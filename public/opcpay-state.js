// Display selection only. The server validates every new intent independently.
export function paymentSelection(info, search = '', intent) {
  const id = intent?.snapshot?.packageId || new URLSearchParams(search).get('package') || 'trial';
  const profile = (info?.packages ?? [info]).find(value=>value?.package?.packageId===id);
  if (!profile || !['trial','week','month'].includes(id)) return null;
  return {...profile, package:intent?.snapshot || profile.package};
}
export function savedIntentSelection(intents, search = '') {
  const query = new URLSearchParams(search), requested = query.get('intent');
  if (requested) return intents.find(item=>item.id===requested);
  const id=query.get('package') || 'trial';
  return intents.find(item=>item.snapshot?.packageId===id && !['fulfilled','cancelled','expired','failed'].includes(item.status));
}
