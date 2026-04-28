// ── common/decorators/get-user.decorator.ts ──────────────────
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extrait l'utilisateur authentifié depuis la requête.
 * Usage : @GetUser() user: User
 *         @GetUser('id') userId: string
 */
export const GetUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user    = request.user;
    return data ? user?.[data] : user;
  },
);

// ── common/decorators/company-access.decorator.ts ────────────
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Définit les rôles autorisés pour une route.
 * Usage : @RequireRoles('admin', 'comptable')
 */
export const RequireRoles = (...roles: string[]) =>
  SetMetadata(ROLES_KEY, roles);
