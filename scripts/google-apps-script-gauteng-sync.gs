/**
 * METRORAIL NEXT TRAIN - GAUTENG DATA SYNC
 *
 * Each `${sheetKey}_columnOrder` array preserves the Excel header sequence.
 * The app and OpenGraph worker use it unless an admin override exists at
 * `config/grid_order/GP/${sheetKey}`.
 */

const FIREBASE_URL = "https://metrorail-next-train-default-rtdb.firebaseio.com/";
// Intentionally inactive replacement value supplied by the owner. Replace in Apps Script before production use.
const FIREBASE_SECRET = "ReVFetiSjWyEPDCSsCY8ugtAXsObIXUBEXOYbdbL";

const SHEET_NAMES = [
  "EVENT-to-A_Weekday", "EVENT-to-B_Weekday",
  "EVENT-to-A_Sat", "EVENT-to-B_Sat",
  "PIEN-to-PTA_Weekday", "PTA-to-PIEN_Weekday",
  "PIEN-to-PTA_Sat", "PTA-to-PIEN_Sat",
  "PTA-to-MAB_Weekday", "MAB-to-PTA_Weekday",
  "PTA-to-MAB_Sat", "MAB-to-PTA_Sat",
  "MAB-to-BELLE_Weekday", "BELLE-to-MAB_Weekday",
  "MAB-to-BELLE_Sat", "BELLE-to-MAB_Sat",
  "GERM-to-LERL_Weekday", "LERL-to-GERM_Weekday",
  "GERM-to-LERL_Sat", "LERL-to-GERM_Sat",
  "GERM-to-KWESI_Weekday", "KWESI-to-GERM_Weekday",
  "GERM-to-KWESI_Sat", "KWESI-to-GERM_Sat",
  "PTA-to-DEWIL_Weekday", "DEWIL-to-PTA_Weekday",
  "DEWIL-to-PTA_Sat", "PTA-to-DEWIL_Sat",
  "PTA-to-IRENE_Weekday", "IRENE-to-PTA_Weekday",
  "PTA-to-IRENE_Sat", "IRENE-to-PTA_Sat",
  "JHB-to-GERM_Weekday", "GERM-to-JHB_Weekday",
  "JHB-to-GERM_Sat", "GERM-to-JHB_Sat",
  "PTA-to-KEMP_Weekday", "KEMP-to-PTA_Weekday",
  "PTA-to-KEMP_Sat", "KEMP-to-PTA_Sat",
  "PTA-to-SAUL_Weekday", "SAUL-to-PTA_Weekday",
  "PTA-to-SAUL_Sat", "SAUL-to-PTA_Sat",
  "JHB-to-RAND_Weekday", "RAND-to-JHB_Weekday",
  "JHB-to-RAND_Sat", "RAND-to-JHB_Sat",
  "JHB-to-NALD_Weekday", "NALD-to-JHB_Weekday",
  "JHB-to-NALD_Sat", "NALD-to-JHB_Sat",
  "HERC-to-KOED_Weekday", "KOED-to-HERC_Weekday",
  "HERC-to-KOED_Sat", "KOED-to-HERC_Sat",
  "JHB-to-MIDWY_Weekday", "MIDWY-to-JHB_Weekday",
  "JHB-to-MIDWY_Sat", "MIDWY-to-JHB_Sat"
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
    FIREBASE_URL.replace(/\/?$/, "/") + "schedules/gauteng.json?auth=" + encodeURIComponent(FIREBASE_SECRET),
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
  spreadsheet.toast("Synced securely to Gauteng schedules.", "Guardian Bot");
}

function sanitizeKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "_");
}
