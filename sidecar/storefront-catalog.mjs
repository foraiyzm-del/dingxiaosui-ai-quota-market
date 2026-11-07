// Display terms supplied in the user's 2026-11-07 package screenshot.
// Package names describe the catalog, not an entitlement validity period.
// This preview never creates products, prices orders, or changes OPCPay's
// single-card redemption snapshots. Payment readiness comes from each profile.
export function storefrontCatalog() {
  return { dingxiaosui: {
    packages: [
      { id: 'trial', label: '尝鲜卡', priceCents: 990, quota: { text: 10, image: 15, video: 2 } },
      { id: 'week', label: '周卡', priceCents: 2990, quota: { text: 30, image: 45, video: 6 } },
      { id: 'month', label: '月卡', recommended: true, priceCents: 9900, quota: { text: 100, image: 150, video: 20 } },
      { id: 'season', label: '旺季卡', priceCents: 29900, quota: { text: 300, image: 450, video: 70 } },
      { id: 'custom', label: '自由组合', priceCents: null, quota: null },
    ],
    // The only existing per-capability prices belong to an inactive bootstrap
    // sample. They are not verified merchant terms and must not be quoted here.
    customPricing: null,
  } };
}
