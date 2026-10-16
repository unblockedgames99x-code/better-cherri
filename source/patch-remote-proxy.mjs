import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Keep the proxy in the original site's secure origin, where its service worker
// can register. An about:blank app cannot own that site's service worker.
const helpers = String.raw`
function betterCherriRemoteUrl(target){
  const page=globalThis.__BETTER_CHERRI_UPSTREAM__||"https://cherrion.top/";
  const url=new URL(page);
  if(url.protocol!=="https:")throw new Error("The Cherri proxy page must use HTTPS.");
  if(/\.(?:svg|html)$/i.test(url.pathname))url.hash="/embed?u="+encodeURIComponent(target);
  else{url.pathname=new URL("embed",url).pathname;url.search="?u="+encodeURIComponent(target);url.hash=""}
  return url.href;
}
function betterCherriRemoteFrame(element,onChange,onLoad){
  const frame=element||document.createElement("iframe");
  let entries=[],index=-1,destroyed=false;
  frame.allowFullscreen=true;
  frame.allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-read; clipboard-write; microphone; camera; gamepad";
  function changed(){onChange?.(entries[index]||"",index>0,index<entries.length-1)}
  function render(){if(destroyed)return;frame.src=betterCherriRemoteUrl(entries[index]);changed()}
  frame.addEventListener("load",()=>{if(!destroyed)onLoad?.()});
  return {element:frame,
    go(target){if(destroyed)return;if(entries[index]!==target){entries=entries.slice(0,index+1);entries.push(target);index=entries.length-1}render()},
    back(){if(index>0){index--;render()}},
    forward(){if(index<entries.length-1){index++;render()}},
    reload(){render()},
    destroy(){destroyed=true;frame.remove()},
    get canBack(){return index>0},get canForward(){return index<entries.length-1}
  };
}
`;

export function patchRemoteProxy(input){
  if(input.includes('function betterCherriRemoteUrl(target)'))return {source:input,edits:[]};
  let source=input;const edits=[];
  function replace(name,before,after,count=1){
    const found=source.split(before).length-1;
    if(found!==count)throw new Error(`${name}: expected ${count} matches, found ${found}`);
    source=source.split(before).join(after);edits.push({name,count});
  }

  const open='kQ=(0,NA.useCallback)((b,X)=>{';
  const start=source.indexOf(open);
  const end=source.indexOf('Q.current=(0,NA.useCallback)(()=>{',start);
  if(start<0||end<0)throw new Error('The upstream shell proxy mount was not found.');
  const original=source.slice(start,end);
  if(!original.endsWith('[TI,v,eB]);'))throw new Error('The upstream shell proxy mount has changed.');
  const replacement=String.raw`kQ=(0,NA.useCallback)((b,X)=>{
    let hA=TI(b);
    if(!hA){let VI=(o.current[b]??0)+1;if(VI>60){delete o.current[b];return}o.current[b]=VI;requestAnimationFrame(()=>kQ(b,X));return}
    delete o.current[b];eB(s.current[b]);d.current[b]?.unmount();delete d.current[b];hA.innerHTML="";
    let pA=document.createElement("iframe");pA.className="w-full h-full border-none bg-white";hk(pA);hA.appendChild(pA);
    let DI=betterCherriRemoteFrame(pA,(VI,canBack,canForward)=>{
      Z(wC=>wC.map(bt=>bt.id===b?{...bt,url:VI,favicon:lu(VI),title:ck(VI),isInternal:!1,canBack,canForward}:bt));
      v===b&&nA(VI);vI.current?.notifyTabUpdated(b,{status:"loading",url:VI});xA(!0)
    },()=>{xA(!1);vI.current?.notifyTabUpdated(b,{status:"complete"})});
    s.current[b]=DI;l.current[b]=pA;DI.go(X)
  },[TI,v,eB]);`;
  source=source.slice(0,start)+replacement+source.slice(end);
  edits.push({name:'shell proxy uses the upstream secure origin',count:1});

  replace('split panes use the upstream secure origin',
    'let hA=t.current;if(!hA)return;let pA=I.current?.createFrame(void 0,{plugins:[new hA]});if(!pA)return;',
    'let pA=betterCherriRemoteFrame();');
  replace('external back and forward reflect launcher navigation history',
    'kt=!kI||kI.isInternal&&!kI.canBack,FQ=!kI||kI.isInternal&&!kI.canForward;',
    'kt=!kI||!kI.canBack,FQ=!kI||!kI.canForward;');

  // Game frames and the open-in-new-tab command must reach the real upstream
  // origin directly. Resolving a relative #/embed inside about:blank does not
  // create a second copy of the embedded app.
  for(const target of ['Q','L.url','b'])replace(`remote embed URL for ${target}`,
    'Bs(`/embed?u=${encodeURIComponent('+target+')}`)',
    'betterCherriRemoteUrl('+target+')');

  replace('internal embed page delegates proxy boot to upstream',
    'return Q(null),(async()=>{try{let t=await zw();if(e)return;let E=I.current;if(!E)return;t.createFrame(E,{plugins:[new fd,new sz(o=>_y.emit(o))]}).go(C)}catch(t){e||Q(t instanceof Error?t.message:"Failed to start proxy.")}})(),()=>{e=!0}',
    'Q(null);try{if(I.current)I.current.src=betterCherriRemoteUrl(C)}catch(t){Q(t instanceof Error?t.message:"Failed to start proxy.")}return()=>{e=!0}');

  // Leave the import-meta shim at the start of the file for the standalone
  // launcher's existing asset-rewrite step.
  replace('inject remote proxy helpers','function qv(A){',helpers+'\nfunction qv(A){');
  return {source,edits};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw new Error('Usage: node patch-remote-proxy.mjs input.js output.js');
  const result=patchRemoteProxy(await readFile(input,'utf8'));
  await writeFile(output,result.source);
  console.log(JSON.stringify({output,edits:result.edits}));
}
