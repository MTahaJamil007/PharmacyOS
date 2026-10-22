import { createServer, type AddressInfo, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { PrintingService } from './printing.service.js';

describe('network printer relay', () => {
  let server: Server | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  it('delivers the exact bytes to a printer on the local network', async () => {
    const received: Buffer[] = [];
    const done = new Promise<void>((resolve) => {
      server = createServer((socket) => {
        socket.on('data', (chunk: Buffer) => received.push(chunk));
        socket.on('end', () => resolve());
      });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const port = (server?.address() as AddressInfo).port;
    const data = Buffer.from([0x1b, 0x40, 0x41, 0x0a, 0x1d, 0x56, 0x00]);

    const result = await new PrintingService().printToNetwork({
      host: '127.0.0.1',
      port,
      data: data.toString('base64'),
    });
    await done;

    expect(result).toEqual({ bytes: data.length });
    expect(Buffer.concat(received)).toEqual(data);
  });

  it('refuses addresses outside the shop network', async () => {
    await expect(
      new PrintingService().printToNetwork({ host: '8.8.8.8', port: 9100, data: 'G0A=' }),
    ).rejects.toThrow('Only printers on the shop network');
  });

  it('reports an unreachable printer instead of hanging', async () => {
    await expect(
      new PrintingService().printToNetwork({ host: '127.0.0.1', port: 9, data: 'G0A=' }),
    ).rejects.toThrow();
  });
});
