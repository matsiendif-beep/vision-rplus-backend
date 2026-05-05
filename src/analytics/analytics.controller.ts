import {
  Controller, Get, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService }   from './analytics.service';
import { JwtAuthGuard }       from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard } from '../common/guards/company-access.guard';

@ApiTags('Analyse financière & KPIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
@Controller('companies/:companyId/analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard principal — synthèse + KPIs + alertes' })
  getDashboard(
    @Param('companyId') companyId: string,
    @Query('fiscal_year_id') fiscalYearId: string,
  ) {
    return this.service.getDashboard(companyId, fiscalYearId);
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Indicateurs clés (CAF, trésorerie, rentabilité, endettement)' })
  getKpis(
    @Param('companyId') companyId: string,
    @Query('fiscal_year_id') fiscalYearId: string,
  ) {
    return this.service.getKpis(companyId, fiscalYearId);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Balance générale des comptes' })
  getBalance(
    @Param('companyId') companyId: string,
    @Query('fiscal_year_id') fiscalYearId: string,
  ) {
    return this.service.getBalance(companyId, fiscalYearId);
  }

  @Get('grand-livre')
  @ApiOperation({ summary: 'Grand livre comptable' })
  getGrandLivre(
    @Param('companyId') companyId: string,
    @Query('fiscal_year_id') fiscalYearId: string,
    @Query('account_code') accountCode?: string,
  ) {
    return this.service.getGrandLivre(companyId, fiscalYearId, accountCode);
  }
}
