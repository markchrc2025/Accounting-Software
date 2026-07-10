import { useAuth } from "./AuthProvider";
import "./login.css";

/**
 * Sign-in screen for the OIDC redirect flow. Credentials are entered on
 * Authenticize's hosted page, so this is just a branded launch point: the button
 * sends the browser to <API>/auth/login, which redirects to Authenticize.
 */

const BooksGlyph = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 6.6 C9.6 4.9 6.2 4.7 3.8 5.7 V17.9 C6.2 17 9.6 17.2 12 18.9 C14.4 17.2 17.8 17 20.2 17.9 V5.7 C17.8 4.7 14.4 4.9 12 6.6 Z"
      fill="none"
      stroke="#F7F3EF"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M12 6.6 V18.9" fill="none" stroke="#9DB8FF" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ShieldIcon = () => (
  <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
    <path d="M10 2l6 2.5v4.2c0 3.7-2.5 7-6 8.3-3.5-1.3-6-4.6-6-8.3V4.5L10 2z" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

const WarningIcon = () => (
  <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
    <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 5.5v5.2M10 13.6v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

function BrandPanel() {
  return (
    <div className="sn-brand">
      <div className="sn-brand-tex" aria-hidden="true" />

      <div className="sn-brand-top">
        <span className="sn-prodlock">
          <span className="sn-prodchip">
            <BooksGlyph size={20} />
          </span>
          <span className="sn-prodword">
            Sentire <b>Books</b>
          </span>
        </span>
        <span className="sn-env">Workspace</span>
      </div>

      <div className="sn-brand-mid">
        <h1 className="sn-headline">
          Your books,
          <br />
          balanced.
        </h1>
        <p className="sn-subhead">
          Invoices, expenses and reconciliation — accurate, audit-ready accounting that keeps itself
          in order.
        </p>
      </div>

      <div className="sn-brand-foot">
        <span className="sn-trust">
          <i />
          Double-entry ledger
        </span>
        <span className="sn-trust">
          <i />
          SOC 2 Type II
        </span>
        <span className="sn-trust">
          <i />
          Bank-grade encryption
        </span>
      </div>
    </div>
  );
}

function LoginForm() {
  const { login, authError } = useAuth();

  return (
    <div className="sn-form-wrap">
      <div className="sn-form-head">
        <h2 className="sn-title">Sign in</h2>
        <p className="sn-sub">Continue to your workspace with your Sentire account.</p>
      </div>

      {authError && (
        <div className="sn-alert" role="alert">
          <WarningIcon />
          <span>{authError}</span>
        </div>
      )}

      <button type="button" className="sn-submit" onClick={() => login()}>
        Sign in with Sentire
      </button>

      <p className="sn-switch">
        Trouble signing in? Contact your workspace admin — access is granted by invitation.
      </p>

      <p className="sn-legal">
        <ShieldIcon />
        Protected by Sentire. Your financial records are encrypted end-to-end.
      </p>
    </div>
  );
}

export function LoginPage() {
  return (
    <div className="sn-screen" data-mode="books">
      <div className="sn-layout">
        <BrandPanel />
        <div className="sn-pane">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
