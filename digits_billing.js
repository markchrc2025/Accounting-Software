/**
 * Creates a custom menu in the Google Sheets toolbar when the file is opened.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⚙️ Billing Automation')
    .addItem('Step 1: Consolidate Regional Sheets', 'consolidateRawSheets')
    .addItem('Step 2: Generate Detailed Client Invoices', 'generateClientBilling')
    .addItem('Step 3: Generate Formal Cover Sheets', 'generateCoverSheets')
    .addToUi();
}

/**
 * Helper function: Converts a column index (0, 1, 2) to a letter (A, B, C...)
 */
function getColLetter(colIndex) {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * STEP 1: Loops through all regional sheets and stacks them into "Raw_Billing"
 */
function consolidateRawSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let rawSheet = ss.getSheetByName("Raw_Billing");
  
  if (!rawSheet) {
    rawSheet = ss.insertSheet("Raw_Billing", 0); 
  } else {
    rawSheet.clear();
  }
  
  const allSheets = ss.getSheets();
  const sheetsToExclude = ["Raw_Billing", "Employee_Masterlist", "Summary"]; 
  
  let consolidatedData = [];
  let headersAdded = false;
  
  for (let i = 0; i < allSheets.length; i++) {
    let sheet = allSheets[i];
    let sheetName = sheet.getName();
    
    if (sheetsToExclude.indexOf(sheetName) === -1 && !sheetName.startsWith("Cover - ")) {
      let data = sheet.getDataRange().getValues();
      if (data.length <= 1) continue; 
      
      if (!headersAdded) {
        consolidatedData.push(data[0]); 
        headersAdded = true;
      }
      
      for (let r = 1; r < data.length; r++) {
        let row = data[r];
        let name = row[0];
        // Skip empty rows and the regional "Total" rows
        if (name && name.toString().trim().toLowerCase() !== 'total') {
           consolidatedData.push(row);
        }
      }
    }
  }
  
  if (consolidatedData.length > 0) {
    rawSheet.getRange(1, 1, consolidatedData.length, consolidatedData[0].length).setValues(consolidatedData);
    rawSheet.getRange(1, 1, 1, consolidatedData[0].length).setFontWeight("bold").setBackground("#d9ead3");
    SpreadsheetApp.getUi().alert(`✅ Step 1 Complete: ${consolidatedData.length - 1} employees consolidated into 'Raw_Billing'!`);
  } else {
    SpreadsheetApp.getUi().alert("⚠️ No valid data found to consolidate.");
  }
}

/**
 * STEP 2: Generates Client Invoices with Dynamic Formulas (Rate Math), Scrubbing, and Accounting Totals
 */
function generateClientBilling() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheet = ss.getSheetByName("Raw_Billing");
  const masterSheet = ss.getSheetByName("Employee_Masterlist");
  
  if (!rawSheet || !masterSheet) {
    SpreadsheetApp.getUi().alert("❌ Missing Sheets: Ensure 'Raw_Billing' and 'Employee_Masterlist' exist.");
    return;
  }
  
  const rawValues = rawSheet.getDataRange().getValues();
  const masterValues = masterSheet.getDataRange().getValues();
  
  // 1. Build Dictionary from Masterlist
  const employeeDirectory = {};
  for (let i = 1; i < masterValues.length; i++) {
    let billingCo = masterValues[i][0];
    let empName = masterValues[i][2];
    let branchName = masterValues[i][3];
    let companyName = masterValues[i][4];
    
    if (empName) {
      employeeDirectory[empName] = {
        billingCompany: billingCo || "Unassigned",
        branch: branchName || "",
        company: companyName || ""
      };
    }
  }

  // Define Headers & Create Index Map
  const rawHeaders = rawValues[0];
  const finalHeaders = [rawHeaders[0], "Branch Name", "Company", ...rawHeaders.slice(1)];
  const numCols = finalHeaders.length;
  
  let colMap = {};
  finalHeaders.forEach((h, i) => {
    let ht = h.toString().toLowerCase().trim();
    colMap[ht] = i;
  });

  // 19 TARGET COLUMNS FOR SUBTOTAL
  const targetColsForSubtotal = [
    "total basic salary", "overtime", "dod", "dod ot", 
    "spl holiday", "spl holiday ot", "spl holiday dod", "spl holiday dod ot", 
    "legal holiday", "legal holiday ot", "legal holiday dod", "legal holiday dod ot", 
    "night diff", "adjustment", "allowances", "sss", "pagibig", "philhealth", "13th month pay"
  ];
  
  // Create an array of all columns that receive formulas so we know to sum them at the bottom
  const formulaCols = [
    "regular", "lates amount", "total basic salary", "overtime", "dod", "dod ot", "spl holiday", 
    "spl holiday ot", "night diff", "13th month pay", "subtotal", "service fee", "total"
  ];
  const formulaColIndices = formulaCols.map(name => colMap[name]).filter(idx => idx !== undefined);

  // 2. Group Data & Scrub Text (days, mins, hrs) into pure numbers
  const groupedData = {};
  for (let i = 1; i < rawValues.length; i++) {
    let row = rawValues[i];
    let name = row[0];
    
    if (!name || name.toString().trim().toLowerCase() === 'total') continue; 
    
    let cleanedRow = row.map(cell => {
      if (typeof cell === 'string') {
        let cleaned = cell.replace(/\b(days|mins|hrs)\b/gi, '').trim();
        return (cleaned !== "" && !isNaN(cleaned)) ? Number(cleaned) : cleaned;
      }
      return cell;
    });
    
    let mapping = employeeDirectory[name] || { billingCompany: "Unassigned", branch: "Unknown", company: "Unknown" };
    
    let billCo = mapping.billingCompany;
    let groupKey = mapping.branch + "|" + mapping.company; 
    
    if (!groupedData[billCo]) groupedData[billCo] = { groups: {} };
    if (!groupedData[billCo].groups[groupKey]) groupedData[billCo].groups[groupKey] = [];
    
    let newRow = [name, mapping.branch, mapping.company, ...cleanedRow.slice(1)];
    groupedData[billCo].groups[groupKey].push(newRow);
  }
  
  // 3. Generate Sheets and Inject Formulas
  for (const billCo in groupedData) {
    let clientSheet = ss.getSheetByName(billCo);
    if (!clientSheet) {
      clientSheet = ss.insertSheet(billCo);
    } else {
      clientSheet.clear(); 
      clientSheet.clearFormats(); 
    }
    
    let sheetData = [];
    let emptyRow = new Array(numCols).fill("");
    
    // --- TOP SUMMARY HEADERS ---
    sheetData.push(emptyRow); 
    let titleRow = new Array(numCols).fill(""); titleRow[1] = billCo; 
    sheetData.push(titleRow); 
    let subRow = new Array(numCols).fill(""); subRow[0] = "Subtotal:"; 
    sheetData.push(subRow); 
    let vatRow = new Array(numCols).fill(""); vatRow[0] = "VAT (12%)"; 
    sheetData.push(vatRow); 
    let totRow = new Array(numCols).fill(""); totRow[0] = "Total"; 
    sheetData.push(totRow); 
    sheetData.push(emptyRow); 
    sheetData.push(emptyRow); 
    sheetData.push(finalHeaders); // Row 8
    
    let currentRow = 9; 
    let branchTotalCellsForSummary = []; 
    let branchTotalRowIndices = []; 
    let activeColumnsForGrandTotal = new Set(); 

    // --- GROUPED EMPLOYEE DATA ---
    for (const groupKey in groupedData[billCo].groups) {
      let groupRows = groupedData[billCo].groups[groupKey];
      let startRow = currentRow;
      
      for (let r = 0; r < groupRows.length; r++) {
        let empRow = [...groupRows[r]];
        
        let cellRef = (colName) => colMap[colName] !== undefined ? getColLetter(colMap[colName]) + currentRow : null;
        let dr = cellRef("daily rate");
        
        // Custom Math Formulas
        if (colMap["regular"] !== undefined && dr && cellRef("days")) {
          empRow[colMap["regular"]] = `=${dr}*${cellRef("days")}`;
        }
        if (colMap["lates amount"] !== undefined && dr && cellRef("lates")) {
          empRow[colMap["lates amount"]] = `=-(${dr}/8/60*${cellRef("lates")})`;
        }
        if (colMap["total basic salary"] !== undefined && colMap["regular"] !== undefined && colMap["lates amount"] !== undefined) {
          empRow[colMap["total basic salary"]] = `=${cellRef("regular")}+${cellRef("lates amount")}`;
        }
        if (colMap["overtime"] !== undefined && dr && cellRef("overtime hrs")) {
          empRow[colMap["overtime"]] = `=${dr}/8*1.25*${cellRef("overtime hrs")}`;
        }
        if (colMap["dod"] !== undefined && dr && cellRef("dod hrs")) {
          empRow[colMap["dod"]] = `=${dr}/8*1.3*${cellRef("dod hrs")}`;
        }
        if (colMap["dod ot"] !== undefined && dr && cellRef("dod ot hrs")) {
          empRow[colMap["dod ot"]] = `=${dr}/8*1.69*${cellRef("dod ot hrs")}`;
        }
        if (colMap["spl holiday"] !== undefined && dr && cellRef("spl holiday hrs")) {
          empRow[colMap["spl holiday"]] = `=${dr}/8*0.3*${cellRef("spl holiday hrs")}`;
        }
        if (colMap["spl holiday ot"] !== undefined && dr && cellRef("spl holiday ot hrs")) {
          empRow[colMap["spl holiday ot"]] = `=${dr}/8*0.44*${cellRef("spl holiday ot hrs")}`;
        }
        if (colMap["night diff"] !== undefined && dr && cellRef("night diff hrs")) {
          empRow[colMap["night diff"]] = `=${dr}/8*0.1*${cellRef("night diff hrs")}`;
        }
        if (colMap["13th month pay"] !== undefined && colMap["regular"] !== undefined) {
          empRow[colMap["13th month pay"]] = `=${cellRef("regular")}/12`;
        }
        
        // Standard Subtotals & Totals
        if (colMap["subtotal"] !== undefined) {
          let formulaParts = targetColsForSubtotal.map(name => cellRef(name)).filter(x => x);
          if (formulaParts.length > 0) empRow[colMap["subtotal"]] = `=SUM(${formulaParts.join(",")})`;
        }
        if (colMap["service fee"] !== undefined && colMap["subtotal"] !== undefined) {
          empRow[colMap["service fee"]] = `=ROUND(${cellRef("subtotal")}*0.10, 2)`;
        }
        if (colMap["total"] !== undefined && colMap["subtotal"] !== undefined && colMap["service fee"] !== undefined) {
          empRow[colMap["total"]] = `=${cellRef("subtotal")}+${cellRef("service fee")}`;
        }
        
        sheetData.push(empRow);
        currentRow++;
      }
      
      let endRow = currentRow - 1;
      
      // --- BRANCH TOTAL ROW ---
      let branchTotalRow = new Array(numCols).fill("");
      branchTotalRow[0] = "Total";
      
      for (let c = 5; c < numCols; c++) {
        let hasNumber = false;
        for (let r = 0; r < groupRows.length; r++) {
           let mappedVal = groupRows[r][c];
           if (formulaColIndices.includes(c)) {
               hasNumber = true; 
           } else if (!isNaN(parseFloat(mappedVal)) && mappedVal !== "") {
               hasNumber = true; 
           }
        }
        if (hasNumber) {
           let colLetter = getColLetter(c);
           branchTotalRow[c] = `=SUM(${colLetter}${startRow}:${colLetter}${endRow})`;
           activeColumnsForGrandTotal.add(c); 
        }
      }
      
      sheetData.push(branchTotalRow);
      branchTotalRowIndices.push(currentRow); 
      
      if (colMap["total"] !== undefined) {
        branchTotalCellsForSummary.push(`${getColLetter(colMap["total"])}${currentRow}`);
      }
      
      currentRow++; 
      sheetData.push(emptyRow); 
      currentRow++;
    }
    
    // --- BUILD THE GRAND TOTAL ROW ---
    let grandTotalRow = new Array(numCols).fill("");
    grandTotalRow[0] = "GRAND TOTAL";
    
    for (let c of activeColumnsForGrandTotal) {
      let colLetter = getColLetter(c);
      let cellsToSum = branchTotalRowIndices.map(r => `${colLetter}${r}`);
      grandTotalRow[c] = `=SUM(${cellsToSum.join(",")})`;
    }
    
    sheetData.push(grandTotalRow);
    
    // --- INJECT TOP SUMMARY FORMULAS ---
    if (branchTotalCellsForSummary.length > 0) {
      sheetData[2][1] = `=SUM(${branchTotalCellsForSummary.join(",")})`; 
      sheetData[3][1] = `=ROUND(B3 * 0.12, 2)`; 
      sheetData[4][1] = `=B3 + B4`; 
    }
    
    // --- WRITE TO SHEET & APPLY ACCOUNTING FORMATS ---
    clientSheet.getRange(1, 1, sheetData.length, numCols).setValues(sheetData);
    clientSheet.getRange(2, 2).setFontWeight("bold").setFontSize(12);
    clientSheet.getRange(3, 1, 3, 2).setFontWeight("bold"); 
    clientSheet.getRange(8, 1, 1, numCols).setFontWeight("bold").setBackground("#f3f3f3");
    
    clientSheet.getRange(9, 6, sheetData.length - 8, numCols - 5).setNumberFormat("#,##0.00");
    clientSheet.getRange("B3:B5").setNumberFormat("#,##0.00");
    
    // Apply Accounting Borders to Total / Grand Total rows
    for (let r = 0; r < sheetData.length; r++) {
      let rowLabel = sheetData[r][0] ? sheetData[r][0].toString().toUpperCase() : "";
      
      if ((rowLabel === "TOTAL" || rowLabel === "GRAND TOTAL") && r > 7) { 
        let range = clientSheet.getRange(r + 1, 1, 1, numCols);
        range.setFontWeight("bold");
        
        range.setBorder(true, false, false, false, false, false, "#000000", SpreadsheetApp.BorderStyle.SOLID);
        range.setBorder(false, false, true, false, false, false, "#000000", SpreadsheetApp.BorderStyle.DOUBLE);
      }
    }
    
    clientSheet.autoResizeColumns(1, numCols);
  }
  
  SpreadsheetApp.getUi().alert("✅ Success: Invoices generated with fully mapped rate calculations!");
}

/**
 * STEP 3: Generates the formal Invoice Topsheet for each client, linked to their data.
 */
function generateCoverSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  
  const periodResponse = ui.prompt(
    'Billing Period', 
    'Enter the period for the particulars (e.g., February 16-28, 2026):', 
    ui.ButtonSet.OK_CANCEL
  );
  if (periodResponse.getSelectedButton() !== ui.Button.OK) return;
  const billingPeriod = periodResponse.getResponseText();
  
  const billNumResponse = ui.prompt(
    'Billing Number', 
    'Enter the Invoice/Billing # (e.g., WS-001005):', 
    ui.ButtonSet.OK_CANCEL
  );
  if (billNumResponse.getSelectedButton() !== ui.Button.OK) return;
  const billingNum = billNumResponse.getResponseText();

  const companyTINs = {
    "DiGiTalks": "607-772-309-000",
    "DiGiTalks-Gashapon": "607-772-309-000",
    "Happy Surprises Corp.": "607-772-309-000",
    "HSC": "607-772-309-000",
    "BoxTalks": "009-234-042-000",
    "Digital Walker Corp.": "007-105-295-000",
    "Digital Walker": "007-105-295-000",
    "DGNation": "763-676-229-000",
    "Digits Trading Corp": "007-105-295-000",
    "DiGiTs Trading Corp.": "007-105-295-000"
  };

  const companyAddress = "#56 Mayor Ignacio Diaz St. San Marin De Porres Cubao Quezon City, Metro Manila";
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEEE, d MMMM yyyy");

  const allSheets = ss.getSheets();
  const sheetsToExclude = ["Raw_Billing", "Employee_Masterlist", "Summary"]; 
  let generatedCount = 0;

  for (let i = 0; i < allSheets.length; i++) {
    let detailSheet = allSheets[i];
    let sheetName = detailSheet.getName();
    
    if (sheetsToExclude.indexOf(sheetName) === -1 && !sheetName.startsWith("Cover - ")) {
      
      let coverName = "Cover - " + sheetName;
      let coverSheet = ss.getSheetByName(coverName);
      
      if (!coverSheet) {
        coverSheet = ss.insertSheet(coverName, i); 
      } else {
        coverSheet.clear();
      }
      
      let tin = companyTINs[sheetName] || "XXX-XXX-XXX-000";
      let safeSheetName = `'${sheetName}'`;

      let payload = [
        ["", "", "", ""], 
        ["", "", "", ""],
        ["", "", "", ""],
        ["", "", "", ""],
        ["", "", "", ""],
        ["", "", "", ""], 
        ["To:", sheetName, "", ""], 
        ["Address:", companyAddress, "", ""], 
        ["TIN:", tin, "", ""], 
        ["Terms:", "15 days", "", ""], 
        ["Billing #", billingNum, "", ""], 
        ["Date:", today, "", ""], 
        ["", "", "", ""], 
        ["Particulars:", `Services rendered by employees for the period of ${billingPeriod}`, "", ""], 
        ["", "for the following company:", "", ""], 
        ["", "", "", ""], 
        ["", "Services rendered", "P", `=${safeSheetName}!B3`], 
        ["", "VAT (12%)", "P", `=${safeSheetName}!B4`], 
        ["", "Total", "P", `=${safeSheetName}!B5`], 
        ["", "EWT (2%)", "P", `=ROUND(D17 * 0.02, 2)`], 
        ["", "Grand Total", "P", `=D19 - D20`], 
        ["", "", "", ""], 
        ["", "", "", ""], 
        ["Please make check payable to:", "", "", ""], 
        ["Account name:", "Workscale Resources Inc.", "", ""], 
        ["Account No.:", "'002570018928", "", ""], 
        ["Bank:", "Unionbank (Greenhills branch)", "", ""], 
        ["", "", "", ""], 
        ["", "", "", ""], 
        ["", "", "", ""], 
        ["Prepared by:", "", "", "Noted by:"], 
        ["", "", "", ""], 
        ["", "", "", ""], 
        ["Patrick Palman", "", "", "Christian Canlubo"], 
        ["Billing and Collection", "", "", "CFO"] 
      ];

      coverSheet.getRange(1, 1, payload.length, 4).setValues(payload);

      // Formatting Adjustments
      coverSheet.setHiddenGridlines(true); 
      coverSheet.setColumnWidth(1, 150); // Increased slightly for signature labels
      coverSheet.setColumnWidth(2, 350); 
      coverSheet.setColumnWidth(3, 40);  
      coverSheet.setColumnWidth(4, 150); 
      
      // Top section left alignment
      coverSheet.getRange("A7:A14").setFontWeight("bold").setHorizontalAlignment("left");
      coverSheet.getRange("B12").setHorizontalAlignment("left"); // Date alignment
      
      coverSheet.getRange("B17:B21").setFontWeight("bold");
      
      // Banking info & signatories
      coverSheet.getRange("A24:A27").setFontWeight("bold").setHorizontalAlignment("left");
      coverSheet.getRange("A31").setFontWeight("bold").setHorizontalAlignment("left");
      coverSheet.getRange("D31").setFontWeight("bold").setHorizontalAlignment("left");
      
      coverSheet.getRange("C17:C21").setHorizontalAlignment("center");
      coverSheet.getRange("D17:D21").setNumberFormat("#,##0.00");
      
      // Top borders for Total and Grand Total
      coverSheet.getRange("D19").setBorder(true, false, false, false, false, false, "#000000", SpreadsheetApp.BorderStyle.SOLID);
      coverSheet.getRange("D21").setBorder(true, false, false, false, false, false, "#000000", SpreadsheetApp.BorderStyle.SOLID);
      
      generatedCount++;
    }
  }
  
  ui.alert(`✅ Success: Generated ${generatedCount} Cover Sheets!\nThey have been aligned to the left and populated with your new banking/signatory details.`);
}