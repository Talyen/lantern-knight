import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AssetCache,diskBytes} from './cache';
import {projectRoot} from './paths';
import {readLibrarySource} from './sources';
import {calibrationFixture} from '../../src/core/camera';
import {stagePayload} from './payload';
import {makeArchive,recipeHash} from './pack';
const exec=promisify(execFile),BUDGET=3*1024**3;
export async function prepareAssets(cache=new AssetCache()){
 const held=await cache.lease('preparation',BUDGET,true),workspace=path.join(held.root,'work');
 const env={...process.env,LANTERN_ASSET_WORKSPACE:workspace,LANTERN_PREPARING:'1',LANTERN_PREPARE_BUDGET:String(BUDGET-16*1024*1024)};
 try{
  await fs.rm(workspace,{recursive:true,force:true});await fs.mkdir(path.join(workspace,'public'),{recursive:true});
  await fs.writeFile(path.join(workspace,'public/build-mode.json'),JSON.stringify({allowDevelopmentContent:true}));
  await fs.mkdir(path.join(workspace,'public/generated'),{recursive:true});
  await fs.writeFile(path.join(workspace,'public/generated/calibration.json'),JSON.stringify(calibrationFixture()));
  const startRecipe=await recipeHash();
  async function step(file:string,args:string[]=[]){
   try{await exec(process.execPath,['--import','tsx',path.join(projectRoot,file),...args],{cwd:projectRoot,env,maxBuffer:4*1024*1024});}
   catch(error){const failure=error as Error&{stdout?:string;stderr?:string};const log=(failure.stdout??'')+'\n'+(failure.stderr??'');await fs.writeFile(path.join(held.root,'failure.log'),log.slice(-1024*1024));throw new Error(`${file} failed: ${log.split('\n').filter(Boolean).slice(-8).join('\n')}`);}
   if(await diskBytes(held.root)>BUDGET)throw new Error('Asset preparation exceeded its reservation');
  }
  for(const file of ['prepare-masonry.ts','prepare-ink.ts','prepare-hero.ts','prepare-graveyard-art.ts','prepare-graveyard-ground.ts','prepare-churchyard-kit.ts','prepare-graveyard-coverage.ts','prepare-visual-effects.ts','prepare-surface-relief.ts','prepare-effects-playground.ts','prepare-lighting.ts'])await step('tools/'+file);
  try{await exec('python3',['-B','tools/prepare-animation-flow.py'],{cwd:projectRoot,env,maxBuffer:1024*1024});}catch(error){throw new Error('Animation-field preparation failed: '+String((error as Error).message).slice(0,800));}
  const payload=path.join(workspace,'payload');await stagePayload(path.join(workspace,'public'),path.join(workspace,'staging'),payload);
  await fs.copyFile(path.join(payload,'public/registration.json'),path.join(workspace,'public/registration.json'));
  // Source fidelity belongs here; ordinary CI only validates prepared data.
  await step('tools/check-source-assets.ts');
  for(const file of ['prepare-masonry.ts','prepare-ink.ts','prepare-hero.ts','prepare-graveyard-art.ts','prepare-graveyard-ground.ts','prepare-churchyard-kit.ts','prepare-graveyard-coverage.ts','prepare-visual-effects.ts','prepare-surface-relief.ts','prepare-effects-playground.ts','prepare-lighting.ts'])await step('tools/'+file,['--check']);
  if(await recipeHash()!==startRecipe)throw new Error('Asset recipes changed during preparation; retry');
  const archive=path.join(held.root,'lantern-assets.tar.gz'),lock=await makeArchive(payload,archive,startRecipe);
  if(await diskBytes(held.root)>BUDGET)throw new Error('Prepared asset archive exceeded its reservation');
  await fs.writeFile(path.join(held.root,'prepared.json'),JSON.stringify(lock));
  console.log(`Prepared shared asset pack: ${(lock.bytes/1024**2).toFixed(1)} MiB; sources verified.`);
  return {held,payload,archive,lock};
 }catch(error){await held.release();throw error;}
}
