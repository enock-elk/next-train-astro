// METRORAIL NEXT TRAIN - WESTERN CAPE PUBLIC HOLIDAY SYNC (V6.0 + columnOrder)
// Targets: /schedules/westerncape/public_holidays.json only.
// Never PUT the weekday/sat westerncape root from this workbook.

const FIREBASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/";
// Prefer: File → Project settings → Script properties → FIREBASE_SECRET
const FIREBASE_SECRET = PropertiesService.getScriptProperties().getProperty("FIREBASE_SECRET");

const SHEET_NAMES = [
  // Central
  "CT-to-HANI_Pub", "HANI-to-CT_Pub",
  "CT-to-KAP_Pub", "KAP-to-CT_Pub",
  "CT-to-NOLU_Pub", "NOLU-to-CT_Pub",
  "MUTUL-to-BELLV_Pub", "BELLV-to-MUTUL_Pub",

  // Southern
  "CT-to-SIMON_Pub", "SIMON-to-CT_Pub",

  // Cape Flats
  "CT-to-RTRET_Pub", "RTRET-to-CT_Pub",

  // Northern
  "CT-to-BELLV_Pub", "BELLV-to-CT_Pub",
  "CT-to-KRAAI_Pub", "KRAAI-to-CT_Pub",
  "CT-to-EERST_Pub", "EERST-to-CT_Pub",
  "CT-to-STRND_Pub", "STRND-to-CT_Pub",
  "EERST-to-DTOIT_Pub", "DTOIT-to-EERST_Pub",
  "CT-to-WELL_Pub", "WELL-to-CT_Pub",

  // Malmesbury
  "CT-to-MALM_Pub", "MALM-to-CT_Pub"
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

function syncPublicHolidaysToFirebase() {
  if (!FIREBASE_SECRET) {
    throw new Error("Missing FIREBASE_SECRET in Script properties.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const allData = {};
  let synced = 0;
  let totalCoordRows = 0;
  let sheetsWithCoords = 0;

  SHEET_NAMES.forEach(sheetName => {
    if (!/_Pub$/i.test(sheetName)) {
      console.log(`⚠️ Warning: Blocked non-Pub sheet '${sheetName}'.`);
      return;
    }

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
    if (coordCount > 0) sheetsWithCoords += 1;
    console.log(`🛰️ Sheet '${sheetName}': Coordinates sent=${coordCount}/${formattedRows.length}`);
    if (coordCount === 0) {
      console.log(`❌ Sheet '${sheetName}': No COORDINATES values found in the payload.`);
    }

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
    synced += 1;
  });

  allData["lastUpdated"] = new Date().toLocaleString();
  allData.dayType = "public_holiday";

  if (totalCoordRows === 0) {
    console.log("❌ Coordinate validation FAILED: 0 COORDINATES values in this PUT. Station locate will break.");
  } else {
    console.log(`✅ Coordinate validation OK: ${totalCoordRows} rows with COORDINATES across ${sheetsWithCoords} sheets will be sent.`);
  }

  const newUrl = FIREBASE_URL + "schedules/westerncape/public_holidays.json?auth=" + FIREBASE_SECRET;

  try {
    const newOptions = {
      method: "put",
      contentType: "application/json",
      payload: JSON.stringify(allData),
      muteHttpExceptions: true
    };
    const resNew = UrlFetchApp.fetch(newUrl, newOptions);
    console.log("✅ V6 Node Sync Status: " + resNew.getResponseCode());
    console.log("✅ Coordinates included in V6 PUT: " + totalCoordRows + " rows");

    try {
      SpreadsheetApp.getActiveSpreadsheet().toast("Synced " + synced + " Pub sheets to Western Cape public holidays.", "Guardian Bot");
    } catch (toastErr) {
      console.log("Toast notification skipped (running in background).");
    }
  } catch (e) {
    console.log("❌ Error: " + e.message);
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast("Error: Check execution logs.", "Guardian Bot");
    } catch (toastErr) {
      console.log("Toast notification skipped (running in background).");
    }
  }
}

function sanitizeKey(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, "_"); }
