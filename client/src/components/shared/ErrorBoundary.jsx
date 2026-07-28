import { Component } from 'react';
import { RefreshCcw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Unhandled render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: 14,
            fontFamily: 'DM Sans, sans-serif',
            textAlign: 'center',
            padding: 24,
          }}
        >
          <h2 style={{ margin: 0 }}>حصل خطأ غير متوقع</h2>
          <p style={{ color: '#6b7280', maxWidth: 380, margin: 0 }}>حاول تحدّث الصفحة. لو المشكلة استمرت، كلم الدعم الفني.</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              borderRadius: 12,
              border: 'none',
              background: '#6C5CE7',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <RefreshCcw size={16} /> تحديث الصفحة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
