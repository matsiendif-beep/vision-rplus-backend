import {
  Controller, Post, Get, Body, Headers,
  RawBodyRequest, Req, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Request }         from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BillingService }  from './billing.service';
import { CinetPayService } from './cinetpay.service';
import { JwtAuthGuard }    from '../common/guards/jwt-auth.guard';
import { GetUser }         from '../common/decorators';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(
    private billing:   BillingService,
    private cinetpay:  CinetPayService,
  ) {}

  // ── Initier un abonnement ─────────────────────────────────────
  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Créer une session Stripe Checkout' })
  checkout(
    @GetUser('id') userId: string,
    @Body('plan') plan: 'pro' | 'cabinet',
  ) {
    return this.billing.createCheckoutSession(userId, plan);
  }

  // ── Portail client (modifier / annuler) ───────────────────────
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Paiement Mobile Money via CinetPay (Afrique)' })
  cinetpayCheckout(
    @GetUser('id') userId: string,
    @Body() body: {
      plan:        'pro' | 'cabinet';
      currency:    'XAF' | 'XOF' | 'EUR';
      phone:       string;
      countryCode: string;
    },
  ) {
    return this.cinetpay.initiatePayment({ userId, ...body });
  }

  @Post('cinetpay/notify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook CinetPay (usage interne)' })
  cinetpayNotify(@Body() body: any) {
    return this.cinetpay.handleNotification(body);
  }
}
