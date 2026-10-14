#!/usr/bin/env node
/**
 * Venyl: copy audio from public Supabase Storage to Cloudflare R2.
 * This is a one-time admin script, never imported by the website.
 * Requires: npm install --no-save @aws-sdk/client-s3
 * Required env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 * Optional: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for private buckets),
 *           SOURCE_BUCKET, DEST_BUCKET, DRY_RUN, LIMIT, REPORT_PATH.
 *
 * Run: node scripts/migrate-supabase-to-r2.mjs
 * Default DRY_RUN=true. Set DRY_RUN=false to actually copy.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, readFileSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const project = 'hwulruialugaaufjzsdt';
const supabaseUrl = (process.env.SUPABASE_URL || `https://${project}.supabase.co`).replace(/\/$/, '');
const sourceBucket = process.env.SOURCE_BUCKET || 'tracks';
const destBucket = process.env.DEST_BUCKET || 'venyl-tracks';
const dryRun = process.env.DRY_RUN !== 'false';
const limit = Number(process.env.LIMIT || 0);
const reportPath = process.env.REPORT_PATH || 'venyl-r2-migration-report.json';
const auth = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = auth ? { Authorization: `Bearer ${auth}`, apikey: auth } : {};
const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
if (!dryRun && required.some(k => !process.env[k])) {
  throw new Error('Missing R2 credentials. Set environment variables privately, not in GitHub.');
}
const r2 = dryRun ? null : new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  forcePathStyle: true,
});
const apiBase = `${supabaseUrl}/storage/v1`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, headers: { ...headers, ...opts.headers } });
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status} for ${new URL(url).pathname}`);
  return res;
};
async function list(prefix = '') {
  let offset = 0;
  const out = [];
  for (;;) {
    const res = await check(`${apiBase}/object/list/${encodeURIComponent(sourceBucket)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error('Unexpected Supabase list response');
    for (const item of page) {
      const key = prefix + item.name;
      if (item.id === null || item.metadata === null) out.push(...await list(key + '/'));
      else out.push({ key, size: Number(item.metadata?.size ?? -1), contentType: item.metadata?.mimetype || 'application/octet-stream' });
    }
    if (page.length < 100) break;
    offset += page.length;
  }
  return out;
}
async function migrate(item) {
  const path = item.key.split('/').map(encodeURIComponent).join('/');
  const url = `${apiBase}/object/${auth ? 'authenticated' : 'public'}/${encodeURIComponent(sourceBucket)}/${path}`;
  let temp;
  try {
    const response = await check(url);
    temp = join(tmpdir(), `venyl-migration-${process.pid}-${createHash('sha256').update(item.key).digest('hex')}`);
    const hash = createHash('sha256');
    let bytes = 0;
    const stream = Readable.fromWeb(response.body);
    stream.on('data', chunk => { hash.update(chunk); bytes += chunk.length; });
    await pipeline(stream, createWriteStream(temp));
    if (item.size >= 0 && bytes !== item.size) throw new Error(`Source size mismatch: expected ${item.size}, got ${bytes}`);
    // Single PutObject supports up to 5 GiB, far above expected Venyl audio files.
    // R2 uploads need a replayable request body for signing and retries.
    // A file stream is non-retryable in the AWS SDK and can fail before upload.
    const uploadBody = readFileSync(temp);
    await r2.send(new PutObjectCommand({
      Bucket: destBucket, Key: item.key, Body: uploadBody,
      ContentLength: bytes, ContentType: item.contentType,
      Metadata: { sha256: hash.digest('hex') },
    }));
    const head = await r2.send(new HeadObjectCommand({ Bucket: destBucket, Key: item.key }));
    if (head.ContentLength !== bytes) throw new Error(`Destination size mismatch: expected ${bytes}, got ${head.ContentLength}`);
    return { key: item.key, bytes, status: 'verified' };
  } finally {
    if (temp) await unlink(temp).catch(() => {});
  }
}
const files = await list();
console.log(`Found ${files.length} source objects in ${sourceBucket}. DRY_RUN=${dryRun}`);
const selected = limit > 0 ? files.slice(0, limit) : files;
const results = [];
for (const [index, item] of selected.entries()) {
  if (dryRun) {
    results.push({ key: item.key, bytes: item.size, status: 'dry-run' });
    continue;
  }
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { result = await migrate(item); break; }
    catch (err) {
      if (attempt === 3) {
        const details = [err.name, err.message, err.$metadata?.httpStatusCode && `HTTP ${err.$metadata.httpStatusCode}`, err.cause?.message].filter(Boolean).join(' | ');
        console.error(`[${index + 1}/${selected.length}] upload error: ${details}`);
        result = { key: item.key, status: 'failed', error: details };
      }
      else await sleep(attempt * 1000);
    }
  }
  results.push(result);
  console.log(`[${index + 1}/${selected.length}] ${result.status}: ${item.key}`);
  writeFileSync(reportPath, JSON.stringify({ sourceBucket, destBucket, dryRun, totalFound: files.length, results }, null, 2));
}
writeFileSync(reportPath, JSON.stringify({ sourceBucket, destBucket, dryRun, totalFound: files.length, results }, null, 2));
console.log(`Report: ${reportPath}; verified=${results.filter(x => x.status === 'verified').length}; failed=${results.filter(x => x.status === 'failed').length}`);
if (results.some(x => x.status === 'failed')) process.exitCode = 1;
