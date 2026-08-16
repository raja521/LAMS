/**
 * Where new applications to sell land to the District come from.
 *
 * INTAKE_SOURCE decides which path is live:
 *   simulated — the generator below, drawing on the sample GIS data so a
 *               simulated application has a real shape on the map
 *   webhook   — the District's online form system posts to the intake endpoint
 *
 * Both paths end in the same createApplication() call, so when the real form
 * system is connected nothing downstream changes.
 */
import crypto from 'node:crypto';
import config from '../config/env.js';
import { LandApplication, APPLICATION_STATUS } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import { nextNumber, SEQUENCES } from './numberingService.js';
import { recordActivity } from './activityService.js';
import { fetchFeatures, centroidOf } from './gisService.js';

/**
 * The one way an application enters the system. The file number is assigned
 * here — no caller supplies one and nobody types one.
 */
export async function createApplication(payload, { source, user, req } = {}) {
  const fileNumber = await nextNumber(SEQUENCES.APPLICATION);

  const application = await LandApplication.create({
    fileNumber,
    source: source ?? 'manual',
    externalReference: payload.externalReference,
    submittedAt: payload.submittedAt ?? new Date(),
    applicant: {
      name: payload.applicant?.name,
      email: payload.applicant?.email,
      phone: payload.applicant?.phone,
      mailingAddress: payload.applicant?.mailingAddress,
    },
    property: {
      description: payload.property?.description,
      address: payload.property?.address,
      county: payload.property?.county,
      region: payload.property?.region,
      acres: payload.property?.acres,
      parcelIdentifiers: payload.property?.parcelIdentifiers ?? [],
      askingPrice: payload.property?.askingPrice,
      geometry: payload.property?.geometry,
    },
    status: APPLICATION_STATUS.NEW,
    notes: payload.notes,
    createdBy: user?._id,
  });

  await recordActivity({
    req,
    actor: user,
    action: 'create',
    entityType: 'LandApplication',
    entityId: application._id,
    entityLabel: fileNumber,
    module: 'acquisition',
    summary: `Application ${fileNumber} received from ${source ?? 'manual entry'}.`,
  });

  return application;
}

/**
 * Stand-in for the online form system until Prompt 3 connects the real one.
 * Applications are built from the sample GIS features so each one has geometry
 * the map can actually draw.
 */
export async function simulateIncoming({ count = 1, user, req } = {}) {
  const collection = await fetchFeatures();
  const features = collection.features ?? [];

  if (features.length === 0) {
    throw ApiError.badRequest(
      'No sample GIS features are available to build a simulated application from. ' +
        `Check GIS_SAMPLE_DATA_PATH (${config.gis.samplePath}).`
    );
  }

  // Don't offer the same parcel twice.
  const alreadyUsed = new Set(
    (await LandApplication.find({ source: 'simulated' }).select('property.parcelIdentifiers')).flatMap(
      (a) => a.property.parcelIdentifiers ?? []
    )
  );

  const available = features.filter((f) => !alreadyUsed.has(f.properties?.parcelId));
  if (available.length === 0) {
    throw ApiError.conflict(
      'Every sample property has already been submitted. Add more features to the sample GeoJSON to simulate further applications.'
    );
  }

  const created = [];
  for (const feature of available.slice(0, count)) {
    const props = feature.properties ?? {};
    const centroid = centroidOf(feature);

    created.push(
      await createApplication(
        {
          externalReference: `FORM-${props.parcelId}`,
          applicant: {
            name: props.owner ?? 'Unnamed owner',
            email: props.ownerEmail,
            phone: props.ownerPhone,
            mailingAddress: props.ownerAddress,
          },
          property: {
            description: props.name,
            address: props.address,
            county: props.county,
            region: props.region,
            acres: props.acres,
            parcelIdentifiers: [props.parcelId],
            askingPrice: props.askingPrice,
            geometry: {
              source: config.gis.provider === 'sample' ? 'sample' : 'arcgis',
              ref: props.parcelId,
              featureId: String(feature.id ?? props.parcelId),
              srid: 'EPSG:4326',
              centroid: centroid ? { lat: centroid.lat, lng: centroid.lng } : undefined,
            },
          },
          notes: props.notes,
        },
        { source: 'simulated', user, req }
      )
    );
  }

  return created;
}

/**
 * Verify a post from the online form system.
 *
 * The signature is an HMAC of the raw body using INTAKE_WEBHOOK_SECRET, compared
 * in constant time so the check cannot be probed a byte at a time.
 */
export function verifyWebhookSignature(rawBody, signature) {
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', config.intake.webhookSecret)
    .update(rawBody ?? '')
    .digest('hex');

  const provided = String(signature).replace(/^sha256=/, '');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');

  if (expectedBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export function intakeStatus() {
  return {
    source: config.intake.source,
    simulationAvailable: config.intake.source === 'simulated',
    webhookPath: '/api/acquisition/intake/webhook',
    formSystemUrl: config.intake.formSystemUrl ?? null,
  };
}
