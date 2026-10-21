import {
  BadRequestException,
  Catch,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ArgumentsHost, HttpException } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';

interface PostgreSqlError extends Error {
  readonly code: string;
  readonly constraint_name?: string;
  readonly where?: string;
}

function isPostgreSqlError(error: unknown): error is PostgreSqlError {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}

/**
 * Constraint violations that a person at the counter can act on. Anything not listed here
 * keeps the generic message so internal names and values are never echoed to a client.
 */
const CONSTRAINT_MESSAGES: Readonly<Record<string, string>> = {
  branches_fbr_scenario_id_format: 'The sandbox scenario must look like SN001',
  branches_seller_ntn_cnic_format: 'The NTN must be 7 digits, or the CNIC 13 digits',
  customer_ledger_entries_balance_after_check: 'A customer balance cannot go below zero',
  customers_branch_phone_idx: 'Another customer already uses this phone number',
  inventory_batch_sale_price_mrp_check: 'The sale price cannot exceed the maximum retail price',
  inventory_batches_current_qty_check: 'Stock for a batch cannot go below zero',
  medicine_barcodes_barcode_key: 'Another medicine already uses this barcode',
  medicines_active_sku_uidx: 'Another medicine already uses this SKU',
  medicines_hs_code_format: 'The HS code must look like 3004.9099',
  shelves_branch_id_code_key: 'A shelf with this code already exists',
  suppliers_active_code_uidx: 'A supplier with this code already exists',
  terminals_branch_id_code_key: 'A terminal with this code already exists',
  users_active_username_uidx: 'That username is already taken',
};

export function mapDatabaseException(error: unknown): HttpException | undefined {
  if (!isPostgreSqlError(error)) return undefined;
  const known = error.constraint_name ? CONSTRAINT_MESSAGES[error.constraint_name] : undefined;

  if (error.code === '23505') {
    return new ConflictException(known ?? 'A record with the same unique key already exists');
  }
  if (error.code === '23503') {
    return new ConflictException('A related record is missing or still in use');
  }
  if (error.code === '23514' && !known && error.where?.includes('PL/pgSQL function')) {
    // Raised by PharmacyOS integrity triggers, whose messages are written for operators.
    return new ConflictException(error.message.charAt(0).toUpperCase() + error.message.slice(1));
  }
  if (['23514', '23502', '22001', '22P02'].includes(error.code)) {
    return new BadRequestException(known ?? 'Request violates a database constraint');
  }
  if (error.code === '22003') {
    return new BadRequestException('Numeric value is outside the allowed range');
  }
  if (error.code === '40001' || error.code === '40P01') {
    return new ConflictException('Transaction conflicted; retry with the same client request ID');
  }
  if (error.code === '57014') {
    return new ServiceUnavailableException('Database operation timed out');
  }
  return undefined;
}

@Catch()
@Injectable()
export class DatabaseExceptionFilter extends BaseExceptionFilter {
  constructor(@Inject(HttpAdapterHost) adapterHost: HttpAdapterHost) {
    super(adapterHost.httpAdapter);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(mapDatabaseException(exception) ?? exception, host);
  }
}
