import fs from 'node:fs/promises';
import { snapshot, inputKey, phaseEvidence } from './task-state';
import { dependencyInputs } from './verification-plan';
import { fileChecksums } from './verified-files';
import { shaFile } from './assets/sources';

export async function reusableDeliveryPhase(
  root: string,
  options: {
    name: string;
    entry: string;
    args: string[];
    assets?: string;
    outputFiles?: string[];
    run: () => Promise<string[]>;
  },
) {
  const inputs = await snapshot(root);
  const names = await dependencyInputs(root, [options.entry], inputs);
  if (options.outputFiles) for (const file of options.outputFiles) names.push(file);
  const identity = options.outputFiles ? await fileChecksums(root, options.outputFiles) : {};
  const key = inputKey(
    inputs,
    names,
    JSON.stringify([
      'delivery-phase-v1',
      options.name,
      options.args,
      options.assets,
      process.version,
      process.platform,
      identity,
    ]),
  );
  const result = await phaseEvidence(
    root,
    'delivery:' + options.name,
    key,
    async () => {
      const captures = await options.run();
      if (inputKey(inputs, names, 'stable') !== inputKey(await snapshot(root), names, 'stable'))
        throw new Error('Phase inputs changed: ' + options.name);
      if (
        options.outputFiles &&
        JSON.stringify(identity) !== JSON.stringify(await fileChecksums(root, options.outputFiles))
      )
        throw new Error('Phase package outputs changed: ' + options.name);
      const files: Record<string, string> = {};
      for (const directory of captures)
        for (const name of await fs.readdir(directory)) {
          if (name.endsWith('.png'))
            files[directory + '/' + name] = await shaFile(directory + '/' + name);
        }
      return { captures, files };
    },
    async (proof) => {
      try {
        for (const [file, hash] of Object.entries(proof.files))
          if ((await shaFile(file)) !== hash) return false;
        if (options.outputFiles)
          return (
            JSON.stringify(identity) ===
            JSON.stringify(await fileChecksums(root, options.outputFiles))
          );
        return true;
      } catch {
        return false;
      }
    },
  );
  if (result.reused)
    console.log('Reused matching ' + options.name + ' input/output/capture evidence.');
  return result.result.captures;
}
