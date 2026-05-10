import {
  Injectable, NotFoundException,
  ForbiddenException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService }  from '../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

// Limites par plan tarifaire
const COMPANY_LIMITS: Record<string, number> = {
  free:    1,
  pro:     3,
  cabinet: Infinity,
};

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(private prisma: PrismaService) {}

  // ── Créer une entreprise ───────────────────────────────────
  async create(userId: string, dto: CreateCompanyDto) {
    // Vérifier la limite du plan
    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { plan: true, _count: { select: { owned_companies: true } } },
    });

    const limit   = COMPANY_LIMITS[user!.plan] ?? 1;
    const current = user!._count.owned_companies;

    if (current >= limit) {
      throw new ForbiddenException(
        `Votre plan "${user!.plan}" est limité à ${limit} entreprise(s). ` +
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
      owned:  ownedCompanies,
      shared: memberCompanies.map((m) => ({ ...m.company, role: m.role })),
    };
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
