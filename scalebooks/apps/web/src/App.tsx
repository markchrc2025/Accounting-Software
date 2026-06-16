import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { JournalPage } from "./pages/JournalPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ContactsPage } from "./pages/ContactsPage";
import { VouchersPage } from "./pages/VouchersPage";
import { LoginPage } from "./auth/LoginPage";
import { authEnabled, useAuth } from "./auth/AuthProvider";

function Nav() {
  const { session, signOut } = useAuth();
  const link = (isActive: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${
      isActive ? "bg-primary-subtle text-primary" : "text-[#6B7280] hover:text-[#1F2937]"
    }`;
  return (
    <header className="flex h-14 items-center gap-6 border-b border-[#E5E7EB] bg-white px-6">
      <span className="text-lg font-semibold">ScaleBooks</span>
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
  const { session, loading } = useAuth();

  // When auth is configured, require a session; otherwise (local dev) render directly.
  if (authEnabled) {
    if (loading) {
      return (
        <div className="flex min-h-screen items-center justify-center font-sans text-sm text-[#6B7280]">
          Loading…
        </div>
      );
    }
    if (!session) return <LoginPage />;
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
        <Route path="*" element={<Navigate to="/journal" replace />} />
      </Routes>
    </div>
  );
}
