import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LoginScreen } from './LoginScreen';

vi.mock('./api', () => ({
  login: vi.fn(),
}));

describe('LoginScreen', () => {
  it('focuses the username and accepts explicit terminal credentials', async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    const username = screen.getByRole('textbox', { name: 'Username' });
    const password = screen.getByLabelText('Password');
    const terminal = screen.getByRole('textbox', { name: 'Terminal code' });

    expect(username).toBe(document.activeElement);
    expect(terminal).toHaveProperty('value', 'COUNTER-01');

    await user.type(username, 'cashier');
    await user.type(password, 'correct horse battery staple');
    await user.clear(terminal);
    await user.type(terminal, 'COUNTER-02');

    expect(username).toHaveProperty('value', 'cashier');
    expect(password).toHaveProperty('value', 'correct horse battery staple');
    expect(terminal).toHaveProperty('value', 'COUNTER-02');
  });
});
