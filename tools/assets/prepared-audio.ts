import { audioManifestPath, parseAudioManifest, type AudioManifest } from '../../src/assets/audio';

// Pins published before audio are silent. A present manifest must still validate,
// and failures fetching or verifying its samples remain fatal.
export async function readPreparedAudio(
  read: (file: string) => Promise<Buffer>,
): Promise<AudioManifest> {
  let bytes: Buffer;
  try {
    bytes = await read(audioManifestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { schemaVersion: 1, samples: [] };
  }
  return parseAudioManifest(JSON.parse(bytes.toString()));
}
