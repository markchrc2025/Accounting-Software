import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { JournalPage } from "./pages/JournalPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ContactsPage } from "./pages/ContactsPage";
import { VouchersPage } from "./pages/VouchersPage";
import { AccountsPage } from "./pages/AccountsPage";
import { LoginPage } from "./auth/LoginPage";
import { authEnabled, useAuth } from "./auth/AuthProvider";

function Nav() {
  const { session, org, signOut } = useAuth();
  const link = (isActive: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${
      isActive ? "bg-primary-subtle text-primary" : "text-[#6B7280] hover:text-[#1F2937]"
    }`;
  return (
    <header className="flex h-14 items-center gap-6 border-b border-[#E5E7EB] bg-white px-6">
      <span className="flex items-baseline gap-2">
        <span className="text-lg font-semibold">Sentire Books</span>
        {org && (
          <span className="text-xs font-medium text-[#9CA3AF]" title={`Workspace: ${org.code}`}>
            {org.name}
          </span>
        )}
      </span>
      <nav className="flex gap-1">
        <NavLink to="/journal" className={({ isActive }) => link(isActive)}>
          Journal
        </NavLink>
        <NavLink to="/vouchers" className={({ isActive }) => link(isActive)}>
          Vouchers
        </NavLink>
        <NavLink to="/reports" className={({ isActive }) => link(isActive)}>
          Reports
        </NavLink>
        <NavLink to="/contacts" className={({ isActive }) => link(isActive)}>
          Contacts
        </NavLink>
        <NavLink to="/accounts" className={({ isActive }) => link(isActive)}>
          Accounts
        </NavLink>
      </nav>
      {authEnabled && (
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-[#6B7280]">{session?.user?.email}</span>
          <button
            onClick={() => void signOut()}
            className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-sm font-medium text-[#6B7280] hover:text-[#1F2937]"
          >
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}

export function App() {
  const { session, phase } = useAuth();

  // When auth is configured, require a verified session; otherwise (local dev)
  // render directly.
  if (authEnabled) {
    if (phase === "loading" || phase === "verifying") {
      return (
        <div className="flex min-h-screen items-center justify-center font-sans text-sm text-[#6B7280]">
          {phase === "verifying" ? "Opening your workspace…" : "Loading…"}
        </div>
      );
    }
    if (phase !== "ready" || !session) return <LoginPage />;
  }

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#1F2937]">
      <Nav />
      <Routes>
        <Route path="/" element={<Navigate to="/journal" replace />} />
        <Route path="/journal" element={<JournalPage />} />
        <Route path="/vouchers" element={<VouchersPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/accounts" element={<AccountsPage />} />
        <Route path="*" element={<Navigate to="/journal" replace />} />
      </Routes>
    </div>
  );
}
