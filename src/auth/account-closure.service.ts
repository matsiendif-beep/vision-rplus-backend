// ════════════════════════════════════════════════════════════
//  Fermeture et suppression de compte (droit à l'effacement)
//
//  Conforme aux CGU art. 8 et à la politique de confidentialité :
//   1. Fermeture (immédiate, à la demande de l'utilisateur) :
//      accès bloqué, abonnements arrêtés, email de confirmation,
//      données conservées 90 jours (réactivation ou export sur demande).
//   2. Suppression (automatique, 90 jours après) :
//      entreprises dont il est propriétaire supprimées avec leurs
//      données ; compte anonymisé (nom, email, téléphone effacés).
//      Les écritures qu'il a saisies chez d'AUTRES entreprises restent,
//      rattachées à « Compte supprimé », pour ne pas fausser leur
//      comptabilité.
// ════════════════════════════════════════════════════════════
import {
  Injectable, Logger, BadRequestException, UnauthorizedException,
  OnModuleInit, OnModuleDestroy,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { OnboardingEmailsService } from '../email/onboarding-emails.service';

export const CLOSED_ACTION = 'account.closed';
const PURGED_ACTION = 'account.purged';
export const RETENTION_DAYS = 90;
const DAY = 864e5;
const ANON_DOMAIN = '@supprime.visionrplus.invalid';

@Injectable()
export class AccountClosureService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('FermetureCompte');
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private emails: OnboardingEmailsService,
  ) {}

  onModuleInit() {
    setTimeout(() => this.purgeExpired().catch(() => undefined), 5 * 60_000).unref();
    this.timer = setInterval(() => this.purgeExpired().catch(() => undefined), 6 * 3_600_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ── 1. Fermeture ───────────────────────────────────────────
  async close(userId: string, password: string, confirmation: string, ctx: { ip?: string } = {}) {
    if ((confirmation ?? '').trim().toUpperCase() !== 'SUPPRIMER') {
      throw new BadRequestException('Tapez SUPPRIMER pour confirmer la fermeture du compte.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.is_active) throw new UnauthorizedException('Compte introuvable ou déjà fermé');
    // 400 et non 401 : un 401 déconnecterait l'utilisateur côté site
    if (!(await argon2.verify(user.password_hash, password ?? ''))) {
      throw new BadRequestException('Mot de passe incorrect');
    }

    const cancelled = await this.billing.cancelAllForUser(userId);
    const closedAt = new Date();
    const deletionOn = new Date(closedAt.getTime() + RETENTION_DAYS * DAY);

    await this.prisma.user.update({ where: { id: userId }, data: { is_active: false } });
    const log = await this.prisma.auditLog.create({
      data: {
        user_id: userId, action: CLOSED_ACTION, table_name: 'users', record_id: userId,
        new_values: { deletion_on: deletionOn.toISOString(), subscriptions_cancelled: cancelled },
        ip_address: ctx.ip?.slice(0, 64),
      },
    });
    this.emails.sendAccountClosed({ id: user.id, email: user.email, first_name: user.first_name }, deletionOn, log.id)
      .catch((e) => this.logger.error(`Email de fermeture : ${e.message}`));
    this.logger.log(`Compte fermé : ${user.email} (suppression le ${deletionOn.toISOString().slice(0, 10)})`);
    return { closed_at: closedAt, deletion_on: deletionOn };
  }

  /** Date de fermeture d'un compte inactif (null s'il n'a pas été fermé par l'utilisateur). */
  async closedAt(userId: string): Promise<Date | null> {
    const log = await this.prisma.auditLog.findFirst({
      where: { user_id: userId, action: CLOSED_ACTION }, orderBy: { created_at: 'desc' }, select: { created_at: true },
    });
    return log?.created_at ?? null;
  }

  // ── 2. Suppression après 90 jours ──────────────────────────
  async purgeExpired() {
    const limit = new Date(Date.now() - RETENTION_DAYS * DAY);
    const closures = await this.prisma.auditLog.findMany({
      where: { action: CLOSED_ACTION, created_at: { lte: limit } },
      select: { user_id: true },
    });
    for (const { user_id } of closures) {
      if (!user_id) continue;
      const user = await this.prisma.user.findUnique({ where: { id: user_id } });
      // Ignorés : comptes réactivés entre-temps ou déjà anonymisés
      if (!user || user.is_active || user.email.endsWith(ANON_DOMAIN)) continue;
      await this.purge(user_id);
    }
  }

  async purge(userId: string) {
    const owned = await this.prisma.company.findMany({ where: { owner_id: userId }, select: { id: true, name: true } });
    let deleted = 0;
    for (const c of owned) {
      try {
        await this.prisma.company.delete({ where: { id: c.id } });   // supprime ses écritures, comptes, documents… (cascade)
        deleted++;
      } catch (e: any) {
        this.logger.error(`Suppression de l'entreprise ${c.id} impossible : ${e.message}`);
      }
    }
    // WhatsApp : séparé, car ces tables peuvent être absentes de certaines bases
    try {
      await this.prisma.whatsAppSession.deleteMany({ where: { user_id: userId } });
    } catch (e: any) {
      this.logger.warn(`Session WhatsApp non supprimée (${e.code ?? e.message})`);
    }
    await this.prisma.$transaction([
      this.prisma.companyMember.deleteMany({ where: { user_id: userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: `${userId}${ANON_DOMAIN}`, first_name: 'Compte', last_name: 'supprimé',
          phone: null, avatar_url: null, is_active: false,
          password_hash: await argon2.hash(randomBytes(32).toString('hex')),
        },
      }),
      this.prisma.auditLog.create({
        data: { user_id: userId, action: PURGED_ACTION, table_name: 'users', record_id: userId,
                new_values: { companies_deleted: deleted, companies_total: owned.length } },
      }),
    ]);
    this.logger.log(`Compte ${userId} anonymisé, ${deleted}/${owned.length} entreprise(s) supprimée(s)`);
    return { companies_deleted: deleted, companies_total: owned.length };
  }
}
