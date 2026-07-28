import { Navigate } from 'react-router-dom';
import useAuthStore from '../store/authStore';

export default function ProtectedRoute({ children }) {
  const { token, user } = useAuthStore();
  if (!token || !user) {
    return <Navigate to="/" replace />;
  }
  return children;
}
