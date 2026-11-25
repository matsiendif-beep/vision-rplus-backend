// ════════════════════════════════════════════════════════════
//  Synchronisation des plans comptables (au démarrage)
//
//  Aligne les comptes « système » (company_id = null) sur les plans
//  de référence (src/accounting-plans) : PCG 2026 et SYSCOHADA révisé.
//
//  Règles de prudence (les écritures existantes ne sont jamais faussées) :
//   • compte absent                         → créé
//   • libellé proche (simple écriture)      → libellé / type mis à jour
//   • sens différent ET compte jamais utilisé → corrigé
//   • sens différent ET compte déjà utilisé → conservé tel quel, libellé
//     suffixé « (ancien libellé — à vérifier) », signalé dans les logs,
//     et le compte correct est créé à côté
//   • doublon ou compte hors référence jamais utilisé → désactivé
//   • compte hors référence déjà utilisé    → conservé
//  Idempotent : un redémarrage sans changement n'écrit rien.
// ════════════════════════════════════════════════════════════
import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  REFERENCE_PLANS, PlanSystem, accountTypeFor, isPostable, labelSimilarity,
} from '../accounting-plans';

const LEGACY_SUFFIX = ' (ancien libellé — à vérifier)';
const SIMILAR = 0.5;

type SysAccount = { id: string; code: string; label: string; type: string; is_detail: boolean; is_active: boolean };

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger('PlanComptable');
  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    for (const system of Object.keys(REFERENCE_PLANS) as PlanSystem[]) {
      try {
        await this.syncSystem(system);
      } catch (e: any) {
        // Ne bloque jamais le démarrage de l'application
        this.logger.error(`Synchronisation ${system} impossible : ${e.message}`);
      }
    }
  }

  async syncSystem(system: PlanSystem) {
    const reference = REFERENCE_PLANS[system];
    const existing: SysAccount[] = await this.prisma.account.findMany({
      where:  { company_id: null, system },
      select: { id: true, code: true, label: true, type: true, is_detail: true, is_active: true },
    });

    // Nombre de lignes d'écriture par compte système de ce plan
    const used = new Map<string, number>();
    if (existing.length) {
      const counts = await this.prisma.journalLine.groupBy({
        by: ['account_id'],
        where: { account_id: { in: existing.map((a) => a.id) } },
        _count: { _all: true },
      });
      for (const c of counts) used.set(c.account_id, c._count._all);
    }
    const isUsed = (a: SysAccount) => (used.get(a.id) ?? 0) > 0;

    const byCode = new Map<string, SysAccount[]>();
    for (const a of existing) byCode.set(a.code, [...(byCode.get(a.code) ?? []), a]);

    const toCreate: { code: string; label: string; type: any; is_detail: boolean }[] = [];
    const updates: { id: string; data: Record<string, any> }[] = [];
    const warnings: string[] = [];
    const refCodes = new Set<string>();

    for (const [code, label] of reference) {
      refCodes.add(code);
      const type = accountTypeFor(system, code, label);
      const is_detail = isPostable(code);
      const candidates = byCode.get(code) ?? [];
      if (!candidates.length) { toCreate.push({ code, label, type, is_detail }); continue; }

      // Compte « principal » : le plus proche du libellé officiel, puis le plus utilisé
      const ranked = [...candidates].sort((x, y) =>
        (labelSimilarity(y.label.replace(LEGACY_SUFFIX, ''), label) - labelSimilarity(x.label.replace(LEGACY_SUFFIX, ''), label))
        || ((used.get(y.id) ?? 0) - (used.get(x.id) ?? 0)));
      const main = ranked[0];
      const similar = labelSimilarity(main.label.replace(LEGACY_SUFFIX, ''), label) >= SIMILAR;

      const keep = new Set<string>([main.id]);
      const alignTo = (a: SysAccount) => {
        const data: Record<string, any> = {};
        if (a.label !== label) data.label = label;
        if (a.type !== type) data.type = type;
        if (a.is_detail !== is_detail) data.is_detail = is_detail;
        if (!a.is_active) data.is_active = true;
        if (Object.keys(data).length) updates.push({ id: a.id, data });
      };

      if (similar || !isUsed(main)) {
        alignTo(main);
      } else {
        // Sens différent sur un compte déjà mouvementé : on ne touche pas aux écritures
        if (!main.label.endsWith(LEGACY_SUFFIX)) {
          updates.push({ id: main.id, data: { label: (main.label + LEGACY_SUFFIX).slice(0, 255) } });
        }
        warnings.push(`${code} « ${main.label.replace(LEGACY_SUFFIX, '')} » (${used.get(main.id)} ligne(s)) ≠ officiel « ${label} »`);
        // Le compte correct : un doublon au bon sens s'il existe, sinon on le crée
        const correct = candidates.find((c) => c !== main && labelSimilarity(c.label, label) >= SIMILAR)
                     ?? candidates.find((c) => c !== main && !isUsed(c));
        if (correct) { keep.add(correct.id); alignTo(correct); }
        else toCreate.push({ code, label, type, is_detail });
      }
      // Autres doublons inutilisés du même code → désactivés
      for (const dup of candidates) {
        if (!keep.has(dup.id) && !isUsed(dup) && dup.is_active) {
          updates.push({ id: dup.id, data: { is_active: false } });
        }
      }
    }

    // Comptes système hors référence (anciennes listes) : désactivés s'ils sont inutilisés
    let kept = 0;
    for (const a of existing) {
      if (refCodes.has(a.code) || !a.is_active) continue;
      if (isUsed(a)) { kept++; continue; }
      updates.push({ id: a.id, data: { is_active: false } });
    }

    if (!toCreate.length && !updates.length) {
      this.logger.log(`${system} : plan à jour (${reference.length} comptes de référence)`);
      return { created: 0, updated: 0 };
    }

    await this.prisma.$transaction(async (tx) => {
      if (toCreate.length) {
        await tx.account.createMany({
          data: toCreate.map((a) => ({ ...a, system, company_id: null, is_active: true })),
        });
      }
      for (const u of updates) await tx.account.update({ where: { id: u.id }, data: u.data });
    }, { timeout: 120_000 });

    this.logger.log(
      `${system} : ${toCreate.length} compte(s) ajouté(s), ${updates.length} mise(s) à jour` +
      (kept ? `, ${kept} ancien(s) compte(s) hors plan conservé(s) car déjà utilisé(s)` : ''),
    );
    for (const w of warnings) this.logger.warn(`Compte à vérifier (${system}) : ${w}`);
    return { created: toCreate.length, updated: updates.length, warnings };
  }
}
