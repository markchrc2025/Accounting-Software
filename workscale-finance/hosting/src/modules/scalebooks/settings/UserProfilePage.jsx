import { useState, useEffect } from 'react';
import { getMe, getSettings, listUsers } from '../../../lib/api.js';

// ─── Section card ─────────────────────────────────────────────────────────────
function Card({ title, children }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
      <h2 className="text-[15px] font-semibold text-[#1F2937] mb-5">{title}</h2>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function UserProfilePage() {
  // Identity — resolved from GET /auth/me; both fields are Admin-managed (read-only)
  const [myEmail,     setMyEmail]     = useState('');
  const [displayName, setDisplayName] = useState('');
  const [workEmail,   setWorkEmail]   = useState('');

  // Approval routing
  const [myRoutes,  setMyRoutes]  = useState([]);
  const [userNames, setUserNames] = useState({});   // email → display name
  const [routingLoading, setRoutingLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [meRes, settings, users] = await Promise.all([
          getMe(),
          getSettings().catch(() => null),
          listUsers().catch(() => []),   // 403 for non-admins → fall back to raw emails
        ]);
        if (cancelled) return;

        const u = meRes?.user || {};
        const email = (u.email || '').toLowerCase();
        setMyEmail(u.email || '');
        setDisplayName(u.fullName || '');
        setWorkEmail(u.profile?.workEmail || '');

        const routes = Array.isArray(settings?.approvalRouting?.routes)
          ? settings.approvalRouting.routes
          : [];
        setMyRoutes(routes.filter(r => (r.makerEmail ?? '').toLowerCase() === email));

        const names = {};
        (users || []).forEach(x => {
          if (x.email) names[x.email.toLowerCase()] = x.fullName || x.email;
        });
        setUserNames(names);
      } catch { /* silent */ } finally {
        if (!cancelled) setRoutingLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const nameFor = (email) => email
    ? (userNames[(email ?? '').toLowerCase()] || email)
    : '—';

  // ── Initials avatar ────────────────────────────────────────────────────────
  const initials = (displayName || myEmail || 'U')
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
            {displayName || 'Your Profile'}
          </h1>
          <p className="text-sm text-[#6B7280]">{myEmail}</p>
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
                {displayName || myEmail || '—'}
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

        {/* ── Password — managed by workspace Admins ───────────────────── */}
        <Card title="Password">
          <p className="text-sm text-[#6B7280] leading-relaxed">
            Passwords are managed by your workspace Admin. If you need a new one, ask an Admin
            to reset it in Settings → Users &amp; Roles.
          </p>
        </Card>

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
