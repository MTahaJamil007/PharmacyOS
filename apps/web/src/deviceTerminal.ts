const DEVICE_TERMINAL_KEY = 'pharmacy-device-terminal';

/**
 * The terminal this device opened last. Sent as a preference at sign-in so staff never have to
 * type a terminal code; the server falls back to its own choice when the code no longer applies.
 */
export function readDeviceTerminalCode(): string | null {
  try {
    const code = localStorage.getItem(DEVICE_TERMINAL_KEY)?.trim();
    return code === undefined || code.length < 2 ? null : code;
  } catch {
    return null;
  }
}

export function rememberDeviceTerminalCode(code: string): void {
  try {
    if (code.trim().length >= 2) localStorage.setItem(DEVICE_TERMINAL_KEY, code.trim());
  } catch {
    // A device without usable storage simply lets the server pick the terminal each time.
  }
}

export function forgetDeviceTerminalCode(): void {
  try {
    localStorage.removeItem(DEVICE_TERMINAL_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
