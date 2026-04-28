import { NestFactory } from '@nestjs/core';
import { ValidationPipe }   from '@nestjs/common';
import { ConfigService }     from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule }         from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });

  const config = app.get(ConfigService);
  const port   = config.get<number>('PORT', 3000);

  // ── Prefix global ──────────────────────────────────────────
  app.setGlobalPrefix(config.get('API_PREFIX', 'api/v1'));

  // ── CORS ──────────────────────────────────────────────────
  // FRONTEND_URL accepte plusieurs origines séparées par une virgule
  // Ex: "https://vision-rplus.vercel.app,http://localhost:3001"
  const frontendUrl = config.get<string>('FRONTEND_URL', 'http://localhost:3001');
  const allowedOrigins = frontendUrl.includes(',')
    ? frontendUrl.split(',').map((u) => u.trim())
    : frontendUrl;

  app.enableCors({
    origin:      allowedOrigins,
    credentials: true,
  });

  // ── Validation globale ────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:        true,   // Retire les propriétés inconnues
      forbidNonWhitelisted: true,
      transform:        true,   // Auto-cast des types
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Filtre d'erreurs global ───────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── Swagger (documentation API) ──────────────────────────
  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Vision R+ API')
      .setDescription('API comptable SaaS — OHADA & PCG France')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
    console.log(`📚 Swagger disponible : http://localhost:${port}/docs`);
  }

  await app.listen(port);
  console.log(`🚀 Vision R+ API démarrée sur le port ${port}`);
}

bootstrap();
