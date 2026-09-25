'use strict'

const { config } = require('../config')

// The application's "current calendar month" is defined by APP_TIMEZONE (a
// configurable IANA timezone, default Asia/Kuala_Lumpur). It must be consistent
// across the whole app, so every caller uses this single helper instead of
// UTC/local clock tricks. All monthly lifecycle rules (current month, editable
// window, auto-close) are computed from these calendar parts.
function partsIn(timeZone, date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')) }
}

// Current calendar y/m/d in the configured application timezone.
// Falls back to UTC if the configured timezone is invalid.
function appNow(date = new Date()) {
  try {
    return partsIn(config.appTimeZone, date)
  } catch {
    const d = new Date(date)
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    }
  }
}

// Contiguous month index: year*12 + (month-1). Enables simple "older/current/newer"
// arithmetic without calendar libraries.
function monthIndex(year, month) {
  return year * 12 + (month - 1)
}

module.exports = { appNow, monthIndex }