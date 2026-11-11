/**
 * Compute inventory delta between scans.
 * @param {object[]} previous
 * @param {object[]} current
 */
export function computeDelta(previous, current) {
  const prevMap = new Map((previous || []).map((i) => [i.id, i]));
  const currMap = new Map(current.map((i) => [i.id, i]));
  const delta = [];

  for (const [id, item] of currMap) {
    const prev = prevMap.get(id);
    if (!prev) {
      delta.push({ ...item, operation: 'create' });
    } else if (JSON.stringify(prev.data) !== JSON.stringify(item.data)) {
      delta.push({ ...item, operation: 'update' });
    }
  }
  for (const [id, item] of prevMap) {
    if (!currMap.has(id)) {
      delta.push({ ...item, operation: 'delete' });
    }
  }
  return delta;
}
