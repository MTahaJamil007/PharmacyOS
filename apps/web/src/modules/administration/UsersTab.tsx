import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';

import { adminGet, adminPatch, adminPost } from '../../api';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  ErrorAlert,
  Field,
  IconButton,
  Input,
  useToast,
} from '../../components/ui';
import { formatDateTime, humanize } from '../../format';
import { useSession } from '../../hooks/useSession';
import type { AdminRole, AdminUser, RoleCode } from './admin-types';

const MIN_PASSWORD = 12;

export function UsersTab() {
  const session = useSession();
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => adminGet<{ readonly data: readonly AdminUser[] }>('/users'),
  });
  const roles = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => adminGet<{ readonly data: readonly AdminRole[] }>('/users/roles'),
  });
  return (
    <Card
      title="Staff accounts"
      description="Each person gets their own login so every sale, refund and stock change is traceable."
      actions={
        <Button variant="primary" icon={UserPlus} onClick={() => setEditing('new')}>
          Add staff member
        </Button>
      }
      flush
    >
      <ErrorAlert error={users.error} />
      <DataTable
        caption="Staff accounts"
        rows={users.data?.data ?? []}
        rowKey={(user) => user.id}
        loading={users.isLoading}
        empty={<EmptyState icon={Users} title="No staff accounts" />}
        columns={[
          {
            header: 'Name',
            key: 'name',
            render: (user) => (
              <>
                <span className="cell-primary">
                  {user.displayName}
                  {user.id === session?.user.id ? <span className="muted"> (you)</span> : null}
                </span>
                <span className="cell-sub mono">{user.username}</span>
              </>
            ),
          },
          {
            header: 'Roles',
            key: 'roles',
            render: (user) => (
              <span className="row wrap">
                {user.roles.map((role) => (
                  <Badge
                    key={role}
                    tone={role === 'OWNER' || role === 'SYSTEM_ADMIN' ? 'brand' : 'neutral'}
                  >
                    {humanize(role)}
                  </Badge>
                ))}
              </span>
            ),
          },
          {
            header: 'Status',
            key: 'status',
            render: (user) =>
              !user.isActive ? (
                <Badge tone="danger">Disabled</Badge>
              ) : user.lockedUntil && Date.parse(user.lockedUntil) > Date.now() ? (
                <Badge tone="warning">Locked until {formatDateTime(user.lockedUntil)}</Badge>
              ) : (
                <Badge tone="success">Active</Badge>
              ),
          },
          {
            header: 'Last sign-in',
            key: 'login',
            render: (user) => (user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'),
          },
          {
            align: 'end',
            header: <span className="sr-only">Actions</span>,
            key: 'actions',
            render: (user) => (
              <span className="table-actions">
                <IconButton
                  label={`Reset password for ${user.displayName}`}
                  icon={KeyRound}
                  onClick={() => setResetting(user)}
                />
                <IconButton
                  label={`Edit ${user.displayName}`}
                  icon={Pencil}
                  onClick={() => setEditing(user)}
                />
              </span>
            ),
          },
        ]}
      />
      {editing ? (
        <UserDialog
          user={editing === 'new' ? null : editing}
          roles={roles.data?.data ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {resetting ? (
        <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      ) : null}
    </Card>
  );
}

function UserDialog({
  user,
  roles,
  onClose,
}: {
  readonly user: AdminUser | null;
  readonly roles: readonly AdminRole[];
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const session = useSession();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [selected, setSelected] = useState<readonly RoleCode[]>(user?.roles ?? ['SALESPERSON']);
  const [active, setActive] = useState(user?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const isSelf = user?.id === session?.user.id;
  const passwordProblem =
    user === null && password.length > 0 && password.length < MIN_PASSWORD
      ? `At least ${String(MIN_PASSWORD)} characters`
      : user === null && confirm.length > 0 && confirm !== password
        ? 'The two passwords do not match'
        : null;
  const valid =
    displayName.trim().length >= 2 &&
    selected.length > 0 &&
    (user !== null ||
      (username.trim().length >= 3 && password.length >= MIN_PASSWORD && password === confirm));
  const toggle = (code: RoleCode, checked: boolean): void => {
    setSelected((current) =>
      checked ? [...current, code] : current.filter((role) => role !== code),
    );
  };
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (user === null) {
        await adminPost('/users', {
          displayName: displayName.trim(),
          password,
          roles: selected,
          username: username.trim(),
        });
        toast.success(`${displayName.trim()} can now sign in`);
      } else {
        await adminPatch(`/users/${user.id}`, {
          displayName: displayName.trim(),
          roles: selected,
          ...(isSelf ? {} : { isActive: active }),
        });
        toast.success('Account updated');
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={user ? `Edit ${user.displayName}` : 'Add staff member'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void submit()}>
            {user ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <div className="form-grid">
          <Field label="Full name">
            <Input
              value={displayName}
              maxLength={160}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field
            label="Username"
            hint={user ? 'Usernames cannot be changed.' : 'Used to sign in. Letters and numbers.'}
          >
            <Input
              value={username}
              disabled={user !== null}
              autoComplete="off"
              maxLength={100}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          {user === null ? (
            <>
              <Field
                label="Password"
                hint={`At least ${String(MIN_PASSWORD)} characters.`}
                error={passwordProblem ?? undefined}
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field label="Repeat password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </Field>
            </>
          ) : null}
        </div>
        <div className="form-section-title">What can they do?</div>
        <div className="stack" style={{ gap: 8 }}>
          {roles.map((role) => (
            <div key={role.code}>
              <Checkbox
                label={<strong>{role.name || humanize(role.code)}</strong>}
                checked={selected.includes(role.code)}
                onChange={(checked) => toggle(role.code, checked)}
              />
              {role.description ? (
                <span className="cell-sub" style={{ marginInlineStart: 24 }}>
                  {role.description}
                </span>
              ) : null}
            </div>
          ))}
        </div>
        {user && !isSelf ? (
          <Checkbox label="Account is active (can sign in)" checked={active} onChange={setActive} />
        ) : null}
        <ErrorAlert error={error} />
      </div>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
}: {
  readonly user: AdminUser;
  readonly onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await adminPost(`/users/${user.id}/password`, { password });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('Password reset', `Give the new password to ${user.displayName} in person.`);
      onClose();
    } catch (caught) {
      toast.error('Could not reset the password', caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Reset password for ${user.displayName}`}
      description="Their current sessions are signed out and any lockout is cleared."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={password.length < MIN_PASSWORD}
            onClick={() => void submit()}
          >
            Reset password
          </Button>
        </>
      }
    >
      <Field label="New password" hint={`At least ${String(MIN_PASSWORD)} characters.`}>
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}
