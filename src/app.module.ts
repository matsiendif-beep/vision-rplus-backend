import { Module }       from '@nestjs/common';
import { ConfigModule }  from '@nestjs/config';
import { PrismaModule }  from './prisma/prisma.module';
import { AuthModule }    from './auth/auth.module';
import { CompaniesModule }   from './companies/companies.module';
import { AccountsModule }    from './accounts/accounts.module';
import { JournalModule }     from './journal/journal.module';
import { FixedAssetsModule } from './fixed-assets/fixed-assets.module';
import { DocumentsModule }   from './documents/documents.module';
import { TaxModule }         from './tax/tax.module';
import { AnalyticsModule }   from './analytics/analytics.module';
import { BankModule }        from './bank/bank.module';
import { SyncModule }        from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,

    // ── Modules existants ────────────────────────────────
    AuthModule,
    CompaniesModule,
    AccountsModule,
    JournalModule,

    // ── Nouveaux modules v2 ──────────────────────────────
    FixedAssetsModule,   // Immobilisations & amortissements
    DocumentsModule,     // Pièces justificatives & OCR
    TaxModule,           // Déclarations fiscales & DSF
    AnalyticsModule,     // KPIs, balance, grand livre
    BankModule,          // Comptes bancaires & rapprochement
    SyncModule,          // Synchronisation offline mobile
  ],
})
export class AppModule {}
