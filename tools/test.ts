import {run} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {inspect} from 'node:util';
import {randomUUID} from 'node:crypto';
import {AssetCache} from './assets/cache';
const files=(await fs.readdir('tests')).filter(n=>n.endsWith('.test.ts')).map(n=>'tests/'+n);
let passed=0,failed=0,details='';
for await(const event of run({files,execArgv:['--import','tsx'],concurrency:true})){
 if(event.type==='test:pass')passed++;
 if(event.type==='test:fail'){failed++;const message=inspect(event.data.details.error,{depth:4,maxArrayLength:20,maxStringLength:2000});if(failed<=5)console.error(`${event.data.name}: ${message.slice(0,3000)}`);details+=(event.data.name+'\n'+message+'\n').slice(0,32768);}
 if(event.type==='test:stderr'||event.type==='test:stdout')details=(details+event.data.message).slice(-1024*1024);
}
console.log(`${passed} checks passed; ${failed} failed.`);
if(failed){const cache=new AssetCache(),held=await cache.lease('diagnostics-'+randomUUID(),2*1024*1024);try{await fs.writeFile(path.join(held.root,'tests.log'),details.slice(-1024*1024));console.error('Failure diagnostics: '+path.join(held.root,'tests.log'));}finally{await held.release();}process.exitCode=1;}
