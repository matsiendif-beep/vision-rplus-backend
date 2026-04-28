import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService }   from '@nestjs/config';
import { PrismaService }   from '../prisma/prisma.service';

export interface JwtPayload {
  sub:   string;   // user id
  email: string;
  plan:  string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where:  { id: payload.sub },
      select: {
        id:         true,
        email:      true,
        first_name: true,
        last_name:  true,
        plan:       true,
        is_active:  true,
      },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException('Compte introuvable ou désactivé');
    }

    return user; // Injecté dans req.user
  }
}
