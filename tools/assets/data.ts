import fs from 'node:fs';
import { publicFile } from './paths';
import { parseRegistration } from '../../src/assets/registration';
export const readRegistration = () =>
  parseRegistration(JSON.parse(fs.readFileSync(publicFile('registration.json'), 'utf8')));
