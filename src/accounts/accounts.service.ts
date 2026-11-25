import {
  Injectable, NotFoundException, BadRequestException,
  ConflictException, ForbiddenException,
} from '@nestjs/common';
import { PrismaService }    from '../prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto, FilterAccountsDto } from './dto/account.dto';
import { ALLOWED_CLASSES, PlanSystem } from '../accounting-plans';

const SEARCH_LIMIT = 50;

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  private async companySystem(companyId: string): Promise<PlanSystem> {
    const company = await this.prisma.company.findUnique({
      where:  { id: companyId },
      select: { accounting_system: true },
    });
    if (!company) throw new NotFoundException('Entreprise introuvable');
    return company.accounting_system as PlanSystem;
  }

  /** Comptes utilisables par l'entreprise : ses sous-comptes + le plan système de SON référentiel. */
  private scope(companyId: string, system: PlanSystem) {
    return { OR: [{ company_id: companyId }, { company_id: null, system }] };
  }

  // ── Plan comptable d'une entreprise ───────────────────────
  async findAll(companyId: string, filters: FilterAccountsDto) {
    const system = await this.companySystem(companyId);
    const where: any = { AND: [this.scope(companyId, system), { is_active: true }] };

    if (filters.type)      where.AND.push({ type: filters.type });
    if (filters.is_detail !== undefined) where.AND.push({ is_detail: filters.is_detail });
    if (filters.search) {
      where.AND.push({
        OR: [
          { code:  { startsWith: filters.search } },
          { label: { contains: filters.search, mode: 'insensitive' } },
        ],
      });
    }

    const accounts = await this.prisma.account.findMany({ where, orderBy: [{ code: 'asc' }] });
    const withFlag = accounts.map((a) => ({ ...a, is_custom: a.company_id !== null }));
    return { system, accounts: withFlag, grouped: this.groupByClass(withFlag), total: withFlag.length };
  }

  // ── Comptes par type (pour le compte de résultat / bilan) ─
  async findByType(companyId: string, types: string[]) {
    const system = await this.companySystem(companyId);
    return this.prisma.account.findMany({
      where: { ...this.scope(companyId, system), type: { in: types as any[] }, is_active: true },
      orderBy: { code: 'asc' },
    });
  }

  // ── Récupérer un compte ────────────────────────────────────
  async findOne(accountId: string, companyId: string) {
    const system = await this.companySystem(companyId);
    const account = await this.prisma.account.findFirst({
      where: { id: accountId, ...this.scope(companyId, system) },
    });
    if (!account) throw new NotFoundException('Compte introuvable');
    return account;
  }

  // ── Créer un sous-compte ───────────────────────────────────
  //  Règles (respect de la logique du plan) :
  //   • il prolonge un compte existant du plan de l'entreprise (ex. 6011 → 60111) ;
  //   • il hérite de la classe et du type de ce compte parent : un compte de
  //     classe 1 à 5 reste au bilan, un compte de classe 6 à 8 au compte de résultat ;
  //   • son numéro n'existe pas déjà (ni dans le plan officiel, ni chez l'entreprise).
  async create(companyId: string, dto: CreateAccountDto) {
    const system = await this.companySystem(companyId);
    const code = dto.code;

    if (!ALLOWED_CLASSES[system].includes(code[0])) {
      throw new BadRequestException(
        `La classe ${code[0]} n'existe pas dans le plan ${system === 'ohada' ? 'SYSCOHADA' : 'PCG'} ` +
        `(classes autorisées : ${ALLOWED_CLASSES[system].join(', ')}).`,
      );
    }

    const candidates = await this.prisma.account.findMany({
      where: {
        ...this.scope(companyId, system),
        is_active: true,
        code: { in: Array.from({ length: code.length - 1 }, (_, i) => code.slice(0, i + 2)).filter((c) => c.length >= 2) },
      },
      orderBy: { code: 'desc' },
    });

    if (candidates.some((a) => a.code === code)) {
      throw new ConflictException(`Le compte ${code} existe déjà dans votre plan comptable.`);
    }
    // Parent = compte existant le plus long dont le numéro commence le nouveau compte
    const parent = candidates
      .filter((a) => a.code.length < code.length)
      .sort((a, b) => b.code.length - a.code.length || Number(a.label.includes('(ancien libellé')) - Number(b.label.includes('(ancien libellé')))[0];
    if (!parent) {
      throw new BadRequestException(
        `Le compte ${code} doit prolonger un compte existant de votre plan (par exemple 6011 → 60111). ` +
        `Aucun compte ne correspond au début de ce numéro.`,
      );
    }

    return this.prisma.account.create({
      data: {
        company_id:  companyId,
        code,
        label:       dto.label,
        type:        parent.type,      // hérité : garantit la place au bilan / compte de résultat
        system,
        parent_code: parent.code,
        is_detail:   true,
      },
    });
  }

  // ── Modifier le libellé d'un sous-compte ──────────────────
  async update(accountId: string, companyId: string, dto: UpdateAccountDto) {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, company_id: companyId } });
    if (!account) {
      throw new ForbiddenException('Seuls les sous-comptes créés par votre entreprise peuvent être modifiés. Les comptes du plan officiel ne sont pas modifiables.');
    }
    return this.prisma.account.update({ where: { id: accountId }, data: { label: dto.label } });
  }

  // ── Désactiver un sous-compte ─────────────────────────────
  async remove(accountId: string, companyId: string) {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, company_id: companyId } });
    if (!account) throw new NotFoundException('Compte introuvable ou non modifiable (compte du plan officiel)');

    const linesCount = await this.prisma.journalLine.count({ where: { account_id: accountId } });
    if (linesCount > 0) {
      throw new ForbiddenException(
        `Ce compte comporte ${linesCount} ligne(s) d'écriture : il ne peut pas être supprimé (données comptables préservées).`,
      );
    }
    await this.prisma.account.update({ where: { id: accountId }, data: { is_active: false } });
    return { message: 'Compte supprimé' };
  }

  // ── Recherche rapide (autocomplete saisie) ────────────────
  //  Comptes mouvementables du plan de l'entreprise uniquement.
  //  Numéro saisi → comptes qui commencent par ce numéro ; texte → libellé.
  async search(companyId: string, query = '') {
    const system = await this.companySystem(companyId);
    const q = query.trim();
    const isCode = /^\d+$/.test(q);
    return this.prisma.account.findMany({
      where: {
        ...this.scope(companyId, system),
        AND: [
          { is_active: true },
          { is_detail: true },
          ...(q ? [isCode
            ? { code: { startsWith: q } }
            : { OR: [{ label: { contains: q, mode: 'insensitive' as const } }, { code: { startsWith: q } }] }] : []),
        ],
      },
      orderBy: { code: 'asc' },
      take:    SEARCH_LIMIT,
    });
  }

  // ── Grouper les comptes par classe (1xx, 2xx…) ────────────
  private groupByClass(accounts: any[]) {
    return accounts.reduce((groups, account) => {
      const cls = account.code[0];
      if (!groups[cls]) groups[cls] = [];
      groups[cls].push(account);
      return groups;
    }, {} as Record<string, any[]>);
  }
}
