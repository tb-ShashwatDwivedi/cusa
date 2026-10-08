/** Map collector `name` to config.collectors key (event-channel → eventChannel). */
const NAME_TO_CONFIG = {
  'event-channel': 'eventChannel',
};

/** @param {object} collectors @param {string} collectorName */
export function isCollectorEnabled(collectors, collectorName) {
  const key = NAME_TO_CONFIG[collectorName] || collectorName;
  return collectors?.[key]?.enabled !== false;
}
