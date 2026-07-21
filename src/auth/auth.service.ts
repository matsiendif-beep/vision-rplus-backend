import {
  Injectable, ConflictException,
  UnauthorizedException, BadRequestException, Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService }    from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2       from 'argon2';
import * as QRCode       from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto, InviteClientDto, AcceptInviteDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma:  PrismaService,
    private jwt:     JwtService,
    private config:  ConfigService,
  ) {}

  // ── Inscription ────────────────────────────────────────────
  async register(dto: RegisterDto) {
    // Vérifier si l'email est déjà utilisé
    const exists = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (exists) {
      throw new ConflictException('Un compte existe déjà avec cet email');
    }

    // Hacher le mot de passe (argon2 > bcrypt)
    const hash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email:         dto.email.toLowerCase(),
        password_hash: hash,
        first_name:    dto.first_name,
        last_name:     dto.last_name,
        phone:         dto.phone,
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

    const tokens = await this.generateTokens(user.id, user.email, user.plan);
    return { user, ...tokens };
  }

  // ── Connexion ──────────────────────────────────────────────
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    const passwordValid = await argon2.verify(user.password_hash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

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

  // ── Profil utilisateur connecté ────────────────────────────
  async getMe(userId: string) {
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

  // ── Générer un QR code d'invitation client ─────────────────
  async generateClientInvite(userId: string, dto: InviteClientDto) {
    const company = await this.prisma.company.findFirst({
      where: { id: dto.company_id, owner_id: userId },
      select: { id: true, name: true },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable ou accès refusé');

    const role = dto.role ?? 'lecture';
    const payload = { type: 'client_invite', company_id: company.id, role, invited_by: userId };
    const token = await this.jwt.signAsync(payload, {
      secret:    this.config.get('JWT_SECRET'),
      expiresIn: '7d',
    });

    const frontendUrl = this.config.get('FRONTEND_URL', 'https://app.visionrplus.com');
    const inviteUrl   = `${frontendUrl}/join?token=${token}`;
    const qrCodeBase64 = await QRCode.toDataURL(inviteUrl, { width: 300, margin: 2 });

    this.logger.log(`Invitation générée pour l'entreprise ${company.name} par l'utilisateur ${userId}`);

    return {
      invite_url:      inviteUrl,
      qr_code_base64:  qrCodeBase64,
      company_name:    company.name,
      role,
      expires_in:      '7 jours',
    };
  }

  // ── Valider un token d'invitation ──────────────────────────
  async validateInviteToken(token: string) {
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get('JWT_SECRET'),
      });
      if (payload.type !== 'client_invite') throw new Error();

      const company = await this.prisma.company.findUnique({
        where:  { id: payload.company_id },
        select: { id: true, name: true, country: true, accounting_system: true },
      });
      if (!company) throw new NotFoundException('Entreprise introuvable');

      return { valid: true, company, role: payload.role };
    } catch {
      throw new BadRequestException('Lien d\'invitation invalide ou expiré');
    }
  }

  // ── Accepter une invitation et créer le compte ─────────────
  async acceptInvite(dto: AcceptInviteDto) {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(dto.token, { secret: this.config.get('JWT_SECRET') });
      if (payload.type !== 'client_invite') throw new Error();
    } catch {
      throw new BadRequestException('Lien d\'invitation invalide ou expiré');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException('Un compte existe déjà avec cet email');

    const hash = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: {
        email:         dto.email.toLowerCase(),
        password_hash: hash,
        first_name:    dto.first_name,
        last_name:     dto.last_name,
      },
      select: { id: true, email: true, first_name: true, last_name: true, plan: true },
    });

    await this.prisma.companyMember.create({
      data: {
        company_id:  payload.company_id,
        user_id:     user.id,
        role:        payload.role,
        invited_by:  payload.invited_by,
        accepted_at: new Date(),
      },
    });

    const tokens = await this.generateTokens(user.id, user.email, user.plan);
    this.logger.log(`Invitation acceptée : ${user.email} → entreprise ${payload.company_id}`);
    return { user, ...tokens };
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
