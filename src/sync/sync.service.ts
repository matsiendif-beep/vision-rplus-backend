import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface SyncPushDto {
  device_id: string;
  operations: Array<{
    operation:      'create' | 'update' | 'delete';
    table_name:     string;
    record_id:      string;
    payload:        Record<string, any>;
    client_version: number;
  }>;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private prisma: PrismaService) {}

  // ── Push depuis mobile ────────────────────────────────────
  async push(companyId: string, userId: string, dto: SyncPushDto) {
    const results: Array<{ record_id: string; status: string; error?: string }> = [];

    for (const op of dto.operations) {
      try {
        await this.prisma.syncQueue.create({
          data: {
            device_id:      dto.device_id,
            user_id:        userId,
            company_id:     companyId,
            operation:      op.operation,
            table_name:     op.table_name,
            record_id:      op.record_id,
            payload:        op.payload,
            client_version: op.client_version,
            status:         'pending',
          },
        });
        // Traiter immédiatement l'opération
        await this.applyOperation(companyId, userId, op);
        await this.prisma.syncQueue.updateMany({
          where: { device_id: dto.device_id, record_id: op.record_id, table_name: op.table_name },
          data:  { status: 'synced', synced_at: new Date() },
        });
        results.push({ record_id: op.record_id, status: 'synced' });
      } catch (err: any) {
        this.logger.error(`Sync error for ${op.table_name}/${op.record_id}: ${err.message}`);
        await this.prisma.syncQueue.updateMany({
          where: { device_id: dto.device_id, record_id: op.record_id },
          data:  { status: 'error', error_message: err.message },
        });
        results.push({ record_id: op.record_id, status: 'error', error: err.message });
      }
    }

    return { device_id: dto.device_id, synced: results.filter(r => r.status === 'synced').length, results };
  }

  // ── Pull vers mobile ──────────────────────────────────────
  // Retourne les données modifiées depuis lastSyncAt
  async pull(companyId: string, lastSyncAt?: string) {
    const since = lastSyncAt ? new Date(lastSyncAt) : new Date(0);

    const [entries, accounts, fiscalYears, fixedAssets] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: { company_id: companyId, updated_at: { gt: since } },
        include: { lines: true },
        take: 500,
      }),
      this.prisma.account.findMany({
        where: { OR: [{ company_id: companyId }, { company_id: null }], created_at: { gt: since } },
        take: 200,
      }),
      this.prisma.fiscalYear.findMany({
        where: { company_id: companyId },
      }),
      this.prisma.fixedAsset.findMany({
        where: { company_id: companyId, updated_at: { gt: since } },
        take: 100,
      }),
    ]);

    return {
      sync_at: new Date().toISOString(),
      data: {
        journal_entries: entries,
        accounts,
        fiscal_years:    fiscalYears,
        fixed_assets:    fixedAssets,
      },
    };
  }

  // ── Appliquer une opération ───────────────────────────────
  private async applyOperation(
    companyId: string,
    userId: string,
    op: SyncPushDto['operations'][0],
  ) {
    switch (op.table_name) {
      case 'journal_entries':
        return this.applyJournalEntry(companyId, userId, op);
      case 'documents':
        return this.applyDocument(companyId, userId, op);
      default:
        this.logger.warn(`Table non gérée en sync: ${op.table_name}`);
    }
  }

  private async applyJournalEntry(
    companyId: string,
    userId: string,
    op: SyncPushDto['operations'][0],
  ) {
    const p = op.payload;
    if (op.operation === 'create') {
      // Vérifier si l'entrée existe déjà (idempotence)
      const exists = await this.prisma.journalEntry.findFirst({
        where: { id: op.record_id },
      });
      if (exists) return;

      await this.prisma.journalEntry.create({
        data: {
          id:             op.record_id,
          company_id:     companyId,
          fiscal_year_id: p.fiscal_year_id,
          journal_type:   p.journal_type,
          entry_date:     new Date(p.entry_date),
          reference:      p.reference,
          libelle:        p.libelle,
          status:         'brouillon',
          total_debit:    p.total_debit ?? 0,
          total_credit:   p.total_credit ?? 0,
          created_by:     userId,
          lines: p.lines ? {
            create: p.lines.map((l: any, i: number) => ({
              company_id: companyId,
              account_id: l.account_id,
              libelle:    l.libelle,
              debit:      l.debit ?? 0,
              credit:     l.credit ?? 0,
              line_order: i + 1,
            })),
          } : undefined,
        },
      });
    }
  }

  private async applyDocument(
    companyId: string,
    userId: string,
    op: SyncPushDto['operations'][0],
  ) {
    const p = op.payload;
    if (op.operation === 'create') {
      const exists = await this.prisma.document.findFirst({ where: { id: op.record_id } });
      if (exists) return;
      await this.prisma.document.create({
        data: {
          id:                op.record_id,
          company_id:        companyId,
          uploaded_by:       userId,
          name:              p.name,
          original_filename: p.original_filename,
          file_url:          p.file_url,
          file_key:          p.file_key,
          mime_type:         p.mime_type ?? 'image/jpeg',
          file_size_bytes:   p.file_size_bytes ?? 0,
          document_type:     p.document_type ?? 'autre',
          source:            'scan_mobile',
          journal_entry_id:  p.journal_entry_id,
        },
      });
    }
  }
}
