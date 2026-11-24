// ── email/email.controller.ts ────────────────────────────────
//  Lien de désinscription des emails de conseils (public).
// ─────────────────────────────────────────────────────────────
import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiExcludeController }        from '@nestjs/swagger';
import { Response }                    from 'express';
import { OnboardingEmailsService }     from './onboarding-emails.service';

@ApiExcludeController()
@Controller('email')
export class EmailController {
  constructor(private readonly onboarding: OnboardingEmailsService) {}

  // GET /email/unsubscribe?u=<userId>&t=<token>
  @Get('unsubscribe')
  async unsubscribe(@Query('u') userId: string, @Query('t') token: string, @Res() res: Response) {
    const ok = userId && token ? await this.onboarding.unsubscribe(userId, token) : false;
    const msg = ok
      ? 'C\'est noté : vous ne recevrez plus nos emails de conseils. Les emails liés à votre compte (facturation, sécurité) restent actifs.'
      : 'Lien invalide ou expiré. Répondez simplement à l\'un de nos emails pour vous désinscrire.';
    res.status(ok ? 200 : 400).type('html').send(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vision R+</title></head><body style="font-family:Segoe UI,Arial,sans-serif;background:#f5f6fa;color:#1a2744;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px">
<div style="background:#fff;border-radius:16px;padding:32px;max-width:440px;text-align:center"><h1 style="font-size:20px">Vision R<span style="color:#e07b2a">+</span></h1><p>${msg}</p>
<p><a href="https://www.visionrplus.com" style="color:#e07b2a">Retour au site</a></p></div></body></html>`,
    );
  }
}
