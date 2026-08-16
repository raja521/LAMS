/**
 * Build the indexes the reporting screens rely on.
 *
 * Mongoose creates these automatically outside production; this script makes
 * them explicit so a production deploy does not depend on autoIndex.
 */
export async function up({ db }) {
  await db.collection('users').createIndexes([
    { key: { email: 1 }, name: 'email_unique', unique: true },
    { key: { role: 1, isActive: 1 }, name: 'role_active' },
    { key: { externalId: 1 }, name: 'external_id', sparse: true },
  ]);

  await db.collection('parcels').createIndexes([
    { key: { parcelId: 1 }, name: 'parcel_id_unique', unique: true },
    { key: { status: 1, region: 1 }, name: 'status_region' },
    { key: { county: 1, status: 1 }, name: 'county_status' },
  ]);

  await db.collection('contracts').createIndexes([
    { key: { contractNumber: 1 }, name: 'contract_number_unique', unique: true },
    { key: { status: 1, module: 1 }, name: 'status_module' },
  ]);

  await db.collection('purchaseorders').createIndexes([
    { key: { poNumber: 1 }, name: 'po_number_unique', unique: true },
    { key: { contract: 1, status: 1 }, name: 'contract_status' },
  ]);

  await db.collection('generateddocuments').createIndexes([
    { key: { documentType: 1, generatedAt: -1 }, name: 'type_generated_at' },
    { key: { generatedBy: 1, generatedAt: -1 }, name: 'generated_by_at' },
  ]);

  await db.collection('activitylogs').createIndexes([
    { key: { at: -1 }, name: 'at_desc' },
    { key: { actor: 1, at: -1 }, name: 'actor_at' },
    { key: { entityType: 1, entityId: 1, at: -1 }, name: 'entity_at' },
  ]);
}

export async function down({ db }) {
  const collections = [
    'users',
    'parcels',
    'contracts',
    'purchaseorders',
    'generateddocuments',
    'activitylogs',
  ];
  for (const name of collections) {
    await db
      .collection(name)
      .dropIndexes()
      .catch(() => {});
  }
}
