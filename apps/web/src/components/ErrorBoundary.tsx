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
      <main className="recovery-screen" role="alert">
        <p className="eyebrow">Counter recovery</p>
        <h1>This screen stopped unexpectedly.</h1>
        <p>Your cart is stored on this terminal. Reload to continue without rebuilding it.</p>
        <button className="primary-button" onClick={() => window.location.reload()}>
          Reload counter
        </button>
      </main>
    );
  }
}
