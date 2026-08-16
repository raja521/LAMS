/**
 * PaperVision — the District's document storage.
 *
 * Documents are NOT copied into the LAMS database. LAMS stores a reference —
 * the document id, its title, and a click-through URL — so staff open the real
 * document where it already lives and there is only ever one copy of record.
 *
 * There is deliberately no download or upload method on this connector.
 */
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import Connector from './Connector.js';
import ExternalReference from '../models/ExternalReference.js';

class PaperVisionConnector extends Connector {
  constructor() {
    super({
      id: 'papervision',
      name: 'PaperVision (document storage)',
      purpose: 'Links LAMS records to documents that stay in PaperVision.',
      direction: 'read',
      notes: 'Stores a link only — document content is never copied into LAMS.',
      settings: () => config.connectors.papervision,
      requiredSettings: [
        { key: 'baseUrl', env: 'PAPERVISION_BASE_URL', description: 'PaperVision base URL.' },
        { key: 'apiKey', env: 'PAPERVISION_API_KEY', description: 'API key.' },
        {
          key: 'documentUrlTemplate',
          env: 'PAPERVISION_DOCUMENT_URL_TEMPLATE',
          description: 'Click-through URL template containing {documentId}.',
        },
      ],
    });
  }

  headers() {
    return { accept: 'application/json', authorization: `Bearer ${this.config.apiKey}` };
  }

  /** Build the click-through link for a document id. */
  linkFor(documentId) {
    return this.config.documentUrlTemplate.replace('{documentId}', encodeURIComponent(documentId));
  }

  async checkConnection() {
    this.assertUsable();
    const url = new URL(
      this.config.searchPath.replace(/^\//, ''),
      `${this.config.baseUrl.replace(/\/$/, '')}/`
    );
    url.searchParams.set('q', 'lams-connection-check');
    url.searchParams.set('pageSize', '1');

    const response = await this.request(url, { headers: this.headers() });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'PaperVision rejected the API key (PAPERVISION_API_KEY).' };
    }
    if (!response.ok) {
      return { ok: false, message: `PaperVision returned ${response.status} ${response.statusText}.` };
    }

    return {
      ok: true,
      message: 'Connected. LAMS will store links to documents rather than copies of them.',
      details: { linkTemplate: this.config.documentUrlTemplate },
    };
  }

  /**
   * Search PaperVision and return link records — never file content.
   * @returns {Promise<Array<{documentId, title, url, modifiedAt, documentType}>>}
   */
  async search(query, { limit = 25 } = {}) {
    this.assertUsable();

    const url = new URL(this.config.searchPath.replace(/^\//, ''), `${this.config.baseUrl.replace(/\/$/, '')}/`);
    url.searchParams.set('q', query);
    url.searchParams.set('pageSize', String(limit));

    const response = await this.request(url, { headers: this.headers() });
    if (!response.ok) {
      throw new ApiError(502, `PaperVision returned ${response.status} ${response.statusText}.`);
    }

    const payload = await response.json();
    const documents = payload.items ?? payload.documents ?? [];

    this.lastRun = { at: new Date(), operation: 'search', count: documents.length };

    return documents.map((document) => ({
      documentId: String(document.id ?? document.documentId),
      title: document.title ?? document.name ?? 'Untitled document',
      documentType: document.type ?? document.documentType ?? null,
      modifiedAt: document.modifiedAt ?? document.modified ?? null,
      url: this.linkFor(document.id ?? document.documentId),
    }));
  }

  /**
   * Attach a PaperVision document to a LAMS record by reference.
   *
   * Nothing is downloaded: the stored row holds the id, the title and the link.
   */
  async attach({ entityType, entityId, documentId, title, documentType, user }) {
    this.assertUsable();
    if (!documentId) throw ApiError.badRequest('A PaperVision document id is required.');

    const reference = await ExternalReference.findOneAndUpdate(
      { system: 'papervision', externalId: String(documentId), entityType, entityId },
      {
        $set: {
          system: 'papervision',
          externalId: String(documentId),
          externalUrl: this.linkFor(documentId),
          entityType,
          entityId,
          label: title ?? `PaperVision document ${documentId}`,
          metadata: { documentType },
          syncedAt: new Date(),
          createdBy: user?._id,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    logger.info(`Linked PaperVision document ${documentId} to ${entityType} ${entityId}`);
    return reference;
  }

  /** Every PaperVision link held against a record. */
  async linksFor(entityType, entityId) {
    return ExternalReference.find({ system: 'papervision', entityType, entityId }).sort({ createdAt: -1 });
  }
}

export default new PaperVisionConnector();
