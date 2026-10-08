import {execFileSync} from 'node:child_process';
import {readLock,recipeHash} from './assets/pack';

// Check each outgoing snapshot, even when unrelated working-tree edits exist.
export async function checkCommittedAssetPin(cwd=process.cwd(),ref='HEAD'){
 if(!/^(?:HEAD|[a-f0-9]{40,64})$/.test(ref))throw new Error('Expected HEAD or an outgoing commit SHA.');
 const read=(name:string)=>Promise.resolve(execFileSync('git',['show',`${ref}:${name}`],{cwd,maxBuffer:1024*1024}));
 const tools=()=>Promise.resolve(execFileSync('git',['ls-tree','--name-only',`${ref}:tools`],{cwd,encoding:'utf8'}).trim().split('\n'));
 const lock=await readLock(read);
 if(lock.recipeSha256!==await recipeHash(read,tools))throw new Error('Committed asset recipes differ from assets/lock.json. Validate the local preparation, obtain publication approval, run npm run assets:publish, then commit the updated pin before pushing.');
}
if(process.argv[1]?.endsWith('check-asset-pin.ts'))checkCommittedAssetPin(process.cwd(),process.argv[2]).then(()=>console.log('PASS: committed asset recipes match the published pack pin.')).catch(error=>{console.error(error.message);process.exitCode=1;});
