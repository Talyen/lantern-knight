import fs from 'node:fs/promises';
import path from 'node:path';
import * as ts from 'typescript/unstable/ast';
import {API} from 'typescript/unstable/sync';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {builtinModules} from 'node:module';

// These rules protect existing owners, including type imports and re-exports.
// Three.js math and the current core/content/asset relationships remain legal.
export function importFinding(file:string,target:string){
 if(!file.startsWith('src/'))return;
 if(/^(?:electron|tools|tests)\//.test(target)||target==='electron'||target.startsWith('node:')||builtinModules.includes(target)||target.startsWith('../')||path.isAbsolute(target))return 'runtime source must use its browser/Bridge seam, not desktop or tooling imports';
 if(/^src\/(?:core|content|assets)\//.test(file)&&target.startsWith('src/')&&!/^src\/(?:core|content|assets)\//.test(target))return 'core, content and assets must not depend on application, presentation or developer entry points';
}
export async function checkArchitecture(root:string,files:string[]){
 const api=new API({cwd:root}),findings:string[]=[];
 try{
 const snapshot=api.updateSnapshot({openProjects:[path.join(root,'tsconfig.json')]}),project=snapshot.getProject(path.join(root,'tsconfig.json'));
 if(!project)throw new Error('Architecture checker could not open tsconfig.json');
 for(const file of files.filter(f=>f.startsWith('src/')&&/\.[cm]?tsx?$/.test(f))){
  let text:string;try{text=await fs.readFile(path.join(root,file),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
  const source=project.program.getSourceFile(path.join(root,file));if(!source)throw new Error(`Runtime file is outside tsconfig: ${file}`);
  const inspect=(node:ts.Node)=>{
   let specifier:ts.Node|undefined;
   if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))specifier=node.moduleSpecifier;
   else if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference))specifier=node.moduleReference.expression;
   else if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument))specifier=node.argument.literal;
   else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require'))specifier=node.arguments[0];
   if(specifier){
    const line=text.slice(0,node.getStart(source)).split('\n').length;
    if(!ts.isStringLiteral(specifier)&&!ts.isNoSubstitutionTemplateLiteral(specifier)){findings.push(`${file}:${line}: module imports must have a literal target for boundary validation`);}
    else{
     const name=specifier.text;
     // Native handles use case-folded paths on macOS; the resolved SourceFile
     // retains spelling so path.relative does not misclassify an internal edge.
     const declaration=project.checker.getSymbolAtLocation(specifier)?.declarations.find(node=>node.kind===ts.SyntaxKind.SourceFile)?.resolve(project);
     const resolved=declaration&&ts.isSourceFile(declaration)?declaration.fileName:undefined;
     const target=resolved&&!resolved.replaceAll('\\','/').includes('/node_modules/')?path.relative(root,resolved).split(path.sep).join('/'):name.startsWith('.')?path.relative(root,path.resolve(root,path.dirname(file),name)).split(path.sep).join('/'):name;
     const finding=importFinding(file,target);if(finding)findings.push(`${file}:${line}: ${name}: ${finding}`);
    }
   }
   node.forEachChild(inspect);
  };inspect(source);
 }
 snapshot.dispose();return findings;
 }finally{api.close();}
}
async function main(){
 const root=fileURLToPath(new URL('../',import.meta.url)),files=execFileSync('git',['-c','core.fsmonitor=false','-c','core.untrackedCache=false','ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0');
 const findings=await checkArchitecture(root,[...new Set(files)]);
 if(findings.length)throw new Error(`${findings.length} import boundary violations:\n${findings.slice(0,10).join('\n')}`);
 console.log('PASS: runtime import boundaries, including type imports, exports and dynamic imports.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
