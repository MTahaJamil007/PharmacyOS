import { createClientRequestId, IMPORT_CHUNK_ROWS } from '@pharmacy/shared';
import { CheckCircle2, Download, FileSpreadsheet, ShieldCheck, Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import { Alert, Button, Card, DataTable, ErrorAlert } from '../../components/ui';
import { formatCount } from '../../format';

export interface ImportChunkResult {
  readonly applied: boolean;
  readonly issues: ReadonlyArray<{
    readonly row: number;
    readonly field: string;
    readonly message: string;
  }>;
}

interface ParsedFile {
  readonly rows: readonly Record<string, unknown>[];
  readonly recognizedColumns: readonly string[];
  readonly ignoredColumns: readonly string[];
}

interface LoadedFile extends ParsedFile {
  readonly name: string;
  readonly chunks: ReadonlyArray<readonly Record<string, unknown>[]>;
  /** One request ID per chunk and mode, kept for the life of the file so a retry replays. */
  readonly validateIds: readonly string[];
  readonly applyIds: readonly string[];
}

interface FileIssue {
  readonly line: number;
  readonly field: string;
  readonly message: string;
}

type Phase =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'VALIDATING'; readonly done: number }
  | { readonly kind: 'VALIDATED'; readonly issues: readonly FileIssue[] }
  | { readonly kind: 'APPLYING'; readonly done: number }
  | { readonly kind: 'APPLIED' };

function chunk<T>(rows: readonly T[]): ReadonlyArray<readonly T[]> {
  const chunks: T[][] = [];
  for (let start = 0; start < rows.length; start += IMPORT_CHUNK_ROWS) {
    chunks.push(rows.slice(start, start + IMPORT_CHUNK_ROWS));
  }
  return chunks;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Imports a spreadsheet in server-sized chunks. Every chunk is validated before anything is
 * written; the apply step only unlocks when the whole file is clean, and it can be resumed
 * after a network failure without duplicating chunks that already went through.
 */
export function ChunkedImport<R extends ImportChunkResult>({
  title,
  description,
  columnsHelp,
  templateName,
  template,
  parse,
  run,
  summarize,
  applyLabel,
  onApplied,
}: {
  readonly title: string;
  readonly description: ReactNode;
  readonly columnsHelp: ReactNode;
  readonly templateName: string;
  readonly template: string;
  readonly parse: (text: string) => ParsedFile;
  readonly run: (
    mode: 'VALIDATE' | 'APPLY',
    rows: readonly Record<string, unknown>[],
    requestId: string,
  ) => Promise<R>;
  readonly summarize: (results: readonly R[]) => ReactNode;
  readonly applyLabel: string;
  readonly onApplied?: (() => void) | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'IDLE' });
  const [results, setResults] = useState<readonly R[]>([]);
  const [appliedResults, setAppliedResults] = useState<readonly R[]>([]);
  const [appliedChunks, setAppliedChunks] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [dragging, setDragging] = useState(false);

  const load = async (selected: File): Promise<void> => {
    setError(null);
    setResults([]);
    setAppliedResults([]);
    setAppliedChunks(0);
    setPhase({ kind: 'IDLE' });
    if (!/\.(csv|txt)$/i.test(selected.name)) {
      setFile(null);
      setError(
        new Error(
          'Save the spreadsheet as CSV (Excel: File → Save As → CSV UTF-8) and choose that file.',
        ),
      );
      return;
    }
    const parsed = parse(await selected.text());
    if (parsed.rows.length === 0) {
      setFile(null);
      setError(new Error('The file has no data rows under the heading row.'));
      return;
    }
    const chunks = chunk(parsed.rows);
    setFile({
      ...parsed,
      applyIds: chunks.map(() => createClientRequestId()),
      chunks,
      name: selected.name,
      validateIds: chunks.map(() => createClientRequestId()),
    });
  };

  const validate = async (): Promise<void> => {
    if (!file) return;
    setError(null);
    const collected: R[] = [];
    const issues: FileIssue[] = [];
    try {
      for (const [index, rows] of file.chunks.entries()) {
        setPhase({ done: index, kind: 'VALIDATING' });
        const result = await run(
          'VALIDATE',
          rows,
          file.validateIds[index] ?? createClientRequestId(),
        );
        collected.push(result);
        for (const issue of result.issues) {
          // Line 1 is the heading row; server rows are 1-based within the chunk.
          issues.push({
            field: issue.field,
            line: index * IMPORT_CHUNK_ROWS + issue.row + 1,
            message: issue.message,
          });
        }
      }
      setResults(collected);
      setPhase({ issues, kind: 'VALIDATED' });
    } catch (caught) {
      setError(caught);
      setPhase({ kind: 'IDLE' });
    }
  };

  const apply = async (): Promise<void> => {
    if (!file) return;
    setError(null);
    if (appliedChunks === 0) setAppliedResults([]);
    try {
      for (let index = appliedChunks; index < file.chunks.length; index += 1) {
        setPhase({ done: index, kind: 'APPLYING' });
        const rows = file.chunks[index] ?? [];
        const result = await run('APPLY', rows, file.applyIds[index] ?? createClientRequestId());
        if (!result.applied) {
          throw new Error(
            `Part ${String(index + 1)} was refused (${String(result.issues.length)} problem(s)). Nothing in that part was written; validate the file again.`,
          );
        }
        setAppliedResults((previous) => [...previous, result]);
        setAppliedChunks(index + 1);
      }
      setPhase({ kind: 'APPLIED' });
      onApplied?.();
    } catch (caught) {
      setError(caught);
      setPhase({ issues: [], kind: 'VALIDATED' });
    }
  };

  const reset = (): void => {
    setFile(null);
    setPhase({ kind: 'IDLE' });
    setResults([]);
    setAppliedResults([]);
    setAppliedChunks(0);
    setError(null);
    if (input.current) input.current.value = '';
  };

  const busy = phase.kind === 'VALIDATING' || phase.kind === 'APPLYING';
  const chunkCount = file?.chunks.length ?? 0;
  const issues = phase.kind === 'VALIDATED' ? phase.issues : [];
  const clean = phase.kind === 'VALIDATED' && issues.length === 0;
  return (
    <Card
      title={title}
      description={description}
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon={Download}
          onClick={() => download(templateName, template)}
        >
          Download template
        </Button>
      }
    >
      <div className="stack">
        <div className="muted">{columnsHelp}</div>
        <label
          className={dragging ? 'dropzone active' : 'dropzone'}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files[0];
            if (dropped && !busy) void load(dropped);
          }}
        >
          <FileSpreadsheet aria-hidden />
          <strong>{file ? file.name : 'Choose or drop a CSV file'}</strong>
          <span>
            {file
              ? `${formatCount(file.rows.length)} row(s) · ${String(chunkCount)} part(s) of up to ${String(IMPORT_CHUNK_ROWS)}`
              : 'Excel: File → Save As → CSV UTF-8'}
          </span>
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept=".csv,text/csv,.txt"
            disabled={busy}
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) void load(selected);
            }}
          />
        </label>
        {file && file.ignoredColumns.length > 0 ? (
          <Alert tone="warning" title="Some columns will be ignored">
            Not recognised: {file.ignoredColumns.join(', ')}. Recognised:{' '}
            {file.recognizedColumns.join(', ') || 'none'}.
          </Alert>
        ) : null}
        <ErrorAlert error={error} />
        {busy ? (
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted">
              {phase.kind === 'VALIDATING' ? 'Checking' : 'Saving'} part {phase.done + 1} of{' '}
              {chunkCount}…
            </span>
            <div
              className="progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={chunkCount}
              aria-valuenow={phase.done}
            >
              <div
                style={{
                  width: `${String(Math.round((phase.done / Math.max(chunkCount, 1)) * 100))}%`,
                }}
              />
            </div>
          </div>
        ) : null}
        {phase.kind === 'VALIDATED' && issues.length > 0 ? (
          <>
            <Alert
              tone="danger"
              title={`${formatCount(issues.length)} problem(s) found — nothing has been saved`}
            >
              Fix these lines in the spreadsheet, save it again, and choose the file once more.
            </Alert>
            <DataTable
              caption="Problems in the file"
              compact
              maxHeight={320}
              rows={issues.slice(0, 500).map((issue, index) => ({ ...issue, index }))}
              rowKey={(issue) => String(issue.index)}
              columns={[
                { header: 'Line', key: 'line', width: 80, render: (issue) => issue.line },
                { header: 'Column', key: 'field', width: 160, render: (issue) => issue.field },
                { header: 'Problem', key: 'message', render: (issue) => issue.message },
              ]}
            />
          </>
        ) : null}
        {phase.kind === 'APPLIED' && appliedResults.length > 0 ? summarize(appliedResults) : null}
        {clean && results.length > 0 ? summarize(results) : null}
        {clean && appliedChunks > 0 ? (
          <Alert tone="warning">
            {appliedChunks} of {chunkCount} part(s) were saved before the interruption. Continuing
            finishes the rest; the saved parts are not repeated.
          </Alert>
        ) : null}
        {phase.kind === 'APPLIED' ? (
          <Alert tone="success" title="Import complete">
            All {formatCount(file?.rows.length ?? 0)} row(s) were saved.
          </Alert>
        ) : null}
        <div className="row">
          {file && phase.kind !== 'APPLIED' ? (
            <Button
              icon={ShieldCheck}
              loading={phase.kind === 'VALIDATING'}
              disabled={busy}
              onClick={() => void validate()}
            >
              Check file
            </Button>
          ) : null}
          {clean ? (
            <Button variant="primary" icon={Upload} disabled={busy} onClick={() => void apply()}>
              {appliedChunks > 0 ? 'Continue import' : applyLabel}
            </Button>
          ) : null}
          {phase.kind === 'APPLYING' ? (
            <Button variant="primary" icon={Upload} loading>
              Saving…
            </Button>
          ) : null}
          {phase.kind === 'APPLIED' ? (
            <Button icon={CheckCircle2} onClick={reset}>
              Import another file
            </Button>
          ) : null}
          {file && phase.kind !== 'APPLIED' && !busy ? (
            <Button variant="ghost" onClick={reset}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
