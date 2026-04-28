// ── companies/companies.controller.ts ────────────────────────
import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CompaniesService }  from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import { JwtAuthGuard }      from '../common/guards/jwt-auth.guard';
import { GetUser }           from '../common/decorators';

@ApiTags('Entreprises')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly service: CompaniesService) {}

  // POST /companies
  @Post()
  @ApiOperation({ summary: 'Créer une nouvelle entreprise (dossier comptable)' })
  create(
    @GetUser('id') userId: string,
    @Body() dto: CreateCompanyDto,
  ) {
    return this.service.create(userId, dto);
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

  // GET /companies/:companyId/fiscal-years
  @Get(':companyId/fiscal-years')
  @ApiOperation({ summary: 'Exercices fiscaux d\'une entreprise' })
  getFiscalYears(@Param('companyId') companyId: string) {
    return this.service.getFiscalYears(companyId);
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
