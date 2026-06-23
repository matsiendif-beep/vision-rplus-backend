import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ── CinetPay — Mobile Money Afrique (Gabon, Congo, Cameroun, CI…)
// Supporte : Airtel Money, Moov Money, MTN, Orange Money, Wave

const CINETPAY_BASE = 'https://api-checkout.cinetpay.com/v2';

@Injectable()
export class CinetPayService {
  private readonly logger = new Logger(CinetPayService.name);

  private readonly siteId  = process.env.CINETPAY_SITE_ID!;
  private readonly apiKey  = process.env.CINETPAY_API_KEY!;
  private readonly baseUrl = process.env.FRONTEND_URL ?? 'https://visionrplus.com';

  constructor(private readonly prisma: PrismaService) {}

  // ── Initier un paiement Mobile Money ─────────────────────────
  async initiatePayment(params: {
    userId:      string;
    plan:        'pro' | 'cabinet';
    currency:    'XAF' | 'XOF' | 'EUR';
    phone:       string;
    countryCode: string; // 'GA' Gabon, 'CG' Congo, 'CM' Cameroun, 'CI' Côte d'Ivoire
  }) {
    if (!this.siteId || !this.apiKey) {
      throw new BadRequestException('CinetPay non configuré. Contactez le support.');
    }

    const user = await this.prisma.user.findUnique({
      where:  { id: params.userId },
      select: { email: true, first_name: true, last_name: true },
    });
    if (!user) throw new BadRequestException('Utilisateur introuvable');

    const amount      = this.getPlanAmount(params.plan, params.currency);
    const transId     = `VP_${params.userId.slice(0, 8)}_${Date.now()}`;
    const description = `Vision R+ ${params.plan === 'pro' ? 'Pro' : 'Cabinet'} — 1 mois`;

    const payload = {
      apikey:           this.apiKey,
      site_id:          this.siteId,
      transaction_id:   transId,
      amount,
      currency:         params.currency,
      alternative_currency: '',
      description,
      customer_id:      params.userId,
      customer_name:    user.first_name,
      customer_surname: user.last_name,
      customer_email:   user.email,
      customer_phone_number: params.phone,
      customer_address: '',
      customer_city:    '',
      customer_country: params.countryCode,
      customer_state:   params.countryCode,
      customer_zip_code: '',
      notify_url:   `${this.baseUrl.replace('visionrplus.com', process.env.BACKEND_URL ?? 'api.visionrplus.com')}/billing/cinetpay/notify`,
      return_url:   `${this.baseUrl}/settings/billing?success=1&provider=cinetpay`,
      channels:     'MOBILE_MONEY',
      metadata:     JSON.stringify({ userId: params.userId, plan: params.plan }),
      lang:         'FR',
      invoice_data: {},
    };

    const res = await fetch(`${CINETPAY_BASE}/payment`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const data = await res.json();

    if (data.code !== '201') {
      this.logger.error('Erreur CinetPay init', data);
      throw new BadRequestException(data.message ?? 'Erreur initialisation paiement');
    }

    this.logger.log(`CinetPay paiement initié: ${transId} — ${amount} ${params.currency}`);

    return {
      payment_url:    data.data.payment_url,
      transaction_id: transId,
      amount,
      currency:       params.currency,
    };
  }

  // ── Vérifier le statut d'un paiement ─────────────────────────
  async checkPaymentStatus(transactionId: string): Promise<{
    status: 'ACCEPTED' | 'REFUSED' | 'PENDING';
    amount: number;
    currency: string;
  }> {
    const res = await fetch(`${CINETPAY_BASE}/payment/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apikey:         this.apiKey,
        site_id:        this.siteId,
        transaction_id: transactionId,
      }),
    });

    const data = await res.json();
    return {
      status:   data.data?.status ?? 'PENDING',
      amount:   data.data?.amount ?? 0,
      currency: data.data?.currency ?? 'XAF',
    };
  }

  // ── Traiter la notification de paiement (webhook CinetPay) ───
  async handleNotification(body: any): Promise<void> {
    const transactionId = body.cpm_trans_id;
    if (!transactionId) return;

    const status = await this.checkPaymentStatus(transactionId);
    if (status.status !== 'ACCEPTED') {
      this.logger.warn(`CinetPay paiement refusé: ${transactionId}`);
      return;
    }

    // Extraire les métadonnées
    let metadata: { userId: string; plan: string } | null = null;
    try {
      metadata = JSON.parse(body.cpm_custom ?? '{}');
    } catch {
      this.logger.error(`Métadonnées CinetPay invalides: ${body.cpm_custom}`);
      return;
    }

    if (!metadata?.userId || !metadata?.plan) return;

    // Mettre à jour le plan de l'utilisateur
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: metadata.userId },
        data:  { plan: metadata.plan as any },
      }),
      this.prisma.subscription.upsert({
        where:  { id: `cinetpay_${metadata.userId}` },
        create: {
          id:                  `cinetpay_${metadata.userId}`,
          user_id:             metadata.userId,
          plan:                metadata.plan as any,
          status:              'actif',
          current_period_start: new Date(),
          current_period_end:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        update: {
          plan:                metadata.plan as any,
          status:              'actif',
          current_period_start: new Date(),
          current_period_end:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    this.logger.log(`CinetPay: utilisateur ${metadata.userId} upgradé vers ${metadata.plan}`);
  }

  // ── Montants par plan et devise ───────────────────────────────
  private getPlanAmount(plan: 'pro' | 'cabinet', currency: string): number {
    const prices: Record<string, Record<string, number>> = {
      pro: {
        EUR: 29,
        XAF: 19000, // ~29€ en FCFA CFA
        XOF: 19000,
        USD: 32,
      },
      cabinet: {
        EUR: 79,
        XAF: 52000,
        XOF: 52000,
        USD: 87,
      },
    };
    return prices[plan]?.[currency] ?? prices[plan].EUR;
  }
}
