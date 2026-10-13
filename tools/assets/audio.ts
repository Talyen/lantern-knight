import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { runProcess } from '../run-process';
import recipes from '../../assets/audio-sources.json';
import { audioManifestPath, parseAudioManifest, type AudioManifest } from '../../src/assets/audio';
import type { PreparationContext } from './context';
import { safeRelative } from './files';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
async function capture(command: string, args: string[], env: NodeJS.ProcessEnv) {
  let output = '';
  try {
    await runProcess(command, args, {
      cwd: process.cwd(),
      env,
      timeoutMs: 60_000,
      output: (chunk) => {
        output = (output + chunk.toString()).slice(-12000);
      },
    });
  } catch (error) {
    throw new Error(command + ': ' + output.slice(-4000), { cause: error });
  }
  return output;
}
export async function audioTools(env: NodeJS.ProcessEnv) {
  const ffmpeg = env.LANTERN_FFMPEG ?? 'ffmpeg',
    ffprobe = env.LANTERN_FFPROBE ?? 'ffprobe';
  const versions = await Promise.all([
    capture(ffmpeg, ['-version'], env),
    capture(ffprobe, ['-version'], env),
  ]);
  if (versions.some((v) => !new RegExp(`version ${recipes.encoderMajor}\\.`).test(v)))
    throw new Error(`Audio preparation requires FFmpeg/FFprobe ${recipes.encoderMajor}.x`);
  return {
    ffmpeg,
    ffprobe,
    versions: versions.map((value) => value.split('\n')[0]),
    fingerprint: sha(versions.join('\n')),
  };
}
export async function verifyAudioSources(
  libraryRoot: string,
  env: NodeJS.ProcessEnv,
  selected: readonly { source: string; sha256: string }[] = recipes.entries,
) {
  const root = path.resolve(
    env.LANTERN_SOUND_LIBRARY ?? path.join(libraryRoot, recipes.libraryDirectory),
  );
  for (const recipe of selected) {
    safeRelative(recipe.source);
    const source = path.join(root, recipe.source);
    if (
      !(await fs.realpath(source)).startsWith((await fs.realpath(root)) + path.sep) ||
      sha(await fs.readFile(source)) !== recipe.sha256
    )
      throw new Error('Audio source changed or escaped library: ' + recipe.source);
  }
}
export async function prepareAudio(context: PreparationContext, check: boolean) {
  const env = context.environment,
    tools = await audioTools(env);
  const root = path.resolve(
    env.LANTERN_SOUND_LIBRARY ?? path.join(context.libraryRoot, recipes.libraryDirectory),
  );
  const manifest: AudioManifest = { schemaVersion: 1, samples: [] };
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-audio-'));
  const receipts = [];
  try {
    for (const recipe of recipes.entries) {
      safeRelative(recipe.source);
      const source = path.join(root, recipe.source);
      if (!(await fs.realpath(source)).startsWith((await fs.realpath(root)) + path.sep))
        throw new Error('Audio source escapes library');
      const original = await fs.readFile(source);
      if (sha(original) !== recipe.sha256)
        throw new Error('Audio source changed: ' + recipe.source);
      if (check) continue;
      const file = path.join(temporary, recipe.id + (recipe.loop ? '.ogg' : '.wav'));
      const analysis = await capture(
        tools.ffmpeg,
        [
          '-hide_banner',
          '-nostdin',
          '-ss',
          String(recipe.start),
          '-i',
          source,
          '-t',
          String(recipe.duration),
          '-af',
          'volumedetect',
          '-f',
          'null',
          '-',
        ],
        env,
      );
      const mean = Number(/mean_volume: ([\d.-]+) dB/.exec(analysis)?.[1]);
      const peak = Number(/max_volume: ([\d.-]+) dB/.exec(analysis)?.[1]);
      if (!Number.isFinite(mean) || !Number.isFinite(peak))
        throw new Error('Silent or invalid source: ' + recipe.id);
      const gainDb = Math.min(18, -18 - mean, -2 - peak) + recipe.gainDb;

      // Leading-silence removal applies only to one-shots. Loops use a short
      // equal-power seam baked into their samples; playback itself is gapless.
      const filters = [
        'silenceremove=start_periods=1:start_duration=0.003:start_threshold=-55dB',
        `atrim=duration=${recipe.duration}`,
        `volume=${gainDb}dB`,
        'alimiter=limit=0.89:level=false:latency=true',
        // Fade the actual terminal samples even when leading-silence removal
        // shortened the segment. Reverse operates only on bounded one-shots.
        'areverse',
        'afade=t=in:d=0.015',
        'areverse',
      ];
      // Use a simple filtergraph for one-shots and a named graph for loop seams.
      const loopGraph = recipe.loop
        ? `[0:a]atrim=duration=${recipe.duration + 0.25},asplit[a][b];[a]atrim=start=0.25,asetpts=PTS-STARTPTS[c];[b]atrim=end=0.25,asetpts=PTS-STARTPTS[d];[c][d]acrossfade=d=0.25:c1=qsin:c2=qsin,volume=${gainDb}dB,alimiter=limit=0.89:level=false:latency=true[out]`
        : undefined;
      await capture(
        tools.ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-y',
          '-ss',
          String(recipe.start),
          '-i',
          source,
          '-t',
          String(recipe.duration + (recipe.loop ? 0.25 : 0)),
          ...(loopGraph
            ? ['-filter_complex', loopGraph, '-map', '[out]']
            : ['-af', filters.join(',')]),
          '-ac',
          recipe.loop ? '2' : '1',
          '-ar',
          recipe.loop ? '48000' : '44100',
          '-map_metadata',
          '-1',
          '-fflags',
          '+bitexact',
          '-flags:a',
          '+bitexact',
          ...(recipe.loop
            ? ['-c:a', 'vorbis', '-strict', 'experimental', '-b:a', '128k']
            : ['-c:a', 'pcm_s16le']),
          file,
        ],
        env,
      );
      const info = JSON.parse(
        await capture(
          tools.ffprobe,
          ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
          env,
        ),
      );
      const bytes = await fs.readFile(file),
        hash = sha(bytes),
        duration = Number(info.format.duration);
      const stream = info.streams[0];
      if (!(duration > 0.01 && duration <= 30))
        throw new Error('Empty or excessive audio: ' + recipe.id);
      const output = `audio/${hash}.${recipe.loop ? 'ogg' : 'wav'}`;
      await context.writeAsset('public/' + output, bytes);
      manifest.samples.push({
        id: recipe.id,
        cue: recipe.cue,
        path: output,
        hash,
        bytes: bytes.length,
        duration,
        channels: Number(stream.channels) as 1 | 2,
        sampleRate: Number(stream.sample_rate) as 44100 | 48000,
        loop: recipe.loop,
        loopStart: 0,
        loopEnd: duration,
      });
      receipts.push({
        ...recipe,
        output,
        outputHash: hash,
        toolFingerprint: tools.fingerprint,
        measuredMeanDb: mean,
        measuredPeakDb: peak,
        appliedGainDb: gainDb,
      });
    }
    if (check) {
      const prepared = parseAudioManifest(
        JSON.parse(await context.readAsset('public/' + audioManifestPath, 'utf8')),
      );
      if (prepared.samples.length !== recipes.entries.length)
        throw new Error('Incomplete prepared audio');
      for (const sample of prepared.samples) {
        const bytes = await context.readAsset('public/' + sample.path);
        if (bytes.length !== sample.bytes || sha(bytes) !== sample.hash)
          throw new Error('Prepared audio differs: ' + sample.id);
      }
    } else {
      parseAudioManifest(manifest);
      await context.writeAsset('public/' + audioManifestPath, JSON.stringify(manifest));
      await context.writeAsset(
        'staging/audio/receipt.json',
        JSON.stringify({ schemaVersion: 1, tools: tools.versions, sources: receipts }),
      );
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
