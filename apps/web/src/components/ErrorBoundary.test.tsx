import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

function BrokenCounter(): never {
  throw new Error('simulated render failure');
}

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('replaces a failed counter render with a recoverable screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <BrokenCounter />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert').textContent).toContain('Your cart is stored on this terminal');
    expect(screen.getByRole('button', { name: 'Reload counter' })).not.toBeNull();
  });
});
