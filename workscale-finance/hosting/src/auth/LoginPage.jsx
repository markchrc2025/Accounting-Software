import { signInWithPopup, onAuthStateChanged } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { auth, googleProvider } from '../firebase.js';

export default function LoginPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // If already signed in, skip login page immediately
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) navigate('/', { replace: true });
    });
    return unsub;
  }, [navigate]);

  async function handleGoogleLogin() {
    try {
      await signInWithPopup(auth, googleProvider);
      navigate('/', { replace: true });
    } catch (err) {
      alert('Sign-in failed: ' + err.message);
    }
  }

  return (
    <div style={{
      display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0b1220 0%, #0f1b31 100%)',
      fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: '48px 40px',
        width: 'min(400px, 92vw)', textAlign: 'center',
        boxShadow: '0 24px 64px rgba(0,0,0,.4)',
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14, background: '#f97316',
          display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 22,
          color: '#fff', margin: '0 auto 20px',
        }}>W</div>

        <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 900, color: '#0f172a' }}>
          Workscale Finance
        </h1>
        <p style={{ margin: '0 0 32px', fontSize: 13, color: '#64748b' }}>
          Sign in with your authorised Google account to continue.
        </p>

        <button onClick={handleGoogleLogin} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          width: '100%', padding: '13px 20px', borderRadius: 14,
          border: '1px solid #e5e7eb', background: '#fff',
          fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 700,
          color: '#0f172a', cursor: 'pointer', transition: 'background 0.15s',
        }}
          onMouseOver={e => e.currentTarget.style.background = '#f1f5f9'}
          onMouseOut={e => e.currentTarget.style.background = '#fff'}
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width={20} height={20} />
          Continue with Google
        </button>

        <p style={{ margin: '24px 0 0', fontSize: 11, color: '#94a3b8' }}>
          Only authorised accounts have access. Contact your admin if you need access.
        </p>
      </div>
    </div>
  );
}
