import { minorUnitsToMoney, moneyToMinorUnits } from '@pharmacy/shared';

import type { InvoiceModel } from './invoice-model';

/**
 * ESC/POS is the command language almost every receipt printer understands (Epson, Xprinter,
 * Bixolon, Rongta, Sewoo, BlackCopper…), whichever way it is connected. Thermal printers are
 * ASCII-only here, so Urdu and fraction glyphs are written out in Latin characters.
 */
const ESC = 0x1b;
const GS = 0x1d;

const encoder = new TextEncoder();

export function columnsFor(model: InvoiceModel): number {
  const small = model.layout.fontScale === 'SMALL';
  if (model.layout.paperWidth === '58mm') return small ? 42 : 32;
  return small ? 64 : 48;
}

/** Thermal printers here are ASCII-only, so "1½+0+½" prints as "1-1/2+0+1/2". */
export function asciiDosage(value: string): string {
  return value.replace(/(\d?)([¼½¾])/g, (_match, whole: string, glyph: string) => {
    const fraction = glyph === '¼' ? '1/4' : glyph === '½' ? '1/2' : '3/4';
    return whole ? `${whole}-${fraction}` : fraction;
  });
}

function ascii(value: string): string {
  return asciiDosage(value)
    .replace(/[–—]/g, '-')
    .replace(/[·•]/g, '-')
    .replace(/[^\x20-\x7e\n]/g, '?');
}

function money(value: string): string {
  const normalized = minorUnitsToMoney(moneyToMinorUnits(value));
  const [whole = '0', fraction = '00'] = normalized.replace('-', '').split('.');
  return `${normalized.startsWith('-') ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

function wrap(text: string, width: number): string[] {
  const words = ascii(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      if (current) lines.push(current);
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      current = '';
    } else if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function twoColumns(left: string, right: string, width: number): string {
  const leftText = ascii(left);
  const rightText = ascii(right);
  const room = width - rightText.length - 1;
  if (room < 4) return `${leftText}\n${rightText.padStart(width)}`;
  const clipped = leftText.length > room ? leftText.slice(0, room) : leftText;
  return `${clipped}${' '.repeat(width - clipped.length - rightText.length)}${rightText}`;
}

function qr(payload: string, moduleSize: number): number[] {
  const data = [...encoder.encode(ascii(payload))];
  const store = data.length + 3;
  return [
    // Model 2, module size, error correction M, store data, print.
    ...[GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00],
    ...[GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize],
    ...[GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31],
    ...[GS, 0x28, 0x6b, store & 0xff, (store >> 8) & 0xff, 0x31, 0x50, 0x30, ...data],
    ...[GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30],
  ];
}

export interface EscPosOptions {
  readonly openDrawer: boolean;
}

export function buildEscPosInvoice(model: InvoiceModel, options: EscPosOptions): Uint8Array {
  const width = columnsFor(model);
  const rule = '-'.repeat(width);
  const qrSize = model.layout.paperWidth === '58mm' ? 4 : 6;
  const copy: number[] = [];
  const text = (value: string): void => {
    copy.push(...encoder.encode(`${value}\n`));
  };
  const align = (mode: 0 | 1 | 2): void => {
    copy.push(ESC, 0x61, mode);
  };
  const style = (bits: number): void => {
    copy.push(ESC, 0x21, bits);
  };
  const bodyStyle =
    model.layout.fontScale === 'SMALL' ? 0x01 : model.layout.fontScale === 'LARGE' ? 0x10 : 0x00;

  align(1);
  style(0x30);
  for (const line of wrap(model.shopName, Math.floor(width / 2))) text(line);
  style(bodyStyle);
  for (const line of model.shopLines) for (const part of wrap(line, width)) text(part);
  if (model.headerNote) for (const part of wrap(model.headerNote, width)) text(part);
  style(0x08 | bodyStyle);
  text(ascii(model.title.toUpperCase()));
  style(bodyStyle);
  align(0);
  text(rule);
  text(twoColumns('Invoice', model.invoiceNumber, width));
  text(twoColumns('Date', model.issuedAt, width));
  if (model.cashier) text(twoColumns('Cashier', model.cashier, width));
  if (model.customer) text(twoColumns('Customer', model.customer, width));
  text(rule);

  for (const line of model.lines) {
    style(0x08 | bodyStyle);
    for (const part of wrap(line.name, width)) text(part);
    style(bodyStyle);
    text(twoColumns(`  ${line.quantity} x ${money(line.unitPrice)}`, money(line.amount), width));
    if (line.discount) text(`  Discount -${money(line.discount)}`);
    const batch = [
      line.batch ? `Batch ${line.batch}` : null,
      line.expiry ? `Exp ${line.expiry}` : null,
    ]
      .filter(Boolean)
      .join('  ');
    if (batch) text(`  ${ascii(batch)}`);
    if (line.dosage) {
      for (const part of wrap(`Dose ${line.dosage.code}`, width - 2)) text(`  ${part}`);
      for (const part of wrap(line.dosage.english, width - 4)) text(`    ${part}`);
    }
  }
  text(rule);
  text(twoColumns(`Subtotal (${model.totals.units} units)`, money(model.totals.subtotal), width));
  if (model.totals.discount)
    text(twoColumns('Discount', `-${money(model.totals.discount)}`, width));
  if (model.totals.tax) text(twoColumns('Sales tax incl.', money(model.totals.tax), width));
  style(0x10 | 0x08);
  text(twoColumns('TOTAL PKR', money(model.totals.total), width));
  style(bodyStyle);
  for (const payment of model.payments)
    text(twoColumns(payment.label, money(payment.amount), width));
  if (model.change) text(twoColumns('Change', money(model.change), width));

  if (model.fbr) {
    text(rule);
    align(1);
    style(0x08 | bodyStyle);
    text('FBR INVOICE');
    style(bodyStyle);
    if (model.fbr.posRegistrationNumber) text(ascii(`POS ID: ${model.fbr.posRegistrationNumber}`));
    if (model.fbr.invoiceNumber) {
      for (const part of wrap(`FBR No: ${model.fbr.invoiceNumber}`, width)) text(part);
    } else {
      text('FBR number pending - reprint to verify');
    }
    if (model.fbr.qrPayload) {
      copy.push(...qr(model.fbr.qrPayload, qrSize));
      text('');
      text('Verify with the FBR Tax Asaan app');
    }
    align(0);
  }

  if (model.returnQr) {
    text(rule);
    align(1);
    copy.push(...qr(model.returnQr, qrSize - 1));
    text('');
    text('Scan at the counter for returns');
    align(0);
  }
  if (model.footerNote) {
    text(rule);
    align(1);
    for (const part of wrap(model.footerNote, width)) text(part);
    align(0);
  }
  text('\n\n');

  const bytes: number[] = [ESC, 0x40];
  for (let index = 0; index < model.layout.copies; index += 1) {
    bytes.push(...copy);
    if (index === 0 && options.openDrawer) bytes.push(ESC, 0x70, 0x00, 0x19, 0xfa);
    bytes.push(GS, 0x56, 0x42, 0x03);
  }
  return Uint8Array.from(bytes);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
