import AppRouter from './routes/AppRouter';
import ErrorBoundary from './components/shared/ErrorBoundary';

export default function App() {
  return (
    <ErrorBoundary>
      <AppRouter />
    </ErrorBoundary>
  );
}
