import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { login } from './api';
import { LoginScreen } from './LoginScreen';

vi.mock('./api', () => ({
  login: vi.fn(),
}));

const loginMock = vi.mocked(login);

describe('LoginScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    loginMock.mockReset();
    loginMock.mockRejectedValue(new Error('Invalid credentials or terminal'));
  });

  it('signs in with username and password alone and lets the server pick the terminal', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    const username = screen.getByRole('textbox', { name: 'Username' });
    expect(username).toBe(document.activeElement);
    expect(screen.queryByRole('textbox', { name: 'Terminal code' })).toBeNull();
    expect(screen.getByText(/selected automatically for this device/)).toBeTruthy();

    await user.type(username, 'cashier');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Open counter' }));

    expect(loginMock).toHaveBeenCalledWith('cashier', 'correct horse battery staple', {});
  });

  it('offers this device stored terminal as a preference the server may override', async () => {
    localStorage.setItem('pharmacy-device-terminal', 'COUNTER-02');
    const user = userEvent.setup();
    render(<LoginScreen />);

    expect(screen.getByText(/This device opens COUNTER-02/)).toBeTruthy();

    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'cashier');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Open counter' }));

    expect(loginMock).toHaveBeenCalledWith('cashier', 'correct horse battery staple', {
      preferredTerminalCode: 'COUNTER-02',
    });
  });

  it('binds the session when a terminal is chosen by hand', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(screen.getByRole('button', { name: 'Change terminal' }));
    const terminal = screen.getByRole('textbox', { name: 'Terminal code' });
    await user.type(terminal, 'COUNTER-03');
    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'cashier');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Open counter' }));

    expect(loginMock).toHaveBeenCalledWith('cashier', 'correct horse battery staple', {
      terminalCode: 'COUNTER-03',
    });
  });

  it('drops a stored terminal when the operator returns to automatic selection', async () => {
    localStorage.setItem('pharmacy-device-terminal', 'COUNTER-02');
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(screen.getByRole('button', { name: 'Change terminal' }));
    await user.click(screen.getByRole('button', { name: 'Select the terminal automatically' }));

    expect(localStorage.getItem('pharmacy-device-terminal')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Terminal code' })).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'cashier');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
    await user.click(screen.getByRole('button', { name: 'Open counter' }));

    expect(loginMock).toHaveBeenCalledWith('cashier', 'correct horse battery staple', {});
  });
});
