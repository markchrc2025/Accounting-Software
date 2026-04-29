/**
 * WORKSCALE FINANCE — UNIFIED PORTAL
 * ─────────────────────────────────────────────────────────────────────────────
 * Single GAS web app that embeds all Finance applications (Accounting, Payroll,
 * and any future apps) in one portal without requiring separate links.
 *
 * SETUP:
 *  1. Set PORTAL_SS_ID below to the Spreadsheet ID of your "Finance Unified
 *     Web App" spreadsheet (visible in the sheet's URL).
 *  2. In that spreadsheet, keep a sheet named "MainLinks" with:
 *       Column A → WebAppName  (e.g. "Accounting Web App")
 *       Column B → WebAppLink  (deployed /exec URL of the web app)
 *  3. Deploy THIS script as a new Web App (Execute as: Me, Who has access: Anyone).
 *  4. Share this portal URL instead of the individual app URLs.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
// Replace with the ID from your "Finance Unified Web App" spreadsheet URL.
// e.g. https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit
const PORTAL_SS_ID        = '1EjmhRK_4nhlBYq2wCeT1LnOlOnOuQ4j8rE5Fd96rSEo';
const PORTAL_LINKS_SHEET  = 'MainLinks';
const PORTAL_QUOTES_SHEET = 'DailyQuotes'; // Sheet in PORTAL_SS_ID — auto-created if missing

// Central Settings spreadsheet — source of user display names
const CENTRAL_SETTINGS_SS_ID = '1TueoeHavaK4lrNuWiZN_2TqcyoVev-3Ma-d3HEGGvdk';
const CENTRAL_USERS_SHEET    = 'Users';

// Optional: Set to a comma-separated list of authorised email addresses.
// Leave empty ('') to allow all users who have access to the web app deployment.
const PORTAL_ALLOWED_EMAILS = '';

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────

/**
 * Serves the unified portal HTML.
 */
function doGet(e) {
  const email = Session.getActiveUser().getEmail();

  if (!isPortalUserAllowed_(email)) {
    return HtmlService.createHtmlOutput(
      '<html><body style="font-family:sans-serif;display:flex;justify-content:center;'
      + 'align-items:center;height:100vh;flex-direction:column;gap:12px;">'
      + '<div style="font-size:48px;">🔒</div>'
      + '<h2 style="margin:0;">Access Denied</h2>'
      + '<p style="color:#666;margin:0;">Your account (<strong>' + escHtml_(email) + '</strong>) '
      + 'is not authorised to access this portal.</p>'
      + '<p style="color:#999;font-size:12px;margin:0;">Contact your system administrator.</p>'
      + '</body></html>'
    ).setTitle('Access Denied');
  }

  const tpl = HtmlService.createTemplateFromFile('unified_index');
  tpl.userEmail = email || 'Unknown User';

  return tpl.evaluate()
    .setTitle('Workscale Finance Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Public function called client-side via google.script.run.
 * Returns the app links array to the browser.
 * @return {Array<{name:string, link:string}>}
 */
function getPortalAppLinks() {
  return getPortalAppLinks_();
}

/**
 * Public function called client-side via google.script.run.
 * Returns the current user's email.
 * @return {string}
 */
function getPortalUserEmail() {
  return Session.getActiveUser().getEmail() || '';
}

/**
 * Public function called client-side via google.script.run.
 * Looks up the current user's first name from Central Settings → Users sheet.
 * Falls back to the part before @ in the email.
 * @return {string}  e.g. "Christian"
 */
function getPortalUserFirstName() {
  const email = Session.getActiveUser().getEmail() || '';
  try {
    const ss    = SpreadsheetApp.openById(CENTRAL_SETTINGS_SS_ID);
    const sheet = ss.getSheetByName(CENTRAL_USERS_SHEET);
    if (!sheet) return fallbackName_(email);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return fallbackName_(email);
    const headers  = data[0].map(h => String(h).trim().toLowerCase());
    const emailIdx = headers.indexOf('email');
    const nameIdx  = headers.indexOf('full name');
    if (emailIdx < 0 || nameIdx < 0) return fallbackName_(email);
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][emailIdx]).trim().toLowerCase() === email.toLowerCase()) {
        const full = String(data[i][nameIdx] || '').trim();
        return full ? full.split(' ')[0] : fallbackName_(email);
      }
    }
  } catch (err) {
    Logger.log('[Portal] getPortalUserFirstName error: ' + err.message);
  }
  return fallbackName_(email);
}

function fallbackName_(email) {
  const local = String(email || '').split('@')[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * Public function called client-side via google.script.run.
 * Returns today's quote object {quote, author, date} or a default if none set.
 * @return {{quote:string, author:string, date:string}}
 */
function getPortalDailyQuote() {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  try {
    const sheet = getOrCreateQuotesSheet_();
    const data  = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      const rowDate = data[i][0] ? Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
      if (rowDate === today) {
        return { quote: String(data[i][1] || ''), author: String(data[i][2] || ''), date: rowDate };
      }
    }
  } catch (err) {
    Logger.log('[Portal] getPortalDailyQuote error: ' + err.message);
  }
  return { quote: '', author: '', date: today };
}

/**
 * Public function called client-side via google.script.run.
 * Saves or updates today's quote in the DailyQuotes sheet.
 * @param {string} quote
 * @param {string} author
 */
function savePortalDailyQuote(quote, author) {
  const today   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const savedBy = Session.getEffectiveUser().getEmail() || '';
  const sheet   = getOrCreateQuotesSheet_();
  const data    = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const rowDate = data[i][0] ? Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), 'yyyy-MM-dd') : '';
    if (rowDate === today) {
      sheet.getRange(i + 1, 2, 1, 3).setValues([[quote, author, savedBy]]);
      return { success: true };
    }
  }
  sheet.appendRow([new Date(), quote, author, savedBy]);
  return { success: true };
}

function getOrCreateQuotesSheet_() {
  let ss;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch(e) { ss = null; }
  if (!ss) ss = SpreadsheetApp.openById(PORTAL_SS_ID);
  let sheet = ss.getSheetByName(PORTAL_QUOTES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PORTAL_QUOTES_SHEET);
    sheet.appendRow(['Date', 'Quote', 'Author', 'SavedBy']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ─── DATA FUNCTIONS ───────────────────────────────────────────────────────────

/**
 * Reads the MainLinks sheet and returns an array of { name, link } objects.
 * @return {Array<{name:string, link:string}>}
 */
function getPortalAppLinks_() { // internal — use getPortalAppLinks() from client
  try {
    // Prefer getActiveSpreadsheet() for container-bound projects;
    // fall back to openById() for standalone deployments.
    let ss;
    try {
      ss = SpreadsheetApp.getActiveSpreadsheet();
    } catch (e) {
      ss = null;
    }
    if (!ss) {
      ss = SpreadsheetApp.openById(PORTAL_SS_ID);
    }

    const sheet = ss.getSheetByName(PORTAL_LINKS_SHEET);

    if (!sheet) {
      Logger.log('[Portal] Sheet "' + PORTAL_LINKS_SHEET + '" not found in spreadsheet ' + ss.getId());
      return [];
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return []; // header only or empty

    const result = [];
    for (let i = 1; i < data.length; i++) {
      const name = String(data[i][0] || '').trim();
      const link = String(data[i][1] || '').trim();
      if (name && link) {
        result.push({ name: name, link: link });
      }
    }
    return result;
  } catch (err) {
    Logger.log('[Portal] getPortalAppLinks_ error: ' + err.message);
    return [];
  }
}

// ─── ACCESS CONTROL ───────────────────────────────────────────────────────────

/**
 * Returns true if the given email is permitted to use the portal.
 * When PORTAL_ALLOWED_EMAILS is empty, all authenticated users are permitted.
 * @param {string} email
 * @return {boolean}
 */
function isPortalUserAllowed_(email) {
  if (!email) return false;
  if (!PORTAL_ALLOWED_EMAILS || PORTAL_ALLOWED_EMAILS.trim() === '') return true;
  const allowed = PORTAL_ALLOWED_EMAILS
    .split(',')
    .map(function(e) { return e.trim().toLowerCase(); })
    .filter(Boolean);
  return allowed.indexOf(email.toLowerCase()) !== -1;
}

// ─── UTILITY ─────────────────────────────────────────────────────────────────

/**
 * HTML-escapes a string to prevent XSS in server-generated output.
 * @param {string} str
 * @return {string}
 */
function escHtml_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
