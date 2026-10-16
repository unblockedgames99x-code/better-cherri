import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This repository publishes compiled assets. Every edit is guarded against the
// audited upstream build, so an upstream update fails safely instead of making
// an approximate replacement in an unrelated component.
export function patchGamesMusic(input) {
  let source = input;
  const edits = [];
  const replace = (name, before, after, expected = 1) => {
    const count = source.split(before).length - 1;
    if (count !== expected) throw new Error(`${name}: expected ${expected} matches, found ${count}`);
    source = source.split(before).join(after);
    edits.push({ name, count });
  };

  replace('legacy catalogs enabled by default', 'proxyGames:!0,legacyGames:!1,legacyGamesNoticed:!1', 'proxyGames:!0,legacyGames:!0,legacyGamesNoticed:!0');
  replace('default Games source', 'function sEA(){let A=HB(),[g,I]=(0,yB.useState)([]),[B,Q]=(0,yB.useState)("fruit")', 'function sEA(){let A=HB(),[g,I]=(0,yB.useState)([]),[B,Q]=(0,yB.useState)("better-all")');
  replace('Show all source option', 'let o=C?[...Ej,...lj]:Ej,', 'let o=[{id:"better-all",label:"Show all"},...(C?[...Ej,...lj]:Ej)],');

  const loadAll = String.raw`
async function betterCherriAllGames(){
  const limit=(promise,ms=12000)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Catalog timed out")),ms)})]).finally(()=>clearTimeout(timer))};
  const json=async url=>{const controller=new AbortController, timer=setTimeout(()=>controller.abort(),12000);try{const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw Error("Catalog unavailable");return await response.json()}finally{clearTimeout(timer)}};
  const staticCatalogs=[
    json(BC("assets/json/fruit.json")).then(rows=>rows.map(game=>({id:"fruit:"+game.id,name:game.name,img:game.img?BC(game.img):"",launch:XI(eEA+game.path.split("/").map(encodeURIComponent).join("/")),store:"fruit"}))),
    ...rj.map(({id})=>json(BC("assets/json/"+id+".json")).then(rows=>rows.map((game,index)=>({id:id+":"+index,name:game.name,img:XI(game.img.startsWith("/img/")?QEA+game.img.slice(4):game.img),launch:XI(game.url.startsWith("/")?BEA+game.url:game.url),store:id}))))
  ];
  const dynamicCatalogs=[
    json("/api/gmshelf/catalog").then(data=>(data.games||[]).map(game=>({id:"gmshelf:"+game.id,name:game.title,img:game.cover?XI("/api/gmshelf/files/"+game.cover):"",launch:XI("/api/gmshelf/files/"+game.path),store:"gmshelf"}))),
    limit((async()=>{const sdk=await eN(),data=await sdk.getGames({page:1,limit:9999});return Promise.all(data.games.map(async game=>({id:"lumin:"+game.id,name:game.name,img:await Promise.resolve().then(()=>sdk.getImageUrl(game.image_token)).catch(()=>""),launch:"lumin:"+game.id,store:"lumin"})))})())
  ];
  const results=await Promise.allSettled([...staticCatalogs,...dynamicCatalogs]);
  const games=results.flatMap(result=>result.status==="fulfilled"?result.value:[]);
  if(!games.length)throw Error("Game catalogs are unavailable. Try a source from the menu.");
  // Catalogs overlap; each launch target appears once in the combined view.
  return [...new Map(games.map(game=>[game.launch,game])).values()].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:"base"}));
}
`;
  replace('combined catalog loader', 'function sEA(){', loadAll + 'function sEA(){');
  replace('load Show all catalog', '(0,yB.useEffect)(()=>{let fA=!0;if(B==="emulator")', '(0,yB.useEffect)(()=>{let fA=!0;if(B==="better-all"){_(!0),dA(null);betterCherriAllGames().then(mg=>{fA&&I(mg)}).catch(mg=>{fA&&dA(mg.message)}).finally(()=>{fA&&_(!1)});return()=>{fA=!1}}if(B==="emulator")');
  replace('Show all filter label', 'Qg=[{id:"all",label:"All",count:g.length', 'Qg=[{id:"all",label:"Show all",count:g.length');
  replace('Show all filter resets source', 'icon:fA.icon,onClick:()=>$(fA.id)', 'icon:fA.icon,onClick:()=>{$(fA.id),fA.id==="all"&&Q("better-all")}');

  // Remove the obsolete removal notice, including its settings shortcut.
  const noticeStart = source.indexOf('cg=!C&&!t?(0,tI.jsxs)("div",');
  const noticeEnd = source.indexOf('):null;return(0,tI.jsx)("div",{className:"min-h-full bg-(--bg)', noticeStart);
  if (noticeStart < 0 || noticeEnd < noticeStart) throw new Error('legacy notice: audited boundaries missing');
  source = source.slice(0, noticeStart) + 'cg=null;return(0,tI.jsx)("div",{className:"min-h-full bg-(--bg)' + source.slice(noticeEnd + '):null;return(0,tI.jsx)("div",{className:"min-h-full bg-(--bg)'.length);
  edits.push({ name: 'obsolete legacy removal notice removed', count: 1 });

  // The music page already supports three modes. The outer browser host was
  // reducing them to a boolean, losing the repeat-one state in normal use.
  replace('host repeat state', 'muted:!1,shuffle:!1,repeat:!1,streamError:null', 'muted:!1,shuffle:!1,repeat:"off",streamError:null');
  replace('host repeat cycle', 'repeat:!b.repeat', 'repeat:b.repeat==="off"||b.repeat===!1?"all":b.repeat==="all"||b.repeat===!0?"one":"off"');
  replace('host repeat queue boundary', 'if(!b.repeat)return;', 'if(b.repeat==="off"||b.repeat===!1)return;', 2);
  replace('host replay current song on ended', 'let X=()=>NB();return b.addEventListener("ended",X)', 'let X=()=>{if(rA.current.repeat==="one"){b.currentTime=0,mA.set(0),b.play().catch(()=>{});return}NB()};return b.addEventListener("ended",X)');
  replace('preserve repeat mode over host bridge', 'Qg(pA.repeat?"all":"off")', 'Qg(pA.repeat==="one"?"one":pA.repeat==="all"||pA.repeat===!0?"all":"off")');
  replace('expanded repeat control description', '"aria-label":"Repeat",title:"Repeat",onClick:Y', '"aria-label":t==="one"?"Repeat one song":t==="all"?"Repeat queue":"Repeat off",title:t==="one"?"Repeat one song (click to turn off)":t==="all"?"Repeat queue (click to repeat one song)":"Repeat off (click to repeat queue)",onClick:Y');
  replace('compact repeat control description', '"aria-label":"Repeat",title:"Repeat",onClick:N', '"aria-label":u==="one"?"Repeat one song":u==="all"?"Repeat queue":"Repeat off",title:u==="one"?"Repeat one song (click to turn off)":u==="all"?"Repeat queue (click to repeat one song)":"Repeat off (click to repeat queue)",onClick:N');
  replace('repeat control visible on narrow screens', 'className:`hidden sm:flex w-8 h-8 items-center justify-center rounded-xl transition-colors relative ${u==="off"?', 'className:`flex w-8 h-8 items-center justify-center rounded-xl transition-colors relative ${u==="off"?');
  return { source, edits };
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  const target = path.resolve(process.argv[2] || 'work/cherri/b/assets/bundle-i7rlf846.js');
  const result = patchGamesMusic(fs.readFileSync(target, 'utf8'));
  if (!process.argv.includes('--dry-run')) fs.writeFileSync(target, result.source);
  console.log(JSON.stringify({ target, dryRun: process.argv.includes('--dry-run'), edits: result.edits }, null, 2));
}
