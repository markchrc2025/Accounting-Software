/**
 * 1. MAIN FUNCTION: Serves the HTML file as a Web App.
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('projections')
      .setTitle('Financial Projection Tool')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// _____________________________________________________________________________
// INTERNAL HELPERS
// _____________________________________________________________________________

/**
 * Ensures the Profiles index sheet exists.
 * Migrates legacy single-profile data (SavedBudget, Headcount Plan, etc.)
 * into profile ID 1 named "Default Budget / HQ Manpower" if needed.
 */
function ensureProfilesSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let profilesSheet = ss.getSheetByName('Profiles');
  if (profilesSheet) return profilesSheet;

  profilesSheet = ss.insertSheet('Profiles', 0);
  const headers = ['ID', 'Name', 'Category', 'Description', 'Created', 'Updated', 'Headcount', 'Projection'];
  const hdr = profilesSheet.getRange(1, 1, 1, 8);
  hdr.setValues([headers]);
  hdr.setFontWeight('bold').setBackground('#1e40af').setFontColor('#ffffff');
  profilesSheet.setColumnWidth(1, 50);
  profilesSheet.setColumnWidth(2, 200);
  profilesSheet.setColumnWidth(3, 160);
  profilesSheet.setColumnWidth(4, 240);

  // Migrate legacy data if found
  const legacyHC = ss.getSheetByName('Headcount Plan');
  const legacySB = ss.getSheetByName('SavedBudget');
  if (legacyHC || legacySB) {
    const now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMM dd, yyyy');
    profilesSheet.appendRow([1, 'Default Budget', 'HQ Manpower', 'Migrated from existing data', now, now, 0, 0]);
    if (legacyHC) { legacyHC.copyTo(ss).setName('HC_1'); ss.deleteSheet(legacyHC); }
    if (legacySB) { legacySB.copyTo(ss).setName('SB_1'); ss.deleteSheet(legacySB); }
    const legacyCAT = ss.getSheetByName('Departments & Positions');
    if (legacyCAT) { legacyCAT.copyTo(ss).setName('CAT_1'); ss.deleteSheet(legacyCAT); }
    const legacySC = ss.getSheetByName('Salary Changes');
    if (legacySC) { legacySC.copyTo(ss).setName('SC_1'); ss.deleteSheet(legacySC); }
  }

  return profilesSheet;
}

// _____________________________________________________________________________
// PROFILE MANAGEMENT
// _____________________________________________________________________________

/** Returns JSON array of all profiles: [{id,name,category,description,created,updated,headcount,projection}] */
function listProfiles() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const profilesSheet = ensureProfilesSheet_();
    if (profilesSheet.getLastRow() < 2) return JSON.stringify([]);
    const rows = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 8).getValues();
    const profiles = rows
      .filter(function(r) { return r[0] !== '' && r[0] !== null; })
      .map(function(r) {
        return {
          id:          parseInt(r[0]),
          name:        String(r[1]),
          category:    String(r[2]),
          description: String(r[3]),
          created:     String(r[4]),
          updated:     String(r[5]),
          headcount:   parseInt(r[6]) || 0,
          projection:  parseFloat(r[7]) || 0
        };
      });
    return JSON.stringify(profiles);
  } catch(e) { return JSON.stringify([]); }
}

/** Creates a new empty profile. Returns { success, id }. */
function createProfile(name, category, description) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const profilesSheet = ensureProfilesSheet_();
    var maxId = 0;
    if (profilesSheet.getLastRow() >= 2) {
      var ids = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 1).getValues();
      ids.forEach(function(r) { if (parseInt(r[0]) > maxId) maxId = parseInt(r[0]); });
    }
    var newId = maxId + 1;
    var now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMM dd, yyyy');
    profilesSheet.appendRow([newId, name || 'New Profile', category || 'HQ Manpower', description || '', now, now, 0, 0]);
    return JSON.stringify({ success: true, id: newId });
  } catch(e) { return JSON.stringify({ success: false, message: e.toString() }); }
}

/** Renames a profile and optionally updates its description. Returns { success }. */
function renameProfile(profileId, newName, newDescription) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const profilesSheet = ensureProfilesSheet_();
    if (profilesSheet.getLastRow() < 2) return JSON.stringify({ success: false, message: 'No profiles found' });
    const rows = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (parseInt(rows[i][0]) === parseInt(profileId)) {
        if (newName) profilesSheet.getRange(i + 2, 2).setValue(newName);
        if (newDescription !== undefined && newDescription !== null)
          profilesSheet.getRange(i + 2, 4).setValue(newDescription);
        profilesSheet.getRange(i + 2, 6).setValue(
          Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMM dd, yyyy'));
        return JSON.stringify({ success: true });
      }
    }
    return JSON.stringify({ success: false, message: 'Profile not found' });
  } catch(e) { return JSON.stringify({ success: false, message: e.toString() }); }
}

/** Deletes a profile and all its associated sheets. Returns { success }. */
function deleteProfile(profileId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const profilesSheet = ensureProfilesSheet_();
    if (profilesSheet.getLastRow() >= 2) {
      const ids = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (parseInt(ids[i][0]) === parseInt(profileId)) {
          profilesSheet.deleteRow(i + 2);
          break;
        }
      }
    }
    ['HC', 'SB', 'CAT', 'SC', 'OPEX', 'OPEX_META', 'CAPEX', 'CAPEX_META', 'FINC', 'FINC_META', 'PWP_META'].forEach(function(type) {
      var sh = ss.getSheetByName(type + '_' + profileId);
      if (sh) ss.deleteSheet(sh);
    });
    return JSON.stringify({ success: true });
  } catch(e) { return JSON.stringify({ success: false, message: e.toString() }); }
}

/** Clones an existing profile into a new one. Returns { success, id }. */
function cloneProfile(profileId, newName, newCategory, newDescription) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    var createResult = JSON.parse(createProfile(newName, newCategory || 'HQ Manpower', newDescription || ''));
    if (!createResult.success) return JSON.stringify(createResult);
    var newId = createResult.id;
    ['HC', 'SB', 'CAT', 'SC', 'OPEX', 'OPEX_META', 'CAPEX', 'CAPEX_META', 'FINC', 'FINC_META', 'PWP_META'].forEach(function(type) {
      var src = ss.getSheetByName(type + '_' + profileId);
      if (src) src.copyTo(ss).setName(type + '_' + newId);
    });
    return JSON.stringify({ success: true, id: newId });
  } catch(e) { return JSON.stringify({ success: false, message: e.toString() }); }
}

// _____________________________________________________________________________
// SAVE — profile-scoped
// _____________________________________________________________________________

/**
 * Saves all profile data to profile-scoped sheets and updates the Profiles index row.
 */
function saveProfile(profileId, jsonData) {
  try {
    const parsed = JSON.parse(jsonData);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const timeline = (parsed.timeline && parsed.timeline.length) ? parsed.timeline :
      ['Jan-2026','Feb-2026','Mar-2026','Apr-2026','May-2026','Jun-2026',
       'Jul-2026','Aug-2026','Sep-2026','Oct-2026','Nov-2026','Dec-2026'];

    // HC_{id}: Headcount Plan ─────────────────────────────────────────────────
    var hcSheet = ss.getSheetByName('HC_' + profileId);
    if (!hcSheet) hcSheet = ss.insertSheet('HC_' + profileId);
    hcSheet.clearContents();

    const fixedHeaders = ['Department', 'Position Title', 'Level', 'Base Salary (PHP)'];
    const totalCols = fixedHeaders.length + timeline.length;
    hcSheet.getRange(1, 1, 1, fixedHeaders.length).setValues([fixedHeaders]);
    if (timeline.length > 0) {
      hcSheet.getRange(1, fixedHeaders.length + 1, 1, timeline.length)
        .setNumberFormat('@STRING@').setValues([timeline]);
    }
    hcSheet.getRange(1, 1, 1, totalCols)
      .setFontWeight('bold').setBackground('#1e40af').setFontColor('#ffffff');

    var totalHeadcount = 0;
    if (parsed.positions && parsed.positions.length > 0) {
      const hcRows = parsed.positions.map(function(pos) {
        var maxHC = Math.max.apply(null, [0].concat(
          timeline.map(function(m) { return pos.headcount[m] || 0; })));
        totalHeadcount += maxHC;
        return [pos.department, pos.title, pos.level || 'Rank & File', pos.baseSalary].concat(
          timeline.map(function(m) { return pos.headcount[m] || 0; })
        );
      });
      hcSheet.getRange(2, 1, hcRows.length, totalCols).setValues(hcRows);
      hcSheet.autoResizeColumns(1, 4);
      for (var c = 5; c <= totalCols; c++) hcSheet.setColumnWidth(c, 75);
    }

    // SB_{id}: Assumptions + Timeline JSON ────────────────────────────────────
    var sbSheet = ss.getSheetByName('SB_' + profileId);
    if (!sbSheet) sbSheet = ss.insertSheet('SB_' + profileId);
    sbSheet.getRange('A1').setValue(JSON.stringify({ assumptions: parsed.assumptions, timeline: timeline }));
    sbSheet.getRange('A2').setValue(JSON.stringify({
      monthlyTotals:       parsed.monthlyTotals       || {},
      grandTotal:          parsed.grandTotal           || 0,
      isComponents:        parsed.isComponents        || {},
      isYearTotals:        parsed.isYearTotals        || {},
      serviceFeeMonthly:   parsed.serviceFeeMonthly   || {},
      serviceFeeGrandTotal:parsed.serviceFeeGrandTotal || 0,
      isDeployedRevenue:   parsed.isDeployedRevenue   || false
    }));
    sbSheet.getRange('A3').setValue('Last Updated: ' + new Date().toLocaleString());

    // CAT_{id}: Departments & Positions ───────────────────────────────────────
    var catSheet = ss.getSheetByName('CAT_' + profileId);
    if (!catSheet) catSheet = ss.insertSheet('CAT_' + profileId);
    catSheet.clearContents();
    var catHdr = catSheet.getRange(1, 1, 1, 2);
    catHdr.setValues([['Department', 'Position Title']]);
    catHdr.setFontWeight('bold').setBackground('#1e40af').setFontColor('#ffffff');
    if (parsed.catalog) {
      var catRows = [];
      Object.keys(parsed.catalog).forEach(function(dept) {
        var titles = parsed.catalog[dept];
        if (titles.length === 0) { catRows.push([dept, '']); }
        else { titles.forEach(function(t) { catRows.push([dept, t]); }); }
      });
      if (catRows.length > 0) catSheet.getRange(2, 1, catRows.length, 2).setValues(catRows);
    }
    catSheet.autoResizeColumns(1, 2);

    // SC_{id}: Salary Changes ─────────────────────────────────────────────────
    var scSheet = ss.getSheetByName('SC_' + profileId);
    if (!scSheet) scSheet = ss.insertSheet('SC_' + profileId);
    scSheet.clearContents();
    var scHdr = scSheet.getRange(1, 1, 1, 5);
    scHdr.setValues([['Department', 'Position Title', 'Effective Month', 'New Salary (PHP)', 'Position Row']]);
    scHdr.setFontWeight('bold').setBackground('#1e40af').setFontColor('#ffffff');
    if (parsed.positions) {
      var scRows = [];
      parsed.positions.forEach(function(pos, posIdx) {
        (pos.salaryHistory || []).forEach(function(entry) {
          scRows.push([pos.department, pos.title, entry.effectiveMonth, entry.salary, posIdx + 1]);
        });
      });
      if (scRows.length > 0) {
        scSheet.getRange(2, 3, scRows.length, 1).setNumberFormat('@STRING@');
        scSheet.getRange(2, 5, scRows.length, 1).setNumberFormat('0');
        scSheet.getRange(2, 1, scRows.length, 5).setValues(scRows);
      }
      scSheet.autoResizeColumns(1, 5);
    }

    // Update Profiles index row ───────────────────────────────────────────────
    var grandTotal = parsed.grandTotal || 0;
    var now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMM dd, yyyy');
    var profilesSheet = ss.getSheetByName('Profiles');
    if (profilesSheet && profilesSheet.getLastRow() >= 2) {
      var idVals = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 1).getValues();
      for (var j = 0; j < idVals.length; j++) {
        if (parseInt(idVals[j][0]) === parseInt(profileId)) {
          profilesSheet.getRange(j + 2, 6).setValue(now);
          profilesSheet.getRange(j + 2, 7).setValue(totalHeadcount);
          profilesSheet.getRange(j + 2, 8).setValue(grandTotal);
          break;
        }
      }
    }

    return { success: true, message: 'Saved!' };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

// _____________________________________________________________________________
// LOAD — profile-scoped
// _____________________________________________________________________________

/**
 * Loads all data for a given profile.
 * Returns the same JSON shape as the old loadData(), plus a profileMeta field.
 */
function loadProfile(profileId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const result = {};

    // HC_{id}: positions ──────────────────────────────────────────────────────
    var hcSheet = ss.getSheetByName('HC_' + profileId);
    if (hcSheet && hcSheet.getLastRow() > 1) {
      const lastCol  = hcSheet.getLastColumn();
      const headerRow = hcSheet.getRange(1, 1, 1, lastCol).getValues()[0];
      const hasLevel  = String(headerRow[2]).trim() === 'Level';
      const dataOffset = hasLevel ? 4 : 3;
      const monthHeaders = headerRow.slice(dataOffset)
        .filter(function(h) { return h !== ''; })
        .map(function(h) {
          if (h instanceof Date) {
            return Utilities.formatDate(h, ss.getSpreadsheetTimeZone(), 'MMM-yyyy');
          }
          var s = String(h).trim();
          if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
            return Utilities.formatDate(new Date(s), ss.getSpreadsheetTimeZone(), 'MMM-yyyy');
          }
          return s;
        });
      const numCols = dataOffset + monthHeaders.length;
      const values  = hcSheet.getRange(2, 1, hcSheet.getLastRow() - 1, numCols).getValues();
      result.positions = values
        .filter(function(row) { return row[0] || row[1]; })
        .map(function(row, i) {
          var headcount = {};
          monthHeaders.forEach(function(m, j) { headcount[m] = row[dataOffset + j] || 0; });
          return {
            id: i + 1,
            department:    row[0],
            title:         row[1],
            level:         hasLevel ? (String(row[2]).trim() || 'Rank & File') : 'Rank & File',
            baseSalary:    hasLevel ? (row[3] || 0) : (row[2] || 0),
            salaryHistory: [],
            headcount:     headcount
          };
        });
      if (monthHeaders.length) result.timeline = monthHeaders;
    }

    // SB_{id}: assumptions + timeline ─────────────────────────────────────────
    var sbSheet = ss.getSheetByName('SB_' + profileId);
    if (sbSheet) {
      var metaJson = sbSheet.getRange('A1').getValue();
      if (metaJson) {
        try {
          var meta = JSON.parse(metaJson);
          if (meta.assumptions) result.assumptions = meta.assumptions;
          if (!result.timeline && meta.timeline) result.timeline = meta.timeline;
        } catch(ignored) {}
      }
    }

    // CAT_{id}: catalog ───────────────────────────────────────────────────────
    var catSheet = ss.getSheetByName('CAT_' + profileId);
    if (catSheet && catSheet.getLastRow() > 1) {
      var catVals = catSheet.getRange(2, 1, catSheet.getLastRow() - 1, 2).getValues();
      var catalog = {};
      catVals.forEach(function(row) {
        var dept  = String(row[0]).trim();
        var title = String(row[1]).trim();
        if (!dept) return;
        if (!catalog[dept]) catalog[dept] = [];
        if (title && catalog[dept].indexOf(title) === -1) catalog[dept].push(title);
      });
      result.catalog = catalog;
    }

    // SC_{id}: salary history ─────────────────────────────────────────────────
    var scSheet = ss.getSheetByName('SC_' + profileId);
    if (scSheet && scSheet.getLastRow() > 1 && result.positions) {
      var scVals = scSheet.getRange(2, 1, scSheet.getLastRow() - 1, 5).getValues();
      var salaryMap = {};
      scVals.forEach(function(row) {
        var dept   = String(row[0]).trim();
        var title  = String(row[1]).trim();
        var month  = String(row[2]).trim();
        var sal    = parseFloat(row[3]) || 0;
        var posRow = parseInt(row[4]) || 0;
        if (!dept || !title || !month || !sal) return;
        var key = posRow > 0 ? ('row:' + posRow) : (dept + '||' + title);
        if (!salaryMap[key]) salaryMap[key] = [];
        salaryMap[key].push({ effectiveMonth: month, salary: sal });
      });
      result.positions.forEach(function(pos, posIdx) {
        var idxKey    = 'row:' + (posIdx + 1);
        var legacyKey = pos.department + '||' + pos.title;
        pos.salaryHistory = salaryMap[idxKey] || salaryMap[legacyKey] || [];
      });
    }

    // Shared: SSS table ───────────────────────────────────────────────────────
    var sssSheet = ss.getSheetByName('SSS');
    if (sssSheet && sssSheet.getLastRow() > 1) {
      var sssVals = sssSheet.getRange(2, 1, sssSheet.getLastRow() - 1, 3).getValues();
      result.sssTable = sssVals
        .filter(function(r) { return r[0] !== '' && r[1] !== ''; })
        .map(function(r) { return { from: parseFloat(r[0])||0, to: parseFloat(r[1])||0, er: parseFloat(r[2])||0 }; });
    }

    // Shared: taxtable ────────────────────────────────────────────────────────
    var taxSheet = ss.getSheetByName('taxtable');
    if (taxSheet && taxSheet.getLastRow() > 1) {
      var taxVals = taxSheet.getRange(2, 1, taxSheet.getLastRow() - 1, 4).getValues();
      result.taxTable = taxVals
        .filter(function(r) { return r[1] !== ''; })
        .map(function(r) {
          return { from: parseFloat(r[0])||0, upto: parseFloat(r[1])||0,
                   percent: parseFloat(r[2])||0, fixed: parseFloat(r[3])||0 };
        });
    }

    // Profile metadata (name, category, description) ──────────────────────────
    var profilesSheet = ss.getSheetByName('Profiles');
    if (profilesSheet && profilesSheet.getLastRow() >= 2) {
      var pRows = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 4).getValues();
      for (var i = 0; i < pRows.length; i++) {
        if (parseInt(pRows[i][0]) === parseInt(profileId)) {
          result.profileMeta = {
            id:          parseInt(pRows[i][0]),
            name:        String(pRows[i][1]),
            category:    String(pRows[i][2]),
            description: String(pRows[i][3])
          };
          break;
        }
      }
    }

    return Object.keys(result).length ? JSON.stringify(result) : null;
  } catch(e) {
    return null;
  }
}

// _____________________________________________________________________________
// OPERATING EXPENSES PROFILE — SAVE & LOAD
// _____________________________________________________________________________

/**
 * Saves an Operating Expenses profile.
 * Writes line items to OPEX_{id} and assumptions/timeline JSON to OPEX_META_{id}.
 */
function saveOpExProfile(profileId, jsonData) {
  try {
    var parsed = JSON.parse(jsonData);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var timeline  = parsed.timeline  || [];
    var lineItems = parsed.lineItems || [];

    // OPEX_{id}: Line Items sheet
    var opexSheet = ss.getSheetByName('OPEX_' + profileId);
    if (!opexSheet) opexSheet = ss.insertSheet('OPEX_' + profileId);
    opexSheet.clearContents();

    var fixedHeaders = ['Category', 'Account Name', 'Cost Type', 'Item ID'];
    var totalCols = fixedHeaders.length + timeline.length;
    opexSheet.getRange(1, 1, 1, fixedHeaders.length).setValues([fixedHeaders]);
    if (timeline.length > 0) {
      opexSheet.getRange(1, fixedHeaders.length + 1, 1, timeline.length)
        .setNumberFormat('@STRING@').setValues([timeline]);
    }
    opexSheet.getRange(1, 1, 1, totalCols)
      .setFontWeight('bold').setBackground('#ea580c').setFontColor('#ffffff');

    var grandTotal = 0;
    if (lineItems.length > 0) {
      var rows = lineItems.map(function(item) {
        var monthAmounts = timeline.map(function(m) {
          var v = item.amounts ? (parseFloat(item.amounts[m]) || 0) : 0;
          grandTotal += v;
          return v;
        });
        return [item.category || '', item.account || '', item.costType || 'Fixed', item.id || 0]
          .concat(monthAmounts);
      });
      opexSheet.getRange(2, 1, rows.length, totalCols).setValues(rows);
      opexSheet.autoResizeColumns(1, 3);
    }

    // OPEX_META_{id}: Assumptions + Timeline JSON
    var metaSheet = ss.getSheetByName('OPEX_META_' + profileId);
    if (!metaSheet) metaSheet = ss.insertSheet('OPEX_META_' + profileId);
    metaSheet.getRange('A1').setValue(JSON.stringify({ assumptions: parsed.assumptions, timeline: timeline }));
    metaSheet.getRange('A2').setValue('Last Updated: ' + new Date().toLocaleString());

    // Update Profiles index row
    var now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMM dd, yyyy');
    var profilesSheet = ss.getSheetByName('Profiles');
    if (profilesSheet && profilesSheet.getLastRow() >= 2) {
      var idVals = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 1).getValues();
      for (var j = 0; j < idVals.length; j++) {
        if (parseInt(idVals[j][0]) === parseInt(profileId)) {
          profilesSheet.getRange(j + 2, 6).setValue(now);
          profilesSheet.getRange(j + 2, 7).setValue(lineItems.length); // line count
          profilesSheet.getRange(j + 2, 8).setValue(grandTotal);       // grand total
          break;
        }
      }
    }

    return { success: true, message: 'Saved!' };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * Loads an Operating Expenses profile.
 * Returns JSON: { lineItems, assumptions, timeline, profileMeta }
 */
function loadOpExProfile(profileId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var result = {};

    // OPEX_{id}: Line Items
    var opexSheet = ss.getSheetByName('OPEX_' + profileId);
    if (opexSheet && opexSheet.getLastRow() > 1) {
      var lastCol  = opexSheet.getLastColumn();
      var headerRow = opexSheet.getRange(1, 1, 1, lastCol).getValues()[0];
      // Fixed headers: Category(0), Account(1), CostType(2), ID(3), then months from col 5
      var monthHeaders = headerRow.slice(4).filter(function(h) { return h !== ''; }).map(function(h) {
        if (h instanceof Date) return Utilities.formatDate(h, ss.getSpreadsheetTimeZone(), 'MMM-yyyy');
        var s = String(h).trim();
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return Utilities.formatDate(new Date(s), ss.getSpreadsheetTimeZone(), 'MMM-yyyy');
        return s;
      });
      var numCols = 4 + monthHeaders.length;
      var values = opexSheet.getRange(2, 1, opexSheet.getLastRow() - 1, numCols).getValues();
      result.lineItems = values
        .filter(function(row) { return row[0] || row[1]; })
        .map(function(row) {
          var amounts = {};
          monthHeaders.forEach(function(m, j) {
            var v = parseFloat(row[4 + j]) || 0;
            if (v !== 0) amounts[m] = v;
          });
          return {
            id:       parseInt(row[3]) || 0,
            category: String(row[0]).trim(),
            account:  String(row[1]).trim(),
            costType: String(row[2]).trim() || 'Fixed',
            amounts:  amounts
          };
        });
      if (monthHeaders.length) result.timeline = monthHeaders;
    }

    // OPEX_META_{id}: Assumptions
    var metaSheet = ss.getSheetByName('OPEX_META_' + profileId);
    if (metaSheet) {
      var metaJson = metaSheet.getRange('A1').getValue();
      if (metaJson) {
        try {
          var meta = JSON.parse(metaJson);
          if (meta.assumptions) result.assumptions = meta.assumptions;
          if (!result.timeline && meta.timeline) result.timeline = meta.timeline;
        } catch(ignored) {}
      }
    }

    // Profile metadata
    var profilesSheet = ss.getSheetByName('Profiles');
    if (profilesSheet && profilesSheet.getLastRow() >= 2) {
      var pRows = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 4).getValues();
      for (var i = 0; i < pRows.length; i++) {
        if (parseInt(pRows[i][0]) === parseInt(profileId)) {
          result.profileMeta = {
            id:          parseInt(pRows[i][0]),
            name:        String(pRows[i][1]),
            category:    String(pRows[i][2]),
            description: String(pRows[i][3])
          };
          break;
        }
      }
    }

    return Object.keys(result).length ? JSON.stringify(result) : null;
  } catch(e) {
    return null;
  }
}

/**
 * Saves a Fixed Assets profile.
 * Writes asset registry to CAPEX_{id} and assumptions/timeline JSON to CAPEX_META_{id}.
 */
function saveCapExProfile(profileId, jsonData) {
  try {
    var parsed = JSON.parse(jsonData);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var timeline = parsed.timeline || [];
    var assets   = parsed.assets   || [];

    // CAPEX_{id}: Asset Registry sheet
    var capexSheet = ss.getSheetByName('CAPEX_' + profileId);
    if (!capexSheet) capexSheet = ss.insertSheet('CAPEX_' + profileId);
    capexSheet.clearContents();

    var fixedHeaders = ['Asset ID', 'Asset Name', 'Category', 'Acquisition Date',
      'Acquisition Cost', 'Useful Life (mo)', 'Residual Value', 'Method', 'Status'];
    capexSheet.getRange(1, 1, 1, fixedHeaders.length).setValues([fixedHeaders]);
    capexSheet.getRange(1, 1, 1, fixedHeaders.length)
      .setFontWeight('bold').setBackground('#7c3aed').setFontColor('#ffffff');

    if (assets.length > 0) {
      var rows = assets.map(function(a) {
        return [
          a.id || 0,
          a.name || '',
          a.category || '',
          a.acquisitionDate || '',
          a.acquisitionCost || 0,
          a.usefulLife || 0,
          a.residualValue || 0,
          a.method || 'Straight-Line',
          a.status || 'Active'
        ];
      });
      capexSheet.getRange(2, 1, rows.length, fixedHeaders.length).setValues(rows);
      capexSheet.autoResizeColumns(1, fixedHeaders.length);
    }

    // CAPEX_META_{id}: Assumptions + Timeline JSON + Assets blob
    var metaSheet = ss.getSheetByName('CAPEX_META_' + profileId);
    if (!metaSheet) metaSheet = ss.insertSheet('CAPEX_META_' + profileId);
    metaSheet.getRange('A1').setValue(JSON.stringify({ assumptions: parsed.assumptions, timeline: timeline }));
    metaSheet.getRange('A2').setValue('Assets JSON: ' + JSON.stringify(assets));
    metaSheet.getRange('A3').setValue('Last Updated: ' + new Date().toLocaleString());

    // Update Profiles index row
    var now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMM dd, yyyy');
    var profilesSheet = ss.getSheetByName('Profiles');
    if (profilesSheet && profilesSheet.getLastRow() >= 2) {
      var idVals = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 1).getValues();
      for (var j = 0; j < idVals.length; j++) {
        if (parseInt(idVals[j][0]) === parseInt(profileId)) {
          profilesSheet.getRange(j + 2, 6).setValue(now);
          profilesSheet.getRange(j + 2, 7).setValue(assets.length); // asset count
          profilesSheet.getRange(j + 2, 8).setValue(assets.reduce(function(s, a) { return s + (parseFloat(a.acquisitionCost) || 0); }, 0));
          break;
        }
      }
    }

    return { success: true, message: 'Saved!' };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * Loads a Fixed Assets profile.
 * Returns JSON: { assets, assumptions, timeline, profileMeta }
 */
function loadCapExProfile(profileId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var result = {};

    // CAPEX_META_{id}: Contains assumptions, timeline, and full assets JSON blob
    var metaSheet = ss.getSheetByName('CAPEX_META_' + profileId);
    if (metaSheet) {
      var metaJson = metaSheet.getRange('A1').getValue();
      if (metaJson) {
        try {
          var meta = JSON.parse(metaJson);
          if (meta.assumptions) result.assumptions = meta.assumptions;
          if (meta.timeline)    result.timeline    = meta.timeline;
        } catch(ignored) {}
      }
      // Assets are stored as JSON string on row 2
      var assetsJson = String(metaSheet.getRange('A2').getValue() || '');
      if (assetsJson.indexOf('Assets JSON: ') === 0) {
        try { result.assets = JSON.parse(assetsJson.replace('Assets JSON: ', '')); } catch(ignored) {}
      }
    }

    // Fallback: read CAPEX_{id} sheet if meta didn't have assets
    if (!result.assets) {
      var capexSheet = ss.getSheetByName('CAPEX_' + profileId);
      if (capexSheet && capexSheet.getLastRow() > 1) {
        var numCols = capexSheet.getLastColumn();
        var values  = capexSheet.getRange(2, 1, capexSheet.getLastRow() - 1, numCols).getValues();
        result.assets = values
          .filter(function(row) { return row[0] || row[1]; })
          .map(function(row) {
            return {
              id:              parseInt(row[0]) || 0,
              name:            String(row[1] || '').trim(),
              category:        String(row[2] || '').trim() || 'IT Equipment',
              acquisitionDate: String(row[3] || '').trim(),
              acquisitionCost: parseFloat(row[4]) || 0,
              usefulLife:      parseInt(row[5])   || 60,
              residualValue:   parseFloat(row[6]) || 0,
              method:          String(row[7] || '').trim() || 'Straight-Line',
              status:          String(row[8] || '').trim() || 'Active'
            };
          });
      }
    }

    // Profile metadata
    var profilesSheet = ss.getSheetByName('Profiles');
    if (profilesSheet && profilesSheet.getLastRow() >= 2) {
      var pRows = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 4).getValues();
      for (var k = 0; k < pRows.length; k++) {
        if (parseInt(pRows[k][0]) === parseInt(profileId)) {
          result.profileMeta = {
            id:          parseInt(pRows[k][0]),
            name:        String(pRows[k][1]),
            category:    String(pRows[k][2]),
            description: String(pRows[k][3])
          };
          break;
        }
      }
    }

    return Object.keys(result).length ? JSON.stringify(result) : null;
  } catch(e) {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// ■■ FINANCE & LIABILITIES — BACKEND ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// ════════════════════════════════════════════════════════════════════════

/**
 * saveFincProfile(profileId, jsonData)
 * Persists Finance & Liabilities data for the given profile.
 *
 * FINC_{id}      — one row per loan (registry mirror for quick read / external queries)
 * FINC_META_{id} — full JSON blob (loans, assumptions, timeline) in A1; loan count in A2
 */
function saveFincProfile(profileId, jsonData) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data;
    try { data = JSON.parse(jsonData); } catch(e) { return { success: false, message: 'Invalid JSON' }; }

    var loans       = data.loans       || [];
    var assumptions = data.assumptions || {};
    var timeline    = data.timeline    || [];

    // ── FINC_{id}: Loan registry rows ─────────────────────────────────────────
    var sheetName = 'FINC_' + profileId;
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);
    sheet.clearContents();
    var loanHeader = [['ID', 'Name', 'Loan Type', 'First Payment',
      'Principal', 'Term (mo.)', 'Annual Rate (%)', 'Interest Method', 'Processing Fee', 'Proceeds Receipt Date', 'Status', 'Payment Frequency', 'Pay Days', 'Pay Day Mode', 'Pay Days Per Month']];
    sheet.getRange(1, 1, 1, loanHeader[0].length).setValues(loanHeader);
    if (loans.length) {
      var rows = loans.map(function(l) {
        return [l.id || 0, l.name || '', l.loanType || '', l.disbursementDate || '',
          l.principal || 0, l.termMonths || 0, l.annualRate || 0,
          l.interestMethod || 'Reducing Balance', l.processingFee || 0, l.proceedsDate || '', l.status || 'Active',
          l.paymentFrequency || 'Monthly', l.payDays || '',
          l.payDayMode || 'Fixed',
          l.payDaysPerMonth ? JSON.stringify(l.payDaysPerMonth) : ''];
      });
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    }

    // ── FINC_META_{id}: Full JSON blob ────────────────────────────────────────
    var metaName = 'FINC_META_' + profileId;
    var metaSheet = ss.getSheetByName(metaName);
    if (!metaSheet) metaSheet = ss.insertSheet(metaName);
    metaSheet.clearContents();
    metaSheet.getRange('A1').setValue(jsonData);
    metaSheet.getRange('A2').setValue('Loans Count: ' + loans.length);

    // ── Profiles sheet: update loan count (col 7), projection (col 8), updated (col 6) ──
    var grandTotal = parseFloat(data.grandTotal) || 0;
    var now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMM dd, yyyy');
    var profilesSheet = ss.getSheetByName('Profiles');
    if (profilesSheet && profilesSheet.getLastRow() >= 2) {
      var idVals = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 1).getValues();
      for (var k = 0; k < idVals.length; k++) {
        if (parseInt(idVals[k][0]) === parseInt(profileId)) {
          profilesSheet.getRange(k + 2, 6).setValue(now);
          profilesSheet.getRange(k + 2, 7).setValue(loans.length);
          profilesSheet.getRange(k + 2, 8).setValue(grandTotal);
          break;
        }
      }
    }

    return { success: true };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

/**
 * loadFincProfile(profileId)
 * Returns a JSON string: { loans, assumptions, timeline, profileMeta }
 */
function loadFincProfile(profileId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var result = {};

    // FINC_META_{id}: Full JSON blob
    var metaSheet = ss.getSheetByName('FINC_META_' + profileId);
    if (metaSheet) {
      var metaJson = metaSheet.getRange('A1').getValue();
      if (metaJson) {
        try {
          var meta = JSON.parse(metaJson);
          if (meta.loans)       result.loans       = meta.loans;
          if (meta.assumptions) result.assumptions = meta.assumptions;
          if (meta.timeline)    result.timeline    = meta.timeline;
        } catch(ignored) {}
      }
    }

    // Fallback: read FINC_{id} sheet row by row if meta didn't have loans
    if (!result.loans) {
      var fincSheet = ss.getSheetByName('FINC_' + profileId);
      if (fincSheet && fincSheet.getLastRow() > 1) {
        var numCols = fincSheet.getLastColumn();
        var values  = fincSheet.getRange(2, 1, fincSheet.getLastRow() - 1, numCols).getValues();
        result.loans = values
          .filter(function(row) { return row[0] || row[1]; })
          .map(function(row) {
            return {
              id:               parseInt(row[0]) || 0,
              name:             String(row[1] || '').trim(),
              loanType:         String(row[2] || '').trim() || 'Term Loan',
              disbursementDate: String(row[3] || '').trim(),
              principal:        parseFloat(row[4]) || 0,
              termMonths:       parseInt(row[5])   || 60,
              annualRate:       parseFloat(row[6]) || 0,
              interestMethod:   String(row[7] || '').trim() || 'Reducing Balance',
              processingFee:    parseFloat(row[8]) || 0,
              proceedsDate:      String(row[9] || '').trim(),
              status:            String(row[10] || '').trim() || 'Active',
              paymentFrequency:  String(row[11] || '').trim() || 'Monthly',
              payDays:           String(row[12] || '').trim(),
              payDayMode:        String(row[13] || '').trim() || 'Fixed',
              payDaysPerMonth:   (function() { try { return JSON.parse(String(row[14] || '{}')); } catch(e) { return {}; } })()
            };
          });
      }
    }

    // Profile metadata
    var profilesSheet2 = ss.getSheetByName('Profiles');
    if (profilesSheet2 && profilesSheet2.getLastRow() >= 2) {
      var pRows = profilesSheet2.getRange(2, 1, profilesSheet2.getLastRow() - 1, 4).getValues();
      for (var j = 0; j < pRows.length; j++) {
        if (parseInt(pRows[j][0]) === parseInt(profileId)) {
          result.profileMeta = {
            id:          parseInt(pRows[j][0]),
            name:        String(pRows[j][1]),
            category:    String(pRows[j][2]),
            description: String(pRows[j][3])
          };
          break;
        }
      }
    }

    return Object.keys(result).length ? JSON.stringify(result) : null;
  } catch(e) {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// ■■ BUDGET WORKING PAPER — BACKEND ■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■
// ════════════════════════════════════════════════════════════════════════

/**
 * savePwpProfile(profileId, jsonData)
 * Stores the PWP configuration (linked profile IDs + timeline) in PWP_META_{id}.
 * Updates the Profiles index row (headcount column = number of linked profiles).
 */
function savePwpProfile(profileId, jsonData) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data;
    try { data = JSON.parse(jsonData); } catch(e) { return { success: false, message: 'Invalid JSON' }; }

    var cfg    = data.config || {};
    var linked = cfg.linkedProfiles || {};
    var linkedCount = Object.keys(linked).reduce(function(s, k) {
      return s + (Array.isArray(linked[k]) ? linked[k].length : 0);
    }, 0);

    // PWP_META_{id}: store the full config JSON
    var metaName = 'PWP_META_' + profileId;
    var metaSheet = ss.getSheetByName(metaName);
    if (!metaSheet) metaSheet = ss.insertSheet(metaName);
    metaSheet.clearContents();
    metaSheet.getRange('A1').setValue(jsonData);
    metaSheet.getRange('A2').setValue('Linked Profiles: ' + linkedCount);

    // Update Profiles index row
    var now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMM dd, yyyy');
    var profilesSheet = ss.getSheetByName('Profiles');
    if (profilesSheet && profilesSheet.getLastRow() >= 2) {
      var pData = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 8).getValues();
      for (var k = 0; k < pData.length; k++) {
        if (parseInt(pData[k][0]) === parseInt(profileId)) {
          profilesSheet.getRange(k + 2, 6).setValue(now);
          profilesSheet.getRange(k + 2, 7).setValue(linkedCount);
          break;
        }
      }
    }

    return { success: true };
  } catch(e) {
    return { success: false, message: e.message };
  }
}

/**
 * loadPwpProfile(profileId)
 * Returns JSON string: { config: { linkedProfiles, timeline }, profileMeta }
 */
function loadPwpProfile(profileId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var result = {};

    // PWP_META_{id}: full config JSON
    var metaSheet = ss.getSheetByName('PWP_META_' + profileId);
    if (metaSheet) {
      var metaJson = metaSheet.getRange('A1').getValue();
      if (metaJson) {
        try {
          var saved = JSON.parse(metaJson);
          if (saved.config) result.config = saved.config;
        } catch(ignored) {}
      }
    }

    // Profile metadata
    var profilesSheet = ss.getSheetByName('Profiles');
    if (profilesSheet && profilesSheet.getLastRow() >= 2) {
      var pRows = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 4).getValues();
      for (var i = 0; i < pRows.length; i++) {
        if (parseInt(pRows[i][0]) === parseInt(profileId)) {
          result.profileMeta = {
            id:          parseInt(pRows[i][0]),
            name:        String(pRows[i][1]),
            category:    String(pRows[i][2]),
            description: String(pRows[i][3])
          };
          break;
        }
      }
    }

    return Object.keys(result).length ? JSON.stringify(result) : null;
  } catch(e) {
    return null;
  }
}

/**
 * loadManpowerSummary(profileId)
 * Returns monthly projection totals for a manpower profile (HQ or Deployed).
 * Called by the Projection Working Paper to populate Personnel Costs.
 */
function loadManpowerSummary(profileId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var monthlyTotals = {};
    var grandTotal = 0;
    var isComponents = {};
    var isYearTotals = {};
    var serviceFeeMonthly = {};
    var serviceFeeGrandTotal = 0;
    var isDeployedRevenue = false;

    // Read summary data saved in SB_{id} A2
    var sbSheet = ss.getSheetByName('SB_' + profileId);
    if (sbSheet) {
      var a2val = sbSheet.getRange('A2').getValue();
      if (a2val && a2val.toString().charAt(0) === '{') {
        try {
          var a2parsed = JSON.parse(a2val);
          if (a2parsed.monthlyTotals)        monthlyTotals        = a2parsed.monthlyTotals;
          if (a2parsed.grandTotal)           grandTotal           = a2parsed.grandTotal;
          if (a2parsed.isComponents)         isComponents         = a2parsed.isComponents;
          if (a2parsed.isYearTotals)         isYearTotals         = a2parsed.isYearTotals;
          if (a2parsed.serviceFeeMonthly)    serviceFeeMonthly    = a2parsed.serviceFeeMonthly;
          if (a2parsed.serviceFeeGrandTotal) serviceFeeGrandTotal = a2parsed.serviceFeeGrandTotal;
          if (a2parsed.isDeployedRevenue)    isDeployedRevenue    = a2parsed.isDeployedRevenue;
        } catch(e) {}
      }
    }

    // Also read Profiles index for headcount + fallback total
    var profileMeta = { id: profileId, headcount: 0, projection: 0 };
    var profilesSheet = ss.getSheetByName('Profiles');
    if (profilesSheet && profilesSheet.getLastRow() >= 2) {
      var pRows2 = profilesSheet.getRange(2, 1, profilesSheet.getLastRow() - 1, 8).getValues();
      for (var j = 0; j < pRows2.length; j++) {
        if (parseInt(pRows2[j][0]) === parseInt(profileId)) {
          profileMeta = {
            id:          parseInt(pRows2[j][0]),
            name:        String(pRows2[j][1]),
            category:    String(pRows2[j][2]),
            description: String(pRows2[j][3]),
            headcount:   parseInt(pRows2[j][6]) || 0,
            projection:  parseFloat(pRows2[j][7]) || 0
          };
          if (!grandTotal) grandTotal = profileMeta.projection;
          break;
        }
      }
    }

    return JSON.stringify({
      monthlyTotals:        monthlyTotals,
      grandTotal:           grandTotal,
      isComponents:         isComponents,
      isYearTotals:         isYearTotals,
      serviceFeeMonthly:    serviceFeeMonthly,
      serviceFeeGrandTotal: serviceFeeGrandTotal,
      isDeployedRevenue:    isDeployedRevenue,
      profileMeta:          profileMeta
    });
  } catch(e) {
    return null;
  }
}
