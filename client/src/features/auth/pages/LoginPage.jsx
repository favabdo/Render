import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import AnimatedBackground from '../../../components/shared/AnimatedBackground';
import LanguageToggle from '../../../components/shared/LanguageToggle';
import ThemeToggle from '../../../components/shared/ThemeToggle';
import useAuthStore from '../../../store/authStore';
import { login } from '../services/auth.service';
import './LoginPage.css';

export default function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { token, user, setAuth } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyCode, setCompanyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // لو المستخدم مسجل دخول بالفعل، نوديه على الداشبورد على طول من غير ما نعرض فورم الدخول
  useEffect(() => {
    if (token && user) {
      navigate('/dashboard', { replace: true });
    }
  }, [token, user, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(email.trim(), password, companyCode.trim());
      setAuth(data.token, data.user);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || t('login.genericError'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page-bg">
      <AnimatedBackground />
      <div className="page-center">
        <div className="login-card">
          <div className="auth-toggle-bar">
            <LanguageToggle className="auth-toggle-btn" />
            <ThemeToggle className="auth-toggle-btn" />
          </div>
          <img src="/assets/logo.png" alt="NileChat" className="login-logo" />
          <h1>{t('login.title')}</h1>
          <div className="subtitle">{t('login.subtitle')}</div>

          <form id="login-form" autoComplete="on" onSubmit={handleSubmit}>
            <div className="field-wrap">
              <label className="field-label" htmlFor="login-company-code">
                {t('login.companyCodeLabel')}
              </label>
              <input
                type="text"
                className="login-input"
                id="login-company-code"
                placeholder="NTX7K2Q9PL"
                autoComplete="off"
                required
                style={{ textTransform: 'uppercase' }}
                value={companyCode}
                onChange={(e) => setCompanyCode(e.target.value)}
              />
            </div>
            <div className="field-wrap">
              <label className="field-label" htmlFor="login-email">
                {t('login.emailLabel')}
              </label>
              <input
                type="email"
                className="login-input"
                id="login-email"
                placeholder="agent@example.com"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field-wrap">
              <label className="field-label" htmlFor="login-password">
                {t('login.passwordLabel')}
              </label>
              <input
                type="password"
                className="login-input"
                id="login-password"
                placeholder="••••••••"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button type="submit" className={`login-btn${loading ? ' loading' : ''}`} id="login-btn" disabled={loading}>
              <span className="spinner"></span>
              <span className="btn-text">{t('login.submitButton')}</span>
            </button>

            <div className="login-error" id="login-error">
              {error}
            </div>
          </form>

          <div className="app-footer">{t('footer')}</div>
        </div>
      </div>
    </div>
  );
}
