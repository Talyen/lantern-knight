import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import recipe from '../../assets/recipe.json';
import { projectRoot, safeRelative } from './paths';
const RecipeSchema = z
  .object({
    schemaVersion: z.literal(1),
    steps: z
      .array(
        z
          .object({
            file: z.string(),
            freshness: z.boolean(),
            ids: z.array(z.string()).optional(),
            inputs: z.array(z.string()).optional(),
            dependsOn: z.array(z.string()).optional(),
          })
          .strict(),
      )
      .nonempty(),
    inputs: z.array(z.string()),
    sharedInputs: z.array(z.string()).default([]),
    authoredInputs: z.array(z.string()).optional(),
    dependencies: z
      .object({ devDependencies: z.array(z.string()), dependencies: z.array(z.string()) })
      .strict(),
  })
  .strict();
const authoredSteps = RecipeSchema.parse(recipe).steps;
// A producer may be declared after its consumer in the authored manifest.
// Both full and scoped preparation must execute the same dependency order.
function orderedSteps() {
  const ordered: typeof authoredSteps = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (file: string) => {
    if (visited.has(file)) return;
    if (visiting.has(file)) throw new Error('Cyclic preparation dependency: ' + file);
    const step = authoredSteps.find((step) => step.file === file);
    if (!step) throw new Error('Unknown preparation dependency: ' + file);
    visiting.add(file);
    for (const dependency of step.dependsOn ?? []) visit(dependency);
    visiting.delete(file);
    visited.add(file);
    ordered.push(step);
  };
  for (const step of authoredSteps) visit(step.file);
  return ordered;
}
export const preparationSteps = orderedSteps();
export function preparationSelection(ids: readonly string[] = []) {
  if (!ids.length) return preparationSteps;
  const selected = new Set<string>();
  const visit = (file: string) => {
    if (selected.has(file)) return;
    const step = preparationSteps.find((step) => step.file === file);
    if (!step) throw new Error('Unknown preparation dependency: ' + file);
    for (const dependency of step.dependsOn ?? []) visit(dependency);
    selected.add(file);
  };
  for (const id of ids) {
    const owners = preparationSteps.filter((step) =>
      step.ids?.some((pattern) =>
        pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern,
      ),
    );
    if (!owners.length) throw new Error('No preparation owner for asset: ' + id);
    for (const owner of owners) visit(owner.file);
  }
  return preparationSteps.filter((step) => selected.has(step.file));
}
export function preparationStepKey(
  operation: (typeof preparationSteps)[number],
  inputs: Record<string, string>,
  digests: ReadonlyMap<string, string>,
) {
  const owned = [
    ...(recipe.sharedInputs ?? []),
    ...(operation.inputs ?? Object.keys(inputs).filter((file) => file !== 'assets/recipe.json')),
  ];
  return createHash('sha256')
    .update(
      JSON.stringify([
        'preparation-step-v2',
        operation.file,
        inputs['tools/' + operation.file],
        inputs['tools/assets/recipe.ts'],
        inputs.dependencies,
        owned.map((file) => [file, inputs[file] ?? null]),
        (operation.dependsOn ?? []).map((file) => [file, digests.get(file)]),
        process.version,
        process.platform,
      ]),
    )
    .digest('hex');
}
export async function recipeInputs(
  read = (name: string) => fs.readFile(path.join(projectRoot, name)),
) {
  const bytes = await read('assets/recipe.json'),
    recipe = RecipeSchema.parse(JSON.parse(bytes.toString()));
  const config = JSON.parse((await read('package.json')).toString());
  const dependencies: Record<string, Record<string, string>> = {};
  for (const [group, names] of Object.entries(recipe.dependencies)) {
    dependencies[group] = {};
    for (const name of names) {
      const version = config[group]?.[name];
      if (typeof version !== 'string') throw new Error('Missing recipe dependency: ' + name);
      dependencies[group]![name] = version;
    }
  }
  const inputs: Record<string, string> = {
    dependencies: createHash('sha256').update(JSON.stringify(dependencies)).digest('hex'),
  };
  for (const name of [
    ...new Set([
      'assets/recipe.json',
      ...recipe.inputs,
      ...recipe.sharedInputs,
      ...recipe.steps.flatMap((step) => step.inputs ?? []),
      ...recipe.steps.map((step) => 'tools/' + step.file),
    ]),
  ].sort()) {
    safeRelative(name);
    inputs[name] = createHash('sha256')
      .update(name === 'assets/recipe.json' ? bytes : await read(name))
      .digest('hex');
  }
  return inputs;
}
export async function recipeHash(
  read = (name: string) => fs.readFile(path.join(projectRoot, name)),
) {
  return createHash('sha256')
    .update(JSON.stringify(await recipeInputs(read)))
    .digest('hex');
}

// Runtime consumption depends on authored asset intent, not preparation-tool formatting.
export async function checkAuthoredAssetInputs(
  inputs: Record<string, string>,
  read = (name: string) => fs.readFile(path.join(projectRoot, name)),
) {
  const current = RecipeSchema.parse(JSON.parse((await read('assets/recipe.json')).toString()));
  const names =
    current.authoredInputs ??
    current.inputs.filter(
      (file) =>
        /^(?:assets|authoring)\//.test(file) || /registration\.ts$|asset-catalog\.ts$/.test(file),
    );
  for (const file of names)
    if (
      !inputs[file] ||
      createHash('sha256')
        .update(await read(file))
        .digest('hex') !== inputs[file]
    )
      throw new Error(
        'Authored asset input differs from the published pin: ' +
          file +
          '. Prepare the affected assets before delivery.',
      );
}
