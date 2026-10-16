export function patchMatrixIntegration(input) {
  if (input.includes('window.__betterMatrixRequest(g,I)')) return input;
  let source=input;
  const replace=(before,after)=>{
    if(source.split(before).length!==2)throw new Error('Matrix integration anchor changed: '+before.slice(0,80));
    source=source.replace(before,after);
  };
  replace('function UI(){return localStorage.getItem(GM)}', 'function UI(){return globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="matrix"?window.__betterMatrixSessionToken():localStorage.getItem(GM)}');
  replace('function NM(A){localStorage.setItem(GM,A)}', 'function NM(A){if(globalThis.__BETTER_CHERRI_CHAT_PROVIDER__!=="matrix")localStorage.setItem(GM,A)}');
  replace('function Xy(){localStorage.removeItem(GM)}', 'function Xy(){if(globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="matrix"){window.__betterMatrix.logout().catch(()=>{}).finally(()=>{Vi();window.dispatchEvent(new Event("cherri:session"))});return}localStorage.removeItem(GM)}');
  replace('window.fetch=(g,I)=>window.__betterCherriRequest(g,I,A,NE())', String.raw`window.fetch=async(g,I)=>{
    if(globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="matrix"){
      let betterResponse=await window.__betterMatrixRequest(g,I);if(betterResponse!==null)return betterResponse;
      let betterOptions={...I,headers:new Headers(I?.headers||(g instanceof Request?g.headers:void 0))};
      betterOptions.headers.delete("Authorization");
      return window.__betterCherriRequest(g instanceof Request?new Request(g,{headers:betterOptions.headers}):g,betterOptions,A,NE());
    }
    return window.__betterCherriRequest(g,I,A,NE());
  }`);
  replace('function Y0(A,g){if(!window.__betterCherriBackend(NE())', 'function Y0(A,g){if(globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="matrix")return window.__betterMatrixStream(A,g)||{close(){},send(){},isOpen:()=>!1};if(!window.__betterCherriBackend(NE())');
  replace('function Vi(){A0.clear(),window.dispatchEvent(new Event(Wt))}', 'function Vi(){A0.clear(),window.dispatchEvent(new Event(Wt))}window.addEventListener("better-matrix:session",Vi);');
  replace('if(CA?.type==="user_meta"&&CA.userId)', 'if(CA?.type==="members_changed"){fetch("/api/members",{headers:C}).then(x=>x.ok?x.json():[]).then(PB).catch(()=>{});return}if(CA?.type==="user_meta"&&CA.userId)');
  replace('if(!globalThis.__BETTER_CHERRI_NATIVE_ORIGIN__)return;let g=()=>betterRefreshRooms(I=>I+1);window.addEventListener("better-cherri:rooms-created",g);return()=>window.removeEventListener("better-cherri:rooms-created",g)', 'if(!globalThis.__BETTER_CHERRI_NATIVE_ORIGIN__&&globalThis.__BETTER_CHERRI_CHAT_PROVIDER__!=="matrix")return;let g=()=>betterRefreshRooms(I=>I+1);for(let I of ["better-cherri:rooms-created","better-matrix:community","better-matrix:session"])window.addEventListener(I,g);return()=>{for(let I of ["better-cherri:rooms-created","better-matrix:community","better-matrix:session"])window.removeEventListener(I,g)}');
  const p2p='    if(globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="chitchatter"&&(A==="chat"||A==="members"))return';
  replace(p2p, String.raw`    let betterMatrixContainer=(0,NA.useRef)(null);
    (0,NA.useEffect)(()=>{
      if(globalThis.__BETTER_CHERRI_CHAT_PROVIDER__!=="matrix"||!betterMatrixContainer.current)return;
      if(A==="login"||A==="reset"||((A==="chat"||A==="members")&&!UI()))return window.__betterMatrixUI.mountAccount(betterMatrixContainer.current);
      if(A==="chat"||A==="members")return window.__betterMatrixUI.mountCommunity(betterMatrixContainer.current);
    },[A,betterRoomRevision]);
    if(globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="matrix"){
      if(A==="login"||A==="reset"||((A==="chat"||A==="members")&&!UI()))return(0,eA.jsx)("div",{style:{height:"100%",minHeight:0},ref:betterMatrixContainer});
      if(A==="chat"||A==="members"){let BetterMatrixPage=pkA[A];return(0,eA.jsxs)("div",{style:{height:"100%",minHeight:0,display:"flex",flexDirection:"column"},children:[
        (0,eA.jsx)("div",{ref:betterMatrixContainer}),
        (0,eA.jsx)("div",{style:{flex:1,minHeight:0},children:(0,eA.jsx)(BetterMatrixPage,{},betterRoomRevision)})
      ]})}
    }
`+p2p);
  return source;
}
