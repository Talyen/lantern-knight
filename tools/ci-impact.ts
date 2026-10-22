import { runCli } from './cli';
import { coverageFor } from './coverage-policy';
import fs from 'node:fs/promises';
import { comparisonFiles } from './changed-files';
async function main() {
  const base = process.env.LANTERN_CI_BASE;
  const { source, desktop, authoring, assets } = coverageFor(
    base ? comparisonFiles(process.cwd(), base) : undefined,
  );
  console.log(`CI: source=${source}; desktop=${desktop}; authoring=${authoring}; assets=${assets}`);
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(
      process.env.GITHUB_OUTPUT,
      `source=${source}\ndesktop=${desktop}\nauthoring=${authoring}\nassets=${assets}\n`,
    );
}
runCli(import.meta.url, () => main());
