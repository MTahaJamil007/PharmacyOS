import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Socket } from 'node:net';
import { isPrivatePrinterAddress, type NetworkPrintRequest } from '@pharmacy/shared';

const CONNECT_TIMEOUT_MS = 4_000;

/**
 * Relays raw ESC/POS bytes to a receipt printer on the shop network (port 9100, "RAW" or
 * "JetDirect"). A browser cannot open a TCP socket, so the local API does it on the counter's
 * behalf, and only towards private addresses.
 */
@Injectable()
export class PrintingService {
  async printToNetwork(input: NetworkPrintRequest): Promise<{ readonly bytes: number }> {
    if (!isPrivatePrinterAddress(input.host)) {
      throw new BadRequestException(
        'Only printers on the shop network (10.x, 172.16-31.x, 192.168.x) are allowed',
      );
    }
    const payload = Buffer.from(input.data, 'base64');
    if (payload.length === 0) throw new BadRequestException('Nothing to print');
    await new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };
      socket.setTimeout(CONNECT_TIMEOUT_MS, () =>
        finish(new Error(`Printer ${input.host}:${String(input.port)} did not answer`)),
      );
      socket.once('error', (error) => finish(error));
      socket.connect(input.port, input.host, () => {
        socket.end(payload, () => finish());
      });
    }).catch((error: unknown) => {
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'Network printer is unavailable',
      );
    });
    return { bytes: payload.length };
  }
}
