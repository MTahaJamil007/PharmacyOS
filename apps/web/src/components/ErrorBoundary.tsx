import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Counter render failure', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="error-screen" role="alert">
        <section className="card">
          <header className="card-header">
            <div>
              <h2>This screen stopped unexpectedly.</h2>
              <p>Your cart and any sale in progress are kept on this terminal.</p>
            </div>
          </header>
          <div className="card-body">
            <p>
              Reload to continue. If the same screen stops again, note what you were doing and
              contact support; nothing has been charged twice.
            </p>
          </div>
          <footer className="card-footer">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload counter
            </button>
          </footer>
        </section>
      </div>
    );
  }
}
