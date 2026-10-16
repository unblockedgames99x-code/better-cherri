import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// The original audio elements use anonymous CORS so their equalizer can read
// them. Loading through the existing API fetch bridge and a local Blob keeps
// that access available when the original API omits CORS headers.
export const mediaHelpers=String.raw`
var betterCherriMediaLoads=new WeakMap;
function betterCherriReleaseMedia(audio){
  const state=betterCherriMediaLoads.get(audio);
  if(!state)return;
  betterCherriMediaLoads.delete(audio);
  state.controller.abort();
  if(state.url)URL.revokeObjectURL(state.url);
}
async function betterCherriMediaSource(audio,url){
  betterCherriReleaseMedia(audio);
  audio.removeAttribute("src");audio.load();
  const state={controller:new AbortController,url:null};
  betterCherriMediaLoads.set(audio,state);
  const signal=state.controller.signal;
  const cancelled=()=>signal.aborted||betterCherriMediaLoads.get(audio)!==state;
  try{
    const response=await fetch(url,{signal});
    if(!response.ok)throw new Error("Stream unavailable");
    let blob;
    if(response.body){
      const reader=response.body.getReader(),chunks=[];
      const abort=()=>{reader.cancel().catch(()=>{})};
      signal.addEventListener("abort",abort,{once:true});
      try{
        for(;;){
          if(cancelled())throw new DOMException("The request was aborted.","AbortError");
          const chunk=await reader.read();if(chunk.done)break;chunks.push(chunk.value);
        }
        blob=new Blob(chunks,{type:response.headers.get("content-type")||"audio/mpeg"});
      }finally{signal.removeEventListener("abort",abort);reader.releaseLock()}
    }else blob=await response.blob();
    if(cancelled())throw new DOMException("The request was aborted.","AbortError");
    state.url=URL.createObjectURL(blob);
    audio.src=state.url;audio.load();
  }catch(error){
    if(betterCherriMediaLoads.get(audio)===state)betterCherriReleaseMedia(audio);
    throw error;
  }
}
`;

export function patchRemoteMedia(input){
  if(input.includes('var betterCherriMediaLoads=new WeakMap;'))return {source:input,edits:[]};
  let source=input;const edits=[];
  function replace(name,before,after,count=1){
    const found=source.split(before).length-1;
    if(found!==count)throw new Error(`${name}: expected ${count} matches, found ${found}`);
    source=source.split(before).join(after);edits.push({name,count});
  }

  replace('release stream blobs when audio elements unmount',
    '()=>{b.pause(),b.removeEventListener("timeupdate",X)',
    '()=>{b.pause(),betterCherriReleaseMedia(b),b.removeEventListener("timeupdate",X)',2);

  replace('standalone music loads through the original server transport',
    '(0,JA.useEffect)(()=>{if(Lg)return;let b=IB.current;if(!b)return;let X=!1;return bA(null),b.pause(),gI?(j(!0),gg.set(0),_g(gI.duration),b.src=ZG(gI).url,b.load(),b.play().catch(()=>{X||VA(!1)}).finally(()=>{X||j(!1)}),()=>{X=!0}):(b.removeAttribute("src"),b.load(),queueMicrotask(()=>{X||(gg.set(0),_g(0),j(!1))}),()=>{X=!0})},[gI,Lg,gg])',
    String.raw`(0,JA.useEffect)(()=>{
      if(Lg)return;let b=IB.current;if(!b)return;let X=!1;
      bA(null);b.pause();
      if(gI){
        j(!0);gg.set(0);_g(gI.duration);
        betterCherriMediaSource(b,ZG(gI).url)
          .then(()=>{if(!X)return b.play().catch(()=>{X||VA(!1)})})
          .catch(()=>{if(!X){VA(!1);bA("Stream unavailable")}})
          .finally(()=>{X||j(!1)});
      }else{
        betterCherriReleaseMedia(b);b.removeAttribute("src");b.load();
        queueMicrotask(()=>{X||(gg.set(0),_g(0),j(!1))});
      }
      return()=>{X=!0;betterCherriReleaseMedia(b)};
    },[gI,Lg,gg])`);

  replace('shell music loads through the original server transport',
    '(0,NA.useEffect)(()=>{let b=wA.current,X=rA.current.current;if(!b||!X)return;let hA=!1;return b.pause(),b.src=ZG(X).url,b.load(),b.play().catch(pA=>{hA||bA(eg=>({...eg,playing:!1}))}),()=>{hA=!0}},[j.current?.id])',
    String.raw`(0,NA.useEffect)(()=>{
      let b=wA.current,X=rA.current.current;if(!b||!X)return;let hA=!1;
      b.pause();
      betterCherriMediaSource(b,ZG(X).url)
        .then(()=>{if(!hA)return b.play().catch(()=>{hA||bA(eg=>({...eg,loading:!1,playing:!1}))})})
        .catch(()=>{hA||bA(eg=>({...eg,loading:!1,playing:!1,streamError:"Stream unavailable"}))});
      return()=>{hA=!0;betterCherriReleaseMedia(b)};
    },[j.current?.id,j.current?.source,j.current?.isrc])`);

  replace('install remote media helpers','function ZG(A){',mediaHelpers+'\nfunction ZG(A){');
  return {source,edits};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw new Error('Usage: node patch-remote-media.mjs input.js output.js');
  const result=patchRemoteMedia(await readFile(input,'utf8'));
  await writeFile(output,result.source);
  console.log(JSON.stringify({output,edits:result.edits}));
}
