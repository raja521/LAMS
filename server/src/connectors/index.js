/**
 * The connector registry.
 *
 * Everything that talks to one of the District's other systems is reached
 * through here, so there is one place that knows what exists, what is switched
 * on, and what is actually reachable.
 */
import arcgis from './arcgis.connector.js';
import accufund from './accufund.connector.js';
import civicplus from './civicplus.connector.js';
import papervision from './papervision.connector.js';
import perch from './perch.connector.js';
import legacy from './legacy.connector.js';
import { CONNECTOR_STATE } from './Connector.js';

const registry = new Map([
  [arcgis.id, arcgis],
  [accufund.id, accufund],
  [civicplus.id, civicplus],
  [papervision.id, papervision],
  [perch.id, perch],
  [legacy.id, legacy],
]);

export function getConnector(id) {
  return registry.get(id) ?? null;
}

export function allConnectors() {
  return [...registry.values()];
}

/** Fast summary for the admin screen — no network calls. */
export function describeAll() {
  return allConnectors().map((connector) => connector.describe());
}

/** Runs every enabled connector's live check, in parallel. */
export async function testAll() {
  const results = await Promise.all(
    allConnectors().map(async (connector) => ({ ...connector.describe(), ...(await connector.test()) }))
  );
  return results;
}

/** True only when the connector is on AND fully configured. */
export function isUsable(id) {
  const connector = getConnector(id);
  return Boolean(connector?.enabled && connector.missingSettings().length === 0);
}

export { arcgis, accufund, civicplus, papervision, perch, legacy, CONNECTOR_STATE };
export default { getConnector, allConnectors, describeAll, testAll, isUsable };
