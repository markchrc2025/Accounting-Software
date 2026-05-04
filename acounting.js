/**
 * WORKSCALE ACCOUNTING - MASTER UNIFIED BACKEND
 * Contains Initialization, Transactions, Journal Entries, Approval Routing, PDFs, Bank Ledger, and Projections.
 */

const CENTRAL_SETTINGS_ID       = '1TueoeHavaK4lrNuWiZN_2TqcyoVev-3Ma-d3HEGGvdk';
const SIGNATURES_FOLDER_ID      = '1xvI3W5zKvVUsITws4EyNgq31EYVsDDHI';
const CENTRAL_JOURNAL_LINES_ID  = '1e7ixGvLABB8iRZBwASqWILL9DG4jpVxBYuOoeIv4tvE';
const BANK_STATEMENTS_FOLDER_ID = '18qdX_MwbqlF2pRf01HC5S2LQcIBznc16';
const UNIONBANK_TX_SS_ID        = '1fINal3bzRJz-WZqZrCCHCQf4leAXkka3o2ZJQAYVz-I';
const BPI_TX_SS_ID              = '1LIMZMPGp9aR85akvGY30Q39Gi-r6GzfXZ6jfo8fuacU';
const BDO_TX_SS_ID              = '1mUJI8tCcm5sRoUJ6rfbFTzxFudX5zekkMXlSW54AWro';

const FA_SS_ID                 = '1TKpObMQKlBFegi061hw1l-n1tAr4i1SErVFeuoy1u4U';
const WRI_MASTERLIST_SS_ID_    = '13QOgFiROvcXny_P30mU13AW4fTB-DB7MWAKj6X45BFo';

function getCentralSS_() {
  return SpreadsheetApp.openById(CENTRAL_SETTINGS_ID);
}

function getCentralJournalLinesSheet_() {
  return SpreadsheetApp.openById(CENTRAL_JOURNAL_LINES_ID).getSheetByName('JournalLines');
}

function getCentralJournalLinesData_() {
  try {
    const sheet = getCentralJournalLinesSheet_();
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];
    const headers = data[0].map(h => String(h).trim());
    const result = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.join('').trim() === '') continue;
      const obj = {};
      headers.forEach((h, idx) => { if (h) obj[h] = row[idx]; });
      result.push(obj);
    }
    return result.reverse();
  } catch(e) {
    Logger.log('getCentralJournalLinesData_ error: ' + e.message);
    return [];
  }
}

/**
 * Appends journal lines to the Central Journal Lines sheet.
 * Local row format: [voucher_id, je_id, line_no, account_code, account_name, description, contact, class, debit, credit, timestamp]
 * Central columns:  DocumentID, journal_entry_id, line_number, account_code, account_name, description, contact_name, class, debit, credit, created_at, created_by, updated_by, updated_at, posted_by, posted_at
 */
function appendToCentralJournalLines_(jLines, user) {
  if (!jLines || jLines.length === 0) return;
  try {
    const sheet = getCentralJournalLinesSheet_();
    if (!sheet) return;
    const rows = jLines.map(l => [
      l[0],  // DocumentID       ← voucher_id
      l[1],  // journal_entry_id ← je_id
      l[2],  // line_number      ← line_no
      l[3],  // account_code
      l[4],  // account_name
      l[5],  // description
      l[6],  // contact_name     ← contact
      l[7],  // class
      l[8],  // debit
      l[9],  // credit
      l[10], // created_at       ← timestamp from buildJournalLines_
      user,  // created_by
      '',    // updated_by
      '',    // updated_at
      '',    // posted_by
      ''     // posted_at
    ]);
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
  } catch (e) {
    Logger.log('appendToCentralJournalLines_ error: ' + e.message);
  }
}

/**
 * Deletes all rows from the Central Journal Lines sheet where DocumentID matches vid.
 * Called before re-writing on voucher update.
 */
function deleteFromCentralJournalLines_(vid) {
  try {
    const sheet = getCentralJournalLinesSheet_();
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === String(vid)) sheet.deleteRow(i + 1);
    }
  } catch (e) {
    Logger.log('deleteFromCentralJournalLines_ error: ' + e.message);
  }
}

function getCentralSheetData_(sheetName) {
  const ss = getCentralSS_();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i]; if (row.join('').trim() === '') continue;
    const obj = {}; headers.forEach((h, idx) => { if (h) obj[String(h).trim()] = row[idx]; }); result.push(obj);
  }
  return result;
}

function getCentralAccountsData_() {
  // Accounts are maintained in the Central Journal Lines spreadsheet (Accounts sheet)
  const ss = SpreadsheetApp.openById(CENTRAL_JOURNAL_LINES_ID);
  const sheet = ss.getSheetByName('Accounts');
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i]; if (row.join('').trim() === '') continue;
    const obj = {}; headers.forEach((h, idx) => { if (h) obj[String(h).trim()] = row[idx]; }); result.push(obj);
  }
  return result;
}

function doGet(e) {
  const email = Session.getActiveUser().getEmail();
  const access = getUserAccess_(email);
  if (!access) return HtmlService.createHtmlOutput(`<div style="text-align:center; padding:50px; font-family:sans-serif;"><h2 style="color:#d93025;">Access Denied</h2><p>Your email (<b>${email}</b>) is not authorized in the Users list.</p><p>Please contact the Workscale administrator.</p></div>`);
  if (!access.hasModuleAccess) return HtmlService.createHtmlOutput(`<div style="text-align:center; padding:50px; font-family:sans-serif;"><h2 style="color:#d93025;">Access Denied</h2><p>Your account (<b>${email}</b>) does not have access to the <b>Disbursement</b> module.</p></div>`);
  const html = HtmlService.createTemplateFromFile('index');
  html.userEmail = email; 
  return html.evaluate().setTitle('Workscale Disbursement').addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getUserAccess_(email) {
  const users = getCentralSheetData_('Users');
  const matchingUsers = users.filter(r => String(r.Email || '').toLowerCase().trim() === String(email).toLowerCase().trim());
  if (matchingUsers.length === 0) return null;
  const combinedRoles = matchingUsers.map(u => String(u.Role || '')).join(', ');
  const moduleAccess = String(matchingUsers[0]['Modules'] || '').split(',').map(m => m.trim().toLowerCase());
  const hasModuleAccess = moduleAccess.includes('disbursement');
  return {
    email: matchingUsers[0].Email,
    fullName: matchingUsers[0]['Full Name'],
    role: combinedRoles,
    workEmail: matchingUsers[0]['Work Email'] || matchingUsers[0].Email,
    signatureUrl: matchingUsers[0]['Signature URL'] || '',
    moduleAccess: moduleAccess,
    hasModuleAccess: hasModuleAccess
  };
}

function getSS_() {
  try { const ss = SpreadsheetApp.getActiveSpreadsheet(); if (ss) return ss; } catch(e) {}
  return SpreadsheetApp.openById('1qVExR4ZOSYR-46-7YwHr48SGnVvMISKiSsO2kV4yHz0'); 
}

function sanitizeData_(data) {
  if (data == null) return data;
  if (data instanceof Date) return data.toISOString();
  if (Array.isArray(data)) return data.map(sanitizeData_);
  if (typeof data === 'object') { const obj = {}; for (const key in data) obj[key] = sanitizeData_(data[key]); return obj; }
  return data;
}

function escapeHtml_(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getTargetSheet_(sheetName) {
  const ss = getSS_(); let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    if (sheetName === 'DisbursementReports') { sheet = ss.insertSheet('DisbursementReports'); sheet.appendRow(['ReportId', 'Date', 'BankCode', 'TotalAmount', 'CreatedAt', 'CreatedBy', 'BankBalances', 'ExpectedCollection']); return sheet; }
    if (sheetName === 'DisbursementLines') { sheet = ss.insertSheet('DisbursementLines'); sheet.appendRow(['ReportId', 'VoucherId', 'LineNo', 'CheckNumber', 'BankReference', 'Amount', 'Status', 'BankCode', 'CreatedAt', 'CreatedBy']); return sheet; }
    if (sheetName === 'DailyBankBalances') { sheet = ss.insertSheet('DailyBankBalances'); sheet.appendRow(['Date', 'BankCode', 'BegBalance', 'EndBalance', 'UpdatedAt', 'UpdatedBy']); return sheet; }
    if (sheetName === 'WeeklyProjections') { sheet = ss.insertSheet('WeeklyProjections'); sheet.appendRow(['ProjId', 'WeekCoverage', 'StartDate', 'EndDate', 'TotalAmount', 'CreatedAt', 'CreatedBy']); return sheet; }
    if (sheetName === 'WeeklyProjectionLines') { sheet = ss.insertSheet('WeeklyProjectionLines'); sheet.appendRow(['ProjId', 'VoucherType', 'Purpose', 'Contact', 'Description', 'DueDate', 'BankCode', 'Amount', 'Status', 'LinkedVoucherId']); return sheet; }
    if (sheetName === 'WeeklyProjectionInflows') { sheet = ss.insertSheet('WeeklyProjectionInflows'); sheet.appendRow(['ProjId', 'Source', 'Description', 'ExpectedDate', 'BankCode', 'Amount']); return sheet; }
    if (sheetName === 'ServiceInvoices') { sheet = ss.insertSheet('ServiceInvoices'); sheet.appendRow(['SiId', 'Contact', 'SiDate', 'DueDate', 'Amount', 'AppliedAmount', 'Balance', 'Status', 'BillingStatementId', 'Notes', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy']); return sheet; }
    if (sheetName === 'BillingStatements') { sheet = ss.insertSheet('BillingStatements'); sheet.appendRow(['BsId', 'Client', 'Contact', 'BillingNo', 'BillingPeriod', 'BillingDate', 'CreditTerm', 'BillingDate2', 'TotalSalesVatInclusive', 'LessVAT', 'Total', 'LessWithholdingTax', 'CostOfService', 'PaymentDue', 'ChargesReversal', 'AmountCollected', 'DaysDue', 'TotalAmount', 'AppliedAmount', 'Balance', 'Status', 'ReferenceSiIds', 'Notes', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy']); return sheet; }
    if (sheetName === 'Collections') { sheet = ss.insertSheet('Collections'); sheet.appendRow(['CollectionId', 'SiId', 'BillingStatementId', 'Contact', 'CollectionDate', 'AmountReceived', 'AppliedAmount', 'UnappliedAmount', 'Method', 'ReferenceNo', 'Status', 'Notes', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy']); return sheet; }
    if (sheetName === 'CollectionApplications') { sheet = ss.insertSheet('CollectionApplications'); sheet.appendRow(['AppId', 'CollectionId', 'BillingStatementId', 'SiId', 'Contact', 'AppliedAmount', 'AppliedAt', 'AppliedBy', 'Note']); return sheet; }
    if (sheetName === 'JournalLines') { sheet = ss.insertSheet('JournalLines'); sheet.appendRow(['voucher_id', 'je_id', 'line_no', 'account_code', 'account_name', 'description', 'contact', 'class', 'debit', 'credit', 'date']); return sheet; }
    if (sheetName === 'Settings') { sheet = ss.insertSheet('Settings'); sheet.appendRow(['Key', 'Value']); return sheet; }
    if (sheetName === 'BankStatements') { sheet = ss.insertSheet('BankStatements'); sheet.appendRow(['StatementId','BankCode','FileName','FileId','DriveUrl','UploadedAt','UploadedBy']); sheet.setFrozenRows(1); return sheet; }
    if (sheetName === 'BankStatementLines') { sheet = ss.insertSheet('BankStatementLines'); sheet.appendRow(['StatementId','BankCode','LineId','TxDate','Description','Reference','Debit','Credit','Balance','IsReconciled','ReconciledWithJEId','ReconciledAt','ReconciledBy']); sheet.setFrozenRows(1); return sheet; }
    if (sheetName === 'BankReconSessions') { sheet = ss.insertSheet('BankReconSessions'); sheet.appendRow(['SessionId','BankCode','StmtEndDate','StmtEndBal','BeginBal','EndingBalance','ClearedCount','ReconciledAt','ReconciledBy']); sheet.setFrozenRows(1); return sheet; }
    if (sheetName === 'FinancialLoans') { sheet = ss.insertSheet('FinancialLoans'); sheet.appendRow(['LoanId','LoanName','LoanType','FirstPayment','Principal','TermMonths','AnnualRate','InterestMethod','ProcessingFee','ProceedsDate','Status','PaymentFrequency','PayDayMode','PayDays','PayDaysPerMonth','PaymentMethod','PMChecks','PMAdaDay','PMAdaBank','PMBtBank','PMAutoVoucher','UpdatedAt','UpdatedBy']); sheet.setFrozenRows(1); return sheet; }
    if (sheetName === 'FinancialMeta')  { sheet = ss.insertSheet('FinancialMeta');  sheet.appendRow(['ProfileId', 'Label', 'CreatedAt', 'CreatedBy']); sheet.appendRow([1, 'Financial Management', new Date().toISOString(), 'system']); sheet.setFrozenRows(1); return sheet; }
    if (sheetName === 'CheckbookMaster') { sheet = ss.insertSheet('CheckbookMaster'); sheet.appendRow(['CheckbookId','BankCode','StartingNumber','EndingNumber','NextCheckNumber','IsActive','Notes','CreatedAt','CreatedBy']); sheet.setFrozenRows(1); return sheet; }
    if (sheetName === 'CheckRegister')    { sheet = ss.insertSheet('CheckRegister');    sheet.appendRow(['CheckId','CheckbookId','BankCode','CheckNumber','IssueDate','PayeeName','Amount','Status','ReferenceType','ReferenceId','ClearedDate','VoidedDate','VoidReason','StoppedDate','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy']); sheet.setFrozenRows(1); return sheet; }
    if (sheetName === 'PaymentSchedules') { sheet = ss.insertSheet('PaymentSchedules'); sheet.appendRow(['id','title','contactId','category','amount','frequency','dueDay','startDate','endDate','dueDate','bankCode','status','notes','linkedVoucherId','paymentMethod','pmCheckNo','pmCheckDate','pmCheckBank','pmBtBank','pmBtRefNo','pmAdaDay','createdAt','updatedAt']); sheet.setFrozenRows(1); return sheet; }
    sheet = ss.getSheets().find(s => s.getName().trim().toLowerCase() === sheetName.trim().toLowerCase());
  }
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found.`);
  return sheet;
}

function getSheetData_(sheetName) {
  const sheet = getTargetSheet_(sheetName); const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0]; const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i]; if (row.join('').trim() === '') continue; 
    const obj = {}; headers.forEach((h, colIdx) => { if (h) obj[String(h).trim()] = row[colIdx]; }); result.push(obj);
  }
  return result;
}

function parseBool_(val) { return String(val).toUpperCase() === 'TRUE'; }

function getRoleEmails_(roleSubstring) {
  const users = getCentralSheetData_('Users');
  const emails = [];
  users.forEach(u => {
    const role = String(u.Role || '').toUpperCase();
    const moduleAccess = String(u['Modules'] || '').split(',').map(m => m.trim().toLowerCase());
    if (!moduleAccess.includes('disbursement')) return;
    const workEmail = String(u['Work Email'] || u.Email || '').trim();
    if (role.includes(roleSubstring.toUpperCase()) && workEmail !== '') {
      if (!emails.includes(workEmail)) emails.push(workEmail);
    }
  });
  return emails;
}

function getActionUser_() { const email = Session.getActiveUser().getEmail(); const access = getUserAccess_(email); return access ? access.fullName : email; }

function getEmailByDisplayName_(displayName) {
  if (!displayName) return null;
  const users = getCentralSheetData_('Users');
  const name = String(displayName).trim().toLowerCase();
  const match = users.find(u => String(u['Full Name'] || '').trim().toLowerCase() === name);
  if (!match) return null;
  return String(match['Work Email'] || match['Email'] || '').trim() || null;
}

// --- FIXED: ADDED JOURNALLINES FETCH ---
function getDashboardData() {
    var _errors = [];
    function safe_(key, fn, fallback) {
      try { return fn(); }
      catch(e) {
        var msg = '[' + key + '] ' + e.message;
        Logger.log('getDashboardData error: ' + msg);
        _errors.push(msg);
        return fallback;
      }
    }
    var result = {
        vouchers:              safe_('Vouchers',              function(){ return getSheetData_('Vouchers').reverse(); }, []),
        voucherLines:          safe_('VoucherLines',          function(){ return getSheetData_('VoucherLines'); }, []),
        reports:               safe_('DisbursementReports',   function(){ return getSheetData_('DisbursementReports').reverse(); }, []),
        reportLines:           safe_('DisbursementLines',     function(){ return getSheetData_('DisbursementLines'); }, []),
        accounts:              safe_('Accounts',              function(){ return getCentralAccountsData_(); }, []),
        dailyBalances:         safe_('DailyBankBalances',     function(){ return getSheetData_('DailyBankBalances'); }, []),
        projections:           safe_('WeeklyProjections',     function(){ return getSheetData_('WeeklyProjections').reverse(); }, []),
        projectionLines:       safe_('WeeklyProjectionLines', function(){ return getSheetData_('WeeklyProjectionLines'); }, []),
        projectionInflows:     safe_('WeeklyProjectionInflows', function(){ return getSheetData_('WeeklyProjectionInflows'); }, []),
        journalLines:          safe_('JournalLines',          function(){ return getCentralJournalLinesData_(); }, []),
        contacts:              safe_('Contacts',              function(){ return getCentralSheetData_('Contacts'); }, []),
        taxEntries:            safe_('TaxEntries',            function(){ return getTaxEntries_(); }, []),
        fixedAssets:           safe_('FixedAssets',           function(){ return JSON.parse(loadFixedAssets() || '{"assets":[]}').assets; }, []),
        fixedAssetTypes:       safe_('FixedAssetTypes',       function(){ return JSON.parse(loadFixedAssetTypes() || '{"types":[]}').types; }, []),
        paymentSchedules:      safe_('PaymentSchedules',      function(){ return getSheetData_('PaymentSchedules'); }, []),
        fincLoans:             safe_('FincLoans',             function(){ var json = loadFincProfile(); if (!json) return []; var p = JSON.parse(json); return p.loans || []; }, []),
        _errors:               _errors
    };
    return sanitizeData_(result);
}

// ── Payment Schedule CRUD ─────────────────────────────────────────────────

const PS_HEADERS_ = ['id','title','contactId','category','amount','frequency','dueDay','startDate','endDate','dueDate','bankCode','status','notes','linkedVoucherId','paymentMethod','pmCheckNo','pmCheckDate','pmCheckBank','pmBtBank','pmBtRefNo','pmAdaDay','createdAt','updatedAt'];

function getPaymentScheduleSheet_() {
  var sheet = getTargetSheet_('PaymentSchedules');
  // Ensure headers exist on first use
  var firstRow = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
  if (!firstRow[0] || String(firstRow[0]).trim() === '') {
    sheet.getRange(1, 1, 1, PS_HEADERS_.length).setValues([PS_HEADERS_]);
  }
  return sheet;
}

function savePaymentSchedule(payload) {
  if (!payload || !payload.id)                throw new Error('payload.id is required.');
  if (!payload.title)                         throw new Error('payload.title is required.');
  if (!payload.dueDate && !payload.startDate) throw new Error('payload.dueDate or startDate is required.');
  // For recurring entries: mirror startDate into dueDate when dueDate is absent
  if (!payload.dueDate && payload.startDate)  payload.dueDate = payload.startDate;

  var sheet = getPaymentScheduleSheet_();
  var now   = new Date();
  var data  = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h){ return String(h).trim(); });

  function colVal(key, fallback) {
    return payload[key] !== undefined ? payload[key] : (fallback !== undefined ? fallback : '');
  }

  var row = PS_HEADERS_.map(function(h) {
    if (h === 'createdAt') return now;
    if (h === 'updatedAt') return now;
    return colVal(h, '');
  });

  // Check for existing row to update
  var idIdx = headers.indexOf('id');
  if (idIdx >= 0) {
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idIdx] || '') === String(payload.id)) {
        // Preserve original createdAt
        var createdAtIdx = PS_HEADERS_.indexOf('createdAt');
        if (createdAtIdx >= 0 && data[i][headers.indexOf('createdAt')]) {
          row[createdAtIdx] = data[i][headers.indexOf('createdAt')];
        }
        sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
        return { ok: true, action: 'updated' };
      }
    }
  }
  // New row
  sheet.appendRow(row);
  return { ok: true, action: 'created' };
}

function deletePaymentSchedule(id) {
  if (!id) throw new Error('id is required.');
  var sheet   = getPaymentScheduleSheet_();
  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h){ return String(h).trim(); });
  var idIdx   = headers.indexOf('id');
  if (idIdx < 0) throw new Error('id column not found in PaymentSchedules sheet.');
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idIdx] || '') === String(id)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  throw new Error('Payment schedule not found: ' + id);
}

/**
 * Returns all PaymentSchedule occurrences within [startDateStr, endDateStr] (inclusive).
 * Expands One-Time, Monthly, Quarterly, Semi-Annual, and Annual recurring entries.
 * A blank endDate on a recurring schedule means it is ongoing indefinitely.
 */
function getScheduledPaymentsForRange(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) return [];
  var schedules = getSheetData_('PaymentSchedules');
  var results   = [];
  var seenKeys  = {};
  var s0 = new Date(startDateStr + 'T00:00:00');
  var s1 = new Date(endDateStr   + 'T00:00:00');
  var curY = s0.getFullYear(), curM = s0.getMonth() + 1;
  var endY = s1.getFullYear(), endM = s1.getMonth() + 1;

  while (curY < endY || (curY === endY && curM <= endM)) {
    var dim    = new Date(curY, curM, 0).getDate();
    var mStart = curY + '-' + String(curM).padStart(2,'0') + '-01';
    var mEnd   = curY + '-' + String(curM).padStart(2,'0') + '-' + String(dim).padStart(2,'0');

    schedules.forEach(function(s) {
      if (!s || String(s.status || '') === 'Cancelled') return;
      var freq      = String(s.frequency  || 'One-Time');
      var startDate = String(s.startDate  || s.dueDate || '');
      var endDate   = String(s.endDate    || '');
      var dueDate   = String(s.dueDate    || startDate);

      if (freq === 'One-Time') {
        if (!dueDate || dueDate < startDateStr || dueDate > endDateStr) return;
        var key = String(s.id) + '|' + dueDate;
        if (!seenKeys[key]) { seenKeys[key] = true; results.push(Object.assign({}, s, { dueDate: dueDate })); }
        return;
      }

      if (!startDate) return;
      var sDate = new Date(startDate + 'T00:00:00');
      if (sDate > new Date(mEnd   + 'T00:00:00')) return;
      if (endDate && new Date(endDate + 'T00:00:00') < new Date(mStart + 'T00:00:00')) return;

      var sY   = sDate.getFullYear(), sM = sDate.getMonth() + 1;
      var diff = (curY - sY) * 12 + (curM - sM);
      var occurs = false;
      if      (freq === 'Monthly')      occurs = diff >= 0;
      else if (freq === 'Quarterly')    occurs = diff >= 0 && diff % 3  === 0;
      else if (freq === 'Semi-Annual')  occurs = diff >= 0 && diff % 6  === 0;
      else if (freq === 'Annual')       occurs = diff >= 0 && diff % 12 === 0;
      if (!occurs) return;

      var dueDay    = parseInt(s.dueDay) || sDate.getDate();
      var actualDay = Math.min(dueDay, dim);
      var occDate   = curY + '-' + String(curM).padStart(2,'0') + '-' + String(actualDay).padStart(2,'0');
      if (occDate < startDateStr || occDate > endDateStr) return;
      var key = String(s.id) + '|' + occDate;
      if (!seenKeys[key]) { seenKeys[key] = true; results.push(Object.assign({}, s, { dueDate: occDate, _isRecurring: true })); }
    });

    curM++;
    if (curM > 12) { curM = 1; curY++; }
  }

  results.sort(function(a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
  return sanitizeData_(results);
}

function getContacts() {
  return sanitizeData_(getCentralSheetData_('Contacts'));
}

/**
 * Returns service fee rate (decimal) for a Customer contact.
 * Reads Contacts.'Service Fee' column. Falls back to 0.10 if missing or not Customer.
 */
function getContactServiceFeeRate_(contactIdOrName) {
  try {
    const contacts = getCentralSheetData_('Contacts');
    const key = String(contactIdOrName || '').trim().toLowerCase();
    if (!key) return 0.10;
    for (var i = 0; i < contacts.length; i++) {
      var c = contacts[i];
      var idMatch   = String(c['ContactID']   || '').trim().toLowerCase() === key;
      var nameMatch = String(c['ContactName'] || '').trim().toLowerCase() === key;
      if (!idMatch && !nameMatch) continue;
      if (String(c['ContactType'] || '').trim().toLowerCase() !== 'customer') return 0.10;
      var sf = parseFloat(String(c['Service Fee'] || '').replace('%', '').trim());
      if (isNaN(sf) || sf <= 0) return 0.10;
      return sf > 1 ? sf / 100 : sf;  // stored as 10 → 0.10; or already 0.10
    }
  } catch(e) { Logger.log('getContactServiceFeeRate_: ' + e.message); }
  return 0.10;
}

/**
 * Returns all contacts where ParentContact === parentContactId.
 */
function getChildContacts(parentContactId) {
  const contacts = getCentralSheetData_('Contacts');
  const key = String(parentContactId || '').trim().toLowerCase();
  const children = contacts.filter(function(c) {
    return String(c['ParentContact'] || '').trim().toLowerCase() === key;
  });
  return sanitizeData_({ ok: true, contacts: children });
}

function generateContactId_() {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const seqSheet = getCentralSS_().getSheetByName('Sequence');
    if (!seqSheet) throw new Error('Sequence sheet not found.');
    const data = seqSheet.getDataRange().getValues();
    const KEY = 'SEQ_CNT';
    let rowIdx = -1, seq = 1;
    data.forEach((row, i) => { if (String(row[0]).trim() === KEY) { rowIdx = i + 1; seq = Number(row[1]) || 1; } });
    const id = 'CNT-' + String(seq).padStart(4, '0');
    if (rowIdx > 0) seqSheet.getRange(rowIdx, 2).setValue(seq + 1);
    else seqSheet.appendRow([KEY, seq + 1]);
    return id;
  } finally { lock.releaseLock(); }
}

function saveContact(payload) {
  const ss = getCentralSS_();
  let sheet = ss.getSheetByName('Contacts');
  if (!sheet) {
    sheet = ss.insertSheet('Contacts');
    sheet.appendRow(['ContactID','ContactName','IsActive','ContactType','Cost Center','Category','TIN','Email','Phone','ParentContact','ARAccount','APAccount','Address Line 1','Address Line 2','Postal','City','Terms']);
  }
  const data = sheet.getDataRange().getValues();
  if (data.length === 0) throw new Error('Contacts sheet is empty.');
  const headers = data[0].map(h => String(h).trim());
  const nameIdx = headers.indexOf('ContactName');
  if (nameIdx === -1) throw new Error('ContactName column not found.');
  const contactName = String(payload.contactName || payload.ContactName || '').trim();
  if (!contactName) throw new Error('ContactName is required.');
  // Find existing row first (needed to preserve existing ContactID)
  let foundRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][nameIdx] || '').trim().toLowerCase() === contactName.toLowerCase()) { foundRow = i + 1; break; }
  }
  // Read existing ContactID so it is never overwritten on update
  const contactIdIdx = headers.indexOf('ContactID');
  let existingContactId = '';
  if (foundRow > -1 && contactIdIdx > -1) {
    existingContactId = String(data[foundRow - 1][contactIdIdx] || '').trim();
  }
  // Ensure new columns exist on older sheets (additive migration)
  const ensureCol_ = (colName) => { if (!headers.includes(colName)) { sheet.getRange(1, headers.length + 1).setValue(colName); headers.push(colName); } };
  ['ContactID','Email','Phone','ParentContact','ARAccount','APAccount','Service Fee'].forEach(ensureCol_);
  const record = headers.map(h => {
    if (h === 'ContactID')      return existingContactId || payload.contactId || generateContactId_();
    if (h === 'ContactName')    return contactName;
    if (h === 'IsActive')       return payload.isActive != null ? String(payload.isActive) : 'TRUE';
    if (h === 'ContactType')    return payload.contactType   || payload.ContactType   || '';
    if (h === 'Cost Center')    return payload.costCenter    || payload.CostCenter    || '';
    if (h === 'Category')       return payload.category      || payload.Category      || '';
    if (h === 'TIN')            return payload.tin           || payload.TIN           || '';
    if (h === 'Email')          return payload.email         || payload.Email         || '';
    if (h === 'Phone')          return payload.phone         || payload.Phone         || '';
    if (h === 'ParentContact')  return payload.parentContact || payload.ParentContact || '';
    if (h === 'ARAccount')      return payload.arAccount     || payload.ARAccount     || '';
    if (h === 'APAccount')      return payload.apAccount     || payload.APAccount     || '';
    if (h === 'Address Line 1') return payload.addressLine1  || payload.AddressLine1  || '';
    if (h === 'Address Line 2') return payload.addressLine2  || payload.AddressLine2  || '';
    if (h === 'Postal')         return payload.postal        || payload.Postal        || '';
    if (h === 'City')           return payload.city          || payload.City          || '';
    if (h === 'Terms')          return payload.terms         || payload.Terms         || '';
    if (h === 'Service Fee') {
      const ctype = String(payload.contactType || payload.ContactType || '').trim().toLowerCase();
      if (ctype !== 'customer') return '';
      const sf = payload.serviceFee != null ? payload.serviceFee : (payload['Service Fee'] != null ? payload['Service Fee'] : '');
      return sf !== '' && sf != null ? String(sf) : '';
    }
    return '';
  });
  if (foundRow > -1) {
    sheet.getRange(foundRow, 1, 1, record.length).setValues([record]);
  } else {
    sheet.appendRow(record);
  }
  return sanitizeData_({ ok: true, contactName: contactName });
}

function getAppConfig() {
  const email = Session.getActiveUser().getEmail();
  const access = getUserAccess_(email);

  // Open Central Settings once and read all needed sheets in one go
  const centralSS = getCentralSS_();
  const readSheet_ = (sheetName) => {
    const sh = centralSS.getSheetByName(sheetName); if (!sh) return [];
    const d = sh.getDataRange().getValues(); if (d.length < 2) return [];
    const hdrs = d[0];
    return d.slice(1).filter(r => r.join('').trim() !== '').map(r => { const o = {}; hdrs.forEach((h, i) => { if (h) o[String(h).trim()] = r[i]; }); return o; });
  };
  const settings = {};
  readSheet_('Modules').forEach(r => { if (r.Key) settings[r.Key] = r.Value; });
  readSheet_('Sequence').forEach(r => { if (r.Key) settings[r.Key] = r.Value; });
  const purposeCategories = (settings['PURPOSE_CATEGORIES'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const statuses = (settings['STATUSES'] || 'Pending,Pending Review,Pending Approval,Approved,Paid,Voided,For Disbursement,Rejected').split(',').map(s => s.trim()).filter(Boolean);

  let isReviewer = false; let isApprover = false; let isAdmin = false;
  if (access && access.role) {
     const roleStr = String(access.role).toUpperCase();
     if (roleStr.includes('REVIEWER')) isReviewer = true;
     if (roleStr.includes('APPROVER')) isApprover = true;
     if (roleStr.includes('ADMIN')) isAdmin = true;
  }

  // Contacts from Central Settings (same SS already open)
  const activeContacts = []; const contactDetails = [];
  const ccRows = readSheet_('Contacts');
  if (ccRows.length > 0) {
    const sample = ccRows[0];
    const keys = Object.keys(sample);
    const nameKey   = keys.find(k => k.toLowerCase() === 'contactname') || '';
    const activeKey = keys.find(k => k.toLowerCase() === 'isactive') || '';
    const acrKey    = keys.find(k => k.toLowerCase() === 'cost center' || k.toLowerCase() === 'acronym') || '';
    const catKey    = keys.find(k => k.toLowerCase() === 'category') || '';
    ccRows.forEach(r => {
      const name = nameKey ? String(r[nameKey] || '').trim() : '';
      if (!name) return;
      const isActive = activeKey ? parseBool_(r[activeKey]) : true;
      if (isActive) activeContacts.push(name);
      contactDetails.push({ name, acronym: acrKey ? String(r[acrKey] || '').trim() : '', category: catKey ? String(r[catKey] || '').trim() : 'Deployed' });
    });
  }

  return sanitizeData_({ 
      currentUserEmail: email, isReviewer: isReviewer, isApprover: isApprover, isAdmin: isAdmin,
      voucherTypes: [{id: 'PAYMENT', label: 'Payment Voucher'}, {id: 'PAYROLL', label: 'Payroll Voucher'}, {id: 'FINAL_PAY', label: 'Final Pay Voucher'}, {id: 'LOAN', label: 'Loan Voucher'}], 
      purposeCategories: purposeCategories, statuses: statuses, taxRates: getTaxRates(), taxGroups: getTaxGroups(), contacts: activeContacts, contactDetails: contactDetails,
      billingWebAppUrl: String(settings['BILLING_WEB_APP_URL'] || '')
  });
}

function getUsersAndRoles() {
  const email = Session.getActiveUser().getEmail();
  const access = getUserAccess_(email);
  if (!access || !String(access.role || '').toUpperCase().includes('ADMIN')) {
    throw new Error('Access denied. Only Admins can view Users & Roles.');
  }
  const users = getCentralSheetData_('Users');
  return sanitizeData_(users.map(u => ({
    email:        u['Email']         || '',
    fullName:     u['Full Name']     || '',
    workEmail:    u['Work Email']    || '',
    roles:        String(u['Role'] || '').split(',').map(r => r.trim()).filter(Boolean),
    moduleAccess: String(u['Modules'] || '').split(',').map(m => m.trim()).filter(Boolean),
    signatureUrl: u['Signature URL'] || ''
  })));
}

function saveUserCentral(payload) {
  const callerEmail = Session.getActiveUser().getEmail();
  const access = getUserAccess_(callerEmail);
  if (!access || !String(access.role || '').toUpperCase().includes('ADMIN'))
    throw new Error('Access denied. Only Admins can manage users.');
  const { email, fullName, roles, workEmail, signatureUrl, isNew, moduleAccess } = payload;
  if (!email || !fullName || !roles || roles.length === 0)
    throw new Error('Email, Full Name, and at least one Role are required.');
  const sheet = getCentralSS_().getSheetByName('Users');
  if (!sheet) throw new Error('Users sheet not found in Central Settings.');
  const data = sheet.getDataRange().getValues();
  const h = data[0];
  const eIdx = h.indexOf('Email'), nIdx = h.indexOf('Full Name'), rIdx = h.indexOf('Role'),
        wIdx = h.indexOf('Work Email'), mIdx = h.indexOf('Modules'), sIdx = h.indexOf('Signature URL');
  const roleStr = (Array.isArray(roles) ? roles : [roles]).join(', ');
  const managed = ['Payroll','Disbursement','Accounting','Billing'];
  const buildMods = (existingStr) => {
    const incoming = Array.isArray(moduleAccess) ? moduleAccess : [];
    const existing = String(existingStr || '').split(',').map(m => m.trim()).filter(Boolean);
    const unmanaged = existing.filter(m => !managed.map(x => x.toLowerCase()).includes(m.toLowerCase()));
    const result = incoming.filter(m => managed.map(x => x.toLowerCase()).includes(m.toLowerCase()));
    if (!result.map(m => m.toLowerCase()).includes('disbursement')) result.push('Disbursement');
    return [...result, ...unmanaged].join(', ');
  };
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][eIdx]).trim().toLowerCase() === email.toLowerCase()) {
      if (isNew) throw new Error('A user with this email already exists.');
      const newMods = buildMods(data[i][mIdx]);
      sheet.getRange(i + 1, eIdx + 1).setValue(email);
      sheet.getRange(i + 1, nIdx + 1).setValue(fullName);
      sheet.getRange(i + 1, rIdx + 1).setValue(roleStr);
      sheet.getRange(i + 1, wIdx + 1).setValue(workEmail || '');
      sheet.getRange(i + 1, mIdx + 1).setValue(newMods);
      if (signatureUrl) sheet.getRange(i + 1, sIdx + 1).setValue(signatureUrl);
      return { ok: true };
    }
  }
  if (!isNew) throw new Error('User not found.');
  const newRow = new Array(h.length).fill('');
  newRow[eIdx] = email; newRow[nIdx] = fullName; newRow[rIdx] = roleStr;
  newRow[wIdx] = workEmail || ''; newRow[mIdx] = buildMods(''); newRow[sIdx] = signatureUrl || '';
  sheet.appendRow(newRow);
  return { ok: true };
}

function deleteUserCentral(emailToDelete) {
  const callerEmail = Session.getActiveUser().getEmail();
  const access = getUserAccess_(callerEmail);
  if (!access || !String(access.role || '').toUpperCase().includes('ADMIN'))
    throw new Error('Access denied. Only Admins can manage users.');
  if (emailToDelete.toLowerCase() === callerEmail.toLowerCase())
    throw new Error('You cannot delete your own account.');
  const sheet = getCentralSS_().getSheetByName('Users');
  if (!sheet) throw new Error('Users sheet not found in Central Settings.');
  const data = sheet.getDataRange().getValues();
  const h = data[0];
  const eIdx = h.indexOf('Email'), rIdx = h.indexOf('Role');
  let adminCount = 0, targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    const rowRoles = String(data[i][rIdx] || '').split(',').map(s => s.trim().toLowerCase());
    if (rowRoles.includes('admin')) adminCount++;
    if (String(data[i][eIdx]).trim().toLowerCase() === emailToDelete.toLowerCase()) targetRow = i + 1;
  }
  if (targetRow === -1) throw new Error('User not found.');
  const targetRoles = String(data[targetRow - 1][rIdx] || '').split(',').map(s => s.trim().toLowerCase());
  if (targetRoles.includes('admin') && adminCount <= 1)
    throw new Error('Cannot delete the last Admin user.');
  sheet.deleteRow(targetRow);
  return { ok: true };
}

function uploadSignatureImageCentral(payload) {
  const callerEmail = Session.getActiveUser().getEmail();
  const access = getUserAccess_(callerEmail);
  if (!access || !String(access.role || '').toUpperCase().includes('ADMIN'))
    throw new Error('Access denied. Only Admins can upload signatures.');
  const { email, base64Data, mimeType } = payload;
  if (!email || !base64Data) throw new Error('Email and image data are required.');
  const ext = (mimeType || 'image/png').split('/')[1] || 'png';
  const safeName = 'sig_' + email.replace(/[^a-z0-9]/gi, '_') + '.' + ext;
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, safeName);
  const parent = DriveApp.getFolderById(SIGNATURES_FOLDER_ID);
  const iter = parent.getFoldersByName('Signatures');
  const sigFolder = iter.hasNext() ? iter.next() : parent.createFolder('Signatures');
  const old = sigFolder.getFilesByName(safeName);
  while (old.hasNext()) old.next().setTrashed(true);
  const file = sigFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = 'https://drive.google.com/file/d/' + file.getId() + '/view?usp=sharing';
  const sheet = getCentralSS_().getSheetByName('Users');
  const data = sheet.getDataRange().getValues();
  const h = data[0];
  const eIdx = h.indexOf('Email'), sIdx = h.indexOf('Signature URL');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][eIdx]).trim().toLowerCase() === email.toLowerCase()) {
      sheet.getRange(i + 1, sIdx + 1).setValue(url); break;
    }
  }
  return { ok: true, url: url };
}

function getVoucherIdSettings() {
  const s = {};
  getCentralSheetData_('Modules').forEach(row => { if (row.Key) s[row.Key] = row.Value; });
  getCentralSheetData_('Sequence').forEach(row => { if (row.Key) s[row.Key] = row.Value; });
  const getCfg = (type) => ({ prefix: s[`${type}_PREFIX`] || (type === 'DISB' ? 'DR' : type === 'IS' ? 'IS' : type === 'WP' ? 'WP' : type.substring(0,3)), includeYear: s['INCLUDE_YEAR'] !== undefined ? parseBool_(s['INCLUDE_YEAR']) : true, includeMonth: s['INCLUDE_MONTH'] !== undefined ? parseBool_(s['INCLUDE_MONTH']) : true, startSeq: Number(s[`STARTING_SEQUENCE_${type}`] || 1) });
  return sanitizeData_({ raw: s, PAYMENT: getCfg('PAYMENT'), CHECK: getCfg('CHECK'), DISB: getCfg('DISB'), WP: getCfg('WP'), ROUTING: { reviewerName: s['REVIEWER_NAME'] || '', reviewerEmail: s['REVIEWER_EMAIL'] || '', approverName: s['APPROVER_NAME'] || '', approverEmail: s['APPROVER_EMAIL'] || '', notedByName: s['NOTED_BY_NAME'] || '' } });
}

function saveSettingsBulk(updates) {
  const centralSS = getCentralSS_();
  const progSheet = centralSS.getSheetByName('Modules');
  const seqSheet  = centralSS.getSheetByName('Sequence');
  const writeToSheet = (sheet, upd) => {
    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      const key = data[i][0];
      if (upd.hasOwnProperty(key)) { sheet.getRange(i + 1, 2).setValue(upd[key]); delete upd[key]; }
    }
    for (const key in upd) sheet.appendRow([key, upd[key]]);
  };
  const seqUpdates = {}, progUpdates = {};
  for (const key in updates) {
    if (key.startsWith('SEQ_') || key.startsWith('STARTING_SEQUENCE_') || key.endsWith('_PREFIX') || key === 'INCLUDE_YEAR' || key === 'INCLUDE_MONTH') seqUpdates[key] = updates[key];
    else progUpdates[key] = updates[key];
  }
  if (Object.keys(progUpdates).length > 0) writeToSheet(progSheet, progUpdates);
  if (Object.keys(seqUpdates).length > 0)  writeToSheet(seqSheet,  seqUpdates);
  return true;
}

function generateVoucherId_(type, prepDate) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const centralSS = getCentralSS_();
    const progSheet = centralSS.getSheetByName('Modules');
    const progData  = progSheet.getDataRange().getValues();
    const progMap   = {};
    progData.forEach(row => { if (row[0]) progMap[row[0]] = row[1]; });

    const seqSheet = centralSS.getSheetByName('Sequence');
    if (!seqSheet) throw new Error('Sequence sheet not found in Central Settings.');
    const seqData = seqSheet.getDataRange().getValues();
    const s = {}; const rowMap = {};
    seqData.forEach((row, i) => { if (row[0]) { s[row[0]] = row[1]; rowMap[row[0]] = i + 1; } });

    let prefix = progMap[`${type}_PREFIX`];
    if (!prefix || String(prefix).includes('undefined')) prefix = (type === 'DISB' ? 'DR' : type === 'IS' ? 'IS' : type === 'WP' ? 'WP' : type.substring(0,3));

    const incYear  = parseBool_(progMap['INCLUDE_YEAR']  !== undefined ? progMap['INCLUDE_YEAR']  : true);
    const incMonth = parseBool_(progMap['INCLUDE_MONTH'] !== undefined ? progMap['INCLUDE_MONTH'] : true);
    const ref = prepDate ? new Date(prepDate) : new Date(); const yyyy = String(ref.getFullYear()); const mm = String(ref.getMonth() + 1).padStart(2, '0');
    const periodKey = `SEQ_${type}_${incYear ? yyyy : ''}${incMonth ? mm : ''}`;

    let seqVal = (incYear || incMonth) ? (s[periodKey] || s[`STARTING_SEQUENCE_${type}`]) : s[`STARTING_SEQUENCE_${type}`];
    if (!seqVal || String(seqVal).includes('undefined')) seqVal = 1;
    let seq = Number(seqVal) || 1;

    const id = `${prefix}${incYear ? yyyy : ''}${incMonth ? mm : ''}${String(seq).padStart(4, '0')}`;
    const targetKey = (incYear || incMonth) ? periodKey : `STARTING_SEQUENCE_${type}`;
    if (rowMap[targetKey]) seqSheet.getRange(rowMap[targetKey], 2).setValue(seq + 1); else seqSheet.appendRow([targetKey, seq + 1]);
    return id;
  } finally { lock.releaseLock(); }
}

function ensureVouchersHeaders_(sheet) {
    if (sheet.getLastRow() === 0) { const h = ['VoucherId', 'VoucherType', 'PreparationDate', 'PurposeCategory', 'Status', 'PaymentFromAccountCode', 'ContactSummary', 'TotalAmount', 'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy', 'CheckNumber', 'CheckDate', 'IsMultipleChecks', 'ReviewedBy', 'ApprovedBy', 'RejectReason', 'DisbursementRef', 'PreDisbursementStatus', 'LinkedScheduleId', 'LinkedScheduleDate']; sheet.appendRow(h); return h; }
    const _h = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    // Additive migration: ensure linked schedule columns exist
    const _ensure = (col) => { if (!_h.includes(col)) { sheet.getRange(1, _h.length + 1).setValue(col); _h.push(col); } };
    ['LinkedScheduleId', 'LinkedScheduleDate'].forEach(_ensure);
    return _h;
}
function ensureVoucherLinesHeaders_(sheet) {
    let headers = [];
    if (sheet.getLastRow() === 0) {
        headers = ['VoucherId', 'Date', 'LineNo', 'Contact', 'ExpenseAccountCode', 'Description', 'Amount',
                   'CreatedAt', 'CreatedBy', 'UpdatedAt', 'UpdatedBy', 'Category', 'ManpowerCount',
                   'LineBankCode', 'LineCheckNumber', 'LineCheckDate',
                   'TaxType', 'EwtRate', 'VatAmount', 'EwtAmount'];
        sheet.appendRow(headers);
    } else {
        headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
        // Additive migration — add tax columns to existing sheets
        const ensure_ = (col) => { if (!headers.includes(col)) { sheet.getRange(1, headers.length + 1).setValue(col); headers.push(col); } };
        ['TaxType', 'EwtRate', 'VatAmount', 'EwtAmount'].forEach(ensure_);
    }
    return {
        headers: headers,
        cat:     headers.indexOf('Category'),
        mp:      headers.indexOf('ManpowerCount'),
        bank:    headers.indexOf('LineBankCode'),
        chkNo:   headers.indexOf('LineCheckNumber'),
        chkDate: headers.indexOf('LineCheckDate'),
        taxType: headers.indexOf('TaxType'),
        ewtRate: headers.indexOf('EwtRate'),
        vatAmt:  headers.indexOf('VatAmount'),
        ewtAmt:  headers.indexOf('EwtAmount')
    };
}

// Finds tax-related accounts in COA by name pattern (case-insensitive).
function findTaxAccounts_(accountsData) {
    const find_ = (pattern) => {
        const re = new RegExp(pattern, 'i');
        const acc = accountsData.find(a => re.test(String(a['Account Name'] || '')));
        return acc ? { code: String(acc['Account Code']), name: String(acc['Account Name']) } : null;
    };
    return {
        inputVat:   find_('input.?vat|vat.?input'),
        outputVat:  find_('output.?vat|vat.?output'),
        ewtPayable: find_('withholding.?tax.?payable|ewt.?payable|expanded.?withholding'),
        cwtReceivable: find_('creditable.?withholding|cwt.?receivable|deferred.?tax.?asset')
    };
}

function findAccountByNameOrCode_(nameOrCode, accountsData) {
  if (!nameOrCode || String(nameOrCode).trim() === '' || String(nameOrCode).trim() === '-') return null;
  const s = String(nameOrCode).trim();
  let acc = accountsData.find(a => String(a['Account Code']||'').trim() === s);
  if (!acc) { try { const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'); acc = accountsData.find(a => re.test(String(a['Account Name']||''))); } catch(e) {} }
  return acc ? { code: String(acc['Account Code']), name: String(acc['Account Name']) } : null;
}

function computeFromNewRates_(grossAmt, rates, isInclusive) {
  // isInclusive (per-line toggle): if true, positive rates are back-calculated from gross (VAT-style)
  //                                 negative rates (EWT) are always deductions regardless
  let run = grossAmt;
  const inclusiveTaxes = [];
  if (isInclusive) {
    rates.filter(r => r.ratePercent > 0).forEach(r => {
      const net = run / (1 + r.ratePercent / 100); const amt = run - net;
      inclusiveTaxes.push({ amt, account: r.taxAccount||'', name: r.name }); run = net;
    });
  }
  const net = run;
  const exclusiveTaxes = [];
  rates.filter(r => r.ratePercent !== 0 && (isInclusive ? r.ratePercent < 0 : true)).forEach(r => {
    const pct = r.ratePercent;
    if (!isInclusive && pct > 0) {
      // Exclusive positive: tax added on top (not deducted from payment)
      exclusiveTaxes.push({ amt: net * pct / 100, account: r.taxAccount||'', name: r.name, isDeduction: false });
    } else if (pct < 0) {
      // Negative rate: always a deduction from payment
      exclusiveTaxes.push({ amt: net * Math.abs(pct) / 100, account: r.taxAccount||'', name: r.name, isDeduction: true });
    }
  });
  const totalDeduct = exclusiveTaxes.filter(t => t.isDeduction).reduce((s,t) => s+t.amt, 0);
  return { net, inclusiveTaxes, exclusiveTaxes, cashOut: grossAmt - totalDeduct };
}

function computeTaxAmounts_(grossAmt, taxName, taxRates, taxGroups, legacyLine) {
  if (!taxRates)  taxRates  = getTaxRates();
  if (!taxGroups) taxGroups = getTaxGroups();
  const tName = String(taxName||'N/A').trim();
  // isTaxable / isInclusive come from the voucher line payload
  const isTaxable   = legacyLine && legacyLine.isTaxable  != null ? !!legacyLine.isTaxable  : true;
  const isInclusive = legacyLine && legacyLine.isInclusive != null ? !!legacyLine.isInclusive : false;
  if (!isTaxable || tName === 'N/A') {
    return { net: grossAmt, inclusiveTaxes: [], exclusiveTaxes: [], cashOut: grossAmt };
  }
  const group = taxGroups.find(g => g.name.toLowerCase() === tName.toLowerCase());
  let rates = [];
  if (group) {
    rates = (group.rateNames||[]).map(rn => taxRates.find(r => r.name.toLowerCase() === rn.trim().toLowerCase())).filter(Boolean);
  } else {
    const rate = taxRates.find(r => r.name.toLowerCase() === tName.toLowerCase());
    if (rate) rates = [rate];
  }
  if (rates.length) return computeFromNewRates_(grossAmt, rates, isInclusive);
  // Legacy string-based fallback (old vouchers without config)
  const tUp = tName.toUpperCase();
  const _hasVat = legacyLine && legacyLine.hasVat != null ? !!legacyLine.hasVat : tUp.includes('VAT');
  const _hasEwt = legacyLine && legacyLine.hasEwt != null ? !!legacyLine.hasEwt : tUp.includes('EWT');
  const _ewtRate = Number((legacyLine && legacyLine.ewtRate) || 0.02);
  const net = (_hasVat && isInclusive) ? grossAmt / 1.12 : grossAmt;
  const vatAmt = (_hasVat && isInclusive) ? grossAmt - net : 0;
  const ewtAmt = _hasEwt ? net * _ewtRate : 0;
  return { net, inclusiveTaxes: vatAmt>0?[{amt:vatAmt,account:'',name:'Input VAT'}]:[],
           exclusiveTaxes: ewtAmt>0?[{amt:ewtAmt,account:'',name:'EWT Payable',isDeduction:true}]:[], cashOut: grossAmt-ewtAmt };
}
function ensureDisbursementReportsHeaders_(sheet) {
  const requiredCols = ['Status', 'ReviewedBy', 'ApprovedBy', 'RejectReason'];
  if (sheet.getLastRow() === 0) {
    const h = ['ReportId', 'Date', 'BankCode', 'TotalAmount', 'CreatedAt', 'CreatedBy', 'BankBalances', 'ExpectedCollection', ...requiredCols];
    sheet.appendRow(h); return h;
  }
  const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
  requiredCols.forEach(col => { if (!existing.includes(col)) { sheet.getRange(1, existing.length + 1).setValue(col); existing.push(col); } });
  return existing;
}
function ensureDisbursementLinesHeaders_(sheet) {
    if (sheet.getLastRow() === 0) { const h = ['ReportId', 'VoucherId', 'LineNo', 'CheckNumber', 'BankReference', 'Amount', 'Status', 'BankCode', 'CreatedAt', 'CreatedBy']; sheet.appendRow(h); return h; }
    return sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
}
function ensureDailyBankBalancesHeaders_(sheet) {
    if (sheet.getLastRow() === 0) { const h = ['Date', 'BankCode', 'BegBalance', 'EndBalance', 'UpdatedAt', 'UpdatedBy']; sheet.appendRow(h); return h; }
    return sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
}

function saveDailyBankBalances(payload) {
  const { date, balances } = payload;
  const sheet = getTargetSheet_('DailyBankBalances');
  const headers = ensureDailyBankBalancesHeaders_(sheet);
  const data = sheet.getDataRange().getValues();
  const user = getActionUser_(); const now = new Date();

  for (let i = data.length - 1; i >= 1; i--) {
    let rDate = data[i][0];
    if (rDate instanceof Date) rDate = Utilities.formatDate(rDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (rDate === date) sheet.deleteRow(i + 1);
  }

  const rowsToAppend = [];
  balances.forEach(b => {
    const row = new Array(headers.length).fill('');
    row[headers.indexOf('Date')] = date;
    row[headers.indexOf('BankCode')] = b.bankCode;
    row[headers.indexOf('BegBalance')] = b.begBal === '' ? '' : Number(b.begBal);
    row[headers.indexOf('EndBalance')] = b.endBal === '' ? '' : Number(b.endBal);
    row[headers.indexOf('UpdatedAt')] = now;
    row[headers.indexOf('UpdatedBy')] = user;
    rowsToAppend.push(row);
  });

  if (rowsToAppend.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
  return true;
}

function ensureBankStatementsHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    const h = ['StatementId','BankCode','FileName','FileId','DriveUrl','UploadedAt','UploadedBy'];
    sheet.appendRow(h); return h;
  }
  return sheet.getRange(1,1,1,sheet.getLastColumn()||1).getValues()[0];
}

function ensureBankStatementLinesHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    const h = ['StatementId','BankCode','LineId','TxDate','Description','Reference','Debit','Credit','Balance','IsReconciled','ReconciledWithJEId','ReconciledAt','ReconciledBy'];
    sheet.appendRow(h); return h;
  }
  return sheet.getRange(1,1,1,sheet.getLastColumn()||1).getValues()[0];
}

function getUnionbankStmtLines_(bankCode) {
  // Reads all year sheets from the Unionbank transactions spreadsheet and returns
  // rows normalized to the BankStatementLines schema so renderBankTxTable works unchanged.
  try {
    var ubSS = SpreadsheetApp.openById(UNIONBANK_TX_SS_ID);
    var sheets = ubSS.getSheets();
    var normalized = [];
    sheets.forEach(function(sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
      var bkIdx   = headers.indexOf('BankCode');
      var txIdIdx = headers.indexOf('Transaction ID');
      var dtIdx   = headers.indexOf('Transaction Date');
      var descIdx = headers.indexOf('Transaction Description');
      var dbIdx   = headers.indexOf('Debits');
      var crIdx   = headers.indexOf('Credits');
      var balIdx  = headers.indexOf('Ending Balance');
      var stmtIdx = headers.indexOf('StatementId');
      var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      data.forEach(function(row) {
        if (!row.some(function(c){ return c !== '' && c !== null; })) return;
        // Strict filter: skip row if BankCode column is absent OR value doesn't match
        if (bkIdx < 0 || String(row[bkIdx] || '').trim() !== bankCode) return;
        var txDate = '';
        var rawDate = dtIdx >= 0 ? row[dtIdx] : '';
        if (rawDate instanceof Date) {
          var y = rawDate.getFullYear();
          var m = String(rawDate.getMonth() + 1).padStart(2, '0');
          var d = String(rawDate.getDate()).padStart(2, '0');
          txDate = y + '-' + m + '-' + d;
        } else if (rawDate) {
          txDate = String(rawDate).split('T')[0];
        }
        normalized.push({
          StatementId:          stmtIdx >= 0 ? String(row[stmtIdx] || '') : '',
          BankCode:             bankCode,
          LineId:               txIdIdx >= 0 ? String(row[txIdIdx] || '') : '',
          TxDate:               txDate,
          Description:          descIdx >= 0 ? String(row[descIdx] || '') : '',
          Reference:            txIdIdx >= 0 ? String(row[txIdIdx] || '') : '',
          Debit:                dbIdx >= 0 && row[dbIdx] !== '' ? Number(row[dbIdx] || 0) : '',
          Credit:               crIdx >= 0 && row[crIdx] !== '' ? Number(row[crIdx] || 0) : '',
          Balance:              balIdx >= 0 && row[balIdx] !== '' ? Number(row[balIdx] || 0) : '',
          IsReconciled:         'FALSE',
          ReconciledWithJEId:   '',
          ReconciledAt:         '',
          ReconciledBy:         ''
        });
      });
    });
    return normalized;
  } catch(e) {
    Logger.log('getUnionbankStmtLines_ error: ' + e.message);
    return [];
  }
}

// Keywords used to identify which external SS to query — must match BANK_STATEMENT_FORMATS in the HTML
const UB_KEYWORDS_  = ['unionbank','union bank','ub checking','ub savings','ub current','ub corporate','- ub -','(ub)'];
const BPI_KEYWORDS_ = ['bpi checking','bpi savings','bpi corporate','bpi current','- bpi -','(bpi)','bpi bizlink','bpi biz','bpi kcl','bpi '];
const BDO_KEYWORDS_ = ['bdo savings','bdo checking','bdo corporate','bdo current','- bdo -','(bdo)','bdo unibank'];

function getBankType_(bankCode) {
  // Look up the account name to decide which external SS this bank code belongs to
  var accounts = getCentralAccountsData_();
  var acct = accounts.find(function(a) { return String(a['Account Code'] || '').trim() === String(bankCode).trim(); });
  var searchStr = (String(bankCode) + ' ' + String(acct ? (acct['Account Name'] || '') : '')).toLowerCase();
  if (UB_KEYWORDS_.some(function(kw) { return searchStr.indexOf(kw) >= 0; }))  return 'UNIONBANK';
  if (BPI_KEYWORDS_.some(function(kw) { return searchStr.indexOf(kw) >= 0; })) return 'BPI';
  if (BDO_KEYWORDS_.some(function(kw) { return searchStr.indexOf(kw) >= 0; })) return 'BDO';
  return null;
}

function getBankTransactionData(bankCode) {
  if (!bankCode) return { jLines: [], stmtLines: [], stmts: [] };
  const jLines = getSheetData_('JournalLines').filter(r =>
    String(r.AccountCode || r['account_code'] || '').trim() === bankCode
  );
  let stmtLines = [], stmts = [];
  try { stmtLines = getSheetData_('BankStatementLines').filter(r => String(r.BankCode||'').trim() === bankCode); } catch(e) {}
  try { stmts     = getSheetData_('BankStatements').filter(r => String(r.BankCode||'').trim() === bankCode); } catch(e) {}
  // Only query the external SS that matches this bank account's type
  const bankType = getBankType_(bankCode);
  if (bankType === 'UNIONBANK') {
    const ubLines = getUnionbankStmtLines_(bankCode);
    if (ubLines.length > 0) stmtLines = stmtLines.concat(ubLines);
  } else if (bankType === 'BPI') {
    const bpiLines = getBpiStmtLines_(bankCode);
    if (bpiLines.length > 0) stmtLines = stmtLines.concat(bpiLines);
  } else if (bankType === 'BDO') {
    const bdoLines = getBdoStmtLines_(bankCode);
    if (bdoLines.length > 0) stmtLines = stmtLines.concat(bdoLines);
  }
  return sanitizeData_({ jLines, stmtLines, stmts });
}

const UNIONBANK_TX_COLS = [
  'Transaction Date','Transaction ID','Transaction Description','Check Number',
  'Debits','Credits','Ending Balance','Reference Number',
  'Remarks','Remarks 1','Remarks 2','Branch','Net Amount',
  'Remittance Ref 1','Biller Name','Payment Channel',
  'Bills Payment Ref 1','Bills Payment Ref 2','Bills Payment Ref 3'
];
const UNIONBANK_TX_HEADERS = ['StatementId','BankCode'].concat(UNIONBANK_TX_COLS);

const BPI_TX_COLS = [
  'Date','Check Number','SBA Reference No.','Branch','Transaction Code',
  'Transaction Description','Debit','Credit','Running Balance'
];
const BPI_TX_HEADERS = ['StatementId','BankCode'].concat(BPI_TX_COLS);

function getOrCreateBpiYearSheet_(ss, year) {
  var sheet = ss.getSheetByName(String(year));
  if (!sheet) {
    sheet = ss.insertSheet(String(year));
    sheet.appendRow(BPI_TX_HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(BPI_TX_HEADERS);
    sheet.setFrozenRows(1);
  } else {
    // Verify the header row matches BPI_TX_HEADERS — fix if the sheet was pre-created
    // with only the 9 data columns (no StatementId/BankCode prefix).
    var existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    if (existingHeaders[0] !== 'StatementId') {
      // Prepend StatementId and BankCode by inserting 2 columns at the left
      sheet.insertColumnsBefore(1, 2);
      sheet.getRange(1, 1).setValue('StatementId');
      sheet.getRange(1, 2).setValue('BankCode');
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function saveBpiRows_(parsedRows, stmtId, bankCode) {
  var byYear = {};
  parsedRows.forEach(function(r) {
    var year = String(r['Date'] || '').substring(0, 4) || 'UNKNOWN';
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(r);
  });

  var bpiSS = SpreadsheetApp.openById(BPI_TX_SS_ID);
  var inserted = 0, skipped = 0;

  for (var year in byYear) {
    var sheet   = getOrCreateBpiYearSheet_(bpiSS, year);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];

    // Build composite-key set for deduplication (no unique transaction ID in BPI)
    var existingKeys = {};
    if (sheet.getLastRow() > 1) {
      var dtIdx  = headers.indexOf('Date'),   sbaIdx = headers.indexOf('SBA Reference No.'),
          txcIdx = headers.indexOf('Transaction Code'),
          dbIdx  = headers.indexOf('Debit'),  crIdx  = headers.indexOf('Credit'),
          balIdx = headers.indexOf('Running Balance');
      if (dtIdx >= 0) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length)
             .getValues()
             .forEach(function(row) {
               var k = [row[dtIdx], row[sbaIdx], row[txcIdx], row[dbIdx], row[crIdx], row[balIdx]].join('|');
               existingKeys[k] = true;
             });
      }
    }

    var newRows = [];
    byYear[year].forEach(function(r) {
      var k = [r['Date'], r['SBA Reference No.'], r['Transaction Code'], r['Debit'], r['Credit'], r['Running Balance']].join('|');
      if (existingKeys[k]) { skipped++; return; }
      var row = new Array(headers.length).fill('');
      row[headers.indexOf('StatementId')] = stmtId;
      row[headers.indexOf('BankCode')]    = bankCode;
      BPI_TX_COLS.forEach(function(col) {
        var idx = headers.indexOf(col);
        if (idx >= 0) row[idx] = (r[col] !== undefined && r[col] !== null) ? r[col] : '';
      });
      newRows.push(row);
      inserted++;
    });

    if (newRows.length > 0)
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }

  return { inserted: inserted, skipped: skipped };
}

function getBpiStmtLines_(bankCode) {
  try {
    var bpiSS = SpreadsheetApp.openById(BPI_TX_SS_ID);
    var sheets = bpiSS.getSheets();
    var normalized = [];
    sheets.forEach(function(sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
      var bkIdx   = headers.indexOf('BankCode');
      var dtIdx   = headers.indexOf('Date');
      var descIdx = headers.indexOf('Transaction Description');
      var refIdx  = headers.indexOf('SBA Reference No.');
      var txcIdx  = headers.indexOf('Transaction Code');
      var dbIdx   = headers.indexOf('Debit');
      var crIdx   = headers.indexOf('Credit');
      var balIdx  = headers.indexOf('Running Balance');
      var stmtIdx = headers.indexOf('StatementId');
      var chkIdx  = headers.indexOf('Check Number');
      var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      data.forEach(function(row) {
        if (!row.some(function(c){ return c !== '' && c !== null; })) return;
        // Strict filter: skip row if BankCode column is absent OR value doesn't match
        if (bkIdx < 0 || String(row[bkIdx] || '').trim() !== bankCode) return;
        var txDate = '';
        var rawDate = dtIdx >= 0 ? row[dtIdx] : '';
        if (rawDate instanceof Date) {
          var y = rawDate.getFullYear();
          var m = String(rawDate.getMonth() + 1).padStart(2, '0');
          var d = String(rawDate.getDate()).padStart(2, '0');
          txDate = y + '-' + m + '-' + d;
        } else if (rawDate) {
          txDate = String(rawDate).split('T')[0];
        }
        normalized.push({
          StatementId:          stmtIdx >= 0 ? String(row[stmtIdx] || '') : '',
          BankCode:             bankCode,
          LineId:               [txDate, refIdx >= 0 ? row[refIdx] : '', txcIdx >= 0 ? row[txcIdx] : '', row[dbIdx], row[crIdx], row[balIdx]].join('|'),
          TxDate:               txDate,
          Description:          descIdx >= 0 ? String(row[descIdx] || '') : '',
          Reference:            refIdx >= 0 ? String(row[refIdx] || '') : (chkIdx >= 0 ? String(row[chkIdx] || '') : ''),
          Debit:                dbIdx >= 0 && row[dbIdx] !== '' ? Number(row[dbIdx] || 0) : '',
          Credit:               crIdx >= 0 && row[crIdx] !== '' ? Number(row[crIdx] || 0) : '',
          Balance:              balIdx >= 0 && row[balIdx] !== '' ? Number(row[balIdx] || 0) : '',
          IsReconciled:         'FALSE',
          ReconciledWithJEId:   '',
          ReconciledAt:         '',
          ReconciledBy:         ''
        });
      });
    });
    return normalized;
  } catch(e) {
    Logger.log('getBpiStmtLines_ error: ' + e.message);
    return [];
  }
}

const BDO_TX_COLS = [
  'TxId','Posting Date','Branch','Description','Debit','Credit','Running Balance','Check Number'
];
const BDO_TX_HEADERS = ['StatementId','BankCode'].concat(BDO_TX_COLS);

function generateBdoTxId_(row) {
  // Deterministic stable PK: MD5 of composite key fields, prefixed with BDO-
  var raw = [row['Posting Date'], row['Branch'], row['Description'],
             row['Debit'], row['Credit'], row['Running Balance']].join('|');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  var hex = bytes.map(function(b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2,'0'); }).join('');
  return 'BDO-' + hex.substring(0, 12);
}

// Case-insensitive header index lookup
function hdridx_(headers, col) {
  var cl = col.toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).toLowerCase() === cl) return i;
  }
  return -1;
}

function getOrCreateBdoYearSheet_(ss, year) {
  var sheet = ss.getSheetByName(String(year));
  if (!sheet) {
    sheet = ss.insertSheet(String(year));
    sheet.appendRow(BDO_TX_HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(BDO_TX_HEADERS);
    sheet.setFrozenRows(1);
  } else {
    // Validate headers: must have StatementId first AND TxId column present.
    // If wrong (missing TxId, all-caps, legacy format), clear and rewrite.
    var existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    var hasTxId = existingHeaders.some(function(h) { return String(h).toLowerCase() === 'txid'; });
    var hasStatementId = String(existingHeaders[0]).toLowerCase() === 'statementid';
    if (!hasTxId || !hasStatementId) {
      sheet.clearContents();
      sheet.appendRow(BDO_TX_HEADERS);
      sheet.setFrozenRows(1);
      Logger.log('getOrCreateBdoYearSheet_: reset bad headers for year ' + year);
    } else if (existingHeaders[0] !== 'StatementId') {
      // Correct casing only — rewrite header row in place
      sheet.getRange(1, 1, 1, BDO_TX_HEADERS.length).setValues([BDO_TX_HEADERS]);
    }
  }
  return sheet;
}

function saveBdoRows_(parsedRows, stmtId, bankCode) {
  Logger.log('saveBdoRows_ rows: ' + parsedRows.length + '  first: ' + JSON.stringify((parsedRows||[])[0] || {}));
  var byYear = {};
  parsedRows.forEach(function(r) {
    var year = String(r['Posting Date'] || '').substring(0, 4) || 'UNKNOWN';
    if (year === 'UNKNOWN' || !/^\d{4}$/.test(year)) return; // skip rows with no valid date
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(r);
  });

  var bdoSS = SpreadsheetApp.openById(BDO_TX_SS_ID);
  var inserted = 0, skipped = 0;

  for (var year in byYear) {
    var sheet   = getOrCreateBdoYearSheet_(bdoSS, year);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    var txIdColIdx = hdridx_(headers, 'TxId');

    // Build set of existing TxIds for deduplication
    var existingIds = {};
    if (sheet.getLastRow() > 1 && txIdColIdx >= 0) {
      sheet.getRange(2, txIdColIdx + 1, sheet.getLastRow() - 1, 1)
           .getValues()
           .forEach(function(r) { if (r[0]) existingIds[String(r[0]).trim()] = true; });
    }

    var newRows = [];
    byYear[year].forEach(function(r) {
      var txId = generateBdoTxId_(r);
      if (existingIds[txId]) { skipped++; return; }
      var row = new Array(headers.length).fill('');
      row[hdridx_(headers, 'StatementId')] = stmtId;
      row[hdridx_(headers, 'BankCode')]    = bankCode;
      row[hdridx_(headers, 'TxId')]        = txId;
      BDO_TX_COLS.forEach(function(col) {
        if (col === 'TxId') return; // already set
        var idx = hdridx_(headers, col);
        if (idx >= 0) row[idx] = (r[col] !== undefined && r[col] !== null) ? r[col] : '';
      });
      newRows.push(row);
      inserted++;
    });

    if (newRows.length > 0)
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }

  return { inserted: inserted, skipped: skipped };
}

function getBdoStmtLines_(bankCode) {
  try {
    var bdoSS = SpreadsheetApp.openById(BDO_TX_SS_ID);
    var sheets = bdoSS.getSheets();
    var normalized = [];
    sheets.forEach(function(sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
      var bkIdx   = hdridx_(headers, 'BankCode');
      var txIdIdx = hdridx_(headers, 'TxId');
      var dtIdx   = hdridx_(headers, 'Posting Date');
      var descIdx = hdridx_(headers, 'Description');
      var brIdx   = hdridx_(headers, 'Branch');
      var dbIdx   = hdridx_(headers, 'Debit');
      var crIdx   = hdridx_(headers, 'Credit');
      var balIdx  = hdridx_(headers, 'Running Balance');
      var chkIdx  = hdridx_(headers, 'Check Number');
      var stmtIdx = hdridx_(headers, 'StatementId');
      var data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      data.forEach(function(row) {
        if (!row.some(function(c){ return c !== '' && c !== null; })) return;
        // Strict filter: skip row if BankCode column is absent OR value doesn't match
        if (bkIdx < 0 || String(row[bkIdx] || '').trim() !== bankCode) return;
        var txDate = '';
        var rawDate = dtIdx >= 0 ? row[dtIdx] : '';
        if (rawDate instanceof Date) {
          txDate = rawDate.getFullYear() + '-' +
                   String(rawDate.getMonth() + 1).padStart(2,'0') + '-' +
                   String(rawDate.getDate()).padStart(2,'0');
        } else if (rawDate) {
          txDate = String(rawDate).split('T')[0];
        }
        normalized.push({
          StatementId:          stmtIdx >= 0 ? String(row[stmtIdx] || '') : '',
          BankCode:             bankCode,
          LineId:               txIdIdx >= 0 ? String(row[txIdIdx] || '') : '',
          TxDate:               txDate,
          Description:          descIdx >= 0 ? String(row[descIdx] || '') : '',
          Reference:            brIdx  >= 0 ? String(row[brIdx]  || '') : '',
          Debit:                dbIdx  >= 0 && row[dbIdx]  !== '' ? Number(row[dbIdx]  || 0) : '',
          Credit:               crIdx  >= 0 && row[crIdx]  !== '' ? Number(row[crIdx]  || 0) : '',
          Balance:              balIdx >= 0 && row[balIdx] !== '' ? Number(row[balIdx] || 0) : '',
          IsReconciled:         'FALSE',
          ReconciledWithJEId:   '',
          ReconciledAt:         '',
          ReconciledBy:         ''
        });
      });
    });
    return normalized;
  } catch(e) {
    Logger.log('getBdoStmtLines_ error: ' + e.message);
    return [];
  }
}

function getOrCreateUnionbankYearSheet_(ss, year) {
  let sheet = ss.getSheetByName(String(year));
  if (!sheet) {
    sheet = ss.insertSheet(String(year));
    sheet.appendRow(UNIONBANK_TX_HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(UNIONBANK_TX_HEADERS);
    sheet.setFrozenRows(1);
  } else {
    // Ensure BankCode column exists on sheets created before it was added
    var existingHdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    if (existingHdrs.indexOf('BankCode') < 0) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue('BankCode');
    }
  }
  return sheet;
}

function saveUnionbankRows_(parsedRows, stmtId, bankCode) {
  // Group rows by year derived from Transaction Date (already YYYY-MM-DD after client sanitization)
  var byYear = {};
  parsedRows.forEach(function(r) {
    var year = String(r['Transaction Date'] || '').substring(0, 4) || 'UNKNOWN';
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(r);
  });

  var ubSS = SpreadsheetApp.openById(UNIONBANK_TX_SS_ID);
  var inserted = 0, skipped = 0;

  for (var year in byYear) {
    var sheet   = getOrCreateUnionbankYearSheet_(ubSS, year);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    var txIdCol = headers.indexOf('Transaction ID');

    // Build Set of existing Transaction IDs to enforce uniqueness
    var existingIds = {};
    if (sheet.getLastRow() > 1 && txIdCol >= 0) {
      sheet.getRange(2, txIdCol + 1, sheet.getLastRow() - 1, 1)
           .getValues()
           .forEach(function(r) { if (r[0]) existingIds[String(r[0]).trim()] = true; });
    }

    var newRows = [];
    byYear[year].forEach(function(r) {
      var txId = String(r['Transaction ID'] || '').trim();
      if (txId && existingIds[txId]) { skipped++; return; } // duplicate — skip
      var row = new Array(headers.length).fill('');
      row[headers.indexOf('StatementId')] = stmtId;
      row[headers.indexOf('BankCode')]    = bankCode;
      UNIONBANK_TX_COLS.forEach(function(col) {
        var idx = headers.indexOf(col);
        if (idx >= 0) row[idx] = (r[col] !== undefined && r[col] !== null) ? r[col] : '';
      });
      newRows.push(row);
      inserted++;
    });

    if (newRows.length > 0)
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, headers.length).setValues(newRows);
  }

  return { inserted: inserted, skipped: skipped };
}

function uploadBankStatement(payload) {
  try {
    return uploadBankStatement_(payload);
  } catch(e) {
    Logger.log('uploadBankStatement error: ' + e.message + '\n' + (e.stack || ''));
    throw new Error(e.message || String(e));
  }
}

function uploadBankStatement_(payload) {
  const { bankCode, fileName, mimeType, base64Data, parsedRows, formatKey } = payload;
  if (!bankCode || !fileName || !base64Data) throw new Error('Missing required fields.');
  let _step = 'init';
  try {
    const user = getActionUser_(); const now = new Date();
    const stmtId = 'BS-' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss');

    // Drive upload — non-blocking. If Drive API fails (auth/quota/transient), skip silently.
    _step = 'drive-upload';
    let fileId = '', driveUrl = '';
    try {
      const blobBytes = Utilities.base64Decode(base64Data);
      const blob = Utilities.newBlob(blobBytes, mimeType || 'application/octet-stream', fileName);
      const parent = DriveApp.getFolderById(BANK_STATEMENTS_FOLDER_ID);
      const bankFolderIter = parent.getFoldersByName(bankCode);
      const bankFolder = bankFolderIter.hasNext() ? bankFolderIter.next() : parent.createFolder(bankCode);
      const file = bankFolder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      fileId   = file.getId();
      driveUrl = 'https://drive.google.com/file/d/' + fileId + '/view?usp=sharing';
    } catch(driveErr) {
      Logger.log('Drive upload skipped: ' + driveErr.message);
      // Continue — transaction data save proceeds regardless
    }

    _step = 'stmt-sheet';
    const stmtSheet   = getTargetSheet_('BankStatements');
    const stmtHeaders = ensureBankStatementsHeaders_(stmtSheet);
    const stmtRow     = new Array(stmtHeaders.length).fill('');
    stmtRow[stmtHeaders.indexOf('StatementId')] = stmtId;
    stmtRow[stmtHeaders.indexOf('BankCode')]    = bankCode;
    stmtRow[stmtHeaders.indexOf('FileName')]    = fileName;
    stmtRow[stmtHeaders.indexOf('FileId')]      = fileId;
    stmtRow[stmtHeaders.indexOf('DriveUrl')]    = driveUrl;
    stmtRow[stmtHeaders.indexOf('UploadedAt')]  = now;
    stmtRow[stmtHeaders.indexOf('UploadedBy')]  = user;
    stmtSheet.appendRow(stmtRow);

    _step = 'save-rows';
    let insertResult = null;
    if (parsedRows && parsedRows.length > 0) {
      if (formatKey === 'UNIONBANK') {
        _step = 'save-rows-ub';
        insertResult = saveUnionbankRows_(parsedRows, stmtId, bankCode);
      } else if (formatKey === 'BPI') {
        _step = 'save-rows-bpi';
        insertResult = saveBpiRows_(parsedRows, stmtId, bankCode);
      } else if (formatKey === 'BDO') {
        _step = 'save-rows-bdo';
        insertResult = saveBdoRows_(parsedRows, stmtId, bankCode);
      } else {
      const lSheet   = getTargetSheet_('BankStatementLines');
      const lHeaders = ensureBankStatementLinesHeaders_(lSheet);
      const rowsToSave = parsedRows.map((r, i) => {
        const row    = new Array(lHeaders.length).fill('');
        const lineId = stmtId + '-L' + String(i + 1).padStart(4, '0');
        row[lHeaders.indexOf('StatementId')]  = stmtId;
        row[lHeaders.indexOf('BankCode')]     = bankCode;
        row[lHeaders.indexOf('LineId')]       = lineId;
        row[lHeaders.indexOf('TxDate')]       = r.txDate || '';
        row[lHeaders.indexOf('Description')]  = r.description || '';
        row[lHeaders.indexOf('Reference')]    = r.reference || '';
        row[lHeaders.indexOf('Debit')]        = (r.debit !== '' && r.debit !== null) ? Number(r.debit || 0) : '';
        row[lHeaders.indexOf('Credit')]       = (r.credit !== '' && r.credit !== null) ? Number(r.credit || 0) : '';
        row[lHeaders.indexOf('Balance')]      = (r.balance !== '' && r.balance !== null) ? Number(r.balance || 0) : '';
        row[lHeaders.indexOf('IsReconciled')] = 'FALSE';
        return row;
      });
      lSheet.getRange(lSheet.getLastRow() + 1, 1, rowsToSave.length, lHeaders.length).setValues(rowsToSave);
    }
  }
    return { ok: true, statementId: stmtId, driveUrl, insertResult };
  } catch(e) {
    throw new Error('[step:' + _step + '] ' + e.message);
  }
}

function recordStatementBalance(payload) {
  // Single-bank upsert into DailyBankBalances — never touches other banks' rows for the same date.
  const { bankCode, date, endBal } = payload;
  if (!bankCode || !date) return { ok: false };
  const sheet   = getTargetSheet_('DailyBankBalances');
  const headers = ensureDailyBankBalancesHeaders_(sheet);
  const data    = sheet.getDataRange().getValues();
  const tz      = Session.getScriptTimeZone();
  const user    = getActionUser_();
  const now     = new Date();
  const dateIdx = headers.indexOf('Date');
  const bcIdx   = headers.indexOf('BankCode');
  const ebIdx   = headers.indexOf('EndBalance');
  const uaIdx   = headers.indexOf('UpdatedAt');
  const ubIdx   = headers.indexOf('UpdatedBy');

  for (let i = 1; i < data.length; i++) {
    let rDate = data[i][dateIdx];
    if (rDate instanceof Date) rDate = Utilities.formatDate(rDate, tz, 'yyyy-MM-dd');
    if (String(rDate) === String(date) && String(data[i][bcIdx]) === String(bankCode)) {
      sheet.getRange(i + 1, ebIdx + 1).setValue(endBal);
      sheet.getRange(i + 1, uaIdx + 1).setValue(now);
      sheet.getRange(i + 1, ubIdx + 1).setValue(user);
      return { ok: true, action: 'updated' };
    }
  }

  // No existing row — insert new (BegBalance blank; system derives from prior EndBalance)
  const row = new Array(headers.length).fill('');
  row[headers.indexOf('Date')]       = date;
  row[headers.indexOf('BankCode')]   = bankCode;
  row[headers.indexOf('BegBalance')] = '';
  row[headers.indexOf('EndBalance')] = endBal;
  row[headers.indexOf('UpdatedAt')]  = now;
  row[headers.indexOf('UpdatedBy')]  = user;
  sheet.appendRow(row);
  return { ok: true, action: 'inserted' };
}

function saveBankReconciliation(payload) {
  const { matches = [], unmatches = [] } = payload;
  if (matches.length === 0 && unmatches.length === 0) return { ok: true };
  const user = getActionUser_(); const now = new Date();
  const lSheet   = getTargetSheet_('BankStatementLines');
  const lHeaders = ensureBankStatementLinesHeaders_(lSheet);
  const lData    = lSheet.getDataRange().getValues();
  const lidIdx       = lHeaders.indexOf('LineId');
  const isReconIdx   = lHeaders.indexOf('IsReconciled');
  const reconWithIdx = lHeaders.indexOf('ReconciledWithJEId');
  const reconAtIdx   = lHeaders.indexOf('ReconciledAt');
  const reconByIdx   = lHeaders.indexOf('ReconciledBy');
  let updated = false;
  for (let i = 1; i < lData.length; i++) {
    const lineId = String(lData[i][lidIdx] || '');
    const matchEntry = matches.find(m => m.lineId === lineId);
    if (matchEntry) {
      lData[i][isReconIdx]   = 'TRUE';
      lData[i][reconWithIdx] = matchEntry.jeId;
      lData[i][reconAtIdx]   = now;
      lData[i][reconByIdx]   = user;
      updated = true;
    } else if (unmatches.includes(lineId)) {
      lData[i][isReconIdx]   = 'FALSE';
      lData[i][reconWithIdx] = '';
      lData[i][reconAtIdx]   = '';
      lData[i][reconByIdx]   = '';
      updated = true;
    }
  }
  if (updated) lSheet.getRange(1, 1, lData.length, lData[0].length).setValues(lData);
  return { ok: true };
}

function ensureBankReconSessionsHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    const h = ['SessionId','BankCode','StmtEndDate','StmtEndBal','BeginBal','EndingBalance','ClearedCount','ReconciledAt','ReconciledBy'];
    sheet.appendRow(h); return h;
  }
  return sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
}

function ensureCheckbookMasterHeaders_(sheet) {
  const COLS = ['CheckbookId','BankCode','StartingNumber','EndingNumber','NextCheckNumber','IsActive','Notes','CreatedAt','CreatedBy'];
  if (sheet.getLastRow() === 0) { sheet.appendRow(COLS); sheet.setFrozenRows(1); return COLS; }
  const h = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0].map(c => String(c).trim());
  COLS.forEach(col => { if (!h.includes(col)) { sheet.getRange(1, h.length + 1).setValue(col); h.push(col); } });
  return h;
}

function ensureCheckRegisterHeaders_(sheet) {
  const COLS = ['CheckId','CheckbookId','BankCode','CheckNumber','IssueDate','PayeeName','Amount','Status','ReferenceType','ReferenceId','ClearedDate','VoidedDate','VoidReason','StoppedDate','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy'];
  if (sheet.getLastRow() === 0) { sheet.appendRow(COLS); sheet.setFrozenRows(1); return COLS; }
  const h = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0].map(c => String(c).trim());
  COLS.forEach(col => { if (!h.includes(col)) { sheet.getRange(1, h.length + 1).setValue(col); h.push(col); } });
  return h;
}

function saveManualBankTransaction(payload) {
  const { bankCode, date, desc, ref, debit, credit, balance } = payload;
  if (!bankCode || !date || !desc) throw new Error('bankCode, date and desc are required.');
  const sheet   = getTargetSheet_('BankStatementLines');
  const headers = ensureBankStatementLinesHeaders_(sheet);
  const now     = new Date();
  const lineId  = 'MANUAL-' + bankCode + '-' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  const row     = new Array(headers.length).fill('');
  row[headers.indexOf('StatementId')]  = 'MANUAL';
  row[headers.indexOf('BankCode')]     = bankCode;
  row[headers.indexOf('LineId')]       = lineId;
  row[headers.indexOf('TxDate')]       = date;
  row[headers.indexOf('Description')]  = desc;
  row[headers.indexOf('Reference')]    = ref || '';
  row[headers.indexOf('Debit')]        = (debit !== '' && debit !== null) ? Number(debit || 0) : '';
  row[headers.indexOf('Credit')]       = (credit !== '' && credit !== null) ? Number(credit || 0) : '';
  row[headers.indexOf('Balance')]      = (balance !== '' && balance !== null) ? Number(balance || 0) : '';
  row[headers.indexOf('IsReconciled')] = 'FALSE';
  // Store source flag — reuse ReconciledBy column or add Source if header exists
  const srcIdx = headers.indexOf('Source');
  if (srcIdx >= 0) row[srcIdx] = 'Manual';
  else row[headers.indexOf('StatementId')] = 'MANUAL'; // StatementId='MANUAL' signals source
  sheet.appendRow(row);
  return { ok: true, lineId };
}

function deleteManualBankTransaction(lineId) {
  if (!lineId || !String(lineId).startsWith('MANUAL-')) throw new Error('Only manual transactions can be deleted.');
  const sheet   = getTargetSheet_('BankStatementLines');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
  const lineIdx = headers.indexOf('LineId');
  if (lineIdx < 0) throw new Error('LineId column not found.');
  const data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][lineIdx] || '') === String(lineId)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  throw new Error('Transaction not found: ' + lineId);
}

function finishBankReconciliation(payload) {
  const { bankCode, stmtEndDate, stmtEndBal, beginBal, clearedLineIds = [] } = payload;
  if (!bankCode || !stmtEndDate) throw new Error('bankCode and stmtEndDate are required.');
  const user = getActionUser_();
  const now  = new Date();

  // 1. Mark cleared lines in BankStatementLines
  const lSheet   = getTargetSheet_('BankStatementLines');
  const lHeaders = ensureBankStatementLinesHeaders_(lSheet);
  const lData    = lSheet.getDataRange().getValues();
  const lidIdx       = lHeaders.indexOf('LineId');
  const isReconIdx   = lHeaders.indexOf('IsReconciled');
  const reconAtIdx   = lHeaders.indexOf('ReconciledAt');
  const reconByIdx   = lHeaders.indexOf('ReconciledBy');
  const idSet = new Set(clearedLineIds.map(String));
  let updatedCount = 0;
  for (let i = 1; i < lData.length; i++) {
    if (idSet.has(String(lData[i][lidIdx] || ''))) {
      lData[i][isReconIdx] = 'TRUE';
      lData[i][reconAtIdx] = now;
      lData[i][reconByIdx] = user;
      updatedCount++;
    }
  }
  if (updatedCount > 0) lSheet.getRange(1, 1, lData.length, lData[0].length).setValues(lData);

  // 2. Save session record
  const sSheet   = getTargetSheet_('BankReconSessions');
  const sHeaders = ensureBankReconSessionsHeaders_(sSheet);
  const sessionId = 'REC-' + bankCode + '-' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  const row = sHeaders.map(h => {
    switch (h) {
      case 'SessionId':      return sessionId;
      case 'BankCode':       return bankCode;
      case 'StmtEndDate':    return stmtEndDate;
      case 'StmtEndBal':     return Number(stmtEndBal) || 0;
      case 'BeginBal':       return Number(beginBal) || 0;
      case 'EndingBalance':  return Number(stmtEndBal) || 0;
      case 'ClearedCount':   return updatedCount;
      case 'ReconciledAt':   return now;
      case 'ReconciledBy':   return user;
      default:               return '';
    }
  });
  sSheet.appendRow(row);
  return { ok: true, sessionId, clearedCount: updatedCount };
}

function getReconSessions(bankCode) {
  const sSheet = getTargetSheet_('BankReconSessions');
  if (sSheet.getLastRow() < 2) return [];
  const headers = ensureBankReconSessionsHeaders_(sSheet);
  const data    = sSheet.getDataRange().getValues().slice(1);
  const bcIdx   = headers.indexOf('BankCode');
  const rows = data
    .filter(r => !bankCode || String(r[bcIdx] || '') === bankCode)
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = r[i] instanceof Date ? Utilities.formatDate(r[i], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : r[i]; });
      return obj;
    });
  rows.sort((a, b) => (b.ReconciledAt || '') > (a.ReconciledAt || '') ? 1 : -1);
  return rows;
}

function ensureWeeklyProjectionsHeaders_(sheet) {
    if (sheet.getLastRow() === 0) { const h = ['ProjId', 'WeekCoverage', 'StartDate', 'EndDate', 'TotalAmount', 'TotalInflow', 'CreatedAt', 'CreatedBy', 'Status', 'ReviewedBy', 'ApprovedBy', 'RejectReason']; sheet.appendRow(h); return h; }
    const h = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    if (!h.includes('TotalInflow')) { sheet.getRange(1, h.length + 1).setValue('TotalInflow'); h.push('TotalInflow'); }
    if (!h.includes('Status')) { sheet.getRange(1, h.length + 1).setValue('Status'); h.push('Status'); }
    if (!h.includes('ReviewedBy')) { sheet.getRange(1, h.length + 1).setValue('ReviewedBy'); h.push('ReviewedBy'); }
    if (!h.includes('ApprovedBy')) { sheet.getRange(1, h.length + 1).setValue('ApprovedBy'); h.push('ApprovedBy'); }
    if (!h.includes('RejectReason')) { sheet.getRange(1, h.length + 1).setValue('RejectReason'); h.push('RejectReason'); }
    return h;
}
function ensureWeeklyProjectionLinesHeaders_(sheet) {
    if (sheet.getLastRow() === 0) { const h = ['ProjId', 'VoucherType', 'Purpose', 'Contact', 'Description', 'DueDate', 'BankCode', 'Amount', 'Status', 'LinkedVoucherId']; sheet.appendRow(h); return h; }
    return sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
}
function ensureWeeklyProjectionInflowsHeaders_(sheet) {
    if (sheet.getLastRow() === 0) { const h = ['ProjId', 'Source', 'Description', 'ExpectedDate', 'BankCode', 'Amount']; sheet.appendRow(h); return h; }
    return sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
}

function saveWeeklyProjection(payload) {
  const user = getActionUser_(); const now = new Date();
  let projId = payload.projId;
  const isNew = !projId || projId === 'Auto-generated on save';
  if (isNew) projId = generateVoucherId_('WP');

  const pSheet = getTargetSheet_('WeeklyProjections'); const pHeaders = ensureWeeklyProjectionsHeaders_(pSheet);
  const lSheet = getTargetSheet_('WeeklyProjectionLines'); const lHeaders = ensureWeeklyProjectionLinesHeaders_(lSheet);
  const iSheet = getTargetSheet_('WeeklyProjectionInflows'); const iHeaders = ensureWeeklyProjectionInflowsHeaders_(iSheet);

  if (!isNew) {
      const pData = pSheet.getDataRange().getValues();
      for (let i = 1; i < pData.length; i++) {
          if (pData[i][0] === projId) {
              pSheet.getRange(i+1, pHeaders.indexOf('WeekCoverage')+1).setValue(payload.weekCoverage);
              pSheet.getRange(i+1, pHeaders.indexOf('StartDate')+1).setValue(payload.startDate);
              pSheet.getRange(i+1, pHeaders.indexOf('EndDate')+1).setValue(payload.endDate);
              pSheet.getRange(i+1, pHeaders.indexOf('TotalAmount')+1).setValue(payload.totalAmount);
              if (pHeaders.includes('TotalInflow')) pSheet.getRange(i+1, pHeaders.indexOf('TotalInflow')+1).setValue(payload.totalInflow || 0);
              break;
          }
      }
      const lData = lSheet.getDataRange().getValues();
      for (let i = lData.length - 1; i >= 1; i--) {
          if (lData[i][0] === projId) lSheet.deleteRow(i + 1);
      }
      const iData = iSheet.getDataRange().getValues();
      for (let i = iData.length - 1; i >= 1; i--) {
          if (iData[i][0] === projId) iSheet.deleteRow(i + 1);
      }
  } else {
      const pRow = new Array(pHeaders.length).fill('');
      pRow[pHeaders.indexOf('ProjId')] = projId; pRow[pHeaders.indexOf('WeekCoverage')] = payload.weekCoverage;
      pRow[pHeaders.indexOf('StartDate')] = payload.startDate; pRow[pHeaders.indexOf('EndDate')] = payload.endDate;
      pRow[pHeaders.indexOf('TotalAmount')] = payload.totalAmount;
      if (pHeaders.includes('TotalInflow')) pRow[pHeaders.indexOf('TotalInflow')] = payload.totalInflow || 0;
      pRow[pHeaders.indexOf('CreatedAt')] = now; pRow[pHeaders.indexOf('CreatedBy')] = user;
      if (pHeaders.includes('Status')) pRow[pHeaders.indexOf('Status')] = 'Draft';
      pSheet.appendRow(pRow);
  }

  const rows = payload.lines.map(l => {
      const row = new Array(lHeaders.length).fill('');
      row[lHeaders.indexOf('ProjId')] = projId; row[lHeaders.indexOf('VoucherType')] = l.type; row[lHeaders.indexOf('Purpose')] = l.purpose;
      row[lHeaders.indexOf('Contact')] = l.contact; row[lHeaders.indexOf('Description')] = l.desc; row[lHeaders.indexOf('DueDate')] = l.date;
      row[lHeaders.indexOf('BankCode')] = l.bank; row[lHeaders.indexOf('Amount')] = l.amount; row[lHeaders.indexOf('Status')] = l.status; row[lHeaders.indexOf('LinkedVoucherId')] = l.linkedId || '';
      return row;
  });

  if (rows.length > 0) lSheet.getRange(lSheet.getLastRow() + 1, 1, rows.length, lHeaders.length).setValues(rows);

  const inflowRows = (payload.inflowLines || []).map(l => {
      const row = new Array(iHeaders.length).fill('');
      row[iHeaders.indexOf('ProjId')] = projId; row[iHeaders.indexOf('Source')] = l.source;
      row[iHeaders.indexOf('Description')] = l.desc; row[iHeaders.indexOf('ExpectedDate')] = l.date;
      row[iHeaders.indexOf('BankCode')] = l.bank; row[iHeaders.indexOf('Amount')] = l.amount;
      return row;
  });
  if (inflowRows.length > 0) iSheet.getRange(iSheet.getLastRow() + 1, 1, inflowRows.length, iHeaders.length).setValues(inflowRows);

  return { projId };
}

function deleteWeeklyProjection(projId) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const id = String(projId);

    // Delete projection lines
    const lSheet = getTargetSheet_('WeeklyProjectionLines');
    const lData = lSheet.getDataRange().getValues(); const lH = lData[0];
    const lProjIdx = lH.indexOf('ProjectionId');
    for (let i = lData.length - 1; i >= 1; i--) { if (String(lData[i][lProjIdx]) === id) lSheet.deleteRow(i + 1); }

    // Delete projection inflows
    const iSheet = getTargetSheet_('WeeklyProjectionInflows');
    const iData = iSheet.getDataRange().getValues(); const iH = iData[0];
    const iProjIdx = iH.indexOf('ProjectionId');
    for (let i = iData.length - 1; i >= 1; i--) { if (String(iData[i][iProjIdx]) === id) iSheet.deleteRow(i + 1); }

    // Delete projection header row
    const pSheet = getTargetSheet_('WeeklyProjections');
    const pData = pSheet.getDataRange().getValues(); const pH = pData[0];
    const pIdIdx = pH.indexOf('ProjectionId');
    for (let i = pData.length - 1; i >= 1; i--) { if (String(pData[i][pIdIdx]) === id) { pSheet.deleteRow(i + 1); break; } }

    return sanitizeData_({ ok: true });
  } finally { lock.releaseLock(); }
}

function submitWeeklyProjectionForApproval(projId) {
  const pSheet = getTargetSheet_('WeeklyProjections');
  const pHeaders = ensureWeeklyProjectionsHeaders_(pSheet);
  const pData = pSheet.getDataRange().getValues();
  const reviewerEmails = getRoleEmails_('REVIEWER');
  const approverEmails = getRoleEmails_('APPROVER');
  let targetEmails = []; let nextStatus = '';
  if (reviewerEmails.length > 0) { targetEmails = reviewerEmails; nextStatus = 'Pending Review'; }
  else if (approverEmails.length > 0) { targetEmails = approverEmails; nextStatus = 'Pending Approval'; }
  else { throw new Error('No Reviewer or Approver configured in Users sheet.'); }
  let found = false;
  for (let i = 1; i < pData.length; i++) {
    if (String(pData[i][0]).trim() === String(projId).trim()) {
      const current = String(pData[i][pHeaders.indexOf('Status')] || '').trim();
      if (current === 'Approved' || current === 'Pending Review' || current === 'Pending Approval') throw new Error('Projection is already ' + current + '.');
      pSheet.getRange(i + 1, pHeaders.indexOf('Status') + 1).setValue(nextStatus);
      if (pHeaders.includes('RejectReason')) pSheet.getRange(i + 1, pHeaders.indexOf('RejectReason') + 1).setValue('');
      found = true; break;
    }
  }
  if (!found) throw new Error('Projection not found: ' + projId);
  if (targetEmails.length > 0) {
    const url = ScriptApp.getService().getUrl() + '?view=approvals';
    const body = `<div style="font-family:Arial,sans-serif;padding:30px;background-color:#f4f4f4;"><div style="max-width:500px;margin:0 auto;background:#fff;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center;"><h2 style="color:#188038;margin-top:0;">Action Required</h2><p style="color:#555;font-size:16px;">Weekly Projection <b>${projId}</b> is awaiting your review/approval.</p><br><a href="${url}" style="display:inline-block;background:#188038;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;">Open Approval Dashboard</a></div></div>`;
    MailApp.sendEmail({ to: targetEmails.join(','), subject: `ACTION REQUIRED: Weekly Projection ${projId} for Approval`, htmlBody: body });
  }
  return true;
}

function processWeeklyProjectionApprovals(payload) {
  const { projIds, action, reason } = payload;
  if (!projIds || projIds.length === 0) return false;
  const email = Session.getActiveUser().getEmail();
  const pSheet = getTargetSheet_('WeeklyProjections');
  const pHeaders = ensureWeeklyProjectionsHeaders_(pSheet);
  const pData = pSheet.getDataRange().getValues();
  let toApproverCount = 0;
  const webAppUrl = ScriptApp.getService().getUrl();
  for (let i = 1; i < pData.length; i++) {
    const pId = String(pData[i][0]).trim();
    if (!projIds.includes(pId)) continue;
    const currentStatus = String(pData[i][pHeaders.indexOf('Status')] || '').trim();
    const createdBy = String(pData[i][pHeaders.indexOf('CreatedBy')] || '').trim();
    if (action === 'approve') {
      if (currentStatus === 'Pending Review') {
        pSheet.getRange(i + 1, pHeaders.indexOf('Status') + 1).setValue('Pending Approval');
        pSheet.getRange(i + 1, pHeaders.indexOf('ReviewedBy') + 1).setValue(email);
        toApproverCount++;
      } else if (currentStatus === 'Pending Approval') {
        pSheet.getRange(i + 1, pHeaders.indexOf('Status') + 1).setValue('Approved');
        pSheet.getRange(i + 1, pHeaders.indexOf('ApprovedBy') + 1).setValue(email);
      }
    } else if (action === 'reject') {
      pSheet.getRange(i + 1, pHeaders.indexOf('Status') + 1).setValue('Rejected');
      pSheet.getRange(i + 1, pHeaders.indexOf('RejectReason') + 1).setValue(reason || 'No reason provided');
      if (createdBy) {
        const body = `<div style="font-family:Arial,sans-serif;padding:30px;background-color:#f4f4f4;"><div style="max-width:500px;margin:0 auto;background:#fff;border-top:4px solid #d93025;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);"><h2 style="color:#d93025;margin-top:0;">Weekly Projection Returned</h2><p style="color:#555;">Projection <b>${pId}</b> has been returned for correction.</p><div style="background:#fff3cd;padding:15px;border-left:4px solid #856404;margin:20px 0;"><p style="margin:0;color:#856404;"><b>Reason:</b> ${escapeHtml_(reason || '')}</p></div><div style="text-align:center;"><a href="${webAppUrl}" style="display:inline-block;background:#0b1220;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;">Open Dashboard</a></div></div></div>`;
        MailApp.sendEmail({ to: getEmailByDisplayName_(createdBy) || createdBy, subject: `REJECTED: Weekly Projection ${pId} returned for correction`, htmlBody: body });
      }
    }
  }
  if (toApproverCount > 0) {
    const approverEmails = getRoleEmails_('APPROVER');
    if (approverEmails.length > 0) {
      const url = webAppUrl + '?view=approvals';
      const body = `<div style="font-family:Arial,sans-serif;padding:30px;background-color:#f4f4f4;"><div style="max-width:500px;margin:0 auto;background:#fff;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center;"><h2 style="color:#188038;margin-top:0;">Final Approval Required</h2><p style="color:#555;font-size:16px;">You have <b>${toApproverCount}</b> Weekly Projection(s) that require your final approval.</p><br><a href="${url}" style="display:inline-block;background:#188038;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;">Open Approval Dashboard</a></div></div>`;
      MailApp.sendEmail({ to: approverEmails.join(','), subject: `FINAL APPROVAL REQUIRED: ${toApproverCount} Weekly Projection(s)`, htmlBody: body });
    }
  }
  return true;
}

function getWeeklyProjectionPdfBase64(projId) {
  const pData = getSheetData_('WeeklyProjections').find(r => String(r.ProjId) === String(projId));
  if (!pData) throw new Error("Projection not found");

  const lines = getSheetData_('WeeklyProjectionLines').filter(r => String(r.ProjId) === String(projId));
  const inflowLines = getSheetData_('WeeklyProjectionInflows').filter(r => String(r.ProjId) === String(projId));
  const accountsData = getCentralAccountsData_();
  const getAccountName = (code) => { const c = String(code).trim(); const m = accountsData.find(a => String(a['Account Code']).trim() === c); return escapeHtml_(m ? m['Account Name'] : (c==='UNASSIGNED'?'Unassigned':c)); };
  const fmtMoney = (n) => Number(n || 0).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const fmtDate = (d) => { try { const dt = new Date(d); return isNaN(dt.getTime()) ? d : Utilities.formatDate(dt, Session.getScriptTimeZone(), "EEEE, MMMM dd, yyyy"); } catch(e) { return escapeHtml_(d); }};

  const bankTotals = {}; let grandTotal = 0; let scheduleHtml = '';
  const inflowBankTotals = {}; let grandInflowTotal = 0;
  const groupedByDate = {};

  lines.sort((a,b) => new Date(a.DueDate) - new Date(b.DueDate));
  lines.forEach(l => {
      const amt = Number(l.Amount || 0); const bCode = l.BankCode || 'UNASSIGNED';
      if (!bankTotals[bCode]) bankTotals[bCode] = 0; bankTotals[bCode] += amt; grandTotal += amt;
      const dStr = fmtDate(l.DueDate);
      if (!groupedByDate[dStr]) groupedByDate[dStr] = { outflows: [], inflows: [] };
      groupedByDate[dStr].outflows.push(l);
  });

  inflowLines.sort((a,b) => new Date(a.ExpectedDate) - new Date(b.ExpectedDate));
  inflowLines.forEach(l => {
      const amt = Number(l.Amount || 0); const bCode = l.BankCode || 'UNASSIGNED';
      if (!inflowBankTotals[bCode]) inflowBankTotals[bCode] = 0; inflowBankTotals[bCode] += amt; grandInflowTotal += amt;
      const dStr = fmtDate(l.ExpectedDate);
      if (!groupedByDate[dStr]) groupedByDate[dStr] = { outflows: [], inflows: [] };
      groupedByDate[dStr].inflows.push(l);
  });

  const sortedDates = Object.keys(groupedByDate).sort((a, b) => new Date(a) - new Date(b));
  for (const d of sortedDates) {
      const { outflows, inflows } = groupedByDate[d];
      scheduleHtml += `<div class="status-header" style="margin-top:20px; font-size:11px; font-weight:bold; border-bottom:2px solid #000; padding-bottom:4px; text-transform:uppercase;">SCHEDULED FOR: ${d}</div>`;
      scheduleHtml += `<table class="data-table"><thead><tr><th style="width:10%;">FLOW</th><th style="width:13%;">TYPE</th><th style="width:22%;">PAYEE / CONTACT</th><th style="width:28%;">DESCRIPTION</th><th style="width:14%;">TARGET BANK</th><th style="width:13%; text-align:right;">AMOUNT</th></tr></thead><tbody>`;

      let dayOutflow = 0; let dayInflow = 0;
      outflows.forEach(l => {
          dayOutflow += Number(l.Amount || 0);
          scheduleHtml += `<tr><td style="color:#d93025; font-weight:bold; font-size:8px;">OUTFLOW</td><td>${escapeHtml_(l.VoucherType)}<br><small style="color:#555; font-weight:normal;">${escapeHtml_(l.Purpose)}</small></td><td>${escapeHtml_(l.Contact)}</td><td>${escapeHtml_(l.Description)}</td><td>${getAccountName(l.BankCode)}</td><td style="text-align:right; font-weight:bold; color:#d93025;">${fmtMoney(l.Amount)}</td></tr>`;
      });
      inflows.forEach(l => {
          dayInflow += Number(l.Amount || 0);
          scheduleHtml += `<tr><td style="color:#188038; font-weight:bold; font-size:8px;">INFLOW</td><td></td><td>${escapeHtml_(l.Source)}</td><td>${escapeHtml_(l.Description)}</td><td>${getAccountName(l.BankCode)}</td><td style="text-align:right; font-weight:bold; color:#188038;">${fmtMoney(l.Amount)}</td></tr>`;
      });

      if (dayOutflow > 0 && dayInflow > 0) {
          scheduleHtml += `<tr class="grand-total"><td colspan="5" style="text-align:right;">Total Outflow for ${d}:</td><td style="text-align:right; color:#d93025;">(₱ ${fmtMoney(dayOutflow)})</td></tr>`;
          scheduleHtml += `<tr class="grand-total"><td colspan="5" style="text-align:right;">Total Inflow for ${d}:</td><td style="text-align:right; color:#188038;">₱ ${fmtMoney(dayInflow)}</td></tr>`;
      } else if (dayOutflow > 0) {
          scheduleHtml += `<tr class="grand-total"><td colspan="5" style="text-align:right;">Total for ${d}:</td><td style="text-align:right;">₱ ${fmtMoney(dayOutflow)}</td></tr>`;
      } else {
          scheduleHtml += `<tr class="grand-total"><td colspan="5" style="text-align:right;">Total for ${d}:</td><td style="text-align:right; color:#188038;">₱ ${fmtMoney(dayInflow)}</td></tr>`;
      }
      scheduleHtml += `</tbody></table>`;
  }

  // Calculate Balances
  const latestBals = {}; let totalAvailCash = 0;
  const dbb = getSheetData_('DailyBankBalances');
  dbb.sort((a,b) => new Date(b.Date) - new Date(a.Date));
  
  const banks = accountsData.filter(a => String(a['Account Type']).toLowerCase().includes('bank'));
  banks.forEach(b => {
     const bCode = b['Account Code'];
     const latestRow = dbb.find(r => r.BankCode === bCode);
     const bal = latestRow ? Number(latestRow.EndBalance || 0) : 0;
     latestBals[bCode] = bal; totalAvailCash += bal;
  });

  let balanceTableHtml = '';
  banks.forEach(b => {
      const bCode = b['Account Code']; const bal = latestBals[bCode] || 0; const projOut = bankTotals[bCode] || 0; const projIn = inflowBankTotals[bCode] || 0; const net = bal - projOut + projIn;
      balanceTableHtml += `<tr><td>${escapeHtml_(b['Account Name'])}</td><td style="text-align:right;">${fmtMoney(bal)}</td><td style="text-align:right; color:#d93025;">${projOut > 0 ? '(' + fmtMoney(projOut) + ')' : '-'}</td><td style="text-align:right; color:#188038;">${projIn > 0 ? fmtMoney(projIn) : '-'}</td><td style="text-align:right; font-weight:bold; ${net < 0 ? 'color:#d93025;' : ''}">${fmtMoney(net)}</td></tr>`;
  });

  const htmlTemplate = `<html><head><style>
        @page { size: letter landscape; margin: 0.5in; }
        body { font-family: Arial, sans-serif; font-size: 9px; color: #000; margin: 0; padding: 0; } 
        .section-title { background-color: #f0f0f0; padding: 4px 6px; font-weight: bold; font-size: 9px; margin-top: 15px; border: 1px solid #000; text-transform:uppercase; } 
        .data-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 9px; table-layout: fixed; } 
        .data-table th, .data-table td { padding: 3px 5px; border: 1px solid #000; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } 
        .data-table th { background-color: #e2e8f0; font-weight:bold; text-align:center; } 
        .grand-total td { font-weight: bold; background-color: #f8fafc; } 
      </style></head><body>
      <div style="padding-bottom: 25px;">
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; border-bottom: 2px solid #000; padding-bottom: 10px;"><tr><td style="width: 60%; vertical-align: middle; text-align: left; border:none;"><div style="font-size: 16px; font-weight: bold; text-decoration: underline; text-transform: uppercase;">WEEKLY DISBURSEMENT PROJECTION</div><div style="font-size:11px; margin-top:4px; color:#555;">${escapeHtml_(pData.WeekCoverage)}</div></td><td style="width: 40%; vertical-align: middle; text-align: right; font-size: 9px; border:none;"><div style="margin-bottom: 3px;"><span style="color: #555; font-weight: bold; margin-right: 5px;">Proj No:</span><span>${escapeHtml_(pData.ProjId)}</span></div><div style="margin-bottom: 3px;"><span style="color: #555; font-weight: bold; margin-right: 5px;">Generated:</span><span>${fmtDate(pData.CreatedAt)}</span></div></td></tr></table>
        
        <div style="margin-bottom: 20px;">
          <div class="section-title" style="margin-top:0;">1. BANK BALANCE PROJECTIONS</div>
          <table class="data-table">
            <thead><tr><th>BANK ACCOUNT</th><th style="text-align:right;">CURRENT AVAILABLE</th><th style="text-align:right;">PROJECTED OUTFLOW</th><th style="text-align:right;">PROJECTED INFLOW</th><th style="text-align:right;">BALANCE AFTER DISB</th></tr></thead>
            <tbody>${balanceTableHtml}<tr class="grand-total"><td>GRAND TOTAL</td><td style="text-align:right;">₱ ${fmtMoney(totalAvailCash)}</td><td style="text-align:right; color:#d93025;">(₱ ${fmtMoney(grandTotal)})</td><td style="text-align:right; color:#188038;">₱ ${fmtMoney(grandInflowTotal)}</td><td style="text-align:right;">₱ ${fmtMoney(totalAvailCash - grandTotal + grandInflowTotal)}</td></tr></tbody>
          </table>
        </div>

        <div class="section-title">2. CASH FLOW SCHEDULE</div>
        ${scheduleHtml || '<div style="padding:20px; text-align:center; border:1px solid #000;">No cash flow items scheduled.</div>'}
        
      </div>
      </body></html>`;
  try { const blob = Utilities.newBlob(htmlTemplate, MimeType.HTML).getAs(MimeType.PDF); blob.setName(`${projId}.pdf`); return Utilities.base64Encode(blob.getBytes()); } catch (err) { throw new Error("PDF Conversion failed: " + err.message); }
}


// --- DISBURSEMENT SIDE: Payment / Check Voucher JE ---
// Amount on each line = gross (VAT-inclusive when VAT tagged)
// VAT tag  → DR Expense(net) + DR Input VAT(vat), CR Bank
// EWT tag  → DR Expense, CR EWT Payable(ewt) + CR Bank(amt-ewt)
// VAT+EWT  → DR Expense(net) + DR Input VAT(vat), CR EWT Payable(ewt) + CR Bank(amt-ewt)
function buildJournalLines_(vid, payload, totalAmt, contactSummary, now, accountsData, taxRatesArr, taxGroupsArr) {
    const vType        = payload.voucherType;
    const isAutoBank   = ['PAYROLL', 'FINAL_PAY', 'INCENTIVES'].includes(vType);
    const isCheck      = vType === 'CHECK';
    const globalBankCode = payload.paymentFrom || '';
    const taxAccts     = findTaxAccounts_(accountsData);
    const taxRates     = taxRatesArr  || getTaxRates();
    const taxGroups    = taxGroupsArr || getTaxGroups();

    const getAccName = (c) => {
        const m = accountsData.find(a => String(a['Account Code']) === String(c));
        return m ? m['Account Name'] : c;
    };

    // jeMap[code] = { name, dr, cr, desc, cont }
    const jeMap = {};
    const add_ = (code, name, dr, cr, desc, cont) => {
        if (!code) return;
        if (!jeMap[code]) jeMap[code] = { name: name || getAccName(code), dr: 0, cr: 0, desc: desc || '', cont: cont || '' };
        jeMap[code].dr += (dr || 0);
        jeMap[code].cr += (cr || 0);
    };

    payload.lines.forEach((l) => {
        const expCode  = String(l.expenseAccount || '').trim();
        const amt      = Number(l.amount || 0);
        if (!expCode || amt <= 0) return;

        const taxResult = computeTaxAmounts_(amt, String(l.taxType||'N/A'), taxRates, taxGroups, l);
        const cashOut   = taxResult.cashOut;

        const desc = l.description || payload.purposeCategory || '';
        const cont = l.contact || '';

        // Debit: Expense (net after inclusive taxes)
        add_(expCode, null, taxResult.net, 0, desc, cont);
        // Debit: each inclusive tax (VAT-like)
        taxResult.inclusiveTaxes.forEach(t => {
          const acc = findAccountByNameOrCode_(t.account, accountsData) || taxAccts.inputVat;
          if (acc) add_(acc.code, acc.name, t.amt, 0, t.name + ' - ' + desc, cont);
        });
        // Credit: each exclusive deduction (EWT-like)
        taxResult.exclusiveTaxes.filter(t => t.isDeduction).forEach(t => {
          const acc = findAccountByNameOrCode_(t.account, accountsData) || taxAccts.ewtPayable;
          if (acc) add_(acc.code, acc.name, 0, t.amt, t.name + ' - ' + desc, cont);
        });

        if (isAutoBank) {
            const bankCode = String(l.paymentFrom || '').trim();
            if (bankCode) add_(bankCode, null, 0, cashOut, desc, cont);
        } else if (isCheck) {
            // CHECK vouchers with per-line bank codes (e.g. payroll check-payment clearance):
            // DR expenseAccount (e.g. PDC Issued), CR per-line bank (e.g. Cash in Bank – BPI).
            // If no per-line bank is provided, skip here and let the PDC auto-balance below handle it.
            const lineBankCode = String(l.paymentFrom || '').trim();
            if (lineBankCode) add_(lineBankCode, null, 0, cashOut, desc, cont);
        } else {
            if (globalBankCode) add_(globalBankCode, null, 0, cashOut, desc, cont);
        }
    });

    // CHECK: for manually-created check vouchers (no per-line bank codes), balance the entry
    // with Post-Dated Checks Issued. Skipped when per-line banks already balanced the entry.
    if (isCheck) {
        const totalDr = Object.values(jeMap).reduce((s, v) => s + v.dr, 0);
        const totalCr = Object.values(jeMap).reduce((s, v) => s + v.cr, 0);
        const checkCr = +(totalDr - totalCr).toFixed(2);
        if (checkCr > 0) {
            const pdcAcc  = accountsData.find(a => String(a['Account Name']).trim().toLowerCase() === 'post-dated checks issued');
            const pdcCode = pdcAcc ? pdcAcc['Account Code'] : '2800001';
            add_(pdcCode, pdcAcc ? pdcAcc['Account Name'] : 'Post-Dated Checks Issued',
                 0, checkCr, payload.purposeCategory || 'Check Issuance', contactSummary);
        }
    }

    const jLines = []; let lineNo = 1;
    // Debits first, then credits — standard JE presentation
    for (const [code, v] of Object.entries(jeMap)) {
        if (v.dr > 0) jLines.push([vid, 'JE-' + vid, lineNo++, code, v.name, v.desc, v.cont, '', v.dr, '', now]);
    }
    for (const [code, v] of Object.entries(jeMap)) {
        if (v.cr > 0) jLines.push([vid, 'JE-' + vid, lineNo++, code, v.name, v.desc, v.cont, '', '', v.cr, now]);
    }
    return jLines;
}

function createVoucher(payload, _internal) {
  if (payload.voucherType === 'CHECK' && !_internal) throw new Error('Check Vouchers must be created through the Check Registry module.');
  const id = generateVoucherId_(payload.voucherType, payload.preparationDate); const user = getActionUser_(); const now = new Date();
  const vlSheet = getTargetSheet_('VoucherLines'); const vlColMap = ensureVoucherLinesHeaders_(vlSheet); const vlHLen = vlColMap.headers.length;
  const _taxRates_ = getTaxRates(); const _taxGroups_ = getTaxGroups();
  let totalAmount = 0; let contacts = new Set();
  const linesData = payload.lines.map((line, i) => {
    totalAmount += Number(line.amount || 0); if (line.contact) contacts.add(line.contact);
    const row = new Array(vlHLen).fill('');
    row[vlColMap.headers.indexOf('VoucherId')] = id; row[vlColMap.headers.indexOf('Date')] = payload.preparationDate; row[vlColMap.headers.indexOf('LineNo')] = i + 1;
    row[vlColMap.headers.indexOf('Contact')] = line.contact; row[vlColMap.headers.indexOf('ExpenseAccountCode')] = line.expenseAccount; row[vlColMap.headers.indexOf('Description')] = line.description;
    row[vlColMap.headers.indexOf('Amount')] = Number(line.amount || 0); row[vlColMap.headers.indexOf('CreatedAt')] = now; row[vlColMap.headers.indexOf('CreatedBy')] = user; row[vlColMap.headers.indexOf('UpdatedAt')] = now; row[vlColMap.headers.indexOf('UpdatedBy')] = user;
    row[vlColMap.cat] = line.category || ''; row[vlColMap.mp] = Number(line.manpowerCount || 0); row[vlColMap.bank] = String(line.paymentFrom || '');
    row[vlColMap.chkNo] = line.lineCheckNo || ''; row[vlColMap.chkDate] = line.lineCheckDate || '';
    // Tax fields — resolved from TaxRates/TaxGroups config
    const _taxType = String(line.taxType || 'N/A'); const _amt = Number(line.amount || 0);
    const _taxRes  = computeTaxAmounts_(_amt, _taxType, _taxRates_, _taxGroups_, line);
    const _vatAmt  = _taxRes.inclusiveTaxes.reduce((s,t) => s+t.amt, 0);
    const _ewtAmtS = _taxRes.exclusiveTaxes.filter(t=>t.isDeduction).reduce((s,t) => s+t.amt, 0);
    const _ewtRateS= _taxRes.net > 0 ? _ewtAmtS / _taxRes.net : 0;
    if (vlColMap.taxType > -1) row[vlColMap.taxType] = _taxType;
    if (vlColMap.ewtRate > -1) row[vlColMap.ewtRate] = _ewtRateS;
    if (vlColMap.vatAmt  > -1) row[vlColMap.vatAmt]  = _vatAmt;
    if (vlColMap.ewtAmt  > -1) row[vlColMap.ewtAmt]  = _ewtAmtS;
    return row;
  });
  
  const contactSummary = Array.from(contacts).join(', ');
  const vSheet = getTargetSheet_('Vouchers'); const vHeaders = ensureVouchersHeaders_(vSheet);
  const vRow = new Array(vHeaders.length).fill('');
  vRow[vHeaders.indexOf('VoucherId')] = id; vRow[vHeaders.indexOf('VoucherType')] = payload.voucherType; vRow[vHeaders.indexOf('PreparationDate')] = payload.preparationDate; vRow[vHeaders.indexOf('PurposeCategory')] = payload.purposeCategory; vRow[vHeaders.indexOf('Status')] = payload.status;
  vRow[vHeaders.indexOf('PaymentFromAccountCode')] = payload.paymentFrom || ''; vRow[vHeaders.indexOf('ContactSummary')] = contactSummary; vRow[vHeaders.indexOf('TotalAmount')] = totalAmount; vRow[vHeaders.indexOf('CreatedAt')] = now; vRow[vHeaders.indexOf('CreatedBy')] = user; vRow[vHeaders.indexOf('UpdatedAt')] = now; vRow[vHeaders.indexOf('UpdatedBy')] = user;
  vRow[vHeaders.indexOf('CheckNumber')] = payload.isMultipleChecks ? '' : (payload.globalCheckNo || '');
  vRow[vHeaders.indexOf('CheckDate')] = payload.isMultipleChecks ? '' : (payload.globalCheckDate || '');
  vRow[vHeaders.indexOf('IsMultipleChecks')] = payload.isMultipleChecks ? 'TRUE' : 'FALSE';
  vRow[vHeaders.indexOf('ReviewedBy')] = ''; vRow[vHeaders.indexOf('ApprovedBy')] = ''; vRow[vHeaders.indexOf('RejectReason')] = '';
  const _lsIdx  = vHeaders.indexOf('LinkedScheduleId');   if (_lsIdx  >= 0) vRow[_lsIdx]  = payload.linkedScheduleId   || '';
  const _lsdIdx = vHeaders.indexOf('LinkedScheduleDate'); if (_lsdIdx >= 0) vRow[_lsdIdx] = payload.linkedScheduleDate || '';

  vSheet.appendRow(vRow);
  if (linesData.length > 0) { const lastRow = vlSheet.getLastRow(); const maxRows = vlSheet.getMaxRows(); if (lastRow + linesData.length > maxRows) { vlSheet.insertRowsAfter(lastRow, (lastRow + linesData.length) - maxRows + 50); } vlSheet.getRange(lastRow + 1, 1, linesData.length, vlHLen).setValues(linesData); }
  const accountsData = getCentralAccountsData_();
  
  const jLines = buildJournalLines_(id, payload, totalAmount, contactSummary, now, accountsData, _taxRates_, _taxGroups_);
  const jlSheet = getTargetSheet_('JournalLines'); 
  if (jLines.length > 0) { const jlLastRow = jlSheet.getLastRow(); const jlMaxRows = jlSheet.getMaxRows(); if (jlLastRow + jLines.length > jlMaxRows) { jlSheet.insertRowsAfter(jlLastRow, (jlLastRow + jLines.length) - jlMaxRows + 50); } jlSheet.getRange(jlLastRow + 1, 1, jLines.length, jLines[0].length).setValues(jLines); }
  appendToCentralJournalLines_(jLines, user);

  return { voucherId: id };
}

function updateVoucher(payload) {
  const id = payload.voucherId; const user = getActionUser_(); const now = new Date();
  const vlSheet = getTargetSheet_('VoucherLines'); const vlColMap = ensureVoucherLinesHeaders_(vlSheet); const vlHLen = vlColMap.headers.length;
  const _taxRatesU_ = getTaxRates(); const _taxGroupsU_ = getTaxGroups();
  let totalAmount = 0; let contacts = new Set();
  const linesData = payload.lines.map((line, i) => {
    totalAmount += Number(line.amount || 0); if (line.contact) contacts.add(line.contact);
    const row = new Array(vlHLen).fill('');
    row[vlColMap.headers.indexOf('VoucherId')] = id; row[vlColMap.headers.indexOf('Date')] = payload.preparationDate; row[vlColMap.headers.indexOf('LineNo')] = i + 1;
    row[vlColMap.headers.indexOf('Contact')] = line.contact; row[vlColMap.headers.indexOf('ExpenseAccountCode')] = line.expenseAccount; row[vlColMap.headers.indexOf('Description')] = line.description;
    row[vlColMap.headers.indexOf('Amount')] = Number(line.amount || 0); row[vlColMap.headers.indexOf('CreatedAt')] = now; row[vlColMap.headers.indexOf('CreatedBy')] = user; row[vlColMap.headers.indexOf('UpdatedAt')] = now; row[vlColMap.headers.indexOf('UpdatedBy')] = user;
    row[vlColMap.cat] = line.category || ''; row[vlColMap.mp] = Number(line.manpowerCount || 0); row[vlColMap.bank] = String(line.paymentFrom || '');
    row[vlColMap.chkNo] = line.lineCheckNo || ''; row[vlColMap.chkDate] = line.lineCheckDate || '';
    // Tax fields — resolved from TaxRates/TaxGroups config
    const _taxType = String(line.taxType || 'N/A'); const _amt = Number(line.amount || 0);
    const _taxRes  = computeTaxAmounts_(_amt, _taxType, _taxRatesU_, _taxGroupsU_, line);
    const _vatAmt  = _taxRes.inclusiveTaxes.reduce((s,t) => s+t.amt, 0);
    const _ewtAmtS = _taxRes.exclusiveTaxes.filter(t=>t.isDeduction).reduce((s,t) => s+t.amt, 0);
    const _ewtRateS= _taxRes.net > 0 ? _ewtAmtS / _taxRes.net : 0;
    if (vlColMap.taxType > -1) row[vlColMap.taxType] = _taxType;
    if (vlColMap.ewtRate > -1) row[vlColMap.ewtRate] = _ewtRateS;
    if (vlColMap.vatAmt  > -1) row[vlColMap.vatAmt]  = _vatAmt;
    if (vlColMap.ewtAmt  > -1) row[vlColMap.ewtAmt]  = _ewtAmtS;
    return row;
  });
  
  const contactSummary = Array.from(contacts).join(', ');
  const vSheet = getTargetSheet_('Vouchers'); const vHeaders = ensureVouchersHeaders_(vSheet); const vData = vSheet.getDataRange().getValues();
  let headerRowIdx = -1; for (let i = 1; i < vData.length; i++) { if (vData[i][vHeaders.indexOf('VoucherId')] === id) { headerRowIdx = i + 1; break; } }
  
  const updateCell = (colName, val) => { const cIdx = vHeaders.indexOf(colName); if (cIdx !== -1) vSheet.getRange(headerRowIdx, cIdx + 1).setValue(val); };
  updateCell('VoucherType', payload.voucherType); updateCell('PreparationDate', payload.preparationDate); updateCell('PurposeCategory', payload.purposeCategory); updateCell('Status', payload.status); updateCell('PaymentFromAccountCode', payload.paymentFrom || ''); updateCell('ContactSummary', contactSummary); updateCell('TotalAmount', totalAmount); updateCell('UpdatedAt', now); updateCell('UpdatedBy', user);
  updateCell('CheckNumber', payload.isMultipleChecks ? '' : (payload.globalCheckNo || ''));
  updateCell('CheckDate', payload.isMultipleChecks ? '' : (payload.globalCheckDate || ''));
  updateCell('IsMultipleChecks', payload.isMultipleChecks ? 'TRUE' : 'FALSE');
  updateCell('RejectReason', ''); updateCell('ReviewedBy', ''); updateCell('ApprovedBy', '');

  const vlData = vlSheet.getDataRange().getValues();
  for (let i = vlData.length - 1; i >= 1; i--) { if (vlData[i][vlData[0].indexOf('VoucherId')] === id) vlSheet.deleteRow(i + 1); }
  if (linesData.length > 0) { const lastRow = vlSheet.getLastRow(); const maxRows = vlSheet.getMaxRows(); if (lastRow + linesData.length > maxRows) { vlSheet.insertRowsAfter(lastRow, (lastRow + linesData.length) - maxRows + 50); } vlSheet.getRange(lastRow + 1, 1, linesData.length, vlHLen).setValues(linesData); }
  
  const jlSheet = getTargetSheet_('JournalLines'); const jlData = jlSheet.getDataRange().getValues();
  if (jlData.length > 0) { const targetIdx = Math.max(0, jlData[0].findIndex(h => String(h).trim() === 'voucher_id')); for (let i = jlData.length - 1; i >= 1; i--) { if (jlData[i][targetIdx] === id) jlSheet.deleteRow(i + 1); } }
  deleteFromCentralJournalLines_(id);
  const accountsData = getCentralAccountsData_();
  
  const jLines = buildJournalLines_(id, payload, totalAmount, contactSummary, now, accountsData, _taxRatesU_, _taxGroupsU_);
  if (jLines.length > 0) jlSheet.getRange(jlSheet.getLastRow() + 1, 1, jLines.length, jLines[0].length).setValues(jLines);
  appendToCentralJournalLines_(jLines, user);

  return { voucherId: id };
}

function getVoucherDetails(id) {
  const vData = getSheetData_('Vouchers').find(r => String(r.VoucherId) === String(id));
  const vlData = getSheetData_('VoucherLines').filter(r => String(r.VoucherId) === String(id));
  const jlData = getSheetData_('JournalLines').filter(r => String(r.voucher_id || r.VoucherId || '') === String(id));
  if (!vData) throw new Error("Voucher not found");
  return sanitizeData_({ header: vData, lines: vlData, journalLines: jlData });
}

function updateVoucherStatus(id, status) {
  const vSheet = getTargetSheet_('Vouchers'); const headers = ensureVouchersHeaders_(vSheet); const vData = vSheet.getDataRange().getValues();
  const vTypeIdx = headers.indexOf('VoucherType');
  let foundPaid = false;
  for (let i = 1; i < vData.length; i++) { 
    if (vData[i][headers.indexOf('VoucherId')] === id) { 
      vSheet.getRange(i + 1, headers.indexOf('Status') + 1).setValue(status); 
      vSheet.getRange(i + 1, headers.indexOf('UpdatedAt') + 1).setValue(new Date()); 
      vSheet.getRange(i + 1, headers.indexOf('UpdatedBy') + 1).setValue(Session.getActiveUser().getEmail()); 
      // If this is an INCENTIVES voucher and status is Paid or Released, update the incentive status
      if (String(vData[i][vTypeIdx]).trim() === 'INCENTIVES' && (status === 'Paid' || status === 'Released')) {
        try { updateIncentiveStatusWhenVoucherPaid_(id); } catch(e) { Logger.log('Error updating incentive status: ' + e.message); }
      }
      // If this is a PAYROLL voucher set to 'Released', revert employee salarystatus to 'Active'
      // (guard is inside revertEmployeeStatusToActive_ — only 'For Release*' statuses are reverted)
      if (String(vData[i][vTypeIdx]).trim() === 'PAYROLL' && status === 'Released') {
        try { revertEmployeeStatusToActive_(id, 'PAYROLL'); } catch(e) { Logger.log('Error reverting payroll employee status: ' + e.message); }
      }
      // If this is a FINAL_PAY voucher set to 'Released', mark employees Released/Inactive in WRI Masterlist
      if (String(vData[i][vTypeIdx]).trim() === 'FINAL_PAY' && status === 'Released') {
        try { notifyFinalPayDisbursed(id); } catch(e) { Logger.log('Error notifying final pay disbursed: ' + e.message); }
      }
      foundPaid = true;
      break;
    } 
  }
  if (!foundPaid) throw new Error('Voucher ID not found');
  return true;
}

/**
 * Restore a Voided voucher back to the approval queue.
 * Clears prior approval stamps and routes to Pending Review (if reviewer exists)
 * or Pending Approval (if only an approver is configured), then emails the next approver.
 */
function restoreVoucher(id) {
  const vSheet = getTargetSheet_('Vouchers');
  const headers = ensureVouchersHeaders_(vSheet);
  const vData = vSheet.getDataRange().getValues();

  const reviewerEmails = getRoleEmails_('REVIEWER');
  const approverEmails = getRoleEmails_('APPROVER');
  let targetEmails = [];
  let nextStatus = '';
  if (reviewerEmails.length > 0) {
    targetEmails = reviewerEmails;
    nextStatus = 'Pending Review';
  } else if (approverEmails.length > 0) {
    targetEmails = approverEmails;
    nextStatus = 'Pending Approval';
  } else {
    throw new Error('No Reviewer or Approver configured in Users sheet.');
  }

  const idIdx         = headers.indexOf('VoucherId');
  const statusIdx     = headers.indexOf('Status');
  const reviewedByIdx = headers.indexOf('ReviewedBy');
  const approvedByIdx = headers.indexOf('ApprovedBy');
  const updatedAtIdx  = headers.indexOf('UpdatedAt');
  const updatedByIdx  = headers.indexOf('UpdatedBy');

  let found = false;
  for (let i = 1; i < vData.length; i++) {
    if (vData[i][idIdx] !== id) continue;
    const currentStatus = String(vData[i][statusIdx] || '').trim();
    if (currentStatus !== 'Voided') throw new Error(`Voucher ${id} is not Voided (current: ${currentStatus}).`);

    const row = i + 1;
    const email = Session.getActiveUser().getEmail();
    const now = new Date();
    vSheet.getRange(row, statusIdx + 1).setValue(nextStatus);
    if (reviewedByIdx >= 0) vSheet.getRange(row, reviewedByIdx + 1).setValue('');
    if (approvedByIdx >= 0) vSheet.getRange(row, approvedByIdx + 1).setValue('');
    vSheet.getRange(row, updatedAtIdx + 1).setValue(now);
    vSheet.getRange(row, updatedByIdx + 1).setValue(email);
    found = true;
    break;
  }
  if (!found) throw new Error('Voucher ID not found.');

  if (targetEmails.length > 0) {
    const url = ScriptApp.getService().getUrl() + '?view=approvals';
    const body = `<div style="font-family:Arial,sans-serif; padding:30px; background-color:#f4f4f4;"><div style="max-width:500px; margin:0 auto; background:#fff; padding:30px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.1); text-align:center;"><h2 style="color:#f97316; margin-top:0;">Voucher Restore — Approval Required</h2><p style="color:#555; font-size:16px;">Voucher <b>${id}</b> has been restored from Voided status and requires your ${nextStatus === 'Pending Review' ? 'review' : 'approval'}.</p><br><a href="${url}" style="display:inline-block; background:#188038; color:#fff; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:bold; font-size:14px;">Open Approval Dashboard</a></div></div>`;
    MailApp.sendEmail({ to: targetEmails.join(','), subject: `ACTION REQUIRED: Restored Voucher ${id} needs your ${nextStatus === 'Pending Review' ? 'review' : 'approval'}`, htmlBody: body });
  }
  return true;
}

// Update incentive status to 'Released' when voucher is paid or released
function updateIncentiveStatusWhenVoucherPaid_(voucherId) {
  try {
    // Get the Vouchers sheet to verify it's an INCENTIVES voucher
    const vSheet = getTargetSheet_('Vouchers');
    const vData = vSheet.getDataRange().getValues();
    const vHeaders = vData[0];
    const vTypeIdx = vHeaders.indexOf('VoucherType');
    const vIdIdx = vHeaders.indexOf('VoucherId');
    
    let isIncentivesVoucher = false;
    for (let i = 1; i < vData.length; i++) {
      if (String(vData[i][vIdIdx]).trim() === String(voucherId).trim()) {
        if (String(vData[i][vTypeIdx]).trim() === 'INCENTIVES') {
          isIncentivesVoucher = true;
        }
        break;
      }
    }
    
    if (!isIncentivesVoucher) return;
    
    // Update IncentiveSheetLines - set all "For Release" lines to 'Released'
    const islSheet = getTargetSheet_('IncentiveSheetLines');
    if (!islSheet || islSheet.getLastRow() < 2) return;
    
    const islData = islSheet.getDataRange().getValues();
    const islHeaders = islData[0].map(h => String(h).trim());
    const islStatusIdx = islHeaders.findIndex(h => h.toLowerCase() === 'incentive status');
    
    if (islStatusIdx < 0) return;
    
    // Update all "For Release" lines to "Released"
    for (let i = 1; i < islData.length; i++) {
      const currentStatus = String(islData[i][islStatusIdx]).trim().toLowerCase();
      
      // Update if it says "For Release" and not on hold
      if (currentStatus.includes('for release') && !currentStatus.includes('hold')) {
        islSheet.getRange(i + 1, islStatusIdx + 1).setValue('Released');
      }
    }
  } catch(e) {
    Logger.log('updateIncentiveStatusWhenVoucherPaid_ error: ' + e.message);
  }
}

// Revert employee salary status to 'Active' when PAYROLL or FINAL_PAY vouchers are paid/disbursed
function revertEmployeeStatusToActive_(voucherId, voucherType) {
  // Only handles PAYROLL vouchers. FINAL_PAY is handled by notifyFinalPayDisbursed().
  if (voucherType === 'FINAL_PAY') return;
  try {
    // The VoucherId for a PAYROLL voucher equals the PayrollID (pbId) set in createPayrollVoucherInDisbApp_.
    // Use PayrollBookConsolidated as the authoritative employee list for this payroll batch.
    const payrollSS  = SpreadsheetApp.openById(PAYROLL_DB_ID_);
    const pbcSheet   = payrollSS.getSheetByName('PayrollBookConsolidated');
    if (!pbcSheet || pbcSheet.getLastRow() < 2) return;

    const pbcData  = pbcSheet.getDataRange().getValues();
    const pbcH     = pbcData[0].map(function(h) { return String(h).trim().toLowerCase().replace(/\s+/g,''); });
    const pbcPidI  = pbcH.indexOf('payrollid');
    const pbcUidI  = pbcH.indexOf('userid');
    const pbcNI    = pbcH.indexOf('name');
    const pbcCI    = pbcH.indexOf('companyname');
    if (pbcPidI < 0) return;

    // Read current WRI salarystatus so we only revert 'For Release*' employees —
    // 'Hold' employees must NOT be reverted (they are mid-Final-Pay-process).
    const wriSS      = SpreadsheetApp.openById('13QOgFiROvcXny_P30mU13AW4fTB-DB7MWAKj6X45BFo');
    const wriSheet   = wriSS.getSheetByName('Masterlist');
    const wriStatusByUid = {};
    if (wriSheet && wriSheet.getLastRow() > 1) {
      const wriData = wriSheet.getDataRange().getValues();
      const wriH    = wriData[0].map(function(h) { return String(h).trim().toLowerCase(); });
      const wUidI   = wriH.indexOf('userid');
      const wStI    = wriH.indexOf('salarystatus');
      if (wUidI > -1 && wStI > -1) {
        for (var wi = 1; wi < wriData.length; wi++) {
          var uid = String(wriData[wi][wUidI] || '').trim();
          if (uid) wriStatusByUid[uid] = String(wriData[wi][wStI] || '').trim();
        }
      }
    }

    // Build updates: only revert employees whose current WRI salarystatus starts with 'For Release'
    const updates = [];
    for (var i = 1; i < pbcData.length; i++) {
      if (String(pbcData[i][pbcPidI]).trim() !== String(voucherId).trim()) continue;
      var uid  = pbcUidI > -1 ? String(pbcData[i][pbcUidI] || '').trim() : '';
      var name = pbcNI   > -1 ? String(pbcData[i][pbcNI]   || '').trim() : '';
      var comp = pbcCI   > -1 ? String(pbcData[i][pbcCI]   || '').trim() : '';
      var curStatus = uid ? (wriStatusByUid[uid] || '') : '';
      // Guard: only revert if the current status starts with 'For Release' (any variant)
      if (curStatus.toLowerCase().startsWith('for release')) {
        updates.push({ userid: uid, name: name, company: comp, salaryStatus: 'Active' });
      }
    }

    if (updates.length > 0) {
      syncWriMasterlistByNameCompanyPayroll_(updates);
      syncWriMasterlistByUserid_(updates);
      Logger.log('revertEmployeeStatusToActive_: reverted ' + updates.length + ' employees for voucher ' + voucherId);
    }
  } catch(e) {
    Logger.log('revertEmployeeStatusToActive_ error: ' + e.message);
  }
}

function submitVouchersForApproval(voucherIds) {
  if (!voucherIds || voucherIds.length === 0) return false;
  const vSheet = getTargetSheet_('Vouchers'); const headers = ensureVouchersHeaders_(vSheet); const vData = vSheet.getDataRange().getValues(); 
  const reviewerEmails = getRoleEmails_('REVIEWER'); const approverEmails = getRoleEmails_('APPROVER');
  let targetEmails = []; let nextStatus = '';
  if (reviewerEmails.length > 0) { targetEmails = reviewerEmails; nextStatus = 'Pending Review'; } else if (approverEmails.length > 0) { targetEmails = approverEmails; nextStatus = 'Pending Approval'; } else { throw new Error("No Reviewer or Approver configured in Users sheet."); }
  const lockedTypes = ['PAYROLL', 'FINAL_PAY'];
  const lockedStatuses = ['Approved', 'Paid', 'Voided', 'Rejected'];
  let count = 0;
  for (let i = 1; i < vData.length; i++) {
    if (voucherIds.includes(vData[i][headers.indexOf('VoucherId')])) {
      const vType = String(vData[i][headers.indexOf('VoucherType')] || '').trim();
      const vStat = String(vData[i][headers.indexOf('Status')] || '').trim();
      if (lockedTypes.includes(vType) || lockedStatuses.includes(vStat)) continue; // pre-approved or terminal status
      vSheet.getRange(i + 1, headers.indexOf('Status') + 1).setValue(nextStatus); vSheet.getRange(i + 1, headers.indexOf('UpdatedAt') + 1).setValue(new Date()); vSheet.getRange(i + 1, headers.indexOf('UpdatedBy') + 1).setValue(Session.getActiveUser().getEmail()); count++;
    }
  }
  if (count > 0 && targetEmails.length > 0) {
      const url = ScriptApp.getService().getUrl() + "?view=approvals";
      const body = `<div style="font-family:Arial,sans-serif; padding:30px; background-color:#f4f4f4;"><div style="max-width:500px; margin:0 auto; background:#fff; padding:30px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.1); text-align:center;"><h2 style="color:#188038; margin-top:0;">Action Required</h2><p style="color:#555; font-size:16px;">You have <b>${count}</b> voucher(s) awaiting your review/approval.</p><br><a href="${url}" style="display:inline-block; background:#188038; color:#fff; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:bold; font-size:14px;">Open Approval Dashboard</a></div></div>`;
      MailApp.sendEmail({ to: targetEmails.join(','), subject: `ACTION REQUIRED: ${count} Voucher(s) for Approval`, htmlBody: body });
  }
  return true;
}

function processApprovals(payload) {
  const { voucherIds, action, reason } = payload;
  if (!voucherIds || voucherIds.length === 0) return false;
  const email = Session.getActiveUser().getEmail();
  const vSheet = getTargetSheet_('Vouchers'); const headers = ensureVouchersHeaders_(vSheet); const vData = vSheet.getDataRange().getValues(); 
  let toApproverCount = 0; const webAppUrl = ScriptApp.getService().getUrl();

  for (let i = 1; i < vData.length; i++) {
    const vId = vData[i][headers.indexOf('VoucherId')];
    if (voucherIds.includes(vId)) {
      const currentStatus = vData[i][headers.indexOf('Status')]; const preparerName = vData[i][headers.indexOf('CreatedBy')]; const preparerEmail = getEmailByDisplayName_(preparerName) || preparerName;
      if (action === 'approve') {
         if (currentStatus === 'Pending Review') { vSheet.getRange(i + 1, headers.indexOf('Status') + 1).setValue('Pending Approval'); vSheet.getRange(i + 1, headers.indexOf('ReviewedBy') + 1).setValue(email); toApproverCount++; } else if (currentStatus === 'Pending Approval') { vSheet.getRange(i + 1, headers.indexOf('Status') + 1).setValue('Approved'); vSheet.getRange(i + 1, headers.indexOf('ApprovedBy') + 1).setValue(email); }
      } else if (action === 'reject') {
         vSheet.getRange(i + 1, headers.indexOf('Status') + 1).setValue('Rejected'); vSheet.getRange(i + 1, headers.indexOf('RejectReason') + 1).setValue(reason || 'No reason provided');
         const body = `<div style="font-family:Arial,sans-serif; padding:30px; background-color:#f4f4f4;"><div style="max-width:500px; margin:0 auto; background:#fff; border-top:4px solid #d93025; padding:30px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.1);"><h2 style="color:#d93025; margin-top:0;">Voucher Returned</h2><p style="color:#555;">Voucher <b>${vId}</b> has been returned for correction.</p><div style="background:#fff3cd; padding:15px; border-left:4px solid #856404; margin:20px 0;"><p style="margin:0; color:#856404;"><b>Reason:</b> ${escapeHtml_(reason)}</p></div><div style="text-align:center;"><a href="${webAppUrl}" style="display:inline-block; background:#0b1220; color:#fff; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:bold; font-size:14px;">Open Dashboard to Edit</a></div></div></div>`;
         MailApp.sendEmail({ to: preparerEmail, subject: `REJECTED: Voucher ${vId} returned for correction`, htmlBody: body });
      }
      vSheet.getRange(i + 1, headers.indexOf('UpdatedAt') + 1).setValue(new Date()); vSheet.getRange(i + 1, headers.indexOf('UpdatedBy') + 1).setValue(email);
    }
  }
  if (toApproverCount > 0) {
      const approverEmails = getRoleEmails_('APPROVER');
      if (approverEmails.length > 0) {
          const url = webAppUrl + "?view=approvals";
          const body = `<div style="font-family:Arial,sans-serif; padding:30px; background-color:#f4f4f4;"><div style="max-width:500px; margin:0 auto; background:#fff; padding:30px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.1); text-align:center;"><h2 style="color:#188038; margin-top:0;">Final Approval Required</h2><p style="color:#555; font-size:16px;">You have <b>${toApproverCount}</b> voucher(s) that have been reviewed and require your final approval.</p><br><a href="${url}" style="display:inline-block; background:#188038; color:#fff; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:bold; font-size:14px;">Open Approval Dashboard</a></div></div>`;
          MailApp.sendEmail({ to: approverEmails.join(','), subject: `FINAL APPROVAL REQUIRED: ${toApproverCount} Voucher(s)`, htmlBody: body });
      }
  }
  return true;
}

function fetchImageBase64_(urlOrFileId) {
  if (!urlOrFileId) return null;
  try {
    var input = String(urlOrFileId).trim();
    var useDrive = false;
    var fileId = input;

    if (input.includes('drive.google.com') || input.includes('docs.google.com')) {
      // Extract file ID from Google Drive sharing/view URL
      var m = input.match(/[?&]id=([^&]+)/) || input.match(/\/d\/([^\/\?]+)/);
      if (m) { fileId = m[1]; useDrive = true; }
    } else if (!input.startsWith('http')) {
      // Raw Drive file ID (no URL scheme)
      useDrive = true;
    }

    if (useDrive) {
      var file = DriveApp.getFileById(fileId);
      var blob = file.getBlob();
      var mimeType = blob.getContentType() || 'image/png';
      return 'data:' + mimeType + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } else {
      // Generic HTTP URL
      var response = UrlFetchApp.fetch(input, { muteHttpExceptions: true });
      if (response.getResponseCode() === 200) {
        var blob = response.getBlob();
        var mimeType = blob.getContentType() || 'image/png';
        return 'data:' + mimeType + ';base64,' + Utilities.base64Encode(blob.getBytes());
      }
    }
  } catch (e) {
    Logger.log('fetchImageBase64_ error: ' + e.message);
  }
  return null;
}

function getVoucherPdfBase64(voucherIdOrArray) {
  const ids = Array.isArray(voucherIdOrArray) ? voucherIdOrArray : [voucherIdOrArray];
  const accountsData = getCentralAccountsData_();
  const getAccountName = (codeOrName) => { const codeStr = String(codeOrName).trim(); const match = accountsData.find(a => String(a['Account Code']).trim() === codeStr || String(a['AccountCode']).trim() === codeStr); return escapeHtml_(match ? (match['Account Name'] || match['AccountName']) : codeStr); };
  const fmtMoney = (n) => Number(n || 0).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const s = {};
  getCentralSheetData_('Modules').forEach(row => { if (row.Key) s[row.Key] = row.Value; });
  getCentralSheetData_('Sequence').forEach(row => { if (row.Key) s[row.Key] = row.Value; });
  const users = getCentralSheetData_('Users');
  const getSigHtml = (searchStr, isAuth) => { if (!isAuth || !searchStr) return ""; const query = String(searchStr).toLowerCase().trim(); const u = users.find(x => String(x['Full Name']).toLowerCase().trim() === query || String(x['Email']).toLowerCase().trim() === query || String(x['Work Email']).toLowerCase().trim() === query); if (u && u['Signature URL']) { const b64 = fetchImageBase64_(u['Signature URL']); if (b64) return `<img src="${b64}" height="55" style="margin-bottom:-15px;" />`; } return ""; };
  const getPrintedName = (searchStr) => { if (!searchStr) return ""; const query = String(searchStr).toLowerCase().trim(); const u = users.find(x => String(x['Email']).toLowerCase().trim() === query || String(x['Work Email']).toLowerCase().trim() === query); return escapeHtml_(u ? (u['Full Name'] || searchStr) : searchStr); }

  let logoHtml = `<div style="font-weight: bold; color: #000;">WORKSCALE RESOURCES INC.</div>`;
  try { const b64 = fetchImageBase64_(s['LETTERHEAD_LINK'] || "1hTAv6ofNi9676XN_rR_eSTgFv91wpNYt"); if (b64) logoHtml = `<img src="${b64}" style="max-height: 65px; max-width: 200px; object-fit: contain;" />`; } catch(e) {}

  let allPagesHtml = '';

  ids.forEach((voucherId, index) => {
      const details = getVoucherDetails(voucherId); const h = details.header; const lines = details.lines;
      let dateStr = h.PreparationDate; try { const d = new Date(h.PreparationDate); if (!isNaN(d.getTime())) dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), "EEE, MMMM dd, yyyy"); } catch(e) {}
      const stat = String(h.Status || '');
      let isReviewed = h.ReviewedBy ? true : ['Pending Approval', 'Approved', 'Paid', 'Voided'].includes(stat);
      let isApproved = h.ApprovedBy ? true : ['Approved', 'Paid', 'Voided'].includes(stat);
      const revName = h.ReviewedBy ? getPrintedName(h.ReviewedBy) : escapeHtml_(s['REVIEWER_NAME'] || ''); 
      const appName = h.ApprovedBy ? getPrintedName(h.ApprovedBy) : escapeHtml_(s['APPROVER_NAME'] || ''); 
      const notedName = escapeHtml_(s['NOTED_BY_NAME'] || '');
      const revSig = h.ReviewedBy ? getSigHtml(h.ReviewedBy, true) : getSigHtml(revName, isReviewed);
      const appSig = h.ApprovedBy ? getSigHtml(h.ApprovedBy, true) : getSigHtml(appName, isApproved);

      let mainBodyHtml = '';
      let displayTitle = escapeHtml_(h.VoucherType) + " VOUCHER";
      if (h.VoucherType === 'FINAL_PAY') displayTitle = "FINAL PAY VOUCHER";
      if (h.VoucherType === 'INCENTIVES') displayTitle = "INCENTIVES VOUCHER";
      if (h.VoucherType === 'PAYROLL') displayTitle = "PAYROLL VOUCHER";

      if (['PAYROLL', 'FINAL_PAY', 'INCENTIVES'].includes(h.VoucherType)) {
        let catGroups = {}; let grandTotalAmt = 0;
        lines.forEach(l => {
           const amt = Number(l.Amount || 0); const count = Number(l.ManpowerCount || 0); const cat = String(l.Category || 'Other').trim();
           if (!catGroups[cat]) catGroups[cat] = { html: '', total: 0, count: 0 };
           catGroups[cat].html += `<tr><td>${escapeHtml_(l.Contact || l.Payee || '')}</td><td>${escapeHtml_(l.Description || '')}</td><td style="text-align: right;">₱ ${fmtMoney(amt)}</td><td style="text-align: center;">${count}</td></tr>`;
           catGroups[cat].total += amt; catGroups[cat].count += count; grandTotalAmt += amt;
        });

        let summaryTrs = '';
        for (const [cat, grp] of Object.entries(catGroups)) { summaryTrs += `<td style="text-align: right;">₱ ${fmtMoney(grp.total)}</td>`; }

        mainBodyHtml = `<div class="block-avoid"><div class="section-title">SUMMARY</div><table class="data-table"><thead><tr><th>Payment Date</th>${Object.keys(catGroups).map(k => `<th style="text-align: right;">${escapeHtml_(k)} Total</th>`).join('')}<th style="text-align: right;">Total</th></tr></thead><tbody><tr><td>${escapeHtml_(dateStr)}</td>${summaryTrs}<td style="text-align: right; font-weight:bold;">₱ ${fmtMoney(grandTotalAmt)}</td></tr></tbody></table></div>`;

        for (const [cat, grp] of Object.entries(catGroups)) {
            mainBodyHtml += `<div class="block-avoid"><div class="section-title">${escapeHtml_(cat)} DETAILS</div><table class="data-table"><thead><tr><th style="width: 30%;">Contact / Dept</th><th style="width: 35%;">Remarks / Code</th><th style="width: 20%; text-align: right;">Net Pay</th><th style="width: 15%; text-align: center;">Manpower Count</th></tr></thead><tbody>${grp.html}<tr class="grand-total"><td colspan="2" style="text-align: right;">${escapeHtml_(cat)} Subtotal</td><td style="text-align: right;">₱ ${fmtMoney(grp.total)}</td><td style="text-align: center;">${grp.count}</td></tr></tbody></table></div>`;
        }
      } else if (h.VoucherType === 'CHECK') {
        const isMultiple = String(h.IsMultipleChecks).toUpperCase() === 'TRUE';
        if (isMultiple) {
            let detailsRowsHtml = '';
            lines.forEach(l => { 
                let chkDateStr = l.LineCheckDate;
                if (chkDateStr instanceof Date) chkDateStr = Utilities.formatDate(chkDateStr, Session.getScriptTimeZone(), "MM/dd/yyyy");
                else if (chkDateStr) { try { chkDateStr = Utilities.formatDate(new Date(chkDateStr), Session.getScriptTimeZone(), "MM/dd/yyyy"); } catch(e){} }
                detailsRowsHtml += `<tr><td>${escapeHtml_(l.LineCheckNumber || '')}</td><td>${escapeHtml_(chkDateStr || '')}</td><td>${escapeHtml_(l.Description || '')}</td><td style="text-align: right;">₱ ${fmtMoney(l.Amount)}</td></tr>`; 
            });
            mainBodyHtml = `<div class="block-avoid"><div class="section-title">PAYEE DETAILS</div><table class="data-table" style="margin-bottom:15px;"><tr><td style="width:15%; font-weight:bold;">Payee:</td><td style="width:35%; font-weight:bold;">${escapeHtml_(h.ContactSummary)}</td><td style="width:20%; font-weight:bold;">Total Amount:</td><td style="width:30%; font-weight:bold;">₱ ${fmtMoney(h.TotalAmount)}</td></tr></table></div><div class="block-avoid"><div class="section-title">CHECK DETAILS / SCHEDULE</div><table class="data-table"><thead><tr><th style="width: 20%;">Check No.</th><th style="width: 20%;">Check Date</th><th style="width: 40%;">Particulars</th><th style="width: 20%; text-align: right;">Amount</th></tr></thead><tbody>${detailsRowsHtml}<tr class="grand-total"><td colspan="3" style="text-align: right;">Grand Total</td><td style="text-align: right;">₱ ${fmtMoney(h.TotalAmount)}</td></tr></tbody></table></div>`;
        } else {
            let chkDateStr = h.CheckDate;
            if (chkDateStr instanceof Date) chkDateStr = Utilities.formatDate(chkDateStr, Session.getScriptTimeZone(), "MM/dd/yyyy");
            else if (chkDateStr) { try { chkDateStr = Utilities.formatDate(new Date(chkDateStr), Session.getScriptTimeZone(), "MM/dd/yyyy"); } catch(e){} }
            let detailsRowsHtml = '';
            lines.forEach(l => { detailsRowsHtml += `<tr><td>${escapeHtml_(l.Contact || l.Payee || '')}</td><td>${escapeHtml_(l.Description || '')}</td><td style="text-align: right;">₱ ${fmtMoney(l.Amount)}</td></tr>`; });
            mainBodyHtml = `<div class="block-avoid"><table class="data-table" style="margin-bottom:15px; border:2px solid #000;"><tr><td style="width:15%; font-weight:bold;">Payee:</td><td style="width:35%; font-weight:bold;">${escapeHtml_(h.ContactSummary)}</td><td style="width:20%; font-weight:bold;">Amount:</td><td style="width:30%; font-weight:bold;">₱ ${fmtMoney(h.TotalAmount)}</td></tr><tr><td style="width:15%; font-weight:bold;">Check No:</td><td style="width:35%; font-weight:bold;">${escapeHtml_(h.CheckNumber || '')}</td><td style="width:20%; font-weight:bold;">Check Date:</td><td style="width:30%; font-weight:bold;">${escapeHtml_(chkDateStr || '')}</td></tr></table></div><div class="block-avoid"><div class="section-title">PAYMENT DETAILS</div><table class="data-table"><thead><tr><th style="width: 30%;">Contact</th><th style="width: 45%;">Description</th><th style="width: 25%; text-align: right;">Amount to Pay</th></tr></thead><tbody>${detailsRowsHtml}<tr class="grand-total"><td colspan="2" style="text-align: right;">Grand Total</td><td style="text-align: right;">₱ ${fmtMoney(h.TotalAmount)}</td></tr></tbody></table></div>`;
        }
      } else {
        let detailsRowsHtml = '';
        lines.forEach(l => { detailsRowsHtml += `<tr><td>${escapeHtml_(l.Contact || l.Payee || '')}</td><td>${escapeHtml_(l.Description || '')}</td><td style="text-align: right;">₱ ${fmtMoney(l.Amount)}</td></tr>`; });
        mainBodyHtml = `<div class="block-avoid"><div class="section-title">PAYMENT DETAILS</div><table class="data-table"><thead><tr><th style="width: 30%;">Contact</th><th style="width: 45%;">Description</th><th style="width: 25%; text-align: right;">Amount to Pay</th></tr></thead><tbody>${detailsRowsHtml}<tr class="grand-total"><td colspan="2" style="text-align: right;">Grand Total</td><td style="text-align: right;">₱ ${fmtMoney(h.TotalAmount)}</td></tr></tbody></table></div>`;
      }

      let jeRowsHtml = ''; let totalDebit = 0; let totalCredit = 0; const jeMap = {};
      lines.forEach(l => { 
        const expCode = String(l.ExpenseAccountCode || '').trim(); const bankCode = String(l.LineBankCode || '').trim(); const amt = Number(l.Amount || 0); 
        if (expCode && amt > 0) { if (!jeMap[expCode]) jeMap[expCode] = { dr: 0, cr: 0 }; jeMap[expCode].dr += amt; totalDebit += amt; }
        if (['PAYROLL', 'FINAL_PAY', 'INCENTIVES'].includes(h.VoucherType) && bankCode && amt > 0) { if (!jeMap[bankCode]) jeMap[bankCode] = { dr: 0, cr: 0 }; jeMap[bankCode].cr += amt; totalCredit += amt; }
      });
      for (const [code, val] of Object.entries(jeMap)) { if (val.dr > 0) jeRowsHtml += `<tr><td style="font-weight:bold;">${getAccountName(code)}</td><td style="text-align: right;">₱ ${fmtMoney(val.dr)}</td><td style="text-align: right;">-</td></tr>`; }
      for (const [code, val] of Object.entries(jeMap)) { if (val.cr > 0) jeRowsHtml += `<tr><td style="padding-left: 20px;">${getAccountName(code)}</td><td style="text-align: right;">-</td><td style="text-align: right;">₱ ${fmtMoney(val.cr)}</td></tr>`; }
      
      if (h.VoucherType === 'CHECK' && totalDebit > 0) {
          const pdcName = "Post-Dated Checks Issued"; jeRowsHtml += `<tr><td style="padding-left: 20px;">${escapeHtml_(pdcName)}</td><td style="text-align: right;">-</td><td style="text-align: right; font-weight:bold;">₱ ${fmtMoney(totalDebit)}</td></tr>`; totalCredit += totalDebit; 
      } else if (!['PAYROLL', 'FINAL_PAY', 'INCENTIVES', 'CHECK'].includes(h.VoucherType) && totalDebit > 0) { 
          jeRowsHtml += `<tr><td style="padding-left: 20px;">${getAccountName(h.PaymentFromAccountCode)}</td><td style="text-align: right;">-</td><td style="text-align: right; font-weight:bold;">₱ ${fmtMoney(totalDebit)}</td></tr>`; totalCredit += totalDebit; 
      }

      const pageBreakStyle = (index < ids.length - 1) ? 'page-break-after: always;' : '';
      allPagesHtml += `<div style="${pageBreakStyle}"><div style="padding-bottom: 25px;"><table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 15px;"><tr><td style="width: 30%; vertical-align: middle; text-align: left; border:none;">${logoHtml}</td><td style="width: 40%; vertical-align: middle; text-align: center; border:none; font-weight: bold;"><div style="text-decoration: underline; text-transform: uppercase;">${displayTitle}</div></td><td style="width: 30%; vertical-align: middle; text-align: right; border:none;"><div style="margin-bottom: 4px;">Control No: ${escapeHtml_(h.VoucherId)}</div><div style="margin-bottom: 4px;">Date: ${escapeHtml_(dateStr)}</div>${['PAYROLL','FINAL_PAY','INCENTIVES'].includes(h.VoucherType) ? '' : `<div>Purpose: ${escapeHtml_(h.PurposeCategory)}</div>`}</td></tr></table>${mainBodyHtml}<div class="block-avoid"><div class="section-title">JOURNAL ENTRY</div><table class="data-table"><thead><tr><th style="width: 50%;">COA</th><th style="width: 25%; text-align: right;">Debit</th><th style="width: 25%; text-align: right;">Credit</th></tr></thead><tbody>${jeRowsHtml}<tr class="grand-total"><td style="text-align: right;">Total Debit / Credit</td><td style="text-align: right;">₱ ${fmtMoney(totalDebit)}</td><td style="text-align: right;">₱ ${fmtMoney(totalCredit)}</td></tr></tbody></table></div><div class="block-avoid" style="margin-top:30px;"><table class="signatures"><tr><td style="vertical-align: top;"><div class="sig-label">Prepared by</div></td><td style="vertical-align: top;"><div class="sig-label">Reviewed by</div></td><td style="vertical-align: top;"><div class="sig-label">Approved by</div></td><td style="vertical-align: top;"><div class="sig-label">Noted by</div></td></tr><tr><td class="sig-img-cell">${getSigHtml(h.CreatedBy, true)}</td><td class="sig-img-cell">${revSig}</td><td class="sig-img-cell">${appSig}</td><td class="sig-img-cell">${getSigHtml(notedName, true)}</td></tr><tr><td class="sig-name-cell"><div class="sig-line">${getPrintedName(h.CreatedBy)}</div></td><td class="sig-name-cell"><div class="sig-line">${revName}</div></td><td class="sig-name-cell"><div class="sig-line">${appName}</div></td><td class="sig-name-cell"><div class="sig-line">${notedName}</div></td></tr></table></div></div></div>`;
  });

  const htmlTemplate = `<html><head><style>@page { size: letter; margin: 0.5in; } body { font-family: 'Courier New', Courier, monospace; font-size: 11pt; color: #000; margin: 0; padding: 0; background: #fff; } .block-avoid { page-break-inside: avoid; margin-bottom: 20px; } .section-title { font-weight: bold; margin-top: 20px; margin-bottom: 8px; border-bottom: 1px dashed #000; text-transform:uppercase; padding-bottom: 3px; } .data-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-family: 'Courier New', Courier, monospace; } .data-table th, .data-table td { padding: 6px 8px; border: 1px solid #000; text-align: left; font-family: 'Courier New', Courier, monospace; color: #000; } .data-table th { font-weight:bold; text-align:center; border-bottom: 2px solid #000; text-transform: uppercase; } .grand-total td { font-weight: bold; border-top: 2px solid #000; } .signatures { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 40px; } .signatures td { padding-right: 15px; width: 25%; border: none; font-weight: bold; } .sig-label { color: #000; margin-bottom: 15px; text-align: left; font-weight: bold; } .sig-img-cell { height: 40px; vertical-align: bottom; text-align: center; } .sig-name-cell { vertical-align: top; } .sig-line { border-top: 1px solid #000; padding-top: 4px; font-weight: bold; text-transform: uppercase; text-align: center; }</style></head><body>${allPagesHtml}</body></html>`;
  try { const blob = Utilities.newBlob(htmlTemplate, MimeType.HTML).getAs(MimeType.PDF); blob.setName(ids.length > 1 ? `Bulk_Vouchers.pdf` : `Voucher_${ids[0]}.pdf`); return Utilities.base64Encode(blob.getBytes()); } catch (err) { throw new Error("PDF Converter Error (HTML Parser): " + err.message); }
}

// ---------------------------------------------------------------------------
// MASTER DISBURSEMENT REPORT — CRUD
// ---------------------------------------------------------------------------

function createDisbursementReport(payload) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const user = getActionUser_(); const now = new Date();
    const reportId = generateVoucherId_('DISB');

    // Write report row
    const repSheet = getTargetSheet_('DisbursementReports');
    const repHeaders = ensureDisbursementReportsHeaders_(repSheet);
    const totalAmt = (payload.lines || []).reduce((s, l) => s + Number(l.amount || 0), 0);
    const repRow = new Array(repHeaders.length).fill('');
    repRow[repHeaders.indexOf('ReportId')]          = reportId;
    repRow[repHeaders.indexOf('Date')]              = payload.date ? new Date(payload.date) : now;
    repRow[repHeaders.indexOf('BankCode')]          = 'MULTIPLE';
    repRow[repHeaders.indexOf('TotalAmount')]       = totalAmt;
    repRow[repHeaders.indexOf('CreatedAt')]         = now;
    repRow[repHeaders.indexOf('CreatedBy')]         = user;
    repRow[repHeaders.indexOf('BankBalances')]      = payload.bankBalances || '{}';
    repRow[repHeaders.indexOf('ExpectedCollection')]= Number(payload.expectedCollection || 0);
    if (repHeaders.indexOf('Status') > -1) repRow[repHeaders.indexOf('Status')] = 'Draft';
    repSheet.appendRow(repRow);

    // Write disbursement lines
    const lineSheet = getTargetSheet_('DisbursementLines');
    const lineHeaders = ensureDisbursementLinesHeaders_(lineSheet);
    const lineRows = (payload.lines || []).map(l => {
      const row = new Array(lineHeaders.length).fill('');
      row[lineHeaders.indexOf('ReportId')]     = reportId;
      row[lineHeaders.indexOf('VoucherId')]    = l.voucherId;
      row[lineHeaders.indexOf('LineNo')]       = l.lineNo || '';
      row[lineHeaders.indexOf('CheckNumber')]  = l.checkNo || '';
      row[lineHeaders.indexOf('BankReference')]= l.refNo || '';
      row[lineHeaders.indexOf('Amount')]       = Number(l.amount || 0);
      row[lineHeaders.indexOf('Status')]       = 'In Disbursement';
      row[lineHeaders.indexOf('BankCode')]     = l.bankCode || '';
      row[lineHeaders.indexOf('CreatedAt')]    = now;
      row[lineHeaders.indexOf('CreatedBy')]    = user;
      return row;
    });
    if (lineRows.length > 0) lineSheet.getRange(lineSheet.getLastRow() + 1, 1, lineRows.length, lineHeaders.length).setValues(lineRows);

    // Mark vouchers as 'In Disbursement' and save their pre-disbursement status
    const vSheet = getTargetSheet_('Vouchers');
    const vData = vSheet.getDataRange().getValues(); const vH = vData[0];
    const viIdx = vH.indexOf('VoucherId'); const vsIdx = vH.indexOf('Status');
    const vpIdx = vH.indexOf('PreDisbursementStatus'); const vdIdx = vH.indexOf('DisbursementRef');
    const voucherIds = [...new Set((payload.lines || []).map(l => String(l.voucherId)))];
    voucherIds.forEach(vid => {
      for (let i = 1; i < vData.length; i++) {
        if (String(vData[i][viIdx]) === vid) {
          if (vpIdx > -1 && !vData[i][vpIdx]) vSheet.getRange(i + 1, vpIdx + 1).setValue(String(vData[i][vsIdx] || ''));
          if (vsIdx > -1) vSheet.getRange(i + 1, vsIdx + 1).setValue('In Disbursement');
          if (vdIdx > -1) vSheet.getRange(i + 1, vdIdx + 1).setValue(reportId);
          break;
        }
      }
    });

    return sanitizeData_({ reportId: reportId });
  } finally { lock.releaseLock(); }
}

function updateDisbursementReport(payload) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const user = getActionUser_(); const now = new Date();
    const reportId = String(payload.reportId);

    // Update report header row
    const repSheet = getTargetSheet_('DisbursementReports');
    const repData = repSheet.getDataRange().getValues(); const repH = repData[0];
    const repIdIdx = repH.indexOf('ReportId'); let repRowNum = -1;
    for (let i = 1; i < repData.length; i++) { if (String(repData[i][repIdIdx]) === reportId) { repRowNum = i + 1; break; } }
    if (repRowNum === -1) throw new Error('Disbursement report not found: ' + reportId);
    const totalAmt = (payload.lines || []).reduce((s, l) => s + Number(l.amount || 0), 0);
    repSheet.getRange(repRowNum, repH.indexOf('Date') + 1).setValue(payload.date ? new Date(payload.date) : now);
    repSheet.getRange(repRowNum, repH.indexOf('TotalAmount') + 1).setValue(totalAmt);
    repSheet.getRange(repRowNum, repH.indexOf('BankBalances') + 1).setValue(payload.bankBalances || '{}');
    repSheet.getRange(repRowNum, repH.indexOf('ExpectedCollection') + 1).setValue(Number(payload.expectedCollection || 0));

    // Read existing lines to know which vouchers to revert if removed
    const lineSheet = getTargetSheet_('DisbursementLines');
    const lineData = lineSheet.getDataRange().getValues(); const lineH = lineData[0];
    const lRepIdx = lineH.indexOf('ReportId'); const lVidIdx = lineH.indexOf('VoucherId');
    const oldVoucherIds = new Set();
    for (let i = 1; i < lineData.length; i++) { if (String(lineData[i][lRepIdx]) === reportId) oldVoucherIds.add(String(lineData[i][lVidIdx])); }

    // Delete old lines (iterate backwards to preserve row indices)
    for (let i = lineData.length - 1; i >= 1; i--) { if (String(lineData[i][lRepIdx]) === reportId) lineSheet.deleteRow(i + 1); }

    // Write new lines
    const freshLineH = ensureDisbursementLinesHeaders_(lineSheet);
    const lineRows = (payload.lines || []).map(l => {
      const row = new Array(freshLineH.length).fill('');
      row[freshLineH.indexOf('ReportId')]     = reportId;
      row[freshLineH.indexOf('VoucherId')]    = l.voucherId;
      row[freshLineH.indexOf('LineNo')]       = l.lineNo || '';
      row[freshLineH.indexOf('CheckNumber')]  = l.checkNo || '';
      row[freshLineH.indexOf('BankReference')]= l.refNo || '';
      row[freshLineH.indexOf('Amount')]       = Number(l.amount || 0);
      row[freshLineH.indexOf('Status')]       = 'In Disbursement';
      row[freshLineH.indexOf('BankCode')]     = l.bankCode || '';
      row[freshLineH.indexOf('CreatedAt')]    = now;
      row[freshLineH.indexOf('CreatedBy')]    = user;
      return row;
    });
    if (lineRows.length > 0) lineSheet.getRange(lineSheet.getLastRow() + 1, 1, lineRows.length, freshLineH.length).setValues(lineRows);

    // Update voucher statuses: revert removed, mark new as 'In Disbursement'
    const newVoucherIds = new Set((payload.lines || []).map(l => String(l.voucherId)));
    const vSheet = getTargetSheet_('Vouchers');
    const vData = vSheet.getDataRange().getValues(); const vH = vData[0];
    const viIdx = vH.indexOf('VoucherId'); const vsIdx = vH.indexOf('Status');
    const vpIdx = vH.indexOf('PreDisbursementStatus'); const vdIdx = vH.indexOf('DisbursementRef');
    for (let i = 1; i < vData.length; i++) {
      const vid = String(vData[i][viIdx]);
      if (oldVoucherIds.has(vid) && !newVoucherIds.has(vid)) {
        const prev = vpIdx > -1 ? String(vData[i][vpIdx] || 'Approved') : 'Approved';
        if (vsIdx > -1) vSheet.getRange(i + 1, vsIdx + 1).setValue(prev);
        if (vdIdx > -1) vSheet.getRange(i + 1, vdIdx + 1).setValue('');
        if (vpIdx > -1) vSheet.getRange(i + 1, vpIdx + 1).setValue('');
      } else if (newVoucherIds.has(vid)) {
        if (vpIdx > -1 && !vData[i][vpIdx]) vSheet.getRange(i + 1, vpIdx + 1).setValue(String(vData[i][vsIdx] || ''));
        if (vsIdx > -1) vSheet.getRange(i + 1, vsIdx + 1).setValue('In Disbursement');
        if (vdIdx > -1) vSheet.getRange(i + 1, vdIdx + 1).setValue(reportId);
      }
    }

    return sanitizeData_({ reportId: reportId });
  } finally { lock.releaseLock(); }
}

function submitDisbursementForApproval(reportId) {
  const repSheet = getTargetSheet_('DisbursementReports');
  const repHeaders = ensureDisbursementReportsHeaders_(repSheet);
  const repData = repSheet.getDataRange().getValues();
  const reviewerEmails = getRoleEmails_('REVIEWER');
  const approverEmails = getRoleEmails_('APPROVER');
  let targetEmails = []; let nextStatus = '';
  if (reviewerEmails.length > 0) { targetEmails = reviewerEmails; nextStatus = 'Pending Review'; }
  else if (approverEmails.length > 0) { targetEmails = approverEmails; nextStatus = 'Pending Approval'; }
  else { throw new Error('No Reviewer or Approver configured in Users sheet.'); }
  let found = false;
  for (let i = 1; i < repData.length; i++) {
    if (String(repData[i][0]).trim() === String(reportId).trim()) {
      const current = String(repData[i][repHeaders.indexOf('Status')] || '').trim();
      if (current === 'Approved' || current === 'Pending Review' || current === 'Pending Approval') throw new Error('Report is already ' + current + '.');
      repSheet.getRange(i + 1, repHeaders.indexOf('Status') + 1).setValue(nextStatus);
      if (repHeaders.includes('RejectReason')) repSheet.getRange(i + 1, repHeaders.indexOf('RejectReason') + 1).setValue('');
      found = true; break;
    }
  }
  if (!found) throw new Error('Report not found: ' + reportId);
  if (targetEmails.length > 0) {
    const url = ScriptApp.getService().getUrl() + '?view=approvals';
    const body = `<div style="font-family:Arial,sans-serif;padding:30px;background-color:#f4f4f4;"><div style="max-width:500px;margin:0 auto;background:#fff;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center;"><h2 style="color:#188038;margin-top:0;">Action Required</h2><p style="color:#555;font-size:16px;">Master Disbursement Report <b>${reportId}</b> is awaiting your review/approval.</p><br><a href="${url}" style="display:inline-block;background:#188038;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;">Open Approval Dashboard</a></div></div>`;
    MailApp.sendEmail({ to: targetEmails.join(','), subject: `ACTION REQUIRED: Disbursement Report ${reportId} for Approval`, htmlBody: body });
  }
  return true;
}

function processDisbursementApprovals(payload) {
  const { reportIds, action, reason } = payload;
  if (!reportIds || reportIds.length === 0) return false;
  const email = Session.getActiveUser().getEmail();
  const repSheet = getTargetSheet_('DisbursementReports');
  const repHeaders = ensureDisbursementReportsHeaders_(repSheet);
  const repData = repSheet.getDataRange().getValues();

  // Load lines and vouchers once for efficiency
  const lineSheet = getTargetSheet_('DisbursementLines');
  const lineData = lineSheet.getDataRange().getValues(); const lineH = lineData[0];
  const lRepIdx = lineH.indexOf('ReportId'); const lVidIdx = lineH.indexOf('VoucherId'); const lStIdx = lineH.indexOf('Status');
  const vSheet = getTargetSheet_('Vouchers');
  const vData = vSheet.getDataRange().getValues(); const vH = vData[0];
  const viIdx = vH.indexOf('VoucherId'); const vsIdx = vH.indexOf('Status');
  const vpIdx = vH.indexOf('PreDisbursementStatus'); const vdIdx = vH.indexOf('DisbursementRef');

  let toApproverCount = 0;
  const webAppUrl = ScriptApp.getService().getUrl();
  for (let i = 1; i < repData.length; i++) {
    const rId = String(repData[i][0]).trim();
    if (!reportIds.includes(rId)) continue;
    const currentStatus = String(repData[i][repHeaders.indexOf('Status')] || '').trim();
    const createdBy = String(repData[i][repHeaders.indexOf('CreatedBy')] || '').trim();
    if (action === 'approve') {
      if (currentStatus === 'Pending Review') {
        repSheet.getRange(i + 1, repHeaders.indexOf('Status') + 1).setValue('Pending Approval');
        repSheet.getRange(i + 1, repHeaders.indexOf('ReviewedBy') + 1).setValue(email);
        toApproverCount++;
      } else if (currentStatus === 'Pending Approval') {
        repSheet.getRange(i + 1, repHeaders.indexOf('Status') + 1).setValue('Approved');
        repSheet.getRange(i + 1, repHeaders.indexOf('ApprovedBy') + 1).setValue(email);
        // Mark all linked voucher lines and vouchers as Paid
        const voucherIdsToMark = new Set();
        const vTypeIdx = vHeaders.indexOf('VoucherType');
        for (let j = 1; j < lineData.length; j++) {
          if (String(lineData[j][lRepIdx]) === rId) {
            if (lStIdx > -1) lineSheet.getRange(j + 1, lStIdx + 1).setValue('Paid');
            voucherIdsToMark.add(String(lineData[j][lVidIdx]));
          }
        }
        for (let j = 1; j < vData.length; j++) {
          if (voucherIdsToMark.has(String(vData[j][viIdx]))) {
            if (vsIdx > -1) vSheet.getRange(j + 1, vsIdx + 1).setValue('Paid');
            // If this is an INCENTIVES voucher, update the incentive status
            try {
              const vType = String(vData[j][vTypeIdx] || '').trim();
              if (vType === 'INCENTIVES') {
                updateIncentiveStatusWhenVoucherPaid_(String(vData[j][viIdx]));
              } else if (vType === 'PAYROLL') {
                // Revert employee salarystatus to 'Active' when payroll is bulk-disbursed
                // Guard inside revertEmployeeStatusToActive_: only 'For Release*' statuses are reverted
                revertEmployeeStatusToActive_(String(vData[j][viIdx]), vType);
                // FINAL_PAY: handled exclusively by notifyFinalPayDisbursed() via updateVoucherStatus
              }
            } catch(e) { Logger.log('Error updating employee status: ' + e.message); }
          }
        }
      }
    } else if (action === 'reject') {
      repSheet.getRange(i + 1, repHeaders.indexOf('Status') + 1).setValue('Rejected');
      repSheet.getRange(i + 1, repHeaders.indexOf('RejectReason') + 1).setValue(reason || 'No reason provided');
      // Revert all linked vouchers to their pre-disbursement status
      const voucherIdsToRevert = new Set();
      for (let j = 1; j < lineData.length; j++) {
        if (String(lineData[j][lRepIdx]) === rId) voucherIdsToRevert.add(String(lineData[j][lVidIdx]));
      }
      for (let j = 1; j < vData.length; j++) {
        if (voucherIdsToRevert.has(String(vData[j][viIdx]))) {
          const prev = vpIdx > -1 ? String(vData[j][vpIdx] || 'Approved') : 'Approved';
          if (vsIdx > -1) vSheet.getRange(j + 1, vsIdx + 1).setValue(prev);
          if (vdIdx > -1) vSheet.getRange(j + 1, vdIdx + 1).setValue('');
        }
      }
      if (createdBy) {
        const body = `<div style="font-family:Arial,sans-serif;padding:30px;background-color:#f4f4f4;"><div style="max-width:500px;margin:0 auto;background:#fff;border-top:4px solid #d93025;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);"><h2 style="color:#d93025;margin-top:0;">Disbursement Report Returned</h2><p style="color:#555;">Report <b>${rId}</b> has been returned for correction.</p><div style="background:#fff3cd;padding:15px;border-left:4px solid #856404;margin:20px 0;"><p style="margin:0;color:#856404;"><b>Reason:</b> ${escapeHtml_(reason || '')}</p></div><div style="text-align:center;"><a href="${webAppUrl}" style="display:inline-block;background:#0b1220;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;">Open Dashboard</a></div></div></div>`;
        MailApp.sendEmail({ to: getEmailByDisplayName_(createdBy) || createdBy, subject: `REJECTED: Disbursement Report ${rId} returned for correction`, htmlBody: body });
      }
    }
  }
  if (toApproverCount > 0) {
    const approverEmails = getRoleEmails_('APPROVER');
    if (approverEmails.length > 0) {
      const url = webAppUrl + '?view=approvals';
      const body = `<div style="font-family:Arial,sans-serif;padding:30px;background-color:#f4f4f4;"><div style="max-width:500px;margin:0 auto;background:#fff;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center;"><h2 style="color:#188038;margin-top:0;">Final Approval Required</h2><p style="color:#555;font-size:16px;">You have <b>${toApproverCount}</b> Disbursement Report(s) that require your final approval.</p><br><a href="${url}" style="display:inline-block;background:#188038;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;">Open Approval Dashboard</a></div></div>`;
      MailApp.sendEmail({ to: approverEmails.join(','), subject: `FINAL APPROVAL REQUIRED: ${toApproverCount} Disbursement Report(s)`, htmlBody: body });
    }
  }
  return true;
}

function removeDisbursementLine(reportId, voucherId) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const rId = String(reportId); const vId = String(voucherId);
    // Delete matching line(s) — multi-line vouchers (PAYROLL) may have several
    const lineSheet = getTargetSheet_('DisbursementLines');
    const lineData = lineSheet.getDataRange().getValues(); const lineH = lineData[0];
    const lRepIdx = lineH.indexOf('ReportId'); const lVidIdx = lineH.indexOf('VoucherId'); const lAmtIdx = lineH.indexOf('Amount');
    let removedAmt = 0;
    for (let i = lineData.length - 1; i >= 1; i--) {
      if (String(lineData[i][lRepIdx]) === rId && String(lineData[i][lVidIdx]) === vId) {
        removedAmt += Number(lineData[i][lAmtIdx] || 0);
        lineSheet.deleteRow(i + 1);
      }
    }
    // Revert voucher status
    const vSheet = getTargetSheet_('Vouchers');
    const vData = vSheet.getDataRange().getValues(); const vH = vData[0];
    const viIdx = vH.indexOf('VoucherId'); const vsIdx = vH.indexOf('Status');
    const vpIdx = vH.indexOf('PreDisbursementStatus'); const vdIdx = vH.indexOf('DisbursementRef');
    for (let i = 1; i < vData.length; i++) {
      if (String(vData[i][viIdx]) === vId) {
        const prev = vpIdx > -1 ? String(vData[i][vpIdx] || 'Approved') : 'Approved';
        if (vsIdx > -1) vSheet.getRange(i + 1, vsIdx + 1).setValue(prev);
        if (vdIdx > -1) vSheet.getRange(i + 1, vdIdx + 1).setValue('');
        if (vpIdx > -1) vSheet.getRange(i + 1, vpIdx + 1).setValue('');
        break;
      }
    }
    // Recompute report total
    const freshLines = lineSheet.getDataRange().getValues(); const freshH = freshLines[0];
    const frRep = freshH.indexOf('ReportId'); const frAmt = freshH.indexOf('Amount');
    let newTotal = 0;
    for (let i = 1; i < freshLines.length; i++) { if (String(freshLines[i][frRep]) === rId) newTotal += Number(freshLines[i][frAmt] || 0); }
    const repSheet = getTargetSheet_('DisbursementReports');
    const repData = repSheet.getDataRange().getValues(); const repH = repData[0];
    for (let i = 1; i < repData.length; i++) { if (String(repData[i][0]) === rId) { repSheet.getRange(i + 1, repH.indexOf('TotalAmount') + 1).setValue(newTotal); break; } }
    return sanitizeData_({ ok: true, newTotal });
  } finally { lock.releaseLock(); }
}

function deleteDisbursementReport(id) {
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const reportId = String(id);

    // Collect voucher IDs from lines before deleting
    const lineSheet = getTargetSheet_('DisbursementLines');
    const lineData = lineSheet.getDataRange().getValues(); const lineH = lineData[0];
    const lRepIdx = lineH.indexOf('ReportId'); const lVidIdx = lineH.indexOf('VoucherId');
    const voucherIds = new Set();
    for (let i = 1; i < lineData.length; i++) { if (String(lineData[i][lRepIdx]) === reportId) voucherIds.add(String(lineData[i][lVidIdx])); }

    // Delete disbursement lines
    for (let i = lineData.length - 1; i >= 1; i--) { if (String(lineData[i][lRepIdx]) === reportId) lineSheet.deleteRow(i + 1); }

    // Delete report row
    const repSheet = getTargetSheet_('DisbursementReports');
    const repData = repSheet.getDataRange().getValues(); const repH = repData[0];
    const repIdIdx = repH.indexOf('ReportId');
    for (let i = repData.length - 1; i >= 1; i--) { if (String(repData[i][repIdIdx]) === reportId) { repSheet.deleteRow(i + 1); break; } }

    // Revert voucher statuses
    if (voucherIds.size > 0) {
      const vSheet = getTargetSheet_('Vouchers');
      const vData = vSheet.getDataRange().getValues(); const vH = vData[0];
      const viIdx = vH.indexOf('VoucherId'); const vsIdx = vH.indexOf('Status');
      const vpIdx = vH.indexOf('PreDisbursementStatus'); const vdIdx = vH.indexOf('DisbursementRef');
      for (let i = 1; i < vData.length; i++) {
        if (voucherIds.has(String(vData[i][viIdx]))) {
          const prev = vpIdx > -1 ? String(vData[i][vpIdx] || 'Approved') : 'Approved';
          if (vsIdx > -1) vSheet.getRange(i + 1, vsIdx + 1).setValue(prev);
          if (vdIdx > -1) vSheet.getRange(i + 1, vdIdx + 1).setValue('');
        }
      }
    }

    return sanitizeData_({ ok: true });
  } finally { lock.releaseLock(); }
}

function getDisbursementReportPdfBase64(reportId) {
  const dData = getSheetData_('DisbursementReports').find(r => String(r.ReportId).trim() === String(reportId).trim());
  if (!dData) throw new Error("Report not found");
  const dlData = getSheetData_('DisbursementLines').filter(r => String(r.ReportId).trim() === String(reportId).trim());
  const vData = getSheetData_('Vouchers'); const vlData = getSheetData_('VoucherLines');
  const accountsData = getCentralAccountsData_();
  const getAccountName = (code) => { const c = String(code).trim(); const m = accountsData.find(a => String(a['Account Code']).trim() === c); return escapeHtml_(m ? m['Account Name'] : (c === 'UNASSIGNED' ? 'Unassigned Bank' : c)); };
  const fmtMoney = (n) => Number(n || 0).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const fmtDate = (d) => { try { const dt = new Date(d); return isNaN(dt.getTime()) ? d : Utilities.formatDate(dt, Session.getScriptTimeZone(), "MMMM dd, yyyy"); } catch(e) { return escapeHtml_(d); }};

  // --- Group disbursement lines by bank ---
  const bankGroups = {}; const lateGroups = {};
  const getGroup = (groupObj, bCode) => { const code = bCode || 'UNASSIGNED'; if (!groupObj[code]) groupObj[code] = { name: getAccountName(code), items: [], total: 0 }; return groupObj[code]; };

  dlData.forEach(row => {
    const vHead = vData.find(v => String(v.VoucherId) === String(row.VoucherId)) || {};
    let isLate = false;
    if (vHead.PreparationDate && dData.Date) {
      const d1 = new Date(vHead.PreparationDate); const d2 = new Date(dData.Date);
      if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
        if (d1.toDateString() !== d2.toDateString()) isLate = true;
      }
    }
    let payee = escapeHtml_(vHead.ContactSummary || ''); let desc = escapeHtml_(vHead.PurposeCategory || ''); let vidDisplay = escapeHtml_(row.VoucherId);
    if (row.LineNo) {
      const vlRow = vlData.find(l => String(l.VoucherId) === String(row.VoucherId) && String(l.LineNo) === String(row.LineNo));
      if (vlRow) { payee = escapeHtml_(vlRow.Contact || payee); desc = escapeHtml_(vlRow.Description || 'Line Item'); }
      vidDisplay = `${escapeHtml_(row.VoucherId)}<br><span style="font-size:7.5pt;color:#888;">Line ${escapeHtml_(row.LineNo)}</span>`;
    }
    const amt = Number(row.Amount || 0);
    const grp = isLate ? getGroup(lateGroups, row.BankCode) : getGroup(bankGroups, row.BankCode);
    grp.items.push({ vid: vidDisplay, payee, desc, check: escapeHtml_(row.CheckNumber || ''), ref: escapeHtml_(row.BankReference || ''), amt });
    grp.total += amt;
  });

  // --- Build disbursement section blocks ---
  const renderDisbTable = (grp) => {
    let rows = '';
    grp.items.forEach((item) => {
      rows += `<tr>
        <td style="font-family:'Courier New',monospace;">${item.vid}</td>
        <td>${item.payee}</td>
        <td>${item.desc}</td>
        <td style="text-align:center;">${item.check}</td>
        <td style="text-align:center;">${item.ref}</td>
        <td style="text-align:right;font-family:'Courier New',monospace;white-space:nowrap;">&#8369; ${fmtMoney(item.amt)}</td>
      </tr>`;
    });
    rows += `<tr class="grand-total">
      <td colspan="5" style="text-align:right;">Subtotal</td>
      <td style="text-align:right;font-family:'Courier New',monospace;white-space:nowrap;">&#8369; ${fmtMoney(grp.total)}</td>
    </tr>`;
    return `<table class="data-table">
      <thead><tr>
        <th style="width:14%;text-align:left;">VOUCHER NO.</th>
        <th style="width:24%;text-align:left;">PAYEE</th>
        <th style="width:28%;text-align:left;">DESCRIPTION</th>
        <th style="width:12%;">CHECK NO.</th>
        <th style="width:10%;">REF NO.</th>
        <th style="width:12%;text-align:right;">AMOUNT</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  };

  let htmlBlocks = ''; let grandTotal = 0;
  for (const [, grp] of Object.entries(bankGroups)) {
    if (!grp.items.length) continue; grandTotal += grp.total;
    htmlBlocks += `<div style="page-break-inside:avoid;margin-bottom:12px;">
      <div class="status-header">Disbursements From: ${grp.name}</div>
      ${renderDisbTable(grp)}
      <div style="text-align:right;font-weight:bold;padding:2px 0 4px;">Total for ${grp.name}: &nbsp; &#8369; ${fmtMoney(grp.total)}</div>
    </div>`;
  }

  if (Object.keys(lateGroups).length > 0) {
    htmlBlocks += `<div style="page-break-inside:avoid;margin-bottom:12px;">
      <div class="status-header">&#9654; For Late Approvals</div>`;
    for (const [, grp] of Object.entries(lateGroups)) {
      if (!grp.items.length) continue; grandTotal += grp.total;
      htmlBlocks += `<div style="margin-top:10px;">
        <div style="font-weight:bold;padding:3px 0;border-bottom:1px solid #555;">From: ${grp.name}</div>
        ${renderDisbTable(grp)}
      </div>`;
    }
    htmlBlocks += `</div>`;
  }

  if (!htmlBlocks) htmlBlocks = `<div style="padding:20px;text-align:center;border:1px solid #000;font-weight:bold;">No disbursement vouchers in this report.</div>`;

  // --- Bank Account Balances — vertical 4-column table ---
  let savedBals = {}; let totalCurrentBal = 0; let totalDisbBal = 0;
  try { savedBals = JSON.parse(dData.BankBalances || '{}'); } catch(e) {}
  const bankAccounts = accountsData.filter(a => String(a['Account Type']).toLowerCase().includes('bank'));
  let balRows = '';
  bankAccounts.forEach((a, idx) => {
    const bCode = a['Account Code'];
    const dispName = escapeHtml_(a['Account Name'] || bCode);
    const currentBal = Number(savedBals[bCode] !== undefined ? savedBals[bCode] : 0);
    const disbAmt = (bankGroups[bCode] ? bankGroups[bCode].total : 0) + (lateGroups[bCode] ? lateGroups[bCode].total : 0);
    const afterBal = currentBal - disbAmt;
    totalCurrentBal += currentBal; totalDisbBal += disbAmt;
    const disbCell = disbAmt > 0
      ? `<td style="text-align:right;color:#c00;font-family:'Courier New',monospace;white-space:nowrap;">(&#8369; ${fmtMoney(disbAmt)})</td>`
      : `<td style="text-align:center;color:#aaa;">—</td>`;
    balRows += `<tr>
      <td>${dispName}</td>
      <td style="text-align:right;font-family:'Courier New',monospace;white-space:nowrap;">&#8369; ${fmtMoney(currentBal)}</td>
      ${disbCell}
      <td style="text-align:right;font-family:'Courier New',monospace;white-space:nowrap;">&#8369; ${fmtMoney(afterBal)}</td>
    </tr>`;
  });
  const totalAfterBal = totalCurrentBal - totalDisbBal;
  balRows += `<tr class="grand-total">
    <td>TOTAL</td>
    <td style="text-align:right;font-family:'Courier New',monospace;white-space:nowrap;">&#8369; ${fmtMoney(totalCurrentBal)}</td>
    <td style="text-align:right;color:#c00;font-family:'Courier New',monospace;white-space:nowrap;">${totalDisbBal > 0 ? '(&#8369; ' + fmtMoney(totalDisbBal) + ')' : '—'}</td>
    <td style="text-align:right;font-family:'Courier New',monospace;white-space:nowrap;">&#8369; ${fmtMoney(totalAfterBal)}</td>
  </tr>`;
  const bankBalsTable = bankAccounts.length > 0
    ? `<table class="data-table">
        <thead><tr>
          <th style="width:40%;text-align:left;">BANK ACCOUNT</th>
          <th style="width:20%;text-align:right;">CURRENT BALANCE</th>
          <th style="width:20%;text-align:right;">LESS: DISBURSEMENTS</th>
          <th style="width:20%;text-align:right;">BALANCE AFTER</th>
        </tr></thead>
        <tbody>${balRows}</tbody>
      </table>`
    : `<div style="padding:10px;color:#888;">No bank accounts configured.</div>`;

  // --- Summary box ---
  const expectedCol = Number(dData.ExpectedCollection || 0);
  const finalBal = totalAfterBal + expectedCol;
  const summaryHtml = `<div style="border:1px solid #000;min-width:220px;font-size:9px;">
    <div style="background:#f0f0f0;font-weight:bold;padding:4px 8px;text-transform:uppercase;font-size:9px;border-bottom:1px solid #000;">SUMMARY</div>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:3px 8px;border-bottom:1px solid #ccc;">Total Bank Balance (Before)</td><td style="padding:3px 8px;text-align:right;font-family:'Courier New',monospace;border-bottom:1px solid #ccc;white-space:nowrap;">&#8369; ${fmtMoney(totalCurrentBal)}</td></tr>
      <tr><td style="padding:3px 8px;border-bottom:1px solid #ccc;">Less: Total Disbursements</td><td style="padding:3px 8px;text-align:right;font-family:'Courier New',monospace;color:#c00;border-bottom:1px solid #ccc;white-space:nowrap;">(&#8369; ${fmtMoney(grandTotal)})</td></tr>
      <tr><td style="padding:3px 8px;border-bottom:1px solid #ccc;">Add: Expected Collection</td><td style="padding:3px 8px;text-align:right;font-family:'Courier New',monospace;color:#167a1f;border-bottom:1px solid #ccc;white-space:nowrap;">&#8369; ${fmtMoney(expectedCol)}</td></tr>
      <tr class="grand-total"><td style="padding:4px 8px;font-weight:bold;border-top:1.5px solid #000;border-bottom:3px double #000;">Bank Balance After</td><td style="padding:4px 8px;text-align:right;font-family:'Courier New',monospace;white-space:nowrap;font-weight:bold;border-top:1.5px solid #000;border-bottom:3px double #000;">&#8369; ${fmtMoney(finalBal)}</td></tr>
    </table>
  </div>`;

  // --- Signatures & metadata ---
  const s = {};
  getCentralSheetData_('Modules').forEach(row => { if (row.Key) s[row.Key] = row.Value; });
  getCentralSheetData_('Sequence').forEach(row => { if (row.Key) s[row.Key] = row.Value; });
  const revName = escapeHtml_(s['REVIEWER_NAME'] || ''); const appName = escapeHtml_(s['APPROVER_NAME'] || ''); const notedName = escapeHtml_(s['NOTED_BY_NAME'] || '');
  let logoHtml = `<div style="font-weight:bold;font-size:11pt;">WORKSCALE RESOURCES INC.</div>`;
  try { const b64 = fetchImageBase64_(s['LETTERHEAD_LINK'] || "1hTAv6ofNi9676XN_rR_eSTgFv91wpNYt"); if (b64) logoHtml = `<img src="${b64}" style="max-height:60px;max-width:180px;object-fit:contain;" />`; } catch(e) {}

  const sigRow = (label, name) => `<td style="padding-right:20px;border:none;width:25%;vertical-align:top;">
    <div style="font-size:8px;color:#555;margin-bottom:28px;">${label}</div>
    <div style="border-top:1px solid #000;padding-top:4px;font-weight:bold;text-transform:uppercase;text-align:center;font-size:8px;">${name}</div>
  </td>`;

  const htmlTemplate = `<html><head><style>
    @page { size: letter landscape; margin: 0.5in; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #000; margin: 0; padding: 0; background: #fff; }
    .section-title { background-color: #f0f0f0; padding: 4px 6px; font-weight: bold; font-size: 9px; margin-top: 15px; border: 1px solid #000; text-transform: uppercase; }
    .data-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 9px; table-layout: fixed; }
    .data-table th, .data-table td { padding: 3px 5px; border: 1px solid #000; text-align: left; overflow: hidden; text-overflow: ellipsis; }
    .data-table th { background-color: #e2e8f0; font-weight: bold; text-align: center; }
    .grand-total td { font-weight: bold; background-color: #f8fafc; }
    .status-header { font-size: 9px; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 4px; text-transform: uppercase; margin-top: 14px; margin-bottom: 4px; }
    .block-avoid { page-break-inside: avoid; }
  </style></head><body>

  <!-- Header -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:15px;border-bottom:2px solid #000;padding-bottom:10px;">
    <tr>
      <td style="width:60%;vertical-align:middle;text-align:left;border:none;">${logoHtml}
        <div style="font-size:14px;font-weight:bold;text-decoration:underline;text-transform:uppercase;margin-top:4px;">MASTER DISBURSEMENT REPORT</div>
        <div style="font-size:9px;margin-top:3px;color:#555;">${escapeHtml_(fmtDate(dData.Date))}</div>
      </td>
      <td style="width:40%;vertical-align:middle;text-align:right;font-size:9px;border:none;">
        <div style="margin-bottom:3px;"><span style="color:#555;font-weight:bold;margin-right:5px;">Report No:</span><span style="font-weight:bold;">${escapeHtml_(reportId)}</span></div>
        <div><span style="color:#555;font-weight:bold;margin-right:5px;">Generated:</span><span>${escapeHtml_(fmtDate(dData.Date))}</span></div>
      </td>
    </tr>
  </table>

  <!-- Section 1: Bank Account Balances -->
  <div style="margin-bottom:20px;">
    <div class="section-title" style="margin-top:0;">1. BANK ACCOUNT BALANCES</div>
    ${bankBalsTable}
  </div>

  <!-- Section 2: Disbursements -->
  <div class="section-title">2. DISBURSEMENTS</div>
  ${htmlBlocks}

  <!-- Bottom: Signatures | Summary -->
  <div class="block-avoid" style="margin-top:20px;display:flex;justify-content:space-between;align-items:flex-end;gap:30px;">
    <div style="flex:1;">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
        <tr>
          ${sigRow('Prepared by', escapeHtml_(dData.CreatedBy))}
          ${sigRow('Reviewed by', revName)}
          ${sigRow('Approved by', appName)}
          ${sigRow('Noted by', notedName)}
        </tr>
      </table>
    </div>
    <div>${summaryHtml}</div>
  </div>

  </body></html>`;

  try { const blob = Utilities.newBlob(htmlTemplate, MimeType.HTML).getAs(MimeType.PDF); blob.setName(`${reportId}.pdf`); return Utilities.base64Encode(blob.getBytes()); } catch (err) { throw new Error("PDF Conversion failed: " + err.message); }
}

// =============================================================================
// PAYROLL BOOK INTEGRATION
// =============================================================================

const PAYROLL_DB_ID_ = '1CHPOJo0LzQISnMfg6GhFSaF00bqDEWhIKli7leKPaZA';

function getApprovedPayrollBooksForVoucher() {
  const ss = SpreadsheetApp.openById(PAYROLL_DB_ID_);
  const sheet = ss.getSheetByName('PayrollBooks');
  if (!sheet) return [];
  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) return [];
  const h = data[0];
  const idIdx = h.indexOf('PayrollID');
  const nameIdx = h.indexOf('PayrollName');
  const attrIdx = h.indexOf('Attribution');
  const dateIdx = h.indexOf('PayoutDate');
  const statusIdx = h.indexOf('Status');
  const result = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][statusIdx]).trim() === 'Processing') {
      result.push({
        pbId: String(data[i][idIdx]).trim(),
        payrollName: String(data[i][nameIdx] || data[i][idIdx]).trim(),
        attribution: String(data[i][attrIdx] || '').trim(),
        payoutDate: String(data[i][dateIdx] || '').trim()
      });
    }
  }
  return sanitizeData_(result);
}

function getPayrollVoucherData(pbId) {
  const ss = SpreadsheetApp.openById(PAYROLL_DB_ID_);
  const pbSheet = ss.getSheetByName('PayrollBooks');
  if (!pbSheet) throw new Error('PayrollBooks sheet not found');
  const pbData = pbSheet.getDataRange().getDisplayValues();
  const pbH = pbData[0];
  let bookHeader = null;
  for (let i = 1; i < pbData.length; i++) {
    if (String(pbData[i][pbH.indexOf('PayrollID')]).trim() === String(pbId).trim()) {
      bookHeader = {};
      pbH.forEach((col, idx) => { bookHeader[col] = pbData[i][idx]; });
      break;
    }
  }
  if (!bookHeader) throw new Error('Payroll Book not found: ' + pbId);
  const consSheet = ss.getSheetByName('PayrollBookConsolidated');
  if (!consSheet) throw new Error('PayrollBookConsolidated sheet not found');
  const consData = consSheet.getDataRange().getDisplayValues();
  if (consData.length < 2) {
    return sanitizeData_({ bookHeader: { payrollName: bookHeader['PayrollName'] || pbId, payoutDate: bookHeader['PayoutDate'] || '' }, lines: [] });
  }
  const cH = consData[0];
  const pidIdx = cH.indexOf('PayrollID');
  const compIdx = cH.indexOf('Company Name');
  const salaryStatusIdx = cH.indexOf('Salary Status');
  const netPayIdx = cH.indexOf('Payslip Net Pay');
  const payrollNameForDesc = String(bookHeader['PayrollName'] || pbId).trim();
  const groups = {};
  for (let i = 1; i < consData.length; i++) {
    if (String(consData[i][pidIdx]).trim() !== String(pbId).trim()) continue;
    const status = String(consData[i][salaryStatusIdx] || '').toUpperCase().trim();
    if (status === '' || status.includes('HOLD') || status.includes('CHECK ACCOUNT')) continue;
    const isCheck = status.includes('FOR RELEASE-CHECK') || status.includes('FOR RELEASE - CHECK');
    const isBpi = !isCheck && (status === 'FOR RELEASE' || status.includes('-BPI'));
    const fee = (isBpi || isCheck) ? 0 : 50;
    const rawNet = Number(String(consData[i][netPayIdx] || 0).replace(/[^0-9.-]+/g, ''));
    const netDisbursed = rawNet - fee;
    if (netDisbursed <= 0) continue;
    const companyName = String(consData[i][compIdx] || 'Unknown').trim();
    const bankLabel = isCheck ? 'CHECK' : (isBpi ? 'BPI' : 'UB');
    const key = companyName + '|' + bankLabel;
    if (!groups[key]) groups[key] = { companyName: companyName, bankLabel: bankLabel, amount: 0, headcount: 0 };
    groups[key].amount += netDisbursed;
    groups[key].headcount += 1;
  }
  const lines = [];
  for (const key in groups) {
    const g = groups[key];
    const bankAccountName = g.bankLabel === 'BPI' ? 'Cash in Bank - BPI Checking' : g.bankLabel === 'CHECK' ? 'Post-Dated Checks Issued' : 'Cash in Bank - UB Checking';
    const isInternal = g.companyName.toLowerCase().includes('workscale');
    lines.push({
      Contact: g.companyName,
      ExpenseAccountCode: 'Salaries and Wages Payable',
      Description: g.companyName + ' Payroll - ' + payrollNameForDesc,
      Category: isInternal ? 'Head Office' : 'Deployed',
      ManpowerCount: g.headcount,
      LineBankCode: bankAccountName,
      Amount: Math.round(g.amount * 100) / 100
    });
  }
  return sanitizeData_({
    bookHeader: { payrollName: bookHeader['PayrollName'] || pbId, payoutDate: bookHeader['PayoutDate'] || '' },
    lines: lines
  });
}

function markPayrollBookVouchered(pbId) {
  const ss = SpreadsheetApp.openById(PAYROLL_DB_ID_);
  const pbSheet = ss.getSheetByName('PayrollBooks');
  if (pbSheet) {
    const pbData = pbSheet.getDataRange().getValues();
    const pbH = pbData[0];
    const idIdx = pbH.indexOf('PayrollID');
    const statusIdx = pbH.indexOf('Status');
    for (let i = 1; i < pbData.length; i++) {
      if (String(pbData[i][idIdx]).trim() === String(pbId).trim()) {
        pbSheet.getRange(i + 1, statusIdx + 1).setValue('Vouchered');
        break;
      }
    }
  }
  const consSheet = ss.getSheetByName('PayrollBookConsolidated');
  if (consSheet) {
    const cData = consSheet.getDataRange().getValues();
    const cpIdx = cData[0].indexOf('PayrollID');
    const clStatusIdx = cData[0].indexOf('LineStatus');
    if (clStatusIdx > -1) {
      const writeArray = consSheet.getRange(2, clStatusIdx + 1, cData.length - 1, 1).getValues();
      let changed = false;
      for (let i = 1; i < cData.length; i++) {
        if (String(cData[i][cpIdx]).trim() === String(pbId).trim()) {
          writeArray[i - 1][0] = 'Vouchered';
          changed = true;
        }
      }
      if (changed) consSheet.getRange(2, clStatusIdx + 1, cData.length - 1, 1).setValues(writeArray);
    }
  }
  return true;
}

// ─── JOURNAL ENTRY ACTIONS ────────────────────────────────────────────────────

/**
 * Posts a single journal entry identified by its DocumentID.
 * Marks all matching rows in the Central JournalLines sheet with posted_by and posted_at.
 */
function postJournalEntry(vId) {
  try {
    const sheet = getCentralJournalLinesSheet_();
    if (!sheet) throw new Error('JournalLines sheet not found');
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) throw new Error('No journal lines found');
    const headers = data[0].map(h => String(h).trim());
    const docIdx     = headers.indexOf('DocumentID');
    const postedByIdx = headers.indexOf('posted_by');
    const postedAtIdx = headers.indexOf('posted_at');
    if (docIdx < 0) throw new Error('DocumentID column not found');

    const user = Session.getActiveUser().getEmail() || 'system';
    const now  = new Date();
    let updated = false;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][docIdx]).trim() === String(vId).trim()) {
        if (postedByIdx > -1) sheet.getRange(i + 1, postedByIdx + 1).setValue(user);
        if (postedAtIdx > -1) sheet.getRange(i + 1, postedAtIdx + 1).setValue(now);
        updated = true;
      }
    }
    if (!updated) throw new Error('No lines found for ' + vId);
    return { success: true };
  } catch (e) {
    throw new Error('postJournalEntry failed: ' + e.message);
  }
}

/**
 * Duplicates all journal entry lines for a given DocumentID.
 * New lines get a new DocumentID (original + '-COPY-' + timestamp) and cleared posted fields.
 */
function duplicateJournalEntry(vId) {
  try {
    const sheet = getCentralJournalLinesSheet_();
    if (!sheet) throw new Error('JournalLines sheet not found');
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) throw new Error('No journal lines found');
    const headers = data[0].map(h => String(h).trim());
    const docIdx = headers.indexOf('DocumentID');
    const jeIdx  = headers.indexOf('journal_entry_id');
    const createdByIdx = headers.indexOf('created_by');
    const createdAtIdx = headers.indexOf('created_at');
    const postedByIdx  = headers.indexOf('posted_by');
    const postedAtIdx  = headers.indexOf('posted_at');

    const sourceRows = data.filter((row, i) => i > 0 && String(row[docIdx]).trim() === String(vId).trim());
    if (sourceRows.length === 0) throw new Error('No lines found for ' + vId);

    const user = Session.getActiveUser().getEmail() || 'system';
    const now  = new Date();
    const ts   = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
    const newDocId = String(vId) + '-COPY-' + ts;

    const newRows = sourceRows.map((row, idx) => {
      const newRow = row.slice(); // copy array
      if (docIdx > -1)     newRow[docIdx]     = newDocId;
      if (jeIdx > -1)      newRow[jeIdx]      = newDocId + '-L' + String(idx + 1).padStart(3, '0');
      if (createdAtIdx > -1) newRow[createdAtIdx] = now;
      if (createdByIdx > -1) newRow[createdByIdx] = user;
      if (postedByIdx > -1)  newRow[postedByIdx]  = '';
      if (postedAtIdx > -1)  newRow[postedAtIdx]  = '';
      return newRow;
    });

    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, headers.length).setValues(newRows);
    return { success: true, newDocId: newDocId };
  } catch (e) {
    throw new Error('duplicateJournalEntry failed: ' + e.message);
  }
}

/**
 * Creates a reversing journal entry for a given DocumentID.
 * Swaps debit and credit values; new DocumentID = original + '-REV-' + timestamp.
 */
function reverseJournalEntry(vId) {
  try {
    const sheet = getCentralJournalLinesSheet_();
    if (!sheet) throw new Error('JournalLines sheet not found');
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) throw new Error('No journal lines found');
    const headers = data[0].map(h => String(h).trim());
    const docIdx   = headers.indexOf('DocumentID');
    const jeIdx    = headers.indexOf('journal_entry_id');
    const debitIdx = headers.indexOf('debit');
    const creditIdx= headers.indexOf('credit');
    const createdByIdx = headers.indexOf('created_by');
    const createdAtIdx = headers.indexOf('created_at');
    const postedByIdx  = headers.indexOf('posted_by');
    const postedAtIdx  = headers.indexOf('posted_at');

    const sourceRows = data.filter((row, i) => i > 0 && String(row[docIdx]).trim() === String(vId).trim());
    if (sourceRows.length === 0) throw new Error('No lines found for ' + vId);

    const user = Session.getActiveUser().getEmail() || 'system';
    const now  = new Date();
    const ts   = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
    const newDocId = String(vId) + '-REV-' + ts;

    const newRows = sourceRows.map((row, idx) => {
      const newRow = row.slice();
      if (docIdx > -1)     newRow[docIdx]     = newDocId;
      if (jeIdx > -1)      newRow[jeIdx]      = newDocId + '-L' + String(idx + 1).padStart(3, '0');
      // Swap debit and credit
      if (debitIdx > -1 && creditIdx > -1) {
        const origDebit  = newRow[debitIdx];
        const origCredit = newRow[creditIdx];
        newRow[debitIdx]  = origCredit;
        newRow[creditIdx] = origDebit;
      }
      if (createdAtIdx > -1) newRow[createdAtIdx] = now;
      if (createdByIdx > -1) newRow[createdByIdx] = user;
      if (postedByIdx > -1)  newRow[postedByIdx]  = '';
      if (postedAtIdx > -1)  newRow[postedAtIdx]  = '';
      return newRow;
    });

    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, newRows.length, headers.length).setValues(newRows);
    return { success: true, newDocId: newDocId };
  } catch (e) {
    throw new Error('reverseJournalEntry failed: ' + e.message);
  }
}

/**
 * Posts multiple journal entries at once. vIds is an array of DocumentIDs.
 */
function bulkPostJournalEntries(vIds) {
  if (!vIds || vIds.length === 0) throw new Error('No entries to post');
  try {
    const sheet = getCentralJournalLinesSheet_();
    if (!sheet) throw new Error('JournalLines sheet not found');
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) throw new Error('No journal lines found');
    const headers = data[0].map(h => String(h).trim());
    const docIdx      = headers.indexOf('DocumentID');
    const postedByIdx = headers.indexOf('posted_by');
    const postedAtIdx = headers.indexOf('posted_at');
    if (docIdx < 0) throw new Error('DocumentID column not found');

    const vIdSet = new Set(vIds.map(v => String(v).trim()));
    const user   = Session.getActiveUser().getEmail() || 'system';
    const now    = new Date();

    for (let i = 1; i < data.length; i++) {
      if (vIdSet.has(String(data[i][docIdx]).trim())) {
        if (postedByIdx > -1) sheet.getRange(i + 1, postedByIdx + 1).setValue(user);
        if (postedAtIdx > -1) sheet.getRange(i + 1, postedAtIdx + 1).setValue(now);
      }
    }
    return { success: true, count: vIds.length };
  } catch (e) {
    throw new Error('bulkPostJournalEntries failed: ' + e.message);
  }
}

/**
 * Saves a manually created journal entry from the UI.
 * payload: { refId, date, memo, lines: [{lineNo, accountCode, accountName, description, contact, debit, credit}] }
 */
function saveManualJournalEntry(payload) {
  try {
    if (!payload || !payload.lines || payload.lines.length === 0) throw new Error('No journal lines provided.');
    const sheet = getCentralJournalLinesSheet_();
    if (!sheet) throw new Error('JournalLines sheet not found.');

    const user = Session.getActiveUser().getEmail() || 'system';
    const now  = new Date();
    const dateStr = payload.date ? new Date(payload.date).toISOString() : now.toISOString();

    // Generate a doc ID if not provided
    const dateTag = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
    const docId = payload.refId && payload.refId.trim() ? payload.refId.trim() : ('MJE-' + dateTag);
    const jeId  = 'JE-' + docId;

    const rows = payload.lines.map(l => [
      docId,              // DocumentID
      jeId,               // journal_entry_id
      l.lineNo,           // line_number
      l.accountCode,      // account_code
      l.accountName,      // account_name
      l.description || payload.memo || '', // description
      l.contact || '',    // contact_name
      '',                 // class
      Number(l.debit)  || 0, // debit
      Number(l.credit) || 0, // credit
      dateStr,            // created_at
      user,               // created_by
      '',                 // updated_by
      '',                 // updated_at
      '',                 // posted_by
      ''                  // posted_at
    ]);

    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
    return { success: true, docId };
  } catch (e) {
    throw new Error('saveManualJournalEntry failed: ' + e.message);
  }
}

// =============================================================================
// TAX MODULE
// =============================================================================

// Returns all voucher lines that carry a tax tag (disbursement side).
function getTaxEntries_() {
    const lines    = getSheetData_('VoucherLines');
    const vouchers = getSheetData_('Vouchers');
    const vMap = {};
    vouchers.forEach(v => { vMap[String(v.VoucherId)] = v; });
    return sanitizeData_(
        lines
          .filter(l => l.TaxType && String(l.TaxType).toUpperCase() !== 'N/A' && String(l.TaxType).trim() !== '')
          .map(l => {
              const v       = vMap[String(l.VoucherId)] || {};
              const amt     = Number(l.Amount   || 0);
              const taxType = String(l.TaxType  || '').toUpperCase();
              const ewtRate = Number(l.EwtRate  || 0);
              const hasVat  = taxType.includes('VAT');
              const hasEwt  = taxType.includes('EWT');
              const net     = hasVat ? amt / 1.12 : amt;
              const vatAmt  = hasVat ? (Number(l.VatAmount) || +(amt - net).toFixed(4)) : 0;
              const ewtAmt  = hasEwt ? (Number(l.EwtAmount) || +(net * ewtRate).toFixed(4)) : 0;
              return {
                  voucherId:   l.VoucherId,
                  voucherType: v.VoucherType || '',
                  date:        l.Date || v.PreparationDate || '',
                  contact:     l.Contact || '',
                  description: l.Description || '',
                  taxType:     l.TaxType,
                  ewtRate:     ewtRate,
                  grossAmount: amt,
                  netAmount:   +net.toFixed(4),
                  vatAmount:   +vatAmt.toFixed(4),
                  ewtAmount:   +ewtAmt.toFixed(4),
                  cashOut:     +(amt - ewtAmt).toFixed(4),
                  direction:   'DISBURSEMENT',
                  status:      v.Status || ''
              };
          })
    );
}

function getTaxSummary() {
    const entries = getTaxEntries_();
    const periodMap = {};
    entries.forEach(e => {
        const d = e.date ? new Date(e.date) : null;
        const period = (d && !isNaN(d)) ? (d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0')) : 'Unknown';
        const tags = String(e.taxType || '').toUpperCase().split('+').map(t => t.trim()).filter(Boolean);
        tags.forEach(tt => {
            const key = period + '|' + tt;
            if (!periodMap[key]) periodMap[key] = { period, taxType: tt, count: 0, totalGross: 0, totalVat: 0, totalEwt: 0 };
            periodMap[key].count++;
            periodMap[key].totalGross += e.grossAmount;
            if (tt === 'VAT') periodMap[key].totalVat += e.vatAmount;
            if (tt === 'EWT') periodMap[key].totalEwt += e.ewtAmount;
        });
    });
    return sanitizeData_(Object.values(periodMap).sort((a,b) => b.period.localeCompare(a.period)));
}

// =============================================================================
// TAX RATES CRUD
// =============================================================================

function ensureTaxRatesSheet_() {
  const ss = getCentralSS_();
  let sh = ss.getSheetByName('TaxRates');
  if (sh) {
    // Migrate old schemas (HasVat/HasEwt or IsInclusive columns) to new schema
    const hdrs = sh.getRange(1,1,1,sh.getLastColumn()||1).getValues()[0].map(h=>String(h).trim());
    if (hdrs.includes('HasVat') || hdrs.includes('IsInclusive')) {
      sh.clearContents();
      sh.appendRow(['TaxName','RatePercent','TaxAccount','IsActive']);
    }
    return sh;
  }
  sh = ss.insertSheet('TaxRates');
  sh.appendRow(['TaxName','RatePercent','TaxAccount','IsActive']);
  return sh;
}

function getTaxRates() {
  const sh = ensureTaxRatesSheet_();
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return sanitizeData_([]);
  const hdrs = data[0].map(h => String(h).trim());
  return sanitizeData_(data.slice(1).filter(r => r.join('').trim() !== '').map(r => {
    const o = {}; hdrs.forEach((h, i) => { o[h] = r[i]; });
    return { name: String(o['TaxName']||''), ratePercent: Number(o['RatePercent']||0),
             taxAccount: String(o['TaxAccount']||''),
             isActive: parseBool_(o['IsActive'] != null ? o['IsActive'] : 'TRUE') };
  }));
}

function saveTaxRate(payload) {
  if (!String(payload.taxName||'').trim()) throw new Error('TaxName is required.');
  const sh = ensureTaxRatesSheet_();
  const data = sh.getDataRange().getValues();
  const hdrs = data[0].map(h => String(h).trim());
  const nameIdx  = hdrs.indexOf('TaxName');
  const origName = String(payload.origName || payload.taxName).trim().toLowerCase();
  const row = [String(payload.taxName).trim(), Number(payload.ratePercent||0),
               String(payload.taxAccount||''), 'TRUE'];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][nameIdx]||'').trim().toLowerCase() === origName) {
      sh.getRange(i+1, 1, 1, row.length).setValues([row]);
      return sanitizeData_({ ok: true });
    }
  }
  sh.appendRow(row);
  return sanitizeData_({ ok: true });
}

function deleteTaxRate(taxName) {
  const sh = ensureTaxRatesSheet_();
  const data = sh.getDataRange().getValues();
  const hdrs = data[0].map(h => String(h).trim());
  const nameIdx  = hdrs.indexOf('TaxName');
  const nameLower = String(taxName||'').trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][nameIdx]||'').trim().toLowerCase() === nameLower) {
      sh.deleteRow(i+1);
      return sanitizeData_({ ok: true });
    }
  }
  return sanitizeData_({ ok: false, message: 'Not found.' });
}

function ensureTaxGroupsSheet_() {
  const ss = getCentralSS_();
  let sh = ss.getSheetByName('TaxGroups');
  if (!sh) {
    sh = ss.insertSheet('TaxGroups');
    sh.appendRow(['GroupName','RateNames','IsActive']);
    [['VAT+EWT 2%','VAT,EWT 2%','TRUE'],['VAT+EWT 5%','VAT,EWT 5%','TRUE']].forEach(r => sh.appendRow(r));
  }
  return sh;
}

function getTaxGroups() {
  const sh = ensureTaxGroupsSheet_();
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return sanitizeData_([]);
  const hdrs = data[0].map(h => String(h).trim());
  return sanitizeData_(data.slice(1).filter(r => r.join('').trim() !== '').map(r => {
    const o = {}; hdrs.forEach((h, i) => { o[h] = r[i]; });
    return { name: String(o['GroupName']||''),
             rateNames: String(o['RateNames']||'').split(',').map(s=>s.trim()).filter(Boolean),
             isActive: parseBool_(o['IsActive'] != null ? o['IsActive'] : 'TRUE') };
  }));
}

function saveTaxGroup(payload) {
  if (!String(payload.groupName||'').trim()) throw new Error('GroupName is required.');
  if (!Array.isArray(payload.rateNames) || !payload.rateNames.length) throw new Error('Select at least one tax rate.');
  const sh = ensureTaxGroupsSheet_();
  const data = sh.getDataRange().getValues();
  const hdrs = data[0].map(h => String(h).trim());
  const nameIdx = hdrs.indexOf('GroupName');
  const origName = String(payload.origName || payload.groupName).trim().toLowerCase();
  const row = [String(payload.groupName).trim(), payload.rateNames.join(','), 'TRUE'];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][nameIdx]||'').trim().toLowerCase() === origName) {
      sh.getRange(i+1, 1, 1, row.length).setValues([row]);
      return sanitizeData_({ ok: true });
    }
  }
  sh.appendRow(row);
  return sanitizeData_({ ok: true });
}

function deleteTaxGroup(groupName) {
  const sh = ensureTaxGroupsSheet_();
  const data = sh.getDataRange().getValues();
  const hdrs = data[0].map(h => String(h).trim());
  const nameIdx = hdrs.indexOf('GroupName');
  const nameLower = String(groupName||'').trim().toLowerCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][nameIdx]||'').trim().toLowerCase() === nameLower) {
      sh.deleteRow(i+1); return sanitizeData_({ ok: true });
    }
  }
  return sanitizeData_({ ok: false, message: 'Not found.' });
}

// =============================================================================
function getApprovedFinalPayBooksForVoucher() {
  const ss = SpreadsheetApp.openById(PAYROLL_DB_ID_);
  const sheet = ss.getSheetByName('FinalPayBooks');
  if (!sheet) return [];
  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) return [];
  const h = data[0];
  const idIdx = h.indexOf('FP_ID');
  const dateIdx = h.indexOf('Release Date');
  const statusIdx = h.indexOf('Status');
  const hcIdx = h.indexOf('Headcount');
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const status = String(data[i][statusIdx]).trim();
    if (status === 'Processing' || status === 'Approved') {
      result.push({
        fpId: String(data[i][idIdx]).trim(),
        releaseDate: String(data[i][dateIdx] || '').trim(),
        headcount: String(data[i][hcIdx] || '0').trim(),
        status: status
      });
    }
  }
  return sanitizeData_(result);
}

function getFinalPayVoucherData(fpId) {
  const ss = SpreadsheetApp.openById(PAYROLL_DB_ID_);
  const fpSheet = ss.getSheetByName('FinalPayBooks');
  if (!fpSheet) throw new Error('FinalPayBooks sheet not found');
  const fpData = fpSheet.getDataRange().getDisplayValues();
  const fpH = fpData[0];
  let bookHeader = null;
  for (let i = 1; i < fpData.length; i++) {
    if (String(fpData[i][fpH.indexOf('FP_ID')]).trim() === String(fpId).trim()) {
      bookHeader = {};
      fpH.forEach((col, idx) => { bookHeader[col] = fpData[i][idx]; });
      break;
    }
  }
  if (!bookHeader) throw new Error('Final Pay Book not found: ' + fpId);

  const consSheet = ss.getSheetByName('FinalPayConsolidated');
  if (!consSheet) throw new Error('FinalPayConsolidated sheet not found');
  const consData = consSheet.getDataRange().getDisplayValues();
  if (consData.length < 2) {
    return sanitizeData_({ bookHeader: { fpId: fpId, releaseDate: bookHeader['Release Date'] || '' }, lines: [] });
  }

  const cH = consData[0];
  const pidIdx = cH.indexOf('FP_ID');
  const compIdx = cH.indexOf('Company Name');
  const modeIdx = cH.indexOf('Mode of Release');
  const netIdx = cH.indexOf('Net Final Pay');
  const lineStatusIdx = cH.indexOf('LineStatus');

  // Group by Company Name x bank channel (Mode of Release)
  // Net Final Pay already includes cumulative 13th month (computed at FP book creation)
  const groups = {};
  for (let i = 1; i < consData.length; i++) {
    if (String(consData[i][pidIdx]).trim() !== String(fpId).trim()) continue;
    const lineStatus = String(consData[i][lineStatusIdx] || '').trim();
    if (lineStatus === 'Vouchered') continue;
    const rawNet = Number(String(consData[i][netIdx] || 0).replace(/[^0-9.-]+/g, ''));
    if (rawNet <= 0) continue;

    const companyName = String(consData[i][compIdx] || 'Unknown').trim();
    const mode = String(consData[i][modeIdx] || 'Payroll Credit').trim();
    // Mode of Release: 'Payroll Credit' → BPI, 'Other Bank' → UB (InstaPay), 'Check' → CHECK
    const isCheck = mode === 'Check';
    const isUB = mode === 'Other Bank';
    const bankLabel = isCheck ? 'CHECK' : (isUB ? 'UB' : 'BPI');
    const key = companyName + '|' + bankLabel;

    if (!groups[key]) groups[key] = { companyName: companyName, bankLabel: bankLabel, amount: 0, headcount: 0 };
    groups[key].amount += rawNet;
    groups[key].headcount += 1;
  }

  const lines = [];
  for (const key in groups) {
    const g = groups[key];
    const bankAccountName = g.bankLabel === 'BPI' ? 'Cash in Bank - BPI Checking' :
                            g.bankLabel === 'CHECK' ? 'Post-Dated Checks Issued' :
                            'Cash in Bank - UB Checking';
    const isInternal = g.companyName.toLowerCase().includes('workscale');
    lines.push({
      Contact: g.companyName,
      ExpenseAccountCode: 'Salaries and Wages Payable',
      Description: g.companyName + ' Final Pay - ' + fpId,
      Category: isInternal ? 'Head Office' : 'Deployed',
      ManpowerCount: g.headcount,
      LineBankCode: bankAccountName,
      Amount: Math.round(g.amount * 100) / 100
    });
  }

  return sanitizeData_({
    bookHeader: { fpId: fpId, releaseDate: bookHeader['Release Date'] || '' },
    lines: lines
  });
}

function markFinalPayVouchered(fpId) {
  const ss = SpreadsheetApp.openById(PAYROLL_DB_ID_);
  const fpSheet = ss.getSheetByName('FinalPayBooks');
  if (fpSheet) {
    const fpData = fpSheet.getDataRange().getValues();
    const fpH = fpData[0];
    const idIdx = fpH.indexOf('FP_ID');
    const statusIdx = fpH.indexOf('Status');
    for (let i = 1; i < fpData.length; i++) {
      if (String(fpData[i][idIdx]).trim() === String(fpId).trim()) {
        fpSheet.getRange(i + 1, statusIdx + 1).setValue('Vouchered');
        break;
      }
    }
  }
  const consSheet = ss.getSheetByName('FinalPayConsolidated');
  if (consSheet) {
    const cData = consSheet.getDataRange().getValues();
    const cpIdx = cData[0].indexOf('FP_ID');
    const clStatusIdx = cData[0].indexOf('LineStatus');
    if (clStatusIdx > -1) {
      const writeArray = consSheet.getRange(2, clStatusIdx + 1, cData.length - 1, 1).getValues();
      let changed = false;
      for (let i = 1; i < cData.length; i++) {
        if (String(cData[i][cpIdx]).trim() === String(fpId).trim()) {
          writeArray[i - 1][0] = 'Vouchered';
          changed = true;
        }
      }
      if (changed) consSheet.getRange(2, clStatusIdx + 1, cData.length - 1, 1).setValues(writeArray);
    }
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// ■■ FINANCIAL MANAGEMENT (FINC) BACKEND ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// ═══════════════════════════════════════════════════════════════════════════

// Column order must match the header row defined in getTargetSheet_('FinancialLoans')
const FINC_COLS_ = ['LoanId','LoanName','LoanType','FirstPayment','Principal','TermMonths','AnnualRate','InterestMethod','ProcessingFee','ProceedsDate','Status','PaymentFrequency','PayDayMode','PayDays','PayDaysPerMonth','PaymentMethod','PMChecks','PMAdaDay','PMAdaBank','PMBtBank','PMAutoVoucher','UpdatedAt','UpdatedBy'];

function toSheetMdy_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    if (isNaN(val.getTime())) return '';
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'MM/dd/yyyy');
  }
  var s = String(val).trim();
  if (!s) return '';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    var p = s.split('/');
    return String(parseInt(p[0], 10)).padStart(2, '0') + '/' + String(parseInt(p[1], 10)).padStart(2, '0') + '/' + p[2];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s.substring(5, 7) + '/' + s.substring(8, 10) + '/' + s.substring(0, 4);
  }
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy');
  return '';
}

function fromSheetToIso_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    if (isNaN(val.getTime())) return '';
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    var p = s.split('/');
    return p[2] + '-' + String(parseInt(p[0], 10)).padStart(2, '0') + '-' + String(parseInt(p[1], 10)).padStart(2, '0');
  }
  var d = new Date(s);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return '';
}

function saveFincProfile(jsonData) {
  try {
    const email  = Session.getActiveUser().getEmail();
    const sheet  = getTargetSheet_('FinancialLoans');
    const now    = new Date().toISOString();

    // Schema migration: full wipe if old JSON-blob schema; expand header if PM columns missing
    const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (existingHeaders.indexOf('LoanId') === -1) {
      sheet.clearContents();
      sheet.appendRow(FINC_COLS_);
      sheet.setFrozenRows(1);
    } else if (existingHeaders.indexOf('PMChecks') === -1) {
      // Expand header for schema changes (e.g. PMChecks replacing old single-check columns)
      sheet.getRange(1, 1, 1, FINC_COLS_.length).setValues([FINC_COLS_]);
    }

    // Parse incoming loan list
    var loans = [];
    try { loans = JSON.parse(jsonData).loans || []; } catch(e) {}

    // Clear existing data rows, keep header
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, FINC_COLS_.length).clearContent();

    // Write one row per loan
    if (loans.length) {
      const rows = loans.map(function(l) {
        return [
          l.id               || '',
          l.name             || '',
          l.loanType         || '',
          toSheetMdy_(l.disbursementDate),
          l.principal        || 0,
          l.termMonths       || 0,
          l.annualRate       || 0,
          l.interestMethod   || '',
          l.processingFee    || 0,
          toSheetMdy_(l.proceedsDate),
          l.status           || '',
          l.paymentFrequency || '',
          l.payDayMode       || '',
          l.payDays          || '',
          l.payDaysPerMonth  ? JSON.stringify(l.payDaysPerMonth) : '',
          l.paymentMethod    || 'Check',
          l.pmChecks && l.pmChecks.length ? JSON.stringify(l.pmChecks) : '',
          l.pmAdaDay         || '',
          l.pmAdaBank        || '',
          l.pmBtBank         || '',
          l.pmAutoVoucher    ? 'TRUE' : 'FALSE',
          now,
          email
        ];
      });
      sheet.getRange(2, 1, rows.length, FINC_COLS_.length).setValues(rows);
    }
    return { success: true };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

function loadFincProfile() {
  try {
    const sheet   = getTargetSheet_('FinancialLoans');
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    // Old schema (JSON blob) — return null so the frontend starts fresh
    if (headers.indexOf('LoanId') === -1) return null;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    // Build column index map from actual headers (tolerates extra or missing columns)
    const col = {};
    headers.forEach(function(h, i) { if (h) col[h] = i; });
    function g(row, key, def) { return col[key] !== undefined ? row[col[key]] : (def !== undefined ? def : ''); }
    const loans = [];
    data.forEach(function(row) {
      if (!g(row, 'LoanId')) return; // skip blank rows
      var pdpm = {};
      try { var pdStr = g(row, 'PayDaysPerMonth'); if (pdStr) pdpm = JSON.parse(pdStr); } catch(e) {}
      loans.push({
        id:               Number(g(row, 'LoanId'))                      || 0,
        name:             String(g(row, 'LoanName')           || ''),
        loanType:         String(g(row, 'LoanType')           || ''),
        disbursementDate: fromSheetToIso_(g(row, 'FirstPayment')),
        principal:        Number(g(row, 'Principal'))         || 0,
        termMonths:       Number(g(row, 'TermMonths'))        || 0,
        annualRate:       Number(g(row, 'AnnualRate'))        || 0,
        interestMethod:   String(g(row, 'InterestMethod')     || ''),
        processingFee:    Number(g(row, 'ProcessingFee'))     || 0,
        proceedsDate:     fromSheetToIso_(g(row, 'ProceedsDate')),
        status:           String(g(row, 'Status')             || ''),
        paymentFrequency: String(g(row, 'PaymentFrequency',   'Monthly') || 'Monthly'),
        payDayMode:       String(g(row, 'PayDayMode',         'Fixed')   || 'Fixed'),
        payDays:          String(g(row, 'PayDays')            || ''),
        payDaysPerMonth:  pdpm,
        paymentMethod:    String(g(row, 'PaymentMethod',      'Check')   || 'Check'),
        pmChecks:         (function() { var s = g(row, 'PMChecks'); if (!s) return []; try { return JSON.parse(s); } catch(e) { return []; } })(),
        pmAdaDay:         g(row, 'PMAdaDay') !== '' ? (Number(g(row, 'PMAdaDay')) || '') : '',
        pmAdaBank:        String(g(row, 'PMAdaBank')          || ''),
        pmBtBank:         String(g(row, 'PMBtBank')           || ''),
        pmAutoVoucher:    g(row, 'PMAutoVoucher') === 'TRUE' || g(row, 'PMAutoVoucher') === true
      });
    });
    return JSON.stringify({ loans: loans });
  } catch(e) {
    return null;
  }
}

// ■■ FIXED ASSETS (FA) BACKEND ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// ═══════════════════════════════════════════════════════════════════════════

// Column definitions — these must match the header rows created by getFASheet_
const FA_ASSET_COLS_ = [
  'AssetId','AssetName','AssetTypeId','AssetType',
  'PurchaseDate','DeprecStartDate',
  'Cost','ResidualValue','UsefulLifeMonths',
  'DepreciationMethod','ComputationType',
  'FixedAssetAccount','AccumDeprecAccount','DeprecExpenseAccount',
  'Status','DisposalDate','Notes',
  'IsInstallment','InstallmentPrincipal','InstallmentStartDate',
  'InstallmentTermMonths','InstallmentAnnualRate','InstallmentMethod',
  'InstallmentPayableAccount','InstallmentAmortizationAccount',
  'PaymentMethod','PMChecks','PMAdaDay','PMAdaBank','PMBtBank','PMAutoVoucher',
  'UpdatedAt','UpdatedBy'
];

const FA_TYPE_COLS_ = [
  'TypeId','TypeName',
  'DepreciationMethod','UsefulLifeMonths',
  'FixedAssetAccount','AccumDeprecAccount','DeprecExpenseAccount',
  'UpdatedAt','UpdatedBy'
];

function getFA_SS_() {
  return SpreadsheetApp.openById(FA_SS_ID);
}

function getFASheet_(sheetName) {
  const ss = getFA_SS_();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    if (sheetName === 'FixedAssets') {
      sheet = ss.insertSheet('FixedAssets');
      sheet.appendRow(FA_ASSET_COLS_);
      sheet.setFrozenRows(1);
      return sheet;
    }
    if (sheetName === 'FixedAssetTypes') {
      sheet = ss.insertSheet('FixedAssetTypes');
      sheet.appendRow(FA_TYPE_COLS_);
      sheet.setFrozenRows(1);
      return sheet;
    }
    throw new Error('FA sheet "' + sheetName + '" not found.');
  }
  return sheet;
}

// ─── ASSET TYPES CRUD ────────────────────────────────────────────────────────

function saveFixedAssetTypes(jsonData) {
  try {
    const email = Session.getActiveUser().getEmail();
    const sheet = getFASheet_('FixedAssetTypes');
    const now   = new Date().toISOString();

    const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    if (existingHeaders.indexOf('TypeId') === -1) {
      sheet.clearContents();
      sheet.appendRow(FA_TYPE_COLS_);
      sheet.setFrozenRows(1);
    } else {
      sheet.getRange(1, 1, 1, FA_TYPE_COLS_.length).setValues([FA_TYPE_COLS_]);
    }

    var types = [];
    try { types = JSON.parse(jsonData).types || []; } catch(e2) {}
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, FA_TYPE_COLS_.length).clearContent();

    if (types.length) {
      const rows = types.map(function(t) {
        return [
          t.id                   || '',
          t.name                 || '',
          t.depreciationMethod   || 'Straight Line',
          t.usefulLifeMonths     || 0,
          t.fixedAssetAccount    || '',
          t.accumDeprecAccount   || '',
          t.deprecExpenseAccount || '',
          now,
          email
        ];
      });
      sheet.getRange(2, 1, rows.length, FA_TYPE_COLS_.length).setValues(rows);
    }
    return { success: true };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

function loadFixedAssetTypes() {
  try {
    const sheet   = getFASheet_('FixedAssetTypes');
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (headers.indexOf('TypeId') === -1) return JSON.stringify({ types: [] });
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ types: [] });
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const col = {};
    headers.forEach(function(h, i) { if (h) col[String(h).trim()] = i; });
    function g(row, key, def) { return col[key] !== undefined ? row[col[key]] : (def !== undefined ? def : ''); }
    const types = [];
    data.forEach(function(row) {
      if (!g(row, 'TypeId')) return;
      types.push({
        id:                   String(g(row, 'TypeId')              || ''),
        name:                 String(g(row, 'TypeName')            || ''),
        depreciationMethod:   String(g(row, 'DepreciationMethod', 'Straight Line') || 'Straight Line'),
        usefulLifeMonths:     Number(g(row, 'UsefulLifeMonths'))   || 0,
        fixedAssetAccount:    String(g(row, 'FixedAssetAccount')   || ''),
        accumDeprecAccount:   String(g(row, 'AccumDeprecAccount')  || ''),
        deprecExpenseAccount: String(g(row, 'DeprecExpenseAccount')|| '')
      });
    });
    return JSON.stringify({ types: types });
  } catch(e) {
    return null;
  }
}

// ─── ASSETS CRUD ─────────────────────────────────────────────────────────────

function saveFixedAssets(jsonData) {
  try {
    const email = Session.getActiveUser().getEmail();
    const sheet = getFASheet_('FixedAssets');
    const now   = new Date().toISOString();

    const existingHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    if (existingHeaders.indexOf('AssetId') === -1) {
      sheet.clearContents();
      sheet.appendRow(FA_ASSET_COLS_);
      sheet.setFrozenRows(1);
    } else {
      sheet.getRange(1, 1, 1, FA_ASSET_COLS_.length).setValues([FA_ASSET_COLS_]);
    }

    var assets = [];
    try { assets = JSON.parse(jsonData).assets || []; } catch(e2) {}
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, FA_ASSET_COLS_.length).clearContent();

    if (assets.length) {
      const rows = assets.map(function(a) {
        return [
          a.id                   || '',
          a.name                 || '',
          a.assetTypeId          || '',
          a.assetType            || '',
          toSheetMdy_(a.purchaseDate),
          toSheetMdy_(a.deprecStartDate),
          a.cost                 || 0,
          a.residualValue        || 0,
          a.usefulLifeMonths     || 0,
          a.depreciationMethod   || 'Straight Line',
          a.computationType      || 'Non Pro Rata',
          a.fixedAssetAccount    || '',
          a.accumDeprecAccount   || '',
          a.deprecExpenseAccount || '',
          a.status               || 'Active',
          toSheetMdy_(a.disposalDate),
          a.notes                || '',
          a.isInstallment              || '',
          a.installmentPrincipal       || 0,
          toSheetMdy_(a.installmentStartDate),
          a.installmentTermMonths      || 0,
          a.installmentAnnualRate      || 0,
          a.installmentMethod          || 'Reducing Balance',
          a.installmentPayableAccount  || '',
          a.installmentAmortizationAccount || '',
          a.paymentMethod || 'Check',
          JSON.stringify(a.pmChecks || []),
          a.pmAdaDay   || '',
          a.pmAdaBank  || '',
          a.pmBtBank   || '',
          a.pmAutoVoucher ? 'TRUE' : 'FALSE',
          now,
          email
        ];
      });
      sheet.getRange(2, 1, rows.length, FA_ASSET_COLS_.length).setValues(rows);
    }
    return { success: true };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

function loadFixedAssets() {
  try {
    const sheet   = getFASheet_('FixedAssets');
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    if (headers.indexOf('AssetId') === -1) return JSON.stringify({ assets: [] });
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return JSON.stringify({ assets: [] });
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    const col = {};
    headers.forEach(function(h, i) { if (h) col[String(h).trim()] = i; });
    function g(row, key, def) { return col[key] !== undefined ? row[col[key]] : (def !== undefined ? def : ''); }
    const assets = [];
    data.forEach(function(row) {
      if (!g(row, 'AssetId')) return;
      assets.push({
        id:                   String(g(row, 'AssetId')              || ''),
        name:                 String(g(row, 'AssetName')            || ''),
        assetTypeId:          String(g(row, 'AssetTypeId')          || ''),
        assetType:            String(g(row, 'AssetType')            || ''),
        purchaseDate:         fromSheetToIso_(g(row, 'PurchaseDate')),
        deprecStartDate:      fromSheetToIso_(g(row, 'DeprecStartDate')),
        cost:                 Number(g(row, 'Cost'))                || 0,
        residualValue:        Number(g(row, 'ResidualValue'))       || 0,
        usefulLifeMonths:     Number(g(row, 'UsefulLifeMonths'))    || 0,
        depreciationMethod:   String(g(row, 'DepreciationMethod', 'Straight Line') || 'Straight Line'),
        computationType:      String(g(row, 'ComputationType', 'Non Pro Rata') || 'Non Pro Rata'),
        fixedAssetAccount:    String(g(row, 'FixedAssetAccount')    || ''),
        accumDeprecAccount:   String(g(row, 'AccumDeprecAccount')   || ''),
        deprecExpenseAccount: String(g(row, 'DeprecExpenseAccount') || ''),
        status:               String(g(row, 'Status', 'Active')     || 'Active'),
        disposalDate:         fromSheetToIso_(g(row, 'DisposalDate')),
        notes:                String(g(row, 'Notes')                || ''),
        isInstallment:              String(g(row, 'IsInstallment')              || ''),
        installmentPrincipal:       Number(g(row, 'InstallmentPrincipal'))      || 0,
        installmentStartDate:       fromSheetToIso_(g(row, 'InstallmentStartDate')),
        installmentTermMonths:      Number(g(row, 'InstallmentTermMonths'))     || 0,
        installmentAnnualRate:      Number(g(row, 'InstallmentAnnualRate'))     || 0,
        installmentMethod:          String(g(row, 'InstallmentMethod', 'Reducing Balance') || 'Reducing Balance'),
        installmentPayableAccount:  String(g(row, 'InstallmentPayableAccount')  || ''),
        installmentAmortizationAccount: String(g(row, 'InstallmentAmortizationAccount') || ''),
        paymentMethod: String(g(row, 'PaymentMethod') || 'Check'),
        pmChecks:      (function() { try { return JSON.parse(g(row, 'PMChecks') || '[]'); } catch(e) { return []; } })(),
        pmAdaDay:      Number(g(row, 'PMAdaDay'))  || '',
        pmAdaBank:     String(g(row, 'PMAdaBank')  || ''),
        pmBtBank:      String(g(row, 'PMBtBank')   || ''),
        pmAutoVoucher: g(row, 'PMAutoVoucher') === 'TRUE' || g(row, 'PMAutoVoucher') === true
      });
    });
    return JSON.stringify({ assets: assets });
  } catch(e) {
    return null;
  }
}

// ─── DEPRECIATION ENGINE ─────────────────────────────────────────────────────

/**
 * Computes the depreciation amount for a single asset in a given month.
 * @param {Object} asset     - Asset object with cost, residualValue, usefulLifeMonths,
 *                             depreciationMethod, computationType, deprecStartDate, status
 * @param {string} monthISO  - "YYYY-MM"
 * @returns {number}
 */
function computeFixedAssetDepreciation_(asset, monthISO) {
  if (!asset || !monthISO) return 0;
  if ((asset.status || 'Active') === 'Disposed') return 0;
  const deprecStart = asset.deprecStartDate ? new Date(asset.deprecStartDate + 'T00:00:00') : null;
  if (!deprecStart || isNaN(deprecStart.getTime())) return 0;

  const cost       = Number(asset.cost)             || 0;
  const residual   = Number(asset.residualValue)    || 0;
  const lifeMonths = Number(asset.usefulLifeMonths) || 0;
  if (lifeMonths <= 0 || cost <= residual) return 0;

  const method   = asset.depreciationMethod || 'Straight Line';
  const compType = asset.computationType   || 'Non Pro Rata';

  const parts       = monthISO.split('-').map(Number);
  const yyyy        = parts[0];
  const mm          = parts[1];
  const periodStart = new Date(yyyy, mm - 1, 1);
  const dsMonthStart = new Date(deprecStart.getFullYear(), deprecStart.getMonth(), 1);

  if (periodStart < dsMonthStart) return 0;

  const periodIndex = (yyyy - deprecStart.getFullYear()) * 12 + (mm - 1 - deprecStart.getMonth());
  if (periodIndex < 0 || periodIndex >= lifeMonths) return 0;

  function fullMonthDepr_(bv) {
    var depreciable = bv - residual;
    if (depreciable <= 0) return 0;
    if (method === 'Straight Line') return (cost - residual) / lifeMonths;
    var multiplier = method === '200 Declining Balance' ? 2 :
                     method === '150 Declining Balance' ? 1.5 : 1;
    var annualRate = multiplier / (lifeMonths / 12);
    return Math.min(bv * (annualRate / 12), depreciable);
  }

  // Accumulate book value to start of this period
  var bookValue = cost;
  for (var i = 0; i < periodIndex; i++) {
    bookValue -= fullMonthDepr_(bookValue);
    if (bookValue < residual) { bookValue = residual; break; }
  }
  if (bookValue <= residual) return 0;

  var depr = fullMonthDepr_(bookValue);

  // Pro Rata: prorate first period by days used in month
  if (compType === 'Pro Rata' && periodIndex === 0) {
    var daysInMonth = new Date(yyyy, mm, 0).getDate();
    var dayOfStart  = deprecStart.getDate();
    depr = depr * ((daysInMonth - dayOfStart + 1) / daysInMonth);
  }

  return Math.round(depr * 100) / 100;
}

/**
 * Generates and posts depreciation journal entries for all active Fixed Assets
 * for the specified month to the Central Journal Lines spreadsheet.
 * Existing FA depreciation entries for the same month are deleted first (idempotent).
 * @param {string} monthISO - "YYYY-MM"
 */
function generateFADepreciationJEs(monthISO) {
  try {
    if (!monthISO || !/^\d{4}-\d{2}$/.test(monthISO)) {
      return { success: false, message: 'Invalid month — use YYYY-MM format.' };
    }
    const user = getActionUser_();
    const rawAssets = loadFixedAssets();
    if (!rawAssets) return { success: false, message: 'No Fixed Assets data found.' };
    const assets = JSON.parse(rawAssets).assets || [];
    if (!assets.length) return { success: false, message: 'No assets defined.' };

    const parts    = monthISO.split('-').map(Number);
    const postDate = new Date(parts[0], parts[1] - 1, 1).toISOString();
    const jeIdBase = 'FA-DEPR-' + monthISO;
    const jLines   = [];
    var   lineNo   = 1;

    assets.forEach(function(asset) {
      var amount = computeFixedAssetDepreciation_(asset, monthISO);
      if (!amount || amount <= 0) return;
      if (!asset.deprecExpenseAccount || !asset.accumDeprecAccount) return;
      var desc = 'Depreciation - ' + asset.name + ' - ' + monthISO;
      var jeId = jeIdBase + '-' + asset.id;
      // DR Depreciation Expense
      jLines.push([jeId, jeId, lineNo++, asset.deprecExpenseAccount, asset.deprecExpenseAccount, desc, '', '', amount, 0, postDate]);
      // CR Accumulated Depreciation
      jLines.push([jeId, jeId, lineNo++, asset.accumDeprecAccount, asset.accumDeprecAccount, desc, '', '', 0, amount, postDate]);
    });

    if (!jLines.length) {
      return { success: true, entriesPosted: 0, message: 'No depreciation amounts for ' + monthISO };
    }

    // Remove previously posted FA depreciation entries for this month (idempotent)
    try {
      const jeSheet = getCentralJournalLinesSheet_();
      const data    = jeSheet.getDataRange().getValues();
      for (var i = data.length - 1; i >= 1; i--) {
        if (String(data[i][1]).indexOf(jeIdBase) === 0) jeSheet.deleteRow(i + 1);
      }
    } catch(ex) {
      Logger.log('FA delete old JEs error: ' + ex.message);
    }

    appendToCentralJournalLines_(jLines, user);
    return { success: true, entriesPosted: jLines.length, month: monthISO };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─── INSTALLMENT AMORTIZATION ENGINE ─────────────────────────────────────────

/**
 * Computes one month's installment amortization breakdown for a single asset.
 * @param {Object} asset    - Asset with installment fields (isInstallment must be 'Yes')
 * @param {string} monthISO - "YYYY-MM"
 * @returns {{ principal: number, interest: number, pmt: number, balance: number } | null}
 */
function computeFA_Installment_(asset, monthISO) {
  if (!asset || asset.isInstallment !== 'Yes') return null;
  if (!monthISO) return null;

  const P    = Number(asset.installmentPrincipal)   || 0;
  const r    = (Number(asset.installmentAnnualRate) || 0) / 100 / 12;
  const term = Number(asset.installmentTermMonths)  || 0;
  if (P <= 0 || term <= 0) return null;

  const startDate = asset.installmentStartDate
    ? new Date(asset.installmentStartDate + 'T00:00:00') : null;
  if (!startDate || isNaN(startDate.getTime())) return null;

  const parts   = monthISO.split('-').map(Number);
  const yyyy    = parts[0];
  const mm      = parts[1];
  const elapsed = (yyyy - startDate.getFullYear()) * 12 + (mm - 1 - startDate.getMonth());
  if (elapsed < 0 || elapsed >= term) return null;

  const method = asset.installmentMethod || 'Reducing Balance';

  var principal, interest, balance;

  if (method === 'Straight-Line') {
    var prinPay = P / term;
    var bal0    = P - prinPay * elapsed;
    principal   = Math.round(prinPay * 100) / 100;
    interest    = Math.round(bal0 * r * 100) / 100;
    balance     = Math.round(Math.max(bal0 - prinPay, 0) * 100) / 100;
  } else {
    // Reducing Balance (PMT)
    if (r === 0) {
      var pp = P / term;
      principal = Math.round(pp * 100) / 100;
      interest  = 0;
      balance   = Math.round(Math.max(P - pp * (elapsed + 1), 0) * 100) / 100;
    } else {
      var pmt    = P * r * Math.pow(1 + r, term) / (Math.pow(1 + r, term) - 1);
      var bal0rb = P * Math.pow(1 + r, elapsed) - pmt * (Math.pow(1 + r, elapsed) - 1) / r;
      interest   = bal0rb * r;
      var pp2    = pmt - interest;
      principal  = Math.round(Math.max(pp2, 0) * 100) / 100;
      interest   = Math.round(Math.max(interest, 0) * 100) / 100;
      balance    = Math.round(Math.max(bal0rb - pp2, 0) * 100) / 100;
    }
  }

  return {
    principal: principal,
    interest:  interest,
    pmt:       Math.round((principal + interest) * 100) / 100,
    balance:   balance
  };
}

/**
 * Generates and posts monthly installment amortization JEs for all installment assets.
 * DR Amortization Expense (installmentAmortizationAccount)  — full PMT
 * CR Installment Payable  (installmentPayableAccount)       — full PMT
 * Existing entries for the same month are removed first (idempotent).
 * @param {string} monthISO - "YYYY-MM"
 */
function generateFA_InstallmentJEs(monthISO) {
  try {
    if (!monthISO || !/^\d{4}-\d{2}$/.test(monthISO)) {
      return { success: false, message: 'Invalid month — use YYYY-MM format.' };
    }
    const user   = getActionUser_();
    const assets = JSON.parse(loadFixedAssets() || '{"assets":[]}').assets || [];
    if (!assets.length) return { success: false, message: 'No assets defined.' };

    const jeIdBase = 'FA-INST-' + monthISO;
    const parts    = monthISO.split('-').map(Number);
    const postDate = new Date(parts[0], parts[1] - 1, 1).toISOString();
    const jLines   = [];
    var   lineNo   = 1;

    assets.forEach(function(asset) {
      if (asset.isInstallment !== 'Yes') return;
      if ((asset.status || 'Active') === 'Disposed') return;
      var d = computeFA_Installment_(asset, monthISO);
      if (!d || d.pmt <= 0) return;
      if (!asset.installmentAmortizationAccount || !asset.installmentPayableAccount) return;

      var jeId = jeIdBase + '-' + asset.id;
      var desc = 'Monthly Amortization - ' + asset.name + ' - ' + monthISO;

      // DR Amortization Expense
      jLines.push([jeId, jeId, lineNo++, asset.installmentAmortizationAccount, asset.installmentAmortizationAccount, desc, '', '', d.pmt, 0, postDate]);
      // CR Installment Payable
      jLines.push([jeId, jeId, lineNo++, asset.installmentPayableAccount, asset.installmentPayableAccount, desc, '', '', 0, d.pmt, postDate]);
    });

    if (!jLines.length) {
      return { success: true, entriesPosted: 0, message: 'No installment amounts for ' + monthISO };
    }

    // Delete prior entries for this month (idempotent)
    try {
      const jeSheet = getCentralJournalLinesSheet_();
      const data    = jeSheet.getDataRange().getValues();
      for (var i = data.length - 1; i >= 1; i--) {
        if (String(data[i][1]).indexOf(jeIdBase) === 0) jeSheet.deleteRow(i + 1);
      }
    } catch(ex) {
      Logger.log('FA Installment delete old JEs error: ' + ex.message);
    }

    appendToCentralJournalLines_(jLines, user);
    return { success: true, entriesPosted: jLines.length, month: monthISO };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

// ─── CHECK REGISTRY ───────────────────────────────────────────────────────────

/**
 * Returns all Checkbook Masters and Check Register rows for the frontend.
 * Auto-creates both sheets with correct headers if they don't exist yet.
 */
function getCheckRegistryData() {
  const cbSheet = getTargetSheet_('CheckbookMaster');
  ensureCheckbookMasterHeaders_(cbSheet);
  const crSheet = getTargetSheet_('CheckRegister');
  ensureCheckRegisterHeaders_(crSheet);

  const checkbooks = getSheetData_('CheckbookMaster').map(r => ({
    checkbookId:     String(r.CheckbookId    || ''),
    bankCode:        String(r.BankCode        || ''),
    startingNumber:  Number(r.StartingNumber  || 0),
    endingNumber:    Number(r.EndingNumber    || 0),
    nextCheckNumber: Number(r.NextCheckNumber || 0),
    isActive:        parseBool_(r.IsActive),
    notes:           String(r.Notes           || ''),
    createdAt:       r.CreatedAt ? new Date(r.CreatedAt).toISOString() : '',
    createdBy:       String(r.CreatedBy       || '')
  }));

  const register = getSheetData_('CheckRegister').map(r => ({
    checkId:       String(r.CheckId       || ''),
    checkbookId:   String(r.CheckbookId   || ''),
    bankCode:      String(r.BankCode      || ''),
    checkNumber:   Number(r.CheckNumber   || 0),
    issueDate:     r.IssueDate   ? new Date(r.IssueDate).toISOString()   : '',
    payeeName:     String(r.PayeeName     || ''),
    amount:        Number(r.Amount        || 0),
    status:        String(r.Status        || 'Issued'),
    referenceType: String(r.ReferenceType || ''),
    referenceId:   String(r.ReferenceId   || ''),
    clearedDate:   r.ClearedDate ? new Date(r.ClearedDate).toISOString() : '',
    voidedDate:    r.VoidedDate  ? new Date(r.VoidedDate).toISOString()  : '',
    voidReason:    String(r.VoidReason    || ''),
    stoppedDate:   r.StoppedDate ? new Date(r.StoppedDate).toISOString() : '',
    createdAt:     r.CreatedAt   ? new Date(r.CreatedAt).toISOString()   : '',
    createdBy:     String(r.CreatedBy     || ''),
    updatedAt:     r.UpdatedAt   ? new Date(r.UpdatedAt).toISOString()   : '',
    updatedBy:     String(r.UpdatedBy     || '')
  }));

  return sanitizeData_({ checkbooks: checkbooks, register: register });
}

/**
 * Creates or updates a Checkbook Master record.
 * Enforces only one active checkbook per BankCode when activating.
 */
function saveCheckbookMaster(payload) {
  const user    = getActionUser_();
  const now     = new Date();
  const sheet   = getTargetSheet_('CheckbookMaster');
  const headers = ensureCheckbookMasterHeaders_(sheet);
  const data    = sheet.getDataRange().getValues();
  const idIdx   = headers.indexOf('CheckbookId');
  const actIdx  = headers.indexOf('IsActive');
  const bankIdx = headers.indexOf('BankCode');
  const isNew   = !payload.checkbookId;
  const checkbookId = isNew ? ('CB-' + now.getTime()) : String(payload.checkbookId);

  // When activating this checkbook, deactivate all others for the same bankCode
  if (parseBool_(payload.isActive)) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][bankIdx]).trim().toUpperCase() === String(payload.bankCode || '').trim().toUpperCase()
          && String(data[i][idIdx]).trim() !== checkbookId) {
        if (actIdx > -1) sheet.getRange(i + 1, actIdx + 1).setValue('FALSE');
      }
    }
  }

  if (isNew) {
    const row = new Array(headers.length).fill('');
    const set_ = (col, val) => { const i = headers.indexOf(col); if (i > -1) row[i] = val; };
    set_('CheckbookId',    checkbookId);
    set_('BankCode',       String(payload.bankCode        || ''));
    set_('StartingNumber', Number(payload.startingNumber  || 0));
    set_('EndingNumber',   Number(payload.endingNumber    || 0));
    set_('NextCheckNumber',Number(payload.nextCheckNumber || payload.startingNumber || 0));
    set_('IsActive',       payload.isActive ? 'TRUE' : 'FALSE');
    set_('Notes',          String(payload.notes           || ''));
    set_('CreatedAt',      now);
    set_('CreatedBy',      user);
    sheet.appendRow(row);
  } else {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]).trim() === checkbookId) {
        const s = (col, val) => { const ci = headers.indexOf(col); if (ci > -1) sheet.getRange(i + 1, ci + 1).setValue(val); };
        s('BankCode',       String(payload.bankCode || ''));
        s('StartingNumber', Number(payload.startingNumber || 0));
        s('EndingNumber',   Number(payload.endingNumber || 0));
        if (payload.nextCheckNumber !== undefined) s('NextCheckNumber', Number(payload.nextCheckNumber));
        s('IsActive',       payload.isActive ? 'TRUE' : 'FALSE');
        s('Notes',          String(payload.notes || ''));
        break;
      }
    }
  }
  return { ok: true, checkbookId: checkbookId };
}

/**
 * Creates a Check Voucher through the Check Registry.
 * Uses LockService.getScriptLock() to prevent concurrent check number assignment.
 */
function createCheckVoucher(payload) {
  const lock     = LockService.getScriptLock();
  const acquired = lock.tryLock(12000);
  if (!acquired) {
    throw new Error('Another user is currently creating a Check Voucher. Please wait a moment and try again.');
  }
  try {
    const user = getActionUser_();
    const now  = new Date();

    // 1. Find the active checkbook for this bank
    const cbSheet  = getTargetSheet_('CheckbookMaster');
    const cbH      = ensureCheckbookMasterHeaders_(cbSheet);
    const cbData   = cbSheet.getDataRange().getValues();
    const cbIdIdx  = cbH.indexOf('CheckbookId');
    const cbBkIdx  = cbH.indexOf('BankCode');
    const cbStIdx  = cbH.indexOf('StartingNumber');
    const cbEndIdx = cbH.indexOf('EndingNumber');
    const cbNxtIdx = cbH.indexOf('NextCheckNumber');
    const cbActIdx = cbH.indexOf('IsActive');

    let cbRowIndex = -1;
    for (let i = 1; i < cbData.length; i++) {
      if (String(cbData[i][cbBkIdx]).trim().toUpperCase() === String(payload.bankCode || '').trim().toUpperCase()
          && String(cbData[i][cbActIdx]).toUpperCase() === 'TRUE') {
        cbRowIndex = i;
        break;
      }
    }
    if (cbRowIndex < 0) {
      throw new Error('No active checkbook found for bank: ' + payload.bankCode
        + '. Please set up a Checkbook in Check Registry \u2192 Checkbook Management first.');
    }

    const checkbookId = String(cbData[cbRowIndex][cbIdIdx]);
    const startNo     = Number(cbData[cbRowIndex][cbStIdx]);
    const endNo       = Number(cbData[cbRowIndex][cbEndIdx]);
    let   nextNo      = Number(cbData[cbRowIndex][cbNxtIdx]);
    if (nextNo < startNo) nextNo = startNo;
    if (nextNo > endNo) {
      throw new Error('Checkbook ' + checkbookId + ' is exhausted (all checks up to #' + endNo
        + ' have been used). Please create a new checkbook.');
    }

    // 2. Assign and immediately increment (burn-safe: counter moves forward before voucher write)
    const assignedCheckNo = nextNo;
    cbSheet.getRange(cbRowIndex + 1, cbNxtIdx + 1).setValue(assignedCheckNo + 1);

    // 3. Write Check Register entry (Status = Issued; ReferenceId back-filled after voucher creation)
    const crSheet  = getTargetSheet_('CheckRegister');
    const crH      = ensureCheckRegisterHeaders_(crSheet);
    const checkId  = 'CHK-' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + '-' + assignedCheckNo;
    let   totalAmt = 0;
    (payload.lines || []).forEach(l => { totalAmt += Number(l.amount || 0); });

    const crRow = new Array(crH.length).fill('');
    const setCr_ = (col, val) => { const ci = crH.indexOf(col); if (ci > -1) crRow[ci] = val; };
    setCr_('CheckId',       checkId);
    setCr_('CheckbookId',   checkbookId);
    setCr_('BankCode',      String(payload.bankCode      || ''));
    setCr_('CheckNumber',   assignedCheckNo);
    setCr_('IssueDate',     payload.issueDate            || now);
    setCr_('PayeeName',     String(payload.payeeName     || payload.contactSummary || ''));
    setCr_('Amount',        totalAmt);
    setCr_('Status',        'Issued');
    setCr_('ReferenceType', String(payload.referenceType || 'AP Voucher'));
    setCr_('ReferenceId',   '');
    setCr_('CreatedAt',     now);
    setCr_('CreatedBy',     user);
    setCr_('UpdatedAt',     now);
    setCr_('UpdatedBy',     user);
    crSheet.appendRow(crRow);
    const checkRegisterRow = crSheet.getLastRow();

    // 4. Create the underlying CHECK voucher (pass _internal=true to bypass the type guard)
    const vPayload = Object.assign({}, payload, {
      voucherType:      'CHECK',
      status:           'Pending',
      globalCheckNo:    payload.isMultipleChecks ? '' : String(assignedCheckNo),
      globalCheckDate:  payload.isMultipleChecks ? '' : (payload.globalCheckDate || payload.issueDate || ''),
      isMultipleChecks: !!payload.isMultipleChecks,
      paymentFrom:      payload.bankCode || '',
      purposeCategory:  payload.purposeCategory || '',
      // Enrich each line with per-line check number when using multiple checks
      lines: (payload.lines || []).map(function(l, idx) {
        return Object.assign({}, l, {
          lineCheckNo:   payload.isMultipleChecks ? (l.lineCheckNumber || '') : String(assignedCheckNo),
          lineCheckDate: payload.isMultipleChecks ? (l.lineCheckDate   || '') : (payload.globalCheckDate || payload.issueDate || ''),
          taxType:       l.taxType    || 'N/A',
          isInclusive:   !!l.isInclusive,
          ewtRate:       Number(l.ewtRate || 0),
          contact:       l.contact    || payload.payeeName || '',
          expenseAccount: l.expenseAccountCode || l.expenseAccount || ''
        });
      })
    });
    const result = createVoucher(vPayload, true);

    // 5. Back-fill the ReferenceId in the Check Register row
    const refIdx = crH.indexOf('ReferenceId');
    if (refIdx > -1 && checkRegisterRow >= 2) {
      crSheet.getRange(checkRegisterRow, refIdx + 1).setValue(result.voucherId);
    }

    return sanitizeData_({
      ok: true,
      voucherId: result.voucherId,
      checkId: checkId,
      checkNumber: assignedCheckNo
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Registers a single check into the Check Register from an external module
 * (Financial Management, Fixed Assets, or Payment Schedule).
 * Lighter than createCheckVoucher — no AP Voucher is created.
 *
 * Payload:
 *   bankCode      {string}  — must match an active Checkbook
 *   checkNumber   {number}  — if 0 / missing, assigns next from the active checkbook
 *   checkDate     {string}  — YYYY-MM-DD
 *   amount        {number}
 *   referenceId   {string}  — e.g. 'FINC-5', 'FA-abc123', 'PS_1234567890'
 *   referenceType {string}  — 'Loan Payment', 'Asset Installment', 'Payment Schedule'
 *   payeeName     {string}
 */
function registerCheckFromModule(payload) {
  const lock     = LockService.getScriptLock();
  const acquired = lock.tryLock(12000);
  if (!acquired) throw new Error('Another check operation is in progress. Please wait a moment and try again.');
  try {
    const user = getActionUser_();
    const now  = new Date();

    // 1. Find the active checkbook for this bank
    const cbSheet  = getTargetSheet_('CheckbookMaster');
    const cbH      = ensureCheckbookMasterHeaders_(cbSheet);
    const cbData   = cbSheet.getDataRange().getValues();
    const cbBkIdx  = cbH.indexOf('BankCode');
    const cbIdIdx  = cbH.indexOf('CheckbookId');
    const cbStIdx  = cbH.indexOf('StartingNumber');
    const cbEndIdx = cbH.indexOf('EndingNumber');
    const cbNxtIdx = cbH.indexOf('NextCheckNumber');
    const cbActIdx = cbH.indexOf('IsActive');

    let cbRowIndex = -1;
    for (let i = 1; i < cbData.length; i++) {
      if (String(cbData[i][cbBkIdx]).trim().toUpperCase() === String(payload.bankCode || '').trim().toUpperCase()
          && String(cbData[i][cbActIdx]).toUpperCase() === 'TRUE') {
        cbRowIndex = i;
        break;
      }
    }
    if (cbRowIndex < 0) {
      throw new Error('No active checkbook found for bank: ' + payload.bankCode
        + '. Please set up a Checkbook in Check Registry → Checkbook Management first.');
    }

    const checkbookId = String(cbData[cbRowIndex][cbIdIdx]);
    const startNo     = Number(cbData[cbRowIndex][cbStIdx]);
    const endNo       = Number(cbData[cbRowIndex][cbEndIdx]);
    let   nextNo      = Number(cbData[cbRowIndex][cbNxtIdx]);
    if (nextNo < startNo) nextNo = startNo;

    // Use provided checkNumber if valid and within range; otherwise assign next
    let assignedCheckNo = Number(payload.checkNumber || 0);
    if (!assignedCheckNo || assignedCheckNo < startNo || assignedCheckNo > endNo) {
      if (nextNo > endNo) {
        throw new Error('Checkbook ' + checkbookId + ' is exhausted (all checks up to #' + endNo
          + ' have been used). Please create a new checkbook.');
      }
      assignedCheckNo = nextNo;
    }

    // Advance nextCheckNumber
    cbSheet.getRange(cbRowIndex + 1, cbNxtIdx + 1).setValue(assignedCheckNo + 1);

    // 2. Write Check Register entry
    const crSheet  = getTargetSheet_('CheckRegister');
    const crH      = ensureCheckRegisterHeaders_(crSheet);
    const checkId  = 'CHK-' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + '-' + assignedCheckNo;

    const crRow = new Array(crH.length).fill('');
    const setCr_ = (col, val) => { const ci = crH.indexOf(col); if (ci > -1) crRow[ci] = val; };
    setCr_('CheckId',       checkId);
    setCr_('CheckbookId',   checkbookId);
    setCr_('BankCode',      String(payload.bankCode      || ''));
    setCr_('CheckNumber',   assignedCheckNo);
    setCr_('IssueDate',     payload.checkDate || payload.issueDate || now);
    setCr_('PayeeName',     String(payload.payeeName     || ''));
    setCr_('Amount',        Number(payload.amount        || 0));
    setCr_('Status',        'Issued');
    setCr_('ReferenceType', String(payload.referenceType || 'Loan Payment'));
    setCr_('ReferenceId',   String(payload.referenceId   || ''));
    setCr_('CreatedAt',     now);
    setCr_('CreatedBy',     user);
    setCr_('UpdatedAt',     now);
    setCr_('UpdatedBy',     user);
    crSheet.appendRow(crRow);

    return sanitizeData_({ ok: true, checkId: checkId, checkNumber: assignedCheckNo });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Updates the lifecycle status of a check in the Check Register.
 * Allowed newStatus values: "Cleared", "Voided", "Stopped", "Stale"
 */
function updateCheckStatus(payload) {
  if (!payload.checkId)   throw new Error('checkId is required.');
  if (!payload.newStatus) throw new Error('newStatus is required.');
  if (payload.newStatus === 'Voided' && !payload.voidReason) {
    throw new Error('A void reason is required when voiding a check.');
  }

  const user  = getActionUser_();
  const now   = new Date();
  const sheet = getTargetSheet_('CheckRegister');
  const h     = ensureCheckRegisterHeaders_(sheet);
  const data  = sheet.getDataRange().getValues();

  const idx = (col) => h.indexOf(col);
  let foundRow        = -1;
  let linkedVoucherId = '';

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx('CheckId')]).trim() === String(payload.checkId).trim()) {
      foundRow        = i + 1;
      linkedVoucherId = String(data[i][idx('ReferenceId')] || '');
      break;
    }
  }
  if (foundRow < 0) throw new Error('Check ID not found: ' + payload.checkId);

  const set = (col, val) => { const ci = idx(col); if (ci > -1) sheet.getRange(foundRow, ci + 1).setValue(val); };
  set('Status',    payload.newStatus);
  set('UpdatedAt', now);
  set('UpdatedBy', user);

  if (payload.newStatus === 'Cleared') {
    set('ClearedDate', payload.clearedDate ? new Date(payload.clearedDate) : now);
    if (linkedVoucherId) {
      try { updateVoucherStatus(linkedVoucherId, 'Paid'); }
      catch(e) { Logger.log('updateCheckStatus Cleared voucher: ' + e.message); }
    }
  } else if (payload.newStatus === 'Voided') {
    set('VoidedDate', now);
    set('VoidReason', payload.voidReason);
    if (linkedVoucherId) {
      try { updateVoucherStatus(linkedVoucherId, 'Pending'); }
      catch(e) { Logger.log('updateCheckStatus Voided voucher: ' + e.message); }
    }
  } else if (payload.newStatus === 'Stopped') {
    set('StoppedDate', now);
  }

  return { ok: true };
}

/**
 * Scans CheckRegister for "Issued" checks older than 180 days and flags them "Stale".
 * Wire to a daily Time-driven Apps Script trigger.
 */
function flagStaleChecks() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 180);
  const sheet     = getTargetSheet_('CheckRegister');
  const h         = ensureCheckRegisterHeaders_(sheet);
  const data      = sheet.getDataRange().getValues();
  if (data.length < 2) return { flagged: 0 };
  const statusIdx = h.indexOf('Status');
  const dateIdx   = h.indexOf('IssueDate');
  const updAtIdx  = h.indexOf('UpdatedAt');
  const updByIdx  = h.indexOf('UpdatedBy');
  let   flagged   = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][statusIdx]).trim() !== 'Issued') continue;
    const issueDate = new Date(data[i][dateIdx]);
    if (isNaN(issueDate.getTime()) || issueDate > cutoff) continue;
    sheet.getRange(i + 1, statusIdx + 1).setValue('Stale');
    if (updAtIdx > -1) sheet.getRange(i + 1, updAtIdx + 1).setValue(new Date());
    if (updByIdx > -1) sheet.getRange(i + 1, updByIdx + 1).setValue('system-autoflag');
    flagged++;
  }
  Logger.log('flagStaleChecks: flagged ' + flagged + ' check(s).');
  return { flagged: flagged };
}
