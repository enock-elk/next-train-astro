import os
import glob
import json
import sys

# Target files and nodes
TARGET_FILE_PATTERN = '*rtdb-export*.json'
OUTPUT_FILE = 'full-database.json'
TMP_FILE = 'full-database.json.tmp'

# The Strict Whitelist: Only these nodes are allowed into the public GitHub payload
PUBLIC_METADATA_NODES = ['config', 'notices', 'disruptions', 'exclusions']
KNOWN_REGIONAL_NODES = ['gauteng', 'westerncape', 'kzn', 'easterncape']

def main():
    print("🛡️  Guardian Sanitization Protocol Initiated...")

    # 1. Find the raw Firebase export
    export_files = glob.glob(TARGET_FILE_PATTERN)
    
    # Exclude the output and tmp files just in case the naming overlaps
    export_files = [f for f in export_files if f not in [OUTPUT_FILE, TMP_FILE]]

    if not export_files:
        print("❌ Error: No Firebase export file found matching '*rtdb-export*.json'.")
        sys.exit(1)

    # Get the most recently modified file if there are multiple
    latest_export = max(export_files, key=os.path.getmtime)
    print(f"📄 Found target payload: {latest_export}")

    try:
        original_size = os.path.getsize(latest_export)
        
        # 2. Load the JSON data into memory
        with open(latest_export, 'r', encoding='utf-8') as file:
            raw_data = json.load(file)
        
        sanitized_data = {}
        
        # 3. Whitelist Extraction - Metadata
        for node in PUBLIC_METADATA_NODES:
            if node in raw_data:
                sanitized_data[node] = raw_data[node]
                print(f"   ✅ Secured public node: /{node}")
                
        # 4. Safe Regional Schedule Extraction (Flattening)
        # Scenario A: Schedules are nested inside a 'schedules' node
        if 'schedules' in raw_data and isinstance(raw_data['schedules'], dict):
            print("   🗜️  Unwrapping nested 'schedules' node...")
            for region_key, region_data in raw_data['schedules'].items():
                sanitized_data[region_key] = region_data
                print(f"   ✅ Secured schedule: /{region_key}")
                
        # Scenario B: Schedules were exported directly at the root
        for region in KNOWN_REGIONAL_NODES:
            if region in raw_data and region not in sanitized_data:
                sanitized_data[region] = raw_data[region]
                print(f"   ✅ Secured root schedule: /{region}")
        
        # 5. Atomic Write Process
        # We use indent=2 to pretty-print the JSON for readability and easier Git diffs
        # ensure_ascii=False prevents ↔ from turning into \u2194, saving space and preventing parsing bugs
        print(f"   💾 Writing payload to temporary buffer ({TMP_FILE})...")
        with open(TMP_FILE, 'w', encoding='utf-8') as file:
            json.dump(sanitized_data, file, indent=2, ensure_ascii=False)
            
        # If the write succeeds without crashing, commit the file
        if os.path.exists(OUTPUT_FILE):
            os.remove(OUTPUT_FILE)
        os.rename(TMP_FILE, OUTPUT_FILE)
        
        new_size = os.path.getsize(OUTPUT_FILE)
        
        # 6. Destroy the raw export to prevent Git leaks
        os.remove(latest_export)
        
        # 7. Calculate and report metrics
        saved_kb = (original_size - new_size) / 1024
        orig_mb = original_size / (1024 * 1024)
        new_mb = new_size / (1024 * 1024)
        
        print("\n✅ Sanitization Complete!")
        print(f"📊 Metrics:")
        print(f"   - Original Size: {orig_mb:.2f} MB")
        print(f"   - New Size:      {new_mb:.2f} MB")
        print(f"   - Bloat Removed: {saved_kb:.1f} KB")
        print(f"   - Status:        Raw export deleted securely.")
        print(f"🚀 '{OUTPUT_FILE}' is primed and ready for GitHub deployment.")

    except Exception as e:
        print(f"\n❌ FATAL ERROR during sanitization: {e}")
        # Clean up the tmp file if it crashed mid-write to prevent ghost files
        if os.path.exists(TMP_FILE):
            os.remove(TMP_FILE)
        sys.exit(1)

if __name__ == "__main__":
    main()