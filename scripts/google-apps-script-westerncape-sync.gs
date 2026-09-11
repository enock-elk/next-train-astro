/**
 * METRORAIL NEXT TRAIN - WESTERN CAPE DATA SYNC
 *
 * Each `${sheetKey}_columnOrder` array preserves the Excel header sequence.
 * The app and OpenGraph worker use it unless an admin override exists at
 * `config/grid_order/WC/${sheetKey}`.
 *
 * Writes only to /schedules/westerncape.json. Do not write the legacy
 * monolithic schedules.json node from this workbook.
 */

const FIREBASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/";
// Intentionally inactive replacement value supplied by the owner. Replace in Apps Script before production use.
const FIREBASE_SECRET = "ReVFetiSjWyEPDCSsCY8ugtAXsObIXUBEXOYbdbL";

const SHEET_NAMES = [
  // Central Line
  "CT-to-HANI_Weekday", "HANI-to-CT_Weekday",
  "CT-to-HANI_Sat", "HANI-to-CT_Sat",
  "CT-to-KAP_Weekday", "KAP-to-CT_Weekday",
  "CT-to-KAP_Sat", "KAP-to-CT_Sat",
  "CT-to-NOLU_Weekday", "NOLU-to-CT_Weekday",
  "CT-to-NOLU_Sat", "NOLU-to-CT_Sat",
  "MUTUL-to-BELLV_Weekday", "BELLV-to-MUTUL_Weekday",
  "MUTUL-to-BELLV_Sat", "BELLV-to-MUTUL_Sat",

  // Southern Line
  "CT-to-SIMON_Weekday", "SIMON-to-CT_Weekday",
  "CT-to-SIMON_Sat", "SIMON-to-CT_Sat",

  // Cape Flats
  "CT-to-RTRET_Weekday", "RTRET-to-CT_Weekday",
  "CT-to-RTRET_Sat", "RTRET-to-CT_Sat",

  // Northern Line
  "CT-to-BELLV_Weekday", "BELLV-to-CT_Weekday",
  "CT-to-BELLV_Sat", "BELLV-to-CT_Sat",
  "CT-to-KRAAI_Weekday", "KRAAI-to-CT_Weekday",
  "CT-to-KRAAI_Sat", "KRAAI-to-CT_Sat",
  "CT-to-EERST_Weekday", "EERST-to-CT_Weekday",
  "CT-to-EERST_Sat", "EERST-to-CT_Sat",
  "CT-to-STRND_Weekday", "STRND-to-CT_Weekday",
  "CT-to-STRND_Sat", "STRND-to-CT_Sat",
  "EERST-to-DTOIT_Weekday", "DTOIT-to-EERST_Weekday",
  "EERST-to-DTOIT_Sat", "DTOIT-to-EERST_Sat",
  "CT-to-WELL_Weekday", "WELL-to-CT_Weekday",
  "CT-to-WELL_Sat", "WELL-to-CT_Sat",

  // Regional / Malmesbury
  "CT-to-MALM_Weekday", "MALM-to-CT_Weekday",
  "CT-to-MALM_Sat", "MALM-to-CT_Sat"
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

function syncToFirebase() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const allData = {};

  SHEET_NAMES.forEach(function (sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      console.log("Warning: Sheet '" + sheetName + "' not found. Skipping.");
      return;
    }

    const data = sheet.getDataRange().getDisplayValues();
    if (data.length < 3) {
      console.log("Skipped '" + sheetName + "': Not enough data.");
      return;
    }

    const manualUpdateDate = data[0][1]
      || new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
    const headers = data[1];
    const stationHeader = headers[0] || "STATION";
    const normalizedHeaders = headers.map(normalizeSheetHeader);
    const cleanKey = sanitizeKey(sheetName);

    const formattedRows = data.slice(2).map(function (row) {
      const output = {};
      output[stationHeader] = row[0];
      for (let index = 1; index < normalizedHeaders.length; index += 1) {
        const header = normalizedHeaders[index];
        if (header && row[index] !== "") output[header] = row[index];
      }
      return output;
    });

    const metadataRow = {};
    metadataRow[stationHeader] = "Last Updated: " + manualUpdateDate;
    formattedRows.unshift(metadataRow);

    allData[cleanKey] = formattedRows;
    allData[cleanKey + "_meta"] = manualUpdateDate;
    allData[cleanKey + "_columnOrder"] = trainColumnOrder(normalizedHeaders.slice(1));

    for (let index = 0; index < data[0].length; index += 1) {
      const value = String(data[0][index] || "").trim();
      if (/^Z\d+$/.test(value)) {
        allData[cleanKey + "_zone"] = value;
        break;
      }
    }
  });

  allData.lastUpdated = new Date().toLocaleString();
  const response = UrlFetchApp.fetch(
    FIREBASE_URL.replace(/\/?$/, "/") + "schedules/westerncape.json?auth=" + encodeURIComponent(FIREBASE_SECRET),
    {
      method: "put",
      contentType: "application/json",
      payload: JSON.stringify(allData),
      muteHttpExceptions: true
    }
  );
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("Firebase sync failed with HTTP " + status + ".");
  }
  spreadsheet.toast("Synced securely to Western Cape schedules.", "Guardian Bot");
}

function sanitizeKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}
