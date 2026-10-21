import type { Environment } from '@pharmacy/config';
import type { Database } from '@pharmacy/database';

/**
 * Counts a wrong password against an account and locks it once the configured number of
 * failures falls inside the lockout window. Every path that verifies a password, including
 * supervisor approval at the counter, must call this so it cannot be used to guess one.
 */
export async function recordFailedPassword(
  database: Database,
  environment: Pick<Environment, 'ACCOUNT_LOCKOUT_FAILURES' | 'ACCOUNT_LOCKOUT_MINUTES'>,
  userId: string,
): Promise<void> {
  await database`
    with state as (
      select id,
        case
          when failed_login_window_started_at is null
            or failed_login_window_started_at <= now() -
              (${environment.ACCOUNT_LOCKOUT_MINUTES} * interval '1 minute')
          then 1 else failed_login_count + 1
        end as next_count,
        case
          when failed_login_window_started_at is null
            or failed_login_window_started_at <= now() -
              (${environment.ACCOUNT_LOCKOUT_MINUTES} * interval '1 minute')
          then now() else failed_login_window_started_at
        end as next_window
      from users
      where id = ${userId} and (locked_until is null or locked_until <= now())
      for update
    )
    update users set failed_login_count = state.next_count,
      failed_login_window_started_at = state.next_window,
      locked_until = case
        when state.next_count >= ${environment.ACCOUNT_LOCKOUT_FAILURES}
        then now() + (${environment.ACCOUNT_LOCKOUT_MINUTES} * interval '1 minute')
        else null
      end
    from state where users.id = state.id
  `;
}
