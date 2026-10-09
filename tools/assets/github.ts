import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { projectRoot } from './paths';
const exec = promisify(execFile);
export const gh = async (args: string[]) =>
  (await exec('gh', args, { cwd: projectRoot, maxBuffer: 4 * 1024 * 1024 })).stdout;
