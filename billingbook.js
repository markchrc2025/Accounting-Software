function doGet() {
  return HtmlService.createHtmlOutputFromFile('billingbook')
      .setTitle('Workscale Billing Book')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Helper: retrieve the Central Settings spreadsheet ID from Script Properties.
// Run once to configure: PropertiesService.getScriptProperties().setProperty('CENTRAL_SS_ID', '<your-id>');
function getCentralSs() {
  const id = PropertiesService.getScriptProperties().getProperty('CENTRAL_SS_ID');
  if (!id) throw new Error('CENTRAL_SS_ID is not set. Add it via Script Properties.');
  return SpreadsheetApp.openById(id);
}

// -------------------------------------------------------------
// PHASE 1: RUN THIS ONCE to authorize & create all Sheets
// -------------------------------------------------------------
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss.getSheetByName('Transactions')) {
    const sheet = ss.insertSheet('Transactions');
    sheet.appendRow(['id', 'clientId', 'date', 'type', 'period', 'gross', 'vat', 'ewt', 'total', 'collected', 'balance', 'status']);
    sheet.getRange('A1:L1').setFontWeight('bold').setBackground('#f1f5f9');
    sheet.setFrozenRows(1);
  }

  // Phase 1: New Architecture Sheets
  if (!ss.getSheetByName('RawBillingUploads')) {
    const sheet = ss.insertSheet('RawBillingUploads');
    sheet.appendRow(['UploadId', 'ContactId', 'ContactName', 'FileName', 'FileId', 'FileUrl', 'BillingPeriod', 'BillingDate', 'TransformMethod', 'Status', 'ComputationId', 'UploadedAt', 'UploadedBy']);
    sheet.getRange('A1:M1').setFontWeight('bold').setBackground('#f1f5f9');
    sheet.setFrozenRows(1);
  }

  if (!ss.getSheetByName('BillingComputations')) {
    const sheet = ss.insertSheet('BillingComputations');
    sheet.appendRow(['ComputationId', 'UploadId', 'BillingStatementId', 'ContactId', 'ContactName', 'BillingPeriod', 'ServiceFeeRate', 'TaxGroupName', 'TransformMethod', 'RowCount', 'GrandTotal', 'FileId', 'FileUrl', 'WorksheetUrl', 'Status', 'ProcessedAt', 'ProcessedBy']);
    sheet.getRange('A1:Q1').setFontWeight('bold').setBackground('#f1f5f9');
    sheet.setFrozenRows(1);
  }

  if (!ss.getSheetByName('BillingTransformConfigs')) {
    const sheet = ss.insertSheet('BillingTransformConfigs');
    sheet.appendRow(['ContactName', 'TransformMethod', 'ColumnAliases', 'Notes']);
    sheet.getRange('A1:D1').setFontWeight('bold').setBackground('#f1f5f9');
    sheet.setFrozenRows(1);
  }

  if (!ss.getSheetByName('BillingBooks')) {
    const sheet = ss.insertSheet('BillingBooks');
    sheet.appendRow(['BookId', 'ContactId', 'ContactName', 'TIN', 'BusinessStyle', 'Address', 'PrimaryEmails', 'CcEmails', 'Terms', 'CreatedAt', 'CreatedBy', 'WorksheetId', 'WorksheetUrl']);
    sheet.getRange('A1:M1').setFontWeight('bold').setBackground('#e0f2fe');
    sheet.setFrozenRows(1);
  }

  if (!ss.getSheetByName('BillingBookTrnx')) {
    const sheet = ss.insertSheet('BillingBookTrnx');
    sheet.appendRow(['id', 'bookId', 'date', 'type', 'period', 'gross', 'vat', 'ewt', 'total', 'collected', 'balance', 'status']);
    sheet.getRange('A1:L1').setFontWeight('bold').setBackground('#e0f2fe');
    sheet.setFrozenRows(1);
  }

  // Payroll-Push integration sheets
  if (!ss.getSheetByName('BillingDataList')) {
    const sheet = ss.insertSheet('BillingDataList');
    sheet.appendRow(['PushId', 'PayrollBookId', 'PayrollBookStatus', 'CompanyName',
                     'CutoffStart', 'CutoffEnd', 'SpreadsheetId', 'SpreadsheetUrl',
                     'FileName', 'PushedAt', 'PushedBy', 'Status']);
    sheet.getRange('A1:L1').setFontWeight('bold').setBackground('#fef9c3');
    sheet.setFrozenRows(1);
  }

  if (!ss.getSheetByName('ParameterTemplates')) {
    const sheet = ss.insertSheet('ParameterTemplates');
    sheet.appendRow(['TemplateId', 'Label', 'Method', 'ParamsJson', 'CreatedAt', 'CreatedBy']);
    sheet.getRange('A1:F1').setFontWeight('bold').setBackground('#ede9fe');
    sheet.setFrozenRows(1);
  }

  // Payment sheets
  setupPaymentsSheets_(ss);

  if (!ss.getSheetByName('PayrollBillingLines')) {
    const sheet = ss.insertSheet('PayrollBillingLines');
    sheet.appendRow([
      'PushId', 'PayrollBookId', 'CompanyName', 'CutoffStart', 'CutoffEnd', 'Year',
      'Name', 'Daily Rate', 'Days', 'Regular', 'Lates', 'Lates Amount', 'Total Basic Salary',
      'Overtime Hrs', 'Overtime', 'DOD Hrs', 'DOD', 'DOD OT Hrs', 'DOD OT',
      'Spl Holiday Hrs', 'Spl Holiday', 'Spl Holiday OT Hrs', 'Spl Holiday OT',
      'Spl Holiday DOD Hrs', 'Spl Holiday DOD', 'Spl Holiday DOD OT Hrs', 'Spl Holiday DOD OT',
      'Legal Holiday Hrs', 'Legal Holiday', 'Legal Holiday OT Hrs', 'Legal Holiday OT',
      'Legal Holiday DOD Hrs', 'Legal Holiday DOD', 'Legal Holiday DOD OT Hrs', 'Legal Holiday DOD OT',
      'Night Diff Hrs', 'Night Diff', 'Adjustment', 'Allowances',
      'SSS', 'Pagibig', 'Philhealth', '13th Month Pay', 'Subtotal', 'Service Fee', 'Total',
      'Branch', 'Department', 'Work Location', 'Company Name (Client)', 'Position', 'Work Region'
    ]);
    sheet.getRange('A1:AZ1').setFontWeight('bold').setBackground('#fef9c3');
    sheet.setFrozenRows(1);
  }

  // ── Billing AR sheets (migrated from Accounting Web App) ──────────────────
  (function() {
    function ensureSheet_(name, headers, bg) {
      var s = ss.getSheetByName(name);
      if (!s) s = ss.insertSheet(name);
      if (s.getLastRow() === 0 || s.getRange('A1').getValue() === '') {
        s.getRange(1, 1, 1, headers.length).setValues([headers]);
        s.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground(bg || '#f1f5f9');
        s.setFrozenRows(1);
      }
    }

    ensureSheet_('ServiceInvoices',
      ['SiId','Contact','SiDate','DueDate','Amount','AppliedAmount','Balance','Status',
       'BillingStatementId','Notes','TaxType','EwtRate','BankCode','IncomeAccountCode',
       'VatAmount','EwtAmount','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy'],
      '#fef9c3');

    ensureSheet_('BillingStatements',
      ['BsId','Client','Contact','BillingNo','BillingPeriod','BillingDate','CreditTerm','BillingDate2',
       'TotalSalesVatInclusive','LessVAT','Total','LessWithholdingTax','CostOfService','PaymentDue',
       'ChargesReversal','AmountCollected','DaysDue','TotalAmount','AppliedAmount','Balance','Status',
       'ReferenceSiIds','Notes','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy',
       'ContactId','ContactName','PeriodStart','PeriodEnd','Description','GrossAmount','TaxGroupName',
       'TaxBreakdownJson','TotalVatInclusive','NetDue','IncomeAccount','JournalEntryId'],
      '#dbeafe');

    ensureSheet_('Collections',
      ['CollectionId','SiId','BillingStatementId','Contact','CollectionDate','AmountReceived',
       'AppliedAmount','UnappliedAmount','Method','ReferenceNo','Status','Notes',
       'CreatedAt','CreatedBy','UpdatedAt','UpdatedBy'],
      '#dcfce7');

    ensureSheet_('CollectionApplications',
      ['AppId','CollectionId','BillingStatementId','SiId','Contact',
       'AppliedAmount','AppliedAt','AppliedBy','Note'],
      '#f3e8ff');
  })();
}

// -------------------------------------------------------------
// READ DATA
// -------------------------------------------------------------
function getAppData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  function getSheetDataAsObjects(sheet) {
    if (!sheet) return [];
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; 
    const headers = data[0];
    const rows = [];
    for (let i = 1; i < data.length; i++) {
      let obj = {};
      headers.forEach((h, j) => { obj[h] = data[i][j]; });
      rows.push(obj);
    }
    return rows;
  }

  const transactions = getSheetDataAsObjects(ss.getSheetByName('Transactions'));
  const rawUploadsRaw = getSheetDataAsObjects(ss.getSheetByName('RawBillingUploads'));
  const billingDataList = getSheetDataAsObjects(ss.getSheetByName('BillingDataList'));

  // Enrich rawUploads with WorksheetUrl from BillingComputations (keyed by UploadId)
  const computations = getSheetDataAsObjects(ss.getSheetByName('BillingComputations'));
  const compByUploadId = {};
  computations.forEach(c => { if (c.UploadId) compByUploadId[c.UploadId] = c; });
  const rawUploads = rawUploadsRaw.map(u => ({
    ...u,
    WorksheetUrl: (compByUploadId[u.UploadId] && (compByUploadId[u.UploadId].WorksheetUrl || compByUploadId[u.UploadId].GeneratedUrl)) || ''
  }));

  // BillingBooks — primary registry of opened billing ledgers
  const billingBooksRaw = getSheetDataAsObjects(ss.getSheetByName('BillingBooks'));
  const books = billingBooksRaw.map(r => ({
    id: r.BookId || '',
    name: r.ContactName || '',
    contactId: r.ContactId || '',
    tin: r.TIN || '',
    businessStyle: r.BusinessStyle || '',
    address: r.Address || '',
    primaryEmails: r.PrimaryEmails || '',
    ccEmails: r.CcEmails || '',
    terms: r.Terms || '',
    createdAt: r.CreatedAt || '',
    worksheetId: r.WorksheetId || '',
    worksheetUrl: r.WorksheetUrl || ''
  }));

  // BillingBookTrnx — new transactions table; merge with legacy Transactions for backward compat
  const bookTrnx = getSheetDataAsObjects(ss.getSheetByName('BillingBookTrnx')).map(r => ({
    ...r, clientId: r.bookId || r.clientId
  }));
  const mergedTransactions = [...bookTrnx, ...transactions];

  // FETCH CONTACTS, SEQUENCE, TAX CONFIG FROM CENTRAL SETTINGS SPREADSHEET
  let contacts = [];
  let billingCc = "";
  let taxRates  = [];
  let taxGroups = [];
  try {
    const centralSs = getCentralSs();
    const contactsSheet = centralSs.getSheetByName('Contacts');
    contacts = getSheetDataAsObjects(contactsSheet);

    const sequenceSheet = centralSs.getSheetByName('Sequence');
    if (sequenceSheet) {
      const seqData = sequenceSheet.getDataRange().getValues();
      for(let i = 1; i < seqData.length; i++) {
         if(seqData[i][0] === 'ccEmails') {
            billingCc = seqData[i][1];
            break;
         }
      }
    }
    // TaxRates and TaxGroups for the ProcessBillingModal dropdown
    const taxRatesSheet = centralSs.getSheetByName('TaxRates');
    if (taxRatesSheet) {
      const trData = taxRatesSheet.getDataRange().getValues();
      const trH = trData[0].map(h => h.toString().toLowerCase().trim());
      const nameCol    = trH.findIndex(h => h === 'taxname');
      const rateCol    = trH.findIndex(h => h === 'ratepercent');
      const accountCol = trH.findIndex(h => h === 'taxaccount');
      const activeCol  = trH.findIndex(h => h === 'isactive');
      for (let i = 1; i < trData.length; i++) {
        if (activeCol !== -1 && String(trData[i][activeCol]).toUpperCase() !== 'TRUE') continue;
        taxRates.push({
          name:       nameCol    !== -1 ? String(trData[i][nameCol]    || '').trim() : '',
          rate:       rateCol    !== -1 ? Number(trData[i][rateCol])                : 0,
          taxAccount: accountCol !== -1 ? String(trData[i][accountCol] || '').trim() : ''
        });
      }
    }
    const taxGroupsSheet = centralSs.getSheetByName('TaxGroups');
    if (taxGroupsSheet) {
      const tgData = taxGroupsSheet.getDataRange().getValues();
      const tgH = tgData[0].map(h => h.toString().toLowerCase().trim());
      const tgNameCol   = tgH.findIndex(h => h === 'groupname');
      const tgRatesCol  = tgH.findIndex(h => h === 'ratenames');
      const tgActiveCol = tgH.findIndex(h => h === 'isactive');
      for (let i = 1; i < tgData.length; i++) {
        if (tgActiveCol !== -1 && String(tgData[i][tgActiveCol]).toUpperCase() !== 'TRUE') continue;
        taxGroups.push({
          name:      tgNameCol  !== -1 ? String(tgData[i][tgNameCol]  || '').trim() : '',
          rateNames: tgRatesCol !== -1 ? String(tgData[i][tgRatesCol] || '').trim() : ''
        });
      }
    }
  } catch (e) {
    console.error("Error fetching Central Settings: " + e.toString());
  }

  // FETCH ACCOUNTS FROM CENTRAL JOURNAL LINES (Income + Cost of Services)
  let accounts = [];
  try {
    const jlSs = SpreadsheetApp.openById('1e7ixGvLABB8iRZBwASqWILL9DG4jpVxBYuOoeIv4tvE');
    const accountsSheet = jlSs.getSheetByName('Accounts');
    if (accountsSheet) {
      const acctData = accountsSheet.getDataRange().getValues();
      const acctH    = acctData[0].map(h => h.toString().toLowerCase().trim());
      const type1Col = acctH.findIndex(h => h === 'type1');
      const nameCol  = acctH.findIndex(h => h.replace(/\s+/g, ' ') === 'account name');
      const codeCol  = acctH.findIndex(h => h.replace(/\s+/g, ' ') === 'account code');
      for (let i = 1; i < acctData.length; i++) {
        const t1   = type1Col !== -1 ? String(acctData[i][type1Col] || '').trim() : '';
        const code = codeCol  !== -1 ? String(acctData[i][codeCol]  || '').trim() : '';
        const name = nameCol  !== -1 ? String(acctData[i][nameCol]  || '').trim() : '';
        if (!name) continue;
        accounts.push({ type1: t1, accountCode: code, accountName: name });
      }
    }
  } catch (e) {
    Logger.log('Accounts fetch failed: ' + e.message);
  }

  return JSON.stringify({ 
    transactions: mergedTransactions, 
    rawUploads: rawUploads,
    computations: computations,
    contacts: contacts,
    books: books,
    billingCc: billingCc,
    taxRates: taxRates,
    taxGroups: taxGroups,
    accounts: accounts,
    billingDataList: billingDataList,
    payments: getSheetDataAsObjects(ss.getSheetByName('BillingPayments')).map(r => ({
      paymentId:   String(r.PaymentId   || ''),
      bookId:      String(r.BookId      || ''),
      contactId:   String(r.ContactId   || ''),
      contactName: String(r.ContactName || ''),
      paymentDate: String(r.PaymentDate || ''),
      paymentNo:   String(r.PaymentNo   || ''),
      status:      String(r.Status      || '')
    })),
    parameterTemplates: getSheetDataAsObjects(ss.getSheetByName('ParameterTemplates')).map(r => ({
      key:    String(r.TemplateId || ''),
      label:  String(r.Label     || ''),
      method: String(r.Method    || 'regional'),
      ...( (() => { try { return JSON.parse(r.ParamsJson || '{}'); } catch { return {}; } })() )
    })),
    billingTransformConfigs: (() => {
      const map = {};
      const cfgSheet = ss.getSheetByName('BillingTransformConfigs');
      if (cfgSheet) {
        getSheetDataAsObjects(cfgSheet).forEach(r => {
          if (r.ContactName) map[String(r.ContactName).trim()] = String(r.TransformMethod || r['TransferMethod'] || 'regional').trim();
        });
      }
      return map;
    })()
  });
}

// -------------------------------------------------------------
// PARAMETER TEMPLATES
// -------------------------------------------------------------
function saveParameterTemplate(payloadStr) {
  const payload = JSON.parse(payloadStr);
  if (!payload.label || !payload.method || !payload.Computation || !payload.SummarySheet) {
    throw new Error('Invalid template payload: label, method, Computation, and SummarySheet are required.');
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('ParameterTemplates');
  if (!sheet) {
    sheet = ss.insertSheet('ParameterTemplates');
    sheet.appendRow(['TemplateId', 'Label', 'Method', 'ParamsJson', 'CreatedAt', 'CreatedBy']);
    sheet.getRange('A1:F1').setFontWeight('bold').setBackground('#ede9fe');
    sheet.setFrozenRows(1);
  }
  const templateId = 'TPL-' + Date.now();
  const paramsJson = JSON.stringify({ Computation: payload.Computation, SummarySheet: payload.SummarySheet });
  const createdAt  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MM/dd/yyyy HH:mm:ss');
  const createdBy  = Session.getEffectiveUser().getEmail();
  sheet.appendRow([templateId, payload.label, payload.method, paramsJson, createdAt, createdBy]);
  return JSON.stringify({ key: templateId, label: payload.label, method: payload.method,
                          Computation: payload.Computation, SummarySheet: payload.SummarySheet });
}

function deleteParameterTemplate(templateId) {
  if (!templateId) throw new Error('templateId is required.');
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('ParameterTemplates');
  if (!sheet) return;
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol   = headers.indexOf('TemplateId');
  if (idCol === -1) return;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idCol]) === String(templateId)) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
}

// -------------------------------------------------------------
// PHASE 2: UPLOAD RAW BILLING FILE
// -------------------------------------------------------------
function getOrCreateFolder(folderName, parentFolder = null) {
  const parent = parentFolder || DriveApp.getRootFolder();
  const folders = parent.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(folderName);
}

function uploadRawBillingFile(payloadStr) {
  const payload = JSON.parse(payloadStr);

  // --- Input Validation ---
  if (!payload.contactId || !payload.fileName || !payload.bytesBase64 || !payload.mimeType) {
    throw new Error('Invalid payload: contactId, fileName, mimeType, and bytesBase64 are required.');
  }
  const ALLOWED_MIMES = [
    'text/csv', 'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  if (!ALLOWED_MIMES.includes(payload.mimeType)) {
    throw new Error('Invalid file type. Only CSV and Excel files are allowed.');
  }
  // Sanitize filename — strip characters that could be problematic in Drive
  payload.fileName = payload.fileName.toString().replace(/[^a-zA-Z0-9._\- ]/g, '_').substring(0, 200);

  // 1. Save File to Drive
  const billingFolderId = PropertiesService.getScriptProperties().getProperty('BILLING_FOLDER_ID');
  if (!billingFolderId) throw new Error('BILLING_FOLDER_ID is not set. Add it via Script Properties.');
  const mainFolder = DriveApp.getFolderById(billingFolderId);
  const clientFolder = getOrCreateFolder(payload.contactName, mainFolder);
  
  const blob = Utilities.newBlob(Utilities.base64Decode(payload.bytesBase64), payload.mimeType, payload.fileName);
  const file = clientFolder.createFile(blob);

  // 2. Log to RawBillingUploads Sheet
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('RawBillingUploads');
  const uploadId = 'RAWUP-' + Date.now();
  
  const rowData = {
    UploadId: uploadId,
    ContactId: payload.contactId,
    ContactName: payload.contactName,
    FileName: payload.fileName,
    FileId: file.getId(),
    FileUrl: file.getUrl(),
    BillingPeriod: payload.period,
    BillingDate: payload.date,
    TransformMethod: '', 
    Status: 'Raw', 
    ComputationId: '',
    UploadedAt: new Date().toISOString(),
    UploadedBy: Session.getActiveUser().getEmail()
  };

  sheet.appendRow([
    rowData.UploadId, rowData.ContactId, rowData.ContactName, rowData.FileName, 
    rowData.FileId, rowData.FileUrl, rowData.BillingPeriod, rowData.BillingDate, 
    rowData.TransformMethod, rowData.Status, rowData.ComputationId, 
    rowData.UploadedAt, rowData.UploadedBy
  ]);

  return JSON.stringify(rowData);
}

// -------------------------------------------------------------
// WRITE DATA
// -------------------------------------------------------------
function saveContact(payloadStr) {
  const payload = JSON.parse(payloadStr);

  // --- Input Validation & Sanitization ---
  if (!payload.name || typeof payload.name !== 'string' || payload.name.trim() === '') {
    throw new Error('Contact name is required.');
  }
  const sanitize = (val) => (val || '').toString().trim().substring(0, 500);
  payload.name = sanitize(payload.name);
  payload.tin = sanitize(payload.tin);
  payload.businessStyle = sanitize(payload.businessStyle);
  payload.address = sanitize(payload.address);
  payload.primaryEmails = sanitize(payload.primaryEmails);
  payload.terms = sanitize(payload.terms);

  const centralSs = getCentralSs();
  const sheet = centralSs.getSheetByName('Contacts');

  // Dynamically get headers to ensure columns map exactly to Central Settings
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const newRow = new Array(headers.length).fill('');

  // Map incoming payload to the exact columns in Central Settings
  headers.forEach((header, index) => {
    if (header === 'ContactID') newRow[index] = payload.id || `CNT-${Date.now()}`;
    if (header === 'ContactName') newRow[index] = payload.name || '';
    if (header === 'TIN') newRow[index] = payload.tin || '';
    if (header === 'Business Style') newRow[index] = payload.businessStyle || '';
    if (header === 'Address Line 1') newRow[index] = payload.address || '';
    if (header === 'Email' || header === 'primaryEmails') newRow[index] = payload.primaryEmails || '';
    if (header === 'Terms') newRow[index] = payload.terms || '';
    if (header === 'ContactType') newRow[index] = 'Customer';
  });

  sheet.appendRow(newRow);
  return true;
}

// Retained alias so the frontend doesn't break when saving a new Billing Book
function saveNewClient(clientString) {
  return saveContact(clientString);
}

function saveNewBillingBook(payloadStr) {
  const payload = JSON.parse(payloadStr);

  if (!payload.bookId || !payload.contactName) {
    throw new Error('bookId and contactName are required.');
  }
  const sanitize = (val) => (val || '').toString().trim().substring(0, 500);
  const bookId      = sanitize(payload.bookId);
  const contactId   = sanitize(payload.contactId);
  const contactName = sanitize(payload.contactName);
  const tin         = sanitize(payload.tin);
  const businessStyle = sanitize(payload.businessStyle);
  const address     = sanitize(payload.address);
  const primaryEmails = sanitize(payload.primaryEmails);
  const ccEmails    = sanitize(payload.ccEmails);
  const terms       = sanitize(payload.terms);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('BillingBooks');
  if (!sheet) throw new Error('BillingBooks sheet not found. Run setupDatabase() first.');

  // Idempotency: skip if bookId already exists
  const existingIds = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat()
    : [];
  if (existingIds.includes(bookId)) return JSON.stringify({ bookId, skipped: true });

  // Worksheet is created lazily on first computation by getOrCreateBillingWorksheet_()
  sheet.appendRow([bookId, contactId, contactName, tin, businessStyle, address, primaryEmails, ccEmails, terms, new Date().toISOString(), Session.getActiveUser().getEmail(), '', '']);
  return JSON.stringify({ bookId, contactName, worksheetId: '', worksheetUrl: '' });
}

/**
 * Returns the dedicated billing worksheet Spreadsheet for a contact.
 * Opens the existing one from BillingBooks.WorksheetId, or creates a new one
 * in BILLING_WORKSHEET_FOLDER_ID and writes the ID/URL back to BillingBooks.
 */
function getOrCreateBillingWorksheet_(contactId, contactName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const booksSheet = ss.getSheetByName('BillingBooks');
  if (!booksSheet) throw new Error('BillingBooks sheet not found. Run setupDatabase() first.');

  const data = booksSheet.getDataRange().getValues();
  const headers = data[0];
  const cidCol   = headers.indexOf('ContactId');
  const wsIdCol  = headers.indexOf('WorksheetId');
  const wsUrlCol = headers.indexOf('WorksheetUrl');

  let bookRowIndex = -1;
  let existingWsId = null;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][cidCol]) === String(contactId)) {
      bookRowIndex = i + 1; // 1-indexed for sheet range
      existingWsId = (wsIdCol !== -1 && data[i][wsIdCol]) ? data[i][wsIdCol] : null;
      break;
    }
  }

  // Try to open the existing worksheet
  if (existingWsId) {
    try {
      return SpreadsheetApp.openById(existingWsId);
    } catch (e) {
      // File was deleted — fall through to recreate
    }
  }

  // Create a new spreadsheet in the target folder
  // Falls back to BILLING_FOLDER_ID if BILLING_WORKSHEET_FOLDER_ID is not separately configured.
  const wsFolderId = PropertiesService.getScriptProperties().getProperty('BILLING_WORKSHEET_FOLDER_ID')
                  || PropertiesService.getScriptProperties().getProperty('BILLING_FOLDER_ID');
  if (!wsFolderId) throw new Error('Neither BILLING_WORKSHEET_FOLDER_ID nor BILLING_FOLDER_ID is set in Script Properties. Please add at least one.');
  const wsFolder = DriveApp.getFolderById(wsFolderId);
  const newWs = SpreadsheetApp.create('Billing Worksheet - ' + contactName);
  const wsFile = DriveApp.getFileById(newWs.getId());
  wsFolder.addFile(wsFile);
  DriveApp.getRootFolder().removeFile(wsFile);

  // Write the new ID/URL back to BillingBooks row
  if (bookRowIndex > 0) {
    if (wsIdCol  !== -1) booksSheet.getRange(bookRowIndex, wsIdCol  + 1).setValue(newWs.getId());
    if (wsUrlCol !== -1) booksSheet.getRange(bookRowIndex, wsUrlCol + 1).setValue(newWs.getUrl());
  }

  return newWs;
}

function saveNewTransaction(txnString) {
  const txn = JSON.parse(txnString);
  const bookId = txn.bookId || txn.clientId;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('BillingBookTrnx');
  if (!sheet) throw new Error('BillingBookTrnx sheet not found. Run setupDatabase() first.');
  sheet.appendRow([txn.id, bookId, txn.date, txn.type, txn.period, txn.gross, txn.vat, txn.ewt, txn.total, txn.collected, txn.balance, txn.status]);
  return true;
}

// -------------------------------------------------------------
// PAYMENTS: recordPayment, setupPaymentsSheets_
// -------------------------------------------------------------

/**
 * Ensures BillingPayments and BillingPaymentApplications sheets exist and have headers.
 * Handles the case where sheets were created empty before setup ran.
 */
function setupPaymentsSheets_(ss) {
  let pay = ss.getSheetByName('BillingPayments');
  if (!pay) pay = ss.insertSheet('BillingPayments');
  if (pay.getLastRow() === 0 || pay.getRange('A1').getValue() === '') {
    pay.getRange('A1:P1').setValues([['PaymentId', 'BookId', 'ContactId', 'ContactName', 'PaymentDate', 'PaymentNo',
                                      'AmountReceived', 'BankCharges', 'PaymentMode', 'DepositTo', 'ReferenceNo',
                                      'TaxDeducted', 'Notes', 'Status', 'CreatedAt', 'CreatedBy']]);
    pay.getRange('A1:P1').setFontWeight('bold').setBackground('#d1fae5');
    pay.setFrozenRows(1);
  }

  let app = ss.getSheetByName('BillingPaymentApplications');
  if (!app) app = ss.insertSheet('BillingPaymentApplications');
  if (app.getLastRow() === 0 || app.getRange('A1').getValue() === '') {
    app.getRange('A1:F1').setValues([['ApplicationId', 'PaymentId', 'TransactionId', 'BookId', 'AmountApplied', 'AppliedAt']]);
    app.getRange('A1:F1').setFontWeight('bold').setBackground('#d1fae5');
    app.setFrozenRows(1);
  }
}

/**
 * Records a payment, applies it to BillingBookTrnx rows, and returns updated transactions.
 * Payload: { bookId, contactId, contactName, paymentDate, paymentNo, amountReceived,
 *            bankCharges, paymentMode, depositTo, referenceNo, taxDeducted, notes, status,
 *            applications: [{ transactionId, amountApplied }] }
 */
function recordPayment(payloadStr) {
  const payload = JSON.parse(payloadStr);

  // --- Input Validation ---
  if (!payload.bookId || !payload.paymentDate || !payload.paymentNo) {
    throw new Error('bookId, paymentDate, and paymentNo are required.');
  }
  if (isNaN(Number(payload.amountReceived))) {
    throw new Error('amountReceived must be a valid number.');
  }
  if (!Array.isArray(payload.applications)) {
    throw new Error('applications must be an array.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setupPaymentsSheets_(ss);

  const paymentId  = 'PAY-' + Date.now();
  const now        = new Date().toISOString();
  const createdBy  = Session.getActiveUser().getEmail();
  const sanitize   = (v) => (v || '').toString().trim().substring(0, 500);

  // 1. Write to BillingPayments
  const paySheet = ss.getSheetByName('BillingPayments');
  paySheet.appendRow([
    paymentId,
    sanitize(payload.bookId),
    sanitize(payload.contactId || ''),
    sanitize(payload.contactName || ''),
    sanitize(payload.paymentDate),
    sanitize(payload.paymentNo),
    Number(payload.amountReceived) || 0,
    Number(payload.bankCharges)    || 0,
    sanitize(payload.paymentMode || 'Cash'),
    sanitize(payload.depositTo || ''),
    sanitize(payload.referenceNo || ''),
    sanitize(payload.taxDeducted || 'none'),
    sanitize(payload.notes || ''),
    sanitize(payload.status || 'Paid'),
    now,
    createdBy
  ]);

  // 2. Write applications + update BillingBookTrnx
  const appSheet  = ss.getSheetByName('BillingPaymentApplications');
  const trnxSheet = ss.getSheetByName('BillingBookTrnx');

  let trnxData    = null;
  let trnxHeaders = null;
  if (trnxSheet && trnxSheet.getLastRow() > 1) {
    trnxData    = trnxSheet.getDataRange().getValues();
    trnxHeaders = trnxData[0];
  }

  const updatedTransactions = [];

  payload.applications.forEach((app, idx) => {
    const amtApplied = Number(app.amountApplied) || 0;
    if (amtApplied <= 0) return;

    // Write application row
    const appId = 'PAYAPP-' + Date.now() + '-' + idx;
    appSheet.appendRow([appId, paymentId, sanitize(app.transactionId), sanitize(payload.bookId), amtApplied, now]);

    // Update BillingBookTrnx collected, balance, status
    if (!trnxData) return;
    const idCol        = trnxHeaders.indexOf('id');
    const collectedCol = trnxHeaders.indexOf('collected');
    const balanceCol   = trnxHeaders.indexOf('balance');
    const statusCol    = trnxHeaders.indexOf('status');
    const totalCol     = trnxHeaders.indexOf('total');

    for (let i = 1; i < trnxData.length; i++) {
      if (String(trnxData[i][idCol]) === String(app.transactionId)) {
        const oldCollected = Number(trnxData[i][collectedCol]) || 0;
        const total        = Number(trnxData[i][totalCol])     || 0;
        const newCollected = oldCollected + amtApplied;
        const newBalance   = Math.max(0, total - newCollected);
        const newStatus    = newBalance <= 0.001 ? 'Paid' : 'Unpaid';

        const rowNum = i + 1; // 1-indexed
        if (collectedCol !== -1) trnxSheet.getRange(rowNum, collectedCol + 1).setValue(newCollected);
        if (balanceCol   !== -1) trnxSheet.getRange(rowNum, balanceCol   + 1).setValue(newBalance);
        if (statusCol    !== -1) trnxSheet.getRange(rowNum, statusCol    + 1).setValue(newStatus);

        // Build updated txn object for response
        const txnObj = {};
        trnxHeaders.forEach((h, j) => { txnObj[h] = trnxData[i][j]; });
        txnObj.collected = newCollected;
        txnObj.balance   = newBalance;
        txnObj.status    = newStatus;
        txnObj.clientId  = txnObj.bookId || txnObj.clientId;
        updatedTransactions.push(txnObj);
        break;
      }
    }
  });

  return JSON.stringify({ success: true, paymentId, updatedTransactions });
}

// -------------------------------------------------------------
// VOID & REVERT
// -------------------------------------------------------------

/**
 * Marks a BillingBookTrnx row as Voided.
 * Payload: { transactionId }
 */
function voidBillingStatement(payloadStr) {
  const payload = JSON.parse(payloadStr);
  if (!payload.transactionId) throw new Error('transactionId is required.');

  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('BillingBookTrnx');
  if (!sheet) throw new Error('BillingBookTrnx sheet not found.');

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol     = headers.indexOf('id');
  const statusCol = headers.indexOf('status');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(payload.transactionId)) {
      sheet.getRange(i + 1, statusCol + 1).setValue('Voided');
      return JSON.stringify({ success: true });
    }
  }
  throw new Error('Transaction not found: ' + payload.transactionId);
}

/**
 * Reverts a billing statement: deletes the BillingBookTrnx row,
 * clears BillingStatementId on the linked computation, and removes journal lines.
 * Payload: { transactionId }
 */
function revertBillingStatement(payloadStr) {
  const payload = JSON.parse(payloadStr);
  if (!payload.transactionId) throw new Error('transactionId is required.');
  const txnId = String(payload.transactionId);

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Delete from BillingBookTrnx
  const trnxSheet = ss.getSheetByName('BillingBookTrnx');
  if (trnxSheet) {
    const tData    = trnxSheet.getDataRange().getValues();
    const tHeaders = tData[0];
    const idCol    = tHeaders.indexOf('id');
    for (let i = tData.length - 1; i >= 1; i--) {
      if (String(tData[i][idCol]) === txnId) {
        trnxSheet.deleteRow(i + 1);
        break;
      }
    }
  }

  // 2. Clear BillingStatementId on the linked computation
  const compSheet = ss.getSheetByName('BillingComputations');
  if (compSheet) {
    const cData    = compSheet.getDataRange().getValues();
    const cHeaders = cData[0];
    const bsIdCol  = cHeaders.indexOf('BillingStatementId');
    if (bsIdCol !== -1) {
      for (let i = 1; i < cData.length; i++) {
        if (String(cData[i][bsIdCol]) === txnId) {
          compSheet.getRange(i + 1, bsIdCol + 1).setValue('');
          break;
        }
      }
    }
  }

  // 3. Delete journal lines from Central Journal Lines
  try {
    const jlSs    = SpreadsheetApp.openById('1e7ixGvLABB8iRZBwASqWILL9DG4jpVxBYuOoeIv4tvE');
    const jlSheet = jlSs.getSheetByName('JournalLines');
    if (jlSheet) {
      const jData    = jlSheet.getDataRange().getValues();
      const jHeaders = jData[0];
      const docIdCol = jHeaders.findIndex(h => h.toString().toLowerCase().trim() === 'documentid');
      if (docIdCol !== -1) {
        for (let i = jData.length - 1; i >= 1; i--) {
          if (String(jData[i][docIdCol]) === txnId) jlSheet.deleteRow(i + 1);
        }
      }
    }
  } catch (e) {
    Logger.log('Warning: could not remove journal lines for ' + txnId + ': ' + e.message);
  }

  return JSON.stringify({ success: true });
}

// Placeholder — approval required
function deleteStatement(payloadStr) {
  return JSON.stringify({ success: false, message: 'Delete requires management approval. Not yet implemented.' });
}

/**
 * READ-ONLY preview: looks up computation data, ARAccount, builds journal lines,
 * and generates a PDF of the BILLING SUMMARY sheet. Nothing is written.
 * Returns { computationId, contactName, billingPeriod, gross, vat, ewt, total,
 *           arAccount, journalLines, journalHeaders, warnings, pdfBase64, pdfError }
 */
function prepareBillingStatementReview(payloadStr) {
  const payload = JSON.parse(payloadStr);
  if (!payload.computationId) throw new Error('computationId is required.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. Load computation row ──────────────────────────────────────────────
  const compSheet = ss.getSheetByName('BillingComputations');
  const compData = compSheet.getDataRange().getValues();
  const compHeaders = compData[0];
  let compRow = null;
  for (let i = 1; i < compData.length; i++) {
    if (String(compData[i][compHeaders.indexOf('ComputationId')]) === String(payload.computationId)) {
      compRow = {};
      compHeaders.forEach((h, j) => { compRow[h] = compData[i][j]; });
      break;
    }
  }
  if (!compRow) throw new Error('Computation not found: ' + payload.computationId);

  const gross = Math.round(Number(compRow.GrandTotal) * 100) / 100;
  const warnings = [];

  // ── 2. Load Central Settings: Contacts, TaxRates, TaxGroups, Sequence ───
  let arAccount = '', taxGroupName = '', contactTerms = '15 days';
  const taxRatesMap   = {};  // taxName → { ratePercent, taxAccount }
  let applicableRateNames = [];
  let revenueAccount = 'Manpower Service Revenue';

  // Prefer TaxGroupName stored on the computation row (set explicitly at Process time)
  const storedTaxGroup = (compRow.TaxGroupName || '').toString().trim();

  try {
    const csSs = SpreadsheetApp.openById('1TueoeHavaK4lrNuWiZN_2TqcyoVev-3Ma-d3HEGGvdk');

    // Contacts — ARAccount only; TaxGroup falls back to stored value if present
    const cSheet = csSs.getSheetByName('Contacts');
    if (cSheet) {
      const cData = cSheet.getDataRange().getValues();
      const cH = cData[0];
      const cIdCol     = cH.findIndex(h => h.toString().toLowerCase() === 'contactid');
      const cArCol     = cH.findIndex(h => h.toString().toLowerCase() === 'araccount');
      const cTaxGrpCol = cH.findIndex(h => h.toString().toLowerCase() === 'taxgroup');
      const cTermsCol  = cH.findIndex(h => h.toString().toLowerCase() === 'terms');
      if (cArCol === -1) warnings.push('No "ARAccount" column found in Central Settings Contacts sheet.');

      // If ContactId is a BookId (BOOK-xxx) from legacy HRIS uploads, resolve the real ContactId via BillingBooks
      let resolvedContactId = String(compRow.ContactId || '').trim();
      if (/^BOOK-/i.test(resolvedContactId)) {
        const booksSheet = ss.getSheetByName('BillingBooks');
        if (booksSheet) {
          const bData = booksSheet.getDataRange().getValues();
          const bH = bData[0].map(h => String(h).trim().toLowerCase());
          const bBookIdCol    = bH.indexOf('bookid');
          const bContactIdCol = bH.indexOf('contactid');
          for (let b = 1; b < bData.length; b++) {
            if (bBookIdCol > -1 && String(bData[b][bBookIdCol]).trim() === resolvedContactId) {
              if (bContactIdCol > -1) resolvedContactId = String(bData[b][bContactIdCol]).trim();
              break;
            }
          }
        }
      }

      for (let i = 1; i < cData.length; i++) {
        if (String(cData[i][cIdCol]) === resolvedContactId) {
          arAccount = cArCol !== -1 ? String(cData[i][cArCol] || '').trim() : '';
          // Only use Contacts TaxGroup if nothing was stored at compute time
          if (!storedTaxGroup && cTaxGrpCol !== -1) {
            taxGroupName = String(cData[i][cTaxGrpCol] || '').trim();
          }
          contactTerms = cTermsCol !== -1 ? String(cData[i][cTermsCol] || '15 days').trim() : '15 days';
          break;
        }
      }
    }
    // Stored computation TaxGroup always wins
    if (storedTaxGroup) taxGroupName = storedTaxGroup;
    if (!arAccount) warnings.push('ARAccount is not configured for this contact. Please set it in Central Settings → Contacts.');

    // TaxRates — name → { ratePercent, taxAccount }
    const taxRatesSheet = csSs.getSheetByName('TaxRates');
    if (taxRatesSheet) {
      const trData = taxRatesSheet.getDataRange().getValues();
      const trH = trData[0].map(h => h.toString().toLowerCase().trim());
      const nameCol    = trH.findIndex(h => h === 'taxname');
      const rateCol    = trH.findIndex(h => h === 'ratepercent');
      const accountCol = trH.findIndex(h => h === 'taxaccount');
      const activeCol  = trH.findIndex(h => h === 'isactive');
      for (let i = 1; i < trData.length; i++) {
        if (activeCol !== -1 && String(trData[i][activeCol]).toUpperCase() !== 'TRUE') continue;
        const name = nameCol !== -1 ? String(trData[i][nameCol] || '').trim() : '';
        if (!name) continue;
        taxRatesMap[name] = {
          ratePercent: rateCol    !== -1 ? Number(trData[i][rateCol])                : 0,
          taxAccount:  accountCol !== -1 ? String(trData[i][accountCol] || '').trim() : ''
        };
      }
    }

    // TaxGroups — find applicable group for this contact
    const taxGroupsSheet = csSs.getSheetByName('TaxGroups');
    if (taxGroupsSheet) {
      const tgData = taxGroupsSheet.getDataRange().getValues();
      const tgH = tgData[0].map(h => h.toString().toLowerCase().trim());
      const tgNameCol   = tgH.findIndex(h => h === 'groupname');
      const tgRatesCol  = tgH.findIndex(h => h === 'ratenames');
      const tgActiveCol = tgH.findIndex(h => h === 'isactive');
      for (let i = 1; i < tgData.length; i++) {
        if (tgActiveCol !== -1 && String(tgData[i][tgActiveCol]).toUpperCase() !== 'TRUE') continue;
        const gName = tgNameCol !== -1 ? String(tgData[i][tgNameCol] || '').trim() : '';
        // Match by contact's TaxGroup if set, else use first active group containing "sales"
        const matches = taxGroupName ? gName === taxGroupName : gName.toLowerCase().includes('sales');
        if (matches) {
          const rateNamesStr = tgRatesCol !== -1 ? String(tgData[i][tgRatesCol] || '') : '';
          applicableRateNames = rateNamesStr.split(',').map(r => r.trim()).filter(Boolean);
          if (!taxGroupName) taxGroupName = gName;
          break;
        }
      }
    }
    // If no group matched but taxGroupName is a comma-separated list of rate names (By Rate mode), use them directly
    if (applicableRateNames.length === 0 && taxGroupName && taxGroupName.includes(',')) {
      applicableRateNames = taxGroupName.split(',').map(r => r.trim()).filter(Boolean);
    } else if (applicableRateNames.length === 0 && taxGroupName && taxRatesMap[taxGroupName]) {
      // Single rate name stored directly (no comma)
      applicableRateNames = [taxGroupName];
    }
    if (applicableRateNames.length === 0) {
      warnings.push('No applicable TaxGroup or TaxRates found. Falling back to default 12% VAT and 2% EWT.');
    }

    // Sequence — optional SERVICE_REVENUE_ACCOUNT key
    const seqSheet = csSs.getSheetByName('Sequence');
    if (seqSheet) {
      const seqD = seqSheet.getDataRange().getValues();
      for (let i = 0; i < seqD.length; i++) {
        if (String(seqD[i][0]) === 'SERVICE_REVENUE_ACCOUNT') {
          revenueAccount = String(seqD[i][1] || revenueAccount);
          break;
        }
      }
    }
  } catch (e) {
    warnings.push('Error loading Central Settings: ' + e.message);
  }

  // ── 3. Load Central Journal Lines: headers + Accounts sheet ─────────────
  const jlSsId = '1e7ixGvLABB8iRZBwASqWILL9DG4jpVxBYuOoeIv4tvE';
  let journalHeaders = [];
  const accountsMap  = {};  // lowercase account name → canonical name
  try {
    const jlSs = SpreadsheetApp.openById(jlSsId);

    // JournalLines headers (first sheet)
    const jlSheet = jlSs.getSheets()[0];
    journalHeaders = jlSheet.getRange(1, 1, 1, Math.max(jlSheet.getLastColumn(), 1)).getValues()[0]
      .map(h => h.toString().trim());

    // Accounts sheet — build a lookup map by Account Name
    const accSheet = jlSs.getSheetByName('Accounts');
    if (accSheet) {
      const accData = accSheet.getDataRange().getValues();
      const accH = accData[0].map(h => h.toString().toLowerCase().trim());
      const accNameCol = accH.findIndex(h => h === 'account name' || h === 'accountname');
      if (accNameCol !== -1) {
        for (let i = 1; i < accData.length; i++) {
          const n = String(accData[i][accNameCol] || '').trim();
          if (n) accountsMap[n.toLowerCase()] = n;
        }
      }
    }
  } catch (e) {
    warnings.push('Could not read Central Journal Lines data: ' + e.message);
  }

  // Resolve account names through Accounts sheet
  const resolveAccount = (name) => accountsMap[name.toLowerCase()] || name;
  const resolvedArAccount      = resolveAccount(arAccount);
  const resolvedRevenueAccount = resolveAccount(revenueAccount);

  // ── 4. Build journal lines dynamically from TaxGroup ────────────────────
  const journalId = 'JE-' + payload.computationId;
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const desc  = 'Billing Statement — ' + compRow.ContactName + ' / ' + compRow.BillingPeriod;

  let arDebit  = gross;   // starts at gross; positive-rate taxes add, negative-rate taxes subtract
  let vatTotal = 0;
  let ewtTotal = 0;
  const taxLines = [];

  if (applicableRateNames.length > 0) {
    for (const rateName of applicableRateNames) {
      const tr = taxRatesMap[rateName];
      if (!tr) { warnings.push('Tax rate "' + rateName + '" not found in TaxRates sheet.'); continue; }
      const absRate = Math.abs(tr.ratePercent);
      const rateAmt = Math.round(gross * absRate / 100 * 100) / 100;  // always 2dp
      const resolvedTaxAccount = resolveAccount(tr.taxAccount);

      if (tr.ratePercent > 0) {
        // e.g. Sales VAT 12% — liability, credit to tax account, increases AR
        vatTotal += rateAmt;
        arDebit  += rateAmt;
        taxLines.push({ account: resolvedTaxAccount, debit: 0, credit: rateAmt, description: desc, type: rateName + ' Credit' });
      } else {
        // e.g. Sales EWT 2% — Withholding Tax Receivable (asset), debit to tax account, net reduces AR
        ewtTotal += rateAmt;
        arDebit  -= rateAmt;
        taxLines.push({ account: resolvedTaxAccount, debit: rateAmt, credit: 0, description: desc, type: rateName + ' Debit' });
      }
    }
  } else {
    // Fallback defaults — 2dp throughout
    const vat = Math.round(gross * 0.12 * 100) / 100;
    const ewt = Math.round(gross * 0.02 * 100) / 100;
    vatTotal = vat;
    ewtTotal = ewt;
    arDebit  = gross + vat - ewt;
    taxLines.push({ account: resolveAccount('Output Tax'),         debit: 0,   credit: vat, description: desc, type: 'Sales VAT Credit' });
    taxLines.push({ account: resolveAccount('Deferred Tax Asset'), debit: ewt, credit: 0,   description: desc, type: 'Sales EWT 2% Debit' });
  }

  arDebit = Math.round(arDebit * 100) / 100;

  // Journal entry: DR Accounts Receivable + DR EWT Receivable = CR Revenue + CR Output VAT
  const journalLines = [
    { account: resolvedArAccount || '(AR Account not set)', debit: arDebit, credit: 0,     description: desc, type: 'AR Debit' },
    { account: resolvedRevenueAccount,                       debit: 0,       credit: gross, description: desc, type: 'Revenue Credit' },
    ...taxLines
  ];

  // Auto-balance: absorb any rounding residual into the AR debit line
  const _sumD = Math.round(journalLines.reduce((s, l) => s + Number(l.debit  || 0), 0) * 100) / 100;
  const _sumC = Math.round(journalLines.reduce((s, l) => s + Number(l.credit || 0), 0) * 100) / 100;
  if (_sumD !== _sumC) {
    journalLines[0].debit = Math.round((journalLines[0].debit + (_sumC - _sumD)) * 100) / 100;
  }
  const total = journalLines[0].debit;  // net AR after auto-balance

  // ── 6. Read BILLING SUMMARY display values for HTML preview ──────────────
  let summaryRows = null, summaryError = null, capturedPdfUrl = null;
  try {
    let wsUrl = compRow.WorksheetUrl || compRow.GeneratedUrl || '';
    // Fallback: look up WorksheetUrl from BillingBooks by ContactId
    if (!wsUrl) {
      const booksSheet = ss.getSheetByName('BillingBooks');
      if (booksSheet) {
        const booksData = booksSheet.getDataRange().getValues();
        const bH = booksData[0];
        const wsUrlCol = bH.indexOf('WorksheetUrl');
        const cIdCol   = bH.indexOf('ContactId');
        for (let i = 1; i < booksData.length; i++) {
          if (String(booksData[i][cIdCol]) === String(compRow.ContactId)) {
            wsUrl = booksData[i][wsUrlCol] || '';
            break;
          }
        }
      }
    }
    const wsIdMatch = wsUrl.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (wsIdMatch) {
      const wsSs = SpreadsheetApp.openById(wsIdMatch[1]);
      const sumSheet = wsSs.getSheetByName('BILLING SUMMARY');
      if (sumSheet) {
        summaryRows = sumSheet.getDataRange().getDisplayValues();
        const gid = sumSheet.getSheetId();
        capturedPdfUrl = 'https://docs.google.com/spreadsheets/d/' + wsIdMatch[1] +
          '/export?exportFormat=pdf&format=pdf' +
          '&gid=' + gid +
          '&size=A4&portrait=true' +
          '&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5' +
          '&gridlines=false&sheetnames=false&printtitle=false&fzr=false';
      } else {
        summaryError = 'BILLING SUMMARY sheet not found in worksheet.';
      }
    } else {
      summaryError = 'No worksheet URL found for this computation.';
    }
  } catch (e) {
    summaryError = 'Could not read billing summary: ' + e.message;
  }
  const sig = getCentralSettingsSignatories_();

  return JSON.stringify({
    computationId: compRow.ComputationId,
    contactName:   compRow.ContactName,
    contactId:     compRow.ContactId,
    billingPeriod: compRow.BillingPeriod,
    gross, vat: vatTotal, ewt: ewtTotal, total,
    taxGroupName,
    arAccount:     resolvedArAccount,
    journalId,
    journalDate: today,
    journalLines,
    journalHeaders,
    warnings,
    summaryRows,
    summaryError,
    signatories: sig,
    contactTerms,
    pdfUrl: capturedPdfUrl
  });
}

function createBillingStatementFromComputation(payloadStr) {
  const payload = JSON.parse(payloadStr);
  if (!payload.computationId) throw new Error('computationId is required.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Find the computation row
  const compSheet = ss.getSheetByName('BillingComputations');
  const compData = compSheet.getDataRange().getValues();
  const compHeaders = compData[0];
  let compRow = null, compRowIndex = -1;
  for (let i = 1; i < compData.length; i++) {
    if (String(compData[i][compHeaders.indexOf('ComputationId')]) === String(payload.computationId)) {
      compRow = {};
      compHeaders.forEach((h, j) => { compRow[h] = compData[i][j]; });
      compRowIndex = i + 1;
      break;
    }
  }
  if (!compRow) throw new Error('Computation not found: ' + payload.computationId);
  if (compRow.BillingStatementId) throw new Error('Billing statement already created for this computation: ' + compRow.BillingStatementId);

  // Find the billing book for this contact
  const booksSheet = ss.getSheetByName('BillingBooks');
  const booksData = booksSheet.getDataRange().getValues();
  const bH = booksData[0];
  const bBookIdCol    = bH.indexOf('BookId');
  const bContactIdCol = bH.indexOf('ContactId');

  // Resolve: if ContactId stored on computation is actually a BookId (BOOK-xxx legacy), match directly
  const storedContactId = String(compRow.ContactId || '').trim();
  let bookId = '';
  if (/^BOOK-/i.test(storedContactId)) {
    // Direct BookId match
    for (let i = 1; i < booksData.length; i++) {
      if (String(booksData[i][bBookIdCol]).trim() === storedContactId) {
        bookId = booksData[i][bBookIdCol];
        break;
      }
    }
  }
  if (!bookId) {
    // Normal ContactId match
    for (let i = 1; i < booksData.length; i++) {
      if (String(booksData[i][bContactIdCol]) === storedContactId) {
        bookId = booksData[i][bBookIdCol];
        break;
      }
    }
  }
  if (!bookId) throw new Error('No billing book found for contact: ' + storedContactId);

  // Compute amounts — prefer values from payload (pre-validated in prepareBillingStatementReview)
  // to ensure tax amounts match the journal lines the user reviewed.
  const gross = payload.gross !== undefined
    ? Math.round(Number(payload.gross)  * 100) / 100
    : Math.round(Number(compRow.GrandTotal) * 100) / 100;
  const vat   = payload.vat   !== undefined ? Math.round(Number(payload.vat)   * 100) / 100 : Math.round(gross * 0.12 * 100) / 100;
  const ewt   = payload.ewt   !== undefined ? Math.round(Number(payload.ewt)   * 100000) / 100000 : Math.round(gross * 0.02 * 100000) / 100000;
  const total = payload.total !== undefined ? Math.round(Number(payload.total) * 100) / 100 : Math.round((gross + vat - ewt) * 100) / 100;

  const statementId = 'BS-' + Date.now();
  const trnxSheet = ss.getSheetByName('BillingBookTrnx');
  if (!trnxSheet) throw new Error('BillingBookTrnx sheet not found.');
  trnxSheet.appendRow([
    statementId, bookId, new Date().toISOString(), 'billing',
    compRow.BillingPeriod, gross, vat, ewt, total, 0, total, 'Pending'
  ]);

  // Write journal lines to Central Journal Lines → JournalLines sheet
  const journalLines = Array.isArray(payload.journalLines) ? payload.journalLines : [];
  if (journalLines.length > 0) {
    try {
      // ── Pre-lookup 1: Cost Center from Central Settings Contacts ───────
      let costCenter = '';
      try {
        const csSs = SpreadsheetApp.openById('1TueoeHavaK4lrNuWiZN_2TqcyoVev-3Ma-d3HEGGvdk');
        const cSheet = csSs.getSheetByName('Contacts');
        if (cSheet) {
          const cData = cSheet.getDataRange().getValues();
          const cH    = cData[0].map(h => h.toString().toLowerCase().trim());
          const cIdCol = cH.findIndex(h => h === 'contactid');
          const ccCol  = cH.findIndex(h => h === 'cost center');
          if (cIdCol !== -1 && ccCol !== -1) {
            for (let i = 1; i < cData.length; i++) {
              if (String(cData[i][cIdCol]) === String(compRow.ContactId)) {
                costCenter = String(cData[i][ccCol] || '').trim();
                break;
              }
            }
          }
        }
      } catch (e) { Logger.log('Cost center lookup failed: ' + e.message); }

      // ── Pre-lookup 2: account_code map from Accounts sheet ────────────
      const accountCodeMap = {};  // lower(account_name) → account_code
      const jlSs = SpreadsheetApp.openById('1e7ixGvLABB8iRZBwASqWILL9DG4jpVxBYuOoeIv4tvE');
      try {
        const accSheet = jlSs.getSheetByName('Accounts');
        if (accSheet) {
          const accData = accSheet.getDataRange().getValues();
          const aH = accData[0].map(h => h.toString().toLowerCase().trim());
          // Accept both "account code" (space, as in the sheet) and legacy underscore/compact variants
          const aCodeCol = aH.findIndex(h => h === 'account code' || h === 'account_code' || h === 'code' || h === 'accountcode');
          const aNameCol = aH.findIndex(h => h === 'account name' || h === 'account_name' || h === 'name' || h === 'accountname');
          if (aCodeCol !== -1 && aNameCol !== -1) {
            for (let i = 1; i < accData.length; i++) {
              const name = String(accData[i][aNameCol] || '').toLowerCase().trim();
              if (name) accountCodeMap[name] = String(accData[i][aCodeCol] || '').trim();
            }
          }
        }
      } catch (e) { Logger.log('Account code lookup failed: ' + e.message); }

      // ── Pre-lookup 3: full name of current user from Central Settings Users ──
      let currentUserFullName = Session.getActiveUser().getEmail();
      try {
        const csUsers = SpreadsheetApp.openById('1TueoeHavaK4lrNuWiZN_2TqcyoVev-3Ma-d3HEGGvdk')
                          .getSheetByName('Users');
        if (csUsers) {
          const uData = csUsers.getDataRange().getValues();
          const uH    = uData[0].map(h => h.toString().toLowerCase().trim());
          const uEmailCol = uH.findIndex(h => h === 'email' || h === 'emailaddress' || h === 'email address');
          const uNameCol  = uH.findIndex(h => h === 'full name' || h === 'fullname' || h === 'name' || h === 'username');
          const email = Session.getActiveUser().getEmail().toLowerCase();
          if (uEmailCol !== -1 && uNameCol !== -1) {
            for (let i = 1; i < uData.length; i++) {
              if (String(uData[i][uEmailCol] || '').toLowerCase().trim() === email) {
                const fullName = String(uData[i][uNameCol] || '').trim();
                if (fullName) { currentUserFullName = fullName; break; }
              }
            }
          }
        }
      } catch (e) { Logger.log('User full name lookup failed: ' + e.message); }

      // ── Write to JournalLines sheet ───────────────────────────────────
      // Columns (exact order):
      // DocumentID | journal_entry_id | line_number | account_code | account_name |
      // description | contact_name | class | debit | credit |
      // created_at | created_by | updated_by | updated_at | posted_by | posted_at
      const jlSheet = jlSs.getSheetByName('JournalLines');
      if (!jlSheet) throw new Error('JournalLines sheet not found in Central Journal Lines spreadsheet.');

      const nowDate     = new Date();
      const nowFormatted = Utilities.formatDate(nowDate, Session.getScriptTimeZone(), 'MM/dd/yyyy');
      const journalId   = payload.journalId || ('JE-' + statementId);

      journalLines.forEach((line, lineIdx) => {
        const accountName = (line.account || '').trim();
        const accountCode = accountCodeMap[accountName.toLowerCase()] || '';
        jlSheet.appendRow([
          statementId,                // DocumentID
          journalId,                  // journal_entry_id
          lineIdx + 1,                // line_number
          accountCode,                // account_code
          accountName,                // account_name
          line.description || '',     // description
          compRow.ContactName || '',  // contact_name
          costCenter,                 // class (Cost Center)
          line.debit  || 0,           // debit
          line.credit || 0,           // credit
          nowFormatted,               // created_at (mm/dd/yyyy)
          currentUserFullName,        // created_by (full name)
          currentUserFullName,        // updated_by (full name)
          nowFormatted,               // updated_at (mm/dd/yyyy)
          '',                         // posted_by
          ''                          // posted_at
        ]);
      });
    } catch (e) {
      Logger.log('Journal lines write failed: ' + e.message);
      // Non-fatal — statement is still created; log and continue
    }
  }

  // Link statement ID back to the computation row
  const bsIdCol = compHeaders.indexOf('BillingStatementId');
  if (bsIdCol !== -1) compSheet.getRange(compRowIndex, bsIdCol + 1).setValue(statementId);

  return JSON.stringify({ statementId, bookId, gross, vat, ewt, total, period: compRow.BillingPeriod, contactId: compRow.ContactId });
}

function deleteComputation(payloadStr) {
  const payload = JSON.parse(payloadStr);
  if (!payload.computationId) throw new Error('computationId is required.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const compSheet = ss.getSheetByName('BillingComputations');
  const compData = compSheet.getDataRange().getValues();
  const cidCol = compData[0].indexOf('ComputationId');
  for (let i = 1; i < compData.length; i++) {
    if (String(compData[i][cidCol]) === String(payload.computationId)) {
      compSheet.deleteRow(i + 1);
      return JSON.stringify({ deleted: true });
    }
  }
  throw new Error('Computation not found: ' + payload.computationId);
}

// -------------------------------------------------------------
// GEMINI AI PROXY — API key stays server-side in Script Properties
// Set key once: PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', '<key>')
// -------------------------------------------------------------
function callGeminiAI(payloadStr) {
  const parsed = JSON.parse(payloadStr);
  if (!parsed.prompt || typeof parsed.prompt !== 'string') return 'Invalid prompt.';

  const prompt = parsed.prompt.substring(0, 10000);
  const systemPrompt = (parsed.systemPrompt || 'You are a professional financial assistant.').substring(0, 1000);

  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) return 'GEMINI_API_KEY not configured. Set it in Script Properties.';

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=' + apiKey;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] }
  };

  let retries = 3, delay = 1000;
  while (retries > 0) {
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify(body), muteHttpExceptions: true
      });
      const data = JSON.parse(response.getContentText());
      return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated.';
    } catch (e) {
      retries--;
      if (retries === 0) return 'Failed to generate content after multiple attempts.';
      Utilities.sleep(delay);
      delay *= 2;
    }
  }
}

// -------------------------------------------------------------
// PHASE 3A: DRAFT BILLING COMPUTATION
// Runs the full transform and (for regional) writes output sheets to
// the dedicated billing worksheet, but does NOT commit to
// BillingComputations or change the upload Status.
// Returns draft data including WorksheetUrl for the review step.
// For XLSX support, enable the Drive API advanced service in the GAS project.
// -------------------------------------------------------------
function draftBillingComputation(payloadStr) {
  const payload = JSON.parse(payloadStr);
  if (!payload.uploadId || payload.serviceFeeRate === undefined) {
    throw new Error('Invalid payload: uploadId and serviceFeeRate are required.');
  }
  const rate = parseFloat(payload.serviceFeeRate);
  if (isNaN(rate) || rate < 0 || rate > 1) {
    throw new Error('serviceFeeRate must be a decimal between 0 and 1 (e.g. 0.15 for 15%).');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const uploadsSheet = ss.getSheetByName('RawBillingUploads');
  const uploadsData = uploadsSheet.getDataRange().getValues();
  const headers = uploadsData[0];

  let uploadRow = null;
  for (let i = 1; i < uploadsData.length; i++) {
    if (String(uploadsData[i][headers.indexOf('UploadId')]) === String(payload.uploadId)) {
      uploadRow = {};
      headers.forEach((h, j) => { uploadRow[h] = uploadsData[i][j]; });
      break;
    }
  }
  if (!uploadRow) throw new Error('Upload record not found: ' + payload.uploadId);
  // Allow reprocessing of already-computed uploads — draft does not commit anything

  const file = DriveApp.getFileById(uploadRow.FileId);
  const mimeType = file.getMimeType();
  const transformConfig = getBillingTransformConfig_(uploadRow.ContactName);
  const autoMethod = transformConfig ? (transformConfig.method || 'default') : 'default';
  // Allow an explicit override from the UI; 'auto' or absent falls back to BillingTransformConfigs lookup
  const transformMethod = (payload.transformMethod && payload.transformMethod !== 'auto')
    ? payload.transformMethod
    : autoMethod;
  const computationId = 'COMP-' + Date.now();

  let computedTotal = 0, dataRowCount = 0, worksheetUrl = null, worksheetEmbedUrl = null;

  // ── TRANSFORM: multi-sheet payroll transform via processTransform_ ───────
  if (mimeType === 'text/csv' || mimeType === 'text/plain') {
    throw new Error('Billing transform requires an XLSX file or Google Sheet, not a CSV.');
  }
  // If the file is already a Google Spreadsheet, read it directly via SpreadsheetApp
  // instead of re-importing through Drive (avoids "Illegal spreadsheet id" errors).
  const allSheetData = (mimeType === 'application/vnd.google-apps.spreadsheet')
    ? parseGoogleSheetsToAllSheets_(uploadRow.FileId)
    : parseXlsxToAllSheets_(file);
  const worksheetSs = getOrCreateBillingWorksheet_(uploadRow.ContactId, uploadRow.ContactName);
  const billingOptions = {
    taxGroupName:    payload.taxGroupName    || '',
    thirteenthBasis: payload.thirteenthBasis || 'regular',
    transformParams: payload.transformParams  || null,
    billingDate:     payload.billingDate      || ''
  };
  const result = processTransform_(allSheetData, rate, uploadRow, worksheetSs, computationId, billingOptions);
  computedTotal = result.grandTotal;
  dataRowCount = result.employeeCount;
  worksheetUrl = worksheetSs.getUrl();
  // Rename the Drive file to include the computation ID for easy reference
  DriveApp.getFileById(worksheetSs.getId())
    .setName('Billing Worksheet - ' + uploadRow.ContactName + ' [' + computationId + ']');
  const compSheetRef = worksheetSs.getSheetByName('BILLING COMPUTATION');
  const gid = compSheetRef ? compSheetRef.getSheetId() : 0;
  worksheetEmbedUrl = 'https://docs.google.com/spreadsheets/d/' + worksheetSs.getId() + '/htmlview?gid=' + gid + '&rm=minimal';

  // Return draft data — NOT yet committed to BillingComputations
  return JSON.stringify({
    ComputationId: computationId,
    UploadId: uploadRow.UploadId,
    ContactId: uploadRow.ContactId,
    ContactName: uploadRow.ContactName,
    BillingPeriod: uploadRow.BillingPeriod,
    RowCount: dataRowCount,
    GrandTotal: computedTotal,
    ServiceFeeRate: rate,
    TaxGroupName: payload.taxGroupName || '',
    ThirteenthBasis: payload.thirteenthBasis || 'regular',
    TransformMethod: transformMethod,
    WorksheetUrl: worksheetUrl,
    WorksheetEmbedUrl: worksheetEmbedUrl,
    Status: 'Draft'
  });
}

// -------------------------------------------------------------
// PHASE 3B: FINALIZE BILLING COMPUTATION
// Called after the user reviews the draft. Commits to
// BillingComputations and flips the upload Status to 'Computed'.
// -------------------------------------------------------------
function finalizeBillingComputation(payloadStr) {
  const payload = JSON.parse(payloadStr);
  const required = ['computationId', 'uploadId', 'grandTotal', 'rowCount', 'serviceFeeRate', 'transformMethod'];
  for (const k of required) {
    if (payload[k] === undefined) throw new Error('Missing required field: ' + k);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const uploadsSheet = ss.getSheetByName('RawBillingUploads');
  const uploadsData = uploadsSheet.getDataRange().getValues();
  const headers = uploadsData[0];

  let uploadRow = null, uploadRowIndex = -1;
  for (let i = 1; i < uploadsData.length; i++) {
    if (String(uploadsData[i][headers.indexOf('UploadId')]) === String(payload.uploadId)) {
      uploadRow = {};
      headers.forEach((h, j) => { uploadRow[h] = uploadsData[i][j]; });
      uploadRowIndex = i + 1;
      break;
    }
  }
  if (!uploadRow) throw new Error('Upload record not found: ' + payload.uploadId);
  // Reprocessing is allowed — a new computation row is appended with a fresh ComputationId

  // Commit to BillingComputations (dynamic column mapping to handle existing sheets without TaxGroupName)
  const compSheet = ss.getSheetByName('BillingComputations');
  const compSheetHeaders = compSheet.getRange(1, 1, 1, compSheet.getLastColumn()).getValues()[0];
  // If TaxGroupName column missing (existing sheet), append it now
  if (!compSheetHeaders.includes('TaxGroupName')) {
    compSheet.getRange(1, compSheet.getLastColumn() + 1).setValue('TaxGroupName');
    compSheetHeaders.push('TaxGroupName');
  }
  const newCompRow = new Array(compSheetHeaders.length).fill('');
  const setCol = (name, val) => { const i = compSheetHeaders.indexOf(name); if (i !== -1) newCompRow[i] = val; };
  setCol('ComputationId',    payload.computationId);
  setCol('UploadId',         uploadRow.UploadId);
  setCol('BillingStatementId', '');
  setCol('ContactId',        uploadRow.ContactId);
  setCol('ContactName',      uploadRow.ContactName);
  setCol('BillingPeriod',    uploadRow.BillingPeriod);
  setCol('ServiceFeeRate',   payload.serviceFeeRate);
  setCol('TaxGroupName',     payload.taxGroupName || '');
  setCol('TransformMethod',  payload.transformMethod);
  setCol('RowCount',         payload.rowCount);
  setCol('GrandTotal',       payload.grandTotal);
  setCol('FileId',           uploadRow.FileId);
  setCol('FileUrl',          uploadRow.FileUrl);
  setCol('WorksheetUrl',     payload.worksheetUrl || '');
  setCol('Status',           'Computed');
  setCol('ProcessedAt',      new Date().toISOString());
  setCol('ProcessedBy',      Session.getActiveUser().getEmail());
  compSheet.appendRow(newCompRow);

  // Flip upload status to Computed
  uploadsSheet.getRange(uploadRowIndex, headers.indexOf('Status') + 1).setValue('Computed');
  uploadsSheet.getRange(uploadRowIndex, headers.indexOf('ComputationId') + 1).setValue(payload.computationId);

  return JSON.stringify({
    ComputationId: payload.computationId,
    UploadId: uploadRow.UploadId,
    ContactId: uploadRow.ContactId,
    ContactName: uploadRow.ContactName,
    BillingPeriod: uploadRow.BillingPeriod,
    RowCount: payload.rowCount,
    GrandTotal: payload.grandTotal,
    ServiceFeeRate: payload.serviceFeeRate,
    WorksheetUrl: payload.worksheetUrl || '',
    Status: 'Computed',
    ProcessedAt: new Date().toISOString()
  });
}

function getCentralSettingsSignatories_() {
  try {
    const cs = SpreadsheetApp.openById('1TueoeHavaK4lrNuWiZN_2TqcyoVev-3Ma-d3HEGGvdk');

    // Prepared by: match current user email in Users sheet (col A=Email, col B=Full Name)
    const usersSheet = cs.getSheetByName('Users');
    const usersData  = usersSheet ? usersSheet.getDataRange().getValues() : [];
    const currentEmail = Session.getActiveUser().getEmail().toLowerCase();
    let preparerName = '', preparerRole = 'Billing and Collection';
    for (let i = 1; i < usersData.length; i++) {
      if ((usersData[i][0] || '').toString().toLowerCase() === currentEmail) {
        preparerName = usersData[i][1] || '';
        break;
      }
    }

    // Reviewer / Approver: Sequence sheet key-value pairs (col A=Key, col B=Value)
    const seqSheet = cs.getSheetByName('Sequence');
    const seqData  = seqSheet ? seqSheet.getDataRange().getValues() : [];
    let reviewerName = '', approverName = '';
    for (let i = 0; i < seqData.length; i++) {
      if (seqData[i][0] === 'REVIEWER_NAME') reviewerName = seqData[i][1] || '';
      if (seqData[i][0] === 'APPROVER_NAME') approverName = seqData[i][1] || '';
    }

    return { preparerName, preparerRole, reviewerName, approverName };
  } catch (e) {
    Logger.log('getCentralSettingsSignatories_ error: ' + e.message);
    return { preparerName: '', preparerRole: 'Billing and Collection', reviewerName: '', approverName: '' };
  }
}

function getBillingTransformConfig_(contactName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('BillingTransformConfigs');
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === contactName) {
      return { method: data[i][1], aliases: data[i][2], notes: data[i][3] };
    }
  }
  return null;
}

function findTotalColumn_(headerRow, transformConfig) {
  // Check column aliases from BillingTransformConfigs first
  if (transformConfig && transformConfig.aliases) {
    try {
      const aliases = JSON.parse(transformConfig.aliases);
      if (aliases.total !== undefined) {
        const idx = headerRow.findIndex(h => String(h).toLowerCase() === String(aliases.total).toLowerCase());
        if (idx !== -1) return idx;
      }
    } catch (e) { /* ignore malformed JSON aliases */ }
  }
  // Fallback: scan header names for common total-related keywords
  const keywords = ['total', 'amount', 'gross', 'fee', 'charge'];
  for (let i = headerRow.length - 1; i >= 0; i--) {
    if (keywords.some(k => String(headerRow[i]).toLowerCase().includes(k))) return i;
  }
  return headerRow.length - 1; // Last column as last resort
}

function parseXlsxToRows_(file) {
  // Single-sheet parse used by the default keyword-total transform path.
  // Requires the Drive advanced service (Drive API v2) to be enabled in the GAS project.
  // Guard: if the file is already a Google Spreadsheet, read it directly.
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    const ss = SpreadsheetApp.openById(file.getId());
    return ss.getSheets()[0].getDataRange().getValues();
  }
  const resource = { title: 'temp_billing_parse_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS };
  const importedFile = Drive.Files.insert(resource, file.getBlob(), { convert: true });
  // Allow Drive time to complete the async XLSX → Google Sheets conversion.
  Utilities.sleep(3000);
  if (!importedFile || !importedFile.id || importedFile.mimeType !== MimeType.GOOGLE_SHEETS) {
    if (importedFile && importedFile.id) {
      try { DriveApp.getFileById(importedFile.id).setTrashed(true); } catch(e) {}
    }
    throw new Error('Drive could not convert the billing file to a Google Spreadsheet. Please re-upload the file as a valid .xlsx.');
  }
  try {
    const tempSs = SpreadsheetApp.openById(importedFile.id);
    return tempSs.getSheets()[0].getDataRange().getValues();
  } finally {
    DriveApp.getFileById(importedFile.id).setTrashed(true);
  }
}

function parseXlsxToAllSheets_(file) {
  // Multi-sheet parse used by the Regional transform path.
  // Returns an object keyed by tab name: { sheetName: rows[][] }
  // Requires the Drive advanced service (Drive API v2) to be enabled in the GAS project.
  // Guard: if the file is already a Google Spreadsheet, read it directly.
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    return parseGoogleSheetsToAllSheets_(file.getId());
  }
  const resource = { title: 'temp_billing_parse_' + Date.now(), mimeType: MimeType.GOOGLE_SHEETS };
  const importedFile = Drive.Files.insert(resource, file.getBlob(), { convert: true });
  // Allow Drive time to complete the async XLSX → Google Sheets conversion.
  Utilities.sleep(3000);
  if (!importedFile || !importedFile.id || importedFile.mimeType !== MimeType.GOOGLE_SHEETS) {
    if (importedFile && importedFile.id) {
      try { DriveApp.getFileById(importedFile.id).setTrashed(true); } catch(e) {}
    }
    throw new Error('Drive could not convert the billing file to a Google Spreadsheet. Please re-upload the file as a valid .xlsx.');
  }
  try {
    const tempSs = SpreadsheetApp.openById(importedFile.id);
    const result = {};
    tempSs.getSheets().forEach(s => {
      result[s.getName()] = s.getDataRange().getValues();
    });
    return result;
  } finally {
    DriveApp.getFileById(importedFile.id).setTrashed(true);
  }
}

function parseGoogleSheetsToAllSheets_(spreadsheetId) {
  // Reads a pushed billing Google Spreadsheet by ID.
  // Returns { sheetName: rows[][] } for all data tabs, excluding billing output sheets.
  const sheetsToExclude = [
    'BILLING COMPUTATION', 'BILLING SUMMARY', 'Summary',
    'Employee_Masterlist', 'Raw_Billing'
  ];
  const targetSs = SpreadsheetApp.openById(spreadsheetId);
  const result = {};
  targetSs.getSheets().forEach(function(s) {
    if (sheetsToExclude.indexOf(s.getName()) === -1) {
      result[s.getName()] = s.getDataRange().getValues();
    }
  });
  return result;
}

// =============================================================
// REGIONAL BILLING TRANSFORM — private helpers
// Adapted from regional_billing.js standalone script.
// These functions are only invoked when BillingTransformConfigs
// has TransformMethod = 'regional' for the given contact.
// =============================================================

/**
 * Converts a 0-based column index to a spreadsheet column letter (A, B, ... Z, AA, ...).
 */
function getColLetter_(colIndex) {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Processes multi-sheet XLSX payroll data using the Regional 40-column transform.
 * Extracts employee rows from each regional sheet, computes all pay components,
 * writes BILLING COMPUTATION and BILLING SUMMARY sheets to `ss`, and returns
 * { grandTotal, employeeCount } for logging to BillingComputations.
 *
 * @param {Object}  allSheetData   Result of parseXlsxToAllSheets_: { sheetName: rows[][] }
 * @param {number}  rate           Service fee as a decimal (e.g. 0.12)
 * @param {Object}  uploadRow      The RawBillingUploads record object
 * @param {Object}  ss             The active spreadsheet (SpreadsheetApp.getActiveSpreadsheet())
 * @param {string}  computationId  The COMP-xxx ID generated in processRawBillingFile
 * @returns {{ grandTotal: number, employeeCount: number }}
 */
function processTransform_(allSheetData, rate, uploadRow, ss, computationId, options) {
  options = options || {};

  // ── Pull transform parameters ────────────────────────────────────────────
  const tp           = options.transformParams || {};
  const tpC          = tp.Computation   || {};
  const tpS          = tp.SummarySheet  || {};
  const extraCols    = Array.isArray(tpC.extraColumns) ? tpC.extraColumns : [];
  const separatedPer = (tpC.separatedPer  || 'N/A').toString().trim();
  const subtotalPer  = (tpC.subtotalPer   || 'N/A').toString().trim();

  // ── Column aliases ────────────────────────────────────────────────────────
  // Maps a param key to the raw source column names to check (in priority order)
  const COL_ALIASES = {
    'work region':   ['work region', 'workregion', 'region'],
    'work location': ['work location', 'worklocation'],
    'branch':        ['branch', 'branch name', 'branchname'],
    'department':    ['department', 'dept'],
    'position':      ['position', 'job title', 'jobtitle', 'job_title']
  };

  // ── Build the output column header list ──────────────────────────────────
  // Base payroll columns (always present)
  const BASE_HEADERS = [
    'Name', 'Daily Rate', 'Days', 'Regular', 'Lates', 'Lates Amount',
    'Total Basic Salary', 'Overtime Hrs', 'Overtime', 'DOD Hrs', 'DOD',
    'DOD OT Hrs', 'DOD OT', 'Spl Holiday Hrs', 'Spl Holiday',
    'Spl Holiday OT Hrs', 'Spl Holiday OT', 'Spl Holiday DOD Hrs',
    'Spl Holiday DOD', 'Spl Holiday DOD OT Hrs', 'Spl Holiday DOD OT',
    'Legal Holiday Hrs', 'Legal Holiday', 'Legal Holiday OT Hrs',
    'Legal Holiday OT', 'Legal Holiday DOD Hrs', 'Legal Holiday DOD',
    'Legal Holiday DOD OT Hrs', 'Legal Holiday DOD OT', 'Night Diff Hrs',
    'Night Diff', 'Adjustment', 'Allowances', 'SSS', 'Pagibig',
    'Philhealth', '13th Month Pay', 'Subtotal', 'Service Fee', 'Total'
  ];

  // Extra columns are inserted right after 'Name' (index 0)
  const extraColLabels = extraCols.slice(0, 2).map(c => c.toString().trim());
  const regionalHeaders = [
    BASE_HEADERS[0],
    ...extraColLabels,
    ...BASE_HEADERS.slice(1)
  ];

  const numCols = regionalHeaders.length;
  const colMap = {};
  regionalHeaders.forEach((h, i) => { colMap[h.toLowerCase().trim()] = i; });

  const sheetsToExclude = [
    'BILLING COMPUTATION', 'BILLING SUMMARY', 'Summary',
    'Employee_Masterlist', 'Raw_Billing'
  ];

  // separationGroups[sepValue][subValue] = [empRow, empRow, ...]
  // When separatedPer = 'N/A', all employees land under the key '__ALL__'
  // When subtotalPer  = 'N/A', all employees land under the sub-key '__ALL__'
  const separationGroups = {};
  let totalEmployees = 0;
  let grandTotal = 0;

  const n = (v) => { const p = parseFloat(v); return isNaN(p) ? 0 : p; };

  for (const sheetName of Object.keys(allSheetData)) {
    if (sheetsToExclude.indexOf(sheetName) !== -1) continue;
    const data = allSheetData[sheetName];
    if (!data || data.length <= 1) continue;

    const rawHeaders = data[0];
    const rawColMap = {};
    rawHeaders.forEach((h, idx) => { rawColMap[h.toString().toLowerCase().trim()] = idx; });

    const getRaw = (row, possibleNames) => {
      for (const name of possibleNames) {
        if (rawColMap[name] !== undefined) return row[rawColMap[name]];
      }
      return '';
    };

    const getColVal = (row, paramKey) => {
      if (paramKey === 'N/A') return '__ALL__';
      const aliases = COL_ALIASES[paramKey.toLowerCase()] || [paramKey.toLowerCase()];
      // Also try sheet name as fallback for work location / work region
      const val = getRaw(row, aliases);
      if (val !== undefined && val !== null && val.toString().trim() !== '') {
        return val.toString().trim();
      }
      // Fallback for work location / work region: use sheet name
      if (paramKey.toLowerCase() === 'work location' || paramKey.toLowerCase() === 'work region') return sheetName;
      return 'Unknown';
    };

    const cleanVal = (val) => {
      if (typeof val === 'string') {
        const scrubbed = val.replace(/\b(days|mins|hrs)\b/gi, '').trim();
        return (scrubbed !== '' && !isNaN(scrubbed)) ? Number(scrubbed) : scrubbed;
      }
      return val;
    };

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      const nameVal = getRaw(row, ['name']) || row[0];
      if (!nameVal || nameVal.toString().trim().toLowerCase().includes('total')) continue;

      // Determine separation + subtotal keys
      const sepKey = getColVal(row, separatedPer);
      const subKey = getColVal(row, subtotalPer);

      if (!separationGroups[sepKey]) separationGroups[sepKey] = {};
      if (!separationGroups[sepKey][subKey]) separationGroups[sepKey][subKey] = [];

      // Build output row (extra cols inserted after Name)
      const empData = new Array(numCols).fill('');
      // Name (index 0)
      empData[0] = cleanVal(getRaw(row, ['name']) || row[0]);
      // Extra columns (indices 1..extraColLabels.length)
      extraColLabels.forEach((label, ei) => {
        const aliases = COL_ALIASES[label.toLowerCase()] || [label.toLowerCase()];
        empData[1 + ei] = cleanVal(getRaw(row, aliases));
      });
      // Base columns (shifted by extraColLabels.length)
      const offset = extraColLabels.length;
      BASE_HEADERS.slice(1).forEach((header, bi) => {
        const cleanH = header.toLowerCase().trim();
        const possibleNames = [cleanH];
        if (cleanH === 'allowances')     possibleNames.push('transpo allowance', 'allowance');
        if (cleanH === 'adjustment')     possibleNames.push('adjustments');
        if (cleanH === 'pagibig')        possibleNames.push('pag-ibig');
        if (cleanH === '13th month pay') possibleNames.push('13th month');
        empData[1 + offset + bi] = cleanVal(getRaw(row, possibleNames));
      });

      // Compute numeric grand total contribution
      const dr        = n(empData[colMap['daily rate']]);
      const days      = n(empData[colMap['days']]);
      const lates     = n(empData[colMap['lates']]);
      const regular   = dr * days;
      const latesAmt  = -(dr / 8 / 60 * lates);
      const tbs       = regular + latesAmt;
      const ot        = dr / 8 * 1.25 * n(empData[colMap['overtime hrs']]);
      const dod       = dr / 8 * 1.3  * n(empData[colMap['dod hrs']]);
      const dodOt     = dr / 8 * 1.69 * n(empData[colMap['dod ot hrs']]);
      const splHol    = dr / 8 * 0.3  * n(empData[colMap['spl holiday hrs']]);
      const splHolOt  = dr / 8 * 0.44 * n(empData[colMap['spl holiday ot hrs']]);
      const splHolDod    = n(empData[colMap['spl holiday dod']]);
      const splHolDodOt  = n(empData[colMap['spl holiday dod ot']]);
      const legalHol     = n(empData[colMap['legal holiday']]);
      const legalHolOt   = n(empData[colMap['legal holiday ot']]);
      const legalHolDod  = n(empData[colMap['legal holiday dod']]);
      const legalHolDodOt = n(empData[colMap['legal holiday dod ot']]);
      const nightDiff = dr / 8 * 0.1 * n(empData[colMap['night diff hrs']]);
      const adj       = n(empData[colMap['adjustment']]);
      const allow     = n(empData[colMap['allowances']]);
      const sss       = n(empData[colMap['sss']]);
      const pagibig   = n(empData[colMap['pagibig']]);
      const phil      = n(empData[colMap['philhealth']]);
      const thirteenth = options.thirteenthBasis === 'tbs' ? tbs / 12 : regular / 12;

      const subtotal = tbs + ot + dod + dodOt + splHol + splHolOt +
                       splHolDod + splHolDodOt + legalHol + legalHolOt +
                       legalHolDod + legalHolDodOt + nightDiff +
                       adj + allow + sss + pagibig + phil + thirteenth;
      const serviceFee = Math.round(subtotal * rate * 100) / 100;
      const total = subtotal + serviceFee;

      grandTotal += total;
      separationGroups[sepKey][subKey].push(empData);
      totalEmployees++;
    }
  }

  // Write the visual output sheets (BILLING COMPUTATION(s) + BILLING SUMMARY(ies))
  buildRegionalBillingSheets_(ss, separationGroups, regionalHeaders, colMap, rate, uploadRow, computationId, grandTotal, options);

  return { grandTotal: grandTotal, employeeCount: totalEmployees };
}

/**
 * Writes BILLING COMPUTATION (40-col per-employee grid with region groups and totals)
 * and BILLING SUMMARY (cover sheet with VAT / EWT / net payable) to the billing
 * spreadsheet. Sheet content mirrors the regional_billing.js standalone output.
 */
function buildRegionalBillingSheets_(ss, separationGroups, regionalHeaders, colMap, rate, uploadRow, computationId, grandTotal, options) {
  options = options || {};
  const numCols = regionalHeaders.length;
  const clientName    = uploadRow.ContactName || '';
  const billingPeriod = uploadRow.BillingPeriod || '';
  const controlNo     = computationId;

  // ── Transform params ──────────────────────────────────────────────────────
  const tp           = options.transformParams || {};
  const tpC          = tp.Computation  || {};
  const tpS          = tp.SummarySheet || {};
  const separatedPer  = (tpC.separatedPer  || 'N/A').toString().trim();
  const subtotalPer   = (tpC.subtotalPer   || 'N/A').toString().trim();
  const summarizeBottom        = !!tpC.summarizeBottom;
  const createGrandComputation = !!tpC.createGrandComputation;
  const createSummary     = !!tpS.createSummary;
  const summarizePer      = (tpS.summarizePer || 'per_computation').toString().trim();
  const createGrandSummary = !!tpS.createGrandSummary;

  // ── Billing mode flags ────────────────────────────────────────────────────
  const _txn            = (options.taxGroupName || '').trim();
  const isNonTaxable    = _txn.toUpperCase() === 'N/A';
  const _rateList       = _txn.toLowerCase().split(',').map(r => r.trim()).filter(Boolean);
  const _looksLikeRates = _rateList.some(r => r.includes('vat') || r.includes('ewt'));
  const hasEwt          = !isNonTaxable && (!_looksLikeRates || _rateList.some(r => r.includes('ewt')));

  // ── Columns used in subtotals / formulas ─────────────────────────────────
  const targetColsForSubtotal = [
    'total basic salary', 'overtime', 'dod', 'dod ot',
    'spl holiday', 'spl holiday ot', 'spl holiday dod', 'spl holiday dod ot',
    'legal holiday', 'legal holiday ot', 'legal holiday dod', 'legal holiday dod ot',
    'night diff', 'adjustment', 'allowances', 'sss', 'pagibig', 'philhealth', '13th month pay'
  ];
  const formulaCols = [
    'regular', 'lates amount', 'total basic salary', 'overtime', 'dod', 'dod ot',
    'spl holiday', 'spl holiday ot', 'night diff', '13th month pay',
    'subtotal', 'service fee', 'total'
  ];
  const formulaColIndices = formulaCols
    .map(name => colMap[name])
    .filter(idx => idx !== undefined);

  // ── Helper: write formula cells for one employee row ─────────────────────
  const writeEmpFormulas = (empRow, rowNum, thirteenthBasis) => {
    const cellRef = (colName) => {
      const idx = colMap[colName];
      return idx !== undefined ? getColLetter_(idx) + rowNum : null;
    };
    const dr = cellRef('daily rate');
    if (colMap['regular'] !== undefined && dr && cellRef('days'))
      empRow[colMap['regular']] = '=' + dr + '*' + cellRef('days');
    if (colMap['lates amount'] !== undefined && dr && cellRef('lates'))
      empRow[colMap['lates amount']] = '=-(' + dr + '/8/60*' + cellRef('lates') + ')';
    if (colMap['total basic salary'] !== undefined)
      empRow[colMap['total basic salary']] = '=' + cellRef('regular') + '+' + cellRef('lates amount');
    if (colMap['overtime'] !== undefined && dr && cellRef('overtime hrs'))
      empRow[colMap['overtime']] = '=' + dr + '/8*1.25*' + cellRef('overtime hrs');
    if (colMap['dod'] !== undefined && dr && cellRef('dod hrs'))
      empRow[colMap['dod']] = '=' + dr + '/8*1.3*' + cellRef('dod hrs');
    if (colMap['dod ot'] !== undefined && dr && cellRef('dod ot hrs'))
      empRow[colMap['dod ot']] = '=' + dr + '/8*1.69*' + cellRef('dod ot hrs');
    if (colMap['spl holiday'] !== undefined && dr && cellRef('spl holiday hrs'))
      empRow[colMap['spl holiday']] = '=' + dr + '/8*0.3*' + cellRef('spl holiday hrs');
    if (colMap['spl holiday ot'] !== undefined && dr && cellRef('spl holiday ot hrs'))
      empRow[colMap['spl holiday ot']] = '=' + dr + '/8*0.44*' + cellRef('spl holiday ot hrs');
    if (colMap['night diff'] !== undefined && dr && cellRef('night diff hrs'))
      empRow[colMap['night diff']] = '=' + dr + '/8*0.1*' + cellRef('night diff hrs');
    if (colMap['13th month pay'] !== undefined && cellRef('regular')) {
      const _ref = thirteenthBasis === 'tbs' ? cellRef('total basic salary') : cellRef('regular');
      empRow[colMap['13th month pay']] = '=' + _ref + '/12';
    }
    if (colMap['subtotal'] !== undefined) {
      const parts = targetColsForSubtotal.map(n => cellRef(n)).filter(x => x);
      if (parts.length) empRow[colMap['subtotal']] = '=SUM(' + parts.join(',') + ')';
    }
    if (colMap['service fee'] !== undefined && cellRef('subtotal'))
      empRow[colMap['service fee']] = '=ROUND(' + cellRef('subtotal') + '*' + rate + ',2)';
    if (colMap['total'] !== undefined && cellRef('subtotal') && cellRef('service fee'))
      empRow[colMap['total']] = '=' + cellRef('subtotal') + '+' + cellRef('service fee');
    return empRow;
  };

  // ── Helper: build a SUM total row (subtotal or grand total) ──────────────
  const buildTotalRow = (label, groupRows, startRow, endRow) => {
    const totalRow = new Array(numCols).fill('');
    totalRow[0] = label;
    for (let c = 1; c < numCols; c++) {
      let hasNumber = false;
      if (formulaColIndices.indexOf(c) !== -1) {
        hasNumber = true;
      } else {
        for (let r = 0; r < groupRows.length; r++) {
          if (!isNaN(parseFloat(groupRows[r][c])) && groupRows[r][c] !== '') { hasNumber = true; break; }
        }
      }
      if (hasNumber) {
        const cl = getColLetter_(c);
        totalRow[c] = '=SUM(' + cl + startRow + ':' + cl + endRow + ')';
      }
    }
    return totalRow;
  };

  // ── Helper: build a cross-reference total row (sum of specific rows) ──────
  const buildGrandTotalRow = (label, activeColSet, rowNums) => {
    const row = new Array(numCols).fill('');
    row[0] = label;
    for (const c of activeColSet) {
      const cl = getColLetter_(c);
      row[c] = '=SUM(' + rowNums.map(r => cl + r).join(',') + ')';
    }
    return row;
  };

  // ── Helper: get the set of numeric columns in a group ────────────────────
  const getActiveNumericCols = (groupRows) => {
    const active = new Set();
    for (let c = 1; c < numCols; c++) {
      if (formulaColIndices.indexOf(c) !== -1) { active.add(c); continue; }
      for (let r = 0; r < groupRows.length; r++) {
        if (!isNaN(parseFloat(groupRows[r][c])) && groupRows[r][c] !== '') { active.add(c); break; }
      }
    }
    return active;
  };

  const emptyRow = new Array(numCols).fill('');
  const compTotalColLetter = colMap['total'] !== undefined ? getColLetter_(colMap['total']) : 'AN';

  // ── Determine how many separate Computation sheets to create ─────────────
  // separationGroups keys: each is a Computation sheet name suffix
  // When separatedPer = 'N/A', there is exactly one key '__ALL__'
  const sepKeys = Object.keys(separationGroups);

  // Track all created comp sheet totals for Grand Summary
  // compSheetInfo[i] = { sheetName, grandTotalRowNum, branchTotalRowIndices, regionNames }
  const compSheetInfoList = [];

  // ── Also gather all subtotal group names for per_subtotal Summary ─────────
  // Used to create BILLING SUMMARY sheets per subtotal group when summarizePer === 'per_subtotal'
  // Structure: [{ compSheetName, subKey, totalRowNum, amount_formula }]
  const subTotalInfoList = [];

  // ═══════════════════════════════════════════════════════════════════════════
  // PASS 1 — Build Computation Sheets
  // ═══════════════════════════════════════════════════════════════════════════
  for (const sepKey of sepKeys) {
    const subGroups = separationGroups[sepKey]; // { subKey: [empRow] }
    const compSheetName = separatedPer === 'N/A'
      ? 'BILLING COMPUTATION'
      : 'BILLING COMPUTATION - ' + sepKey;

    // Delete existing sheet, then create fresh
    let compSheet = ss.getSheetByName(compSheetName);
    if (!compSheet) compSheet = ss.insertSheet(compSheetName);
    else { compSheet.clear(); compSheet.clearFormats(); }

    const sheetData = [];

    // Rows 1-10: header block
    sheetData.push(emptyRow.slice());
    const c1 = emptyRow.slice(); c1[0] = clientName; sheetData.push(c1);
    sheetData.push(emptyRow.slice());
    const c2 = emptyRow.slice(); c2[0] = 'Billing ' + billingPeriod; sheetData.push(c2);
    sheetData.push(emptyRow.slice());
    const c3 = emptyRow.slice(); c3[0] = 'Control No.'; c3[1] = controlNo; sheetData.push(c3);
    const c4 = emptyRow.slice(); c4[0] = 'Subtotal:'; sheetData.push(c4);
    const c5 = emptyRow.slice(); c5[0] = 'VAT (12%):'; sheetData.push(c5);
    const c6 = emptyRow.slice(); c6[0] = 'TOTAL'; sheetData.push(c6);
    sheetData.push(emptyRow.slice());

    let currentRow = 11;
    const totalRowsFormatCoords = [];   // all rows that get bold+border formatting
    const subtotalTotalRowNums  = [];   // Total rows per subgroup (for Grand Total SUM)
    const subKeyNames           = [];   // subKey labels in order written
    const activeColsForSheet    = new Set();

    // Iterate sub-groups (subtotalPer groups within this separation sheet)
    const subKeys = Object.keys(subGroups);
    for (const subKey of subKeys) {
      const groupRows = subGroups[subKey];
      if (!groupRows || groupRows.length === 0) continue;

      // If subtotalPer is active, print a group header row
      if (subtotalPer !== 'N/A') {
        const groupHeaderRow = emptyRow.slice();
        groupHeaderRow[0] = subKey;
        sheetData.push(groupHeaderRow);
        sheetData.push(regionalHeaders.slice());
        currentRow += 2;
      } else {
        // No sub-groups: just print the column header once (only for first subKey)
        if (subKeys.indexOf(subKey) === 0) {
          sheetData.push(regionalHeaders.slice());
          currentRow++;
        }
      }

      const startRow = currentRow;
      for (let r = 0; r < groupRows.length; r++) {
        const empRow = writeEmpFormulas(groupRows[r].slice(), currentRow, options.thirteenthBasis);
        sheetData.push(empRow);
        currentRow++;
      }
      const endRow = currentRow - 1;

      // Track active numeric columns across all groups in this sheet
      getActiveNumericCols(groupRows).forEach(c => activeColsForSheet.add(c));

      // Subtotal row (only when subtotalPer is active)
      if (subtotalPer !== 'N/A') {
        const subTotalRow = buildTotalRow('Total', groupRows, startRow, endRow);
        sheetData.push(subTotalRow);
        totalRowsFormatCoords.push(currentRow);
        subtotalTotalRowNums.push(currentRow);
        subKeyNames.push(subKey);

        // Record for per_subtotal summary generation
        if (createSummary && summarizePer === 'per_subtotal') {
          subTotalInfoList.push({
            compSheetName: compSheetName,
            subKey:        subKey,
            totalRowNum:   currentRow,
            colLetter:     compTotalColLetter
          });
        }

        currentRow++;
        sheetData.push(emptyRow.slice());
        sheetData.push(emptyRow.slice());
        currentRow += 2;
      }
    }

    // One Grand Total row (sum of all subtotal rows, or of all data rows when no subtotals)
    let grandTotalRowNum;
    if (subtotalPer !== 'N/A' && subtotalTotalRowNums.length > 0) {
      const gtRow = buildGrandTotalRow('GRAND TOTAL', activeColsForSheet, subtotalTotalRowNums);
      sheetData.push(gtRow);
      totalRowsFormatCoords.push(currentRow);
      grandTotalRowNum = currentRow;
      currentRow++;
    } else {
      // Flat list: one SUM from the first data row to the last
      // We need flat start/end — rows 12..currentRow-1 (after the header at row 11)
      const flatStart = 12;
      const flatEnd   = currentRow - 1;
      const gtRow = buildTotalRow('GRAND TOTAL', [], flatStart, flatEnd);
      // Override: use SUM over all data range since groupRows isn't available here
      // Re-derive from all employees
      const allEmpRows = subKeys.reduce((acc, sk) => acc.concat(subGroups[sk] || []), []);
      const gtRowReal = buildGrandTotalRow('GRAND TOTAL', getActiveNumericCols(allEmpRows),
        Array.from({ length: flatEnd - flatStart + 1 }, (_, i) => flatStart + i));
      sheetData.push(gtRowReal);
      totalRowsFormatCoords.push(currentRow);
      grandTotalRowNum = currentRow;
      currentRow++;
    }

    // Grand Total summary block linkage (rows 7-9)
    if (colMap['total'] !== undefined) {
      const totalColLetter = compTotalColLetter;
      if (isNonTaxable && colMap['subtotal'] !== undefined && colMap['service fee'] !== undefined) {
        const subColLetter = getColLetter_(colMap['subtotal']);
        const sfColLetter  = getColLetter_(colMap['service fee']);
        sheetData[6][0] = 'Services rendered';
        sheetData[6][1] = '=' + subColLetter + grandTotalRowNum;
        sheetData[7][0] = 'Admin Fee';
        sheetData[7][1] = '=' + sfColLetter  + grandTotalRowNum;
        sheetData[8][0] = 'Total Amount Due';
        sheetData[8][1] = '=B7+B8';
      } else {
        sheetData[6][1] = '=' + totalColLetter + grandTotalRowNum;
        sheetData[7][1] = '=B7*0.12';
        sheetData[8][1] = '=B7+B8';
      }
    }

    // Optional: summarize bottom — append a mini-summary block below last row
    if (summarizeBottom) {
      sheetData.push(emptyRow.slice());
      sheetData.push(emptyRow.slice());
      currentRow += 2;
      const sbLabelRow = emptyRow.slice();
      sbLabelRow[0] = 'SUMMARY';
      sheetData.push(sbLabelRow);
      currentRow++;

      // One line: grand total amount
      const sbGrandRow = emptyRow.slice();
      sbGrandRow[0] = 'Grand Total';
      sbGrandRow[1] = '=' + compTotalColLetter + grandTotalRowNum;
      sheetData.push(sbGrandRow);
      currentRow++;
    }

    // Write all rows at once
    compSheet.getRange(1, 1, sheetData.length, numCols).setValues(sheetData);

    // ── Formatting ──────────────────────────────────────────────────────────
    compSheet.getRange('A2:A9').setFontWeight('bold');
    compSheet.getRange('B7:B9').setNumberFormat('#,##0.00');
    compSheet.getRange(11, 2, sheetData.length, numCols - 1).setNumberFormat('#,##0.00');

    // Group headers + column header row formatting
    let fmtRow = 11;
    for (const subKey of subKeys) {
      const groupRows = subGroups[subKey];
      if (!groupRows || groupRows.length === 0) continue;
      if (subtotalPer !== 'N/A') {
        // Group header
        compSheet.getRange(fmtRow, 1, 1, numCols)
          .setFontWeight('bold').setFontSize(11).setBackground('#d9d9d9');
        // Column header
        compSheet.getRange(fmtRow + 1, 1, 1, numCols)
          .setFontWeight('bold').setBackground('#f3f3f3');
        fmtRow += groupRows.length + 5; // header + colHdr + employees + total + 2 spacers
      } else {
        // Column header row (row 11 — only once)
        compSheet.getRange(fmtRow, 1, 1, numCols)
          .setFontWeight('bold').setBackground('#f3f3f3');
        fmtRow += groupRows.length + 1;
      }
    }

    // Total row formatting
    for (const row of totalRowsFormatCoords) {
      const range = compSheet.getRange(row, 1, 1, numCols);
      range.setFontWeight('bold');
      range.setBorder(true, null, null, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID);
      range.setBorder(null, null, true, null, null, null, '#000000', SpreadsheetApp.BorderStyle.DOUBLE);
    }
    compSheet.autoResizeColumns(1, numCols);

    compSheetInfoList.push({
      sheetName:            compSheetName,
      grandTotalRowNum:     grandTotalRowNum,
      subTotalRowNums:      subtotalTotalRowNums,
      subKeyNames:          subKeyNames,
      sepKey:               sepKey
    });
  } // end PASS 1

  // ═══════════════════════════════════════════════════════════════════════════
  // PASS 1.5 — Grand Computation Sheet (one row per separation group, cross-sheet refs)
  // ═══════════════════════════════════════════════════════════════════════════
  if (createGrandComputation && separatedPer !== 'N/A' && compSheetInfoList.length > 1) {
    const grandCompSheetName = 'BILLING COMPUTATION - GRAND';
    let gcSheet = ss.getSheetByName(grandCompSheetName);
    if (!gcSheet) gcSheet = ss.insertSheet(grandCompSheetName);
    else { gcSheet.clear(); gcSheet.clearFormats(); }

    const gcData = [];

    // Rows 1-10: same header block as individual computation sheets
    gcData.push(emptyRow.slice());
    const gc1 = emptyRow.slice(); gc1[0] = clientName; gcData.push(gc1);
    gcData.push(emptyRow.slice());
    const gc2 = emptyRow.slice(); gc2[0] = 'Billing ' + billingPeriod; gcData.push(gc2);
    gcData.push(emptyRow.slice());
    const gc3 = emptyRow.slice(); gc3[0] = 'Control No.'; gc3[1] = controlNo; gcData.push(gc3);
    const gc4 = emptyRow.slice(); gc4[0] = 'Subtotal:'; gcData.push(gc4);
    const gc5 = emptyRow.slice(); gc5[0] = 'VAT (12%):'; gcData.push(gc5);
    const gc6 = emptyRow.slice(); gc6[0] = 'TOTAL'; gcData.push(gc6);
    gcData.push(emptyRow.slice());

    // Row 11: column headers
    gcData.push(regionalHeaders.slice());
    let gcCurrentRow = 12;

    const gcGroupRowNums = [];
    const gcActiveNumericCols = new Set();

    for (const info of compSheetInfoList) {
      const groupRow = emptyRow.slice();
      groupRow[0] = info.sepKey;
      for (const colName of targetColsForSubtotal) {
        const idx = colMap[colName];
        if (idx !== undefined) {
          groupRow[idx] = "='" + info.sheetName + "'!" + getColLetter_(idx) + info.grandTotalRowNum;
          gcActiveNumericCols.add(idx);
        }
      }
      if (colMap['total'] !== undefined) {
        const idx = colMap['total'];
        groupRow[idx] = "='" + info.sheetName + "'!" + compTotalColLetter + info.grandTotalRowNum;
        gcActiveNumericCols.add(idx);
      }
      gcData.push(groupRow);
      gcGroupRowNums.push(gcCurrentRow);
      gcCurrentRow++;
    }

    // Grand total row: SUM across all group rows
    const gcGrandTotalRow = emptyRow.slice();
    gcGrandTotalRow[0] = 'GRAND TOTAL';
    for (const idx of gcActiveNumericCols) {
      const colLetter = getColLetter_(idx);
      gcGrandTotalRow[idx] = '=SUM(' + colLetter + gcGroupRowNums[0] + ':' + colLetter + gcGroupRowNums[gcGroupRowNums.length - 1] + ')';
    }
    gcData.push(gcGrandTotalRow);
    const gcGrandTotalRowNum = gcCurrentRow;

    // Link header block rows 7-9 to the grand total row
    if (colMap['total'] !== undefined) {
      if (isNonTaxable && colMap['subtotal'] !== undefined && colMap['service fee'] !== undefined) {
        gcData[6][0] = 'Services rendered';
        gcData[6][1] = '=' + getColLetter_(colMap['subtotal']) + gcGrandTotalRowNum;
        gcData[7][0] = 'Admin Fee';
        gcData[7][1] = '=' + getColLetter_(colMap['service fee']) + gcGrandTotalRowNum;
        gcData[8][0] = 'Total Amount Due';
        gcData[8][1] = '=B7+B8';
      } else {
        gcData[6][1] = '=' + compTotalColLetter + gcGrandTotalRowNum;
        gcData[7][1] = '=B7*0.12';
        gcData[8][1] = '=B7+B8';
      }
    }

    gcSheet.getRange(1, 1, gcData.length, numCols).setValues(gcData);

    // Formatting
    gcSheet.getRange('A2:A9').setFontWeight('bold');
    gcSheet.getRange('B7:B9').setNumberFormat('#,##0.00');
    gcSheet.getRange(11, 2, gcData.length - 10, numCols - 1).setNumberFormat('#,##0.00');
    // Blue-tinted column header to distinguish from individual sheets
    gcSheet.getRange(11, 1, 1, numCols).setFontWeight('bold').setBackground('#dbeafe');
    // Alternating row background per group
    for (let gi = 0; gi < gcGroupRowNums.length; gi++) {
      gcSheet.getRange(gcGroupRowNums[gi], 1, 1, numCols)
        .setBorder(null, null, true, null, null, null, '#CCCCCC', SpreadsheetApp.BorderStyle.SOLID)
        .setBackground(gi % 2 === 0 ? '#f8fafc' : '#ffffff');
    }
    // Grand total row formatting
    gcSheet.getRange(gcGrandTotalRowNum, 1, 1, numCols)
      .setFontWeight('bold')
      .setBorder(true, null, null, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID)
      .setBorder(null, null, true, null, null, null, '#000000', SpreadsheetApp.BorderStyle.DOUBLE);
    gcSheet.autoResizeColumns(1, numCols);
  } // end PASS 1.5

  // ═══════════════════════════════════════════════════════════════════════════
  // PASS 2 — Build BILLING SUMMARY sheets
  // ═══════════════════════════════════════════════════════════════════════════
  if (!createSummary) {
    // Nothing to do — skip summary generation entirely
  } else {
    // Shared helper to build one summary sheet
    const sig   = getCentralSettingsSignatories_();
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy');
    let contactTerms = '15 days';
    try {
      const csSs   = SpreadsheetApp.openById('1TueoeHavaK4lrNuWiZN_2TqcyoVev-3Ma-d3HEGGvdk');
      const cSheet = csSs.getSheetByName('Contacts');
      if (cSheet) {
        const cData     = cSheet.getDataRange().getValues();
        const cH        = cData[0];
        const cIdCol    = cH.findIndex(h => h.toString().toLowerCase() === 'contactid');
        const cTermsCol = cH.findIndex(h => h.toString().toLowerCase() === 'terms');
        if (cIdCol !== -1 && cTermsCol !== -1) {
          for (let i = 1; i < cData.length; i++) {
            if (String(cData[i][cIdCol]) === String(uploadRow.ContactId)) {
              contactTerms = cData[i][cTermsCol] || '15 days';
              break;
            }
          }
        }
      }
    } catch (e) {
      Logger.log('Terms lookup failed: ' + e.message);
    }

    const buildSummarySheet_ = (summarySheetName, lineItems, grandTotalFormula) => {
      // lineItems: [{ label: string, formula: string }]
      let sumSheet = ss.getSheetByName(summarySheetName);
      if (!sumSheet) sumSheet = ss.insertSheet(summarySheetName);
      else { sumSheet.clear(); sumSheet.clearFormats(); }

      sumSheet.getRange(1, 1, 50 + lineItems.length, 5)
        .setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle');

      try {
        const letterheadBlob = DriveApp.getFileById('1xMyos-Sq0pL99io6DSf3ZnG3HPZ80Khp').getBlob();
        const letterheadImg  = sumSheet.insertImage(letterheadBlob, 1, 1);
        const origH = letterheadImg.getHeight();
        const origW = letterheadImg.getWidth();
        const targetH = 150;
        letterheadImg.setHeight(targetH);
        letterheadImg.setWidth(Math.round(origW * targetH / origH));
      } catch (e) {
        Logger.log('Letterhead insert failed: ' + e.message);
      }

      const e5 = ['', '', '', '', ''];
      const N  = lineItems.length;

      // Row indices
      const svcRendRow   = 19 + N;
      const _totalsCount = (isNonTaxable || !hasEwt) ? 3 : 5;
      const grandTotRow  = svcRendRow + _totalsCount - 1;
      const totalRow     = svcRendRow + 2;
      const ewtRow       = svcRendRow + 3;
      const checkPayRow  = grandTotRow + 2;
      const sigHeaderRow = grandTotRow + 7;
      const sigLineRow   = sigHeaderRow + 1;
      const sigNameRow   = sigHeaderRow + 2;
      const sigRoleRow   = sigHeaderRow + 3;

      const summaryPayload = [
        e5.slice(), e5.slice(), e5.slice(), e5.slice(), e5.slice(), e5.slice(), e5.slice(),
        ['', 'BILLING STATEMENT', '', '', ''],
        e5.slice(),
        ['', 'To:',        clientName,   '', ''],
        ['', 'Date:',      today,        '', ''],
        ['', 'Billing #:', controlNo,    '', ''],
        ['', 'Terms:',     contactTerms, '', ''],
        e5.slice(),
        ['', 'Particulars:', '', '', ''],
        ['', 'Services rendered by employees for the period of ' + billingPeriod, '', '', ''],
        e5.slice(),
      ];

      for (let i = 0; i < N; i++) {
        summaryPayload.push(['', '   ' + lineItems[i].label, lineItems[i].formula, '', '']);
      }

      summaryPayload.push(e5.slice());
      if (isNonTaxable) {
        summaryPayload.push(
          ['', 'Services Rendered', grandTotalFormula, '', ''],
          ['', 'Admin Fee',         '=ROUND(C' + svcRendRow + '*' + rate + ',2)', '', ''],
          ['', 'Total Amount Due',  '=C' + svcRendRow + '+C' + (svcRendRow + 1), '', '']
        );
      } else if (!hasEwt) {
        summaryPayload.push(
          ['', 'Services Rendered', grandTotalFormula, '', ''],
          ['', 'VAT (12%)',         '=ROUND(C' + svcRendRow + '*0.12,2)', '', ''],
          ['', 'GRAND TOTAL',       '=C' + svcRendRow + '+C' + (svcRendRow + 1), '', '']
        );
      } else {
        summaryPayload.push(
          ['', 'Services Rendered', grandTotalFormula, '', ''],
          ['', 'VAT (12%)',         '=ROUND(C' + svcRendRow + '*0.12,2)', '', ''],
          ['', 'Total w/ VAT',      '=C' + svcRendRow + '+C' + (svcRendRow + 1), '', ''],
          ['', 'Less: EWT (2%)',    '=ROUND(C' + svcRendRow + '*0.02,5)', '', ''],
          ['', 'GRAND TOTAL',       '=C' + totalRow + '-C' + ewtRow, '', '']
        );
      }

      summaryPayload.push(
        e5.slice(),
        ['', 'Please make check payable to:', '', '', ''],
        ['', '   Account Name:', 'Workscale Resources Inc.',      '', ''],
        ['', '   Account No.:',  "'002570018928",                 '', ''],
        ['', '   Bank:',         'Unionbank (Greenhills branch)', '', ''],
        e5.slice(),
        ['', 'Prepared by:', 'Reviewed by:', 'Approved by:', ''],
        e5.slice(),
        ['', sig.preparerName, sig.reviewerName, sig.approverName, ''],
        ['', sig.preparerRole, 'Reviewer',       'CFO',           '']
      );

      sumSheet.getRange(1, 1, summaryPayload.length, 5).setValues(summaryPayload);

      // Sheet chrome
      sumSheet.setHiddenGridlines(true);
      sumSheet.setRowHeights(1, 7, 22);
      sumSheet.setRowHeight(8, 32);
      sumSheet.setColumnWidth(1, 25);
      sumSheet.setColumnWidth(2, 240);
      sumSheet.setColumnWidth(3, 170);
      sumSheet.setColumnWidth(4, 160);
      sumSheet.setColumnWidth(5, 160);

      // Typography
      sumSheet.getRange('B8:E8').merge().setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center');
      sumSheet.getRange('B10:B13').setFontWeight('bold').setHorizontalAlignment('left');
      sumSheet.getRange('C10:C13').setHorizontalAlignment('left');
      sumSheet.getRange('B15').setFontWeight('bold').setHorizontalAlignment('left');
      sumSheet.getRange('B16:E16').merge().setHorizontalAlignment('left').setWrap(false);

      if (N > 0) {
        sumSheet.getRange(18, 2, N, 1).setHorizontalAlignment('left').setFontColor('#555555');
        sumSheet.getRange(18, 3, N, 1).setHorizontalAlignment('right').setNumberFormat('#,##0.00').setFontColor('#333333');
      }
      sumSheet.getRange('B' + svcRendRow + ':B' + grandTotRow).setHorizontalAlignment('left').setFontWeight('normal');
      sumSheet.getRange('B' + svcRendRow).setFontWeight('bold');
      sumSheet.getRange('C' + svcRendRow + ':C' + grandTotRow).setHorizontalAlignment('right').setNumberFormat('#,##0.00');

      if (!isNonTaxable && hasEwt) {
        sumSheet.getRange('C' + totalRow)
          .setBorder(true, null, null, null, null, null, '#333333', SpreadsheetApp.BorderStyle.SOLID);
        sumSheet.getRange('B' + ewtRow + ':C' + ewtRow).setFontColor('#CC0000');
      }

      sumSheet.getRange('B' + grandTotRow).setFontWeight('bold').setFontSize(11);
      sumSheet.getRange('C' + grandTotRow)
        .setFontWeight('bold').setFontSize(11)
        .setNumberFormat('"₱ "#,##0.00')
        .setBorder(true, null, null, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID)
        .setBorder(null, null, true, null, null, null, '#000000', SpreadsheetApp.BorderStyle.DOUBLE);

      sumSheet.getRange('B' + checkPayRow).setFontWeight('bold').setHorizontalAlignment('left');
      sumSheet.getRange('B' + (checkPayRow + 1) + ':C' + (checkPayRow + 3)).setHorizontalAlignment('left');
      sumSheet.getRange('B' + (checkPayRow + 1) + ':B' + (checkPayRow + 3)).setFontWeight('bold');

      sumSheet.getRange('B' + sigHeaderRow).setFontWeight('bold').setHorizontalAlignment('left');
      sumSheet.getRange('C' + sigHeaderRow).setFontWeight('bold').setHorizontalAlignment('left');
      sumSheet.getRange('D' + sigHeaderRow).setFontWeight('bold').setHorizontalAlignment('left');
      sumSheet.setRowHeight(sigLineRow, 32);
      const BS = SpreadsheetApp.BorderStyle.SOLID;
      ['B', 'C', 'D'].forEach(col => {
        sumSheet.getRange(col + sigLineRow)
          .setBorder(null, null, true, null, null, null, '#000000', BS);
      });
      sumSheet.getRange('B' + sigNameRow + ':D' + sigRoleRow)
        .setHorizontalAlignment('left').setFontSize(9).setFontColor('#444444');

      const DIV  = SpreadsheetApp.BorderStyle.SOLID;
      const GREY = '#CCCCCC';
      sumSheet.getRange('B8:E8').setBorder(null, null, true, null, null, null, GREY, DIV);
      sumSheet.getRange('B13:C13').setBorder(null, null, true, null, null, null, GREY, DIV);
      sumSheet.getRange('B16:E16').setBorder(null, null, true, null, null, null, GREY, DIV);
      if (N > 0) {
        sumSheet.getRange(17 + N, 2, 1, 2).setBorder(null, null, true, null, null, null, GREY, DIV);
      }
      sumSheet.getRange('B' + (checkPayRow + 3) + ':C' + (checkPayRow + 3))
        .setBorder(null, null, true, null, null, null, GREY, DIV);
    }; // end buildSummarySheet_

    // ── Decide which summaries to create based on summarizePer ───────────────
    if (summarizePer === 'per_subtotal' && subtotalPer !== 'N/A') {
      // One BILLING SUMMARY for every subtotal group across all comp sheets
      for (const info of subTotalInfoList) {
        const sumSheetName = 'BILLING SUMMARY - ' + info.subKey;
        const lineItems = [{
          label:   info.subKey,
          formula: "='" + info.compSheetName + "'!" + info.colLetter + info.totalRowNum
        }];
        const grandFormula = lineItems[0].formula;
        buildSummarySheet_(sumSheetName, lineItems, grandFormula);
      }
    } else {
      // per_computation (default): one BILLING SUMMARY per Computation sheet
      for (const info of compSheetInfoList) {
        const sumSheetName = separatedPer === 'N/A'
          ? 'BILLING SUMMARY'
          : 'BILLING SUMMARY - ' + info.sepKey;

        // Line items: if there are subtotal rows, list them; otherwise single line
        let lineItems;
        if (info.subTotalRowNums.length > 0 && subtotalPer !== 'N/A') {
          lineItems = info.subTotalRowNums.map((rowNum, i) => ({
            label:   info.subKeyNames[i] || ('Group ' + (i + 1)),
            formula: "='" + info.sheetName + "'!" + compTotalColLetter + rowNum
          }));
        } else {
          lineItems = [{
            label:   separatedPer !== 'N/A' ? info.sepKey : 'Services Rendered',
            formula: "='" + info.sheetName + "'!" + compTotalColLetter + info.grandTotalRowNum
          }];
        }
        const grandFormula = "='" + info.sheetName + "'!B7";
        buildSummarySheet_(sumSheetName, lineItems, grandFormula);
      }
    }
  } // end PASS 2

  // ═══════════════════════════════════════════════════════════════════════════
  // PASS 3 — Grand Summary (consolidates all Computation sheets)
  // ═══════════════════════════════════════════════════════════════════════════
  if (createGrandSummary && compSheetInfoList.length > 1) {
    const sig   = getCentralSettingsSignatories_();
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEEE, MMMM d, yyyy');

    let gsSheet = ss.getSheetByName('GRAND SUMMARY');
    if (!gsSheet) gsSheet = ss.insertSheet('GRAND SUMMARY');
    else { gsSheet.clear(); gsSheet.clearFormats(); }

    gsSheet.getRange(1, 1, 50 + compSheetInfoList.length, 5)
      .setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle');

    try {
      const letterheadBlob = DriveApp.getFileById('1xMyos-Sq0pL99io6DSf3ZnG3HPZ80Khp').getBlob();
      const letterheadImg  = gsSheet.insertImage(letterheadBlob, 1, 1);
      const origH = letterheadImg.getHeight();
      const origW = letterheadImg.getWidth();
      const targetH = 150;
      letterheadImg.setHeight(targetH);
      letterheadImg.setWidth(Math.round(origW * targetH / origH));
    } catch (e) {
      Logger.log('Grand Summary letterhead failed: ' + e.message);
    }

    const e5 = ['', '', '', '', ''];
    const N  = compSheetInfoList.length;
    const svcRendRow  = 19 + N;
    const grandTotRow = isNonTaxable || !hasEwt ? svcRendRow + 2 : svcRendRow + 4;
    const totalRow    = svcRendRow + 2;
    const ewtRow      = svcRendRow + 3;
    const checkPayRow = grandTotRow + 2;
    const sigHeaderRow = grandTotRow + 7;
    const sigLineRow   = sigHeaderRow + 1;
    const sigNameRow   = sigHeaderRow + 2;
    const sigRoleRow   = sigHeaderRow + 3;

    const gsPayload = [
      e5.slice(), e5.slice(), e5.slice(), e5.slice(), e5.slice(), e5.slice(), e5.slice(),
      ['', 'GRAND BILLING SUMMARY', '', '', ''],
      e5.slice(),
      ['', 'To:',        clientName,   '', ''],
      ['', 'Date:',      today,        '', ''],
      ['', 'Billing #:', controlNo,    '', ''],
      ['', 'Terms:',     '15 days',    '', ''],
      e5.slice(),
      ['', 'Particulars:', '', '', ''],
      ['', 'Services rendered by employees for the period of ' + billingPeriod, '', '', ''],
      e5.slice(),
    ];

    const allTotalFormulas = [];
    for (let i = 0; i < N; i++) {
      const info = compSheetInfoList[i];
      const formula = "='" + info.sheetName + "'!" + compTotalColLetter + info.grandTotalRowNum;
      allTotalFormulas.push(formula);
      gsPayload.push(['', '   ' + info.sepKey, formula, '', '']);
    }

    const grandFormula = '=SUM(C18:C' + (17 + N) + ')';
    gsPayload.push(e5.slice());
    if (isNonTaxable) {
      gsPayload.push(
        ['', 'Services Rendered', grandFormula, '', ''],
        ['', 'Admin Fee',         '=ROUND(C' + svcRendRow + '*' + rate + ',2)', '', ''],
        ['', 'Total Amount Due',  '=C' + svcRendRow + '+C' + (svcRendRow + 1), '', '']
      );
    } else if (!hasEwt) {
      gsPayload.push(
        ['', 'Services Rendered', grandFormula, '', ''],
        ['', 'VAT (12%)',         '=ROUND(C' + svcRendRow + '*0.12,2)', '', ''],
        ['', 'GRAND TOTAL',       '=C' + svcRendRow + '+C' + (svcRendRow + 1), '', '']
      );
    } else {
      gsPayload.push(
        ['', 'Services Rendered', grandFormula, '', ''],
        ['', 'VAT (12%)',         '=ROUND(C' + svcRendRow + '*0.12,2)', '', ''],
        ['', 'Total w/ VAT',      '=C' + svcRendRow + '+C' + (svcRendRow + 1), '', ''],
        ['', 'Less: EWT (2%)',    '=ROUND(C' + svcRendRow + '*0.02,5)', '', ''],
        ['', 'GRAND TOTAL',       '=C' + totalRow + '-C' + ewtRow, '', '']
      );
    }

    gsPayload.push(
      e5.slice(),
      ['', 'Please make check payable to:', '', '', ''],
      ['', '   Account Name:', 'Workscale Resources Inc.',      '', ''],
      ['', '   Account No.:',  "'002570018928",                 '', ''],
      ['', '   Bank:',         'Unionbank (Greenhills branch)', '', ''],
      e5.slice(),
      ['', 'Prepared by:', 'Reviewed by:', 'Approved by:', ''],
      e5.slice(),
      ['', sig.preparerName, sig.reviewerName, sig.approverName, ''],
      ['', sig.preparerRole, 'Reviewer',       'CFO',           '']
    );

    gsSheet.getRange(1, 1, gsPayload.length, 5).setValues(gsPayload);

    gsSheet.setHiddenGridlines(true);
    gsSheet.setRowHeights(1, 7, 22);
    gsSheet.setRowHeight(8, 32);
    gsSheet.setColumnWidth(1, 25);
    gsSheet.setColumnWidth(2, 240);
    gsSheet.setColumnWidth(3, 170);
    gsSheet.setColumnWidth(4, 160);
    gsSheet.setColumnWidth(5, 160);

    gsSheet.getRange('B8:E8').merge().setFontSize(14).setFontWeight('bold').setHorizontalAlignment('center');
    gsSheet.getRange('B10:B13').setFontWeight('bold').setHorizontalAlignment('left');
    gsSheet.getRange('C10:C13').setHorizontalAlignment('left');
    gsSheet.getRange('B15').setFontWeight('bold').setHorizontalAlignment('left');
    gsSheet.getRange('B16:E16').merge().setHorizontalAlignment('left').setWrap(false);

    if (N > 0) {
      gsSheet.getRange(18, 2, N, 1).setHorizontalAlignment('left').setFontColor('#555555');
      gsSheet.getRange(18, 3, N, 1).setHorizontalAlignment('right').setNumberFormat('#,##0.00').setFontColor('#333333');
    }
    gsSheet.getRange('B' + svcRendRow + ':B' + grandTotRow).setHorizontalAlignment('left').setFontWeight('normal');
    gsSheet.getRange('B' + svcRendRow).setFontWeight('bold');
    gsSheet.getRange('C' + svcRendRow + ':C' + grandTotRow).setHorizontalAlignment('right').setNumberFormat('#,##0.00');

    if (!isNonTaxable && hasEwt) {
      gsSheet.getRange('C' + totalRow)
        .setBorder(true, null, null, null, null, null, '#333333', SpreadsheetApp.BorderStyle.SOLID);
      gsSheet.getRange('B' + ewtRow + ':C' + ewtRow).setFontColor('#CC0000');
    }

    gsSheet.getRange('B' + grandTotRow).setFontWeight('bold').setFontSize(11);
    gsSheet.getRange('C' + grandTotRow)
      .setFontWeight('bold').setFontSize(11)
      .setNumberFormat('"₱ "#,##0.00')
      .setBorder(true, null, null, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID)
      .setBorder(null, null, true, null, null, null, '#000000', SpreadsheetApp.BorderStyle.DOUBLE);

    gsSheet.getRange('B' + checkPayRow).setFontWeight('bold').setHorizontalAlignment('left');
    gsSheet.getRange('B' + (checkPayRow + 1) + ':C' + (checkPayRow + 3)).setHorizontalAlignment('left');
    gsSheet.getRange('B' + (checkPayRow + 1) + ':B' + (checkPayRow + 3)).setFontWeight('bold');

    gsSheet.getRange('B' + sigHeaderRow).setFontWeight('bold').setHorizontalAlignment('left');
    gsSheet.getRange('C' + sigHeaderRow).setFontWeight('bold').setHorizontalAlignment('left');
    gsSheet.getRange('D' + sigHeaderRow).setFontWeight('bold').setHorizontalAlignment('left');
    gsSheet.setRowHeight(sigLineRow, 32);
    const BS = SpreadsheetApp.BorderStyle.SOLID;
    ['B', 'C', 'D'].forEach(col => {
      gsSheet.getRange(col + sigLineRow).setBorder(null, null, true, null, null, null, '#000000', BS);
    });
    gsSheet.getRange('B' + sigNameRow + ':D' + sigRoleRow)
      .setHorizontalAlignment('left').setFontSize(9).setFontColor('#444444');

    const DIV  = SpreadsheetApp.BorderStyle.SOLID;
    const GREY = '#CCCCCC';
    gsSheet.getRange('B8:E8').setBorder(null, null, true, null, null, null, GREY, DIV);
    gsSheet.getRange('B13:C13').setBorder(null, null, true, null, null, null, GREY, DIV);
    gsSheet.getRange('B16:E16').setBorder(null, null, true, null, null, null, GREY, DIV);
    if (N > 0) {
      gsSheet.getRange(17 + N, 2, 1, 2).setBorder(null, null, true, null, null, null, GREY, DIV);
    }
    gsSheet.getRange('B' + (checkPayRow + 3) + ':C' + (checkPayRow + 3))
      .setBorder(null, null, true, null, null, null, GREY, DIV);
  } // end PASS 3
}

// =============================================================
// HRIS RAW DATA — GENERATE BILLING DIRECTLY FROM PAYROLL DB
// =============================================================

const PAYROLL_DB_ID_ = '1CHPOJo0LzQISnMfg6GhFSaF00bqDEWhIKli7leKPaZA';
const BILLING_RAW_DATA_FOLDER_ID_ = '11dViI-Q9RjzL09wvYXp7eXKYAqtOVL6P';
const EMPLOYEE_MASTERLIST_SS_ID_ = '13QOgFiROvcXny_P30mU13AW4fTB-DB7MWAKj6X45BFo';

/**
 * Returns HRIS raw data entries for a specific company from the Payroll DB,
 * annotated with whether each BatchID has already been pulled into RawBillingUploads.
 *
 * @param {string} companyName  The ContactName / Client_Company to filter on.
 * @returns {string} JSON array of entry objects.
 */
function getHrisRawDataList(companyName) {
  if (!companyName) throw new Error('companyName is required.');
  const companyNorm = String(companyName).trim().toLowerCase();

  // Read HRISRawData from Payroll DB
  const payrollDb  = SpreadsheetApp.openById(PAYROLL_DB_ID_);
  const hrisSheet  = payrollDb.getSheetByName('HRISRawData');
  if (!hrisSheet) throw new Error('HRISRawData sheet not found in Payroll DB.');
  const hrisData    = hrisSheet.getDataRange().getValues();
  const hrisHeaders = hrisData[0];

  const idx = (name) => hrisHeaders.indexOf(name);

  // Read already-pulled BatchIDs from local RawBillingUploads
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheet     = ss.getSheetByName('RawBillingUploads');
  const pulledBatch  = new Set();
  if (rawSheet && rawSheet.getLastRow() > 1) {
    const rawData    = rawSheet.getDataRange().getValues();
    const rawHeaders = rawData[0];
    const batchCol   = rawHeaders.indexOf('HrisBatchId');
    if (batchCol > -1) {
      for (let i = 1; i < rawData.length; i++) {
        const b = String(rawData[i][batchCol] || '').trim();
        if (b) pulledBatch.add(b);
      }
    }
  }

  const results = [];
  for (let i = 1; i < hrisData.length; i++) {
    const row         = hrisData[i];
    const clientName  = String(row[idx('Client_Company')] || '').trim();
    if (clientName.toLowerCase() !== companyNorm) continue;

    const batchId     = String(row[idx('BatchID')]     || '').trim();
    const sourceFile  = String(row[idx('Source_File')] || '').trim();
    const fileName    = String(row[idx('FileName')]    || '').trim();
    const cutoffStart = String(row[idx('CutoffStart')] || '').trim();
    const cutoffEnd   = String(row[idx('CutoffEnd')]   || '').trim();
    const uploadDate  = String(row[idx('UploadDate')]  || '').trim();
    const rowCount    = Number(row[idx('Rows')]        || 0);
    const payrollId   = String(row[idx('PayrollID')]   || '').trim();

    const isPulled = pulledBatch.has(batchId);

    results.push({
      BatchId:      batchId,
      CompanyName:  clientName,
      CutoffStart:  cutoffStart,
      CutoffEnd:    cutoffEnd,
      UploadDate:   uploadDate,
      Employees:    rowCount,
      FileName:     fileName,
      SourceFile:   sourceFile,
      PayrollId:    payrollId,
      Status:       isPulled ? 'Pulled' : 'New'
    });
  }

  // Sort newest cutoff first
  results.sort((a, b) => new Date(b.CutoffEnd) - new Date(a.CutoffEnd));
  return JSON.stringify(results);
}

/**
 * Pulls a single HRIS raw data batch from its Source_File Google Sheet,
 * parses the billingdata JSON column per row, derives hour columns,
 * writes a flat billing sheet to Drive under Billing Raw Data/{companyName}/,
 * registers it in RawBillingUploads, and returns the new UploadId.
 *
 * @param {string} payloadStr  JSON: { batchId, companyName, contactId, cutoffStart, cutoffEnd, sourceFileUrl }
 * @returns {string} JSON: { UploadId, FileName, FileUrl, BillingPeriod }
 */
function pullAndRegisterHrisFile(payloadStr) {
  const payload = JSON.parse(payloadStr);
  const { batchId, companyName, contactId, cutoffStart, cutoffEnd, sourceFileUrl } = payload;
  if (!batchId || !companyName || !sourceFileUrl) {
    throw new Error('pullAndRegisterHrisFile: batchId, companyName and sourceFileUrl are required.');
  }

  // Extract spreadsheet ID from the Google Sheets URL
  const ssIdMatch = sourceFileUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!ssIdMatch) throw new Error('Cannot extract spreadsheet ID from sourceFileUrl: ' + sourceFileUrl);
  const spreadsheetId = ssIdMatch[1];

  // Open source spreadsheet — convert to Google Sheets first if it's an xlsx
  let tempConvertedId = null;
  let srcSsId = spreadsheetId;
  try {
    const srcFile = DriveApp.getFileById(spreadsheetId);
    if (srcFile.getMimeType() !== MimeType.GOOGLE_SHEETS) {
      // Convert xlsx → Google Sheets via Drive REST API v3 copy
      const token = ScriptApp.getOAuthToken();
      const resp  = UrlFetchApp.fetch(
        'https://www.googleapis.com/drive/v3/files/' + spreadsheetId + '/copy',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          payload: JSON.stringify({ name: 'TEMP_HRIS_IMPORT_' + spreadsheetId, mimeType: 'application/vnd.google-apps.spreadsheet' })
        }
      );
      tempConvertedId = JSON.parse(resp.getContentText()).id;
      srcSsId = tempConvertedId;
    }
  } catch (e) {
    throw new Error('Failed to prepare source file for reading: ' + e.message);
  }

  let srcSs, srcSheet, srcData;
  try {
    srcSs    = SpreadsheetApp.openById(srcSsId);
    srcSheet = srcSs.getSheets()[0];
    srcData  = srcSheet.getDataRange().getValues();
  } finally {
    if (tempConvertedId) {
      try { DriveApp.getFileById(tempConvertedId).setTrashed(true); } catch (e) { /* best-effort cleanup */ }
    }
  }
  if (srcData.length < 2) throw new Error('Source HRIS file appears to be empty: ' + sourceFileUrl);

  const srcHeaders = srcData[0].map(h => String(h).trim().toLowerCase());
  const getCol = (name) => srcHeaders.indexOf(name.toLowerCase());

  // Column indices for org fields — with fallback variants for different HRIS export formats
  const iName       = getCol('name');
  const iFirstName  = getCol('first_name') > -1 ? getCol('first_name') : getCol('firstname');
  const iLastName   = getCol('last_name')   > -1 ? getCol('last_name')   : getCol('lastname');
  const iWorkRegion = getCol('workregion')    > -1 ? getCol('workregion')    : getCol('work_region');
  const iWorkLoc    = getCol('work_location') > -1 ? getCol('work_location') : getCol('worklocation');
  const iBranch      = getCol('branch');
  const iDept        = getCol('department');
  const iPosition    = getCol('position');
  const iBillingData = getCol('billingdata');

  if (iBillingData === -1) {
    throw new Error('Source HRIS file has no "billingdata" column. Cannot generate billing.');
  }

  // Flat output headers (matches the billing transform expected input)
  const FLAT_HEADERS = [
    'Name', 'Daily Rate', 'Days', 'Regular', 'Lates', 'Lates Amount', 'Total Basic Salary',
    'Overtime Hrs', 'Overtime',
    'DOD Hrs', 'DOD',
    'DOD OT Hrs', 'DOD OT',
    'Spl Holiday Hrs', 'Spl Holiday',
    'Spl Holiday OT Hrs', 'Spl Holiday OT',
    'Spl Holiday DOD Hrs', 'Spl Holiday DOD',
    'Spl Holiday DOD OT Hrs', 'Spl Holiday DOD OT',
    'Legal Holiday Hrs', 'Legal Holiday',
    'Legal Holiday OT Hrs', 'Legal Holiday OT',
    'Legal Holiday DOD Hrs', 'Legal Holiday DOD',
    'Legal Holiday DOD OT Hrs', 'Legal Holiday DOD OT',
    'Night Diff Hrs', 'Night Diff',
    'Adjustment', 'Allowances',
    'SSS', 'Pagibig', 'Philhealth',
    '13th Month Pay', 'Subtotal', 'Service Fee', 'Total',
    'Work Region', 'Work Location', 'Branch', 'Department', 'Position',
    'CompanyName'
  ];

  const flatRows = [FLAT_HEADERS];

  const iId     = getCol('id');
  const iUserId  = getCol('userid') > -1 ? getCol('userid') : getCol('user_id');

  // Build org-data lookup map from Employee Masterlist: userid → {branch, department, workLoc, position}
  const orgMap = {};
  try {
    const mlSs     = SpreadsheetApp.openById(EMPLOYEE_MASTERLIST_SS_ID_);
    const mlSheet  = mlSs.getSheetByName('Masterlist');
    if (mlSheet) {
      const mlData    = mlSheet.getDataRange().getValues();
      const mlHeaders = mlData[0].map(h => String(h).trim().toLowerCase());
      const mUid  = mlHeaders.indexOf('userid');
      const mBr   = mlHeaders.indexOf('branch');
      const mDept = mlHeaders.indexOf('department');
      const mWLoc = mlHeaders.indexOf('work_location') > -1 ? mlHeaders.indexOf('work_location') : mlHeaders.indexOf('worklocation');
      const mPos  = mlHeaders.indexOf('position');
      const mWReg = mlHeaders.indexOf('work_region') > -1 ? mlHeaders.indexOf('work_region') : mlHeaders.indexOf('workregion');
      if (mUid > -1) {
        for (let r = 1; r < mlData.length; r++) {
          const uid = String(mlData[r][mUid] || '').trim();
          if (!uid) continue;
          orgMap[uid] = {
            branch:    mBr   > -1 ? String(mlData[r][mBr]   || '').trim() : '',
            dept:      mDept > -1 ? String(mlData[r][mDept] || '').trim() : '',
            workLoc:   mWLoc > -1 ? String(mlData[r][mWLoc] || '').trim() : '',
            position:  mPos  > -1 ? String(mlData[r][mPos]  || '').trim() : '',
            workRegion:mWReg > -1 ? String(mlData[r][mWReg] || '').trim() : '',
          };
        }
      }
    }
  } catch (e) {
    // Non-fatal: org fields will just be blank if masterlist is unavailable
    Logger.log('Employee Masterlist lookup failed: ' + e.message);
  }

  for (let i = 1; i < srcData.length; i++) {
    const row = srcData[i];

    // Drop rows with no value in the 'id' column
    if (iId > -1 && String(row[iId] || '').trim() === '') continue;

    // Parse billingdata JSON
    let bd = {};
    try {
      const raw = String(row[iBillingData] || '').trim();
      if (raw) bd = JSON.parse(raw);
    } catch (e) {
      // Skip rows with malformed JSON
      continue;
    }

    const name       = iName > -1
      ? String(row[iName] || '').trim()
      : [iFirstName, iLastName].map(i => i > -1 ? String(row[i] || '').trim() : '').filter(Boolean).join(' ');

    // Org fields: prefer Employee Masterlist lookup over HRIS file (HRIS file typically lacks these)
    const userId = iUserId > -1 ? String(row[iUserId] || '').trim() : '';
    const orgData = (userId && orgMap[userId]) ? orgMap[userId] : {};
    const workRegion = orgData.workRegion || (iWorkRegion > -1 ? String(row[iWorkRegion] || '').trim() : '');
    const workLoc    = orgData.workLoc    || (iWorkLoc   > -1 ? String(row[iWorkLoc]    || '').trim() : '');
    const branch     = orgData.branch     || (iBranch    > -1 ? String(row[iBranch]     || '').trim() : '');
    const dept       = orgData.dept       || (iDept      > -1 ? String(row[iDept]       || '').trim() : '');
    const position   = orgData.position   || (iPosition  > -1 ? String(row[iPosition]   || '').trim() : '');

    const dr             = parseFloat(bd.DailyRate                || 0);
    const totalDays      = parseFloat(bd.TotalDays                || 0);
    const regular        = parseFloat(bd.TotalAmount              || 0);
    const totalBasic     = parseFloat(bd.TotalBasicSalary         || 0);
    const lates          = parseFloat(bd.TotalLates               || 0);
    const latesAmt       = parseFloat(bd.TotalLatesAmount         || 0);
    const otHrs          = parseFloat(bd.OvertimeHrs              || 0);
    const otAmt          = parseFloat(bd.Overtime                 || 0);
    const dodHrs         = parseFloat(bd.DODHrs                   || 0);
    const dodAmt         = parseFloat(bd.DOD                      || 0);
    const dodOtHrs       = parseFloat(bd.DODOTHrs                 || 0);
    const dodOtAmt       = parseFloat(bd.DOT_OT                   || 0);
    const splHolHrs      = parseFloat(bd.SplHolidaysPayHrs        || 0);
    const splHolAmt      = parseFloat(bd.SplHolidaysPay           || 0);
    const splHolOtHrs    = parseFloat(bd.SplHolidaysPayOTHrs      || 0);
    const splHolOtAmt    = parseFloat(bd.SplHolidaysPayOT         || 0);
    const splHolDodHrs   = parseFloat(bd.SplHolidaysDODPayHrs     || 0);
    const splHolDodAmt   = parseFloat(bd.SplHolidaysDODPay        || 0);
    const splHolDodOtHrs = parseFloat(bd.SplHolidaysDODPayOTHrs   || 0);
    const splHolDodOtAmt = parseFloat(bd.SplHolidaysDODPayOT      || 0);
    const legHolHrs      = parseFloat(bd.LegalHolidaysHrs         || 0);
    const legHolAmt      = parseFloat(bd.LegalHolidaysPay         || 0);
    const legHolOtHrs    = parseFloat(bd.LegalHolidaysOTHrs       || 0);
    const legHolOtAmt    = parseFloat(bd.LegalHolidaysOTPay       || 0);
    const legHolDodHrs   = parseFloat(bd.LegalHolidaysPayDODHrs   || 0);
    const legHolDodAmt   = parseFloat(bd.LegalHolidaysPayDOD      || 0);
    const legHolDodOtHrs = parseFloat(bd.LegalHolidaysPayDODOTHrs || 0);
    const legHolDodOtAmt = parseFloat(bd.LegalHolidaysPayDODOT    || 0);
    const ndHrs          = parseFloat(bd.NightDiffHrs             || 0);
    const ndAmt          = parseFloat(bd.NightDiff                || 0);
    const adjustment     = parseFloat(bd.Adjustment               || 0);
    const allowances     = parseFloat(bd.Allowances               || 0);
    const sss            = parseFloat(bd.SSS                      || 0);
    const pagibig        = parseFloat(bd.Pagibig                  || 0);
    const philhealth     = parseFloat(bd.Philhealth               || 0);
    const nthMonth       = parseFloat(bd.NthMonthPay              || 0);
    const subtotal       = parseFloat(bd.Subtotal                 || 0);
    const serviceFee     = parseFloat(bd.ServiceFee               || 0);
    const total          = parseFloat(bd.Total                    || 0);

    flatRows.push([
      name, dr, totalDays, regular, lates, latesAmt, totalBasic,
      otHrs, otAmt,
      dodHrs, dodAmt,
      dodOtHrs, dodOtAmt,
      splHolHrs, splHolAmt,
      splHolOtHrs, splHolOtAmt,
      splHolDodHrs, splHolDodAmt,
      splHolDodOtHrs, splHolDodOtAmt,
      legHolHrs, legHolAmt,
      legHolOtHrs, legHolOtAmt,
      legHolDodHrs, legHolDodAmt,
      legHolDodOtHrs, legHolDodOtAmt,
      ndHrs, ndAmt,
      adjustment, allowances,
      sss, pagibig, philhealth,
      nthMonth, subtotal, serviceFee, total,
      workRegion, workLoc, branch, dept, position,
      companyName
    ]);
  }

  if (flatRows.length < 2) {
    throw new Error('No valid employee rows found in HRIS source file for batch: ' + batchId);
  }

  // Date helpers for clean filenames and stored BillingPeriod
  const fmtSlug = (d) => { const x = new Date(d); if (isNaN(x.getTime())) return String(d).replace(/[^a-zA-Z0-9]/g,''); return (x.getMonth()+1).toString().padStart(2,'0') + x.getDate().toString().padStart(2,'0') + x.getFullYear(); };
  const fmtDate = (d) => { const x = new Date(d); if (isNaN(x.getTime())) return String(d); return (x.getMonth()+1).toString().padStart(2,'0') + '/' + x.getDate().toString().padStart(2,'0') + '/' + x.getFullYear(); };

  // Write flat billing sheet to Drive: Billing Raw Data/{companyName}/
  const parentFolder  = DriveApp.getFolderById(BILLING_RAW_DATA_FOLDER_ID_);
  const clientFolder  = getOrCreateFolder(companyName, parentFolder);
  const newSs         = SpreadsheetApp.create('billingraw_' + companyName.replace(/\s+/g, '_') + '_' + fmtSlug(cutoffStart) + '_' + fmtSlug(cutoffEnd));
  const newSheet      = newSs.getActiveSheet();
  newSheet.getRange(1, 1, flatRows.length, FLAT_HEADERS.length).setValues(flatRows);
  newSheet.getRange(1, 1, 1, FLAT_HEADERS.length).setFontWeight('bold').setBackground('#e0f2fe');
  newSheet.setFrozenRows(1);
  newSheet.setName('BillingRaw');

  // Move file to the client folder
  const newFile = DriveApp.getFileById(newSs.getId());
  clientFolder.addFile(newFile);
  DriveApp.getRootFolder().removeFile(newFile);

  const uploadId    = 'RAWUP-HRIS-' + Date.now();
  const fileName    = newFile.getName();
  const fileUrl     = newFile.getUrl();
  const billingPeriod = fmtDate(cutoffStart) + ' - ' + fmtDate(cutoffEnd);
  const uploadedAt  = new Date().toISOString();
  const uploadedBy  = Session.getActiveUser().getEmail();

  // Register in RawBillingUploads (with new HrisBatchId column)
  const ss2       = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheet  = ss2.getSheetByName('RawBillingUploads');
  if (!rawSheet) throw new Error('RawBillingUploads sheet not found. Run setupDatabase() first.');

  // Ensure HrisBatchId column exists
  const rawHeaders = rawSheet.getRange(1, 1, 1, rawSheet.getLastColumn()).getValues()[0];
  if (!rawHeaders.includes('HrisBatchId')) {
    rawSheet.getRange(1, rawSheet.getLastColumn() + 1).setValue('HrisBatchId').setFontWeight('bold').setBackground('#f1f5f9');
    rawHeaders.push('HrisBatchId');
  }

  const newRow = new Array(rawHeaders.length).fill('');
  const setC   = (name, val) => { const i = rawHeaders.indexOf(name); if (i > -1) newRow[i] = val; };
  setC('UploadId',     uploadId);
  setC('ContactId',    contactId || '');
  setC('ContactName',  companyName);
  setC('FileName',     fileName);
  setC('FileId',       newSs.getId());
  setC('FileUrl',      fileUrl);
  setC('BillingPeriod', billingPeriod);
  setC('BillingDate',  '');
  setC('TransformMethod', 'regional');
  setC('Status',       'Raw');
  setC('ComputationId', '');
  setC('UploadedAt',   uploadedAt);
  setC('UploadedBy',   uploadedBy);
  setC('HrisBatchId',  batchId);
  rawSheet.appendRow(newRow);

  return JSON.stringify({
    UploadId:      uploadId,
    FileName:      fileName,
    FileUrl:       fileUrl,
    FileId:        newSs.getId(),
    BillingPeriod: billingPeriod,
    ContactName:   companyName,
    ContactId:     contactId || '',
    RowCount:      flatRows.length - 1
  });
}
