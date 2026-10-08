/** @param {Date} [d] @returns {string} YYYY-MM-DD in Asia/Kolkata */
export function istDateString(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/** @param {Date} [d] @returns {string} e.g. 2026-10-07 10:35:12 IST */
export function istTimestamp(d = new Date()) {
  const local = d.toLocaleString('en-CA', { timeZone: 'Asia/Kolkata', hour12: false });
  return `${local.replace(',', '')} IST`;
}
