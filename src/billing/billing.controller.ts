import {
  Controller, Post, Get, Body, Headers,
  RawBodyRequest, Req, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Request }         from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsIn, IsString, Matches, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { BillingService }  from './billing.service';
import { CinetPayService } from './cinetpay.service';
import { JwtAuthGuard }    from '../common/guards/jwt-auth.guard';
import { GetUser }         from '../common/decorators';
import { PaidPlan, BillingCurrency } from './billing-plans';

class PlanDto {
  @IsIn(['pro', 'cabinet'], { message: 'Formule invalide (pro ou cabinet)' })
  plan: PaidPlan;
}

class MobileMoneyDto extends PlanDto {
  @IsIn(['XAF', 'XOF', 'EUR'], { message: 'Devise invalide' })
  currency: BillingCurrency;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s.-]/g, '') : value))
  @Matches(/^\+?\d{8,15}$/, { message: 'Numéro de téléphone invalide' })
  phone: string;

  @IsString()
  @Length(2, 2, { message: 'Code pays invalide (ex. GA, CM, CI)' })
  countryCode: string;
}

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(
    private billing:   BillingService,
    private cinetpay:  CinetPayService,
  ) {}

  // ── Souscrire par carte (Stripe Checkout) ─────────────────────
  @Post('checkout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Créer une session Stripe Checkout' })
  checkout(@GetUser('id') userId: string, @Body() dto: PlanDto) {
    return this.billing.createCheckoutSession(userId, dto.plan);
  }

  // ── Changer de formule (abonnement par carte) ─────────────────
  @Post('change-plan')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Passer de Pro à Cabinet (ou l\'inverse), au prorata' })
  changePlan(@GetUser('id') userId: string, @Body() dto: PlanDto) {
    return this.billing.changePlan(userId, dto.plan);
  }

  // ── Portail client (carte, factures, résiliation) ─────────────
  @Post('portal')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accéder au portail de facturation Stripe' })
  portal(@GetUser('id') userId: string) {
    return this.billing.createPortalSession(userId);
  }

  // ── Statut abonnement actuel ──────────────────────────────────
  @Get('subscription')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Statut de l\'abonnement de l\'utilisateur' })
  subscription(@GetUser('id') userId: string) {
    return this.billing.getSubscription(userId);
  }

  // ── Webhook Stripe (pas de JWT ici — Stripe signe sa requête) ─
  @Post('webhook')
  @SkipThrottle()   // signé par Stripe (constructEvent) — ne jamais bloquer
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook Stripe (usage interne)' })
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    return this.billing.handleWebhook(req.rawBody!, sig);
  }

  // ══════════════════════════════════════════════════════════════
  //  CINETPAY — Mobile Money Afrique
  // ══════════════════════════════════════════════════════════════

  @Post('cinetpay/checkout')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Paiement Mobile Money via CinetPay (Afrique)' })
  cinetpayCheckout(@GetUser('id') userId: string, @Body() dto: MobileMoneyDto) {
    return this.cinetpay.initiatePayment({ userId, ...dto, countryCode: dto.countryCode.toUpperCase() });
  }

  @Post('cinetpay/notify')
  @SkipThrottle()   // vérifié en interrogeant l'API CinetPay (statut, montant, formule)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook CinetPay (usage interne)' })
  cinetpayNotify(@Body() body: any) {
    return this.cinetpay.handleNotification(body);
  }
}
