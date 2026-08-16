/**
 * Where generated files physically live.
 *
 * Both providers sit behind the same three calls, so document generation never
 * knows or cares whether it is writing to a local folder or a bucket.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';

const { provider, localPath, s3 } = config.storage;

function safeKey(key) {
  const normalized = path.normalize(key).replace(/^(\.\.[/\\])+/, '');
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw ApiError.badRequest('Invalid storage key.');
  }
  return normalized;
}

/** Build the storage key for a generated document. */
export function documentKey({ module, documentNumber, filename }) {
  const year = new Date().getFullYear();
  return `documents/${year}/${module}/${documentNumber}-${filename}`;
}

export async function put(key, buffer, { contentType = 'application/octet-stream' } = {}) {
  const cleanKey = safeKey(key);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

  if (provider === 'local') {
    const target = path.resolve(config.storage.localPath ?? localPath, cleanKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
  } else {
    const { client, PutObjectCommand } = await s3Client();
    await client.send(
      new PutObjectCommand({ Bucket: s3.bucket, Key: cleanKey, Body: buffer, ContentType: contentType })
    );
  }

  return { provider, key: cleanKey, bucket: provider === 's3' ? s3.bucket : undefined, sizeBytes: buffer.length, checksum };
}

export async function get(key) {
  const cleanKey = safeKey(key);

  if (provider === 'local') {
    const target = path.resolve(config.storage.localPath ?? localPath, cleanKey);
    try {
      return await fs.readFile(target);
    } catch {
      throw ApiError.notFound('That file is no longer available in storage.');
    }
  }

  const { client, GetObjectCommand } = await s3Client();
  const response = await client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: cleanKey }));
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function remove(key) {
  const cleanKey = safeKey(key);
  if (provider === 'local') {
    await fs.unlink(path.resolve(config.storage.localPath ?? localPath, cleanKey)).catch(() => {});
    return;
  }
  const { client, DeleteObjectCommand } = await s3Client();
  await client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: cleanKey }));
}

/**
 * The AWS SDK is loaded only if STORAGE_PROVIDER=s3, so a local install carries
 * no dependency on it.
 */
async function s3Client() {
  let sdk;
  try {
    sdk = await import('@aws-sdk/client-s3');
  } catch {
    throw new Error(
      'STORAGE_PROVIDER=s3 requires the AWS SDK. Install it with:\n' +
        '  cd server && npm install @aws-sdk/client-s3'
    );
  }
  const client = new sdk.S3Client({
    region: s3.region,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
    ...(s3.endpoint ? { endpoint: s3.endpoint, forcePathStyle: s3.forcePathStyle } : {}),
  });
  return { client, ...sdk };
}

export default { put, get, remove, documentKey };
