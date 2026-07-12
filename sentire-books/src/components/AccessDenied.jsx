import { useNavigate } from 'react-router-dom';

const ROLE_LABELS = {
  Maker:    { label: 'Maker',    desc: 'create & edit drafts',        color: '#0369a1', bg: '#f0f9ff', border: '#bae6fd' },
  Verifier: { label: 'Verifier', desc: 'review documents',            color: '#065f46', bg: '#ecfdf5', border: '#6ee7b7' },
  Approver: { label: 'Approver', desc: 'approve or reject',           color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  Poster:   { label: 'Poster',   desc: 'post entries to the ledger',  color: '#7e22ce', bg: '#fdf4ff', border: '#e9d5ff' },
};

export default function AccessDenied({ module: moduleName }) {
  const navigate = useNavigate();

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 16,
      fontFamily: 'Inter,system-ui,sans-serif', padding: '40px 24px',
      background: '#f8fafc',
    }}>
      {/* Icon */}
      <div style={{
        width: 72, height: 72, borderRadius: 20, background: '#fef2f2',
        border: '1.5px solid #fecaca', display: 'grid', placeItems: 'center',
        fontSize: 32,
      }}>
        🔒
      </div>

      {/* Heading */}
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 900, color: '#0b1220' }}>
          Access Restricted
        </h2>
        <p style={{ margin: 0, color: '#64748b', fontSize: 14, maxWidth: 380, lineHeight: 1.6 }}>
          You do not have permission to access
          {moduleName ? <><strong style={{ color: '#0b1220' }}> {moduleName}</strong></> : ' this module'}.
          Contact your administrator to request access.
        </p>
      </div>

      {/* Role legend */}
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14,
        padding: '16px 20px', maxWidth: 400, width: '100%',
      }}>
        <div style={{
          fontSize: 10, fontWeight: 900, color: '#94a3b8', letterSpacing: '.08em',
          textTransform: 'uppercase', marginBottom: 10,
        }}>
          Available Roles
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(ROLE_LABELS).map(([role, { label, desc, color, bg, border }]) => (
            <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: 999,
                fontSize: 11, fontWeight: 700, background: bg, color, border: `1px solid ${border}`,
                flexShrink: 0, minWidth: 68, textAlign: 'center',
              }}>
                {label}
              </span>
              <span style={{ fontSize: 12, color: '#64748b' }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            padding: '10px 20px', borderRadius: 10, border: 'none',
            background: '#f97316', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13,
          }}
        >
          ← Back to Dashboard
        </button>
      </div>
    </div>
  );
}
