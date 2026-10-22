import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';
import { resolveInvoiceLayout, type InvoiceLayout } from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { auditShopEvent, SHOP_COLUMNS, toShop, type ShopRow } from '../common/shop-profile.js';
import { DATABASE, ENVIRONMENT } from '../database.module.js';

/**
 * The shop owner's view of their shop: the profile the super admin maintains (read only here),
 * the FBR invoicing switch, and the invoice layout.
 */
@Injectable()
export class ShopSettingsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async shop(user: AuthenticatedUser) {
    const [row] = await this.database<ShopRow[]>`
      select ${this.database.unsafe(SHOP_COLUMNS)} from branches where branches.id = ${user.branchId}
    `;
    if (!row) throw new NotFoundException('Shop not found');
    return toShop(row, this.environment);
  }

  async setFbrInvoicing(user: AuthenticatedUser, enabled: boolean) {
    return this.database.begin(async (transaction) => {
      const [row] = await transaction<ShopRow[]>`
        select ${transaction.unsafe(SHOP_COLUMNS)} from branches
        where branches.id = ${user.branchId} for update
      `;
      if (!row) throw new NotFoundException('Shop not found');
      const shop = toShop(row, this.environment);
      if (enabled && shop.fbr.registrationGaps.length > 0) {
        throw new ConflictException(
          `FBR invoicing needs the shop's FBR registration first. Ask the super admin to add: ${shop.fbr.registrationGaps.join(', ')}`,
        );
      }
      if (row.fbr_invoicing_enabled === enabled) return shop;
      await transaction`
        update branches set fbr_invoicing_enabled = ${enabled},
          fbr_invoicing_changed_at = now(), fbr_invoicing_changed_by = ${user.id}
        where id = ${user.branchId}
      `;
      await auditShopEvent(
        transaction,
        user,
        enabled ? 'SETTINGS.FBR_INVOICING_ENABLED' : 'SETTINGS.FBR_INVOICING_DISABLED',
        user.branchId,
        { enabled },
      );
      return {
        ...shop,
        fbr: { ...shop.fbr, invoicingEnabled: enabled, invoicingChangedAt: new Date() },
      };
    });
  }

  async invoiceLayout(user: AuthenticatedUser) {
    const [row] = await this.database<
      Array<{ invoice_layout: unknown; invoice_layout_updated_at: Date | null }>
    >`
      select invoice_layout, invoice_layout_updated_at from branches where id = ${user.branchId}
    `;
    if (!row) throw new NotFoundException('Shop not found');
    return {
      layout: resolveInvoiceLayout(row.invoice_layout),
      updatedAt: row.invoice_layout_updated_at,
    };
  }

  async updateInvoiceLayout(user: AuthenticatedUser, layout: InvoiceLayout) {
    return this.database.begin(async (transaction) => {
      const [row] = await transaction<Array<{ invoice_layout_updated_at: Date }>>`
        update branches set invoice_layout = ${transaction.json({ ...layout })},
          invoice_layout_updated_at = now(), invoice_layout_updated_by = ${user.id}
        where id = ${user.branchId}
        returning invoice_layout_updated_at
      `;
      if (!row) throw new NotFoundException('Shop not found');
      await auditShopEvent(transaction, user, 'SETTINGS.INVOICE_LAYOUT_UPDATED', user.branchId, {
        paperWidth: layout.paperWidth,
        copies: layout.copies,
      });
      return { layout, updatedAt: row.invoice_layout_updated_at };
    });
  }
}
