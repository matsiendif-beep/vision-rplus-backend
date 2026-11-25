import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { LEGAL_VERSION } from './legal-version';

const SITE = 'https://www.visionrplus.com';

// Les textes juridiques font foi sur le site (vision-rplus-frontend/src/app/legal).
// Cette page reste en place car son adresse a pu être déclarée ailleurs
// (application Meta, stores mobiles) : elle renvoie vers la version officielle.
@Controller('legal')
export class LegalController {
  constructor(private prisma: PrismaService) {}

  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  privacyPolicy(): string {
    const url = `${SITE}/legal/confidentialite`;
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="0; url=${url}">
  <link rel="canonical" href="${url}">
  <title>Politique de confidentialité — Vision R+</title>
</head>
<body style="font-family:Arial,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1a2744">
  <h1>Politique de confidentialité — Vision R+</h1>
  <p>La politique de confidentialité en vigueur (version du ${LEGAL_VERSION}) est publiée sur notre site :</p>
  <p><a href="${url}">${url}</a></p>
  <p>Contact : <a href="mailto:contact@visionrplus.com">contact@visionrplus.com</a></p>
</body>
</html>`;
  }

  // Liste des documents juridiques (utile pour l'application mobile)
  @Get('documents')
  documents() {
    return {
      version: LEGAL_VERSION,
      cgu_cgv:          `${SITE}/legal/cgu`,
      confidentialite:  `${SITE}/legal/confidentialite`,
      mentions_legales: `${SITE}/legal/mentions-legales`,
    };
  }
}

// ── Santé du service (surveillance UptimeRobot) ───────────────
//  GET /api/v1/health → 200 si l'API ET la base de données répondent,
//  503 sinon. À surveiller : c'est ce qui aurait signalé la panne
//  de la base de données d'août 2026.
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @SkipThrottle()
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok', time: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable' });
    }
  }
}
