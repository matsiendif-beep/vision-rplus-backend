// ════════════════════════════════════════════════════════════
//  Mobile Money (CinetPay) — Orange Money, MTN, Airtel, Moov, Wave…
//
//  Paiement d'avance pour 30 jours, sans renouvellement automatique
//  (CGV art. 6). Sécurité :
//   • la notification ne fait jamais foi : le statut, le montant et
//     la formule sont relus auprès de l'API CinetPay ;
//   • le montant payé doit correspondre au prix de la formule ;
//   • chaque transaction n'est prise en compte qu'une fois.
//  Expiration et rappel : voir BillingSchedulerService.
// ════════════════════════════════════════════════════════════
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaidPlan, BillingCurrency, PLAN_PRICES, MOBILE_MONEY_DAYS, appUrl, apiUrl, planLabel,
} from './billing-plans';

const CINETPAY_BASE = 'https://api-checkout.cinetpay.com/v2';
const DAY = 24 * 60 * 60 * 1000;
const PROCESSED = 'billing.cinetpay.processed';

@Injectable()
export class CinetPayService {
  private readonly logger = new Logger(CinetPayService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get creds() {
    const siteId = process.env.CINETPAY_SITE_ID, apiKey = process.env.CINETPAY_API_KEY;
    if (!siteId || !apiKey) throw new BadRequestException('Le paiement Mobile Money n\'est pas encore disponible. Contactez-nous.');
    return { siteId, apiKey };
  }

  // ── Initier un paiement Mobile Money ─────────────────────────
  async initiatePayment(params: {
    userId: string; plan: PaidPlan; currency: BillingCurrency; phone: string; countryCode: string;
  }) {
    const { siteId, apiKey } = this.creds;
    const user = await this.prisma.user.findUnique({
      where:  { id: params.userId },
      select: { email: true, first_name: true, last_name: true },
    });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const amount  = PLAN_PRICES[params.plan][params.currency];
    const transId = `VP_${params.userId.slice(0, 8)}_${Date.now()}`;

    const res = await fetch(`${CINETPAY_BASE}/payment`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey: apiKey, site_id: siteId,
        transaction_id: transId,
        amount, currency: params.currency,
        description: `Vision R+ ${planLabel(params.plan)} — ${MOBILE_MONEY_DAYS} jours`,
        customer_id: params.userId,
        customer_name: user.first_name, customer_surname: user.last_name,
        customer_email: user.email,
        customer_phone_number: params.phone,
        customer_address: '', customer_city: '',
        customer_country: params.countryCode, customer_state: params.countryCode, customer_zip_code: '',
        notify_url: `${apiUrl()}/billing/cinetpay/notify`,
        return_url: `${appUrl()}/abonnement?paiement=ok&moyen=mobile-money`,
        channels:   'MOBILE_MONEY',
        metadata:   JSON.stringify({ userId: params.userId, plan: params.plan }),
        lang:       'FR',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));
    if (data.code !== '201') {
      this.logger.error(`Erreur CinetPay init : ${JSON.stringify(data).slice(0, 300)}`);
      throw new BadRequestException(data.message ?? 'Le paiement Mobile Money n\'a pas pu être initié. Réessayez.');
    }
    this.logger.log(`CinetPay paiement initié : ${transId} — ${amount} ${params.currency}`);
    return { payment_url: data.data.payment_url, transaction_id: transId, amount, currency: params.currency };
  }

  // ── Statut réel d'une transaction (fait foi) ─────────────────
  async checkPayment(transactionId: string) {
    const { siteId, apiKey } = this.creds;
    const res = await fetch(`${CINETPAY_BASE}/payment/check`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ apikey: apiKey, site_id: siteId, transaction_id: transactionId }),
      signal:  AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));
    let metadata: { userId?: string; plan?: string } = {};
    try {
      const raw = data.data?.metadata;
      metadata = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
    } catch { /* métadonnées illisibles : traitées comme absentes */ }
    return {
      status:   (data.data?.status ?? 'PENDING') as 'ACCEPTED' | 'REFUSED' | 'PENDING' | string,
      amount:   Number(data.data?.amount ?? 0),
      currency: String(data.data?.currency ?? ''),
      metadata,
    };
  }

  // ── Notification CinetPay ────────────────────────────────────
  async handleNotification(body: any): Promise<void> {
    const transactionId = body?.cpm_trans_id;
    if (!transactionId || typeof transactionId !== 'string') return;

    const already = await this.prisma.auditLog.findFirst({ where: { action: PROCESSED, record_id: transactionId }, select: { id: true } });
    if (already) return;   // déjà pris en compte (CinetPay renvoie parfois la notification)

    const tx = await this.checkPayment(transactionId);
    if (tx.status !== 'ACCEPTED') {
      this.logger.warn(`CinetPay : transaction ${transactionId} non acceptée (${tx.status})`);
      return;
    }
    const userId = tx.metadata.userId;
    const plan   = tx.metadata.plan as PaidPlan | undefined;
    const currency = tx.currency as BillingCurrency;
    if (!userId || (plan !== 'pro' && plan !== 'cabinet') || !PLAN_PRICES[plan][currency]) {
      this.logger.error(`CinetPay : transaction ${transactionId} sans formule ou devise valide`);
      return;
    }
    if (tx.amount < PLAN_PRICES[plan][currency]) {
      this.logger.error(`CinetPay : montant insuffisant pour ${transactionId} (${tx.amount} ${currency} < ${PLAN_PRICES[plan][currency]})`);
      return;
    }

    // Prolonge à partir de la fin de la période en cours si elle n'est pas terminée
    const existing = await this.prisma.subscription.findFirst({
      where: { user_id: userId, stripe_sub_id: null },
      orderBy: { created_at: 'desc' },
    });
    const now = Date.now();
    const from = existing?.current_period_end && existing.current_period_end.getTime() > now && existing.status === 'actif'
      ? existing.current_period_end.getTime() : now;
    const data = {
      plan: plan as any, status: 'actif' as const,
      current_period_start: new Date(from),
      current_period_end:   new Date(from + MOBILE_MONEY_DAYS * DAY),
      cancelled_at: null,
    };

    await this.prisma.$transaction(async (t) => {
      if (existing) await t.subscription.update({ where: { id: existing.id }, data });
      else          await t.subscription.create({ data: { ...data, user_id: userId } });
      await t.user.update({ where: { id: userId }, data: { plan: plan as any } });
      await t.auditLog.create({
        data: { user_id: userId, action: PROCESSED, table_name: 'subscriptions', record_id: transactionId,
                new_values: { plan, amount: tx.amount, currency } },
      });
    });
    this.logger.log(`CinetPay : ${userId} → ${plan} jusqu'au ${data.current_period_end.toISOString().slice(0, 10)}`);
  }
}
