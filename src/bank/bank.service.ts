import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateBankAccountDto {
  name: string;
  bank_name: string;
  iban?: string;
  bic?: string;
  account_number?: string;
  currency?: string;
}

export interface ImportTransactionDto {
  transaction_date: string;
  value_date?: string;
  description: string;
  amount: number;
  import_batch?: string;
}

@Injectable()
export class BankService {
  constructor(private prisma: PrismaService) {}

  // ── Comptes bancaires ─────────────────────────────────────
  async getAccounts(companyId: string) {
    return this.prisma.bankAccount.findMany({
      where: { company_id: companyId, is_active: true },
      include: {
        _count: { select: { transactions: true } },
      },
    });
  }

  async createAccount(companyId: string, dto: CreateBankAccountDto) {
    return this.prisma.bankAccount.create({
      data: { company_id: companyId, ...dto, currency: (dto.currency ?? 'EUR') as any },
    });
  }

  // ── Transactions ──────────────────────────────────────────
  async getTransactions(bankAccountId: string, companyId: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, company_id: companyId },
    });
    if (!account) throw new NotFoundException('Compte bancaire introuvable');

    return this.prisma.bankTransaction.findMany({
      where: { bank_account_id: bankAccountId },
      include: { journal_line: { include: { entry: { select: { libelle: true, entry_date: true } } } } },
      orderBy: { transaction_date: 'desc' },
    });
  }

  // ── Import relevé bancaire ────────────────────────────────
  async importTransactions(
    bankAccountId: string,
    companyId: string,
    transactions: ImportTransactionDto[],
  ) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, company_id: companyId },
    });
    if (!account) throw new NotFoundException('Compte bancaire introuvable');

    const batchId = `IMPORT-${Date.now()}`;
    const created = await this.prisma.bankTransaction.createMany({
      data: transactions.map(t => ({
        bank_account_id:  bankAccountId,
        company_id:       companyId,
        transaction_date: new Date(t.transaction_date),
        value_date:       t.value_date ? new Date(t.value_date) : null,
        description:      t.description,
        amount:           t.amount,
        import_batch:     batchId,
      })),
    });

    // Mettre à jour le solde du compte
    const balance = transactions.reduce((s, t) => s + t.amount, 0);
    await this.prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: { current_balance: { increment: balance } },
    });

    return { imported: created.count, batch_id: batchId };
  }

  // ── Rapprochement bancaire ────────────────────────────────
  async reconcile(
    companyId: string,
    bankTransactionId: string,
    journalLineId: string,
  ) {
    const [tx, line] = await Promise.all([
      this.prisma.bankTransaction.findFirst({
        where: { id: bankTransactionId, company_id: companyId },
      }),
      this.prisma.journalLine.findFirst({
        where: { id: journalLineId, company_id: companyId },
      }),
    ]);
    if (!tx)   throw new NotFoundException('Transaction bancaire introuvable');
    if (!line) throw new NotFoundException('Ligne comptable introuvable');

    // Vérification cohérence montants (tolérance 0.01)
    const txAmt   = Math.abs(Number(tx.amount));
    const lineAmt = Math.abs(Number(line.debit) - Number(line.credit));
    if (Math.abs(txAmt - lineAmt) > 0.01) {
      throw new BadRequestException(
        `Montants incompatibles : transaction ${txAmt} ≠ ligne comptable ${lineAmt}`,
      );
    }

    return this.prisma.bankTransaction.update({
      where: { id: bankTransactionId },
      data: { is_reconciled: true, journal_line_id: journalLineId },
    });
  }

  // ── Transactions non rapprochées ──────────────────────────
  async getUnreconciled(bankAccountId: string, companyId: string) {
    return this.prisma.bankTransaction.findMany({
      where: { bank_account_id: bankAccountId, company_id: companyId, is_reconciled: false },
      orderBy: { transaction_date: 'desc' },
    });
  }
}
