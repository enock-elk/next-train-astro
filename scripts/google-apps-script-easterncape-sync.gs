/**
 * METRORAIL NEXT TRAIN - EASTERN CAPE DATA SYNC
 *
 * Each `${sheetKey}_columnOrder` array preserves the Excel header sequence.
 * The app and OpenGraph worker use it unless an admin override exists at
 * `config/grid_order/EC/${sheetKey}`.
 *
 * Writes only to /schedules/easterncape.json. Do not write the legacy
 * monolithic schedules.json node from this workbook.
 */

const FIREBASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/";
// Intentionally inactive replacement value supplied by the owner. Replace in Apps Script before production use.
const FIREBASE_SECRET = "ReVFetiSjWyEPDCSsCY8ugtAXsObIXUBEXOYbdbL";

const SHEET_NAMES = [
  // Central Line
  "BERLN-to-EASTL_Weekday", "EASTL-to-BERLN_Weekday",
  "BERLN-to-EASTL_Sat", "EASTL-to-BERLN_Sat"
];

function normalizeTrainId(value) {
  let id = String(value || "").trim();
  if (/^\d+$/.test(id)) id = id.padStart(4, "0");
  return /^\d{4}[a-zA-Z]*$/.test(id) ? id : "";
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
    const normalizedHeaders = headers.map(function (header, index) {
      return index === 0 ? stationHeader : normalizeTrainId(header);
    });
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
    allData[cleanKey + "_columnOrder"] = normalizedHeaders.slice(1).filter(Boolean);

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
    FIREBASE_URL.replace(/\/?$/, "/") + "schedules/easterncape.json?auth=" + encodeURIComponent(FIREBASE_SECRET),
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
  spreadsheet.toast("Synced securely to Eastern Cape schedules.", "Guardian Bot");
}

function sanitizeKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}
