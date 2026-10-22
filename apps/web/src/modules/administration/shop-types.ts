import type { InvoiceShop } from '@pharmacy/shared';

/** A shop as the API describes it (see apps/api/src/common/shop-profile.ts). */
export interface ShopRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly drugLicenseNumber: string | null;
  readonly isActive: boolean;
  readonly sellerNtnCnic: string | null;
  readonly sellerStrn: string | null;
  readonly posRegistrationNumber: string | null;
  readonly businessName: string | null;
  readonly province: string | null;
  readonly scenarioId: string | null;
  readonly fbr: {
    readonly invoicingEnabled: boolean;
    readonly invoicingChangedAt: string | null;
    readonly transmissionApproved: boolean;
    readonly transmissionApprovedAt: string | null;
    readonly serverMode: string;
    readonly serverTokenConfigured: boolean;
    readonly registrationGaps: readonly string[];
  };
  readonly users?: number;
  readonly terminals?: number;
  readonly salesToday?: number;
}

export function invoiceShop(shop: ShopRecord): InvoiceShop {
  return {
    name: shop.name,
    address: shop.address,
    phone: shop.phone,
    email: shop.email,
    drugLicenseNumber: shop.drugLicenseNumber,
    sellerNtnCnic: shop.sellerNtnCnic,
    sellerStrn: shop.sellerStrn,
    businessName: shop.businessName,
  };
}

/** Plain-language FBR readiness, the same for the shop owner and the super admin. */
export function fbrReadiness(shop: ShopRecord): readonly string[] {
  const notes: string[] = [];
  if (shop.fbr.registrationGaps.length > 0) {
    notes.push(`FBR registration incomplete: ${shop.fbr.registrationGaps.join(', ')}.`);
  }
  if (shop.fbr.serverMode === 'DISABLED') {
    notes.push('The server has no FBR connection configured (FBR_MODE is DISABLED).');
  } else if (!shop.fbr.serverTokenConfigured) {
    notes.push('The server has no FBR API token.');
  }
  if (!shop.fbr.transmissionApproved) {
    notes.push(
      'Live sending to FBR is not approved yet, so invoices stay "pending" and print without an FBR number or QR.',
    );
  }
  return notes;
}
