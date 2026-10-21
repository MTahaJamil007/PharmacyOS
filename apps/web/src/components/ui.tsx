import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Inbox,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { useDialogFocus } from '../hooks/useDialogFocus';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/* ---------- Buttons ---------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';

export interface ButtonProps extends ComponentProps<'button'> {
  readonly variant?: ButtonVariant | undefined;
  readonly size?: 'sm' | 'md' | 'lg' | undefined;
  readonly icon?: LucideIcon | undefined;
  readonly loading?: boolean | undefined;
  readonly block?: boolean | undefined;
  readonly shortcut?: string | undefined;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading = false,
  block = false,
  shortcut,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'btn',
        `btn-${variant}`,
        size !== 'md' && `btn-${size}`,
        block && 'btn-block',
        className,
      )}
      disabled={disabled === true || loading}
      {...props}
    >
      {loading ? (
        <span className="spinner" aria-hidden="true" />
      ) : Icon ? (
        <Icon aria-hidden />
      ) : null}
      {children}
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { readonly label: string; readonly icon: LucideIcon }) {
  return (
    <button
      type={type}
      className={cx('icon-btn', className)}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon aria-hidden />
    </button>
  );
}

export function Spinner({ label = 'Loading' }: { readonly label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Kbd({ children }: { readonly children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

/* ---------- Forms ---------- */

export function Field({
  label,
  hint,
  error,
  optional = false,
  className,
  children,
}: {
  readonly label: ReactNode;
  readonly hint?: ReactNode | undefined;
  readonly error?: ReactNode | undefined;
  readonly optional?: boolean | undefined;
  readonly className?: string | undefined;
  readonly children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cx('field', className)}>
      <label className="field-label" htmlFor={id}>
        {label}
        {optional ? <span className="optional"> (optional)</span> : null}
      </label>
      {cloneElement(children, {
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      })}
      {error ? (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  invalid = false,
  ...props
}: ComponentProps<'input'> & { readonly invalid?: boolean }) {
  return (
    <input
      className={cx('input', invalid && 'invalid', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

/** Decimal entry for money; validation is done by the caller with exact helpers. */
export function MoneyInput({
  className,
  ...props
}: ComponentProps<'input'> & { readonly invalid?: boolean }) {
  return (
    <Input
      inputMode="decimal"
      autoComplete="off"
      className={cx('input-money', className)}
      placeholder="0.00"
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cx('select', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cx('textarea', className)} {...props} />;
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  readonly label: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean | undefined;
}) {
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function SearchInput({
  icon: Icon,
  className,
  ...props
}: ComponentProps<'input'> & { readonly icon: LucideIcon }) {
  return (
    <div className={cx('input-group', className)}>
      <Icon aria-hidden />
      <input className="input" type="search" autoComplete="off" {...props} />
    </div>
  );
}

/* ---------- Layout ---------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  description,
  actions,
  footer,
  flush = false,
  className,
  children,
}: {
  readonly title?: ReactNode | undefined;
  readonly description?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
  readonly footer?: ReactNode | undefined;
  readonly flush?: boolean | undefined;
  readonly className?: string | undefined;
  readonly children?: ReactNode | undefined;
}) {
  return (
    <section className={cx('card', className)}>
      {title || actions ? (
        <header className="card-header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </header>
      ) : null}
      {children !== undefined ? (
        <div className={cx('card-body', flush && 'flush')}>{children}</div>
      ) : null}
      {footer ? <footer className="card-footer">{footer}</footer> : null}
    </section>
  );
}

export interface TabItem<T extends string> {
  readonly id: T;
  readonly label: ReactNode;
  readonly icon?: LucideIcon | undefined;
  readonly count?: number | undefined;
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
}: {
  readonly tabs: readonly TabItem<T>[];
  readonly active: T;
  readonly onChange: (id: T) => void;
  readonly label: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map(({ id, label: tabLabel, icon: Icon, count }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          className={cx('tab', active === id && 'active')}
          onClick={() => onChange(id)}
        >
          {Icon ? <Icon aria-hidden /> : null}
          {tabLabel}
          {count !== undefined ? <span className="count">{count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: ReactNode }>;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={value === option.value ? 'active' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Status ---------- */

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

export function Badge({
  tone = 'neutral',
  children,
}: {
  readonly tone?: Tone | undefined;
  readonly children: ReactNode;
}) {
  return <span className={cx('badge', tone !== 'neutral' && tone)}>{children}</span>;
}

const ALERT_ICONS: Record<'info' | 'success' | 'warning' | 'danger', LucideIcon> = {
  danger: XCircle,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
};

export function Alert({
  tone = 'info',
  title,
  children,
  actions,
}: {
  readonly tone?: 'info' | 'success' | 'warning' | 'danger' | undefined;
  readonly title?: ReactNode | undefined;
  readonly children?: ReactNode | undefined;
  readonly actions?: ReactNode | undefined;
}) {
  const Icon = ALERT_ICONS[tone];
  return (
    <div className={cx('alert', tone)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon aria-hidden />
      <div className="alert-body">
        {title ? <strong>{title}</strong> : null}
        {title && children ? <div>{children}</div> : children}
      </div>
      {actions ? <div className="alert-actions">{actions}</div> : null}
    </div>
  );
}

export function ErrorAlert({ error }: { readonly error: unknown }) {
  if (!error) return null;
  return <Alert tone="danger">{errorMessage(error)}</Alert>;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Something went wrong';
}

export function Stat({
  label,
  value,
  hint,
  tone,
  icon: Icon,
  onClick,
  selected = false,
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly hint?: ReactNode | undefined;
  readonly tone?: 'danger' | 'warning' | 'success' | undefined;
  readonly icon?: LucideIcon | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly selected?: boolean | undefined;
}) {
  const content = (
    <>
      <span className="stat-label">
        {Icon ? <Icon aria-hidden /> : null}
        {label}
      </span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </>
  );
  const className = cx(
    'stat',
    tone && `tone-${tone}`,
    onClick && 'clickable',
    selected && 'selected',
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} aria-pressed={selected}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  children,
  action,
}: {
  readonly icon?: LucideIcon | undefined;
  readonly title: ReactNode;
  readonly children?: ReactNode | undefined;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <div className="empty-state">
      <Icon aria-hidden />
      <strong>{title}</strong>
      {children ? <span>{children}</span> : null}
      {action}
    </div>
  );
}

/* ---------- Data table ---------- */

export interface Column<T> {
  readonly key: string;
  readonly header: ReactNode;
  readonly render: (row: T) => ReactNode;
  readonly align?: 'start' | 'end' | undefined;
  readonly width?: number | string | undefined;
  readonly footer?: ReactNode | undefined;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  loading = false,
  empty,
  compact = false,
  caption,
  maxHeight,
}: {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly onRowClick?: ((row: T) => void) | undefined;
  readonly selectedKey?: string | null | undefined;
  readonly loading?: boolean | undefined;
  readonly empty?: ReactNode | undefined;
  readonly compact?: boolean | undefined;
  readonly caption?: string | undefined;
  readonly maxHeight?: number | string | undefined;
}) {
  const hasFooter = columns.some((column) => column.footer !== undefined);
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className={cx('table', compact && 'table-compact')}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.align === 'end' ? 'num' : undefined}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0
            ? Array.from({ length: 4 }, (_, index) => (
                <tr key={`skeleton-${String(index)}`}>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <div className="skeleton" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => {
                const key = rowKey(row);
                return (
                  <tr
                    key={key}
                    className={cx(onRowClick && 'clickable', selectedKey === key && 'selected')}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                  >
                    {columns.map((column) => (
                      <td key={column.key} className={column.align === 'end' ? 'num' : undefined}>
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
        {hasFooter && rows.length > 0 ? (
          <tfoot>
            <tr>
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'end' ? 'num' : undefined}>
                  {column.footer}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {!loading && rows.length === 0 ? (empty ?? <EmptyState title="Nothing to show" />) : null}
    </div>
  );
}

/* ---------- Overlays ---------- */

export function Dialog({
  title,
  description,
  onClose,
  size = 'md',
  children,
  footer,
  initialFocus,
  closeLabel = 'Close',
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly onClose: () => void;
  readonly size?: 'sm' | 'md' | 'lg' | 'xl' | undefined;
  readonly children: ReactNode;
  readonly footer?: ReactNode | undefined;
  readonly initialFocus?: React.RefObject<HTMLElement | null> | undefined;
  readonly closeLabel?: string | undefined;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const fallbackFocus = useRef<HTMLButtonElement>(null);
  useDialogFocus(dialog, initialFocus ?? fallbackFocus, onClose);
  const titleId = useId();
  return (
    <div className="overlay" role="presentation">
      <div
        ref={dialog}
        className={cx('dialog', size !== 'md' && size)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton ref={fallbackFocus} label={closeLabel} icon={X} onClick={onClose} />
        </header>
        <div className="dialog-body">{children}</div>
        {footer ? <footer className="dialog-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Drawer({
  title,
  description,
  onClose,
  children,
  footer,
  narrow = false,
  actions,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode | undefined;
  readonly narrow?: boolean | undefined;
  readonly actions?: ReactNode | undefined;
}) {
  const drawer = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useDialogFocus(drawer, closeButton, onClose);
  const titleId = useId();
  return (
    <>
      <div className="drawer-overlay" role="presentation" />
      <div
        ref={drawer}
        className={cx('drawer', narrow && 'narrow')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="drawer-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <div className="row">
            {actions}
            <IconButton ref={closeButton} label="Close" icon={X} onClick={onClose} />
          </div>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-footer">{footer}</footer> : null}
      </div>
    </>
  );
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  tone = 'primary',
  busy = false,
  onConfirm,
  onClose,
}: {
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly tone?: 'primary' | 'danger' | undefined;
  readonly busy?: boolean | undefined;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/* ---------- Toasts ---------- */

interface ToastMessage {
  readonly id: number;
  readonly tone: 'success' | 'error' | 'info';
  readonly title: string;
  readonly detail?: string | undefined;
}

interface ToastApi {
  readonly success: (title: string, detail?: string) => void;
  readonly error: (title: string, detail?: unknown) => void;
  readonly info: (title: string, detail?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [messages, setMessages] = useState<readonly ToastMessage[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);
  const push = useCallback(
    (tone: ToastMessage['tone'], title: string, detail?: string) => {
      const id = next.current;
      next.current += 1;
      setMessages((current) => [...current.slice(-3), { detail, id, title, tone }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 8_000 : 4_000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      error: (title, detail) =>
        push('error', title, detail === undefined ? undefined : errorMessage(detail)),
      info: (title, detail) => push('info', title, detail),
      success: (title, detail) => push('success', title, detail),
    }),
    [push],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-live="polite">
        {messages.map((message) => {
          const Icon =
            message.tone === 'success' ? CheckCircle2 : message.tone === 'error' ? XCircle : Info;
          return (
            <div key={message.id} className={cx('toast', message.tone)} role="status">
              <Icon aria-hidden />
              <div className="toast-body">
                <strong>{message.title}</strong>
                {message.detail ? <span>{message.detail}</span> : null}
              </div>
              <IconButton label="Dismiss" icon={X} onClick={() => dismiss(message.id)} />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

const noopToast: ToastApi = {
  error: () => undefined,
  info: () => undefined,
  success: () => undefined,
};

export function useToast(): ToastApi {
  return useContext(ToastContext) ?? noopToast;
}

/** Closes a popover when the user clicks elsewhere or presses Escape. */
export function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', key);
    };
  }, [onDismiss, open, ref]);
}
