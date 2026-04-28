import {
  Injectable, CanActivate, ExecutionContext,
  ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Guard d'isolation multi-tenant.
 *
 * Vérifie que l'utilisateur authentifié est bien :
 *   - le propriétaire de l'entreprise, OU
 *   - un membre ayant accès (company_members)
 *
 * Récupère le company_id depuis :
 *   - req.params.companyId
 *   - req.body.company_id
 *
 * Usage : @UseGuards(JwtAuthGuard, CompanyAccessGuard)
 */
@Injectable()
export class CompanyAccessGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req       = ctx.switchToHttp().getRequest();
    const userId    = req.user?.id;
    const companyId = req.params?.companyId ?? req.body?.company_id;

    if (!companyId) return true; // Route sans contexte entreprise

    // Vérifier existence de l'entreprise
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company || !company.is_active) {
      throw new NotFoundException('Entreprise introuvable ou inactive');
    }

    // Propriétaire → accès total
    if (company.owner_id === userId) {
      req.company = company;
      req.userRole = 'admin';
      return true;
    }

    // Membre avec accès → accès selon rôle
    const membership = await this.prisma.companyMember.findUnique({
      where: {
        company_id_user_id: { company_id: companyId, user_id: userId },
      },
    });
    if (!membership || !membership.accepted_at) {
      throw new ForbiddenException("Accès refusé à cette entreprise");
    }

    req.company  = company;
    req.userRole = membership.role;
    return true;
  }
}
