import fs from 'node:fs';
import {publicFile,metadataFile} from './paths';
import {parseRegistration} from '../../src/assets/registration';
export const readRegistration=()=>parseRegistration(JSON.parse(fs.readFileSync(publicFile('registration.json'),'utf8')));
export const readReceipt=(file:string)=>JSON.parse(fs.readFileSync(metadataFile(file),'utf8'));
