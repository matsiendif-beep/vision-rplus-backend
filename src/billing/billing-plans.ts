// ── billing/billing-plans.ts ─────────────────────────────────
//  Prix des formules (source unique côté serveur ; identiques aux CGV
//  et à vision-rplus-frontend/src/lib/legal.ts).
// ─────────────────────────────────────────────────────────────
export type PaidPlan = 'pro' | 'cabinet';
export type BillingCurrency = 'EUR' | 'XAF' | 'XOF';

export const PLAN_PRICES: Record<PaidPlan, Record<BillingCurrency, number>> = {
  pro:     { EUR: 29, XAF: 19_000, XOF: 19_000 },
  cabinet: { EUR: 79, XAF: 52_000, XOF: 52_000 },
};

/** Clés de recherche des prix Stripe (créés automatiquement s'ils n'existent pas). */
export const STRIPE_LOOKUP_KEYS: Record<PaidPlan, string> = {
  pro:     'visionrplus_pro_monthly_eur',
  cabinet: 'visionrplus_cabinet_monthly_eur',
};

export const TRIAL_DAYS = 14;
export const MOBILE_MONEY_DAYS = 30;

export const planLabel = (p: string) => (p === 'cabinet' ? 'Cabinet' : p === 'pro' ? 'Pro' : 'Gratuit');

/** URL publique du site (liens de retour après paiement). */
export const appUrl = () => (process.env.APP_URL ?? 'https://www.visionrplus.com').replace(/\/$/, '');

/** URL publique de l'API (notifications CinetPay). */
export const apiUrl = () =>
  (process.env.PUBLIC_API_URL ?? 'https://vision-rplus-backend-production.up.railway.app/api/v1').replace(/\/$/, '');
