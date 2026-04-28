import {
  Injectable, NotFoundException,
  ConflictException, ForbiddenException,
} from '@nestjs/common';
import { AccountingSystem } from '@prisma/client';
import { PrismaService }    from '../prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto, FilterAccountsDto } from './dto/account.dto';

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  // ── Plan comptable d'une entreprise ───────────────────────
  // Retourne : comptes personnalisés de l'entreprise
  //          + comptes système du bon système comptable
  async findAll(companyId: string, filters: FilterAccountsDto) {
    const company = await this.prisma.company.findUnique({
      where:  { id: companyId },
      select: { accounting_system: true },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable');

    const where: any = {
      AND: [
        // Comptes de l'entreprise OU comptes système
        {
          OR: [
            { company_id: companyId },
            { company_id: null, system: company!.accounting_system },
          ],
        },
        { is_active: true },
      ],
    };

    // Filtres optionnels
    if (filters.type)      where.AND.push({ type: filters.type });
    if (filters.system)    where.AND.push({ system: filters.system });
    if (filters.is_detail !== undefined) where.AND.push({ is_detail: filters.is_detail });
    if (filters.search) {
      where.AND.push({
        OR: [
          { code:  { contains: filters.search, mode: 'insensitive' } },
          { label: { contains: filters.search, mode: 'insensitive' } },
        ],
      });
    }

    const accounts = await this.prisma.account.findMany({
      where,
      orderBy: [{ code: 'asc' }],
    });

    // Grouper par classe (1xx, 2xx, etc.) pour l'affichage
    const grouped = this.groupByClass(accounts);
    return { accounts, grouped, total: accounts.length };
  }

  // ── Comptes par type (pour le compte de résultat / bilan) ─
  async findByType(companyId: string, types: string[]) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { accounting_system: true },
    });

    return this.prisma.account.findMany({
      where: {
        OR: [
          { company_id: companyId },
          { company_id: null, system: company!.accounting_system },
        ],
        type:      { in: types as any[] },
        is_active: true,
      },
      orderBy: { code: 'asc' },
    });
  }

  // ── Récupérer un compte ────────────────────────────────────
  async findOne(accountId: string, companyId: string) {
    const account = await this.prisma.account.findFirst({
      where: {
        id: accountId,
        OR: [
          { company_id: companyId },
          { company_id: null },
        ],
      },
    });
    if (!account) throw new NotFoundException('Compte introuvable');
    return account;
  }

  // ── Créer un compte personnalisé ──────────────────────────
  async create(companyId: string, dto: CreateAccountDto) {
    // Vérifier l'unicité du code dans cette entreprise + système
    const existing = await this.prisma.account.findFirst({
      where: {
        company_id: companyId,
        code:       dto.code,
        system:     dto.system,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Le compte ${dto.code} existe déjà dans ce plan comptable`,
      );
    }

    return this.prisma.account.create({
      data: {
        company_id:  companyId,
        code:        dto.code,
        label:       dto.label,
        type:        dto.type,
        system:      dto.system,
        parent_code: dto.parent_code,
        is_detail:   dto.is_detail ?? true,
      },
    });
  }

  // ── Modifier un compte personnalisé ───────────────────────
  async update(accountId: string, companyId: string, dto: UpdateAccountDto) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, company_id: companyId },
    });

    // Impossible de modifier un compte système (company_id = null)
    if (!account) {
      const sysAccount = await this.prisma.account.findUnique({
        where: { id: accountId },
      });
      if (sysAccount?.company_id === null) {
        throw new ForbiddenException(
          'Les comptes du plan comptable standard ne peuvent pas être modifiés. ' +
          'Créez un compte personnalisé à la place.',
        );
      }
      throw new NotFoundException('Compte introuvable');
    }

    return this.prisma.account.update({
      where: { id: accountId },
      data:  dto,
    });
  }

  // ── Désactiver un compte ──────────────────────────────────
  async remove(accountId: string, companyId: string) {
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, company_id: companyId },
    });
    if (!account) throw new NotFoundException('Compte introuvable ou non modifiable');

    // Vérifier que le compte n'a pas d'écritures
    const linesCount = await this.prisma.journalLine.count({
      where: { account_id: accountId },
    });
    if (linesCount > 0) {
      throw new ForbiddenException(
        `Ce compte comporte ${linesCount} écriture(s). ` +
        'Désactivation impossible (données comptables préservées).',
      );
    }

    await this.prisma.account.update({
      where: { id: accountId },
      data:  { is_active: false },
    });
    return { message: 'Compte désactivé' };
  }

  // ── Recherche rapide (autocomplete saisie) ────────────────
  async search(companyId: string, query: string, system: AccountingSystem) {
    return this.prisma.account.findMany({
      where: {
        OR: [
          { company_id: companyId },
          { company_id: null, system },
        ],
        AND: [
          { is_active: true },
          { is_detail: true },    // Seulement comptes mouvementables
          {
            OR: [
              { code:  { startsWith: query } },
              { label: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      },
      orderBy: { code: 'asc' },
      take:    15,   // Limité pour l'autocomplete
    });
  }

  // ── Grouper les comptes par classe (1xx, 2xx…) ────────────
  private groupByClass(accounts: any[]) {
    return accounts.reduce((groups, account) => {
      const cls = account.code[0]; // '1', '2', '3'…
      if (!groups[cls]) groups[cls] = [];
      groups[cls].push(account);
      return groups;
    }, {} as Record<string, any[]>);
  }
}
