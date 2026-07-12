import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";
import "./login.css";

const SN_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── inline SVG icons (no icon library) ───────────────────────────────────────
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
const BuildingIcon = () => (
  <svg className="sn-input-ic" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
    <rect x="3" y="3.5" width="9" height="13" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M12 8h4.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H12M5.5 7h3M5.5 10h3M5.5 13h2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const EnvelopeIcon = () => (
  <svg className="sn-input-ic" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3 6l7 5 7-5" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
const PadlockIcon = () => (
  <svg className="sn-input-ic" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
    <rect x="4" y="9" width="12" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6.5 9V7a3.5 3.5 0 1 1 7 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);
const EyeIcon = ({ off = false }: { off?: boolean }) => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    {off && <path d="M4 16L16 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
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
const Spinner = () => (
  <svg className="sn-spin" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.6" fill="none" opacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" />
  </svg>
);
const GoogleIcon = () => (
  <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
  </svg>
);
const MicrosoftIcon = () => (
  <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
    <path fill="#F25022" d="M0 0h8.5v8.5H0z" />
    <path fill="#7FBA00" d="M9.5 0H18v8.5H9.5z" />
    <path fill="#00A4EF" d="M0 9.5h8.5V18H0z" />
    <path fill="#FFB900" d="M9.5 9.5H18V18H9.5z" />
  </svg>
);

function mapError(code: string): string {
  switch (code) {
    case "invalid_credentials":
      return "We couldn't verify those details. Check your email and password and try again.";
    case "network":
      return "Couldn't reach the server. Check your connection and try again.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

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

type Status = "idle" | "loading";

function LoginForm() {
  const { signInPassword, authError, clearAuthError } = useAuth();

  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState<{ company?: boolean; email?: boolean; pw?: boolean }>({});
  const [status, setStatus] = useState<Status>("idle");
  const [formErr, setFormErr] = useState("");
  const [ssoNote, setSsoNote] = useState("");

  const emailErr =
    touched.email && !SN_EMAIL_RE.test(email) ? (email ? "Enter a valid email address." : "Email is required.") : "";
  const companyErr = touched.company && company.trim() === "" ? "Company code is required." : "";
  const pwErr = touched.pw && pw.length < 8 ? (pw ? "Password must be at least 8 characters." : "Password is required.") : "";
  const busy = status === "loading";
  const shownErr = formErr || (authError ?? "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({ company: true, email: true, pw: true });
    setFormErr("");
    clearAuthError();
    if (company.trim() === "" || !SN_EMAIL_RE.test(email) || pw.length < 8) return;

    setStatus("loading");
    const { error } = await signInPassword(company, email, pw);
    if (error) {
      setStatus("idle");
      setFormErr(mapError(error));
      return;
    }
    // Success: AuthProvider resolves the workspace and App.tsx takes over.
  }

  return (
    <div className="sn-form-wrap">
      <div className="sn-form-head">
        <h2 className="sn-title">Sign in</h2>
        <p className="sn-sub">Welcome back — your ledgers are up to date.</p>
      </div>

      {shownErr && (
        <div className="sn-alert" role="alert">
          <WarningIcon />
          <span>{shownErr}</span>
        </div>
      )}

      <form className="sn-form" onSubmit={submit} noValidate>
        <label className="sn-field">
          <span className="sn-label">Company code</span>
          <div className={"sn-input" + (companyErr ? " is-err" : "")}>
            <BuildingIcon />
            <input
              type="text"
              autoComplete="organization"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="e.g. ACMEFOODS"
              value={company}
              disabled={busy}
              style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
              onChange={(e) => {
                setCompany(e.target.value);
                if (authError) clearAuthError();
              }}
              onBlur={() => setTouched((t) => ({ ...t, company: true }))}
            />
          </div>
          {companyErr ? (
            <span className="sn-err-txt">{companyErr}</span>
          ) : (
            <span className="sn-hint">The workspace ID your admin gave you.</span>
          )}
        </label>

        <label className="sn-field">
          <span className="sn-label">Work email</span>
          <div className={"sn-input" + (emailErr ? " is-err" : "")}>
            <EnvelopeIcon />
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="you@company.com"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            />
          </div>
          {emailErr && <span className="sn-err-txt">{emailErr}</span>}
        </label>

        <label className="sn-field">
          <span className="sn-label">Password</span>
          <div className={"sn-input" + (pwErr ? " is-err" : "")}>
            <PadlockIcon />
            <input
              type={show ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={pw}
              disabled={busy}
              onChange={(e) => setPw(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, pw: true }))}
            />
            <button
              type="button"
              className="sn-eye"
              tabIndex={-1}
              disabled={busy}
              aria-label={show ? "Hide password" : "Show password"}
              onClick={() => setShow((s) => !s)}
            >
              <EyeIcon off={show} />
            </button>
          </div>
          {pwErr && <span className="sn-err-txt">{pwErr}</span>}
        </label>

        <button type="submit" className="sn-submit" disabled={busy}>
          {busy ? (
            <>
              <Spinner /> Verifying…
            </>
          ) : (
            "Sign in to workspace"
          )}
        </button>
      </form>

      <div className="sn-or">
        <span>or</span>
      </div>

      {/* Placeholders for now — sign-in is email/password. */}
      <div className="sn-sso">
        <button
          type="button"
          className="sn-sso-btn"
          disabled={busy}
          onClick={() => setSsoNote("Google sign-in isn't available yet — please use your email and password.")}
        >
          <GoogleIcon /> Google
        </button>
        <button
          type="button"
          className="sn-sso-btn"
          disabled={busy}
          onClick={() => setSsoNote("Microsoft sign-in isn't available yet — please use your email and password.")}
        >
          <MicrosoftIcon /> Microsoft
        </button>
      </div>
      {ssoNote && (
        <p className="sn-hint" style={{ textAlign: "center", marginTop: "10px" }}>
          {ssoNote}
        </p>
      )}

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
