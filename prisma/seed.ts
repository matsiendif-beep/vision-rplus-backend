// ════════════════════════════════════════════════════════════
//  npm run prisma:seed — synchronise les plans comptables
//  (PCG 2026 et SYSCOHADA révisé) avec la base de données.
//
//  Même logique que la synchronisation automatique au démarrage
//  de l'application (src/seed/seed.service.ts) : il n'existe
//  qu'UNE seule liste de référence, dans src/accounting-plans.
// ════════════════════════════════════════════════════════════
import { PrismaClient } from '@prisma/client';
import { SeedService } from '../src/seed/seed.service';

const prisma = new PrismaClient();

async function main() {
  const sync = new SeedService(prisma as any);
  for (const system of ['ohada', 'pcg_france'] as const) {
    const r = await sync.syncSystem(system);
    console.log(`${system} :`, r);
  }
}

main()
  .catch((e) => { console.error('Erreur seed :', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
