import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS } from '@pharmacy/shared';
import { useMemo, useState } from 'react';

import { askOwnerAssistant, getFailedJobs, type OwnerAnswer, type OwnerTool } from '../../api';
import { usePharmacyStore } from '../../store';

const ownerQuestions: ReadonlyArray<{ readonly question: string; readonly tool: OwnerTool }> = [
  { question: 'What is most likely to run out soon?', tool: 'get_purchase_suggestions' },
  { question: 'Which batches need expiry action first?', tool: 'get_expiry_risk' },
  { question: 'Summarize sales for the last 30 days.', tool: 'get_sales_summary' },
  {
    question: 'Which shelf changes would save the most picking time?',
    tool: 'get_shelf_recommendations',
  },
];

export function OwnerAssistant(): React.JSX.Element {
  const session = usePharmacyStore((state) => state.session);
  const token = session?.accessToken ?? '';
  const canViewSystemHealth =
    session?.user.permissions.includes(PERMISSIONS.SETTINGS_MANAGE_SYSTEM) ?? false;
  const [selected, setSelected] = useState(0);
  const [answer, setAnswer] = useState<OwnerAnswer | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const failedJobs = useQuery({
    queryKey: ['operations', 'failed-jobs'],
    queryFn: () => getFailedJobs(token),
    enabled: canViewSystemHealth && Boolean(token),
    refetchInterval: 60_000,
  });
  const current = ownerQuestions[selected] ?? ownerQuestions[0];
  const ask = async (): Promise<void> => {
    if (!current) return;
    try {
      setLoading(true);
      setError('');
      setAnswer(await askOwnerAssistant(token, current.question, current.tool));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Assistant is unavailable');
    } finally {
      setLoading(false);
    }
  };
  const factsText = useMemo(() => (answer ? JSON.stringify(answer.facts, null, 2) : ''), [answer]);
  return (
    <section className="operations-canvas assistant-canvas" aria-label="Owner assistant">
      <section className="operations-heading">
        <div>
          <p className="eyebrow">Owner-only · read-only</p>
          <h1>Ask about operations, never medicine.</h1>
          <p>
            Whitelisted local reports produce the facts. AI may explain them but cannot write,
            order, refund, or change stock.
          </p>
        </div>
      </section>
      {canViewSystemHealth ? (
        <section className="job-health-panel" aria-label="Background job health">
          <div className="attention-ledger">
            <article
              className={
                failedJobs.data?.summary.failed ? 'attention-cell critical' : 'attention-cell'
              }
            >
              <span>Failed jobs</span>
              <strong>{failedJobs.data?.summary.failed ?? '—'}</strong>
            </article>
            <article className="attention-cell warning">
              <span>Retrying</span>
              <strong>{failedJobs.data?.summary.retryable ?? '—'}</strong>
            </article>
            <article className="attention-cell">
              <span>Processing</span>
              <strong>{failedJobs.data?.summary.processing ?? '—'}</strong>
            </article>
            <article
              className={
                failedJobs.data?.summary.staleProcessing
                  ? 'attention-cell critical'
                  : 'attention-cell'
              }
            >
              <span>Stale locks</span>
              <strong>{failedJobs.data?.summary.staleProcessing ?? '—'}</strong>
            </article>
          </div>
          {failedJobs.error ? (
            <p className="inline-error">Background job status is unavailable.</p>
          ) : failedJobs.data?.jobs[0] ? (
            <p className="job-health-latest">
              Latest failure: <strong>{failedJobs.data.jobs[0].jobType}</strong> ·{' '}
              {failedJobs.data.jobs[0].lastError ?? 'No error detail was recorded'}
            </p>
          ) : (
            <p className="job-health-latest">No failed background jobs require review.</p>
          )}
        </section>
      ) : null}
      <section className="assistant-layout">
        <aside className="question-rail">
          <p className="eyebrow">Suggested questions</p>
          {ownerQuestions.map((item, index) => (
            <button
              className={selected === index ? 'selected' : ''}
              key={item.tool}
              onClick={() => setSelected(index)}
            >
              {item.question}
            </button>
          ))}
        </aside>
        <article className="assistant-answer">
          <header>
            <span>Operational question</span>
            <h2>{current?.question}</h2>
            <button className="primary-button" disabled={loading} onClick={() => void ask()}>
              {loading ? 'Checking local facts…' : 'Get answer'}
            </button>
          </header>
          {error ? <p className="inline-error">{error}</p> : null}
          {answer ? (
            <>
              <section className="fact-block">
                <p className="eyebrow">Authoritative tool result</p>
                <pre>{factsText}</pre>
                <small>{answer.dataBasis}</small>
              </section>
              <section className="explanation-block">
                <p className="eyebrow">AI explanation</p>
                <p>
                  {answer.explanation ??
                    'AI is disabled. The deterministic result above remains available and authoritative.'}
                </p>
              </section>
            </>
          ) : (
            <p className="empty-state">
              Choose a question and get the current local facts. No customer-identifiable
              prescription or health data is sent to the provider.
            </p>
          )}
        </article>
      </section>
    </section>
  );
}
