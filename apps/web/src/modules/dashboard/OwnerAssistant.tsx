import { Bot, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { askOwnerAssistant, type OwnerAnswer, type OwnerTool } from '../../api';
import { Alert, Button, Card, DataTable, EmptyState, ErrorAlert } from '../../components/ui';
import { humanizeColumn, toReportTable } from '../reports/report-table';

const QUESTIONS: ReadonlyArray<{ readonly question: string; readonly tool: OwnerTool }> = [
  { question: 'What is most likely to run out soon?', tool: 'get_purchase_suggestions' },
  { question: 'Which batches need expiry action first?', tool: 'get_expiry_risk' },
  { question: 'Summarize sales for the last 30 days.', tool: 'get_sales_summary' },
  {
    question: 'Which shelf changes would save the most picking time?',
    tool: 'get_shelf_recommendations',
  },
];

/**
 * Read-only questions answered from whitelisted local reports. The optional AI explanation
 * only describes those facts; it cannot change stock, prices, orders or refunds.
 */
export function OwnerAssistant(): React.JSX.Element {
  const [selected, setSelected] = useState(0);
  const [answer, setAnswer] = useState<OwnerAnswer | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const current = QUESTIONS[selected] ?? QUESTIONS[0];
  const ask = async (index: number): Promise<void> => {
    const item = QUESTIONS[index];
    if (!item) return;
    setSelected(index);
    setLoading(true);
    setError(null);
    try {
      setAnswer(await askOwnerAssistant(item.question, item.tool));
    } catch (caught) {
      setAnswer(null);
      setError(caught);
    } finally {
      setLoading(false);
    }
  };
  const table = answer ? toReportTable(answer.facts) : null;
  return (
    <Card
      title="Ask about the business"
      description="Answers come from the shop's own records. Never used for clinical or dosing advice."
    >
      <div className="stack">
        <div className="row wrap">
          {QUESTIONS.map((item, index) => (
            <Button
              key={item.tool}
              size="sm"
              variant={selected === index && answer ? 'primary' : 'secondary'}
              icon={Sparkles}
              loading={loading && selected === index}
              onClick={() => void ask(index)}
            >
              {item.question}
            </Button>
          ))}
        </div>
        <ErrorAlert error={error} />
        {answer && table ? (
          <>
            <Alert tone="info" title={current?.question}>
              {answer.explanation ??
                'AI explanations are switched off. The figures below are the complete answer.'}
            </Alert>
            {table.columns.length > 0 ? (
              <DataTable
                caption="Facts"
                compact
                maxHeight={360}
                rows={table.rows.map((cells, index) => ({ cells, index }))}
                rowKey={(row) => String(row.index)}
                columns={table.columns.map((column, columnIndex) => ({
                  header:
                    column === 'Measure' || column === 'Value' ? column : humanizeColumn(column),
                  key: column,
                  render: (row: { readonly cells: readonly string[] }) =>
                    row.cells[columnIndex] ?? '—',
                }))}
              />
            ) : (
              <EmptyState icon={Bot} title="Nothing to report" />
            )}
            <span className="muted">{answer.dataBasis}</span>
          </>
        ) : !error ? (
          <span className="muted">Pick a question to see the current figures.</span>
        ) : null}
      </div>
    </Card>
  );
}
