import {
  Injectable, ConflictException,
  UnauthorizedException, Logger,
} from '@nestjs/common';
import { JwtService }    from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2       from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';

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
