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

function receiptBytes(receipt: SaleReceipt, kickDrawer: boolean): Uint8Array {
  const bytes: number[] = [0x1b, 0x40, 0x1b, 0x61, 0x01];
  bytes.push(...text(`${receipt.sale.branch_name}\n${receipt.sale.invoice_number}\n`));
  bytes.push(0x1b, 0x61, 0x00);
  bytes.push(...text(`${new Date(receipt.sale.created_at).toLocaleString('en-PK')}\n`));
  bytes.push(...text('--------------------------------\n'));
  for (const item of receipt.items) {
    bytes.push(...text(`${item.name} ${item.strength ?? ''}\n`));
    bytes.push(...text(`${item.quantity} x ${item.unit_price}  ${item.line_total}\n`));
  }
  bytes.push(...text('--------------------------------\n'));
  bytes.push(...text(`TOTAL PKR ${receipt.sale.total}\n`));
  for (const payment of receipt.payments) {
    bytes.push(...text(`${payment.method} ${payment.amount}\n`));
    if (payment.change_amount && payment.change_amount !== '0.00') {
      bytes.push(...text(`CHANGE ${payment.change_amount}\n`));
    }
  }
  bytes.push(...text('\nReturn token\n'));
  bytes.push(...qrCommand(0x41, [0x32, 0x00]));
  bytes.push(...qrCommand(0x43, [0x06]));
  bytes.push(...qrCommand(0x45, [0x31]));
  const token = [...encoder.encode(receipt.returnQrPayload)];
  bytes.push(...qrCommand(0x50, [0x30, ...token]));
  bytes.push(...qrCommand(0x51, [0x30]));
  bytes.push(...text(`\n${receipt.returnQrPayload}\n\n`));
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
    await writer.write(receiptBytes(receipt, options.kickDrawer));
  } finally {
    writer.releaseLock();
    await port.close();
  }
}
