import { useState } from 'react';

import {
  loadPrinterProfile,
  PRINTER_METHOD_LABELS,
  savePrinterProfile,
  type PrinterMethod,
  type PrinterProfile,
} from './printers';

const METHOD_HINTS: Record<PrinterMethod, string> = {
  BROWSER:
    'Works with any printer installed in Windows: thermal receipt printers with their driver, A4 laser or inkjet. The print dialog lets you pick it.',
  USB: 'Direct to a USB thermal printer without a Windows driver (Chrome or Edge). The first print asks you to choose the printer once.',
  SERIAL:
    'Direct to a COM-port or Bluetooth (paired, serial) thermal printer. The first print asks you to choose the port once.',
  NETWORK: 'Direct to a LAN or Wi-Fi receipt printer by its IP address (port 9100).',
};

/** This counter's printer. Stored on the device, because each counter has its own printer. */
export function PrinterSetup({
  onSaved,
}: {
  readonly onSaved?: (profile: PrinterProfile) => void;
}): React.JSX.Element {
  const [profile, setProfile] = useState<PrinterProfile>(() => loadPrinterProfile());
  const [saved, setSaved] = useState(false);
  const update = (next: Partial<PrinterProfile>): void => {
    setSaved(false);
    setProfile((current) => ({ ...current, ...next }));
  };
  return (
    <div className="printer-setup">
      <fieldset>
        <legend>How this counter prints</legend>
        {(Object.keys(PRINTER_METHOD_LABELS) as PrinterMethod[]).map((method) => (
          <label key={method} className="printer-method">
            <input
              type="radio"
              name="printer-method"
              checked={profile.method === method}
              onChange={() => update({ method })}
            />
            <strong>{PRINTER_METHOD_LABELS[method]}</strong>
            <small>{METHOD_HINTS[method]}</small>
          </label>
        ))}
      </fieldset>
      {profile.method === 'NETWORK' ? (
        <div className="printer-fields">
          <label>
            Printer IP address
            <input
              value={profile.networkHost}
              placeholder="192.168.1.50"
              onChange={(event) => update({ networkHost: event.target.value.trim() })}
            />
          </label>
          <label>
            Port
            <input
              inputMode="numeric"
              value={String(profile.networkPort)}
              onChange={(event) => {
                const port = Number(event.target.value);
                if (Number.isInteger(port) && port >= 9100 && port <= 9109) {
                  update({ networkPort: port });
                }
              }}
            />
          </label>
        </div>
      ) : null}
      {profile.method === 'SERIAL' ? (
        <div className="printer-fields">
          <label>
            Speed (baud)
            <select
              value={String(profile.baudRate)}
              onChange={(event) => update({ baudRate: Number(event.target.value) })}
            >
              {[9600, 19200, 38400, 57600, 115200].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <label className="check-field">
        <input
          type="checkbox"
          checked={profile.openDrawer}
          disabled={profile.method === 'BROWSER'}
          onChange={(event) => update({ openDrawer: event.target.checked })}
        />
        <span>Open the cash drawer when printing (receipt printers only)</span>
      </label>
      <label className="check-field">
        <input
          type="checkbox"
          checked={profile.autoPrint}
          onChange={(event) => update({ autoPrint: event.target.checked })}
        />
        <span>Print automatically when a sale completes</span>
      </label>
      <button
        type="button"
        className="secondary-button compact"
        onClick={() => {
          savePrinterProfile(profile);
          setSaved(true);
          onSaved?.(profile);
        }}
      >
        Save printer
      </button>
      {saved ? <span className="side-hint">Saved on this device.</span> : null}
    </div>
  );
}
