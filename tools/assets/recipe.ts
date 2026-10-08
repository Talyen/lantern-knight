import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import recipe from '../../assets/recipe.json';
import { projectRoot, safeRelative } from './paths';
const RecipeSchema = z
  .object({
    schemaVersion: z.literal(1),
    steps: z.array(z.object({ file: z.string(), freshness: z.boolean() }).strict()).nonempty(),
    inputs: z.array(z.string()).nonempty(),
    dependencies: z
      .object({ devDependencies: z.array(z.string()), dependencies: z.array(z.string()) })
      .strict(),
  })
  .strict();
export const preparationSteps = RecipeSchema.parse(recipe).steps;
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
