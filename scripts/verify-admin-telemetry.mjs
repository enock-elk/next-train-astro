/**
 * Admin trip-plan insights must be all-time, never a windowed user-batch headline.
 * Run: node scripts/verify-admin-telemetry.mjs
 */
import { readFileSync } from 'node:fs';

const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

const admin = readFileSync(new URL('../public/js/admin.js', import.meta.url), 'utf8');
assert(admin.includes('Insights (all time)'), 'insights labelled Insights (all time)');
assert(!admin.includes('Insights (this window)'), 'must not say Insights (this window)');
assert(admin.includes('Admin.fetchTripPlanEverStats'), 'fetchTripPlanEverStats exists');
assert(admin.includes('Admin.buildTripInsightsHtml'), 'buildTripInsightsHtml exists');
assert(admin.includes('Admin.fetchAllTripPlanBatches'), 'all-time trip_plans fetch exists');
assert(admin.includes('Users ever'), 'Users ever banner present');
assert(admin.includes('await Admin.fetchTripPlanEverStats'), 'always call fetchTripPlanEverStats');
assert(!admin.includes('unique user-batches'), 'headline must not be unique user-batches');
assert(admin.includes('In this window:'), 'list-scope line remains In this window');
assert(admin.includes('_deTripPageSize'), 'corridor cards are paged');
assert(!/usersEver:\s*ever\.usersEver\s*\|\|\s*uniqueUsers/.test(admin), 'Users ever must not fall back to a window unique-user count');

const ingest = readFileSync(new URL('../src/lib/planner-telemetry.js', import.meta.url), 'utf8');
assert(ingest.includes('sys_logs/trip_plans'), 'client ingest path unchanged');

if (failures.length) {
    console.error('verify-admin-telemetry failed:');
    failures.forEach((f) => console.error(' -', f));
    process.exit(1);
}
console.log('verify-admin-telemetry: ok');
