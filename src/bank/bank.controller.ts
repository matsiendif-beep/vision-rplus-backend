import {
  Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BankService, CreateBankAccountDto, ImportTransactionDto } from './bank.service';
import { JwtAuthGuard }       from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard } from '../common/guards/company-access.guard';

@ApiTags('Banque & Rapprochement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
@Controller('companies/:companyId/bank')
export class BankController {
  constructor(private readonly service: BankService) {}

  @Get('accounts')
  @ApiOperation({ summary: 'Lister les comptes bancaires' })
  getAccounts(@Param('companyId') companyId: string) {
    return this.service.getAccounts(companyId);
  }

  @Post('accounts')
  @ApiOperation({ summary: 'Créer un compte bancaire' })
  createAccount(
    @Param('companyId') companyId: string,
    @Body() dto: CreateBankAccountDto,
  ) {
    return this.service.createAccount(companyId, dto);
  }

  @Get('accounts/:accountId/transactions')
  @ApiOperation({ summary: 'Transactions d\'un compte' })
  getTransactions(
    @Param('companyId') companyId: string,
    @Param('accountId') accountId: string,
  ) {
    return this.service.getTransactions(accountId, companyId);
  }

  @Post('accounts/:accountId/import')
  @ApiOperation({ summary: 'Importer un relevé bancaire (CSV/JSON)' })
  @HttpCode(HttpStatus.OK)
  importTransactions(
    @Param('companyId') companyId: string,
    @Param('accountId') accountId: string,
    @Body() body: { transactions: ImportTransactionDto[] },
  ) {
    return this.service.importTransactions(accountId, companyId, body.transactions);
  }

  @Get('accounts/:accountId/unreconciled')
  @ApiOperation({ summary: 'Transactions non rapprochées' })
  getUnreconciled(
    @Param('companyId') companyId: string,
    @Param('accountId') accountId: string,
  ) {
    return this.service.getUnreconciled(accountId, companyId);
  }

  @Post('reconcile')
  @ApiOperation({ summary: 'Rapprocher une transaction bancaire avec une ligne comptable' })
  @HttpCode(HttpStatus.OK)
  reconcile(
    @Param('companyId') companyId: string,
    @Body() body: { bank_transaction_id: string; journal_line_id: string },
  ) {
    return this.service.reconcile(companyId, body.bank_transaction_id, body.journal_line_id);
  }
}
