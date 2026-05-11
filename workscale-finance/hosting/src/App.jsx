import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AuthGuard from './auth/AuthGuard.jsx';
import LoginPage from './auth/LoginPage.jsx';
import AppShell from './layouts/AppShell.jsx';
import HomePage from './modules/home/HomePage.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <AuthGuard>
              <AppShell>
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/accounting" element={<div style={{ padding: 32 }}>Accounting — coming soon</div>} />
                  <Route path="/payroll" element={<div style={{ padding: 32 }}>Payroll — coming soon</div>} />
                  <Route path="/billing" element={<div style={{ padding: 32 }}>Billing Book — coming soon</div>} />
                  <Route path="/projections" element={<div style={{ padding: 32 }}>Projections — coming soon</div>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppShell>
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
