import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export function patchRoomView(input) {
  if (input.includes('GM=globalThis.__BETTER_CHERRI_NATIVE_ORIGIN__?')) return input;
  let source = input;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Room-view patch anchor mismatch: ' + before.slice(0, 100));
    source = source.replace(before, after);
  };
  replace('GM="better_cherri_session_token"', 'GM=globalThis.__BETTER_CHERRI_NATIVE_ORIGIN__?"session_token":"better_cherri_remote_session_token"');
  replace('kCA=new Set(["session_token","better_cherri_session_token",', 'kCA=new Set(["session_token","better_cherri_session_token","better_cherri_remote_session_token",');
  replace('function Y0(A,g){if(!window.__betterCherriBackend())return{close(){},send(){},isOpen:()=>!1};', 'function Y0(A,g){if(!window.__betterCherriBackend(NE())||window.__betterCherriBlocked(A))return{close(){},send(){},isOpen:()=>!1};');
  replace('o=()=>window.__betterCherriSocket(A)', 'o=()=>window.__betterCherriSocket(A,NE())');
  replace('try{g.onMessage(JSON.parse(w.data))}catch{}', 'try{let betterFrame=window.__betterCherriFilterFrame(A,JSON.parse(w.data));betterFrame!==null&&g.onMessage(betterFrame)}catch{}');
  replace('Browse Better Cherri members only.', 'People who have posted in Better Cherri rooms. Your current account is included.');
  replace('children:"No channels yet."', 'children:"Original Cherri rooms are hidden. No Better Cherri rooms are connected."');
  replace('"Select a channel to start chatting."', '"Original Cherri rooms are hidden. Select a Better Cherri room when one is available."');
  replace('"in every channel"', '"in Better Cherri rooms"');
  replace('Ep=[{id:"cherri",label:XB,desc:"This server, just us"},{id:"vortex",label:"Vortex",desc:"Vortex network",disabled:!0}]', 'Ep=[{id:"cherri",label:XB,desc:"Better Cherri rooms on Cherri’s servers"}]');
  replace('function d6({id:A}){let g=pkA[A];return(0,eA.jsx)(g,{})}', String.raw`function d6({id:A}){
    let betterNavigate=HB(),betterOpen=g=>Vt(OB+g,()=>betterNavigate("/?u="+encodeURIComponent(OB+g)));
    let[betterRoomRevision,betterRefreshRooms]=(0,NA.useState)(0);
    (0,NA.useEffect)(()=>{if(!globalThis.__BETTER_CHERRI_NATIVE_ORIGIN__)return;let g=()=>betterRefreshRooms(I=>I+1);window.addEventListener("better-cherri:rooms-created",g);return()=>window.removeEventListener("better-cherri:rooms-created",g)},[]);
    let betterP2PContainer=(0,NA.useRef)(null);
    (0,NA.useEffect)(()=>{if(globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="chitchatter"&&(A==="chat"||A==="members")&&betterP2PContainer.current)return window.__betterCherriP2P?.mount(betterP2PContainer.current,{membersOnly:A==="members"})},[A]);
    if(globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="chitchatter"&&(A==="chat"||A==="members"))return(0,eA.jsx)("div",{style:{height:"100%",minHeight:0},ref:betterP2PContainer});
    if(globalThis.__BETTER_CHERRI_NATIVE_ORIGIN__&&(A==="chat"||A==="members")){let BetterPage=pkA[A];return(0,eA.jsxs)("div",{style:{height:"100%",minHeight:0,display:"flex",flexDirection:"column"},children:[
      (0,eA.jsx)("div",{"data-better-room-setup":"",ref:g=>g&&window.__betterCherriRoomSetup?.mount(g)}),
      (0,eA.jsx)("div",{style:{flex:1,minHeight:0},children:(0,eA.jsx)(BetterPage,{},betterRoomRevision)})
    ]})}
    if(!UI()&&(A==="chat"||A==="members"))return(0,eA.jsxs)("div",{className:"min-h-full flex flex-col bg-(--bg) text-(--bright-text)",children:[
      (0,eA.jsxs)("header",{className:"flex flex-wrap items-center justify-between gap-4 border-b border-(--border-3) px-6 py-4",children:[
        (0,eA.jsx)("span",{className:"font-semibold",children:"Better Cherri"}),
        (0,eA.jsx)("nav",{"aria-label":"Better Cherri navigation",className:"flex items-center gap-2",children:[{id:"home",label:"Home"},{id:"g",label:"Games"},{id:"music",label:"Music"}].map(g=>(0,eA.jsx)("button",{type:"button",onClick:()=>betterOpen(g.id),className:"rounded-xl border border-(--border-3) px-4 py-2 text-sm hover:bg-(--bg-2)",children:g.label},g.id))})
      ]}),
      (0,eA.jsxs)("main",{className:"flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center",children:[
        (0,eA.jsx)("h1",{className:"text-xl font-semibold",children:A==="chat"?"Better Cherri chat":"Better Cherri members"}),
        (0,eA.jsx)("p",{className:"text-sm text-(--text-muted)",children:"Chat isn’t connected in this standalone launcher."}),
        (0,eA.jsx)("p",{className:"max-w-md text-xs text-(--text-muted)",children:"Original Cherri rooms and shared member lists are hidden."}),
        (0,eA.jsx)("button",{type:"button",onClick:()=>betterOpen("home"),className:"mt-3 rounded-xl bg-(--accent) px-5 py-3 text-sm font-medium text-black",children:"Back to Better Cherri"})
      ]})
    ]});
    if(!globalThis.__BETTER_CHERRI_NATIVE_ORIGIN__&&(A==="login"||A==="reset"))return(0,eA.jsxs)("div",{className:"min-h-full flex flex-col items-center justify-center gap-4 p-8 text-center bg-(--bg) text-(--bright-text)",children:[
      (0,eA.jsx)("h1",{className:"text-xl font-semibold",children:"Cherri account"}),
      (0,eA.jsx)("p",{className:"max-w-md text-sm text-(--text-muted)",children:"Sign-in and signup are handled on Cherri’s official site. This launcher does not send account requests through a proxy."}),
      (0,eA.jsx)("p",{className:"max-w-md text-xs text-(--text-muted)",children:globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="chitchatter"?"Live chat uses its own display name and does not require a Cherri account.":"Signing in there won’t connect chat in this launcher."}),
      (0,eA.jsx)("a",{href:"https://cherrion.top/login",target:"_blank",rel:"noopener noreferrer",className:"rounded-xl bg-(--accent) px-5 py-3 font-medium text-black",children:"Open Cherri account page"}),
      (0,eA.jsx)("button",{type:"button",onClick:()=>betterOpen("home"),className:"rounded-xl border border-(--border-3) px-5 py-3 text-sm hover:bg-(--bg-2)",children:"Back to Better Cherri"})
    ]});
    let g=pkA[A];return(0,eA.jsx)(g,{})
  }`);
  return source;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input,output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node patch-room-view.mjs input.js output.js');
  await writeFile(output,patchRoomView(await readFile(input,'utf8')));
  console.log('Patched remote Better Cherri room view: ' + output);
}
