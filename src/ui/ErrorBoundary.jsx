import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error('[ChatYouTube] Panel render failed', error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app" role="alert">
        <div className="hero">
          <div className="hero-inner">
            <h2>ChatYouTube couldn’t open</h2>
            <p>The panel encountered an error. Your saved settings are unchanged.</p>
            <button className="btn btn-primary" onClick={() => location.reload()}>Reload this page</button>
          </div>
        </div>
      </div>
    );
  }
}
