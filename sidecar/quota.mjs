import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CAPABILITIES, normalizeQuota, quotaTotal, readQuota } from './quota-values.mjs';
import { mediaSpec } from './media-spec.mjs';
import { createChannelBudgets } from './channel-budgets.mjs';

const MAX_UNITS = 1_000_000;
const MAX_CODES = 1_000;
const MAX_GRANTED = 1_000_000_000_000;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function text(value, field, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(400, `${field} must be a non-empty string of at most ${maximum} characters`);
  }
  return value.trim();
}

function positiveInteger(value, field, maximum = MAX_UNITS) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(400, `${field} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function hashCode(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Synchronous, transaction-safe per-project usage ledger for a DatabaseSync.
 * Tables use quota_ prefixes and never persist a plaintext activation code.
 *
 * Project: { id, name, createdAt }
 * Code: { id, projectId, codeSuffix, units, status: 'unused'|'redeemed',
 *         redeemedBy: string|null, redeemedAt: string|null, createdAt }
 * Usage: { id, projectId, userId, requestId, units,
 *          status: 'reserved'|'committed'|'cancelled', createdAt, settledAt }
 * Balance: { projectId, userId, granted, available, reserved, consumed }
 * generateCodes returns { projectId, quantity, units, codes: string[] }.
 * redeem returns { codeId, projectId, userId, units, balance: Balance }.
 * reserve/settle return { usage: Usage, balance: Balance }.
 * Lists contain the corresponding records above; code hashes stay private.
 * stats returns { projectCount, codeCount, redeemedCodeCount, unusedCodeCount,
 *   accountCount, availableUnits, reservedUnits, committedUnits, usageCount }.
 *
 * Mutators use SAVEPOINTs, so they are atomic both independently and inside a
 * caller's transaction (for example, inventory issuance and fulfilment).
 */
export function createQuota(db) {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const channelBudgets = createChannelBudgets(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS quota_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quota_codes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES quota_projects(id),
      code_hash TEXT NOT NULL UNIQUE,
      code_suffix TEXT NOT NULL,
      units INTEGER NOT NULL CHECK (units > 0 AND units <= ${MAX_UNITS}),
      redeemed_by TEXT,
      redeemed_at TEXT,
      created_at TEXT NOT NULL,
      CHECK ((redeemed_by IS NULL AND redeemed_at IS NULL)
        OR (redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS quota_accounts (
      project_id TEXT NOT NULL REFERENCES quota_projects(id),
      user_id TEXT NOT NULL,
      granted_units INTEGER NOT NULL DEFAULT 0 CHECK (granted_units BETWEEN 0 AND ${MAX_GRANTED}),
      available_units INTEGER NOT NULL DEFAULT 0 CHECK (available_units >= 0),
      reserved_units INTEGER NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
      consumed_units INTEGER NOT NULL DEFAULT 0 CHECK (consumed_units >= 0),
      PRIMARY KEY (project_id, user_id),
      CHECK (available_units + reserved_units + consumed_units = granted_units)
    );
    CREATE TABLE IF NOT EXISTS quota_usage (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      units INTEGER NOT NULL CHECK (units > 0 AND units <= ${MAX_UNITS}),
      status TEXT NOT NULL CHECK (status IN ('reserved', 'committed', 'cancelled')),
      created_at TEXT NOT NULL,
      settled_at TEXT,
      FOREIGN KEY (project_id, user_id) REFERENCES quota_accounts(project_id, user_id),
      UNIQUE (project_id, user_id, request_id),
      CHECK ((status = 'reserved' AND settled_at IS NULL)
        OR (status <> 'reserved' AND settled_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS quota_codes_project ON quota_codes(project_id);
    CREATE INDEX IF NOT EXISTS quota_usage_project ON quota_usage(project_id);
  `);

  const codeColumns = new Set(db.prepare('PRAGMA table_info(quota_codes)').all().map(column => column.name));
  if (!codeColumns.has('issuance_state')) db.exec("ALTER TABLE quota_codes ADD COLUMN issuance_state TEXT NOT NULL DEFAULT 'active' CHECK(issuance_state IN ('active','stock','revoked'))");
  // Serialize the migration with other connections. The shared row preserves
  // every historical grant/reservation, including work still in flight.
  db.exec('BEGIN IMMEDIATE');
  try {
    const codes = new Set(db.prepare('PRAGMA table_info(quota_codes)').all().map(column => column.name));
    if (!codes.has('quota_json')) db.exec('ALTER TABLE quota_codes ADD COLUMN quota_json TEXT');
    if (!codes.has('media_spec_json')) db.exec('ALTER TABLE quota_codes ADD COLUMN media_spec_json TEXT');
    const usages = new Set(db.prepare('PRAGMA table_info(quota_usage)').all().map(column => column.name));
    if (!usages.has('capability')) db.exec('ALTER TABLE quota_usage ADD COLUMN capability TEXT');
    if (!usages.has('allocations_json')) db.exec('ALTER TABLE quota_usage ADD COLUMN allocations_json TEXT');
    const hadBuckets = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='quota_account_buckets'").get();
    db.exec(`CREATE TABLE IF NOT EXISTS quota_account_buckets (
      project_id TEXT NOT NULL, user_id TEXT NOT NULL,
      capability TEXT NOT NULL CHECK(capability IN ('shared','text','image','video')),
      granted_units INTEGER NOT NULL DEFAULT 0 CHECK(granted_units BETWEEN 0 AND ${MAX_GRANTED}),
      available_units INTEGER NOT NULL DEFAULT 0 CHECK(available_units>=0),
      reserved_units INTEGER NOT NULL DEFAULT 0 CHECK(reserved_units>=0),
      consumed_units INTEGER NOT NULL DEFAULT 0 CHECK(consumed_units>=0),
      PRIMARY KEY(project_id,user_id,capability),
      FOREIGN KEY(project_id,user_id) REFERENCES quota_accounts(project_id,user_id),
      CHECK(available_units+reserved_units+consumed_units=granted_units)
    )`);
    if (!hadBuckets) db.exec(`INSERT INTO quota_account_buckets
      SELECT project_id,user_id,'shared',granted_units,available_units,reserved_units,consumed_units FROM quota_accounts`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  let transactionSequence = 0;
  function transaction(work) {
    const point = `quota_${++transactionSequence}`;
    const nested = db.isTransaction;
    db.exec(nested ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec(nested ? `RELEASE ${point}` : 'COMMIT');
      return result;
    } catch (error) {
      db.exec(nested ? `ROLLBACK TO ${point}; RELEASE ${point}` : 'ROLLBACK');
      throw error;
    }
  }

  function projectId(value) {
    const id = text(value, 'projectId', 64);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(id)) {
      fail(400, 'projectId may contain letters, digits, dots, underscores and hyphens');
    }
    return id;
  }

  function requireProject(id) {
    if (!db.prepare('SELECT 1 FROM quota_projects WHERE id = ?').get(id)) fail(404, 'Project not found');
  }

  function accountBalance(id, userId) {
    const row = db.prepare('SELECT * FROM quota_accounts WHERE project_id = ? AND user_id = ?').get(id, userId);
    const result = {
      projectId: id,
      userId,
      granted: row?.granted_units ?? 0,
      available: row?.available_units ?? 0,
      reserved: row?.reserved_units ?? 0,
      consumed: row?.consumed_units ?? 0,
    };
    const buckets = db.prepare('SELECT * FROM quota_account_buckets WHERE project_id=? AND user_id=?').all(id, userId);
    // Preserve the original response shape for shared-only accounts.
    if (buckets.some(bucket => bucket.capability !== 'shared')) {
      const summary = capability => {
        const bucket = buckets.find(item => item.capability === capability);
        return { granted: bucket?.granted_units ?? 0, available: bucket?.available_units ?? 0,
          reserved: bucket?.reserved_units ?? 0, consumed: bucket?.consumed_units ?? 0 };
      };
      result.shared = summary('shared');
      result.byCapability = Object.fromEntries(CAPABILITIES.map(capability => [capability, summary(capability)]));
    }
    return result;
  }

  function usageRecord(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      userId: row.user_id,
      requestId: row.request_id,
      units: row.units,
      status: row.status,
      createdAt: row.created_at,
      settledAt: row.settled_at,
      ...(row.capability ? { capability: row.capability } : {}),
    };
  }

  return {
    listProjects() {
      return db.prepare('SELECT id, name, created_at AS createdAt FROM quota_projects ORDER BY created_at, id').all();
    },

    createProject({ id, name } = {}) {
      id = projectId(id);
      name = text(name, 'name', 160);
      return transaction(() => {
        if (db.prepare('SELECT 1 FROM quota_projects WHERE id = ?').get(id)) fail(409, 'Project already exists');
        const createdAt = new Date().toISOString();
        db.prepare('INSERT INTO quota_projects (id, name, created_at) VALUES (?, ?, ?)').run(id, name, createdAt);
        return { id, name, createdAt };
      });
    },

    generateCodes({ projectId: id, quantity, units, quota: requestedQuota, redeemable = true, mediaSpec: requestedSpec } = {}) {
      id = projectId(id);
      quantity = positiveInteger(quantity, 'quantity', MAX_CODES);
      const quota = normalizeQuota(requestedQuota);
      units = quota ? quotaTotal(quota) : positiveInteger(units, 'units');
      if (typeof redeemable !== 'boolean') fail(400, 'redeemable must be a boolean');
      const spec = mediaSpec(requestedSpec);
      return transaction(() => {
        requireProject(id);
        channelBudgets.allocateForProject({ projectId: id, quota, quantity });
        const createdAt = new Date().toISOString();
        const insert = db.prepare(`INSERT INTO quota_codes
          (id, project_id, code_hash, code_suffix, units, created_at, issuance_state, quota_json, media_spec_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const codes = [];
        for (let index = 0; index < quantity; index += 1) {
          const code = `QTA-${randomBytes(18).toString('hex').toUpperCase()}`;
          insert.run(randomUUID(), id, hashCode(code), code.slice(-4), units, createdAt, redeemable ? 'active' : 'stock', quota ? JSON.stringify(quota) : null, spec ? JSON.stringify(spec) : null);
          codes.push(code);
        }
        return { projectId: id, quantity, units, codes, ...(quota ? { quota } : {}), ...(spec ? { mediaSpec: spec } : {}) };
      });
    },

    activateCode({ codeId } = {}) {
      codeId = text(codeId, 'codeId', 64);
      return transaction(() => {
        const row = db.prepare('SELECT issuance_state FROM quota_codes WHERE id=?').get(codeId);
        if (!row) fail(404, 'Activation code not found');
        if (row.issuance_state === 'revoked') fail(409, 'Activation code has been revoked');
        db.prepare("UPDATE quota_codes SET issuance_state='active' WHERE id=? AND issuance_state='stock'").run(codeId);
      });
    },

    redeem({ projectId: id, code, userId, idempotent = false } = {}) {
      if (typeof idempotent !== 'boolean') fail(400, 'idempotent must be boolean');
      id = projectId(id);
      userId = text(userId, 'userId');
      const codeHash = hashCode(text(code, 'code').toUpperCase());
      return transaction(() => {
        requireProject(id);
        const row = db.prepare('SELECT * FROM quota_codes WHERE code_hash = ? AND project_id = ?').get(codeHash, id);
        if (!row) fail(404, 'Activation code not found for this project');
        if (row.issuance_state !== 'active') fail(409, '此卡密尚未售出或已停用，不能兑换');
        if (row.redeemed_by !== null) {
          if (!idempotent || row.redeemed_by !== userId) fail(409, 'Activation code already redeemed');
          const quota = readQuota(row.quota_json);
          return { codeId: row.id, projectId: id, userId, units: row.units, ...(quota ? { quota } : {}),
            balance: accountBalance(id, userId), replayed: true };
        }
        const current = accountBalance(id, userId);
        if (current.granted > MAX_GRANTED - row.units) fail(409, 'Account quota limit exceeded');
        db.prepare(`INSERT INTO quota_accounts (project_id, user_id, granted_units, available_units)
          VALUES (?, ?, ?, ?) ON CONFLICT(project_id, user_id) DO UPDATE SET
          granted_units = granted_units + excluded.granted_units,
          available_units = available_units + excluded.available_units`).run(id, userId, row.units, row.units);
        const quota = readQuota(row.quota_json);
        const grants = quota ? Object.entries(quota).filter(([, count]) => count > 0) : [['shared', row.units]];
        const grant = db.prepare(`INSERT INTO quota_account_buckets(project_id,user_id,capability,granted_units,available_units)
          VALUES(?,?,?,?,?) ON CONFLICT(project_id,user_id,capability) DO UPDATE SET
          granted_units=granted_units+excluded.granted_units,available_units=available_units+excluded.available_units`);
        for (const [capability, count] of grants) grant.run(id, userId, capability, count, count);
        const redeemedAt = new Date().toISOString();
        const change = db.prepare('UPDATE quota_codes SET redeemed_by = ?, redeemed_at = ? WHERE id = ? AND redeemed_by IS NULL')
          .run(userId, redeemedAt, row.id);
        if (change.changes !== 1) fail(409, 'Activation code already redeemed');
        return { codeId: row.id, projectId: id, userId, units: row.units, ...(quota ? { quota } : {}), balance: accountBalance(id, userId) };
      });
    },

    balance({ projectId: id, userId } = {}) {
      id = projectId(id);
      userId = text(userId, 'userId');
      requireProject(id);
      return accountBalance(id, userId);
    },

    reserve({ projectId: id, userId, requestId, units = 1, capability } = {}) {
      id = projectId(id);
      userId = text(userId, 'userId');
      requestId = text(requestId, 'requestId');
      units = positiveInteger(units, 'units');
      if (capability !== undefined && !CAPABILITIES.includes(capability)) fail(400, 'capability must be text, image or video');
      return transaction(() => {
        requireProject(id);
        const previous = db.prepare('SELECT * FROM quota_usage WHERE project_id = ? AND user_id = ? AND request_id = ?')
          .get(id, userId, requestId);
        if (previous) {
          if (previous.units !== units || (previous.capability ?? undefined) !== capability) fail(409, 'Idempotency key was already used with different units or capability');
          return { usage: usageRecord(previous), balance: accountBalance(id, userId) };
        }
        let remainder = units;
        const allocations = {};
        for (const bucket of capability ? [capability, 'shared'] : ['shared']) {
          const available = db.prepare('SELECT available_units FROM quota_account_buckets WHERE project_id=? AND user_id=? AND capability=?').get(id, userId, bucket)?.available_units ?? 0;
          const count = Math.min(available, remainder);
          if (count > 0) allocations[bucket] = count;
          remainder -= count;
        }
        if (remainder > 0) fail(402, capability ? `Insufficient ${capability} quota` : 'Insufficient shared quota');
        for (const [bucket, count] of Object.entries(allocations)) {
          const changed = db.prepare(`UPDATE quota_account_buckets SET available_units=available_units-?,reserved_units=reserved_units+?
            WHERE project_id=? AND user_id=? AND capability=? AND available_units>=?`).run(count, count, id, userId, bucket, count);
          if (changed.changes !== 1) fail(409, 'Capability quota changed during reservation');
        }
        const change = db.prepare(`UPDATE quota_accounts SET available_units = available_units - ?,
          reserved_units = reserved_units + ? WHERE project_id = ? AND user_id = ? AND available_units >= ?`)
          .run(units, units, id, userId, units);
        if (change.changes !== 1) fail(402, 'Insufficient quota');
        const usageId = randomUUID();
        const createdAt = new Date().toISOString();
        db.prepare(`INSERT INTO quota_usage
          (id, project_id, user_id, request_id, units, status, created_at, capability, allocations_json)
          VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?, ?)`).run(usageId, id, userId, requestId, units, createdAt, capability ?? null, JSON.stringify(allocations));
        const row = db.prepare('SELECT * FROM quota_usage WHERE id = ?').get(usageId);
        return { usage: usageRecord(row), balance: accountBalance(id, userId) };
      });
    },

    settle({ projectId: id, usageId, action } = {}) {
      id = projectId(id);
      usageId = text(usageId, 'usageId');
      if (action !== 'commit' && action !== 'cancel') fail(400, 'action must be commit or cancel');
      const status = action === 'commit' ? 'committed' : 'cancelled';
      return transaction(() => {
        requireProject(id);
        const row = db.prepare('SELECT * FROM quota_usage WHERE id = ? AND project_id = ?').get(usageId, id);
        if (!row) fail(404, 'Usage not found for this project');
        if (row.status !== 'reserved') {
          if (row.status !== status) fail(409, 'Usage was already settled with a different action');
          return { usage: usageRecord(row), balance: accountBalance(id, row.user_id) };
        }
        const column = action === 'commit' ? 'consumed_units' : 'available_units';
        const allocations = row.allocations_json ? JSON.parse(row.allocations_json) : { shared: row.units };
        for (const [bucket, count] of Object.entries(allocations)) {
          const changed = db.prepare(`UPDATE quota_account_buckets SET reserved_units=reserved_units-?,${column}=${column}+?
            WHERE project_id=? AND user_id=? AND capability=? AND reserved_units>=?`).run(count, count, id, row.user_id, bucket, count);
          if (changed.changes !== 1) fail(409, 'Reserved capability quota is inconsistent');
        }
        const change = db.prepare(`UPDATE quota_accounts SET reserved_units = reserved_units - ?,
          ${column} = ${column} + ? WHERE project_id = ? AND user_id = ? AND reserved_units >= ?`)
          .run(row.units, row.units, id, row.user_id, row.units);
        if (change.changes !== 1) fail(409, 'Reserved quota is inconsistent');
        const settledAt = new Date().toISOString();
        db.prepare("UPDATE quota_usage SET status = ?, settled_at = ? WHERE id = ? AND status = 'reserved'")
          .run(status, settledAt, usageId);
        return {
          usage: usageRecord({ ...row, status, settled_at: settledAt }),
          balance: accountBalance(id, row.user_id),
        };
      });
    },

    listCodes() {
      return db.prepare(`SELECT id, project_id AS projectId, code_suffix AS codeSuffix, units, quota_json,
        CASE WHEN redeemed_at IS NULL THEN 'unused' ELSE 'redeemed' END AS status,
        redeemed_by AS redeemedBy, redeemed_at AS redeemedAt, created_at AS createdAt
        FROM quota_codes ORDER BY created_at DESC, id`).all().map(({ quota_json, ...row }) => ({ ...row, ...(quota_json ? { quota: readQuota(quota_json) } : {}) }));
    },

    listUsage() {
      return db.prepare('SELECT * FROM quota_usage ORDER BY created_at DESC, id').all().map(usageRecord);
    },

    stats() {
      const row = db.prepare(`SELECT
        (SELECT COUNT(*) FROM quota_projects) AS projectCount,
        (SELECT COUNT(*) FROM quota_codes) AS codeCount,
        (SELECT COUNT(*) FROM quota_codes WHERE redeemed_at IS NOT NULL) AS redeemedCodeCount,
        (SELECT COUNT(*) FROM quota_codes WHERE redeemed_at IS NULL) AS unusedCodeCount,
        (SELECT COUNT(*) FROM quota_accounts) AS accountCount,
        (SELECT COALESCE(SUM(available_units), 0) FROM quota_accounts) AS availableUnits,
        (SELECT COALESCE(SUM(reserved_units), 0) FROM quota_accounts) AS reservedUnits,
        (SELECT COALESCE(SUM(consumed_units), 0) FROM quota_accounts) AS committedUnits,
        (SELECT COUNT(*) FROM quota_usage) AS usageCount`).get();
      return { ...row };
    },
  };
}
