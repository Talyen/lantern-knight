import fs from 'node:fs/promises';
import path from 'node:path';
import { convertLegacySceneDocument } from '../../src/content/scene-document';

export function conversionOptions(args: string[]) {
  if (
    args.length !== 6 ||
    args[0] !== '--input' ||
    !args[1] ||
    args[2] !== '--profile' ||
    !['study', 'graveyard', 'chapel'].includes(args[3]!) ||
    args[4] !== '--output' ||
    !args[5]
  )
    throw new Error(
      'Use scene:convert --input <old.json> --profile <study|graveyard|chapel> --output <new.json>',
    );
  return {
    input: path.resolve(args[1]),
    profile: args[3] as 'study' | 'graveyard' | 'chapel',
    output: path.resolve(args[5]),
  };
}
export async function convertScene(args: string[]) {
  const options = conversionOptions(args),
    stat = await fs.lstat(options.input);
  if (!stat.isFile() || stat.size > 64 * 1024 || !options.output.endsWith('.json'))
    throw new Error('Scene conversion requires bounded regular JSON files');
  const value = JSON.parse(await fs.readFile(options.input, 'utf8'));
  const document = convertLegacySceneDocument(
    { ...value, id: path.basename(options.output, '.json'), target: 'draft' },
    options.profile,
  );
  await fs.writeFile(options.output, JSON.stringify(document, null, 2) + '\n', { flag: 'wx' });
  console.log('Converted draft without altering artwork/transforms: ' + options.output);
}
