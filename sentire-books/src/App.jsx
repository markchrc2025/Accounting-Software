import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider.jsx';
import AuthGuard from './auth/AuthGuard.jsx';
import LoginPage from './auth/LoginPage.jsx';
import AppShell from './layouts/AppShell.jsx';
import ScaleBooksApp from './modules/scalebooks/ScaleBooksApp.jsx';

// Old /scalebooks/* deep links keep working: strip the legacy prefix and
// forward to the same page at its new top-level path.
function LegacyPrefixRedirect() {
  const rest = useParams()['*'] || '';
  return <Navigate to={`/${rest}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <AuthGuard>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                {/* Legacy redirects — bookmarks from the /scalebooks era still resolve */}
                <Route path="/scalebooks" element={<Navigate to="/dashboard" replace />} />
                <Route path="/scalebooks/*" element={<LegacyPrefixRedirect />} />
                <Route path="/accounting" element={<Navigate to="/dashboard" replace />} />
                <Route path="/payroll" element={<AppShell><div style={{ padding: 32, color: '#64748b' }}>Payroll — managed by another team. Handoff pending.</div></AppShell>} />
                {/* The portal owns every other route at the top level */}
                <Route path="/*" element={<ScaleBooksApp />} />
              </Routes>
            </AuthGuard>
          }
        />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
