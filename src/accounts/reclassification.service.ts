// ════════════════════════════════════════════════════════════
//  Reclassement de comptes
//
//  Corrige des écritures passées sur un compte au mauvais sens
//  (ex. salaires saisis en 6711 avec l'ancien plan erroné) SANS
//  modifier l'historique : une écriture d'opérations diverses
//  « Reclassement » est créée par exercice, qui solde le compte
//  d'origine vers le compte cible. Traçable, réversible
//  (extourne), conforme à la pratique comptable.
// ════════════════════════════════════════════════════════════
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const LEGACY_MARK = '(ancien libellé';
const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class ReclassificationService {
  constructor(private prisma: PrismaService) {}

  private async companySystem(companyId: string) {
    const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { accounting_system: true } });
    if (!c) throw new NotFoundException('Entreprise introuvable');
    return c.accounting_system;
  }

  /** Comptes « ancien libellé — à vérifier » qui portent des écritures dans CETTE entreprise. */
  async legacyUsage(companyId: string) {
    const system = await this.companySystem(companyId);
    const legacy = await this.prisma.account.findMany({
      where:  { company_id: null, system, label: { contains: LEGACY_MARK } },
      select: { id: true, code: true, label: true },
      orderBy: { code: 'asc' },
    });
    // Seuls les comptes encore à corriger : solde non nul (écritures validées) ou brouillons.
    // Après reclassement, le compte est soldé et disparaît de la liste.
    const out: Array<{ id: string; code: string; label: string; lines: number }> = [];
    for (const a of legacy) {
      const lines = await this.prisma.journalLine.count({ where: { company_id: companyId, account_id: a.id } });
      if (!lines) continue;
      const { years, drafts } = await this.balances(companyId, a.id);
      if (years.length || drafts) out.push({ ...a, lines });
    }
    return out;
  }

  /** Solde du compte d'origine par exercice (écritures validées) et brouillons restants. */
  private async balances(companyId: string, accountId: string) {
    const lines = await this.prisma.journalLine.findMany({
      where:  { company_id: companyId, account_id: accountId, entry: { status: 'validee' } },
      select: { debit: true, credit: true, entry: { select: { fiscal_year_id: true } } },
    });
    const byYear = new Map<string, number>();
    for (const l of lines) {
      const fy = l.entry.fiscal_year_id;
      byYear.set(fy, (byYear.get(fy) ?? 0) + Number(l.debit) - Number(l.credit));
    }
    const drafts = await this.prisma.journalLine.count({
      where: { company_id: companyId, account_id: accountId, entry: { status: 'brouillon' } },
    });
    const years = await this.prisma.fiscalYear.findMany({
      where:  { id: { in: [...byYear.keys()] } },
      select: { id: true, label: true, start_date: true, end_date: true, is_closed: true },
    });
    return {
      drafts,
      years: years
        .map((y) => ({ ...y, solde: round2(byYear.get(y.id) ?? 0) }))
        .filter((y) => Math.abs(y.solde) >= 0.01)
        .sort((a, b) => a.start_date.getTime() - b.start_date.getTime()),
    };
  }

  /** Aperçu (dryRun) ou création des écritures de reclassement. */
  async reclassify(companyId: string, userId: string, sourceId: string, targetId: string, dryRun: boolean) {
    const system = await this.companySystem(companyId);
    const scope = { OR: [{ company_id: companyId }, { company_id: null, system }] };
    const [source, target] = await Promise.all([
      this.prisma.account.findFirst({ where: { id: sourceId, ...scope } }),
      this.prisma.account.findFirst({ where: { id: targetId, ...scope, is_active: true } }),
    ]);
    if (!source) throw new NotFoundException('Compte d\'origine introuvable');
    if (!target) throw new BadRequestException('Compte cible introuvable ou inactif');
    if (source.id === target.id) throw new BadRequestException('Choisissez un compte cible différent du compte d\'origine');
    if (!target.is_detail) throw new BadRequestException(`Le compte ${target.code} est un compte de regroupement : choisissez un compte détaillé (ex. ${target.code}1)`);
    if (target.label.includes(LEGACY_MARK)) throw new BadRequestException('Le compte cible porte lui-même un ancien libellé : choisissez le compte officiel');
    if (source.code[0] !== target.code[0]) {
      throw new BadRequestException(
        `Reclassement limité à la même classe (${source.code} est en classe ${source.code[0]}, ${target.code} en classe ${target.code[0]}) : ` +
        'un changement de classe déplacerait le montant entre bilan et compte de résultat.',
      );
    }

    const { years, drafts } = await this.balances(companyId, source.id);
    const today = new Date();
    const plan = years.map((y) => {
      // Date : aujourd'hui si elle tombe dans l'exercice, sinon le dernier jour de l'exercice
      const date = today >= y.start_date && today <= y.end_date ? today : y.end_date;
      return { fiscal_year_id: y.id, exercice: y.label, montant: Math.abs(y.solde), sens: y.solde > 0 ? 'debiteur' : 'crediteur', date, cloture: y.is_closed };
    });
    const preview = {
      source: { id: source.id, code: source.code, label: source.label },
      target: { id: target.id, code: target.code, label: target.label },
      ecritures: plan.map((p) => ({ ...p, date: p.date.toISOString().slice(0, 10) })),
      brouillons_restants: drafts,
    };
    if (dryRun) return preview;

    if (!plan.length) throw new BadRequestException(`Le compte ${source.code} est déjà soldé dans cette entreprise : rien à reclasser.`);
    const closed = plan.filter((p) => p.cloture);
    if (closed.length) {
      throw new BadRequestException(`Exercice clôturé (${closed.map((c) => c.exercice).join(', ')}) : le reclassement doit être passé sur l'exercice ouvert suivant par votre comptable.`);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const p of plan) {
        const libelle = `Reclassement ${source.code} → ${target.code} (${target.label})`.slice(0, 255);
        const entry = await tx.journalEntry.create({
          data: {
            company_id: companyId, fiscal_year_id: p.fiscal_year_id, journal_type: 'od',
            entry_date: p.date, reference: 'RECLASS', libelle, status: 'validee',
            total_debit: p.montant, total_credit: p.montant,
            created_by: userId, validated_by: userId, validated_at: new Date(),
          },
        });
        // Solde débiteur : débit cible / crédit origine (et l'inverse pour un solde créditeur)
        const debitTarget = p.sens === 'debiteur';
        await tx.journalLine.createMany({
          data: [
            { entry_id: entry.id, company_id: companyId, account_id: target.id, libelle, debit: debitTarget ? p.montant : 0, credit: debitTarget ? 0 : p.montant, line_order: 1 },
            { entry_id: entry.id, company_id: companyId, account_id: source.id, libelle, debit: debitTarget ? 0 : p.montant, credit: debitTarget ? p.montant : 0, line_order: 2 },
          ],
        });
        ids.push(entry.id);
      }
      await tx.auditLog.create({
        data: { user_id: userId, company_id: companyId, action: 'accounts.reclassified', table_name: 'journal_entries',
                record_id: source.id, new_values: { from: source.code, to: target.code, entries: ids, amounts: plan.map((p) => p.montant) } },
      });
      return ids;
    });
    return { ...preview, entries_created: created.length };
  }
}
