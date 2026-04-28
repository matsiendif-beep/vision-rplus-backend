// ── prisma/prisma.service.ts ──────────────────────────────────
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('✅ Connexion PostgreSQL établie');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('🔌 Connexion PostgreSQL fermée');
  }

  /**
   * Nettoie la base de données (tests uniquement).
   * Ne jamais appeler en production.
   */
  async cleanDatabase() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('cleanDatabase interdit en production');
    }
    const models = Reflect.ownKeys(this).filter(
      (key) => typeof key === 'string' && !key.startsWith('_') && !key.startsWith('$'),
    );
    await Promise.all(models.map((model) => (this as any)[model].deleteMany()));
  }
}
