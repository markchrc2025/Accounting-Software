// sentire-login.jsx — Sentire-branded login screens
// Exports (to window): SentireLoginScreen
// Modes: "tenant" (Sentire Payroll workspace) · "admin" (Sentire Central portal)
// Depends on: NexusMark, NexusWord (nexus-refined.jsx), ProductGlyph (sentire-logos.jsx)

const SN_DEMO = {
  tenant: { company: "acmefoods", email: "maria@acmefoods.com", password: "Acme2026!" },
  books: { company: "acmefoods", email: "liz@acmefoods.com", password: "Acme2026!" },
  admin: { email: "a.okafor@sentire.io", password: "Sentire2026" },
};
const SN_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SN_CORE = "#E8693A";

const SnGoogleIcon = () => (
  <svg viewBox="0 0 18 18" width="17" height="17" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
  </svg>
);
const SnMsIcon = () => (
  <svg viewBox="0 0 18 18" width="15" height="15" aria-hidden="true">
    <path fill="#F25022" d="M0 0h8.5v8.5H0z"/><path fill="#7FBA00" d="M9.5 0H18v8.5H9.5z"/>
    <path fill="#00A4EF" d="M0 9.5h8.5V18H0z"/><path fill="#FFB900" d="M9.5 9.5H18V18H9.5z"/>
  </svg>
);
const SnKeyIcon = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
    <circle cx="7.5" cy="10" r="4" fill="none" stroke="currentColor" strokeWidth="1.7"/>
    <path d="M11.5 10h6.5M15 10v3M17.5 10v2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none"/>
  </svg>
);
const SnSpinner = () => (
  <svg className="sn-spin" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.6" fill="none" opacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" />
  </svg>
);

// ---- brand panel -----------------------------------------------------------
function SnBrandPanel({ mode, texture }) {
  return (
    <div className="sn-brand" data-texture={texture ? "on" : "off"}>
      <div className="sn-brand-tex" aria-hidden="true"></div>

      <div className="sn-brand-top">
        {mode === "books" ? (
          <span className="sn-prodlock">
            <span className="sn-prodchip">
              <ProductGlyph product="Books" color="#F7F3EF" accent="#9DB8FF" size={20} />
            </span>
            <span className="sn-prodword">Sentire <b style={{ color: "#9DB8FF" }}>Books</b></span>
          </span>
        ) : mode === "tenant" ? (
          <span className="sn-prodlock">
            <span className="sn-prodchip">
              <ProductGlyph product="Payroll" color="#F7F3EF" accent="#7FC4A6" size={20} />
            </span>
            <span className="sn-prodword">Sentire <b>Payroll</b></span>
          </span>
        ) : (
          <span className="sn-prodlock">
            <NexusMark variant="mesh" size={30} lineW={3.4} onDark core={SN_CORE} />
            <span className="sn-prodword">Sentire <b style={{ color: "#F2A380" }}>Central</b></span>
          </span>
        )}
        <span className="sn-env">{mode === "admin" ? "Admin Console" : "Workspace"}</span>
      </div>

      <div className="sn-brand-mid">
        {mode === "books" ? (
          <>
            <h1 className="sn-headline">Your books,<br />balanced.</h1>
            <p className="sn-subhead">
              Invoices, expenses and reconciliation — accurate, audit-ready
              accounting that keeps itself in order.
            </p>
          </>
        ) : mode === "tenant" ? (
          <>
            <h1 className="sn-headline">Payday,<br />handled.</h1>
            <p className="sn-subhead">
              Approvals, filings and payslips for your whole team —
              one calm, connected place.
            </p>
          </>
        ) : (
          <>
            <div className="sn-bigmark">
              <NexusMark variant="mesh" size={120} lineW={3.4} onDark core={SN_CORE} />
            </div>
            <h1 className="sn-headline sn-headline-sm">Central Portal</h1>
            <p className="sn-subhead">
              Operations console for Sentire administrators —
              tenants, billing, releases and support tooling.
            </p>
          </>
        )}
      </div>

      <div className="sn-brand-foot">
        {mode === "books" ? (
          <>
            <span className="sn-trust"><i></i>Double-entry ledger</span>
            <span className="sn-trust"><i></i>SOC 2 Type II</span>
            <span className="sn-trust"><i></i>Bank-grade encryption</span>
          </>
        ) : mode === "tenant" ? (
          <>
            <span className="sn-trust"><i></i>SOC 2 Type II</span>
            <span className="sn-trust"><i></i>256-bit encryption</span>
            <span className="sn-trust"><i></i>99.99% uptime</span>
          </>
        ) : (
          <>
            <span className="sn-trust"><i></i>Restricted system</span>
            <span className="sn-trust"><i></i>All activity audited</span>
            <span className="sn-trust"><i></i>2FA enforced</span>
          </>
        )}
      </div>
    </div>
  );
}

// ---- form ------------------------------------------------------------------
function SnLoginForm({ mode }) {
  const demo = SN_DEMO[mode];
  const isTenant = mode !== "admin";
  const [company, setCompany] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [remember, setRemember] = React.useState(isTenant);
  const [touched, setTouched] = React.useState({});
  const [status, setStatus] = React.useState("idle");
  const [formErr, setFormErr] = React.useState("");
  const shakeRef = React.useRef(null);

  const emailErr = touched.email && !SN_EMAIL_RE.test(email)
    ? (email ? "Enter a valid email address." : "Email is required.") : "";
  const companyErr = isTenant && touched.company && company.trim() === ""
    ? "Company code is required." : "";
  const pwErr = touched.pw && pw.length < 8
    ? (pw ? "Password must be at least 8 characters." : "Password is required.") : "";
  const busy = status === "loading";

  function shake() {
    if (!shakeRef.current) return;
    shakeRef.current.classList.remove("sn-shake");
    void shakeRef.current.offsetWidth;
    shakeRef.current.classList.add("sn-shake");
  }

  function submit(e) {
    e.preventDefault();
    setTouched({ email: true, pw: true, company: true });
    setFormErr("");
    const companyMissing = isTenant && company.trim() === "";
    if (companyMissing || !SN_EMAIL_RE.test(email) || pw.length < 8) { setStatus("error"); shake(); return; }
    setStatus("loading");
    setTimeout(() => {
      const companyOk = !isTenant || company.trim().toLowerCase() === demo.company;
      if (companyOk && email.trim().toLowerCase() === demo.email && pw === demo.password) {
        setStatus("success");
      } else {
        setStatus("error");
        setFormErr(mode === "admin"
          ? "Credentials not recognised. Admin accounts lock after 5 failed attempts."
          : "We couldn't verify those details. Check your company code, email and password and try again.");
        shake();
      }
    }, 1500);
  }

  function fillDemo() {
    if (isTenant) setCompany(demo.company.toUpperCase());
    setEmail(demo.email); setPw(demo.password);
    setTouched({}); setStatus("idle"); setFormErr("");
  }

  if (status === "success") {
    return (
      <div className="sn-form-wrap">
        <div className="sn-success">
          <svg viewBox="0 0 52 52" width="56" height="56" aria-hidden="true">
            <circle className="sn-suc-c" cx="26" cy="26" r="24" fill="none" strokeWidth="3" />
            <path className="sn-suc-k" d="M15 27l7.5 7.5L38 19" fill="none" strokeWidth="3.4"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2>{isTenant ? "Welcome back" : "Identity verified"}</h2>
          <p>{isTenant
            ? "Opening the Acme Foods workspace…"
            : "Approval sent to your device — confirm to continue."}</p>
          <div className="sn-redir-bar"><i></i></div>
        </div>
      </div>
    );
  }

  return (
    <div className="sn-form-wrap">
      <div className="sn-form-head">
        <h2 className="sn-title">{isTenant ? "Sign in" : "Administrator sign in"}</h2>
        <p className="sn-sub">{mode === "books"
          ? "Welcome back — your ledgers are up to date."
          : mode === "tenant"
          ? "Welcome back — your team's payroll is waiting."
          : "Authorized personnel only. Use your Sentire staff account."}</p>
      </div>

      {isTenant ? (
        <div className="sn-sso">
          <button type="button" className="sn-sso-btn" disabled={busy}><SnGoogleIcon /> Google</button>
          <button type="button" className="sn-sso-btn" disabled={busy}><SnMsIcon /> Microsoft</button>
        </div>
      ) : (
        <div className="sn-sso">
          <button type="button" className="sn-sso-btn sn-sso-wide" disabled={busy}>
            <SnKeyIcon /> Continue with company SSO
          </button>
        </div>
      )}

      <div className="sn-or"><span>{isTenant ? "or sign in with email" : "or use admin credentials"}</span></div>

      {formErr && (
        <div className="sn-alert" role="alert">
          <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
            <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.6"/>
            <path d="M10 5.5v5.2M10 13.6v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <span>{formErr}</span>
        </div>
      )}

      <form ref={shakeRef} className="sn-form" onSubmit={submit} noValidate>
        {isTenant && (
          <label className="sn-field">
            <span className="sn-label">Company code</span>
            <div className={"sn-input" + (companyErr ? " is-err" : "")}>
              <svg className="sn-input-ic" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
                <rect x="3" y="3.5" width="9" height="13" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 8h4.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H12M5.5 7h3M5.5 10h3M5.5 13h2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input type="text" autoComplete="organization" autoCapitalize="characters" spellCheck="false"
                     placeholder="e.g. ACMEFOODS" value={company} disabled={busy}
                     style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}
                     onChange={(e) => setCompany(e.target.value)}
                     onBlur={() => setTouched((t) => ({ ...t, company: true }))} />
            </div>
            {companyErr
              ? <span className="sn-err-txt">{companyErr}</span>
              : <span className="sn-hint">The workspace ID your admin gave you.</span>}
          </label>
        )}
        <label className="sn-field">
          <span className="sn-label">{isTenant ? "Work email" : "Staff email"}</span>
          <div className={"sn-input" + (emailErr ? " is-err" : "")}>
            <svg className="sn-input-ic" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <rect x="2.5" y="4.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M3 6l7 5 7-5" fill="none" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            <input type="email" inputMode="email" autoComplete="username"
                   placeholder={isTenant ? "you@company.com" : "name@sentire.io"}
                   value={email} disabled={busy}
                   onChange={(e) => setEmail(e.target.value)}
                   onBlur={() => setTouched((t) => ({ ...t, email: true }))} />
          </div>
          {emailErr && <span className="sn-err-txt">{emailErr}</span>}
        </label>

        <label className="sn-field">
          <span className="sn-label">Password</span>
          <div className={"sn-input" + (pwErr ? " is-err" : "")}>
            <svg className="sn-input-ic" viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
              <rect x="4" y="9" width="12" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M6.5 9V7a3.5 3.5 0 1 1 7 0v2" fill="none" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            <input type={show ? "text" : "password"} autoComplete="current-password"
                   placeholder="Enter your password" value={pw} disabled={busy}
                   onChange={(e) => setPw(e.target.value)}
                   onBlur={() => setTouched((t) => ({ ...t, pw: true }))} />
            <button type="button" className="sn-eye" tabIndex={-1} disabled={busy}
                    aria-label={show ? "Hide password" : "Show password"}
                    onClick={() => setShow((s) => !s)}>
              {show ? (
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                  <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
              ) : (
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                  <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M4 16L16 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          </div>
          {pwErr && <span className="sn-err-txt">{pwErr}</span>}
        </label>

        <div className="sn-row">
          <label className="sn-check">
            <input type="checkbox" checked={remember} disabled={busy}
                   onChange={(e) => setRemember(e.target.checked)} />
            <span className="sn-check-box" aria-hidden="true">
              <svg viewBox="0 0 14 14" width="11" height="11">
                <path d="M2.5 7.5l3 3 6-6.5" fill="none" stroke="#fff" strokeWidth="2.2"
                      strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
            Keep me signed in
          </label>
          <a className="sn-link" href="#" onClick={(e) => e.preventDefault()}>
            {isTenant ? "Forgot password?" : "Trouble signing in?"}
          </a>
        </div>

        <button type="submit" className="sn-submit" disabled={busy}>
          {busy ? (<><SnSpinner /> Verifying…</>) : (isTenant ? "Sign in to workspace" : "Sign in to portal")}
        </button>

        <button type="button" className="sn-demo" onClick={fillDemo} disabled={busy}>
          Use demo credentials
        </button>
      </form>

      <p className="sn-legal">
        <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
          <path d="M10 2l6 2.5v4.2c0 3.7-2.5 7-6 8.3-3.5-1.3-6-4.6-6-8.3V4.5L10 2z"
                fill="none" stroke="currentColor" strokeWidth="1.4"/>
        </svg>
        {mode === "books"
          ? "Protected by Sentire. Your financial records are encrypted end-to-end."
          : mode === "tenant"
          ? "Protected by Sentire. Your payroll data is encrypted end-to-end."
          : "Restricted system. Sessions are monitored and logged for security."}
      </p>
    </div>
  );
}

function SentireLoginScreen({ mode = "tenant", density = "regular", texture = true, tenantAccent = "sage" }) {
  const accent = mode === "admin" ? "orange" : mode === "books" ? "blue" : tenantAccent;
  return (
    <div className="sn-screen" data-density={density} data-accent={accent} data-mode={mode}>
      <div className="sn-layout">
        <SnBrandPanel mode={mode} texture={texture} />
        <div className="sn-pane">
          <SnLoginForm mode={mode} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SentireLoginScreen });
