import { printToNetworkPrinter } from '../../api';
import { buildEscPosInvoice, toBase64 } from './escpos';
import type { InvoiceModel } from './invoice-model';

/**
 * How this counter reaches its printer. Every method prints the same invoice:
 * - BROWSER: the operating system's printer driver (any installed printer, A4 or thermal).
 * - USB: raw ESC/POS over WebUSB, for thermal printers without a driver.
 * - SERIAL: raw ESC/POS over a COM port, including Bluetooth serial printers.
 * - NETWORK: raw ESC/POS to a LAN printer's port 9100, relayed by the local server.
 */
export type PrinterMethod = 'BROWSER' | 'USB' | 'SERIAL' | 'NETWORK';

export interface PrinterProfile {
  readonly method: PrinterMethod;
  readonly networkHost: string;
  readonly networkPort: number;
  readonly baudRate: number;
  readonly openDrawer: boolean;
  readonly autoPrint: boolean;
}

export const DEFAULT_PRINTER_PROFILE: PrinterProfile = {
  method: 'BROWSER',
  networkHost: '',
  networkPort: 9100,
  baudRate: 9600,
  openDrawer: false,
  autoPrint: false,
};

export const PRINTER_METHOD_LABELS: Record<PrinterMethod, string> = {
  BROWSER: 'Installed printer (print dialog)',
  USB: 'USB receipt printer',
  SERIAL: 'Serial or Bluetooth printer',
  NETWORK: 'Network (LAN) printer',
};

const PROFILE_KEY = 'pharmacy-printer-profile-v1';
const METHODS: readonly PrinterMethod[] = ['BROWSER', 'USB', 'SERIAL', 'NETWORK'];

export function loadPrinterProfile(): PrinterProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return DEFAULT_PRINTER_PROFILE;
    const value = JSON.parse(raw) as Partial<PrinterProfile>;
    return {
      method: METHODS.includes(value.method as PrinterMethod)
        ? (value.method as PrinterMethod)
        : DEFAULT_PRINTER_PROFILE.method,
      networkHost: typeof value.networkHost === 'string' ? value.networkHost : '',
      networkPort:
        Number.isInteger(value.networkPort) &&
        Number(value.networkPort) >= 9100 &&
        Number(value.networkPort) <= 9109
          ? Number(value.networkPort)
          : 9100,
      baudRate: [9600, 19200, 38400, 57600, 115200].includes(Number(value.baudRate))
        ? Number(value.baudRate)
        : 9600,
      openDrawer: value.openDrawer === true,
      autoPrint: value.autoPrint === true,
    };
  } catch {
    return DEFAULT_PRINTER_PROFILE;
  }
}

export function savePrinterProfile(profile: PrinterProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // A device without storage keeps using the default browser printing.
  }
}

/** Marks one element as the printable invoice, sets the page size, and opens the print dialog. */
export function printElementInBrowser(element: HTMLElement, paperWidth: string): void {
  const style = document.createElement('style');
  style.id = 'invoice-page-size';
  style.textContent =
    paperWidth === 'A4'
      ? '@page { size: A4; margin: 12mm; }'
      : `@page { size: ${paperWidth} auto; margin: 0; }`;
  document.getElementById('invoice-page-size')?.remove();
  document.head.append(style);
  element.classList.add('print-target');
  document.documentElement.classList.add('printing-invoice');
  const cleanup = (): void => {
    element.classList.remove('print-target');
    document.documentElement.classList.remove('printing-invoice');
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  // Browsers without afterprint (and test doubles) still get their page back.
  window.setTimeout(cleanup, 1_000);
}

interface SerialPortLike {
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
}
interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(): Promise<SerialPortLike>;
}
interface UsbEndpointLike {
  readonly endpointNumber: number;
  readonly direction: 'in' | 'out';
  readonly type: string;
}
interface UsbInterfaceLike {
  readonly interfaceNumber: number;
  readonly alternate: { readonly endpoints: readonly UsbEndpointLike[] };
}
interface UsbDeviceLike {
  readonly opened: boolean;
  readonly configuration: { readonly interfaces: readonly UsbInterfaceLike[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(value: number): Promise<void>;
  releaseInterface(value: number): Promise<void>;
  transferOut(endpoint: number, data: Uint8Array): Promise<unknown>;
}
interface UsbLike {
  getDevices(): Promise<UsbDeviceLike[]>;
  requestDevice(options: { filters: readonly object[] }): Promise<UsbDeviceLike>;
}

async function printSerial(bytes: Uint8Array, baudRate: number): Promise<void> {
  const serial = (navigator as Navigator & { readonly serial?: SerialLike }).serial;
  if (!serial) throw new Error('This browser cannot reach serial printers. Use Chrome or Edge.');
  // Reuse a port the cashier already allowed so printing does not ask every time.
  const port = (await serial.getPorts())[0] ?? (await serial.requestPort());
  await port.open({ baudRate });
  try {
    const writer = port.writable?.getWriter();
    if (!writer) throw new Error('The selected serial printer is not writable');
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  } finally {
    await port.close();
  }
}

async function printUsb(bytes: Uint8Array): Promise<void> {
  const usb = (navigator as Navigator & { readonly usb?: UsbLike }).usb;
  if (!usb) throw new Error('This browser cannot reach USB printers. Use Chrome or Edge.');
  const device = (await usb.getDevices())[0] ?? (await usb.requestDevice({ filters: [] }));
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const target = device.configuration?.interfaces
    .map((item) => ({
      interfaceNumber: item.interfaceNumber,
      endpoint: item.alternate.endpoints.find(
        (endpoint) => endpoint.direction === 'out' && endpoint.type === 'bulk',
      ),
    }))
    .find((item) => item.endpoint !== undefined);
  if (!target?.endpoint) throw new Error('This USB device has no printer output channel');
  try {
    await device.claimInterface(target.interfaceNumber);
  } catch {
    throw new Error(
      'Windows has this printer reserved for its driver. Choose "Installed printer (print dialog)" instead.',
    );
  }
  try {
    for (let offset = 0; offset < bytes.length; offset += 16_384) {
      await device.transferOut(
        target.endpoint.endpointNumber,
        bytes.slice(offset, offset + 16_384),
      );
    }
  } finally {
    await device.releaseInterface(target.interfaceNumber);
    await device.close();
  }
}

/**
 * Prints an invoice the way this counter is set up. Browser printing needs the rendered
 * invoice element; every other method sends ESC/POS built from the same invoice model.
 */
export async function printInvoice(
  model: InvoiceModel,
  profile: PrinterProfile,
  options: { readonly token: string; readonly element: HTMLElement | null },
): Promise<string> {
  if (profile.method === 'BROWSER') {
    if (!options.element) throw new Error('The invoice is not on screen to print');
    printElementInBrowser(options.element, model.layout.paperWidth);
    return 'Sent to the printer dialog';
  }
  if (model.layout.paperWidth === 'A4') {
    throw new Error('A4 invoices print through "Installed printer (print dialog)"');
  }
  const bytes = buildEscPosInvoice(model, { openDrawer: profile.openDrawer });
  if (profile.method === 'SERIAL') await printSerial(bytes, profile.baudRate);
  else if (profile.method === 'USB') await printUsb(bytes);
  else {
    if (!profile.networkHost) throw new Error('Set the network printer address first');
    await printToNetworkPrinter(options.token, {
      host: profile.networkHost,
      port: profile.networkPort,
      data: toBase64(bytes),
    });
  }
  return `Printed on the ${PRINTER_METHOD_LABELS[profile.method].toLowerCase()}`;
}
