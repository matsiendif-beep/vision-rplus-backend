// ── companies/companies.controller.ts ────────────────────────
import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle }          from '@nestjs/throttler';
import { IsString, IsDateString, IsOptional } from 'class-validator';
import { CompaniesService }  from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import { JwtAuthGuard }      from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard } from '../common/guards/company-access.guard';
import { PlanLimitsService, FREE_MONTHLY_ENTRIES } from '../common/plan/plan-limits.service';
import { GetUser }           from '../common/decorators';

class CreateFiscalYearDto {
  @IsString()  label: string;
  @IsDateString() start_date: string;
  @IsDateString() end_date: string;
}

@ApiTags('Entreprises')
@ApiBearerAuth()
// CompanyAccessGuard : toute route avec :companyId vérifie que l'utilisateur
// est propriétaire ou membre de l'entreprise (stats et exercices étaient ouverts).
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly service: CompaniesService,
    private readonly limits:  PlanLimitsService,
  ) {}

  // POST /companies
  @Post()
  @ApiOperation({ summary: 'Créer une nouvelle entreprise (dossier comptable)' })
  create(
    @GetUser('id') userId: string,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.service.create(userId, dto);
  }

  // POST /companies/demo
  @Post('demo')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Créer (ou récupérer) l\'entreprise de démonstration' })
  createDemo(@GetUser('id') userId: string) {
    return this.service.createDemo(userId);
  }

  // GET /companies
  @Get()
  @ApiOperation({ summary: 'Lister toutes les entreprises de l\'utilisateur' })
  findAll(@GetUser('id') userId: string) {
    return this.service.findAll(userId);
  }

  // GET /companies/:companyId
  @Get(':companyId')
  @ApiOperation({ summary: 'Détail d\'une entreprise' })
  findOne(
    @Param('companyId') companyId: string,
    @GetUser('id') userId: string,
  ) {
    return this.service.findOne(companyId, userId);
  }

  // GET /companies/:companyId/stats
  @Get(':companyId/stats')
  @ApiOperation({ summary: 'Statistiques rapides de l\'entreprise' })
  getStats(@Param('companyId') companyId: string) {
    return this.service.getStats(companyId);
  }

  // GET /companies/:companyId/usage — quota d'écritures du plan Gratuit
  @Get(':companyId/usage')
  @ApiOperation({ summary: 'Consommation du quota mensuel d\'écritures (plan Gratuit)' })
  async getUsage(@Param('companyId') companyId: string) {
    const u = await this.limits.entryUsage(companyId);
    return u.limited
      ? { limited: true, used: u.used, limit: FREE_MONTHLY_ENTRIES, remaining: u.remaining }
      : { limited: false };
  }

  // GET /companies/:companyId/fiscal-years
  @Get(':companyId/fiscal-years')
  @ApiOperation({ summary: 'Exercices fiscaux d\'une entreprise' })
  getFiscalYears(@Param('companyId') companyId: string) {
    return this.service.getFiscalYears(companyId);
  }

  // POST /companies/:companyId/fiscal-years
  @Post(':companyId/fiscal-years')
  @ApiOperation({ summary: 'Créer un nouvel exercice fiscal' })
  createFiscalYear(
    @Param('companyId') companyId: string,
    @GetUser('id') userId: string,
    @Body() dto: CreateFiscalYearDto,
  ) {
    return this.service.createFiscalYear(companyId, userId, dto);
  }

  // PATCH /companies/:companyId
  @Patch(':companyId')
  @ApiOperation({ summary: 'Modifier une entreprise' })
  update(
    @Param('companyId') companyId: string,
    @GetUser('id') userId: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.service.update(companyId, userId, dto);
  }

  // DELETE /companies/:companyId
  @Delete(':companyId')
  @ApiOperation({ summary: 'Désactiver une entreprise (soft delete)' })
  remove(
    @Param('companyId') companyId: string,
    @GetUser('id') userId: string,
  ) {
    return this.service.remove(companyId, userId);
  }
}
