'use strict';

// Unit tests for the timezone helper that defines the app's "current calendar
// month" (APP_TIMEZONE default Asia/Kuala_Lumpur, UTC fallback on invalid tz).
let failed = 0;

function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`);
  if (!cond) failed++;
}

const timePath = require.resolve('../../backend/utils/time.js');
const configPath = require.resolve('../../backend/config.js');

// 1) Invalid timezone -> graceful UTC fallback (set before config loads).
process.env.APP_TIMEZONE = 'Invalid/Zone';
delete require.cache[timePath];
delete require.cache[configPath];
const { appNow } = require(timePath);
const utc = appNow(new Date('2026-03-08T12:34:56Z'));
check('invalid APP_TIMEZONE falls back to UTC date', utc.year === 2026 && utc.month === 3 && utc.day === 8, JSON.stringify(utc));

// 2) Real timezone is applied (Asia/Kuala_Lumpur, UTC+8).
delete process.env.APP_TIMEZONE; // .env default reapplies via dotenv on reload
delete require.cache[timePath];
delete require.cache[configPath];
const tz = require(timePath);
const octKl = tz.appNow(new Date('2026-09-30T18:00:00Z')); // UTC is still Sep 30, KL already Oct 1
check('KL: UTC Sep 30 18:00 is already October 1 (month differs from UTC)', octKl.year === 2026 && octKl.month === 10 && octKl.day === 1, JSON.stringify(octKl));
const sepKl = tz.appNow(new Date('2026-09-24T23:30:00Z'));
check('KL: Sep 24 23:30Z is Sep 25 but still September', sepKl.month === 9 && sepKl.day === 25, JSON.stringify(sepKl));

check('monthIndex: Aug 2026 is one before Sep 2026', tz.monthIndex(2026, 8) === tz.monthIndex(2026, 9) - 1);
check('monthIndex: Dec 2026 -> Jan 2027 contiguous', tz.monthIndex(2027, 1) === tz.monthIndex(2026, 12) + 1);
check('monthIndex: sanity (Jan 2026)', tz.monthIndex(2026, 1) === 2026 * 12);

console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : `${failed} TEST(S) FAILED`}`);
process.exit(failed ? 1 : 0);