import type { Environment } from '@pharmacy/config';
import type { DatabaseTransaction } from '@pharmacy/database';
import { fbrRegistrationGaps } from '@pharmacy/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';

/** Branch columns that make up a shop profile and its FBR state. */
export const SHOP_COLUMNS = `
  branches.id::text as id, branches.code, branches.name, branches.address, branches.phone,
  branches.email, branches.drug_license_number, branches.is_active,
  branches.seller_ntn_cnic, branches.seller_strn, branches.fbr_pos_registration_number,
  branches.fbr_business_name, branches.fbr_province, branches.fbr_scenario_id,
  branches.fbr_invoicing_enabled, branches.fbr_invoicing_changed_at,
  branches.fbr_transmission_approved, branches.fbr_transmission_approved_at
`;

export interface ShopRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly drug_license_number: string | null;
  readonly is_active: boolean;
  readonly seller_ntn_cnic: string | null;
  readonly seller_strn: string | null;
  readonly fbr_pos_registration_number: string | null;
  readonly fbr_business_name: string | null;
  readonly fbr_province: string | null;
  readonly fbr_scenario_id: string | null;
  readonly fbr_invoicing_enabled: boolean;
  readonly fbr_invoicing_changed_at: Date | null;
  readonly fbr_transmission_approved: boolean;
  readonly fbr_transmission_approved_at: Date | null;
}

export function toShop(row: ShopRow, environment: Environment) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    drugLicenseNumber: row.drug_license_number,
    isActive: row.is_active,
    sellerNtnCnic: row.seller_ntn_cnic,
    sellerStrn: row.seller_strn,
    posRegistrationNumber: row.fbr_pos_registration_number,
    businessName: row.fbr_business_name,
    province: row.fbr_province,
    scenarioId: row.fbr_scenario_id,
    fbr: {
      invoicingEnabled: row.fbr_invoicing_enabled,
      invoicingChangedAt: row.fbr_invoicing_changed_at,
      transmissionApproved: row.fbr_transmission_approved,
      transmissionApprovedAt: row.fbr_transmission_approved_at,
      serverMode: environment.FBR_MODE,
      serverTokenConfigured: Boolean(environment.FBR_API_TOKEN),
      registrationGaps: fbrRegistrationGaps({
        sellerNtnCnic: row.seller_ntn_cnic,
        posRegistrationNumber: row.fbr_pos_registration_number,
        businessName: row.fbr_business_name,
        province: row.fbr_province,
        address: row.address,
      }),
    },
  };
}

export type AuditMetadata = Readonly<
  Record<string, string | number | boolean | null | readonly string[] | undefined>
>;

export async function auditShopEvent(
  transaction: DatabaseTransaction,
  actor: AuthenticatedUser,
  eventType: string,
  branchId: string,
  metadata: AuditMetadata,
): Promise<void> {
  await transaction`
    insert into audit_events (
      branch_id, user_id, terminal_id, event_type, entity_type, entity_id, metadata
    ) values (
      ${branchId}, ${actor.id}, ${actor.terminalId}, ${eventType}, 'branch', ${branchId},
      ${transaction.json(metadata)}
    )
  `;
}
