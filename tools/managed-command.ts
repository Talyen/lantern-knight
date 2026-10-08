import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {acquireCommandLane} from './command-lane';
import {runProcess} from './run-process';

// Admit before loading task modules, assets, diagnostics or source fingerprints.
async function main(){
 const [file,...args]=process.argv.slice(2);if(!file)throw new Error('Supply a Node entry point and its arguments.');
 const cwd=fileURLToPath(new URL('../',import.meta.url)),lane=await acquireCommandLane({cwd,command:[file,...args].join(' ')});
 const python=file.endsWith('.py');
 try{await runProcess(python?'python3':process.execPath,[...(python?['-B']:file.endsWith('.ts')?['--import','tsx']:[]),path.resolve(cwd,file),...args],{cwd,env:lane.env});}
 finally{await lane.release();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
