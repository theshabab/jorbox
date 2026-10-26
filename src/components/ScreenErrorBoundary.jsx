import { Component } from 'react';

// A cached page can reference a lazy chunk that is no longer available after a
// deployment. Keep navigation usable and provide recovery instead of a blank app.
export default class ScreenErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed)
      return (
        <section className="empty-state glass-panel" role="alert">
          <h2>This screen couldn’t load</h2>
          <p>Check your connection, then reload to try again.</p>
          <button className="btn-primary" onClick={() => location.reload()}>
            Reload JorBox
          </button>
        </section>
      );
    return this.props.children;
  }
}
