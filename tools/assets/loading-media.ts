import { createHash } from 'node:crypto';
import sources from '../../assets/loading-sources.json';

export function validateLoadingVideo(bytes: Uint8Array) {
  const expected = sources.files['last-ferry']['Lantern_C_LastFerry_Preview.mp4'];
  if (
    bytes.byteLength !== expected.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== expected.sha256
  )
    throw new Error('Last Ferry loading video differs from the selected original');
}
