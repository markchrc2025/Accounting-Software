import { useAuth } from './AuthProvider.jsx';

/** Shown after sign-in when the identity belongs to more than one workspace. */
export default function WorkspacePicker() {
  const { workspaces, chooseWorkspace, signOut, session, authError } = useAuth();
  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>Choose a workspace</h1>
        <p style={s.sub}>
          {session?.user?.email ? `Signed in as ${session.user.email}. ` : ''}
          You have access to {workspaces.length} workspaces.
        </p>
        {authError && <div style={s.err}>{authError}</div>}
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {workspaces.map((w) => (
            <button key={w.id} onClick={() => chooseWorkspace(w.id)} style={s.item}>
              <span>
                <span style={s.name}>{w.name}</span>
                <span style={s.code}>{w.code}</span>
              </span>
              <span style={s.role}>{w.role}</span>
            </button>
          ))}
        </div>
        <button onClick={() => signOut()} style={s.signout}>Sign out</button>
      </div>
    </div>
  );
}

const s = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6fbf8', fontFamily: "'Inter', sans-serif", padding: 24 },
  card: { width: '100%', maxWidth: 420, background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 10px 40px rgba(15,23,42,0.08)', border: '1px solid #eef2f7' },
  title: { fontSize: 20, fontWeight: 800, color: '#0f172a', margin: '0 0 4px' },
  sub: { fontSize: 13, color: '#475569', margin: '0 0 16px' },
  err: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 12 },
  item: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', textAlign: 'left', padding: '12px 14px', borderRadius: 12, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer' },
  name: { display: 'block', fontSize: 14, fontWeight: 700, color: '#0f172a' },
  code: { display: 'block', fontSize: 12, color: '#94a3b8' },
  role: { fontSize: 12, fontWeight: 600, color: '#10b981', textTransform: 'capitalize' },
  signout: { marginTop: 18, width: '100%', background: 'none', border: 'none', color: '#64748b', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
};
