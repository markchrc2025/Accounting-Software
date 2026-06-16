import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { JournalPage } from "./pages/JournalPage";
import { ReportsPage } from "./pages/ReportsPage";

function Nav() {
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
        <NavLink to="/reports" className={({ isActive }) => link(isActive)}>
          Reports
        </NavLink>
      </nav>
    </header>
  );
}

export function App() {
  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans text-[#1F2937]">
      <Nav />
      <Routes>
        <Route path="/" element={<Navigate to="/journal" replace />} />
        <Route path="/journal" element={<JournalPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="*" element={<Navigate to="/journal" replace />} />
      </Routes>
    </div>
  );
}
