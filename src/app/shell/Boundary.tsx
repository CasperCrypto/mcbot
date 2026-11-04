import { Component, type ReactNode } from "react";

/** One broken view must never blank the whole window. */
export class Boundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="main flush-left">
        <div className="empty">
          <h3>Something broke here</h3>
          <p className="mono" style={{ fontSize: 12 }}>{this.state.error.message}</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </section>
    );
  }
}
