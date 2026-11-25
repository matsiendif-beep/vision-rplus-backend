import {
  Injectable, ConflictException,
  UnauthorizedException, BadRequestException, Logger,
  HttpException, HttpStatus,
} from '@nestjs/common';

// Blocage temporaire d'un compte après trop d'échecs de connexion
// (protège contre la recherche de mot de passe, même si l'attaquant change d'IP).
import { LEGAL_VERSION, LEGAL_ACCEPTED_ACTION } from '../legal/legal-version';

export interface RequestContext { ip?: string; userAgent?: string }

const MAX_FAILED_LOGINS = 5;
const FAILED_WINDOW_MS  = 15 * 60_000;
const LOCK_DURATION_MS  = 15 * 60_000;
import { JwtService }    from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2       from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { OnboardingEmailsService } from '../email/onboarding-emails.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Échecs de connexion par email (en mémoire : remis à zéro à chaque redémarrage). */
  private readonly failedLogins = new Map<string, { count: number; first: number; lockedUntil?: number }>();

  constructor(
    private prisma:  PrismaService,
    private jwt:     JwtService,
    private config:  ConfigService,
    private onboardingEmails: OnboardingEmailsService,
  ) {}

  // ── Inscription ────────────────────────────────────────────
  async register(dto: RegisterDto, ctx: RequestContext = {}) {
    // Vérifier si l'email est déjà utilisé
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    if (exists) {
      throw new ConflictException('Un compte existe déjà avec cet email');
    }

    // Hacher le mot de passe (argon2 > bcrypt)
    const hash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email:         dto.email.trim().toLowerCase(),
        password_hash: hash,
        // Les claviers mobiles ajoutent souvent un espace final
        first_name:    dto.first_name.trim(),
        last_name:     dto.last_name.trim(),
        phone:         dto.phone?.trim(),
      },
      select: {
        id:         true,
        email:      true,
        first_name: true,
        last_name:  true,
        plan:       true,
        created_at: true,
      },
    });

    this.logger.log(`Nouvel utilisateur inscrit : ${user.email}`);
    // Preuve de l'acceptation des CGU/CGV (case cochée à l'inscription)
    await this.recordTermsAcceptance(user.id, LEGAL_VERSION, ctx);
    this.onboardingEmails.sendWelcome(user);   // asynchrone, ne bloque pas

    const tokens = await this.generateTokens(user.id, user.email, user.plan);
    return { user, ...tokens };
  }

  // ── Connexion ──────────────────────────────────────────────
  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    this.assertNotLocked(email);

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.is_active) {
      this.recordFailedLogin(email);
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    const passwordValid = await argon2.verify(user.password_hash, dto.password);
    if (!passwordValid) {
      this.recordFailedLogin(email);
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }
    this.failedLogins.delete(email);

    // Mettre à jour la date de dernière connexion
    await this.prisma.user.update({
      where: { id: user.id },
      data:  { last_login_at: new Date() },
    });

    const tokens = await this.generateTokens(user.id, user.email, user.plan);

    return {
      user: {
        id:         user.id,
        email:      user.email,
        first_name: user.first_name,
        last_name:  user.last_name,
        plan:       user.plan,
      },
      ...tokens,
    };
  }

  // ── Conditions générales ───────────────────────────────────
  /** Dernière version acceptée par l'utilisateur (null s'il n'a jamais accepté). */
  async acceptedTermsVersion(userId: string): Promise<string | null> {
    const last = await this.prisma.auditLog.findFirst({
      where:   { user_id: userId, action: LEGAL_ACCEPTED_ACTION },
      orderBy: { created_at: 'desc' },
      select:  { record_id: true },
    });
    return last?.record_id ?? null;
  }

  async acceptTerms(userId: string, version: string, ctx: RequestContext = {}) {
    if (version !== LEGAL_VERSION) {
      throw new BadRequestException('Cette version des conditions n\'est plus en vigueur. Rechargez la page.');
    }
    if ((await this.acceptedTermsVersion(userId)) !== LEGAL_VERSION) {
      await this.recordTermsAcceptance(userId, LEGAL_VERSION, ctx);
    }
    return { accepted_version: LEGAL_VERSION };
  }

  private recordTermsAcceptance(userId: string, version: string, ctx: RequestContext) {
    return this.prisma.auditLog.create({
      data: {
        user_id:    userId,
        action:     LEGAL_ACCEPTED_ACTION,
        table_name: 'legal',
        record_id:  version,
        new_values: { version, documents: ['cgu-cgv', 'confidentialite'] },
        ip_address: ctx.ip?.slice(0, 64),
        user_agent: ctx.userAgent?.slice(0, 500),
      },
    });
  }

  // ── Protection contre les essais de mots de passe ──────────
  private assertNotLocked(email: string) {
    const entry = this.failedLogins.get(email);
    if (!entry?.lockedUntil) return;
    const remaining = entry.lockedUntil - Date.now();
    if (remaining <= 0) { this.failedLogins.delete(email); return; }
    const minutes = Math.ceil(remaining / 60_000);
    throw new HttpException(
      `Trop de tentatives de connexion pour ce compte. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private recordFailedLogin(email: string) {
    const now = Date.now();
    // Nettoyage pour que la table ne grossisse pas indéfiniment
    if (this.failedLogins.size > 10_000) {
      for (const [k, v] of this.failedLogins) {
        if ((v.lockedUntil ?? v.first + FAILED_WINDOW_MS) < now) this.failedLogins.delete(k);
      }
    }
    const entry = this.failedLogins.get(email);
    if (!entry || now - entry.first > FAILED_WINDOW_MS) {
      this.failedLogins.set(email, { count: 1, first: now });
      return;
    }
    entry.count += 1;
    if (entry.count >= MAX_FAILED_LOGINS) {
      entry.lockedUntil = now + LOCK_DURATION_MS;
      this.logger.warn(`Compte ${email} bloqué 15 min après ${entry.count} échecs de connexion`);
    }
  }

  // ── Profil utilisateur connecté ────────────────────────────
  async getMe(userId: string) {
    const [user, accepted] = await Promise.all([this.findMe(userId), this.acceptedTermsVersion(userId)]);
    if (!user) return user;
    return { ...user, legal: { current_version: LEGAL_VERSION, accepted_version: accepted } };
  }

  private findMe(userId: string) {
    return this.prisma.user.findUnique({
      where:  { id: userId },
      select: {
        id:           true,
        email:        true,
        first_name:   true,
        last_name:    true,
        phone:        true,
        avatar_url:   true,
        plan:         true,
        is_verified:  true,
        created_at:   true,
        _count: {
          select: { owned_companies: true },
        },
      },
    });
  }

  // ── Changer le mot de passe ────────────────────────────────
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const valid = await argon2.verify(user.password_hash, currentPassword);
    if (!valid) throw new BadRequestException('Mot de passe actuel incorrect');

    if (newPassword.length < 8) {
      throw new BadRequestException('Le nouveau mot de passe doit comporter au moins 8 caractères');
    }

    const newHash = await argon2.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data:  { password_hash: newHash },
    });

    this.logger.log(`Mot de passe changé pour l'utilisateur ${userId}`);
    return { message: 'Mot de passe mis à jour avec succès' };
  }

  // ── Génération des tokens JWT ──────────────────────────────
  private async generateTokens(userId: string, email: string, plan: string) {
    const payload = { sub: userId, email, plan };

    const [access_token, refresh_token] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret:    this.config.get('JWT_SECRET'),
        expiresIn: this.config.get('JWT_EXPIRES_IN', '7d'),
      }),
      this.jwt.signAsync(payload, {
        secret:    this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'),
      }),
    ]);

    return { access_token, refresh_token };
  }
}
