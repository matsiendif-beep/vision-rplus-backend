import {
  Injectable, NotFoundException,
  ForbiddenException, BadRequestException, Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID }     from 'crypto';
import { PrismaService }  from '../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import {
  DEMO_MARKER, DEMO_COMPANY, DEMO_ACCOUNT_CODES, buildDemoEntries, resolveDemoAccounts,
} from './demo-company';

import { COMPANY_LIMITS, CABINET_EXTRA_COMPANY } from '../common/plan/plan-limits.service';

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(private prisma: PrismaService) {}

  // ── Créer une entreprise ───────────────────────────────────
  async create(userId: string, dto: CreateCompanyDto) {
    // Vérifier la limite du plan
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { plan: true },
    });

    // Seules les entreprises actives comptent ; la démo n'est jamais comptée.
    const active = await this.prisma.company.findMany({
      where:  { owner_id: userId, is_active: true },
      select: { rccm: true },
    });
    const limit   = COMPANY_LIMITS[user!.plan] ?? 1;
    const current = active.filter((c) => c.rccm !== DEMO_MARKER).length;

    if (current >= limit) {
      const labels: Record<string, string> = { free: 'Gratuit', pro: 'Pro', cabinet: 'Cabinet' };
      throw new ForbiddenException(
        user!.plan === 'cabinet'
          ? `Votre plan Cabinet inclut ${limit} entreprises. Chaque entreprise supplémentaire est facturée ` +
            `${CABINET_EXTRA_COMPANY.EUR} €/mois (${CABINET_EXTRA_COMPANY.XAF.toLocaleString('fr-FR')} FCFA) : ` +
            `écrivez à contact@visionrplus.com pour l'ajouter.`
          : `Votre plan ${labels[user!.plan] ?? user!.plan} est limité à ${limit} entreprise${limit > 1 ? 's' : ''}. ` +
            `Passez au plan supérieur pour en créer davantage.`,
      );
    }

    // Créer l'entreprise + premier exercice fiscal automatiquement
    const company = await this.prisma.$transaction(async (tx) => {
      const newCompany = await tx.company.create({
        data: {
          owner_id:          userId,
          name:              dto.name,
          legal_form:        dto.legal_form,
          accounting_system: dto.accounting_system,
          currency:          dto.currency    ?? 'EUR',
          country:           dto.country     ?? 'France',
          address:           dto.address,
          city:              dto.city,
          postal_code:       dto.postal_code,
          phone:             dto.phone,
          email:             dto.email,
          website:           dto.website,
          siret:             dto.siret,
          rccm:              dto.rccm,
          nif:               dto.nif,
          fiscal_year_start: new Date(dto.fiscal_year_start),
          fiscal_year_end:   new Date(dto.fiscal_year_end),
        },
      });

      // Créer automatiquement le premier exercice fiscal
      const year = new Date(dto.fiscal_year_start).getFullYear();
      await tx.fiscalYear.create({
        data: {
          company_id: newCompany.id,
          label:      `Exercice ${year}`,
          start_date: new Date(dto.fiscal_year_start),
          end_date:   new Date(dto.fiscal_year_end),
        },
      });

      this.logger.log(`Entreprise créée : ${newCompany.name} (${newCompany.accounting_system})`);
      return newCompany;
    });

    return company;
  }

  // ── Liste des entreprises de l'utilisateur ─────────────────
  async findAll(userId: string) {
    // Inclure les entreprises dont l'utilisateur est owner OU membre
    const ownedCompanies = await this.prisma.company.findMany({
      where:   { owner_id: userId, is_active: true },
      include: {
        _count:      { select: { journal_entries: true } },
        fiscal_years: {
          where:   { is_closed: false },
          orderBy: { start_date: 'desc' },
          take:    1,
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const memberCompanies = await this.prisma.companyMember.findMany({
      where:   { user_id: userId, accepted_at: { not: null } },
      include: {
        company: {
          include: {
            _count: { select: { journal_entries: true } },
          },
        },
      },
    });

    return {
      owned:  ownedCompanies.map((c) => ({ ...c, is_demo: c.rccm === DEMO_MARKER })),
      shared: memberCompanies.map((m) => ({ ...m.company, role: m.role })),
    };
  }

  // ── Entreprise de démonstration (onboarding) ───────────────
  //  Crée une PME fictive SYSCOHADA avec une année d'écritures
  //  validées. Idempotent : renvoie la démo existante si présente.
  async createDemo(userId: string) {
    const existing = await this.prisma.company.findFirst({
      where:   { owner_id: userId, rccm: DEMO_MARKER, is_active: true },
      include: { fiscal_years: { orderBy: { start_date: 'desc' } } },
    });
    if (existing) return { ...existing, is_demo: true };

    const accounts = await this.prisma.account.findMany({
      where:   { system: 'ohada', company_id: null, is_active: true, code: { in: DEMO_ACCOUNT_CODES } },
      select:  { id: true, code: true, label: true },
      orderBy: { created_at: 'asc' },
    });
    const { ids: accountId, missing } = resolveDemoAccounts(accounts);
    if (missing.length) {
      this.logger.error(`Démo impossible — comptes OHADA introuvables pour : ${missing.join(', ')}`);
      throw new InternalServerErrorException('Plan comptable OHADA incomplet : démo indisponible');
    }

    // Année en cours ; en début d'année, on prend l'année précédente complète
    // pour que les états financiers soient parlants.
    const now   = new Date();
    const year  = now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const end   = new Date(Date.UTC(year, 11, 31));
    const demoEntries = buildDemoEntries(year, now);

    const company = await this.prisma.$transaction(async (tx) => {
      const c = await tx.company.create({
        data: {
          owner_id:          userId,
          ...DEMO_COMPANY,
          fiscal_year_start: start,
          fiscal_year_end:   end,
        },
      });
      const fy = await tx.fiscalYear.create({
        data: { company_id: c.id, label: `Exercice ${year}`, start_date: start, end_date: end },
      });

      const entries = demoEntries.map((e) => {
        const total = e.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
        return {
          id:             randomUUID(),
          company_id:     c.id,
          fiscal_year_id: fy.id,
          journal_type:   e.journal,
          entry_date:     e.date,
          reference:      e.ref,
          libelle:        e.libelle,
          status:         'validee' as const,
          total_debit:    total,
          total_credit:   total,
          created_by:     userId,
          validated_by:   userId,
          validated_at:   e.date,
        };
      });
      await tx.journalEntry.createMany({ data: entries });
      await tx.journalLine.createMany({
        data: demoEntries.flatMap((e, i) =>
          e.lines.map((l, j) => ({
            entry_id:   entries[i].id,
            company_id: c.id,
            account_id: accountId.get(l.code)!,
            libelle:    l.libelle ?? e.libelle,
            debit:      l.debit  ?? 0,
            credit:     l.credit ?? 0,
            line_order: j + 1,
          })),
        ),
      });

      return tx.company.findUniqueOrThrow({
        where:   { id: c.id },
        include: { fiscal_years: { orderBy: { start_date: 'desc' } } },
      });
    }, { timeout: 30_000 });

    this.logger.log(`Entreprise démo créée pour ${userId} (${demoEntries.length} écritures)`);
    return { ...company, is_demo: true };
  }

  // ── Récupérer une entreprise ───────────────────────────────
  async findOne(companyId: string, userId: string) {
    const company = await this.prisma.company.findFirst({
      where: {
        id:        companyId,
        is_active: true,
        OR: [
          { owner_id: userId },
          {
            members: {
              some: { user_id: userId, accepted_at: { not: null } },
            },
          },
        ],
      },
      include: {
        fiscal_years: { orderBy: { start_date: 'desc' } },
        _count: {
          select: {
            journal_entries: true,
            accounts:        true,
            third_parties:   true,
          },
        },
      },
    });

    if (!company) throw new NotFoundException('Entreprise introuvable');
    return company;
  }

  // ── Mettre à jour une entreprise ──────────────────────────
  async update(companyId: string, userId: string, dto: UpdateCompanyDto) {
    await this.checkOwnership(companyId, userId);

    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...dto,
        fiscal_year_start: dto.fiscal_year_start
          ? new Date(dto.fiscal_year_start)
          : undefined,
        fiscal_year_end: dto.fiscal_year_end
          ? new Date(dto.fiscal_year_end)
          : undefined,
      },
    });
  }

  // ── Supprimer (désactiver) une entreprise ─────────────────
  async remove(companyId: string, userId: string) {
    await this.checkOwnership(companyId, userId);

    // Soft delete : is_active = false (préserve les données)
    await this.prisma.company.update({
      where: { id: companyId },
      data:  { is_active: false },
    });

    return { message: 'Entreprise désactivée avec succès' };
  }

  // ── Exercices fiscaux d'une entreprise ────────────────────
  async getFiscalYears(companyId: string) {
    return this.prisma.fiscalYear.findMany({
      where:   { company_id: companyId },
      orderBy: { start_date: 'desc' },
    });
  }

  // ── Créer un exercice fiscal ───────────────────────────────
  async createFiscalYear(
    companyId: string,
    userId: string,
    dto: { label: string; start_date: string; end_date: string },
  ) {
    await this.checkOwnership(companyId, userId);

    const start = new Date(dto.start_date);
    const end   = new Date(dto.end_date);

    if (end <= start) {
      throw new BadRequestException('La date de fin doit être après la date de début');
    }

    // Vérifier qu'il n'y a pas de chevauchement
    const overlap = await this.prisma.fiscalYear.findFirst({
      where: {
        company_id: companyId,
        OR: [
          { start_date: { lte: end },   end_date: { gte: start } },
        ],
      },
    });
    if (overlap) {
      throw new BadRequestException(
        `Cet exercice chevauche "${overlap.label}" (${overlap.start_date.toISOString().slice(0,10)} → ${overlap.end_date.toISOString().slice(0,10)})`
      );
    }

    return this.prisma.fiscalYear.create({
      data: {
        company_id: companyId,
        label:      dto.label,
        start_date: start,
        end_date:   end,
      },
    });
  }

  // ── Statistiques rapides ──────────────────────────────────
  async getStats(companyId: string) {
    const [entryCount, validatedCount, accounts, currentYear] =
      await Promise.all([
        this.prisma.journalEntry.count({ where: { company_id: companyId } }),
        this.prisma.journalEntry.count({
          where: { company_id: companyId, status: 'validee' },
        }),
        this.prisma.account.count({
          where: { company_id: companyId, is_active: true },
        }),
        this.prisma.fiscalYear.findFirst({
          where:   { company_id: companyId, is_closed: false },
          orderBy: { start_date: 'desc' },
        }),
      ]);

    return { entryCount, validatedCount, accounts, currentYear };
  }

  // ── Vérification de propriété ─────────────────────────────
  private async checkOwnership(companyId: string, userId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, owner_id: userId },
    });
    if (!company) {
      throw new ForbiddenException(
        'Seul le propriétaire peut effectuer cette action',
      );
    }
    return company;
  }
}
