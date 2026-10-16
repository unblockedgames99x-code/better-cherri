import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const CHERRI_ORIGIN = 'https://cherrion.top';

// A normal click opens account services as a first-party page. The embedded
// page remains available when a browser blocks that requested tab.
export const standardNativeNavigation = String.raw`function betterCherriOpenOriginal(target){
  if(globalThis.origin==="https://cherrion.top"||typeof target!=="string"||!/^cherri:\/\//i.test(target))return!1;
  if(typeof navigator!=="undefined"&&navigator.userActivation&&!navigator.userActivation.isActive)return!1;
  let url;
  try{url=new URL("https://cherrion.top/"+target.slice(target.indexOf("://")+3))}catch{return!1}
  if(!/^\/(?:chat|members|login|reset|profile|shop|achievements|mod|activity|assistant)\/?$/.test(url.pathname)&&!/^\/profile\/view\/[^/]+\/?$/.test(url.pathname))return!1;
  url.hash="";
  for(let key of [...url.searchParams.keys()])if(!["next","channel","page","q","tab","handle"].includes(key))url.searchParams.delete(key);
  let next=url.searchParams.get("next");
  if(next&&(!/^\/(?!\/)/.test(next)||/[?#]/.test(next)))url.searchParams.delete("next");
  let child;
  try{child=window.open(url.href,"_blank")}catch{return!1}
  if(!child)return!1;
  try{child.opener=null}catch{}
  return!0;
}
`;

export const standardSidebarClick = '()=>{if(betterCherriOpenOriginal(`cherri://${b.path}`))return;hA?(AA(hA.id),nA(`cherri://${b.path}`)):BB(`cherri://${b.path}`)}';

// Account pages run inside Cherri's real origin. A static fork cannot grant
// itself access to that origin's accounts or bypass its CORS policy.
export const standardRouteView = String.raw`function d6({id:A}){
  let betterLocation=Me();
  if(globalThis.origin!=="https://cherrion.top"&&["chat","members","login","reset","profile","profile/view","shop","achievements","mod","activity","assistant"].includes(A)){
    let betterUrl=new URL("https://cherrion.top/");
    betterUrl.pathname=betterLocation.pathname||("/"+A);
    betterUrl.search=betterLocation.search||"";
    let betterTitle=({chat:"Cherri chat",members:"Cherri members",login:"Cherri sign in",reset:"Cherri password reset",profile:"Cherri profile","profile/view":"Cherri profile",shop:"Cherri shop",achievements:"Cherri achievements",mod:"Cherri moderation",activity:"Cherri activity",assistant:"Cherri AI"})[A];
    return(0,eA.jsxs)("div",{"data-better-original-cherri":"",style:{height:"100%",minHeight:0,display:"flex",flexDirection:"column"},children:[
      (0,eA.jsx)("iframe",{src:betterUrl.href,title:betterTitle,allow:"autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-read; clipboard-write; microphone; camera; gamepad",allowFullScreen:!0,style:{width:"100%",flex:1,minHeight:0,border:0,background:"var(--bg)"}}),
      (0,eA.jsx)("div",{style:{flex:"0 0 auto",padding:"3px 10px",textAlign:"right",fontSize:11},children:(0,eA.jsx)("a",{href:betterUrl.href,target:"_blank",rel:"noopener noreferrer",title:"Open Cherri directly if it does not load here",className:"text-(--text-muted) hover:text-(--bright-text) underline",children:"Open Cherri"})})
    ]});
  }
  let g=pkA[A];return(0,eA.jsx)(g,{})
}`;

export const originalFetchRouter = 'if(wpA(),Mv()){let A=window.fetch.bind(window);window.fetch=((g,I)=>{let B=NE();if(typeof g=="string"&&g.startsWith("/api/"))return A(B+g,I);if(g instanceof URL&&g.origin===location.origin&&g.pathname.startsWith("/api/"))return A(B+g.pathname+g.search+g.hash,I);if(g instanceof Request&&new URL(g.url,location.href).pathname.startsWith("/api/")&&new URL(g.url,location.href).origin===location.origin){let Q=new URL(g.url,location.href);return A(new Request(B+Q.pathname+Q.search+Q.hash,g),I)}return A(g,I)})}';

export const standardFetchRouter = String.raw`if(wpA(),Mv()){
  let A=window.fetch.bind(window);
  window.fetch=(g,I)=>{
    let B=NE();
    if(globalThis.origin==="https://cherrion.top"){
      if(typeof g==="string"&&g.startsWith("/api/"))return A(B+g,I);
      if(g instanceof URL&&g.origin===location.origin&&g.pathname.startsWith("/api/"))return A(B+g.pathname+g.search+g.hash,I);
      if(g instanceof Request&&new URL(g.url,location.href).pathname.startsWith("/api/")&&new URL(g.url,location.href).origin===location.origin){let Q=new URL(g.url,location.href);return A(new Request(B+Q.pathname+Q.search+Q.hash,g),I)}
      return A(g,I);
    }
    let betterUrl;
    try{betterUrl=new URL(g instanceof Request?g.url:String(g),B+"/")}catch{return A(g,I)}
    if(!betterUrl.pathname.startsWith("/api/"))return A(g,I);
    if(betterUrl.origin===location.origin)betterUrl=new URL(betterUrl.pathname+betterUrl.search+betterUrl.hash,B);
    if(betterUrl.origin!=="https://cherrion.top")return A(g,I);
    let betterRequest=g instanceof Request?new Request(new Request(betterUrl.href,g),I):new Request(betterUrl.href,I);
    let betterPublic=["/api/music/","/api/emulator/arcade/","/api/gmshelf/","/api/extensions/"].some(Q=>betterUrl.pathname.startsWith(Q))||["/api/ping","/api/presence/count","/api/suggest","/api/playlists/search"].includes(betterUrl.pathname);
    if(!betterPublic||!["GET","HEAD"].includes(betterRequest.method))return Promise.resolve(new Response(JSON.stringify({error:"Open Cherri to use your account.",code:"cherri_account_origin"}),{status:401,headers:{"Content-Type":"application/json"}}));
    let betterHeaders=new Headers(betterRequest.headers);
    for(let Q of ["Authorization","Cookie","Proxy-Authorization","X-Auth-Token","X-Api-Key"])betterHeaders.delete(Q);
    for(let Q of [...betterUrl.searchParams.keys()])if(/^(?:access_token|session_token|token|authorization)$/i.test(Q))betterUrl.searchParams.delete(Q);
    betterRequest=new Request(new Request(betterUrl.href,betterRequest),{headers:betterHeaders,credentials:"omit"});
    return typeof window.__betterCherriRemoteFetch==="function"?window.__betterCherriRemoteFetch(betterRequest):A(betterRequest);
  };
}`;

export function patchStandardCherri(input) {
  if (input.includes('"data-better-original-cherri":""')) return input;
  let source = input;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Standard Cherri patch anchor changed: ' + before.slice(0, 100));
    source = source.replace(before, after);
  };
  if (/__better(?:Xmpp|Matrix)|__betterCherriRequest|Original Cherri rooms are hidden/.test(source)) {
    throw new Error('Build standard Cherri from the original bundle without private chat patches.');
  }
  replace('function d6({id:A}){let g=pkA[A];return(0,eA.jsx)(g,{})}', standardRouteView);
  replace('function Vt(A,g){', standardNativeNavigation + 'function Vt(A,g){if(betterCherriOpenOriginal(A))return;');
  const sidebarClick = 'onClick:()=>{hA?(AA(hA.id),nA(`cherri://${b.path}`)):BB(`cherri://${b.path}`)}';
  if (source.split(sidebarClick).length !== 3) throw new Error('Original Cherri sidebar navigation anchors changed.');
  source = source.split(sidebarClick).join('onClick:' + standardSidebarClick);
  replace(originalFetchRouter, standardFetchRouter);
  // The standalone shell must not mistake an old local token for a login in
  // the cross-origin frame. Native Cherri windows keep their original token.
  replace('function UI(){return localStorage.getItem(GM)}', 'function UI(){return globalThis.origin==="https://cherrion.top"?localStorage.getItem(GM):null}');
  // Old providers are no longer loaded, but a user may still have their local
  // private state. Continue excluding it from settings exports/cloud saves.
  replace('kCA=new Set(["session_token",', 'kCA=new Set(["session_token","better_cherri_session_token","better_cherri_remote_session_token","better_cherri_matrix_session_v1","better_cherri_xmpp_session_v1","better_cherri_matrix_event_ids_v1","better_cherri_xmpp_event_ids_v1",');
  replace('RCA=["cherri_music_queue"]', 'RCA=["cherri_music_queue","better_cherri_matrix_blocks:","better_cherri_xmpp_blocks:"]');
  replace('Rv="cherri_api_base";Ih=Fv()||"https://kristenblackburnvolleyballcamps.com"', 'Rv="better_cherri_remote_api_base";Ih="' + CHERRI_ORIGIN + '"');
  const candidates = JSON.stringify(['https://kristenblackburnvolleyballcamps.com','https://southpadreislandkiteboarding.com','https://bananadogstore.com','https://aplusmartialarts-templehills.com','https://actingoutdoor.com','https://restorecounselingcenter.org']);
  if (!source.includes(candidates)) throw new Error('Original Cherri API candidates changed.');
  source = source.split(candidates).join('["' + CHERRI_ORIGIN + '"]');
  return source;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node patch-standard-cherri.mjs input.js output.js');
  await writeFile(output, patchStandardCherri(await readFile(input, 'utf8')));
  console.log('Restored standard Cherri accounts and chat: ' + output);
}
