import {
  Controller, Get, Post, Patch, Body, Param,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FixedAssetsService }   from './fixed-assets.service';
import { JwtAuthGuard }         from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard }   from '../common/guards/company-access.guard';
import { GetUser }              from '../common/decorators';
import {
  CreateFixedAssetDto, UpdateFixedAssetDto, DisposeAssetDto,
} from './dto/fixed-assets.dto';

@ApiTags('Immobilisations & Amortissements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
@Controller('companies/:companyId/fixed-assets')
export class FixedAssetsController {
  constructor(private readonly service: FixedAssetsService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les immobilisations' })
  findAll(@Param('companyId') companyId: string) {
    return this.service.findAll(companyId);
  }

  @Get('depreciation-table')
  @ApiOperation({ summary: 'Tableau global des amortissements' })
  depreciationTable(@Param('companyId') companyId: string) {
    return this.service.getDepreciationTable(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d\'une immobilisation + plan d\'amortissement' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(companyId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Créer une immobilisation (génère le plan d\'amortissement)' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateFixedAssetDto,
  ) {
    return this.service.create(companyId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifier une immobilisation' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFixedAssetDto,
  ) {
    return this.service.update(companyId, id, dto);
  }

  @Post(':id/dispose')
  @ApiOperation({ summary: 'Céder ou mettre au rebut une immobilisation' })
  @HttpCode(HttpStatus.OK)
  dispose(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: DisposeAssetDto,
  ) {
    return this.service.dispose(companyId, id, dto);
  }

  @Post('post-depreciations/:fiscalYearId')
  @ApiOperation({ summary: 'Générer les écritures de dotation aux amortissements' })
  @HttpCode(HttpStatus.OK)
  postDepreciations(
    @Param('companyId') companyId: string,
    @Param('fiscalYearId') fiscalYearId: string,
    @GetUser('id') userId: string,
  ) {
    return this.service.postDepreciationsForFiscalYear(companyId, fiscalYearId, userId);
  }
}
