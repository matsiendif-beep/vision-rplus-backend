import { NestFactory }    from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet              from 'helmet';
import { AppModule }       from './app.module';

// Origines web autorisées à appeler l'API depuis un navigateur.
// FRONTEND_URL (séparées par des virgules) s'ajoute à cette liste.
const DEFAULT_ORIGINS = [
  'https://www.visionrplus.com',
  'https://visionrplus.com',
  'http://localhost:3000',
  'http://localhost:3001',
];
// Déploiements de prévisualisation Vercel des projets Vision R+
const VERCEL_PREVIEW = /^https:\/\/vision-rplus-frontend[a-z0-9-]*\.vercel\.app$/;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const logger = new Logger('Bootstrap');

  // Railway place un proxy devant l'appli : on lui fait confiance pour 1 saut,
  // afin que req.ip soit l'IP réelle du client (limite de tentatives) sans
  // pouvoir être falsifiée par un en-tête X-Forwarded-For forgé.
  app.set('trust proxy', 1);

  // En-têtes de sécurité HTTP (masque aussi « X-Powered-By: Express »)
  app.use(helmet({
    // Les fichiers servis par l'API (documents) sont affichés par visionrplus.com
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  const allowed = new Set([
    ...DEFAULT_ORIGINS,
    ...(process.env.FRONTEND_URL ?? '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),
  ]);
  app.enableCors({
    origin: (origin, cb) => {
      // Pas d'origine = application mobile, serveur, webhook, curl : autorisé
      // (le CORS ne concerne que les navigateurs ; l'API reste protégée par le JWT).
      if (!origin || allowed.has(origin) || VERCEL_PREVIEW.test(origin)) return cb(null, true);
      logger.warn(`CORS refusé pour l'origine ${origin}`);
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({
    transform:        true,   // runs @Transform decorators (parseInt on page/limit)
    whitelist:        true,   // strips unknown properties
    forbidNonWhitelisted: false,
  }));

  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
