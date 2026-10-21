import { describe, expect, it } from 'vitest';

import { describeApiError } from './api';

describe('describeApiError', () => {
  it('reports the field rules a validated endpoint rejected', () => {
    expect(
      describeApiError(
        {
          formErrors: [],
          fieldErrors: { password: ['Too small: expected string to have >=12 characters'] },
        },
        400,
      ),
    ).toBe('password: Too small: expected string to have >=12 characters');
  });

  it('reports every field and form error together', () => {
    expect(
      describeApiError(
        {
          formErrors: ['At least one field is required'],
          fieldErrors: { username: ['Too small'], roles: ['Invalid option'] },
        },
        400,
      ),
    ).toBe('At least one field is required; username: Too small; roles: Invalid option');
  });

  it('falls back to the message of an ordinary failure', () => {
    expect(describeApiError({ message: 'Invalid credentials or terminal' }, 401)).toBe(
      'Invalid credentials or terminal',
    );
  });

  it('joins a message array', () => {
    expect(describeApiError({ message: ['first problem', 'second problem'] }, 400)).toBe(
      'first problem; second problem',
    );
  });

  it('falls back to the status when the body carries nothing usable', () => {
    expect(describeApiError(null, 500)).toBe('Request failed (500)');
    expect(describeApiError({ fieldErrors: {} }, 503)).toBe('Request failed (503)');
  });
});
