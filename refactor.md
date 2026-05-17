You are refactoring the Dashboard page and global shell of "ScaleBooks", a 
Philippine cloud accounting SaaS, to match the visual language and information 
architecture of QuickBooks Online's post-2025 redesign (the "Intuit Platform" UI).

==========================================
CONTEXT — DO NOT CHANGE THESE
==========================================
- Stack: React + Vite + Tailwind CSS + React Router. Keep this stack.
- Existing routes: /dashboard (this page), /vouchers, /approvals, /weekly-
  projections, /payment-schedule, /disbursements, /check-registry, /journal, 
  /bank, /chart-of-accounts, /tax, /financial-mgmt, /fixed-assets, /billing-
  book, /service-invoices, /collections.
- Domain language stays. Do NOT rename: Vouchers, Disbursements, Billing 
  Statements, Approvals, Check Registry, Journal, Chart of Accounts, Service 
  Invoices, Collections, Fixed Assets.
- Currency is PHP, render as ₱ prefix with thousands separators and 2 decimals.
- Brand color is orange #F97316 — keep it as the primary accent (this replaces 
  QBO's green throughout the new design).
- Date is shown in "Sunday, May 17, 2026" format, Asia/Manila timezone.

==========================================
GOAL
==========================================
Transform the dashboard from a dark-sidebar admin panel into a light, airy, 
QBO-style home page with:
- A thin 80px LIGHT icon rail (replacing the dark sidebar)
- A clean 56px top bar with universal search
- A centered greeting block
- A row of pill-shaped hub buttons
- A row of quick "create action" pills
- A "Business at a glance" customizable widget grid

==========================================
DESIGN TOKENS — add to tailwind.config.js and index.css
==========================================
Colors:
  --color-primary: #F97316          (orange, brand)
  --color-primary-hover: #EA580C
  --color-primary-subtle: #FFF7ED   (orange tint for hover bgs)
  --color-text: #1F2937             (almost black)
  --color-text-muted: #6B7280
  --color-text-placeholder: #9CA3AF
  --color-border: #E5E7EB
  --color-border-subtle: #F3F4F6
  --color-surface: #FFFFFF
  --color-bg: #F9FAFB               (page background)
  --color-info: #2563EB
  --color-success: #16A34A
  --color-warning: #D97706
  --color-danger: #DC2626

Typography:
  Font family: Inter, system-ui, sans-serif
  Greeting (h1): 36px, weight 500, tracking -0.02em
  Section title (h2): 18px, weight 600
  Widget label (uppercase): 11px, weight 600, tracking 0.05em, text-muted
  Body: 14px, weight 400
  Metric (large number): 28px, weight 600
  Small/footer: 12px

Radius: cards 12px, pills 9999px, inputs/buttons 8px
Shadow: cards use shadow-sm; floating panels use shadow-md
Spacing: page padding 32px; widget grid gap 16px; row gap 24px

==========================================
GLOBAL SHELL — three regions wrapping every page
==========================================

LEFT RAIL (80px fixed, light theme, full height)
File: src/components/shell/LeftRail.jsx
- White background, 1px right border (--color-border)
- Vertical flex column, items are 64px tall, icon centered above 11px label
- Icon size 22px (lucide-react), label text-muted, active item gets orange 
  icon + label + a 3px orange left bar
- Primary group (top):
    Create   (Plus icon)        → opens flyout (see below)
    Bookmarks (Bookmark icon)   → hover opens secondary panel
    Home     (Home icon)        → /dashboard  ← active here
    Feed     (Sparkles icon)    → /feed
    Reports  (BarChart3 icon)   → hover opens secondary panel
    All apps (LayoutGrid icon)  → hover opens secondary panel
- Thin divider
- "PINNED" label, 11px uppercase, --color-text-muted, padding 12px 0 4px
- Pinned group (user customizable, hardcode this default):
    Disbursement (Wallet icon)  → /vouchers
    Accountant   (Calculator icon) → /journal
    Billing      (FileText icon) → /billing-book
    Reports      (PieChart icon) → /reports
- Bottom of rail: Customise (Sliders icon) → opens rail-editor sheet

CREATE FLYOUT (when Create is clicked)
- 280px wide panel anchored to the right of the rail
- White surface, shadow-md, 12px radius, padding 16px
- Title "Create new" (14px semibold), then grouped list:
    DISBURSEMENT: Voucher, Cheque, Disbursement, Payment Schedule entry
    ACCOUNTING: Journal Entry, Bank Transaction, Fixed Asset
    BILLING & AR: Billing Statement, Service Invoice, Collection entry
    LISTS: Customer, Vendor, Employee, Chart of Accounts entry
- Each item is a 36px row with a small icon, label, and a keyboard shortcut 
  badge on the right (e.g. Ctrl+V for Voucher). Hover state uses 
  --color-primary-subtle.

TOP BAR (56px sticky, white, 1px bottom border)
File: src/components/shell/TopBar.jsx
- Left: ScaleBooks wordmark logo (use the same SVG/text already in your sidebar)
- Then: company name selector (16px semibold), e.g. "Workscale Resources Inc." 
  with a small chevron-down — clicking opens a company-switcher popover (stub it 
  with a single entry for now).
- Center: a Command-palette trigger styled as a search input, width max-w-2xl, 
  height 36px, rounded-full, --color-bg background, 1px border, search icon 
  on the left, placeholder text:
    "Navigate. Find vouchers, customers, help, reports, and more."
- Right cluster (36px square icon buttons, gap 4px):
    Tasks (Clipboard), Shortcuts (Zap), Notifications (Bell, with red dot 
    when count>0), Settings (Settings), Help (HelpCircle), Profile avatar 
    (initials in an orange circle), AI Assistant (Sparkles in an outlined 
    button on the far right).

==========================================
DASHBOARD PAGE — src/pages/Dashboard.jsx
==========================================
The page sits inside the shell. Page background --color-bg, content max-width 
1280px, centered, padding 32px.

ROW 1 — GREETING BAR
- Centered greeting h1: "Good afternoon, {firstName}!" 
  (use time-of-day: morning <12, afternoon <18, evening otherwise)
- Subtitle below in --color-text-muted, 14px: 
  "Here's what's happening in your finance portal today."
- Top-right corner of this row, absolutely positioned: two text+icon buttons
    "Customise" (Sliders icon) with a small orange dot when user has 
    customised the layout
    "Privacy" (Eye-off icon) — toggles numbers to •••• across all widgets

ROW 2 — HUB PILLS (horizontal scroll on overflow)
Render 6 pill-shaped buttons, gap 12px, centered horizontally:
- Each pill: 56px tall, rounded-full, white bg, 1px border, padding 8px 24px, 
  icon left (in a 40px circle with category color), then 16px label
- The pills (use these EXACT labels and route them as shown):
    1. Accounting       (Calculator icon, navy circle)        → /journal
    2. Disbursement     (Wallet icon, orange circle)          → /vouchers
    3. Billing & AR     (FileText icon, blue circle)          → /billing-book
    4. Approvals        (CheckCircle icon, green circle)      → /approvals
    5. Tax              (Receipt icon, red circle)            → /tax
    6. Reports          (BarChart3 icon, purple circle)       → /reports
- Hover state: subtle lift (translateY -1px), shadow-sm, border becomes 
  --color-primary

ROW 3 — CREATE ACTIONS (left-aligned)
- Section label "Create actions" (18px semibold) on the left
- Then horizontal pill buttons (height 36px, rounded-full, 1px border, 14px 
  label, padding 8px 16px, gap 8px):
    Create voucher
    Record disbursement
    Create cheque
    Create billing statement
    Add journal entry
    Show all  ← this one styled in orange (--color-primary), no border
- Show all opens a popover with every create action from the Create flyout

ROW 4 — "BUSINESS AT A GLANCE" WIDGET GRID
- Section title "Business at a glance" (18px semibold)
- 12-column CSS grid, gap 16px, widgets vary in column span
- Use react-grid-layout or @dnd-kit for drag/reorder/resize. If those aren't 
  installed yet, install react-grid-layout.
- Each widget is a white card, 12px radius, 1px border, padding 20px, 
  shadow-sm, with this anatomy:
    Header row:    uppercase label (left)  +  period dropdown (right)
    Body:          metric or chart
    Footer row:    helper text link (left)  +  3-dot overflow menu (right)
- Period dropdowns use shadcn Select; options: Last 7 days, Last 30 days, 
  This month, Last month, This quarter, This year, Custom

WIDGET DEFINITIONS (preserve existing data — pull from the same hooks/queries 
the current cards use; just re-render in this new shell):

  Widget A — TOTAL VOUCHERS  (col-span 3)
    Label: "TOTAL VOUCHERS"
    Period: dropdown, default "All-time"
    Body: large metric (28px) e.g. "5", helper "All-time" below
    Add a tiny 30-day sparkline (Recharts LineChart, height 40px, orange 
    stroke, no axes) at the bottom of the body
    Footer: "View vouchers →" link to /vouchers

  Widget B — PENDING APPROVALS  (col-span 3)
    Label: "PENDING APPROVALS"
    Period: none (always live)
    Body: metric "3", helper "Awaiting action"
    Below the metric: a "Review now" orange button (height 32px)
    Footer: "View all →" link to /approvals

  Widget C — PROFIT & LOSS  (col-span 6)
    Label: "PROFIT & LOSS"
    Period dropdown, default "Last month"
    Body: 
      Headline: "Net profit for {periodLabel}"
      Metric: "₱{value}" with a small info-circle icon on the right
      Trend chip: e.g. "↑ 12.4% from prior month" (green) or "Same from prior 
      month" (muted)
      Two-column micro-breakdown below: Income (with a vertical orange bar) 
      and Expenses (with a vertical gray bar), each showing the period total
    Footer: "Missing data? Check account connections" link

  Widget D — EXPENSES  (col-span 4)
    Label: "EXPENSES"
    Period dropdown, default "Last 30 days"
    Body:
      Headline: "Spending for last 30 days"
      Metric: "₱{value}"
      Below: "{x}% from prior 30 days" (red if up, green if down)
      Donut chart (Recharts PieChart, innerRadius 40, outerRadius 60) with 
      top 5 expense categories
      Legend on the right with category color, name, and amount
    Footer: "Add an expense" link

  Widget E — BANK ACCOUNTS  (col-span 4)
    Label: "BANK ACCOUNTS"
    Right header: "As of today" (not a dropdown)
    Sub-header: "Just updated" with a refresh icon button
    Body:
      "Total bank balance" caption, then large "₱{total}" metric
      List of accounts (max 3 visible, scroll for more), each row:
        Bank icon (Building2) on the left
        Account name + last 4 digits (e.g. "1008928 — Cash and cash equiv.")
        Two-column right side: 
          "Bank balance" / "₱{x}"
          "In ScaleBooks" / "₱{y}"
        "Updated {n} days ago" + a green "Reviewed" pill if reconciled
    Footer: "Go to registers ▾" dropdown + settings gear icon

  Widget F — TOTAL BILLED (AR)  (col-span 3)
    Label: "TOTAL BILLED (AR)"
    Period dropdown, default "This year to date"
    Body: metric "₱{value}", helper "Billing statements"
    Mini stacked bar (Recharts) of monthly billing for last 6 months
    Footer: "View billing book →" link

  Widget G — TOTAL COLLECTED  (col-span 3)
    Label: "TOTAL COLLECTED"
    Period dropdown, default "This year to date"
    Body: metric "₱{value}", helper "Payments received"
    Collection rate chip: "{x}% collection rate"
    Footer: "View collections →" link

  Widget H — RECENT VOUCHERS  (col-span 6)
    Label: "RECENT VOUCHERS"
    Right: "View all →" link
    Body: list of last 5 vouchers (use the same data the current page shows). 
    Each row:
      Left: voucher ID (monospace 14px), small muted caption below
      Right: amount "₱{x}" (16px) + status pill (Pending=amber, Paid=green, 
      Draft=yellow, Void=gray)
    Status pill style: rounded-full, padding 2px 10px, 11px text, 
    subtle bg + colored text (e.g. Pending = bg-amber-50 text-amber-700)

  Widget I — RECENT BILLING STATEMENTS  (col-span 6)
    Label: "RECENT BILLING STATEMENTS"
    Right: "View all →" link
    If empty: centered empty state with a small Info icon, headline 
    "No billing statements yet.", subtext "Open a client book →" as an 
    orange link to /billing-book
    If has data: same row pattern as Recent Vouchers

  Widget J — ADD WIDGETS  (col-span 3, always last)
    Dashed border (border-dashed 2px --color-border)
    Centered content: 
      "Add widgets" (18px semibold)
      A 48px circle with a Plus icon
      Divider
      "✨ Smart suggestions" label
      A suggested widget chip below: e.g. "Cash flow forecast" with an Add btn
      Tiny "Why am I seeing these suggestions?" link at the bottom

DEFAULT LAYOUT (12-column grid):
  Row 1: A(3) + B(3) + C(6)
  Row 2: D(4) + E(4) + F(2) + G(2)         [last two collapse to col-span 3 
                                              each on lg]
  Row 3: H(6) + I(6)
  Row 4: J(3)  + reserved space

ROW 5 — ACTIVITY LINK
- Right-aligned "See all activity →" link in --color-primary

PAGE FOOTER
- Centered muted text: "© 2026 ScaleBooks. Privacy · Security · Terms of 
  Service"

==========================================
CUSTOMISE LAYOUT MODE
==========================================
Clicking "Customise" (top right of the greeting bar) enters edit mode:
- A toolbar appears at the top of the page: "Customising layout" title, 
  "Reset to default" link, "Cancel" outline button, "Save" orange button
- Each widget gets a draggable handle (corners and edges show resize cursors)
- Widgets get a small X button in the top-right to remove
- An empty grid cell shows a "+ Add widget" placeholder
- Saving persists the layout to localStorage under key 
  "scalebooks.dashboard.layout"
- After save, the small orange dot next to "Customise" appears if layout 
  differs from default

==========================================
PRIVACY MODE
==========================================
Clicking the "Privacy" button replaces every currency value across the 
dashboard with "₱••••". Persist to localStorage under "scalebooks.privacy".

==========================================
COMPONENT FILES TO CREATE
==========================================
src/
  components/
    shell/
      LeftRail.jsx
      TopBar.jsx
      CreateFlyout.jsx
      CommandPalette.jsx
    dashboard/
      GreetingBar.jsx
      HubPills.jsx
      CreateActions.jsx
      WidgetGrid.jsx
      widgets/
        WidgetShell.jsx          (the shared card chrome)
        TotalVouchersWidget.jsx
        PendingApprovalsWidget.jsx
        ProfitLossWidget.jsx
        ExpensesWidget.jsx
        BankAccountsWidget.jsx
        TotalBilledWidget.jsx
        TotalCollectedWidget.jsx
        RecentVouchersWidget.jsx
        RecentBillingWidget.jsx
        AddWidgetCard.jsx
    common/
      StatusPill.jsx              (Pending/Paid/Draft/Void)
      MoneyText.jsx               (handles ₱ formatting + privacy mode)
      PeriodSelect.jsx            (the dropdown used in widget headers)
  pages/
    Dashboard.jsx                  (composes all of the above)
  hooks/
    useTimeOfDayGreeting.js
    usePrivacyMode.js
    useDashboardLayout.js          (react-grid-layout state + persistence)

==========================================
DEPENDENCIES TO INSTALL IF MISSING
==========================================
npm i lucide-react recharts react-grid-layout cmdk
npm i -D @types/react-grid-layout  (if using TS)

==========================================
WHAT TO PRESERVE FROM THE CURRENT DASHBOARD
==========================================
- All existing data hooks/queries that produced the "TOTAL VOUCHERS", 
  "PENDING APPROVALS", "TOTAL BILLED (AR)", "TOTAL COLLECTED", "Recent 
  Vouchers", and "Recent Billing Statements" values. Re-wire them into 
  the new widget components — do not refetch from new endpoints.
- All routes. The new hub pills, create actions, and footer links must 
  route to the existing paths listed in CONTEXT above.
- The current authentication, sign-out flow, and user data. Move Sign Out 
  into a profile-avatar menu in the top bar.

==========================================
WHAT TO DELETE / REPLACE
==========================================
- The current dark sidebar component entirely. Replace with LeftRail + 
  TopBar in the new shell.
- The four flat KPI cards at the top of the current dashboard. They are 
  replaced by widgets A, B, F, G (which present the same numbers with 
  the new chrome).
- The plain Recent Vouchers and Recent Billing Statements panels. They 
  become widgets H and I.

==========================================
DELIVERABLE FOR THIS PROMPT
==========================================
1. Update tailwind.config.js with the design tokens.
2. Build the shell (LeftRail, TopBar, CreateFlyout) and wrap the existing 
   router with it.
3. Build the new Dashboard.jsx page composing GreetingBar, HubPills, 
   CreateActions, and WidgetGrid with all widgets A–J.
4. Wire existing data into the new widgets.
5. Implement Privacy Mode and basic Customise Mode (drag/reorder; save 
   to localStorage).
6. Do NOT touch any of the other routes/pages yet — just the shell and 
   the dashboard.

When done, list any files you created or modified, and any TODOs for me 
(e.g. "needs real sparkline data for vouchers — wire to /api/vouchers/
trend"). If you need to make assumptions about my existing data shape, 
state them at the top of your changes.



==========================================
TO-DO LIST — STEP-BY-STEP REBUILD
==========================================
Status legend:  [ ] = not started  [~] = partially done  [x] = complete

Current codebase state (as of audit):
  - LeftRail.tsx & TopBar.tsx EXIST but use QBO green (#2CA01C) — must be rewritten
  - DashboardPage.jsx EXISTS with all Firestore queries — data must be preserved
  - ScaleBooksApp.jsx has a dark sidebar that will be replaced
  - AppShell.jsx has an old dark sidebar (legacy, to be removed)
  - tailwind.config.js has QBO green tokens — must be replaced with orange tokens
  - MISSING deps: recharts, react-grid-layout, cmdk

------------------------------------------
PHASE 1 — FOUNDATION
------------------------------------------
  [ ] 1.1  Install missing dependencies:
             npm i recharts react-grid-layout cmdk
             npm i -D @types/react-grid-layout

  [ ] 1.2  Update tailwind.config.js:
             - Remove the `qbo` green color block
             - Add orange brand tokens (primary, primary-hover, primary-subtle)
             - Add semantic tokens: text, text-muted, text-placeholder,
               border, border-subtle, surface, bg, info, success, warning, danger
             - Confirm borderRadius pill (9999px), card (12px), button (8px)
             - Confirm font family: Inter, system-ui, sans-serif

  [ ] 1.3  Update src/index.css (or main entry CSS):
             - Add all CSS custom properties (--color-primary through --color-danger)
             - Add typography size/weight CSS variables
             - Ensure Inter font is loaded (Google Fonts import or local)

------------------------------------------
PHASE 2 — GLOBAL SHELL
------------------------------------------
  [ ] 2.1  Rewrite src/components/shell/LeftRail.tsx
             CURRENT: uses green active state, wired to report tabs only
             CHANGES:
             - Change active color from green → orange (#F97316)
             - Add 3px orange left-bar on active item
             - Add full primary group (Create, Bookmarks, Home, Feed,
               Reports, All apps) with correct Lucide icons
             - Add PINNED section with correct defaults
               (Disbursement→/vouchers, Accountant→/journal,
                Billing→/billing-book, Reports→/reports)
             - Wire Home → /scalebooks/dashboard
             - Bottom: Customise item that opens rail-editor sheet (stub)
             - Remove report-tab sub-list (that logic moves to Reports page)

  [ ] 2.2  Rewrite src/components/shell/TopBar.tsx
             CURRENT: uses green, missing AI Assistant and profile menu
             CHANGES:
             - Change avatar background and focus ring green → orange
             - Add AI Assistant button (Sparkles, outlined, far right)
             - Replace plain avatar with a dropdown menu containing Sign Out
               (move Sign Out out of the dark sidebar)
             - Company name selector with chevron + company-switcher popover
             - Update search placeholder text to match spec
             - Add Shortcuts (Zap) button to right cluster
             - Notification red dot: wire to a count prop (stub count=0)

  [ ] 2.3  Create src/components/shell/CreateFlyout.jsx  (NEW FILE)
             - 280px panel, anchored right of the rail, shadow-md
             - "Create new" title
             - Four groups: DISBURSEMENT, ACCOUNTING, BILLING & AR, LISTS
             - Each row: icon + label + keyboard shortcut badge
             - Hover: --color-primary-subtle background
             - Close on outside click

  [ ] 2.4  Create src/components/shell/CommandPalette.jsx  (NEW FILE)
             - Use cmdk package
             - Opens when search bar is clicked (or Ctrl+K / Cmd+K)
             - Stub with static list of all routes as search results
             - Renders as a modal overlay, shadow-md, 12px radius

  [ ] 2.5  Update src/modules/scalebooks/ScaleBooksApp.jsx
             - Remove the inline dark sidebar (the big NAV_GROUPS block +
               all inline sidebar JSX)
             - Wrap the page area with LeftRail (left) + TopBar (top) layout
             - Pass companyName and userEmail to TopBar from auth state
             - Pass active route to LeftRail for active-item highlighting
             - Sign Out logic: move to TopBar profile avatar dropdown

------------------------------------------
PHASE 3 — COMMON COMPONENTS
------------------------------------------
  [ ] 3.1  Create src/components/common/StatusPill.jsx  (NEW FILE)
             - Props: status ("Pending" | "Paid" | "Draft" | "Void" |
               "Approved" | "Rejected" | "Posted")
             - Styles per status (bg + text + border, all from spec)
             - rounded-full, padding 2px 10px, 11px text

  [ ] 3.2  Create src/components/common/MoneyText.jsx  (NEW FILE)
             - Props: value (number), className
             - Reads privacy mode from context/localStorage
             - If privacy ON → renders "₱••••"
             - If privacy OFF → renders "₱{value}" with thousands separator
               and 2 decimal places (Intl.NumberFormat en-PH)

  [ ] 3.3  Create src/components/common/PeriodSelect.jsx  (NEW FILE)
             - Wraps @radix-ui/react-select (already installed)
             - Options: Last 7 days, Last 30 days, This month, Last month,
               This quarter, This year, Custom
             - Props: value, onChange, defaultValue
             - Compact style (height 28px, 12px text) for widget headers

------------------------------------------
PHASE 4 — HOOKS
------------------------------------------
  [ ] 4.1  Create src/hooks/useTimeOfDayGreeting.js  (NEW FILE)
             - Returns { greeting, firstName } 
             - greeting: "Good morning" / "Good afternoon" / "Good evening"
               based on Asia/Manila current hour
             - firstName: read from Firebase auth currentUser.displayName

  [ ] 4.2  Create src/hooks/usePrivacyMode.js  (NEW FILE)
             - State: isPrivate (boolean)
             - Toggle function
             - Persists to localStorage key "scalebooks.privacy"
             - Reads initial value from localStorage on mount

  [ ] 4.3  Create src/hooks/useDashboardLayout.js  (NEW FILE)
             - Manages react-grid-layout layout state
             - DEFAULT_LAYOUT constant matching the spec grid rows
             - Reads saved layout from localStorage "scalebooks.dashboard.layout"
             - Returns: { layout, setLayout, isCustomised, resetLayout, saveLayout }
             - isCustomised = true when current layout differs from DEFAULT_LAYOUT

------------------------------------------
PHASE 5 — DASHBOARD SECTION COMPONENTS
------------------------------------------
  [ ] 5.1  Create src/components/dashboard/GreetingBar.jsx  (NEW FILE)
             - Uses useTimeOfDayGreeting hook
             - Displays greeting h1 (36px, weight 500, tracking -0.02em)
             - Subtitle in text-muted, 14px
             - Today's date in "Sunday, May 17, 2026" format, Asia/Manila tz
             - Top-right corner: "Customise" button (Sliders icon + orange dot
               when isCustomised=true) and "Privacy" button (EyeOff icon)
             - Customise click: calls onCustomiseToggle prop
             - Privacy click: calls toggle from usePrivacyMode

  [ ] 5.2  Create src/components/dashboard/HubPills.jsx  (NEW FILE)
             - Renders the 6 pill buttons (Accounting, Disbursement,
               Billing & AR, Approvals, Tax, Reports)
             - Each pill: 56px tall, rounded-full, white bg, 1px border
             - Icon inside a 40px colored circle (colors per spec)
             - Hover: translateY -1px, shadow-sm, border → orange
             - Uses react-router-dom Link or useNavigate

  [ ] 5.3  Create src/components/dashboard/CreateActions.jsx  (NEW FILE)
             - "Create actions" section title (18px semibold)
             - Row of pill buttons: Create voucher, Record disbursement,
               Create cheque, Create billing statement, Add journal entry
             - "Show all" pill: orange text, no border
             - "Show all" opens a Popover with the full CreateFlyout list

  [ ] 5.4  Create src/components/dashboard/WidgetGrid.jsx  (NEW FILE)
             - Accepts: layout, widgets, isCustomising, onLayoutChange
             - Uses react-grid-layout ResponsiveGridLayout
             - 12-column grid, gap 16px
             - In customise mode: shows drag handles, X remove buttons,
               empty cell placeholders
             - Outside customise mode: drag/resize disabled

------------------------------------------
PHASE 6 — WIDGET SHARED CHROME
------------------------------------------
  [ ] 6.1  Create src/components/dashboard/widgets/WidgetShell.jsx  (NEW FILE)
             - White card, 12px radius, 1px border, 20px padding, shadow-sm
             - Header: uppercase label (left) + optional period dropdown (right)
             - Body: children
             - Footer: helper link (left) + 3-dot overflow menu (right)
             - Props: label, headerRight, footer, overflowMenu, children

------------------------------------------
PHASE 7 — INDIVIDUAL WIDGETS
------------------------------------------
  [ ] 7.1  Widget A — TotalVouchersWidget.jsx  (NEW FILE)
             Data source: allVSnap.size from DashboardPage load()
             - Large metric (28px)
             - Sparkline: Recharts LineChart, height 40px, orange, no axes
             - TODO: wire sparkline to per-day voucher count query

  [ ] 7.2  Widget B — PendingApprovalsWidget.jsx  (NEW FILE)
             Data source: pendingSnap.size from DashboardPage load()
             - Metric + "Awaiting action" helper
             - "Review now" orange button → navigates to /scalebooks/approvals

  [ ] 7.3  Widget C — ProfitLossWidget.jsx  (NEW FILE)
             Data source: STUB (no P&L query exists yet)
             - Net profit metric, trend chip, Income/Expenses breakdown
             - TODO: wire to journal entries aggregated by account type

  [ ] 7.4  Widget D — ExpensesWidget.jsx  (NEW FILE)
             Data source: STUB (no expense-category query exists yet)
             - Metric, % change chip, donut chart (Recharts PieChart)
             - TODO: wire to vouchers/disbursements grouped by category

  [ ] 7.5  Widget E — BankAccountsWidget.jsx  (NEW FILE)
             Data source: bank module (BankPage uses db collection 'bank' or similar)
             - Total balance metric, account list rows
             - "Reviewed" pill if reconciled flag is true
             - TODO: confirm Firestore collection name for bank accounts

  [ ] 7.6  Widget F — TotalBilledWidget.jsx  (NEW FILE)
             Data source: totalBilled from DashboardPage load()
             - Metric (₱) + "Billing statements" helper
             - Mini stacked bar: Recharts BarChart, last 6 months
             - TODO: wire monthly billing data (currently only total is fetched)

  [ ] 7.7  Widget G — TotalCollectedWidget.jsx  (NEW FILE)
             Data source: totalCollected from DashboardPage load()
             - Metric (₱) + collection rate chip
             - TODO: compute collection rate = totalCollected / totalBilled × 100

  [ ] 7.8  Widget H — RecentVouchersWidget.jsx  (NEW FILE)
             Data source: recentVouchers array from DashboardPage load()
             - List of 5 rows: voucher ID (monospace) + amount + StatusPill
             - Uses MoneyText for amounts

  [ ] 7.9  Widget I — RecentBillingWidget.jsx  (NEW FILE)
             Data source: recentBilling array from DashboardPage load()
             - Empty state when recentBilling.length === 0
             - Same row pattern as Widget H when has data

  [ ] 7.10 Widget J — AddWidgetCard.jsx  (NEW FILE)
             - Dashed border (2px), centered Plus circle
             - "✨ Smart suggestions" section with a suggested chip
             - "Why am I seeing these?" link (stub)

------------------------------------------
PHASE 8 — DASHBOARD PAGE ASSEMBLY
------------------------------------------
  [ ] 8.1  Rewrite src/modules/scalebooks/DashboardPage.jsx
             - Remove all inline CSS (STAT_CARD string, inline styles)
             - Remove old dc-grid, dc-stat, dc-section HTML
             - Preserve the Firestore load() function and all its queries
             - Lift data into local state, pass as props to widgets
             - Compose: GreetingBar → HubPills → CreateActions → WidgetGrid
             - Page background: --color-bg, max-w-[1280px], mx-auto, p-8
             - Row 5: right-aligned "See all activity →" link
             - Footer: centered muted text © 2026 ScaleBooks

------------------------------------------
PHASE 9 — PRIVACY & CUSTOMISE MODES
------------------------------------------
  [ ] 9.1  Create a PrivacyContext (or pass via prop/hook) so MoneyText
             anywhere on the page reads the same privacy flag

  [ ] 9.2  Wire usePrivacyMode to GreetingBar "Privacy" button toggle

  [ ] 9.3  Wire useDashboardLayout to WidgetGrid
             - Pass layout and onLayoutChange to ResponsiveGridLayout
             - "Save" in customise toolbar calls saveLayout()
             - "Reset to default" calls resetLayout()
             - "Cancel" reverts to saved layout without persisting

  [ ] 9.4  Customise toolbar: render at top of page when isCustomising=true
             - Title "Customising layout", Reset link, Cancel + Save buttons
             - Orange dot on "Customise" button when isCustomised=true

  [ ] 9.5  Widget remove (X button): only visible in customise mode;
             removes widget from layout state (not from default)

------------------------------------------
PHASE 10 — CLEANUP
------------------------------------------
  [ ] 10.1 Remove the dark sidebar block from ScaleBooksApp.jsx
             (the NAV_GROUPS constant, Ico helper, sidebar JSX, all inline
             sidebar styles, sign-out button in sidebar)

  [ ] 10.2 Remove / archive AppShell.jsx (old dark sidebar shell) once
             all old /accounting and /billing routes are confirmed gone

  [ ] 10.3 Remove qbo green color block from tailwind.config.js

  [ ] 10.4 Audit all remaining pages for any hardcoded #2CA01C green
             references; replace with orange where it was brand color

  [ ] 10.5 Smoke-test all existing routes after shell replacement:
             /scalebooks, /scalebooks/vouchers, /scalebooks/approvals,
             /scalebooks/billing, /scalebooks/journal, /scalebooks/bank,
             /scalebooks/chart-of-accounts, /scalebooks/tax,
             /scalebooks/financial-mgmt, /scalebooks/fixed-assets,
             /scalebooks/service-invoices, /scalebooks/collections,
             /scalebooks/disbursements, /scalebooks/check-registry,
             /scalebooks/weekly-projections, /scalebooks/payment-schedule

------------------------------------------
OPEN TODOs (post-phase 10)
------------------------------------------
  [ ] T1  Widget A sparkline — add a Firestore query that returns voucher
           counts grouped by day for the last 30 days

  [ ] T2  Widget C (P&L) — build a journal-aggregation query that sums
           revenue vs. expense accounts for the selected period

  [ ] T3  Widget D (Expenses) — add a category field to vouchers/
           disbursements and group by that field for the donut chart

  [ ] T4  Widget E (Bank) — confirm Firestore collection name and field
           shape for bank account balances and reconciliation status

  [ ] T5  Widget F monthly bar data — change the billingStatements query
           to fetch last 6 months grouped by month (not just last 5 docs)

  [ ] T6  CommandPalette — wire search results to live Firestore queries
           (vouchers, billing statements, contacts) instead of static routes

  [ ] T7  LeftRail "Customise" sheet — build the rail-editor UI that lets
           users reorder / swap pinned items

  [ ] T8  Responsive breakpoints — test ≤ 768px (mobile) layout collapse;
           LeftRail should collapse to bottom tab bar on small screens

  [ ] T9  Keyboard shortcuts in CreateFlyout — implement the Ctrl+V etc.
           shortcuts to actually open the corresponding create modals