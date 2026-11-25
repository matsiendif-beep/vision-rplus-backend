// ── auth/auth.controller.ts ───────────────────────────────────
import {
  Controller, Post, Get, Patch, Body, Req,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsString, MinLength } from 'class-validator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle }      from '@nestjs/throttler';
import { AuthService }   from './auth.service';
import { RegisterDto, LoginDto, AcceptTermsDto } from './dto/auth.dto';
import { JwtAuthGuard }  from '../common/guards/jwt-auth.guard';
import { GetUser }       from '../common/decorators';

class ChangePasswordDto {
  @IsString() current_password: string;
  @IsString() @MinLength(8) new_password: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })   // 10 inscriptions / min / IP
  @ApiOperation({ summary: 'Créer un compte Vision R+' })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  // Acceptation d'une nouvelle version des CGU/CGV par un utilisateur existant
  @Post('accept-terms')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accepter la version en vigueur des conditions générales' })
  acceptTerms(@GetUser('id') userId: string, @Body() dto: AcceptTermsDto, @Req() req: Request) {
    return this.authService.acceptTerms(userId, dto.version, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('login')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })   // 20 essais / min / IP (+ blocage par compte)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion et récupération des tokens JWT' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Profil de l\'utilisateur connecté' })
  getMe(@GetUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @Patch('change-password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Changer le mot de passe' })
  changePassword(
    @GetUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto.current_password, dto.new_password);
  }
}
