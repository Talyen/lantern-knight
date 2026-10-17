import { onAsyncExit } from '../scope-exit';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import timers from 'node:timers/promises';

function transientTransportFailure(error: unknown) {
  const visited = new Set<unknown>();
  while (error && typeof error === 'object' && !visited.has(error)) {
    visited.add(error);
    if (
      'code' in error &&
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'EAI_AGAIN',
        'ETIMEDOUT',
        'UND_ERR_SOCKET',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_BODY_TIMEOUT',
      ].includes(String(error.code))
    )
      return true;
    error = 'cause' in error ? error.cause : undefined;
  }
  return false;
}

// Exact ranges transfer no archive neighbors. Stream to disk with an exact
// size cap, hash before rename, and leave no usable output after cancellation.
export async function downloadFile(...args: Parameters<typeof downloadAttempt>) {
  const signal = args[4];
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadAttempt(...args);
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt === 2 || !transientTransportFailure(error)) throw error;
      // Failed attempts have already removed their temporary bytes. Every retry
      // repeats the exact range and verifies the complete response before install.
      await timers.setTimeout(250 * (attempt + 1), undefined, { signal });
    }
  }
}

async function downloadAttempt(
  url: string,
  info: { bytes: number; sha256: string },
  target: string,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
  range?: { offset: number; totalBytes: number },
) {
  signal?.throwIfAborted();
  if (info.bytes === 0) {
    if (info.sha256 !== createHash('sha256').update('').digest('hex'))
      throw new Error('Empty asset hash differs');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '');
    return;
  }
  const end = range ? range.offset + info.bytes - 1 : 0;
  const response = await request(url, {
    signal,
    headers: range ? { Range: `bytes=${range.offset}-${end}`, 'Accept-Encoding': 'identity' } : {},
  });
  if (
    range &&
    (response.status !== 206 ||
      response.headers.get('content-range') !==
        `bytes ${range.offset}-${end}/${range.totalBytes}` ||
      (response.headers.get('content-encoding') &&
        response.headers.get('content-encoding') !== 'identity'))
  ) {
    await response.body?.cancel();
    throw new Error('Asset server did not honor the exact byte range');
  }
  if (!response.ok || !response.body)
    throw new Error(`Asset file unavailable: HTTP ${response.status}`);
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) !== info.bytes) {
    await response.body.cancel();
    throw new Error('Asset file size differs from pin');
  }
  const temporary = target + '.' + randomUUID();
  const hash = createHash('sha256');
  let bytes = 0;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const output = await fs.open(temporary, 'wx');
  await using _scopeExit1 = onAsyncExit(async () => {
    await output.close();
    await fs.rm(temporary, { force: true });
  });
  async function* checked() {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      signal?.throwIfAborted();
      bytes += chunk.length;
      if (bytes > info.bytes) throw new Error('Asset file exceeds pinned size');
      hash.update(chunk);
      yield chunk;
    }
  }
  await pipeline(checked(), output.createWriteStream());
  signal?.throwIfAborted();
  if (bytes !== info.bytes || hash.digest('hex') !== info.sha256)
    throw new Error('Asset file hash or size differs from pin');
  await fs.rename(temporary, target);
}
