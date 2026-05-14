import { useEffect, useState } from 'react';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  OAuthProvider,
} from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth, googleProvider } from '../firebase.js';

const microsoftProvider = new OAuthProvider('microsoft.com');

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) navigate('/scalebooks', { replace: true });
    });
    return unsub;
  }, [navigate]);

  async function handleEmailLogin(e) {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate('/scalebooks', { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleMicrosoftLogin() {
    setError('');
    setBusy(true);
    try {
      await signInWithPopup(auth, microsoftProvider);
      navigate('/scalebooks', { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleLogin() {
    setError('');
    setBusy(true);
    try {
      await signInWithPopup(auth, googleProvider);
      navigate('/scalebooks', { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    setError('');
    if (!email) {
      setError('Enter your email above first, then click "Forgot password?".');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setError('Password reset email sent. Check your inbox.');
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <div style={styles.page}>
      <form onSubmit={handleEmailLogin} style={styles.card}>
        <div style={styles.brandRow}>
          <div style={styles.logoTile}>W</div>
          <div>
            <div style={styles.brandName}>Workscale</div>
            <div style={styles.brandTag}>SINGLE SIGN-ON</div>
          </div>
        </div>

        <p style={styles.subtitle}>
          Sign in to continue to <strong>accountingsystem.online</strong>
        </p>

        <label style={styles.label}>Email address</label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@workscale.ph"
          style={styles.input}
        />

        <div style={styles.passwordRow}>
          <label style={{ ...styles.label, marginBottom: 0 }}>Password</label>
          <button type="button" onClick={handleForgotPassword} style={styles.forgotLink}>
            Forgot password?
          </button>
        </div>
        <div style={styles.passwordWrap}>
          <input
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{ ...styles.input, paddingRight: 40, marginBottom: 0 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            style={styles.eyeBtn}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? eyeOffIcon : eyeIcon}
          </button>
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}

        <button type="submit" disabled={busy} style={styles.signInBtn}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div style={styles.divider}>
          <span style={styles.dividerLine} />
          <span style={styles.dividerText}>or</span>
          <span style={styles.dividerLine} />
        </div>

        <div style={styles.ssoRow}>
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={busy}
            style={styles.ssoBtn}
          >
            {googleIcon}
            <span>Google</span>
          </button>
          <button
            type="button"
            onClick={handleMicrosoftLogin}
            disabled={busy}
            style={styles.ssoBtn}
          >
            {microsoftIcon}
            <span>Microsoft</span>
          </button>
        </div>

        <p style={styles.footer}>Access is restricted to authorized personnel only.</p>
      </form>
    </div>
  );
}

function friendlyError(err) {
  const code = err?.code || '';
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return 'Invalid email or password.';
  }
  if (code === 'auth/invalid-email') return 'Please enter a valid email address.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please try again later.';
  if (code === 'auth/popup-closed-by-user') return 'Sign-in window was closed.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection.';
  return err?.message || 'Sign-in failed.';
}

const eyeIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const eyeOffIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a19.77 19.77 0 015.06-5.94M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 8 11 8a19.79 19.79 0 01-3.16 4.19M1 1l22 22" />
    <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
  </svg>
);

const microsoftIcon = (
  <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
    <rect x="1" y="1" width="10" height="10" fill="#F25022" />
    <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
    <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
    <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
  </svg>
);

const googleIcon = (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41.7 35.2 44 30 44 24c0-1.3-.1-2.4-.4-3.5z"/>
  </svg>
);

const styles = {
  page: {
    flex: 1,
    width: '100%',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background:
      'radial-gradient(circle at 30% 20%, #e6f7ef 0%, #f6fbf8 40%, #ffffff 75%)',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: 420,
    background: '#fff',
    borderRadius: 16,
    padding: '36px 36px 28px',
    boxShadow:
      '0 10px 40px rgba(15, 23, 42, 0.08), 0 2px 6px rgba(15, 23, 42, 0.04)',
    border: '1px solid #eef2f7',
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  logoTile: {
    width: 42,
    height: 42,
    borderRadius: 10,
    background: '#f97316',
    color: '#fff',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 900,
    fontSize: 20,
    letterSpacing: 0.5,
  },
  brandName: {
    fontSize: 18,
    fontWeight: 800,
    color: '#0f172a',
    lineHeight: 1.1,
  },
  brandTag: {
    fontSize: 10,
    fontWeight: 700,
    color: '#10b981',
    letterSpacing: 1.4,
    marginTop: 2,
  },
  subtitle: {
    fontSize: 13,
    color: '#475569',
    margin: '0 0 22px',
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#0f172a',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '11px 14px',
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    background: '#fff',
    fontSize: 14,
    color: '#0f172a',
    outline: 'none',
    marginBottom: 16,
    fontFamily: 'inherit',
  },
  passwordRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  forgotLink: {
    background: 'none',
    border: 'none',
    color: '#10b981',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
  },
  passwordWrap: {
    position: 'relative',
    marginBottom: 18,
  },
  eyeBtn: {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#94a3b8',
    padding: 6,
    display: 'grid',
    placeItems: 'center',
  },
  errorBox: {
    background: '#fef2f2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: 12,
    marginBottom: 14,
  },
  signInBtn: {
    width: '100%',
    padding: '12px',
    borderRadius: 10,
    border: 'none',
    background: '#10b981',
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '18px 0',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: '#e2e8f0',
  },
  dividerText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  ssoRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  },
  ssoBtn: {
    width: '100%',
    padding: '11px',
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    background: '#fff',
    color: '#0f172a',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  footer: {
    textAlign: 'center',
    fontSize: 11,
    color: '#94a3b8',
    margin: '22px 0 0',
  },
};
