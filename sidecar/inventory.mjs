import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { normalizeQuota, quotaTotal, quotaKey, readQuota } from './quota-values.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();

// Internal inventory service. Callers validate product/SKU rules; this module
// owns card lifecycle and encrypted delivery, and never stores readable codes.
export function createInventory(db, { quota, secret }) {
  const key = createHash('sha256').update(`inventory-code-encryption:${secret}`).digest();
  db.exec(`
    CREATE TABLE IF NOT EXISTS shop_card_batches (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES shop_products(id),
      project_id TEXT NOT NULL REFERENCES quota_projects(id),
      sku_id TEXT,
      product_name TEXT NOT NULL,
      package_label TEXT NOT NULL,
      units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 1000000),
      quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shop_inventory (
      id TEXT PRIMARY KEY REFERENCES quota_codes(id),
      batch_id TEXT NOT NULL REFERENCES shop_card_batches(id),
      product_id TEXT NOT NULL REFERENCES shop_products(id),
      project_id TEXT NOT NULL REFERENCES quota_projects(id),
      sku_id TEXT,
      units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 1000000),
      status TEXT NOT NULL CHECK(status IN ('available','reserved','sold','revoked')),
      order_id TEXT UNIQUE REFERENCES shop_orders(id),
      code_ciphertext TEXT NOT NULL,
      code_iv TEXT NOT NULL,
      code_tag TEXT NOT NULL,
      code_suffix TEXT NOT NULL,
      created_at TEXT NOT NULL,
      reserved_at TEXT,
      sold_at TEXT,
      CHECK((status IN ('available','revoked') AND order_id IS NULL) OR (status IN ('reserved','sold') AND order_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS shop_inventory_match ON shop_inventory(product_id,project_id,sku_id,units,status);
    CREATE INDEX IF NOT EXISTS shop_inventory_batch ON shop_inventory(batch_id);
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['shop_card_batches', 'shop_inventory']) {
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
      if (!columns.has('quota_json')) db.exec(`ALTER TABLE ${table} ADD COLUMN quota_json TEXT NOT NULL DEFAULT ''`);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  let sequence = 0;
  function transaction(work) {
    const point = `inventory_${++sequence}`;
    const nested = db.isTransaction;
    db.exec(nested ? `SAVEPOINT ${point}` : 'BEGIN IMMEDIATE');
    try { const result = work(); db.exec(nested ? `RELEASE ${point}` : 'COMMIT'); return result; }
    catch (error) { db.exec(nested ? `ROLLBACK TO ${point}; RELEASE ${point}` : 'ROLLBACK'); throw error; }
  }
  function encrypt(code, id, projectId) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`inventory:${id}:${projectId}`));
    const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
    return [encrypted.toString('base64'), iv.toString('base64'), cipher.getAuthTag().toString('base64')];
  }
  function decrypt(row) {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.code_iv, 'base64'));
    decipher.setAAD(Buffer.from(`inventory:${row.id}:${row.project_id}`));
    decipher.setAuthTag(Buffer.from(row.code_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.code_ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }
  function record(row) {
    return { id: row.id, batchId: row.batch_id, productId: row.product_id, projectId: row.project_id,
      skuId: row.sku_id, units: row.units, status: row.status, orderId: row.order_id,
      codeSuffix: row.code_suffix, createdAt: row.created_at, reservedAt: row.reserved_at,
      soldAt: row.sold_at, redeemedAt: row.redeemed_at ?? null, quota: readQuota(row.quota_json) };
  }
  function batches() {
    return db.prepare(`SELECT b.*, SUM(i.status='available') AS available, SUM(i.status='reserved') AS reserved,
      SUM(i.status='sold') AS sold, SUM(i.status='revoked') AS revoked, SUM(q.redeemed_at IS NOT NULL) AS redeemed
      FROM shop_card_batches b JOIN shop_inventory i ON i.batch_id=b.id JOIN quota_codes q ON q.id=i.id
      GROUP BY b.id ORDER BY b.created_at DESC,b.id`).all().map(row => ({ batchId: row.id, id: row.id,
        productId: row.product_id, projectId: row.project_id, packageId: row.sku_id, skuId: row.sku_id,
        productName: row.product_name, packageLabel: row.package_label, units: row.units, quantity: row.quantity,
        createdAt: row.created_at, available: row.available, reserved: row.reserved, sold: row.sold,
        revoked: row.revoked, redeemed: row.redeemed, quota: readQuota(row.quota_json) }));
  }
  return {
    generate({ productId, projectId, skuId = null, productName, packageLabel, units, quantity, quota: requestedQuota }) {
      const allocation = normalizeQuota(requestedQuota), allocationKey = quotaKey(allocation);
      if (allocation) units = quotaTotal(allocation);
      return transaction(() => {
        const batchId = randomBytes(16).toString('hex'), createdAt = now();
        db.prepare(`INSERT INTO shop_card_batches(id,product_id,project_id,sku_id,product_name,package_label,units,quantity,created_at,quota_json)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(batchId, productId, projectId, skuId, productName, packageLabel, units, quantity, createdAt, allocationKey);
        const generated = quota.generateCodes({ projectId, units, quantity, quota: allocation, redeemable: false });
        const find = db.prepare('SELECT id FROM quota_codes WHERE code_hash=?');
        const insert = db.prepare(`INSERT INTO shop_inventory(id,batch_id,product_id,project_id,sku_id,units,status,
          code_ciphertext,code_iv,code_tag,code_suffix,created_at,quota_json) VALUES (?,?,?,?,?,?,'available',?,?,?,?,?,?)`);
        for (const code of generated.codes) {
          const row = find.get(createHash('sha256').update(code).digest('hex'));
          if (!row) fail(500, '库存卡签发失败');
          insert.run(row.id, batchId, productId, projectId, skuId, units, ...encrypt(code, row.id, projectId), code.slice(-4), createdAt, allocationKey);
        }
        return batches().find(batch => batch.batchId === batchId);
      });
    },
    available({ productId, projectId, skuId = null, units, quota: allocation }) {
      return db.prepare("SELECT COUNT(*) AS n FROM shop_inventory WHERE product_id=? AND project_id=? AND sku_id IS ? AND units=? AND quota_json=? AND status='available'")
        .get(productId, projectId, skuId, units, quotaKey(allocation)).n;
    },
    customStock({ productId, projectId }) {
      return db.prepare("SELECT units,COUNT(*) AS available FROM shop_inventory WHERE product_id=? AND project_id=? AND sku_id IS NULL AND quota_json='' AND status='available' GROUP BY units ORDER BY units")
        .all(productId, projectId).map(row => ({ ...row }));
    },
    reserve({ productId, projectId, skuId = null, units, orderId, quota: allocation, batchId }) {
      const allocationKey = quotaKey(allocation);
      return transaction(() => {
        const existing = db.prepare('SELECT * FROM shop_inventory WHERE order_id=?').get(orderId);
        if (existing) {
          if (existing.product_id !== productId || existing.project_id !== projectId || existing.sku_id !== skuId || existing.units !== units || existing.quota_json !== allocationKey) fail(409, '订单库存规格不匹配');
          return record(existing);
        }
        const row = db.prepare("SELECT * FROM shop_inventory WHERE product_id=? AND project_id=? AND sku_id IS ? AND units=? AND quota_json=? AND status='available' AND (? IS NULL OR batch_id=?) ORDER BY created_at,id LIMIT 1")
          .get(productId, projectId, skuId, units, allocationKey, batchId ?? null, batchId ?? null);
        if (!row) fail(409, '此套餐库存不足，请选择其他套餐或等待补货');
        const reservedAt = now();
        const change = db.prepare("UPDATE shop_inventory SET status='reserved',order_id=?,reserved_at=? WHERE id=? AND status='available'").run(orderId, reservedAt, row.id);
        if (change.changes !== 1) fail(409, '库存已被其他订单预留，请重新下单');
        return record({ ...row, status: 'reserved', order_id: orderId, reserved_at: reservedAt });
      });
    },
    release({ orderId }) {
      return transaction(() => db.prepare("UPDATE shop_inventory SET status='available',order_id=NULL,reserved_at=NULL WHERE order_id=? AND status='reserved'").run(orderId).changes);
    },
    fulfill({ orderId }) {
      return transaction(() => {
        const row = db.prepare('SELECT * FROM shop_inventory WHERE order_id=?').get(orderId);
        if (!row || !['reserved','sold'].includes(row.status)) fail(409, '订单没有可交付的预留卡密');
        const code = decrypt(row);
        if (row.status !== 'sold') {
          quota.activateCode({ codeId: row.id });
          db.prepare("UPDATE shop_inventory SET status='sold',sold_at=? WHERE id=? AND status='reserved'").run(now(), row.id);
        }
        return { ...record(db.prepare('SELECT * FROM shop_inventory WHERE id=?').get(row.id)), code };
      });
    },
    list() {
      return db.prepare('SELECT i.*,q.redeemed_at FROM shop_inventory i JOIN quota_codes q ON q.id=i.id ORDER BY i.created_at DESC,i.id').all().map(record);
    },
    listBatches: batches,
    exportBatch({ batchId }) {
      const batch = batches().find(item => item.batchId === batchId);
      if (!batch) fail(404, '制卡批次不存在');
      return { batch, codes: db.prepare('SELECT i.*,q.redeemed_at FROM shop_inventory i JOIN quota_codes q ON q.id=i.id WHERE batch_id=? ORDER BY i.id')
        .all(batchId).map(row => ({ ...record(row), code: decrypt(row) })) };
    },
    stats() {
      return { ...db.prepare(`SELECT COUNT(*) AS inventoryCount,
        COALESCE(SUM(status='available'),0) AS availableCardCount,COALESCE(SUM(status='reserved'),0) AS reservedCardCount,
        COALESCE(SUM(status='sold'),0) AS soldCardCount,COALESCE(SUM(status='revoked'),0) AS revokedCardCount,
        (SELECT COUNT(*) FROM shop_card_batches) AS batchCount FROM shop_inventory`).get() };
    },
  };
}
