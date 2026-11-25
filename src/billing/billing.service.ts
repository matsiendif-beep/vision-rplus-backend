// ════════════════════════════════════════════════════════════
//  Abonnements par carte bancaire (Stripe)
//
//  • Fonctionne en mode test (clé sk_test_…) comme en production
//    (sk_live_…) : seul le changement de clés dans Railway compte.
//  • Les prix mensuels (Pro 29 €, Cabinet 79 €) sont créés
//    automatiquement dans Stripe s'ils n'existent pas (lookup_key).
//  • Compatible avec l'API Stripe « dahlia » (2026) : les périodes
//    sont lues sur les éléments d'abonnement.
// ════════════════════════════════════════════════════════════
import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingEmailsService } from '../email/onboarding-emails.service';
import {
  PaidPlan, PLAN_PRICES, STRIPE_LOOKUP_KEYS, TRIAL_DAYS, appUrl, planLabel,
} from './billing-plans';

type StripeClient = InstanceType<typeof Stripe>;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: StripeClient | null;
  private priceCache = new Map<PaidPlan, string>();

  constructor(
    private prisma: PrismaService,
    private onboardingEmails: OnboardingEmailsService,
  ) {
    const key = process.env.STRIPE_SECRET_KEY;
    this.stripe = key ? new Stripe(key) : null;
    if (!key) this.logger.warn('STRIPE_SECRET_KEY non défini — paiements par carte désactivés');
    else this.logger.log(`Stripe actif en mode ${key.startsWith('sk_live') ? 'PRODUCTION' : 'TEST'}`);
  }

  get stripeEnabled() { return !!this.stripe; }
  get stripeTestMode() { return !!process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.startsWith('sk_live'); }

  private get stripeClient(): StripeClient {
    if (!this.stripe) throw new BadRequestException('Le paiement par carte n\'est pas encore disponible. Utilisez Mobile Money ou contactez-nous.');
    return this.stripe;
  }

  // ── Prix Stripe (créés au besoin) ─────────────────────────────
  private async priceId(plan: PaidPlan): Promise<string> {
    const cached = this.priceCache.get(plan);
    if (cached) return cached;

    // Prix imposé par variable d'environnement : utilisé seulement s'il existe dans le
    // mode de la clé (un prix « live » est introuvable avec une clé de test, et inversement).
    const envId = plan === 'pro' ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_CABINET;
    if (envId) {
      try {
        const p = await this.stripeClient.prices.retrieve(envId);
        if (p.active) { this.priceCache.set(plan, envId); return envId; }
        this.logger.warn(`STRIPE_PRICE_${plan.toUpperCase()} (${envId}) est inactif : prix automatique utilisé`);
      } catch {
        this.logger.warn(`STRIPE_PRICE_${plan.toUpperCase()} (${envId}) introuvable avec cette clé (mode test/réel ?) : prix automatique utilisé`);
      }
    }

    const lookup = STRIPE_LOOKUP_KEYS[plan];
    const found = await this.stripeClient.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
    let id = found.data[0]?.id;
    if (!id) {
      const product = await this.stripeClient.products.create({
        name: `Vision R+ ${planLabel(plan)}`,
        metadata: { plan },
      });
      const price = await this.stripeClient.prices.create({
        product:     product.id,
        currency:    'eur',
        unit_amount: PLAN_PRICES[plan].EUR * 100,
        recurring:   { interval: 'month' },
        lookup_key:  lookup,
        metadata:    { plan },
      });
      id = price.id;
      this.logger.log(`Prix Stripe créé : ${planLabel(plan)} ${PLAN_PRICES[plan].EUR} €/mois (${id})`);
    }
    this.priceCache.set(plan, id);
    return id;
  }

  /** Abonnement Stripe en cours (essai, actif ou impayé) de l'utilisateur. */
  private currentStripeSub(userId: string) {
    return this.prisma.subscription.findFirst({
      where:   { user_id: userId, stripe_sub_id: { not: null }, status: { in: ['essai', 'actif', 'expire'] } },
      orderBy: { created_at: 'desc' },
    });
  }

  // ── Souscrire (Stripe Checkout) ───────────────────────────────
  async createCheckoutSession(userId: string, plan: PaidPlan): Promise<{ url: string }> {
    if (await this.currentStripeSub(userId)) {
      throw new BadRequestException('Vous avez déjà un abonnement par carte : utilisez « Changer de formule » ou « Gérer mon abonnement ».');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const customerId = await this.getOrCreateStripeCustomer(userId, user.email, `${user.first_name} ${user.last_name}`);

    // Essai gratuit : une seule fois par compte (CGV art. 6)
    const hadSubscription = await this.prisma.subscription.count({ where: { user_id: userId } });

    const session = await this.stripeClient.checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: await this.priceId(plan), quantity: 1 }],
      success_url: `${appUrl()}/abonnement?paiement=ok`,
      cancel_url:  `${appUrl()}/abonnement?paiement=annule`,
      locale:      'fr',
      allow_promotion_codes: true,
      metadata:    { userId, plan },
      subscription_data: {
        ...(hadSubscription === 0 ? { trial_period_days: TRIAL_DAYS } : {}),
        metadata: { userId, plan },
      },
    });
    return { url: session.url! };
  }

  // ── Changer de formule (Pro ⇄ Cabinet), au prorata ────────────
  async changePlan(userId: string, plan: PaidPlan) {
    const current = await this.currentStripeSub(userId);
    if (!current?.stripe_sub_id) throw new BadRequestException('Aucun abonnement par carte en cours.');
    if (current.plan === plan) throw new BadRequestException(`Vous êtes déjà sur la formule ${planLabel(plan)}.`);

    if (plan === 'pro') {
      const owned = await this.prisma.company.findMany({ where: { owner_id: userId, is_active: true }, select: { rccm: true } });
      const real = owned.filter((c) => c.rccm !== 'DEMO-VISIONRPLUS').length;
      if (real > 3) {
        throw new BadRequestException(`La formule Pro est limitée à 3 entreprises : vous en avez ${real}. Supprimez-en d'abord ${real - 3}.`);
      }
    }

    const sub = await this.stripeClient.subscriptions.retrieve(current.stripe_sub_id);
    const item = (sub as any).items?.data?.[0];
    if (!item) throw new BadRequestException('Abonnement Stripe invalide.');
    const updated = await this.stripeClient.subscriptions.update(sub.id, {
      items:              [{ id: item.id, price: await this.priceId(plan) }],
      metadata:           { ...(sub.metadata ?? {}), userId, plan },
      proration_behavior: 'create_prorations',
    });
    await this.saveStripeSubscription(userId, plan, updated as any);
    this.logger.log(`Changement de formule : ${userId} → ${plan}`);
    return { plan };
  }

  // ── Portail client Stripe (carte, factures, résiliation) ──────
  async createPortalSession(userId: string): Promise<{ url: string }> {
    const sub = await this.prisma.subscription.findFirst({
      where:   { user_id: userId, stripe_customer_id: { not: null } },
      orderBy: { created_at: 'desc' },
    });
    if (!sub?.stripe_customer_id) throw new BadRequestException('Aucun abonnement par carte trouvé.');

    const configuration = await this.portalConfiguration();
    const session = await this.stripeClient.billingPortal.sessions.create({
      customer:   sub.stripe_customer_id,
      return_url: `${appUrl()}/abonnement`,
      locale:     'fr',
      ...(configuration ? { configuration } : {}),
    });
    return { url: session.url };
  }

  /** Configuration du portail : utilise celle par défaut, sinon en crée une (résiliation en fin de période). */
  private async portalConfiguration(): Promise<string | undefined> {
    const list = await this.stripeClient.billingPortal.configurations.list({ is_default: true, limit: 1 });
    if (list.data.length) return undefined;
    const existing = await this.stripeClient.billingPortal.configurations.list({ active: true, limit: 1 });
    if (existing.data.length) return existing.data[0].id;
    const created = await this.stripeClient.billingPortal.configurations.create({
      business_profile: { headline: 'Vision R+ — gérez votre abonnement' },
      features: {
        invoice_history:       { enabled: true },
        payment_method_update: { enabled: true },
        customer_update:       { enabled: true, allowed_updates: ['email', 'address', 'tax_id'] },
        subscription_cancel:   { enabled: true, mode: 'at_period_end' },
      },
    } as any);
    return created.id;
  }

  // ── Statut affiché sur la page Abonnement ─────────────────────
  async getSubscription(userId: string) {
    const [user, subs] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } }),
      this.prisma.subscription.findMany({ where: { user_id: userId }, orderBy: { created_at: 'desc' }, take: 5 }),
    ]);
    const current = subs.find((s) => ['essai', 'actif', 'expire'].includes(s.status)) ?? subs[0] ?? null;
    let cancelAtPeriodEnd = false;
    if (current?.stripe_sub_id && this.stripe) {
      try {
        const s = await this.stripe.subscriptions.retrieve(current.stripe_sub_id);
        cancelAtPeriodEnd = !!(s as any).cancel_at_period_end || !!(s as any).cancel_at;
      } catch { /* hors ligne : on affiche les données locales */ }
    }
    return {
      currentPlan: user.plan,
      subscription: current && {
        plan:                 current.plan,
        status:               current.status,
        provider:             current.stripe_sub_id ? 'stripe' : 'mobile_money',
        current_period_end:   current.current_period_end,
        trial_ends_at:        current.trial_ends_at,
        cancel_at_period_end: cancelAtPeriodEnd,
      },
      hadSubscription: subs.length > 0,
      prices:          PLAN_PRICES,
      providers: {
        stripe:      this.stripeEnabled,
        stripe_test: this.stripeTestMode,
        mobile_money: !!(process.env.CINETPAY_SITE_ID && process.env.CINETPAY_API_KEY),
      },
    };
  }

  // ── Webhook Stripe ────────────────────────────────────────────
  async handleWebhook(payload: Buffer, signature: string): Promise<void> {
    let event: any;
    try {
      event = this.stripeClient.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET ?? '');
    } catch {
      throw new BadRequestException('Signature webhook invalide');
    }

    switch (event.type) {
      case 'checkout.session.completed':    await this.onCheckoutCompleted(event.data.object); break;
      case 'customer.subscription.updated': await this.onSubscriptionUpdated(event.data.object); break;
      case 'customer.subscription.deleted': await this.onSubscriptionDeleted(event.data.object); break;
      case 'invoice.payment_failed':        await this.onPaymentFailed(event.data.object); break;
    }
  }

  private async onCheckoutCompleted(session: any) {
    const userId = session.metadata?.userId as string | undefined;
    const plan   = session.metadata?.plan   as PaidPlan | undefined;
    if (!userId || !plan || !session.subscription) return;
    const stripeSub = await this.stripeClient.subscriptions.retrieve(session.subscription as string);
    await this.saveStripeSubscription(userId, plan, stripeSub as any);
    this.logger.log(`Abonnement souscrit : ${userId} → ${plan}`);
    this.onboardingEmails.sendSubscribed(userId, plan)
      .catch((e) => this.logger.error(`Email de remerciement : ${e.message}`));
  }

  private async onSubscriptionUpdated(stripeSub: any) {
    const userId = stripeSub.metadata?.userId as string | undefined;
    const plan   = stripeSub.metadata?.plan as PaidPlan | undefined;
    if (!userId || !plan) return;
    await this.saveStripeSubscription(userId, plan, stripeSub);
  }

  private async onSubscriptionDeleted(stripeSub: any) {
    const userId = stripeSub.metadata?.userId as string | undefined;
    await this.prisma.subscription.updateMany({
      where: { stripe_sub_id: stripeSub.id },
      data:  { status: 'annule', cancelled_at: new Date() },
    });
    if (userId) await this.downgradeIfNoActiveSubscription(userId);
  }

  private async onPaymentFailed(invoice: any) {
    // API « dahlia » : invoice.parent.subscription_details.subscription (ancien : invoice.subscription)
    const subId = invoice.parent?.subscription_details?.subscription ?? invoice.subscription;
    if (!subId) return;
    // L'abonnement reste ouvert pendant les relances de Stripe ; l'accès est retiré
    // seulement à la résiliation définitive (customer.subscription.deleted).
    await this.prisma.subscription.updateMany({ where: { stripe_sub_id: subId }, data: { status: 'expire' } });
  }

  // ── Helpers ───────────────────────────────────────────────────
  /** Enregistre (ou met à jour) l'abonnement Stripe et le plan de l'utilisateur. */
  private async saveStripeSubscription(userId: string, plan: PaidPlan, sub: any) {
    const item  = sub.items?.data?.[0];
    const start = item?.current_period_start ?? sub.current_period_start;
    const end   = item?.current_period_end   ?? sub.current_period_end;
    const status = this.mapStripeStatus(sub.status);
    const data = {
      plan:                 plan as any,
      status,
      stripe_customer_id:   typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
      stripe_sub_id:        sub.id,
      current_period_start: start ? new Date(start * 1000) : null,
      current_period_end:   end   ? new Date(end * 1000)   : null,
      trial_ends_at:        sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      ...(status === 'annule' ? { cancelled_at: new Date() } : {}),
    };
    const existing = await this.prisma.subscription.findFirst({ where: { stripe_sub_id: sub.id } });
    if (existing) await this.prisma.subscription.update({ where: { id: existing.id }, data });
    else          await this.prisma.subscription.create({ data: { ...data, user_id: userId } });

    if (status === 'essai' || status === 'actif') {
      await this.prisma.user.update({ where: { id: userId }, data: { plan: plan as any } });
    } else if (status === 'annule') {
      await this.downgradeIfNoActiveSubscription(userId);
    }
  }

  /** Repasse au plan Gratuit sauf si un autre abonnement (ex. Mobile Money) est encore valable. */
  async downgradeIfNoActiveSubscription(userId: string) {
    const stillActive = await this.prisma.subscription.findFirst({
      where: { user_id: userId, status: { in: ['essai', 'actif'] }, OR: [{ current_period_end: null }, { current_period_end: { gt: new Date() } }] },
      orderBy: { current_period_end: 'desc' },
    });
    await this.prisma.user.update({ where: { id: userId }, data: { plan: (stillActive?.plan ?? 'free') as any } });
  }

  private async getOrCreateStripeCustomer(userId: string, email: string, name: string): Promise<string> {
    const existing = await this.prisma.subscription.findFirst({
      where:   { user_id: userId, stripe_customer_id: { not: null } },
      orderBy: { created_at: 'desc' },
    });
    if (existing?.stripe_customer_id) return existing.stripe_customer_id;

    // Évite de créer un client Stripe à chaque tentative de paiement abandonnée
    const found = await this.stripeClient.customers.list({ email, limit: 10 });
    const mine = found.data.find((c: any) => c.metadata?.userId === userId);
    if (mine) return mine.id;

    const customer = await this.stripeClient.customers.create({ email, name, metadata: { userId } });
    return customer.id;
  }

  private mapStripeStatus(status: string): 'actif' | 'annule' | 'expire' | 'essai' {
    switch (status) {
      case 'active':   return 'actif';
      case 'trialing': return 'essai';
      case 'canceled': return 'annule';
      default:         return 'expire';   // past_due, unpaid, incomplete…
    }
  }
}
