import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthProvider.jsx';
import WorkspacePicker from './WorkspacePicker.jsx';

/**
 * Gate the app on an Authenticize session that resolves to a workspace. The
 * allowlist check now happens server-side (GET /auth/me against app_users) — the
 * provider surfaces "not on the list" as an auth error on the login screen.
 */
export default function AuthGuard({ children }) {
  const { phase } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (phase === 'anon') navigate('/login', { replace: true });
  }, [phase, navigate]);

  if (phase === 'loading' || phase === 'verifying') {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', color: '#64748b' }}>
        Loading…
      </div>
    );
  }
  if (phase === 'choosing') return <WorkspacePicker />;
  if (phase !== 'ready') return null; // 'anon' → redirecting to /login
  return children;
}
