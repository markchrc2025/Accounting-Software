/**
 * WORKSCALE PAYROLL - MAIN BACKEND
 * Handles Excel file archiving, Raw Data consolidation, and caching Consolidated Books.
 */

// --- CONFIGURATION ---
const PAYROLL_ARCHIVE_FOLDER_ID = '13lC6v8KC_450vne_LRxAJVUHg-o3759U'; // HRIS Raw Data repository folder
const PAYROLL_DB_SHEET_ID = '1CHPOJo0LzQISnMfg6GhFSaF00bqDEWhIKli7leKPaZA'; 
const PAYSHEETS_FOLDER_ID = '1tgndNGsz11cLX75Gplllw3YfozibRo1k';
const CENTRAL_JOURNAL_ID  = '1e7ixGvLABB8iRZBwASqWILL9DG4jpVxBYuOoeIv4tvE';
const DISBURSEMENT_DB_ID  = '1qVExR4Z0SYR-46-7YwHr48SGnVvMlSKiSsO2kV4yHz0';
const CENTRAL_SETTINGS_ID = '1TueoeHavaK4lrNuWiZN_2TqcyoVev-3Ma-d3HEGGvdk';
const YEARLY_DB_FOLDER_ID = '168AJ_zd24Ms2x8ViPhEUjZ3Qle0WugE-';
const WRI_EMPLOYEE_MASTERLIST_ID = '13QOgFiROvcXny_P30mU13AW4fTB-DB7MWAKj6X45BFo';
const BIR2316_TEMPLATE_PDF_ID    = '1uUDxjsNQ0OsE7tATvu-b8FjXYhyE-AVq';
const WRI_MASTERLIST_SHEET_NAME  = 'Masterlist';
const WRI_ML_HEADERS    = [
  'userid','first_name','middlename','last_name','accountnumber','workregion',
  'employmenttype','employer','companyname','employeestatus',
  'regulardayrate',                                      // index 10 — NEW
  'salarystatus','finalpaystatus',                       // shifted +1
  'last_seen_cutoffend','hiringdate','separationdate','last_modified',
  'tin','rdo_code','address','address_zip',              // BIR cols absorbed (formerly dynamic)
  'local_address','local_address_zip',
  'date_of_birth','contact_number','nationality',
  'smw_monthly','is_mwe','is_substituted_filing',
  'branch','department','work_location','position','level' // indices 29–33 — Org fields
];
const WRI_13M_SHEET     = '13MDetails';
const WRI_DEMIN_SHEET   = 'DeminimisDetails';
const WRI_13M_COLS      = ['Batch ID','Upload Date','Uploaded By','Source File','id','userid','cutoffstart','cutoffend','totaldays','first_name','middlename','last_name','nthmonthpaybillable','basicsalary','name','companyname'];
const WRI_DEMIN_COLS    = [
  'Batch ID','Upload Date','Uploaded By','Source File',
  'userid','first_name','middlename','last_name','companyname',
  'cutoffstart','cutoffend',
  'rice_subsidy','clothing','medical_cash','laundry',
  'daily_meal','transport','meal','housing','other_benefits',
  'total_deminimis','billable_total','nonbillable_total'
];
const FINAL_APPROVER_EMAIL = 'workscale.finance@gmail.com';
const WORKFLOW_COLS = ['SubmittedBy','SubmittedAt','ReviewedBy','ReviewedAt','ReviewNote','FinalApprovedBy','FinalApprovedAt','FinalApproveNote','ReturnedBy','ReturnedAt','ReturnNote','ApproverType'];
const ATD_FOLDER_ID = '1svQoMpCYVrkWgaCtmmVPn6kOMu6t2H7o';

/**
 * Returns true if the salary status indicates a physical check payment.
 * These employees are included in disbursement but excluded from BPI/UB bank
 * uploads and are not charged the ₱50 inter-bank fee.
 */
function isCheckPayment_(status) {
  const s = String(status || '').toUpperCase().trim();
  return s === 'FOR RELEASE-CHECK' || s.includes('-CHECK');
}

function doGet(e) {
  const email = Session.getEffectiveUser().getEmail();
  if (!checkUserAccess_(email)) {
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;flex-direction:column;gap:10px;">'
      + '<div style="font-size:48px;">🔒</div>'
      + '<h2 style="margin:0;">Access Denied</h2>'
      + '<p style="color:#666;margin:0;">Your account (<strong>' + email + '</strong>) is not authorized to use this application.</p>'
      + '<p style="color:#999;font-size:12px;margin:0;">Please contact your system administrator.</p>'
      + '</body></html>'
    ).setTitle('Access Denied');
  }
  const html = HtmlService.createTemplateFromFile('payroll_index');
  html.userEmail = email ? email : 'Unknown User';
  return html.evaluate()
    .setTitle('Workscale Payroll Processor')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function checkUserAccess_(email) {
  if (!email) return false;
  try {
    const ss = SpreadsheetApp.openById(CENTRAL_SETTINGS_ID);
    const sheet = ss.getSheetByName('Users');
    if (!sheet) return true; // bootstrap
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return true; // bootstrap
    const h = data[0].map(c => String(c).trim().toLowerCase());
    const eIdx = h.indexOf('email');
    const mIdx = h.findIndex(c => c.includes('module'));
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][eIdx]).trim().toLowerCase() !== email.toLowerCase()) continue;
      if (mIdx === -1) return true;
      const mods = String(data[i][mIdx] || '').split(',').map(m => m.trim().toLowerCase());
      return mods.includes('payroll');
    }
    return false;
  } catch(e) { return true; }
}

function getPayrollDB_() {
  try {
    return SpreadsheetApp.openById(PAYROLL_DB_SHEET_ID);
  } catch (e) {
    throw new Error('You do not have permission to access the Payroll Database spreadsheet. Please contact your administrator to grant you Editor access to the database.');
  }
}

// =====================================================================
// USER & ROLES MANAGEMENT — reads/writes Central Settings
// =====================================================================

function getCentralSS_() {
  return SpreadsheetApp.openById(CENTRAL_SETTINGS_ID);
}

function getCentralUsersSheet_() {
  const sheet = getCentralSS_().getSheetByName('Users');
  if (!sheet) throw new Error('Users sheet not found in Central Settings.');
  return sheet;
}

function getCentralUsersData_() {
  const sheet = getCentralUsersSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { sheet, h: data[0] || [], rows: [] };
  const h = data[0].map(c => String(c).trim());
  const rows = data.slice(1).filter(r => String(r[h.indexOf('Email')] || '').trim());
  return { sheet, h, rows };
}

function getUsersList() {
  const { h, rows } = getCentralUsersData_();
  const eIdx = h.indexOf('Email'), nIdx = h.indexOf('Full Name'), rIdx = h.indexOf('Role'),
        wIdx = h.indexOf('Work Email'), mIdx = h.indexOf('Modules'), sIdx = h.indexOf('Signature URL');
  return rows.map(r => ({
    email:        String(r[eIdx] || '').trim(),
    fullName:     String(r[nIdx] || '').trim(),
    roles:        String(r[rIdx] || '').split(',').map(s => s.trim()).filter(Boolean),
    workEmail:    String(r[wIdx] || '').trim(),
    moduleAccess: String(r[mIdx] || '').split(',').map(s => s.trim()).filter(Boolean),
    signatureUrl: String(r[sIdx] || '').trim(),
  }));
}

function getCurrentUserAccess() {
  const email = Session.getEffectiveUser().getEmail();
  const users = getUsersList();
  const user = users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user) return null;
  return {
    email:        user.email,
    fullName:     user.fullName,
    roles:        user.roles,
    moduleAccess: user.moduleAccess || [],
    workEmail:    user.workEmail,
    signatureUrl: user.signatureUrl,
    isAdmin:      user.roles.includes('Admin'),
    isReviewer:   user.roles.includes('Reviewer'),
    isApprover:   user.roles.includes('Approver'),
  };
}

function saveUser(payload) {
  const callerEmail = Session.getEffectiveUser().getEmail();
  const callerAccess = getCurrentUserAccess();
  if (!callerAccess || !callerAccess.isAdmin)
    throw new Error('Only Admins can manage users.');
  const { email, fullName, roles, workEmail, signatureUrl, isNew, moduleAccess } = payload;
  if (!email || !fullName || !roles || roles.length === 0)
    throw new Error('Email, Full Name, and at least one Role are required.');
  const { sheet, h, rows } = getCentralUsersData_();
  const eIdx = h.indexOf('Email'), nIdx = h.indexOf('Full Name'), rIdx = h.indexOf('Role'),
        wIdx = h.indexOf('Work Email'), mIdx = h.indexOf('Modules'), sIdx = h.indexOf('Signature URL');
  const roleStr = (Array.isArray(roles) ? roles : [roles]).join(', ');
  // Build final module access — always includes Payroll; preserves any unmanaged modules
  const managed = ['Payroll','Disbursement','Accounting','Billing'];
  const buildMods = (existingStr) => {
    const base = String(existingStr || '').split(',').map(m => m.trim()).filter(Boolean);
    const incoming = Array.isArray(moduleAccess) ? moduleAccess : [];
    const unmanaged = base.filter(m => !managed.map(x => x.toLowerCase()).includes(m.toLowerCase()));
    const merged = [...new Set([...unmanaged, ...incoming])];
    if (!merged.map(m => m.toLowerCase()).includes('payroll')) merged.push('Payroll');
    return merged.join(', ');
  };
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][eIdx]).trim().toLowerCase() === email.toLowerCase()) {
      if (isNew) throw new Error('A user with this email already exists.');
      const rowNum = i + 2; // +1 for header, +1 for 1-based
      sheet.getRange(rowNum, nIdx + 1).setValue(fullName);
      sheet.getRange(rowNum, rIdx + 1).setValue(roleStr);
      sheet.getRange(rowNum, wIdx + 1).setValue(workEmail || '');
      sheet.getRange(rowNum, mIdx + 1).setValue(buildMods(rows[i][mIdx]));
      if (signatureUrl) sheet.getRange(rowNum, sIdx + 1).setValue(signatureUrl);
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

function deleteUser(emailToDelete) {
  const currentEmail = Session.getEffectiveUser().getEmail();
  const callerAccess = getCurrentUserAccess();
  if (!callerAccess || !callerAccess.isAdmin)
    throw new Error('Only Admins can manage users.');
  if (emailToDelete.toLowerCase() === currentEmail.toLowerCase())
    throw new Error('You cannot delete your own account.');
  const { sheet, h, rows } = getCentralUsersData_();
  const eIdx = h.indexOf('Email'), rIdx = h.indexOf('Role');
  let adminCount = 0, targetRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const rowRoles = String(rows[i][rIdx] || '').split(',').map(s => s.trim().toLowerCase());
    if (rowRoles.includes('admin')) adminCount++;
    if (String(rows[i][eIdx]).trim().toLowerCase() === emailToDelete.toLowerCase()) targetRow = i + 2;
  }
  if (targetRow === -1) throw new Error('User not found.');
  const targetRoles = String(rows[targetRow - 2][rIdx] || '').split(',').map(s => s.trim().toLowerCase());
  if (targetRoles.includes('admin') && adminCount <= 1)
    throw new Error('Cannot delete the last Admin user.');
  sheet.deleteRow(targetRow);
  return { ok: true };
}

function uploadSignatureImage(payload) {
  const { email, base64Data, mimeType, fileName } = payload;
  if (!email || !base64Data) throw new Error('Email and image data are required.');
  const ext = (mimeType || 'image/png').split('/')[1] || 'png';
  const safeName = 'sig_' + email.replace(/[^a-z0-9]/gi, '_') + '.' + ext;
  const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, safeName);
  const parent = DriveApp.getFolderById(PAYSHEETS_FOLDER_ID);
  const iter = parent.getFoldersByName('Signatures');
  const sigFolder = iter.hasNext() ? iter.next() : parent.createFolder('Signatures');
  const old = sigFolder.getFilesByName(safeName);
  while (old.hasNext()) old.next().setTrashed(true);
  const file = sigFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = 'https://drive.google.com/file/d/' + file.getId() + '/view?usp=sharing';
  // Persist URL to Central Settings Users sheet
  const { sheet, h, rows } = getCentralUsersData_();
  const eIdx = h.indexOf('Email'), sIdx = h.indexOf('Signature URL');
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][eIdx]).trim().toLowerCase() === email.toLowerCase()) {
      sheet.getRange(i + 2, sIdx + 1).setValue(url); break;
    }
  }
  return { ok: true, url: url };
}

function getVoucherIdSettings() {
  const s = {};
  const centralSS = SpreadsheetApp.openById(CENTRAL_SETTINGS_ID);
  const progSheet = centralSS.getSheetByName('Modules');
  const seqSheet  = centralSS.getSheetByName('Sequence');
  if (progSheet) {
    const d = progSheet.getDataRange().getValues();
    d.slice(1).forEach(r => { const k = String(r[0]||'').trim(); if(k) s[k] = r[1]; });
  }
  if (seqSheet) {
    const d = seqSheet.getDataRange().getValues();
    d.slice(1).forEach(r => { const k = String(r[0]||'').trim(); if(k) s[k] = r[1]; });
  }
  const parseBool = (v) => String(v).toUpperCase() === 'TRUE';
  const getCfg = (type) => ({
    prefix:       s[`${type}_PREFIX`] !== undefined ? s[`${type}_PREFIX`] : type.substring(0,3),
    includeYear:  s['INCLUDE_YEAR']  !== undefined ? parseBool(s['INCLUDE_YEAR'])  : true,
    includeMonth: s['INCLUDE_MONTH'] !== undefined ? parseBool(s['INCLUDE_MONTH']) : true,
    startSeq:     Number(s[`STARTING_SEQUENCE_${type}`] || 1)
  });
  return {
    raw:        s,
    PAYROLL:    getCfg('PAYROLL'),
    FINAL_PAY:  getCfg('FINAL_PAY'),
    INCENTIVES: getCfg('INCENTIVES'),
    IS:         getCfg('IS'),
    ROUTING: {
      reviewerName:  s['REVIEWER_NAME']  || '',
      reviewerEmail: s['REVIEWER_EMAIL'] || '',
      approverName:  s['APPROVER_NAME']  || '',
      approverEmail: s['APPROVER_EMAIL'] || '',
      notedByName:   s['NOTED_BY_NAME']  || ''
    },
    BIR2316: {
      companyName:         s['BIR2316_COMPANY_NAME']          || '',
      companyTin:          s['BIR2316_COMPANY_TIN']           || '',
      companyAddress:      s['BIR2316_COMPANY_ADDRESS']       || '',
      companyZip:          s['BIR2316_COMPANY_ZIP']           || '',
      authorizedSignatory: s['BIR2316_AUTHORIZED_SIGNATORY']  || ''
    },
    INCOME_TAX: (function() {
      var ns = function(k, def) { return (s[k] !== undefined && s[k] !== '') ? Number(s[k]) : def; };
      return {
        cap13th:        ns('INCOMETAX_CAP_13TH', 90000),
        rice_subsidy:   ns('INCOMETAX_DEMIN_RICE_SUBSIDY', 24000),
        clothing:       ns('INCOMETAX_DEMIN_CLOTHING', 6000),
        medical_cash:   ns('INCOMETAX_DEMIN_MEDICAL_CASH', 10000),
        laundry:        ns('INCOMETAX_DEMIN_LAUNDRY', 3600),
        daily_meal:     ns('INCOMETAX_DEMIN_DAILY_MEAL', 0),
        transport:      ns('INCOMETAX_DEMIN_TRANSPORT', 0),
        meal:           ns('INCOMETAX_DEMIN_MEAL', 0),
        housing:        ns('INCOMETAX_DEMIN_HOUSING', 0),
        other_benefits: ns('INCOMETAX_DEMIN_OTHER_BENEFITS', 0)
      };
    })()
  };
}

function saveSettingsBulk(updates) {
  const centralSS = SpreadsheetApp.openById(CENTRAL_SETTINGS_ID);
  const progSheet = centralSS.getSheetByName('Modules');
  const seqSheet  = centralSS.getSheetByName('Sequence');
  const writeToSheet = (sheet, upd) => {
    const data = sheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      const key = data[i][0];
      if (upd.hasOwnProperty(key)) { sheet.getRange(i+1,2).setValue(upd[key]); delete upd[key]; }
    }
    for (const key in upd) sheet.appendRow([key, upd[key]]);
  };
  const seqUpdates = {}, progUpdates = {};
  for (const key in updates) {
    if (key.startsWith('SEQ_') || key.startsWith('STARTING_SEQUENCE_')) seqUpdates[key] = updates[key];
    else progUpdates[key] = updates[key];
  }
  if (Object.keys(progUpdates).length > 0) writeToSheet(progSheet, progUpdates);
  if (Object.keys(seqUpdates).length > 0)  writeToSheet(seqSheet, seqUpdates);
  return true;
}

function standardizeDateStr_(val) {
    if (!val) return '';
    if (typeof val === 'number' && val > 20000) {
        const d = new Date(Math.round((val - 25569) * 86400 * 1000));
        d.setMinutes(d.getMinutes() + d.getTimezoneOffset());
        return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy');
    }
    if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'MM/dd/yyyy');
    const d = new Date(val);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy');
    return String(val).trim();
}

function normalizeColName_(h) {
    return String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatRawLinesSheet_(ss, fromRow, numRows) {
    const rawSheet = ss.getSheetByName('PayrollLines');
    if (!rawSheet) return;
    const lastRow = rawSheet.getLastRow();
    const maxCols = rawSheet.getLastColumn();
    if (lastRow < 2 || maxCols < 1) return;

    // Only format the specified rows (newly inserted). If called without
    // range args fall back to last 200 rows to avoid OOM on large sheets.
    const startRow = (fromRow && fromRow >= 2) ? fromRow : Math.max(2, lastRow - 199);
    const count    = (numRows && numRows > 0)  ? numRows : (lastRow - startRow + 1);
    if (count < 1) return;

    const headers = rawSheet.getRange(1, 1, 1, maxCols).getValues()[0];
    const rowFmt = [];
    headers.forEach(h => {
        const lowerH = String(h).toLowerCase().trim();
        if (lowerH.includes('amount') || lowerH.includes('rate') || lowerH.includes('salary') || lowerH.includes('pay') || lowerH.includes('deduction') || lowerH.includes('contribution') || lowerH.includes('hours') || lowerH.includes('mins') || lowerH.includes('total') || lowerH.includes('incentives') || lowerH.includes('duty') || lowerH === 'nd' || lowerH.includes('ot') || lowerH.includes('absent')) {
             rowFmt.push('0.00'); 
        } else if (lowerH.includes('cutoff') || lowerH.includes('date') || lowerH.includes('verifiedat')) {
             rowFmt.push('mm/dd/yyyy');
        } else {
             rowFmt.push('@'); 
        }
    });

    const formats = Array.from({length: count}, () => rowFmt);
    rawSheet.getRange(startRow, 1, count, maxCols).setNumberFormats(formats);
}

function getYearlySpreadsheet_(year) {
    let safeYear = parseInt(year, 10);
    if (isNaN(safeYear) || safeYear < 2000 || safeYear > 2100) {
        safeYear = new Date().getFullYear();
    }

    // Lock prevents concurrent calls from creating duplicate spreadsheets
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);

    try {
    const ss = getPayrollDB_();
    let regSheet = ss.getSheetByName('YearlyDatabases');
    if (!regSheet) {
        regSheet = ss.insertSheet('YearlyDatabases');
        regSheet.appendRow(['Year', 'SpreadsheetID', 'URL']);
        regSheet.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#f3f4f6");
    }
    
    const data = regSheet.getDataRange().getValues();

    // Collect ALL valid candidates for this year
    const candidates = [];
    const scanErrors = [];
    for (let i = 1; i < data.length; i++) {
        if (Number(data[i][0]) !== safeYear && String(data[i][0]).trim() !== String(safeYear)) continue;
        try {
            const fileId = String(data[i][1]).trim();
            if (!fileId) { scanErrors.push('Row ' + (i+1) + ': empty SpreadsheetID'); continue; }
            const existingSS = SpreadsheetApp.openById(fileId);
            candidates.push({ fileId, existingSS });
        } catch(e) {
            scanErrors.push('Row ' + (i+1) + ' (ID: ' + data[i][1] + '): ' + e.message);
        }
    }

    if (candidates.length > 0) {
        // Pick the candidate with the most rows in PayrollLines (handles duplicates)
        let chosen = candidates[0];
        let maxRows = 0;
        for (const c of candidates) {
            const pl = c.existingSS.getSheetByName('PayrollLines');
            const rows = pl ? pl.getLastRow() : 0;
            if (rows > maxRows) { maxRows = rows; chosen = c; }
        }
        return chosen.existingSS;
    }

    // No registered spreadsheet found for this year — do NOT auto-create.
    // Register one manually in the YearlyDatabases sheet.
    const errDetail = scanErrors.length ? ' Errors: ' + scanErrors.join('; ') : ' No rows matched year ' + safeYear + ' in YearlyDatabases (sheet has ' + (data.length - 1) + ' data rows).';
    throw new Error('No yearly database found for ' + safeYear + '.' + errDetail);
    } finally {
        lock.releaseLock();
    }
}

// =====================================================================
// 1. RAW DATA UPLOAD & CONSOLIDATION
// =====================================================================

/**
 * Uploads a file to a Drive folder using the REST API v3 (multipart upload).
 * This bypasses DriveApp entirely, avoiding "We're sorry" service errors.
 * Returns the webViewLink of the created file.
 */
function archiveFileToFolderRest_(folderId, archiveName, mimeType, decodedBytes) {
  var b64Data  = Utilities.base64Encode(decodedBytes);
  var metadata = JSON.stringify({ name: archiveName, parents: [folderId] });
  var boundary = 'hris_archive_boundary';
  var body = '--' + boundary + '\r\n'
           + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
           + metadata + '\r\n'
           + '--' + boundary + '\r\n'
           + 'Content-Type: ' + mimeType + '\r\n'
           + 'Content-Transfer-Encoding: base64\r\n\r\n'
           + b64Data + '\r\n'
           + '--' + boundary + '--';
  var resp = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      contentType: 'multipart/related; boundary=' + boundary,
      payload: body,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    }
  );
  var code   = resp.getResponseCode();
  var result = JSON.parse(resp.getContentText());
  if (code === 200 || code === 201) {
    return result.webViewLink || ('https://drive.google.com/file/d/' + result.id + '/view');
  }
  throw new Error('Drive REST upload HTTP ' + code + ': ' + resp.getContentText().substring(0, 300));
}

/**
 * Run this function directly from the Apps Script editor (Run → testDriveArchive)
 * to verify that the archive Drive folder is accessible and writable.
 * Check the Execution Log for the result.
 */
function testDriveArchive() {
  if (!PAYROLL_ARCHIVE_FOLDER_ID || PAYROLL_ARCHIVE_FOLDER_ID === 'YOUR_DRIVE_FOLDER_ID_HERE') {
    Logger.log('ERROR: PAYROLL_ARCHIVE_FOLDER_ID is not set.');
    return 'ERROR: PAYROLL_ARCHIVE_FOLDER_ID is not set.';
  }
  try {
    var bytes = Utilities.newBlob('archive test').getBytes();
    var url = archiveFileToFolderRest_(PAYROLL_ARCHIVE_FOLDER_ID, 'TEST_archive_access.txt', 'text/plain', bytes);
    Logger.log('SUCCESS: ' + url);
    // Clean up the test file
    try {
      var idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (idMatch) DriveApp.getFileById(idMatch[1]).setTrashed(true);
    } catch(e) {}
    return 'SUCCESS: ' + url;
  } catch(e) {
    Logger.log('testDriveArchive ERROR: ' + e.message);
    return 'ERROR: ' + e.message;
  }
}

function processPayrollRun(payload) {
  let fileUrl = '';  // declared outside try so the outer catch can trash it on any failure
  try {
    let { fileBase64, fileName, mimeType, rawData, batchOverride } = payload;
    const user = Session.getEffectiveUser().getEmail();
    const timestamp = new Date();
    
    const batchId = batchOverride || "RAW-" + Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");

    // Archive is MANDATORY — if this fails, the entire upload is aborted.
    // Nothing is written to PayrollLines, HRISRawData, or WRI sheets.
    if (PAYROLL_ARCHIVE_FOLDER_ID && PAYROLL_ARCHIVE_FOLDER_ID !== 'YOUR_DRIVE_FOLDER_ID_HERE') {
      const safeMime = (mimeType && mimeType.trim()) ? mimeType.trim()
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const decodedData = Utilities.base64Decode(fileBase64);
      const archiveName = batchId + '_' + fileName;
      // Use Drive REST API — requires Drive API enabled in GCP project.
      // If this throws, the outer catch will propagate the error to the frontend.
      fileUrl = archiveFileToFolderRest_(PAYROLL_ARCHIVE_FOLDER_ID, archiveName, safeMime, decodedData);
      Logger.log('Archive SUCCESS: ' + fileUrl);
    }

    if (rawData && rawData.length > 0) {
      rawData = rawData.filter(r => {
         const idKey = Object.keys(r).find(k => normalizeColName_(k) === 'id');
         if (idKey) return String(r[idKey]).trim() !== '';
         return true; 
      });

      if (rawData.length === 0) return { success: true, batchId: batchId, fileUrl: fileUrl, rowsProcessed: 0 };

      rawData.forEach(r => { if (r['FileName'] === undefined) r['FileName'] = fileName; });

      let batchYear = new Date().getFullYear();
      const kEnd = Object.keys(rawData[0]).find(k => normalizeColName_(k) === 'cutoffend');
      if (kEnd && rawData[0][kEnd]) {
          let dStr = rawData[0][kEnd];
          if (typeof dStr === 'number') dStr = new Date(Math.round((dStr - 25569) * 86400 * 1000));
          const d = new Date(dStr);
          if (!isNaN(d.getTime())) batchYear = d.getFullYear();
      }

      const targetSS = getYearlySpreadsheet_(batchYear);
      let rawSheet = targetSS.getSheetByName('PayrollLines');
      // Create sheet if it doesn't exist yet in this year's spreadsheet
      if (!rawSheet) rawSheet = targetSS.insertSheet('PayrollLines');
      let existingHeaders = rawSheet.getLastColumn() > 0
          ? rawSheet.getRange(1, 1, 1, rawSheet.getLastColumn()).getValues()[0]
          : [];
      let normExisting = existingHeaders.map(normalizeColName_);
      let headersAdded = false;

      const currentFileHeaders = Object.keys(rawData[0]);
      currentFileHeaders.forEach(header => {
        const normH = normalizeColName_(header);
        if (!normExisting.includes(normH)) {
          existingHeaders.push(header);
          normExisting.push(normH);
          headersAdded = true;
        }
      });

      // Always ensure metadata columns exist — they are never present in the
      // raw Excel file but must be stored so HRIS Data List can read them.
      ['BatchID', 'UploadDate', 'UploadedBy', 'SourceFile'].forEach(function(mc) {
        if (!normExisting.includes(normalizeColName_(mc))) {
          existingHeaders.push(mc);
          normExisting.push(normalizeColName_(mc));
          headersAdded = true;
        }
      });

      if (headersAdded) {
          rawSheet.getRange(1, 1, 1, existingHeaders.length).setValues([existingHeaders]);
      }

      const findColIdx = (name) => normExisting.indexOf(normalizeColName_(name));

      if (rawSheet.getLastRow() > 1) {
         const eIdIdx    = findColIdx('id');
         const eStartIdx = findColIdx('cutoffstart');
         const eEndIdx   = findColIdx('cutoffend');

         if (eIdIdx > -1 && eStartIdx > -1 && eEndIdx > -1) {
             const incomingKeys = new Set();
             rawData.forEach(r => {
                 const kId    = Object.keys(r).find(k => normalizeColName_(k) === 'id');
                 const kStart = Object.keys(r).find(k => normalizeColName_(k) === 'cutoffstart');
                 const kEnd   = Object.keys(r).find(k => normalizeColName_(k) === 'cutoffend');
                 if (kId && r[kId]) {
                     const key = `${String(r[kId]).trim()}_${standardizeDateStr_(r[kStart])}_${standardizeDateStr_(r[kEnd])}`;
                     incomingKeys.add(key);
                 }
             });

             // Read ONLY the 3 needed columns instead of the entire sheet to
             // avoid memory overflows on large accumulated data sets.
             const lastExistRow = rawSheet.getLastRow();
             const numExistRows = lastExistRow - 1; // data rows (exclude header)
             const idVals    = rawSheet.getRange(2, eIdIdx + 1,    numExistRows, 1).getValues();
             const startVals = rawSheet.getRange(2, eStartIdx + 1, numExistRows, 1).getValues();
             const endVals   = rawSheet.getRange(2, eEndIdx + 1,   numExistRows, 1).getValues();

             const rowsToDelete = [];
             for (let i = 0; i < numExistRows; i++) {
                 const key = `${String(idVals[i][0]).trim()}_${standardizeDateStr_(startVals[i][0])}_${standardizeDateStr_(endVals[i][0])}`;
                 if (incomingKeys.has(key)) rowsToDelete.push(i + 2); // +2: skip header row, convert to 1-indexed
             }
             // Reverse to descending order so row indices stay valid as we delete
             rowsToDelete.reverse();
             // Delete in contiguous chunks — one API call per chunk
             for (let j = 0; j < rowsToDelete.length; ) {
                 let start = rowsToDelete[j];
                 let count = 1;
                 while (j + count < rowsToDelete.length && rowsToDelete[j + count] === start - count) count++;
                 rawSheet.deleteRows(start - count + 1, count);
                 j += count;
             }
         }
      }

      const rowsToAppend = rawData.map(row => {
        const newRow = new Array(existingHeaders.length).fill('');
        
        const idxBatch = findColIdx('BatchID');
        const idxDate = findColIdx('UploadDate');
        const idxUser = findColIdx('UploadedBy');
        const idxFile = findColIdx('SourceFile');

        if (idxBatch > -1) newRow[idxBatch] = batchId;
        if (idxDate > -1) newRow[idxDate] = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "MM/dd/yyyy HH:mm:ss");
        if (idxUser > -1) newRow[idxUser] = user;
        if (idxFile > -1) newRow[idxFile] = fileUrl;
        
        for (const key in row) {
          const index = findColIdx(key);
          if (index !== -1) {
            let val = row[key];
            if (val === undefined || val === null) val = '';
            
            const normKey = normalizeColName_(key);
            if (normKey === 'cutoffstart' || normKey === 'cutoffend') {
                if (val !== '') val = standardizeDateStr_(val);
            } 
            else if (normKey.includes('amount') || normKey.includes('rate') || normKey.includes('salary') || normKey.includes('pay') || normKey.includes('deduction') || normKey.includes('contribution') || normKey.includes('duty')) {
                if (val !== '') {
                    const n = Number(String(val).replace(/,/g, ''));
                    if (!isNaN(n)) val = n;
                }
            } 
            else if (typeof val === 'object') {
               val = JSON.stringify(val);
            }
            newRow[index] = val;
          }
        }
        return newRow;
      });
      
      if (rowsToAppend.length > 0) {
        const insertStartRow = rawSheet.getLastRow() + 1;
        rawSheet.getRange(insertStartRow, 1, rowsToAppend.length, existingHeaders.length).setValues(rowsToAppend);
        // Pass the exact range so only newly inserted rows are formatted,
        // avoiding a full-sheet reformat that can OOM on large sheets.
        try { formatRawLinesSheet_(targetSS, insertStartRow, rowsToAppend.length); } catch(e) {}

        // Capture pre-write snapshots so rollback can restore/delete touched rows.
        const wriSnapshot    = captureWriMasterlistSnapshot_(rowsToAppend, existingHeaders);
        const emExistingKeys = captureLocalEmSnapshot_(rowsToAppend, existingHeaders);

        // All WRI writes run together. If any step throws, roll back the whole upload.
        try {
          upsertEmployeesFromHRIS_(rowsToAppend, existingHeaders);
          upsertToWriMasterlist_(rowsToAppend, existingHeaders);
          const batchDate = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
          upsertToWri13MDetails_(rowsToAppend, existingHeaders, batchId, batchDate, user, fileUrl);
          upsertToDeminimisDetails_(rowsToAppend, existingHeaders, batchId, batchDate, user, fileUrl);
          upsertToEmployeeIncomeLedger_(rowsToAppend, existingHeaders, batchId, batchDate, user, fileUrl);
          recordHrisRawDataEntries_(rawData, batchId, timestamp, user, fileUrl, fileName);
        } catch(wriErr) {
          rollbackHrisUpload_(rawSheet, batchId, insertStartRow, rowsToAppend.length,
                              fileUrl, wriSnapshot, rowsToAppend, existingHeaders, emExistingKeys);
          throw new Error('WRI write failed — upload rolled back: ' + wriErr.message);
        }

        // Rebuild BIR2316Data for the uploaded year so it stays current.
        // Runs after rollback-scope; a failure here does NOT revert the upload.
        try {
          var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
          _rebuildBir2316Data_(wriSS, batchYear);
          Logger.log('processPayrollRun: BIR2316Data rebuilt for year ' + batchYear);
        } catch(birErr) {
          Logger.log('processPayrollRun: BIR2316Data rebuild failed (non-critical): ' + birErr.message);
        }
      }
    }
    return { success: true, batchId: batchId, fileUrl: fileUrl, rowsProcessed: rawData.length };

  } catch (error) {
    // Trash the archived Drive file on any outer failure (archive succeeded but writes failed)
    if (fileUrl) {
      try {
        const m = fileUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (m && m[1]) DriveApp.getFileById(m[1]).setTrashed(true);
        Logger.log('processPayrollRun: trashed archived file after failure: ' + fileUrl);
      } catch(e) { Logger.log('processPayrollRun: could not trash file: ' + e.message); }
    }
    throw new Error("Failed to process consolidation: " + error.message);
  }
}

/**
 * Rolls back a failed HRIS upload — covers every surface that processPayrollRun touches:
 *   PayrollLines rows, WRI Employee Masterlist, local EmployeeMaster, archived Drive file,
 *   13MDetails, DeminimisDetails, EIL, and HRISRawData registry.
 */
function rollbackHrisUpload_(rawSheet, batchId, insertStartRow, rowCount,
                              fileUrl, wriSnapshot, rows, headers, emExistingKeys) {
  // 1. Delete newly inserted PayrollLines rows
  try {
    if (rawSheet && rowCount > 0) rawSheet.deleteRows(insertStartRow, rowCount);
  } catch(e) { Logger.log('rollbackHrisUpload_: PayrollLines delete failed: ' + e.message); }

  // 2. Restore/delete WRI Employee Masterlist rows (external spreadsheet)
  if (wriSnapshot && rows && headers) {
    try { rollbackWriMasterlist_(wriSnapshot, rows, headers); }
    catch(e) { Logger.log('rollbackHrisUpload_: WRI masterlist rollback failed: ' + e.message); }
  }

  // 3. Delete newly added rows from local EmployeeMaster
  if (rows && headers && emExistingKeys !== undefined) {
    try { rollbackLocalEmployeeMaster_(rows, headers, emExistingKeys); }
    catch(e) { Logger.log('rollbackHrisUpload_: local EM rollback failed: ' + e.message); }
  }

  // 4. Trash the archived Drive file
  if (fileUrl) {
    try {
      const m = fileUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (m && m[1]) DriveApp.getFileById(m[1]).setTrashed(true);
    } catch(e) { Logger.log('rollbackHrisUpload_: Drive file trash failed: ' + e.message); }
  }

  // 5. Remove batch-level detail records
  try { removeWri13MDetailsByBatch_(batchId); } catch(e) {}
  try { removeDeminimisDetailsByBatch_(batchId); } catch(e) {}
  try { removeEilByBatch_(batchId); } catch(e) {}

  // 6. Clean up HRIS raw data registry (safe even if recordHrisRawDataEntries_ never ran)
  try { deleteHrisRawDataEntry_(batchId); } catch(e) {}

  Logger.log('rollbackHrisUpload_: fully rolled back batchId=' + batchId);
}

/**
 * Captures the current WRI masterlist state for all UIDs in the incoming batch.
 * Returns { uid: { rowIndex (1-based in sheet), rowValues: [] } } for UIDs that already exist.
 * UIDs absent from the result were not present before the upload (newly added).
 */
function captureWriMasterlistSnapshot_(rows, headers) {
  try {
    const mapH = headers.map(normalizeColName_);
    const uidIdx = mapH.indexOf('userid');
    if (uidIdx === -1) return {};
    const incomingUids = new Set();
    rows.forEach(function(r) {
      const uid = String(r[uidIdx] !== undefined ? r[uidIdx] : '').trim();
      if (uid) incomingUids.add(uid);
    });
    if (incomingUids.size === 0) return {};
    const sheet = getWriMasterlistSheet_();
    const allData = sheet.getDataRange().getValues();
    const snapshot = {};
    for (let i = 1; i < allData.length; i++) {
      const uid = String(allData[i][0]).trim();
      if (incomingUids.has(uid)) snapshot[uid] = { rowIndex: i + 1, rowValues: allData[i].slice() };
    }
    return snapshot;
  } catch(e) {
    Logger.log('captureWriMasterlistSnapshot_: ' + e.message);
    return {};
  }
}

/**
 * Returns a Set of employeekeys that ALREADY exist in local EmployeeMaster for
 * the employees in the incoming batch. Keys not in this set were newly added by the upload.
 * Returns null on error — rollback will skip local EM cleanup safely.
 */
function captureLocalEmSnapshot_(rows, headers) {
  try {
    const mapH = headers.map(normalizeColName_);
    const nIdx = mapH.indexOf('name');
    const cIdx = mapH.indexOf('companyname');
    if (nIdx === -1 || cIdx === -1) return new Set();
    const incomingKeys = new Set();
    rows.forEach(function(r) {
      const name = String(r[nIdx] !== undefined ? r[nIdx] : '').trim();
      const comp = String(r[cIdx] !== undefined ? r[cIdx] : '').trim();
      if (name && comp) incomingKeys.add(name.toLowerCase() + '|' + comp.toLowerCase());
    });
    if (incomingKeys.size === 0) return new Set();
    const emSheet = getPayrollDB_().getSheetByName('EmployeeMaster');
    if (!emSheet || emSheet.getLastRow() < 2) return new Set();
    const emData = emSheet.getDataRange().getValues();
    const h = emData[0].map(normalizeColName_);
    const keyIdx = h.indexOf('employeekey');
    if (keyIdx === -1) return new Set();
    const existingKeys = new Set();
    for (let i = 1; i < emData.length; i++) {
      const key = String(emData[i][keyIdx]).trim().toLowerCase();
      if (incomingKeys.has(key)) existingKeys.add(key);
    }
    return existingKeys;
  } catch(e) {
    Logger.log('captureLocalEmSnapshot_: ' + e.message);
    return null;
  }
}

/**
 * Rolls back WRI Employee Masterlist changes from a failed upload:
 *   - UIDs in snapshot (existed before upload): row is restored to pre-upload values
 *   - UIDs not in snapshot (newly added by upload): row is deleted
 */
function rollbackWriMasterlist_(snapshot, rows, headers) {
  const mapH = headers.map(normalizeColName_);
  const uidIdx = mapH.indexOf('userid');
  if (uidIdx === -1) return;
  const incomingUids = new Set();
  rows.forEach(function(r) {
    const uid = String(r[uidIdx] !== undefined ? r[uidIdx] : '').trim();
    if (uid) incomingUids.add(uid);
  });
  if (incomingUids.size === 0) return;
  const sheet = getWriMasterlistSheet_();
  const allData = sheet.getDataRange().getValues();
  const currentMap = {};
  for (let i = 1; i < allData.length; i++) {
    const uid = String(allData[i][0]).trim();
    if (uid) currentMap[uid] = i + 1; // 1-based row number
  }
  const toDelete = [];
  incomingUids.forEach(function(uid) {
    const rowNum = currentMap[uid];
    if (!rowNum) return;
    if (snapshot.hasOwnProperty(uid)) {
      // Existed before upload — restore previous values exactly
      const prev = snapshot[uid].rowValues;
      sheet.getRange(rowNum, 1, 1, prev.length).setValues([prev]);
    } else {
      // Newly added by this upload — delete the row
      toDelete.push(rowNum);
    }
  });
  toDelete.sort(function(a, b) { return b - a; });
  for (var j = 0; j < toDelete.length; ) {
    var rs = toDelete[j], rc = 1;
    while (j + rc < toDelete.length && toDelete[j + rc] === rs - rc) rc++;
    sheet.deleteRows(rs - rc + 1, rc);
    j += rc;
  }
}

/**
 * Deletes rows from local EmployeeMaster that were newly added by this upload
 * (i.e. their employeekey was NOT in the pre-upload snapshot).
 * Safe when emExistingKeys is null — exits immediately.
 */
function rollbackLocalEmployeeMaster_(rows, headers, emExistingKeys) {
  if (!emExistingKeys) return;
  const mapH = headers.map(normalizeColName_);
  const nIdx = mapH.indexOf('name');
  const cIdx = mapH.indexOf('companyname');
  if (nIdx === -1 || cIdx === -1) return;
  const newKeys = new Set();
  rows.forEach(function(r) {
    const name = String(r[nIdx] !== undefined ? r[nIdx] : '').trim();
    const comp = String(r[cIdx] !== undefined ? r[cIdx] : '').trim();
    if (name && comp) {
      const key = name.toLowerCase() + '|' + comp.toLowerCase();
      if (!emExistingKeys.has(key)) newKeys.add(key);
    }
  });
  if (newKeys.size === 0) return;
  const emSheet = getPayrollDB_().getSheetByName('EmployeeMaster');
  if (!emSheet || emSheet.getLastRow() < 2) return;
  const emData = emSheet.getDataRange().getValues();
  const h = emData[0].map(normalizeColName_);
  const keyIdx = h.indexOf('employeekey');
  if (keyIdx === -1) return;
  const toDelete = [];
  for (let i = emData.length - 1; i >= 1; i--) {
    if (newKeys.has(String(emData[i][keyIdx]).trim().toLowerCase())) toDelete.push(i + 1);
  }
  toDelete.sort(function(a, b) { return b - a; });
  for (var j = 0; j < toDelete.length; ) {
    var rs = toDelete[j], rc = 1;
    while (j + rc < toDelete.length && toDelete[j + rc] === rs - rc) rc++;
    emSheet.deleteRows(rs - rc + 1, rc);
    j += rc;
  }
}

// =====================================================================
// 2. MASTER PAYROLL FILTERS & HRIS LIST
// =====================================================================

function getPayrollMasterFilters(year) {
  const targetSS = getYearlySpreadsheet_(year || new Date().getFullYear());
  const sheet = targetSS.getSheetByName('PayrollLines');
  if (!sheet) return { companies: [], cutoffStarts: [], cutoffEnds: [] };
  
  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) return { companies: [], cutoffStarts: [], cutoffEnds: [] };
  
  const headers = data[0];
  const idxCompany = headers.findIndex(h => normalizeColName_(h) === 'companyname');
  const idxFileName = headers.findIndex(h => normalizeColName_(h) === 'filename');
  const idxStart = headers.findIndex(h => normalizeColName_(h) === 'cutoffstart');
  const idxEnd = headers.findIndex(h => normalizeColName_(h) === 'cutoffend');
  
  let companies = new Set(); let starts = new Set(); let ends = new Set();
  for (let i = 1; i < data.length; i++) {
    const compRaw = idxCompany > -1 ? String(data[i][idxCompany]).trim() : "";
    const fNameRaw = idxFileName > -1 ? String(data[i][idxFileName]).trim() : "";
    const comp = compRaw || (fNameRaw ? fNameRaw.split(' ')[0] : "Unknown");
    
    if (comp && comp !== "Unknown") companies.add(comp);
    if (idxStart > -1 && data[i][idxStart]) starts.add(standardizeDateStr_(data[i][idxStart]));
    if (idxEnd > -1 && data[i][idxEnd]) ends.add(standardizeDateStr_(data[i][idxEnd]));
  }
  
  return { companies: Array.from(companies).sort(), cutoffStarts: Array.from(starts).sort(), cutoffEnds: Array.from(ends).sort() };
}

function getFilteredPayrollLines(filters) {
  const { company, start, end, year } = filters;
  const targetSS = getYearlySpreadsheet_(year || new Date().getFullYear());
  const sheet = targetSS.getSheetByName('PayrollLines');
  if (!sheet) return { headers: [], rows: [] };
  
  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) return { headers: (data[0] || []), rows: [] };
  
  const headers = data[0]; 
  const idxCompany = headers.findIndex(h => normalizeColName_(h) === 'companyname');
  const idxFileName = headers.findIndex(h => normalizeColName_(h) === 'filename');
  const idxStart = headers.findIndex(h => normalizeColName_(h) === 'cutoffstart');
  const idxEnd = headers.findIndex(h => normalizeColName_(h) === 'cutoffend');
  
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const compRaw = idxCompany > -1 ? String(row[idxCompany]).trim() : "";
    const fNameRaw = idxFileName > -1 ? String(row[idxFileName]).trim() : "";
    const rowCompany = compRaw || (fNameRaw ? fNameRaw.split(' ')[0] : "Unknown");
    
    const rowStart = idxStart > -1 ? standardizeDateStr_(row[idxStart]) : "";
    const rowEnd = idxEnd > -1 ? standardizeDateStr_(row[idxEnd]) : "";
    
    let match = true;
    if (company && rowCompany !== company) match = false;
    if (start && rowStart !== start) match = false;
    if (end && rowEnd !== end) match = false;
    
    if (match) {
      const obj = {};
      headers.forEach((h, idx) => {
        let val = row[idx];
        const normH = normalizeColName_(h);
        const isDateCol = ['uploaddate', 'cutoffstart', 'cutoffend'].includes(normH);
        if (val && typeof val === 'string') {
          if (val.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/) || isDateCol) val = standardizeDateStr_(val);
        }
        obj[h] = val;
      });
      result.push(obj);
    }
  }
  return { headers: headers, rows: result };
}

function debugHrisInfo(year) {
    const safeYear = parseInt(year, 10) || new Date().getFullYear();
    const ss = getPayrollDB_();
    const regSheet = ss.getSheetByName('YearlyDatabases');
    if (!regSheet) return { error: 'YearlyDatabases sheet not found' };
    const data = regSheet.getDataRange().getValues();
    const results = [];
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) !== String(safeYear)) continue;
        const fileId = String(data[i][1]);
        try {
            const file = DriveApp.getFileById(fileId);
            const ySS = SpreadsheetApp.openById(fileId);
            const pl = ySS.getSheetByName('PayrollLines');
            const lastRow = pl ? pl.getLastRow() : 0;
            const headers = pl && lastRow > 0 ? pl.getRange(1,1,1,pl.getLastColumn()).getValues()[0] : [];
            results.push({ row: i, fileId, fileName: file.getName(), trashed: file.isTrashed(), lastRow, headers });
        } catch(e) {
            results.push({ row: i, fileId, error: e.message });
        }
    }
    return { year: safeYear, candidates: results };
}

// ─────────────────────────────────────────────────────────────────────────────
// HRISRawData registry helpers
// ─────────────────────────────────────────────────────────────────────────────
var HRIS_RD_COLS_ = ['BatchID','UploadDate','UploadedBy','Client_Company',
                     'CutoffStart','CutoffEnd','CutoffPeriod','Rows',
                     'Source_File','FileName','PayrollID'];

function getHrisRawDataSheet_() {
  var ss = getPayrollDB_();
  var sh = ss.getSheetByName('HRISRawData');
  if (!sh) sh = ss.insertSheet('HRISRawData');
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HRIS_RD_COLS_.length).setValues([HRIS_RD_COLS_])
      .setFontWeight('bold').setBackground('#f3f4f6');
    sh.setFrozenRows(1);
  }
  return sh;
}

function recordHrisRawDataEntries_(rawData, batchId, timestamp, uploadedBy, fileUrl, fileName) {
  try {
    var sh = getHrisRawDataSheet_();
    var uploadDateStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');

    // Ensure every needed column exists in the sheet
    var shHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                       .map(function(v){ return String(v).trim(); });
    HRIS_RD_COLS_.forEach(function(col) {
      if (shHeaders.indexOf(col) === -1) {
        sh.getRange(1, shHeaders.length + 1).setValue(col)
          .setFontWeight('bold').setBackground('#f3f4f6');
        shHeaders.push(col);
      }
    });
    function setCol(row, col, val) { var i = shHeaders.indexOf(col); if (i > -1) row[i] = val; }

    // Group incoming rows by company + cutoff
    var groupMap = {};
    rawData.forEach(function(r) {
      var rKeys = Object.keys(r);
      var cKey = rKeys.find(function(k){ return normalizeColName_(k) === 'companyname'; });
      var sKey = rKeys.find(function(k){ return normalizeColName_(k) === 'cutoffstart'; });
      var eKey = rKeys.find(function(k){ return normalizeColName_(k) === 'cutoffend'; });
      var comp  = cKey ? String(r[cKey] || 'Unknown').trim() : 'Unknown';
      var start = sKey ? standardizeDateStr_(r[sKey]) : '';
      var end   = eKey ? standardizeDateStr_(r[eKey]) : '';
      var key = comp + '_' + start + '_' + end;
      if (!groupMap[key]) groupMap[key] = { comp: comp, start: start, end: end, count: 0 };
      groupMap[key].count++;
    });

    // Remove only the exact company+cutoff rows within this batchId that are about to be
    // re-inserted (dedup guard for replaceHrisBatchData). Do NOT wipe other files' rows
    // that share the same batchId in a multi-file batch upload.
    if (sh.getLastRow() > 1) {
      var nRows = sh.getLastRow() - 1;
      var idxB  = shHeaders.indexOf('BatchID');
      var idxC2 = shHeaders.indexOf('Client_Company');
      var idxS2 = shHeaders.indexOf('CutoffStart');
      var idxE2 = shHeaders.indexOf('CutoffEnd');
      if (idxB > -1) {
        var nCols2 = shHeaders.length;
        var existData = sh.getRange(2, 1, nRows, nCols2).getValues();
        var toDelete = [];
        for (var i = existData.length - 1; i >= 0; i--) {
          var rowBatch = String(existData[i][idxB] || '').trim();
          if (rowBatch !== String(batchId).trim()) continue;
          var rowComp  = idxC2 > -1 ? String(existData[i][idxC2] || '').trim() : '';
          var rowStart = idxS2 > -1 ? String(existData[i][idxS2] || '').trim() : '';
          var rowEnd   = idxE2 > -1 ? String(existData[i][idxE2] || '').trim() : '';
          var dedupKey = rowComp + '_' + rowStart + '_' + rowEnd;
          if (groupMap[dedupKey]) toDelete.push(i + 2); // only delete if we're re-inserting same key
        }
        for (var d = 0; d < toDelete.length; ) {
          var rs = toDelete[d], rc = 1;
          while (d + rc < toDelete.length && toDelete[d + rc] === rs - rc) rc++;
          sh.deleteRows(rs - rc + 1, rc);
          d += rc;
        }
      }
    }

    // Append one row per unique company + cutoff pair
    var toAppend = Object.values(groupMap).map(function(g) {
      var row = new Array(shHeaders.length).fill('');
      setCol(row, 'BatchID',        batchId);
      setCol(row, 'UploadDate',     uploadDateStr);
      setCol(row, 'UploadedBy',     uploadedBy);
      setCol(row, 'Client_Company', g.comp);
      setCol(row, 'CutoffStart',    g.start);
      setCol(row, 'CutoffEnd',      g.end);
      setCol(row, 'CutoffPeriod',   g.start && g.end ? g.start + ' - ' + g.end : '');
      setCol(row, 'Rows',           g.count);
      setCol(row, 'Source_File',    fileUrl);
      setCol(row, 'FileName',       fileName);
      setCol(row, 'PayrollID',      '');
      return row;
    });
    if (toAppend.length > 0) {
      sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, shHeaders.length).setValues(toAppend);
    }
  } catch(e) {
    Logger.log('recordHrisRawDataEntries_ error: ' + e);
  }
}

function deleteHrisRawDataEntry_(batchId, company, start, end) {
  // Pass undefined for company/start/end to remove ALL rows for the batchId.
  try {
    var sh = SpreadsheetApp.openById(PAYROLL_DB_SHEET_ID).getSheetByName('HRISRawData');
    if (!sh || sh.getLastRow() < 2) return;
    var nCols = sh.getLastColumn();
    var headers = sh.getRange(1, 1, 1, nCols).getValues()[0]
                    .map(function(v){ return String(v).trim(); });
    var idxB = headers.indexOf('BatchID');
    var idxC = headers.indexOf('Client_Company');
    var idxS = headers.indexOf('CutoffStart');
    var idxE = headers.indexOf('CutoffEnd');
    if (idxB < 0) return;
    var allData = sh.getRange(2, 1, sh.getLastRow() - 1, nCols).getValues();
    var toDelete = [];
    for (var i = allData.length - 1; i >= 0; i--) {
      if (String(allData[i][idxB]).trim() !== String(batchId).trim()) continue;
      if (company !== undefined) {
        if (idxC > -1 && String(allData[i][idxC]).trim() !== String(company).trim()) continue;
        if (idxS > -1 && standardizeDateStr_(allData[i][idxS]) !== standardizeDateStr_(start)) continue;
        if (idxE > -1 && standardizeDateStr_(allData[i][idxE]) !== standardizeDateStr_(end))   continue;
      }
      toDelete.push(i + 2);
    }
    for (var d = 0; d < toDelete.length; ) {
      var rs = toDelete[d], rc = 1;
      while (d + rc < toDelete.length && toDelete[d + rc] === rs - rc) rc++;
      sh.deleteRows(rs - rc + 1, rc);
      d += rc;
    }
  } catch(e) {}
}

function backfillHrisRawData(year) {
  var safeYear = year || new Date().getFullYear();
  var targetSS = getYearlySpreadsheet_(safeYear);
  var plSheet = targetSS.getSheetByName('PayrollLines');
  if (!plSheet || plSheet.getLastRow() < 2) return 'No PayrollLines data for ' + safeYear;

  var lastRow = plSheet.getLastRow();
  var lastCol = plSheet.getLastColumn();
  var nData   = lastRow - 1;
  var h = plSheet.getRange(1, 1, 1, lastCol).getValues()[0].map(normalizeColName_);

  var readCol = function(idx) {
    if (idx < 0) return new Array(nData).fill('');
    return plSheet.getRange(2, idx + 1, nData, 1).getDisplayValues().map(function(r){ return r[0]; });
  };
  var batchIds    = readCol(h.indexOf('batchid'));
  var uploadDates = readCol(h.indexOf('uploaddate'));
  var sourceFiles = readCol(h.indexOf('sourcefile'));
  var companies   = readCol(h.indexOf('companyname'));
  var starts      = readCol(h.indexOf('cutoffstart'));
  var ends        = readCol(h.indexOf('cutoffend'));
  var users       = readCol(h.indexOf('uploadedby'));
  var fileNames   = readCol(h.indexOf('filename'));

  var groupMap = {};
  for (var i = 0; i < nData; i++) {
    var compRaw  = String(companies[i] || '').trim();
    var fNameRaw = String(fileNames[i] || '').trim();
    var comp = compRaw || (fNameRaw ? fNameRaw.split(' ')[0] : 'Unknown');
    if (!comp) continue;
    var start   = standardizeDateStr_(starts[i]);
    var end     = standardizeDateStr_(ends[i]);
    var batchId = String(batchIds[i] || '').trim();
    if (!batchId) continue;
    var key = batchId + '_' + comp + '_' + start + '_' + end;
    if (!groupMap[key]) {
      var sFile = String(sourceFiles[i] || '').trim();
      if (sFile && !sFile.startsWith('http')) sFile = '';
      groupMap[key] = {
        batchId: batchId, uploadDate: String(uploadDates[i] || '').trim(),
        uploadedBy: String(users[i] || '').trim(), comp: comp,
        start: start, end: end, count: 0, sourceFile: sFile, fileName: fNameRaw
      };
    }
    groupMap[key].count++;
  }

  var rdSh = getHrisRawDataSheet_();
  var shHeaders = rdSh.getRange(1, 1, 1, rdSh.getLastColumn()).getValues()[0]
                      .map(function(v){ return String(v).trim(); });
  HRIS_RD_COLS_.forEach(function(col) {
    if (shHeaders.indexOf(col) === -1) {
      rdSh.getRange(1, shHeaders.length + 1).setValue(col)
          .setFontWeight('bold').setBackground('#f3f4f6');
      shHeaders.push(col);
    }
  });
  function setCol(row, col, val) { var i = shHeaders.indexOf(col); if (i > -1) row[i] = val; }

  // Build set of keys already present so we skip duplicates
  var existKeys = {};
  if (rdSh.getLastRow() > 1) {
    var iB = shHeaders.indexOf('BatchID'), iC = shHeaders.indexOf('Client_Company');
    var iS = shHeaders.indexOf('CutoffStart'), iE = shHeaders.indexOf('CutoffEnd');
    rdSh.getRange(2, 1, rdSh.getLastRow() - 1, shHeaders.length).getValues()
      .forEach(function(row) {
        var k = [iB,iC,iS,iE].map(function(idx){ return idx > -1 ? String(row[idx]).trim() : ''; }).join('_');
        existKeys[k] = true;
      });
  }

  var toAppend = [];
  Object.values(groupMap).forEach(function(g) {
    var checkKey = [g.batchId, g.comp, g.start, g.end].join('_');
    if (existKeys[checkKey]) return;
    var row = new Array(shHeaders.length).fill('');
    setCol(row, 'BatchID',        g.batchId);
    setCol(row, 'UploadDate',     g.uploadDate);
    setCol(row, 'UploadedBy',     g.uploadedBy);
    setCol(row, 'Client_Company', g.comp);
    setCol(row, 'CutoffStart',    g.start);
    setCol(row, 'CutoffEnd',      g.end);
    setCol(row, 'CutoffPeriod',   g.start && g.end ? g.start + ' - ' + g.end : '');
    setCol(row, 'Rows',           g.count);
    setCol(row, 'Source_File',    g.sourceFile);
    setCol(row, 'FileName',       g.fileName);
    setCol(row, 'PayrollID',      '');
    toAppend.push(row);
  });

  if (toAppend.length > 0) {
    rdSh.getRange(rdSh.getLastRow() + 1, 1, toAppend.length, shHeaders.length).setValues(toAppend);
  }
  return 'Backfilled ' + toAppend.length + ' entries for ' + safeYear + ' into HRISRawData.';
}

function getHrisBatchesSummary(year) {
    // Read from HRISRawData in Payroll DB — fast, O(n) on a small registry sheet.
    const ss = getPayrollDB_();
    const rdSheet = ss.getSheetByName('HRISRawData');
    if (!rdSheet || rdSheet.getLastRow() < 2) return [];

    const lastRow = rdSheet.getLastRow();
    const lastCol = rdSheet.getLastColumn();
    const h = rdSheet.getRange(1, 1, 1, lastCol).getValues()[0]
                     .map(function(v){ return String(v).trim(); });

    const idxBatch   = h.indexOf('BatchID');
    const idxDate    = h.indexOf('UploadDate');
    const idxComp    = h.indexOf('Client_Company');
    const idxStart   = h.indexOf('CutoffStart');
    const idxEnd     = h.indexOf('CutoffEnd');
    const idxRows    = h.indexOf('Rows');
    const idxFile    = h.indexOf('Source_File');
    const idxFName   = h.indexOf('FileName');
    const idxPayroll = h.indexOf('PayrollID');

    const nData = lastRow - 1;
    const readCol = function(idx) {
        if (idx < 0) return new Array(nData).fill('');
        return rdSheet.getRange(2, idx + 1, nData, 1).getDisplayValues().map(function(r){ return r[0]; });
    };

    const batchIds    = readCol(idxBatch);
    const uploadDates = readCol(idxDate);
    const companies   = readCol(idxComp);
    const starts      = readCol(idxStart);
    const ends        = readCol(idxEnd);
    const rowCounts   = readCol(idxRows);
    const sourceFiles = readCol(idxFile);
    const fileNames   = readCol(idxFName);
    const payrollIds  = readCol(idxPayroll);

    // Filter by year if provided
    const safeYear = year ? String(year) : String(new Date().getFullYear());

    const results = [];
    for (var i = 0; i < nData; i++) {
        var batchId = String(batchIds[i] || '').trim();
        if (!batchId) continue;

        var end   = String(ends[i]   || '').trim();
        var start = String(starts[i] || '').trim();

        // Year filter — check the cutoff end year, fall back to batch ID year
        var rowYear = '';
        if (end) { var d = new Date(end); if (!isNaN(d.getTime())) rowYear = String(d.getFullYear()); }
        if (!rowYear) { var m = batchId.match(/RAW-(\d{4})/); if (m) rowYear = m[1]; }
        if (safeYear && rowYear && rowYear !== safeYear) continue;

        var sFile = String(sourceFiles[i] || '').trim();
        if (sFile && !sFile.startsWith('http')) sFile = '';

        results.push({
            batchId:    batchId,
            uploadDate: uploadDates[i],
            company:    String(companies[i] || '').trim(),
            start:      start,
            end:        end,
            rowCount:   parseInt(rowCounts[i], 10) || 0,
            sourceFile: sFile,
            fileName:   String(fileNames[i] || '').trim(),
            linkedBook: String(payrollIds[i] || '').trim() || '-'
        });
    }

    // Enrich linkedBook from PayrollBooks BatchesJSON for entries not yet linked
    const pbSheet = ss.getSheetByName('PayrollBooks');
    if (pbSheet && pbSheet.getLastRow() > 1) {
        const pbData = pbSheet.getDataRange().getValues();
        const pbH    = pbData[0];
        const idIdx  = pbH.indexOf('PayrollID');
        const jsonIdx = pbH.indexOf('BatchesJSON');
        for (var p = 1; p < pbData.length; p++) {
            var pbId   = String(pbData[p][idIdx]   || '').trim();
            var pbJson = String(pbData[p][jsonIdx]  || '').trim();
            if (!pbId || !pbJson) continue;
            try {
                JSON.parse(pbJson).forEach(function(b) {
                    results.forEach(function(r) {
                        if (r.linkedBook !== '-') return;
                        var compMatch  = r.company === b.company;
                        var startMatch = standardizeDateStr_(r.start) === standardizeDateStr_(b.start);
                        var endMatch   = standardizeDateStr_(r.end)   === standardizeDateStr_(b.end);
                        var bMatch     = (b.batchId && r.batchId) ? (r.batchId === b.batchId) : true;
                        if (compMatch && startMatch && endMatch && bMatch) r.linkedBook = pbId;
                    });
                });
            } catch(e) {}
        }
    }

    results.sort(function(a, b){ return new Date(b.uploadDate) - new Date(a.uploadDate); });
    return results;
}

function deleteHrisBatchData(payload) {
  const { batchId, company, start, end, fileUrl } = payload;
  let targetYear = new Date().getFullYear();
  if (end) { let d = new Date(end); if (!isNaN(d.getTime())) targetYear = d.getFullYear(); }

  const targetSS = getYearlySpreadsheet_(targetYear);
  const sheet = targetSS.getSheetByName('PayrollLines');
  if (!sheet) return { success: false, message: 'PayrollLines not found for year ' + targetYear };

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true };

  const headers = data[0];
  const normHeaders = headers.map(normalizeColName_);
  const idxBatch    = normHeaders.indexOf('batchid');
  const idxComp     = normHeaders.indexOf('companyname');
  const idxFileName = normHeaders.indexOf('filename');
  const idxStart    = normHeaders.indexOf('cutoffstart');
  const idxEnd      = normHeaders.indexOf('cutoffend');

  const normStart = standardizeDateStr_(start);
  const normEnd   = standardizeDateStr_(end);

  // Collect 1-indexed sheet row numbers to delete, then remove bottom-up in
  // contiguous chunks. This physically removes rows — no blank rows left behind.
  const rowsToDelete = [];
  let batchStillExists = false;

  for (let i = 1; i < data.length; i++) {
    const row      = data[i];
    const cNameRaw = idxComp     > -1 ? String(row[idxComp]).trim()     : '';
    const fNameRaw = idxFileName > -1 ? String(row[idxFileName]).trim() : '';
    const cName    = cNameRaw || (fNameRaw ? fNameRaw.split(' ')[0] : 'Unknown');
    const rowBatch = idxBatch > -1 ? String(row[idxBatch]).trim()       : '';
    const rowStart = idxStart > -1 ? standardizeDateStr_(row[idxStart]) : '';
    const rowEnd   = idxEnd   > -1 ? standardizeDateStr_(row[idxEnd])   : '';

    const matchBatch = (idxBatch === -1) || (rowBatch === String(batchId).trim());
    if (matchBatch && cName === String(company).trim() && rowStart === normStart && rowEnd === normEnd) {
      rowsToDelete.push(i + 1); // i is 0-based in data array; +1 converts to 1-based sheet row
    } else {
      if (idxBatch > -1 && rowBatch === String(batchId).trim()) batchStillExists = true;
    }
  }

  // Delete bottom-up in contiguous chunks so row indices stay valid
  rowsToDelete.sort(function(a, b) { return b - a; });
  for (var j = 0; j < rowsToDelete.length; ) {
    var rs = rowsToDelete[j], rc = 1;
    while (j + rc < rowsToDelete.length && rowsToDelete[j + rc] === rs - rc) rc++;
    sheet.deleteRows(rs - rc + 1, rc);
    j += rc;
  }

  if (!batchStillExists && fileUrl && fileUrl.includes('/d/')) {
    try {
      const fileIdMatch = fileUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (fileIdMatch && fileIdMatch[1]) DriveApp.getFileById(fileIdMatch[1]).setTrashed(true);
    } catch(e) {}
  }
  try { deleteHrisRawDataEntry_(batchId, String(company).trim(), String(start).trim(), String(end).trim()); } catch(e) {}
  try { removeWri13MDetailsByBatch_(batchId, String(company).trim()); } catch(e) {}
  try { removeDeminimisDetailsByBatch_(batchId, String(company).trim()); } catch(e) {}
  try { removeEilByBatch_(batchId, String(company).trim()); } catch(e) {}
  return { success: true };
}

function bulkDeleteHrisBatchData(items) {
  if (!items || !items.length) return { success: true, deleted: 0 };
  var deleted = 0, errors = [];
  items.forEach(function(item) {
    try { deleteHrisBatchData(item); deleted++; }
    catch(e) { errors.push(String(item.batchId) + ': ' + e.message); }
  });
  if (errors.length) throw new Error('Partial failure (' + deleted + ' deleted): ' + errors.join('; '));
  return { success: true, deleted: deleted };
}

function replaceHrisBatchData(payload) {
  const { oldBatchId, company, start, end, linkedBook, fileBase64, fileName, mimeType, rawData } = payload;
  let targetYear = new Date().getFullYear();
  if (end) { let d = new Date(end); if (!isNaN(d.getTime())) targetYear = d.getFullYear(); }

  // STEP 1: Upload and write the new file first.
  // Old data is fully preserved until this succeeds — if processPayrollRun throws,
  // the old rows remain intact and nothing is lost.
  // processPayrollRun's own dedup (id+cutoffstart+cutoffend) will overwrite rows
  // that exist in both the old and new batch.
  const runResult = processPayrollRun({ fileBase64, fileName, mimeType, rawData });

  // STEP 2: Delete any rows still carrying the OLD batchId (employees present in the
  // old batch but absent from the new file — processPayrollRun won't touch these).
  try {
    const targetSS2 = getYearlySpreadsheet_(targetYear);
    const sheet2 = targetSS2.getSheetByName('PayrollLines');
    if (sheet2 && sheet2.getLastRow() > 1) {
      const data2 = sheet2.getDataRange().getValues();
      const normH2 = data2[0].map(normalizeColName_);
      const ib2 = normH2.indexOf('batchid');
      const ic2 = normH2.indexOf('companyname');
      const if2 = normH2.indexOf('filename');
      const is2 = normH2.indexOf('cutoffstart');
      const ie2 = normH2.indexOf('cutoffend');
      const normStart2 = standardizeDateStr_(start);
      const normEnd2   = standardizeDateStr_(end);
      const toDelete2  = [];
      for (let i = 1; i < data2.length; i++) {
        const row      = data2[i];
        const cNameRaw = ic2 > -1 ? String(row[ic2]).trim() : '';
        const fNameRaw = if2 > -1 ? String(row[if2]).trim() : '';
        const cName    = cNameRaw || (fNameRaw ? fNameRaw.split(' ')[0] : 'Unknown');
        const rowBatch = ib2 > -1 ? String(row[ib2]).trim() : '';
        const rowStart = is2 > -1 ? standardizeDateStr_(row[is2]) : '';
        const rowEnd   = ie2 > -1 ? standardizeDateStr_(row[ie2]) : '';
        if (rowBatch === String(oldBatchId).trim() && cName === String(company).trim() && rowStart === normStart2 && rowEnd === normEnd2) {
          toDelete2.push(i + 1);
        }
      }
      toDelete2.sort(function(a, b) { return b - a; });
      for (var dj = 0; dj < toDelete2.length; ) {
        var drs = toDelete2[dj], drc = 1;
        while (dj + drc < toDelete2.length && toDelete2[dj + drc] === drs - drc) drc++;
        sheet2.deleteRows(drs - drc + 1, drc);
        dj += drc;
      }
    }
  } catch(cleanupErr) {
    Logger.log('replaceHrisBatchData: leftover row cleanup error: ' + cleanupErr.message);
  }

  // STEP 3: Remove stale derived-sheet rows and HRISRawData entry for the old batch.
  try { removeDeminimisDetailsByBatch_(String(oldBatchId).trim(), String(company).trim()); } catch(e) { Logger.log('replaceHrisBatchData: remove DeminimisDetails error: ' + e); }
  try { removeWri13MDetailsByBatch_(String(oldBatchId).trim(), String(company).trim()); } catch(e) { Logger.log('replaceHrisBatchData: remove 13MDetails error: ' + e); }
  try { removeEilByBatch_(String(oldBatchId).trim(), String(company).trim()); } catch(e) { Logger.log('replaceHrisBatchData: remove EmployeeIncomeLedger error: ' + e); }
  try { deleteHrisRawDataEntry_(oldBatchId, String(company).trim(), String(start).trim(), String(end).trim()); } catch(e) {}

  if (linkedBook && linkedBook !== '-') {
      const ss = getPayrollDB_();
      const pbSheet = ss.getSheetByName('PayrollBooks');
      if (pbSheet) {
          const pbData = pbSheet.getDataRange().getValues();
          const pbHeaders = pbData[0];
          const batchJsonIdx = pbHeaders.indexOf('BatchesJSON');
          let outIdx = pbHeaders.indexOf('Outdated');
          if (outIdx === -1) { outIdx = pbHeaders.length; pbSheet.getRange(1, outIdx + 1).setValue('Outdated'); }
          const normStart = standardizeDateStr_(start);
          const normEnd   = standardizeDateStr_(end);
          for (let i = 1; i < pbData.length; i++) {
              if (String(pbData[i][0]).trim() === String(linkedBook).trim()) {
                  // Update BatchesJSON: swap old batchId → new batchId so regeneration finds the new PayrollLines data
                  if (batchJsonIdx > -1) {
                      try {
                          const batches = JSON.parse(String(pbData[i][batchJsonIdx] || '[]'));
                          const updatedBatches = batches.map(b => {
                              const bStart = standardizeDateStr_(b.start);
                              const bEnd   = standardizeDateStr_(b.end);
                              if (b.batchId === String(oldBatchId).trim() && b.company === String(company).trim() && bStart === normStart && bEnd === normEnd) {
                                  return Object.assign({}, b, { batchId: runResult.batchId, fileName: fileName });
                              }
                              return b;
                          });
                          pbSheet.getRange(i + 1, batchJsonIdx + 1).setValue(JSON.stringify(updatedBatches));
                      } catch(e) {}
                  }
                  pbSheet.getRange(i + 1, outIdx + 1).setValue('TRUE');
                  break;
              }
          }
      }
  }
  return { success: true, newBatchId: runResult.batchId };
}

// =====================================================================
// 3. MASTER PAYROLL BOOK BACKEND LOGIC (WITH CACHING & EXTRACTION)
// =====================================================================

function ensurePayrollBooksHeaders_(sheet) {
  const h = ['PayrollID', 'Name', 'Attribution', 'PayoutDate', 'ClientsSummary', 'BatchesJSON', 'Type', 'Status', 'CreatedAt', 'CreatedBy', 'GeneratedPaysheets', 'Outdated', 'LinkedVoucherId', 'LinkedCheckVoucherId'].concat(WORKFLOW_COLS);
  if (sheet.getLastRow() === 0) { sheet.appendRow(h); sheet.getRange(1, 1, 1, h.length).setFontWeight("bold").setBackground("#f3f4f6"); sheet.setFrozenRows(1); return h; }
  const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  // Insert missing columns rather than overwriting headers (prevents data misalignment)
  if (!existingHeaders.includes('LinkedVoucherId')) {
    const insertAfterCol = existingHeaders.indexOf('Outdated') + 1; // 1-based
    sheet.insertColumnAfter(insertAfterCol);
    sheet.getRange(1, insertAfterCol + 1).setValue('LinkedVoucherId').setFontWeight('bold').setBackground('#f3f4f6');
  }
  const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (!currentHeaders.includes('LinkedCheckVoucherId')) {
    const insertAfterCol2 = currentHeaders.indexOf('LinkedVoucherId') + 1; // 1-based
    sheet.insertColumnAfter(insertAfterCol2);
    sheet.getRange(1, insertAfterCol2 + 1).setValue('LinkedCheckVoucherId').setFontWeight('bold').setBackground('#f3f4f6');
  }
  const currentHeaders2 = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return h;
}

function ensurePayrollBookConsolidatedHeaders_(sheet) {
  const h = [
    'PayrollID', 'Name', 'Daily Rate', 'Days (days)', 'Regular', 'Lates (mins)', 'Lates', 'Total Bsc', 
    'Overtime', 'ND', 'DOD', 'DOD OT', 'Spl Hol', 'Spl Hol OT', 'Lgl Hol', 'Lgl Hol OT', 
    'Alw', 'Adj', 'Total Gross Pay', 'Pagibig', 'Pagibig Loan', 'SSS Loan', 'SSS', 
    'Philhealth', 'Total Deduction', '13th Month', 'Payslip Net Pay', 'Computed Net Pay', 
    'Validity Check', 'Region', 'Employment Status', 'Bank Account Number', 'Amount', 
    'Remarks', 'Cutoff Start', 'Cutoff End', 'Company Name', 'Salary Status', 'LineStatus',
    'Tax', 'SSS ER', 'Philhealth ER', 'Pagibig ER', 'Admin Fee', 'Total Billable', 'User ID',
    'Branch', 'Department', 'Work Location', 'Position'
  ];
  if (sheet.getLastRow() === 0) { sheet.appendRow(h); sheet.getRange(1, 1, 1, h.length).setFontWeight("bold").setBackground("#f3f4f6"); sheet.setFrozenRows(1); }
  const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
  if (existingHeaders.length < h.length) sheet.getRange(1, 1, 1, h.length).setValues([h]); 
  return h;
}

function formatConsolidatedSheet_(ss, consHeaders) {
    const consSheet = ss.getSheetByName('PayrollBookConsolidated');
    if (!consSheet) return;
    const maxRows = consSheet.getMaxRows();
    if (maxRows < 2) return;
    const moneyCols = ['daily rate', 'regular', 'lates', 'total bsc', 'overtime', 'nd', 'dod', 'dod ot', 'spl hol', 'spl hol ot', 'lgl hol', 'lgl hol ot', 'alw', 'adj', 'total gross pay', 'pagibig', 'pagibig loan', 'sss loan', 'sss', 'philhealth', 'total deduction', '13th month', 'payslip net pay', 'computed net pay', 'amount', 'tax', 'sss er', 'philhealth er', 'pagibig er', 'admin fee', 'total billable'];
    const formats = [];
    for(let i=0; i < maxRows - 1; i++) {
        const rowFmt = [];
        consHeaders.forEach(h => {
            const normH = normalizeColName_(h);
            if (moneyCols.map(normalizeColName_).includes(normH)) rowFmt.push('#,##0.00');
            else if (['latesmins', 'daysdays'].includes(normH)) rowFmt.push('0');
            else if (normH.includes('cutoff')) rowFmt.push('mm/dd/yyyy');
            else rowFmt.push('@');
        });
        formats.push(rowFmt);
    }
    consSheet.getRange(2, 1, maxRows - 1, consHeaders.length).setNumberFormats(formats);
}

function getAvailableBatches(year, editingPbId) {
  let safeYear = parseInt(year, 10);
  if (isNaN(safeYear) || safeYear < 2000 || safeYear > 2100) safeYear = new Date().getFullYear();

  const ss = getPayrollDB_();

  // Build set of batchId+company+start+end keys already used in OTHER payroll books
  const usedKeys = new Set();
  const pbSheet = ss.getSheetByName('PayrollBooks');
  if (pbSheet && pbSheet.getLastRow() > 1) {
    const pbData = pbSheet.getDataRange().getValues();
    const pbH = pbData[0];
    const idIdx   = pbH.indexOf('PayrollID');
    const jsonIdx = pbH.indexOf('BatchesJSON');
    for (var i = 1; i < pbData.length; i++) {
      const bId   = String(pbData[i][idIdx]   || '').trim();
      const bJson = String(pbData[i][jsonIdx]  || '').trim();
      if (editingPbId && bId === String(editingPbId).trim()) continue;
      if (!bJson) continue;
      try {
        JSON.parse(bJson).forEach(function(b) {
          var k = String(b.batchId||'').trim() + '::' + String(b.company||'').trim()
                + '::' + String(b.start||'').trim() + '::' + String(b.end||'').trim()
                + '::' + String(b.fileName||'').trim();
          usedKeys.add(k);
          // Also add legacy key without fileName for backward compatibility
          var legacyK = String(b.batchId||'').trim() + '::' + String(b.company||'').trim()
                      + '::' + String(b.start||'').trim() + '::' + String(b.end||'').trim() + '::';
          usedKeys.add(legacyK);
        });
      } catch(e) {}
    }
  }

  // Read directly from HRISRawData — one row per uploaded file
  const rdSheet = ss.getSheetByName('HRISRawData');
  if (!rdSheet || rdSheet.getLastRow() < 2) return [];

  const lastCol = rdSheet.getLastColumn();
  const h = rdSheet.getRange(1, 1, 1, lastCol).getValues()[0]
                   .map(function(v){ return String(v).trim(); });
  const idxBatch   = h.indexOf('BatchID');
  const idxComp    = h.indexOf('Client_Company');
  const idxStart   = h.indexOf('CutoffStart');
  const idxEnd     = h.indexOf('CutoffEnd');
  const idxFName   = h.indexOf('FileName');
  const idxPayroll = h.indexOf('PayrollID');

  const nData = rdSheet.getLastRow() - 1;
  const readCol = function(idx) {
    if (idx < 0) return new Array(nData).fill('');
    return rdSheet.getRange(2, idx + 1, nData, 1).getDisplayValues().map(function(r){ return r[0]; });
  };

  const batchIds  = readCol(idxBatch);
  const companies = readCol(idxComp);
  const starts    = readCol(idxStart);
  const ends      = readCol(idxEnd);
  const fileNames = readCol(idxFName);
  const payrollIds = readCol(idxPayroll);

  var batches = [];
  for (var r = 0; r < nData; r++) {
    var batchId  = String(batchIds[r]   || '').trim();
    var comp     = String(companies[r]  || '').trim();
    var start    = String(starts[r]     || '').trim();
    var end      = String(ends[r]       || '').trim();
    var fileName = String(fileNames[r]  || '').trim();
    var pbId     = String(payrollIds[r] || '').trim();

    if (!comp) continue;

    // Year filter
    var rowYear = '';
    if (end) { var d = new Date(end); if (!isNaN(d.getTime())) rowYear = String(d.getFullYear()); }
    if (!rowYear) { var m = batchId.match(/RAW-(\d{4})/); if (m) rowYear = m[1]; }
    if (rowYear && rowYear !== String(safeYear)) continue;

    // Skip if already linked to another payroll book
    if (pbId && pbId !== '-') continue;
    var key = batchId + '::' + comp + '::' + start + '::' + end + '::' + fileName;
    if (usedKeys.has(key)) continue;

    batches.push({ batchId: batchId, company: comp, start: start, end: end, fileName: fileName });
  }

  return batches.sort(function(a, b){ return a.company.localeCompare(b.company); });
}

function computeConsolidatedLines_(ss, pbId, batches) {
  const lines = [];
  if (batches.length === 0) return lines;

  const batchesByYear = {};
  batches.forEach(b => { let y = new Date(b.end).getFullYear(); if(isNaN(y)) y = new Date().getFullYear(); if(!batchesByYear[y]) batchesByYear[y] = []; batchesByYear[y].push(b); });

  for (const y in batchesByYear) {
      const yearBatches = batchesByYear[y];
      const targetSS = getYearlySpreadsheet_(y);
      const plSheet = targetSS.getSheetByName('PayrollLines');
      if (!plSheet) continue;

      const plData = plSheet.getDataRange().getValues(); 
      if (plData.length <= 1) continue;
      
      const plHeaders = plData[0].map(normalizeColName_);
      const hIdx = (name) => plHeaders.indexOf(normalizeColName_(name));

      for (let i = 1; i < plData.length; i++) {
        const row = plData[i];
        const cNameRaw = hIdx('companyname') > -1 ? String(row[hIdx('companyname')]).trim() : '';
        const fNameRaw = hIdx('filename') > -1 ? String(row[hIdx('filename')]).trim() : '';
        const cName = cNameRaw || (fNameRaw ? fNameRaw.split(' ')[0] : 'Unknown');
        const cStartRaw = hIdx('cutoffstart') > -1 ? row[hIdx('cutoffstart')] : '';
        const cEndRaw = hIdx('cutoffend') > -1 ? row[hIdx('cutoffend')] : '';
        const cStart = standardizeDateStr_(cStartRaw);
        const cEnd = standardizeDateStr_(cEndRaw);
        
        const rowBatchId = hIdx('batchid') > -1 ? String(row[hIdx('batchid')]).trim() : '';
        const rowFileName = hIdx('filename') > -1 ? String(row[hIdx('filename')]).trim() : '';
        const match = yearBatches.some(b => {
          // If the saved batch has a fileName, it must also match — prevents pulling in sibling
          // files that share the same batchId + company + cutoff but were not selected.
          const fileMatch = b.fileName ? (rowFileName === b.fileName) : true;
          if (b.batchId && rowBatchId) {
            return b.batchId === rowBatchId && b.company === cName && b.start === cStart && b.end === cEnd && fileMatch;
          }
          return b.company === cName && b.start === cStart && b.end === cEnd && fileMatch;
        });

        if (match) {
          const getVal = (cols) => { 
              for (let col of cols) { 
                  if (hIdx(col) > -1) {
                      let v = row[hIdx(col)];
                      if (v !== '' && v !== null && v !== undefined) {
                          if (v instanceof Date) {
                              const msPerDay = 24 * 60 * 60 * 1000;
                              const tzOffset = v.getTimezoneOffset() * 60000;
                              const serial = (v.getTime() - tzOffset) / msPerDay + 25569;
                              v = Math.round(serial * 10000) / 10000; 
                          }
                          if (typeof v === 'string') {
                              let trimmed = String(v).trim();
                              if (trimmed.startsWith('{') || trimmed.startsWith('[')) continue; 
                              if (trimmed === '-' || trimmed === '--') return 0;
                              v = trimmed.replace(/[^0-9.-]+/g, ''); 
                          }
                          const num = Number(v);
                          if (!isNaN(num)) return num;
                      }
                  } 
              } 
              return 0; 
          };

          const getStr = (col) => hIdx(col) > -1 ? String(row[hIdx(col)] || '') : '';
          
          const parseJson = (str, key) => { 
              if (!str) return 0; 
              try { 
                  let obj = str;
                  if (typeof str === 'string') obj = JSON.parse(str); 
                  const n = Number(obj[key]);
                  return isNaN(n) ? 0 : n; 
              } catch(e) { return 0; } 
          };

          const parseBenefitsJson = (str) => { 
              if (!str) return 0; 
              try { 
                  let obj = str;
                  if (typeof str === 'string') {
                      let trimmed = str.trim();
                      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
                          obj = JSON.parse(trimmed); 
                      } else {
                          return Number(str.replace(/[^0-9.-]+/g, '')) || 0;
                      }
                  }
                  if (Array.isArray(obj)) {
                      // Actual structure: [{id, info:{name, amount, billabletoclient}}, ...]
                      // Fallback: flat {amount} for legacy data
                      return obj.reduce((sum, item) => sum + (Number((item.info && item.info.amount) || item.amount || 0)), 0);
                  }
                  return Number((obj.info && obj.info.amount) || obj.amount) || Number(obj) || 0; 
              } catch(e) { return 0; } 
          };

          const gross = getVal(['grosspay', 'totalgrosspay']);
          const sss = parseJson(getStr('deductions.sss'), 'employeeContribution');
          const sssLoan = parseJson(getStr('deductions.sss'), 'loan');
          const phic = parseJson(getStr('deductions.philhealth'), 'employeeContribution');
          const hdmf = parseJson(getStr('deductions.pagibig'), 'employeeContribution');
          const hdmfLoan = parseJson(getStr('deductions.pagibig'), 'loan');
          const totalDed = sss + sssLoan + phic + hdmf + hdmfLoan || getVal(['totaleededuction']);
          const hrNet = getVal(['netpay', 'payslipnetpay']);
          const alw = parseBenefitsJson(getStr('benefits.other')) || getVal(['benefits', 'alw', 'totalbenefits']);
          const computedNet = gross + alw - totalDed;
          const diff = Math.abs(hrNet - computedNet);
          const tax = getVal(['tax', 'withholdingtax', 'withholding tax']);
          const sssER = parseJson(getStr('deductions.sss'), 'employerContribution') || getVal(['ssser', 'sss_er']);
          const phicER = parseJson(getStr('deductions.philhealth'), 'employerContribution') || getVal(['philhealther', 'phic_er']);
          const hdmfER = parseJson(getStr('deductions.pagibig'), 'employerContribution') || getVal(['pagibiger', 'hdmf_er']);
          
          let rawBankAcc = getStr('accountnumber') || getStr('bankaccountnumber') || getStr('ubaccountnumber') || getStr('bankaccount') || getStr('account') || getStr('bankaccountno') || getStr('acctno') || getStr('bankacctno') || getStr('unionbankaccount');
          
          if (!rawBankAcc) {
              const possibleIdx = plHeaders.findIndex(h => h.includes('account') && !h.includes('name') && !h.includes('type') && !h.includes('status'));
              if (possibleIdx > -1) rawBankAcc = String(row[possibleIdx] || '');
          }

          // Deep scan fallback: Check all columns for a 10-16 digit bank identifier or nested json
          if (!rawBankAcc) {
              for (let c = 0; c < row.length; c++) {
                 let cellStr = String(row[c] || '').trim();
                 // If it's just a 10 to 16 digit number and not a PH mobile number
                 if (/^[0-9]{10,16}$/.test(cellStr) && !cellStr.startsWith('09')) { rawBankAcc = cellStr; break; }
                 // If it's a JSON payload
                 if ((cellStr.startsWith('{') || cellStr.startsWith('[')) && cellStr.toLowerCase().includes('account')) {
                     try {
                         let tempMatch = cellStr.match(/"(?:accountnumber|account_number|bankaccount|account)"\s*:\s*"?([^"'}]+)"?/i);
                         if (tempMatch && tempMatch[1]) { rawBankAcc = tempMatch[1]; break; }
                     } catch(e) {}
                 }
              }
          }
          
          const isInternal = cName.toLowerCase().includes('workscale');
          let adminFee = 0; let totalBillable = 0;
          let bDailyRate = 0, bTotalDays = 0, bRegular = 0, bLatesMins = 0, bLatesAmt = 0, bTotalBsc = 0;
          let bOvertime = 0, bND = 0, bDOD = 0, bDODOT = 0, bSplHol = 0, bSplHolOT = 0, bLglHol = 0, bLglHolOT = 0;
          let bAlw = 0, bAdj = 0, b13th = 0;

          if (!isInternal) {
              const billingDataStr = getStr('billingdata');
              if (billingDataStr) {
                  try {
                      let cleanJson = billingDataStr.trim();
                      if (cleanJson.startsWith('"') && cleanJson.endsWith('"')) cleanJson = cleanJson.slice(1, -1); 
                      cleanJson = cleanJson.replace(/""/g, '"').replace(/\\"/g, '"');
                      const bData = JSON.parse(cleanJson);
                      if (bData.ServiceFee !== undefined) adminFee = Number(bData.ServiceFee) || 0;
                      if (bData.Subtotal !== undefined) totalBillable = Number(bData.Subtotal) || 0;
                      
                      bDailyRate = Number(bData.DailyRate) || 0; bTotalDays = Number(bData.TotalDays) || 0; bTotalBsc = Number(bData.TotalBasicSalary) || Number(bData.TotalAmount) || 0;
                      bRegular = bTotalBsc; bLatesMins = Number(bData.TotalLates) || 0; bLatesAmt = Number(bData.TotalLatesAmount) || 0;
                      bOvertime = Number(bData.Overtime) || 0; bND = Number(bData.NightDiff) || 0; bDOD = Number(bData.DOD) || 0; bDODOT = Number(bData.DOT_OT) || 0;
                      bSplHol = Number(bData.SplHolidaysPay) || 0; bSplHolOT = Number(bData.SplHolidaysPayOT) || 0; bLglHol = Number(bData.LegalHolidaysPay) || 0; bLglHolOT = Number(bData.LegalHolidaysOTPay) || 0;
                      bAlw = Number(bData.Allowances) || 0; bAdj = Number(bData.Adjustment) || 0; b13th = Number(bData.NthMonthPay) || 0;
                  } catch(e) { adminFee = getVal(['adminfee', 'admin_fee']); totalBillable = getVal(['totalbillable', 'total_billable']); }
              } else { adminFee = getVal(['adminfee', 'admin_fee']); totalBillable = getVal(['totalbillable', 'total_billable']); }
          }

          const rDailyRate = bDailyRate || getVal(['salaryrate', 'dailyrate']); const rTotalDays = bTotalDays || getVal(['totaldays', 'days(days)']); const rRegular = bRegular || getVal(['regularday.amount', 'regular']);
          const rLatesMins = bLatesMins || Math.round(getVal(['lates.hours', 'lates(mins)']) * 60); const rLatesAmt = bLatesAmt || getVal(['lates.amount', 'lates']); const rTotalBsc = bTotalBsc || getVal(['basicsalary', 'totalbsc']);
          const rOvertime = bOvertime || getVal(['regularovertime.amount', 'overtime']); const rND = bND || getVal(['nightdifferential.amount', 'nd']); const rDOD = bDOD || getVal(['dayoffduty.amount', 'dod']); const rDODOT = bDODOT || getVal(['excessdayoffduty.amount', 'dodot']);
          const rSplHol = bSplHol || getVal(['specialnonworkingholidaysummary', 'specialnonworkingholiday.amount', 'splhol']); const rSplHolOT = bSplHolOT || getVal(['specialnonworkingholidayovertimesummary', 'splholot']);
          const rLglHol = bLglHol || getVal(['legalholidaysummary', 'legalholiday.amount', 'lglhol']); const rLglHolOT = bLglHolOT || getVal(['legalholidayovertimesummary', 'lglholot']);
          const rAlw = bAlw || alw; const rAdj = bAdj || getVal(['adjustments', 'adjustments.0', 'adj']); const r13th = b13th || getVal(['nthmonthpaybillable', 'nthmonthpay', '13thmonth']);

          const empUid = (getStr('userid') || getStr('id')).trim();
          const salaryStatus = 'For Release';

          lines.push([ pbId, (getStr('first_name') + ' ' + getStr('last_name')).trim() || getStr('name'), rDailyRate, rTotalDays, rRegular, rLatesMins, rLatesAmt, rTotalBsc, rOvertime, rND, rDOD, rDODOT, rSplHol, rSplHolOT, rLglHol, rLglHolOT, rAlw, rAdj, gross, hdmf, hdmfLoan, sssLoan, sss, phic, totalDed, r13th, hrNet, computedNet, diff < 1.00 ? 'Passed' : 'Failed', getStr('workregion') || getStr('region'), getStr('employmenttype') || getStr('employmentstatus'), rawBankAcc, hrNet, getStr('remarks'), cStart, cEnd, cName, salaryStatus, 'Draft', tax, sssER, phicER, hdmfER, adminFee, totalBillable, empUid,
              getStr('branch'), getStr('department'), getStr('work_location'), getStr('position') ]);
        }
      }
  }
  // Deduplicate by (userid or name+company) + cutoffstart + cutoffend.
  // Guards against doubled consolidated lines if PayrollLines accumulated stale duplicate
  // rows from prior failed Replace attempts.
  const _seenLineKeys = new Set();
  return lines.filter(line => {
    const uid   = String(line[45] || '').trim();
    const comp  = String(line[36] || '').trim();
    const name  = String(line[1]  || '').trim();
    const start = String(line[34] || '').trim();
    const end   = String(line[35] || '').trim();
    const key   = (uid || comp + '::' + name) + '_' + start + '_' + end;
    if (_seenLineKeys.has(key)) return false;
    _seenLineKeys.add(key);
    return true;
  });
}

function mapManualPayrollLines_(pbId, rows) {
  const cols = [
    'PayrollID', 'Name', 'Daily Rate', 'Days (days)', 'Regular', 'Lates (mins)', 'Lates', 'Total Bsc',
    'Overtime', 'ND', 'DOD', 'DOD OT', 'Spl Hol', 'Spl Hol OT', 'Lgl Hol', 'Lgl Hol OT',
    'Alw', 'Adj', 'Total Gross Pay', 'Pagibig', 'Pagibig Loan', 'SSS Loan', 'SSS',
    'Philhealth', 'Total Deduction', '13th Month', 'Payslip Net Pay', 'Computed Net Pay',
    'Validity Check', 'Region', 'Employment Status', 'Bank Account Number', 'Amount',
    'Remarks', 'Cutoff Start', 'Cutoff End', 'Company Name', 'Salary Status', 'LineStatus',
    'Tax', 'SSS ER', 'Philhealth ER', 'Pagibig ER', 'Admin Fee', 'Total Billable', 'User ID',
    'Branch', 'Department', 'Work Location', 'Position'
  ];
  const numCols = new Set(['Daily Rate','Days (days)','Regular','Lates (mins)','Lates','Total Bsc','Overtime','ND','DOD','DOD OT','Spl Hol','Spl Hol OT','Lgl Hol','Lgl Hol OT','Alw','Adj','Total Gross Pay','Pagibig','Pagibig Loan','SSS Loan','SSS','Philhealth','Total Deduction','13th Month','Payslip Net Pay','Computed Net Pay','Amount','Tax','SSS ER','Philhealth ER','Pagibig ER','Admin Fee','Total Billable']);

  const norm = function(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  const ss = getPayrollDB_();
  const emSheet = ss.getSheetByName('EmployeeMaster');
  const emData = emSheet ? emSheet.getDataRange().getValues() : [[]];
  const emHeaders = emData[0].map(function(h) { return String(h); });
  const emIdxName    = emHeaders.indexOf('Name');
  const emIdxCo     = emHeaders.indexOf('Company Name');
  const emIdxRegion = emHeaders.indexOf('Region');
  const emIdxStatus = emHeaders.indexOf('Employment Status');
  const emIdxBank   = emHeaders.indexOf('Bank Account Number');
  const emIdxSalary = emHeaders.indexOf('Salary Status');

  var byNameCo = {};
  var byName   = {};
  for (var i = 1; i < emData.length; i++) {
    var row = emData[i];
    var n  = norm(row[emIdxName]);
    var co = norm(row[emIdxCo]);
    if (!n) continue;
    var key = n + '::' + co;
    if (!byNameCo[key]) byNameCo[key] = row;
    if (!byName[n])     byName[n]     = row;
  }

  return rows.map(function(r) {
    var rName = norm(r['Name']);
    var rCo   = norm(r['Company Name']);
    var emRow = byNameCo[rName + '::' + rCo] || byName[rName] || null;

    var fill = function(uploadVal, emIdx) {
      var v = String(uploadVal != null ? uploadVal : '').trim();
      return v !== '' ? v : (emRow && emIdx > -1 ? String(emRow[emIdx] != null ? emRow[emIdx] : '') : '');
    };
    var region   = fill(r['Region'],              emIdxRegion);
    var empStat  = fill(r['Employment Status'],   emIdxStatus);
    var bankAcc  = fill(r['Bank Account Number'], emIdxBank);
    var salStat  = fill(r['Salary Status'],       emIdxSalary);

    var baseRemark = String(r['Remarks'] != null ? r['Remarks'] : '').trim();
    var remarks = emRow ? baseRemark : (baseRemark ? baseRemark + ' ⚠ Unmatched' : '⚠ Unmatched');

    return cols.map(function(col) {
      if (col === 'PayrollID')           return pbId;
      if (col === 'LineStatus')          return salStat || 'For Release';
      if (col === 'Salary Status')       return salStat;
      if (col === 'Region')              return region;
      if (col === 'Employment Status')   return empStat;
      if (col === 'Bank Account Number') return bankAcc;
      if (col === 'Remarks')             return remarks;
      var val = r[col];
      if (numCols.has(col)) return Number(String(val != null ? val : '').replace(/[^0-9.-]/g, '')) || 0;
      return val !== undefined && val !== null ? String(val) : '';
    });
  });
}

// -------------------------------------------------------------------------
// 13TH MONTH PROCESSOR (server-side)
// -------------------------------------------------------------------------
function get13thMonthPreview(year) {
    const data = get13thMonthReport({ year: year, viewMode: 'projected', company: '', employee: '', month: -1 });
    const rows = [];
    (data.detail || []).forEach(function(co) {
        (co.employees || []).forEach(function(emp) {
            rows.push({
                userid: emp.userid || '',
                name: emp.name || '',
                company: co.company,
                isWs: emp.isWs,
                total: emp.total || 0,
                projected12: emp.projected12 || false
            });
        });
    });
    return { year: data.year, rows: rows, companies: data.companies || [] };
}

function map13thMonthLines_(pbId, year, lines) {
    const consH = [
        'PayrollID','Name','Daily Rate','Days (days)','Regular','Lates (mins)','Lates','Total Bsc',
        'Overtime','ND','DOD','DOD OT','Spl Hol','Spl Hol OT','Lgl Hol','Lgl Hol OT',
        'Alw','Adj','Total Gross Pay','Pagibig','Pagibig Loan','SSS Loan','SSS',
        'Philhealth','Total Deduction','13th Month','Payslip Net Pay','Computed Net Pay',
        'Validity Check','Region','Employment Status','Bank Account Number','Amount',
        'Remarks','Cutoff Start','Cutoff End','Company Name','Salary Status','LineStatus',
        'Tax','SSS ER','Philhealth ER','Pagibig ER','Admin Fee','Total Billable','User ID'
    ];
    var ci = {};
    consH.forEach(function(h, i) { ci[h] = i; });
    return lines.map(function(l) {
        var amt = parseFloat(l.amount) || 0;
        var isWs = String(l.company || '').toLowerCase().indexOf('workscale') !== -1;
        var row = new Array(consH.length).fill('');
        row[ci['PayrollID']]           = pbId;
        row[ci['Name']]                = l.name || '';
        row[ci['13th Month']]          = amt;
        row[ci['Total Gross Pay']]     = amt;
        row[ci['Payslip Net Pay']]     = amt;
        row[ci['Computed Net Pay']]    = amt;
        row[ci['Amount']]              = amt;
        row[ci['Company Name']]        = l.company || '';
        row[ci['Salary Status']]       = l.salaryStatus || 'FOR RELEASE';
        row[ci['Bank Account Number']] = l.bankAccount || '';
        row[ci['Remarks']]             = l.projected12 ? 'Projected Dec' : '';
        row[ci['Cutoff Start']]        = isWs ? new Date(year, 0, 1) : new Date(year - 1, 11, 1);
        row[ci['Cutoff End']]          = isWs ? new Date(year, 11, 31) : new Date(year, 10, 30);
        row[ci['User ID']]             = l.userid || '';
        row[ci['LineStatus']]          = 'Active';
        return row;
    });
}

function write13MConsolidated_(ss, pbId, year, lines) {
    var COLS = ['PayrollID','Name','UserID','Company','IsWS','SalaryStatus','BankAccount',
                'Slot0','Slot1','Slot2','Slot3','Slot4','Slot5','Slot6',
                'Slot7','Slot8','Slot9','Slot10','Slot11','Slot12','IsProjected12','Total'];
    var sh = ss.getSheetByName('13MConsolidated');
    if (!sh) {
        sh = ss.insertSheet('13MConsolidated');
        sh.appendRow(COLS);
    } else if (sh.getLastRow() === 0) {
        sh.appendRow(COLS);
    }
    // Delete existing rows for this pbId (reverse to keep indices valid)
    var allData = sh.getDataRange().getValues();
    var pidIdx = allData[0].indexOf('PayrollID');
    for (var i = allData.length - 1; i >= 1; i--) {
        if (String(allData[i][pidIdx]).trim() === String(pbId).trim()) sh.deleteRow(i + 1);
    }
    if (!lines || lines.length === 0) return;
    // Fetch per-slot breakdown from 13MDetails
    var report = get13thMonthReport({ year: year, viewMode: 'yearly', company: '', employee: '', month: -1 });
    var slotLookup = {};
    (report.detail || []).forEach(function(co) {
        (co.employees || []).forEach(function(emp) { slotLookup[co.company + '||' + emp.userid] = emp; });
    });
    var rows = [];
    lines.forEach(function(l) {
        var key = (l.company || '') + '||' + (l.userid || '');
        var empData = slotLookup[key];
        var slots = empData ? empData.slots.slice() : new Array(13).fill(0);
        var isProj12 = empData ? (empData.projected12 || false) : false;
        var total = empData ? (empData.total || 0) : (parseFloat(l.amount) || 0);
        rows.push([
            pbId, l.name || '', l.userid || '', l.company || '',
            (l.isWs || false) ? 'TRUE' : 'FALSE',
            l.salaryStatus || 'FOR RELEASE', l.bankAccount || '',
            slots[0], slots[1], slots[2], slots[3], slots[4], slots[5], slots[6],
            slots[7], slots[8], slots[9], slots[10], slots[11], slots[12],
            isProj12 ? 'TRUE' : 'FALSE', total
        ]);
    });
    if (rows.length > 0) sh.getRange(sh.getLastRow() + 1, 1, rows.length, COLS.length).setValues(rows);
}

function get13thMonthBookDetails(pbId) {
    var ss = getPayrollDB_();
    var pbSheet = ss.getSheetByName('PayrollBooks');
    if (!pbSheet) throw new Error('PayrollBooks sheet not found');
    var pbData = pbSheet.getDataRange().getDisplayValues();
    var pbH = pbData[0];
    var book = null;
    for (var i = 1; i < pbData.length; i++) {
        if (String(pbData[i][pbH.indexOf('PayrollID')]).trim() === String(pbId).trim()) {
            book = {};
            pbH.forEach(function(h, idx) { book[h] = pbData[i][idx]; });
            break;
        }
    }
    if (!book) throw new Error('Payroll Book not found');
    var attrMatch = String(book.Attribution || '').match(/^(\d{4})/);
    var year = attrMatch ? parseInt(attrMatch[1], 10) : new Date().getFullYear();
    // Read directly from 13MConsolidated
    var employees = [];
    var sh = ss.getSheetByName('13MConsolidated');
    if (sh && sh.getLastRow() > 1) {
        var data = sh.getDataRange().getValues();
        var h = data[0];
        var pidIdx = h.indexOf('PayrollID');
        var nmIdx  = h.indexOf('Name');
        var uidIdx = h.indexOf('UserID');
        var coIdx  = h.indexOf('Company');
        var wsIdx  = h.indexOf('IsWS');
        var ssIdx  = h.indexOf('SalaryStatus');
        var baIdx  = h.indexOf('BankAccount');
        var s0Idx  = h.indexOf('Slot0');
        var p12Idx = h.indexOf('IsProjected12');
        var totIdx = h.indexOf('Total');
        for (var i = 1; i < data.length; i++) {
            if (String(data[i][pidIdx]).trim() !== String(pbId).trim()) continue;
            var slots = [];
            for (var s = 0; s < 13; s++) slots.push(parseFloat(data[i][s0Idx + s]) || 0);
            employees.push({
                name:        String(data[i][nmIdx]  || ''),
                userid:      String(data[i][uidIdx]  || ''),
                company:     String(data[i][coIdx]   || ''),
                isWs:        String(data[i][wsIdx]   || '').toUpperCase() === 'TRUE',
                salaryStatus:String(data[i][ssIdx]   || '') || 'FOR RELEASE',
                bankAccount: String(data[i][baIdx]   || ''),
                slots:       slots,
                projected12: String(data[i][p12Idx]  || '').toUpperCase() === 'TRUE',
                total:       parseFloat(data[i][totIdx]) || 0
            });
        }
    }
    return { book: book, year: year, employees: employees };
}

function create13thMonthBook(payload) {
    try {
        const ss = getPayrollDB_();
        let sheet = ss.getSheetByName('PayrollBooks');
        if (!sheet) sheet = ss.insertSheet('PayrollBooks');
        const h = ensurePayrollBooksHeaders_(sheet);
        const timestamp = new Date();
        const user = Session.getEffectiveUser().getEmail() || 'Unknown';
        const pbId = "PB-" + Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
        const companies = [...new Set((payload.lines || []).map(function(l){ return l.company; }).filter(Boolean))];
        const row = new Array(h.length).fill('');
        row[h.indexOf('PayrollID')]          = pbId;
        row[h.indexOf('Name')]               = payload.name;
        row[h.indexOf('Attribution')]        = payload.attribution;
        row[h.indexOf('PayoutDate')]         = standardizeDateStr_(payload.payoutDate);
        row[h.indexOf('ClientsSummary')]     = companies.join(', ') || '13th Month';
        row[h.indexOf('BatchesJSON')]        = '[]';
        row[h.indexOf('Type')]               = '13th Month';
        row[h.indexOf('Status')]             = 'Draft';
        row[h.indexOf('CreatedAt')]          = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "MM/dd/yyyy HH:mm:ss");
        row[h.indexOf('CreatedBy')]          = user;
        row[h.indexOf('GeneratedPaysheets')] = '[]';
        if (h.indexOf('Outdated') > -1) row[h.indexOf('Outdated')] = 'FALSE';
        sheet.appendRow(row);
        write13MConsolidated_(ss, pbId, parseInt(payload.year), payload.lines || []);
        syncJournalEntries_(pbId, false);
        return { success: true, pbId: pbId };
    } catch (error) { throw new Error('Failed to create 13th Month Book: ' + error.message); }
}

function update13thMonthBook(payload) {
    try {
        const ss = getPayrollDB_();
        const sheet = ss.getSheetByName('PayrollBooks');
        if (!sheet) throw new Error('PayrollBooks sheet not found');
        const data = sheet.getDataRange().getValues();
        const h = data[0];
        let rowIdx = -1;
        for (let i = 1; i < data.length; i++) {
            if (String(data[i][h.indexOf('PayrollID')]).trim() === String(payload.pbId).trim()) { rowIdx = i + 1; break; }
        }
        if (rowIdx === -1) throw new Error('Payroll Book not found');
        const companies = [...new Set((payload.lines || []).map(function(l){ return l.company; }).filter(Boolean))];
        sheet.getRange(rowIdx, h.indexOf('Name') + 1).setValue(payload.name);
        sheet.getRange(rowIdx, h.indexOf('Attribution') + 1).setValue(payload.attribution);
        sheet.getRange(rowIdx, h.indexOf('PayoutDate') + 1).setValue(standardizeDateStr_(payload.payoutDate));
        sheet.getRange(rowIdx, h.indexOf('ClientsSummary') + 1).setValue(companies.join(', ') || '13th Month');
        write13MConsolidated_(ss, payload.pbId, parseInt(payload.year), payload.lines || []);
        syncJournalEntries_(payload.pbId, false);
        return { success: true, pbId: payload.pbId };
    } catch (error) { throw new Error('Failed to update 13th Month Book: ' + error.message); }
}

function createPayrollBook(payload) {
  try {
    const ss = getPayrollDB_();
    let sheet = ss.getSheetByName('PayrollBooks');
    if (!sheet) sheet = ss.insertSheet('PayrollBooks');
    const h = ensurePayrollBooksHeaders_(sheet);
    const timestamp = new Date();
    const user = Session.getEffectiveUser().getEmail() || 'Unknown';
    const pbId = "PB-" + Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");

    let clientsSummary = payload.isManual ? "Manual Entry" : "None Selected";
    let batchesJson = "[]"; let consolidatedLines = [];
    if (payload.isManual && payload.manualLines && payload.manualLines.length > 0) {
      consolidatedLines = mapManualPayrollLines_(pbId, payload.manualLines);
      const companies = [...new Set(payload.manualLines.map(r => r['Company Name'] || '').filter(Boolean))];
      clientsSummary = companies.join(', ') || 'Manual Entry';
    } else if (!payload.isManual && payload.batches && payload.batches.length > 0) {
       const uniqueClients = new Set(payload.batches.map(b => b.company)); clientsSummary = Array.from(uniqueClients).join(', '); batchesJson = JSON.stringify(payload.batches); consolidatedLines = computeConsolidatedLines_(ss, pbId, payload.batches);
    }
    const row = new Array(h.length).fill('');
    row[h.indexOf('PayrollID')] = pbId; row[h.indexOf('Name')] = payload.name; row[h.indexOf('Attribution')] = payload.attribution; row[h.indexOf('PayoutDate')] = standardizeDateStr_(payload.payoutDate);
    row[h.indexOf('ClientsSummary')] = clientsSummary; row[h.indexOf('BatchesJSON')] = batchesJson; row[h.indexOf('Type')] = payload.isManual ? 'Manual' : 'HRIS Data';
    row[h.indexOf('Status')] = 'Draft'; row[h.indexOf('CreatedAt')] = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "MM/dd/yyyy HH:mm:ss"); row[h.indexOf('CreatedBy')] = user; row[h.indexOf('GeneratedPaysheets')] = '[]'; if(h.indexOf('Outdated') > -1) row[h.indexOf('Outdated')] = 'FALSE';
    sheet.appendRow(row);

    if (consolidatedLines.length > 0) {
        let consSheet = ss.getSheetByName('PayrollBookConsolidated'); if (!consSheet) consSheet = ss.insertSheet('PayrollBookConsolidated');
        const consHeaders = ensurePayrollBookConsolidatedHeaders_(consSheet);
        const targetRange = consSheet.getRange(consSheet.getLastRow() + 1, 1, consolidatedLines.length, consHeaders.length); targetRange.setValues(consolidatedLines); formatConsolidatedSheet_(ss, consHeaders);
        
        // Fix 2: Correctly flip 'Active' → 'For Release' in WRI Masterlist for all employees.
        // Previously broken: consHeaders.indexOf('CompanyName') always returned -1 (header is 'Company Name'),
        // and userid was never passed, so syncWriMasterlistByNameCompany_ could never match any row.
        const employeeUpdates = consolidatedLines.map(line => ({
            userid:       String(line[45] || '').trim(),   // User ID index 45
            name:         String(line[1]  || '').trim(),   // Name index 1
            company:      String(line[36] || '').trim(),   // Company Name index 36
            salaryStatus: 'For Release'
        }));
        if (employeeUpdates.length > 0) {
            syncWriMasterlistByNameCompany_(employeeUpdates);
            syncWriMasterlistByUserid_(employeeUpdates);
        }
    }
    
    syncJournalEntries_(pbId, false);
    return { success: true, pbId: pbId };
  } catch (error) { throw new Error("Failed to create Payroll Book: " + error.message); }
}

function updatePayrollBook(payload) {
  try {
    const ss = getPayrollDB_();
    const sheet = ss.getSheetByName('PayrollBooks'); if (!sheet) throw new Error("PayrollBooks sheet not found");
    const data = sheet.getDataRange().getValues(); const h = data[0]; let rowIdx = -1;
    for (let i = 1; i < data.length; i++) { if (String(data[i][h.indexOf('PayrollID')]).trim() === String(payload.pbId).trim()) { rowIdx = i + 1; break; } }
    if (rowIdx === -1) throw new Error("Payroll Book not found");

    let clientsSummary = payload.isManual ? "Manual Entry" : "None Selected"; let batchesJson = "[]"; let consolidatedLines = [];
    if (payload.isManual && payload.manualLines && payload.manualLines.length > 0) {
      consolidatedLines = mapManualPayrollLines_(payload.pbId, payload.manualLines);
      const companies = [...new Set(payload.manualLines.map(r => r['Company Name'] || '').filter(Boolean))];
      clientsSummary = companies.join(', ') || 'Manual Entry';
    } else if (!payload.isManual && payload.batches && payload.batches.length > 0) {
       const uniqueClients = new Set(payload.batches.map(b => b.company)); clientsSummary = Array.from(uniqueClients).join(', '); batchesJson = JSON.stringify(payload.batches); consolidatedLines = computeConsolidatedLines_(ss, payload.pbId, payload.batches);
    }
    sheet.getRange(rowIdx, h.indexOf('Name') + 1).setValue(payload.name); sheet.getRange(rowIdx, h.indexOf('Attribution') + 1).setValue(payload.attribution); sheet.getRange(rowIdx, h.indexOf('PayoutDate') + 1).setValue(standardizeDateStr_(payload.payoutDate));
    sheet.getRange(rowIdx, h.indexOf('ClientsSummary') + 1).setValue(clientsSummary); sheet.getRange(rowIdx, h.indexOf('BatchesJSON') + 1).setValue(batchesJson); sheet.getRange(rowIdx, h.indexOf('Type') + 1).setValue(payload.isManual ? 'Manual' : 'HRIS Data');
    
    let consSheet = ss.getSheetByName('PayrollBookConsolidated');
    if (!consSheet) consSheet = ss.insertSheet('PayrollBookConsolidated');
    const consHeaders = ensurePayrollBookConsolidatedHeaders_(consSheet);
    const allUPData = consSheet.getLastRow() > 0 ? consSheet.getDataRange().getValues() : [consHeaders];
    const upCpIdx = allUPData[0].map(normalizeColName_).indexOf('payrollid');
    const numUPCols = allUPData[0].length;
    const keptUPRows = [allUPData[0]].concat(allUPData.slice(1).filter(row => String(row[upCpIdx] || '').trim() !== String(payload.pbId).trim()));
    consSheet.clearContents();
    consSheet.getRange(1, 1, keptUPRows.length, numUPCols).setValues(keptUPRows);
    if (consolidatedLines.length > 0) {
        consSheet.getRange(consSheet.getLastRow() + 1, 1, consolidatedLines.length, consHeaders.length).setValues(consolidatedLines);
        formatConsolidatedSheet_(ss, consHeaders);
    }

    // Sync salarystatus changes to WRI Masterlist for added/removed employees.
    // Collect the OLD employee set (before rewrite) from keptUPRows.
    try {
      const normKeptH = keptUPRows[0].map(normalizeColName_);
      const kUidIdx  = normKeptH.indexOf('userid');
      const kNIdx    = normKeptH.indexOf('name');
      const kCIdx    = normKeptH.indexOf('companyname');
      const oldUids  = new Set();
      for (let i = 1; i < keptUPRows.length; i++) {
        const uid = kUidIdx > -1 ? String(keptUPRows[i][kUidIdx] || '').trim() : '';
        if (uid) oldUids.add(uid);
      }
      // NEW employee set from freshly written consolidatedLines
      // Column indices follow ensurePayrollBookConsolidatedHeaders_ order: index 45 = userid, 1 = name, 36 = companyname
      const addedUpdates   = [];
      const newUids        = new Set();
      consolidatedLines.forEach(line => {
        const uid  = String(line[45] || '').trim();
        const name = String(line[1]  || '').trim();
        const comp = String(line[36] || '').trim();
        if (uid) newUids.add(uid);
        if (!oldUids.has(uid)) {
          // Employee newly added — set to 'For Release'
          addedUpdates.push({ userid: uid, name: name, company: comp, salaryStatus: 'For Release' });
        }
      });
      // Employees removed from this book — revert to 'Active'
      const removedUpdates = [];
      for (let i = 1; i < keptUPRows.length; i++) {
        const uid  = kUidIdx > -1 ? String(keptUPRows[i][kUidIdx] || '').trim() : '';
        const name = kNIdx  > -1 ? String(keptUPRows[i][kNIdx]   || '').trim() : '';
        const comp = kCIdx  > -1 ? String(keptUPRows[i][kCIdx]   || '').trim() : '';
        if (uid && !newUids.has(uid)) {
          removedUpdates.push({ userid: uid, name: name, company: comp, salaryStatus: 'Active' });
        }
      }
      if (addedUpdates.length > 0) {
        syncWriMasterlistByNameCompany_(addedUpdates);
        syncWriMasterlistByUserid_(addedUpdates);
      }
      if (removedUpdates.length > 0) {
        syncWriMasterlistByNameCompany_(removedUpdates);
        syncWriMasterlistByUserid_(removedUpdates);
      }
    } catch(e) { Logger.log('updatePayrollBook WRI sync error: ' + e.message); }

    syncJournalEntries_(payload.pbId, false);
    return { success: true, pbId: payload.pbId };
  } catch (error) { throw new Error("Failed to update Payroll Book: " + error.message); }
}

function regeneratePayrollBook(pbId) {
  try {
    const ss = getPayrollDB_(); const pbSheet = ss.getSheetByName('PayrollBooks'); if (!pbSheet) throw new Error("PayrollBooks sheet not found");
    const pbData = pbSheet.getDataRange().getValues(); const h = pbData[0]; let rowIdx = -1; let book = null;
    for (let i = 1; i < pbData.length; i++) { if (String(pbData[i][h.indexOf('PayrollID')]).trim() === String(pbId).trim()) { rowIdx = i + 1; book = {}; h.forEach((col, idx) => book[col] = pbData[i][idx]); break; } }
    if (!book) throw new Error("Payroll Book not found"); if (book.Status !== 'Draft') throw new Error("Cannot update a Book that is already processing."); if (book.Type === 'Manual') throw new Error("Cannot automatically update a Manual entry book.");
    let batches = []; try { batches = JSON.parse(book.BatchesJSON || "[]"); } catch(e) {}
    if (batches.length === 0) throw new Error("No batches found to regenerate.");

    const oldStatusMap = {}; let consSheet = ss.getSheetByName('PayrollBookConsolidated');
    if (consSheet) {
        const cData = consSheet.getDataRange().getValues(); const consHeaders = cData[0].map(ch => normalizeColName_(ch)); const cpIdx = consHeaders.indexOf('payrollid'); const cNameIdx = consHeaders.indexOf('name'); const cCompIdx = consHeaders.indexOf('companyname'); const cStatIdx = consHeaders.indexOf('salarystatus');
        if (cpIdx > -1 && cNameIdx > -1 && cCompIdx > -1 && cStatIdx > -1) { const cUidIdx = consHeaders.indexOf('userid'); for (let i = 1; i < cData.length; i++) { if (String(cData[i][cpIdx]).trim() === String(pbId).trim()) { const uid = cUidIdx > -1 ? String(cData[i][cUidIdx] || '').trim() : ''; const key = uid ? uid : `${String(cData[i][cCompIdx]).trim()}::${String(cData[i][cNameIdx]).trim()}`; oldStatusMap[key] = cData[i][cStatIdx]; } } }
    }

    const consolidatedLines = computeConsolidatedLines_(ss, pbId, batches);
    // Preserve ONLY genuine manual overrides from the old consolidated sheet.
    // A status of 'For Release' is the default and should NOT override the fresh WRI value.
    consolidatedLines.forEach(line => {
        const uid = String(line[45] || '').trim(); const comp = String(line[36]).trim(); const name = String(line[1]).trim();
        const key = uid ? uid : `${comp}::${name}`;
        const oldStatus = String(oldStatusMap[key] || '').trim();
        // Fix 3: Exclude 'Active' from preserved statuses — it is an employment status value
        // that leaked into Salary Status due to Fix 2's bug. Only genuine disbursement
        // instructions (e.g. 'HOLD', 'FOR RELEASE-BPI', 'FOR RELEASE-CHECK') should be preserved.
        if (oldStatus && oldStatus !== 'For Release' && oldStatus.toUpperCase() !== 'ACTIVE') { line[37] = oldStatus; }
    });

    // Replace the stale deleteRows loop with a safe read-filter-rewrite so row index
    // shifts caused by mid-loop deletions can never leave behind un-deleted rows.
    if (!consSheet) consSheet = ss.insertSheet('PayrollBookConsolidated');
    const actualConsHeaders = ensurePayrollBookConsolidatedHeaders_(consSheet);
    const allConsData = consSheet.getLastRow() > 0 ? consSheet.getDataRange().getValues() : [actualConsHeaders];
    const cpIdxCons = allConsData[0].map(normalizeColName_).indexOf('payrollid');
    const numConsCols = allConsData[0].length;
    const keptConsRows = [allConsData[0]].concat(allConsData.slice(1).filter(row => String(row[cpIdxCons] || '').trim() !== String(pbId).trim()));
    consSheet.clearContents();
    consSheet.getRange(1, 1, keptConsRows.length, numConsCols).setValues(keptConsRows);
    if (consolidatedLines.length > 0) {
        consSheet.getRange(consSheet.getLastRow() + 1, 1, consolidatedLines.length, actualConsHeaders.length).setValues(consolidatedLines);
        formatConsolidatedSheet_(ss, actualConsHeaders);
    }
    let outIdx = h.indexOf('Outdated'); if (outIdx === -1) { outIdx = h.length; pbSheet.getRange(1, outIdx + 1).setValue('Outdated'); } pbSheet.getRange(rowIdx, outIdx + 1).setValue('FALSE');
    syncJournalEntries_(pbId, false);
    return { success: true, pbId: pbId };
  } catch (error) { throw new Error("Failed to update Payroll Book: " + error.message); }
}

function deletePayrollBook(pbId) {
  try {
    const ss = getPayrollDB_();
    
    // Build a set of Inactive employees from WRI Masterlist (skip reverting those)
    const inactiveSet = new Set();
    try {
      const mlSheet = getWriMasterlistSheet_();
      if (mlSheet) {
        const mlData = mlSheet.getDataRange().getValues();
        const mlH = mlData[0].map(normalizeColName_);
        const mlNameIdx = mlH.indexOf('name');
        const mlCompIdx = mlH.indexOf('companyname');
        const mlStatIdx = mlH.indexOf('employeestatus');
        for (let i = 1; i < mlData.length; i++) {
          if (String(mlData[i][mlStatIdx] || '').trim().toLowerCase() === 'inactive') {
            const key = String(mlData[i][mlNameIdx] || '').trim().toLowerCase() + '|' + String(mlData[i][mlCompIdx] || '').trim().toLowerCase();
            inactiveSet.add(key);
          }
        }
      }
    } catch(e) { Logger.log('deletePayrollBook: could not load Masterlist for inactive check: ' + e.message); }

    // Collect ALL employees in this book and revert to 'Active', skipping Inactive ones
    const employeesToRevert = [];
    const consSheet = ss.getSheetByName('PayrollBookConsolidated');
    if (consSheet) {
        const cData = consSheet.getDataRange().getValues();
        const consH = cData[0].map(normalizeColName_);
        const pidIdx = consH.indexOf('payrollid');
        const nameIdx = consH.indexOf('name');
        const compIdx = consH.indexOf('companyname');
        
        for (let i = 1; i < cData.length; i++) {
            if (String(cData[i][pidIdx]).trim() === String(pbId).trim()) {
                const name = String(cData[i][nameIdx] || '').trim();
                const company = String(cData[i][compIdx] || '').trim();
                const key = name.toLowerCase() + '|' + company.toLowerCase();
                if (!inactiveSet.has(key)) {
                    employeesToRevert.push({ name, company, salaryStatus: 'Active' });
                }
            }
        }
    }
    
    // Revert employee statuses in WRI Masterlist
    if (employeesToRevert.length > 0) {
        syncWriMasterlistByNameCompany_(employeesToRevert);
    }
    
    const pbSheet = ss.getSheetByName('PayrollBooks');
    if (pbSheet) { const data = pbSheet.getDataRange().getValues(); const idIdx = data[0].indexOf('PayrollID'); for (let i = data.length - 1; i >= 1; i--) { if (String(data[i][idIdx]).trim() === String(pbId).trim()) { pbSheet.deleteRow(i + 1); break; } } }
    
    if (consSheet) {
        const cData = consSheet.getDataRange().getValues(); const cpIdx = cData[0].map(ch => normalizeColName_(ch)).indexOf('payrollid');
        if (cpIdx > -1) { for (let i = cData.length - 1; i >= 1; i--) { if (String(cData[i][cpIdx]).trim() === String(pbId).trim()) { consSheet.deleteRow(i + 1); } } }
    }
    const sheet13mc = ss.getSheetByName('13MConsolidated');
    if (sheet13mc && sheet13mc.getLastRow() > 1) {
        const mc = sheet13mc.getDataRange().getValues();
        const mcPidIdx = mc[0].indexOf('PayrollID');
        if (mcPidIdx > -1) {
            for (let i = mc.length - 1; i >= 1; i--) {
                if (String(mc[i][mcPidIdx]).trim() === String(pbId).trim()) sheet13mc.deleteRow(i + 1);
            }
        }
    }
    deleteCentralJournalLines_(pbId);
    return { success: true };
  } catch (error) { throw new Error("Failed to delete Payroll Book: " + error.message); }
}

function getPayrollBooks() {
  const ss = getPayrollDB_(); const sheet = ss.getSheetByName('PayrollBooks'); if (!sheet) return [];
  const data = sheet.getDataRange().getDisplayValues(); if (data.length < 2) return [];
  
  // Calculate stats from consolidated sheet (regular books) and 13MConsolidated (13th Month books)
  const summaryMap = {};
  const consSheet = ss.getSheetByName('PayrollBookConsolidated');
  if (consSheet) {
      const consData = consSheet.getDataRange().getValues();
      if (consData.length > 1) {
          const consH = consData[0].map(normalizeColName_);
          const pidI = consH.indexOf('payrollid');
          const statI = consH.indexOf('salarystatus');
          const netI = consH.indexOf('payslipnetpay');
          if (pidI > -1 && statI > -1 && netI > -1) {
              for (let i = 1; i < consData.length; i++) {
                  let pId = String(consData[i][pidI]).trim();
                  if (!summaryMap[pId]) summaryMap[pId] = { count: 0, hold: 0, release: 0, net: 0 };
                  summaryMap[pId].count++;
                  
                  let statStr = String(consData[i][statI] || '').toUpperCase().trim();
                  let rawNet = Number(String(consData[i][netI] || 0).replace(/[^0-9.-]+/g, '')) || 0;
                  
                  let isBpi = statStr === 'FOR RELEASE' || statStr.includes('-BPI'); 
                  let isHold = statStr === 'HOLD';
                  let isOtherHold = statStr.includes('HOLD') || statStr.includes('CHECK ACCOUNT');
                  let isCheck = isCheckPayment_(statStr);
                  let fee = (!isBpi && !isCheck && !isOtherHold && statStr !== '') ? 50 : 0;
                  
                  if (!isHold) summaryMap[pId].net += (rawNet - fee);
                  if (isOtherHold) summaryMap[pId].hold++; else summaryMap[pId].release++;
              }
          }
      }
  }
  const sheet13mc = ss.getSheetByName('13MConsolidated');
  if (sheet13mc && sheet13mc.getLastRow() > 1) {
      const mcData = sheet13mc.getDataRange().getValues();
      if (mcData.length > 1) {
          const mcH = mcData[0];
          const mcPid  = mcH.indexOf('PayrollID');
          const mcStat = mcH.indexOf('SalaryStatus');
          const mcTot  = mcH.indexOf('Total');
          if (mcPid > -1) {
              for (let i = 1; i < mcData.length; i++) {
                  let pId = String(mcData[i][mcPid] || '').trim();
                  if (!pId) continue;
                  if (!summaryMap[pId]) summaryMap[pId] = { count: 0, hold: 0, release: 0, net: 0 };
                  summaryMap[pId].count++;
                  let statStr = String(mcStat > -1 ? mcData[i][mcStat] : '').toUpperCase().trim();
                  let tot = mcTot > -1 ? (parseFloat(mcData[i][mcTot]) || 0) : 0;
                  let isOtherHold = statStr.includes('HOLD') || statStr.includes('CHECK ACCOUNT');
                  let isCheck13m = isCheckPayment_(statStr);
                  if (!isOtherHold) { if (isCheck13m) summaryMap[pId].net += tot; else summaryMap[pId].net += tot; }
                  if (isOtherHold) summaryMap[pId].hold++; else summaryMap[pId].release++;
              }
          }
      }
  }

  const headers = data[0]; const result = [];
  for (let i = 1; i < data.length; i++) { 
      const obj = {}; headers.forEach((h, idx) => { obj[h] = data[i][idx]; }); 
      let pId = obj['PayrollID'];
      if (summaryMap[pId]) {
          obj['EmployeeCount'] = summaryMap[pId].count;
          obj['HoldCount'] = summaryMap[pId].hold;
          obj['ReleaseCount'] = summaryMap[pId].release;
          obj['NetPayroll'] = summaryMap[pId].net;
      } else {
          obj['EmployeeCount'] = 0; obj['HoldCount'] = 0; obj['ReleaseCount'] = 0; obj['NetPayroll'] = 0;
      }
      result.push(obj); 
  }
  return result.reverse(); 
}

function getPayrollBookDetails(pbId) {
  const ss = getPayrollDB_(); const pbSheet = ss.getSheetByName('PayrollBooks'); if (!pbSheet) throw new Error("PayrollBooks sheet not found");
  const pbData = pbSheet.getDataRange().getDisplayValues(); const pbHeaders = pbData[0]; let book = null;
  for (let i = 1; i < pbData.length; i++) { if (String(pbData[i][pbHeaders.indexOf('PayrollID')]).trim() === String(pbId).trim()) { book = {}; pbHeaders.forEach((h, idx) => book[h] = pbData[i][idx]); break; } }
  if (!book) throw new Error("Payroll Book not found");
  const lines = []; const consSheet = ss.getSheetByName('PayrollBookConsolidated');
  if (consSheet) {
      const consData = consSheet.getDataRange().getDisplayValues(); 
      if (consData.length > 1) { const consHeaders = consData[0]; const pIdIdx = consHeaders.indexOf('PayrollID'); for(let i = 1; i < consData.length; i++) { if (String(consData[i][pIdIdx]).trim() === String(pbId).trim()) { const obj = {}; consHeaders.forEach((h, idx) => { if (h !== 'PayrollID' && h !== 'LineStatus') { obj[h] = consData[i][idx]; } }); lines.push(obj); } } }
  }
  // Patch stale 'For Release' statuses with the current WRI Masterlist value so a page refresh
  // always shows up-to-date salary status without requiring a full regeneration.
  try {
    const wriSheet = getWriMasterlistSheet_();
    if (wriSheet.getLastRow() > 1) {
      const wriData = wriSheet.getDataRange().getValues();
      const wriH    = wriData[0].map(normalizeColName_);
      const wUidIdx = wriH.indexOf('userid');
      const wStIdx  = wriH.indexOf('salarystatus');
      if (wUidIdx > -1 && wStIdx > -1) {
        const wriStatusByUid = {};
        for (let i = 1; i < wriData.length; i++) {
          const uid = String(wriData[i][wUidIdx] || '').trim();
          const st  = String(wriData[i][wStIdx]  || '').trim();
          if (uid && st) wriStatusByUid[uid] = st;
        }
        // Collect which sheet rows need patching (only 'For Release' rows)
        const rawConsData = consSheet.getDataRange().getValues();
        const rawHeaders  = rawConsData[0].map(normalizeColName_);
        const rPidIdx  = rawHeaders.indexOf('payrollid');
        const rUidIdx  = rawHeaders.indexOf('userid');
        const rStatIdx = rawHeaders.indexOf('salarystatus');
        if (rPidIdx > -1 && rUidIdx > -1 && rStatIdx > -1) {
          const patchedRows = [];
          for (let i = 1; i < rawConsData.length; i++) {
            if (String(rawConsData[i][rPidIdx]).trim() !== String(pbId).trim()) continue;
            const uid       = String(rawConsData[i][rUidIdx] || '').trim();
            const curStatus = String(rawConsData[i][rStatIdx] || '').trim();
            if (uid && curStatus === 'For Release' && wriStatusByUid[uid] && wriStatusByUid[uid] !== 'For Release') {
              patchedRows.push({ row: i + 1, newStatus: wriStatusByUid[uid] });
            }
          }
          patchedRows.forEach(p => { consSheet.getRange(p.row, rStatIdx + 1).setValue(p.newStatus); });
          // Update in-memory lines too so the response to the client is immediately correct
          lines.forEach(line => {
            const uid = String(line['User ID'] || '').trim();
            if (uid && String(line['Salary Status']).trim() === 'For Release' && wriStatusByUid[uid] && wriStatusByUid[uid] !== 'For Release') {
              line['Salary Status'] = wriStatusByUid[uid];
            }
          });
        }
      }
    }
  } catch(e) { Logger.log('getPayrollBookDetails WRI patch error: ' + e.message); }
  // Look up voucher status from Disbursement DB so UI can show/hide Route Voucher button
  // Guard: if the stored value is an email it's corrupted data from a past column-misalignment bug — treat as empty.
  // Fallback: VoucherId in Disbursement DB equals pbId, so use pbId when status is Vouchered.
  let linkedVid = (String(book['LinkedVoucherId'] || '').includes('@')) ? '' : String(book['LinkedVoucherId'] || '').trim();
  if (!linkedVid && String(book['Status'] || '').toLowerCase() === 'vouchered') linkedVid = String(pbId).trim();
  book['LinkedVoucherId'] = linkedVid;
  let voucherStatus = '';
  if (linkedVid) {
    try {
      const disbSS = SpreadsheetApp.openById(DISBURSEMENT_DB_ID);
      const vSheet = disbSS.getSheetByName('Vouchers');
      if (vSheet) {
        const vData = vSheet.getDataRange().getValues();
        const vHdr  = vData[0];
        const vidI  = vHdr.indexOf('VoucherId');
        const stI   = vHdr.indexOf('Status');
        for (let i = 1; i < vData.length; i++) {
          if (String(vData[i][vidI]).trim() === String(linkedVid).trim()) {
            voucherStatus = String(vData[i][stI]).trim(); break;
          }
        }
      }
    } catch(e) { Logger.log('getPayrollBookDetails voucher status: ' + e.message); }
  }
  book['VoucherStatus'] = voucherStatus;
  return { book: book, lines: lines };
}

function savePayrollBookLines(payload) {
  const { pbId, lines } = payload; const ss = getPayrollDB_(); const consSheet = ss.getSheetByName('PayrollBookConsolidated'); if (!consSheet) throw new Error("Consolidated sheet not found");
  const data = consSheet.getDataRange().getValues(); const headers = data[0]; const cleanHeaders = headers.map(normalizeColName_); const pIdIdx = cleanHeaders.indexOf('payrollid'); 
  let salaryStatusIdx = cleanHeaders.indexOf('salarystatus');
  let bankAccIdx = cleanHeaders.findIndex(h => h === 'bankaccountnumber' || h === 'ubaccountnumber' || h === 'bankaccount');
  if (salaryStatusIdx === -1) { salaryStatusIdx = headers.length; consSheet.getRange(1, salaryStatusIdx + 1).setValue('Salary Status'); data.forEach(r => r.push('')); }
  let startRow = -1; let count = 0;
  for(let i=1; i<data.length; i++) { if(String(data[i][pIdIdx]).trim() === String(pbId).trim()) { if(startRow === -1) startRow = i + 1; count++; } }
  
  if (startRow !== -1 && count === lines.length) { 
      const statusValues = lines.map(l => [l['Salary Status'] || '']); 
      consSheet.getRange(startRow, salaryStatusIdx + 1, count, 1).setValues(statusValues);
      if (bankAccIdx > -1) {
          const bankValues = lines.map(l => [l['Bank Account Number'] || l['UB Account Number'] || l['Bank Account'] || '']);
          consSheet.getRange(startRow, bankAccIdx + 1, count, 1).setValues(bankValues);
      }
  } else if (count > 0) { 
      let writeArray = consSheet.getRange(2, salaryStatusIdx + 1, data.length - 1, 1).getValues(); 
      let bankArray = bankAccIdx > -1 ? consSheet.getRange(2, bankAccIdx + 1, data.length - 1, 1).getValues() : null;
      let lineIdx = 0; 
      for(let i=1; i<data.length; i++) { 
          if(String(data[i][pIdIdx]).trim() === String(pbId).trim() && lineIdx < lines.length) { 
              writeArray[i-1][0] = lines[lineIdx]['Salary Status'] || ''; 
              if (bankArray) bankArray[i-1][0] = lines[lineIdx]['Bank Account Number'] || lines[lineIdx]['UB Account Number'] || lines[lineIdx]['Bank Account'] || '';
              lineIdx++; 
          } 
      } 
      consSheet.getRange(2, salaryStatusIdx + 1, data.length - 1, 1).setValues(writeArray); 
      if (bankArray) consSheet.getRange(2, bankAccIdx + 1, data.length - 1, 1).setValues(bankArray);
  }
  syncJournalEntries_(pbId, false);
  // Sync salary status changes to WRI Employee Masterlist using userid as PK (from PayrollBookConsolidated)
  try {
    const uidIdx2 = cleanHeaders.indexOf('userid');
    const nIdx2   = cleanHeaders.indexOf('name');
    const cIdx2   = cleanHeaders.indexOf('companyname');
    // Build a map of userid -> {name, company} from PBC rows for this pbId
    const pbcByUid = {};
    if (uidIdx2 > -1) {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][pIdIdx]).trim() !== String(pbId).trim()) continue;
        const uid = String(data[i][uidIdx2] || '').trim();
        if (uid) pbcByUid[uid] = { name: String(data[i][nIdx2] || '').trim(), company: String(data[i][cIdx2] || '').trim() };
      }
    }
    // Build WRI sync updates: userid is primary key; each line carries its userid directly
    const wriUpdates = lines.map(l => {
      const uid = String(l['User ID'] || l['userid'] || '').trim();
      const nameComp = pbcByUid[uid] || { name: String(l['Name'] || '').trim(), company: String(l['Company Name'] || l['Company'] || '').trim() };
      return { userid: uid, name: nameComp.name, company: nameComp.company, status: l['Salary Status'] || '' };
    });
    syncOverlayToEmployeeMaster_(wriUpdates);
  } catch(e) {}
  // Sync SalaryStatus changes to 13MConsolidated (for 13th Month books)
  try {
    var sh13mc = ss.getSheetByName('13MConsolidated');
    if (sh13mc && sh13mc.getLastRow() > 1) {
      var d13mc = sh13mc.getDataRange().getValues();
      var hdr13mc = d13mc[0];
      var pid13mc = hdr13mc.indexOf('PayrollID');
      var uid13mc = hdr13mc.indexOf('UserID');
      var ssi13mc = hdr13mc.indexOf('SalaryStatus');
      if (pid13mc > -1 && uid13mc > -1 && ssi13mc > -1) {
        var stsByUid = {};
        lines.forEach(function(l) { var u = String(l['User ID'] || l['userid'] || '').trim(); if (u) stsByUid[u] = l['Salary Status'] || ''; });
        for (var ri = 1; ri < d13mc.length; ri++) {
          if (String(d13mc[ri][pid13mc]).trim() !== String(pbId).trim()) continue;
          var ru = String(d13mc[ri][uid13mc] || '').trim();
          if (ru && stsByUid[ru] !== undefined) sh13mc.getRange(ri + 1, ssi13mc + 1).setValue(stsByUid[ru]);
        }
      }
    }
  } catch(e13ms) {}
  return { success: true };
}

// =====================================================================
// PAYROLL BOOK WORKFLOW FUNCTIONS
// =====================================================================

function getUserRoles_(email) {
  try {
    const ss = SpreadsheetApp.openById(CENTRAL_SETTINGS_ID);
    const sheet = ss.getSheetByName('Users');
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    const h = data[0].map(c => String(c).trim());
    const eIdx = h.indexOf('Email'), rIdx = h.indexOf('Role');
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][eIdx]).trim().toLowerCase() === String(email).trim().toLowerCase())
        return String(data[i][rIdx] || '').split(',').map(s => s.trim()).filter(Boolean);
    }
  } catch(e) {}
  return [];
}

function sendWorkflowNotification_(subject, body, targetRoles) {
  try {
    var appUrl = ScriptApp.getService().getUrl();
    var users = getUsersList();
    var emails = [];
    users.forEach(function(u) {
      if (!u.workEmail) return;
      var roles = (u.roles || []);
      if (targetRoles.some(function(r) { return roles.includes(r); })) {
        emails.push(u.workEmail);
      }
    });
    if (emails.length === 0) return;
    var fullBody = body + '\n\nOpen the payroll system: ' + appUrl;
    emails.forEach(function(email) {
      MailApp.sendEmail({ to: email, subject: subject, body: fullBody });
    });
  } catch(e) {
    Logger.log('sendWorkflowNotification_ error: ' + e.message);
  }
}

function submitPayrollBook(pbId) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  if (!callerRoles.includes('Maker') && !callerRoles.includes('Admin'))
    throw new Error('Only Makers can submit a Payroll Book for review.');
  const ss = getPayrollDB_();
  const pbSheet = ss.getSheetByName('PayrollBooks');
  const h = ensurePayrollBooksHeaders_(pbSheet);
  const data = pbSheet.getDataRange().getValues();
  let rIdx = -1;
  for (let i = 1; i < data.length; i++) { if (String(data[i][h.indexOf('PayrollID')]).trim() === String(pbId).trim()) { rIdx = i + 1; break; } }
  if (rIdx === -1) throw new Error('Payroll Book not found.');
  const currentStatus = String(data[rIdx - 1][h.indexOf('Status')]).trim();
  if (currentStatus !== 'Draft') throw new Error('Only Draft books can be submitted for review.');
  // If submitter is also a Reviewer, skip to Admin-only approval to prevent self-review
  const approverType = callerRoles.includes('Reviewer') ? 'Admin' : 'Reviewer';
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
  pbSheet.getRange(rIdx, h.indexOf('Status') + 1).setValue('For Review');
  pbSheet.getRange(rIdx, h.indexOf('SubmittedBy') + 1).setValue(user);
  pbSheet.getRange(rIdx, h.indexOf('SubmittedAt') + 1).setValue(ts);
  pbSheet.getRange(rIdx, h.indexOf('ApproverType') + 1).setValue(approverType);
  pbSheet.getRange(rIdx, h.indexOf('ReviewedBy') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('ReviewedAt') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('ReviewNote') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('FinalApprovedBy') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('FinalApprovedAt') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('FinalApproveNote') + 1).setValue('');
  try { sendWorkflowNotification_('[Payroll] ' + pbId + ' submitted for review', 'A Payroll Book (' + pbId + ') has been submitted and is now awaiting review.\nSubmitted by: ' + user, approverType === 'Admin' ? ['Admin'] : ['Reviewer', 'Admin']); } catch(e) {}
  return { success: true, approverType: approverType };
}

function reviewApprovePayrollBook(pbId, note) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  const ss = getPayrollDB_();
  const pbSheet = ss.getSheetByName('PayrollBooks');
  const h = ensurePayrollBooksHeaders_(pbSheet);
  const data = pbSheet.getDataRange().getValues();
  let rIdx = -1, row = null;
  for (let i = 1; i < data.length; i++) { if (String(data[i][h.indexOf('PayrollID')]).trim() === String(pbId).trim()) { rIdx = i + 1; row = data[i]; break; } }
  if (rIdx === -1) throw new Error('Payroll Book not found.');
  if (String(row[h.indexOf('Status')]).trim() !== 'For Review') throw new Error('This book is not in "For Review" status.');
  const approverType = String(row[h.indexOf('ApproverType')]).trim();
  if (approverType === 'Admin' && !callerRoles.includes('Admin'))
    throw new Error('This book requires an Admin to approve the review (submitter has Reviewer role).');
  if (approverType !== 'Admin' && !callerRoles.includes('Reviewer') && !callerRoles.includes('Admin'))
    throw new Error('Only Reviewers or Admins can approve this review.');
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
  pbSheet.getRange(rIdx, h.indexOf('Status') + 1).setValue('For Final Approval');
  pbSheet.getRange(rIdx, h.indexOf('ReviewedBy') + 1).setValue(user);
  pbSheet.getRange(rIdx, h.indexOf('ReviewedAt') + 1).setValue(ts);
  pbSheet.getRange(rIdx, h.indexOf('ReviewNote') + 1).setValue(note || '');
  try { sendWorkflowNotification_('[Payroll] ' + pbId + ' ready for final approval', 'A Payroll Book (' + pbId + ') has passed review and is now awaiting final approval.\nReviewed by: ' + user, ['Approver', 'Admin']); } catch(e) {}
  return { success: true };
}

function finalApprovePayrollBook(pbId, note) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  if (!callerRoles.includes('Approver') && !callerRoles.includes('Admin'))
    throw new Error('Only Approvers or Admins can give final approval.');
  const ss = getPayrollDB_();
  const pbSheet = ss.getSheetByName('PayrollBooks');
  const h = ensurePayrollBooksHeaders_(pbSheet);
  const data = pbSheet.getDataRange().getValues();
  let rIdx = -1;
  for (let i = 1; i < data.length; i++) { if (String(data[i][h.indexOf('PayrollID')]).trim() === String(pbId).trim()) { rIdx = i + 1; break; } }
  if (rIdx === -1) throw new Error('Payroll Book not found.');
  if (String(data[rIdx - 1][h.indexOf('Status')]).trim() !== 'For Final Approval')
    throw new Error('This book is not in "For Final Approval" status.');
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
  pbSheet.getRange(rIdx, h.indexOf('Status') + 1).setValue('Approved');
  pbSheet.getRange(rIdx, h.indexOf('FinalApprovedBy') + 1).setValue(user);
  pbSheet.getRange(rIdx, h.indexOf('FinalApprovedAt') + 1).setValue(ts);
  pbSheet.getRange(rIdx, h.indexOf('FinalApproveNote') + 1).setValue(note || '');
  return { success: true };
}

function returnPayrollBookToDraft(pbId, reason) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  const ss = getPayrollDB_();
  const pbSheet = ss.getSheetByName('PayrollBooks');
  const h = ensurePayrollBooksHeaders_(pbSheet);
  const data = pbSheet.getDataRange().getValues();
  let rIdx = -1, row = null;
  for (let i = 1; i < data.length; i++) { if (String(data[i][h.indexOf('PayrollID')]).trim() === String(pbId).trim()) { rIdx = i + 1; row = data[i]; break; } }
  if (rIdx === -1) throw new Error('Payroll Book not found.');
  const currentStatus = String(row[h.indexOf('Status')]).trim();
  const approverType = String(row[h.indexOf('ApproverType')]).trim();
  if (currentStatus === 'For Review') {
    if (approverType === 'Admin' && !callerRoles.includes('Admin'))
      throw new Error('Only an Admin can return this book to Draft.');
    if (approverType !== 'Admin' && !callerRoles.includes('Reviewer') && !callerRoles.includes('Admin'))
      throw new Error('Only Reviewers or Admins can return this book to Draft.');
  } else if (currentStatus === 'For Final Approval') {
    if (!callerRoles.includes('Approver') && !callerRoles.includes('Admin'))
      throw new Error('Only Approvers or Admins can return this book to Draft.');
  } else {
    throw new Error('Only books in "For Review" or "For Final Approval" can be returned to Draft.');
  }
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
  pbSheet.getRange(rIdx, h.indexOf('Status') + 1).setValue('Draft');
  pbSheet.getRange(rIdx, h.indexOf('ReturnedBy') + 1).setValue(user);
  pbSheet.getRange(rIdx, h.indexOf('ReturnedAt') + 1).setValue(ts);
  pbSheet.getRange(rIdx, h.indexOf('ReturnNote') + 1).setValue(reason || '');
  pbSheet.getRange(rIdx, h.indexOf('SubmittedBy') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('SubmittedAt') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('ReviewedBy') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('ReviewedAt') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('ReviewNote') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('FinalApprovedBy') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('FinalApprovedAt') + 1).setValue('');
  pbSheet.getRange(rIdx, h.indexOf('FinalApproveNote') + 1).setValue('');
  return { success: true };
}

function getMyApprovals() {
  var user = Session.getEffectiveUser().getEmail();
  var callerRoles = getUserRoles_(user);
  var isAdmin = callerRoles.includes('Admin');
  var isReviewer = callerRoles.includes('Reviewer');
  var isApprover = callerRoles.includes('Approver');
  if (!isAdmin && !isReviewer && !isApprover) return { payrollBooks: [], finalPayBooks: [] };
  var ss = getPayrollDB_();
  // Build summary map from PayrollBookConsolidated for accurate HC and Net Payroll
  var summaryMap = {};
  var consSheet = ss.getSheetByName('PayrollBookConsolidated');
  if (consSheet && consSheet.getLastRow() > 1) {
    var consData = consSheet.getDataRange().getValues();
    var consH = consData[0].map(normalizeColName_);
    var pidI = consH.indexOf('payrollid');
    var statI = consH.indexOf('salarystatus');
    var netI = consH.indexOf('payslipnetpay');
    if (pidI > -1 && statI > -1 && netI > -1) {
      for (var ci = 1; ci < consData.length; ci++) {
        var cPid = String(consData[ci][pidI]).trim();
        if (!cPid) continue;
        if (!summaryMap[cPid]) summaryMap[cPid] = { count: 0, net: 0 };
        summaryMap[cPid].count++;
        var cStat = String(consData[ci][statI] || '').toUpperCase().trim();
        var cNet = Number(String(consData[ci][netI] || 0).replace(/[^0-9.-]+/g, '')) || 0;
        var cIsBpi = cStat === 'FOR RELEASE' || cStat.includes('-BPI');
        var cIsHold = cStat.includes('HOLD') || cStat.includes('CHECK ACCOUNT');
        var cFee = (!cIsBpi && !cIsHold && cStat !== '') ? 50 : 0;
        if (!cIsHold) summaryMap[cPid].net += (cNet - cFee);
      }
    }
  }
  var result = { payrollBooks: [], finalPayBooks: [] };
  var pbSheet = ss.getSheetByName('PayrollBooks');
  if (pbSheet) {
    var h = ensurePayrollBooksHeaders_(pbSheet);
    var data = pbSheet.getDataRange().getValues();
    // Use actual sheet headers (data[0]) for accurate column lookups — guards against
    // schema-migration shifts (e.g. LinkedVoucherId insertion changing column positions).
    var actualH = data[0].map(String);
    var sbIdx = actualH.indexOf('SubmittedBy')  > -1 ? actualH.indexOf('SubmittedBy')  : h.indexOf('SubmittedBy');
    var saIdx = actualH.indexOf('SubmittedAt')  > -1 ? actualH.indexOf('SubmittedAt')  : h.indexOf('SubmittedAt');
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var status = String(row[h.indexOf('Status')] || '').trim();
      var approverType = String(row[h.indexOf('ApproverType')] || '').trim();
      var include = false;
      if (status === 'For Review' && (isAdmin || isReviewer)) include = true;
      if (status === 'For Review' && approverType === 'Admin' && isAdmin) include = true;
      if (status === 'For Final Approval' && (isAdmin || isApprover)) include = true;
      if (include) {
        var pbId = String(row[h.indexOf('PayrollID')] || '');
        var sm = summaryMap[pbId] || { count: 0, net: 0 };
        // Attribution may be stored as a Date object in Sheets — convert to YYYY-MM
        // so formatAttributionDate() on the frontend can render it as "Mar 2026".
        var attrRaw = row[h.indexOf('Attribution')];
        var attrStr = (attrRaw instanceof Date)
          ? attrRaw.getFullYear() + '-' + String(attrRaw.getMonth() + 1).padStart(2, '0')
          : String(attrRaw || '');
        var saRaw = row[saIdx];
        var saStr = (saRaw instanceof Date)
          ? Utilities.formatDate(saRaw, Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss')
          : String(saRaw || '');
        result.payrollBooks.push({
          id: pbId,
          name: String(row[h.indexOf('Name')] || ''),
          attribution: attrStr,
          payoutDate: String(row[h.indexOf('PayoutDate')] || ''),
          hc: sm.count,
          netPayroll: sm.net,
          status: status,
          submittedBy: String(row[sbIdx] || ''),
          submittedAt: saStr
        });
      }
    }
  }
  var fpSheet = ss.getSheetByName('FinalPayBooks');
  if (fpSheet) {
    var fh = ensureFinalPayBooksHeaders_(fpSheet);
    var fdata = fpSheet.getDataRange().getValues();
    for (var j = 1; j < fdata.length; j++) {
      var frow = fdata[j];
      var fstatus = String(frow[fh.indexOf('Status')] || '').trim();
      var fApproverType = String(frow[fh.indexOf('ApproverType')] || '').trim();
      var finclude = false;
      if (fstatus === 'For Review' && (isAdmin || isReviewer)) finclude = true;
      if (fstatus === 'For Review' && fApproverType === 'Admin' && isAdmin) finclude = true;
      if (fstatus === 'For Final Approval' && (isAdmin || isApprover)) finclude = true;
      if (finclude) {
        var fSaRaw = frow[fh.indexOf('SubmittedAt')];
        var fSaStr = (fSaRaw instanceof Date)
          ? Utilities.formatDate(fSaRaw, Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss')
          : String(fSaRaw || '');
        result.finalPayBooks.push({
          id: String(frow[fh.indexOf('FP_ID')] || ''),
          releaseDate: String(frow[fh.indexOf('Release Date')] || ''),
          hc: frow[fh.indexOf('Headcount')] || 0,
          status: fstatus,
          submittedBy: String(frow[fh.indexOf('SubmittedBy')] || ''),
          submittedAt: fSaStr
        });
      }
    }
  }
  return result;
}

// =====================================================================
// DEDUCTION SCHEDULE
// =====================================================================

function ensureDeductionScheduleHeaders_(sheet) {
  const h = ['DeductionID','EmployeeName','EmployeeID','Company','DeductionType','Description','TotalAmount','Installments','AmountPerCutoff','StartCutoff','PaidInstallments','RemainingBalance','Status','ATD_FileId','ATD_FileName','CreatedBy','CreatedAt'];
  if (sheet.getLastRow() === 0) { sheet.appendRow(h); sheet.getRange(1,1,1,h.length).setFontWeight('bold').setBackground('#f3f4f6'); sheet.setFrozenRows(1); return h; }
  const existing = sheet.getRange(1,1,1,sheet.getLastColumn()||1).getValues()[0];
  h.forEach(function(col) { if (!existing.includes(col)) { sheet.getRange(1, sheet.getLastColumn()+1).setValue(col).setFontWeight('bold').setBackground('#f3f4f6'); } });
  return h;
}

function ensureDeductionLedgerHeaders_(sheet) {
  const h = ['LedgerID','DeductionID','EmployeeName','Company','CutoffEnd','PayrollRef','AmountDeducted','BalanceBefore','BalanceAfter','PostedBy','PostedAt'];
  if (sheet.getLastRow() === 0) { sheet.appendRow(h); sheet.getRange(1,1,1,h.length).setFontWeight('bold').setBackground('#f3f4f6'); sheet.setFrozenRows(1); }
  return h;
}

function saveDeductionSchedule(payload) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  if (!callerRoles.includes('Maker') && !callerRoles.includes('Admin'))
    throw new Error('Only Makers or Admins can manage deduction schedules.');
  const { dedId, employeeName, employeeId, company, deductionType, description, totalAmount, installments, startCutoff, atdFileId, atdFileName } = payload;
  const ss = getPayrollDB_();
  let sheet = ss.getSheetByName('EmpDeductionSchedule');
  if (!sheet) sheet = ss.insertSheet('EmpDeductionSchedule');
  const h = ensureDeductionScheduleHeaders_(sheet);
  const total = Number(totalAmount) || 0;
  const inst  = Number(installments) || 1;
  const amtPerCutoff = inst > 0 ? (total / inst) : total;
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
  if (dedId) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][h.indexOf('DeductionID')]).trim() === String(dedId).trim()) {
        const r = i + 1;
        sheet.getRange(r, h.indexOf('EmployeeName')+1).setValue(employeeName||'');
        sheet.getRange(r, h.indexOf('EmployeeID')+1).setValue(employeeId||'');
        sheet.getRange(r, h.indexOf('Company')+1).setValue(company||'');
        sheet.getRange(r, h.indexOf('DeductionType')+1).setValue(deductionType||'');
        sheet.getRange(r, h.indexOf('Description')+1).setValue(description||'');
        sheet.getRange(r, h.indexOf('TotalAmount')+1).setValue(total);
        sheet.getRange(r, h.indexOf('Installments')+1).setValue(inst);
        sheet.getRange(r, h.indexOf('AmountPerCutoff')+1).setValue(amtPerCutoff);
        sheet.getRange(r, h.indexOf('StartCutoff')+1).setValue(startCutoff||'');
        const paid = Number(data[i][h.indexOf('PaidInstallments')]||0);
        sheet.getRange(r, h.indexOf('RemainingBalance')+1).setValue(Math.max(0, total - (amtPerCutoff * paid)));
        if (atdFileId) { sheet.getRange(r, h.indexOf('ATD_FileId')+1).setValue(atdFileId); sheet.getRange(r, h.indexOf('ATD_FileName')+1).setValue(atdFileName||''); }
        return { success: true, dedId: dedId };
      }
    }
    throw new Error('Deduction schedule not found: ' + dedId);
  } else {
    const newId = 'DED-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-' + String(Math.floor(Math.random()*9000)+1000);
    const row = new Array(h.length).fill('');
    row[h.indexOf('DeductionID')]    = newId;
    row[h.indexOf('EmployeeName')]   = employeeName||'';
    row[h.indexOf('EmployeeID')]     = employeeId||'';
    row[h.indexOf('Company')]        = company||'';
    row[h.indexOf('DeductionType')]  = deductionType||'';
    row[h.indexOf('Description')]    = description||'';
    row[h.indexOf('TotalAmount')]    = total;
    row[h.indexOf('Installments')]   = inst;
    row[h.indexOf('AmountPerCutoff')]= amtPerCutoff;
    row[h.indexOf('StartCutoff')]    = startCutoff||'';
    row[h.indexOf('PaidInstallments')]= 0;
    row[h.indexOf('RemainingBalance')]= total;
    row[h.indexOf('Status')]         = 'Active';
    row[h.indexOf('ATD_FileId')]     = atdFileId||'';
    row[h.indexOf('ATD_FileName')]   = atdFileName||'';
    row[h.indexOf('CreatedBy')]      = user;
    row[h.indexOf('CreatedAt')]      = ts;
    sheet.appendRow(row);
    // Write Journal Entry: DR Accounts Receivable from Employees / CR Salaries and Wages Payable
    try {
      const accs = getAccountsAndContacts().accounts;
      let arCode = '', arName = 'Accounts Receivable from Employees';
      let swpCode = '', swpName = 'Salaries and Wages Payable';
      accs.forEach(function(a) {
        const n = String(a['Account Name'] || a['AccountName'] || '').trim().toLowerCase();
        const c = String(a['Account Code'] || a['AccountCode'] || '').trim();
        if (n.includes('accounts receivable from employees')) { arCode = c; arName = String(a['Account Name'] || a['AccountName'] || arName).trim(); }
        if (n.includes('salaries and wages payable')) { swpCode = c; swpName = String(a['Account Name'] || a['AccountName'] || swpName).trim(); }
      });
      const jeNow = new Date();
      const jeDesc = 'Deduction Schedule - ' + (description || deductionType || '');
      const cjSheet = getCentralJournalSheet_(false);
      const jRows = [
        [newId, 'JE-'+newId, 1, arCode,  arName,  jeDesc, employeeName||'', '', total, 0,     jeNow, user, '', jeNow, '', ''],
        [newId, 'JE-'+newId, 2, swpCode, swpName, jeDesc, employeeName||'', '', 0,     total, jeNow, user, '', jeNow, '', '']
      ];
      cjSheet.getRange(cjSheet.getLastRow()+1, 1, jRows.length, 16).setValues(jRows);
    } catch(e) { Logger.log('Deduction Schedule JE error: ' + e); }
    return { success: true, dedId: newId };
  }
}

function getDeductionSchedules(filters) {
  const ss = getPayrollDB_();
  const sheet = ss.getSheetByName('EmpDeductionSchedule');
  if (!sheet || sheet.getLastRow() <= 1) return { schedules: [], companies: [] };
  const h    = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const data = sheet.getDataRange().getValues();
  const fStatus  = (filters && filters.status)  || 'ALL';
  const fType    = (filters && filters.type)    || 'ALL';
  const fCompany = (filters && filters.company) || 'ALL';
  const fSearch  = filters && filters.search ? String(filters.search).toLowerCase() : '';
  const results = []; const companies = new Set();
  for (let i = 1; i < data.length; i++) {
    const get = (col) => { const idx = h.indexOf(col); return idx > -1 ? data[i][idx] : ''; };
    const status = String(get('Status')||'').trim();
    const type   = String(get('DeductionType')||'').trim();
    const comp   = String(get('Company')||'').trim();
    const name   = String(get('EmployeeName')||'').trim();
    if (comp) companies.add(comp);
    if (fStatus  !== 'ALL' && status !== fStatus)  continue;
    if (fType    !== 'ALL' && type   !== fType)    continue;
    if (fCompany !== 'ALL' && comp   !== fCompany) continue;
    if (fSearch && !name.toLowerCase().includes(fSearch) && !comp.toLowerCase().includes(fSearch)) continue;
    results.push({
      dedId: String(get('DeductionID')||''), employeeName: name, employeeId: String(get('EmployeeID')||''),
      company: comp, deductionType: type, description: String(get('Description')||''),
      totalAmount: Number(get('TotalAmount')||0), installments: Number(get('Installments')||1),
      amountPerCutoff: Number(get('AmountPerCutoff')||0),
      startCutoff: (function(v){ if (!v) return ''; if (v instanceof Date) { return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd'); } var s = String(v).trim(); if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s.substring(0,10); if (s.includes('/')) { var p=s.split('/'); if(p.length===3) return p[2].substring(0,4)+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0'); } return s; })(get('StartCutoff')),
      paidInstallments: Number(get('PaidInstallments')||0), remainingBalance: Number(get('RemainingBalance')||0),
      status: status, atdFileId: String(get('ATD_FileId')||''), atdFileName: String(get('ATD_FileName')||''),
      createdBy: String(get('CreatedBy')||''), createdAt: String(get('CreatedAt')||'')
    });
  }
  return { schedules: results, companies: Array.from(companies).sort() };
}

function getDeductionSchedulesForFP(employeeNames) {
  const ss = getPayrollDB_();
  const sheet = ss.getSheetByName('EmpDeductionSchedule');
  if (!sheet || sheet.getLastRow() <= 1) return {};
  const h    = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const data = sheet.getDataRange().getValues();
  const nameSet = new Set((employeeNames||[]).map(n => String(n).trim().toLowerCase()));
  const result = {};
  for (let i = 1; i < data.length; i++) {
    const get = (col) => { const idx = h.indexOf(col); return idx > -1 ? data[i][idx] : ''; };
    if (String(get('Status')||'').trim() !== 'Active') continue;
    const name = String(get('EmployeeName')||'').trim();
    if (!nameSet.has(name.toLowerCase())) continue;
    if (!result[name]) result[name] = [];
    result[name].push({
      dedId: String(get('DeductionID')||''), deductionType: String(get('DeductionType')||''),
      description: String(get('Description')||''), totalAmount: Number(get('TotalAmount')||0),
      installments: Number(get('Installments')||0), paidInstallments: Number(get('PaidInstallments')||0),
      amountPerCutoff: Number(get('AmountPerCutoff')||0), remainingBalance: Number(get('RemainingBalance')||0),
      atdFileId: String(get('ATD_FileId')||''), atdFileName: String(get('ATD_FileName')||'')
    });
  }
  return result;
}

function recordDeductionInstallment(payload) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  if (!callerRoles.includes('Maker') && !callerRoles.includes('Admin'))
    throw new Error('Only Makers or Admins can record deduction installments.');
  const { dedId, cutoffEnd, payrollRef } = payload;
  const ss = getPayrollDB_();
  let schedSheet = ss.getSheetByName('EmpDeductionSchedule');
  if (!schedSheet) throw new Error('EmpDeductionSchedule sheet not found.');
  const h    = ensureDeductionScheduleHeaders_(schedSheet);
  const data = schedSheet.getDataRange().getValues();
  let rIdx = -1;
  for (let i = 1; i < data.length; i++) { if (String(data[i][h.indexOf('DeductionID')]).trim() === String(dedId).trim()) { rIdx = i + 1; break; } }
  if (rIdx === -1) throw new Error('Deduction schedule not found.');
  const row = data[rIdx - 1];
  const get = (col) => { const idx = h.indexOf(col); return idx > -1 ? row[idx] : ''; };
  if (String(get('Status')).trim() !== 'Active') throw new Error('Only Active schedules can have installments recorded.');
  const amtPerCutoff = Number(get('AmountPerCutoff')||0);
  const balBefore    = Number(get('RemainingBalance')||0);
  const paid         = Number(get('PaidInstallments')||0);
  const amtDeducted  = Math.min(amtPerCutoff, balBefore);
  const balAfter     = Math.max(0, balBefore - amtDeducted);
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
  schedSheet.getRange(rIdx, h.indexOf('PaidInstallments')+1).setValue(paid + 1);
  schedSheet.getRange(rIdx, h.indexOf('RemainingBalance')+1).setValue(balAfter);
  if (balAfter === 0) schedSheet.getRange(rIdx, h.indexOf('Status')+1).setValue('Fully Paid');
  let ledgerSheet = ss.getSheetByName('EmpDeductionLedger');
  if (!ledgerSheet) ledgerSheet = ss.insertSheet('EmpDeductionLedger');
  const lh   = ensureDeductionLedgerHeaders_(ledgerSheet);
  const lrow = new Array(lh.length).fill('');
  lrow[lh.indexOf('LedgerID')]       = 'LDG-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss');
  lrow[lh.indexOf('DeductionID')]    = dedId;
  lrow[lh.indexOf('EmployeeName')]   = String(get('EmployeeName')||'');
  lrow[lh.indexOf('Company')]        = String(get('Company')||'');
  lrow[lh.indexOf('CutoffEnd')]      = cutoffEnd||'';
  lrow[lh.indexOf('PayrollRef')]     = payrollRef||'';
  lrow[lh.indexOf('AmountDeducted')] = amtDeducted;
  lrow[lh.indexOf('BalanceBefore')]  = balBefore;
  lrow[lh.indexOf('BalanceAfter')]   = balAfter;
  lrow[lh.indexOf('PostedBy')]       = user;
  lrow[lh.indexOf('PostedAt')]       = ts;
  ledgerSheet.appendRow(lrow);
  // Write reverse Journal Entry: DR Salaries and Wages Payable / CR Accounts Receivable from Employees
  try {
    const ldgId = lrow[lh.indexOf('LedgerID')];
    const emp = String(get('EmployeeName')||'');
    const accs = getAccountsAndContacts().accounts;
    let arCode = '', arName = 'Accounts Receivable from Employees';
    let swpCode = '', swpName = 'Salaries and Wages Payable';
    accs.forEach(function(a) {
      const n = String(a['Account Name'] || a['AccountName'] || '').trim().toLowerCase();
      const c = String(a['Account Code'] || a['AccountCode'] || '').trim();
      if (n.includes('accounts receivable from employees')) { arCode = c; arName = String(a['Account Name'] || a['AccountName'] || arName).trim(); }
      if (n.includes('salaries and wages payable')) { swpCode = c; swpName = String(a['Account Name'] || a['AccountName'] || swpName).trim(); }
    });
    const jeNow = new Date();
    const jeDesc = 'Deduction Installment - ' + dedId;
    const cjSheet = getCentralJournalSheet_(false);
    const jRows = [
      [ldgId, 'JE-'+ldgId, 1, swpCode, swpName, jeDesc, emp, '', amtDeducted, 0,           jeNow, user, '', jeNow, '', ''],
      [ldgId, 'JE-'+ldgId, 2, arCode,  arName,  jeDesc, emp, '', 0,           amtDeducted, jeNow, user, '', jeNow, '', '']
    ];
    cjSheet.getRange(cjSheet.getLastRow()+1, 1, jRows.length, 16).setValues(jRows);
  } catch(e) { Logger.log('Deduction Installment JE error: ' + e); }
  return { success: true, amountDeducted: amtDeducted, balanceAfter: balAfter, fullyPaid: balAfter === 0 };
}

function cancelDeductionSchedule(dedId) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  if (!callerRoles.includes('Maker') && !callerRoles.includes('Admin'))
    throw new Error('Only Makers or Admins can cancel deduction schedules.');
  const ss = getPayrollDB_();
  const sheet = ss.getSheetByName('EmpDeductionSchedule');
  if (!sheet) throw new Error('EmpDeductionSchedule sheet not found.');
  const h    = ensureDeductionScheduleHeaders_(sheet);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][h.indexOf('DeductionID')]).trim() === String(dedId).trim()) {
      sheet.getRange(i + 1, h.indexOf('Status')+1).setValue('Cancelled');
      return { success: true };
    }
  }
  throw new Error('Deduction schedule not found.');
}

function uploadATDFile(payload) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  if (!callerRoles.includes('Maker') && !callerRoles.includes('Admin'))
    throw new Error('Only Makers or Admins can upload ATD files.');
  const { base64Data, mimeType, fileName } = payload;
  if (!base64Data || !fileName) throw new Error('File data and name are required.');
  const blob   = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType||'application/octet-stream', fileName);
  const folder = DriveApp.getFolderById(ATD_FOLDER_ID);
  const file   = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { fileId: file.getId(), fileName: fileName, viewUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view?usp=sharing' };
}

function postFPScheduledDeductions_(fpId) {
  try {
    const ss = getPayrollDB_();
    const fpcSheet = ss.getSheetByName('FinalPayConsolidated');
    if (!fpcSheet) return;
    const fpcData = fpcSheet.getDataRange().getValues();
    const fpcH    = fpcData[0].map(normalizeColName_);
    const idIdx   = fpcH.indexOf('fpid');
    const nameIdx = fpcH.indexOf('name');
    const compIdx = fpcH.indexOf('companyname');
    const dedIdx  = fpcH.indexOf('deductions');
    const user = (() => { try { return Session.getEffectiveUser().getEmail()||'system'; } catch(e) { return 'system'; } })();
    const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
    const schedSheet = ss.getSheetByName('EmpDeductionSchedule');
    if (!schedSheet || schedSheet.getLastRow() <= 1) return;
    const sh       = ensureDeductionScheduleHeaders_(schedSheet);
    const schedData = schedSheet.getDataRange().getValues();
    let ledgerSheet = ss.getSheetByName('EmpDeductionLedger');
    if (!ledgerSheet) ledgerSheet = ss.insertSheet('EmpDeductionLedger');
    const lh = ensureDeductionLedgerHeaders_(ledgerSheet);
    // Build map: normalised employee name -> array of schedule row indices
    const schedMap = {};
    for (let i = 1; i < schedData.length; i++) {
      const sName   = String(schedData[i][sh.indexOf('EmployeeName')]||'').trim().toLowerCase();
      const sStatus = String(schedData[i][sh.indexOf('Status')]||'').trim();
      if (sStatus === 'Active') { if (!schedMap[sName]) schedMap[sName] = []; schedMap[sName].push(i); }
    }
    for (let i = 1; i < fpcData.length; i++) {
      if (String(fpcData[i][idIdx]).trim() !== String(fpId).trim()) continue;
      const empName = String(fpcData[i][nameIdx]||'').trim();
      const dedAmt  = Number(String(fpcData[i][dedIdx]||'0').replace(/[^0-9.-]+/g,''))||0;
      if (dedAmt <= 0) continue;
      const schedIdxs = schedMap[empName.toLowerCase()] || [];
      if (!schedIdxs.length) continue;
      let remaining = dedAmt;
      for (const si of schedIdxs) {
        if (remaining <= 0) break;
        const sRow      = schedData[si];
        const balBefore = Number(sRow[sh.indexOf('RemainingBalance')]||0);
        if (balBefore <= 0) continue;
        const amtDeducted = Math.min(remaining, balBefore);
        const balAfter    = Math.max(0, balBefore - amtDeducted);
        remaining -= amtDeducted;
        const sheetRow = si + 1;
        const paid = Number(sRow[sh.indexOf('PaidInstallments')]||0);
        schedSheet.getRange(sheetRow, sh.indexOf('PaidInstallments')+1).setValue(paid + 1);
        schedSheet.getRange(sheetRow, sh.indexOf('RemainingBalance')+1).setValue(balAfter);
        if (balAfter === 0) schedSheet.getRange(sheetRow, sh.indexOf('Status')+1).setValue('Fully Paid');
        const lrow = new Array(lh.length).fill('');
        lrow[lh.indexOf('LedgerID')]       = 'LDG-FP-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmmss') + '-' + si;
        lrow[lh.indexOf('DeductionID')]    = String(sRow[sh.indexOf('DeductionID')]||'');
        lrow[lh.indexOf('EmployeeName')]   = empName;
        lrow[lh.indexOf('Company')]        = String(fpcData[i][compIdx]||'');
        lrow[lh.indexOf('CutoffEnd')]      = 'FINAL PAY';
        lrow[lh.indexOf('PayrollRef')]     = fpId;
        lrow[lh.indexOf('AmountDeducted')] = amtDeducted;
        lrow[lh.indexOf('BalanceBefore')]  = balBefore;
        lrow[lh.indexOf('BalanceAfter')]   = balAfter;
        lrow[lh.indexOf('PostedBy')]       = user;
        lrow[lh.indexOf('PostedAt')]       = ts;
        ledgerSheet.appendRow(lrow);
        // Update local cache to prevent stale reads for subsequent employees in same batch
        schedData[si][sh.indexOf('RemainingBalance')] = balAfter;
        if (balAfter === 0) schedData[si][sh.indexOf('Status')] = 'Fully Paid';
      }
    }
  } catch(e) { Logger.log('postFPScheduledDeductions_ error: ' + e.message); }
}

// =====================================================================
// VOUCHER PDF GENERATOR (reads from Disbursement DB independently)
// =====================================================================

function fetchImageBase64DisbApp_(urlOrFileId) {
  if (!urlOrFileId) return null;
  try {
    var input = String(urlOrFileId).trim();
    var useDrive = false; var fileId = input;
    if (input.includes('drive.google.com') || input.includes('docs.google.com')) {
      var m = input.match(/[?&]id=([^&]+)/) || input.match(/\/d\/([^\/\?]+)/);
      if (m) { fileId = m[1]; useDrive = true; }
    } else if (!input.startsWith('http')) { useDrive = true; }
    if (useDrive) {
      var file = DriveApp.getFileById(fileId); var blob = file.getBlob();
      return 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } else {
      var response = UrlFetchApp.fetch(input, { muteHttpExceptions: true });
      if (response.getResponseCode() === 200) {
        var blob = response.getBlob();
        return 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes());
      }
    }
  } catch(e) { Logger.log('fetchImageBase64DisbApp_ error: ' + e.message); }
  return null;
}

function getLinkedVoucherPdfBase64_(voucherId) {
  const disbSS = SpreadsheetApp.openById(DISBURSEMENT_DB_ID);
  const getRows_ = (sheetName) => {
    const sh = disbSS.getSheetByName(sheetName); if (!sh) return [];
    const data = sh.getDataRange().getValues(); if (data.length < 2) return [];
    const hdrs = data[0]; return data.slice(1).map(r => { const o = {}; hdrs.forEach((h, i) => o[h] = r[i]); return o; });
  };
  const vRows      = getRows_('Vouchers');
  const vlRows     = getRows_('VoucherLines');
  const acRows     = getRows_('Accounts');
  // Read settings and users from Central Settings
  const centralSS  = SpreadsheetApp.openById(CENTRAL_SETTINGS_ID);
  const readCentral_ = (sheetName) => {
    const sh = centralSS.getSheetByName(sheetName); if (!sh) return [];
    const d = sh.getDataRange().getValues(); if (d.length < 2) return [];
    const hdrs = d[0]; return d.slice(1).map(r => { const o = {}; hdrs.forEach((h, i) => o[String(h).trim()] = r[i]); return o; });
  };
  const progRows   = readCentral_('Modules');
  const seqRows    = readCentral_('Sequence');
  const userRows   = readCentral_('Users');
  const s = {};
  progRows.forEach(r => { if (r.Key) s[r.Key] = r.Value; });
  seqRows.forEach(r  => { if (r.Key) s[r.Key] = r.Value; });

  const h = vRows.find(v => String(v['VoucherId']).trim() === String(voucherId).trim());
  if (!h) throw new Error('Voucher not found: ' + voucherId);
  const lines = vlRows.filter(l => String(l['VoucherId']).trim() === String(voucherId).trim());

  const fmtMoney = (n) => Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits:2, maximumFractionDigits:2 });
  const esc = escapeHtml_;
  const getAccountName = (code) => { const m = acRows.find(a => String(a['Account Code']).trim() === String(code).trim()); return esc(m ? (m['Account Name'] || code) : code); };
  const getPrintedName = (searchStr) => {
    if (!searchStr) return '';
    const q = String(searchStr).toLowerCase().trim();
    const u = userRows.find(x => String(x['Email']).toLowerCase().trim() === q || String(x['Work Email']).toLowerCase().trim() === q);
    return esc(u ? (u['Full Name'] || searchStr) : searchStr);
  };
  const getSigHtml = (searchStr, isAuth) => {
    if (!isAuth || !searchStr) return '';
    const q = String(searchStr).toLowerCase().trim();
    const u = userRows.find(x => String(x['Full Name']).toLowerCase().trim() === q || String(x['Email']).toLowerCase().trim() === q || String(x['Work Email']).toLowerCase().trim() === q);
    if (u && u['Signature URL']) { const b64 = fetchImageBase64DisbApp_(u['Signature URL']); if (b64) return '<img src="' + b64 + '" height="55" style="margin-bottom:-15px;" />'; }
    return '';
  };

  let logoHtml = '<div style="font-weight:bold;color:#000;">WORKSCALE RESOURCES INC.</div>';
  try { const b64 = fetchImageBase64DisbApp_(s['LETTERHEAD_LINK'] || '1hTAv6ofNi9676XN_rR_eSTgFv91wpNYt'); if (b64) logoHtml = '<img src="' + b64 + '" style="max-height:65px;max-width:200px;object-fit:contain;" />'; } catch(e) {}

  let dateStr = h.PreparationDate;
  try { const d = new Date(h.PreparationDate); if (!isNaN(d.getTime())) dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEE, MMMM dd, yyyy'); } catch(e) {}

  const stat = String(h.Status || '');
  const isReviewed = h.ReviewedBy ? true : ['Pending Approval','Approved','Paid','Voided'].includes(stat);
  const isApproved = h.ApprovedBy ? true : ['Approved','Paid','Voided'].includes(stat);
  const revName = h.ReviewedBy ? getPrintedName(h.ReviewedBy) : esc(s['REVIEWER_NAME'] || '');
  const appName = h.ApprovedBy ? getPrintedName(h.ApprovedBy) : esc(s['APPROVER_NAME'] || '');
  const notedName = esc(s['NOTED_BY_NAME'] || '');
  const revSig  = h.ReviewedBy ? getSigHtml(h.ReviewedBy, true) : getSigHtml(revName, isReviewed);
  const appSig  = h.ApprovedBy ? getSigHtml(h.ApprovedBy, true) : getSigHtml(appName, isApproved);

  let displayTitle = esc(h.VoucherType) + ' VOUCHER';
  if (h.VoucherType === 'FINAL_PAY')  displayTitle = 'FINAL PAY VOUCHER';
  if (h.VoucherType === 'PAYROLL')    displayTitle = 'PAYROLL VOUCHER';
  if (h.VoucherType === 'INCENTIVES') displayTitle = 'INCENTIVES VOUCHER';

  // Build main body
  let mainBodyHtml = '';
  if (['PAYROLL','FINAL_PAY','INCENTIVES'].includes(h.VoucherType)) {
    const catGroups = {}; let grandTotalAmt = 0;
    lines.forEach(l => {
      const amt = Number(l.Amount || 0); const count = Number(l.ManpowerCount || 0); const cat = String(l.Category || 'Other').trim();
      if (!catGroups[cat]) catGroups[cat] = { html:'', total:0, count:0 };
      catGroups[cat].html += '<tr><td>' + esc(l.Contact || '') + '</td><td>' + esc(l.Description || '') + '</td><td style="text-align:right">₱ ' + fmtMoney(amt) + '</td><td style="text-align:center">' + count + '</td></tr>';
      catGroups[cat].total += amt; catGroups[cat].count += count; grandTotalAmt += amt;
    });
    let summaryTrs = '';
    for (const [cat, grp] of Object.entries(catGroups)) summaryTrs += '<td style="text-align:right">₱ ' + fmtMoney(grp.total) + '</td>';
    mainBodyHtml = '<div class="block-avoid"><div class="section-title">SUMMARY</div><table class="data-table"><thead><tr><th>Payment Date</th>' + Object.keys(catGroups).map(k => '<th style="text-align:right">' + esc(k) + ' Total</th>').join('') + '<th style="text-align:right">Total</th></tr></thead><tbody><tr><td>' + esc(dateStr) + '</td>' + summaryTrs + '<td style="text-align:right;font-weight:bold">₱ ' + fmtMoney(grandTotalAmt) + '</td></tr></tbody></table></div>';
    for (const [cat, grp] of Object.entries(catGroups)) {
      mainBodyHtml += '<div class="block-avoid"><div class="section-title">' + esc(cat) + ' DETAILS</div><table class="data-table"><thead><tr><th style="width:30%">Contact / Dept</th><th style="width:35%">Remarks / Code</th><th style="width:20%;text-align:right">Net Pay</th><th style="width:15%;text-align:center">Manpower Count</th></tr></thead><tbody>' + grp.html + '<tr class="grand-total"><td colspan="2" style="text-align:right">' + esc(cat) + ' Subtotal</td><td style="text-align:right">₱ ' + fmtMoney(grp.total) + '</td><td style="text-align:center">' + grp.count + '</td></tr></tbody></table></div>';
    }
  } else {
    let detailsRowsHtml = '';
    lines.forEach(l => { detailsRowsHtml += '<tr><td>' + esc(l.Contact || '') + '</td><td>' + esc(l.Description || '') + '</td><td style="text-align:right">₱ ' + fmtMoney(l.Amount) + '</td></tr>'; });
    mainBodyHtml = '<div class="block-avoid"><div class="section-title">PAYMENT DETAILS</div><table class="data-table"><thead><tr><th style="width:30%">Contact</th><th style="width:45%">Description</th><th style="width:25%;text-align:right">Amount to Pay</th></tr></thead><tbody>' + detailsRowsHtml + '<tr class="grand-total"><td colspan="2" style="text-align:right">Grand Total</td><td style="text-align:right">₱ ' + fmtMoney(h.TotalAmount) + '</td></tr></tbody></table></div>';
  }

  // Journal entry section
  const jeMap = {}; let totalDebit = 0; let totalCredit = 0;
  lines.forEach(l => {
    const expCode = String(l.ExpenseAccountCode || '').trim(); const bankCode = String(l.LineBankCode || '').trim(); const amt = Number(l.Amount || 0);
    if (expCode && amt > 0) { if (!jeMap[expCode]) jeMap[expCode] = { dr:0, cr:0 }; jeMap[expCode].dr += amt; totalDebit += amt; }
    if (['PAYROLL','FINAL_PAY','INCENTIVES'].includes(h.VoucherType) && bankCode && amt > 0) { if (!jeMap[bankCode]) jeMap[bankCode] = { dr:0, cr:0 }; jeMap[bankCode].cr += amt; totalCredit += amt; }
  });
  let jeRowsHtml = '';
  for (const [code, val] of Object.entries(jeMap)) { if (val.dr > 0) jeRowsHtml += '<tr><td style="font-weight:bold">' + getAccountName(code) + '</td><td style="text-align:right">₱ ' + fmtMoney(val.dr) + '</td><td style="text-align:right">-</td></tr>'; }
  for (const [code, val] of Object.entries(jeMap)) { if (val.cr > 0) jeRowsHtml += '<tr><td style="padding-left:20px">' + getAccountName(code) + '</td><td style="text-align:right">-</td><td style="text-align:right">₱ ' + fmtMoney(val.cr) + '</td></tr>'; }
  if (!['PAYROLL','FINAL_PAY','INCENTIVES'].includes(h.VoucherType) && totalDebit > 0) {
    jeRowsHtml += '<tr><td style="padding-left:20px">' + getAccountName(h.PaymentFromAccountCode) + '</td><td style="text-align:right">-</td><td style="text-align:right;font-weight:bold">₱ ' + fmtMoney(totalDebit) + '</td></tr>'; totalCredit += totalDebit;
  }

  const bodyHtml = '<div style="padding-bottom:25px"><table style="width:100%;border-collapse:collapse;margin-bottom:20px;border-bottom:2px solid #000;"><tr><td style="width:30%;vertical-align:middle;text-align:left;border:none">' + logoHtml + '</td><td style="width:40%;vertical-align:middle;text-align:center;border:none;font-weight:bold"><div style="text-decoration:underline;text-transform:uppercase">' + displayTitle + '</div></td><td style="width:30%;vertical-align:middle;text-align:right;border:none"><div style="margin-bottom:4px">Control No: ' + esc(h.VoucherId) + '</div><div style="margin-bottom:4px">Date: ' + esc(dateStr) + '</div></td></tr></table>' + mainBodyHtml + '<div class="block-avoid"><div class="section-title">JOURNAL ENTRY</div><table class="data-table"><thead><tr><th style="width:50%">COA</th><th style="width:25%;text-align:right">Debit</th><th style="width:25%;text-align:right">Credit</th></tr></thead><tbody>' + jeRowsHtml + '<tr class="grand-total"><td style="text-align:right">Total Debit / Credit</td><td style="text-align:right">₱ ' + fmtMoney(totalDebit) + '</td><td style="text-align:right">₱ ' + fmtMoney(totalCredit) + '</td></tr></tbody></table></div><div class="block-avoid" style="margin-top:30px"><table class="signatures"><tr><td style="vertical-align:top"><div class="sig-label">Prepared by</div></td><td style="vertical-align:top"><div class="sig-label">Reviewed by</div></td><td style="vertical-align:top"><div class="sig-label">Approved by</div></td><td style="vertical-align:top"><div class="sig-label">Noted by</div></td></tr><tr><td class="sig-img-cell">' + getSigHtml(h.CreatedBy, true) + '</td><td class="sig-img-cell">' + revSig + '</td><td class="sig-img-cell">' + appSig + '</td><td class="sig-img-cell">' + getSigHtml(notedName, true) + '</td></tr><tr><td class="sig-name-cell"><div class="sig-line">' + getPrintedName(h.CreatedBy) + '</div></td><td class="sig-name-cell"><div class="sig-line">' + revName + '</div></td><td class="sig-name-cell"><div class="sig-line">' + appName + '</div></td><td class="sig-name-cell"><div class="sig-line">' + notedName + '</div></td></tr></table></div></div>';

  const css = '@page{size:letter;margin:0.5in}body{font-family:"Courier New",Courier,monospace;font-size:11pt;color:#000;margin:0;padding:0}.block-avoid{page-break-inside:avoid;margin-bottom:20px}.section-title{font-weight:bold;margin-top:20px;margin-bottom:8px;border-bottom:1px dashed #000;text-transform:uppercase;padding-bottom:3px}.data-table{width:100%;border-collapse:collapse;margin-bottom:15px}.data-table th,.data-table td{padding:6px 8px;border:1px solid #000;text-align:left}.data-table th{font-weight:bold;text-align:center;border-bottom:2px solid #000;text-transform:uppercase}.grand-total td{font-weight:bold;border-top:2px solid #000}.signatures{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:40px}.signatures td{padding-right:15px;width:25%;border:none}.sig-label{margin-bottom:15px;text-align:left;font-weight:bold}.sig-img-cell{height:40px;vertical-align:bottom;text-align:center}.sig-name-cell{vertical-align:top}.sig-line{border-top:1px solid #000;padding-top:4px;font-weight:bold;text-transform:uppercase;text-align:center}';
  const htmlTemplate = '<html><head><style>' + css + '</style></head><body>' + bodyHtml + '</body></html>';
  const blob = Utilities.newBlob(htmlTemplate, MimeType.HTML).getAs(MimeType.PDF);
  blob.setName('Voucher_' + voucherId + '.pdf');
  return Utilities.base64Encode(blob.getBytes());
}

function getPayrollVoucherPdf(pbId) {
  const ss = getPayrollDB_();
  const pbSheet = ss.getSheetByName('PayrollBooks');
  const h = ensurePayrollBooksHeaders_(pbSheet);
  const pbData = pbSheet.getDataRange().getValues();
  for (let i = 1; i < pbData.length; i++) {
    if (String(pbData[i][h.indexOf('PayrollID')]).trim() === String(pbId).trim()) {
      let vid = String(pbData[i][h.indexOf('LinkedVoucherId')] || '').trim();
      if (!vid || vid.includes('@')) vid = String(pbId).trim(); // fallback: VoucherId = pbId in Disbursement DB
      return { base64: getLinkedVoucherPdfBase64_(vid), voucherId: vid };
    }
  }
  throw new Error('Payroll Book not found.');
}

function getFinalPayVoucherPdf(fpId) {
  const ss = getPayrollDB_();
  const fpSheet = ss.getSheetByName('FinalPayBooks');
  const h = ensureFinalPayBooksHeaders_(fpSheet);
  const fpData = fpSheet.getDataRange().getValues();
  for (let i = 1; i < fpData.length; i++) {
    if (String(fpData[i][h.indexOf('FP_ID')]).trim() === String(fpId).trim()) {
      let vid = String(fpData[i][h.indexOf('LinkedVoucherId')] || '').trim();
      if (!vid || vid.includes('@')) vid = String(fpId).trim(); // fallback: VoucherId = fpId in Disbursement DB
      return { base64: getLinkedVoucherPdfBase64_(vid), voucherId: vid };
    }
  }
  throw new Error('Final Pay Book not found.');
}

// =====================================================================
// VOUCHER ROUTING FROM PAYROLL APP
// =====================================================================

function submitPayrollVoucherForApproval(pbId) {
  const ss = getPayrollDB_();
  const pbSheet = ss.getSheetByName('PayrollBooks');
  const h = ensurePayrollBooksHeaders_(pbSheet);
  const pbData = pbSheet.getDataRange().getValues();
  let linkedVid = '';
  for (let i = 1; i < pbData.length; i++) {
    if (String(pbData[i][h.indexOf('PayrollID')]).trim() === String(pbId).trim()) {
      linkedVid = String(pbData[i][h.indexOf('LinkedVoucherId')] || '').trim();
      if (!linkedVid || linkedVid.includes('@')) linkedVid = String(pbId).trim(); // fallback
      break;
    }
  }
  if (!linkedVid || linkedVid.includes('@')) throw new Error('No linked voucher found. Please send to Finance first.');
  return submitDisbVoucherForApproval_(linkedVid);
}

function submitFinalPayVoucherForApproval(fpId) {
  const ss = getPayrollDB_();
  const fpSheet = ss.getSheetByName('FinalPayBooks');
  const h = ensureFinalPayBooksHeaders_(fpSheet);
  const fpData = fpSheet.getDataRange().getValues();
  let linkedVid = '';
  for (let i = 1; i < fpData.length; i++) {
    if (String(fpData[i][h.indexOf('FP_ID')]).trim() === String(fpId).trim()) {
      linkedVid = String(fpData[i][h.indexOf('LinkedVoucherId')] || '').trim();
      if (!linkedVid || linkedVid.includes('@')) linkedVid = String(fpId).trim(); // fallback
      break;
    }
  }
  if (!linkedVid || linkedVid.includes('@')) throw new Error('No linked voucher found. Please send to Finance first.');
  return submitDisbVoucherForApproval_(linkedVid);
}

function submitDisbVoucherForApproval_(voucherId) {
  const disbSS = SpreadsheetApp.openById(DISBURSEMENT_DB_ID);
  const vSheet = disbSS.getSheetByName('Vouchers');
  if (!vSheet) throw new Error('Vouchers sheet not found in Disbursement DB.');
  const vData  = vSheet.getDataRange().getValues();
  const vHdr   = vData[0];
  const vidI   = vHdr.indexOf('VoucherId');
  const stI    = vHdr.indexOf('Status');
  const updAtI = vHdr.indexOf('UpdatedAt');
  const updByI = vHdr.indexOf('UpdatedBy');
  let rIdx = -1, currentStatus = '';
  for (let i = 1; i < vData.length; i++) {
    if (String(vData[i][vidI]).trim() === String(voucherId).trim()) {
      rIdx = i + 1; currentStatus = String(vData[i][stI]).trim(); break;
    }
  }
  if (rIdx === -1) throw new Error('Voucher ' + voucherId + ' not found in Disbursement DB.');
  if (currentStatus !== 'Pending') throw new Error('Voucher already routed (status: ' + currentStatus + ').');
  // Determine next status from Central Settings Users sheet
  const centralSS2 = SpreadsheetApp.openById(CENTRAL_SETTINGS_ID);
  const centralUsersSheet = centralSS2.getSheetByName('Users');
  const reviewerEmails = [], approverEmails = [];
  if (centralUsersSheet) {
    const uRows = centralUsersSheet.getDataRange().getValues();
    const uHdr  = uRows[0].map(c => String(c).trim().toLowerCase());
    const roleI  = uHdr.indexOf('role');
    const emailI = uHdr.indexOf('work email');
    const modI   = uHdr.findIndex(c => c.includes('module'));
    for (let i = 1; i < uRows.length; i++) {
      if (modI !== -1) {
        const mods = String(uRows[i][modI] || '').split(',').map(m => m.trim().toLowerCase());
        if (!mods.includes('disbursement')) continue;
      }
      const role  = String(uRows[i][roleI]  || '').toUpperCase();
      const email = String(uRows[i][emailI] || '').trim();
      if (!email) continue;
      if (role.includes('REVIEWER')) reviewerEmails.push(email);
      if (role.includes('APPROVER')) approverEmails.push(email);
    }
  }
  const now  = new Date();
  const user = Session.getEffectiveUser().getEmail();
  let nextStatus = '', targetEmails = [];
  if (reviewerEmails.length > 0)      { nextStatus = 'Pending Review';   targetEmails = reviewerEmails; }
  else if (approverEmails.length > 0) { nextStatus = 'Pending Approval'; targetEmails = approverEmails; }
  else throw new Error('No Reviewer or Approver defined in the Disbursement App Users sheet.');
  vSheet.getRange(rIdx, stI + 1).setValue(nextStatus);
  if (updAtI > -1) vSheet.getRange(rIdx, updAtI + 1).setValue(now);
  if (updByI > -1) vSheet.getRange(rIdx, updByI + 1).setValue(user);
  if (targetEmails.length > 0) {
    try {
      const body = '<div style="font-family:Arial,sans-serif;padding:30px;background:#f4f4f4;"><div style="max-width:500px;margin:0 auto;background:#fff;padding:30px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1);text-align:center;">'
        + '<h2 style="color:#188038;margin-top:0;">Action Required</h2>'
        + '<p style="color:#555;font-size:15px;">Voucher <b>' + voucherId + '</b> has been submitted and awaits your review/approval.</p>'
        + '<p style="color:#999;font-size:12px;">Submitted by: ' + user + '</p>'
        + '</div></div>';
      MailApp.sendEmail({ to: targetEmails.join(','), subject: 'ACTION REQUIRED: Payroll Voucher ' + voucherId, htmlBody: body });
    } catch(e) { Logger.log('submitDisbVoucherForApproval_ email error: ' + e.message); }
  }
  return { success: true, nextStatus: nextStatus };
}

// =====================================================================
// AUTO-CREATE VOUCHERS IN DISBURSEMENT APP ON SEND TO FINANCE
// =====================================================================

/**
 * Opens the Disbursement DB and writes a PAYROLL voucher + per-company lines.
 * Returns the VoucherId (= pbId) so it can be saved as LinkedVoucherId.
 */
function createPayrollVoucherInDisbApp_(pbId, pbName, payoutDate, reviewedBy, approvedBy) {
  try {
    const ss = getPayrollDB_();
    const consSheet = ss.getSheetByName('PayrollBookConsolidated');
    if (!consSheet) return null;
    const data = consSheet.getDataRange().getValues();
    const hdr = data[0].map(normalizeColName_);
    const pidI  = hdr.indexOf('payrollid');
    const statI = hdr.indexOf('salarystatus');
    const netI  = hdr.indexOf('payslipnetpay');
    const compI = hdr.indexOf('companyname');
    if (pidI < 0 || statI < 0 || netI < 0 || compI < 0) return null;

    // Group by company + bank (BPI vs UB vs Check)
    const compMap = {}; // { comp: { bpi:{net,count}, ub:{net,count}, check:{net,count} } }
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][pidI]).trim() !== String(pbId).trim()) continue;
      const comp   = String(data[i][compI] || 'Unknown').trim();
      const status = String(data[i][statI] || '').toUpperCase().trim();
      if (status === 'HOLD') continue; // exclude Hold
      const isBpi   = status === 'FOR RELEASE' || status.includes('-BPI');
      const isCheck = isCheckPayment_(status);
      const isHold  = status.includes('HOLD') || status.includes('CHECK ACCOUNT');
      if (isHold) continue;
      const rawNet = Number(String(data[i][netI] || 0).replace(/[^0-9.-]+/g, '')) || 0;
      const fee    = (!isBpi && !isCheck && status !== '') ? 50 : 0;
      const net    = rawNet - fee;
      if (net <= 0) continue;
      const bk = isCheck ? 'check' : (isBpi ? 'bpi' : 'ub');
      if (!compMap[comp]) compMap[comp] = { bpi:{net:0,count:0}, ub:{net:0,count:0}, check:{net:0,count:0} };
      compMap[comp][bk].net   += net;
      compMap[comp][bk].count += 1;
    }
    if (Object.keys(compMap).length === 0) return null;

    // Open Disbursement DB and look up account codes
    const disbSS   = SpreadsheetApp.openById(DISBURSEMENT_DB_ID);
    let bpiCode = '', ubCode = '', swpCode = '', pdcCode = '';
    const accSheet = disbSS.getSheetByName('Accounts');
    if (accSheet) {
      const acRows = accSheet.getDataRange().getValues();
      const acHdr  = acRows[0].map(h => String(h).toLowerCase());
      const nameCI = acHdr.findIndex(h => h.includes('name'));
      const codeCI = acHdr.findIndex(h => h.includes('code'));
      for (let i = 1; i < acRows.length; i++) {
        const n = String(acRows[i][nameCI] || '').toLowerCase();
        const c = String(acRows[i][codeCI] || '').trim();
        if (n.includes('bpi checking'))                                bpiCode = c;
        else if (n.includes('ub checking') || n.includes('unionbank checking') || n.includes('union bank checking')) ubCode = c;
        if (n.includes('salaries and wages payable'))                  swpCode = c;
        if (n.includes('post-dated checks issued') || n.includes('postdated checks issued')) pdcCode = c;
      }
    }

    // Guard: if voucher already exists, skip creation
    let vSheet = disbSS.getSheetByName('Vouchers');
    if (!vSheet) {
      vSheet = disbSS.insertSheet('Vouchers');
      vSheet.appendRow(['VoucherId','VoucherType','PreparationDate','PurposeCategory','Status','PaymentFromAccountCode','ContactSummary','TotalAmount','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy','CheckNumber','CheckDate','IsMultipleChecks','ReviewedBy','ApprovedBy','RejectReason','DisbursementRef','PreDisbursementStatus']);
    }
    const vHdr  = vSheet.getRange(1, 1, 1, vSheet.getLastColumn()).getValues()[0];
    const vData = vSheet.getDataRange().getValues();
    const vidColI = vHdr.indexOf('VoucherId');
    for (let i = 1; i < vData.length; i++) {
      if (String(vData[i][vidColI]).trim() === String(pbId).trim()) return pbId; // already exists
    }

    const now  = new Date();
    const user = Session.getEffectiveUser().getEmail();
    const vid  = pbId;

    // Build lines and total
    const vLines = []; let totalAmt = 0; const companies = [];
    for (const [comp, banks] of Object.entries(compMap)) {
      companies.push(comp);
      if (banks.bpi.net > 0) {
        vLines.push({ contact:comp, expAcc:swpCode, desc:`${pbName} - ${comp}`, amt:banks.bpi.net, cat:'BPI Payroll',   count:banks.bpi.count, bankCode:bpiCode });
        totalAmt += banks.bpi.net;
      }
      if (banks.ub.net > 0) {
        vLines.push({ contact:comp, expAcc:swpCode, desc:`${pbName} - ${comp}`, amt:banks.ub.net,  cat:'Other Banks',  count:banks.ub.count,  bankCode:ubCode  });
        totalAmt += banks.ub.net;
      }
      if (banks.check.net > 0) {
        vLines.push({ contact:comp, expAcc:swpCode, desc:`${pbName} - ${comp} (Check)`, amt:banks.check.net, cat:'Check Payment', count:banks.check.count, bankCode:pdcCode });
        totalAmt += banks.check.net;
      }
    }

    // Write Voucher header row
    const vRow = new Array(vHdr.length).fill('');
    vRow[vHdr.indexOf('VoucherId')]              = vid;
    vRow[vHdr.indexOf('VoucherType')]            = 'PAYROLL';
    vRow[vHdr.indexOf('PreparationDate')]        = payoutDate;
    vRow[vHdr.indexOf('PurposeCategory')]        = pbName;
    vRow[vHdr.indexOf('Status')]                 = 'Approved';
    vRow[vHdr.indexOf('ReviewedBy')]             = reviewedBy || '';
    vRow[vHdr.indexOf('ApprovedBy')]             = approvedBy || '';
    vRow[vHdr.indexOf('TotalAmount')]            = totalAmt;
    vRow[vHdr.indexOf('ContactSummary')]         = companies.slice(0,3).join(', ') + (companies.length > 3 ? ` +${companies.length-3} more` : '');
    vRow[vHdr.indexOf('IsMultipleChecks')]       = 'TRUE';
    vRow[vHdr.indexOf('CreatedAt')]              = now;
    vRow[vHdr.indexOf('CreatedBy')]              = user;
    vRow[vHdr.indexOf('UpdatedAt')]              = now;
    vRow[vHdr.indexOf('UpdatedBy')]              = user;
    vSheet.appendRow(vRow);

    // Write VoucherLines
    let vlSheet = disbSS.getSheetByName('VoucherLines');
    if (!vlSheet) {
      vlSheet = disbSS.insertSheet('VoucherLines');
      vlSheet.appendRow(['VoucherId','Date','LineNo','Contact','ExpenseAccountCode','Description','Amount','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy','Category','ManpowerCount','LineBankCode','LineCheckNumber','LineCheckDate']);
    }
    const vlHdr  = vlSheet.getRange(1, 1, 1, vlSheet.getLastColumn()).getValues()[0];
    const vlRows = vLines.map((l, i) => {
      const row = new Array(vlHdr.length).fill('');
      row[vlHdr.indexOf('VoucherId')]           = vid;
      row[vlHdr.indexOf('Date')]                = payoutDate;
      row[vlHdr.indexOf('LineNo')]              = i + 1;
      row[vlHdr.indexOf('Contact')]             = l.contact;
      row[vlHdr.indexOf('ExpenseAccountCode')]  = l.expAcc;
      row[vlHdr.indexOf('Description')]         = l.desc;
      row[vlHdr.indexOf('Amount')]              = l.amt;
      row[vlHdr.indexOf('Category')]            = l.cat;
      row[vlHdr.indexOf('ManpowerCount')]       = l.count;
      row[vlHdr.indexOf('LineBankCode')]        = l.bankCode;
      row[vlHdr.indexOf('CreatedAt')]           = now;
      row[vlHdr.indexOf('CreatedBy')]           = user;
      row[vlHdr.indexOf('UpdatedAt')]           = now;
      row[vlHdr.indexOf('UpdatedBy')]           = user;
      return row;
    });
    if (vlRows.length > 0) vlSheet.getRange(vlSheet.getLastRow() + 1, 1, vlRows.length, vlHdr.length).setValues(vlRows);

    return vid;
  } catch(e) {
    Logger.log('createPayrollVoucherInDisbApp_ error: ' + e.message);
    return null;
  }
}

/**
 * Creates a separate CHECK voucher in the Disbursement DB for all employees whose
 * Salary Status is 'For Release-Check'. One line per company, grouped.
 * Lines have blank LineCheckNumber / LineCheckDate / LineBankCode for Finance to fill in.
 * The PAYROLL voucher already captures DR Salaries Payable / CR PDC Issued.
 * This CHECK voucher is the physical check issuance authorization document.
 * Returns the new VoucherId, or null if no check employees exist.
 */
function createCheckVoucherInDisbApp_(pbId, pbName, payoutDate, reviewedBy, approvedBy) {
  try {
    const ss = getPayrollDB_();
    const consSheet = ss.getSheetByName('PayrollBookConsolidated');
    if (!consSheet) return null;
    const data = consSheet.getDataRange().getValues();
    const hdr  = data[0].map(normalizeColName_);
    const pidI  = hdr.indexOf('payrollid');
    const statI = hdr.indexOf('salarystatus');
    const netI  = hdr.indexOf('payslipnetpay');
    const compI = hdr.indexOf('companyname');
    if (pidI < 0 || statI < 0 || netI < 0 || compI < 0) return null;

    // Collect check-payment employees only, grouped by company
    const compMap = {}; // { comp: { net, count } }
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][pidI]).trim() !== String(pbId).trim()) continue;
      const status = String(data[i][statI] || '').toUpperCase().trim();
      if (!isCheckPayment_(status)) continue;
      const comp   = String(data[i][compI] || 'Unknown').trim();
      const rawNet = Number(String(data[i][netI] || 0).replace(/[^0-9.-]+/g, '')) || 0;
      if (rawNet <= 0) continue;
      if (!compMap[comp]) compMap[comp] = { net: 0, count: 0 };
      compMap[comp].net   += rawNet;
      compMap[comp].count += 1;
    }
    if (Object.keys(compMap).length === 0) return null; // no check employees

    const disbSS = SpreadsheetApp.openById(DISBURSEMENT_DB_ID);
    let pdcCode = '';
    const accSheet = disbSS.getSheetByName('Accounts');
    if (accSheet) {
      const acRows = accSheet.getDataRange().getValues();
      const acHdr  = acRows[0].map(h => String(h).toLowerCase());
      const nameCI = acHdr.findIndex(h => h.includes('name'));
      const codeCI = acHdr.findIndex(h => h.includes('code'));
      for (let i = 1; i < acRows.length; i++) {
        const n = String(acRows[i][nameCI] || '').toLowerCase();
        const c = String(acRows[i][codeCI] || '').trim();
        if (n.includes('post-dated checks issued') || n.includes('postdated checks issued')) { pdcCode = c; break; }
      }
    }

    const now  = new Date();
    const user = Session.getEffectiveUser().getEmail();
    const vid  = generateVoucherId_('CHECK');

    let vSheet = disbSS.getSheetByName('Vouchers');
    if (!vSheet) {
      vSheet = disbSS.insertSheet('Vouchers');
      vSheet.appendRow(['VoucherId','VoucherType','PreparationDate','PurposeCategory','Status','PaymentFromAccountCode','ContactSummary','TotalAmount','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy','CheckNumber','CheckDate','IsMultipleChecks','ReviewedBy','ApprovedBy','RejectReason','DisbursementRef','PreDisbursementStatus']);
    }
    const vHdr = vSheet.getRange(1, 1, 1, vSheet.getLastColumn()).getValues()[0];

    // Build lines and total
    const vLines = []; let totalAmt = 0; const companies = [];
    for (const [comp, d] of Object.entries(compMap)) {
      companies.push(comp);
      vLines.push({ contact: comp, expAcc: pdcCode, desc: `${pbName} - ${comp} (Check Payment)`, amt: d.net, count: d.count });
      totalAmt += d.net;
    }

    // Write Voucher header row — Status 'Draft' so Finance fills in check numbers before approving
    const vRow = new Array(vHdr.length).fill('');
    vRow[vHdr.indexOf('VoucherId')]        = vid;
    vRow[vHdr.indexOf('VoucherType')]      = 'CHECK';
    vRow[vHdr.indexOf('PreparationDate')]  = payoutDate;
    vRow[vHdr.indexOf('PurposeCategory')]  = `${pbName} (Check Payments)`;
    vRow[vHdr.indexOf('Status')]           = 'Draft';
    vRow[vHdr.indexOf('ReviewedBy')]       = reviewedBy || '';
    vRow[vHdr.indexOf('ApprovedBy')]       = approvedBy || '';
    vRow[vHdr.indexOf('TotalAmount')]      = totalAmt;
    vRow[vHdr.indexOf('ContactSummary')]   = companies.slice(0,3).join(', ') + (companies.length > 3 ? ` +${companies.length-3} more` : '');
    vRow[vHdr.indexOf('IsMultipleChecks')] = 'TRUE';
    vRow[vHdr.indexOf('CreatedAt')]        = now;
    vRow[vHdr.indexOf('CreatedBy')]        = user;
    vRow[vHdr.indexOf('UpdatedAt')]        = now;
    vRow[vHdr.indexOf('UpdatedBy')]        = user;
    vSheet.appendRow(vRow);

    // Write VoucherLines — LineCheckNumber, LineCheckDate, LineBankCode left blank for Finance
    let vlSheet = disbSS.getSheetByName('VoucherLines');
    if (!vlSheet) {
      vlSheet = disbSS.insertSheet('VoucherLines');
      vlSheet.appendRow(['VoucherId','Date','LineNo','Contact','ExpenseAccountCode','Description','Amount','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy','Category','ManpowerCount','LineBankCode','LineCheckNumber','LineCheckDate']);
    }
    const vlHdr = vlSheet.getRange(1, 1, 1, vlSheet.getLastColumn()).getValues()[0];
    const vlRows = vLines.map((l, i) => {
      const row = new Array(vlHdr.length).fill('');
      row[vlHdr.indexOf('VoucherId')]          = vid;
      row[vlHdr.indexOf('Date')]               = payoutDate;
      row[vlHdr.indexOf('LineNo')]             = i + 1;
      row[vlHdr.indexOf('Contact')]            = l.contact;
      row[vlHdr.indexOf('ExpenseAccountCode')] = l.expAcc;
      row[vlHdr.indexOf('Description')]        = l.desc;
      row[vlHdr.indexOf('Amount')]             = l.amt;
      row[vlHdr.indexOf('Category')]           = 'Check Payment';
      row[vlHdr.indexOf('ManpowerCount')]      = l.count;
      row[vlHdr.indexOf('LineBankCode')]       = ''; // Finance fills in — which bank to draw from
      row[vlHdr.indexOf('LineCheckNumber')]    = ''; // Finance fills in
      row[vlHdr.indexOf('LineCheckDate')]      = ''; // Finance fills in
      row[vlHdr.indexOf('CreatedAt')]          = now;
      row[vlHdr.indexOf('CreatedBy')]          = user;
      row[vlHdr.indexOf('UpdatedAt')]          = now;
      row[vlHdr.indexOf('UpdatedBy')]          = user;
      return row;
    });
    if (vlRows.length > 0) vlSheet.getRange(vlSheet.getLastRow() + 1, 1, vlRows.length, vlHdr.length).setValues(vlRows);

    return vid;
  } catch(e) {
    Logger.log('createCheckVoucherInDisbApp_ error: ' + e.message);
    return null;
  }
}

/**
 * Opens the Disbursement DB and writes a FINAL_PAY voucher + per-company lines.
 * Returns the VoucherId (= fpId) so it can be saved as LinkedVoucherId.
 */
function createFinalPayVoucherInDisbApp_(fpId, releaseDate, reviewedBy, approvedBy) {
  try {
    const ss = getPayrollDB_();
    const consSheet = ss.getSheetByName('FinalPayConsolidated');
    if (!consSheet) return null;
    const data = consSheet.getDataRange().getValues();
    const hdr  = data[0].map(normalizeColName_);
    const pidI  = hdr.indexOf('fpid');
    const compI = hdr.indexOf('companyname');
    const netI  = hdr.indexOf('netfinalpay');
    const nameI = hdr.indexOf('name');
    if (pidI < 0 || compI < 0 || netI < 0) return null;

    // Group by company
    const compMap = {}; // { comp: { net, count } }
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][pidI]).trim() !== String(fpId).trim()) continue;
      const comp = String(data[i][compI] || 'Unknown').trim();
      const net  = Number(String(data[i][netI] || 0).replace(/[^0-9.-]+/g, '')) || 0;
      if (!compMap[comp]) compMap[comp] = { net:0, count:0 };
      compMap[comp].net   += net;
      compMap[comp].count += 1;
    }
    if (Object.keys(compMap).length === 0) return null;

    // Open Disbursement DB and look up account codes
    const disbSS  = SpreadsheetApp.openById(DISBURSEMENT_DB_ID);
    let swpCode = '';
    const accSheet = disbSS.getSheetByName('Accounts');
    if (accSheet) {
      const acRows = accSheet.getDataRange().getValues();
      const acHdr  = acRows[0].map(h => String(h).toLowerCase());
      const nameCI = acHdr.findIndex(h => h.includes('name'));
      const codeCI = acHdr.findIndex(h => h.includes('code'));
      for (let i = 1; i < acRows.length; i++) {
        const n = String(acRows[i][nameCI] || '').toLowerCase();
        if (n.includes('salaries and wages payable')) { swpCode = String(acRows[i][codeCI] || '').trim(); break; }
      }
    }

    // Guard: if voucher already exists, skip
    let vSheet = disbSS.getSheetByName('Vouchers');
    if (!vSheet) {
      vSheet = disbSS.insertSheet('Vouchers');
      vSheet.appendRow(['VoucherId','VoucherType','PreparationDate','PurposeCategory','Status','PaymentFromAccountCode','ContactSummary','TotalAmount','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy','CheckNumber','CheckDate','IsMultipleChecks','ReviewedBy','ApprovedBy','RejectReason','DisbursementRef','PreDisbursementStatus']);
    }
    const vHdr  = vSheet.getRange(1, 1, 1, vSheet.getLastColumn()).getValues()[0];
    const vData = vSheet.getDataRange().getValues();
    const vidColI = vHdr.indexOf('VoucherId');
    for (let i = 1; i < vData.length; i++) {
      if (String(vData[i][vidColI]).trim() === String(fpId).trim()) return fpId;
    }

    const now  = new Date();
    const user = Session.getEffectiveUser().getEmail();
    const vid  = fpId;

    let totalAmt = 0; const companies = [];
    const vLines = [];
    for (const [comp, v] of Object.entries(compMap)) {
      companies.push(comp);
      if (v.net > 0) {
        vLines.push({ contact:comp, expAcc:swpCode, desc:`Final Pay - ${comp}`, amt:v.net, count:v.count });
        totalAmt += v.net;
      }
    }

    const vRow = new Array(vHdr.length).fill('');
    vRow[vHdr.indexOf('VoucherId')]        = vid;
    vRow[vHdr.indexOf('VoucherType')]      = 'FINAL_PAY';
    vRow[vHdr.indexOf('PreparationDate')] = releaseDate;
    vRow[vHdr.indexOf('PurposeCategory')] = `Final Pay Batch ${fpId}`;
    vRow[vHdr.indexOf('Status')]          = 'Approved';
    vRow[vHdr.indexOf('ReviewedBy')]      = reviewedBy || '';
    vRow[vHdr.indexOf('ApprovedBy')]      = approvedBy || '';
    vRow[vHdr.indexOf('TotalAmount')]     = totalAmt;
    vRow[vHdr.indexOf('ContactSummary')]  = companies.slice(0,3).join(', ') + (companies.length > 3 ? ` +${companies.length-3} more` : '');
    vRow[vHdr.indexOf('IsMultipleChecks')]= 'TRUE';
    vRow[vHdr.indexOf('CreatedAt')]       = now;
    vRow[vHdr.indexOf('CreatedBy')]       = user;
    vRow[vHdr.indexOf('UpdatedAt')]       = now;
    vRow[vHdr.indexOf('UpdatedBy')]       = user;
    vSheet.appendRow(vRow);

    let vlSheet = disbSS.getSheetByName('VoucherLines');
    if (!vlSheet) {
      vlSheet = disbSS.insertSheet('VoucherLines');
      vlSheet.appendRow(['VoucherId','Date','LineNo','Contact','ExpenseAccountCode','Description','Amount','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy','Category','ManpowerCount','LineBankCode','LineCheckNumber','LineCheckDate']);
    }
    const vlHdr  = vlSheet.getRange(1, 1, 1, vlSheet.getLastColumn()).getValues()[0];
    const vlRows = vLines.map((l, i) => {
      const row = new Array(vlHdr.length).fill('');
      row[vlHdr.indexOf('VoucherId')]          = vid;
      row[vlHdr.indexOf('Date')]               = releaseDate;
      row[vlHdr.indexOf('LineNo')]             = i + 1;
      row[vlHdr.indexOf('Contact')]            = l.contact;
      row[vlHdr.indexOf('ExpenseAccountCode')] = l.expAcc;
      row[vlHdr.indexOf('Description')]        = l.desc;
      row[vlHdr.indexOf('Amount')]             = l.amt;
      row[vlHdr.indexOf('Category')]           = 'Final Pay';
      row[vlHdr.indexOf('ManpowerCount')]      = l.count;
      row[vlHdr.indexOf('CreatedAt')]          = now;
      row[vlHdr.indexOf('CreatedBy')]          = user;
      row[vlHdr.indexOf('UpdatedAt')]          = now;
      row[vlHdr.indexOf('UpdatedBy')]          = user;
      return row;
    });
    if (vlRows.length > 0) vlSheet.getRange(vlSheet.getLastRow() + 1, 1, vlRows.length, vlHdr.length).setValues(vlRows);

    return vid;
  } catch(e) {
    Logger.log('createFinalPayVoucherInDisbApp_ error: ' + e.message);
    return null;
  }
}

function sendPayrollBookToFinance(pbId) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  if (!callerRoles.includes('Maker') && !callerRoles.includes('Admin'))
    throw new Error('Only Makers can send a Payroll Book to Finance.');
  const ss = getPayrollDB_(); const pbSheet = ss.getSheetByName('PayrollBooks'); const pbData = pbSheet.getDataRange().getValues(); const h = ensurePayrollBooksHeaders_(pbSheet); let rIdx = -1;
  for (let i = 1; i < pbData.length; i++) { if (String(pbData[i][h.indexOf('PayrollID')]).trim() === String(pbId).trim()) { rIdx = i + 1; break; } }
  if (rIdx === -1) throw new Error('Payroll Book not found.');
  if (String(pbData[rIdx - 1][h.indexOf('Status')]).trim() !== 'Approved') throw new Error('Only Approved books can be sent to Finance.');
  const pbName     = String(pbData[rIdx - 1][h.indexOf('Name')]       || '').trim();
  const payoutDate = String(pbData[rIdx - 1][h.indexOf('PayoutDate')] || '').trim();
  pbSheet.getRange(rIdx, h.indexOf('Status') + 1).setValue('Processing');
  const consSheet = ss.getSheetByName('PayrollBookConsolidated');
  if (consSheet) {
    const cData = consSheet.getDataRange().getValues(); const cpIdx = cData[0].indexOf('PayrollID'); const clStatusIdx = cData[0].indexOf('LineStatus'); let writeArray = consSheet.getRange(2, clStatusIdx + 1, cData.length - 1, 1).getValues(); let changed = false;
    for (let i = 1; i < cData.length; i++) { if (String(cData[i][cpIdx]).trim() === String(pbId).trim()) { writeArray[i-1][0] = 'Processing'; changed = true; } }
    if (changed) consSheet.getRange(2, clStatusIdx + 1, cData.length - 1, 1).setValues(writeArray);
  }
  syncJournalEntries_(pbId, false);
  const reviewedBy   = String(pbData[rIdx - 1][h.indexOf('ReviewedBy')]      || '').trim();
  const approvedBy   = String(pbData[rIdx - 1][h.indexOf('FinalApprovedBy')] || '').trim();
  const linkedVid = createPayrollVoucherInDisbApp_(pbId, pbName, payoutDate, reviewedBy, approvedBy);
  if (linkedVid) {
    const linkedIdx = h.indexOf('LinkedVoucherId');
    if (linkedIdx > -1) pbSheet.getRange(rIdx, linkedIdx + 1).setValue(linkedVid);
  }
  const linkedCheckVid = createCheckVoucherInDisbApp_(pbId, pbName, payoutDate, reviewedBy, approvedBy);
  if (linkedCheckVid) {
    const linkedCheckIdx = h.indexOf('LinkedCheckVoucherId');
    if (linkedCheckIdx > -1) pbSheet.getRange(rIdx, linkedCheckIdx + 1).setValue(linkedCheckVid);
  }
  return { success: true, linkedVoucherId: linkedVid, linkedCheckVoucherId: linkedCheckVid };
}

function columnToLetter_(column) { let temp, letter = ''; while (column > 0) { temp = (column - 1) % 26; letter = String.fromCharCode(temp + 65) + letter; column = (column - temp - 1) / 26; } return letter; }

function generatePaysheets(pbId) {
    const details = getPayrollBookDetails(pbId); let lines = details.lines.filter(l => !String(l['Salary Status']).toLowerCase().includes('hold'));
    lines.sort((a, b) => { const sA = String(a['Salary Status']).trim(); const sB = String(b['Salary Status']).trim(); const isBpiA = (sA === 'For Release'); const isBpiB = (sB === 'For Release'); if (isBpiA && !isBpiB) return -1; if (!isBpiA && isBpiB) return 1; return sA.localeCompare(sB); });
    const grouped = {}; lines.forEach(l => { const comp = l['Company Name'] || 'Unknown'; if (!grouped[comp]) grouped[comp] = []; grouped[comp].push(l); });
    const generated = []; let folder; try { folder = DriveApp.getFolderById(PAYSHEETS_FOLDER_ID); } catch(e) { throw new Error(`Cannot access target Google Drive Folder (${PAYSHEETS_FOLDER_ID}). Make sure it is shared correctly.`); }
    const targetHeaders = ["Name", "Daily Rate", "Days (days)", "Regular", "Lates (mins)", "Lates", "Total Bsc", "Overtime", "ND", "DOD", "DOD OT", "Spl Hol", "Spl Hol OT", "Lgl Hol", "Lgl Hol OT", "Alw", "Adj", "Total Gross Pay", "Pagibig", "Pagibig Loan", "SSS Loan", "SSS", "Philhealth", "Total Deduction", "13th Month", "Payslip Net Pay", "Computed Net Pay", "Validity Check", "Region", "Employment Status", "Bank Account Number", "Amount", "Name (copy)", "Remarks"];
    const sumCols = ["Total Gross Pay", "Total Deduction", "13th Month", "Payslip Net Pay", "Amount"];
    const moneyCols = ["Daily Rate", "Regular", "Lates", "Total Bsc", "Overtime", "ND", "DOD", "DOD OT", "Spl Hol", "Spl Hol OT", "Lgl Hol", "Lgl Hol OT", "Alw", "Adj", "Total Gross Pay", "Pagibig", "Pagibig Loan", "SSS Loan", "SSS", "Philhealth", "Total Deduction", "13th Month", "Payslip Net Pay", "Computed Net Pay", "Amount"];
    for (const comp in grouped) {
        const compLines = grouped[comp]; const activeHeaders = targetHeaders.filter(h => { if (['Name', 'Name (copy)', 'Amount', 'Bank Account Number', 'Payslip Net Pay'].includes(h)) return true; return compLines.some(l => { let val = l[h]; if (h === 'Bank Account Number') val = l['Bank Account Number']; if (val === null || val === undefined || val === '') return false; if (typeof val === 'number') return val !== 0; let strVal = String(val).trim(); return strVal !== '' && strVal !== '0' && strVal !== '0.00' && strVal !== '-' && strVal !== '--'; }); });
        const rawFileName = `${comp} - Paysheet - ${pbId}`; const fileName = rawFileName.replace(/[\\/:\*\?"<>\|]/g, ""); const existingFiles = folder.getFilesByName(fileName); while (existingFiles.hasNext()) { const f = existingFiles.next(); if (!f.isTrashed()) f.setTrashed(true); }
        const ssNew = SpreadsheetApp.create(fileName); const file = DriveApp.getFileById(ssNew.getId()); file.moveTo(folder); const sheet = ssNew.getSheets()[0]; const safeSheetName = comp.replace(/[\\/:\*\?"<>\|\[\]]/g, "").substring(0, 31); sheet.setName(safeSheetName); 
        const start = compLines[0]['Cutoff Start']; const end = compLines[0]['Cutoff End'];
        sheet.getRange('A1').setValue(comp).setFontWeight('bold'); sheet.getRange('A2').setValue('Payroll Cut-Off Period'); sheet.getRange('A3').setValue(`${start} - ${end}`); sheet.getRange(5, 1, 1, activeHeaders.length).setValues([activeHeaders]).setFontWeight('bold').setBorder(null, null, true, null, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID);
        const rows = compLines.map(l => { return activeHeaders.map(h => { if (h === 'Name (copy)') return l['Name']; if (h === 'Bank Account Number') { const acc = l['Bank Account Number'] || ''; return acc ? `'${acc}` : ''; } if (h === 'Amount') { let rawNet = Number(String(l['Payslip Net Pay'] || 0).replace(/[^0-9.-]+/g, '')); let status = String(l['Salary Status'] || '').trim().toUpperCase(); let isBpi = status === 'FOR RELEASE' || status.includes('-BPI'); let isHold = status.includes('HOLD') || status.includes('CHECK ACCOUNT'); let isCheck = isCheckPayment_(status); let fee = (!isBpi && !isCheck && !isHold && status !== '') ? 50 : 0; return rawNet - fee; } return l[h] !== undefined ? l[h] : ''; }); });
        if (rows.length > 0) {
            sheet.getRange(6, 1, rows.length, activeHeaders.length).setValues(rows); activeHeaders.forEach((h, idx) => { if (moneyCols.includes(h)) { sheet.getRange(6, idx + 1, rows.length, 1).setNumberFormat('#,##0.00'); } });
            const totalRow = 6 + rows.length + 1; sheet.getRange(totalRow, activeHeaders.indexOf('Name') + 1).setValue('Grand Total').setFontWeight('bold');
            sumCols.forEach(sc => { const colIdx = activeHeaders.indexOf(sc); if (colIdx !== -1) { const colLetter = columnToLetter_(colIdx + 1); sheet.getRange(totalRow, colIdx + 1).setFormula(`=SUM(${colLetter}6:${colLetter}${totalRow - 2})`).setFontWeight('bold').setNumberFormat('#,##0.00'); } });
            sheet.getRange(totalRow, 1, 1, activeHeaders.length).setBorder(true, null, null, null, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID);
        }
        sheet.autoResizeColumns(1, activeHeaders.length); generated.push({ company: comp, url: ssNew.getUrl() });
    }
    const ss = getPayrollDB_(); const pbSheet = ss.getSheetByName('PayrollBooks'); const h = ensurePayrollBooksHeaders_(pbSheet); const data = pbSheet.getDataRange().getValues(); const pIdIdx = h.indexOf('PayrollID'); const genIdx = h.indexOf('GeneratedPaysheets');
    for (let i = 1; i < data.length; i++) { if (String(data[i][pIdIdx]).trim() === String(pbId).trim()) { pbSheet.getRange(i + 1, genIdx + 1).setValue(JSON.stringify(generated)); break; } }
    return { success: true, generated };
}

function escapeHtml_(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function downloadPaysheetPdfBase64(pbId, companyName) {
    const details = getPayrollBookDetails(pbId); let lines = details.lines.filter(l => !String(l['Salary Status']).toLowerCase().includes('hold'));
    lines.sort((a, b) => { const sA = String(a['Salary Status']).trim(); const sB = String(b['Salary Status']).trim(); const isBpiA = (sA === 'For Release'); const isBpiB = (sB === 'For Release'); if (isBpiA && !isBpiB) return -1; if (!isBpiA && isBpiB) return 1; return sA.localeCompare(sB); });
    if (companyName) { lines = lines.filter(l => String(l['Company Name']).trim() === String(companyName).trim()); }
    const grouped = {}; lines.forEach(l => { const comp = l['Company Name'] || 'Unknown'; if (!grouped[comp]) grouped[comp] = []; grouped[comp].push(l); });
    const targetHeaders = ["Name", "Daily Rate", "Days (days)", "Regular", "Lates (mins)", "Lates", "Total Bsc", "Overtime", "ND", "DOD", "DOD OT", "Spl Hol", "Spl Hol OT", "Lgl Hol", "Lgl Hol OT", "Alw", "Adj", "Total Gross Pay", "Pagibig", "Pagibig Loan", "SSS Loan", "SSS", "Philhealth", "Total Deduction", "13th Month", "Payslip Net Pay", "Computed Net Pay", "Validity Check", "Region", "Employment Status", "Bank Account Number", "Amount", "Name (copy)", "Remarks"];
    const sumCols = ["Total Gross Pay", "Total Deduction", "13th Month", "Payslip Net Pay", "Amount"];
    const moneyCols = ["Daily Rate", "Regular", "Lates", "Total Bsc", "Overtime", "ND", "DOD", "DOD OT", "Spl Hol", "Spl Hol OT", "Lgl Hol", "Lgl Hol OT", "Alw", "Adj", "Total Gross Pay", "Pagibig", "Pagibig Loan", "SSS Loan", "SSS", "Philhealth", "Total Deduction", "13th Month", "Payslip Net Pay", "Computed Net Pay", "Amount"];
    const fmtMoney = (n) => Number(n || 0).toLocaleString('en-PH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    let allHtml = ''; let isFirst = true;
    for (const comp in grouped) {
        if (!isFirst) allHtml += `<div style="page-break-before: always;"></div>`; isFirst = false;
        const compLines = grouped[comp];
        const activeHeaders = targetHeaders.filter(h => { if (['Name', 'Name (copy)', 'Amount', 'Bank Account Number', 'Payslip Net Pay'].includes(h)) return true; return compLines.some(l => { let val = l[h]; if (h === 'Bank Account Number') val = l['Bank Account Number']; if (val === null || val === undefined || val === '') return false; if (typeof val === 'number') return val !== 0; let strVal = String(val).trim(); return strVal !== '' && strVal !== '0' && strVal !== '0.00' && strVal !== '-' && strVal !== '--'; }); });
        const start = compLines[0]['Cutoff Start']; const end = compLines[0]['Cutoff End'];
        let tableHtml = `<table class="data-table"><thead><tr>`; activeHeaders.forEach(h => { tableHtml += `<th>${escapeHtml_(h)}</th>`; }); tableHtml += `</tr></thead><tbody>`;
        const sums = {}; sumCols.forEach(sc => sums[sc] = 0);
        compLines.forEach(l => {
            tableHtml += `<tr>`;
            activeHeaders.forEach(h => {
                let val = l[h] !== undefined ? l[h] : ''; if (h === 'Name (copy)') val = l['Name']; if (h === 'Bank Account Number') { val = l['Bank Account Number'] || ''; if (val) val = `'${val}`; }
                if (h === 'Amount') { let rawNet = Number(String(l['Payslip Net Pay'] || 0).replace(/[^0-9.-]+/g, '')); let status = String(l['Salary Status'] || '').trim().toUpperCase(); let isBpi = status === 'FOR RELEASE' || status.includes('-BPI'); let isHold = status.includes('HOLD') || status.includes('CHECK ACCOUNT'); let isCheck = isCheckPayment_(status); let fee = (!isBpi && !isCheck && !isHold && status !== '') ? 50 : 0; val = rawNet - fee; }
                let numericVal = 0; if (sumCols.includes(h) || moneyCols.includes(h)) { numericVal = Number(String(val).replace(/[^0-9.-]+/g,'') || 0); }
                if (sumCols.includes(h)) sums[h] += numericVal;
                if (moneyCols.includes(h)) { tableHtml += `<td style="text-align:right;">${numericVal !== 0 ? fmtMoney(numericVal) : '-'}</td>`; } else { tableHtml += `<td>${escapeHtml_(val)}</td>`; }
            });
            tableHtml += `</tr>`;
        });
        tableHtml += `<tr class="grand-total">`; activeHeaders.forEach(h => { if (h === 'Name') { tableHtml += `<td>Grand Total</td>`; } else if (sumCols.includes(h)) { tableHtml += `<td style="text-align:right;">${fmtMoney(sums[h])}</td>`; } else { tableHtml += `<td></td>`; } }); tableHtml += `</tr></tbody></table>`;
        allHtml += `<div style="font-size: 14px; font-weight: bold; margin-bottom: 2px; font-family: sans-serif;">${escapeHtml_(comp)}</div><div style="font-size: 10px; margin-bottom: 2px; font-family: sans-serif;">Payroll Cut-Off Period</div><div style="font-size: 10px; margin-bottom: 10px; font-family: sans-serif;">${escapeHtml_(start)} - ${escapeHtml_(end)}</div>${tableHtml}`;
    }
    const finalHtml = `<html><head><style>@page { size: legal landscape; margin: 0.25in; } body { font-family: Arial, sans-serif; font-size: 7px; color: #000; } .data-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 7px; table-layout: auto; } .data-table th, .data-table td { padding: 3px 2px; border: 1px solid #000; overflow: hidden; text-align: left; vertical-align: middle; white-space: nowrap; } .data-table th { background-color: #f0f0f0; font-weight: bold; text-align: center; } .grand-total td { font-weight: bold; background-color: #e2e8f0; }</style></head><body>${allHtml}</body></html>`;
    try { const blob = Utilities.newBlob(finalHtml, MimeType.HTML).getAs(MimeType.PDF); const rawFileName = companyName ? `${companyName} - Paysheet - ${pbId}.pdf` : `Merged_Paysheets_${pbId}.pdf`; const safeFileName = rawFileName.replace(/[\\/:\*\?"<>\|\[\]]/g, ""); blob.setName(safeFileName); return { base64: Utilities.base64Encode(blob.getBytes()), fileName: safeFileName }; } catch (err) { throw new Error(err.message); }
}

function getInstaPayBankCodes() {
  const ss = getPayrollDB_(); const sheet = ss.getSheetByName('BankCode'); if (!sheet) return []; const data = sheet.getDataRange().getValues(); const codes = []; for (let i = 1; i < data.length; i++) { if (data[i][0] && data[i][1]) { codes.push({ name: String(data[i][0]).trim(), code: String(data[i][1]).trim() }); } } return codes.sort((a, b) => a.name.localeCompare(b.name));
}

function getAccountsAndContacts() {
  const ss = getPayrollDB_();
  const accounts = [];
  // Account codes (COA) live in the Central Journal Lines spreadsheet
  const cjSS = SpreadsheetApp.openById(CENTRAL_JOURNAL_ID);
  const accSheet = cjSS.getSheetByName('Accounts');
  if (accSheet) {
      const data = accSheet.getDataRange().getValues();
      if (data.length >= 2) {
          const headers = data[0];
          for (let i = 1; i < data.length; i++) {
             const obj = {};
             headers.forEach((h, idx) => { obj[String(h).trim()] = data[i][idx]; });
             accounts.push(obj);
          }
      }
  }
  
  const contacts = [];
  // Contacts are maintained in Central Settings spreadsheet
  const centralSS = SpreadsheetApp.openById(CENTRAL_SETTINGS_ID);
  const contSheet = centralSS.getSheetByName('Contacts');
  if (contSheet) {
      const data = contSheet.getDataRange().getValues();
      if (data.length >= 2) {
          const headers = data[0].map(h => String(h).trim().toLowerCase());
          const nameIdx = headers.indexOf('contactname');
          const ccIdx   = headers.indexOf('cost center');
          if (nameIdx > -1) {
              for (let i = 1; i < data.length; i++) {
                  if (data[i][nameIdx]) {
                      contacts.push({
                          name: String(data[i][nameIdx]).trim(),
                          costCenter: ccIdx > -1 ? String(data[i][ccIdx]).trim() : ''
                      });
                  }
              }
          }
      }
  }
  return { accounts, contacts };
}

function ensureFinalPayBooksHeaders_(sheet) {
    const h = ['FP_ID', 'Release Date', 'Status', 'Headcount', 'CreatedAt', 'CreatedBy', 'M13BreakdownJSON', 'LinkedVoucherId'].concat(WORKFLOW_COLS);
    if (sheet.getLastRow() === 0) { sheet.appendRow(h); sheet.getRange(1, 1, 1, h.length).setFontWeight("bold").setBackground("#f3f4f6"); sheet.setFrozenRows(1); return h; }
    const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    // Insert missing column rather than overwriting headers (prevents data misalignment)
    if (!existingHeaders.includes('LinkedVoucherId')) {
      const insertAfterCol = existingHeaders.indexOf('M13BreakdownJSON') + 1; // 1-based
      sheet.insertColumnAfter(insertAfterCol);
      sheet.getRange(1, insertAfterCol + 1).setValue('LinkedVoucherId').setFontWeight('bold').setBackground('#f3f4f6');
    }
    return h;
}

function ensureFinalPayConsolidatedHeaders_(sheet) {
    const h = ['FP_ID', 'Name', 'Company Name', 'Cutoff Start', 'Cutoff End', 'Daily Rate', 'Days (days)', 'Regular', 'Lates (mins)', 'Lates', 'Total Bsc', 'Overtime', 'ND', 'DOD', 'DOD OT', 'Spl Hol', 'Spl Hol OT', 'Lgl Hol', 'Lgl Hol OT', 'Alw', 'Adj', 'Total Gross Pay', 'Pagibig', 'Pagibig Loan', 'SSS Loan', 'SSS', 'Philhealth', 'Total Deduction', 'Hold Salary', '13th Month', 'Gross Final Pay', 'Deductions', 'Net Final Pay', 'Mode of Release', 'Bank Account', 'Benefits JSON', 'LineStatus'];
    if (sheet.getLastRow() === 0) { sheet.appendRow(h); sheet.getRange(1, 1, 1, h.length).setFontWeight("bold").setBackground("#f3f4f6"); sheet.setFrozenRows(1); return h; }
    const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0]; if (existingHeaders.length < h.length) { sheet.getRange(1, 1, 1, h.length).setValues([h]); } return h;
}

function getPendingHoldEmployees() {
    const ss = getPayrollDB_();
    const holdMap = {};
    const allNames = new Set();
    const allComps = new Set();
    const colsToExtract = ['cutoff start', 'cutoff end', 'daily rate', 'days (days)', 'regular', 'lates (mins)', 'lates', 'total bsc', 'overtime', 'nd', 'dod', 'dod ot', 'spl hol', 'spl hol ot', 'lgl hol', 'lgl hol ot', 'alw', 'adj', 'total gross pay', 'pagibig', 'pagibig loan', 'sss loan', 'sss', 'philhealth', 'total deduction'];

    // 1. Read hold employees from WRI Masterlist (source of truth for salarystatus)
    const wriEmployees = [];
    try {
        const wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
        const mlSh  = wriSS.getSheetByName(WRI_MASTERLIST_SHEET_NAME);
        if (mlSh && mlSh.getLastRow() > 1) {
            const mlData = mlSh.getDataRange().getValues();
            for (let i = 1; i < mlData.length; i++) {
                const uid    = String(mlData[i][0]  || '').trim();
                const fn     = String(mlData[i][1]  || '').trim();
                const mn     = String(mlData[i][2]  || '').trim();
                const ln     = String(mlData[i][3]  || '').trim();
                const bank   = String(mlData[i][4]  || '').trim();  // accountnumber
                const cn     = String(mlData[i][8]  || '').trim();  // companyname
                const status = String(mlData[i][10] || '').toUpperCase().trim(); // salarystatus
                const fullName = [fn, mn, ln].filter(Boolean).join(' ');

                if (fullName) { allNames.add(fullName); wriEmployees.push({ name: fullName, company: cn }); }
                if (cn) allComps.add(cn);

                if (uid && (status.includes('HOLD') || status.includes('CHECK ACCOUNT') || status.includes('FOR FINAL PAY'))) {
                    holdMap[uid] = { userid: uid, name: fullName, company: cn, holdAmount: 0, bankAccount: bank, details: {} };
                }
            }
        }
    } catch(e) {}

    // 2. Fetch unpaid hold amounts/details from PayrollBookConsolidated, matched by userid
    const consSheet = ss.getSheetByName('PayrollBookConsolidated');
    if (consSheet && Object.keys(holdMap).length > 0) {
        const data = consSheet.getDataRange().getValues();
        if (data.length > 1) {
            const h      = data[0].map(normalizeColName_);
            const uidIdx = h.indexOf('userid');
            const nIdx   = h.indexOf('name');
            const cIdx   = h.indexOf('companyname');
            const sIdx   = h.indexOf('salarystatus');
            const netIdx = h.indexOf('computednetpay');

            for (let i = 1; i < data.length; i++) {
                // Match by userid if column exists, else fall back to name::company scan
                let uid = uidIdx > -1 ? String(data[i][uidIdx] || '').trim() : '';
                if (!uid) {
                    const n = String(data[i][nIdx] || '').trim();
                    const c = String(data[i][cIdx] || '').trim();
                    uid = Object.keys(holdMap).find(k => holdMap[k].name === n && holdMap[k].company === c) || '';
                }
                if (!uid || !holdMap[uid]) continue;

                const rowStatus = String(data[i][sIdx] || '').toUpperCase().trim();
                const net = Number(String(data[i][netIdx] || 0).replace(/[^0-9.-]+/g, '')) || 0;
                if (rowStatus.includes('HOLD') || rowStatus.includes('CHECK ACCOUNT')) {
                    holdMap[uid].holdAmount += net;
                }
                const det = {};
                colsToExtract.forEach(c => {
                    const idx = h.indexOf(normalizeColName_(c));
                    let val = idx > -1 ? data[i][idx] : '';
                    if (val instanceof Date) val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'MM/dd/yyyy');
                    else if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
                    det[c] = val;
                });
                holdMap[uid].details = det;
            }
        }
    }

    return {
        holdEmployees: Object.values(holdMap).sort((a, b) => a.name.localeCompare(b.name)),
        allNames:      Array.from(allNames).sort(),
        allComps:      Array.from(allComps).sort(),
        wriEmployees:  wriEmployees
    };
}

function createFinalPayBook(payload) {
    const { releaseDate, employees } = payload; const ss = getPayrollDB_();
    let fpSheet = ss.getSheetByName('FinalPayBooks'); if (!fpSheet) fpSheet = ss.insertSheet('FinalPayBooks'); const fh = ensureFinalPayBooksHeaders_(fpSheet);
    let fpcSheet = ss.getSheetByName('FinalPayConsolidated'); if (!fpcSheet) fpcSheet = ss.insertSheet('FinalPayConsolidated'); const fch = ensureFinalPayConsolidatedHeaders_(fpcSheet);
    const timestamp = new Date(); const user = Session.getEffectiveUser().getEmail() || 'Unknown'; const fpId = "FP-" + Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "yyyyMMdd-HHmmss"); const relDateObj = new Date(releaseDate);

    // Read 13th month history from 13MDetails in WRI Employee Masterlist
    const m13HistoryMap = {};
    try {
        const wriSS13 = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
        const m13Sh   = wriSS13.getSheetByName(WRI_13M_SHEET);
        if (m13Sh && m13Sh.getLastRow() > 1) {
            const m13Data = m13Sh.getDataRange().getValues();
            const m13H   = m13Data[0].map(normalizeColName_);
            const uidIdx = m13H.indexOf('userid');
            const amtIdx = m13H.indexOf('nthmonthpaybillable');
            const endIdx = m13H.indexOf('cutoffend');       const startIdx = m13H.indexOf('cutoffstart');
            if (uidIdx > -1 && amtIdx > -1 && endIdx > -1) {
                for (let i = 1; i < m13Data.length; i++) {
                    let uid = String(m13Data[i][uidIdx]).trim();
                    if (!uid) continue;
                    let amount = Number(String(m13Data[i][amtIdx] || '').replace(/[^0-9.-]+/g, '')) || 0;
                    if (amount > 0) {
                        let cEnd = m13Data[i][endIdx];
                        let d = (cEnd instanceof Date) ? new Date(cEnd.getTime()) : new Date(cEnd);
                        if (isNaN(d.getTime()) && typeof cEnd === 'number') { d = new Date(Math.round((cEnd - 25569) * 86400 * 1000)); }
                        if (!isNaN(d.getTime())) {
                            if (!m13HistoryMap[uid]) m13HistoryMap[uid] = [];
                            m13HistoryMap[uid].push({ dateObj: d, start: startIdx > -1 ? standardizeDateStr_(m13Data[i][startIdx]) : '', end: standardizeDateStr_(cEnd), amount: amount });
                        }
                    }
                }
            }
        }
    } catch(e) { Logger.log('13MDetails read error (createFP): ' + e.message); }

    const m13BreakdownAll = [];
    const lines = employees.map(emp => {
        let m13Sum = 0; let isWs = String(emp.company).toLowerCase().includes('workscale');
        const startYear = isWs ? relDateObj.getFullYear() : relDateObj.getFullYear() - 1; const startMonth = isWs ? 0 : 11; const limitDate = new Date(startYear, startMonth, 1);
        let hist = m13HistoryMap[String(emp.userid || '').trim()] || [];
        hist.forEach(record => {
            if (record.dateObj >= limitDate) { m13Sum += record.amount; m13BreakdownAll.push({ name: emp.name, company: emp.company, start: record.start, end: record.end, amount: record.amount }); }
        });
        
        let gross = Number(emp.holdAmount || 0) + m13Sum; let bankAcc = emp.bankAccount || ''; const row = new Array(fch.length).fill('');
        row[fch.indexOf('FP_ID')] = fpId; row[fch.indexOf('Name')] = emp.name; row[fch.indexOf('Company Name')] = emp.company;
        const fpColsToCopy = ['Cutoff Start', 'Cutoff End', 'Daily Rate', 'Days (days)', 'Regular', 'Lates (mins)', 'Lates', 'Total Bsc', 'Overtime', 'ND', 'DOD', 'DOD OT', 'Spl Hol', 'Spl Hol OT', 'Lgl Hol', 'Lgl Hol OT', 'Alw', 'Adj', 'Total Gross Pay', 'Pagibig', 'Pagibig Loan', 'SSS Loan', 'SSS', 'Philhealth', 'Total Deduction'];
        fpColsToCopy.forEach(c => { let val = emp.details ? emp.details[c.toLowerCase()] : ''; row[fch.indexOf(c)] = (val !== undefined && val !== null) ? val : ''; });
        row[fch.indexOf('Hold Salary')] = Number(emp.holdAmount || 0); row[fch.indexOf('13th Month')] = m13Sum; row[fch.indexOf('Gross Final Pay')] = gross; row[fch.indexOf('Deductions')] = 0; row[fch.indexOf('Net Final Pay')] = gross; row[fch.indexOf('Mode of Release')] = 'Payroll Credit'; row[fch.indexOf('Bank Account')] = bankAcc; row[fch.indexOf('LineStatus')] = 'Draft'; return row;
    });
    fpSheet.appendRow([fpId, standardizeDateStr_(releaseDate), 'Draft', lines.length, Utilities.formatDate(timestamp, Session.getScriptTimeZone(), "MM/dd/yyyy HH:mm:ss"), user, JSON.stringify(m13BreakdownAll)]);
    if (lines.length > 0) { fpcSheet.getRange(fpcSheet.getLastRow() + 1, 1, lines.length, fch.length).setValues(lines); }
    // Mark finalpaystatus = 'For Processing' in WRI Masterlist for each included employee
    try {
        const fpSyncUpdates = employees.map(emp => ({ name: emp.name, company: emp.company, userid: String(emp.userid || '').trim(), finalPayStatus: 'For Processing' }));
        syncWriMasterlistByNameCompany_(fpSyncUpdates);
        syncWriMasterlistByUserid_(fpSyncUpdates);
    } catch(e) {}
    syncJournalEntries_(fpId, true);
    return { success: true, fpId: fpId };
}

function updateFinalPayBook(payload) {
    const { fpId, releaseDate, employees } = payload; const ss = getPayrollDB_();
    const fpSheet = ss.getSheetByName('FinalPayBooks'); const fh = ensureFinalPayBooksHeaders_(fpSheet);
    const fpcSheet = ss.getSheetByName('FinalPayConsolidated'); const fch = ensureFinalPayConsolidatedHeaders_(fpcSheet);
    const relDateObj = new Date(releaseDate);

    // Read 13th month history from 13MDetails in WRI Employee Masterlist
    const m13HistoryMap = {};
    try {
        const wriSS13 = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
        const m13Sh   = wriSS13.getSheetByName(WRI_13M_SHEET);
        if (m13Sh && m13Sh.getLastRow() > 1) {
            const m13Data = m13Sh.getDataRange().getValues();
            const m13H   = m13Data[0].map(normalizeColName_);
            const uidIdx = m13H.indexOf('userid');
            const amtIdx = m13H.indexOf('nthmonthpaybillable');
            const endIdx = m13H.indexOf('cutoffend');       const startIdx = m13H.indexOf('cutoffstart');
            if (uidIdx > -1 && amtIdx > -1 && endIdx > -1) {
                for (let i = 1; i < m13Data.length; i++) {
                    let uid = String(m13Data[i][uidIdx]).trim();
                    if (!uid) continue;
                    let amount = Number(String(m13Data[i][amtIdx] || '').replace(/[^0-9.-]+/g, '')) || 0;
                    if (amount > 0) {
                        let cEnd = m13Data[i][endIdx];
                        let d = (cEnd instanceof Date) ? new Date(cEnd.getTime()) : new Date(cEnd);
                        if (isNaN(d.getTime()) && typeof cEnd === 'number') { d = new Date(Math.round((cEnd - 25569) * 86400 * 1000)); }
                        if (!isNaN(d.getTime())) {
                            if (!m13HistoryMap[uid]) m13HistoryMap[uid] = [];
                            m13HistoryMap[uid].push({ dateObj: d, start: startIdx > -1 ? standardizeDateStr_(m13Data[i][startIdx]) : '', end: standardizeDateStr_(cEnd), amount: amount });
                        }
                    }
                }
            }
        }
    } catch(e) { Logger.log('13MDetails read error (updateFP): ' + e.message); }

    const m13BreakdownAll = [];
    const lines = employees.map(emp => {
        let m13Sum = 0; let isWs = String(emp.company).toLowerCase().includes('workscale');
        const startYear = isWs ? relDateObj.getFullYear() : relDateObj.getFullYear() - 1; const startMonth = isWs ? 0 : 11; const limitDate = new Date(startYear, startMonth, 1);
        let hist = m13HistoryMap[String(emp.userid || '').trim()] || [];
        hist.forEach(record => {
            if (record.dateObj >= limitDate) { m13Sum += record.amount; m13BreakdownAll.push({ name: emp.name, company: emp.company, start: record.start, end: record.end, amount: record.amount }); }
        });
        
        let gross = Number(emp.holdAmount || 0) + m13Sum; let bankAcc = emp.bankAccount || ''; const row = new Array(fch.length).fill('');
        row[fch.indexOf('FP_ID')] = fpId; row[fch.indexOf('Name')] = emp.name; row[fch.indexOf('Company Name')] = emp.company;
        const fpColsToCopy = ['Cutoff Start', 'Cutoff End', 'Daily Rate', 'Days (days)', 'Regular', 'Lates (mins)', 'Lates', 'Total Bsc', 'Overtime', 'ND', 'DOD', 'DOD OT', 'Spl Hol', 'Spl Hol OT', 'Lgl Hol', 'Lgl Hol OT', 'Alw', 'Adj', 'Total Gross Pay', 'Pagibig', 'Pagibig Loan', 'SSS Loan', 'SSS', 'Philhealth', 'Total Deduction'];
        fpColsToCopy.forEach(c => { let val = emp.details ? emp.details[c.toLowerCase()] : ''; row[fch.indexOf(c)] = (val !== undefined && val !== null) ? val : ''; });
        row[fch.indexOf('Hold Salary')] = Number(emp.holdAmount || 0); row[fch.indexOf('13th Month')] = m13Sum; row[fch.indexOf('Gross Final Pay')] = gross; row[fch.indexOf('Deductions')] = 0; row[fch.indexOf('Net Final Pay')] = gross; row[fch.indexOf('Mode of Release')] = 'Payroll Credit'; row[fch.indexOf('Bank Account')] = bankAcc; row[fch.indexOf('LineStatus')] = 'Draft'; return row;
    });

    // Collect old employee set before deleting, to revert removed employees
    const oldEmpKeys = new Set();
    const oldEmpList = [];
    const fpcData = fpcSheet.getDataRange().getValues(); const idIdx = fpcData[0].indexOf('FP_ID');
    const fpcNormH = fpcData[0].map(normalizeColName_);
    const fpcNIdx = fpcNormH.indexOf('name'); const fpcCIdx = fpcNormH.indexOf('companyname');
    for (let i = 1; i < fpcData.length; i++) {
        if (String(fpcData[i][idIdx]).trim() !== String(fpId).trim()) continue;
        const n = String(fpcData[i][fpcNIdx] || '').trim();
        const c = String(fpcData[i][fpcCIdx] || '').trim();
        if (n) { oldEmpKeys.add(n + '::' + c); oldEmpList.push({ name: n, company: c }); }
    }
    let startDel = -1; let numDel = 0;
    for (let i = fpcData.length - 1; i >= 1; i--) { if (String(fpcData[i][idIdx]).trim() === String(fpId).trim()) { if (startDel === -1) startDel = i + 1; numDel++; } else if (startDel !== -1) { fpcSheet.deleteRows(startDel - numDel + 1, numDel); startDel = -1; numDel = 0; } }
    if (startDel !== -1) fpcSheet.deleteRows(startDel - numDel + 1, numDel);
    if (lines.length > 0) fpcSheet.getRange(fpcSheet.getLastRow() + 1, 1, lines.length, fch.length).setValues(lines);
    // Revert finalpaystatus for employees removed from the batch
    try {
        const newEmpKeys = new Set(employees.map(e => String(e.name || '').trim() + '::' + String(e.company || '').trim()));
        const removedEmps = oldEmpList.filter(e => !newEmpKeys.has(e.name + '::' + e.company));
        if (removedEmps.length > 0) {
            syncWriMasterlistByNameCompany_(removedEmps.map(e => ({ name: e.name, company: e.company, finalPayStatus: '' })));
        }
    } catch(e) {}

    const fpData = fpSheet.getDataRange().getValues(); const fpIdIdx = fpData[0].indexOf('FP_ID');
    for (let i = 1; i < fpData.length; i++) { if (String(fpData[i][fpIdIdx]).trim() === String(fpId).trim()) { fpSheet.getRange(i+1, fh.indexOf('Release Date')+1).setValue(standardizeDateStr_(releaseDate)); fpSheet.getRange(i+1, fh.indexOf('Headcount')+1).setValue(lines.length); fpSheet.getRange(i+1, fh.indexOf('M13BreakdownJSON')+1).setValue(JSON.stringify(m13BreakdownAll)); break; } }
    // Re-sync finalpaystatus = 'For Processing' for updated employee list
    try {
        const fpSyncUpdates = employees.map(emp => ({ name: emp.name, company: emp.company, userid: String(emp.userid || '').trim(), finalPayStatus: 'For Processing' }));
        syncWriMasterlistByNameCompany_(fpSyncUpdates);
        syncWriMasterlistByUserid_(fpSyncUpdates);
    } catch(e) {}
    syncJournalEntries_(fpId, true);
    return { success: true, fpId: fpId };
}

function deleteFinalPayBook(fpId) {
    const ss = getPayrollDB_();
    // Revert finalpaystatus in WRI Masterlist for all employees in this batch
    try {
        const fpcRevSheet = ss.getSheetByName('FinalPayConsolidated');
        if (fpcRevSheet && fpcRevSheet.getLastRow() > 1) {
            const revData = fpcRevSheet.getDataRange().getValues();
            const revH    = revData[0].map(normalizeColName_);
            const revIdIdx   = revH.indexOf('fp_id');
            const revNIdx    = revH.indexOf('name');
            const revCIdx    = revH.indexOf('companyname');
            const revertUpds = [];
            for (let i = 1; i < revData.length; i++) {
                if (String(revData[i][revIdIdx]).trim() !== String(fpId).trim()) continue;
                const n = String(revData[i][revNIdx] || '').trim();
                const c = String(revData[i][revCIdx] || '').trim();
                if (n) revertUpds.push({ name: n, company: c, finalPayStatus: '' });
            }
            if (revertUpds.length > 0) {
                syncWriMasterlistByNameCompany_(revertUpds);
            }
        }
    } catch(e) {}
    const fpSheet = ss.getSheetByName('FinalPayBooks');
    if (fpSheet) { const data = fpSheet.getDataRange().getValues(); const idIdx = data[0].indexOf('FP_ID'); for (let i = data.length - 1; i >= 1; i--) { if (String(data[i][idIdx]).trim() === String(fpId).trim()) { fpSheet.deleteRow(i + 1); break; } } }
    const fpcSheet = ss.getSheetByName('FinalPayConsolidated');
    if (fpcSheet) { const fpcData = fpcSheet.getDataRange().getValues(); const fpcIdIdx = fpcData[0].indexOf('FP_ID'); let startDel = -1; let numDel = 0; for (let i = fpcData.length - 1; i >= 1; i--) { if (String(fpcData[i][fpcIdIdx]).trim() === String(fpId).trim()) { if (startDel === -1) startDel = i + 1; numDel++; } else if (startDel !== -1) { fpcSheet.deleteRows(startDel - numDel + 1, numDel); startDel = -1; numDel = 0; } } if (startDel !== -1) fpcSheet.deleteRows(startDel - numDel + 1, numDel); }
    deleteCentralJournalLines_(fpId);
    return { success: true };
}

/**
 * Called by the Disbursement system when a FINAL_PAY voucher is set to 'Released'.
 * Writes finalpaystatus = 'Released', salarystatus = 'Inactive', employeestatus = 'Inactive'
 * in the WRI Employee Masterlist for every employee in this Final Pay batch.
 * This is the ONLY place these three fields are written for Final Pay employees —
 * never at approval or send-to-finance time.
 */
function notifyFinalPayDisbursed(fpId) {
  try {
    const ss       = getPayrollDB_();
    const fpcSheet = ss.getSheetByName('FinalPayConsolidated');
    if (!fpcSheet || fpcSheet.getLastRow() < 2) return { success: false, reason: 'No FinalPayConsolidated data' };

    const cData  = fpcSheet.getDataRange().getValues();
    const normH  = cData[0].map(normalizeColName_);
    const fpIdx  = normH.indexOf('fp_id');
    const nIdx   = normH.indexOf('name');
    const cIdx   = normH.indexOf('company name');   // display header
    const cIdx2  = normH.indexOf('companyname');     // normalized fallback
    const uIdx   = normH.indexOf('userid');

    const releasedEmployees = [];
    for (let i = 1; i < cData.length; i++) {
      if (String(cData[i][fpIdx]).trim() !== String(fpId).trim()) continue;
      const name    = String(cData[i][nIdx]  || '').trim();
      const company = String(cData[i][cIdx > -1 ? cIdx : cIdx2] || '').trim();
      const uid     = uIdx > -1 ? String(cData[i][uIdx] || '').trim() : '';
      if (name) releasedEmployees.push({ name: name, company: company, userid: uid, status: 'Final Pay Released' });
    }

    if (releasedEmployees.length > 0) {
      // syncOverlayToEmployeeMaster_ detects 'Final Pay Released' and writes:
      //   finalpaystatus = 'Released', salarystatus = 'Inactive', employeestatus = 'Inactive'
      syncOverlayToEmployeeMaster_(releasedEmployees);
    }

    Logger.log('notifyFinalPayDisbursed: updated ' + releasedEmployees.length + ' employees for ' + fpId);
    return { success: true, count: releasedEmployees.length };
  } catch(e) {
    Logger.log('notifyFinalPayDisbursed error: ' + e.message);
    return { success: false, reason: e.message };
  }
}

function getFinalPayBooks() {
  const ss = getPayrollDB_(); const sheet = ss.getSheetByName('FinalPayBooks'); if (!sheet) return [];
  const data = sheet.getDataRange().getDisplayValues(); if (data.length < 2) return []; const headers = data[0]; const result = [];
  for (let i = 1; i < data.length; i++) { const obj = {}; headers.forEach((h, idx) => { obj[h] = data[i][idx]; }); result.push(obj); } return result.reverse(); 
}

function getFinalPayDetails(fpId) {
  const ss = getPayrollDB_(); const fpSheet = ss.getSheetByName('FinalPayBooks'); if (!fpSheet) throw new Error("FinalPayBooks sheet not found");
  const fpData = fpSheet.getDataRange().getDisplayValues(); const fpHeaders = fpData[0]; let book = null;
  for (let i = 1; i < fpData.length; i++) { if (String(fpData[i][fpHeaders.indexOf('FP_ID')]).trim() === String(fpId).trim()) { book = {}; fpHeaders.forEach((h, idx) => book[h] = fpData[i][idx]); break; } }
  if (!book) throw new Error("Final Pay Book not found");
  const lines = []; const consSheet = ss.getSheetByName('FinalPayConsolidated');
  if (consSheet) { const consData = consSheet.getDataRange().getDisplayValues(); if (consData.length > 1) { const consHeaders = consData[0]; const pIdIdx = consHeaders.indexOf('FP_ID'); for(let i = 1; i < consData.length; i++) { if (String(consData[i][pIdIdx]).trim() === String(fpId).trim()) { const obj = {}; consHeaders.forEach((h, idx) => { if (h !== 'FP_ID' && h !== 'LineStatus') { obj[h] = consData[i][idx]; } }); lines.push(obj); } } } }
  let breakdown = []; try { breakdown = JSON.parse(book.M13BreakdownJSON || "[]"); } catch(e) {}
  // Look up voucher status from Disbursement DB so UI can show/hide Route Voucher button
  // Guard: if the stored value is an email it's corrupted data from a past column-misalignment bug — treat as empty.
  // Fallback: VoucherId in Disbursement DB equals fpId, so use fpId when status is Vouchered.
  let fpLinkedVid = (String(book['LinkedVoucherId'] || '').includes('@')) ? '' : String(book['LinkedVoucherId'] || '').trim();
  if (!fpLinkedVid && String(book['Status'] || '').toLowerCase() === 'vouchered') fpLinkedVid = String(fpId).trim();
  book['LinkedVoucherId'] = fpLinkedVid;
  let fpVoucherStatus = '';
  if (fpLinkedVid) {
    try {
      const disbSS = SpreadsheetApp.openById(DISBURSEMENT_DB_ID);
      const vSheet = disbSS.getSheetByName('Vouchers');
      if (vSheet) {
        const vData = vSheet.getDataRange().getValues();
        const vHdr  = vData[0];
        const vidI  = vHdr.indexOf('VoucherId');
        const stI   = vHdr.indexOf('Status');
        for (let i = 1; i < vData.length; i++) {
          if (String(vData[i][vidI]).trim() === String(fpLinkedVid).trim()) {
            fpVoucherStatus = String(vData[i][stI]).trim(); break;
          }
        }
      }
    } catch(e) { Logger.log('getFinalPayDetails voucher status: ' + e.message); }
  }
  book['VoucherStatus'] = fpVoucherStatus;
  return { book: book, lines: lines, breakdown: breakdown };
}

function saveFinalPayLines(payload) {
  const { fpId, lines } = payload; const ss = getPayrollDB_(); const consSheet = ss.getSheetByName('FinalPayConsolidated'); if (!consSheet) throw new Error("FinalPayConsolidated sheet not found");
  ensureFinalPayConsolidatedHeaders_(consSheet); // ensure Benefits JSON column exists
  const data = consSheet.getDataRange().getValues(); const headers = data[0]; const idIdx = headers.indexOf('FP_ID'); const holdIdx = headers.indexOf('Hold Salary'); const m13Idx = headers.indexOf('13th Month'); const grossIdx = headers.indexOf('Gross Final Pay'); const dedIdx = headers.indexOf('Deductions'); const netIdx = headers.indexOf('Net Final Pay'); const modeIdx = headers.indexOf('Mode of Release'); const bankIdx = headers.indexOf('Bank Account'); const benJsonIdx = headers.indexOf('Benefits JSON');
  let linePtr = 0;
  for (let i = 1; i < data.length; i++) {
      if (String(data[i][idIdx]).trim() === String(fpId).trim() && linePtr < lines.length) {
          const clientLine = lines[linePtr];
          const hold = Number(data[i][holdIdx]) || 0;
          const m13 = Number(data[i][m13Idx]) || 0;
          let benefitsTotal = 0; let benefitsJSON = '[]';
          if (clientLine['Benefits JSON']) { try { const items = JSON.parse(clientLine['Benefits JSON']); benefitsTotal = items.reduce(function(s,b){return s+(Number(b.amount)||0);},0); benefitsJSON = JSON.stringify(items); } catch(e) {} }
          const gross = hold + m13; // Benefits are NOT included in Gross Final Pay
          const ded = Number(clientLine['Deductions'] || 0); const net = gross + benefitsTotal - ded; // Benefits added to reach Net
          if (grossIdx >= 0) consSheet.getRange(i + 1, grossIdx + 1).setValue(gross);
          consSheet.getRange(i + 1, dedIdx + 1).setValue(ded); consSheet.getRange(i + 1, netIdx + 1).setValue(net); consSheet.getRange(i + 1, modeIdx + 1).setValue(clientLine['Mode of Release'] || 'Payroll Credit'); consSheet.getRange(i + 1, bankIdx + 1).setValue(clientLine['Bank Account'] || '');
          if (benJsonIdx >= 0) consSheet.getRange(i + 1, benJsonIdx + 1).setValue(benefitsJSON);
          linePtr++;
      }
  }
  syncJournalEntries_(fpId, true);
  return { success: true };
}

// =====================================================================
// FINAL PAY WORKFLOW FUNCTIONS
// =====================================================================

function submitFinalPayBook(fpId) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  if (!callerRoles.includes('Maker') && !callerRoles.includes('Admin'))
    throw new Error('Only Makers can submit a Final Pay Book for review.');
  const ss = getPayrollDB_();
  const fpSheet = ss.getSheetByName('FinalPayBooks');
  const h = ensureFinalPayBooksHeaders_(fpSheet);
  const data = fpSheet.getDataRange().getValues();
  let rIdx = -1;
  for (let i = 1; i < data.length; i++) { if (String(data[i][h.indexOf('FP_ID')]).trim() === String(fpId).trim()) { rIdx = i + 1; break; } }
  if (rIdx === -1) throw new Error('Final Pay Book not found.');
  if (String(data[rIdx - 1][h.indexOf('Status')]).trim() !== 'Draft') throw new Error('Only Draft books can be submitted for review.');
  // If submitter is also a Reviewer, skip to Admin-only approval to prevent self-review
  const approverType = callerRoles.includes('Reviewer') ? 'Admin' : 'Reviewer';
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
  fpSheet.getRange(rIdx, h.indexOf('Status') + 1).setValue('For Review');
  fpSheet.getRange(rIdx, h.indexOf('SubmittedBy') + 1).setValue(user);
  fpSheet.getRange(rIdx, h.indexOf('SubmittedAt') + 1).setValue(ts);
  fpSheet.getRange(rIdx, h.indexOf('ApproverType') + 1).setValue(approverType);
  fpSheet.getRange(rIdx, h.indexOf('ReviewedBy') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('ReviewedAt') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('ReviewNote') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('FinalApprovedBy') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('FinalApprovedAt') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('FinalApproveNote') + 1).setValue('');
  try { sendWorkflowNotification_('[Final Pay] ' + fpId + ' submitted for review', 'A Final Pay Batch (' + fpId + ') has been submitted and is now awaiting review.\nSubmitted by: ' + user, approverType === 'Admin' ? ['Admin'] : ['Reviewer', 'Admin']); } catch(e) {}
  return { success: true, approverType: approverType };
}

function reviewApproveFinalPayBook(fpId, note) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  const ss = getPayrollDB_();
  const fpSheet = ss.getSheetByName('FinalPayBooks');
  const h = ensureFinalPayBooksHeaders_(fpSheet);
  const data = fpSheet.getDataRange().getValues();
  let rIdx = -1, row = null;
  for (let i = 1; i < data.length; i++) { if (String(data[i][h.indexOf('FP_ID')]).trim() === String(fpId).trim()) { rIdx = i + 1; row = data[i]; break; } }
  if (rIdx === -1) throw new Error('Final Pay Book not found.');
  if (String(row[h.indexOf('Status')]).trim() !== 'For Review') throw new Error('This book is not in "For Review" status.');
  const approverType = String(row[h.indexOf('ApproverType')]).trim();
  if (approverType === 'Admin' && !callerRoles.includes('Admin'))
    throw new Error('This book requires an Admin to approve the review (submitter has Reviewer role).');
  if (approverType !== 'Admin' && !callerRoles.includes('Reviewer') && !callerRoles.includes('Admin'))
    throw new Error('Only Reviewers or Admins can approve this review.');
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
  fpSheet.getRange(rIdx, h.indexOf('Status') + 1).setValue('For Final Approval');
  fpSheet.getRange(rIdx, h.indexOf('ReviewedBy') + 1).setValue(user);
  fpSheet.getRange(rIdx, h.indexOf('ReviewedAt') + 1).setValue(ts);
  fpSheet.getRange(rIdx, h.indexOf('ReviewNote') + 1).setValue(note || '');
  try { sendWorkflowNotification_('[Final Pay] ' + fpId + ' ready for final approval', 'A Final Pay Batch (' + fpId + ') has passed review and is now awaiting final approval.\nReviewed by: ' + user, ['Approver', 'Admin']); } catch(e) {}
  return { success: true };
}

function finalApproveFinalPayBook(fpId, note) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  if (!callerRoles.includes('Approver') && !callerRoles.includes('Admin'))
    throw new Error('Only Approvers or Admins can give final approval.');
  const ss = getPayrollDB_();
  const fpSheet = ss.getSheetByName('FinalPayBooks');
  const h = ensureFinalPayBooksHeaders_(fpSheet);
  const data = fpSheet.getDataRange().getValues();
  let rIdx = -1;
  for (let i = 1; i < data.length; i++) { if (String(data[i][h.indexOf('FP_ID')]).trim() === String(fpId).trim()) { rIdx = i + 1; break; } }
  if (rIdx === -1) throw new Error('Final Pay Book not found.');
  if (String(data[rIdx - 1][h.indexOf('Status')]).trim() !== 'For Final Approval')
    throw new Error('This book is not in "For Final Approval" status.');
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
  fpSheet.getRange(rIdx, h.indexOf('Status') + 1).setValue('Approved');
  fpSheet.getRange(rIdx, h.indexOf('FinalApprovedBy') + 1).setValue(user);
  fpSheet.getRange(rIdx, h.indexOf('FinalApprovedAt') + 1).setValue(ts);
  fpSheet.getRange(rIdx, h.indexOf('FinalApproveNote') + 1).setValue(note || '');
  try { postFPScheduledDeductions_(fpId); } catch(e) { Logger.log('postFPScheduledDeductions_ error: ' + e.message); }
  return { success: true };
}

function returnFinalPayBookToDraft(fpId, reason) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  const ss = getPayrollDB_();
  const fpSheet = ss.getSheetByName('FinalPayBooks');
  const h = ensureFinalPayBooksHeaders_(fpSheet);
  const data = fpSheet.getDataRange().getValues();
  let rIdx = -1, row = null;
  for (let i = 1; i < data.length; i++) { if (String(data[i][h.indexOf('FP_ID')]).trim() === String(fpId).trim()) { rIdx = i + 1; row = data[i]; break; } }
  if (rIdx === -1) throw new Error('Final Pay Book not found.');
  const currentStatus = String(row[h.indexOf('Status')]).trim();
  const approverType = String(row[h.indexOf('ApproverType')]).trim();
  if (currentStatus === 'For Review') {
    if (approverType === 'Admin' && !callerRoles.includes('Admin'))
      throw new Error('Only an Admin can return this book to Draft.');
    if (approverType !== 'Admin' && !callerRoles.includes('Reviewer') && !callerRoles.includes('Admin'))
      throw new Error('Only Reviewers or Admins can return this book to Draft.');
  } else if (currentStatus === 'For Final Approval') {
    if (!callerRoles.includes('Approver') && !callerRoles.includes('Admin'))
      throw new Error('Only Approvers or Admins can return this book to Draft.');
  } else {
    throw new Error('Only books in "For Review" or "For Final Approval" can be returned to Draft.');
  }
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
  fpSheet.getRange(rIdx, h.indexOf('Status') + 1).setValue('Draft');
  fpSheet.getRange(rIdx, h.indexOf('ReturnedBy') + 1).setValue(user);
  fpSheet.getRange(rIdx, h.indexOf('ReturnedAt') + 1).setValue(ts);
  fpSheet.getRange(rIdx, h.indexOf('ReturnNote') + 1).setValue(reason || '');
  fpSheet.getRange(rIdx, h.indexOf('SubmittedBy') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('SubmittedAt') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('ReviewedBy') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('ReviewedAt') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('ReviewNote') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('FinalApprovedBy') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('FinalApprovedAt') + 1).setValue('');
  fpSheet.getRange(rIdx, h.indexOf('FinalApproveNote') + 1).setValue('');
  return { success: true };
}

function sendFinalPayToFinance(fpId) {
  const user = Session.getEffectiveUser().getEmail();
  const callerRoles = getUserRoles_(user);
  if (!callerRoles.includes('Maker') && !callerRoles.includes('Admin'))
    throw new Error('Only Makers can send a Final Pay Book to Finance.');
  const ss = getPayrollDB_(); const fpSheet = ss.getSheetByName('FinalPayBooks'); const fpData = fpSheet.getDataRange().getValues(); const h = ensureFinalPayBooksHeaders_(fpSheet);
  let rIdx = -1;
  for (let i = 1; i < fpData.length; i++) { if (String(fpData[i][h.indexOf('FP_ID')]).trim() === String(fpId).trim()) { rIdx = i + 1; break; } }
  if (rIdx === -1) throw new Error('Final Pay Book not found.');
  if (String(fpData[rIdx - 1][h.indexOf('Status')]).trim() !== 'Approved') throw new Error('Only Approved books can be sent to Finance.');
  const releaseDate = String(fpData[rIdx - 1][h.indexOf('Release Date')] || '').trim();
  fpSheet.getRange(rIdx, h.indexOf('Status') + 1).setValue('Processing');
  const consSheet = ss.getSheetByName('FinalPayConsolidated');
  if (consSheet) {
    const cData = consSheet.getDataRange().getValues();
    const cpIdx = cData[0].indexOf('FP_ID');
    const clStatusIdx = cData[0].indexOf('LineStatus');
    for (let i = 1; i < cData.length; i++) {
      if (String(cData[i][cpIdx]).trim() === String(fpId).trim()) {
        consSheet.getRange(i + 1, clStatusIdx + 1).setValue('Processing');
      }
    }
  }
  // NOTE: finalpaystatus/'Released' and salarystatus/'Inactive' are written only when
  // the linked Final Pay Voucher is explicitly set to 'Released' in the Disbursement system.
  syncJournalEntries_(fpId, true);
  const fpReviewedBy = String(fpData[rIdx - 1][h.indexOf('ReviewedBy')]      || '').trim();
  const fpApprovedBy = String(fpData[rIdx - 1][h.indexOf('FinalApprovedBy')] || '').trim();
  const linkedVid = createFinalPayVoucherInDisbApp_(fpId, releaseDate, fpReviewedBy, fpApprovedBy);
  if (linkedVid) {
    const linkedIdx = h.indexOf('LinkedVoucherId');
    if (linkedIdx > -1) fpSheet.getRange(rIdx, linkedIdx + 1).setValue(linkedVid);
  }
  return { success: true, linkedVoucherId: linkedVid };
}

function approveFinalPayBook(fpId) {
  const ss = getPayrollDB_(); const fpSheet = ss.getSheetByName('FinalPayBooks'); const fpData = fpSheet.getDataRange().getValues(); const h = fpData[0];
  for (let i = 1; i < fpData.length; i++) { if (String(fpData[i][h.indexOf('FP_ID')]).trim() === String(fpId).trim()) { fpSheet.getRange(i + 1, h.indexOf('Status') + 1).setValue('Processing'); break; } }
    const consSheetAp = ss.getSheetByName('FinalPayConsolidated');
    if (consSheetAp) {
        const cData = consSheetAp.getDataRange().getValues();
        const cpIdx = cData[0].indexOf('FP_ID');
        const clStatusIdx = cData[0].indexOf('LineStatus');
        for (let i = 1; i < cData.length; i++) {
            if (String(cData[i][cpIdx]).trim() === String(fpId).trim()) {
                consSheetAp.getRange(i + 1, clStatusIdx + 1).setValue('Processing');
            }
        }
    }
    // NOTE: finalpaystatus/'Released' and salarystatus/'Inactive' are written only when
    // the linked Final Pay Voucher is explicitly set to 'Released' in the Disbursement system.
    syncJournalEntries_(fpId, true);
    return { success: true };
  }

  // =====================================================================
// 9. AUTOMATED JOURNAL ENTRIES LOGIC (COST CENTER ENABLED)
// =====================================================================

function syncJournalEntries_(batchId, isFinalPay) {
    const ss = getPayrollDB_();
    const sheetName = isFinalPay ? 'FinalPayConsolidated' : 'PayrollBookConsolidated';
    const consSheet = ss.getSheetByName(sheetName);
    if (!consSheet) return;

    const data = consSheet.getDataRange().getValues();
    const headers = data[0].map(normalizeColName_);
    const idIdx = isFinalPay ? headers.indexOf('fpid') : headers.indexOf('payrollid');
    
    const lines = [];
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][idIdx]).trim() === String(batchId).trim()) {
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = data[i][idx]; });
            lines.push(obj);
        }
    }
    
    const mappings = getAccountsAndContacts();
    const accountsData = mappings.accounts;
    const contactsData = mappings.contacts;
    
    const getAcc = (name) => {
        const m = accountsData.find(a => String(a['Account Name'] || a['AccountName'] || '').trim().toLowerCase() === String(name).trim().toLowerCase());
        return m ? (m['Account Code'] || m['AccountCode'] || '') : '';
    };

    const getCC = (comp) => {
        const m = contactsData.find(c => c.name.toLowerCase() === String(comp).trim().toLowerCase());
        return m && m.costCenter ? m.costCenter : comp;
    };

    const jLines = [];
    let lineNo = 1;
    const now = new Date();
    const jeId = "JE-" + batchId;

    const createdBy = (() => { try { return Session.getEffectiveUser().getEmail() || 'system'; } catch(e) { return 'system'; } })();
    const addRow = (accName, dr, cr, contact, classCode) => {
        if (dr === 0 && cr === 0) return;
        const code = getAcc(accName);
        // 16 columns: DocumentID, journal_entry_id, line_number, account_code, account_name, description,
        //             contact_name, class, debit, credit, created_at, created_by, updated_by, updated_at, posted_by, posted_at
        jLines.push([batchId, jeId, lineNo++, code, accName, isFinalPay ? 'Final Pay Accrual' : 'Payroll Accrual', contact || '', classCode || '', dr || '', cr || '', now, createdBy, createdBy, now, '', '']);
    };

    if (!isFinalPay) {
        // ── Load EmployeeIncomeLedger rows for this batch ─────────────────────
        var eilForJE = {};  // company_name → component totals
        try {
            var wriSSJE = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
            var eilShJE = wriSSJE.getSheetByName(EIL_SHEET);
            if (eilShJE && eilShJE.getLastRow() > 1) {
                var eilRaw = eilShJE.getDataRange().getValues();
                var eilHJE = eilRaw[0].map(function(h) { return String(h).toLowerCase().trim(); });
                var ej = function(n) { return eilHJE.indexOf(n); };
                var ejBatch   = ej('batch_id');     var ejCn    = ej('company_name');
                var ejReg     = ej('regular_amount'); var ejOt   = ej('overtime_amount');
                var ejNd      = ej('nd_amount');    var ejDod   = ej('dod_amount');
                var ejDotA    = ej('dod_ot_amount');
                var ejSplS    = ej('spl_hol_amount');  var ejSplOS  = ej('spl_hol_ot_amount');
                var ejSplDS   = ej('spl_hol_dof_amount'); var ejSplDOS = ej('spl_hol_dof_ot_amount');
                var ejLglS    = ej('lgl_hol_amount');  var ejLglOS  = ej('lgl_hol_ot_amount');
                var ejLglDS   = ej('lgl_hol_dof_amount'); var ejLglDOS = ej('lgl_hol_dof_ot_amount');
                var ejTrOt    = ej('training_ot_amount'); var ejTrLt = ej('training_lates_amount');
                var ejInc     = ej('incentives');   var ejAlw   = ej('allowance');
                var ejAdj     = ej('adjustment');   var ejNth   = ej('nth_month_pay');
                var ejDRice   = ej('demin_rice_subsidy'); var ejDClot = ej('demin_clothing');
                var ejDMed    = ej('demin_medical_cash');  var ejDLaun = ej('demin_laundry');
                var ejDMeal   = ej('demin_daily_meal');    var ejDTrns = ej('demin_transport');
                var ejDMl     = ej('demin_meal');          var ejDHous = ej('demin_housing');
                var ejDOth    = ej('demin_other');
                var ejSssEE   = ej('sss_ee');   var ejSssLn = ej('sss_loan');
                var ejPhic    = ej('phic_ee');  var ejHdmf  = ej('hdmf_ee');
                var ejHdmfLn  = ej('hdmf_loan'); var ejTax  = ej('withholding_tax');
                var ejTotDed  = ej('total_ee_deduction');
                var ejSssER   = ej('sss_er');   var ejPhicER = ej('phic_er');
                var ejHdmfER  = ej('hdmf_er');
                var nv2 = function(v) { var n = Number(String(v || '').replace(/[^0-9.-]/g,'')); return isNaN(n) ? 0 : n; };
                var newCo = function() { return { reg:0, ot:0, nd:0, dod:0, dotA:0, splS:0, splOS:0, splDS:0, splDOS:0, lglS:0, lglOS:0, lglDS:0, lglDOS:0, trOt:0, trLt:0, inc:0, alw:0, adj:0, nth:0, dRice:0, dClot:0, dMed:0, dLaun:0, dMeal:0, dTrns:0, dMl:0, dHous:0, dOth:0, sssEE:0, sssLoan:0, phicEE:0, hdmfEE:0, hdmfLoan:0, tax:0, totDed:0, sssER:0, phicER:0, hdmfER:0 }; };
                for (var ri = 1; ri < eilRaw.length; ri++) {
                    var er = eilRaw[ri];
                    if (ejBatch > -1 && String(er[ejBatch] || '').trim() !== String(batchId).trim()) continue;
                    var ejCoName = ejCn > -1 ? String(er[ejCn] || '').trim() : 'Unknown';
                    if (!eilForJE[ejCoName]) eilForJE[ejCoName] = newCo();
                    var c = eilForJE[ejCoName];
                    c.reg    += nv2(ejReg    > -1 ? er[ejReg]    : 0); c.ot     += nv2(ejOt     > -1 ? er[ejOt]     : 0);
                    c.nd     += nv2(ejNd     > -1 ? er[ejNd]     : 0); c.dod    += nv2(ejDod    > -1 ? er[ejDod]    : 0);
                    c.dotA   += nv2(ejDotA   > -1 ? er[ejDotA]   : 0); c.splS   += nv2(ejSplS   > -1 ? er[ejSplS]   : 0);
                    c.splOS  += nv2(ejSplOS  > -1 ? er[ejSplOS]  : 0); c.splDS  += nv2(ejSplDS  > -1 ? er[ejSplDS]  : 0);
                    c.splDOS += nv2(ejSplDOS > -1 ? er[ejSplDOS] : 0); c.lglS   += nv2(ejLglS   > -1 ? er[ejLglS]   : 0);
                    c.lglOS  += nv2(ejLglOS  > -1 ? er[ejLglOS]  : 0); c.lglDS  += nv2(ejLglDS  > -1 ? er[ejLglDS]  : 0);
                    c.lglDOS += nv2(ejLglDOS > -1 ? er[ejLglDOS] : 0); c.trOt   += nv2(ejTrOt   > -1 ? er[ejTrOt]   : 0);
                    c.trLt   += nv2(ejTrLt   > -1 ? er[ejTrLt]   : 0); c.inc    += nv2(ejInc    > -1 ? er[ejInc]    : 0);
                    c.alw    += nv2(ejAlw    > -1 ? er[ejAlw]    : 0); c.adj    += nv2(ejAdj    > -1 ? er[ejAdj]    : 0);
                    c.nth    += nv2(ejNth    > -1 ? er[ejNth]    : 0); c.dRice  += nv2(ejDRice  > -1 ? er[ejDRice]  : 0);
                    c.dClot  += nv2(ejDClot  > -1 ? er[ejDClot]  : 0); c.dMed   += nv2(ejDMed   > -1 ? er[ejDMed]   : 0);
                    c.dLaun  += nv2(ejDLaun  > -1 ? er[ejDLaun]  : 0); c.dMeal  += nv2(ejDMeal  > -1 ? er[ejDMeal]  : 0);
                    c.dTrns  += nv2(ejDTrns  > -1 ? er[ejDTrns]  : 0); c.dMl    += nv2(ejDMl    > -1 ? er[ejDMl]    : 0);
                    c.dHous  += nv2(ejDHous  > -1 ? er[ejDHous]  : 0); c.dOth   += nv2(ejDOth   > -1 ? er[ejDOth]   : 0);
                    c.sssEE  += nv2(ejSssEE  > -1 ? er[ejSssEE]  : 0); c.sssLoan+= nv2(ejSssLn  > -1 ? er[ejSssLn]  : 0);
                    c.phicEE += nv2(ejPhic   > -1 ? er[ejPhic]   : 0); c.hdmfEE += nv2(ejHdmf   > -1 ? er[ejHdmf]   : 0);
                    c.hdmfLoan += nv2(ejHdmfLn > -1 ? er[ejHdmfLn] : 0); c.tax  += nv2(ejTax    > -1 ? er[ejTax]    : 0);
                    c.totDed += nv2(ejTotDed > -1 ? er[ejTotDed] : 0); c.sssER  += nv2(ejSssER  > -1 ? er[ejSssER]  : 0);
                    c.phicER += nv2(ejPhicER > -1 ? er[ejPhicER] : 0); c.hdmfER += nv2(ejHdmfER > -1 ? er[ejHdmfER] : 0);
                }
            }
        } catch(eilErr) {
            Logger.log('syncJournalEntries_: EIL read failed for batch ' + batchId + ' — falling back to PayrollBookConsolidated. ' + eilErr);
        }
        var useEil = Object.keys(eilForJE).length > 0;

        // ── Bank fees and net pay payable (status-based, from PayrollBookConsolidated) ──
        let totalBankFees = 0, salariesPayableAccrued = 0, adminFee = 0, totalBillable = 0;
        lines.forEach(l => {
            let status  = String(l['salarystatus'] || '').toUpperCase().trim();
            let isBpi   = status === 'FOR RELEASE' || status.includes('-BPI');
            let isHold  = status.includes('HOLD') || status.includes('CHECK ACCOUNT');
            let isCheck = isCheckPayment_(status);
            let rawGross  = Number(String(l['totalgrosspay'] || l['grosspay'] || 0).replace(/[^0-9.-]+/g, '')) || 0;
            let rawTotDed = Number(String(l['totaleededuction'] || l['totaldeduction'] || 0).replace(/[^0-9.-]+/g, '')) || 0;
            // Derive net from gross − deductions for JE balance integrity
            let derivedNet = rawGross - rawTotDed;
            let fee = (!isBpi && !isCheck && !isHold && status !== '') ? 50 : 0;
            totalBankFees += fee;
            salariesPayableAccrued += (derivedNet - fee);
            adminFee   += Number(String(l['adminfee']     || 0).replace(/[^0-9.-]+/g, '')) || 0;
            totalBillable += Number(String(l['totalbillable'] || 0).replace(/[^0-9.-]+/g, '')) || 0;
        });

        // ── DR lines ─────────────────────────────────────────────────────────
        if (useEil) {
            Object.entries(eilForJE).forEach(function([comp, v]) {
                var isInt = comp.toLowerCase().includes('workscale');
                var contact = isInt ? 'Workscale' : comp;
                var cc = getCC(comp);
                var holAmt   = v.splS + v.splOS + v.splDS + v.splDOS + v.lglS + v.lglOS + v.lglDS + v.lglDOS + v.trOt + v.trLt;
                var deminAmt = v.dRice + v.dClot + v.dMed + v.dLaun + v.dMeal + v.dTrns + v.dMl + v.dHous + v.dOth;
                addRow(isInt ? 'Salaries and Wages'                : 'Salaries and Wages Deployed',         v.reg,    0, contact, cc);
                addRow(isInt ? 'Overtime Pay Expense'              : 'Overtime Pay Expense Deployed',        v.ot,     0, contact, cc);
                addRow(isInt ? 'Night Differential Expense'        : 'Night Differential Expense Deployed',  v.nd + v.dod + v.dotA, 0, contact, cc);
                addRow(isInt ? 'Holiday Pay Expense'               : 'Holiday Pay Expense Deployed',         holAmt,   0, contact, cc);
                addRow(isInt ? 'Personnel Allowance'               : 'Employee Allowances Deployed',         v.alw,    0, contact, cc);
                addRow(isInt ? 'Incentives Expense'                : 'Employee Incentives Deployed',         v.inc,    0, contact, cc);
                addRow(isInt ? 'De Minimis Benefits Expense'       : 'De Minimis Benefits Expense Deployed', deminAmt, 0, contact, cc);
                addRow(isInt ? 'Payroll Adjustment Expense'        : 'Payroll Adjustment Expense Deployed',  v.adj,    0, contact, cc);
                addRow(isInt ? '13th Month Pay'                    : 'Accrued 13th Month Pay Deployed',      v.nth,    0, contact, cc);
                addRow(isInt ? 'SSS Premium ER Share'              : 'SSS ER Share Deployed',                v.sssER,  0, contact, cc);
                addRow(isInt ? 'HDMF Premium ER Share'             : 'HDMF ER Share Deployed',               v.hdmfER, 0, contact, cc);
                addRow(isInt ? 'PHIC Premium ER Share'             : 'PHIC ER Share Deployed',               v.phicER, 0, contact, cc);
            });
        } else {
            // Legacy fallback: aggregate from PayrollBookConsolidated (less accurate, retained for backward compatibility)
            let expDeployed = {};
            let grossInternal = 0, alwInternal = 0, m13Internal = 0;
            let sssER_internal = 0, hdmfER_internal = 0, phicER_internal = 0;
            lines.forEach(l => {
                let comp = String(l['companyname'] || 'Unknown').trim();
                let isInternal = comp.toLowerCase().includes('workscale');
                let gross = Number(String(l['totalgrosspay'] || l['grosspay'] || 0).replace(/[^0-9.-]+/g, '')) || 0;
                let alw   = Number(String(l['alw'] || 0).replace(/[^0-9.-]+/g, '')) || 0;
                let m13   = Number(String(l['13thmonth'] || 0).replace(/[^0-9.-]+/g, '')) || 0;
                let sER = Number(String(l['ssser']  || 0).replace(/[^0-9.-]+/g, '')) || 0;
                let pER = Number(String(l['phicer'] || 0).replace(/[^0-9.-]+/g, '')) || 0;
                let hER = Number(String(l['hdmfer'] || 0).replace(/[^0-9.-]+/g, '')) || 0;
                if (isInternal) {
                    grossInternal += gross; alwInternal += alw; m13Internal += m13;
                    sssER_internal += sER; phicER_internal += pER; hdmfER_internal += hER;
                } else {
                    if (!expDeployed[comp]) expDeployed[comp] = { gross:0, alw:0, m13:0, sssER:0, hdmfER:0, phicER:0 };
                    expDeployed[comp].gross += gross; expDeployed[comp].alw += alw; expDeployed[comp].m13 += m13;
                    expDeployed[comp].sssER += sER; expDeployed[comp].phicER += pER; expDeployed[comp].hdmfER += hER;
                }
            });
            addRow('Salaries and Wages',  grossInternal, 0, 'Workscale', '');
            addRow('Personnel Allowance', alwInternal,   0, 'Workscale', '');
            addRow('13th Month Pay',      m13Internal,   0, 'Workscale', '');
            addRow('SSS Premium ER Share',  sssER_internal, 0, 'Workscale', '');
            addRow('HDMF Premium ER Share', hdmfER_internal, 0, 'Workscale', '');
            addRow('PHIC Premium ER Share', phicER_internal, 0, 'Workscale', '');
            for (let [comp, v] of Object.entries(expDeployed)) {
                let cc = getCC(comp);
                addRow('Salaries and Wages Deployed',       v.gross, 0, comp, cc);
                addRow('Employee Allowances Deployed',      v.alw,   0, comp, cc);
                addRow('Accrued 13th Month Pay Deployed',   v.m13,   0, comp, cc);
                addRow('SSS ER Share Deployed',   v.sssER,  0, comp, cc);
                addRow('HDMF ER Share Deployed',  v.hdmfER, 0, comp, cc);
                addRow('PHIC ER Share Deployed',  v.phicER, 0, comp, cc);
            }
        }

        // ── CR lines ─────────────────────────────────────────────────────────
        var allBatch = Object.values(eilForJE).reduce(function(acc, v) {
            Object.keys(v).forEach(function(k) { acc[k] = (acc[k] || 0) + v[k]; }); return acc;
        }, {});
        var getEilOrFallback = function(eilKey, fallbackFn) {
            if (useEil) return allBatch[eilKey] || 0;
            var tot = 0; lines.forEach(function(l) { tot += Number(String(l[fallbackFn] || 0).replace(/[^0-9.-]+/g, '')) || 0; }); return tot;
        };
        var cr_tax     = getEilOrFallback('tax',     'tax');
        var cr_sssEE   = getEilOrFallback('sssEE',   'sss');
        var cr_sssER   = getEilOrFallback('sssER',   'ssser');
        var cr_sssLoan = getEilOrFallback('sssLoan', 'sssloan');
        var cr_hdmfEE  = getEilOrFallback('hdmfEE',  'pagibig');
        var cr_hdmfER  = getEilOrFallback('hdmfER',  'hdmfer');
        var cr_hdmfLoan= getEilOrFallback('hdmfLoan','pagibigloan');
        var cr_phicEE  = getEilOrFallback('phicEE',  'philhealth');
        var cr_phicER  = getEilOrFallback('phicER',  'phicer');
        var cr_m13     = getEilOrFallback('nth',     '13thmonth');

        addRow('Withholding Tax on Compensation Payable', 0, cr_tax,      'Multi', '');
        addRow('SSS EmployEE Contribution',               0, cr_sssEE,    'Multi', '');
        addRow('SSS EmployER Contribution',               0, cr_sssER,    'Multi', '');
        addRow('SSS Employee Loans and Benefits',         0, cr_sssLoan,  'Multi', '');
        addRow('HDMF EmployEE Contribution',              0, cr_hdmfEE,   'Multi', '');
        addRow('HDMF EmployER Contribution',              0, cr_hdmfER,   'Multi', '');
        addRow('HDMF Employee Loans and Benefits',        0, cr_hdmfLoan, 'Multi', '');
        addRow('PHIC EmployEE Contribution',              0, cr_phicEE,   'Multi', '');
        addRow('PHIC EmployER Contribution',              0, cr_phicER,   'Multi', '');
        addRow('13th Month Payable',                      0, cr_m13,      'Multi', '');
        addRow('Bank Fees Recovered',                     0, totalBankFees,          'Multi', '');
        addRow('Salaries and Wages Payable',              0, salariesPayableAccrued, 'Multi', '');

        // ── Pre-write balance check ───────────────────────────────────────────
        var jeSum = jLines.reduce(function(s, r) { return { dr: s.dr + (Number(r[8]) || 0), cr: s.cr + (Number(r[9]) || 0) }; }, { dr:0, cr:0 });
        if (Math.abs(jeSum.dr - jeSum.cr) > 1.00) {
            try {
                _writeAccrualWarnings_([{ batch_id: batchId, userid: 'BATCH', cutoff_end: '',
                    gross_hris: jeSum.dr, computed_gross: jeSum.cr, gross_variance: jeSum.dr - jeSum.cr, flagged_at: new Date() }]);
            } catch(warnErr) { Logger.log('syncJournalEntries_: could not write AccrualWarnings: ' + warnErr); }
            throw new Error('Payroll accrual JE is imbalanced for batch ' + batchId
                + ': DR=' + jeSum.dr.toFixed(2) + ' CR=' + jeSum.cr.toFixed(2)
                + '. JE not written. See AccrualWarnings sheet.');
        }
        Logger.log('syncJournalEntries_: batch=' + batchId + ' JE balanced DR=CR=' + jeSum.dr.toFixed(2) + ' useEil=' + useEil);

        // NOTE: Trade Receivable, Manpower Service Revenue, and Billable Expense Income
        // are intentionally excluded from this journal entry.
        // Revenue & Billing will be recorded separately by the Billing POS system
        // when invoices are formally issued to clients.

    } else {
        let fpMap = {}; let finalPayInternal = 0; let holdPayable = 0, m13Payable = 0, deductions = 0; 
        
        lines.forEach(l => {
            let comp = String(l['companyname'] || 'Unknown').trim();
            let isInternal = comp.toLowerCase().includes('workscale');
            let hold = Number(String(l['holdsalary'] || 0).replace(/[^0-9.-]+/g, '')) || 0; 
            let m13 = Number(String(l['13thmonth'] || 0).replace(/[^0-9.-]+/g, '')) || 0; 
            let ded = Number(String(l['deductions'] || 0).replace(/[^0-9.-]+/g, '')) || 0; 
            let net = Number(String(l['netfinalpay'] || 0).replace(/[^0-9.-]+/g, '')) || 0;
            
            holdPayable += hold; m13Payable += m13; deductions += ded;
            
            if (isInternal) { finalPayInternal += net; } else { 
                if (!fpMap[comp]) fpMap[comp] = { hold:0, m13:0, ded:0, netDeployed:0 };
                fpMap[comp].hold += hold; fpMap[comp].m13 += m13; fpMap[comp].ded += ded;
                fpMap[comp].netDeployed += net; 
            }
        });

        for (let [comp, v] of Object.entries(fpMap)) {
            let cc = getCC(comp);
            addRow('Salaries and Wages Payable', v.hold, 0, comp, cc);
            addRow('13th Month Payable', v.m13, 0, comp, cc);
            addRow('Other Income / Accountabilities', 0, v.ded, comp, cc);
            if (v.netDeployed > 0) addRow('Final Pay Payable Deployed', 0, v.netDeployed, comp, cc);
        }
        if (finalPayInternal > 0) addRow('Final Pay Payable', 0, finalPayInternal, 'Workscale', '');
    }

    // Write to Central Journal Lines (external spreadsheet) — JournalLines sheet = "For Posting"
    const cjSheet = getCentralJournalSheet_(false);
    const cjData  = cjSheet.getDataRange().getValues();
    // Remove any existing lines for this batch (re-sync on regenerate)
    const rowsToDelete = [];
    for (let i = cjData.length - 1; i >= 1; i--) {
        if (String(cjData[i][0]).trim() === String(batchId).trim()) rowsToDelete.push(i + 1);
    }
    rowsToDelete.forEach(r => cjSheet.deleteRow(r));

    if (jLines.length > 0) {
        cjSheet.getRange(cjSheet.getLastRow() + 1, 1, jLines.length, 16).setValues(jLines);
    }
}

function getPyJournalLines() {
  // Return only Payroll-app related journal lines from the shared Central Journal.
  const allLines = getCentralJournalLines();
  if (!allLines || allLines.length === 0) return [];

  const allowedDocIds = new Set();
  const addId = (v) => {
    const id = String(v || '').trim();
    if (id) allowedDocIds.add(id);
  };

  try {
    const ss = getPayrollDB_();

    const addIdsFromSheet = (sheetName, keyNames) => {
      const sh = ss.getSheetByName(sheetName);
      if (!sh || sh.getLastRow() < 2) return;
      const data = sh.getDataRange().getValues();
      const headers = data[0].map(normalizeColName_);
      const idxs = keyNames
        .map(k => headers.indexOf(normalizeColName_(k)))
        .filter(i => i > -1);
      if (!idxs.length) return;
      for (let r = 1; r < data.length; r++) idxs.forEach(i => addId(data[r][i]));
    };

    // Core IDs written by Payroll app JEs
    addIdsFromSheet('PayrollBooks', ['PayrollID']);
    addIdsFromSheet('FinalPay', ['FP_ID']);
    addIdsFromSheet('IncentiveSheets', ['SheetId']);

    // Linked voucher IDs that may also generate payroll-owned journal rows
    addIdsFromSheet('PayrollBooks', ['LinkedVoucherId', 'LinkedCheckVoucherId']);
    addIdsFromSheet('FinalPay', ['LinkedVoucherId']);
    addIdsFromSheet('IncentiveSheets', ['LinkedVoucherId']);
  } catch (e) {
    Logger.log('getPyJournalLines filter scope warning: ' + e);
  }

  return allLines.filter(row => {
    const docId = String(row.DocumentID || row.documentid || '').trim();
    if (allowedDocIds.has(docId)) return true;

    // Legacy safety net for older rows without stable IDs.
    const desc = String(row.description || row.Description || '').trim().toLowerCase();
    return desc === 'payroll accrual'
      || desc === 'final pay accrual'
      || desc.indexOf('is accrual -') === 0
      || desc.indexOf('incentives payment -') === 0;
  });
}

// =====================================================================
// CENTRAL JOURNAL LINES  (external spreadsheet)
// =====================================================================

/**
 * Deletes all lines for a given DocumentID from BOTH JournalLines and
 * JournalLinesPosted in the Central Journal Lines spreadsheet.
 * Called automatically when a Payroll Book or Final Pay is deleted.
 */
function deleteCentralJournalLines_(docId) {
    [false, true].forEach(posted => {
        try {
            const sh   = getCentralJournalSheet_(posted);
            const data = sh.getDataRange().getValues();
            // Delete bottom-up to keep row indices valid
            for (let i = data.length - 1; i >= 1; i--) {
                if (String(data[i][0]).trim() === String(docId).trim()) sh.deleteRow(i + 1);
            }
        } catch(e) { Logger.log('deleteCentralJournalLines_ error: ' + e); }
    });
}

function getCentralJournalSheet_(posted) {    const spreadsheet = SpreadsheetApp.openById(CENTRAL_JOURNAL_ID);
    const name = posted ? 'JournalLinesPosted' : 'JournalLines';
    let sh = spreadsheet.getSheetByName(name);
    if (!sh) {
        sh = spreadsheet.insertSheet(name);
        const h = ['DocumentID','journal_entry_id','line_number','account_code','account_name',
                   'description','contact_name','class','debit','credit','created_at',
                   'created_by','updated_by','updated_at','posted_by','posted_at'];
        sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#f3f4f6');
        sh.setFrozenRows(1);
    }
    return sh;
}

function getCentralJournalLines() {
    const result = [];
    const readSheet = (posted) => {
        try {
            const sh   = getCentralJournalSheet_(posted);
            const data = sh.getDataRange().getValues();
            if (data.length < 2) return;
            const h = data[0].map(s => String(s).trim());
            for (let i = 1; i < data.length; i++) {
                const obj = { _posted: posted };
                h.forEach((col, idx) => {
                    let v = data[i][idx];
                    if (v instanceof Date) v = v.toISOString();
                    obj[col] = v;
                });
                result.push(obj);
            }
        } catch(e) { Logger.log('getCentralJournalLines error (' + (posted ? 'posted' : 'unposted') + '): ' + e); }
    };
    readSheet(false); // JournalLines      → status: For Posting
    readSheet(true);  // JournalLinesPosted → status: Posted
    return result.reverse();
}

// =====================================================================
// NEW: CENTRALIZED EMPLOYEE DATABASE MASTER
// =====================================================================

function ensureEmployeeMasterHeaders_(sheet) {
    const h = ['Employee Key', 'First Name', 'Last Name', 'Name', 'Company Name', 'Region', 'Employment Status', 'Bank Account Number', 'Salary Status', 'Last Updated'];
    let exist = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1).getValues()[0];
    if (!exist || exist.length !== h.length || exist[0] !== h[0]) {
        sheet.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight("bold").setBackground("#f3f4f6");
        sheet.setFrozenRows(1);
    }
    return h;
}

function initializeEmployeeMaster(yearsArray) {
    const currentYear = new Date().getFullYear();
    const years = (yearsArray && Array.isArray(yearsArray) && yearsArray.length > 0)
        ? yearsArray.map(Number)
        : [currentYear - 3, currentYear - 2, currentYear - 1, currentYear];

    const ss = getPayrollDB_();
    let emSheet = ss.getSheetByName('EmployeeMaster');
    if (!emSheet) emSheet = ss.insertSheet('EmployeeMaster');
    else emSheet.clear();

    const emH = ensureEmployeeMasterHeaders_(emSheet);
    const employeeMap = {};

    for (let yr of years) {
        try {
            const targetSS = getYearlySpreadsheet_(yr); if (!targetSS) continue; const plSheet = targetSS.getSheetByName('PayrollLines'); if (!plSheet) continue; const sData = plSheet.getDataRange().getValues(); if (sData.length < 2) continue;
            
            const h = sData[0].map(normalizeColName_); const nIdx = h.indexOf('name'); const cIdx = h.indexOf('companyname');
            const fIdx = h.indexOf('firstname'); const lIdx = h.indexOf('lastname'); const rIdx = h.indexOf('region'); const esIdx = h.indexOf('employmentstatus');
            let baIdx = h.indexOf('bankaccountnumber'); if (baIdx===-1) baIdx = h.indexOf('ubaccountnumber'); const endIdx = h.indexOf('cutoffend');
            if (nIdx === -1 || cIdx === -1) continue;

            for (let i = 1; i < sData.length; i++) {
                let name = String(sData[i][nIdx]).trim(); let comp = String(sData[i][cIdx]).trim(); if (!name || !comp) continue;
                let key = name.toLowerCase() + "|" + comp.toLowerCase();
                let rawDate = endIdx > -1 ? sData[i][endIdx] : null; let d = new Date(rawDate);
                if (isNaN(d.getTime()) && typeof rawDate === 'number') d = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
                if (isNaN(d.getTime())) d = new Date(yr, 0, 1);
                
                if (!employeeMap[key] || employeeMap[key].lastDate < d) {
                    employeeMap[key] = { key: key, firstName: fIdx > -1 ? sData[i][fIdx] : '', lastName: lIdx > -1 ? sData[i][lIdx] : '', name: name, company: comp, region: rIdx > -1 ? sData[i][rIdx] : '', empStatus: esIdx > -1 ? sData[i][esIdx] : '', bank: baIdx > -1 ? sData[i][baIdx] : '', status: 'Active', lastDate: d };
                }
            }
        } catch(e) {}
    }

    const pbSheet = ss.getSheetByName('PayrollBookConsolidated');
    if (pbSheet) {
        const pbData = pbSheet.getDataRange().getValues();
        if (pbData.length > 1) {
            const h = pbData[0].map(normalizeColName_); const nIdx = h.indexOf('name'); const cIdx = h.indexOf('companyname'); const sIdx = h.indexOf('salarystatus');
            if (nIdx > -1 && cIdx > -1 && sIdx > -1) {
                for (let i = 1; i < pbData.length; i++) {
                    let key = String(pbData[i][nIdx]).trim().toLowerCase() + "|" + String(pbData[i][cIdx]).trim().toLowerCase();
                    if (employeeMap[key]) { let stat = String(pbData[i][sIdx]).trim(); if (stat && stat !== '') employeeMap[key].status = stat; }
                }
            }
        }
    }

    const fpcSheet = ss.getSheetByName('FinalPayConsolidated'); const fpbSheet = ss.getSheetByName('FinalPayBooks');
    if (fpcSheet && fpbSheet) {
        const fpbData = fpbSheet.getDataRange().getValues(); const fpbh = fpbData.length > 0 ? fpbData[0].map(normalizeColName_) : []; const fpbIdIdx = fpbh.indexOf('fp_id'); const fpbStatIdx = fpbh.indexOf('status');
        const fpcData = fpcSheet.getDataRange().getValues(); const fpch = fpcData.length > 0 ? fpcData[0].map(normalizeColName_) : []; const fnIdx = fpch.indexOf('name'); const fcIdx = fpch.indexOf('companyname'); const fidIdx = fpch.indexOf('fp_id');

        if (fpbIdIdx > -1 && fpbStatIdx > -1 && fnIdx > -1 && fcIdx > -1 && fidIdx > -1) {
            const fpStatusMap = {}; for (let i = 1; i < fpbData.length; i++) { fpStatusMap[String(fpbData[i][fpbIdIdx]).trim()] = String(fpbData[i][fpbStatIdx]).trim(); }
            for (let i = 1; i < fpcData.length; i++) {
                let fpid = String(fpcData[i][fidIdx]).trim(); let bStat = fpStatusMap[fpid] || 'Draft'; let key = String(fpcData[i][fnIdx]).trim().toLowerCase() + "|" + String(fpcData[i][fcIdx]).trim().toLowerCase();
                if (employeeMap[key]) { if (bStat === 'Finalized' || bStat === 'Processing') employeeMap[key].status = 'Final Pay Released'; else employeeMap[key].status = 'For Final Pay'; }
            }
        }
    }

    const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/dd/yyyy HH:mm:ss");
    const arr = Object.values(employeeMap).map(e => [ e.key, e.firstName, e.lastName, e.name, e.company, e.region, e.empStatus, e.bank, e.status, nowStr ]);
    if (arr.length > 0) emSheet.getRange(2, 1, arr.length, emH.length).setValues(arr);
    return `Successfully tracked ${arr.length} unique employees into Central Master!`;
}

function setupEmployeeMasterTrigger() {
    const triggers = ScriptApp.getProjectTriggers();
    for (const t of triggers) {
        if (t.getHandlerFunction() === 'initializeEmployeeMaster') ScriptApp.deleteTrigger(t);
    }
    ScriptApp.newTrigger('initializeEmployeeMaster').timeBased().everyDays(1).atHour(2).create();
    return 'Nightly auto-run scheduled for 2:00 AM daily.';
}

function removeEmployeeMasterTrigger() {
    const triggers = ScriptApp.getProjectTriggers();
    let removed = 0;
    for (const t of triggers) {
        if (t.getHandlerFunction() === 'initializeEmployeeMaster') { ScriptApp.deleteTrigger(t); removed++; }
    }
    return removed > 0 ? 'Auto-run schedule removed.' : 'No active schedule found.';
}

function getEmployeeMasterTriggerStatus() {
    const triggers = ScriptApp.getProjectTriggers();
    for (const t of triggers) {
        if (t.getHandlerFunction() === 'initializeEmployeeMaster') return 'active';
    }
    return 'inactive';
}

function syncOverlayToEmployeeMaster_(updates) {
    // Always sync to WRI Masterlist first, regardless of local EmployeeMaster state
    try {
        const wriUpdates = updates.map(u => {
            const isFinalPay = String(u.status || '').toLowerCase().includes('final pay');
            return { name: u.name, company: u.company, userid: u.userid,
                salaryStatus:   isFinalPay ? 'Inactive' : String(u.status),
                finalPayStatus: isFinalPay ? 'Released' : null,
                markInactive:   isFinalPay };
        });
        syncWriMasterlistByNameCompany_(wriUpdates);
        syncWriMasterlistByUserid_(wriUpdates);
    } catch(e) {}

    // Then update local EmployeeMaster if it exists and is valid
    const ss = getPayrollDB_();
    const emSheet = ss.getSheetByName('EmployeeMaster');
    if (!emSheet) return;
    const data = emSheet.getDataRange().getValues();
    if (data.length < 2) return;
    
    const h = data[0].map(normalizeColName_);
    const kIdx = h.indexOf('employeekey');
    const sIdx = h.indexOf('salarystatus');
    const uIdx = h.indexOf('lastupdated');
    if (kIdx === -1) return;

    const updatesByKey = {};
    updates.forEach(u => {
        let key = String(u.name).trim().toLowerCase() + "|" + String(u.company).trim().toLowerCase();
        updatesByKey[key] = u.status;
    });

    const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/dd/yyyy HH:mm:ss");
    for (let i = 1; i < data.length; i++) {
        let rKey = String(data[i][kIdx]).trim().toLowerCase();
        if (updatesByKey[rKey]) {
            if (sIdx > -1) emSheet.getRange(i + 1, sIdx + 1).setValue(updatesByKey[rKey]);
            if (uIdx > -1) emSheet.getRange(i + 1, uIdx + 1).setValue(nowStr);
        }
    }
}

function getEmployeeMasterList() {
    try {
        const ss = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
        const sheet = ss.getSheetByName(WRI_MASTERLIST_SHEET_NAME);
        if (!sheet) return [];
        const data = sheet.getDataRange().getDisplayValues();
        if (data.length < 2) return [];
        // Build dynamic header map (lowercase) for BIR columns that may be at variable positions
        const headers = data[0].map(function(h) { return String(h).toLowerCase().trim(); });
        var h = function(name) { var idx = headers.indexOf(name); return idx > -1 ? idx : null; };
        const birTinIdx       = h('tin');
        const birRdoIdx       = h('rdo_code');
        const birAddrIdx      = h('address');
        const birAddrZipIdx   = h('address_zip');
        const birLocalIdx     = h('local_address');
        const birLocalZipIdx  = h('local_address_zip');
        const birDobIdx       = h('date_of_birth');
        const birContactIdx   = h('contact_number');
        const birNatIdx       = h('nationality');
        const birRegRateIdx   = h('regulardayrate');
        const birSmwMonIdx    = h('smw_monthly');
        const birMweIdx       = h('is_mwe');
        const birSubFilIdx    = h('is_substituted_filing');
        // Org fields
        const orgBranchIdx    = h('branch');
        const orgDeptIdx      = h('department');
        const orgWorkLocIdx   = h('work_location');
        const orgPositionIdx  = h('position');
        const orgLevelIdx     = h('level');
        var cv = function(row, idx) { return idx !== null ? String(row[idx] || '').trim() : ''; };
        const result = [];
        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const uid = String(row[0]).trim();
            if (!uid) continue;
            const fn = String(row[1]).trim();
            const mn = String(row[2]).trim();
            const ln = String(row[3]).trim();
            const fullName = [fn, mn, ln].filter(Boolean).join(' ');
            result.push({
                userId:           uid,
                name:             fullName,
                firstName:        fn,
                lastName:         ln,
                company:          String(row[8]).trim(),
                region:           String(row[5]).trim(),
                empStatus:        String(row[6]).trim(),
                bank:             String(row[4]).trim(),
                status:           String(row[9]).trim()  || 'Active',
                salaryStatus:     cv(row, h('salarystatus'))          || 'Active',
                finalPayStatus:   cv(row, h('finalpaystatus')),
                lastUpdated:      cv(row, h('last_seen_cutoffend')),
                hiringDate:       cv(row, h('hiringdate')),
                separationDate:   cv(row, h('separationdate')),
                lastModified:     cv(row, h('last_modified')),
                // BIR profile (dynamic columns)
                tin:              cv(row, birTinIdx),
                rdoCode:          cv(row, birRdoIdx),
                address:          cv(row, birAddrIdx),
                addressZip:       cv(row, birAddrZipIdx),
                localAddress:     cv(row, birLocalIdx),
                localAddressZip:  cv(row, birLocalZipIdx),
                dateOfBirth:      cv(row, birDobIdx),
                contactNumber:    cv(row, birContactIdx),
                nationality:      cv(row, birNatIdx),
                regularDayRate:   cv(row, birRegRateIdx),
                smwMonthly:       cv(row, birSmwMonIdx),
                isMwe:            cv(row, birMweIdx),
                isSubstitutedFiling: cv(row, birSubFilIdx),
                // Org fields
                branch:           cv(row, orgBranchIdx),
                department:       cv(row, orgDeptIdx),
                workLocation:     cv(row, orgWorkLocIdx),
                position:         cv(row, orgPositionIdx),
                level:            cv(row, orgLevelIdx),
            });
        }
        return result;
    } catch(e) { return []; }
}

function upsertEmployeesFromHRIS_(dataRows, headers) {
    const ss = getPayrollDB_(); let emSheet = ss.getSheetByName('EmployeeMaster'); if (!emSheet) return;
    const emData = emSheet.getDataRange().getValues(); if (emData.length < 2) return;
    const h = emData[0].map(normalizeColName_); const emMap = {};
    for (let i = 1; i < emData.length; i++) { let key = String(emData[i][h.indexOf('employeekey')]).trim().toLowerCase(); emMap[key] = i + 1; }
    const mapH = headers.map(normalizeColName_); const nIdx = mapH.indexOf('name'); const cIdx = mapH.indexOf('companyname');
    const fIdx = mapH.indexOf('firstname'); const lIdx = mapH.indexOf('lastname'); const rIdx = mapH.indexOf('region'); const esIdx = mapH.indexOf('employmentstatus');
    let baIdx = mapH.indexOf('bankaccountnumber'); if (baIdx === -1) baIdx = mapH.indexOf('ubaccountnumber'); if (nIdx === -1 || cIdx === -1) return;
    let newEmps = []; const nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MM/dd/yyyy HH:mm:ss");
    dataRows.forEach(r => {
        let name = String(r[nIdx]).trim(); let comp = String(r[cIdx]).trim(); if (!name || !comp) return;
        let key = name.toLowerCase() + "|" + comp.toLowerCase();
        if (!emMap[key]) {
            newEmps.push([ key, fIdx > -1 ? r[fIdx] : '', lIdx > -1 ? r[lIdx] : '', name, comp, rIdx > -1 ? r[rIdx] : '', esIdx > -1 ? r[esIdx] : '', baIdx > -1 ? r[baIdx] : '', 'Active', nowStr ]);
            emMap[key] = true;
        }
    });
    if (newEmps.length > 0) emSheet.getRange(emSheet.getLastRow() + 1, 1, newEmps.length, emData[0].length).setValues(newEmps);
}

// =====================================================================
// WRI EMPLOYEE MASTERLIST (EXTERNAL SPREADSHEET)
// =====================================================================

function ensureWriMasterlistOrgFields_(sheet) {
    // Migration helper: appends any missing org-field columns to an existing Masterlist sheet.
    // Safe to call repeatedly — only acts when a column is absent.
    const orgFields = ['branch','department','work_location','position','level'];
    const lastCol   = sheet.getLastColumn();
    if (lastCol < 1) return;
    const headers   = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h){ return String(h).toLowerCase().trim(); });
    orgFields.forEach(function(field) {
        if (headers.indexOf(field) === -1) {
            const nextCol = sheet.getLastColumn() + 1;
            sheet.getRange(1, nextCol).setValue(field).setFontWeight('bold').setBackground('#f3f4f6');
        }
    });
}

function getWriMasterlistSheet_() {
    const ss = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
    let sheet = ss.getSheetByName(WRI_MASTERLIST_SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(WRI_MASTERLIST_SHEET_NAME);
    if (sheet.getLastRow() === 0 || String(sheet.getRange(1,1).getValue()).toLowerCase() !== 'userid') {
        if (sheet.getLastRow() === 0) {
            sheet.getRange(1, 1, 1, WRI_ML_HEADERS.length).setValues([WRI_ML_HEADERS]).setFontWeight('bold').setBackground('#f3f4f6');
            sheet.setFrozenRows(1);
        }
    } else {
        // Existing sheet: ensure org columns are present (migration for deployed sheets)
        ensureWriMasterlistOrgFields_(sheet);
    }
    return sheet;
}

function upsertToWriMasterlist_(rows, headers) {
    if (!rows || rows.length === 0) return { added: 0, updated: 0, skipped: 0 };
    const mapH = headers.map(normalizeColName_);
    const uidIdx = mapH.indexOf('userid');
    const fnIdx  = mapH.indexOf('firstname');
    const mnIdx  = mapH.indexOf('middlename');
    const lnIdx  = mapH.indexOf('lastname');
    let   acIdx  = mapH.indexOf('accountnumber');
    if (acIdx === -1) acIdx = mapH.indexOf('bankaccountnumber');
    if (acIdx === -1) acIdx = mapH.indexOf('ubaccountnumber');
    let   wrIdx  = mapH.indexOf('workregion');
    if (wrIdx === -1) wrIdx = mapH.indexOf('region');
    const etIdx  = mapH.indexOf('employmenttype');
    const empIdx = mapH.indexOf('employer');
    const cnIdx  = mapH.indexOf('companyname');
    const endIdx = mapH.indexOf('cutoffend');
    // HRIS column is "regularday.rate"; normalizeColName_ strips the dot → "regulardayrate"
    const srIdx  = mapH.indexOf('regulardayrate');
    if (uidIdx === -1) return { added: 0, updated: 0, skipped: rows.length };

    const sheet   = getWriMasterlistSheet_();
    const allData = sheet.getDataRange().getValues();
    // Resolve destination indices from the sheet's own header row (safe after migration)
    const destH    = allData[0].map(h => String(h).toLowerCase().trim());
    const dLastCut = destH.indexOf('last_seen_cutoffend');
    const dSalStat = destH.indexOf('salarystatus');
    const dFinPay  = destH.indexOf('finalpaystatus');
    const dHiring  = destH.indexOf('hiringdate');
    const dSepDate = destH.indexOf('separationdate');
    const dLastMod = destH.indexOf('last_modified');
    const dRegRate = destH.indexOf('regulardayrate');

    const uidMap  = {};
    for (let i = 1; i < allData.length; i++) {
        const uid = String(allData[i][0]).trim();
        if (uid) uidMap[uid] = i;
    }

    let added = 0, updated = 0, skipped = 0;
    const toAppend = [];
    const updatedIndices = []; // track allData indices that were modified

    rows.forEach(r => {
        const uid = String(r[uidIdx] !== undefined ? r[uidIdx] : '').trim();
        if (!uid) { skipped++; return; }

        let incomingDate = null;
        if (endIdx > -1 && r[endIdx]) {
            let raw = r[endIdx];
            if (typeof raw === 'number') raw = new Date(Math.round((raw - 25569) * 86400 * 1000));
            const d = new Date(raw);
            if (!isNaN(d.getTime())) incomingDate = d;
        }
        const val = (idx, fallback) => {
            if (idx === -1 || r[idx] === undefined) return fallback !== undefined ? fallback : '';
            const v = String(r[idx]).trim();
            return v !== '' ? v : (fallback !== undefined ? fallback : '');
        };

        if (uidMap.hasOwnProperty(uid)) {
            const di = uidMap[uid];
            const ex = allData[di];
            let storedDate = null;
            const storedCutoffVal = dLastCut > -1 ? ex[dLastCut] : '';
            if (storedCutoffVal) { const d = new Date(storedCutoffVal); if (!isNaN(d.getTime())) storedDate = d; }
            const isNewer = !storedDate || (incomingDate && incomingDate > storedDate);
            if (!isNewer) { skipped++; return; }
            // regulardayrate: only overwrite when incoming is non-zero AND isNewer (latest cutoffend wins)
            const incomingRate = srIdx > -1 ? Number(r[srIdx]) || 0 : 0;
            const existingRate = dRegRate > -1 ? Number(ex[dRegRate]) || 0 : 0;
            const newRate = (isNewer && incomingRate) ? incomingRate : existingRate;
            // Build full 29-column row aligned to WRI_ML_HEADERS
            const newRow = new Array(WRI_ML_HEADERS.length).fill('');
            newRow[0]  = uid;
            newRow[1]  = val(fnIdx,  ex[1]);
            newRow[2]  = val(mnIdx,  ex[2]);
            newRow[3]  = val(lnIdx,  ex[3]);
            newRow[4]  = val(acIdx,  ex[4]);                                                  // accountnumber: overwrite if non-empty + newer
            newRow[5]  = wrIdx  > -1 ? val(wrIdx,  ex[5]) : String(ex[5]  || '');
            newRow[6]  = etIdx  > -1 ? val(etIdx,  ex[6]) : String(ex[6]  || '');
            newRow[7]  = empIdx > -1 ? val(empIdx, ex[7]) : String(ex[7]  || '');
            newRow[8]  = val(cnIdx,  ex[8]);
            newRow[9]  = 'Active';                                                            // employeestatus: Active on any appearance
            newRow[10] = newRate;                                                             // regulardayrate
            newRow[11] = String(dSalStat > -1 ? ex[dSalStat] : (ex[11] || 'Active'));        // salarystatus: PRESERVED
            newRow[12] = String(dFinPay  > -1 ? ex[dFinPay]  : (ex[12] || ''));              // finalpaystatus: PRESERVED
            newRow[13] = incomingDate
                ? Utilities.formatDate(incomingDate, Session.getScriptTimeZone(), 'MM/dd/yyyy')
                : String(dLastCut > -1 ? (ex[dLastCut] || '') : '');                         // last_seen_cutoffend
            newRow[14] = String(dHiring  > -1 ? (ex[dHiring]  || '') : '');                  // hiringdate: PRESERVED
            newRow[15] = String(dSepDate > -1 ? (ex[dSepDate] || '') : '');                  // separationdate: PRESERVED
            newRow[16] = String(dLastMod > -1 ? (ex[dLastMod] || '') : '');                  // last_modified: PRESERVED
            // BIR columns [17..28]: always preserve from existing row — never overwrite from PayrollLines
            for (let c = 17; c < WRI_ML_HEADERS.length; c++) {
                newRow[c] = ex[c] !== undefined ? ex[c] : '';
            }
            allData[di] = newRow;
            updatedIndices.push(di);
            updated++;
        } else {
            const incomingRate = srIdx > -1 ? Number(r[srIdx]) || 0 : 0;
            const newRow = new Array(WRI_ML_HEADERS.length).fill('');
            newRow[0]  = uid;
            newRow[1]  = val(fnIdx);
            newRow[2]  = val(mnIdx);
            newRow[3]  = val(lnIdx);
            newRow[4]  = val(acIdx);
            newRow[5]  = wrIdx  > -1 ? val(wrIdx)  : '';
            newRow[6]  = etIdx  > -1 ? val(etIdx)  : '';
            newRow[7]  = empIdx > -1 ? val(empIdx) : '';
            newRow[8]  = val(cnIdx);
            newRow[9]  = 'Active';      // employeestatus
            newRow[10] = incomingRate;  // regulardayrate
            newRow[11] = 'Active';      // salarystatus
            newRow[12] = '';            // finalpaystatus
            newRow[13] = incomingDate ? Utilities.formatDate(incomingDate, Session.getScriptTimeZone(), 'MM/dd/yyyy') : '';
            // [14..28] all blank on first HRIS appearance
            toAppend.push(newRow);
            uidMap[uid] = allData.length + toAppend.length - 1;
            added++;
        }
    });

    if (updatedIndices.length > 0) {
        // Write only the individual rows that changed instead of the full sheet
        updatedIndices.forEach(di => {
            sheet.getRange(di + 1, 1, 1, WRI_ML_HEADERS.length).setValues([allData[di]]);
        });
    }
    if (toAppend.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, WRI_ML_HEADERS.length).setValues(toAppend);
    }
    return { added: added, updated: updated, skipped: skipped };
}

function updateEmployeeRecord(payload) {
    const { userId, employmentType, bank, empStatus, hiringDate, separationDate, openedAt,
            birTin, birRdo, birAddress, birAddressZip, birLocalAddress, birLocalZip,
            birDob, birContact, birNationality, birRegularDayRate, birSmwMonthly, birIsMwe, birSubFiling,
            branch, department, workLocation, position, level } = payload;
    if (!userId) throw new Error('userId is required.');
    const sheet       = getWriMasterlistSheet_();
    const range       = sheet.getDataRange();
    const data        = range.getValues();        // raw – used for header detection & writing
    const displayData = range.getDisplayValues(); // formatted strings – same as what frontend received
    // Build a dynamic column-name → 0-based-index map from header row
    const headers = data[0].map(function(h) { return String(h).toLowerCase().trim(); });
    var colIdx = function(name) { return headers.indexOf(name); };
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === String(userId).trim()) {
            // Optimistic lock: compare using display values so format matches what the frontend received
            const lmIdx = colIdx('last_modified');
            const storedModified = lmIdx > -1 ? String(displayData[i][lmIdx] || '').trim() : '';
            if (openedAt && storedModified && storedModified !== openedAt) {
                return { ok: false, conflict: true };
            }
            const row = i + 1; // 1-indexed for sheet.getRange
            // Fixed-position payroll columns (always present at known indices)
            var set = function(colName, val) {
                var idx = colIdx(colName);
                if (idx > -1 && val !== undefined) sheet.getRange(row, idx + 1).setValue(val);
            };
            set('accountnumber',  bank);
            set('employmenttype', employmentType);
            set('employeestatus', empStatus);
            set('hiringdate',     hiringDate);
            set('separationdate', separationDate);
            // BIR profile columns (added dynamically by _ensureMasterlistBirColumns_)
            set('tin',              birTin);
            set('rdo_code',         birRdo);
            set('address',          birAddress);
            set('address_zip',      birAddressZip);
            set('local_address',    birLocalAddress);
            set('local_address_zip',birLocalZip);
            set('date_of_birth',    birDob);
            set('contact_number',   birContact);
            set('nationality',      birNationality);
            set('regulardayrate',   birRegularDayRate);
            // smw_monthly: use provided value, or auto-compute from regulardayrate when is_mwe = TRUE
            var computedSmwMonthly = (birRegularDayRate && String(birIsMwe).toUpperCase() === 'TRUE')
                ? Number(birRegularDayRate) * 26
                : birSmwMonthly;
            set('smw_monthly',      computedSmwMonthly);
            set('is_mwe',           birIsMwe);
            set('is_substituted_filing', birSubFiling);
            // Org fields (manual-entry only, never overwritten by HRIS)
            set('branch',        branch);
            set('department',    department);
            set('work_location', workLocation);
            set('position',      position);
            set('level',         level);
            const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
            set('last_modified', ts);
            return { ok: true };
        }
    }
    throw new Error('Employee not found: ' + userId);
}

function syncWriMasterlistByUserid_(updates) {
    if (!updates || updates.length === 0) return;
    try {
        const sheet = getWriMasterlistSheet_();
        const data  = sheet.getDataRange().getValues();
        if (data.length < 2) return;
        const hdrs = data[0].map(h => String(h).trim().toLowerCase());
        const colEmpStatus    = hdrs.indexOf('employeestatus') + 1;   // 1-based for getRange
        const colSalaryStatus = hdrs.indexOf('salarystatus')   + 1;
        const colFinalPay     = hdrs.indexOf('finalpaystatus') + 1;
        const updMap = {};
        updates.forEach(u => { if (u.userid) updMap[String(u.userid).trim()] = u; });
        if (Object.keys(updMap).length === 0) return;
        for (let i = 1; i < data.length; i++) {
            const uid = String(data[i][0] || '').trim();
            if (uid && updMap[uid]) {
                const u = updMap[uid];
                if (u.salaryStatus   !== undefined && u.salaryStatus   !== null && colSalaryStatus) sheet.getRange(i + 1, colSalaryStatus).setValue(u.salaryStatus);
                if (u.finalPayStatus !== undefined && u.finalPayStatus !== null && colFinalPay)     sheet.getRange(i + 1, colFinalPay).setValue(u.finalPayStatus);
                if (u.markInactive && colEmpStatus) sheet.getRange(i + 1, colEmpStatus).setValue('Inactive');
            }
        }
    } catch(e) {}
}

function syncWriMasterlistByNameCompany_(updates) {
    if (!updates || updates.length === 0) return;
    try {
        const sheet = getWriMasterlistSheet_();
        const data  = sheet.getDataRange().getValues();
        if (data.length < 2) return;
        const hdrs = data[0].map(h => String(h).trim().toLowerCase());
        const colEmpStatus    = hdrs.indexOf('employeestatus') + 1;   // 1-based for getRange
        const colSalaryStatus = hdrs.indexOf('salarystatus')   + 1;
        const colFinalPay     = hdrs.indexOf('finalpaystatus') + 1;
        const updMap = {};
        updates.forEach(u => {
            const normName = String(u.name || '').trim().toLowerCase().replace(/\s+/g, '');
            const key = normName + '|' + String(u.company || '').trim().toLowerCase();
            updMap[key] = u;
        });
        for (let i = 1; i < data.length; i++) {
            const fn = String(data[i][1] || '').trim();
            const mn = String(data[i][2] || '').trim();
            const ln = String(data[i][3] || '').trim();
            const comp = String(data[i][8] || '').trim().toLowerCase();
            // Try full name (with middle name) first, then fall back to first+last only
            const fullNorm = (fn + (mn ? ' ' + mn : '') + (ln ? ' ' + ln : '')).trim().toLowerCase().replace(/\s+/g, '');
            const shortNorm = (fn + (ln ? ' ' + ln : '')).trim().toLowerCase().replace(/\s+/g, '');
            const u = updMap[fullNorm + '|' + comp] || updMap[shortNorm + '|' + comp];
            if (u) {
                if (u.salaryStatus   !== undefined && u.salaryStatus   !== null && colSalaryStatus) sheet.getRange(i + 1, colSalaryStatus).setValue(u.salaryStatus);
                if (u.finalPayStatus !== undefined && u.finalPayStatus !== null && colFinalPay)     sheet.getRange(i + 1, colFinalPay).setValue(u.finalPayStatus);
                if (u.markInactive) {
                    if (colEmpStatus)    sheet.getRange(i + 1, colEmpStatus).setValue('Inactive');    // employeestatus
                    if (colSalaryStatus) sheet.getRange(i + 1, colSalaryStatus).setValue('Inactive'); // salarystatus
                }
            }
        }
    } catch(e) {}
}

// Variant of syncWriMasterlistByNameCompany_ that matches by name only (used from accounting module)
function syncWriMasterlistByNameCompanyPayroll_(updates) {
    if (!updates || updates.length === 0) return;
    try {
        const sheet = getWriMasterlistSheet_();
        const data  = sheet.getDataRange().getValues();
        if (data.length < 2) return;
        const hdrs = data[0].map(h => String(h).trim().toLowerCase());
        const colEmpStatus    = hdrs.indexOf('employeestatus') + 1;   // 1-based for getRange
        const colSalaryStatus = hdrs.indexOf('salarystatus')   + 1;
        const colFinalPay     = hdrs.indexOf('finalpaystatus') + 1;
        for (let i = 1; i < data.length; i++) {
            const fn = String(data[i][1] || '').trim();
            const mn = String(data[i][2] || '').trim();
            const ln = String(data[i][3] || '').trim();
            const comp = String(data[i][8] || '').trim().toLowerCase();
            
            // Build full and short normalized names
            const fullNorm = (fn + (mn ? ' ' + mn : '') + (ln ? ' ' + ln : '')).trim().toLowerCase().replace(/\s+/g, '');
            const shortNorm = (fn + (ln ? ' ' + ln : '')).trim().toLowerCase().replace(/\s+/g, '');
            
            // Look for matching employee by name (with or without company)
            for (let u of updates) {
                const uNorm = String(u.name || '').trim().toLowerCase().replace(/\s+/g, '');
                let isMatch = (uNorm === fullNorm || uNorm === shortNorm);
                
                // If company is specified in update, also check company match
                if (isMatch && u.company && String(u.company).trim()) {
                    const uComp = String(u.company).trim().toLowerCase();
                    isMatch = isMatch && (comp === uComp);
                }
                
                if (isMatch) {
                    if (u.salaryStatus   !== undefined && u.salaryStatus   !== null && colSalaryStatus) sheet.getRange(i + 1, colSalaryStatus).setValue(u.salaryStatus);
                    if (u.finalPayStatus !== undefined && u.finalPayStatus !== null && colFinalPay)     sheet.getRange(i + 1, colFinalPay).setValue(u.finalPayStatus);
                    if (u.markInactive && colEmpStatus) sheet.getRange(i + 1, colEmpStatus).setValue('Inactive');
                    break;
                }
            }
        }
    } catch(e) {
        Logger.log('syncWriMasterlistByNameCompanyPayroll_ error: ' + e.message);
    }
}

// =====================================================================
// SYNC BANK ACCOUNT CHANGES TO WRI EMPLOYEE MASTERLIST & PAYROLL BOOK
// =====================================================================

function syncBankAccountToMaster(pbookId, employeeName, company, bankAccount, userId) {
    try {
        Logger.log('syncBankAccountToMaster: ' + employeeName + ' (' + bankAccount + ')');
        
        // 1. Update in Payroll Book Consolidated
        if (pbookId) {
            const ss = getPayrollDB_();
            const pbcSheet = ss.getSheetByName('PayrollBookConsolidated');
            if (pbcSheet && pbcSheet.getLastRow() > 1) {
                const pbcData = pbcSheet.getDataRange().getValues();
                const pbcHeaders = pbcData[0];
                const pidIdx = pbcHeaders.indexOf('PayrollID');
                const nameIdx = pbcHeaders.indexOf('Name');
                const compIdx = pbcHeaders.indexOf('Company Name');
                const bankIdx = pbcHeaders.indexOf('Bank Account Number');
                const bankIdx2 = pbcHeaders.indexOf('Bank Account');
                
                if (pidIdx > -1 && nameIdx > -1 && (bankIdx > -1 || bankIdx2 > -1)) {
                    for (let i = 1; i < pbcData.length; i++) {
                        const pbId = String(pbcData[i][pidIdx] || '').trim();
                        const name = String(pbcData[i][nameIdx] || '').trim();
                        const comp = String(pbcData[i][compIdx] || '').trim();
                        
                        if (pbId === String(pbookId).trim() && name === String(employeeName).trim() && comp === String(company).trim()) {
                            if (bankIdx > -1) pbcSheet.getRange(i + 1, bankIdx + 1).setValue(bankAccount);
                            if (bankIdx2 > -1) pbcSheet.getRange(i + 1, bankIdx2 + 1).setValue(bankAccount);
                            Logger.log('Updated Payroll Book Consolidated at row ' + (i + 1));
                        }
                    }
                }
            }
        }
        
        // 2. Sync to WRI Employee Masterlist
        syncBankAccountToWriMasterlist_(userId, employeeName, company, bankAccount);
        
        return { success: true };
    } catch (error) {
        Logger.log('syncBankAccountToMaster error: ' + error.message);
        throw new Error('Failed to sync bank account: ' + error.message);
    }
}

function syncBankAccountToWriMasterlist_(userId, employeeName, company, bankAccount) {
    if (!bankAccount) return;
    try {
        const sheet = getWriMasterlistSheet_();
        if (!sheet) return;
        const data = sheet.getDataRange().getValues();
        if (data.length < 2) return;
        
        Logger.log('syncBankAccountToWriMasterlist_ for: ' + employeeName);
        
        // Column 0: User ID, 1-3: First/Middle/Last Name, 4: Bank Account, 8: Company
        for (let i = 1; i < data.length; i++) {
            let matched = false;
            
            // Try matching by User ID first (most reliable)
            if (userId) {
                const rowUserId = String(data[i][0] || '').trim();
                if (rowUserId === String(userId).trim()) {
                    matched = true;
                }
            }
            
            // Fall back to name+company match if no UserID match
            if (!matched && employeeName && company) {
                const fn = String(data[i][1] || '').trim();
                const mn = String(data[i][2] || '').trim();
                const ln = String(data[i][3] || '').trim();
                const rowComp = String(data[i][8] || '').trim();
                
                const fullNorm = (fn + (mn ? ' ' + mn : '') + (ln ? ' ' + ln : '')).trim().toLowerCase().replace(/\s+/g, '');
                const shortNorm = (fn + (ln ? ' ' + ln : '')).trim().toLowerCase().replace(/\s+/g, '');
                const empNorm = String(employeeName).trim().toLowerCase().replace(/\s+/g, '');
                
                if ((empNorm === fullNorm || empNorm === shortNorm) && rowComp.toLowerCase() === String(company).trim().toLowerCase()) {
                    matched = true;
                }
            }
            
            // Update bank account (column 4) if matched
            if (matched) {
                sheet.getRange(i + 1, 5).setValue(bankAccount);  // Column 5 is 1-indexed for column 4
                Logger.log('Updated WRI Masterlist bank account at row ' + (i + 1));
                return;
            }
        }
        Logger.log('No matching employee found in WRI Masterlist for: ' + employeeName);
    } catch (error) {
        Logger.log('syncBankAccountToWriMasterlist_ error: ' + error.message);
    }
}

// =====================================================================
// WRI EMPLOYEE MASTERLIST — IncomeDetails & 13MDetails live helpers
// =====================================================================

function getWriSheet_(sheetName, headerRow) {
    const ss = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
    let sh = ss.getSheetByName(sheetName);
    if (!sh) {
        sh = ss.insertSheet(sheetName);
        sh.getRange(1, 1, 1, headerRow.length).setValues([headerRow]).setFontWeight('bold').setBackground('#f3f4f6');
        sh.setFrozenRows(1);
    } else if (sh.getLastRow() === 0) {
        sh.getRange(1, 1, 1, headerRow.length).setValues([headerRow]).setFontWeight('bold').setBackground('#f3f4f6');
        sh.setFrozenRows(1);
    }
    return sh;
}

// -------------------------------------------------------------------------
// 13TH MONTH REPORT
// -------------------------------------------------------------------------
function get13thMonthReport(params) {
    params = params || {};
    const year      = parseInt(params.year || new Date().getFullYear(), 10);
    const viewMode  = params.viewMode  || 'ytd';   // ytd | yearly | monthly | summarized | projected
    const filterCo  = String(params.company  || '').trim();
    const filterEmp = String(params.employee || '').trim().toLowerCase();
    const filterSlot= (params.month !== null && params.month !== '' && params.month !== undefined) ? parseInt(params.month, 10) : -1;

    const ss = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
    const sh = ss.getSheetByName(WRI_13M_SHEET);
    if (!sh || sh.getLastRow() < 2) {
        return { year, viewMode, summary: [], detail: [], companies: [], employees: [], lastUploadedMonth: -1 };
    }

    const raw  = sh.getDataRange().getValues();
    const hdrN = raw[0].map(normalizeColName_);
    const gi   = (...ns) => { for (const n of ns) { const k = hdrN.indexOf(n); if (k !== -1) return k; } return -1; };

    const iUid  = gi('userid');
    const iId   = gi('id');
    const iFn   = gi('firstname', 'first_name');
    const iMn   = gi('middlename');
    const iLn   = gi('lastname', 'last_name');
    const iNm   = gi('name');
    const iCo   = gi('companyname');
    const iAmt  = gi('nthmonthpaybillable');
    const iSal  = gi('basicsalary');
    const iCEnd = gi('cutoffend');

    const today       = new Date();
    const currentYear = today.getFullYear();
    const currentMon  = today.getMonth(); // 0-based

    // empKey → { name, userid, company, isWs, slots[13], hasData[13], lastSal, projected12 }
    const empMap = {};

    for (let r = 1; r < raw.length; r++) {
        const row = raw[r];
        const co  = String(row[iCo] || '').trim();
        const uid = String(iUid >= 0 ? row[iUid] : (iId >= 0 ? row[iId] : '')).trim();
        if (!co || !uid) continue;
        if (filterCo && co !== filterCo) continue;

        const isWs     = co.toLowerCase().indexOf('workscale') !== -1;
        const cEndRaw  = row[iCEnd];
        const cEnd     = cEndRaw instanceof Date ? cEndRaw : (cEndRaw ? new Date(cEndRaw) : null);
        if (!cEnd || isNaN(cEnd.getTime())) continue;

        const cEndYear = cEnd.getFullYear();
        const cEndMon  = cEnd.getMonth(); // 0-based

        // Map to slot 0-12
        let slot = -1;
        if (!isWs) {
            if (cEndYear === year - 1 && cEndMon === 11)  slot = 0;             // Dec(Y-1)
            else if (cEndYear === year && cEndMon <= 10)  slot = cEndMon + 1;   // Jan→Nov = slots 1-11
        } else {
            if (cEndYear === year && cEndMon >= 0 && cEndMon <= 11) slot = cEndMon + 1; // Jan→Dec = slots 1-12
        }
        if (slot < 0) continue;

        let nm = String(iNm >= 0 ? row[iNm] : '').trim();
        if (!nm) {
            const fn = String(iFn >= 0 ? row[iFn] : '').trim();
            const mn = String(iMn >= 0 ? row[iMn] : '').trim();
            const ln = String(iLn >= 0 ? row[iLn] : '').trim();
            nm = [ln, fn, mn].filter(s => !!s).join(', ');
        }
        if (filterEmp && nm.toLowerCase().indexOf(filterEmp) === -1) continue;

        const empKey = co + '||' + uid;
        if (!empMap[empKey]) {
            empMap[empKey] = {
                name: nm, userid: uid, company: co, isWs,
                slots:   [0,0,0,0,0,0,0,0,0,0,0,0,0],
                hasData: [false,false,false,false,false,false,false,false,false,false,false,false,false],
                lastSal: 0, projected12: false
            };
        }
        const emp  = empMap[empKey];
        const amt  = parseFloat(row[iAmt]) || 0;
        const sal  = parseFloat(row[iSal]) || 0;
        emp.slots[slot]  += amt;
        emp.hasData[slot] = true;
        if (sal > emp.lastSal) emp.lastSal = sal;
    }

    // Apply view mode adjustments
    Object.keys(empMap).forEach(k => {
        const emp = empMap[k];
        // WS: project December if missing
        if (emp.isWs && !emp.hasData[12] && emp.lastSal > 0 &&
            (viewMode === 'projected' || viewMode === 'yearly')) {
            emp.slots[12]   = emp.lastSal / 12;
            emp.hasData[12] = true;
            emp.projected12 = true;
        }
        // YTD: zero out future slots
        if (viewMode === 'ytd') {
            for (let s = 0; s <= 12; s++) {
                const cal = slotToCalMonth_(s, year);
                if (cal.y > currentYear || (cal.y === currentYear && cal.m > currentMon)) {
                    emp.slots[s] = 0; emp.hasData[s] = false;
                }
            }
        }
        // Monthly: keep only the selected slot
        if (viewMode === 'monthly' && filterSlot >= 0) {
            for (let s = 0; s <= 12; s++) {
                if (s !== filterSlot) { emp.slots[s] = 0; emp.hasData[s] = false; }
            }
        }
        emp.total = emp.slots.reduce((a, b) => a + b, 0);
    });

    // Aggregate per company
    const compMap  = {};
    const coNames  = [];
    const empNames = [];

    Object.keys(empMap).forEach(k => {
        const emp = empMap[k];
        const co  = emp.company;
        if (coNames.indexOf(co) === -1) coNames.push(co);
        if (empNames.indexOf(emp.name) === -1) empNames.push(emp.name);
        if (!compMap[co]) {
            compMap[co] = {
                company: co,
                slots:    [0,0,0,0,0,0,0,0,0,0,0,0,0],
                projSlots:[false,false,false,false,false,false,false,false,false,false,false,false,false],
                total: 0, hc: 0, employees: []
            };
        }
        const cm = compMap[co];
        cm.hc++;
        cm.total += emp.total;
        for (let s = 0; s <= 12; s++) {
            cm.slots[s] += emp.slots[s];
            if (emp.projected12 && s === 12) cm.projSlots[12] = true;
        }
        cm.employees.push({ name: emp.name, userid: emp.userid, isWs: emp.isWs, slots: emp.slots.slice(), projected12: emp.projected12, total: emp.total });
    });

    coNames.sort();
    empNames.sort();

    const summary = coNames.map(co => compMap[co]);
    const detail  = coNames.map(co => ({
        company: co, hc: compMap[co].hc,
        employees: compMap[co].employees.slice().sort((a, b) => a.name.localeCompare(b.name))
    }));

    // Determine last uploaded month slot
    let lastUploadedMonth = -1;
    Object.keys(empMap).forEach(k => {
        const emp = empMap[k];
        for (let s = 12; s >= 0; s--) {
            if (emp.hasData[s] && !emp.projected12 && s > lastUploadedMonth) {
                lastUploadedMonth = s; break;
            }
        }
    });

    return { year, viewMode, lastUploadedMonth, companies: coNames, employees: empNames, summary, detail };
}

// Helper: map slot index 0-12 to calendar { y, m (0-based) }
// slot 0 = Dec(Y-1), slots 1-11 = Jan-Nov(Y), slot 12 = Dec(Y)
function slotToCalMonth_(slot, year) {
    if (slot === 0)  return { y: year - 1, m: 11 };
    if (slot <= 11)  return { y: year,     m: slot - 1 };
    return                  { y: year,     m: 11 };
}

function upsertToWri13MDetails_(rows, headers, batchId, uploadDate, uploadedBy, sourceFile) {
    if (!rows || rows.length === 0) return;
    const sh   = getWriSheet_(WRI_13M_SHEET, WRI_13M_COLS);
    const mapH = headers.map(normalizeColName_);
    const gi   = (...ns) => { for (const n of ns) { const i = mapH.indexOf(n); if (i !== -1) return i; } return -1; };
    const idIdx  = gi('id');
    const uidIdx = gi('userid');
    const fnIdx  = gi('firstname', 'first_name');
    const mnIdx  = gi('middlename');
    const lnIdx  = gi('lastname', 'last_name');
    const nmIdx  = gi('name');
    const cnIdx  = gi('companyname');
    const csIdx  = gi('cutoffstart');
    const ceIdx  = gi('cutoffend');
    const tdIdx  = gi('totaldays');
    const m13Idx = gi('nthmonthpaybillable', 'nthmonthpay', '13thmonth');
    const bsIdx  = gi('basicsalary', 'totalbsc', 'basicsalarytotal');
    const numVal = v => { if (typeof v === 'number') return v; const n = Number(String(v||'').replace(/[^0-9.-]/g,'')); return isNaN(n) ? 0 : n; };
    const fmtDate = v => { if (!v) return ''; const d = v instanceof Date ? v : new Date(v); if (isNaN(d.getTime())) return String(v).trim(); return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy'); };
    const existingRows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, WRI_13M_COLS.length).getValues() : [];
    const dedupSet = new Set(existingRows.map(r => `${r[0]}|${r[4]}|${r[6]}|${r[7]}`));
    const toAppend = [];
    rows.forEach(r => {
        const rowId  = idIdx  > -1 ? String(r[idIdx]  || '').trim() : '';
        const cStart = csIdx  > -1 ? fmtDate(r[csIdx]) : '';
        const cEnd   = ceIdx  > -1 ? fmtDate(r[ceIdx]) : '';
        const key = `${batchId}|${rowId}|${cStart}|${cEnd}`;
        if (dedupSet.has(key)) return;
        dedupSet.add(key);
        const gv = idx => idx > -1 && r[idx] !== undefined ? r[idx] : '';
        toAppend.push([
            batchId, uploadDate, uploadedBy, sourceFile,
            rowId,
            uidIdx > -1 ? String(r[uidIdx] || '').trim() : '',
            cStart, cEnd,
            gv(tdIdx),
            fnIdx > -1 ? String(r[fnIdx] || '').trim() : '',
            mnIdx > -1 ? String(r[mnIdx] || '').trim() : '',
            lnIdx > -1 ? String(r[lnIdx] || '').trim() : '',
            numVal(gv(m13Idx)),
            numVal(gv(bsIdx)),
            nmIdx > -1 ? String(r[nmIdx] || '').trim() : '',
            cnIdx > -1 ? String(r[cnIdx] || '').trim() : '',
        ]);
    });
    if (toAppend.length > 0) sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, WRI_13M_COLS.length).setValues(toAppend);
}

function removeWri13MDetailsByBatch_(batchId, company) {
    if (!batchId) return;
    try {
        const ss = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
        const sh = ss.getSheetByName(WRI_13M_SHEET);
        if (!sh || sh.getLastRow() < 2) return;
        const data = sh.getDataRange().getValues();
        // WRI_13M_COLS: col 0 = Batch ID, col 15 = companyname
        for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][0]).trim() !== String(batchId).trim()) continue;
            if (company && String(data[i][15]).trim().toLowerCase() !== String(company).trim().toLowerCase()) continue;
            sh.deleteRow(i + 1);
        }
    } catch(e) {}
}

function removeDeminimisDetailsByBatch_(batchId, company) {
    if (!batchId) return;
    try {
        const ss = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
        const sh = ss.getSheetByName(WRI_DEMIN_SHEET);
        if (!sh || sh.getLastRow() < 2) return;
        const data = sh.getDataRange().getValues();
        // WRI_DEMIN_COLS: col 0 = Batch ID, col 8 = companyname
        for (let i = data.length - 1; i >= 1; i--) {
            if (String(data[i][0]).trim() !== String(batchId).trim()) continue;
            if (company && String(data[i][8]).trim().toLowerCase() !== String(company).trim().toLowerCase()) continue;
            sh.deleteRow(i + 1);
        }
    } catch(e) {}
}

// =====================================================================
// DE MINIMIS DETAILS — TRANSACTION LOG
// =====================================================================

/**
 * Maps a benefit name string to the corresponding WRI_DEMIN_COLS column name.
 * Uses the same keys as WRI_DEMIN_COLS (indices 11-19).
 */
function mapBenefitNameToCol_(name) {
  const n = String(name || '').trim().toLowerCase();
  if (n === 'rice subsidy' || n === 'rice')                       return 'rice_subsidy';
  if (n === 'clothing' || n === 'uniform')                        return 'clothing';
  if (n === 'medical cash' || n === 'medical')                    return 'medical_cash';
  if (n === 'laundry')                                            return 'laundry';
  if (n === 'daily meal')                                         return 'daily_meal';
  if (n === 'transport' || n === 'transportation')                return 'transport';
  if (n === 'meal')                                               return 'meal';
  if (n === 'housing')                                            return 'housing';
  return 'other_benefits';
}

/**
 * Parses a benefits.other JSON string and returns an object keyed by
 * de minimis column name with { total, billableTotal } sums.
 * Handles nested structure: [{id, info:{name, amount, billabletoclient}}]
 */
function parseBenefitsByType_(str) {
  const result = {
    rice_subsidy:0, clothing:0, medical_cash:0, laundry:0,
    daily_meal:0, transport:0, meal:0, housing:0, other_benefits:0
  };
  const billable = Object.assign({}, result);
  if (!str) return { result, billable };
  try {
    let obj = str;
    if (typeof str === 'string') {
      const t = str.trim();
      if (!t.startsWith('[') && !t.startsWith('{')) return { result, billable };
      obj = JSON.parse(t);
    }
    if (!Array.isArray(obj)) return { result, billable };
    obj.forEach(item => {
      const info   = (item && item.info) ? item.info : item;
      const name   = String(info.name   || '').trim();
      const amount = Number(info.amount  || item.amount || 0);
      const isBill = String(info.billabletoclient || '').trim().toLowerCase() === 'true';
      const col    = mapBenefitNameToCol_(name);
      result[col]  = (result[col]  || 0) + amount;
      if (isBill) billable[col] = (billable[col] || 0) + amount;
    });
  } catch(e) {}
  return { result, billable };
}

/**
 * Appends de minimis rows to DeminimisDetails for each PayrollLines row
 * that has non-empty benefits.other. One row per employee per cutoff.
 * Dedup key: batchId|userid|cutoffStart|cutoffEnd
 */
function upsertToDeminimisDetails_(rows, headers, batchId, uploadDate, uploadedBy, sourceFile) {
  if (!rows || rows.length === 0) return;
  const sh   = getWriSheet_(WRI_DEMIN_SHEET, WRI_DEMIN_COLS);
  const mapH = headers.map(normalizeColName_);
  const gi   = (...ns) => { for (const n of ns) { const i = mapH.indexOf(n); if (i !== -1) return i; } return -1; };
  const uidIdx = gi('userid');
  const fnIdx  = gi('firstname', 'first_name');
  const mnIdx  = gi('middlename');
  const lnIdx  = gi('lastname', 'last_name');
  const cnIdx  = gi('companyname');
  const csIdx  = gi('cutoffstart');
  const ceIdx  = gi('cutoffend');
  const boIdx  = gi('benefitsother');   // normalizeColName_ strips dot: benefits.other → benefitsother
  if (uidIdx === -1 || boIdx === -1) return;

  const existingRows = sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, WRI_DEMIN_COLS.length).getValues()
    : [];
  // Dedup key: batchId|userid|cutoffStart|cutoffEnd (cols 0,4,9,10 in WRI_DEMIN_COLS)
  const dedupSet = new Set(existingRows.map(r => `${r[0]}|${r[4]}|${r[9]}|${r[10]}`));
  const toAppend = [];

  rows.forEach(r => {
    const benStr = r[boIdx] !== undefined ? String(r[boIdx] || '').trim() : '';
    if (!benStr || benStr === '[]' || benStr === '{}') return;  // skip rows with no benefits
    const uid    = uidIdx > -1 ? String(r[uidIdx] || '').trim() : '';
    if (!uid) return;
    const cStart = csIdx > -1 ? String(r[csIdx] || '').trim() : '';
    const cEnd   = ceIdx > -1 ? String(r[ceIdx] || '').trim() : '';
    const key    = `${batchId}|${uid}|${cStart}|${cEnd}`;
    if (dedupSet.has(key)) return;
    dedupSet.add(key);

    const { result, billable } = parseBenefitsByType_(benStr);
    const totalDemin   = Object.values(result).reduce((a, b) => a + b, 0);
    const billTotal    = Object.values(billable).reduce((a, b) => a + b, 0);
    const nonBillTotal = totalDemin - billTotal;

    toAppend.push([
      batchId, uploadDate, uploadedBy, sourceFile,
      uid,
      fnIdx > -1 ? String(r[fnIdx] || '').trim() : '',
      mnIdx > -1 ? String(r[mnIdx] || '').trim() : '',
      lnIdx > -1 ? String(r[lnIdx] || '').trim() : '',
      cnIdx > -1 ? String(r[cnIdx] || '').trim() : '',
      cStart, cEnd,
      result.rice_subsidy, result.clothing, result.medical_cash, result.laundry,
      result.daily_meal,   result.transport, result.meal, result.housing, result.other_benefits,
      totalDemin, billTotal, nonBillTotal
    ]);
  });

  if (toAppend.length > 0) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, WRI_DEMIN_COLS.length).setValues(toAppend);
  }
}

// =====================================================================
// EMPLOYEE INCOME LEDGER
// Append-only sheet: one row per employee per cutoff period.
// Source of truth for accumulated income — feeds BIR2316Data rebuild
// and the payroll accrual JE.
// =====================================================================

const EIL_SHEET = 'EmployeeIncomeLedger';
const EIL_HEADERS = [
  // Group A — Audit identity
  'ledger_id','batch_id','source_file','uploaded_at','uploaded_by',
  'is_amendment','amends_ledger_id','amendment_reason',
  // Group B — Employee snapshot
  'userid','last_name','first_name','middlename',
  'company_name','employment_type','work_region','is_mwe',
  // Group C — Period
  'cutoff_start','cutoff_end','total_days','fiscal_year',
  // Group D — Pay components
  'regular_hours','regular_rate','regular_amount',
  'overtime_hours','overtime_rate','overtime_amount',
  'nd_hours','nd_rate','nd_amount',
  'dod_hours','dod_rate','dod_amount',
  'dod_ot_hours','dod_ot_rate','dod_ot_amount',
  'spl_hol_amount','spl_hol_ot_amount',
  'spl_hol_dof_amount','spl_hol_dof_ot_amount',
  'lgl_hol_amount','lgl_hol_ot_amount',
  'lgl_hol_dof_amount','lgl_hol_dof_ot_amount',
  'training_days','training_ot_amount','training_lates_amount',
  'incentives','allowance','adjustment','nth_month_pay',
  'basic_salary_hris','gross_pay_hris',
  // Group E — De minimis detail
  'demin_rice_subsidy','demin_clothing','demin_medical_cash','demin_laundry',
  'demin_daily_meal','demin_transport','demin_meal','demin_housing','demin_other',
  // Group F — EE deductions
  'sss_ee','sss_loan','phic_ee','hdmf_ee','hdmf_loan',
  'withholding_tax','total_ee_deduction',
  // Group G — ER share
  'sss_er','phic_er','hdmf_er',
  // Group H — Reconciliation
  'computed_gross','gross_variance',
  'net_pay_hris','computed_net','net_variance'
];

/**
 * Returns or creates the EmployeeIncomeLedger sheet on the WRI Employee Masterlist.
 */
function getEilSheet_() {
  var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
  var sh = wriSS.getSheetByName(EIL_SHEET);
  if (!sh) {
    sh = wriSS.insertSheet(EIL_SHEET);
    sh.getRange(1, 1, 1, EIL_HEADERS.length).setValues([EIL_HEADERS])
      .setFontWeight('bold').setBackground('#d9ead3');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Removes EmployeeIncomeLedger rows belonging to a rolled-back batchId.
 */
function removeEilByBatch_(batchId, company) {
  var sh = getEilSheet_();
  if (sh.getLastRow() < 2) return;
  var data = sh.getDataRange().getValues();
  var batchCol = EIL_HEADERS.indexOf('batch_id');    // col 1
  var compCol  = EIL_HEADERS.indexOf('company_name'); // col 12
  var toDelete = [];
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][batchCol] || '').trim() !== String(batchId).trim()) continue;
    if (company && compCol > -1 && String(data[i][compCol] || '').trim().toLowerCase() !== String(company).trim().toLowerCase()) continue;
    toDelete.push(i + 1);
  }
  toDelete.forEach(function(r) { sh.deleteRow(r); });
}

/**
 * Upserts rows into EmployeeIncomeLedger for a given HRIS upload batch.
 * Dedup key: ledger_id = batch_id + '-' + userid + '-' + cutoffend.
 * Writes warnings to AccrualWarnings sheet when gross_variance > ±1.00.
 *
 * @param {Array[]} rows        - raw PayrollLines rows (already appended)
 * @param {Array}   headers     - header row for those PayrollLines rows
 * @param {string}  batchId     - upload batch identifier
 * @param {string}  uploadDate  - formatted upload timestamp string
 * @param {string}  uploadedBy  - uploader email
 * @param {string}  sourceFile  - source filename / Drive URL
 */
function upsertToEmployeeIncomeLedger_(rows, headers, batchId, uploadDate, uploadedBy, sourceFile) {
  if (!rows || rows.length === 0) return;

  var sh = getEilSheet_();
  var mapH = headers.map(normalizeColName_);
  var gi = function() {
    for (var a = 0; a < arguments.length; a++) {
      var idx = mapH.indexOf(arguments[a]);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  // Build dedup set from existing ledger rows
  var existingRows = sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
    : [];
  var dedupSet = new Set(existingRows.map(function(r) { return String(r[0] || '').trim(); }));

  // Load Masterlist for is_mwe lookup
  var wriSS    = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
  var mlSh     = wriSS.getSheetByName(WRI_MASTERLIST_SHEET_NAME);
  var mlMap    = {};
  if (mlSh && mlSh.getLastRow() > 1) {
    var mlVals = mlSh.getDataRange().getValues();
    var mlH    = mlVals[0].map(normalizeColName_);
    var mUid   = mlH.indexOf('userid');
    var mMwe   = mlH.indexOf('ismwe');
    var mEType = mlH.indexOf('employmenttype');
    var mReg   = mlH.indexOf('workregion');
    for (var mi = 1; mi < mlVals.length; mi++) {
      var uid = mUid > -1 ? String(mlVals[mi][mUid] || '').trim() : '';
      if (!uid) continue;
      mlMap[uid] = {
        is_mwe:          mMwe   > -1 ? String(mlVals[mi][mMwe]   || '').toUpperCase() : 'FALSE',
        employment_type: mEType > -1 ? String(mlVals[mi][mEType] || '').trim() : '',
        work_region:     mReg   > -1 ? String(mlVals[mi][mReg]   || '').trim() : ''
      };
    }
  }

  // Load DeminimisDetails for this batch into uid|cutoffend map
  var deminBatch = {};
  var deminSh    = wriSS.getSheetByName(WRI_DEMIN_SHEET);
  if (deminSh && deminSh.getLastRow() > 1) {
    var dData  = deminSh.getDataRange().getValues();
    var dH     = dData[0].map(function(h) { return String(h).toLowerCase().trim(); });
    var dBatch = dH.indexOf('batch id');
    var dUid   = dH.indexOf('userid');
    var dCe    = dH.indexOf('cutoffend');
    var dCols  = ['rice_subsidy','clothing','medical_cash','laundry',
                  'daily_meal','transport','meal','housing','other_benefits'];
    var dIdxs  = dCols.map(function(c) { return dH.indexOf(c); });
    for (var di = 1; di < dData.length; di++) {
      if (dBatch > -1 && String(dData[di][dBatch] || '').trim() !== String(batchId).trim()) continue;
      var dk = String(dData[di][dUid] || '').trim() + '|' + String(dData[di][dCe] || '').trim();
      if (!deminBatch[dk]) deminBatch[dk] = {};
      dCols.forEach(function(col, ci) {
        deminBatch[dk][col] = (deminBatch[dk][col] || 0) + (Number(dData[di][dIdxs[ci]]) || 0);
      });
    }
  }

  var numV = function(v) {
    if (typeof v === 'number') return v;
    var n = Number(String(v || '').replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  var parseJson = function(str, key) {
    if (!str) return 0;
    try {
      var obj = (typeof str === 'string') ? JSON.parse(str) : str;
      if (Array.isArray(obj)) return obj.reduce(function(s, x) { return s + (Number(x[key]) || 0); }, 0);
      return Number(obj[key]) || 0;
    } catch(e) { return 0; }
  };

  var sumJsonArr = function(str, key) {
    // Handles adjustments array: [{amount:...}, ...]
    if (!str) return 0;
    try {
      var obj = typeof str === 'string' ? JSON.parse(str) : str;
      if (Array.isArray(obj)) return obj.reduce(function(s, x) { return s + (Number(x[key] || x.amount || 0)); }, 0);
      return Number(obj[key] || obj.amount || 0);
    } catch(e) { return 0; }
  };

  // Column index helpers
  var iUid    = gi('userid');
  var iFn     = gi('firstname', 'first_name');
  var iMn     = gi('middlename');
  var iLn     = gi('lastname', 'last_name');
  var iCn     = gi('companyname');
  var iCs     = gi('cutoffstart');
  var iCe     = gi('cutoffend');
  var iTd     = gi('totaldays');
  var iEtype  = gi('employmenttype');
  var iRegion = gi('workregion');
  var iRegH   = gi('regularday.hours',  'regulardayhours');
  var iRegR   = gi('regularday.rate',   'regulardayrate');
  var iRegA   = gi('regularday.amount', 'regulardayamount', 'regular');
  var iOtH    = gi('regularovertime.hours',  'regularovertimehours');
  var iOtR    = gi('regularovertime.rate',   'regularovertimerate');
  var iOtA    = gi('regularovertime.amount', 'regularovertimeamount', 'overtime');
  var iNdH    = gi('nightdifferential.hours',  'nightdifferentialhours');
  var iNdR    = gi('nightdifferential.rate',   'nightdifferentialrate');
  var iNdA    = gi('nightdifferential.amount', 'nightdifferentialamount', 'nd');
  var iDodH   = gi('dayoffduty.hours',  'dayoffdutyhours');
  var iDodR   = gi('dayoffduty.rate',   'dayoffdutyrate');
  var iDodA   = gi('dayoffduty.amount', 'dayoffdutyamount', 'dod');
  var iDotH   = gi('excessdayoffduty.hours',  'excessdayoffdutyhours');
  var iDotR   = gi('excessdayoffduty.rate',   'excessdayoffdutyrate');
  var iDotA   = gi('excessdayoffduty.amount', 'excessdayoffdutyamount');
  var iSplS   = gi('specialnonworkingholidaysummary');
  var iSplOS  = gi('specialnonworkingholidayovertimesummary');
  var iSplDS  = gi('specialnonworkingholidaydayoffsummary');
  var iSplDOS = gi('specialnonworkingholidaydayoffovertimesummary');
  var iLglS   = gi('legalholidaysummary');
  var iLglOS  = gi('legalholidayovertimesummary');
  var iLglDS  = gi('legalholidaydayoffsummary');
  var iLglDOS = gi('legalholidaydayoffovertimesummary');
  var iTrDay  = gi('trainingday');
  var iTrOt   = gi('trainingovertime');
  var iTrLt   = gi('traininglates.amount', 'traininglatesamount');
  var iInc    = gi('incentives');
  var iBenOth = gi('benefitsother');   // benefits.other normalizes to benefitsother
  var iAdj    = gi('adjustments');
  var iNth    = gi('nthmonthpaybillable', 'nthmonthpay');
  var iBsc    = gi('basicsalary', 'totalbsc');
  var iGross  = gi('grosspay', 'totalgrosspay');
  var iSss    = gi('deductions.sss', 'deductionssss');
  var iPhic   = gi('deductions.philhealth', 'deductionsphilhealth');
  var iHdmf   = gi('deductions.pagibig', 'deductionspagibig');
  var iTax    = gi('tax', 'withholdingtax');
  var iTotDed = gi('totaleededuction', 'totaldeduction');
  var iNet    = gi('netpay', 'payslipnetpay');

  var toAppend  = [];
  var warnings  = [];
  var now       = new Date();

  rows.forEach(function(r) {
    var uid = iUid > -1 ? String(r[iUid] || '').trim() : '';
    if (!uid) return;
    var cEnd = iCe > -1 ? String(r[iCe] || '').trim() : '';
    var ledgerId = batchId + '-' + uid + '-' + cEnd;
    if (dedupSet.has(ledgerId)) return;
    dedupSet.add(ledgerId);

    var cStart    = iCs > -1 ? String(r[iCs] || '').trim() : '';
    var ceDate    = cEnd ? new Date(cEnd) : null;
    var fiscalYr  = (ceDate && !isNaN(ceDate.getTime())) ? ceDate.getFullYear() : '';
    var ml        = mlMap[uid] || {};

    // Pay components
    var regH   = numV(iRegH  > -1 ? r[iRegH]  : 0);
    var regR   = numV(iRegR  > -1 ? r[iRegR]  : 0);
    var regA   = numV(iRegA  > -1 ? r[iRegA]  : 0);
    var otH    = numV(iOtH   > -1 ? r[iOtH]   : 0);
    var otR    = numV(iOtR   > -1 ? r[iOtR]   : 0);
    var otA    = numV(iOtA   > -1 ? r[iOtA]   : 0);
    var ndH    = numV(iNdH   > -1 ? r[iNdH]   : 0);
    var ndR    = numV(iNdR   > -1 ? r[iNdR]   : 0);
    var ndA    = numV(iNdA   > -1 ? r[iNdA]   : 0);
    var dodH   = numV(iDodH  > -1 ? r[iDodH]  : 0);
    var dodR   = numV(iDodR  > -1 ? r[iDodR]  : 0);
    var dodA   = numV(iDodA  > -1 ? r[iDodA]  : 0);
    var dotH   = numV(iDotH  > -1 ? r[iDotH]  : 0);
    var dotR   = numV(iDotR  > -1 ? r[iDotR]  : 0);
    var dotA   = numV(iDotA  > -1 ? r[iDotA]  : 0);
    var splS   = numV(iSplS  > -1 ? r[iSplS]  : 0);
    var splOS  = numV(iSplOS > -1 ? r[iSplOS] : 0);
    var splDS  = numV(iSplDS > -1 ? r[iSplDS] : 0);
    var splDOS = numV(iSplDOS > -1 ? r[iSplDOS] : 0);
    var lglS   = numV(iLglS  > -1 ? r[iLglS]  : 0);
    var lglOS  = numV(iLglOS > -1 ? r[iLglOS] : 0);
    var lglDS  = numV(iLglDS > -1 ? r[iLglDS] : 0);
    var lglDOS = numV(iLglDOS > -1 ? r[iLglDOS] : 0);
    var trDay  = numV(iTrDay > -1 ? r[iTrDay]  : 0);
    var trOt   = numV(iTrOt  > -1 ? r[iTrOt]   : 0);
    var trLt   = numV(iTrLt  > -1 ? r[iTrLt]   : 0);
    var inc    = numV(iInc   > -1 ? r[iInc]    : 0);
    var nth    = numV(iNth   > -1 ? r[iNth]    : 0);
    var bscH   = numV(iBsc   > -1 ? r[iBsc]    : 0);  // raw HRIS basicsalary — reconciliation only
    var grossH = numV(iGross > -1 ? r[iGross]  : 0);  // raw HRIS grosspay — reconciliation only

    // Allowance from benefits.other JSON
    var benStr  = iBenOth > -1 ? String(r[iBenOth] || '').trim() : '';
    var alwAmt  = 0;
    if (benStr && benStr !== '[]' && benStr !== '{}') {
      try {
        var benArr = JSON.parse(benStr);
        if (Array.isArray(benArr)) {
          benArr.forEach(function(item) {
            var info = (item && item.info) ? item.info : item;
            alwAmt += Number(info.amount || item.amount || 0);
          });
        }
      } catch(e) {}
    }

    // Adjustment — sum all adjustments.* indexed columns
    var adjAmt = 0;
    if (iAdj > -1) {
      var adjStr = String(r[iAdj] || '').trim();
      adjAmt = sumJsonArr(adjStr, 'amount');
      if (!adjAmt) adjAmt = numV(r[iAdj]);
    }
    // Also check adjustments.0, adjustments.1 etc. as separate columns
    var adjIdx0 = gi('adjustments.0', 'adjustments0');
    var adjIdx1 = gi('adjustments.1', 'adjustments1');
    if (adjIdx0 > -1 && !adjAmt) adjAmt += numV(r[adjIdx0]);
    if (adjIdx1 > -1) adjAmt += numV(r[adjIdx1]);

    // De minimis from the DeminimisDetails batch map
    var dk    = uid + '|' + cEnd;
    var demin = deminBatch[dk] || {};
    var dRice = demin.rice_subsidy || 0;
    var dClot = demin.clothing     || 0;
    var dMed  = demin.medical_cash || 0;
    var dLaun = demin.laundry      || 0;
    var dMeal = demin.daily_meal   || 0;
    var dTrns = demin.transport    || 0;
    var dMl   = demin.meal         || 0;
    var dHous = demin.housing      || 0;
    var dOth  = demin.other_benefits || 0;

    // Deductions
    var sssRaw  = iSss  > -1 ? r[iSss]  : 0;
    var phicRaw = iPhic > -1 ? r[iPhic] : 0;
    var hdmfRaw = iHdmf > -1 ? r[iHdmf] : 0;
    var sssStr  = typeof sssRaw  === 'object' && sssRaw  !== null ? JSON.stringify(sssRaw)  : String(sssRaw  || '');
    var phicStr = typeof phicRaw === 'object' && phicRaw !== null ? JSON.stringify(phicRaw) : String(phicRaw || '');
    var hdmfStr = typeof hdmfRaw === 'object' && hdmfRaw !== null ? JSON.stringify(hdmfRaw) : String(hdmfRaw || '');
    var sssEE   = sssStr.indexOf('{') >= 0  ? parseJson(sssStr,  'employeeContribution') : numV(sssRaw);
    var sssLn   = sssStr.indexOf('{') >= 0  ? parseJson(sssStr,  'loan')                : 0;
    var sssER   = sssStr.indexOf('{') >= 0  ? parseJson(sssStr,  'employerContribution') : 0;
    var phicEE  = phicStr.indexOf('{') >= 0 ? parseJson(phicStr, 'employeeContribution') : numV(phicRaw);
    var phicER  = phicStr.indexOf('{') >= 0 ? parseJson(phicStr, 'employerContribution') : 0;
    var hdmfEE  = hdmfStr.indexOf('{') >= 0 ? parseJson(hdmfStr, 'employeeContribution') : numV(hdmfRaw);
    var hdmfLn  = hdmfStr.indexOf('{') >= 0 ? parseJson(hdmfStr, 'loan')                : 0;
    var hdmfER  = hdmfStr.indexOf('{') >= 0 ? parseJson(hdmfStr, 'employerContribution') : 0;
    var tax     = numV(iTax    > -1 ? r[iTax]    : 0);
    var totDed  = numV(iTotDed > -1 ? r[iTotDed] : 0) || (sssEE + sssLn + phicEE + hdmfEE + hdmfLn);
    var netH    = numV(iNet    > -1 ? r[iNet]    : 0);

    // Reconciliation
    var computedGross = regA + otA + ndA + dodA + dotA
      + splS + splOS + splDS + splDOS
      + lglS + lglOS + lglDS + lglDOS
      + trOt + trLt
      + inc + alwAmt + adjAmt + nth
      + dRice + dClot + dMed + dLaun + dMeal + dTrns + dMl + dHous + dOth;
    var grossVariance  = grossH - computedGross;
    var computedNet    = computedGross - totDed;
    var netVariance    = netH - computedNet;

    if (Math.abs(grossVariance) > 1.00) {
      warnings.push({
        batch_id:      batchId,
        userid:        uid,
        cutoff_end:    cEnd,
        gross_hris:    grossH,
        computed_gross: computedGross,
        gross_variance: grossVariance,
        flagged_at:    now
      });
    }

    toAppend.push([
      ledgerId, batchId, sourceFile, uploadDate, uploadedBy,
      false, '', '',
      uid,
      iLn > -1 ? String(r[iLn] || '').trim() : '',
      iFn > -1 ? String(r[iFn] || '').trim() : '',
      iMn > -1 ? String(r[iMn] || '').trim() : '',
      iCn > -1 ? String(r[iCn] || '').trim() : '',
      (iEtype > -1 ? String(r[iEtype] || '') : '') || ml.employment_type || '',
      (iRegion > -1 ? String(r[iRegion] || '') : '') || ml.work_region || '',
      ml.is_mwe || 'FALSE',
      cStart, cEnd,
      numV(iTd > -1 ? r[iTd] : 0), fiscalYr,
      regH, regR, regA,
      otH,  otR,  otA,
      ndH,  ndR,  ndA,
      dodH, dodR, dodA,
      dotH, dotR, dotA,
      splS, splOS, splDS, splDOS,
      lglS, lglOS, lglDS, lglDOS,
      trDay, trOt, trLt,
      inc, alwAmt, adjAmt, nth,
      bscH, grossH,
      dRice, dClot, dMed, dLaun, dMeal, dTrns, dMl, dHous, dOth,
      sssEE, sssLn, phicEE, hdmfEE, hdmfLn, tax, totDed,
      sssER, phicER, hdmfER,
      computedGross, grossVariance,
      netH, computedNet, netVariance
    ]);
  });

  if (toAppend.length > 0) {
    sh.getRange(sh.getLastRow() + 1, 1, toAppend.length, EIL_HEADERS.length).setValues(toAppend);
    var moneyCols = sh.getRange(2, 1, sh.getLastRow() - 1, EIL_HEADERS.length);
    // Format fiscal_year col as plain number (col index 19)
    sh.getRange(2, 20, sh.getLastRow() - 1, 1).setNumberFormat('0');
  }

  if (warnings.length > 0) {
    _writeAccrualWarnings_(warnings);
  }

  Logger.log('upsertToEmployeeIncomeLedger_: ' + toAppend.length + ' rows written, '
    + warnings.length + ' gross_variance warnings for batchId=' + batchId);
}

/**
 * Writes gross_variance warnings to the AccrualWarnings sheet.
 */
function _writeAccrualWarnings_(warnings) {
  var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
  var sh    = wriSS.getSheetByName('AccrualWarnings');
  if (!sh) {
    sh = wriSS.insertSheet('AccrualWarnings');
    sh.getRange(1, 1, 1, 7).setValues([[
      'batch_id','userid','cutoff_end',
      'gross_hris','computed_gross','gross_variance','flagged_at'
    ]]).setFontWeight('bold').setBackground('#fce5cd');
    sh.setFrozenRows(1);
  }
  var rows = warnings.map(function(w) {
    return [w.batch_id, w.userid, w.cutoff_end,
            w.gross_hris, w.computed_gross, w.gross_variance, w.flagged_at];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
}

// =====================================================================

/**
 * One-time full rebuild of DeminimisDetails from all years in YearlyDatabases.
 * Wipes the sheet first; then scans every PayrollLines sheet.
 */
function _rebuildDeminimisDetails_() {
  const wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
  // Wipe and recreate the sheet
  let sh = wriSS.getSheetByName(WRI_DEMIN_SHEET);
  if (sh) wriSS.deleteSheet(sh);
  sh = wriSS.insertSheet(WRI_DEMIN_SHEET);
  sh.getRange(1, 1, 1, WRI_DEMIN_COLS.length).setValues([WRI_DEMIN_COLS]).setFontWeight('bold').setBackground('#f3f4f6');
  sh.setFrozenRows(1);
  Logger.log('_rebuildDeminimisDetails_: sheet wiped and recreated.');

  // Load years from YearlyDatabases registry
  const dbSS  = getPayrollDB_();
  const regSh = dbSS.getSheetByName('YearlyDatabases');
  if (!regSh || regSh.getLastRow() < 2) { Logger.log('_rebuildDeminimisDetails_: no YearlyDatabases rows found.'); return; }
  const regData = regSh.getDataRange().getValues();
  const years = [];
  for (let r = 1; r < regData.length; r++) {
    const yr = parseInt(regData[r][0], 10);
    if (!isNaN(yr) && yr > 2000 && yr <= 2100 && years.indexOf(yr) === -1) years.push(yr);
  }
  Logger.log('_rebuildDeminimisDetails_: processing years: ' + years.join(', '));

  const allRows = [];
  years.forEach(year => {
    try {
      const yrSS  = getYearlySpreadsheet_(year);
      const plSh  = yrSS ? yrSS.getSheetByName('PayrollLines') : null;
      if (!plSh || plSh.getLastRow() < 2) return;
      const plData  = plSh.getDataRange().getValues();
      const plH     = plData[0];
      const mapH    = plH.map(normalizeColName_);
      const gi      = (...ns) => { for (const n of ns) { const i = mapH.indexOf(n); if (i !== -1) return i; } return -1; };
      const boIdx   = gi('benefitsother');
      const bidIdx  = gi('batchid');
      const uidIdx  = gi('userid');
      const fnIdx   = gi('firstname', 'first_name');
      const mnIdx   = gi('middlename');
      const lnIdx   = gi('lastname', 'last_name');
      const cnIdx   = gi('companyname');
      const csIdx   = gi('cutoffstart');
      const ceIdx   = gi('cutoffend');
      if (boIdx === -1 || uidIdx === -1) return;
      const fmtDate = v => {
        if (!v) return '';
        const d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) return String(v).trim();
        return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy');
      };
      const dedupSet = new Set();
      for (let i = 1; i < plData.length; i++) {
        const r      = plData[i];
        const benStr = String(r[boIdx] || '').trim();
        if (!benStr || benStr === '[]' || benStr === '{}') continue;
        const uid    = String(r[uidIdx] || '').trim();
        if (!uid) continue;
        const cStart  = csIdx > -1 ? fmtDate(r[csIdx]) : '';
        const cEnd    = ceIdx > -1 ? fmtDate(r[ceIdx]) : '';
        // Reconstruct batchId from batchid column, fall back to year|uid|cutoff composite
        const batchId = bidIdx > -1 && r[bidIdx] ? String(r[bidIdx]).trim() : `${year}|rebuild`;
        const key     = `${batchId}|${uid}|${cStart}|${cEnd}`;
        if (dedupSet.has(key)) continue;
        dedupSet.add(key);
        const { result, billable } = parseBenefitsByType_(benStr);
        const totalDemin   = Object.values(result).reduce((a, b) => a + b, 0);
        const billTotal    = Object.values(billable).reduce((a, b) => a + b, 0);
        allRows.push([
          batchId, String(year), '(rebuild)', '',
          uid,
          fnIdx > -1 ? String(r[fnIdx] || '').trim() : '',
          mnIdx > -1 ? String(r[mnIdx] || '').trim() : '',
          lnIdx > -1 ? String(r[lnIdx] || '').trim() : '',
          cnIdx > -1 ? String(r[cnIdx] || '').trim() : '',
          cStart, cEnd,
          result.rice_subsidy, result.clothing, result.medical_cash, result.laundry,
          result.daily_meal,   result.transport, result.meal, result.housing, result.other_benefits,
          totalDemin, billTotal, totalDemin - billTotal
        ]);
      }
      Logger.log('_rebuildDeminimisDetails_: year ' + year + ' → ' + allRows.length + ' rows so far.');
    } catch(e) {
      Logger.log('_rebuildDeminimisDetails_: error on year ' + year + ': ' + e.message);
    }
  });

  if (allRows.length > 0) {
    sh.getRange(2, 1, allRows.length, WRI_DEMIN_COLS.length).setValues(allRows);
    Logger.log('_rebuildDeminimisDetails_: wrote ' + allRows.length + ' rows.');
  } else {
    Logger.log('_rebuildDeminimisDetails_: no de minimis rows found across all years.');
  }
}

// =====================================================================
// REBUILD 13M DETAILS — ONE-TIME FULL REBUILD FROM ALL PAYROLLLINES YEARS
// =====================================================================

/**
 * Wipes 13MDetails and rebuilds it from scratch by scanning every year's
 * PayrollLines sheet for rows where nthmonthpaybillable > 0.
 * Dedup key: batchId|rowId|cutoffStart|cutoffEnd (same as incremental upsert).
 */
function _rebuildWri13MDetails_() {
  const wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
  // Wipe and recreate the sheet
  let sh = wriSS.getSheetByName(WRI_13M_SHEET);
  if (sh) wriSS.deleteSheet(sh);
  sh = wriSS.insertSheet(WRI_13M_SHEET);
  sh.getRange(1, 1, 1, WRI_13M_COLS.length).setValues([WRI_13M_COLS]).setFontWeight('bold').setBackground('#f3f4f6');
  sh.setFrozenRows(1);
  Logger.log('_rebuildWri13MDetails_: sheet wiped and recreated.');

  // Load years from YearlyDatabases registry
  const dbSS  = getPayrollDB_();
  const regSh = dbSS.getSheetByName('YearlyDatabases');
  if (!regSh || regSh.getLastRow() < 2) { Logger.log('_rebuildWri13MDetails_: no YearlyDatabases rows found.'); return; }
  const regData = regSh.getDataRange().getValues();
  const years = [];
  for (let r = 1; r < regData.length; r++) {
    const yr = parseInt(regData[r][0], 10);
    if (!isNaN(yr) && yr > 2000 && yr <= 2100 && years.indexOf(yr) === -1) years.push(yr);
  }
  Logger.log('_rebuildWri13MDetails_: processing years: ' + years.join(', '));

  const numVal = v => { if (typeof v === 'number') return v; const n = Number(String(v||'').replace(/[^0-9.-]/g,'')); return isNaN(n) ? 0 : n; };
  const fmtDate = v => { if (!v) return ''; const d = v instanceof Date ? v : new Date(v); if (isNaN(d.getTime())) return String(v).trim(); return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/dd/yyyy'); };
  const allRows = [];
  const dedupSet = new Set();

  years.forEach(year => {
    try {
      const yrSS  = getYearlySpreadsheet_(year);
      const plSh  = yrSS ? yrSS.getSheetByName('PayrollLines') : null;
      if (!plSh || plSh.getLastRow() < 2) { Logger.log('_rebuildWri13MDetails_: no PayrollLines for year ' + year); return; }
      const plData = plSh.getDataRange().getValues();
      const mapH   = plData[0].map(normalizeColName_);
      const gi     = (...ns) => { for (const n of ns) { const i = mapH.indexOf(n); if (i !== -1) return i; } return -1; };
      const idIdx  = gi('id');
      const uidIdx = gi('userid');
      const fnIdx  = gi('firstname', 'first_name');
      const mnIdx  = gi('middlename');
      const lnIdx  = gi('lastname', 'last_name');
      const nmIdx  = gi('name');
      const cnIdx  = gi('companyname');
      const csIdx  = gi('cutoffstart');
      const ceIdx  = gi('cutoffend');
      const tdIdx  = gi('totaldays');
      const m13Idx = gi('nthmonthpaybillable', 'nthmonthpay', '13thmonth');
      const bsIdx  = gi('basicsalary', 'totalbsc', 'basicsalarytotal');
      const bidIdx = gi('batchid');
      if (uidIdx === -1 || m13Idx === -1) { Logger.log('_rebuildWri13MDetails_: missing required columns for year ' + year); return; }
      let yearCount = 0;
      for (let i = 1; i < plData.length; i++) {
        const r    = plData[i];
        const m13  = numVal(m13Idx > -1 ? r[m13Idx] : 0);
        if (m13 <= 0) continue;  // skip rows with no 13th month pay
        const rowId  = idIdx  > -1 ? String(r[idIdx]  || '').trim() : String(i);
        const cStart = csIdx  > -1 ? fmtDate(r[csIdx]) : '';
        const cEnd   = ceIdx  > -1 ? fmtDate(r[ceIdx]) : '';
        const batchId = bidIdx > -1 && r[bidIdx] ? String(r[bidIdx]).trim() : String(year) + '|rebuild';
        const key = `${batchId}|${rowId}|${cStart}|${cEnd}`;
        if (dedupSet.has(key)) continue;
        dedupSet.add(key);
        const gv = idx => idx > -1 && r[idx] !== undefined ? r[idx] : '';
        allRows.push([
          batchId, String(year), '(rebuild)', '',
          rowId,
          uidIdx > -1 ? String(r[uidIdx] || '').trim() : '',
          cStart, cEnd,
          gv(tdIdx),
          fnIdx > -1 ? String(r[fnIdx] || '').trim() : '',
          mnIdx > -1 ? String(r[mnIdx] || '').trim() : '',
          lnIdx > -1 ? String(r[lnIdx] || '').trim() : '',
          m13,
          numVal(gv(bsIdx)),
          nmIdx > -1 ? String(r[nmIdx] || '').trim() : '',
          cnIdx > -1 ? String(r[cnIdx] || '').trim() : '',
        ]);
        yearCount++;
      }
      Logger.log('_rebuildWri13MDetails_: year ' + year + ' → ' + yearCount + ' rows.');
    } catch(e) {
      Logger.log('_rebuildWri13MDetails_: error on year ' + year + ': ' + e.message);
    }
  });

  if (allRows.length > 0) {
    sh.getRange(2, 1, allRows.length, WRI_13M_COLS.length).setValues(allRows);
    Logger.log('_rebuildWri13MDetails_: wrote ' + allRows.length + ' total rows.');
  } else {
    Logger.log('_rebuildWri13MDetails_: no 13th month rows found across all years.');
  }
}

// =====================================================================
// BIR 2316 DATA BOOTSTRAP — ONE-TIME REPAIR UTILITY
// Run from Apps Script editor to:
//   1. Add BIR profile columns to WRI Masterlist sheet (auto, non-destructive)
//   2. Create CompanyRegistry sheet (employer TIN/address per company)
//   3. Rebuild BIR2316Data sheet (per-employee, per-year YTD aggregates)
//
// HOW TO RUN:
//   - Current year only:  bootstrapBir2316Data()
//   - Specific year:      bootstrapBir2316Data(2025)
//   - All years:          bootstrapBir2316Data('all')
// =====================================================================

function bootstrapBir2316Data(targetYear) {
  var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
  _ensureMasterlistBirColumns_(wriSS);
  Logger.log('bootstrapBir2316Data: Masterlist BIR columns ensured.');
  var rowsWritten = _rebuildBir2316Data_(wriSS, targetYear);
  var msg = 'bootstrapBir2316Data COMPLETE. Rows written to BIR2316Data: ' + rowsWritten;
  Logger.log(msg);
  return msg;
}

// =====================================================================
// LIGHTWEIGHT BIR 2316 REFRESH — run after changing Income Tax caps
// in Settings (Settings > Income Tax tab), or after any de minimis fix.
// Does NOT migrate Masterlist schema or rebuild 13MDetails.
//
// HOW TO RUN:
//   Select refreshBir2316DataOnly in the function dropdown → Run
// =====================================================================
function refreshBir2316DataOnly() {
  Logger.log('=== refreshBir2316DataOnly START ===');
  var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);

  // Step 1: Rebuild de minimis transaction log (source of nontax_salaries_other / taxable_salaries_other).
  Logger.log('[1] Rebuilding DeminimisDetails...');
  try { _rebuildDeminimisDetails_(); Logger.log('[1] DONE'); }
  catch(e) { Logger.log('[1] ERROR: ' + e.message); }

  // Step 2: Rebuild BIR2316Data — reads DeminimisDetails + Income Tax caps from Settings.
  Logger.log('[2] Rebuilding BIR2316Data (all years)...');
  try {
    var rows = _rebuildBir2316Data_(wriSS, 'all');
    Logger.log('[2] DONE — ' + rows + ' rows written.');
  } catch(e) { Logger.log('[2] ERROR: ' + e.message); }

  Logger.log('=== refreshBir2316DataOnly COMPLETE ===');
}

// =====================================================================
// BIR 2316 REFRESH WITH 13M REBUILD — run after changing Income Tax caps
// OR after payroll uploads that affect 13th-month pay.
// Rebuilds: DeminimisDetails → 13MDetails → BIR2316Data (all years).
// Does NOT migrate Masterlist schema.
//
// HOW TO RUN:
//   Select refreshBir2316WithThirteenthMonth in the function dropdown → Run
// =====================================================================
function refreshBir2316WithThirteenthMonth() {
  Logger.log('=== refreshBir2316WithThirteenthMonth START ===');
  var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);

  // Step 1: Rebuild de minimis transaction log (source of nontax_salaries_other / taxable_salaries_other).
  Logger.log('[1] Rebuilding DeminimisDetails...');
  try { _rebuildDeminimisDetails_(); Logger.log('[1] DONE'); }
  catch(e) { Logger.log('[1] ERROR: ' + e.message); }

  // Step 2: Rebuild 13MDetails from all years of PayrollLines.
  Logger.log('[2] Rebuilding 13MDetails...');
  try { _rebuildWri13MDetails_(); Logger.log('[2] DONE'); }
  catch(e) { Logger.log('[2] ERROR: ' + e.message); }

  // Step 3: Rebuild BIR2316Data — reads DeminimisDetails + 13MDetails + Income Tax caps from Settings.
  Logger.log('[3] Rebuilding BIR2316Data (all years)...');
  try {
    var rows = _rebuildBir2316Data_(wriSS, 'all');
    Logger.log('[3] DONE — ' + rows + ' rows written.');
  } catch(e) { Logger.log('[3] ERROR: ' + e.message); }

  Logger.log('=== refreshBir2316WithThirteenthMonth COMPLETE ===');
}

// =====================================================================
// REBUILD PAYROLL LINES FROM DRIVE ARCHIVE
// Reads every Excel file from PAYROLL_ARCHIVE_FOLDER_ID, converts it
// to a temporary Google Sheet via Drive API, then re-processes it into
// the correct yearly PayrollLines spreadsheet (same dedup logic as a
// normal upload). WRI Masterlist, 13MDetails, DeminimisDetails, and
// HRISRawData are all updated per file. BIR2316Data is rebuilt once at
// the end.
//
// IMPORTANT:
//  - This function can take several minutes for large archives.
//    If it times out (6-min limit), run it again — each file is
//    idempotent (existing rows are replaced, not duplicated).
//  - Do NOT run while a payroll upload is in progress.
//  - Requires Drive API (v3) to be enabled in the GCP project.
//
// HOW TO RUN:
//   Select rebuildPayrollLinesFromArchive in the function dropdown → Run
// =====================================================================
function rebuildPayrollLinesFromArchive() {
  Logger.log('=== rebuildPayrollLinesFromArchive START ===');

  // ------------------------------------------------------------------
  // Step 0: Wipe PayrollLines in every registered yearly spreadsheet.
  // Reads the YearlyDatabases registry from the Payroll DB so all years
  // (2025, 2026, …) are cleared before re-importing from the archive.
  // The header row is preserved; only data rows are deleted.
  // ------------------------------------------------------------------
  try {
    var dbSS  = getPayrollDB_();
    var regSh = dbSS.getSheetByName('YearlyDatabases');
    if (regSh && regSh.getLastRow() > 1) {
      var regData = regSh.getDataRange().getValues();
      for (var ri = 1; ri < regData.length; ri++) {
        var regYear = regData[ri][0];
        var regId   = String(regData[ri][1] || '').trim();
        if (!regId) continue;
        try {
          var yrSS = SpreadsheetApp.openById(regId);
          var plSh = yrSS.getSheetByName('PayrollLines');
          if (plSh && plSh.getLastRow() > 1) {
            plSh.deleteRows(2, plSh.getLastRow() - 1);
            Logger.log('[Wipe] PayrollLines cleared for year ' + regYear);
          } else {
            Logger.log('[Wipe] PayrollLines already empty for year ' + regYear);
          }
        } catch(wipeYearErr) {
          Logger.log('[Wipe] ERROR clearing year ' + regYear + ': ' + wipeYearErr.message);
        }
      }
    } else {
      Logger.log('[Wipe] YearlyDatabases is empty — nothing to wipe.');
    }
  } catch(wipeErr) {
    Logger.log('[Wipe] ERROR reading YearlyDatabases: ' + wipeErr.message);
  }

  var folder = DriveApp.getFolderById(PAYROLL_ARCHIVE_FOLDER_ID);
  var files  = folder.getFiles();
  var token  = ScriptApp.getOAuthToken();

  // Pre-load HRISRawData so we can restore the original uploadedBy,
  // uploadDate, and source file URL for each batchId.
  var metaMap = {}; // batchId → { uploadedBy, uploadDate, fileUrl }
  try {
    var rdSh = getHrisRawDataSheet_();
    if (rdSh.getLastRow() > 1) {
      var rdAll  = rdSh.getDataRange().getValues();
      var rdH    = rdAll[0].map(function(v){ return String(v).trim(); });
      var idxRB  = rdH.indexOf('BatchID');
      var idxRU  = rdH.indexOf('UploadedBy');
      var idxRD  = rdH.indexOf('UploadDate');
      var idxRSF = rdH.indexOf('Source_File');
      for (var ri = 1; ri < rdAll.length; ri++) {
        var bid = idxRB > -1 ? String(rdAll[ri][idxRB] || '').trim() : '';
        if (bid && !metaMap[bid]) {
          metaMap[bid] = {
            uploadedBy: idxRU  > -1 ? String(rdAll[ri][idxRU]  || '').trim() : 'archive-rebuild',
            uploadDate: idxRD  > -1 ? String(rdAll[ri][idxRD]  || '').trim() : '',
            fileUrl:    idxRSF > -1 ? String(rdAll[ri][idxRSF] || '').trim() : ''
          };
        }
      }
    }
  } catch(metaErr) {
    Logger.log('WARNING: Could not load HRISRawData metadata — will use file defaults. ' + metaErr.message);
  }

  var processed = 0, skipped = 0, errors = 0;

  while (files.hasNext()) {
    var file     = files.next();
    var fileName = file.getName();
    var mimeType = file.getMimeType() || '';

    // Only process Excel / CSV files; skip anything else (PDFs, test files, etc.)
    var isExcel = mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
               || mimeType === 'application/vnd.ms-excel'
               || /\.xlsx?$/i.test(fileName);
    var isCsv   = mimeType === 'text/csv' || /\.csv$/i.test(fileName);
    if (!isExcel && !isCsv) { skipped++; continue; }

    // Filename format: RAW-yyyyMMdd-HHmmss_originalname.ext
    var batchMatch = fileName.match(/^(RAW-\d{8}-\d{6})/);
    if (!batchMatch) {
      Logger.log('Skipping (no batchId in filename): ' + fileName);
      skipped++;
      continue;
    }
    var batchId   = batchMatch[1];
    var meta      = metaMap[batchId] || {};
    var fileUrl   = meta.fileUrl    || ('https://drive.google.com/file/d/' + file.getId() + '/view');
    var uploadedBy = meta.uploadedBy || 'archive-rebuild';
    var timestamp = (meta.uploadDate && meta.uploadDate !== '')
                  ? new Date(meta.uploadDate)
                  : file.getDateCreated();

    Logger.log('Processing [' + batchId + ']: ' + fileName);

    var tempFileId = null;
    try {
      // ------------------------------------------------------------------
      // Step 1: Import the Excel/CSV file as a temporary Google Sheet.
      // Drive API v3 multipart upload with mimeType set to GSheets triggers
      // automatic format conversion — no local XLSX parser needed.
      // ------------------------------------------------------------------
      var blob       = file.getBlob();
      var b64Data    = Utilities.base64Encode(blob.getBytes());
      var safeMime   = isExcel
                     ? (mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                     : 'text/csv';
      var boundary   = 'rplFromArchive_' + batchId.replace(/-/g, '');
      var metaPart   = JSON.stringify({ name: 'rebuild_temp_' + batchId,
                                        mimeType: 'application/vnd.google-apps.spreadsheet' });
      var reqBody    = '--' + boundary + '\r\n'
                     + 'Content-Type: application/json; charset=UTF-8\r\n\r\n'
                     + metaPart + '\r\n'
                     + '--' + boundary + '\r\n'
                     + 'Content-Type: ' + safeMime + '\r\n'
                     + 'Content-Transfer-Encoding: base64\r\n\r\n'
                     + b64Data + '\r\n'
                     + '--' + boundary + '--';

      var resp = UrlFetchApp.fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'post',
          contentType: 'multipart/related; boundary=' + boundary,
          payload: reqBody,
          headers: { Authorization: 'Bearer ' + token },
          muteHttpExceptions: true
        }
      );
      var respCode = resp.getResponseCode();
      if (respCode !== 200 && respCode !== 201) {
        Logger.log('ERROR converting ' + fileName + ' to GSheet: HTTP ' + respCode + ' — ' + resp.getContentText().substring(0, 200));
        errors++;
        continue;
      }
      tempFileId = JSON.parse(resp.getContentText()).id;

      // ------------------------------------------------------------------
      // Step 2: Read the converted sheet into rawData (array of objects).
      // ------------------------------------------------------------------
      var tempSS    = SpreadsheetApp.openById(tempFileId);
      var tempSheet = tempSS.getSheets()[0];
      var sheetData = tempSheet.getDataRange().getValues();

      if (sheetData.length < 2) {
        Logger.log('Skipping (no data rows): ' + fileName);
        skipped++;
        continue;
      }

      var srcHeaders = sheetData[0];
      var rawData    = [];
      for (var r = 1; r < sheetData.length; r++) {
        var obj = {}, hasData = false;
        for (var c = 0; c < srcHeaders.length; c++) {
          if (srcHeaders[c] !== '' && srcHeaders[c] !== null && srcHeaders[c] !== undefined) {
            obj[srcHeaders[c]] = sheetData[r][c];
            if (sheetData[r][c] !== '' && sheetData[r][c] !== null && sheetData[r][c] !== undefined) hasData = true;
          }
        }
        if (hasData) rawData.push(obj);
      }

      // Same blank-id filter as processPayrollRun
      rawData = rawData.filter(function(rx) {
        var idKey = Object.keys(rx).find(function(k){ return normalizeColName_(k) === 'id'; });
        if (idKey) return String(rx[idKey]).trim() !== '';
        return true;
      });
      rawData.forEach(function(rx) { if (rx['FileName'] === undefined) rx['FileName'] = fileName; });

      if (rawData.length === 0) { skipped++; continue; }

      // ------------------------------------------------------------------
      // Step 3: Route to the correct yearly PayrollLines spreadsheet.
      // ------------------------------------------------------------------
      var batchYear = new Date().getFullYear();
      var kEndKey   = Object.keys(rawData[0]).find(function(k){ return normalizeColName_(k) === 'cutoffend'; });
      if (kEndKey && rawData[0][kEndKey]) {
        var dRaw = rawData[0][kEndKey];
        if (typeof dRaw === 'number') dRaw = new Date(Math.round((dRaw - 25569) * 86400 * 1000));
        var dParsed = new Date(dRaw);
        if (!isNaN(dParsed.getTime())) batchYear = dParsed.getFullYear();
      }

      var targetSS  = getYearlySpreadsheet_(batchYear);
      var rawSheet  = targetSS.getSheetByName('PayrollLines');
      if (!rawSheet) rawSheet = targetSS.insertSheet('PayrollLines');

      // ------------------------------------------------------------------
      // Step 4: Merge headers (same logic as processPayrollRun).
      // ------------------------------------------------------------------
      var existingHeaders = rawSheet.getLastColumn() > 0
        ? rawSheet.getRange(1, 1, 1, rawSheet.getLastColumn()).getValues()[0]
        : [];
      var normExisting = existingHeaders.map(normalizeColName_);
      var headersAdded = false;

      Object.keys(rawData[0]).forEach(function(h) {
        var normH = normalizeColName_(h);
        if (!normExisting.includes(normH)) {
          existingHeaders.push(h); normExisting.push(normH); headersAdded = true;
        }
      });
      ['BatchID','UploadDate','UploadedBy','SourceFile'].forEach(function(mc) {
        if (!normExisting.includes(normalizeColName_(mc))) {
          existingHeaders.push(mc); normExisting.push(normalizeColName_(mc)); headersAdded = true;
        }
      });
      if (headersAdded) rawSheet.getRange(1, 1, 1, existingHeaders.length).setValues([existingHeaders]);

      var findColIdx = function(name) { return normExisting.indexOf(normalizeColName_(name)); };

      // ------------------------------------------------------------------
      // Step 5: Delete existing rows for this batch (dedup by id+cutoff).
      // ------------------------------------------------------------------
      if (rawSheet.getLastRow() > 1) {
        var eIdIdx    = findColIdx('id');
        var eStartIdx = findColIdx('cutoffstart');
        var eEndIdx   = findColIdx('cutoffend');
        if (eIdIdx > -1 && eStartIdx > -1 && eEndIdx > -1) {
          var incomingKeys = new Set();
          rawData.forEach(function(rx) {
            var kId    = Object.keys(rx).find(function(k){ return normalizeColName_(k) === 'id'; });
            var kStart = Object.keys(rx).find(function(k){ return normalizeColName_(k) === 'cutoffstart'; });
            var kEnd2  = Object.keys(rx).find(function(k){ return normalizeColName_(k) === 'cutoffend'; });
            if (kId && rx[kId]) {
              incomingKeys.add(String(rx[kId]).trim() + '_'
                + standardizeDateStr_(rx[kStart]) + '_' + standardizeDateStr_(rx[kEnd2]));
            }
          });
          var numExistRows = rawSheet.getLastRow() - 1;
          var idVals    = rawSheet.getRange(2, eIdIdx    + 1, numExistRows, 1).getValues();
          var startVals = rawSheet.getRange(2, eStartIdx + 1, numExistRows, 1).getValues();
          var endVals   = rawSheet.getRange(2, eEndIdx   + 1, numExistRows, 1).getValues();
          var rowsToDelete = [];
          for (var di = 0; di < numExistRows; di++) {
            var dKey = String(idVals[di][0]).trim() + '_'
                     + standardizeDateStr_(startVals[di][0]) + '_'
                     + standardizeDateStr_(endVals[di][0]);
            if (incomingKeys.has(dKey)) rowsToDelete.push(di + 2);
          }
          rowsToDelete.reverse();
          for (var dj = 0; dj < rowsToDelete.length; ) {
            var rs = rowsToDelete[dj], rc = 1;
            while (dj + rc < rowsToDelete.length && rowsToDelete[dj + rc] === rs - rc) rc++;
            rawSheet.deleteRows(rs - rc + 1, rc);
            dj += rc;
          }
        }
      }

      // ------------------------------------------------------------------
      // Step 6: Build and append rows (same value normalization as processPayrollRun).
      // ------------------------------------------------------------------
      var batchDateStr = meta.uploadDate
        || Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');

      var rowsToAppend = rawData.map(function(row) {
        var newRow      = new Array(existingHeaders.length).fill('');
        var idxBatch    = findColIdx('BatchID');
        var idxDate     = findColIdx('UploadDate');
        var idxUser     = findColIdx('UploadedBy');
        var idxSrcFile  = findColIdx('SourceFile');
        if (idxBatch   > -1) newRow[idxBatch]   = batchId;
        if (idxDate    > -1) newRow[idxDate]     = batchDateStr;
        if (idxUser    > -1) newRow[idxUser]     = uploadedBy;
        if (idxSrcFile > -1) newRow[idxSrcFile]  = fileUrl;
        for (var key in row) {
          var index = findColIdx(key);
          if (index === -1) continue;
          var val     = row[key];
          if (val === undefined || val === null) val = '';
          var normKey = normalizeColName_(key);
          if (normKey === 'cutoffstart' || normKey === 'cutoffend') {
            if (val !== '') val = standardizeDateStr_(val);
          } else if (normKey.includes('amount') || normKey.includes('rate')  ||
                     normKey.includes('salary') || normKey.includes('pay')   ||
                     normKey.includes('deduction') || normKey.includes('contribution') ||
                     normKey.includes('duty')) {
            if (val !== '') { var n = Number(String(val).replace(/,/g, '')); if (!isNaN(n)) val = n; }
          } else if (typeof val === 'object' && !(val instanceof Date)) {
            val = JSON.stringify(val);
          }
          newRow[index] = val;
        }
        return newRow;
      });

      if (rowsToAppend.length > 0) {
        var insertStartRow = rawSheet.getLastRow() + 1;
        rawSheet.getRange(insertStartRow, 1, rowsToAppend.length, existingHeaders.length).setValues(rowsToAppend);
        try { formatRawLinesSheet_(targetSS, insertStartRow, rowsToAppend.length); } catch(e) {}

        // WRI writes — roll back PayrollLines rows if any WRI write fails
        try {
          upsertEmployeesFromHRIS_(rowsToAppend, existingHeaders);
          upsertToWriMasterlist_(rowsToAppend, existingHeaders);
          upsertToWri13MDetails_(rowsToAppend, existingHeaders, batchId, batchDateStr, uploadedBy, fileUrl);
          upsertToDeminimisDetails_(rowsToAppend, existingHeaders, batchId, batchDateStr, uploadedBy, fileUrl);
          upsertToEmployeeIncomeLedger_(rowsToAppend, existingHeaders, batchId, batchDateStr, uploadedBy, fileUrl);
          recordHrisRawDataEntries_(rawData, batchId, timestamp, uploadedBy, fileUrl, fileName);
        } catch(wriErr) {
          rollbackHrisUpload_(rawSheet, batchId, insertStartRow, rowsToAppend.length);
          Logger.log('WRI write failed for ' + fileName + ': ' + wriErr.message);
          errors++;
          continue;
        }
      }

      processed++;
      Logger.log('Done [' + batchId + ']: ' + rowsToAppend.length + ' rows → PayrollLines ' + batchYear);

    } catch(fileErr) {
      Logger.log('ERROR processing ' + fileName + ': ' + fileErr.message);
      errors++;
    } finally {
      // Always delete the temporary Google Sheet to avoid clutter
      if (tempFileId) {
        try { DriveApp.getFileById(tempFileId).setTrashed(true); } catch(e) {}
      }
    }
  }

  // Rebuild all derived sheets once after all files are processed
  Logger.log('[Derived] Rebuilding BIR2316Data for all years...');
  try {
    var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
    _rebuildBir2316Data_(wriSS, 'all');
    Logger.log('[Derived] BIR2316Data done.');
  } catch(birErr) { Logger.log('[Derived] BIR2316Data error: ' + birErr.message); }

  Logger.log('=== rebuildPayrollLinesFromArchive COMPLETE ==='
    + ' processed:' + processed + ' skipped:' + skipped + ' errors:' + errors + ' ===');
}

// ---------------------------------------------------------------------
// STEP 1: Add BIR columns to WRI Masterlist (non-destructive)
// Appends missing columns after existing ones — never overwrites data.
// New columns: tin, rdo_code, address, address_zip, local_address,
//              local_address_zip, date_of_birth, contact_number, nationality
// ---------------------------------------------------------------------
function _ensureMasterlistBirColumns_(wriSS) {
  var sh = wriSS.getSheetByName(WRI_MASTERLIST_SHEET_NAME);
  if (!sh) { Logger.log('_ensureMasterlistBirColumns_: Masterlist sheet not found'); return; }

  var BIR_COLS = [
    'tin', 'rdo_code', 'address', 'address_zip',
    'local_address', 'local_address_zip',
    'date_of_birth', 'contact_number', 'nationality',
    'smw_daily',             // Item 9  — Statutory Minimum Wage rate per day
    'smw_monthly',           // Item 10 — Statutory Minimum Wage rate per month
    'is_mwe',                // Item 11 — TRUE if Minimum Wage Earner
    'is_substituted_filing'  // TRUE if employee qualifies for substituted filing
  ];

  var existingHeaders = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).toLowerCase().trim(); });

  BIR_COLS.forEach(function(col) {
    if (existingHeaders.indexOf(col) === -1) {
      var nextCol = sh.getLastColumn() + 1;
      sh.getRange(1, nextCol).setValue(col).setFontWeight('bold').setBackground('#fff2cc');
      existingHeaders.push(col);
      Logger.log('_ensureMasterlistBirColumns_: added column "' + col + '" at position ' + nextCol);
    }
  });
}

// ---------------------------------------------------------------------
// STEP 3: Rebuild BIR2316Data sheet
// One row per employee per year with all YTD figures + pre-computed
// BIR non-taxable/taxable splits and TRAIN Law tax due.
// ---------------------------------------------------------------------
function _rebuildBir2316Data_(wriSS, targetYear) {
  var BIR_DATA_SHEET   = 'BIR2316Data';
  var BIR_DATA_HEADERS = [
    // Identity
    'year','userid','last_name','first_name','middlename','cutoff_from','cutoff_to',
    // Raw YTD aggregates from PayrollLines
    'gross_present','basic_salary_total','nth_month_total',
    'sss_ee','phic_ee','hdmf_ee','sss_loan','hdmf_loan',
    'totaldeduction_ee','alw','tax_withheld',
    'sss_er','phic_er','hdmf_er',
    // Derived BIR non-taxable items (Form 2316 Part IV-B)
    'nontax_basic',           // Item 29 — min(basic_salary_total, 250000)
    'nontax_13thmonth',       // Item 34 — min(nth_month_total, 90000)
    'nontax_sss_phic_hdmf',   // Item 36 — sss_ee + phic_ee + hdmf_ee
    'nontax_salaries_other',  // Item 37 — de minimis / other (fill manually if needed)
    'total_nontaxable',       // Item 38 — sum of items 29-37
    // Derived BIR taxable items
    'taxable_basic',          // Item 39 — max(0, basic_salary_total − 250000)
    'taxable_13thmonth',      // Item 48 — max(0, nth_month_total − 90000)
    'taxable_salaries_other', // Item 44 — taxable allowances / other comp
    'total_taxable_present',  // Item 52
    // Tax summary
    'tax_due',                // Item 24 — computed via TRAIN Law table
    'tax_withheld_jan_nov',   // Item 25A
    'tax_withheld_dec',       // Amount withheld / adjusted in December
    'total_tax_withheld',     // Item 26
    'overwithheld'            // Positive = refundable; negative = deficiency
  ];

  // Wipe and recreate
  var sh = wriSS.getSheetByName(BIR_DATA_SHEET);
  if (sh) wriSS.deleteSheet(sh);
  sh = wriSS.insertSheet(BIR_DATA_SHEET);
  sh.getRange(1, 1, 1, BIR_DATA_HEADERS.length)
    .setValues([BIR_DATA_HEADERS]).setFontWeight('bold').setBackground('#cfe2f3');
  sh.setFrozenRows(1);

  // Determine years to process
  var years = [];
  if (String(targetYear).toLowerCase() === 'all') {
    var dbSS   = getPayrollDB_();
    var regSh  = dbSS.getSheetByName('YearlyDatabases');
    if (regSh && regSh.getLastRow() > 1) {
      var regData = regSh.getDataRange().getValues();
      for (var r = 1; r < regData.length; r++) {
        var yr = parseInt(regData[r][0], 10);
        if (!isNaN(yr) && yr > 2000 && yr <= 2100 && years.indexOf(yr) === -1) years.push(yr);
      }
    }
  } else {
    years.push(parseInt(targetYear, 10) || new Date().getFullYear());
  }
  years.sort();

  var allRows = [];

  // Load configurable de minimis + 13th month caps from central settings (Settings > Income Tax)
  var itCaps = { cap13th:90000, rice_subsidy:24000, clothing:6000, medical_cash:10000, laundry:3600, daily_meal:0, transport:0, meal:0, housing:0, other_benefits:0 };
  try {
    var itSS    = SpreadsheetApp.openById(CENTRAL_SETTINGS_ID);
    var itModSh = itSS.getSheetByName('Modules');
    if (itModSh && itModSh.getLastRow() > 1) {
      var itRaw = itModSh.getDataRange().getValues();
      var itMap = {};
      itRaw.slice(1).forEach(function(r) { var k = String(r[0]||'').trim(); if (k) itMap[k] = r[1]; });
      var nsIt = function(k, def) { return (itMap[k] !== undefined && itMap[k] !== '') ? Number(itMap[k]) : def; };
      itCaps.cap13th        = nsIt('INCOMETAX_CAP_13TH', 90000);
      itCaps.rice_subsidy   = nsIt('INCOMETAX_DEMIN_RICE_SUBSIDY', 24000);
      itCaps.clothing       = nsIt('INCOMETAX_DEMIN_CLOTHING', 6000);
      itCaps.medical_cash   = nsIt('INCOMETAX_DEMIN_MEDICAL_CASH', 10000);
      itCaps.laundry        = nsIt('INCOMETAX_DEMIN_LAUNDRY', 3600);
      itCaps.daily_meal     = nsIt('INCOMETAX_DEMIN_DAILY_MEAL', 0);
      itCaps.transport      = nsIt('INCOMETAX_DEMIN_TRANSPORT', 0);
      itCaps.meal           = nsIt('INCOMETAX_DEMIN_MEAL', 0);
      itCaps.housing        = nsIt('INCOMETAX_DEMIN_HOUSING', 0);
      itCaps.other_benefits = nsIt('INCOMETAX_DEMIN_OTHER_BENEFITS', 0);
    }
  } catch(e) { Logger.log('_rebuildBir2316Data_: could not load income tax settings, using defaults. ' + e); }

  // De minimis type column arrays — parallel-indexed (index i matches across both)
  var DEMIN_TYPE_COLS = ['rice_subsidy','clothing','medical_cash','laundry','daily_meal','transport','meal','housing','other_benefits'];
  var DEMIN_STATUTORY = [itCaps.rice_subsidy, itCaps.clothing, itCaps.medical_cash, itCaps.laundry, itCaps.daily_meal, itCaps.transport, itCaps.meal, itCaps.housing, itCaps.other_benefits];

  // De-minimis per-type detail now comes from EmployeeIncomeLedger (demin_* columns).
  // DEMIN_STATUTORY caps are still applied at aggregation time below.

  // Load manual tax-withheld overrides from BIR2316Overrides sheet
  var overridesMap = {};
  var ovShRb = wriSS.getSheetByName('BIR2316Overrides');
  if (ovShRb && ovShRb.getLastRow() > 1) {
    var ovDataRb = ovShRb.getDataRange().getValues();
    var ovHRb    = ovDataRb[0].map(function(h) { return String(h).toLowerCase().trim(); });
    var ovUidI   = ovHRb.indexOf('userid');
    var ovYrI    = ovHRb.indexOf('year');
    var ovJanI   = ovHRb.indexOf('tax_withheld_jan_nov');
    var ovDecI   = ovHRb.indexOf('tax_withheld_dec');
    for (var ovR = 1; ovR < ovDataRb.length; ovR++) {
      var ovUid = ovUidI > -1 ? String(ovDataRb[ovR][ovUidI] || '').trim() : '';
      var ovYr  = ovYrI  > -1 ? parseInt(ovDataRb[ovR][ovYrI],  10)        : 0;
      if (!ovUid || !ovYr) continue;
      overridesMap[ovUid + '|' + ovYr] = {
        jan: ovJanI > -1 ? ovDataRb[ovR][ovJanI] : null,
        dec: ovDecI > -1 ? ovDataRb[ovR][ovDecI] : null
      };
    }
    Logger.log('_rebuildBir2316Data_: overridesMap keys: ' + Object.keys(overridesMap).length);
  }

  // Build Masterlist lookup once (used for all years)
  var mlDates = {};
  var mlShGlobal = wriSS.getSheetByName(WRI_MASTERLIST_SHEET_NAME);
  if (mlShGlobal && mlShGlobal.getLastRow() > 1) {
    var mlVals = mlShGlobal.getDataRange().getValues();
    var mlNormH = mlVals[0].map(normalizeColName_);
    var mlUidIdx2    = mlNormH.indexOf('userid');
    var mlHireIdx    = mlNormH.indexOf('hiringdate');
    var mlSepIdx     = mlNormH.indexOf('separationdate');
    var mlIsMweIdx   = mlNormH.indexOf('ismwe');
    for (var mi = 1; mi < mlVals.length; mi++) {
      var mlUid = mlUidIdx2 > -1 ? String(mlVals[mi][mlUidIdx2] || '').trim() : '';
      if (!mlUid) continue;
      mlDates[mlUid] = {
        hiringdate:     mlHireIdx  > -1 ? mlVals[mi][mlHireIdx]  : '',
        separationdate: mlSepIdx   > -1 ? mlVals[mi][mlSepIdx]   : '',
        is_mwe:         mlIsMweIdx > -1 ? String(mlVals[mi][mlIsMweIdx] || '').toUpperCase() === 'TRUE' : false
      };
    }
  }

  // Load EmployeeIncomeLedger (single read, all years)
  var eilShRb   = wriSS.getSheetByName(EIL_SHEET);
  var eilDataRb = (eilShRb && eilShRb.getLastRow() > 1) ? eilShRb.getDataRange().getValues() : [];
  var eilHRb    = eilDataRb.length > 0 ? eilDataRb[0].map(function(h) { return String(h).toLowerCase().trim(); }) : [];
  var ei = function(name) { return eilHRb.indexOf(name); };

  var iEUid   = ei('userid');       var iEFn    = ei('first_name');
  var iEMn    = ei('middlename');   var iELn    = ei('last_name');
  var iECn    = ei('company_name'); var iECs    = ei('cutoff_start');
  var iECe    = ei('cutoff_end');   var iEFy    = ei('fiscal_year');
  var iEReg   = ei('regular_amount');
  var iEOt    = ei('overtime_amount');  var iENd    = ei('nd_amount');
  var iEDod   = ei('dod_amount');       var iEDotA  = ei('dod_ot_amount');
  var iESplS  = ei('spl_hol_amount');   var iESplOS = ei('spl_hol_ot_amount');
  var iESplDS = ei('spl_hol_dof_amount'); var iESplDOS= ei('spl_hol_dof_ot_amount');
  var iELglS  = ei('lgl_hol_amount');   var iELglOS = ei('lgl_hol_ot_amount');
  var iELglDS = ei('lgl_hol_dof_amount'); var iELglDOS= ei('lgl_hol_dof_ot_amount');
  var iETrOt  = ei('training_ot_amount'); var iETrLt  = ei('training_lates_amount');
  var iEInc   = ei('incentives');   var iEAlw   = ei('allowance');
  var iEAdj   = ei('adjustment');   var iENth   = ei('nth_month_pay');
  var iEBsc   = ei('basic_salary_hris'); var iEGross = ei('gross_pay_hris');
  var iERice  = ei('demin_rice_subsidy'); var iEClot  = ei('demin_clothing');
  var iEMed   = ei('demin_medical_cash'); var iELaun  = ei('demin_laundry');
  var iEDMeal = ei('demin_daily_meal');   var iETrns  = ei('demin_transport');
  var iEDMl   = ei('demin_meal');         var iEHous  = ei('demin_housing');
  var iEDOth  = ei('demin_other');
  var iESssEE = ei('sss_ee');   var iESssLn = ei('sss_loan');
  var iEPhic  = ei('phic_ee');  var iEHdmf  = ei('hdmf_ee');
  var iEHdmfLn= ei('hdmf_loan'); var iETax   = ei('withholding_tax');
  var iETotDed= ei('total_ee_deduction');
  var iESssER = ei('sss_er');   var iEPhicER= ei('phic_er');
  var iEHdmfER= ei('hdmf_er');

  years.forEach(function(yr) {
    if (eilDataRb.length < 2) {
      Logger.log('_rebuildBir2316Data_: EmployeeIncomeLedger empty for year=' + yr);
      return;
    }

    var numV = function(v) {
      if (typeof v === 'number') return v;
      var n = Number(String(v || '').replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? 0 : n;
    };

    var aggMap = {};

    for (var i = 1; i < eilDataRb.length; i++) {
      var row   = eilDataRb[i];
      var rowFy = iEFy > -1 ? parseInt(row[iEFy], 10) : 0;
      if (rowFy !== yr) continue;

      var uid = iEUid > -1 ? String(row[iEUid] || '').trim() : '';
      if (!uid) continue;
      var fn  = iEFn > -1 ? String(row[iEFn] || '').trim() : '';
      var mn  = iEMn > -1 ? String(row[iEMn] || '').trim() : '';
      var ln  = iELn > -1 ? String(row[iELn] || '').trim() : '';
      var cn  = iECn > -1 ? String(row[iECn] || '').trim() : '';

      var ceRaw  = iECe > -1 ? row[iECe] : '';
      var csRaw  = iECs > -1 ? row[iECs] : '';
      var ceDate = ceRaw instanceof Date ? ceRaw : new Date(ceRaw);
      var csDate = csRaw instanceof Date ? csRaw : new Date(csRaw);

      if (!aggMap[uid]) {
        aggMap[uid] = {
          year: yr, uid: uid, fn: fn, mn: mn, ln: ln, cn: cn,
          cutoffFrom: null, cutoffTo: null,
          bsc: 0, nth: 0,
          ot: 0, nd: 0, dod: 0, dotA: 0,
          splS: 0, splOS: 0, splDS: 0, splDOS: 0,
          lglS: 0, lglOS: 0, lglDS: 0, lglDOS: 0,
          trOt: 0, trLt: 0,
          inc: 0, alw: 0, adj: 0,
          dRice: 0, dClot: 0, dMed: 0, dLaun: 0, dMeal: 0,
          dTrns: 0, dMl: 0, dHous: 0, dOth: 0,
          sssEE: 0, sssLoan: 0, phic: 0, hdmf: 0, hdmfLoan: 0, totDed: 0,
          sssER: 0, phicER: 0, hdmfER: 0,
          taxJanNov: 0, taxDec: 0, grossH: 0
        };
      }
      var a = aggMap[uid];
      if (!a.fn && fn) a.fn = fn;
      if (!a.mn && mn) a.mn = mn;
      if (!a.ln && ln) a.ln = ln;
      if (!isNaN(csDate.getTime())) {
        if (!a.cutoffFrom || csDate < a.cutoffFrom) a.cutoffFrom = csDate;
      }
      if (!isNaN(ceDate.getTime())) {
        if (!a.cutoffTo || ceDate > a.cutoffTo) a.cutoffTo = ceDate;
      }

      a.bsc    += numV(iEBsc    > -1 ? row[iEBsc]    : 0);
      a.nth    += numV(iENth    > -1 ? row[iENth]    : 0);
      a.ot     += numV(iEOt     > -1 ? row[iEOt]     : 0);
      a.nd     += numV(iENd     > -1 ? row[iENd]     : 0);
      a.dod    += numV(iEDod    > -1 ? row[iEDod]    : 0);
      a.dotA   += numV(iEDotA   > -1 ? row[iEDotA]   : 0);
      a.splS   += numV(iESplS   > -1 ? row[iESplS]   : 0);
      a.splOS  += numV(iESplOS  > -1 ? row[iESplOS]  : 0);
      a.splDS  += numV(iESplDS  > -1 ? row[iESplDS]  : 0);
      a.splDOS += numV(iESplDOS > -1 ? row[iESplDOS] : 0);
      a.lglS   += numV(iELglS   > -1 ? row[iELglS]   : 0);
      a.lglOS  += numV(iELglOS  > -1 ? row[iELglOS]  : 0);
      a.lglDS  += numV(iELglDS  > -1 ? row[iELglDS]  : 0);
      a.lglDOS += numV(iELglDOS > -1 ? row[iELglDOS] : 0);
      a.trOt   += numV(iETrOt   > -1 ? row[iETrOt]   : 0);
      a.trLt   += numV(iETrLt   > -1 ? row[iETrLt]   : 0);
      a.inc    += numV(iEInc    > -1 ? row[iEInc]    : 0);
      a.alw    += numV(iEAlw    > -1 ? row[iEAlw]    : 0);
      a.adj    += numV(iEAdj    > -1 ? row[iEAdj]    : 0);
      a.dRice  += numV(iERice   > -1 ? row[iERice]   : 0);
      a.dClot  += numV(iEClot   > -1 ? row[iEClot]   : 0);
      a.dMed   += numV(iEMed    > -1 ? row[iEMed]    : 0);
      a.dLaun  += numV(iELaun   > -1 ? row[iELaun]   : 0);
      a.dMeal  += numV(iEDMeal  > -1 ? row[iEDMeal]  : 0);
      a.dTrns  += numV(iETrns   > -1 ? row[iETrns]   : 0);
      a.dMl    += numV(iEDMl    > -1 ? row[iEDMl]    : 0);
      a.dHous  += numV(iEHous   > -1 ? row[iEHous]   : 0);
      a.dOth   += numV(iEDOth   > -1 ? row[iEDOth]   : 0);
      a.sssEE  += numV(iESssEE  > -1 ? row[iESssEE]  : 0);
      a.sssLoan+= numV(iESssLn  > -1 ? row[iESssLn]  : 0);
      a.phic   += numV(iEPhic   > -1 ? row[iEPhic]   : 0);
      a.hdmf   += numV(iEHdmf   > -1 ? row[iEHdmf]   : 0);
      a.hdmfLoan += numV(iEHdmfLn > -1 ? row[iEHdmfLn] : 0);
      a.totDed += numV(iETotDed > -1 ? row[iETotDed] : 0);
      a.sssER  += numV(iESssER  > -1 ? row[iESssER]  : 0);
      a.phicER += numV(iEPhicER > -1 ? row[iEPhicER] : 0);
      a.hdmfER += numV(iEHdmfER > -1 ? row[iEHdmfER] : 0);
      a.grossH += numV(iEGross  > -1 ? row[iEGross]  : 0);

      var taxAmt = numV(iETax > -1 ? row[iETax] : 0);
      if (!isNaN(ceDate.getTime()) && ceDate.getMonth() === 11) {
        a.taxDec += taxAmt;
      } else {
        a.taxJanNov += taxAmt;
      }
    }

    // Build output rows — MWE-aware + de minimis split from EIL demin_* columns
    Object.values(aggMap).forEach(function(a) {
      var empProfile = mlDates[a.uid] || {};
      var isMwe      = empProfile.is_mwe || false;

      var nontaxBasic  = isMwe ? a.bsc : Math.min(a.bsc, 250000);
      var taxableBasic = isMwe ? 0     : Math.max(0, a.bsc - 250000);

      var nontax13th  = Math.min(a.nth, itCaps.cap13th);
      var taxable13th = Math.max(0, a.nth - itCaps.cap13th);

      var nontaxSssPhicHdmf = a.sssEE + a.phic + a.hdmf;

      // De minimis: apply annual per-type statutory cap
      var deminTotals = [a.dRice, a.dClot, a.dMed, a.dLaun, a.dMeal, a.dTrns, a.dMl, a.dHous, a.dOth];
      var nontaxDemin = 0, taxDemin = 0;
      DEMIN_STATUTORY.forEach(function(cap, ci) {
        var ytd = deminTotals[ci];
        nontaxDemin += Math.min(ytd, cap);
        taxDemin    += Math.max(0, ytd - cap);
      });

      // taxable_salaries_other = OT + ND + DOD + holidays + training + incentives + alw + adj + demin excess
      var taxableSalOther = a.ot + a.nd + a.dod + a.dotA
        + a.splS + a.splOS + a.splDS + a.splDOS
        + a.lglS + a.lglOS + a.lglDS + a.lglDOS
        + a.trOt + a.trLt
        + a.inc + a.alw + a.adj
        + taxDemin;

      var nontaxSalOther    = nontaxDemin;
      var totalNontaxable   = nontaxBasic + nontax13th + nontaxSssPhicHdmf + nontaxSalOther;
      var totalTaxable      = taxableBasic + taxable13th + taxableSalOther;
      var grossPresent      = totalNontaxable + totalTaxable;  // Item 19 = Item 38 + Item 52

      var taxJanNov = isMwe ? 0 : a.taxJanNov;
      var taxDec    = isMwe ? 0 : a.taxDec;
      var taxDue    = isMwe ? 0 : _computeTrainTax_(totalTaxable);
      var totalTaxWithheld = taxJanNov + taxDec;
      var overwithheld     = totalTaxWithheld - taxDue;

      var ovKey = a.uid + '|' + a.year;
      if (overridesMap[ovKey]) {
        var ovEntry = overridesMap[ovKey];
        if (ovEntry.jan !== null && ovEntry.jan !== '') taxJanNov = Number(ovEntry.jan) || 0;
        if (ovEntry.dec !== null && ovEntry.dec !== '') taxDec    = Number(ovEntry.dec) || 0;
        totalTaxWithheld = taxJanNov + taxDec;
        overwithheld     = totalTaxWithheld - taxDue;
      }

      var jan1  = '01/01/' + a.year;
      var cutoffFrom = jan1;
      var cutoffTo   = '12/31/' + a.year;
      var empDates = mlDates[a.uid] || {};
      if (empDates.hiringdate) {
        var hd = empDates.hiringdate instanceof Date ? empDates.hiringdate : new Date(empDates.hiringdate);
        if (!isNaN(hd.getTime()) && hd.getFullYear() === a.year) {
          cutoffFrom = Utilities.formatDate(hd, Session.getScriptTimeZone(), 'MM/dd/yyyy');
        }
      }
      if (empDates.separationdate) {
        var sd = empDates.separationdate instanceof Date ? empDates.separationdate : new Date(empDates.separationdate);
        if (!isNaN(sd.getTime()) && sd.getFullYear() === a.year) {
          cutoffTo = Utilities.formatDate(sd, Session.getScriptTimeZone(), 'MM/dd/yyyy');
        }
      }

      allRows.push([
        a.year, a.uid, a.ln, a.fn, a.mn, cutoffFrom, cutoffTo,
        grossPresent, a.bsc, a.nth,
        a.sssEE, a.phic, a.hdmf, a.sssLoan, a.hdmfLoan,
        a.totDed, a.alw, totalTaxWithheld,
        a.sssER, a.phicER, a.hdmfER,
        nontaxBasic, nontax13th, nontaxSssPhicHdmf, nontaxSalOther, totalNontaxable,
        taxableBasic, taxable13th, taxableSalOther, totalTaxable,
        taxDue, taxJanNov, taxDec, totalTaxWithheld, overwithheld
      ]);
    });

    Logger.log('_rebuildBir2316Data_: year=' + yr + ' — ' + Object.keys(aggMap).length + ' employee records from EmployeeIncomeLedger.');
  });

  if (allRows.length > 0) {
    sh.getRange(2, 1, allRows.length, BIR_DATA_HEADERS.length).setValues(allRows);
    // Format money columns from 'gross_present' (col 8) onward
    sh.getRange(2, 8, allRows.length, BIR_DATA_HEADERS.length - 7).setNumberFormat('#,##0.00');
  }

  Logger.log('_rebuildBir2316Data_: total ' + allRows.length + ' rows written to BIR2316Data.');
  return allRows.length;
}

// ---------------------------------------------------------------------
// TRAIN Law annual income tax table — 2023 revised brackets (effective 2023+)
// For 2018-2022 brackets, the 0% threshold was also 250,000 so results
// are the same at low incomes; high-income brackets differ slightly.
// Input:  annual taxable compensation income (PHP)
// Output: annual income tax due (PHP)
// ---------------------------------------------------------------------
function _computeTrainTax_(annualTaxableIncome) {
  var inc = annualTaxableIncome;
  if (inc <= 250000)  return 0;
  if (inc <= 400000)  return (inc - 250000) * 0.15;
  if (inc <= 800000)  return 22500  + (inc - 400000) * 0.20;
  if (inc <= 2000000) return 102500 + (inc - 800000) * 0.25;
  if (inc <= 8000000) return 402500 + (inc - 2000000) * 0.30;
  return                     2202500+ (inc - 8000000) * 0.35;
}

// =====================================================================
// BIR 2316 TAX WITHHELD OVERRIDES
// Sheet: BIR2316Overrides  (in WRI Employee Masterlist spreadsheet)
// Cols:  userid | year | tax_withheld_jan_nov | tax_withheld_dec | note | last_modified_by | last_modified_at
// Usage: Override specific employees' tax withheld figures (e.g. HRIS
//        miscalculations for MWE or any non-standard correction).
//        MWE employees are auto-zeroed by the rebuild; use this for
//        non-MWE employees that need a manual correction.
// =====================================================================
var BIR_OV_HEADERS_ = ['userid','year','tax_withheld_jan_nov','tax_withheld_dec','note','last_modified_by','last_modified_at'];

function _getBir2316OverridesSheet_(wriSS) {
  var sh = wriSS.getSheetByName('BIR2316Overrides');
  if (!sh) {
    sh = wriSS.insertSheet('BIR2316Overrides');
    sh.getRange(1, 1, 1, BIR_OV_HEADERS_.length)
      .setValues([BIR_OV_HEADERS_]).setFontWeight('bold').setBackground('#ffe0b2');
    sh.setFrozenRows(1);
  }
  return sh;
}

/**
 * Returns BIR2316Data rows (post-MWE-zero + any overrides already applied)
 * merged with any existing override entries, for the Adjustments UI.
 */
function getBir2316AdjustmentsData(year) {
  try {
    var yr    = parseInt(year, 10) || new Date().getFullYear();
    var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);

    // --- BIR2316Data for this year ---
    var birRows = {};
    var birSh   = wriSS.getSheetByName('BIR2316Data');
    if (birSh && birSh.getLastRow() > 1) {
      var bd  = birSh.getDataRange().getDisplayValues();
      var bh  = bd[0].map(function(h) { return String(h).toLowerCase().trim(); });
      var bYI = bh.indexOf('year');
      var bUI = bh.indexOf('userid');
      for (var i = 1; i < bd.length; i++) {
        var rowYr = parseInt(String(bd[i][bYI] || '0').replace(/[^0-9]/g,'').substring(0,4), 10);
        if (rowYr !== yr) continue;
        var obj = {};
        bh.forEach(function(h, idx) { obj[h] = bd[i][idx]; });
        var uid = String(bd[i][bUI] || '').trim();
        if (uid) birRows[uid] = obj;
      }
    }

    // --- is_mwe flag from Masterlist ---
    var mweMap = {};
    var mlSh   = wriSS.getSheetByName(WRI_MASTERLIST_SHEET_NAME);
    if (mlSh && mlSh.getLastRow() > 1) {
      var md   = mlSh.getDataRange().getValues();
      var mh   = md[0].map(function(h) { return String(h).toLowerCase().trim(); });
      var mUI  = mh.indexOf('userid');
      var mMI  = mh.indexOf('is_mwe');
      for (var j = 1; j < md.length; j++) {
        var mUid = mUI > -1 ? String(md[j][mUI] || '').trim() : '';
        if (mUid) mweMap[mUid] = mMI > -1 ? String(md[j][mMI] || '').toUpperCase() === 'TRUE' : false;
      }
    }

    // --- Existing overrides for this year ---
    var ovMap = {};
    var ovSh  = _getBir2316OverridesSheet_(wriSS);
    if (ovSh.getLastRow() > 1) {
      var od   = ovSh.getDataRange().getValues();
      var oh   = od[0].map(function(h) { return String(h).toLowerCase().trim(); });
      var oUI  = oh.indexOf('userid');
      var oYI  = oh.indexOf('year');
      var oJI  = oh.indexOf('tax_withheld_jan_nov');
      var oDI  = oh.indexOf('tax_withheld_dec');
      var oNI  = oh.indexOf('note');
      for (var k = 1; k < od.length; k++) {
        var oUid = oUI > -1 ? String(od[k][oUI] || '').trim() : '';
        var oYr  = oYI > -1 ? parseInt(od[k][oYI], 10) : 0;
        if (!oUid || oYr !== yr) continue;
        ovMap[oUid] = {
          tax_withheld_jan_nov: oJI > -1 ? String(od[k][oJI] || '') : '',
          tax_withheld_dec:     oDI > -1 ? String(od[k][oDI] || '') : '',
          note:                 oNI > -1 ? String(od[k][oNI] || '') : ''
        };
      }
    }

    // --- Merge ---
    var result = Object.keys(birRows).map(function(uid) {
      var b = birRows[uid];
      return {
        userid:                    uid,
        last_name:                 b.last_name  || '',
        first_name:                b.first_name || '',
        middlename:                b.middlename || '',
        is_mwe:                    mweMap[uid]  || false,
        hris_tax_withheld_jan_nov: b.tax_withheld_jan_nov || '0',
        hris_tax_withheld_dec:     b.tax_withheld_dec     || '0',
        override:                  ovMap[uid] || null
      };
    });
    result.sort(function(a, b) { return (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name); });
    return { success: true, year: yr, rows: result };
  } catch(e) {
    throw new Error('getBir2316AdjustmentsData: ' + e.message);
  }
}

/**
 * Upserts one override row and immediately rebuilds BIR2316Data for that year.
 * payload: { userid, year, tax_withheld_jan_nov, tax_withheld_dec, note }
 */
function saveBir2316Override(payload) {
  try {
    var userid = String(payload.userid || '').trim();
    var year   = parseInt(payload.year, 10);
    if (!userid || !year) throw new Error('userid and year are required.');

    var jan  = (payload.tax_withheld_jan_nov !== '' && payload.tax_withheld_jan_nov !== null)
               ? Number(payload.tax_withheld_jan_nov) : '';
    var dec  = (payload.tax_withheld_dec     !== '' && payload.tax_withheld_dec     !== null)
               ? Number(payload.tax_withheld_dec)     : '';
    var note = String(payload.note || '').trim();
    var user = Session.getEffectiveUser().getEmail();
    var ts   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');

    var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
    var sh    = _getBir2316OverridesSheet_(wriSS);
    var data  = sh.getDataRange().getValues();
    var h     = data[0].map(function(c) { return String(c).toLowerCase().trim(); });
    var uIdx  = h.indexOf('userid');
    var yIdx  = h.indexOf('year');

    var row = BIR_OV_HEADERS_.map(function(col) {
      if (col === 'userid')               return userid;
      if (col === 'year')                 return year;
      if (col === 'tax_withheld_jan_nov') return jan;
      if (col === 'tax_withheld_dec')     return dec;
      if (col === 'note')                 return note;
      if (col === 'last_modified_by')     return user;
      if (col === 'last_modified_at')     return ts;
      return '';
    });

    var existIdx = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][uIdx] || '').trim() === userid && parseInt(data[i][yIdx], 10) === year) {
        existIdx = i + 1; break;
      }
    }
    if (existIdx > -1) {
      sh.getRange(existIdx, 1, 1, row.length).setValues([row]);
    } else {
      sh.appendRow(row);
    }

    _rebuildBir2316Data_(wriSS, year);
    return { success: true };
  } catch(e) {
    throw new Error('saveBir2316Override: ' + e.message);
  }
}

/**
 * Removes an override row and rebuilds BIR2316Data for that year.
 * payload: { userid, year }
 */
function deleteBir2316Override(payload) {
  try {
    var userid = String(payload.userid || '').trim();
    var year   = parseInt(payload.year, 10);
    if (!userid || !year) throw new Error('userid and year are required.');

    var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
    var sh    = _getBir2316OverridesSheet_(wriSS);
    var data  = sh.getDataRange().getValues();
    var h     = data[0].map(function(c) { return String(c).toLowerCase().trim(); });
    var uIdx  = h.indexOf('userid');
    var yIdx  = h.indexOf('year');

    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][uIdx] || '').trim() === userid && parseInt(data[i][yIdx], 10) === year) {
        sh.deleteRow(i + 1);
      }
    }

    _rebuildBir2316Data_(wriSS, year);
    return { success: true };
  } catch(e) {
    throw new Error('deleteBir2316Override: ' + e.message);
  }
}

// =====================================================================
// PHASE 9 — MIGRATE MASTERLIST SHEET (one-time data migration)
// Reads old headers→value maps, rebuilds with new 29-column WRI_ML_HEADERS,
// seeds regulardayrate from latest-cutoffend PayrollLines row per uid.
// =====================================================================

function _migrateAndRebuildMasterlistSheet_(wriSS) {
  var sh = wriSS.getSheetByName(WRI_MASTERLIST_SHEET_NAME);
  if (!sh) { Logger.log('_migrateAndRebuildMasterlistSheet_: Masterlist sheet not found.'); return; }

  // Step 1: Read existing sheet and build uid → { colName: value } map
  var existing   = sh.getDataRange().getValues();
  if (existing.length < 1) { Logger.log('_migrateAndRebuildMasterlistSheet_: sheet is empty.'); return; }
  var oldHeaders = existing[0].map(function(h) { return String(h).toLowerCase().trim(); });
  var oldUidIdx  = oldHeaders.indexOf('userid');
  if (oldUidIdx === -1) { Logger.log('_migrateAndRebuildMasterlistSheet_: no userid column.'); return; }
  Logger.log('_migrateAndRebuildMasterlistSheet_: old header count=' + oldHeaders.length + '; rows=' + (existing.length - 1));

  var oldRowMap = {};  // uid → { colName: value }
  for (var i = 1; i < existing.length; i++) {
    var uid = String(existing[i][oldUidIdx] || '').trim();
    if (!uid) continue;
    var rowObj = {};
    oldHeaders.forEach(function(col, ci) { if (col) rowObj[col] = existing[i][ci]; });
    oldRowMap[uid] = rowObj;
  }
  Logger.log('_migrateAndRebuildMasterlistSheet_: ' + Object.keys(oldRowMap).length + ' employees loaded.');

  // Step 4: Seed regulardayrate from PayrollLines — latest cutoffend per uid wins
  var payrollRates = {};  // uid → { rate, date }
  try {
    var dbSS  = getPayrollDB_();
    var regSh = dbSS.getSheetByName('YearlyDatabases');
    if (regSh && regSh.getLastRow() > 1) {
      var regData = regSh.getDataRange().getValues();
      var scanYears = [];
      for (var r = 1; r < regData.length; r++) {
        var yr = parseInt(regData[r][0], 10);
        if (!isNaN(yr) && yr > 2000 && yr <= 2100 && scanYears.indexOf(yr) === -1) scanYears.push(yr);
      }
      scanYears.forEach(function(year) {
        try {
          var yrSS  = getYearlySpreadsheet_(year);
          var plSh  = yrSS ? yrSS.getSheetByName('PayrollLines') : null;
          if (!plSh || plSh.getLastRow() < 2) return;
          var plData   = plSh.getDataRange().getValues();
          var plNormH  = plData[0].map(normalizeColName_);
          var plUidIdx = plNormH.indexOf('userid');
          var plCeIdx  = plNormH.indexOf('cutoffend');
          var plRrIdx  = plNormH.indexOf('regulardayrate'); // regularday.rate → regulardayrate
          if (plUidIdx === -1 || plRrIdx === -1) return;
          for (var j = 1; j < plData.length; j++) {
            var pUid  = String(plData[j][plUidIdx] || '').trim();
            var pRate = Number(plData[j][plRrIdx]  || 0);
            if (!pUid || !pRate) continue;
            var pCeRaw  = plCeIdx > -1 ? plData[j][plCeIdx] : '';
            var pCeDate = pCeRaw instanceof Date ? pCeRaw : new Date(pCeRaw);
            if (!payrollRates[pUid] || (!isNaN(pCeDate.getTime()) && pCeDate > payrollRates[pUid].date)) {
              payrollRates[pUid] = { rate: pRate, date: pCeDate };
            }
          }
        } catch(e) { Logger.log('_migrateAndRebuildMasterlistSheet_: PayrollLines year ' + year + ' error: ' + e.message); }
      });
    }
  } catch(e) { Logger.log('_migrateAndRebuildMasterlistSheet_: YearlyDatabases scan error: ' + e.message); }
  Logger.log('_migrateAndRebuildMasterlistSheet_: regulardayrate seeded for ' + Object.keys(payrollRates).length + ' UIDs.');

  // Step 2 & 3: Clear sheet, write new 29-column header
  sh.clearContents();
  sh.getRange(1, 1, 1, WRI_ML_HEADERS.length)
    .setValues([WRI_ML_HEADERS]).setFontWeight('bold').setBackground('#f3f4f6');
  sh.setFrozenRows(1);

  // Build new-header name → 0-based index map
  var newHMap = {};
  WRI_ML_HEADERS.forEach(function(col, ci) { newHMap[col] = ci; });

  // Step 5–8: Rebuild each row in the new 29-column layout
  var newRows = [];
  Object.keys(oldRowMap).forEach(function(uid) {
    var old = oldRowMap[uid];
    var row = new Array(WRI_ML_HEADERS.length).fill('');

    // Map every column whose name matches between old and new layouts directly
    WRI_ML_HEADERS.forEach(function(col) {
      if (old.hasOwnProperty(col)) row[newHMap[col]] = old[col];
    });

    // regulardayrate: PayrollLines latest value wins; fall back to any value already in old sheet
    var plRate  = payrollRates[uid] ? payrollRates[uid].rate : 0;
    var oldRate = Number(old['regulardayrate'] || 0);
    row[newHMap['regulardayrate']] = plRate || oldRate || '';

    // smw_monthly: recompute when is_mwe=TRUE and we have a rate; otherwise preserve
    var finalRate = Number(row[newHMap['regulardayrate']] || 0);
    var isMwe     = String(old['is_mwe'] || '').toUpperCase() === 'TRUE';
    if (isMwe && finalRate) {
      row[newHMap['smw_monthly']] = finalRate * 26;
    } else if (old.hasOwnProperty('smw_monthly')) {
      row[newHMap['smw_monthly']] = old['smw_monthly'];
    }

    // smw_daily is permanently dropped — value is discarded
    // is_substituted_filing: already mapped above if column existed in old sheet

    row[0] = uid;  // always ensure userid stays at index 0
    newRows.push(row);
  });

  if (newRows.length > 0) {
    sh.getRange(2, 1, newRows.length, WRI_ML_HEADERS.length).setValues(newRows);
  }
  Logger.log('_migrateAndRebuildMasterlistSheet_: DONE — wrote ' + newRows.length + ' rows in new 29-column layout.');
}

// =====================================================================
// INCENTIVE SHEETS  (migrated from Disbursement Web App)
// =====================================================================

function parseBool_(v) { return String(v).toUpperCase() === 'TRUE'; }

function generateVoucherId_(type) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const centralSS = getCentralSS_();
    const progSheet = centralSS.getSheetByName('Modules');
    const progMap   = {};
    if (progSheet) { progSheet.getDataRange().getValues().forEach(row => { if (row[0]) progMap[row[0]] = row[1]; }); }
    let seqSheet = centralSS.getSheetByName('Sequence');
    if (!seqSheet) {
      seqSheet = centralSS.insertSheet('Sequence');
      seqSheet.appendRow(['STARTING_SEQUENCE_IS', 1]);
      seqSheet.appendRow(['STARTING_SEQUENCE_INCENTIVES', 1]);
    }
    const seqData = seqSheet.getDataRange().getValues();
    const s = {}; const rowMap = {};
    seqData.forEach((row, i) => { if (row[0]) { s[row[0]] = row[1]; rowMap[row[0]] = i + 1; } });
    let prefix = progMap[`${type}_PREFIX`];
    if (!prefix || String(prefix).includes('undefined')) prefix = (type === 'IS' ? 'IS' : type === 'INCENTIVES' ? 'INC' : type.substring(0,3));
    const incYear  = parseBool_(progMap['INCLUDE_YEAR']  !== undefined ? progMap['INCLUDE_YEAR']  : true);
    const incMonth = parseBool_(progMap['INCLUDE_MONTH'] !== undefined ? progMap['INCLUDE_MONTH'] : true);
    const now = new Date(); const yyyy = String(now.getFullYear()); const mm = String(now.getMonth()+1).padStart(2,'0');
    const periodKey = `SEQ_${type}_${incYear ? yyyy : ''}${incMonth ? mm : ''}`;
    let seqVal = (incYear || incMonth) ? (s[periodKey] || s[`STARTING_SEQUENCE_${type}`]) : s[`STARTING_SEQUENCE_${type}`];
    if (!seqVal || String(seqVal).includes('undefined')) seqVal = 1;
    let seq = Number(seqVal) || 1;
    const id = `${prefix}${incYear ? yyyy : ''}${incMonth ? mm : ''}${String(seq).padStart(4,'0')}`;
    const targetKey = (incYear || incMonth) ? periodKey : `STARTING_SEQUENCE_${type}`;
    if (rowMap[targetKey]) seqSheet.getRange(rowMap[targetKey], 2).setValue(seq + 1); else seqSheet.appendRow([targetKey, seq + 1]);
    return id;
  } finally { lock.releaseLock(); }
}

function getDisbSS_() { return SpreadsheetApp.openById(DISBURSEMENT_DB_ID); }

function getOrCreateDisbSheet_(sheetName) {
  const ss = getDisbSS_(); let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
    if (sheetName === 'IncentiveSheets')     sh.appendRow(['SheetId','ServiceStart','ServiceEnd','VehicleType','TotalAmount','Status','LinkedVoucherId','CreatedAt','CreatedBy','ShareLink']);
    else if (sheetName === 'IncentiveSheetLines') sh.appendRow(['SheetId','Rider ID','Rider Name','Station Name','Vehicle Type','Region','Sub-Region','Bank Account','Total Incentives','Incentive Status']);
    else if (sheetName === 'RiderAccounts')  sh.appendRow(['Rider ID','Rider Name','Bank Account']);
  }
  return sh;
}

function getDisbSheetData_(sheetName) {
  const sh = getOrCreateDisbSheet_(sheetName);
  const data = sh.getDataRange().getValues(); if (data.length < 2) return [];
  const headers = data[0]; const result = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i]; if (row.join('').trim() === '') continue;
    const obj = {}; headers.forEach((h, c) => { if (h) obj[String(h).trim()] = row[c] instanceof Date ? row[c].toISOString().split('T')[0] : row[c]; });
    result.push(obj);
  }
  return result;
}

function getIncentiveData() {
  const disbSS = getDisbSS_();
  const readSheet = (name) => {
    const sh = disbSS.getSheetByName(name); if (!sh) return [];
    const data = sh.getDataRange().getValues(); if (data.length < 2) return [];
    const h = data[0]; const result = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i].join('').trim() === '') continue;
      const obj = {}; h.forEach((hh, c) => { if (hh) obj[String(hh).trim()] = data[i][c] instanceof Date ? data[i][c].toISOString().split('T')[0] : data[i][c]; });
      result.push(obj);
    }
    return result;
  };
  return {
    incentiveSheets: readSheet('IncentiveSheets').reverse(),
    incentiveLines:  readSheet('IncentiveSheetLines'),
    riderAccounts:   readSheet('RiderAccounts'),
    disbAccounts:    readSheet('Accounts')
  };
}

function saveRiderAccount(payload) {
  const sh   = getOrCreateDisbSheet_('RiderAccounts');
  const data = sh.getDataRange().getValues();
  const h    = data[0].map(c => String(c).trim());
  const idIdx = h.indexOf('Rider ID'); const nmIdx = h.indexOf('Rider Name'); const bkIdx = h.indexOf('Bank Account');
  if (idIdx < 0) throw new Error('RiderAccounts sheet missing "Rider ID" column.');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idIdx]).trim() === String(payload.riderId).trim()) {
      if (nmIdx >= 0) sh.getRange(i + 1, nmIdx + 1).setValue(payload.riderName);
      if (bkIdx >= 0) sh.getRange(i + 1, bkIdx + 1).setValue(payload.bankAccount);
      return { updated: true };
    }
  }
  const newRow = new Array(h.length).fill('');
  if (idIdx >= 0) newRow[idIdx] = payload.riderId;
  if (nmIdx >= 0) newRow[nmIdx] = payload.riderName;
  if (bkIdx >= 0) newRow[bkIdx] = payload.bankAccount;
  sh.appendRow(newRow);
  return { created: true };
}

function deleteRiderAccount(riderId) {
  const sh   = getOrCreateDisbSheet_('RiderAccounts');
  const data = sh.getDataRange().getValues();
  const h    = data[0].map(c => String(c).trim());
  const idIdx = h.indexOf('Rider ID');
  if (idIdx < 0) return false;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idIdx]).trim() === String(riderId).trim()) { sh.deleteRow(i + 1); return true; }
  }
  return false;
}

// Ensures IncentiveSheets has ServiceStart + ServiceEnd columns (migrates from DateCoverage if needed).
// Returns the current header row as an array of strings.
function ensureISColumns_(isSheet) {
  const lastCol = isSheet.getLastColumn() || 1;
  const hdr = isSheet.getRange(1, 1, 1, lastCol).getValues()[0].map(c => String(c).trim());
  const dcIdx = hdr.indexOf('DateCoverage');
  if (dcIdx >= 0 && hdr.indexOf('ServiceStart') < 0) {
    isSheet.getRange(1, dcIdx + 1).setValue('ServiceStart');
    hdr[dcIdx] = 'ServiceStart';
  }
  if (hdr.indexOf('ServiceEnd') < 0) {
    const ssIdx = hdr.indexOf('ServiceStart');
    if (ssIdx >= 0) {
      isSheet.insertColumnAfter(ssIdx + 1);
      isSheet.getRange(1, ssIdx + 2).setValue('ServiceEnd');
      hdr.splice(ssIdx + 1, 0, 'ServiceEnd');
    }
  }
  return isSheet.getRange(1, 1, 1, isSheet.getLastColumn()).getValues()[0].map(c => String(c).trim());
}

function createIncentiveSheet(payload) {
  const user = Session.getEffectiveUser().getEmail();
  const now  = new Date();
  const id   = generateVoucherId_('IS');
  const coverageLabel = [payload.serviceStart, payload.serviceEnd].filter(Boolean).join(' to ') || payload.dateCoverage || '';
  const ssNew = SpreadsheetApp.create(`SPX Incentives - ${id} (${coverageLabel})`);
  const sheet = ssNew.getSheets()[0];
  const headers = ['SheetId','Rider ID','Rider Name','Station Name','Vehicle Type','Region','Sub-Region','Bank Account','Total Incentives','Incentive Status'];
  const rows = payload.lines.map(l => [id, l.riderId, l.riderName, l.stationName, l.vehicleType, l.region, l.subRegion, l.bankAccount, l.amount, l.status]);
  sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f3f4f6');
  if (rows.length > 0) sheet.getRange(2,1,rows.length,headers.length).setValues(rows);
  sheet.setFrozenRows(1); sheet.autoResizeColumns(1, headers.length);
  let shareLink = ssNew.getUrl();
  try {
    const file = DriveApp.getFileById(ssNew.getId());
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    // Move to SPX Incentives folder
    const targetFolder = DriveApp.getFolderById('1PN9JG59OMLDnYLaUPEaMNiA2ssH1QObL');
    targetFolder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
    shareLink = file.getUrl();
  } catch(e) {}
  const isSheet  = getOrCreateDisbSheet_('IncentiveSheets');
  const isHdrCols = ensureISColumns_(isSheet);
  const isNewRow  = new Array(isHdrCols.length).fill('');
  const isSet = (col, val) => { const i = isHdrCols.indexOf(col); if (i >= 0) isNewRow[i] = val; };
  isSet('SheetId', id);  isSet('ServiceStart', payload.serviceStart || payload.dateCoverage || '');
  isSet('ServiceEnd', payload.serviceEnd || '');  isSet('VehicleType', payload.vehicleType);
  isSet('TotalAmount', payload.totalAmount);  isSet('Status', 'Pending');
  isSet('LinkedVoucherId', '');  isSet('CreatedAt', now);  isSet('CreatedBy', user);  isSet('ShareLink', shareLink);
  isSheet.appendRow(isNewRow);
  const islSheet = getOrCreateDisbSheet_('IncentiveSheetLines');
  if (rows.length > 0) { const lastRow = islSheet.getLastRow(); const maxR = islSheet.getMaxRows(); if (lastRow + rows.length > maxR) islSheet.insertRowsAfter(lastRow, (lastRow + rows.length) - maxR + 50); islSheet.getRange(lastRow+1,1,rows.length,headers.length).setValues(rows); }

  // Write Accrual JE: DR Employee Incentives Deployed / CR Salaries and Wages Payable
  try {
    let expCode = ''; let expName = 'Employee Incentives Deployed';
    let swpCode2 = ''; let swpName2 = 'Salaries and Wages Payable';
    const disbSS2 = getDisbSS_(); const accSh = disbSS2.getSheetByName('Accounts');
    if (accSh) {
      const acRows = accSh.getDataRange().getValues(); const acHdr = acRows[0];
      const namCI = acHdr.findIndex(h => String(h).toLowerCase().includes('name'));
      const codCI = acHdr.findIndex(h => String(h).toLowerCase().includes('code'));
      for (let i = 1; i < acRows.length; i++) {
        const c = String(acRows[i][codCI]||'').trim(); const n = String(acRows[i][namCI]||'');
        if (n.toLowerCase().includes('employee incentive') || n.toLowerCase().includes('incentives deployed')) { expCode = c; expName = n; }
        if (n.toLowerCase().includes('salaries and wages payable')) { swpCode2 = c; swpName2 = n; }
      }
    }
    const cjSh = getCentralJournalSheet_(false);
    const jeIdAcc = 'JE-IS-' + id;
    const jAccRows = [
      [id, jeIdAcc, 1, expCode,  expName,  'IS Accrual - '+id, '', '', payload.totalAmount, 0,                   now, user, '', now, '', ''],
      [id, jeIdAcc, 2, swpCode2, swpName2, 'IS Accrual - '+id, '', '', 0,                   payload.totalAmount, now, user, '', now, '', '']
    ];
    cjSh.getRange(cjSh.getLastRow()+1, 1, jAccRows.length, 16).setValues(jAccRows);
  } catch(jeErr) { Logger.log('IS accrual JE error: ' + jeErr); }

  // ── Sync to WRI Employee Masterlist ──────────────────────────────────
  // SPXRiderInc  : one row per unique rider  — upsert, never overwrite Bank Account
  // SPXIncDetails: one row per line per upload — always appended
  try {
    const wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);

    // --- SPXRiderInc ---
    let riderSh = wriSS.getSheetByName('SPXRiderInc');
    if (!riderSh) {
      riderSh = wriSS.insertSheet('SPXRiderInc');
      riderSh.appendRow(['Rider ID','Rider Name','Bank Account','Rider Status','Last Updated']);
      riderSh.getRange(1,1,1,5).setFontWeight('bold').setBackground('#f3f4f6');
      riderSh.setFrozenRows(1);
    }
    const rAll  = riderSh.getDataRange().getValues();
    const rHdr  = rAll[0].map(c => String(c).trim());
    const ridIdI = rHdr.indexOf('Rider ID');
    const ridNmI = rHdr.indexOf('Rider Name');
    const ridLuI = rHdr.indexOf('Last Updated');
    // Build map riderId → sheet row (1-based)
    const riderRowMap = {};
    for (let i = 1; i < rAll.length; i++) {
      const rid = String(rAll[i][ridIdI] || '').trim();
      if (rid) riderRowMap[rid] = i + 1;
    }
    const serviceDate = payload.serviceEnd || payload.serviceStart || Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    // Deduplicate riders from this upload
    const uniqueRiders = {};
    payload.lines.forEach(l => { if (l.riderId && !uniqueRiders[l.riderId]) uniqueRiders[l.riderId] = l.riderName; });
    const newRiderRows = [];
    Object.entries(uniqueRiders).forEach(([rid, name]) => {
      if (riderRowMap[rid]) {
        // Existing rider — update Last Updated only
        if (ridLuI >= 0) riderSh.getRange(riderRowMap[rid], ridLuI + 1).setValue(serviceDate);
      } else {
        // New rider — build row, leave Bank Account and Rider Status blank
        const row = new Array(rHdr.length).fill('');
        if (ridIdI >= 0) row[ridIdI] = String(rid);
        if (ridNmI >= 0) row[ridNmI] = String(name);
        if (ridLuI >= 0) row[ridLuI] = serviceDate;
        newRiderRows.push(row);
      }
    });
    if (newRiderRows.length > 0) {
      const rLast = riderSh.getLastRow(); const rMax = riderSh.getMaxRows();
      if (rLast + newRiderRows.length > rMax) riderSh.insertRowsAfter(rLast, newRiderRows.length + 50);
      riderSh.getRange(rLast + 1, 1, newRiderRows.length, rHdr.length).setValues(newRiderRows);
    }

    // --- SPXIncDetails ---
    let detSh = wriSS.getSheetByName('SPXIncDetails');
    if (!detSh) {
      detSh = wriSS.insertSheet('SPXIncDetails');
      detSh.appendRow(['Rider ID','Rider Name','Service Start','Service End','Amount','Status']);
      detSh.getRange(1,1,1,6).setFontWeight('bold').setBackground('#f3f4f6');
      detSh.setFrozenRows(1);
    }
    const detRows = payload.lines.map(l => [
      String(l.riderId), String(l.riderName),
      payload.serviceStart || '', payload.serviceEnd || '',
      l.amount, String(l.status)
    ]);
    if (detRows.length > 0) {
      const dLast = detSh.getLastRow(); const dMax = detSh.getMaxRows();
      if (dLast + detRows.length > dMax) detSh.insertRowsAfter(dLast, detRows.length + 50);
      detSh.getRange(dLast + 1, 1, detRows.length, 6).setValues(detRows);
    }
  } catch(wriErr) { Logger.log('SPX WRI sync error: ' + wriErr); }

  return { sheetId: id, shareLink: shareLink };
}

function updateIncentiveSheetData(payload) {
  const { sheetId, lines, totalAmount } = payload;
  const isSheet  = getOrCreateDisbSheet_('IncentiveSheets');
  const isData   = isSheet.getDataRange().getValues();
  let shareLink  = '';
  for (let i = 1; i < isData.length; i++) { if (isData[i][0] === sheetId) { isSheet.getRange(i+1,4).setValue(totalAmount); shareLink = isData[i][8]; break; } }
  const islSheet = getOrCreateDisbSheet_('IncentiveSheetLines');
  const islData  = islSheet.getDataRange().getValues();
  for (let i = islData.length-1; i >= 1; i--) { if (islData[i][0] === sheetId) islSheet.deleteRow(i+1); }
  const headers = ['SheetId','Rider ID','Rider Name','Station Name','Vehicle Type','Region','Sub-Region','Bank Account','Total Incentives','Incentive Status'];
  const rows = lines.map(l => [sheetId, l.riderId, l.riderName, l.stationName, l.vehicleType, l.region, l.subRegion, l.bankAccount, l.amount, l.status]);
  if (rows.length > 0) { const lastRow = islSheet.getLastRow(); const maxR = islSheet.getMaxRows(); if (lastRow + rows.length > maxR) islSheet.insertRowsAfter(lastRow, (lastRow + rows.length) - maxR + 50); islSheet.getRange(lastRow+1,1,rows.length,headers.length).setValues(rows); }
  if (shareLink && shareLink.includes('spreadsheets.google.com')) {
    try { const extSS = SpreadsheetApp.openByUrl(shareLink); const extSheet = extSS.getSheets()[0]; const extLast = extSheet.getLastRow(); if (extLast > 1) extSheet.getRange(2,1,extLast-1,headers.length).clearContent(); if (rows.length > 0) extSheet.getRange(2,1,rows.length,headers.length).setValues(rows); } catch(e) {}
  }
  
  // Sync Hold status to SPXIncDetails
  lines.forEach(line => {
    const isCHold = line.status.toLowerCase() === 'hold' || line.status.toLowerCase().includes('check account');
    if (isCHold) {
      syncIncentiveStatusToSPXIncDetails_(line.riderId, 'Hold');
    }
  });
  
  return { success: true, sheetId: sheetId };
}

function voidIncentiveSheet(sheetId) {
  const isSheet = getOrCreateDisbSheet_('IncentiveSheets');
  const isData  = isSheet.getDataRange().getValues();
  const hIdxId = isData[0].indexOf('SheetId'); const hIdxStatus = isData[0].indexOf('Status'); const hIdxLink = isData[0].indexOf('ShareLink'); const hIdxTotal = isData[0].indexOf('TotalAmount');
  let fileIdToTrash = null;
  for (let i = 1; i < isData.length; i++) {
    if (isData[i][hIdxId] === sheetId) {
      isSheet.getRange(i+1, hIdxStatus+1).setValue('Voided');
      isSheet.getRange(i+1, hIdxTotal+1).setValue(0);
      const shareLink = isData[i][hIdxLink];
      if (shareLink) { const m = String(shareLink).match(/\/d\/([a-zA-Z0-9-_]+)/); if (m) fileIdToTrash = m[1]; }
      break;
    }
  }
  const islSheet = getOrCreateDisbSheet_('IncentiveSheetLines');
  const islData  = islSheet.getDataRange().getValues();
  if (islData.length > 0) { const idIdx = islData[0].indexOf('SheetId'); for (let i = islData.length-1; i >= 1; i--) { if (islData[i][idIdx] === sheetId) islSheet.deleteRow(i+1); } }
  if (fileIdToTrash) { try { DriveApp.getFileById(fileIdToTrash).setTrashed(true); } catch(e) {} }
  return true;
}

// Sync Hold status from IncentiveSheetLines to SPXIncDetails when a rider is put on Hold
function syncIncentiveStatusToSPXIncDetails_(riderId, newStatus) {
  try {
    const disbSS = getDisbSS_();
    const riderAccSheet = disbSS.getSheetByName('SPXIncDetails');
    if (!riderAccSheet) return; // Sheet doesn't exist yet, skip
    const data = riderAccSheet.getDataRange().getValues();
    const headers = data [0].map(h => String(h).trim());
    const riderIdIdx = headers.findIndex(h => h.toLowerCase().includes('rider') && h.toLowerCase().includes('id'));
    const statusIdx = headers.findIndex(h => h.toLowerCase().includes('status') && h.toLowerCase().includes('incentive'));
    if (riderIdIdx < 0 || statusIdx < 0) return; // Required columns not found
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][riderIdIdx]).trim() === String(riderId).trim()) {
        riderAccSheet.getRange(i + 1, statusIdx + 1).setValue(newStatus);
        break;
      }
    }
  } catch(e) {
    Logger.log('syncIncentiveStatusToSPXIncDetails_ error: ' + e.message);
  }
}

// Update incentive status to 'Released' when voucher is paid or released
function updateIncentiveStatusWhenVoucherPaid(voucherId) {
  try {
    const disbSS = getDisbSS_();
    const voucherSheet = disbSS.getSheetByName('Vouchers');
    if (!voucherSheet) return;
    const vData = voucherSheet.getDataRange().getValues();
    const vHdr = vData[0].map(h => String(h).trim());
    const vIdIdx = vHdr.indexOf('VoucherId');
    const vTypeIdx = vHdr.indexOf('VoucherType');
    const vLinkedSheetIdx = vHdr.findIndex(h => h.toLowerCase().includes('linkedvoucherid') || h.toLowerCase().includes('linkedsheet'));
    let voucherRow = null;
    for (let i = 1; i < vData.length; i++) {
      if (String(vData[i][vIdIdx]).trim() === String(voucherId).trim()) {
        voucherRow = vData[i];
        break;
      }
    }
    if (!voucherRow) return;
    if (String(voucherRow[vTypeIdx]).trim() !== 'INCENTIVES') return; // Only process INCENTIVES vouchers
    const islSheet = disbSS.getSheetByName('IncentiveSheetLines');
    if (!islSheet) return;
    const islData = islSheet.getDataRange().getValues();
    const islHdr = islData[0].map(h => String(h).trim());
    const islVIdIdx = islHdr.findIndex(h => h.toLowerCase() === 'sheetid');
    const islStatusIdx = islHdr.findIndex(h => h.toLowerCase() === 'incentive status');
    if (islVIdIdx < 0 || islStatusIdx < 0) return;
    for (let i = 1; i < islData.length; i++) {
      if (String(islData[i][islVIdIdx]).trim() === String(voucherId).trim() || 
          String(islData[i][islVIdIdx]).trim().startsWith(String(voucherId).split('-')[0])) {
        islSheet.getRange(i + 1, islStatusIdx + 1).setValue('Released');
      }
    }
  } catch(e) {
    Logger.log('updateIncentiveStatusWhenVoucherPaid error: ' + e.message);
  }
}

function getIncentiveSheetPdfBase64(sheetId) {
  const isRec  = getDisbSheetData_('IncentiveSheets').find(s => String(s.SheetId) === String(sheetId));
  if (!isRec) throw new Error('Incentive Sheet not found.');
  const lines  = getDisbSheetData_('IncentiveSheetLines').filter(l => String(l.SheetId) === String(sheetId));
  const fmt    = n => Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  let totAmt = 0; let holdAmt = 0; let relAmt = 0; let relRows = ''; let holdRows = '';
  lines.forEach(l => {
    const amt    = Number(l['Total Incentives']||0);
    const status = String(l['Incentive Status']||'');
    const isHold = status.toLowerCase().includes('check account') || status.toLowerCase() === 'hold';
    totAmt += amt; if (isHold) holdAmt += amt; else relAmt += amt;
    const row = `<tr><td style="text-align:center;">${escapeHtml_(l['Rider ID'])}</td><td>${escapeHtml_(l['Rider Name'])}</td><td>${escapeHtml_(l['Station Name'])}</td><td style="text-align:center;">${escapeHtml_(l['Vehicle Type'])}</td><td style="text-align:center;">${escapeHtml_(l['Region'])}</td><td style="text-align:center;">${escapeHtml_(l['Sub-Region'])}</td><td style="text-align:center;">${escapeHtml_(l['Bank Account'])}</td><td style="text-align:right;">${fmt(amt)}</td></tr>`;
    if (isHold) holdRows += row; else relRows += row;
  });
  if (!relRows)  relRows  = '<tr><td colspan="8" style="text-align:center;">No riders for release.</td></tr>';
  if (!holdRows) holdRows = '<tr><td colspan="8" style="text-align:center;">No riders on hold.</td></tr>';
  const th = `<thead><tr><th>RIDER ID</th><th>RIDER NAME</th><th>STATION</th><th>VEHICLE</th><th>REGION</th><th>SUB-REGION</th><th>BANK ACCOUNT</th><th>AMOUNT</th></tr></thead>`;
  const html = `<html><head><style>@page{size:letter portrait;margin:0.25in}body{font-family:Arial,sans-serif;color:#000;margin:0;padding:0}table{width:100%;border-collapse:collapse;margin-bottom:15px;table-layout:fixed}th,td{border:1px solid #000;padding:4px;font-size:8pt;overflow:hidden}th{background:#ddebf7;font-weight:bold;text-align:center}.hdr{font-weight:bold;font-size:12pt;margin-bottom:15px;line-height:1.4}.sec{font-weight:bold;font-size:11pt;margin-top:15px;margin-bottom:5px;border-bottom:1px dashed #000;display:inline-block;padding-bottom:2px}</style></head><body><div class="hdr">SPX Incentives<br><span style="font-size:10pt;font-weight:normal">${escapeHtml_((isRec.ServiceStart || isRec.DateCoverage || '') + (isRec.ServiceEnd ? ' to ' + isRec.ServiceEnd : ''))}</span><br><span style="font-size:10pt;font-weight:normal">Vehicle Type: ${escapeHtml_(isRec.VehicleType)}</span></div><div class="sec">FOR RELEASE</div><table>${th}<tbody>${relRows}</tbody></table><div class="sec">ON HOLD (MISSING BANK ACCOUNTS)</div><table>${th}<tbody>${holdRows}</tbody></table><table style="width:300px;float:right;border-collapse:collapse;margin-top:15px"><tr><td style="border:none;padding:4px;font-weight:bold;">Grand Total:</td><td style="border:none;border-bottom:1px solid #000;padding:4px;text-align:right;">${fmt(totAmt)}</td></tr><tr><td style="border:none;padding:4px;font-weight:bold;">Hold:</td><td style="border:none;border-bottom:1px solid #000;padding:4px;text-align:right;">${fmt(holdAmt)}</td></tr><tr><td style="border:none;padding:4px;font-weight:bold;">FOR RELEASE:</td><td style="border:none;border-bottom:1px solid #000;padding:4px;text-align:right;">${fmt(relAmt)}</td></tr></table></body></html>`;
  try { const blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF); blob.setName('IncentiveSheet_'+sheetId+'.pdf'); return Utilities.base64Encode(blob.getBytes()); } catch(e) { throw new Error('PDF error: '+e.message); }
}

function createIncentiveVoucherInDisbApp(sheetId, prepDate, bankCode) {
  const user   = Session.getEffectiveUser().getEmail();
  const now    = new Date();
  const disbSS = getDisbSS_();

  // Validate IS
  const isSheet = disbSS.getSheetByName('IncentiveSheets');
  if (!isSheet) throw new Error('IncentiveSheets sheet not found in Disbursement DB.');
  const isData = isSheet.getDataRange().getValues();
  const isHdr  = isData[0];
  const idI = isHdr.indexOf('SheetId'); const statI = isHdr.indexOf('Status'); const ldI = isHdr.indexOf('LinkedVoucherId');
  const covI = isHdr.indexOf('ServiceStart') >= 0 ? isHdr.indexOf('ServiceStart') : isHdr.indexOf('DateCoverage');
  const sveI = isHdr.indexOf('ServiceEnd');
  const vtI = isHdr.indexOf('VehicleType');
  let isRowIdx = -1;
  for (let i = 1; i < isData.length; i++) { if (String(isData[i][idI]).trim() === String(sheetId).trim()) { isRowIdx = i; break; } }
  if (isRowIdx < 0) throw new Error('Incentive Sheet not found: ' + sheetId);
  if (String(isData[isRowIdx][statI]).trim() !== 'Pending') throw new Error('Only Pending sheets can be vouchered. Status: ' + isData[isRowIdx][statI]);

  // Load For Release lines
  const islSheet = disbSS.getSheetByName('IncentiveSheetLines');
  if (!islSheet) throw new Error('IncentiveSheetLines not found.');
  const islData = islSheet.getDataRange().getValues(); const islHdr = islData[0];
  const islIdI = islHdr.indexOf('SheetId'); const islAmtI = islHdr.indexOf('Total Incentives');
  const islStI = islHdr.indexOf('Incentive Status'); const islNmI = islHdr.indexOf('Rider Name');
  let totalAmt = 0; const riderNames = []; let lineCount = 0;
  for (let i = 1; i < islData.length; i++) {
    if (String(islData[i][islIdI]).trim() !== String(sheetId).trim()) continue;
    if (String(islData[i][islStI]).trim() !== 'For Release') continue;
    totalAmt += Number(islData[i][islAmtI] || 0); riderNames.push(String(islData[i][islNmI] || '')); lineCount++;
  }
  if (totalAmt <= 0) throw new Error('No "For Release" lines found or total is zero.');

  // Look up account names
  let swpCode = ''; let swpName = 'Salaries and Wages Payable'; let bankName = bankCode;
  const accSheet = disbSS.getSheetByName('Accounts');
  if (accSheet) {
    const acRows = accSheet.getDataRange().getValues(); const acHdr = acRows[0];
    const namCI = acHdr.findIndex(h => String(h).toLowerCase().includes('name'));
    const codCI = acHdr.findIndex(h => String(h).toLowerCase().includes('code'));
    for (let i = 1; i < acRows.length; i++) {
      const code = String(acRows[i][codCI] || '').trim();
      const name = String(acRows[i][namCI] || '');
      if (name.toLowerCase().includes('salaries and wages payable')) { swpCode = code; swpName = name; }
      if (code === bankCode) bankName = name;
    }
  }

  const vid          = generateVoucherId_('INCENTIVES');
  const serviceStart_ = String(isData[isRowIdx][covI] || '');
  const serviceEnd_   = sveI >= 0 ? String(isData[isRowIdx][sveI] || '') : '';
  const dateCoverage  = serviceEnd_ ? `${serviceStart_} to ${serviceEnd_}` : serviceStart_;
  const vehicleType  = String(isData[isRowIdx][vtI]  || '');
  const contactSumm  = riderNames.slice(0,5).join(', ') + (riderNames.length > 5 ? ` +${riderNames.length-5} more` : '');

  // Write Voucher row
  let vSheet = disbSS.getSheetByName('Vouchers');
  if (!vSheet) { vSheet = disbSS.insertSheet('Vouchers'); vSheet.appendRow(['VoucherId','VoucherType','PreparationDate','PurposeCategory','Status','PaymentFromAccountCode','ContactSummary','TotalAmount','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy','CheckNumber','CheckDate','IsMultipleChecks','ReviewedBy','ApprovedBy','RejectReason','DisbursementRef','PreDisbursementStatus']); }
  const vHdr = vSheet.getRange(1,1,1,vSheet.getLastColumn()).getValues()[0];
  const vRow = new Array(vHdr.length).fill('');
  const vs = (c,v) => { const i = vHdr.indexOf(c); if (i>=0) vRow[i]=v; };
  vs('VoucherId',vid); vs('VoucherType','INCENTIVES'); vs('PreparationDate',prepDate);
  vs('PurposeCategory',''); vs('Status','Approved');
  vs('PaymentFromAccountCode',bankCode); vs('ContactSummary',contactSumm);
  vs('TotalAmount',totalAmt); vs('IsMultipleChecks','TRUE');
  vs('CreatedAt',now); vs('CreatedBy',user); vs('UpdatedAt',now); vs('UpdatedBy',user);
  vSheet.appendRow(vRow);

  // Write VoucherLines row
  let vlSheet = disbSS.getSheetByName('VoucherLines');
  if (!vlSheet) { vlSheet = disbSS.insertSheet('VoucherLines'); vlSheet.appendRow(['VoucherId','Date','LineNo','Contact','ExpenseAccountCode','Description','Amount','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy','Category','ManpowerCount','LineBankCode','LineCheckNumber','LineCheckDate']); }
  const vlHdr = vlSheet.getRange(1,1,1,vlSheet.getLastColumn()).getValues()[0];
  const vlRow = new Array(vlHdr.length).fill('');
  const vls = (c,v) => { const i = vlHdr.indexOf(c); if (i>=0) vlRow[i]=v; };
  vls('VoucherId',vid); vls('Date',prepDate); vls('LineNo',1);
  vls('Contact','SPX Riders'); vls('ExpenseAccountCode',swpCode);
  vls('Description',vehicleType+' Incentives');
  vls('Amount',totalAmt); vls('Category','Incentives'); vls('ManpowerCount',lineCount);
  vls('LineBankCode',bankCode);
  vls('CreatedAt',now); vls('CreatedBy',user); vls('UpdatedAt',now); vls('UpdatedBy',user);
  vlSheet.appendRow(vlRow);

  // Write Payment JE: DR Salaries and Wages Payable / CR Cash in Bank
  const cjSheet = getCentralJournalSheet_(false);
  const jeIdPayment = 'JE-' + vid;
  const jRows = [
    [vid, jeIdPayment, 1, swpCode,  swpName,  'Incentives Payment - '+sheetId,'', '', totalAmt, 0,        now, user, '', now, '', ''],
    [vid, jeIdPayment, 2, bankCode, bankName, 'Incentives Payment - '+sheetId,'', '', 0,        totalAmt, now, user, '', now, '', '']
  ];
  cjSheet.getRange(cjSheet.getLastRow()+1, 1, jRows.length, 16).setValues(jRows);

  // Mark IS as Vouchered
  isSheet.getRange(isRowIdx+1, statI+1).setValue('Vouchered');
  isSheet.getRange(isRowIdx+1, ldI+1).setValue(vid);

  return { voucherId: vid, totalAmount: totalAmt, lineCount: lineCount };
}

// =========================================================================
// CFO REPORTS — getPayrollReportsData
// =========================================================================
function getPayrollReportsData(params) {
  var rType   = parseInt(params.reportType || 1);
  var year    = parseInt(params.year  || new Date().getFullYear());
  var month   = parseInt(params.month || 0); // 0 = all months, 1–12 = specific month
  var company = String(params.company || '').trim();
  var ss      = getPayrollDB_();
  var n_ = function(v){ return parseFloat(String(v||0).replace(/[^0-9.-]/g,''))||0; };

  // ── PayrollBooks index (type filter only; date filtering moved to Cutoff End) ──
  var bkSheet = ss.getSheetByName('PayrollBooks');
  var bkIdx   = {};
  var allCompanies = {};
  if (bkSheet && bkSheet.getLastRow() > 1) {
    var bkVals = bkSheet.getDataRange().getValues();
    var bkH    = bkVals[0];
    var bi = {
      id:   bkH.indexOf('PayrollID'),
      name: bkH.indexOf('Name'),
      attr: bkH.indexOf('Attribution'),
      pdt:  bkH.indexOf('PayoutDate'),
      stat: bkH.indexOf('Status'),
      type: bkH.indexOf('Type')
    };
    for (var r = 1; r < bkVals.length; r++) {
      var row   = bkVals[r];
      var pid   = String(row[bi.id]   || '').trim();
      var ptype = String(row[bi.type] || '').trim();
      if (!pid) continue;
      if (rType === 5) {
        // 13M: gate by PayoutDate year — 13MConsolidated has no Cutoff End column
        if (ptype !== '13th Month') continue;
        var pdt   = row[bi.pdt];
        var dtObj = pdt instanceof Date ? pdt : (pdt ? new Date(pdt) : null);
        if (dtObj && !isNaN(dtObj.getTime()) && dtObj.getFullYear() !== year) continue;
      } else {
        if (ptype === '13th Month') continue;
      }
      var attr = String(row[bi.attr] || '').trim();
      bkIdx[pid] = { name: String(row[bi.name]||'').trim(), attribution: attr,
                     status: String(row[bi.stat]||'').trim(), type: ptype };
    }
  }

  // ── Report 5: 13M Accrual Tracker (source: WRI 13MDetails via cutoffend) ─
  if (rType === 5) {
    var wriSS   = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
    var tmSheet = wriSS.getSheetByName(WRI_13M_SHEET);
    var aggMap  = {}; // keyed by company

    if (tmSheet && tmSheet.getLastRow() > 1) {
      var tmVals = tmSheet.getDataRange().getValues();
      var tmH    = tmVals[0].map(normalizeColName_);
      var gi5 = function() {
        var args = Array.prototype.slice.call(arguments);
        for (var a = 0; a < args.length; a++) {
          var k = tmH.indexOf(args[a]); if (k !== -1) return k;
        }
        return -1;
      };
      var iCo   = gi5('companyname');
      var iUid  = gi5('userid');
      var iAmt  = gi5('nthmonthpaybillable');
      var iCEnd = gi5('cutoffend');
      var isWsIdx = gi5('companyname'); // same col, checked by value

      for (var r = 1; r < tmVals.length; r++) {
        var row    = tmVals[r];
        var co     = String(row[iCo]  || '').trim();
        var uid    = String(row[iUid] || '').trim();
        if (!co || !uid) continue;
        if (company && company !== '_all' && co !== company) continue;

        var cEndRaw = row[iCEnd];
        var cEnd    = cEndRaw instanceof Date ? cEndRaw : (cEndRaw ? new Date(cEndRaw) : null);
        if (!cEnd || isNaN(cEnd.getTime())) continue;

        var cEndYear = cEnd.getFullYear();
        var cEndMon  = cEnd.getMonth(); // 0-based

        var isWs = co.toLowerCase().indexOf('workscale') !== -1;

        // Map cutoffend → slot (0=Dec(Y-1), 1-11=Jan-Nov, 12=Dec(Y))
        var slot = -1;
        if (!isWs) {
          if (cEndYear === year - 1 && cEndMon === 11) slot = 0;
          else if (cEndYear === year && cEndMon <= 10) slot = cEndMon + 1;
        } else {
          if (cEndYear === year && cEndMon >= 0 && cEndMon <= 11) slot = cEndMon + 1;
        }
        if (slot < 0) continue;

        // Month filter: slot 0 = Dec prev year; slots 1-12 = months 1-12 of year
        if (month > 0 && slot !== month) continue;

        var amt = n_(row[iAmt]);
        allCompanies[co] = 1;

        // Count unique employees per company per slot using co+'||'+uid key
        var empKey = co + '||' + uid;
        if (!aggMap[co]) aggMap[co] = { slots: new Array(13).fill(0), empSets: [], total: 0 };
        var ag = aggMap[co];
        ag.slots[slot] += amt;
        if (ag.empSets.indexOf(empKey) === -1) ag.empSets.push(empKey);
        ag.total += amt;
      }
    }

    // Build output — when month filter active show single amount col, else full monthly breakdown
    var rows = []; var tHC = 0, tSlots = new Array(13).fill(0), tTot = 0;

    if (month > 0) {
      // Single-month view: Company | HC | Amount
      var mLabel = ['','Dec(Y-1)','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month];
      var headers = ['Company', 'Headcount', mLabel + ' Accrual'];
      Object.keys(aggMap).sort().forEach(function(co) {
        var ag = aggMap[co];
        var hc = ag.empSets.length;
        rows.push([co, hc, ag.slots[month]]);
        tHC += hc; tTot += ag.slots[month];
      });
      return {
        headers: headers, rows: rows, totRow: ['TOTAL', tHC, tTot], moneyCols: [2],
        companies: Object.keys(allCompanies).sort(),
        kpis: [
          { label:'Companies',       value: Object.keys(aggMap).length, type:'count', color:'#3b82f6' },
          { label:'Total Employees', value: tHC,                        type:'count', color:'#8b5cf6' },
          { label:'Month Accrual',   value: tTot,                       type:'money', color:'#f59e0b' }
        ]
      };
    }

    // All-months view: Company | HC | Dec(Y-1) | Jan…Nov | Dec(Y) | YTD Total
    var mNames  = ['Dec(Y-1)','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var headers = ['Company','Headcount'].concat(mNames).concat(['YTD Total']);
    Object.keys(aggMap).sort().forEach(function(co) {
      var ag   = aggMap[co];
      var hc   = ag.empSets.length;
      // Display order: slot0=Dec(Y-1), slots1-11=Jan-Nov, slot12=Dec(Y)
      var disp = [ag.slots[0]].concat(ag.slots.slice(1, 12)).concat([ag.slots[12]]);
      rows.push([co, hc].concat(disp).concat([ag.total]));
      tHC += hc;
      ag.slots.forEach(function(v, i){ tSlots[i] += v; });
      tTot += ag.total;
    });
    var dispTot = [tSlots[0]].concat(tSlots.slice(1, 12)).concat([tSlots[12]]);
    var totRow  = ['TOTAL', tHC].concat(dispTot).concat([tTot]);
    var mc5 = []; for (var i = 2; i < headers.length; i++) mc5.push(i);
    return {
      headers: headers, rows: rows, totRow: totRow, moneyCols: mc5,
      companies: Object.keys(allCompanies).sort(),
      kpis: [
        { label:'Companies',       value: Object.keys(aggMap).length, type:'count', color:'#3b82f6' },
        { label:'Total Employees', value: tHC,                        type:'count', color:'#8b5cf6' },
        { label:'YTD Accrual',     value: tTot,                       type:'money', color:'#f59e0b' }
      ]
    };
  }

  // ── Load PayrollBookConsolidated ───────────────────────────────────────
  var pbcSheet = ss.getSheetByName('PayrollBookConsolidated');
  if (!pbcSheet || pbcSheet.getLastRow() < 2) {
    return { headers:['No Data'], rows:[], totRow:[], moneyCols:[], companies:[], kpis:[] };
  }
  var pbcVals = pbcSheet.getDataRange().getValues();
  var pbcH    = pbcVals[0];
  var ci = function(name){ return pbcH.indexOf(name); };
  var F = {
    pid:  ci('PayrollID'),       name:  ci('Name'),
    gross:ci('Total Gross Pay'), ded:   ci('Total Deduction'),
    net:  ci('Payslip Net Pay'), m13:   ci('13th Month'),
    tax:  ci('Tax'),
    sse:  ci('SSS'),             ssr:   ci('SSS ER'),
    phe:  ci('Philhealth'),      phr:   ci('Philhealth ER'),
    pge:  ci('Pagibig'),         pgr:   ci('Pagibig ER'),
    pgl:  ci('Pagibig Loan'),    ssl:   ci('SSS Loan'),
    adm:  ci('Admin Fee'),       bil:   ci('Total Billable'),
    co:   ci('Company Name'),    stat:  ci('Salary Status'),
    lst:  ci('LineStatus'),
    cs:   ci('Cutoff Start'),    ce:    ci('Cutoff End'),
    bank: ci('Bank Account Number'), amt: ci('Amount'),
    days: ci('Days (days)'),
    uid:  ci('userid')
  };

  // ── Pre-filter PBC rows by Cutoff End year + month ─────────────────────
  var pbcFiltered = [pbcVals[0]];
  for (var r = 1; r < pbcVals.length; r++) {
    var ceRaw  = pbcVals[r][F.ce];
    var ceDate = ceRaw instanceof Date ? ceRaw : (ceRaw ? new Date(ceRaw) : null);
    if (!ceDate || isNaN(ceDate.getTime())) continue;
    if (ceDate.getFullYear() !== year) continue;
    if (month > 0 && ceDate.getMonth() + 1 !== month) continue;
    pbcFiltered.push(pbcVals[r]);
  }
  pbcVals = pbcFiltered;

  // Period string helper: YYYY-MM derived from each PBC row's Cutoff End
  var pe_ = function(row) {
    var ceRaw = row[F.ce];
    var d = ceRaw instanceof Date ? ceRaw : (ceRaw ? new Date(ceRaw) : null);
    if (!d || isNaN(d.getTime())) return 'Unknown';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };

  // ── Report 1: Payroll Summary ──────────────────────────────────────────
  if (rType === 1) {
    var aggMap = {};
    for (var r = 1; r < pbcVals.length; r++) {
      var row = pbcVals[r];
      var pid = String(row[F.pid]||'').trim();
      if (!bkIdx[pid]) continue;
      var co = String(row[F.co]||'').trim() || 'Unknown';
      if (company && company !== '_all' && co !== company) continue;
      allCompanies[co] = 1;
      var bk  = bkIdx[pid];
      var key = co + '|' + pid;
      if (!aggMap[key]) aggMap[key] = { co:co, book:bk.name, status:bk.status, hc:0, gross:0, ded:0, net:0, m13:0, _uids:{} };
      var ag = aggMap[key];
      var uid1 = F.uid > -1 ? String(row[F.uid]||'').trim() : '';
      if (!uid1 || !ag._uids[uid1]) { ag.hc++; if (uid1) ag._uids[uid1] = 1; }
      ag.gross+=n_(row[F.gross]); ag.ded+=n_(row[F.ded]); ag.net+=n_(row[F.net]); ag.m13+=n_(row[F.m13]);
    }
    var headers = ['Company','Book Name','Status','Headcount','Gross Pay','Total Deductions','Net Pay','13th Month'];
    var rows=[]; var tHC=0,tGr=0,tDe=0,tNt=0,tM=0;
    Object.keys(aggMap).sort().forEach(function(k){
      var ag = aggMap[k];
      rows.push([ag.co,ag.book,ag.status,ag.hc,ag.gross,ag.ded,ag.net,ag.m13]);
      tHC+=ag.hc; tGr+=ag.gross; tDe+=ag.ded; tNt+=ag.net; tM+=ag.m13;
    });
    return { headers:headers, rows:rows, totRow:['TOTAL','','',tHC,tGr,tDe,tNt,tM], moneyCols:[4,5,6,7],
      companies: Object.keys(allCompanies).sort(),
      kpis: [
        { label:'Payroll Books',  value:Object.keys(aggMap).length, type:'count', color:'#3b82f6' },
        { label:'Total HC',       value:tHC,  type:'count', color:'#8b5cf6' },
        { label:'Total Gross Pay',value:tGr,  type:'money', color:'#f59e0b' },
        { label:'Total Net Pay',  value:tNt,  type:'money', color:'#10b981' }
      ]
    };
  }

  // ── Report 2: Manpower Cost (WRI/HQ internal — grouped by Dept + Branch) ────
  if (rType === 2) {
    // Load WRI Masterlist uid → { dept, branch } map
    var mlMap2 = {};
    var deminMap2 = {}; // uid → total de minimis for the selected period
    try {
      var mlSS2    = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
      var mlSh2    = mlSS2.getSheetByName(WRI_MASTERLIST_SHEET_NAME);
      if (mlSh2 && mlSh2.getLastRow() > 1) {
        var mlVals2 = mlSh2.getDataRange().getValues();
        var mlH2    = mlVals2[0].map(function(h){ return String(h).toLowerCase().trim(); });
        var mlUidC  = mlH2.indexOf('userid');
        var mlDptC  = mlH2.indexOf('department');
        var mlBrnC  = mlH2.indexOf('branch');
        for (var mr = 1; mr < mlVals2.length; mr++) {
          var muid = String(mlVals2[mr][mlUidC] || '').trim();
          if (muid) mlMap2[muid] = {
            dept:   mlDptC > -1 ? String(mlVals2[mr][mlDptC] || '').trim() : '',
            branch: mlBrnC > -1 ? String(mlVals2[mr][mlBrnC] || '').trim() : ''
          };
        }
      }
      // Load DeminimisDetails filtered to the selected year (and month)
      var dmSh2 = mlSS2.getSheetByName(WRI_DEMIN_SHEET);
      if (dmSh2 && dmSh2.getLastRow() > 1) {
        var dmVals2 = dmSh2.getDataRange().getValues();
        var dmH2    = dmVals2[0].map(function(h){ return String(h).toLowerCase().trim(); });
        var dmUidI  = dmH2.indexOf('userid');
        var dmCeI   = dmH2.indexOf('cutoffend');
        var dmTotI  = dmH2.indexOf('total_deminimis');
        if (dmUidI > -1 && dmCeI > -1 && dmTotI > -1) {
          for (var dr = 1; dr < dmVals2.length; dr++) {
            var dmUid = String(dmVals2[dr][dmUidI] || '').trim();
            if (!dmUid) continue;
            var dmCeRaw  = dmVals2[dr][dmCeI];
            var dmCeDate = dmCeRaw instanceof Date ? dmCeRaw : new Date(dmCeRaw);
            if (isNaN(dmCeDate.getTime())) continue;
            if (dmCeDate.getFullYear() !== year) continue;
            if (month > 0 && dmCeDate.getMonth() + 1 !== month) continue;
            deminMap2[dmUid] = (deminMap2[dmUid] || 0) + (Number(dmVals2[dr][dmTotI]) || 0);
          }
        }
      }
    } catch(e) {}

    var aggMap = {};
    for (var r = 1; r < pbcVals.length; r++) {
      var row = pbcVals[r];
      var pid = String(row[F.pid]||'').trim();
      if (!bkIdx[pid]) continue;
      var co  = String(row[F.co]||'').trim() || 'Unknown';
      // Manpower Cost is WRI/HQ only — filter to Workscale entities
      if (co.toLowerCase().indexOf('workscale') === -1) continue;
      // Still respect the company dropdown if a specific non-_all selection is made
      if (company && company !== '_all' && co !== company) continue;
      allCompanies[co] = 1;
      var uid  = F.uid > -1 ? String(row[F.uid]||'').trim() : '';
      var orgInfo = (uid && mlMap2[uid]) ? mlMap2[uid] : { dept:'—', branch:'—' };
      var dept   = orgInfo.dept   || '—';
      var branch = orgInfo.branch || '—';
      var pe  = pe_(row);
      // When All Months: key collapses to dept+branch only so rows are annual aggregates.
      // When a specific month is selected: key includes period for monthly breakdowns.
      var key = month > 0 ? (pe + '|' + dept + '|' + branch) : (dept + '|' + branch);
      if (!aggMap[key]) aggMap[key] = { period: month > 0 ? pe : String(year), dept:dept, branch:branch, hc:0, gross:0, ssr:0, phr:0, pgr:0, demin:0, _uids:{} };
      var ag = aggMap[key];
      if (!uid || !ag._uids[uid]) {
        ag.hc++;
        // Add this employee's de minimis total (from DeminimisDetails) once per unique uid
        if (uid) { ag.demin += (deminMap2[uid] || 0); ag._uids[uid] = 1; }
      }
      ag.gross+=n_(row[F.gross]); ag.ssr+=n_(row[F.ssr]); ag.phr+=n_(row[F.phr]);
      ag.pgr+=n_(row[F.pgr]);
    }
    // When All Months, hide the Period column — rows are already year-level aggregates.
    var headers = month > 0
      ? ['Period','Department','Branch','HC','Gross Wages','SSS ER','PhilHealth ER','HDMF ER','De Minimis']
      : ['Department','Branch','HC','Gross Wages','SSS ER','PhilHealth ER','HDMF ER','De Minimis'];
    var rows=[]; var tHC=0,tGr=0,tSR=0,tPR=0,tPGR=0,tDm=0;
    Object.keys(aggMap).sort().forEach(function(k){
      var ag = aggMap[k];
      if (month > 0) rows.push([ag.period,ag.dept,ag.branch,ag.hc,ag.gross,ag.ssr,ag.phr,ag.pgr,ag.demin]);
      else           rows.push([ag.dept,ag.branch,ag.hc,ag.gross,ag.ssr,ag.phr,ag.pgr,ag.demin]);
      tHC+=ag.hc; tGr+=ag.gross; tSR+=ag.ssr; tPR+=ag.phr; tPGR+=ag.pgr; tDm+=ag.demin;
    });
    var totRow = month > 0 ? ['TOTAL','','',tHC,tGr,tSR,tPR,tPGR,tDm] : ['TOTAL','',tHC,tGr,tSR,tPR,tPGR,tDm];
    var moneyCols2 = month > 0 ? [4,5,6,7,8] : [3,4,5,6,7];
    return { headers:headers, rows:rows, totRow:totRow, moneyCols:moneyCols2,
      companies: Object.keys(allCompanies).sort(),
      kpis: [
        { label:'Departments',       value:Object.keys(aggMap).length, type:'count', color:'#3b82f6' },
        { label:'Total HC',          value:tHC,         type:'count', color:'#8b5cf6' },
        { label:'Total Gross Wages', value:tGr,         type:'money', color:'#f59e0b' },
        { label:'ER Contributions',  value:tSR+tPR+tPGR,type:'money', color:'#6366f1' },
        { label:'Total De Minimis',  value:tDm,         type:'money', color:'#10b981' }
      ]
    };
  }

  // ── Report 3: Government Contributions ────────────────────────────────
  if (rType === 3) {
    var aggMap = {};
    for (var r = 1; r < pbcVals.length; r++) {
      var row = pbcVals[r];
      var pid = String(row[F.pid]||'').trim();
      if (!bkIdx[pid]) continue;
      var co = String(row[F.co]||'').trim() || 'Unknown';
      if (company && company !== '_all' && co !== company) continue;
      allCompanies[co] = 1;
      var bk  = bkIdx[pid];
      var key = co;
      if (!aggMap[key]) aggMap[key] = { co:co, hc:0, sse:0,ssr:0,phe:0,phr:0,pge:0,pgr:0,ssl:0,pgl:0,tax:0, _uids:{} };
      var ag = aggMap[key];
      var uid3 = F.uid > -1 ? String(row[F.uid]||'').trim() : '';
      if (!uid3 || !ag._uids[uid3]) { ag.hc++; if (uid3) ag._uids[uid3] = 1; }
      ag.sse+=n_(row[F.sse]); ag.ssr+=n_(row[F.ssr]); ag.phe+=n_(row[F.phe]); ag.phr+=n_(row[F.phr]);
      ag.pge+=n_(row[F.pge]); ag.pgr+=n_(row[F.pgr]); ag.ssl+=n_(row[F.ssl]); ag.pgl+=n_(row[F.pgl]); ag.tax+=n_(row[F.tax]);
    }
    var headers = ['Company','HC','SSS EE','SSS ER','PhilHealth EE','PhilHealth ER','HDMF EE','HDMF ER','SSS Loans','HDMF Loans','WHT'];
    var rows=[]; var tHC=0,tSE=0,tSR=0,tPE=0,tPR=0,tGE=0,tGR=0,tSL=0,tGL=0,tTx=0;
    Object.keys(aggMap).sort().forEach(function(k){
      var ag = aggMap[k];
      rows.push([ag.co,ag.hc,ag.sse,ag.ssr,ag.phe,ag.phr,ag.pge,ag.pgr,ag.ssl,ag.pgl,ag.tax]);
      tHC+=ag.hc; tSE+=ag.sse; tSR+=ag.ssr; tPE+=ag.phe; tPR+=ag.phr;
      tGE+=ag.pge; tGR+=ag.pgr; tSL+=ag.ssl; tGL+=ag.pgl; tTx+=ag.tax;
    });
    return { headers:headers, rows:rows, totRow:['TOTAL',tHC,tSE,tSR,tPE,tPR,tGE,tGR,tSL,tGL,tTx], moneyCols:[2,3,4,5,6,7,8,9,10],
      companies: Object.keys(allCompanies).sort(),
      kpis: [
        { label:'Client Companies',  value:Object.keys(aggMap).length, type:'count', color:'#3b82f6' },
        { label:'Total HC',          value:tHC,        type:'count', color:'#8b5cf6' },
        { label:'Total SSS (EE+ER)', value:tSE+tSR,    type:'money', color:'#f59e0b' },
        { label:'Total WHT',         value:tTx,        type:'money', color:'#ef4444' }
      ]
    };
  }

  // ── Report 4: Withholding Tax Summary ─────────────────────────────────
  if (rType === 4) {
    var aggMap = {};
    for (var r = 1; r < pbcVals.length; r++) {
      var row = pbcVals[r];
      var pid = String(row[F.pid]||'').trim();
      if (!bkIdx[pid]) continue;
      var co = String(row[F.co]||'').trim() || 'Unknown';
      if (company && company !== '_all' && co !== company) continue;
      allCompanies[co] = 1;
      var bk  = bkIdx[pid];
      var pe  = pe_(row);
      var key = pe + '|' + co;
      if (!aggMap[key]) aggMap[key] = { period:pe, co:co, hc:0, tax:0, _uids:{} };
      var ag = aggMap[key];
      var uid4 = F.uid > -1 ? String(row[F.uid]||'').trim() : '';
      if (!uid4 || !ag._uids[uid4]) { ag.hc++; if (uid4) ag._uids[uid4] = 1; }
      ag.tax += n_(row[F.tax]);
    }
    var headers = ['Period','Company','Headcount','Total Tax Withheld'];
    var rows=[]; var tHC=0,tTx=0;
    Object.keys(aggMap).sort().forEach(function(k){
      var ag = aggMap[k];
      rows.push([ag.period, ag.co, ag.hc, ag.tax]);
      tHC += ag.hc; tTx += ag.tax;
    });
    return { headers:headers, rows:rows, totRow:['TOTAL','',tHC,tTx], moneyCols:[3],
      companies: Object.keys(allCompanies).sort(),
      kpis: [
        { label:'Periods',            value:Object.keys(aggMap).length,               type:'count', color:'#3b82f6' },
        { label:'Total HC',           value:tHC,                                      type:'count', color:'#8b5cf6' },
        { label:'Total WHT',          value:tTx,                                      type:'money', color:'#ef4444' },
        { label:'Avg WHT / Employee', value:tHC > 0 ? Math.round(tTx/tHC*100)/100 : 0, type:'money', color:'#f59e0b' }
      ]
    };
  }

  // ── Report 6: Bank Disbursement Summary ───────────────────────────────
  if (rType === 6) {
    var aggMap = {};
    for (var r = 1; r < pbcVals.length; r++) {
      var row = pbcVals[r];
      var pid = String(row[F.pid]||'').trim();
      if (!bkIdx[pid]) continue;
      var co = String(row[F.co]||'').trim() || 'Unknown';
      if (company && company !== '_all' && co !== company) continue;
      allCompanies[co] = 1;
      var bk  = bkIdx[pid];
      var pe  = pe_(row);
      var key = pid + '|' + co;
      if (!aggMap[key]) aggMap[key] = { period:pe, co:co, book:bk.name, status:bk.status, hc:0, release:0, hold:0, adm:0, total:0, _uids:{} };
      var ag  = aggMap[key];
      var lst = String(row[F.lst] || row[F.stat] || '').trim().toLowerCase();
      var amt = n_(row[F.amt]) || n_(row[F.net]);
      var uid6 = F.uid > -1 ? String(row[F.uid]||'').trim() : '';
      if (!uid6 || !ag._uids[uid6]) { ag.hc++; if (uid6) ag._uids[uid6] = 1; }
      if (lst === 'hold') ag.hold += amt; else ag.release += amt;
      ag.adm   += n_(row[F.adm]);
      ag.total += amt;
    }
    var headers = ['Book Name','Period','Company','Status','HC','For Release','Hold','Admin Fee','Grand Total'];
    var rows=[]; var tHC=0,tRel=0,tHld=0,tAdm=0,tTot=0;
    Object.keys(aggMap).sort().forEach(function(k){
      var ag = aggMap[k];
      rows.push([ag.book,ag.period,ag.co,ag.status,ag.hc,ag.release,ag.hold,ag.adm,ag.total+ag.adm]);
      tHC+=ag.hc; tRel+=ag.release; tHld+=ag.hold; tAdm+=ag.adm; tTot+=ag.total;
    });
    return { headers:headers, rows:rows, totRow:['TOTAL','','','',tHC,tRel,tHld,tAdm,tTot+tAdm], moneyCols:[5,6,7,8],
      companies: Object.keys(allCompanies).sort(),
      kpis: [
        { label:'Payroll Books', value:Object.keys(aggMap).length, type:'count', color:'#3b82f6' },
        { label:'Total HC',      value:tHC,   type:'count', color:'#8b5cf6' },
        { label:'For Release',   value:tRel,  type:'money', color:'#10b981' },
        { label:'On Hold',       value:tHld,  type:'money', color:'#ef4444' }
      ]
    };
  }

  // ── Report 7: Headcount & Movement ────────────────────────────────────
  var aggMap = {};
  for (var r = 1; r < pbcVals.length; r++) {
    var row = pbcVals[r];
    var pid = String(row[F.pid]||'').trim();
    if (!bkIdx[pid]) continue;
    var co = String(row[F.co]||'').trim() || 'Unknown';
    if (company && company !== '_all' && co !== company) continue;
    allCompanies[co] = 1;
    var bk  = bkIdx[pid];
    var key = co;
    if (!aggMap[key]) aggMap[key] = { co:co, total:0, release:0, hold:0, _uidStatus:{} };
    var ag  = aggMap[key];
    var lst = String(row[F.lst] || row[F.stat] || '').trim().toLowerCase();
    var uid7 = F.uid > -1 ? String(row[F.uid]||'').trim() : '';
    var uidKey7 = uid7 || ('_row_' + r);
    var prevStatus7 = ag._uidStatus[uidKey7];
    if (prevStatus7 === undefined) {
      ag.total++;
      if (lst === 'hold') { ag.hold++; ag._uidStatus[uidKey7] = 'hold'; }
      else { ag.release++; ag._uidStatus[uidKey7] = 'release'; }
    } else if (prevStatus7 === 'release' && lst === 'hold') {
      ag.release--; ag.hold++; ag._uidStatus[uidKey7] = 'hold';
    }
  }
  var headers = ['Company','Total HC','For Release','Hold / Pending','Hold %'];
  var rows=[]; var tHC=0,tRel=0,tHld=0;
  Object.keys(aggMap).sort().forEach(function(k){
    var ag  = aggMap[k];
    var pct = ag.total > 0 ? Math.round(ag.hold / ag.total * 1000) / 10 : 0;
    rows.push([ag.co, ag.total, ag.release, ag.hold, pct]);
    tHC += ag.total; tRel += ag.release; tHld += ag.hold;
  });
  var totPct = tHC > 0 ? Math.round(tHld / tHC * 1000) / 10 : 0;
  return { headers:headers, rows:rows, totRow:['TOTAL',tHC,tRel,tHld,totPct], moneyCols:[], numCols:[1,2,3,4],
    companies: Object.keys(allCompanies).sort(),
    kpis: [
      { label:'Companies',      value:Object.keys(aggMap).length, type:'count', color:'#3b82f6' },
      { label:'Total HC',       value:tHC,  type:'count', color:'#8b5cf6' },
      { label:'For Release',    value:tRel, type:'count', color:'#10b981' },
      { label:'Hold / Pending', value:tHld, type:'count', color:'#ef4444' }
    ]
  };
}

// =====================================================================
// FINAL PAY PAYSLIP GENERATOR
// =====================================================================

function getFinalPayPayslipData(fpId) {
  const ss = getPayrollDB_();
  const fpSheet = ss.getSheetByName('FinalPayBooks');
  if (!fpSheet) throw new Error('FinalPayBooks sheet not found');
  
  const fpData = fpSheet.getDataRange().getValues();
  const h = fpData[0];
  const fpIdx = h.indexOf('FP_ID');
  const releaseDateIdx = h.indexOf('Release Date');
  
  let fpRow = null;
  for (let i = 1; i < fpData.length; i++) {
    if (String(fpData[i][fpIdx]).trim() === String(fpId).trim()) {
      fpRow = fpData[i];
      break;
    }
  }
  if (!fpRow) throw new Error('Final Pay Book not found: ' + fpId);
  
  const releaseDate = String(fpRow[releaseDateIdx] || '').trim();
  
  // Get consolidated lines for this Final Pay batch
  const fpcSheet = ss.getSheetByName('FinalPayConsolidated');
  if (!fpcSheet) throw new Error('FinalPayConsolidated sheet not found');
  
  const fpcData = fpcSheet.getDataRange().getValues();
  const fpcHeaders = fpcData[0];
  const fpcNorm = fpcHeaders.map(normalizeColName_);
  
  const fpcIdIdx = fpcHeaders.indexOf('FP_ID');
  const employees = [];
  
  for (let i = 1; i < fpcData.length; i++) {
    if (String(fpcData[i][fpcIdIdx]).trim() === String(fpId).trim()) {
      const emp = {};
      fpcHeaders.forEach((h, idx) => { emp[h] = fpcData[i][idx]; });
      employees.push(emp);
    }
  }
  
  return { fpId, releaseDate, employees };
}

function generateFinalPayPayslipHtml(employee) {
  const fmtMoney = (n) => {
    const num = Number(n || 0);
    return num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const getVal = (obj, field) => {
    if (!obj || !field) return 0;
    let v = obj[field];
    if (v === '' || v === null || v === undefined) return 0;
    if (typeof v === 'string') v = v.replace(/[^0-9.-]+/g, '');
    const num = Number(v);
    return isNaN(num) ? 0 : num;
  };
  const getStr = (obj, field) => String(obj && obj[field] ? obj[field] : '').trim();

  const name   = getStr(employee, 'Name') || 'Employee';
  const client = getStr(employee, 'Client') || getStr(employee, 'Company Name') || 'N/A';
  const bank   = getStr(employee, 'Bank Account') || '';

  // Earnings
  const daysCount      = getVal(employee, 'Days (days)');
  const totalBsc       = getVal(employee, 'Total Bsc');
  const latesTolerance = getVal(employee, 'Lates (mins)');
  const lates          = getVal(employee, 'Lates');
  const overtime       = getVal(employee, 'Overtime');
  const nightDiff      = getVal(employee, 'ND');
  const dod            = getVal(employee, 'DOD');
  const dodOt          = getVal(employee, 'DOD OT');
  const splHol         = getVal(employee, 'Spl Hol');
  const splHolOt       = getVal(employee, 'Spl Hol OT');
  const lglHol         = getVal(employee, 'Lgl Hol');
  const lglHolOt       = getVal(employee, 'Lgl Hol OT');
  const adjustments    = getVal(employee, 'Adj');
  const thirteenthMonth = getVal(employee, '13th Month');
  // Compute earnings total from every line item shown in the payslip (lates is a deduction, subtract it)
  const totalGrossPay = totalBsc + thirteenthMonth - lates
                      + overtime + dod + dodOt
                      + splHol + splHolOt
                      + lglHol + lglHolOt
                      + nightDiff + adjustments;

  // Deductions
  const sss         = getVal(employee, 'SSS');
  const sssLoan     = getVal(employee, 'SSS Loan');
  const philhealth  = getVal(employee, 'Philhealth');
  const pagibig     = getVal(employee, 'Pagibig');
  const pagibigLoan = getVal(employee, 'Pagibig Loan');
  const tax         = getVal(employee, 'Tax');
  const totalDeductions = getVal(employee, 'Total Deduction');

  const netPay = getVal(employee, 'Net Final Pay');

  // Benefits
  let benefitItems = [];
  try { benefitItems = JSON.parse(String(employee['Benefits JSON'] || '[]')); } catch(e) {}
  const totalBenefits = benefitItems.reduce(function(s, b) { return s + (Number(b.amount) || 0); }, 0);

  // Logo — try to load from Central Settings, fall back to styled text
  let logoHtml = '<span style="font-weight:900;font-size:13pt;letter-spacing:1px;">WORKSCALE RESOURCES</span>';
  try {
    const mSheet = getCentralSS_().getSheetByName('Modules');
    if (mSheet) {
      const mData = mSheet.getDataRange().getValues();
      const kIdx = mData[0].indexOf('Key'); const vIdx = mData[0].indexOf('Value');
      if (kIdx >= 0 && vIdx >= 0) {
        for (let i = 1; i < mData.length; i++) {
          if (String(mData[i][kIdx]).trim() === 'LETTERHEAD_LINK') {
            const b64 = fetchImageBase64DisbApp_(String(mData[i][vIdx]).trim());
            if (b64) { logoHtml = '<img src="' + b64 + '" style="max-height:55px;max-width:240px;object-fit:contain;">'; }
            break;
          }
        }
      }
    }
  } catch(e) {}

  const html = `<!DOCTYPE html>
<html>
<head>
<style>
  @page { size: letter portrait; margin: 0.4in; }
  body { font-family: Arial, sans-serif; font-size: 8pt; color: #000; margin: 0; padding: 0; line-height: 1.35; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #bbb; padding: 2px 5px; }
  .hdr { background-color: #2E75B6; color: #fff; font-weight: bold; }
  .nb  { border: none !important; }
  .r   { text-align: right; }
  .c   { text-align: center; }
  .b   { font-weight: bold; }
</style>
</head>
<body>

<!-- ── LOGO + TITLE ── -->
<table style="margin-bottom:6px; border:none;">
  <tr><td class="nb c">${logoHtml}</td></tr>
  <tr><td class="nb c" style="font-size:9pt; padding-top:2px;">FINAL PAY SLIP</td></tr>
</table>

<!-- ── EMPLOYEE INFO ── -->
<table style="margin-bottom:8px; font-size:9pt; border:none;">
  <tr>
    <td class="nb r b" style="width:18%;">Employee Name:</td>
    <td class="nb" style="width:32%;">${name}</td>
    <td class="nb" style="width:50%;"></td>
  </tr>
  <tr>
    <td class="nb r b">Client:</td>
    <td class="nb">${client}</td>
    <td class="nb"></td>
  </tr>
  <tr>
    <td class="nb r b">BPI Bank Account:</td>
    <td class="nb">${bank}</td>
    <td class="nb"></td>
  </tr>
</table>

<!-- ── EARNINGS + OTHER DEDUCTIONS ── -->
<table style="font-size:8pt;">
  <colgroup>
    <col style="width:28%;"/>
    <col style="width:7%;"/>
    <col style="width:13%;"/>
    <col style="width:6%;"/>
    <col style="width:34%;"/>
    <col style="width:12%;"/>
  </colgroup>
  <tr>
    <th class="hdr">Earnings</th>
    <th class="hdr c">Days</th>
    <th class="hdr r">Amount</th>
    <td style="border:none; background:#fff;"></td>
    <th class="hdr">Other Deductions</th>
    <th class="hdr r">Amount</th>
  </tr>
  <!-- Row 1: Regular Days / Claims -->
  <tr>
    <td>Regular Days</td>
    <td class="c">${daysCount > 0 ? daysCount : ''}</td>
    <td class="r">${totalBsc > 0 ? fmtMoney(totalBsc) : ''}</td>
    <td style="border:none;"></td>
    <td>Claims</td><td></td>
  </tr>
  <!-- Row 2: 13th Month / Charges -->
  <tr>
    <td>13th Month</td><td></td>
    <td class="r">${thirteenthMonth > 0 ? fmtMoney(thirteenthMonth) : ''}</td>
    <td style="border:none;"></td>
    <td>Charges</td><td></td>
  </tr>
  <!-- Row 3: Lates / Other Deductions Total -->
  <tr>
    <td>Lates</td>
    <td class="c">${latesTolerance > 0 ? latesTolerance + ' mins' : ''}</td>
    <td class="r">${lates > 0 ? '- ' + fmtMoney(lates) : ''}</td>
    <td style="border:none;"></td>
    <td class="r b">Total</td>
    <td class="r">-</td>
  </tr>
  <!-- Row 4: Regular Overtime / Incentive sub-header -->
  <tr>
    <td>Regular Overtime</td><td></td>
    <td class="r">${overtime > 0 ? fmtMoney(overtime) : ''}</td>
    <td style="border:none;"></td>
    <th class="hdr">Incentive</th>
    <th class="hdr r">Amount</th>
  </tr>
  <!-- Row 5: Day-off Duty -->
  <tr>
    <td>Day-off Duty</td><td></td>
    <td class="r">${dod > 0 ? fmtMoney(dod) : ''}</td>
    <td style="border:none;"></td>
    <td></td><td></td>
  </tr>
  <!-- Row 6: Day-off Duty Overtime / Incentive Total -->
  <tr>
    <td>Day-off Duty Overtime</td><td></td>
    <td class="r">${dodOt > 0 ? fmtMoney(dodOt) : ''}</td>
    <td style="border:none;"></td>
    <td class="r b">Total</td>
    <td class="r">-</td>
  </tr>
  <!-- Row 7: Special Non-Working Holiday -->
  <tr>
    <td>Special Non-Working Holiday</td><td></td>
    <td class="r">${splHol > 0 ? fmtMoney(splHol) : ''}</td>
    <td style="border:none;"></td>
    <td></td><td></td>
  </tr>
  <!-- Row 8: Special Non-Working Holiday OT -->
  <tr>
    <td>Special Non-Working Holiday OT</td><td></td>
    <td class="r">${splHolOt > 0 ? fmtMoney(splHolOt) : ''}</td>
    <td style="border:none;"></td>
    <td></td><td></td>
  </tr>
  <!-- Row 9: Legal Holiday -->
  <tr>
    <td>Legal Holiday</td><td></td>
    <td class="r">${lglHol > 0 ? fmtMoney(lglHol) : ''}</td>
    <td style="border:none;"></td>
    <td></td><td></td>
  </tr>
  <!-- Row 10: Legal Holiday OT -->
  <tr>
    <td>Legal Holiday OT</td><td></td>
    <td class="r">${lglHolOt > 0 ? fmtMoney(lglHolOt) : ''}</td>
    <td style="border:none;"></td>
    <td></td><td></td>
  </tr>
  <!-- Row 11: Night Differential -->
  <tr>
    <td>Night Differential</td><td></td>
    <td class="r">${nightDiff > 0 ? fmtMoney(nightDiff) : ''}</td>
    <td style="border:none;"></td>
    <td></td><td></td>
  </tr>
  <!-- Row 12: Adjustments -->
  <tr>
    <td>Adjustments</td><td></td>
    <td class="r">${adjustments > 0 ? fmtMoney(adjustments) : ''}</td>
    <td style="border:none;"></td>
    <td></td><td></td>
  </tr>
  <!-- Blank spacer row -->
  <tr><td></td><td></td><td style="border-bottom:none;"></td><td style="border:none;"></td><td></td><td></td></tr>
  <!-- Gross Earnings total (separator line above amount) -->
  <tr>
    <td></td><td></td>
    <td class="r b" style="border-top:2px solid #444;">${fmtMoney(totalGrossPay)}</td>
    <td style="border:none;"></td>
    <td></td><td></td>
  </tr>
</table>

<!-- ── EMPLOYEE DEDUCTIONS ── -->
<table style="font-size:8pt; margin-top:8px; margin-bottom:8px;">
  <tr>
    <th class="hdr" style="width:75%;">Employee Deductions</th>
    <th class="hdr r" style="width:25%;">Amount</th>
  </tr>
  <tr><td>SSS EE</td><td class="r">${sss > 0 ? fmtMoney(sss) : ''}</td></tr>
  <tr><td>Philhealth EE</td><td class="r">${philhealth > 0 ? fmtMoney(philhealth) : ''}</td></tr>
  <tr><td>Pag-Ibig</td><td class="r">${pagibig > 0 ? fmtMoney(pagibig) : ''}</td></tr>
  <tr><td>SSS Loan</td><td class="r">${sssLoan > 0 ? fmtMoney(sssLoan) : ''}</td></tr>
  <tr><td>Pag-Ibig Loan</td><td class="r">${pagibigLoan > 0 ? fmtMoney(pagibigLoan) : ''}</td></tr>
  ${tax > 0 ? `<tr><td>Withholding Tax / Others</td><td class="r">${fmtMoney(tax)}</td></tr>` : ''}
  <tr>
    <td class="r b">Total</td>
    <td class="r b" style="border-top:2px solid #444;">${fmtMoney(totalDeductions)}</td>
  </tr>
</table>

<!-- ── BENEFITS + SUMMARY ── -->
<table style="border:none; font-size:8pt;">
  <tr>
    <!-- Benefits (left ~55%) -->
    <td style="width:55%; vertical-align:top; padding:0; border:none;">
      <table style="width:100%; font-size:8pt;">
        <tr>
          <th class="hdr" style="width:72%;">Benefits</th>
          <th class="hdr r" style="width:28%;">Amount</th>
        </tr>
        ${benefitItems.length > 0
          ? benefitItems.map(function(b){ return '<tr><td>' + (b.particular||'') + '</td><td class="r">' + (Number(b.amount||0) > 0 ? fmtMoney(b.amount) : '') + '</td></tr>'; }).join('')
          : '<tr><td>Monthly</td><td></td></tr><tr><td>Transpo</td><td></td></tr>'}
        <tr>
          <td class="r b">Total</td>
          <td class="r b" style="border-top:2px solid #444;">${totalBenefits > 0 ? fmtMoney(totalBenefits) : ''}</td>
        </tr>
      </table>
    </td>
    <!-- Summary (right ~45%) -->
    <td style="width:45%; vertical-align:bottom; padding:0 0 0 12px; border:none;">
      <table style="width:100%; border:none; font-size:9pt; border-collapse:collapse;">
        <tr>
          <td class="nb r" style="width:55%;">Gross Earning</td>
          <td class="nb r b" style="width:45%;">${fmtMoney(totalGrossPay)}</td>
        </tr>
        <tr>
          <td class="nb r">Total Deductions</td>
          <td class="nb r b">${fmtMoney(totalDeductions)}</td>
        </tr>
        <tr>
          <td class="nb r">Total Benefits</td>
          <td class="nb r b">${totalBenefits > 0 ? fmtMoney(totalBenefits) : ''}</td>
        </tr>
        <tr>
          <td class="nb r b">Net Pay</td>
          <td style="background:#FFC000; font-weight:900; text-align:right; font-size:12pt; border:2px solid #E0A800; padding:4px 8px;">${fmtMoney(netPay)}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>

</body>
</html>`;

  return html;
}

function generateFinalPayPayslipPdf(employee) {
  try {
    const html = generateFinalPayPayslipHtml(employee);
    if (!html || html.length === 0) {
      throw new Error('Empty HTML generated for employee: ' + employee['Name']);
    }
    
    const blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
    if (!blob) {
      throw new Error('PDF conversion failed for employee: ' + employee['Name']);
    }
    
    const bytes = blob.getBytes();
    if (!bytes || bytes.length === 0) {
      throw new Error('Empty PDF generated for employee: ' + employee['Name']);
    }
    
    const base64 = Utilities.base64Encode(bytes);
    if (!base64 || base64.length === 0) {
      throw new Error('Base64 encoding failed for employee: ' + employee['Name']);
    }
    
    return base64;
  } catch (error) {
    throw new Error('PDF generation error for ' + (employee['Name'] || 'Unknown') + ': ' + error.message);
  }
}

function generateFinalPayPayslips(fpId) {
  try {
    Logger.log('=== generateFinalPayPayslips START: fpId=' + fpId);
    
    const data = getFinalPayPayslipData(fpId);
    Logger.log('Got payslip data. Employees count: ' + data.employees.length);
    Logger.log('Release Date: ' + data.releaseDate);
    
    if (!data.employees || data.employees.length === 0) {
      throw new Error('No employees found in FinalPayConsolidated for FP_ID: ' + fpId);
    }
    
    const payslips = [];
    
    data.employees.forEach((emp, index) => {
      try {
        Logger.log('Processing employee ' + (index + 1) + ': ' + emp['Name']);
        
        const name = String(emp['Name'] || 'Unknown').trim();
        if (!name || name.length === 0) {
          Logger.log('WARN: Empty employee name at index ' + index);
        }
        
        const pdfBase64 = generateFinalPayPayslipPdf(emp);
        Logger.log('Generated PDF for ' + name + '. Base64 length: ' + (pdfBase64 ? pdfBase64.length : 0));
        
        payslips.push({
          employeeName: name,
          fpId: fpId,
          pdfBase64: pdfBase64,
          fileName: name.replace(/[^a-zA-Z0-9_]/g, '_') + '_FinalPaySlip.pdf'
        });
      } catch (empErr) {
        Logger.log('ERROR for employee ' + (index + 1) + ': ' + empErr.message);
        throw empErr;
      }
    });
    
    Logger.log('Successfully generated ' + payslips.length + ' payslips');
    
    return {
      success: true,
      fpId: fpId,
      releaseDate: data.releaseDate,
      totalPayslips: payslips.length,
      payslips: payslips
    };
  } catch (error) {
    Logger.log('FATAL ERROR in generateFinalPayPayslips: ' + error.message);
    throw new Error('Failed to generate Final Pay payslips: ' + error.message);
  }
}

function downloadFinalPayPayslipZip(fpId) {
  try {
    Logger.log('=== downloadFinalPayPayslipZip START: fpId=' + fpId);
    
    const result = generateFinalPayPayslips(fpId);
    Logger.log('generateFinalPayPayslips completed. Success: ' + result.success + ', Payslips: ' + result.totalPayslips);
    
    if (!result.success) {
      throw new Error('Failed to generate payslips: ' + (result.error || 'Unknown error'));
    }
    if (result.payslips.length === 0) {
      throw new Error('No employees found for Final Pay Book: ' + fpId);
    }
    
    Logger.log('Preparing ' + result.payslips.length + ' payslips for download');
    const payslipsForDownload = [];
    
    result.payslips.forEach((ps, index) => {
      Logger.log('Preparing payslip ' + (index + 1) + ': ' + ps.employeeName);
      
      if (!ps.pdfBase64 || ps.pdfBase64.length === 0) {
        throw new Error('Empty PDF for employee ' + (index + 1) + ': ' + ps.employeeName);
      }
      
      payslipsForDownload.push({
        fileName: ps.fileName,
        pdfBase64: ps.pdfBase64,
        employeeName: ps.employeeName
      });
      
      Logger.log('Added to download queue: ' + ps.fileName);
    });
    
    Logger.log('=== downloadFinalPayPayslipZip SUCCESS ===');
    Logger.log('Total payslips ready: ' + payslipsForDownload.length);
    
    return {
      success: true,
      payslips: payslipsForDownload,
      totalPayslips: payslipsForDownload.length,
      fpId: fpId
    };
  } catch (error) {
    Logger.log('FATAL ERROR in downloadFinalPayPayslipZip: ' + error.message);
    throw new Error('Failed to download Final Pay payslips: ' + error.message);
  }
}

// =====================================================================
// BIR FORMS — Form 2316 Generator
// =====================================================================

/**
 * Returns a list of BIR 2316 records for the given year from BIR2316Data sheet.
 * @param {number} year
 * @returns {Array<Object>}
 */
function getBir2316List(year) {
  try {
    var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);
    var birSh = wriSS.getSheetByName('BIR2316Data');
    if (!birSh) throw new Error('BIR2316Data sheet not found. Please upload HRIS Raw Data first to initialize it.');
    if (birSh.getLastRow() < 2) throw new Error('BIR2316Data is empty. Please upload HRIS Raw Data to populate it.');
    // Use getDisplayValues() — returns everything as strings, avoids Date serialization failures
    var data = birSh.getDataRange().getDisplayValues();
    var headers = data[0].map(function(h) { return String(h).toLowerCase().trim(); });
    var yearIdx = headers.indexOf('year');
    if (yearIdx === -1) throw new Error('BIR2316Data is missing a "year" column. Please re-upload HRIS Raw Data.');
    var yr = parseInt(year, 10) || new Date().getFullYear();
    var result = [];
    for (var i = 1; i < data.length; i++) {
      // Robust year parse — strips formatting like "2,026.00" → 2026
      var rowYear = parseInt(String(data[i][yearIdx]).replace(/[^0-9]/g, '').substring(0, 4), 10);
      if (rowYear !== yr) continue;
      var obj = {};
      headers.forEach(function(h, idx) { obj[h] = data[i][idx]; });
      result.push(obj);
    }
    if (result.length === 0) {
      var foundYears = {};
      for (var j = 1; j < data.length; j++) {
        var fy = parseInt(String(data[j][yearIdx]).replace(/[^0-9]/g, '').substring(0, 4), 10);
        if (!isNaN(fy)) foundYears[fy] = true;
      }
      throw new Error('No records for year ' + yr + '. Sheet has ' + (data.length - 1) + ' row(s) for: ' + (Object.keys(foundYears).join(', ') || 'unknown years') + '. Re-run Build Data for ' + yr + '.');
    }
    return result.sort(function(a, b) {
      return String(a.last_name || '').localeCompare(String(b.last_name || ''));
    });
  } catch (e) {
    throw new Error('getBir2316List: ' + e.message);
  }
}

/**
 * Generates a BIR Form 2316 PDF for one employee.
 * @param {{userid:string, companyname:string, year:number}} payload
 * @returns {{success:boolean, base64:string, fileName:string}}
 */
function generate2316Pdf(payload) {
  try {
    var userid = String(payload.userid || '').trim();
    var year   = parseInt(payload.year, 10) || new Date().getFullYear();

    var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);

    // ---- Load BIR2316Data row ----
    var birSh = wriSS.getSheetByName('BIR2316Data');
    if (!birSh) throw new Error('BIR2316Data sheet not found. Please upload HRIS Raw Data first to initialize it.');
    var birData = birSh.getDataRange().getValues();
    var birH = birData[0].map(function(h) { return String(h).toLowerCase().trim(); });
    var bir = null;
    for (var i = 1; i < birData.length; i++) {
      var rowYear = parseInt(birData[i][birH.indexOf('year')], 10);
      var rowUid  = String(birData[i][birH.indexOf('userid')] || '').trim();
      if (rowYear === year && rowUid === userid) {
        bir = {};
        birH.forEach(function(h, idx) { bir[h] = birData[i][idx]; });
        break;
      }
    }
    if (!bir) throw new Error('No BIR 2316 data found for this employee (userid=' + userid + ', year=' + year + '). Ensure HRIS data for this period has been uploaded.');

    // ---- Load Masterlist profile ----
    var profile = {};
    var mlSh = wriSS.getSheetByName(WRI_MASTERLIST_SHEET_NAME);
    if (mlSh && mlSh.getLastRow() > 1) {
      var mlData = mlSh.getDataRange().getValues();
      var mlH = mlData[0].map(function(h) { return String(h).toLowerCase().trim(); });
      var mlUidIdx = mlH.indexOf('userid');
      for (var j = 1; j < mlData.length; j++) {
        if (String(mlData[j][mlUidIdx] || '').trim() === userid) {
          mlH.forEach(function(h, idx) { profile[h] = mlData[j][idx]; });
          break;
        }
      }
    }

    // ---- Compute period (from Masterlist hire/separation dates) ----
    var cutoffFrom = '01/01/' + year;
    var cutoffTo   = '12/31/' + year;
    if (profile.hiringdate) {
      var hd = profile.hiringdate instanceof Date ? profile.hiringdate : new Date(profile.hiringdate);
      if (!isNaN(hd.getTime()) && hd.getFullYear() === year)
        cutoffFrom = Utilities.formatDate(hd, Session.getScriptTimeZone(), 'MM/dd/yyyy');
    }
    if (profile.separationdate) {
      var sd = profile.separationdate instanceof Date ? profile.separationdate : new Date(profile.separationdate);
      if (!isNaN(sd.getTime()) && sd.getFullYear() === year)
        cutoffTo = Utilities.formatDate(sd, Session.getScriptTimeZone(), 'MM/dd/yyyy');
    }

    // ---- Load BIR 2316 employer settings from Central Settings ----
    var employer = {};
    try {
      var centralSS = SpreadsheetApp.openById(CENTRAL_SETTINGS_ID);
      var modSh2316 = centralSS.getSheetByName('Modules');
      if (modSh2316) {
        var cs = {};
        modSh2316.getDataRange().getValues().slice(1).forEach(function(r) {
          var k = String(r[0]||'').trim(); if (k) cs[k] = r[1];
        });
        employer.company_name         = String(cs['BIR2316_COMPANY_NAME']         || '');
        employer.tin                  = String(cs['BIR2316_COMPANY_TIN']          || '');
        employer.address              = String(cs['BIR2316_COMPANY_ADDRESS']      || '');
        employer.address_zip          = String(cs['BIR2316_COMPANY_ZIP']          || '');
        employer.authorized_signatory = String(cs['BIR2316_AUTHORIZED_SIGNATORY'] || '');
        employer.employer_type        = 'Main';
      }
    } catch (e) { Logger.log('BIR2316 employer settings load error: ' + e.message); }

    var html = _build2316HtmlV2_(bir, profile, employer, year, cutoffFrom, cutoffTo);
    var blob = Utilities.newBlob(html, MimeType.HTML).getAs(MimeType.PDF);
    var lastName  = String(bir.last_name  || '').trim().replace(/[^A-Za-z0-9]/g, '_');
    var firstName = String(bir.first_name || '').trim().replace(/[^A-Za-z0-9]/g, '_');
    blob.setName('BIR2316_' + year + '_' + lastName + '_' + firstName + '.pdf');
    return { success: true, base64: Utilities.base64Encode(blob.getBytes()), fileName: blob.getName() };
  } catch (e) {
    throw new Error('generate2316Pdf failed: ' + e.message);
  }
}

/**
 * Builds the full HTML string for BIR Form 2316 (table-based, folio 8.5"x13").
 */
function _build2316Html_(bir, profile, employer, year, cutoffFrom, cutoffTo) {
  var esc = escapeHtml_;

  var fmtAmt = function(n) {
    var v = parseFloat(String(n || '0').replace(/[^0-9.-]/g, '')) || 0;
    return v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  var fmtTinParts = function(tin) {
    var c = String(tin || '').replace(/[^0-9]/g, '');
    return [c.substr(0,3)||'', c.substr(3,3)||'', c.substr(6,3)||'', c.substr(9,3)||''];
  };

  var empTinP       = fmtTinParts(profile.tin  || '');
  var emplTinP      = fmtTinParts(employer.tin || '');
  var empName       = [esc(bir.last_name||''), esc(bir.first_name||''), esc(bir.middlename||'')].filter(Boolean).join(', ');
  var rdoCode       = esc(profile.rdo_code          || '');
  var address       = esc(profile.address           || '');
  var addrZip       = esc(profile.address_zip       || '');
  var localAddr     = esc(profile.local_address     || '');
  var localZip      = esc(profile.local_address_zip || '');
  var dob           = esc(profile.date_of_birth ? standardizeDateStr_(profile.date_of_birth) : '');
  var contact       = esc(profile.contact_number    || '');
  var smwDaily      = esc(profile.regulardayrate || '');
  var smwMonthly    = esc(profile.smw_monthly       || '');
  var isMweRaw      = String(profile.is_mwe         || '').toLowerCase().trim();
  var mweChecked    = (isMweRaw === 'true' || isMweRaw === 'yes' || isMweRaw === '1');
  var emplName      = esc(employer.company_name     || '');
  var emplAddr      = esc(employer.address          || '');
  var emplZip       = esc(employer.address_zip      || '');
  var authorizedSig = esc(employer.authorized_signatory || '');
  var isMain        = String(employer.employer_type || 'Main').toLowerCase().indexOf('main') >= 0;
  var periodFrom    = esc(cutoffFrom || '');
  var periodTo      = esc(cutoffTo   || '');

  var totalNontax    = parseFloat(bir.total_nontaxable      || 0);
  var taxablePresent = parseFloat(bir.total_taxable_present || 0);
  var taxDue         = parseFloat(bir.tax_due               || 0);
  var taxWH          = parseFloat(bir.tax_withheld          || 0);
  var totalTaxWH     = parseFloat(bir.total_tax_withheld    || taxWH || 0);
  var nontaxBasic    = parseFloat(bir.nontax_basic          || 0);
  var nontax13th     = parseFloat(bir.nontax_13thmonth      || 0);
  var nontaxDemin    = parseFloat(bir.nontax_salaries_other || 0);
  var nontaxSPH      = parseFloat(bir.nontax_sss_phic_hdmf  || 0);
  var totalNTCalc    = nontaxBasic + nontax13th + nontaxDemin + nontaxSPH;
  var taxableBasic   = parseFloat(bir.taxable_basic         || 0);
  var taxable13th    = parseFloat(bir.taxable_13thmonth     || 0);
  var taxableSalOth  = parseFloat(bir.taxable_salaries_other|| 0);
  var totalTaxCalc   = taxableBasic + taxable13th + taxableSalOth;  // Item 52
  var grossPresent   = totalNTCalc + totalTaxCalc;  // Item 19 = Item 38 + Item 52

  var css = [
    '@page{size:8.5in 13in;margin:0.2in}',
    'html,body{margin:0;padding:0}',
    'body{font-family:Arial,Helvetica,sans-serif;font-size:6.5pt;color:#000}',
    'table{border-collapse:collapse;width:100%}',
    'td,th{padding:1px 2px;vertical-align:top}',
    '.bb{border-bottom:0.5pt solid #000}.bl{border-left:0.5pt solid #000}',
    '.br{border-right:0.5pt solid #000}.bdr{border:0.5pt solid #000}',
    '.fn{font-size:5pt;font-weight:bold}',
    '.lbl{font-size:5pt;color:#444}',
    '.val{font-weight:bold;font-size:7pt;display:block;min-height:9px}',
    '.hdr{background:#d9d9d9;font-weight:bold;font-size:6pt;padding:1px 3px}',
    '.amt{text-align:right;font-size:7pt}',
    '.tin{display:inline-block;border:0.5pt solid #000;padding:0 3px;min-width:22px;'
      + 'text-align:center;font-weight:bold;margin:0 1px;font-size:7pt}',
    '.chk{display:inline-block;width:7px;height:7px;border:0.5pt solid #000;'
      + 'text-align:center;font-size:6pt;line-height:7px;vertical-align:middle}'
  ].join('');

  var tinBoxes = function(parts) {
    return parts.map(function(p) {
      return '<span class="tin">' + (p ? esc(p) : '&nbsp;') + '</span>';
    }).join('');
  };

  var summRow = function(num, label, val, bold) {
    var fw = bold ? 'bold' : 'normal';
    return '<tr>'
      + '<td class="bb" style="width:62%;font-size:6pt;padding:1px 3px"><span class="fn">'
      + num + '</span>&nbsp;' + label + '</td>'
      + '<td class="bb bl amt" style="width:38%;padding:1px 4px;font-weight:' + fw + ';'
      + (bold ? 'font-size:7.5pt;' : '') + '">'
      + (val === '' ? '&nbsp;' : fmtAmt(val)) + '</td></tr>';
  };

  var detRow = function(num, label, val) {
    return '<tr>'
      + '<td class="bb" style="width:70%;font-size:6pt;padding:1px 3px"><span class="fn">'
      + num + '</span>&nbsp;' + label + '</td>'
      + '<td class="bb bl amt" style="width:30%;padding:1px 4px">'
      + fmtAmt(val) + '</td></tr>';
  };

  var h = '';

  // HEADER — replicating BIR 2316 official layout (Image 3 style)
  // Row 1: For BIR Use Only | BIR Seal + Agency name | (empty right)
  h += '<table style="width:100%;border:0.5pt solid #000;border-bottom:none;margin-bottom:0"><tr>';
  h += '<td style="width:14%;border-right:0.5pt solid #000;padding:2px 3px;vertical-align:middle">';
  h += '<span style="font-size:5pt;font-weight:bold">For BIR</span><br>';
  h += '<span style="font-size:5pt;font-weight:bold">Use Only</span></td>';
  h += '<td style="width:6%;border-right:0.5pt solid #000;padding:2px 3px;vertical-align:middle;font-size:5pt">BCS/<br>Item:</td>';
  h += '<td style="text-align:center;padding:2px 3px;vertical-align:middle">';
  // BIR seal — CSS-only circle emblem that renders cleanly in Chromium PDF
  h += '<div style="display:inline-block;width:28px;height:28px;border-radius:50%;border:1.5pt solid #000;'
     + 'line-height:28px;text-align:center;font-size:10pt;font-weight:bold;vertical-align:middle">&#9790;</div>';
  h += '&nbsp;<span style="font-size:6pt;font-weight:bold;vertical-align:middle">Republic of the Philippines<br>'
     + 'Department of Finance<br>Bureau of Internal Revenue</span>';
  h += '</td>';
  h += '</tr></table>';
  // Row 2: BIR Form No. | Title | Barcode placeholder
  h += '<table style="width:100%;border:0.5pt solid #000;border-bottom:none;margin-bottom:0"><tr>';
  h += '<td style="width:13%;border-right:0.5pt solid #000;text-align:center;padding:2px 3px;vertical-align:middle">';
  h += '<div style="font-size:5pt">BIR Form No.</div>';
  h += '<div style="font-size:18pt;font-weight:bold;line-height:1">2316</div>';
  h += '<div style="font-size:5pt">September 2021 (ENCS)</div></td>';
  h += '<td style="text-align:center;padding:2px 3px;vertical-align:middle">';
  h += '<div style="font-size:11pt;font-weight:bold;line-height:1.15">Certificate of Compensation<br>Payment/Tax Withheld</div>';
  h += '<div style="font-size:5.5pt;margin-top:1px">For Compensation Payment With or Without Tax Withheld</div></td>';
  h += '<td style="width:14%;border-left:0.5pt solid #000;text-align:center;padding:2px 3px;vertical-align:middle">';
  // Barcode placeholder — hatched pattern using repeating chars
  h += '<div style="font-family:\'Courier New\',monospace;font-size:4pt;letter-spacing:-0.5pt;line-height:1.05;font-weight:bold">';
  for (var _i = 0; _i < 5; _i++) h += '&#9608;&#9617;&#9608;&#9617;&#9608;&#9617;&#9608;&#9617;&#9608;&#9617;&#9608;&#9617;&#9608;<br>';
  h += '</div>';
  h += '<div style="font-size:5pt;margin-top:1px">2316 09/21 ENCS</div>';
  h += '</td>';
  h += '</tr></table>';
  // Row 3: instructions
  h += '<div style="font-size:5.5pt;border:0.5pt solid #000;padding:1px 2px;margin-bottom:2px">Fill in all applicable spaces. Mark all appropriate boxes with an &ldquo;X&rdquo;.</div>';

  // YEAR + PERIOD
  h += '<table style="margin-bottom:1px"><tr>';
  h += '<td class="bdr" style="width:28%;padding:2px">';
  h += '<span class="fn">1</span>&nbsp;<span class="lbl">For the Year (YYYY)</span><br>';
  h += '<span style="display:inline-block;border:0.5pt solid #000;padding:1px 8px;font-weight:bold;font-size:9pt">' + esc(String(year)) + '</span>';
  h += '</td>';
  h += '<td class="bdr" style="padding:2px">';
  h += '<span class="fn">2</span>&nbsp;<span class="lbl">For the Period</span><br>';
  h += '<span class="lbl">From&nbsp;</span>';
  h += '<span style="border:0.5pt solid #000;padding:1px 5px;font-weight:bold;font-size:8pt">' + periodFrom + '</span>';
  h += '&nbsp;&nbsp;<span class="lbl">To&nbsp;</span>';
  h += '<span style="border:0.5pt solid #000;padding:1px 5px;font-weight:bold;font-size:8pt">' + periodTo + '</span>';
  h += '</td></tr></table>';

  // MAIN TWO-COLUMN BODY
  h += '<table style="border:0.5pt solid #000;width:100%;height:100%"><tr>';

  // LEFT COLUMN
  h += '<td style="width:46%;border-right:0.8pt solid #000;padding:0;vertical-align:top">';

  // Part I — all rows unified into one table; header as first <tr>; consistent padding:2px 3px
  h += '<table>';
  h += '<tr><td colspan="2" class="hdr">Part I &mdash; Employee Information</td></tr>';
  h += '<tr>';
  h += '<td class="bb br" style="width:66%;padding:2px 3px"><span class="fn">3</span>&nbsp;<span class="lbl">TIN</span><br>' + tinBoxes(empTinP) + '</td>';
  h += '<td class="bb" style="padding:2px 3px"><span class="fn">5</span>&nbsp;<span class="lbl">RDO Code</span><br><span class="val">' + rdoCode + '</span></td>';
  h += '</tr>';
  h += '<tr><td colspan="2" class="bb" style="padding:2px 3px"><span class="fn">4</span>&nbsp;<span class="lbl">Employee&rsquo;s Name (Last Name, First Name, Middle Name)</span><br><span class="val">' + empName + '</span></td></tr>';
  h += '<tr>';
  h += '<td class="bb br" style="padding:2px 3px"><span class="fn">6</span>&nbsp;<span class="lbl">Registered Address</span><br><span class="val">' + address + '</span></td>';
  h += '<td class="bb" style="padding:2px 3px"><span class="lbl">6A Zip</span><br><span class="val">' + addrZip + '</span></td>';
  h += '</tr>';
  h += '<tr>';
  h += '<td class="bb br" style="padding:2px 3px"><span class="lbl">6B Local Home Address</span><br><span class="val">' + localAddr + '</span></td>';
  h += '<td class="bb" style="padding:2px 3px"><span class="lbl">6C Zip</span><br><span class="val">' + localZip + '</span></td>';
  h += '</tr>';
  h += '<tr><td colspan="2" class="bb" style="padding:2px 3px"><span class="lbl">6D Foreign Address</span><br><span class="val">&nbsp;</span></td></tr>';
  h += '<tr>';
  h += '<td class="bb br" style="padding:2px 3px"><span class="fn">7</span>&nbsp;<span class="lbl">Date of Birth (MM/DD/YYYY)</span><br><span class="val">' + dob + '</span></td>';
  h += '<td class="bb" style="padding:2px 3px"><span class="fn">8</span>&nbsp;<span class="lbl">Contact Number</span><br><span class="val">' + contact + '</span></td>';
  h += '</tr>';
  h += '<tr>';
  h += '<td class="bb br" style="padding:2px 3px"><span class="fn">9</span>&nbsp;<span class="lbl">Stat. Min. Wage/day</span><br><span class="val">' + (smwDaily || '&nbsp;') + '</span></td>';
  h += '<td class="bb" style="padding:2px 3px"><span class="fn">10</span>&nbsp;<span class="lbl">Stat. Min. Wage/month</span><br><span class="val">' + (smwMonthly || '&nbsp;') + '</span></td>';
  h += '</tr>';
  h += '<tr><td colspan="2" class="bb" style="padding:2px 3px"><span class="fn">11</span>&nbsp;<span class="chk">' + (mweChecked ? 'X' : '&nbsp;') + '</span>&nbsp;<span style="font-size:5.5pt">Minimum Wage Earner &mdash; exempt from withholding; not subject to income tax</span></td></tr>';
  h += '</table>';

  // Part II — unified table
  h += '<table>';
  h += '<tr><td colspan="2" class="hdr">Part II &mdash; Employer Information (Present)</td></tr>';
  h += '<tr><td colspan="2" class="bb" style="padding:2px 3px"><span class="fn">12</span>&nbsp;<span class="lbl">TIN</span><br>' + tinBoxes(emplTinP) + '</td></tr>';
  h += '<tr><td colspan="2" class="bb" style="padding:2px 3px"><span class="fn">13</span>&nbsp;<span class="lbl">Employer&rsquo;s Name</span><br><span class="val">' + emplName + '</span></td></tr>';
  h += '<tr>';
  h += '<td class="bb br" style="width:76%;padding:2px 3px"><span class="fn">14</span>&nbsp;<span class="lbl">Registered Address</span><br><span class="val">' + emplAddr + '</span></td>';
  h += '<td class="bb" style="padding:2px 3px"><span class="lbl">14A Zip</span><br><span class="val">' + emplZip + '</span></td>';
  h += '</tr>';
  h += '<tr><td colspan="2" class="bb" style="padding:2px 3px"><span class="fn">15</span>&nbsp;<span class="lbl">Type of Employer:</span>&nbsp;&nbsp;';
  h += '<span class="chk">' + (isMain ? 'X' : '&nbsp;') + '</span>&nbsp;<span style="font-size:8pt;font-weight:bold">Main Employer</span>&nbsp;&nbsp;&nbsp;';
  h += '<span class="chk">' + (!isMain ? 'X' : '&nbsp;') + '</span>&nbsp;<span style="font-size:7pt">Secondary Employer</span></td></tr>';
  h += '</table>';

  // Part III — unified table
  h += '<table>';
  h += '<tr><td colspan="2" class="hdr">Part III &mdash; Employer Information (Previous)</td></tr>';
  h += '<tr><td colspan="2" class="bb" style="padding:2px 3px"><span class="fn">16</span>&nbsp;<span class="lbl">TIN</span><br>';
  h += ['','','',''].map(function(){return '<span class="tin">&nbsp;&nbsp;&nbsp;</span>';}).join('') + '</td></tr>';
  h += '<tr><td colspan="2" class="bb" style="padding:2px 3px"><span class="fn">17</span>&nbsp;<span class="lbl">Employer&rsquo;s Name</span><br><span class="val">&nbsp;</span></td></tr>';
  h += '<tr>';
  h += '<td class="bb br" style="width:76%;padding:2px 3px"><span class="fn">18</span>&nbsp;<span class="lbl">Registered Address</span><br><span class="val">&nbsp;</span></td>';
  h += '<td class="bb" style="padding:2px 3px"><span class="lbl">18A Zip</span><br><span class="val">&nbsp;</span></td>';
  h += '</tr>';
  h += '</table>';

  // Part IV-A — unified table, header as first row
  h += '<table>';
  h += '<tr><td colspan="2" class="hdr">Part IV-A &mdash; Summary</td></tr>';
  h += summRow(19, 'Gross Compensation Income from Present Employer', grossPresent, true);
  h += summRow(20, 'Less: Total Non-Taxable/Exempt Compensation (from Item 38)', totalNontax, false);
  h += summRow(21, 'Taxable Compensation Income from Present Employer', taxablePresent, false);
  h += summRow(22, 'Add: Taxable Compensation from Previous Employer, if any', '', false);
  h += summRow(23, 'Gross Taxable Compensation Income (Sum of Items 21 &amp; 22)', taxablePresent, true);
  h += summRow(24, 'Tax Due', taxDue, false);
  h += '<tr><td class="bb" colspan="2" style="font-size:6pt;padding:2px 3px"><span class="fn">25</span>&nbsp;Amount of Taxes Withheld</td></tr>';
  h += summRow('25A', 'Present Employer', taxWH, false);
  h += summRow('25B', 'Previous Employer, if applicable', '', false);
  h += summRow(26, 'Total Taxes Withheld as Adjusted (Sum of 25A &amp; 25B)', totalTaxWH, false);
  h += summRow(27, '5% Tax Credit (PERA Act of 2008)', 0, false);
  h += summRow(28, 'Total Taxes Withheld (Sum of Items 26 &amp; 27)', totalTaxWH, true);
  h += '</table>';

  h += '</td>'; // end left column

  // RIGHT COLUMN — one table, height:100% so rows spread evenly top-to-bottom
  h += '<td style="width:54%;padding:0;vertical-align:top;height:100%">';
  h += '<table style="width:100%;height:100%;border-collapse:collapse">';
  // Part IV-B header (inside table so height:100% works without a div gap)
  h += '<tr><td colspan="2" class="hdr" style="padding:1px 3px">'
     + 'Part IV-B &mdash; Details of Compensation Income &amp; Tax Withheld (Present Employer)</td></tr>';
  // ── Section A ──────────────────────────────────────────────────────────────
  h += '<tr><td colspan="2" style="background:#e8e8e8;font-weight:bold;font-size:5.5pt;'
     + 'padding:1px 3px;border-top:0.5pt solid #000;border-bottom:0.5pt solid #000">'
     + 'A. NON-TAXABLE / EXEMPT COMPENSATION INCOME</td></tr>';
  h += detRow(29, 'Basic Salary (incl. exempt &le;&#8369;250,000 or Statutory Min. Wage of MWE)', nontaxBasic);
  h += detRow(30, 'Holiday Pay (MWE)', 0);
  h += detRow(31, 'Overtime Pay (MWE)', 0);
  h += detRow(32, 'Night Shift Differential (MWE)', 0);
  h += detRow(33, 'Hazard Pay (MWE)', 0);
  h += detRow(34, '13th Month Pay and Other Benefits (max &#8369;90,000)', nontax13th);
  h += detRow(35, 'De Minimis Benefits', nontaxDemin);
  h += detRow(36, 'SSS, GSIS, PHIC &amp; Pag-IBIG Contributions &amp; Union Dues (EE share)', nontaxSPH);
  h += detRow(37, 'Salaries &amp; Other Forms of Compensation', 0);
  h += '<tr><td class="bb" style="width:70%;font-size:6pt;padding:1px 3px;font-weight:bold">'
     + '<span class="fn">38</span>&nbsp;Total Non-Taxable/Exempt (Sum of Items 29-37)</td>'
     + '<td class="bb bl amt" style="width:30%;padding:1px 4px;font-weight:bold;font-size:7.5pt">'
     + fmtAmt(totalNTCalc) + '</td></tr>';
  // ── Section B ──────────────────────────────────────────────────────────────
  h += '<tr><td colspan="2" style="background:#e8e8e8;font-weight:bold;font-size:5.5pt;'
     + 'padding:1px 3px;border-top:0.5pt solid #000;border-bottom:0.5pt solid #000">'
     + 'B. TAXABLE COMPENSATION INCOME</td></tr>';
  h += '<tr><td colspan="2" class="bb" style="font-size:5pt;font-style:italic;padding:1px 3px">Regular</td></tr>';
  h += detRow(39, 'Basic Salary', taxableBasic);
  h += detRow(40, 'Representation', 0);
  h += detRow(41, 'Transportation', 0);
  h += detRow(42, 'Cost of Living Allowance (COLA)', 0);
  h += detRow(43, 'Fixed Housing Allowance', 0);
  h += detRow(44, 'Others (Specify): 44A', taxableSalOth > 0 ? taxableSalOth : 0);
  h += '<tr><td class="bb" style="width:70%;font-size:6pt;padding:1px 3px 1px 10px">'
     + '<span class="fn">44B</span>&nbsp;</td>'
     + '<td class="bb bl amt" style="width:30%;padding:1px 4px">0.00</td></tr>';
  h += '<tr><td colspan="2" class="bb" style="font-size:5pt;font-style:italic;padding:1px 3px">Supplementary</td></tr>';
  h += detRow(45, 'Commission', 0);
  h += detRow(46, 'Profit Sharing', 0);
  h += detRow(47, 'Fees Including Director&rsquo;s Fees', 0);
  h += detRow(48, 'Taxable 13th Month Pay and Other Benefits', taxable13th);
  h += detRow(49, 'Hazard Pay', 0);
  h += detRow(50, 'Overtime Pay', 0);
  h += detRow(51, 'Others: 51A', 0);
  h += '<tr><td class="bb" style="width:70%;font-size:6pt;padding:1px 3px 1px 10px">'
     + '<span class="fn">51B</span>&nbsp;</td>'
     + '<td class="bb bl amt" style="width:30%;padding:1px 4px">0.00</td></tr>';
  h += '<tr><td class="bb" style="width:70%;font-size:6pt;padding:1px 3px;font-weight:bold">'
     + '<span class="fn">52</span>&nbsp;Total Taxable Compensation Income (Sum of Items 39-51B)</td>'
     + '<td class="bb bl amt" style="width:30%;padding:1px 4px;font-weight:bold;font-size:7.5pt">'
     + fmtAmt(totalTaxCalc) + '</td></tr>';
  h += '</table>';

  h += '</td></tr></table>'; // end two-column body

  // DECLARATION
  h += '<div style="border:0.5pt solid #000;padding:2px 3px;margin-top:1px;font-size:5pt;line-height:1.35">';
  h += 'I/We declare, under the penalties of perjury, that this certificate has been made in good faith, verified by me/us, and to the best of my/our knowledge and belief, is true and correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof. I/we hereby give my/our consent to the processing of my/our information as contemplated under the Data Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes.';
  h += '</div>';

  // SIGNATURES
  h += '<table style="border:0.5pt solid #000;margin-top:1px"><tr>';
  h += '<td style="width:50%;border-right:0.5pt solid #000;padding:3px;vertical-align:top">';
  h += '<div style="font-size:5.5pt;font-weight:bold">53 &nbsp; Present Employer / Authorized Agent</div>';
  h += '<div style="margin-top:12px;font-weight:bold;text-align:center;font-size:7pt">' + authorizedSig + '</div>';
  h += '<div style="border-top:0.5pt solid #000;margin-top:2px;font-size:5pt;text-align:center;padding-top:1px">Signature Over Printed Name (Head of Accounting/HR or Authorized Rep.)</div>';
  h += '<div style="margin-top:5px;font-size:5.5pt;font-weight:bold">CONFORME:</div>';
  h += '<div style="font-size:5.5pt;font-weight:bold">54 &nbsp; Employee Signature</div>';
  h += '<div style="margin-top:12px;font-weight:bold;text-align:center;font-size:7pt">' + empName + '</div>';
  h += '<div style="border-top:0.5pt solid #000;margin-top:2px;font-size:5pt;text-align:center;padding-top:1px">Signature Over Printed Name</div>';
  h += '</td>';
  h += '<td style="width:50%;padding:3px;vertical-align:top">';
  h += '<div style="font-size:5.5pt">Date Signed:</div>';
  h += '<div style="border-bottom:0.5pt solid #000;margin:12px 0 4px;width:80%">&nbsp;</div>';
  h += '<div style="font-size:5.5pt">Date Signed:</div>';
  h += '<div style="border-bottom:0.5pt solid #000;margin:12px 0 4px;width:80%">&nbsp;</div>';
  h += '<div style="font-size:5pt">CTC / Valid ID No. of Employee &nbsp; Place of Issue &nbsp; Date</div>';
  h += '<div style="border-bottom:0.5pt solid #000;margin:10px 0 3px;width:90%">&nbsp;</div>';
  h += '<div style="font-size:5.5pt">Amount Paid, if CTC:</div>';
  h += '<div style="border-bottom:0.5pt solid #000;margin:7px 0 2px;width:50%">&nbsp;</div>';
  h += '</td>';
  h += '</tr></table>';

  // SUBSTITUTED FILING
  h += '<div style="border:0.5pt solid #000;margin-top:1px;font-size:5.5pt;font-weight:bold;text-align:center;padding:1px;background:#ddd">To be accomplished under substituted filing</div>';
  h += '<table style="border:0.5pt solid #000"><tr>';
  h += '<td style="width:50%;border-right:0.5pt solid #000;padding:3px;font-size:5.5pt;vertical-align:top">';
  h += 'I declare, under the penalties of perjury, that my taxable income from all sources based on a preliminary computation is &#8369;250,000 or below and that I am qualified for substituted filing.<br><br>';
  h += '<div style="font-weight:bold">55 &nbsp; Present Employer / Authorized Agent Signature Over Printed Name</div>';
  h += '<div style="margin-top:8px;font-weight:bold;text-align:center;font-size:7pt">' + authorizedSig + '</div>';
  h += '<div style="border-top:0.5pt solid #000;margin-top:2px;font-size:5pt;text-align:center;padding-top:1px">(Head of Accounting / Human Resource or Authorized Representative)</div>';
  h += '</td>';
  h += '<td style="width:50%;padding:3px;font-size:5.5pt;vertical-align:top">';
  h += 'I declare, under penalties of perjury, that I am qualified and signing this form in substitution of BIR Form No. 1700.<br><br>';
  h += '<div style="font-weight:bold">56 &nbsp; Employee Signature</div>';
  h += '<div style="margin-top:10px;font-weight:bold;text-align:center;font-size:7pt">' + empName + '</div>';
  h += '<div style="border-top:0.5pt solid #000;margin-top:2px;font-size:5pt;text-align:center;padding-top:1px">Signature Over Printed Name of Employee</div>';
  h += '</td>';
  h += '</tr></table>';

  return '<html><head><meta charset="UTF-8"><style>' + css + '</style></head><body>' + h + '</body></html>';
}

// =============================================================================
// BIR 2316 — TEMPLATE OVERLAY (uses official PDF as background image)
// =============================================================================

/**
 * Fetches page 1 of the official BIR 2316 PDF from Drive as a JPEG thumbnail
 * and returns it base64-encoded.  sz=w1700 ≈ 200 dpi at 8.5 in wide.
 */
function _get2316TemplateImage_() {
  var token = ScriptApp.getOAuthToken();
  var resp  = UrlFetchApp.fetch(
    'https://drive.google.com/thumbnail?id=' + BIR2316_TEMPLATE_PDF_ID + '&sz=w1700',
    { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200)
    throw new Error('Cannot load BIR 2316 template image: HTTP ' + resp.getResponseCode());
  return Utilities.base64Encode(resp.getContent());
}

/**
 * Builds the BIR Form 2316 HTML by overlaying computed values as
 * absolutely-positioned divs on top of the official template image.
 * The caller converts this HTML to PDF via Utilities.newBlob(...).getAs(MimeType.PDF).
 */
function _build2316HtmlFromTemplate_(bir, profile, employer, year, cutoffFrom, cutoffTo) {
  var esc = escapeHtml_;
  var imgBase64 = _get2316TemplateImage_();

  var fmtAmt = function(n) {
    var v = parseFloat(String(n || '0').replace(/[^0-9.-]/g, '')) || 0;
    return v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Shorthand: absolutely-positioned field div
  var f = function(top, left, val, extra) {
    return '<div style="position:absolute;top:' + top + ';left:' + left
      + ';font-family:Arial,Helvetica,sans-serif;color:#000;z-index:1;'
      + (extra || '') + '">' + esc(String(val == null ? '' : val)) + '</div>';
  };

  var empTin     = String(profile.tin  || '').replace(/[^0-9]/g, '');
  var emplTin    = String(employer.tin || '').replace(/[^0-9]/g, '');
  var empName    = [bir.last_name, bir.first_name, bir.middlename].filter(Boolean).join(', ');
  var isMain     = String(employer.employer_type || 'Main').toLowerCase().indexOf('main') >= 0;
  var smwDaily   = String(profile.regulardayrate || '');
  var smwMonthly = String(profile.smw_monthly || '');
  var isMweRaw   = String(profile.is_mwe      || '').toLowerCase().trim();
  var mweChecked = (isMweRaw === 'true' || isMweRaw === 'yes' || isMweRaw === '1');
  var amtStyle   = 'font-size:7pt;width:0.95in;text-align:right;';

  // Right-column amounts column origin (Part IV-B)
  var amtR = '7.98in';
  // Left-column summary amounts column origin (Part IV-A)
  var amtL = '3.18in';
  var boldAmt = amtStyle + 'font-weight:bold;font-size:7.5pt;';

  var h = '';

  // ── Item 1 — Year ───────────────────────────────────────────────────────────
  h += f('1.22in', '0.55in', String(year), 'font-size:9pt;font-weight:bold;');
  // ── Item 2 — Period ─────────────────────────────────────────────────────────
  h += f('1.22in', '4.55in', cutoffFrom, 'font-size:8pt;font-weight:bold;');
  h += f('1.22in', '6.02in', cutoffTo,   'font-size:8pt;font-weight:bold;');

  // ── Part I — Employee TIN (4 boxes) ─────────────────────────────────────────
  h += f('1.65in', '0.48in',  empTin.substr(0,3), 'font-size:7.5pt;font-weight:bold;');
  h += f('1.65in', '0.98in',  empTin.substr(3,3), 'font-size:7.5pt;font-weight:bold;');
  h += f('1.65in', '1.47in',  empTin.substr(6,3), 'font-size:7.5pt;font-weight:bold;');
  h += f('1.65in', '1.97in',  empTin.substr(9,3), 'font-size:7.5pt;font-weight:bold;');
  // Item 5 — RDO Code
  h += f('1.65in', '3.32in',  profile.rdo_code || '', 'font-size:7.5pt;font-weight:bold;');
  // Item 4 — Employee name
  h += f('1.98in', '0.38in',  empName, 'font-size:7.5pt;font-weight:bold;');
  // Item 6 — Registered address
  h += f('2.30in', '0.38in',  profile.address     || '', 'font-size:7pt;');
  h += f('2.30in', '3.13in',  profile.address_zip || '', 'font-size:7pt;font-weight:bold;');
  // Item 6B — Local home address
  h += f('2.62in', '0.38in',  profile.local_address     || '', 'font-size:7pt;');
  h += f('2.62in', '3.13in',  profile.local_address_zip || '', 'font-size:7pt;');
  // Item 7 — Date of birth
  h += f('3.17in', '0.38in',
    profile.date_of_birth ? standardizeDateStr_(profile.date_of_birth) : '',
    'font-size:7.5pt;');
  // Item 8 — Contact number
  h += f('3.17in', '2.12in',  profile.contact_number || '', 'font-size:7.5pt;');
  // Item 9 — Statutory Minimum Wage rate per day
  h += f('3.43in', '2.60in',  smwDaily,   'font-size:7.5pt;font-weight:bold;');
  // Item 10 — Statutory Minimum Wage rate per month
  h += f('3.65in', '2.60in',  smwMonthly, 'font-size:7.5pt;font-weight:bold;');
  // Item 11 — MWE checkbox
  h += f('3.80in', '0.44in',  mweChecked ? 'X' : '', 'font-size:7.5pt;font-weight:bold;');

  // ── Part II — Employer TIN ───────────────────────────────────────────────────
  h += f('3.90in', '0.48in',  emplTin.substr(0,3), 'font-size:7.5pt;font-weight:bold;');
  h += f('3.90in', '0.98in',  emplTin.substr(3,3), 'font-size:7.5pt;font-weight:bold;');
  h += f('3.90in', '1.47in',  emplTin.substr(6,3), 'font-size:7.5pt;font-weight:bold;');
  h += f('3.90in', '1.97in',  emplTin.substr(9,3), 'font-size:7.5pt;font-weight:bold;');
  // Item 13 — Employer name
  h += f('4.16in', '0.38in',  employer.company_name || '', 'font-size:7.5pt;font-weight:bold;');
  // Item 14 — Employer address
  h += f('4.44in', '0.38in',  employer.address     || '', 'font-size:7pt;');
  h += f('4.44in', '3.13in',  employer.address_zip || '', 'font-size:7pt;');
  // Item 15 — Main / Secondary employer checkbox X
  h += f('4.72in', isMain ? '1.23in' : '2.53in', 'X', 'font-size:7.5pt;font-weight:bold;');

  // ── Part IV-A — Summary amounts ──────────────────────────────────────────────
  var grossPresent   = parseFloat(bir.gross_present         || 0);
  var totalNontax    = parseFloat(bir.total_nontaxable      || 0);
  var taxablePresent = parseFloat(bir.total_taxable_present || 0);
  var taxDue         = parseFloat(bir.tax_due               || 0);
  var taxWH          = parseFloat(bir.tax_withheld          || 0);
  var totalTaxWH     = parseFloat(bir.total_tax_withheld    || taxWH || 0);

  // Item 19 = Item 38 + Item 52 — derived, never gross_present
  var nontaxBasic   = parseFloat(bir.nontax_basic          || 0);
  var nontax13th    = parseFloat(bir.nontax_13thmonth      || 0);
  var nontaxDemin   = parseFloat(bir.nontax_salaries_other || 0);
  var nontaxSPH     = parseFloat(bir.nontax_sss_phic_hdmf  || 0);
  var totalNTCalc   = nontaxBasic + nontax13th + nontaxDemin + nontaxSPH;
  var taxableBasic2  = parseFloat(bir.taxable_basic          || 0);
  var taxable13th2   = parseFloat(bir.taxable_13thmonth      || 0);
  var taxableSalOth2 = parseFloat(bir.taxable_salaries_other || 0);
  var totalTaxCalc2  = taxableBasic2 + taxable13th2 + taxableSalOth2;
  var item19         = totalNTCalc + totalTaxCalc2;  // Item 38 + Item 52

  h += f('6.03in', amtL, fmtAmt(item19),         boldAmt);    // Item 19
  h += f('6.29in', amtL, fmtAmt(totalNontax),    amtStyle);
  h += f('6.55in', amtL, fmtAmt(taxablePresent), amtStyle);
  h += f('6.81in', amtL, '',                     amtStyle);   // Item 22 — previous employer (blank)
  h += f('7.07in', amtL, fmtAmt(taxablePresent), boldAmt);
  h += f('7.31in', amtL, fmtAmt(taxDue),         amtStyle);
  h += f('7.64in', amtL, fmtAmt(taxWH),          amtStyle);   // 25A present
  h += f('7.88in', amtL, '',                     amtStyle);   // 25B previous (blank)
  h += f('8.12in', amtL, fmtAmt(totalTaxWH),     amtStyle);   // Item 26
  h += f('8.36in', amtL, '0.00',                 amtStyle);   // Item 27
  h += f('8.60in', amtL, fmtAmt(totalTaxWH),     boldAmt);    // Item 28

  // ── Part IV-B — Non-taxable income amounts (right column) ───────────────────

  h += f('1.78in', amtR, fmtAmt(nontaxBasic), amtStyle);  // Item 29
  h += f('2.05in', amtR, '0.00', amtStyle);               // Item 30 Holiday Pay (MWE)
  h += f('2.28in', amtR, '0.00', amtStyle);               // Item 31 Overtime Pay (MWE)
  h += f('2.51in', amtR, '0.00', amtStyle);               // Item 32 Night Shift (MWE)
  h += f('2.74in', amtR, '0.00', amtStyle);               // Item 33 Hazard Pay (MWE)
  h += f('2.97in', amtR, fmtAmt(nontax13th),  amtStyle);  // Item 34 13th Month
  h += f('3.20in', amtR, fmtAmt(nontaxDemin), amtStyle);  // Item 35 De Minimis
  h += f('3.43in', amtR, fmtAmt(nontaxSPH),   amtStyle);  // Item 36 SSS/PHIC/HDMF
  h += f('3.66in', amtR, '0.00',              amtStyle);  // Item 37 Other
  h += f('3.90in', amtR, fmtAmt(totalNTCalc), boldAmt);   // Item 38 Total Non-Taxable

  // ── Part IV-B — Taxable income amounts (right column) ───────────────────────
  var taxableBasic   = parseFloat(bir.taxable_basic          || 0);
  var taxable13th    = parseFloat(bir.taxable_13thmonth      || 0);
  var taxableSalOth  = parseFloat(bir.taxable_salaries_other || 0);
  var totalTaxCalc   = parseFloat(bir.total_taxable_present  || 0);

  h += f('4.40in', amtR, fmtAmt(taxableBasic),  amtStyle);  // Item 39 Basic Salary
  h += f('4.63in', amtR, '0.00', amtStyle);                 // Item 40 Representation
  h += f('4.86in', amtR, '0.00', amtStyle);                 // Item 41 Transportation
  h += f('5.09in', amtR, '0.00', amtStyle);                 // Item 42 COLA
  h += f('5.32in', amtR, '0.00', amtStyle);                 // Item 43 Housing
  h += f('5.55in', amtR, fmtAmt(taxableSalOth > 0 ? taxableSalOth : 0), amtStyle); // Item 44A
  h += f('5.75in', amtR, '0.00', amtStyle);                 // Item 44B
  h += f('6.13in', amtR, '0.00', amtStyle);                 // Item 45 Commission
  h += f('6.33in', amtR, '0.00', amtStyle);                 // Item 46 Profit Sharing
  h += f('6.53in', amtR, '0.00', amtStyle);                 // Item 47 Director Fees
  h += f('6.73in', amtR, fmtAmt(taxable13th),   amtStyle);  // Item 48 Taxable 13th
  h += f('6.93in', amtR, '0.00', amtStyle);                 // Item 49 Hazard Pay
  h += f('7.13in', amtR, '0.00', amtStyle);                 // Item 50 Overtime Pay
  h += f('7.33in', amtR, '0.00', amtStyle);                 // Item 51A
  h += f('7.53in', amtR, '0.00', amtStyle);                 // Item 51B
  h += f('7.78in', amtR, fmtAmt(totalTaxCalc),  boldAmt);   // Item 52 Total Taxable

  // ── Signature lines ──────────────────────────────────────────────────────────
  var authorizedSig = esc(employer.authorized_signatory || '');
  h += f('9.56in', '1.10in', authorizedSig, 'font-size:7pt;font-weight:bold;');  // Item 53
  h += f('10.22in','1.10in', empName,       'font-size:7pt;font-weight:bold;');  // Item 54

  var css = '@page{size:8.5in 13in;margin:0}html,body{margin:0;padding:0}';

  return '<html><head><meta charset="UTF-8"><style>' + css + '</style></head><body>'
    + '<div style="position:relative;width:8.5in;height:13in;overflow:hidden;">'
    + '<img style="position:absolute;top:0;left:0;width:8.5in;height:13in;" '
    + 'src="data:image/jpeg;base64,' + imgBase64 + '" />'
    + h
    + '</div></body></html>';
}

// =====================================================================
// BIR FORM 2316 — HTML-BASED PDF BUILDER
// Converts the 2316.HTML replica directly to a filled, static PDF.
// All <input> elements are replaced with data-injected static spans.
// Called by generate2316Pdf() instead of the old image-overlay method.
// =====================================================================
function _build2316HtmlV2_(bir, profile, employer, year, cutoffFrom, cutoffTo) {
  var esc = escapeHtml_;

  var fmtAmt = function(n) {
    var v = parseFloat(String(n || '0').replace(/[^0-9.-]/g, '')) || 0;
    return v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Replaces <input type="text"> — fixed-width or full-width static span
  var inp = function(v, w) {
    var ws = w ? ('width:' + w + ';') : 'width:100%;';
    return '<span style="display:inline-block;' + ws + 'border:1px solid #000;background:#fff;'
      + 'height:13px;font-family:monospace;font-size:9px;padding:0 2px;'
      + 'box-sizing:border-box;overflow:hidden;white-space:nowrap;vertical-align:bottom;">'
      + esc(String(v == null ? '' : v)) + '</span>';
  };

  // Replaces <input type="text" style="flex:1"> inside flex containers
  var inpFlex = function(v) {
    return '<span style="flex:1;min-width:0;border:1px solid #000;background:#fff;'
      + 'height:13px;font-family:monospace;font-size:9px;padding:0 2px;margin:0 4px;'
      + 'box-sizing:border-box;overflow:hidden;white-space:nowrap;">'
      + esc(String(v == null ? '' : v)) + '</span>';
  };

  // Replaces <input type="checkbox">
  var chk = function(checked) {
    return '<span style="display:inline-block;width:9px;height:9px;border:1px solid #000;'
      + 'text-align:center;font-size:8px;line-height:9px;vertical-align:middle;'
      + 'margin:0 3px 0 0;font-weight:bold;">' + (checked ? 'X' : '&nbsp;') + '</span>';
  };

  // TIN 3-3-3-5 group of bordered boxes
  var tinGroup = function(tin) {
    var c = String(tin || '').replace(/[^0-9]/g, '');
    var box = function(v, w) {
      return '<span style="display:inline-block;width:' + w + ';height:13px;border:1px solid #000;'
        + 'text-align:center;font-family:monospace;font-size:9px;line-height:13px;'
        + 'box-sizing:border-box;">' + esc(v) + '</span>';
    };
    return '<div style="display:flex;align-items:center;gap:3px;">'
      + box(c.substr(0,3),'32px') + box(c.substr(3,3),'32px')
      + box(c.substr(6,3),'32px') + box(c.substr(9),'48px')
      + '</div>';
  };

  // Date grid — 8 individual single-char cells (mirrors .date-grid in 2316.HTML)
  var dateGrid = function(digits) {
    var d = String(digits || '').replace(/[^0-9]/g, '');
    var g = '<div style="display:flex;width:27.9mm;border:1px solid #000;background:#fff;flex-shrink:0;">';
    for (var i = 0; i < 8; i++) {
      g += '<span style="flex:1;min-width:0;height:14px;'
        + 'border-right:' + (i < 7 ? '1px solid #000' : 'none') + ';'
        + 'text-align:center;font-size:10px;line-height:14px;font-family:monospace;">'
        + esc(d[i] || '') + '</span>';
    }
    return g + '</div>';
  };

  // Amount input span used inside .amount-input div
  var amtSpan = function(v, bold) {
    var fw = bold ? 'font-weight:bold;' : '';
    return '<span style="display:inline-block;width:100%;height:13px;border:1px solid #000;'
      + 'text-align:right;font-family:monospace;font-size:9px;padding:0 2px;'
      + 'box-sizing:border-box;' + fw + '">'
      + (v !== '' && v !== null && v !== undefined ? esc(fmtAmt(v)) : '&nbsp;') + '</span>';
  };

  // Full amount row: num label + description + amount input
  var amtRow = function(num, label, v, bold) {
    return '<div class="amount-row">'
      + '<div class="amount-desc' + (bold ? ' bold' : '') + '">'
      + '<span class="num-label">' + num + '</span> ' + label + '</div>'
      + '<div class="amount-input">' + amtSpan(v, bold) + '</div>'
      + '</div>';
  };

  // --- Data ---
  // Embed BIR logo and barcode from Drive
  var birLogoSrc = '', barcodeSrc = '';
  try {
    var logoBlob = DriveApp.getFileById('1wgXYKcTwow2wQMSPeqVIMCPcWRhttInw').getBlob();
    birLogoSrc = 'data:' + logoBlob.getContentType() + ';base64,' + Utilities.base64Encode(logoBlob.getBytes());
  } catch(e) { Logger.log('BIR logo load error: ' + e.message); }
  try {
    var bcBlob = DriveApp.getFileById('1AdiZxEOZP88aZ9m1P69JdjvNZ2nNbl_2').getBlob();
    barcodeSrc = 'data:' + bcBlob.getContentType() + ';base64,' + Utilities.base64Encode(bcBlob.getBytes());
  } catch(e) { Logger.log('BIR barcode load error: ' + e.message); }

  var empTin      = String(profile.tin  || '').replace(/[^0-9]/g, '');
  var emplTin     = String(employer.tin || '').replace(/[^0-9]/g, '');
  var empName     = [bir.last_name, bir.first_name, bir.middlename].filter(Boolean).map(String).join(', ');
  var authorizedSig = esc(employer.authorized_signatory || '');
  var isMain         = String(employer.employer_type || 'Main').toLowerCase().indexOf('main') >= 0;
  var isSubFilingRaw = String(profile.is_substituted_filing || '').toLowerCase().trim();
  var isSubFiling    = (isSubFilingRaw === 'true' || isSubFilingRaw === 'yes' || isSubFilingRaw === '1');
  var isMweRaw   = String(profile.is_mwe || '').toLowerCase().trim();
  var mweChecked = (isMweRaw === 'true' || isMweRaw === 'yes' || isMweRaw === '1');
  var dob        = profile.date_of_birth ? standardizeDateStr_(profile.date_of_birth) : '';

  var totalNontax    = parseFloat(bir.total_nontaxable      || 0);
  var taxablePresent = parseFloat(bir.total_taxable_present || 0);
  var taxDue         = parseFloat(bir.tax_due               || 0);
  var taxWH          = parseFloat(bir.tax_withheld          || 0);
  var totalTaxWH     = parseFloat(bir.total_tax_withheld    || taxWH || 0);
  var nontaxBasic    = parseFloat(bir.nontax_basic          || 0);
  var nontax13th     = parseFloat(bir.nontax_13thmonth      || 0);
  var nontaxDemin    = parseFloat(bir.nontax_salaries_other || 0);
  var nontaxSPH      = parseFloat(bir.nontax_sss_phic_hdmf  || 0);
  var totalNTCalc    = nontaxBasic + nontax13th + nontaxDemin + nontaxSPH;
  var taxableBasic   = parseFloat(bir.taxable_basic          || 0);
  var taxable13th    = parseFloat(bir.taxable_13thmonth      || 0);
  var taxableSalOth  = parseFloat(bir.taxable_salaries_other || 0);
  var totalTaxCalc   = taxableBasic + taxable13th + taxableSalOth;  // Item 52
  var grossPresent   = totalNTCalc + totalTaxCalc;  // Item 19 = Item 38 + Item 52

  var emptyGrid = dateGrid('');

  // --- CSS (from 2316.HTML, screen-only rules removed, PDF @page added) ---
  var css = ''
    + '* { box-sizing: border-box; margin: 0; padding: 0; }'
    + '@page { size: 8.5in 13in; margin: 0.4in; }'
    + 'body { margin: 0; padding: 0; background: #fff; font-family: Arial, Helvetica, sans-serif; color: #000; }'
    + '.form-page { width: 100%; border: 2px solid #000; font-size: 8px; line-height: 1.15; }'
    + '.bold { font-weight: bold; } .italic { font-style: italic; }'
    + '.flex { display: flex; } .flex-col { display: flex; flex-direction: column; }'
    + '.border-b { border-bottom: 1px solid #000; } .border-r { border-right: 1px solid #000; }'
    + '.border-t { border-top: 1px solid #000; }'
    + '.top-header { text-align: center; border-bottom: 1px solid #000; padding: 3px 2px; font-size: 9px; line-height: 1.2; }'
    + '.header { display: grid; grid-template-columns: 20% 55% 25%; border-bottom: 2px solid #000; }'
    + '.header-left { padding: 3px; text-align: center; display: flex; flex-direction: column; justify-content: center; }'
    + '.header-center { padding: 3px; text-align: center; display: flex; flex-direction: column; justify-content: center; }'
    + '.header-right { padding: 3px; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; }'
    + '.title-large { font-size: 30px; font-weight: bold; margin: 0; line-height: 1; }'
    + '.title-medium { font-size: 16px; font-weight: bold; margin: 0; line-height: 1.1; }'
    + '.barcode-2d { width: 95%; height: 28px; margin: 0 auto 3px auto; background-color: #fff;'
    + '  background-image: linear-gradient(90deg, #000 12px, transparent 12px),'
    + '    repeating-linear-gradient(90deg, #000 0, #000 2px, transparent 2px, transparent 4px, #000 4px, #000 5px, transparent 5px, transparent 7px),'
    + '    repeating-linear-gradient(90deg, #000 0, #000 3px, transparent 3px, transparent 5px, #000 5px, #000 6px, transparent 6px, transparent 9px),'
    + '    repeating-linear-gradient(90deg, #000 0, #000 1px, transparent 1px, transparent 4px, #000 4px, #000 7px, transparent 7px, transparent 8px),'
    + '    linear-gradient(270deg, #000 2px, transparent 2px);'
    + '  background-size: 12px 100%, 100% 33.3%, 100% 33.3%, 100% 33.3%, 2px 100%;'
    + '  background-position: left top, left 14px top, left 14px center, left 14px bottom, right top;'
    + '  background-repeat: no-repeat; }'
    + '.section-header { background-color: #d0d0d0; text-align: center; font-weight: bold; padding: 2px; font-size: 8px; border-bottom: 1px solid #000; }'
    + '.row { display: flex; border-bottom: 1px solid #000; }'
    + '.cell { padding: 2px 4px; display: flex; flex-direction: column; justify-content: flex-end; }'
    + '.num-label { font-weight: bold; margin-right: 2px; font-size: 8px; }'
    + '.main-grid { display: grid; grid-template-columns: 50% 50%; border-bottom: 2px solid #000; }'
    + '.amount-row { display: flex; justify-content: space-between; align-items: center; padding: 2px 3px 2px 0; min-height: 18px; margin-bottom: 0; }'
    + '.amount-desc { flex-grow: 1; padding-left: 2px; line-height: 1.1; }'
    + '.amount-input { width: 120px; flex-shrink: 0; }'
    + '.sub-header { font-weight: bold; padding: 2px 3px; font-size: 8px; }'
    + '.legal-text { font-size: 7px; text-align: justify; padding: 3px; line-height: 1.15; }';

  var h = '';

  // ── FORM HEADER ─────────────────────────────────────────────────────────────
  h += '<div class="header">';
  h +=   '<div class="header-left border-r" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;">';
  if (birLogoSrc) {
    h +=   '<img src="' + birLogoSrc + '" style="width:52px;height:52px;object-fit:contain;" alt="BIR" />';
  }
  h +=     '<div style="font-size:8px;">BIR Form No.</div><div class="title-large">2316</div><div style="font-size:9px;">September 2021 (ENCS)</div>';
  h +=   '</div>';
  h +=   '<div class="header-center border-r">'
       +   '<div style="font-size:9px;color:#cc0000;font-weight:bold;line-height:1.4;">Republic of the Philippines<br>Department of Finance<br>Bureau of Internal Revenue</div>'
       +   '<div class="title-medium" style="margin-top:4px;">Certificate of Compensation</div>'
       +   '<div class="title-medium">Payment/Tax Withheld</div>'
       +   '<div style="font-size:10px;margin-top:4px;">For Compensation Payment With or Without Tax Withheld</div>'
       + '</div>';
  h +=   '<div class="header-right">';
  if (barcodeSrc) {
    h +=   '<img src="' + barcodeSrc + '" style="width:95%;max-height:52px;object-fit:contain;display:block;margin:0 auto 2px;" alt="barcode" />';
  } else {
    h +=   '<div class="barcode-2d"></div>';
  }
  h +=   '<div style="font-size:9px;width:95%;text-align:right;padding-right:4px;">2316 09/21 ENCS</div>';
  h +=   '</div>';
  h += '</div>';

  // ── INSTRUCTIONS ────────────────────────────────────────────────────────────
  h += '<div class="border-b" style="padding:2px 4px;">Fill in all applicable spaces. Mark all appropriate boxes with an &ldquo;X&rdquo;.</div>';

  // ── ITEMS 1 & 2 — Year / Period ─────────────────────────────────────────────
  h += '<div class="row">';
  h +=   '<div class="cell border-r" style="width:20%;">';
  h +=     '<div><span class="num-label">1</span> For the Year</div>';
  h +=     '<div style="text-align:center;margin-top:2px;">(YYYY) ' + inp(String(year), '60px') + '</div>';
  h +=   '</div>';
  h +=   '<div class="cell" style="width:80%;">';
  h +=     '<div><span class="num-label">2</span> For the Period</div>';
  h +=     '<div class="flex" style="justify-content:center;gap:20px;margin-top:2px;">';
  h +=       '<div>From (MM/DD) ' + inp(cutoffFrom ? String(cutoffFrom).substr(0,5) : '', '100px') + '</div>';
  h +=       '<div>To (MM/DD) '   + inp(cutoffTo   ? String(cutoffTo).substr(0,5)   : '', '100px') + '</div>';
  h +=     '</div>';
  h +=   '</div>';
  h += '</div>';

  // ── MAIN GRID ───────────────────────────────────────────────────────────────
  h += '<div class="main-grid">';

  // ==================== LEFT COLUMN ==========================================
  h += '<div class="border-r flex-col">';

  // Part I ─────────────────────────────────────────────────────────────────────
  h += '<div class="section-header">Part I - Employee Information</div>';

  // Items 3 (TIN) & 5 (RDO Code)
  h += '<div class="row">';
  h +=   '<div class="cell border-r" style="width:80%;">';
  h +=     '<div class="flex" style="align-items:center;justify-content:space-between;">';
  h +=       '<span class="num-label">3</span><span style="margin-right:auto;">TIN</span>';
  h +=       tinGroup(empTin);
  h +=     '</div>';
  h +=   '</div>';
  h +=   '<div class="cell" style="width:20%;">';
  h +=     '<div><span class="num-label">5</span> RDO Code</div>';
  h +=     inp(profile.rdo_code || '', '100%');
  h +=   '</div>';
  h += '</div>';

  // Item 4 — Employee Name
  h += '<div class="row"><div class="cell" style="width:100%;">';
  h +=   '<div><span class="num-label">4</span> Employee\'s Name (Last Name, First Name, Middle Name)</div>';
  h +=   inp(empName, '100%');
  h += '</div></div>';

  // Items 6 & 6A
  h += '<div class="row" style="border-bottom:none;">';
  h +=   '<div class="cell border-r" style="width:80%;border-bottom:1px solid #000;">';
  h +=     '<div><span class="num-label">6</span> Registered Address</div>';
  h +=     inp(profile.address || '', '100%');
  h +=   '</div>';
  h +=   '<div class="cell" style="width:20%;justify-content:flex-end;border-bottom:1px solid #000;">';
  h +=     '<div><span class="num-label" style="font-size:8px;">6A</span> Zip Code</div>';
  h +=     inp(profile.address_zip || '', '100%');
  h +=   '</div>';
  h += '</div>';

  // Items 6B & 6C
  h += '<div class="row" style="border-bottom:none;">';
  h +=   '<div class="cell border-r" style="width:80%;border-bottom:1px solid #000;">';
  h +=     '<div><span class="num-label">6B</span> Local Home Address</div>';
  h +=     inp(profile.local_address || '', '100%');
  h +=   '</div>';
  h +=   '<div class="cell" style="width:20%;justify-content:flex-end;border-bottom:1px solid #000;">';
  h +=     '<div><span class="num-label" style="font-size:8px;">6C</span> Zip Code</div>';
  h +=     inp(profile.local_address_zip || '', '100%');
  h +=   '</div>';
  h += '</div>';

  // Item 6D
  h += '<div class="row"><div class="cell border-r" style="width:100%;">';
  h +=   '<div><span class="num-label">6D</span> Foreign Address</div>';
  h +=   inp('', '100%');
  h += '</div></div>';

  // Items 7 & 8
  h += '<div class="row">';
  h +=   '<div class="cell border-r" style="width:50%;">';
  h +=     '<div><span class="num-label">7</span> Date of Birth (MM/DD/YYYY)</div>';
  h +=     inp(dob, '100%');
  h +=   '</div>';
  h +=   '<div class="cell" style="width:50%;">';
  h +=     '<div><span class="num-label">8</span> Contact Number</div>';
  h +=     inp(profile.contact_number || '', '100%');
  h +=   '</div>';
  h += '</div>';

  // Item 9 — SMW per day
  h += '<div class="row">';
  h +=   '<div class="cell border-r" style="width:60%;">';
  h +=     '<div><span class="num-label">9</span> Statutory Minimum Wage rate per day</div>';
  h +=   '</div>';
  h +=   '<div class="cell" style="width:40%;justify-content:center;">' + inp(profile.regulardayrate || '', '100%') + '</div>';
  h += '</div>';

  // Item 10 — SMW per month
  h += '<div class="row">';
  h +=   '<div class="cell border-r" style="width:60%;">';
  h +=     '<div><span class="num-label">10</span> Statutory Minimum Wage rate per month</div>';
  h +=   '</div>';
  h +=   '<div class="cell" style="width:40%;justify-content:center;">' + inp(profile.smw_monthly || '', '100%') + '</div>';
  h += '</div>';

  // Item 11 — MWE Checkbox
  h += '<div class="row"><div class="cell" style="width:100%;flex-direction:row;align-items:center;">';
  h +=   '<span class="num-label">11</span> ';
  h +=   chk(mweChecked);
  h +=   '<span>Minimum Wage Earner whose compensation is exempt from withholding tax and not subject to income tax</span>';
  h += '</div></div>';

  // Part II ────────────────────────────────────────────────────────────────────
  h += '<div class="section-header border-t">Part II - Employer Information (Present)</div>';

  // Item 12 — Employer TIN
  h += '<div class="row"><div class="cell" style="width:100%;">';
  h +=   '<div class="flex" style="align-items:center;">';
  h +=     '<span class="num-label">12</span><span style="margin-right:20px;">TIN</span>';
  h +=     tinGroup(emplTin);
  h +=   '</div>';
  h += '</div></div>';

  // Item 13 — Employer Name
  h += '<div class="row"><div class="cell" style="width:100%;">';
  h +=   '<div><span class="num-label">13</span> Employer\'s Name</div>';
  h +=   inp(employer.company_name || '', '100%');
  h += '</div></div>';

  // Items 14 & 14A
  h += '<div class="row">';
  h +=   '<div class="cell border-r" style="width:80%;">';
  h +=     '<div><span class="num-label">14</span> Registered Address</div>';
  h +=     inp(employer.address || '', '100%');
  h +=   '</div>';
  h +=   '<div class="cell" style="width:20%;">';
  h +=     '<div><span class="num-label" style="font-size:8px;">14A</span> Zip Code</div>';
  h +=     inp(employer.address_zip || '', '100%');
  h +=   '</div>';
  h += '</div>';

  // Item 15 — Employer Type
  h += '<div class="row"><div class="cell" style="width:100%;flex-direction:row;align-items:center;gap:20px;">';
  h +=   '<div><span class="num-label">15</span> Type of Employer</div>';
  h +=   '<div>' + chk(isMain)  + ' Main Employer</div>';
  h +=   '<div>' + chk(!isMain) + ' Secondary Employer</div>';
  h += '</div></div>';

  // Part III ───────────────────────────────────────────────────────────────────
  h += '<div class="section-header border-t">Part III - Employer Information (Previous)</div>';

  // Item 16 — Prev Employer TIN (blank)
  h += '<div class="row"><div class="cell" style="width:100%;">';
  h +=   '<div class="flex" style="align-items:center;">';
  h +=     '<span class="num-label">16</span><span style="margin-right:20px;">TIN</span>';
  h +=     tinGroup('');
  h +=   '</div>';
  h += '</div></div>';

  // Item 17 — Prev Employer Name (blank)
  h += '<div class="row"><div class="cell" style="width:100%;">';
  h +=   '<div><span class="num-label">17</span> Employer\'s Name</div>';
  h +=   inp('', '100%');
  h += '</div></div>';

  // Items 18 & 18A (blank)
  h += '<div class="row">';
  h +=   '<div class="cell border-r" style="width:80%;">';
  h +=     '<div><span class="num-label">18</span> Registered Address</div>';
  h +=     inp('', '100%');
  h +=   '</div>';
  h +=   '<div class="cell" style="width:20%;">';
  h +=     '<div><span class="num-label" style="font-size:8px;">18A</span> Zip Code</div>';
  h +=     inp('', '100%');
  h +=   '</div>';
  h += '</div>';

  // Part IV-A ──────────────────────────────────────────────────────────────────
  h += '<div class="section-header border-t">Part IV-A - Summary</div>';
  h += '<div class="flex-col" style="padding-bottom:4px;">';
  h += amtRow(19, 'Gross Compensation Income from Present Employer <span class="italic">(Item 38 plus Item 52)</span>', totalNTCalc + totalTaxCalc, true);  // Item 38 + Item 52
  h += amtRow(20, 'Less: Total Non-Taxable/Exempt Compensation Income from Present Employer <span class="italic">(From Item 38)</span>', totalNontax, false);
  h += amtRow(21, 'Taxable Compensation Income from Present Employer <span class="italic">(Item 19 Less Item 20) (From Item 52)</span>', taxablePresent, false);
  h += amtRow(22, 'Add: Taxable Compensation Income from Previous Employer, if applicable', '', false);
  h += amtRow(23, 'Gross Taxable Compensation Income <span class="bold italic">(Sum of Items 21 and 22)</span>', taxablePresent, true);
  h += amtRow(24, 'Tax Due', taxDue, false);
  h += '<div class="amount-row" style="margin-top:4px;"><div class="amount-desc"><span class="num-label">25</span> Amount of Taxes Withheld</div></div>';
  h += amtRow('25A', 'Present Employer', taxWH, false);
  h += amtRow('25B', 'Previous Employer, if applicable', '', false);
  h += amtRow(26, 'Total Amount of Taxes Withheld as adjusted <span class="bold italic">(Sum of Items 25A and 25B)</span>', totalTaxWH, false);
  h += amtRow(27, '5% Tax Credit (PERA Act of 2008)', 0, false);
  h += amtRow(28, 'Total Taxes Withheld <span class="bold italic">(Sum of Items 26 and 27)</span>', totalTaxWH, true);
  h += '</div>';

  h += '</div>'; // end LEFT COLUMN

  // ==================== RIGHT COLUMN =========================================
  h += '<div class="flex-col">';
  h += '<div class="section-header">Part IV-B Details of Compensation Income and Tax Withheld from Present Employer</div>';
  h += '<div class="sub-header flex" style="justify-content:space-between;align-items:center;">';
  h +=   '<span>A. NON-TAXABLE/EXEMPT COMPENSATION INCOME</span>';
  h +=   '<span style="width:130px;text-align:center;margin-right:4px;">Amount</span>';
  h += '</div>';

  h += '<div class="flex-col" style="padding-bottom:4px;">';
  h += amtRow(29, 'Basic Salary (including the exempt P250,000 &amp; below) or the Statutory Minimum Wage of the MWE', nontaxBasic, false);
  h += amtRow(30, 'Holiday Pay (MWE)', 0, false);
  h += amtRow(31, 'Overtime Pay (MWE)', 0, false);
  h += amtRow(32, 'Night Shift Differential (MWE)', 0, false);
  h += amtRow(33, 'Hazard Pay (MWE)', 0, false);
  h += '<div class="amount-row"><div class="amount-desc"><span class="num-label">34</span> 13th Month Pay and Other Benefits <span class="italic">(max P90,000)</span></div><div class="amount-input">' + amtSpan(nontax13th, false) + '</div></div>';
  h += amtRow(35, 'De Minimis Benefits', nontaxDemin, false);
  h += amtRow(36, 'SSS, GSIS, PHIC &amp; Pag-ibig Contributions, &amp; Union Dues <span class="italic">(Employee share only)</span>', nontaxSPH, false);
  h += amtRow(37, 'Salaries &amp; Other Forms of Compensation', 0, false);
  h += amtRow(38, 'Total Non-Taxable/Exempt Compensation Income <span class="bold italic">(Sum of Items 29 to 37)</span>', totalNTCalc, true);
  h += '</div>';

  h += '<div class="border-t"></div>';
  h += '<div class="sub-header">B. TAXABLE COMPENSATION INCOME REGULAR</div>';

  h += '<div class="flex-col" style="padding-bottom:4px;">';
  h += amtRow(39, 'Basic Salary', taxableBasic, false);
  h += amtRow(40, 'Representation', 0, false);
  h += amtRow(41, 'Transportation', 0, false);
  h += amtRow(42, 'Cost of Living Allowance (COLA)', 0, false);
  h += amtRow(43, 'Fixed Housing Allowance', 0, false);
  h += '<div class="amount-row" style="min-height:14px;margin-bottom:0;"><div class="amount-desc"><span class="num-label">44</span> Others (Specify)</div></div>';
  h += '<div class="amount-row"><div class="amount-desc flex" style="align-items:center;padding-left:12px;"><span class="num-label" style="font-size:8px;">44A</span>&nbsp;' + inp(taxableSalOth > 0 ? 'Other Income' : '', '150px') + '</div><div class="amount-input">' + amtSpan(taxableSalOth > 0 ? taxableSalOth : 0, false) + '</div></div>';
  h += '<div class="amount-row"><div class="amount-desc flex" style="align-items:center;padding-left:12px;"><span class="num-label" style="font-size:8px;">44B</span>&nbsp;' + inp('', '150px') + '</div><div class="amount-input">' + amtSpan(0, false) + '</div></div>';
  h += '</div>';

  h += '<div class="border-t"></div>';
  h += '<div class="sub-header">SUPPLEMENTARY</div>';

  h += '<div class="flex-col" style="padding-bottom:4px;">';
  h += amtRow(45, 'Commission', 0, false);
  h += amtRow(46, 'Profit Sharing', 0, false);
  h += amtRow(47, 'Fees Including Director\'s Fees', 0, false);
  h += amtRow(48, 'Taxable 13th Month Pay and Other Benefits', taxable13th, false);
  h += amtRow(49, 'Hazard Pay', 0, false);
  h += amtRow(50, 'Overtime Pay', 0, false);
  h += '<div class="amount-row" style="min-height:14px;margin-bottom:0;"><div class="amount-desc"><span class="num-label">51</span> Others (Specify)</div></div>';
  h += '<div class="amount-row"><div class="amount-desc flex" style="align-items:center;padding-left:12px;"><span class="num-label" style="font-size:8px;">51A</span>&nbsp;' + inp('', '150px') + '</div><div class="amount-input">' + amtSpan(0, false) + '</div></div>';
  h += '<div class="amount-row"><div class="amount-desc flex" style="align-items:center;padding-left:12px;"><span class="num-label" style="font-size:8px;">51B</span>&nbsp;' + inp('', '150px') + '</div><div class="amount-input">' + amtSpan(0, false) + '</div></div>';
  h += amtRow(52, 'Total Taxable Compensation Income <span class="bold italic">(Sum of Items 39 to 51B)</span>', totalTaxCalc, true);
  h += '</div>';

  h += '</div>'; // end RIGHT COLUMN
  h += '</div>'; // end MAIN GRID

  // ── SIGNATURES ──────────────────────────────────────────────────────────────
  h += '<div class="flex-col">';
  h += '<div class="legal-text border-b">I/We declare, under the penalties of perjury that this certificate has been made in good faith, verified by me/us, and to the best of my/our knowledge and belief, is true and correct, pursuant to the provisions of the National Internal Revenue Code, as amended, and the regulations issued under authority thereof. Further, I/we give my/our consent to the processing of my/our information as contemplated under the <em>Data Privacy Act of 2012</em> (R.A. No. 10173) for legitimate and lawful purposes.</div>';

  // Item 53 — Employer signature
  h += '<div class="row" style="border-bottom:1px solid #000;padding:4px 4px 3px;align-items:flex-end;">';
  h +=   '<div style="font-weight:bold;font-size:8px;width:26px;">53</div>';
  h +=   '<div style="width:55%;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-end;">';
  h +=     '<div style="height:28px;"></div>';
  h +=     '<div style="border-bottom:1px solid #000;width:100%;text-align:center;font-size:9px;font-weight:bold;padding-bottom:2px;">' + authorizedSig + '</div>';
  h +=     '<div style="font-size:7px;text-align:center;margin-top:1px;">Present Employer/ Authorized Agent Signature Over Printed Name</div>';
  h +=   '</div>';
  h +=   '<div style="display:flex;align-items:flex-end;gap:4px;margin-left:12px;">';
  h +=     '<span style="font-size:8px;margin-bottom:1px;">Date Signed</span>' + emptyGrid;
  h +=   '</div>';
  h += '</div>';

  // Item 54 — Employee signature (CONFORME)
  h += '<div style="border-bottom:1px solid #000;padding:4px 4px 3px;display:flex;flex-direction:column;">';
  h +=   '<div style="font-weight:bold;font-size:8px;">CONFORME:</div>';
  h +=   '<div style="display:flex;width:100%;margin-top:2px;align-items:flex-end;">';
  h +=     '<div style="font-weight:bold;font-size:8px;width:26px;">54</div>';
  h +=     '<div style="width:55%;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-end;">';
  h +=       '<div style="height:28px;"></div>';
  h +=       '<div style="border-bottom:1px solid #000;width:100%;text-align:center;font-size:9px;font-weight:bold;padding-bottom:2px;">' + empName + '</div>';
  h +=       '<div style="font-size:7px;text-align:center;margin-top:1px;">Employee Signature Over Printed Name</div>';
  h +=     '</div>';
  h +=     '<div style="display:flex;align-items:flex-end;gap:4px;margin-left:12px;">';
  h +=       '<span style="font-size:8px;margin-bottom:1px;">Date Signed</span>' + emptyGrid;
  h +=     '</div>';
  h +=   '</div>';
  h += '</div>';

  // CTC / Valid ID row
  h += '<div class="row" style="padding:2px;border-bottom:2px solid #000;">';
  h +=   '<div class="flex" style="align-items:center;width:31%;">';
  h +=     '<div style="font-size:7px;width:60px;flex-shrink:0;">CTC/Valid ID No. of Employee</div>';
  h +=     inpFlex('');
  h +=   '</div>';
  h +=   '<div class="flex" style="align-items:center;width:22%;">';
  h +=     '<div style="font-size:7px;width:32px;flex-shrink:0;">Place of Issue</div>';
  h +=     inpFlex('');
  h +=   '</div>';
  h +=   '<div class="flex" style="align-items:center;width:27%;">';
  h +=     '<div style="font-size:7px;width:50px;flex-shrink:0;">Date of Issue</div>';
  h +=     '<div style="margin:0 3px;">' + emptyGrid + '</div>';
  h +=   '</div>';
  h +=   '<div class="flex" style="align-items:center;width:20%;">';
  h +=     '<div style="font-size:7px;margin-right:3px;text-align:center;flex-shrink:0;">Amount Paid, if CTC</div>';
  h +=     inpFlex('');
  h +=   '</div>';
  h += '</div>';

  // Substituted filing header
  h += '<div class="section-header border-b">To be accomplished under substituted filing</div>';

  // Items 55 & 56
  h += '<div class="row" style="border-bottom:1px solid #000;align-items:stretch;">';
  h +=   '<div class="cell border-r" style="width:50%;padding:2px 4px;">';
  h +=     '<div class="legal-text" style="padding:0;margin-bottom:3px;">I declare, under the penalties of perjury, that the information herein stated are reported under BIR Form No. 1604-C which has been filed with the Bureau of Internal Revenue.</div>';
  h +=     '<div style="font-weight:bold;font-size:8px;margin:2px 0;">55</div>';
  h +=     '<div style="display:flex;flex-direction:column;align-items:center;margin-top:auto;">';
  h +=       '<div style="height:24px;"></div>';
  h +=       '<div style="border-bottom:1px solid #000;width:90%;text-align:center;font-size:9px;font-weight:bold;padding-bottom:2px;">' + (isSubFiling ? authorizedSig : '') + '</div>';
  h +=       '<div style="font-size:7px;text-align:center;margin-top:1px;">Present Employer/ Authorized Agent Signature Over Printed Name (Head of Accounting/ HR or Authorized Representative)</div>';
  h +=     '</div>';
  h +=   '</div>';
  h +=   '<div class="cell" style="width:50%;padding:2px 4px;">';
  h +=     '<div class="legal-text" style="padding:0;margin-bottom:3px;">I declare, under the penalties of perjury, that I am qualified under substituted filing of Income Tax Return (BIR Form No. 1700), since I received purely compensation income from only one employer in the Philippines for the calendar year; that taxes have been correctly withheld by my employer (tax due equals tax withheld); that the BIR Form No. 1604-C filed by my employer to the BIR shall constitute as my income tax return; and that BIR Form No. 2316 shall serve the same purpose as if BIR Form No. 1700 had been filed pursuant to the provisions of Revenue Regulations (RR) No. 2-98, as amended.</div>';
  h +=     '<div style="font-weight:bold;font-size:8px;margin:2px 0;padding-left:16px;">56</div>';
  h +=     '<div style="display:flex;flex-direction:column;align-items:center;margin-top:auto;">';
  h +=       '<div style="height:24px;"></div>';
  h +=       '<div style="border-bottom:1px solid #000;width:90%;text-align:center;font-size:9px;font-weight:bold;padding-bottom:2px;">' + (isSubFiling ? empName : '') + '</div>';
  h +=       '<div style="font-size:7px;text-align:center;margin-top:1px;">Employee Signature Over Printed Name</div>';
  h +=     '</div>';
  h +=   '</div>';
  h += '</div>';

  h += '<div style="padding:2px 4px;font-size:8px;">*NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)</div>';
  h += '</div>'; // end signatures

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    + '<style>' + css + '</style></head>'
    + '<body><div class="form-page">' + h + '</div></body></html>';
}
