# Handoff: Sentire Books — Login Page

## Overview
A tenant workspace sign-in screen for **Sentire Books** (the accounting/bookkeeping product in the Sentire suite). It pairs a dark branded marketing panel with a clean credential form. It supports SSO (Google/Microsoft), a company-code + email + password flow, inline validation, error/shake feedback, a loading state, and a success/redirect state. The screen is fully responsive: on narrow viewports the brand panel collapses to a compact header and the form fills the width.

## About the Design Files
The files in this bundle are **design references created in HTML/React (via in-browser Babel)** — prototypes showing the intended look and behavior. They are **not production code to copy directly**. The task is to **recreate this design in the target codebase's existing environment** (React, Vue, Svelte, SwiftUI, native, etc.) using its established components, tokens, and patterns. If no front-end environment exists yet, choose the most appropriate framework for the project and implement there.

The login UI is implemented as a shared React component (`sentire-login.jsx`) with a `mode` prop. Books uses `mode="books"`. The same component also renders `mode="tenant"` (Payroll) and `mode="admin"` (Central) — when reimplementing, you only need the Books mode unless you want to generalize.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, and interactions are specified below. Recreate pixel-perfectly using the codebase's existing libraries and patterns. Substitute the codebase's own form primitives where they exist, but match the visual spec.

## Screens / Views

### 1. Books Login — Desktop (default)
- **Purpose**: A workspace user signs in to their company's Sentire Books account.
- **Layout**: Full-bleed two-column CSS grid, `grid-template-columns: 0.82fr 1fr` (brand panel left, form pane right). Base font-size 15px. The whole screen is a container (`container-type: inline-size`) so the responsive switch is driven by container width, not viewport.
  - **Left — brand panel** (`.sn-brand`): `padding: 36px 40px`; vertical flex, `justify-content: space-between`; dark gradient background `linear-gradient(160deg, #2E241C 0%, #211A15 100%)`; text color `#F7F3EF`; `overflow: hidden; isolation: isolate`. A texture layer (`.sn-brand-tex`, z-index -1) sits behind: dotted radial grid `radial-gradient(rgba(247,243,239,0.13) 1.1px, transparent 1.1px)` at `26px 26px`, plus a warm orange glow `radial-gradient(60% 45% at 85% 0%, rgba(232,105,58,0.16), transparent 65%)`, masked with `radial-gradient(130% 100% at 0% 100%, #000 35%, transparent 80%)`.
  - **Right — form pane** (`.sn-pane`): centered flex; `padding: 36px 40px`; background `#ffffff`. Inner form wrap `max-width: 360px`.

#### Brand panel contents (Books)
- **Top lockup** (`.sn-brand-top`, space-between):
  - Product lockup: a 34×34 rounded chip (`border-radius: 9px`, `background: rgba(255,255,255,0.08)`, `border: 1px solid rgba(255,255,255,0.16)`) holding the **Books glyph** (open-book icon, see Assets) drawn at 20px in `#F7F3EF` with accent strokes `#9DB8FF`. Next to it the wordmark "Sentire **Books**" — `font-size: 17.5px`, base weight 500 color `#F7F3EF`, with "Books" weight 600 color `#9DB8FF`.
  - Environment chip: pill reading **WORKSPACE** — `font-size: 10.5px`, weight 600, `letter-spacing: 0.07em`, uppercase, color `rgba(247,243,239,0.6)`, `border: 1px solid rgba(247,243,239,0.18)`, `padding: 5px 10px`, `border-radius: 999px`.
  - **Mid** (`.sn-brand-mid`, vertically centered):
    - Headline: "Your books," / "balanced." (line break between) — weight 600, `font-size: 40px`, `line-height: 1.08`, `letter-spacing: -0.025em`, color `#F7F3EF`.
    - Subhead: "Invoices, expenses and reconciliation — accurate, audit-ready accounting that keeps itself in order." — Hanken Grotesk, `font-size: 14.5px`, `line-height: 1.6`, color `rgba(247,243,239,0.66)`, `max-width: 34ch`.
  - **Foot** (`.sn-brand-foot`, top border `1px solid rgba(247,243,239,0.14)`, `padding-top: 16px`): three trust chips, each Hanken Grotesk `11.5px` weight 500 color `rgba(247,243,239,0.6)`, prefixed by a 6px accent dot (`background: var(--acc)` = `#3F66D6`, with a soft ring `box-shadow: 0 0 0 3px` of the accent at 22%):
    - "Double-entry ledger" · "SOC 2 Type II" · "Bank-grade encryption"

#### Form pane contents
- **Form head** (`.sn-form-head`, `margin-bottom: 20px`):
  - Title `.sn-title`: "Sign in" — weight 600, `25px`, color `#2A2420`, `letter-spacing: -0.02em`.
  - Sub `.sn-sub`: "Welcome back — your ledgers are up to date." — Hanken Grotesk `14px`, color `#6B6259`.
- **SSO row** (`.sn-sso`, 2-col grid, `gap: 10px`): two buttons, "Google" (multicolor Google G) and "Microsoft" (4-square logo). Button `.sn-sso-btn`: white bg, `border: 1px solid #d8cfc2`, `border-radius: 10px`, `padding: 11px 12px`, `font-size: 14px` weight 600 color `#2A2420`. Hover: `background: #faf7f2; border-color: #c4b9a9`.
- **Divider** (`.sn-or`, `margin: 18px 0`): centered label "or sign in with email", Hanken Grotesk `12px` color `#9a9085`, flanked by `1px` rules `#e7e0d6`.
- **Error alert** (`.sn-alert`, conditional): warning icon + message; `background: #fbeceb`, color `#b23b34`, `border: 1px solid #f0c9c6`, `border-radius: 10px`, `padding: 11px 13px`, Hanken Grotesk `13px` weight 500.
- **Form** (`.sn-form`, vertical flex `gap: 15px`):
  1. **Company code** field — label "Company code"; input with a building/ledger icon; placeholder "e.g. ACMEFOODS"; input text is uppercased (`text-transform: uppercase; letter-spacing: 0.04em`); helper hint "The workspace ID your admin gave you." Validation: required.
  2. **Work email** field — label "Work email"; envelope icon; placeholder "you@company.com"; `type=email`. Validation: required + regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
  3. **Password** field — label "Password"; padlock icon; placeholder "Enter your password"; show/hide eye toggle on the right. Validation: required + min 8 chars.
  4. **Row** (`.sn-row`, space-between): "Keep me signed in" checkbox (checked by default for Books/tenant) + "Forgot password?" link.
  5. **Submit** (`.sn-submit`): full-width, height 48px, `background: var(--acc)` `#3F66D6`, white text, weight 600 `15px`, `border-radius: 10px`, shadow `0 10px 22px -12px` of accent at 70%. Label "Sign in to workspace"; while loading shows a spinner + "Verifying…".
  6. **Demo link** (`.sn-demo`): "Use demo credentials" — underlined Hanken Grotesk `12.5px` weight 600 color `#6B6259`, centered.
- **Legal line** (`.sn-legal`, `margin-top: 20px`): shield icon + "Protected by Sentire. Your financial records are encrypted end-to-end." — Hanken Grotesk `11.5px` color `#9a9085`.

#### Input styling (`.sn-input`)
- Flex row, `gap: 9px`, `background: #fcfaf7`, `border: 1px solid #d8cfc2`, `border-radius: 10px`, `padding: 0 12px`, `height: 46px`.
- Leading icon `#9a9085` (turns accent on focus).
- Input text: Instrument Sans `14.5px` color `#2A2420`; placeholder `#9a9085`.
- Focus-within: `border-color: var(--acc)`, `background: #fff`, `box-shadow: 0 0 0 3px rgba(63,102,214,0.20)`.
- Error (`.is-err`): `border-color: #b23b34`, `box-shadow: 0 0 0 3px rgba(178,59,52,0.12)`.

### 2. Books Login — Mobile (≤640px container)
- Layout switches to vertical flex.
- Brand panel becomes a compact horizontal header: `flex-direction: row`, `padding: 16px 20px`, showing only the product lockup + env chip (`.sn-brand-mid` and `.sn-brand-foot` are hidden).
- Form pane fills remaining space, top-aligned, `padding: 26px 22px 30px`, scrollable; form wrap `max-width: 420px` centered. Title scales to `23px`; inputs `48px`; submit `50px`.
- At ≤380px the SSO grid collapses to a single column.

### 3. Success state
Replaces the form after a valid sign-in. Centered: animated check (circle + checkmark draw-on, stroke `var(--acc)`), heading "Welcome back", text "Opening the Acme Foods workspace…", and a thin indeterminate progress bar (`.sn-redir-bar`) that fills over 1.6s.

## Interactions & Behavior
- **Validation timing**: fields validate on blur (`touched` map) and on submit. Submit marks all touched.
- **Submit flow**: if any field invalid → set error status + shake the form (`.sn-shake`, 0.4s). If all valid → loading state for 1500ms (mock), then compare against demo credentials. On match → success state. On mismatch → error status, shake, and form-level alert: "We couldn't verify those details. Check your company code, email and password and try again."
- **Show/hide password**: eye button toggles input `type` between `password` and `text` (icon swaps to a struck-through eye).
- **Use demo credentials**: fills company `ACMEFOODS`, email `liz@acmefoods.com`, password `Acme2026!`, resets touched/status.
- **Animations**: shake `0.4s ease`; success check stroke draw-on (`stroke-dashoffset` 0.5s + 0.35s delayed checkmark); redirect bar fill 1.6s; spinner `0.7s linear infinite`. All transitions on inputs/buttons are `.15s`.
- **Responsive**: container-query driven (see Mobile above), not viewport media queries — so it adapts inside any embed width.

## State Management
- `company`, `email`, `pw` (strings)
- `show` (bool — password visibility)
- `remember` (bool — defaults true for Books)
- `touched` (`{ company, email, pw }`)
- `status` (`"idle" | "loading" | "error" | "success"`)
- `formErr` (string — form-level alert message)
- Derived: `emailErr`, `companyErr`, `pwErr`, `busy` (status === "loading").
- Replace the mock `setTimeout` auth with a real auth request; map server errors to `formErr` and lockout messaging.

## Design Tokens
**Colors**
- Ink / text: `#2A2420`
- Muted: `#6B6259` · Muted-2: `#9a9085`
- Paper: `#ffffff` · Field bg: `#fcfaf7` · App bg: `#F2ECE4`
- Line: `#e7e0d6` · Line-strong: `#d8cfc2`
- Brand dark gradient: `#2E241C` → `#211A15`; on-dark text `#F7F3EF`
- **Books accent (blue):** `--acc: #3F66D6`, `--acc-press: #3151B4`, `--acc-soft: #ecf0fc`, focus ring `rgba(63,102,214,0.20)`
- Books wordmark/glyph accent on dark: `#9DB8FF`
- Brand texture warm glow: `rgba(232,105,58,…)` (Sentire core orange `#E8693A`)
- Danger: `#b23b34` · Danger-soft: `#fbeceb` · Danger border: `#f0c9c6`

**Typography**
- UI / headings: **Instrument Sans** (400/500/600/700)
- Body / supporting copy: **Hanken Grotesk** (400/500/600)
- Scale used: headline 40px/1.08; title 25px; SSO + inputs 14–14.5px; labels 12.5px; hints/legal 11.5–12px.

**Radius**: inputs/buttons/cards `10px`; product chip `9px`; checkbox `5px`; pills/dots `999px`.
**Shadows**: submit `0 10px 22px -12px` (accent 70%); focus ring `0 0 0 3px` (accent 20%).
**Spacing**: brand panel pad `36px 40px`; pane pad `36px 40px`; form gap `15px`; field gap `7px`. Density variants (compact/regular/comfy) adjust input height (42/46/50px), pane padding, and gaps.

## Assets
All icons are inline SVG — no external image files.
- **Books product glyph** (open book with center spine): in `sentire-logos.jsx`, `ProductGlyph` component, `product="Books"`. Recreate as an SVG or use the codebase's icon set.
- Google "G", Microsoft 4-square, key (SSO), envelope, padlock, building/ledger, eye / eye-off, shield, warning, spinner, success check — all inline SVG in `sentire-login.jsx`.
- Fonts loaded from Google Fonts (Instrument Sans, Hanken Grotesk). Use the codebase's existing font pipeline if present.

## Files
Design reference files included in this bundle:
- `Sentire Books Login.html` — entry point: tokens/CSS, fonts, and the design-canvas presentation (desktop + mobile artboards) plus a small Tweaks panel (density, dot texture).
- `sentire-login.jsx` — the login component (`SentireLoginScreen`, `SnBrandPanel`, `SnLoginForm`). Books is `mode="books"`.
- `sentire-logos.jsx` — brand marks and `ProductGlyph` (Books/Payroll/Tax/POS glyphs, wordmarks, lockups).
- `nexus-refined.jsx` — `NexusMark` brand symbol (used by the Central mode; included for completeness).
- `design-canvas.jsx`, `tweaks-panel.jsx` — presentation/scaffolding only; **not** part of the product UI. A developer can ignore these when implementing — they exist purely to display the artboards and toggles.

> Note: the canvas and tweaks scaffolding are for reviewing the design. The actual screen to implement is the contents of `SentireLoginScreen mode="books"` (brand panel + form).
