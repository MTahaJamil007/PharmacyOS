import type { CartLine } from '../../store';
import { formatPkrMoney } from '../../money';

export function CollectionTicketDialog({
  orderNumber,
  customerName,
  total,
  lines,
  onClose,
}: {
  readonly orderNumber: string;
  readonly customerName: string | null;
  readonly total: string;
  readonly lines: readonly CartLine[];
  readonly onClose: () => void;
}): React.JSX.Element {
  return (
    <div
      className="collection-ticket-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Medicine collection ticket"
    >
      <article className="collection-ticket-paper">
        <p className="eyebrow">Medicine collection ticket · not a tax invoice</p>
        <h1>Order #{orderNumber}</h1>
        <p>
          Collect the medicines below and take this ticket to the cashier for final invoice and
          payment.
        </p>
        <p>
          <strong>Customer:</strong> {customerName || 'Walk-in'}
        </p>
        <p>
          <strong>Order time:</strong> {new Date().toLocaleString('en-PK')}
        </p>
        <table>
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Qty</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.medicine.id}>
                <td>
                  {line.medicine.name} {line.medicine.strength}
                  {line.dosage ? ` · ${line.dosage}` : ''}
                </td>
                <td>{line.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="collection-ticket-total">
          <strong>Estimated total:</strong> {formatPkrMoney(total)}
        </p>
        <p className="safety-note">
          Prices and stock are confirmed by the cashier. Payment and the finalized customer invoice
          are still pending.
        </p>
        <div className="collection-ticket-controls">
          <button className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button className="primary-button" onClick={() => window.print()}>
            Print collection ticket
          </button>
        </div>
      </article>
    </div>
  );
}
