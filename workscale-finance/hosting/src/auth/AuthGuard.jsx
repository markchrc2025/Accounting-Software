import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase.js';

export default function AuthGuard({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'allowed' | 'denied'
  const [denyReason, setDenyReason] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate('/login', { replace: true });
        return;
      }

      // Check if user exists in /users/{uid} collection
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        setStatus('allowed');
      } else {
        setStatus('denied');
        setDenyReason(user.email);
      }
    });
    return unsub;
  }, [navigate]);

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', color: '#64748b' }}>
        Loading…
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', gap: 12 }}>
        <div style={{ fontSize: 48 }}>🔒</div>
        <h2 style={{ margin: 0 }}>Access Denied</h2>
        <p style={{ color: '#666', margin: 0 }}>Your account (<strong>{denyReason}</strong>) is not authorised to access this portal.</p>
        <p style={{ color: '#999', fontSize: 12, margin: 0 }}>Contact your system administrator.</p>
        <button onClick={() => { auth.signOut(); navigate('/login'); }}
          style={{ marginTop: 8, padding: '10px 20px', borderRadius: 12, border: 'none', background: '#0b1220', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
          Sign out
        </button>
      </div>
    );
  }

  return children;
}
