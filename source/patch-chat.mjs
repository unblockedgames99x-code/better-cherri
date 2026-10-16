import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`Expected one private API patch anchor: ${before.slice(0,80)}`);
  return source.replace(before, after);
}
export function patchChat(source) {
  if (!source.includes('GM="better_cherri_session_token"')) source = replaceOnce(source, 'GM="session_token"', 'GM="better_cherri_session_token"');
  if (!source.includes('kCA=new Set(["session_token","better_cherri_session_token",')) source = replaceOnce(source, 'kCA=new Set(["session_token",', 'kCA=new Set(["session_token","better_cherri_session_token",');
  const start = 'if(wpA(),Mv()){let A=window.fetch.bind(window);window.fetch=';
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf('var oRA=', startIndex);
  if (!source.includes('window.__betterCherriRequest(g,I,A,NE())')) {
    if (startIndex < 0 || endIndex < 0) throw new Error('Original fetch router was not found');
    source = source.slice(0,startIndex) + 'if(wpA(),!0){let A=window.fetch.bind(window);window.fetch=(g,I)=>window.__betterCherriRequest(g,I,A,NE())}' + source.slice(endIndex);
  }
  if (!source.includes('function Y0(A,g){if(!window.__betterCherriBackend())')) source = replaceOnce(source, 'function Y0(A,g){let I=null,', 'function Y0(A,g){if(!window.__betterCherriBackend())return{close(){},send(){},isOpen:()=>!1};let I=null,');
  const route = 'o=()=>{let h=NE();if(h){let w=new URL(h),d=w.protocol==="https:"?"wss:":"ws:",u=w.pathname.replace(/\\/+$/,"");return`${d}//${w.host}${u}${A}`}return`${location.protocol==="https:"?"wss:":"ws:"}//${location.host}${A}`}';
  if (!source.includes('o=()=>window.__betterCherriSocket(A)')) source = replaceOnce(source, route, 'o=()=>window.__betterCherriSocket(A)');
  if (!source.includes('Browse Better Cherri members only.')) source = replaceOnce(source, 'Browse every public profile in the database.', 'Browse Better Cherri members only.');
  return source;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input,output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node patch-chat.mjs input.js output.js');
  await writeFile(output,patchChat(await readFile(input,'utf8')));
  console.log(`Patched private chat routing: ${output}`);
}
