import {z} from 'zod';
const point=z.object({x:z.number().finite().min(-7.5).max(7.5),z:z.number().finite().min(-7.5).max(7.5),health:z.number().int().min(0).max(100)}).strict();
export const GameSchema=z.object({version:z.literal(1),seed:z.number().int().min(0).max(4294967295),wins:z.number().int().nonnegative().max(100000),hero:point,enemies:z.array(point).length(3)}).strict();
export const SettingsSchema=z.object({version:z.literal(1),renderScale:z.number().min(.5).max(1),showDebug:z.boolean()}).strict();
export type GameSave=z.infer<typeof GameSchema>;
export type Settings=z.infer<typeof SettingsSchema>;
export function parseGame(value:unknown):GameSave {
  if(typeof value==='object'&&value!==null&&'version' in value&&value.version===0){const v=z.object({version:z.literal(0),seed:z.number().int().nonnegative(),wins:z.number().int().nonnegative()}).strict().parse(value);return GameSchema.parse({version:1,seed:v.seed,wins:v.wins,hero:{x:0,z:2.3,health:100},enemies:[-2.5,.2,2.9].map(x=>({x,z:-3.5,health:70}))});}
  return GameSchema.parse(value);
}
export type LoadResult<T>={status:'empty'}|{status:'ok'|'recovered';data:T}|{status:'unreadable';message:string};
export interface Bridge {loadSettings():Promise<LoadResult<Settings>>;saveSettings(value:Settings):Promise<void>;loadGame():Promise<LoadResult<GameSave>>;saveGame(value:GameSave):Promise<void>}
declare global {interface Window{lantern?:Bridge}}
export const browserBridge:Bridge={
  async loadSettings(){return read('settings',v=>SettingsSchema.parse(v));},async saveSettings(v){localStorage.setItem('lantern-settings',JSON.stringify(SettingsSchema.parse(v)));},
  async loadGame(){return read('game',parseGame);},async saveGame(v){localStorage.setItem('lantern-game',JSON.stringify(parseGame(v)));},
};
function read<T>(slot:string,parse:(v:unknown)=>T):LoadResult<T>{const value=localStorage.getItem(`lantern-${slot}`);if(!value)return{status:'empty'};try{return{status:'ok',data:parse(JSON.parse(value))};}catch{return{status:'unreadable',message:'Stored data is unreadable; it has been preserved.'};}}
