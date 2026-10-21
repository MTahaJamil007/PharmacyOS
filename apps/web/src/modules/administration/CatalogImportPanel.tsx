import { useQueryClient } from '@tanstack/react-query';
import { createClientRequestId, PERMISSIONS } from '@pharmacy/shared';
import { useRef, useState } from 'react';

import { importCatalog, type CatalogImportResult } from '../../api';
import { usePharmacyStore } from '../../store';
import { parseCatalogFile, type CatalogFileParseResult } from '@pharmacy/shared';

const MAX_ROWS = 2000;

export function CatalogImportPanel(): React.JSX.Element | null {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const canSystem = session?.user.permissions.includes(PERMISSIONS.SETTINGS_MANAGE_SYSTEM) ?? false;
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<CatalogFileParseResult | null>(null);
  const [result, setResult] = useState<CatalogImportResult | null>(null);
  const [applyRequestId, setApplyRequestId] = useState(createClientRequestId);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  if (!canSystem) return null;

  const reset = (): void => {
    setParsed(null);
    setResult(null);
    setFileName('');
    setApplyRequestId(createClientRequestId());
    if (fileInput.current) fileInput.current.value = '';
  };

  const readFile = async (file: File): Promise<void> => {
    setError('');
    setNotice('');
    setResult(null);
    setApplyRequestId(createClientRequestId());
    try {
      const contents = await file.text();
      const next = parseCatalogFile(contents);
      if (next.rows.length === 0) {
        setParsed(null);
        setError('No data rows were found in that file');
        return;
      }
      if (next.rows.length > MAX_ROWS) {
        setParsed(null);
        setError(
          `That file holds ${String(next.rows.length)} rows; split it into ${String(MAX_ROWS)}-row files`,
        );
        return;
      }
      setFileName(file.name);
      setParsed(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be read');
    }
  };

  const run = async (mode: 'VALIDATE' | 'APPLY'): Promise<void> => {
    if (!parsed) return;
    setBusy(true);
    try {
      setError('');
      const outcome = await importCatalog(
        token,
        mode,
        parsed.rows,
        mode === 'APPLY' ? applyRequestId : createClientRequestId(),
      );
      setResult(outcome);
      if (outcome.applied) {
        setApplyRequestId(createClientRequestId());
        await queryClient.invalidateQueries({ queryKey: ['admin', 'medicines'] });
        setNotice(
          `Applied: ${String(outcome.created)} created, ${String(outcome.updated)} updated`,
        );
      } else {
        setNotice(
          outcome.rejected > 0
            ? `${String(outcome.rejected)} row(s) need correction before this file can be applied`
            : 'Validation passed; this file is safe to apply',
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import could not be processed');
    } finally {
      setBusy(false);
    }
  };

  const applicable = Boolean(result && !result.applied && result.rejected === 0);

  return (
    <article className="work-panel compact-form-panel catalog-import-panel">
      <header>
        <div>
          <p className="eyebrow">Onboarding · validate before you write</p>
          <h2>Import medicine catalog</h2>
        </div>
      </header>
      <p className="data-basis">
        Upload a CSV exported from the current system. Nothing is written until validation reports
        zero rejected rows and you apply it. Rows match an existing medicine by SKU or barcode.
      </p>
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="counter-notice" role="status">
          {notice}
        </p>
      ) : null}
      <div className="form-grid single-column">
        <label>
          Catalog file
          <input
            accept=".csv,text/csv"
            ref={fileInput}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </label>
      </div>
      {parsed ? (
        <>
          <div className="account-strip">
            <span>
              File <b>{fileName}</b>
            </span>
            <span>
              Rows <b>{parsed.rows.length}</b>
            </span>
            <span>
              Columns <b>{parsed.recognizedColumns.length}</b>
            </span>
          </div>
          {parsed.ignoredColumns.length > 0 ? (
            <p className="data-basis">Ignored columns: {parsed.ignoredColumns.join(', ')}</p>
          ) : null}
          <div className="purchase-detail-actions">
            <button disabled={busy} onClick={() => void run('VALIDATE')}>
              Validate file
            </button>
            <button
              className="primary-button"
              disabled={busy || !applicable}
              onClick={() => void run('APPLY')}
            >
              Apply{' '}
              {result ? `${String(result.created)} new / ${String(result.updated)} updated` : ''}
            </button>
            <button disabled={busy} onClick={reset}>
              Clear
            </button>
          </div>
        </>
      ) : null}
      {result ? (
        <>
          <div className="account-strip">
            <span>
              Created <b>{result.created}</b>
            </span>
            <span>
              Updated <b>{result.updated}</b>
            </span>
            <span>
              Rejected <b>{result.rejected}</b>
            </span>
          </div>
          {result.issues.length > 0 ? (
            <table className="report-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Field</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {result.issues.map((issue) => (
                  <tr key={`${String(issue.row)}-${issue.field}-${issue.message}`}>
                    <td>{issue.row}</td>
                    <td>{issue.field}</td>
                    <td>{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}
    </article>
  );
}
