import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AuthGuard from './auth/AuthGuard.jsx';
import LoginPage from './auth/LoginPage.jsx';
import AppShell from './layouts/AppShell.jsx';
import HomePage from './modules/home/HomePage.jsx';
import ScaleBooksApp from './modules/scalebooks/ScaleBooksApp.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <AuthGuard>
              <Routes>
                <Route path="/" element={<Navigate to="/scalebooks" replace />} />
                <Route path="/scalebooks/*" element={<ScaleBooksApp />} />
                {/* Legacy redirects */}
                <Route path="/accounting" element={<Navigate to="/scalebooks" replace />} />
                <Route path="/billing" element={<Navigate to="/scalebooks/billing" replace />} />
                <Route path="/payroll" element={<AppShell><div style={{ padding: 32, color: '#64748b' }}>Payroll — managed by another team. Handoff pending.</div></AppShell>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
