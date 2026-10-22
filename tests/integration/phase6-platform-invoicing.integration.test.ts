import { parseEnvironment } from '@pharmacy/config';
import {
  createDraftSchema,
  createUserSchema,
  DEFAULT_INVOICE_LAYOUT,
  finalizeSaleSchema,
  type FiscalGatewayResult,
  type FiscalInvoiceGateway,
} from '@pharmacy/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ShopSettingsService } from '../../apps/api/src/administration/shop-settings.service.js';
import { UsersService } from '../../apps/api/src/administration/users.service.js';
import type { AuthenticatedUser } from '../../apps/api/src/auth/auth.types.js';
import { PlatformService } from '../../apps/api/src/platform/platform.service.js';
import { PosService } from '../../apps/api/src/pos/pos.service.js';
import { WorkerHeartbeat } from '../../apps/worker/src/heartbeat.js';
import { DurableWorker } from '../../apps/worker/src/worker.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './harness/database.js';

function check(name: string, ok: boolean, detail = ''): void {
  expect({ check: name, ok, detail: ok ? '' : detail }).toEqual({
    check: name,
    ok: true,
    detail: '',
  });
}
async function rejects(promise: Promise<unknown>, pattern: RegExp): Promise<string> {
  try {
    await promise;
    return 'did not reject';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return pattern.test(message) ? 'ok' : message;
  }
}

describe('Phase 6 super admin, shop FBR switch, and invoicing', () => {
  let database: IsolatedDatabase;

  beforeAll(async () => {
    database = await createIsolatedDatabase('phase6_platform_invoicing');
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('controls FBR per shop, protects the software owner, and prints what the shop chose', async () => {
    const db = database.admin;
    const environment = parseEnvironment({
      AI_ENABLED: 'false',
      DATABASE_URL: database.applicationUrl,
      FBR_API_TOKEN: 'phase6-not-transmitted-test-token',
      FBR_MODE: 'SANDBOX',
      NODE_ENV: 'test',
      SESSION_SECRET: 'phase6-platform-session-secret-at-least-32-bytes',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      WORKER_HEALTH_FILE: 'phase6-test-worker-health.json',
      WORKER_ID: 'phase6-integration-worker',
    });
    const app = database.application;

    // Fixtures: one shop, terminal, owner, super admin, a stocked medicine, an open till.
    const [branch] = await db<Array<{ id: string }>>`
    insert into branches (code, name) values ('MAIN', 'Verify Pharmacy') returning id::text`;
    const branchId = branch!.id;
    await db`insert into operational_intelligence_policies (branch_id) values (${branchId})`;
    const [terminal] = await db<Array<{ id: string }>>`
    insert into terminals (branch_id, code, name, terminal_type)
    values (${branchId}, 'C1', 'Counter 1', 'SALES_COUNTER') returning id::text`;
    await db`insert into roles (code, name) values ('OWNER', 'Owner'), ('CASHIER', 'Cashier')`;
    const makeUser = async (username: string, role: string) => {
      const [row] = await db<Array<{ id: string }>>`
      insert into users (username, display_name, password_hash)
      values (${username}, ${username}, 'unused') returning id::text`;
      await db`
      insert into user_branch_roles (user_id, branch_id, role_id)
      select ${row!.id}, ${branchId}, id from roles where code = ${role}`;
      return row!.id;
    };
    const ownerId = await makeUser('owner1', 'OWNER');
    const superId = await makeUser('software', 'SUPER_ADMIN');
    const session = (id: string, platform: boolean): AuthenticatedUser => ({
      id,
      branchId,
      terminalId: terminal!.id,
      username: id,
      displayName: id,
      permissions: platform ? ['platform.super_admin'] : ['settings.manage_users'],
      sessionId: '0',
    });
    const owner = session(ownerId, false);
    const superAdmin = session(superId, true);
    const [medicine] = await db<Array<{ id: string }>>`
    insert into medicines (name, strength, pack_size, unit_name)
    values ('Panadol', '500mg', 10, 'tablet') returning id::text`;
    await db.begin(async (transaction) => {
      const [batch] = await transaction<Array<{ id: string }>>`
      insert into inventory_batches (branch_id, medicine_id, batch_number, expiry_date,
        cost_price, sale_price, current_qty, status)
      values (${branchId}, ${medicine!.id}, 'B1', current_date + 400, 10, 15, 500, 'SELLABLE')
      returning id::text`;
      await transaction`
      insert into stock_movements (branch_id, inventory_batch_id, movement_type, quantity_delta,
        quantity_after, reason)
      values (${branchId}, ${batch!.id}, 'ADJUSTMENT_IN', 500, 500, 'fixture')`;
    });
    const [till] = await db<Array<{ id: string }>>`
    insert into cash_sessions (branch_id, terminal_id, cashier_user_id, opening_float)
    values (${branchId}, ${terminal!.id}, ${ownerId}, 1000) returning id::text`;

    const pos = new PosService(app, environment);
    const shopSettings = new ShopSettingsService(app, environment);
    const platform = new PlatformService(app, environment);
    const users = new UsersService(app);
    const gatewayCalls: string[] = [];
    const gateway: FiscalInvoiceGateway = {
      validateInvoice: () => Promise.reject(new Error('unused')),
      getReferenceData: () => Promise.reject(new Error('unused')),
      submitInvoice: (invoice) => {
        gatewayCalls.push(invoice.sellerNTNCNIC ?? '');
        const result: FiscalGatewayResult = {
          ok: true,
          httpStatus: 200,
          response: { invoiceNumber: `FBR-${String(gatewayCalls.length)}` },
          errorCode: null,
          errorMessage: null,
          retryable: false,
          ambiguousSubmission: false,
          invoiceNumber: `FBR-${String(gatewayCalls.length)}`,
          durationMs: 5,
          correlationId: 'verify',
        };
        return Promise.resolve(result);
      },
    };
    const worker = new DurableWorker(app, environment, new WorkerHeartbeat(''), gateway);
    const drain = async (): Promise<void> => {
      while (await worker.processNext()) {
        // Run every queued job.
      }
    };
    const sell = async (quantity: string, dosage?: string) => {
      const draft = (await pos.createDraft(
        owner,
        createDraftSchema.parse({
          terminalId: terminal!.id,
          items: [
            {
              medicineId: medicine!.id,
              quantity,
              ...(dosage ? { dosageInstruction: dosage } : {}),
            },
          ],
        }),
      )) as { id: string };
      const reserved = (await pos.reserveDraft(owner, BigInt(draft.id))) as { total: string };
      const sale = (await pos.finalizeSale(
        owner,
        finalizeSaleSchema.parse({
          draftId: draft.id,
          cashSessionId: till!.id,
          clientRequestId: `verify-${draft.id}-${String(Date.now())}`,
          payments: [{ method: 'CASH', amount: reserved.total, tenderedAmount: reserved.total }],
        }),
      )) as { id: string };
      return sale.id;
    };
    type Receipt = {
      shop: { name: string; sellerNtnCnic: string | null; address: string | null };
      layout: { paperWidth: string };
      fbr: {
        enabled: boolean;
        status: string;
        invoiceNumber: string | null;
        qrPayload: string | null;
      };
      items: Array<{ dosage_instruction: string | null; expiry_date: string }>;
    };
    const receipt = async (saleId: string) =>
      (await pos.getReceipt(owner, BigInt(saleId))) as unknown as Receipt;

    // 1. FBR cannot be switched on before the super admin completes the registration.
    check(
      'owner cannot enable FBR without registration',
      (await rejects(shopSettings.setFbrInvoicing(owner, true), /registration first/)) === 'ok',
    );
    await platform.updateShop(superAdmin, BigInt(branchId), {
      address: 'Main Boulevard, Lahore',
      phone: '042-1111111',
      drugLicenseNumber: 'DSL-42',
      sellerNtnCnic: '1234567',
      posRegistrationNumber: '654321',
      businessName: 'Verify Pharmacy (Pvt) Ltd',
      province: 'Punjab',
    });
    const enabled = await shopSettings.setFbrInvoicing(owner, true);
    check('owner enables FBR after registration', enabled.fbr.invoicingEnabled);

    // 2. The software owner is hidden from, and untouchable by, the shop owner.
    const ownerList = (await users.list(owner)).data.map((row) => row.username);
    check(
      'owner does not see the super admin',
      !ownerList.includes('software'),
      ownerList.join(','),
    );
    check(
      'owner cannot reset the super admin password',
      (await rejects(users.resetPassword(owner, BigInt(superId), 'abcdef'), /not found/i)) === 'ok',
    );
    check(
      'owner cannot grant SUPER_ADMIN',
      (await rejects(
        users.create(
          owner,
          createUserSchema.parse({
            username: 'sneaky',
            displayName: 'Sneaky',
            password: 'abcdef',
            roles: ['SUPER_ADMIN'],
          }),
        ),
        /Only the super admin/,
      )) === 'ok',
    );
    const superList = (await users.list(superAdmin)).data.map((row) => row.username);
    check(
      'super admin sees everyone',
      superList.includes('software') && superList.includes('owner1'),
    );

    // 3. FBR on but live sending not approved: recorded, never sent, prints as pending.
    const sale1 = await sell('10', 'h0h a');
    const before = await receipt(sale1);
    check(
      'receipt carries shop profile',
      before.shop.sellerNtnCnic === '1234567' && before.shop.address === 'Main Boulevard, Lahore',
    );
    check(
      'receipt FBR block enabled and pending',
      before.fbr.enabled && before.fbr.status === 'PENDING',
    );
    check('receipt keeps the dosage', before.items[0]?.dosage_instruction === '½+0+½ after meal');
    check(
      'expiry is printable text',
      /^\d{4}-\d{2}-\d{2}$/.test(before.items[0]?.expiry_date ?? ''),
    );
    await drain();
    const blocked = await receipt(sale1);
    check(
      'unapproved shop is never sent to FBR',
      gatewayCalls.length === 0 && blocked.fbr.status === 'FAILED_NEEDS_REVIEW',
      blocked.fbr.status,
    );

    // 4. Super admin approves live sending: the FBR number and QR come back onto the invoice.
    check(
      'approval needs a reason-bearing call',
      (await platform.setFbrTransmission(superAdmin, BigInt(branchId), true, 'verified')).fbr
        .transmissionApproved,
    );
    const sale2 = await sell('6', '111');
    await drain();
    const sent = await receipt(sale2);
    check('approved shop sends to FBR', gatewayCalls.length === 1 && gatewayCalls[0] === '1234567');
    check(
      'FBR number and QR on the receipt',
      sent.fbr.status === 'SUBMITTED' &&
        sent.fbr.invoiceNumber === 'FBR-1' &&
        sent.fbr.qrPayload === 'FBR-1',
      JSON.stringify(sent.fbr),
    );
    await drain();
    check('a submitted invoice is never sent twice', gatewayCalls.length === 1);

    // 5. Owner switches FBR off: no FBR block or QR, and new sales are not fiscalized.
    await shopSettings.setFbrInvoicing(owner, false);
    const offReceipt = await receipt(sale2);
    check('FBR off hides the FBR block', !offReceipt.fbr.enabled);
    const sale3 = await sell('2');
    const notRequired = await receipt(sale3);
    check(
      'sales while FBR is off are not fiscalized',
      notRequired.fbr.status === 'NOT_REQUIRED' && !notRequired.fbr.enabled,
    );
    await drain();
    check('nothing is sent while FBR is off', gatewayCalls.length === 1);

    // 6. Invoice layout saved by the owner reaches the receipt.
    await shopSettings.updateInvoiceLayout(owner, {
      ...DEFAULT_INVOICE_LAYOUT,
      paperWidth: '58mm',
      copies: 2,
    });
    const layout = (await shopSettings.invoiceLayout(owner)).layout;
    check('layout saved', layout.paperWidth === '58mm' && layout.copies === 2);
    check('receipt uses the saved layout', (await receipt(sale3)).layout.paperWidth === '58mm');
    await db`update branches set invoice_layout = '{"paperWidth":"A5","copies":2}' where id = ${branchId}`;
    check(
      'a damaged layout still prints with defaults',
      (await receipt(sale3)).layout.paperWidth === '80mm',
    );

    // 7. Platform: shops, users and audit across shops.
    const shop2 = await platform.createShop(superAdmin, { code: 'SHOP-2', name: 'Second Shop' });
    const created = await platform.createUser(superAdmin, {
      branchId: BigInt(shop2.id),
      username: 'owner2',
      displayName: 'Second owner',
      password: 'abc123',
      roles: ['OWNER'],
    });
    const allShops = (await platform.shops()).data;
    check(
      'super admin creates shops and owners',
      allShops.length === 2 && created.roles[0] === 'OWNER',
    );
    check(
      'a new shop has its policies and admin terminal',
      (await db`select 1 from operational_intelligence_policies where branch_id = ${shop2.id}`)
        .length === 1 &&
        (await db`select 1 from terminals where branch_id = ${shop2.id}`).length === 1,
    );
    check(
      'super admin cannot deactivate the shop it is signed in to',
      (await rejects(platform.setShopActive(superAdmin, BigInt(branchId), false), /signed in/)) ===
        'ok',
    );
    const audit = (await platform.audit(null, 50)).data.map((row) => String(row.eventType));
    check(
      'every control is audited',
      [
        'SETTINGS.FBR_INVOICING_ENABLED',
        'PLATFORM.SHOP_UPDATED',
        'PLATFORM.FBR_TRANSMISSION_APPROVED',
        'SETTINGS.INVOICE_LAYOUT_UPDATED',
        'PLATFORM.SHOP_CREATED',
        'PLATFORM.USER_CREATED',
      ].every((event) => audit.includes(event)),
      audit.join(','),
    );
  });
});
