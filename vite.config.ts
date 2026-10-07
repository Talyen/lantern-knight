import {defineConfig} from 'vite';
import path from 'node:path';
import {publicRoot} from './tools/assets/paths.ts';
export default defineConfig(({mode})=>({publicDir:publicRoot(),server:{fs:{allow:[process.cwd(),publicRoot()]}},build:{outDir:mode==='sandbox'?'dist-dev':'dist',rolldownOptions:{input:mode==='sandbox'?{game:path.resolve('index.html'),sandbox:path.resolve('sandbox.html'),effects:path.resolve('effects.html')}:path.resolve('index.html')}}}));
