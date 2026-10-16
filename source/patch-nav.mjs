import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function patchNavigation(input){
  let source=input;
  const edits=[];
  function replace(name,before,after,count=1){const found=source.split(before).length-1;if(found!==count)throw Error(`${name}: expected ${count} matches, found ${found}`);source=source.split(before).join(after);edits.push({name,count})}
  // Internal pages now share their host window through MemoryRouter. In an
  // about:blank launcher's cross-origin frame, parent is the launcher, while
  // this window itself owns the tabs and audio player.
  replace('resolve local host before accessible parent', 'function Vt(A,g){window.parent?.__cherriNavigate?window.parent.__cherriNavigate(A):g()}', 'function betterCherriHostWindow(){if(window.__cherriHost===!0)return window;try{if(window.parent!==window&&window.parent.__cherriHost===!0)return window.parent}catch{}return null}function Vt(A,g){if(typeof window.__cherriNavigate==="function")return window.__cherriNavigate(A);let I;try{I=window.parent?.__cherriNavigate}catch{}return typeof I==="function"?I(A):g()}');
  replace('music host detection in framed app', 'function xn(){try{return(window.parent===window?window:window.parent).__cherriHost===!0}catch{return!1}}', 'function xn(){return!!betterCherriHostWindow()}');
  replace('audio lookup uses resolved host', 'try{return window.parent.__cherriAudio}catch{return}', 'try{return(betterCherriHostWindow()||window).__cherriAudio}catch{return}');
  replace('music and party messages target real app host', 'window.parent.postMessage(', '(betterCherriHostWindow()||window.parent).postMessage(', 6);
  replace('open tab fallback tolerates cross-origin parent', 'function UY(A){let g=window.__cherriOpenTab??window.parent?.__cherriOpenTab;g?g(`cherri://${A}`):window.open(Bs(`/${A}`),"_blank","noopener")}', 'function UY(A){let g=window.__cherriOpenTab;if(!g)try{g=window.parent?.__cherriOpenTab}catch{}g?g(`cherri://${A}`):window.open(Bs(`/${A}`),"_blank","noopener")}');
  return{source,edits};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const target=path.resolve(process.argv[2]||'work/cherri/b/assets/bundle-i7rlf846.js');
  const {source,edits}=patchNavigation(fs.readFileSync(target,'utf8'));
  if(!process.argv.includes('--dry-run'))fs.writeFileSync(target,source);
  console.log(JSON.stringify({target,dryRun:process.argv.includes('--dry-run'),edits}));
}
