/** @param {object[]} items */
export function groupInventoryByCategory(items) {
  const map = {};
  for (const item of items || []) {
    const cat = item.category || 'unknown';
    if (!map[cat]) map[cat] = [];
    map[cat].push(item);
  }
  return map;
}

/**
 * @param {object[]} scanned
 * @param {object[]} previous
 * @param {Record<string, { error?: string }>} status
 */
export function mergeInventoryOnFailure(scanned, previous, status) {
  const prevByCat = groupInventoryByCategory(previous);
  const scanByCat = groupInventoryByCategory(scanned);
  const cats = new Set([...Object.keys(prevByCat), ...Object.keys(scanByCat)]);
  const merged = [];
  for (const cat of cats) {
    if (status?.[cat]?.error && prevByCat[cat]?.length) {
      merged.push(...prevByCat[cat]);
    } else if (scanByCat[cat]?.length) {
      merged.push(...scanByCat[cat]);
    }
  }
  return merged;
}
