import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

const PLAN_PRICES: Record<string, string> = {
  pro:     process.env.STRIPE_PRICE_PRO     ?? '',
  cabinet: process.env.STRIPE_PRICE_CABINET ?? '',
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: InstanceType<typeof Stripe> | null;

  constructor(private prisma: PrismaService) {
    const key = process.env.STRIPE_SECRET_KEY;
    this.stripe = key ? new Stripe(key) : null;
    if (!key) this.logger.warn('STRIPE_SECRET_KEY non défini — paiements Stripe désactivés');
  }

  private get stripeClient(): InstanceType<typeof Stripe> {
    if (!this.stripe) throw new BadRequestException('Paiement Stripe non configuré. Contactez le support.');
    return this.stripe;
  }

  // ── Créer une session de paiement Stripe Checkout ────────────
  async createCheckoutSession(userId: string, plan: 'pro' | 'cabinet'): Promise<{ url: string }> {
    const priceId = PLAN_PRICES[plan];
    if (!priceId) throw new BadRequestException(`Plan "${plan}" non configuré`);

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const customerId = await this.getOrCreateStripeCustomer(
      userId,
      user.email,
      `${user.first_name} ${user.last_name}`,
    );

    const session = await this.stripeClient.checkout.sessions.create({
      customer:   customerId,
      mode:       'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/dashboard?upgrade=success`,
      cancel_url:  `${process.env.FRONTEND_URL}/dashboard?upgrade=cancelled`,
      metadata:    { userId, plan },
      subscription_data: {
        trial_period_days: 14,
        metadata: { userId, plan },
      },
    });

    return { url: session.url! };
  }

  // ── Portail client (gérer / annuler abonnement) ───────────────
  async createPortalSession(userId: string): Promise<{ url: string }> {
    const sub = await this.prisma.subscription.findFirst({
      where:   { user_id: userId },
      orderBy: { created_at: 'desc' },
    });

    if (!sub?.stripe_customer_id) {
      throw new BadRequestException('Aucun abonnement actif trouvé');
    }

    const session = await this.stripeClient.billingPortal.sessions.create({
      customer:   sub.stripe_customer_id,
      return_url: `${process.env.FRONTEND_URL}/dashboard`,
    });

    return { url: session.url };
  }

  // ── Statut abonnement ─────────────────────────────────────────
  async getSubscription(userId: string) {
    const sub = await this.prisma.subscription.findFirst({
      where:   { user_id: userId },
      orderBy: { created_at: 'desc' },
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where:  { id: userId },
      select: { plan: true },
    });

    return { subscription: sub, currentPlan: user.plan };
  }

  // ── Webhook Stripe ────────────────────────────────────────────
  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    let event: any;

    try {
      event = this.stripeClient.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET ?? '',
      );
    } catch {
      throw new BadRequestException('Signature webhook invalide');
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.updated':
        await this.onSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_failed':
        await this.onPaymentFailed(event.data.object);
        break;
    }
  }

  // ── Handlers événements ───────────────────────────────────────
  private async onCheckoutCompleted(session: any) {
    const userId = session.metadata?.userId as string | undefined;
    const plan   = session.metadata?.plan   as 'pro' | 'cabinet' | undefined;
    if (!userId || !plan) return;

    const stripeSub = await this.stripeClient.subscriptions.retrieve(session.subscription as string);
    const sub = stripeSub as any;

    await this.prisma.$transaction([
      this.prisma.subscription.upsert({
        where:  { id: userId },
        create: {
          user_id:              userId,
          plan:                 plan as any,
          status:               'essai',
          stripe_customer_id:   session.customer as string,
          stripe_sub_id:        sub.id,
          current_period_start: new Date(sub.current_period_start * 1000),
          current_period_end:   new Date(sub.current_period_end   * 1000),
          trial_ends_at:        sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        },
        update: {
          plan:                 plan as any,
          status:               'essai',
          stripe_customer_id:   session.customer as string,
          stripe_sub_id:        sub.id,
          current_period_start: new Date(sub.current_period_start * 1000),
          current_period_end:   new Date(sub.current_period_end   * 1000),
          trial_ends_at:        sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data:  { plan: plan as any },
      }),
    ]);

    this.logger.log(`Checkout complété: userId=${userId} plan=${plan}`);
  }

  private async onSubscriptionUpdated(stripeSub: any) {
    const userId = stripeSub.metadata?.userId as string | undefined;
    if (!userId) return;

    const status = this.mapStripeStatus(stripeSub.status);
    const plan   = stripeSub.metadata?.plan as any;

    await this.prisma.subscription.updateMany({
      where: { stripe_sub_id: stripeSub.id },
      data:  {
        status,
        ...(plan ? { plan } : {}),
        current_period_start: new Date(stripeSub.current_period_start * 1000),
        current_period_end:   new Date(stripeSub.current_period_end   * 1000),
      },
    });

    if (status === 'actif' && plan) {
      await this.prisma.user.update({ where: { id: userId }, data: { plan } });
    }
  }

  private async onSubscriptionDeleted(stripeSub: any) {
    const userId = stripeSub.metadata?.userId as string | undefined;

    await this.prisma.subscription.updateMany({
      where: { stripe_sub_id: stripeSub.id },
      data:  { status: 'annule', cancelled_at: new Date() },
    });

    if (userId) {
      await this.prisma.user.update({ where: { id: userId }, data: { plan: 'free' } });
    }
  }

  private async onPaymentFailed(invoice: any) {
    const subId = invoice.subscription as string | undefined;
    if (!subId) return;

    await this.prisma.subscription.updateMany({
      where: { stripe_sub_id: subId },
      data:  { status: 'expire' },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────
  private async getOrCreateStripeCustomer(
    userId: string,
    email: string,
    name: string,
  ): Promise<string> {
    const existing = await this.prisma.subscription.findFirst({
      where:   { user_id: userId, stripe_customer_id: { not: null } },
      orderBy: { created_at: 'desc' },
    });

    if (existing?.stripe_customer_id) return existing.stripe_customer_id;

    const customer = await this.stripeClient.customers.create({ email, name, metadata: { userId } });
    return customer.id;
  }

  private mapStripeStatus(status: string): 'actif' | 'annule' | 'expire' | 'essai' {
    switch (status) {
      case 'active':   return 'actif';
      case 'trialing': return 'essai';
      case 'canceled': return 'annule';
      default:         return 'expire';
    }
  }
}
