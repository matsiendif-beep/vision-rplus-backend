// ── accounts/accounts.controller.ts ──────────────────────────
import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, Req, ForbiddenException,
} from '@nestjs/common';

// Les membres invités en « lecture » ne peuvent pas modifier le plan comptable
const assertCanEdit = (req: any) => {
  if (req.userRole === 'lecture') throw new ForbiddenException('Accès en lecture seule : vous ne pouvez pas modifier le plan comptable.');
};
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsBoolean } from 'class-validator';
import { AccountsService }  from './accounts.service';
import { ReclassificationService } from './reclassification.service';
import { CreateAccountDto, UpdateAccountDto, FilterAccountsDto } from './dto/account.dto';
import { JwtAuthGuard }      from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard } from '../common/guards/company-access.guard';
import { GetUser }           from '../common/decorators';

class ReclassifyDto {
  @IsUUID('all', { message: 'Compte cible invalide' })
  target_account_id: string;

  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;
}

@ApiTags('Comptes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
@Controller('companies/:companyId/accounts')
export class AccountsController {
  constructor(
    private readonly service: AccountsService,
    private readonly reclass: ReclassificationService,
  ) {}

  // GET /companies/:companyId/accounts/legacy-usage
  // (déclarée avant « :accountId » pour ne pas être confondue avec un identifiant)
  @Get('legacy-usage')
  @ApiOperation({ summary: 'Comptes à ancien libellé portant des écritures dans cette entreprise' })
  legacyUsage(@Param('companyId') companyId: string) {
    return this.reclass.legacyUsage(companyId);
  }

  // POST /companies/:companyId/accounts/:accountId/reclassify
  @Post(':accountId/reclassify')
  @ApiOperation({ summary: 'Reclasser le solde d\'un compte vers un autre (écriture d\'OD), ou aperçu si dry_run' })
  reclassify(
    @Param('companyId') companyId: string,
    @Param('accountId') accountId: string,
    @GetUser('id') userId: string,
    @Body() dto: ReclassifyDto,
    @Req() req: any,
  ) {
    if (!dto.dry_run) assertCanEdit(req);
    return this.reclass.reclassify(companyId, userId, accountId, dto.target_account_id, !!dto.dry_run);
  }

  // GET /companies/:companyId/accounts
  @Get()
  @ApiOperation({ summary: 'Plan comptable de l\'entreprise (système + personnalisés)' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() filters: FilterAccountsDto,
  ) {
    return this.service.findAll(companyId, filters);
  }

  // GET /companies/:companyId/accounts/search
  @Get('search')
  @ApiOperation({ summary: 'Recherche rapide de comptes (autocomplete)' })
  @ApiQuery({ name: 'q',      required: true,  description: 'Code ou libellé' })
  search(
    @Param('companyId') companyId: string,
    @Query('q') query: string,
  ) {
    return this.service.search(companyId, query);
  }

  // GET /companies/:companyId/accounts/:accountId
  @Get(':accountId')
  @ApiOperation({ summary: 'Détail d\'un compte' })
  findOne(
    @Param('accountId') accountId: string,
    @Param('companyId') companyId: string,
  ) {
    return this.service.findOne(accountId, companyId);
  }

  // POST /companies/:companyId/accounts
  @Post()
  @ApiOperation({ summary: 'Créer un sous-compte (hérite de la classe du compte parent)' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateAccountDto,
    @Req() req: any,
  ) {
    assertCanEdit(req);
    return this.service.create(companyId, dto);
  }

  // PATCH /companies/:companyId/accounts/:accountId
  @Patch(':accountId')
  @ApiOperation({ summary: 'Modifier un compte personnalisé' })
  update(
    @Param('accountId') accountId: string,
    @Param('companyId') companyId: string,
    @Body() dto: UpdateAccountDto,
    @Req() req: any,
  ) {
    assertCanEdit(req);
    return this.service.update(accountId, companyId, dto);
  }

  // DELETE /companies/:companyId/accounts/:accountId
  @Delete(':accountId')
  @ApiOperation({ summary: 'Désactiver un compte (si aucune écriture)' })
  remove(
    @Param('accountId') accountId: string,
    @Param('companyId') companyId: string,
    @Req() req: any,
  ) {
    assertCanEdit(req);
    return this.service.remove(accountId, companyId);
  }
}
