import {
  Injectable, NotFoundException,
  ForbiddenException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService }    from '../prisma/prisma.service';
import { AccountingEngine } from './accounting.engine';
import {
  CreateJournalEntryDto,
  UpdateJournalEntryDto,
  FilterEntriesDto,
  ReverseEntryDto,
} from './dto/journal.dto';

@Injectable()
export class JournalService {
  private readonly logger = new Logger(JournalService.name);

  constructor(
    private prisma:  PrismaService,
    private engine:  AccountingEngine,
  ) {}

  // ══════════════════════════════════════════════════════════
  //  CRÉER UNE ÉCRITURE
  // ══════════════════════════════════════════════════════════
  async createEntry(
    companyId  : string,
    userId     : string,
    dto        : CreateJournalEntryDto,
  ) {
    // 1. Vérifier que l'exercice existe et n'est pas clôturé
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: dto.fiscal_year_id, company_id: companyId },
    });
    if (!fiscalYear)       throw new NotFoundException('Exercice fiscal introuvable');
    if (fiscalYear.is_closed) {
      throw new ForbiddenException(
        'Cet exercice est clôturé. Aucune écriture ne peut y être ajoutée.',
      );
    }

    // 2. Vérifier que la date est dans l'exercice
    const entryDate = new Date(dto.entry_date);
    if (entryDate < fiscalYear.start_date || entryDate > fiscalYear.end_date) {
      throw new BadRequestException(
        `La date doit être dans l'exercice : ${fiscalYear.start_date.toISOString().slice(0,10)} → ${fiscalYear.end_date.toISOString().slice(0,10)}`,
      );
    }

    // 3. Filtrer les lignes valides pour le brouillon :
    //    - account_id présent (lignes vides ignorées silencieusement)
    //    - au moins un montant non nul
    //    - compte actif dans cette entreprise ou plan système
    const rawLines = dto.lines.filter((l) => l.account_id && (l.debit > 0 || l.credit > 0));
    let validLines = rawLines;
    if (rawLines.length > 0) {
      const uniqueIds = [...new Set(rawLines.map((l) => l.account_id!))];
      const accounts  = await this.prisma.account.findMany({
        where: {
          id:        { in: uniqueIds },
          is_active: true,
          OR: [
            { company_id: companyId },
            { company_id: null },
          ],
        },
      });
      const validIds = new Set(accounts.map((a) => a.id));
      validLines = rawLines.filter((l) => validIds.has(l.account_id!));
    }

    const totalDebit  = validLines.reduce((s, l) => s + l.debit,  0);
    const totalCredit = validLines.reduce((s, l) => s + l.credit, 0);

    // 5. Insertion atomique (en-tête + lignes)
    const entry = await this.prisma.$transaction(async (tx) => {
      const newEntry = await tx.journalEntry.create({
        data: {
          company_id:     companyId,
          fiscal_year_id: dto.fiscal_year_id,
          journal_type:   dto.journal_type,
          entry_date:     new Date(dto.entry_date),
          libelle:        dto.libelle,
          reference:      dto.reference,
          total_debit:    totalDebit,
          total_credit:   totalCredit,
          status:         'brouillon',
          created_by:     userId,
        },
      });

      if (validLines.length > 0) {
        await tx.journalLine.createMany({
          data: validLines.map((line, index) => ({
            entry_id:   newEntry.id,
            company_id: companyId,
            account_id: line.account_id!,
            libelle:    line.libelle,
            debit:      line.debit,
            credit:     line.credit,
            line_order: index + 1,
          })),
        });
      }

      return newEntry;
    });

    this.logger.log(`Écriture créée : ${entry.id} | ${entry.libelle} | ${totalDebit}€`);
    return this.findOneEntry(entry.id, companyId);
  }

  // ══════════════════════════════════════════════════════════
  //  LISTE DES ÉCRITURES (paginée + filtrée)
  // ══════════════════════════════════════════════════════════
  async findAllEntries(companyId: string, filters: FilterEntriesDto) {
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 30;
    const skip  = (page - 1) * limit;

    const where: any = { company_id: companyId };

    if (filters.journal_type)    where.journal_type   = filters.journal_type;
    if (filters.status)          where.status         = filters.status;
    if (filters.fiscal_year_id)  where.fiscal_year_id = filters.fiscal_year_id;
    if (filters.date_from || filters.date_to) {
      where.entry_date = {};
      if (filters.date_from) where.entry_date.gte = new Date(filters.date_from);
      if (filters.date_to)   where.entry_date.lte = new Date(filters.date_to);
    }
    if (filters.search) {
      where.OR = [
        { libelle:   { contains: filters.search, mode: 'insensitive' } },
        { reference: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [entries, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where,
        include: {
          lines: {
            include: {
              account: { select: { code: true, label: true, type: true } },
            },
            orderBy: { line_order: 'asc' },
          },
          creator:    { select: { first_name: true, last_name: true } },
          validator:  { select: { first_name: true, last_name: true } },
        },
        orderBy: [{ entry_date: 'desc' }, { created_at: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.journalEntry.count({ where }),
    ]);

    return {
      data:       entries,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  // ══════════════════════════════════════════════════════════
  //  RÉCUPÉRER UNE ÉCRITURE
  // ══════════════════════════════════════════════════════════
  async findOneEntry(entryId: string, companyId: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id: entryId, company_id: companyId },
      include: {
        lines: {
          include: {
            account: {
              select: { code: true, label: true, type: true, system: true },
            },
          },
          orderBy: { line_order: 'asc' },
        },
        fiscal_year: { select: { label: true, start_date: true, end_date: true } },
        creator:     { select: { first_name: true, last_name: true, email: true } },
        validator:   { select: { first_name: true, last_name: true } },
      },
    });

    if (!entry) throw new NotFoundException('Écriture introuvable');
    return entry;
  }

  // ══════════════════════════════════════════════════════════
  //  MODIFIER UNE ÉCRITURE (brouillon uniquement)
  // ══════════════════════════════════════════════════════════
  async updateEntry(
    entryId    : string,
    companyId  : string,
    userId     : string,
    dto        : UpdateJournalEntryDto,
  ) {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id: entryId, company_id: companyId },
    });
    if (!existing) throw new NotFoundException('Écriture introuvable');

    if (existing.status === 'validee') {
      throw new ForbiddenException(
        'Une écriture validée ne peut plus être modifiée. ' +
        'Utilisez une écriture de contrepassation.',
      );
    }
    if (existing.status === 'annulee') {
      throw new ForbiddenException('Une écriture annulée ne peut pas être modifiée');
    }

    // Filtrer les lignes valides (brouillon : pas de validation de l'équilibre)
    let filteredLines: typeof dto.lines | undefined;
    let totalDebit  = Number(existing.total_debit);
    let totalCredit = Number(existing.total_credit);

    if (dto.lines) {
      const rawLines = dto.lines.filter((l) => l.account_id && (l.debit > 0 || l.credit > 0));
      if (rawLines.length > 0) {
        const uniqueIds = [...new Set(rawLines.map((l) => l.account_id!))];
        const accounts  = await this.prisma.account.findMany({
          where: {
            id:        { in: uniqueIds },
            is_active: true,
            OR: [
              { company_id: companyId },
              { company_id: null },
            ],
          },
        });
        const validIds  = new Set(accounts.map((a) => a.id));
        filteredLines   = rawLines.filter((l) => validIds.has(l.account_id!));
      } else {
        filteredLines = [];
      }
      totalDebit  = filteredLines.reduce((s, l) => s + l.debit,  0);
      totalCredit = filteredLines.reduce((s, l) => s + l.credit, 0);
    }

    return this.prisma.$transaction(async (tx) => {
      // Mettre à jour l'en-tête
      await tx.journalEntry.update({
        where: { id: entryId },
        data: {
          journal_type:   dto.journal_type,
          entry_date:     dto.entry_date ? new Date(dto.entry_date) : undefined,
          libelle:        dto.libelle,
          reference:      dto.reference,
          total_debit:    totalDebit,
          total_credit:   totalCredit,
        },
      });

      // Si nouvelles lignes : supprimer les anciennes et recréer (lignes valides seulement)
      if (filteredLines !== undefined) {
        await tx.journalLine.deleteMany({ where: { entry_id: entryId } });
        if (filteredLines.length > 0) {
          await tx.journalLine.createMany({
            data: filteredLines.map((line, index) => ({
              entry_id:   entryId,
              company_id: companyId,
              account_id: line.account_id!,
              libelle:    line.libelle,
              debit:      line.debit,
              credit:     line.credit,
              line_order: index + 1,
            })),
          });
        }
      }

      return this.findOneEntry(entryId, companyId);
    });
  }

  // ══════════════════════════════════════════════════════════
  //  VALIDER UNE ÉCRITURE (brouillon → validée)
  // ══════════════════════════════════════════════════════════
  async validateEntry(entryId: string, companyId: string, userId: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where:   { id: entryId, company_id: companyId },
      include: { lines: true },
    });
    if (!entry) throw new NotFoundException('Écriture introuvable');
    if (entry.status === 'validee') {
      throw new BadRequestException('Cette écriture est déjà validée');
    }
    if (entry.status === 'annulee') {
      throw new ForbiddenException('Impossible de valider une écriture annulée');
    }

    // Vérifications strictes avant validation définitive
    if (entry.lines.length < 2) {
      throw new BadRequestException(
        "L'écriture doit comporter au moins 2 lignes pour être validée",
      );
    }

    const accountIds = [...new Set(entry.lines.map((l) => l.account_id))];
    const accounts   = await this.prisma.account.findMany({
      where: {
        id:        { in: accountIds },
        is_active: true,
        OR: [
          { company_id: companyId },
          { company_id: null },
        ],
      },
    });
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException(
        "Un ou plusieurs comptes sont introuvables ou inactifs. Modifiez l'écriture avant de valider.",
      );
    }

    // Vérification de l'équilibre débit = crédit
    try {
      this.engine.validateEntry(
        entry.lines.map((l) => ({
          debit:  Number(l.debit),
          credit: Number(l.credit),
        })),
      );
    } catch (err) {
      throw new BadRequestException(`Validation impossible : ${err.message}`);
    }

    const validated = await this.prisma.journalEntry.update({
      where: { id: entryId },
      data:  {
        status:       'validee',
        validated_by: userId,
        validated_at: new Date(),
      },
    });

    this.logger.log(`Écriture validée : ${entryId} par user ${userId}`);
    return validated;
  }

  // ══════════════════════════════════════════════════════════
  //  CONTREPASSATION (annuler une écriture validée)
  //  Crée une écriture miroir avec débit/crédit inversés
  // ══════════════════════════════════════════════════════════
  async reverseEntry(
    entryId    : string,
    companyId  : string,
    userId     : string,
    dto        : ReverseEntryDto,
  ) {
    const original = await this.prisma.journalEntry.findFirst({
      where:   { id: entryId, company_id: companyId },
      include: { lines: true },
    });
    if (!original) throw new NotFoundException('Écriture introuvable');

    if (original.status !== 'validee') {
      throw new ForbiddenException(
        'Seule une écriture validée peut être contrepassée',
      );
    }

    const libelle = dto.libelle ?? `Contrepassation : ${original.libelle}`;

    // Inverser débit ↔ crédit sur chaque ligne
    const reversedLines = original.lines.map((line) => ({
      account_id: line.account_id,
      libelle:    line.libelle ?? undefined,
      debit:      Number(line.credit),  // Crédit devient débit
      credit:     Number(line.debit),   // Débit devient crédit
    }));

    return this.prisma.$transaction(async (tx) => {
      // Créer l'écriture de contrepassation
      const reversal = await tx.journalEntry.create({
        data: {
          company_id:     companyId,
          fiscal_year_id: original.fiscal_year_id,
          journal_type:   original.journal_type,
          entry_date:     new Date(dto.reversal_date),
          libelle,
          reference:      `CONTREPASS-${original.reference ?? original.id.slice(0, 8)}`,
          total_debit:    Number(original.total_credit),
          total_credit:   Number(original.total_debit),
          status:         'brouillon',
          created_by:     userId,
        },
      });

      await tx.journalLine.createMany({
        data: reversedLines.map((line, index) => ({
          entry_id:   reversal.id,
          company_id: companyId,
          account_id: line.account_id,
          libelle:    line.libelle,
          debit:      line.debit,
          credit:     line.credit,
          line_order: index + 1,
        })),
      });

      // Marquer l'originale comme annulée
      await tx.journalEntry.update({
        where: { id: entryId },
        data:  { status: 'annulee' },
      });

      this.logger.log(`Contrepassation créée : ${reversal.id} ← ${entryId}`);
      return { original_entry: entryId, reversal_entry: reversal.id, libelle };
    });
  }

  // ══════════════════════════════════════════════════════════
  //  ÉTATS FINANCIERS (délégués au moteur comptable)
  // ══════════════════════════════════════════════════════════

  async getIncomeStatement(companyId: string, fiscalYearId: string) {
    await this.checkFiscalYearAccess(companyId, fiscalYearId);
    return this.engine.getIncomeStatement(companyId, fiscalYearId);
  }

  async getBalanceSheet(companyId: string, fiscalYearId: string) {
    await this.checkFiscalYearAccess(companyId, fiscalYearId);
    return this.engine.getBalanceSheet(companyId, fiscalYearId);
  }

  async getDashboard(companyId: string, fiscalYearId: string) {
    await this.checkFiscalYearAccess(companyId, fiscalYearId);

    const [cashBalance, incomeStatement, monthlyEvolution, draftEntries] =
      await Promise.all([
        this.engine.getCashBalance(companyId, fiscalYearId),
        this.engine.getIncomeStatement(companyId, fiscalYearId),
        this.engine.getMonthlyEvolution(companyId, fiscalYearId),
        this.prisma.journalEntry.count({
          where: { company_id: companyId, fiscal_year_id: fiscalYearId, status: 'brouillon' },
        }),
      ]);

    return {
      cash_balance:     cashBalance,
      total_produits:   incomeStatement.total_produits,
      total_charges:    incomeStatement.total_charges,
      resultat_net:     incomeStatement.resultat_net,
      nature_resultat:  incomeStatement.nature_resultat,
      monthly_evolution: monthlyEvolution,
      pending_entries:  draftEntries,
      generated_at:     new Date().toISOString(),
    };
  }

  // ══════════════════════════════════════════════════════════
  //  IMPORT CSV
  //  Format attendu : date,piece,compte,tiers,libelle,debit,credit,journal_type
  //  Les lignes sont groupées par (piece + date + libelle) en une seule écriture
  // ══════════════════════════════════════════════════════════
  async importCsv(companyId: string, userId: string, fileBuffer: Buffer) {
    const text = fileBuffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());

    if (lines.length < 2) throw new BadRequestException('Fichier CSV vide ou invalide');

    // Trouver le fiscal year ouvert
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { company_id: companyId, is_closed: false },
      orderBy: { start_date: 'desc' },
    });
    if (!fiscalYear) throw new BadRequestException('Aucun exercice fiscal ouvert trouvé');

    // Charger tous les comptes de l'entreprise (y compris système)
    const accounts = await this.prisma.account.findMany({
      where: {
        is_active: true,
        OR: [{ company_id: companyId }, { company_id: null }],
      },
      select: { id: true, code: true },
    });
    const accountByCode = new Map(accounts.map((a) => [a.code.trim(), a.id]));

    // Parser le CSV (ignorer la première ligne = en-têtes)
    type CsvRow = { date: string; piece: string; compte: string; tiers: string; libelle: string; debit: number; credit: number; journal_type: string };
    const rows: CsvRow[] = [];
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      if (cols.length < 7) continue;
      const [date, piece, compte, tiers, libelle, debitStr, creditStr, journal_type] = cols;
      if (!date || !piece || !compte) continue;

      const accountId = accountByCode.get(compte);
      if (!accountId) {
        errors.push(`Ligne ${i + 1}: compte "${compte}" introuvable`);
        continue;
      }

      rows.push({
        date, piece, compte, tiers, libelle,
        debit:  parseFloat(debitStr)  || 0,
        credit: parseFloat(creditStr) || 0,
        journal_type: journal_type ?? 'od',
      });
    }

    // Grouper par (piece + date + libelle) → une écriture
    const grouped = new Map<string, CsvRow[]>();
    for (const row of rows) {
      const key = `${row.piece}|${row.date}|${row.libelle}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    // Créer les écritures en base
    let created = 0;
    let skipped = 0;

    for (const [, groupRows] of grouped) {
      const first     = groupRows[0];
      const entryDate = new Date(first.date);

      // Vérifier que la date est dans l'exercice
      if (entryDate < fiscalYear.start_date || entryDate > fiscalYear.end_date) {
        skipped++;
        continue;
      }

      const totalDebit  = groupRows.reduce((s, r) => s + r.debit,  0);
      const totalCredit = groupRows.reduce((s, r) => s + r.credit, 0);

      await this.prisma.$transaction(async (tx) => {
        const entry = await tx.journalEntry.create({
          data: {
            company_id:     companyId,
            fiscal_year_id: fiscalYear.id,
            journal_type:   first.journal_type as any,
            entry_date:     entryDate,
            libelle:        first.libelle,
            reference:      first.piece,
            total_debit:    totalDebit,
            total_credit:   totalCredit,
            status:         'brouillon',
            created_by:     userId,
          },
        });

        await tx.journalLine.createMany({
          data: groupRows.map((r, idx) => ({
            entry_id:   entry.id,
            company_id: companyId,
            account_id: accountByCode.get(r.compte)!,
            libelle:    r.tiers || r.libelle,
            debit:      r.debit,
            credit:     r.credit,
            line_order: idx + 1,
          })),
        });
      });

      created++;
    }

    this.logger.log(`Import CSV: ${created} écritures créées, ${skipped} ignorées, ${errors.length} erreurs`);
    return { created, skipped, errors };
  }

  // ── Vérification accès exercice ───────────────────────────
  private async checkFiscalYearAccess(companyId: string, fiscalYearId: string) {
    const fy = await this.prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, company_id: companyId },
    });
    if (!fy) throw new NotFoundException('Exercice fiscal introuvable');
    return fy;
  }
}
