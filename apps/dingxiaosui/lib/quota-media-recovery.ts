export const SAVE_ATTEMPT_CAP = 4;

export const quotaJobUpdateSql = "UPDATE media_jobs SET status=?,error=?,updated_at=?,outputs_json=COALESCE(?,outputs_json),upstream_id=COALESCE(?,upstream_id),key_cipher=CASE WHEN ? IS NOT NULL OR ?='failed' THEN '' ELSE key_cipher END WHERE id=? AND provider_kind='quota-center' AND ((status NOT IN ('succeeded','failed') AND (status!='saving' OR ? IN ('saving','succeeded','failed'))) OR (status='succeeded' AND delivery_state='pending' AND ?='failed'))";

export const quotaOpenWork = "(status IN ('queued','running','saving','unknown') OR (status='succeeded' AND IFNULL(delivery_state,'none') IN ('pending','none')) OR (status='failed' AND IFNULL(refund_state,'none')='pending'))";

export const quotaSweepWhere = `capability IN ('image','video') AND ((provider_kind='apimart' AND status IN ('queued','running','saving') AND upstream_id IS NOT NULL) OR (provider_kind='quota-center' AND ${quotaOpenWork})) AND poll_after<=?`;

export const quotaSaveCommitSql = "UPDATE media_jobs SET status='succeeded', error=NULL, updated_at=?, outputs_json=?, delivery_state=?, poll_after=?, key_cipher='' WHERE id=? AND provider_kind='quota-center' AND status!='failed' AND (status!='succeeded' OR IFNULL(delivery_state,'none') IN ('none','pending'))";

export const quotaRefundSql = "UPDATE media_jobs SET status='failed', error=?, updated_at=?, refund_state=?, poll_after=?, key_cipher='' WHERE id=? AND provider_kind='quota-center' AND (status IN ('saving','queued','running','unknown') OR (status='failed' AND IFNULL(refund_state,'none')='pending'))";

export const quotaDeliveredSql = "UPDATE media_jobs SET delivery_state='delivered', error=NULL, updated_at=?, poll_after=? WHERE id=? AND provider_kind='quota-center' AND status='succeeded'";

export const REFUND_PENDING_MESSAGE = '作品未能保存，次数退回还没确认。请稍后刷新，不会重新生成。';
export const REFUND_CONFIRMED_MESSAGE = '作品未能保存，预留次数已退回。可以点“重新生成”。';

export function nextSaveAttempts(previous: number | null | undefined) {
  return (Number.isInteger(previous) && (previous as number) > 0 ? (previous as number) : 0) + 1;
}

export function nextDeliveryState(current: string | null | undefined, accepted: boolean): 'pending' | 'delivered' {
  if (current === 'delivered') return 'delivered';
  return accepted ? 'delivered' : 'pending';
}

export type DownloadVerdict = { terminal: boolean; refund: boolean; message: string };

/** Decide whether a stuck saving job may become failed. Transient errors keep saving. */
export function downloadVerdict(status: number, attempts: number, centerStatus: string | null | undefined): DownloadVerdict {
  const permanent = status === 404 || status === 410 || status === 400 || status === 415;
  const centerFailed = centerStatus === 'failed';
  const capped = attempts >= SAVE_ATTEMPT_CAP;
  if (!centerFailed && !permanent && !capped) {
    return { terminal: false, refund: false, message: '作品已生成，保存还没完成。请稍后点重试，不会重新扣次。' };
  }
  const refund = centerStatus === 'ready';
  const message = centerFailed
    ? '作品未能交付，预留次数已退回。可以点“重新生成”。'
    : refund
      ? REFUND_PENDING_MESSAGE
      : '保存多次仍未成功。请点“重新生成”；若次数仍预留，退回后才能再次使用。';
  return { terminal: true, refund, message };
}
