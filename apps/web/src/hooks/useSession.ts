import { createClientRequestId } from '@pharmacy/shared';
import { useCallback, useState } from 'react';

import { usePharmacyStore } from '../store';

export function useSession() {
  return usePharmacyStore((state) => state.session);
}

/** `can(permission)` for showing or hiding controls; the server still enforces every rule. */
export function usePermissions() {
  const permissions = usePharmacyStore((state) => state.session?.user.permissions);
  const can = useCallback(
    (...required: readonly string[]) =>
      required.some((permission) => permissions?.includes(permission) ?? false),
    [permissions],
  );
  return can;
}

/**
 * One client request ID per user intent. Keep it while the same action is retried (after a
 * timeout the server may already have applied it) and renew it once the action succeeded or
 * the operator changes what they are submitting.
 */
export function useRequestId(): readonly [string, () => void] {
  const [requestId, setRequestId] = useState(createClientRequestId);
  const renew = useCallback(() => setRequestId(createClientRequestId()), []);
  return [requestId, renew] as const;
}

/**
 * A request ID tied to what is being submitted: it stays the same while the payload is
 * unchanged (so a retry after a timeout replays instead of duplicating) and changes as soon
 * as the operator edits the payload, so an edited submission is never mistaken for a replay.
 * Call `renew` after a success so an identical follow-up submission is a new request.
 */
export function usePayloadRequestId(signature: string): readonly [string, () => void] {
  const [state, setState] = useState(() => ({ id: createClientRequestId(), signature }));
  const renew = useCallback(
    () => setState((current) => ({ id: createClientRequestId(), signature: current.signature })),
    [],
  );
  if (state.signature !== signature) {
    const next = { id: createClientRequestId(), signature };
    setState(next);
    return [next.id, renew] as const;
  }
  return [state.id, renew] as const;
}
