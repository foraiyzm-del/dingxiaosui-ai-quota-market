export const SAVE_ATTEMPT_CAP = 4;

export const quotaJobUpdateSql = "UPDATE media_jobs SET status=?,error=?,updated_at=?,outputs_json=COALESCE(?,outputs_json),upstream_id=COALESCE(?,upstream_id),key_cipher=CASE WHEN ? IS NOT NULL OR ?='failed' THEN '' ELSE key_cipher END WHERE id=? AND provider_kind='quota-center' AND ((status NOT IN ('succeeded','failed') AND (status!='saving' OR ? IN ('saving','succeeded','failed'))) OR (status='succeeded' AND delivery_state='pending' AND ?='failed'))";

export const quotaSweepWhere = "capability IN ('image','video') AND ((provider_kind='apimart' AND status IN ('queued','running','saving') AND upstream_id IS NOT NULL) OR (provider_kind='quota-center' AND (status IN ('queued','running','saving','unknown') OR (status='succeeded' AND delivery_state='pending')))) AND poll_after<=?";

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
      ? '作品文件已失效，次数已退回。可以点“重新生成”，不会重复扣已退回的次数。'
      : '保存多次仍未成功。请点“重新生成”；若次数仍预留，退回后才能再次使用。';
  return { terminal: true, refund, message };
}
