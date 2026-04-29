/**
 * Creates a custom menu in the Google Sheets toolbar when the file is opened.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🚀 Cosmos Billing Automation')
    .addItem('Generate Cosmos Computation & Summary', 'generateCosmosBilling')
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
 * Generates the Cosmos Billing Computation & Formal Summary by scanning regional sheets
 */
function generateCosmosBilling() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  
  // 1. Prompt for Invoice Details
  const clientNameResponse = ui.prompt('Client Name', 'Enter the Client Name (e.g., Cosmos Bazar Inc.):', ui.ButtonSet.OK_CANCEL);
  if (clientNameResponse.getSelectedButton() !== ui.Button.OK) return;
  const clientName = clientNameResponse.getResponseText();
  
  const periodResponse = ui.prompt('Billing Period', 'Enter period (e.g., March 1-15, 2026):', ui.ButtonSet.OK_CANCEL);
  if (periodResponse.getSelectedButton() !== ui.Button.OK) return;
  const billingPeriod = periodResponse.getResponseText();
  
  const billNumResponse = ui.prompt('Control No.', 'Enter the Control/Billing # (e.g., WS-001015):', ui.ButtonSet.OK_CANCEL);
  if (billNumResponse.getSelectedButton() !== ui.Button.OK) return;
  const controlNo = billNumResponse.getResponseText();
  
  const sfResponse = ui.prompt('Service Fee', 'Enter the Service Fee percentage (e.g., 10 or 12):', ui.ButtonSet.OK_CANCEL);
  if (sfResponse.getSelectedButton() !== ui.Button.OK) return;
  
  // Clean the input and convert to decimal (e.g., "12" -> 0.12)
  let sfText = sfResponse.getResponseText().replace('%', '').trim();
  let serviceFeeVal = parseFloat(sfText);
  if (isNaN(serviceFeeVal)) {
    ui.alert("⚠️ Invalid Service Fee percentage. Please run the script again and enter a valid number.");
    return;
  }
  const serviceFeeDecimal = serviceFeeVal / 100;
  
  // 2. Define Full Cosmos Output Headers (40 Columns)
  const cosmosHeaders = [
    "Name", "Daily Rate", "Days", "Regular", "Lates", "Lates Amount", 
    "Total Basic Salary", "Overtime Hrs", "Overtime", "DOD Hrs", "DOD", 
    "DOD OT Hrs", "DOD OT", "Spl Holiday Hrs", "Spl Holiday", 
    "Spl Holiday OT Hrs", "Spl Holiday OT", "Spl Holiday DOD Hrs", 
    "Spl Holiday DOD", "Spl Holiday DOD OT Hrs", "Spl Holiday DOD OT", 
    "Legal Holiday Hrs", "Legal Holiday", "Legal Holiday OT Hrs", 
    "Legal Holiday OT", "Legal Holiday DOD Hrs", "Legal Holiday DOD", 
    "Legal Holiday DOD OT Hrs", "Legal Holiday DOD OT", "Night Diff Hrs", 
    "Night Diff", "Adjustment", "Allowances", "SSS", "Pagibig", 
    "Philhealth", "13th Month Pay", "Subtotal", "Service Fee", "Total"
  ];
  const numCols = cosmosHeaders.length;

  let colMap = {};
  cosmosHeaders.forEach((h, i) => { colMap[h.toLowerCase().trim()] = i; });

  const targetColsForSubtotal = [
    "total basic salary", "overtime", "dod", "dod ot", 
    "spl holiday", "spl holiday ot", "spl holiday dod", "spl holiday dod ot", 
    "legal holiday", "legal holiday ot", "legal holiday dod", "legal holiday dod ot", 
    "night diff", "adjustment", "allowances", "sss", "pagibig", "philhealth", "13th month pay"
  ];

  const formulaCols = [
    "regular", "lates amount", "total basic salary", "overtime", "dod", "dod ot", "spl holiday", 
    "spl holiday ot", "night diff", "13th month pay", "subtotal", "service fee", "total"
  ];
  const formulaColIndices = formulaCols.map(name => colMap[name]).filter(idx => idx !== undefined);

  const allSheets = ss.getSheets();
  const sheetsToExclude = ["BILLING COMPUTATION", "BILLING SUMMARY", "Summary", "Employee_Masterlist", "Raw_Billing"]; 
  
  const groupedData = {};

  // 3. Scan all Regional Sheets directly
  for (let i = 0; i < allSheets.length; i++) {
    let sheet = allSheets[i];
    let regionName = sheet.getName();
    
    // Process only if it's a valid regional data sheet
    if (sheetsToExclude.indexOf(regionName) === -1) {
      let data = sheet.getDataRange().getValues();
      if (data.length <= 1) continue; 
      
      let rawHeaders = data[0];
      let rawColMap = {};
      rawHeaders.forEach((h, idx) => { rawColMap[h.toString().toLowerCase().trim()] = idx; });

      const getRaw = (row, possibleNames) => {
        for (let name of possibleNames) {
          if (rawColMap[name] !== undefined) return row[rawColMap[name]];
        }
        return "";
      };

      let cleanVal = (val) => {
        if (typeof val === 'string') {
          let scrubbed = val.replace(/\b(days|mins|hrs)\b/gi, '').trim();
          return (scrubbed !== "" && !isNaN(scrubbed)) ? Number(scrubbed) : scrubbed;
        }
        return val;
      };

      if (!groupedData[regionName]) {
        groupedData[regionName] = [];
      }

      for (let r = 1; r < data.length; r++) {
        let row = data[r];
        let nameVal = getRaw(row, ["name"]) || row[0]; 
        
        if (!nameVal || nameVal.toString().trim().toLowerCase() === 'total') continue; 

        let empData = new Array(numCols).fill("");
        
        // Dynamically map all 40 columns from the raw sheet to the output array
        cosmosHeaders.forEach((header, idx) => {
          let cleanH = header.toLowerCase().trim();
          let possibleNames = [cleanH];
          
          // Add fallback names for specific Cosmos variations
          if (cleanH === 'allowances') possibleNames.push('transpo allowance', 'allowance');
          if (cleanH === 'adjustment') possibleNames.push('adjustments');
          if (cleanH === 'pagibig') possibleNames.push('pag-ibig');
          if (cleanH === '13th month pay') possibleNames.push('13th month');
          
          empData[idx] = cleanVal(getRaw(row, possibleNames));
        });

        groupedData[regionName].push(empData);
      }
    }
  }

  if (Object.keys(groupedData).length === 0) {
    ui.alert("⚠️ No regional data found. Please ensure your raw sheets are uploaded.");
    return;
  }
  
  // 4. Build the BILLING COMPUTATION Sheet
  let compSheet = ss.getSheetByName("BILLING COMPUTATION");
  if (!compSheet) compSheet = ss.insertSheet("BILLING COMPUTATION", 0);
  else compSheet.clear().clearFormats();
  
  let sheetData = [];
  let emptyRow = new Array(numCols).fill("");
  
  // Adjust alignments to Column A (index 0)
  sheetData.push(emptyRow);
  let c1 = new Array(numCols).fill(""); c1[0] = clientName; sheetData.push(c1);
  sheetData.push(emptyRow);
  let c2 = new Array(numCols).fill(""); c2[0] = `Billing ${billingPeriod}`; sheetData.push(c2);
  sheetData.push(emptyRow);
  let c3 = new Array(numCols).fill(""); c3[0] = "Control No."; c3[1] = controlNo; sheetData.push(c3);
  let c4 = new Array(numCols).fill(""); c4[0] = "Subtotal:"; sheetData.push(c4); // A7
  let c5 = new Array(numCols).fill(""); c5[0] = "VAT (12%):"; sheetData.push(c5); // A8
  let c6 = new Array(numCols).fill(""); c6[0] = "TOTAL"; sheetData.push(c6); // A9
  sheetData.push(emptyRow); // Row 10
  
  let currentRow = 11; 
  let totalRowsFormatCoords = [];
  let branchTotalRowIndices = []; 
  let activeColumnsForGrandTotal = new Set(); 

  for (const region in groupedData) {
    let rName = new Array(numCols).fill(""); rName[0] = region; // Region header in Column A
    sheetData.push(rName); 
    sheetData.push(cosmosHeaders); 
    currentRow += 2;
    
    let startRow = currentRow;
    let groupRows = groupedData[region];
    
    for (let r = 0; r < groupRows.length; r++) {
      let empRow = [...groupRows[r]];
      
      let cellRef = (colName) => colMap[colName] !== undefined ? getColLetter(colMap[colName]) + currentRow : null;
      let dr = cellRef("daily rate");

      // Inject Formulas dynamically based on the mapped indices
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
      
      // Subtotal, Service Fee (Custom % for Cosmos), and Total
      if (colMap["subtotal"] !== undefined) {
        let formulaParts = targetColsForSubtotal.map(name => cellRef(name)).filter(x => x);
        if (formulaParts.length > 0) empRow[colMap["subtotal"]] = `=SUM(${formulaParts.join(",")})`;
      }
      if (colMap["service fee"] !== undefined && colMap["subtotal"] !== undefined) {
        empRow[colMap["service fee"]] = `=ROUND(${cellRef("subtotal")}*${serviceFeeDecimal}, 2)`;
      }
      if (colMap["total"] !== undefined && colMap["subtotal"] !== undefined && colMap["service fee"] !== undefined) {
        empRow[colMap["total"]] = `=${cellRef("subtotal")}+${cellRef("service fee")}`;
      }
      
      sheetData.push(empRow);
      currentRow++;
    }
    
    let endRow = currentRow - 1;
    
    // Build Region Total Row
    let branchTotalRow = new Array(numCols).fill("");
    branchTotalRow[0] = "Total";
    
    for (let c = 3; c < numCols; c++) {
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
    totalRowsFormatCoords.push(currentRow);
    branchTotalRowIndices.push(currentRow);
    
    currentRow++; 
    sheetData.push(emptyRow); 
    sheetData.push(emptyRow); 
    currentRow += 2;
  }
  
  // Build Overall GRAND TOTAL Row at the bottom of the regions
  let grandTotalRow = new Array(numCols).fill("");
  grandTotalRow[0] = "GRAND TOTAL";
  
  for (let c of activeColumnsForGrandTotal) {
    let colLetter = getColLetter(c);
    let cellsToSum = branchTotalRowIndices.map(r => `${colLetter}${r}`);
    grandTotalRow[c] = `=SUM(${cellsToSum.join(",")})`;
  }
  
  sheetData.push(grandTotalRow);
  totalRowsFormatCoords.push(currentRow); // Format the Grand Total row exactly like a branch total
  let grandTotalRowNum = currentRow; // Capture the row number of the GRAND TOTAL
  
  // Link the top summary directly to the Total column (Column AN) of the Grand Total row
  if (colMap["total"] !== undefined) {
    let totalColLetter = getColLetter(colMap["total"]); // e.g., "AN"
    sheetData[6][1] = `=${totalColLetter}${grandTotalRowNum}`; // B7 (Subtotal pulls from Grand Total's Total column)
    sheetData[7][1] = `=B7 * 0.12`; // B8 (VAT - Standard 12%)
    sheetData[8][1] = `=B7 + B8`; // B9 (TOTAL)
  }
  
  // Render and Format Computation Sheet
  compSheet.getRange(1, 1, sheetData.length, numCols).setValues(sheetData);
  compSheet.getRange("A2:A9").setFontWeight("bold");
  compSheet.getRange("B7:B9").setNumberFormat("#,##0.00");
  
  // Format numbers to Accounting format for the employee rows
  compSheet.getRange(11, 2, sheetData.length, numCols - 1).setNumberFormat("#,##0.00");
  
  // Iterate format arrays for Region Labels, Headers, and Totals
  let rCount = 11;
  for (const region in groupedData) {
    // Highlight the entire Region row across all columns with Gray
    compSheet.getRange(rCount, 1, 1, numCols).setFontWeight("bold").setFontSize(11).setBackground("#d9d9d9"); 
    compSheet.getRange(rCount + 1, 1, 1, numCols).setFontWeight("bold").setBackground("#f3f3f3"); // Header row
    rCount += groupedData[region].length + 5;
  }
  for(let row of totalRowsFormatCoords) {
    let range = compSheet.getRange(row, 1, 1, numCols);
    range.setFontWeight("bold");
    // Use 'null' instead of 'false' to prevent overwriting existing borders
    range.setBorder(true, null, null, null, null, null, "#000000", SpreadsheetApp.BorderStyle.SOLID);
    range.setBorder(null, null, true, null, null, null, "#000000", SpreadsheetApp.BorderStyle.DOUBLE);
  }
  compSheet.autoResizeColumns(1, numCols);

  // 5. Build the BILLING SUMMARY (Cover Sheet)
  let sumSheet = ss.getSheetByName("BILLING SUMMARY");
  if (!sumSheet) sumSheet = ss.insertSheet("BILLING SUMMARY", 1);
  else sumSheet.clear().clearFormats();
  
  // Format to long date: "Weekday, Month Day, Year" (e.g., "Thursday, March 5, 2026")
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "EEEE, MMMM d, yyyy");
  
  // Revised 4-Column Layout
  let summaryPayload = [
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["To:", clientName, "", ""], 
    ["Date:", today, "", ""], 
    ["Billing #", controlNo, "", ""], 
    ["Terms:", "15 days", "", ""], 
    ["", "", "", ""], 
    ["Particulars:", `Services rendered by employees for the period of ${billingPeriod}`, "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "Services rendered", "P", `='BILLING COMPUTATION'!B7`], 
    ["", "VAT (12%)", "P", `='BILLING COMPUTATION'!B8`], 
    ["", "Total", "P", `='BILLING COMPUTATION'!B9`], 
    ["", "EWT", "P", `=ROUND(D18 * 0.02, 5)`], 
    ["", "GRAND TOTAL ", "P", `=D20 - D21`], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["Please make check payable to:", "", "", ""], 
    ["Account name:", "Workscale Resources Inc.", "", ""], 
    ["Account No.:", "'002570018928", "", ""], // Leading zeros retained via plain text
    ["Bank:", "Unionbank (Greenhills branch)", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["Prepared by:", "", "", "Noted by:"], 
    ["", "", "", ""], 
    ["", "", "", ""], 
    ["Patrick Palman", "", "", "Christian Canlubo"], 
    ["Billing and Collection", "", "", "CFO"] 
  ];
  
  sumSheet.getRange(1, 1, summaryPayload.length, 4).setValues(summaryPayload);
  
  // Format Cover Sheet
  sumSheet.setHiddenGridlines(true);
  sumSheet.setColumnWidth(1, 150); 
  sumSheet.setColumnWidth(2, 350); // Widened to properly contain the longer left-aligned values
  sumSheet.setColumnWidth(3, 40); 
  sumSheet.setColumnWidth(4, 150);  
  
  // Left-Align To, Date, Billing #, Terms labels
  sumSheet.getRange("A9:A12").setFontWeight("bold").setHorizontalAlignment("left");
  
  // Left-Align the values for To, Date, Billing #, and Terms
  sumSheet.getRange("B9:B12").setHorizontalAlignment("left");
  
  sumSheet.getRange("A14").setFontWeight("bold").setHorizontalAlignment("left");
  
  sumSheet.getRange("B18:B22").setFontWeight("bold");
  sumSheet.getRange("C18:C22").setHorizontalAlignment("center");
  
  // Left-Align Banking and Sig labels
  sumSheet.getRange("A26:A29").setFontWeight("bold").setHorizontalAlignment("left");
  
  sumSheet.getRange("A35").setFontWeight("bold").setHorizontalAlignment("left");
  sumSheet.getRange("D35").setFontWeight("bold").setHorizontalAlignment("left");
  
  // Number formats & Borders
  sumSheet.getRange("D18:D22").setNumberFormat("#,##0.00");
  
  // Use 'null' to stack borders properly without erasing each other
  sumSheet.getRange("D20").setBorder(true, null, null, null, null, null, "#000000", SpreadsheetApp.BorderStyle.SOLID);
  sumSheet.getRange("D22").setBorder(true, null, null, null, null, null, "#000000", SpreadsheetApp.BorderStyle.SOLID);
  sumSheet.getRange("D22").setBorder(null, null, true, null, null, null, "#000000", SpreadsheetApp.BorderStyle.DOUBLE);
  
  ui.alert(`✅ Cosmos Success: 4-column Cover Sheet built with left alignments and dynamic banking details.`);
}