/**
 * 🚅 METRORAIL NEXT TRAIN - GRID ORDER EXTRACTOR (GUARDIAN V2.4)
 * --------------------------------------------------------------
 * USAGE: node extract-grid.js
 * * UPDATES (V2.4):
 * 1. AUTO-FIX: Automatically parses data if pasted into Column A (CSV style).
 * 2. Removes manual "Text to Columns" requirement for the user.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// --- CONSTANTS ---
const CONFIG_SHEET_NAME = 'Config_GridOrder';
const OUTPUT_FILENAME = 'grid-order.js';

// --- CONFIG: Where to look for the output folder? ---
const TARGET_DIRECTORIES = [
    '../../Source Code/js',      // 1. Your specific structure
    '../../js',                  // 2. Standard sibling structure
    './js',                      // 3. Current folder sub-directory
    './'                         // 4. Fallback (Current folder)
];

// --- HELPER: Find latest Schedule File ---
function findScheduleFile() {
    const files = fs.readdirSync(process.cwd());
    const scheduleFiles = files.filter(file => 
        /^(Next)?Train\s*Schedules.*\.xlsx$/i.test(file) && !file.startsWith('~$')
    );

    if (scheduleFiles.length === 0) return null;

    // Sort by modification time (newest first)
    const sorted = scheduleFiles.map(name => ({
        name,
        time: fs.statSync(name).mtime.getTime()
    })).sort((a, b) => b.time - a.time);

    console.log("📂 Found Excel file:", sorted[0].name);
    return sorted[0].name;
}

// --- HELPER: Column Letter to Index ---
function getColIndex(letter) {
    if (!letter) return 2; 
    let column = 0;
    let length = letter.length;
    for (let i = 0; i < length; i++) {
        column += (letter.charCodeAt(i) - 64) * Math.pow(26, length - i - 1);
    }
    return column - 1;
}

// --- HELPER: Pad Train Numbers ---
function formatTrainNumber(val) {
    if (val === undefined || val === null) return null;
    let str = val.toString().trim();
    if (str === "") return null;
    if (/^\d+$/.test(str) && str.length < 4) {
        return str.padStart(4, '0');
    }
    return str;
}

// --- MAIN EXECUTION ---
function run() {
    console.log("\n🚀 STARTING GRID EXTRACTION (V2.4)...");
    
    const sourceFile = findScheduleFile();
    if (!sourceFile) {
        console.error("❌ ERROR: No Excel file found.");
        return;
    }

    console.log(`📖 Reading data...`);
    let workbook;
    try {
        workbook = XLSX.readFile(sourceFile);
    } catch (e) {
        console.error(`❌ ERROR: Could not open file. Close Excel and retry.`);
        return;
    }

    const configSheet = workbook.Sheets[CONFIG_SHEET_NAME];
    if (!configSheet) {
        console.error(`❌ ERROR: Sheet '${CONFIG_SHEET_NAME}' not found.`);
        return;
    }

    let mappings = XLSX.utils.sheet_to_json(configSheet);
    
    // --- V2.4 AUTO-CORRECTOR BLOCK ---
    console.log(`   -> Config Sheet loaded. Found ${mappings.length} rows.`);
    if (mappings.length > 0) {
        const firstRow = mappings[0];
        const keys = Object.keys(firstRow);
        
        // Detect if data is pasted into a single column (Key looks like "Key,SheetName...")
        if (keys.length === 1 && keys[0].includes(',')) {
            console.log("\n🛠️  AUTO-FIX: Detected 'Column A' CSV paste. Fixing structure in memory...");
            
            const headerStr = keys[0]; // e.g., "Key,SheetName,RowNumber,StartCol"
            const headers = headerStr.split(',').map(h => h.trim());

            // Re-map the malformed data into clean objects
            mappings = mappings.map(row => {
                const rawValue = row[headerStr]; // The long string value
                if (!rawValue) return null;
                
                const parts = rawValue.toString().split(',');
                const newObj = {};
                headers.forEach((h, i) => {
                    newObj[h] = parts[i] ? parts[i].trim() : undefined;
                });
                return newObj;
            }).filter(item => item !== null);

            console.log(`   -> ✅ Auto-fixed ${mappings.length} routes.`);
        }
    } else {
        console.warn("   ⚠️ Config sheet appears empty.");
    }
    // ---------------------------------

    const extractedData = {};
    let routeCount = 0;

    mappings.forEach((map, idx) => {
        // Tolerant matching for headers
        const key = map.Key || map.key || map.KEY;
        const sheetName = map.SheetName || map.sheetname || map.Sheetname || map.SHEETNAME;
        const rowNum = map.RowNumber || map.rownumber || map.Row || map.row;
        const startColChar = map.StartCol || map.startcol || map.col || 'C';

        if (!key || !sheetName) {
            console.warn(`   ⚠️ Row ${idx + 2}: SKIPPING - Missing 'Key' or 'SheetName'. Saw:`, map);
            return;
        }

        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
            console.warn(`   ⚠️ Missing Tab: '${sheetName}' (Mapped for ${key})`);
            return;
        }

        const rowIdx = (parseInt(rowNum) || 2) - 1; 
        const startCol = getColIndex(startColChar); 
        const trains = [];
        let colIdx = startCol;
        let consecutiveEmpty = 0;

        while (consecutiveEmpty < 5) { 
            const cellAddr = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
            const cell = sheet[cellAddr];
            const cleanVal = cell ? formatTrainNumber(cell.v) : null;

            if (cleanVal) {
                trains.push(cleanVal);
                consecutiveEmpty = 0;
            } else {
                consecutiveEmpty++;
            }
            colIdx++;
        }

        if (trains.length > 0) {
            extractedData[key] = trains;
            routeCount++;
        } else {
             // Verbose log for empty routes to help debug
             console.log(`   ℹ️  ${key}: No trains found on tab '${sheetName}' row ${rowIdx+1}`);
        }
    });

    const today = new Date().toISOString().split('T')[0];
    const fileContent = `/**
 * METRORAIL NEXT TRAIN - GRID ORDER CONFIG
 * ---------------------------------------------------
 * This file defines the explicit column order for the Full Schedule Grid.
 * Generated from: "${sourceFile}"
 * Date: ${today}
 */

const MANUAL_GRID_ORDER = ${JSON.stringify(extractedData, null, 4)};
`;

    // --- SMART PATH DETECTION ---
    let savedPath = null;
    
    for (const relativePath of TARGET_DIRECTORIES) {
        const absolutePath = path.resolve(process.cwd(), relativePath);
        if (fs.existsSync(absolutePath)) {
            if (fs.lstatSync(absolutePath).isDirectory()) {
                savedPath = path.join(absolutePath, OUTPUT_FILENAME);
                break;
            }
        }
    }

    if (savedPath) {
        fs.writeFileSync(savedPath, fileContent);
        console.log(`\n🎉 SUCCESS! Processed ${routeCount} routes.`);
        console.log(`💾 File Saved to: ${savedPath}`);
    } else {
        console.error("❌ ERROR: Could not find 'Source Code/js' or 'js' folder.");
        console.log("   -> Saving to current folder as fallback.");
        fs.writeFileSync(OUTPUT_FILENAME, fileContent);
    }
}

run();