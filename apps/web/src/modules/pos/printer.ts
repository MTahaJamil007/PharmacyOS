import type { SaleReceipt } from '@pharmacy/shared';

interface SerialWriter {
  releaseLock(): void;
  write(data: Uint8Array): Promise<void>;
}

interface SerialPort {
  readonly writable: { getWriter(): SerialWriter } | null;
  close(): Promise<void>;
  open(options: { baudRate: number }): Promise<void>;
}

interface SerialNavigator {
  requestPort(): Promise<SerialPort>;
}

const encoder = new TextEncoder();

function text(value: string): number[] {
  return [...encoder.encode(value.replace(/[^\x20-\x7e\n]/g, '?'))];
}

function qrCommand(functionNumber: number, data: readonly number[]): number[] {
  const payloadLength = data.length + 2;
  return [
    0x1d,
    0x28,
    0x6b,
    payloadLength & 0xff,
    (payloadLength >> 8) & 0xff,
    0x31,
    functionNumber,
    ...data,
  ];
}

const WIDTH = 32;

function columns(left: string, right: string): string {
  const space = WIDTH - right.length;
  const clipped = left.length > space - 1 ? `${left.slice(0, space - 2)}.` : left;
  return `${clipped.padEnd(space)}${right}\n`;
}

function nonZero(value: string | null | undefined): boolean {
  return Boolean(value && /[1-9]/.test(value));
}

export function buildEscPosReceipt(receipt: SaleReceipt, kickDrawer: boolean): Uint8Array {
  const { sale } = receipt;
  const bytes: number[] = [0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01];
  bytes.push(...text(`${sale.branch_name}\n`));
  bytes.push(0x1b, 0x45, 0x00);
  if (sale.branch_address) bytes.push(...text(`${sale.branch_address}\n`));
  if (sale.branch_phone) bytes.push(...text(`Tel ${sale.branch_phone}\n`));
  if (sale.seller_ntn_cnic) bytes.push(...text(`NTN ${sale.seller_ntn_cnic}\n`));
  if (sale.seller_strn) bytes.push(...text(`STRN ${sale.seller_strn}\n`));
  bytes.push(0x1b, 0x61, 0x00);
  bytes.push(...text('-'.repeat(WIDTH) + '\n'));
  bytes.push(...text(`Invoice ${sale.invoice_number}\n`));
  bytes.push(...text(`${new Date(sale.created_at).toLocaleString('en-GB')}\n`));
  bytes.push(...text(`Cashier ${sale.cashier_name}\n`));
  if (sale.customer_name) bytes.push(...text(`Customer ${sale.customer_name}\n`));
  bytes.push(...text('-'.repeat(WIDTH) + '\n'));
  for (const item of receipt.items) {
    bytes.push(...text(`${item.name} ${item.strength ?? ''}`.trim().slice(0, WIDTH) + '\n'));
    const quantity = item.quantity.replace(/\.?0+$/, '');
    bytes.push(...text(columns(`  ${quantity} x ${item.unit_price}`, item.line_total)));
    if (nonZero(item.discount_amount)) bytes.push(...text(`  less ${item.discount_amount}\n`));
  }
  bytes.push(...text('-'.repeat(WIDTH) + '\n'));
  bytes.push(...text(columns('Subtotal', sale.subtotal)));
  if (nonZero(sale.discount_total))
    bytes.push(...text(columns('Discount', `-${sale.discount_total}`)));
  bytes.push(0x1b, 0x45, 0x01);
  bytes.push(...text(columns('TOTAL Rs', sale.total)));
  bytes.push(0x1b, 0x45, 0x00);
  if (nonZero(sale.tax_total)) bytes.push(...text(columns('Sales tax included', sale.tax_total)));
  for (const payment of receipt.payments) {
    bytes.push(...text(columns(payment.method, payment.amount)));
    if (payment.change_amount && nonZero(payment.change_amount)) {
      bytes.push(...text(columns('Change', payment.change_amount)));
    }
  }
  bytes.push(0x1b, 0x61, 0x01);
  bytes.push(...text('\nKeep this receipt for returns\n'));
  bytes.push(...qrCommand(0x41, [0x32, 0x00]));
  bytes.push(...qrCommand(0x43, [0x06]));
  bytes.push(...qrCommand(0x45, [0x31]));
  const token = [...encoder.encode(receipt.returnQrPayload)];
  bytes.push(...qrCommand(0x50, [0x30, ...token]));
  bytes.push(...qrCommand(0x51, [0x30]));
  bytes.push(...text(`\n${receipt.returnQrPayload}\n`));
  if (sale.fiscal_invoice_number) bytes.push(...text(`FBR ${sale.fiscal_invoice_number}\n`));
  bytes.push(...text('Thank you\n\n\n'));
  bytes.push(0x1b, 0x61, 0x00);
  if (kickDrawer) bytes.push(0x1b, 0x70, 0x00, 0x19, 0xfa);
  bytes.push(0x1d, 0x56, 0x00);
  return Uint8Array.from(bytes);
}

export async function printEscPosReceipt(
  receipt: SaleReceipt,
  options: { readonly kickDrawer: boolean },
): Promise<void> {
  const serial = (navigator as Navigator & { readonly serial?: SerialNavigator }).serial;
  if (!serial) throw new Error('Direct receipt printing is not supported in this browser');
  const port = await serial.requestPort();
  await port.open({ baudRate: 9_600 });
  const writer = port.writable?.getWriter();
  if (!writer) {
    await port.close();
    throw new Error('The selected printer is not writable');
  }
  try {
    await writer.write(buildEscPosReceipt(receipt, options.kickDrawer));
  } finally {
    writer.releaseLock();
    await port.close();
  }
}
