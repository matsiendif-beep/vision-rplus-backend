import {
  Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SyncService, SyncPushDto } from './sync.service';
import { JwtAuthGuard }       from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard } from '../common/guards/company-access.guard';
import { GetUser }            from '../common/decorators';

@ApiTags('Synchronisation offline (mobile)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
@Controller('companies/:companyId/sync')
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Post('push')
  @ApiOperation({ summary: 'Envoyer les opérations créées offline (mobile → serveur)' })
  @HttpCode(HttpStatus.OK)
  push(
    @Param('companyId') companyId: string,
    @GetUser('id') userId: string,
    @Body() dto: SyncPushDto,
  ) {
    return this.service.push(companyId, userId, dto);
  }

  @Get('pull')
  @ApiOperation({ summary: 'Récupérer les données modifiées depuis la dernière sync' })
  pull(
    @Param('companyId') companyId: string,
    @Query('last_sync_at') lastSyncAt?: string,
  ) {
    return this.service.pull(companyId, lastSyncAt);
  }
}
