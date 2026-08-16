/**
 * The District's old land-tracking spreadsheet/database.
 *
 * This is a one-time transfer, not a live connection. The work is done by the
 * separate migration tool in ./migrations/import, which is deliberately not part
 * of the everyday application. This connector exists only so the admin area can
 * report honestly on whether that transfer has happened and what came across.
 */
import config from '../config/env.js';
import Connector from './Connector.js';
import { LandApplication, Organization, Parcel } from '../models/index.js';
import ExternalReference from '../models/ExternalReference.js';

class LegacyConnector extends Connector {
  constructor() {
    super({
      id: 'legacy',
      name: 'Legacy land tracker (one-time transfer)',
      purpose: 'The District’s previous spreadsheet/database, brought across once.',
      direction: 'one-time',
      notes:
        'Not a live connection. Run the migration tool (npm run import:dry-run, then npm run import:apply) to bring the data over.',
      settings: () => config.connectors.legacy,
      requiredSettings: [],
    });
  }

  /** Reports what has actually been imported, rather than pinging anything. */
  async checkConnection() {
    const [parcels, applications, organizations, references] = await Promise.all([
      Parcel.countDocuments({ 'legacy.id': { $exists: true, $ne: null } }),
      LandApplication.countDocuments({ 'legacy.id': { $exists: true, $ne: null } }),
      Organization.countDocuments({ 'legacy.id': { $exists: true, $ne: null } }),
      ExternalReference.countDocuments({ system: 'legacy' }),
    ]);

    const total = parcels + applications + organizations;

    return {
      ok: true,
      message:
        total === 0
          ? `No records have been brought across from ${this.config.systemName} yet. Run the migration tool when the District's export is ready.`
          : `${total} record(s) carried over from ${this.config.systemName}, each keeping its original id.`,
      details: { parcels, applications, organizations, references, systemName: this.config.systemName },
    };
  }
}

export default new LegacyConnector();
