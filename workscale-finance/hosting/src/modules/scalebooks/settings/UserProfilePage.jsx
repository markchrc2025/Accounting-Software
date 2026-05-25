import { useState, useEffect } from 'react';
import {
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { doc, getDoc, getDocs, onSnapshot, collection, query, where, orderBy } from 'firebase/firestore';
import { auth, db } from '../../../firebase.js';

// ─── Section card ─────────────────────────────────────────────────────────────
function Card({ title, children }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
      <h2 className="text-[15px] font-semibold text-[#1F2937] mb-5">{title}</h2>
      {children}
    </div>
  );
}

// ─── Form field ───────────────────────────────────────────────────────────────
function Field({ label, id, type = 'text', value, onChange, placeholder, autoComplete }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-[#374151]">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-9 rounded-lg border border-[#D1D5DB] bg-white px-3 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#F97316]/40 focus:border-[#F97316] transition-colors"
      />
    </div>
  );
}

// ─── Alert banner ─────────────────────────────────────────────────────────────
function Alert({ type, message }) {
  if (!message) return null;
  const styles = type === 'success'
    ? 'bg-green-50 border-green-200 text-green-700'
    : 'bg-red-50 border-red-200 text-red-700';
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${styles}`}>{message}</div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function UserProfilePage() {
  const user = auth.currentUser;

  // Detect Google / OAuth sign-in — hide Change Password for these users
  const isGoogleUser = user?.providerData?.some(p => p.providerId === 'google.com') ?? false;

  // Both fields are Admin-managed (read-only); source of truth is appUsers
  const [displayName, setDisplayName] = useState('');
  const [workEmail,   setWorkEmail]   = useState('');

  useEffect(() => {
    if (!user?.email) return;
    const q = query(collection(db, 'appUsers'), where('email', '==', user.email));
    const unsub = onSnapshot(q, snap => {
      const d = snap.docs[0]?.data();
      if (d) {
        setDisplayName(d.fullName || d.displayName || user.displayName || '');
        setWorkEmail(d.workEmail || '');
      } else {
        setDisplayName(user.displayName || '');
        setWorkEmail('');
      }
    });
    return unsub;
  }, [user?.email]);

  // Password fields
  const [currentPw,  setCurrentPw]  = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [confirmPw,  setConfirmPw]  = useState('');
  const [pwMsg,      setPwMsg]      = useState({ type: '', text: '' });
  const [pwBusy,     setPwBusy]     = useState(false);

  // Approval routing
  const [myRoutes,  setMyRoutes]  = useState([]);
  const [userNames, setUserNames] = useState({});   // email → display name
  const [routingLoading, setRoutingLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) return;
    async function load() {
      try {
        const [routingSnap, usersSnap] = await Promise.all([
          getDoc(doc(db, 'settings', 'approvalRouting')),
          getDocs(query(collection(db, 'appUsers'), orderBy('email'))),
        ]);
        const routes = routingSnap.exists() ? (routingSnap.data().routes ?? []) : [];
        const myEmail = user.email.toLowerCase();
        setMyRoutes(routes.filter(r => (r.makerEmail ?? '').toLowerCase() === myEmail));

        const names = {};
        usersSnap.docs.forEach(d => {
          const u = d.data();
          if (u.email) names[u.email.toLowerCase()] = u.fullName || u.displayName || u.email;
        });
        setUserNames(names);
      } catch { /* silent */ } finally {
        setRoutingLoading(false);
      }
    }
    load();
  }, [user?.email]);

  const nameFor = (email) => email
    ? (userNames[(email ?? '').toLowerCase()] || email)
    : '—';

  // ── Change password ────────────────────────────────────────────────────────
  async function handleChangePassword(e) {
    e.preventDefault();
    if (!user) return;
    if (newPw !== confirmPw) {
      setPwMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    if (newPw.length < 6) {
      setPwMsg({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }
    setPwBusy(true);
    setPwMsg({ type: '', text: '' });
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPw);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPw);
      setPwMsg({ type: 'success', text: 'Password changed successfully.' });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setPwMsg({ type: 'error', text: 'Current password is incorrect.' });
      } else {
        setPwMsg({ type: 'error', text: err.message });
      }
    } finally {
      setPwBusy(false);
    }
  }

  // ── Initials avatar ────────────────────────────────────────────────────────
  const initials = (user?.displayName || user?.email || 'U')
    .split(/[\s@]/).filter(Boolean).slice(0, 2)
    .map(w => w[0]).join('').toUpperCase() || 'U';

  return (
    <div className="px-8 py-10 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="h-14 w-14 rounded-full bg-[#F97316] text-white text-xl font-bold flex items-center justify-center shrink-0">
          {initials}
        </div>
        <div>
          <h1 className="text-[22px] font-bold text-[#1F2937] leading-tight">
            {user?.displayName || 'Your Profile'}
          </h1>
          <p className="text-sm text-[#6B7280]">{user?.email}</p>
          {isGoogleUser && (
            <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Signed in with Google
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* ── Profile information ──────────────────────────────────────── */}
        <Card title="Profile Information">
          <div className="flex flex-col gap-4">
            {/* Display Name — read-only; managed by Admin in Settings → Users & Roles */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-[#374151]">
                Display Name
                <span className="ml-2 text-[11px] font-normal text-[#9CA3AF]">Managed by Admin</span>
              </label>
              <div className="h-9 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 flex items-center text-sm text-[#6B7280] select-none cursor-not-allowed">
                {displayName || '—'}
              </div>
            </div>
            {/* Work Email — read-only; managed by Admin in Settings → Users & Roles */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-[#374151]">
                Work Email
                <span className="ml-2 text-[11px] font-normal text-[#9CA3AF]">Managed by Admin</span>
              </label>
              <div className="h-9 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 flex items-center text-sm text-[#6B7280] select-none cursor-not-allowed">
                {workEmail || '—'}
              </div>
            </div>
          </div>
        </Card>

        {/* ── Change password — hidden for Google/OAuth users ──────────── */}
        {!isGoogleUser && (
          <Card title="Change Password">
            <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
              <Field
                label="Current Password"
                id="currentPw"
                type="password"
                value={currentPw}
                onChange={setCurrentPw}
                placeholder="Enter current password"
                autoComplete="current-password"
              />
              <Field
                label="New Password"
                id="newPw"
                type="password"
                value={newPw}
                onChange={setNewPw}
                placeholder="At least 6 characters"
                autoComplete="new-password"
              />
              <Field
                label="Confirm New Password"
                id="confirmPw"
                type="password"
                value={confirmPw}
                onChange={setConfirmPw}
                placeholder="Repeat new password"
                autoComplete="new-password"
              />
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={pwBusy}
                  className="h-9 px-5 rounded-lg bg-[#1F2937] text-white text-sm font-semibold hover:bg-[#111827] disabled:opacity-50 transition-colors"
                >
                  {pwBusy ? 'Updating…' : 'Update password'}
                </button>
              </div>
              <Alert type={pwMsg.type} message={pwMsg.text} />
            </form>
          </Card>
        )}

        {/* ── Approval routing ─────────────────────────────────────────── */}
        <Card title="My Approval Routing">
          {routingLoading ? (
            <p className="text-sm text-[#6B7280]">Loading…</p>
          ) : myRoutes.length === 0 ? (
            <p className="text-sm text-[#6B7280]">
              No approval routing rules are assigned to your account yet. Ask an Admin to configure them in Settings → Users &amp; Roles.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {myRoutes.map((route, i) => (
                <div key={route.id ?? i} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 flex flex-col gap-2">
                  {/* Document type badge */}
                  <span className="inline-block self-start rounded-full bg-[#FFF7ED] border border-[#FED7AA] px-2.5 py-0.5 text-[11px] font-semibold text-[#C2410C] uppercase tracking-wide">
                    {route.documentType}
                  </span>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-0.5">Reviewer</p>
                      {route.autoBypass || !route.verifierEmail ? (
                        <span className="text-[#9CA3AF] italic text-[13px]">Auto-bypassed</span>
                      ) : (
                        <p className="font-medium text-[#1F2937] text-[13px]">{nameFor(route.verifierEmail)}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-0.5">Approver</p>
                      <p className="font-medium text-[#1F2937] text-[13px]">{nameFor(route.approverEmail)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
