/**
 * METRORAIL NEXT TRAIN - WESTERN CAPE PUBLIC HOLIDAY SYNC
 *
 * Each `${sheetKey}_columnOrder` array preserves the Excel header sequence.
 * The app and OpenGraph worker use it unless an admin override exists at
 * `config/grid_order/WC/${sheetKey}`.
 *
 * Writes only to /schedules/westerncape/public_holidays.json.
 * Never PUT the weekday/sat westerncape root from this workbook.
 */

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
  return normalizeTrainId(raw);
}

function trainColumnOrder(headers) {
  return headers.filter(function (header) {
    return /^\d{4}[a-zA-Z]*$/.test(header);
  });
}

function syncPublicHolidaysToFirebase() {
  if (!FIREBASE_SECRET) {
    throw new Error("Missing FIREBASE_SECRET in Script properties.");
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const allData = {};
  let synced = 0;

  SHEET_NAMES.forEach(function (sheetName) {
    if (!/_Pub$/i.test(sheetName)) {
      console.log("Blocked non-Pub sheet '" + sheetName + "'.");
      return;
    }

    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      console.log("Warning: Sheet '" + sheetName + "' not found. Skipping.");
      return;
    }

    const data = sheet.getDataRange().getDisplayValues();
    if (data.length < 3) {
      console.log("Skipped '" + sheetName + "': not enough data.");
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
    synced += 1;
  });

  allData.lastUpdated = new Date().toLocaleString();
  allData.dayType = "public_holiday";

  const response = UrlFetchApp.fetch(
    FIREBASE_URL.replace(/\/?$/, "/") + "schedules/westerncape/public_holidays.json?auth=" + encodeURIComponent(FIREBASE_SECRET),
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

  try {
    spreadsheet.toast("Synced " + synced + " Pub sheets to Western Cape public holidays.", "Guardian Bot");
  } catch (toastErr) {
    console.log("Toast notification skipped (running in background).");
  }
}

function sanitizeKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}
