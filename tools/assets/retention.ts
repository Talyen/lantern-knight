import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LockSchema, type AssetLock } from './pack';
import { projectRoot } from './paths';
const exec = promisify(execFile);
export const gh = async (args: string[]) => {
  const result = await exec('gh', args, { cwd: projectRoot, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout;
};
type GitHub = (args: string[]) => Promise<string>;
export async function retainedPacks(local: AssetLock, github: GitHub = gh) {
  const keep = new Set([local.releaseTag]);
  async function pin(repo: string, ref: string) {
    const response = JSON.parse(
      await github([
        'api',
        `repos/${repo}/contents/assets/lock.json?ref=${encodeURIComponent(ref)}`,
      ]),
    );
    if (response.encoding !== 'base64' || typeof response.content !== 'string')
      throw new Error('Cannot verify retained asset reference');
    keep.add(
      LockSchema.parse(JSON.parse(Buffer.from(response.content, 'base64').toString())).releaseTag,
    );
  }
  await pin('Talyen/lantern-knight', 'main');
  const pulls = JSON.parse(
    await github([
      'api',
      '--paginate',
      '--slurp',
      'repos/Talyen/lantern-knight/pulls?state=open&per_page=100',
    ]),
  ) as { head: { sha: string; repo: { full_name: string } | null } }[][];
  for (const pull of pulls.flat()) {
    if (!pull.head.repo) throw new Error('Cannot inspect an open pull request');
    await pin(pull.head.repo.full_name, pull.head.sha);
  }
  const supported = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'assets/supported.json'), 'utf8'),
  ) as { schemaVersion: number; releases: string[] };
  if (
    supported.schemaVersion !== 1 ||
    !Array.isArray(supported.releases) ||
    supported.releases.some((tag) => typeof tag !== 'string')
  )
    throw new Error('Invalid supported release list');
  for (const tag of supported.releases) await pin('Talyen/lantern-knight', tag);
  return keep;
}
export async function obsoleteReleases(keep: ReadonlySet<string>, github: GitHub = gh) {
  const pages = JSON.parse(
    await github([
      'api',
      '--paginate',
      '--slurp',
      'repos/Talyen/lantern-knight/releases?per_page=100',
    ]),
  ) as { tag_name: string }[][];
  return pages
    .flat()
    .map((r) => r.tag_name)
    .filter((tag) => /^assets-[a-f0-9]{16}$/.test(tag) && !keep.has(tag));
}
