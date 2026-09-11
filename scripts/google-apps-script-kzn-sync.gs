// METRORAIL NEXT TRAIN - KZN DATA SYNC (V6.0 - Region Split)
// Targets: /schedules/kzn.json only. Do not write the legacy schedules.json node.
// Surgical adds only: `${sheetKey}_columnOrder` and coordinate count logs.

const FIREBASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/"; 
const FIREBASE_SECRET = "ReVFetiSjWyEPDCSsCY8ugtAXsObIXUBEXOYbdbL"; 

const SHEET_NAMES = [
  // Umlazi Line (South)
  "DURBN-to-UMLAZ_Weekday", "UMLAZ-to-DURBN_Weekday",
  "DURBN-to-UMLAZ_Sat", "UMLAZ-to-DURBN_Sat",

  // Bridge City / KwaMashu Line (North)
  "DURBN-to-BRIDG_Weekday", "BRIDG-to-DURBN_Weekday",
  "DURBN-to-BRIDG_Sat", "BRIDG-to-DURBN_Sat",

  // Winklespruit Line (South)
  "DURBN-to-WINKL_Weekday", "WINKL-to-DURBN_Weekday",
  "DURBN-to-WINKL_Sat", "WINKL-to-DURBN_Sat",

  // Cato Ridge Line (Inland / West)
  "DURBN-to-CATOR_Weekday", "CATOR-to-DURBN_Weekday",
  "DURBN-to-CATOR_Sat", "CATOR-to-DURBN_Sat",

  // Pinetown Line (West)
  "DURBN-to-PINET_Weekday", "PINET-to-DURBN_Weekday",
  "DURBN-to-PINET_Sat", "PINET-to-DURBN_Sat",

  // Crossmoor Line
  "DURBN-to-CROSS_Weekday", "CROSS-to-DURBN_Weekday",
  "DURBN-to-CROSS_Sat", "CROSS-to-DURBN_Sat"
];

function normalizeTrainId(value) {
  let id = String(value || "").trim();
  if (/^\d+$/.test(id)) id = id.padStart(4, "0");
  return /^\d{4}[a-zA-Z]*$/.test(id) ? id : "";
}

function normalizeSheetHeader(value, index) {
  const raw = String(value || "").trim();
  if (index === 0) return raw || "STATION";
  const upper = raw.toUpperCase();
  if (upper === "COORDINATES") return "COORDINATES";
  if (upper === "KM_MARK" || upper === "KM MARK") return "KM_MARK";
  if (/^\d+$/.test(raw)) return raw.padStart(4, "0");
  return raw;
}

function trainColumnOrder(headers) {
  return headers.filter(function (header) {
    return /^\d{4}[a-zA-Z]*$/.test(header);
  });
}

function countCoordinateRows(rows) {
  let count = 0;
  rows.forEach(function (row) {
    if (!row || typeof row !== "object") return;
    const keys = Object.keys(row);
    for (let i = 0; i < keys.length; i++) {
      const key = String(keys[i]).toUpperCase().replace(/\s+/g, "");
      if (key === "COORDINATES" && row[keys[i]] !== "") {
        count += 1;
        return;
      }
    }
  });
  return count;
}

function syncToFirebase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allData = {};
  let totalCoordRows = 0;

  SHEET_NAMES.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      console.log(`⚠️ Warning: Sheet '${sheetName}' not found. Skipping.`);
      return;
    }

    const data = sheet.getDataRange().getDisplayValues();
    if (data.length < 3) {
      console.log(`⚠️ Skipped '${sheetName}': Not enough data.`);
      return;
    }

    let manualUpdateDate = data[0][1]; 
    if (!manualUpdateDate) {
       manualUpdateDate = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    const headers = data[1];

    let zoneCode = null;
    for(let k=0; k < data[0].length; k++) {
        const val = data[0][k].toString().trim();
        if (/^Z\d+$/.test(val)) { zoneCode = val; break; }
    }

    const rows = data.slice(2);
    
    console.log(`ℹ️ Sheet '${sheetName}': Date=${manualUpdateDate}, Headers=${headers.length}`);

    const formattedRows = rows.map(row => {
      let obj = {};
      obj[headers[0] || "STATION"] = row[0];
      for (let i = 1; i < headers.length; i++) {
        let header = headers[i].toString().trim();
        
        // 🛡️ GUARDIAN PATCH: Train ID Zero-Padding 
        // Ensures any purely numeric header is padded to exactly 4 digits
        if (/^\d+$/.test(header)) {
            header = header.padStart(4, '0');
        }

        const value = row[i];
        if (header && value !== "") { obj[header] = value; }
      }
      return obj;
    });

    const coordCount = countCoordinateRows(formattedRows);
    totalCoordRows += coordCount;
    console.log(`🛰️ Sheet '${sheetName}': Coordinates sent=${coordCount}`);

    if (manualUpdateDate) {
        const metadataRow = {};
        metadataRow[headers[0] || "STATION"] = "Last Updated: " + manualUpdateDate; 
        formattedRows.unshift(metadataRow);
        
        const key = sanitizeKey(sheetName);
        allData[key + "_meta"] = manualUpdateDate;
        if (zoneCode) allData[key + "_zone"] = zoneCode; 
    }

    const cleanKey = sanitizeKey(sheetName);
    allData[cleanKey] = formattedRows;
    allData[cleanKey + "_columnOrder"] = trainColumnOrder(headers.map(normalizeSheetHeader).slice(1));
  });

  allData["lastUpdated"] = new Date().toLocaleString();

  if (totalCoordRows === 0) {
    console.log("❌ Coordinate validation FAILED: 0 COORDINATES values in this PUT.");
  } else {
    console.log("✅ Coordinate validation OK: " + totalCoordRows + " rows with COORDINATES will be sent.");
  }
  
  const newUrl = FIREBASE_URL + "schedules/kzn.json?auth=" + FIREBASE_SECRET;
  
  try {
    // 1. Write to the NEW V6.0 Regional Node (PUT creates the folder/replaces its contents safely)
    const newOptions = { 
      method: "put", 
      contentType: "application/json", 
      payload: JSON.stringify(allData),
      muteHttpExceptions: true
    };
    const resNew = UrlFetchApp.fetch(newUrl, newOptions);
    console.log("✅ V6 Node Sync Status: " + resNew.getResponseCode());
    console.log("✅ Coordinates included in V6 PUT: " + totalCoordRows + " rows");

    SpreadsheetApp.getActiveSpreadsheet().toast("Synced Securely to V6 KZN!", "Guardian Bot");
  } catch (e) {
    console.log("❌ Error: " + e.message);
    SpreadsheetApp.getActiveSpreadsheet().toast("Error: Check execution logs.", "Guardian Bot");
  }
}

function sanitizeKey(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, "_"); }
