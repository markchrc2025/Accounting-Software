/* ─────────────────────────────────────────────────────────────────
 * Loan Monitoring — Reconciliation Engine
 *
 * Pure functions that, given a loan + its payments, derive:
 *   - per-installment status (scheduled | partial | paid | overdue)
 *   - aggregate state: outstanding, paidPrincipal, paidInterest,
 *                      lastPaymentDate, nextDueDate, missedCount,
 *                      derivedStatus, percentPaid, payoffDate
 *
 * The amortization schedule is the SCHEDULED side; the `payments`
 * array is the ACTUAL side. Allocation order:
 *   1) Honor explicit `payment.allocations[]` if present
 *   2) Otherwise FIFO: oldest unpaid period first, interest before
 *      principal within a period; penalty (if any) absorbs leftover.
 * ───────────────────────────────────────────────────────────────── */

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const EPS = 0.005; // half-cent tolerance

/* ── Amortization (mirrors FinancialPage calcMonthData) ─────────── */
function calcMonthData(loan, elapsed) {
  const P = loan.principal || 0;
  const r = (loan.annualRate || 0) / 100 / 12;
  const term = Math.max(loan.termMonths || 1, 1);
  if (elapsed < 0 || elapsed >= term) return null;
  if (P <= 0) return { principal:0, interest:0, balance:0 };
  if (loan.loanType === 'Revolving Credit') return { principal:0, interest:P*r, balance:P };
  if (loan.interestMethod === 'Balloon') {
    const isLast = elapsed === term - 1;
    return { principal: isLast ? P : 0, interest: P*r, balance: isLast ? 0 : P };
  }
  if (loan.interestMethod === 'Straight-Line') {
    const pp = P / term, bal = P - pp * elapsed;
    return { principal: pp, interest: bal * r, balance: bal - pp };
  }
  if (loan.interestMethod === 'Straight-Line (Monthly Rate)') {
    const rm = (loan.annualRate || 0) / 100, pp = P / term, bal = P - pp * elapsed;
    return { principal: pp, interest: bal * rm, balance: bal - pp };
  }
  if (loan.interestMethod === 'Fixed') {
    const pp = P / term, interest = P * (loan.annualRate||0) / 100 / 12;
    return { principal: pp, interest, balance: Math.max(P - pp * (elapsed+1), 0) };
  }
  if (r === 0) { const pp = P/term; return { principal:pp, interest:0, balance:P - pp*(elapsed+1) }; }
  const pmt = P * r * Math.pow(1+r,term) / (Math.pow(1+r,term)-1);
  const bal0 = P * Math.pow(1+r,elapsed) - pmt * (Math.pow(1+r,elapsed)-1) / r;
  const interest = bal0 * r;
  const pp = pmt - interest;
  return { principal: Math.max(pp,0), interest: Math.max(interest,0), balance: Math.max(bal0-pp,0) };
}

/* ── Determine the due day-of-month for a loan ──────────────────── */
function loanDueDay(loan) {
  if (loan.paymentFrequency === 'Semi-Monthly') {
    const d2 = parseInt(loan.payDay2);
    const d1 = parseInt(loan.payDay1);
    if (d2 >= 1 && d2 <= 31) return d2;
    if (d1 >= 1 && d1 <= 31) return d1;
    return 30; // fallback
  }
  if (loan.disbursementDate) {
    const d = new Date(loan.disbursementDate).getDate();
    if (d >= 1 && d <= 31) return d;
  }
  return 1;
}

function clampDay(year, monthIdx, day) {
  const last = new Date(year, monthIdx + 1, 0).getDate();
  return Math.min(day, last);
}

/* ── Every-N-Days schedule ──────────────────────────────────────── */
function buildIntervalSchedule(loan) {
  const intervalDays = parseInt(loan.intervalDays) || 15;
  const start = loan.disbursementDate ? new Date(loan.disbursementDate + 'T00:00:00') : null;
  if (!start || isNaN(start.getTime()) || !loan.termMonths) return [];
  const endDate = new Date(start.getFullYear(), start.getMonth() + parseInt(loan.termMonths), start.getDate());
  const P = parseFloat(loan.principal) || 0;
  const dates = [];
  let cur = new Date(start);
  while (cur <= endDate) { dates.push(new Date(cur)); cur = new Date(cur.getTime() + intervalDays * 86400000); }
  const n = dates.length;
  if (n === 0 || P <= 0) return [];
  const r = (loan.annualRate || 0) / 100 * intervalDays / 365;
  const pmt = r === 0 ? P / n : P * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
  // For Fixed method: total interest = P × (annualRate/12) × termMonths (same as GAS monthly calc),
  // spread evenly over n actual interval periods so totals are consistent with the Amortization tab.
  const fixedInterestPerPeriod = n > 0
    ? P * (loan.annualRate||0) / 100 / 12 * parseInt(loan.termMonths || 1) / n
    : 0;
  let balance = P;
  const fee = parseFloat(loan.processingFee) || 0;
  const schedule = dates.map((d, i) => {
    const openingBalance = balance;
    let interest, principal;
    if (loan.interestMethod === 'Fixed') {
      principal = P / n;
      interest  = fixedInterestPerPeriod;
    } else if (loan.interestMethod === 'Balloon') {
      interest  = balance * r;
      principal = i === n - 1 ? balance : 0;
    } else {
      interest  = balance * r;
      principal = Math.max(0, pmt - interest);
    }
    balance = Math.max(0, balance - principal);
    const dueDate = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const m = new Date(d.getFullYear(), d.getMonth(), 1);
    const label = MONTH_NAMES[m.getMonth()] + '-' + m.getFullYear();
    return {
      period: i+1, label, dueDate,
      scheduledPrincipal: principal, scheduledInterest: interest,
      scheduledTotal: principal + interest,
      openingBalance,
      closingBalance: balance,
      paidPrincipal: 0, paidInterest: 0, paidPenalty: 0,
      status: 'scheduled',
    };
  });
  // Store processing fee on first period as a separate field (not merged into interest)
  if (schedule.length > 0 && fee > 0) {
    schedule[0].processingFee = fee;
  }
  return schedule;
}

/* ── Build schedule with due dates ─────────────────────────────── */
export function buildScheduleWithDueDates(loan) {
  if (loan.payDayMode === 'Every N Days') return buildIntervalSchedule(loan);
  const rows = [];
  if (!loan.disbursementDate || !loan.termMonths) return rows;
  const base = new Date(loan.disbursementDate);
  if (isNaN(base.getTime())) return rows;
  const dueDay = loanDueDay(loan);

  for (let i = 0; i < loan.termMonths; i++) {
    const d = calcMonthData(loan, i);
    if (!d) break;
    const m = new Date(base.getFullYear(), base.getMonth() + i, 1);
    const dueDayClamped = clampDay(m.getFullYear(), m.getMonth(), dueDay);
    const dueDate =
      m.getFullYear() + '-' +
      String(m.getMonth() + 1).padStart(2, '0') + '-' +
      String(dueDayClamped).padStart(2, '0');
    rows.push({
      period: i + 1,
      label: MONTH_NAMES[m.getMonth()] + '-' + m.getFullYear(),
      dueDate,
      scheduledPrincipal: d.principal,
      scheduledInterest: d.interest,
      scheduledTotal: d.principal + d.interest,
      openingBalance: i === 0 ? loan.principal || 0 : null, // filled below
      closingBalance: d.balance,
      paidPrincipal: 0,
      paidInterest: 0,
      paidPenalty: 0,
      status: 'scheduled', // scheduled | partial | paid | overdue
    });
  }
  // fill opening balances
  for (let i = 1; i < rows.length; i++) {
    rows[i].openingBalance = rows[i - 1].closingBalance;
  }
  // Store processing fee on first period as a separate field (not merged into interest)
  const fee = parseFloat(loan.processingFee) || 0;
  if (rows.length > 0 && fee > 0) {
    rows[0].processingFee = fee;
  }
  return rows;
}

/* ── Allocate payments onto the schedule rows ───────────────────── */
function allocatePayments(schedule, payments) {
  const sorted = [...payments].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  for (const p of sorted) {
    // Honor explicit allocations first
    if (Array.isArray(p.allocations) && p.allocations.length > 0) {
      for (const a of p.allocations) {
        const row = schedule.find(r => r.period === a.period);
        if (!row) continue;
        row.paidInterest  += Math.max(0, a.interest || 0);
        row.paidPrincipal += Math.max(0, a.principal || 0);
        row.paidPenalty   += Math.max(0, a.penalty || 0);
      }
      continue;
    }

    // FIFO allocation: total = explicit fields, falling back to total field
    let interestRemaining  = Math.max(0, Number(p.interest)  || 0);
    let principalRemaining = Math.max(0, Number(p.principal) || 0);
    let penaltyRemaining   = Math.max(0, Number(p.penalty)   || 0);

    // If only `total` was provided (no split), spread it FIFO across rows (interest first within each row)
    if (interestRemaining === 0 && principalRemaining === 0 && penaltyRemaining === 0) {
      let lump = Math.max(0, Number(p.total) || Number(p.amount) || 0);
      for (const row of schedule) {
        if (lump <= EPS) break;
        const intDue = Math.max(0, row.scheduledInterest - row.paidInterest);
        const intPay = Math.min(intDue, lump);
        row.paidInterest += intPay;
        lump -= intPay;
        if (lump <= EPS) break;
        const priDue = Math.max(0, row.scheduledPrincipal - row.paidPrincipal);
        const priPay = Math.min(priDue, lump);
        row.paidPrincipal += priPay;
        lump -= priPay;
      }
      // any leftover spills into penalties on the last paid row
      if (lump > EPS && schedule.length > 0) schedule[schedule.length - 1].paidPenalty += lump;
      continue;
    }

    // Split mode: walk rows, fill interest then principal
    for (const row of schedule) {
      if (interestRemaining <= EPS && principalRemaining <= EPS && penaltyRemaining <= EPS) break;
      if (interestRemaining > EPS) {
        const intDue = Math.max(0, row.scheduledInterest - row.paidInterest);
        const intPay = Math.min(intDue, interestRemaining);
        row.paidInterest += intPay;
        interestRemaining -= intPay;
      }
      if (principalRemaining > EPS) {
        const priDue = Math.max(0, row.scheduledPrincipal - row.paidPrincipal);
        const priPay = Math.min(priDue, principalRemaining);
        row.paidPrincipal += priPay;
        principalRemaining -= priPay;
      }
    }
    if (penaltyRemaining > EPS && schedule.length > 0) {
      schedule[schedule.length - 1].paidPenalty += penaltyRemaining;
    }
  }

  // Mark statuses
  const today = new Date().toISOString().slice(0, 10);
  for (const row of schedule) {
    const intDone = row.paidInterest  >= row.scheduledInterest  - EPS;
    const priDone = row.paidPrincipal >= row.scheduledPrincipal - EPS;
    if (intDone && priDone) row.status = 'paid';
    else if (row.paidInterest > EPS || row.paidPrincipal > EPS) row.status = 'partial';
    else if (row.dueDate < today) row.status = 'overdue';
    else row.status = 'scheduled';
  }
  return schedule;
}

/* ── Main: derive full state for a single loan ──────────────────── */
export function recomputeLoanState(loan, payments) {
  const schedule = buildScheduleWithDueDates(loan);
  allocatePayments(schedule, payments);

  const totalScheduledPrincipal = schedule.reduce((s, r) => s + r.scheduledPrincipal, 0);
  const totalScheduledInterest  = schedule.reduce((s, r) => s + r.scheduledInterest,  0);
  const paidPrincipal = schedule.reduce((s, r) => s + r.paidPrincipal, 0);
  const paidInterest  = schedule.reduce((s, r) => s + r.paidInterest,  0);
  const paidPenalty   = schedule.reduce((s, r) => s + r.paidPenalty,   0);

  const outstandingPrincipal = Math.max(0, totalScheduledPrincipal - paidPrincipal);
  const outstandingTotal     = Math.max(0,
    (totalScheduledPrincipal + totalScheduledInterest) - (paidPrincipal + paidInterest)
  );

  const today = new Date().toISOString().slice(0, 10);
  const overdueRows = schedule.filter(r => r.status === 'overdue' || (r.status === 'partial' && r.dueDate < today));
  const missedCount = overdueRows.length;
  const overdueAmount = overdueRows.reduce(
    (s, r) => s + (r.scheduledPrincipal - r.paidPrincipal) + (r.scheduledInterest - r.paidInterest),
    0
  );

  const nextRow = schedule.find(r => r.status !== 'paid');
  const nextDueDate   = nextRow ? nextRow.dueDate : null;
  const nextDueAmount = nextRow
    ? (nextRow.scheduledPrincipal - nextRow.paidPrincipal) + (nextRow.scheduledInterest - nextRow.paidInterest)
    : 0;

  const lastPaymentDate = payments.length > 0
    ? [...payments].map(p => p.date).filter(Boolean).sort().slice(-1)[0]
    : null;

  const isPaidOff =
    schedule.length > 0 &&
    schedule.every(r => r.status === 'paid') &&
    outstandingPrincipal <= EPS;

  let derivedStatus;
  if (loan.status === 'Disposed')      derivedStatus = 'Disposed';
  else if (isPaidOff)                  derivedStatus = 'Paid-Off';
  else if (missedCount > 0)            derivedStatus = 'Overdue';
  else if (paidPrincipal > EPS || paidInterest > EPS) derivedStatus = 'Current';
  else                                 derivedStatus = 'Active';

  const percentPaid = totalScheduledPrincipal > 0
    ? Math.min(100, (paidPrincipal / totalScheduledPrincipal) * 100)
    : 0;

  // Maturity date = last scheduled dueDate
  const maturityDate = schedule.length > 0 ? schedule[schedule.length - 1].dueDate : null;
  // Payoff date = max payment date for fully-paid loans
  const payoffDate = isPaidOff ? lastPaymentDate : null;

  return {
    schedule,
    totalScheduledPrincipal,
    totalScheduledInterest,
    paidPrincipal,
    paidInterest,
    paidPenalty,
    outstandingPrincipal,
    outstandingTotal,
    missedCount,
    overdueAmount,
    nextDueDate,
    nextDueAmount,
    lastPaymentDate,
    isPaidOff,
    derivedStatus,
    percentPaid,
    maturityDate,
    payoffDate,
  };
}

/* ── Convenience: recompute a portfolio ─────────────────────────── */
export function recomputePortfolio(loans, paymentsByLoan) {
  const states = {};
  for (const l of loans) {
    states[l.id] = recomputeLoanState(l, paymentsByLoan[l.id] || []);
  }
  return states;
}

/* ── Days between two yyyy-mm-dd strings (b - a) ────────────────── */
export function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (isNaN(ms)) return null;
  return Math.round(ms / 86400000);
}
