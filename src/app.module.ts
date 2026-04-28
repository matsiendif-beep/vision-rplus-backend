import { Module }       from '@nestjs/common';
import { ConfigModule }  from '@nestjs/config';
import { PrismaModule }  from './prisma/prisma.module';
import { AuthModule }    from './auth/auth.module';
import { CompaniesModule } from './companies/companies.module';
import { AccountsModule }  from './accounts/accounts.module';
import { JournalModule }   from './journal/journal.module';

@Module({
  imports: [
    // ── Config (variables d'environnement) ───────────────
    ConfigModule.forRoot({ isGlobal: true }),

    // ── Base de données ──────────────────────────────────
    PrismaModule,

    // ── Modules métier ───────────────────────────────────
    AuthModule,
    CompaniesModule,
    AccountsModule,
    JournalModule,
  ],
})
export class AppModule {}
