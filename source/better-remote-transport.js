/* Use Cherri's existing TLS/Wisp transport for its API when CORS disallows the
   standalone launcher origin. No service worker or local server is required. */
(() => {
  'use strict';
  const nativeFetch=globalThis.fetch.bind(globalThis);
  const directOrigins=new Map();
  const clients=new Map();
  const defaultWisps=[
    'wss://shop.kristenblackburnvolleyballcamps.com/wi/',
    'wss://learn.southpadreislandkiteboarding.com/wi/',
    'wss://bananadogstore.com/socket/',
    'wss://aplusmartialarts-templehills.com/socket/',
    'wss://actingoutdoor.com/socket/',
    'wss://restorecounselingcenter.org/socket/'
  ];
  let selectedClient=null,discovery=null;
  function endpoints(){
    const configured=globalThis.__BETTER_CHERRI_WISPS__;
    return [...new Set(Array.isArray(configured)&&configured.length?configured:defaultWisps)]
      .filter(value=>{try{return new URL(value).protocol==='wss:'}catch{return false}});
  }
  function abortError(){return new DOMException('The request was aborted.','AbortError')}
  function abortable(promise,signal){
    if(!signal)return promise;
    if(signal.aborted)return Promise.reject(signal.reason||abortError());
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(signal.reason||abortError());
      signal.addEventListener('abort',abort,{once:true});
      promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
  }
  function timeout(promise,ms){
    let timer;
    return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cherri transport timed out.')),ms)})])
      .finally(()=>clearTimeout(timer));
  }
  function clientAt(wisp){
    if(!clients.has(wisp))clients.set(wisp,(async()=>{
      const factory=globalThis.__betterCherriCreateTransport;
      if(typeof factory!=='function')throw new Error('The original Cherri TLS transport is not loaded.');
      return factory(wisp);
    })().catch(error=>{clients.delete(wisp);throw error}));
    return clients.get(wisp);
  }
  async function rawRequest(client,url,options){
    const headers=Array.from(options.headers.entries());
    return client.request(url,options.method,options.body,headers,options.signal);
  }
  function discover(origin){
    if(selectedClient)return Promise.resolve(selectedClient);
    if(discovery)return discovery;
    const ping=new URL('/api/ping',origin);
    // Race only read-only public pings. Once chosen, a mutation is sent once.
    discovery=Promise.any(endpoints().map(async wisp=>{
      const client=await clientAt(wisp);
      const response=await timeout(rawRequest(client,ping,{method:'GET',headers:new Headers(),body:undefined}),9000);
      if(response.status!==200)throw new Error(`Cherri ping returned ${response.status}.`);
      const data=await new Response(response.body).json();
      if(data?.ok!==true)throw new Error('The Cherri API did not answer its ping.');
      return client;
    })).then(winner=>(selectedClient=winner)).catch(()=>{discovery=null;throw new Error('Could not connect to Cherri’s original servers. Reload and try again.');});
    return discovery;
  }
  function supportsDirect(origin){
    if(origin===location.origin)return Promise.resolve(true);
    if(!directOrigins.has(origin))directOrigins.set(origin,
      nativeFetch(new URL('/api/ping',origin),{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(5000)})
        .then(response=>response.ok).catch(()=>false));
    return directOrigins.get(origin);
  }
  globalThis.__betterCherriRemoteFetch=async (input,init={})=>{
    const request=input instanceof Request?new Request(input,init):new Request(input,init);
    const url=new URL(request.url);
    if(!/^https:$/.test(url.protocol)||!url.pathname.startsWith('/api/'))return nativeFetch(input,init);
    if(request.signal.aborted)throw request.signal.reason||abortError();
    if(await supportsDirect(url.origin))return nativeFetch(input,init);
    const headers=new Headers(request.headers);
    headers.delete('cookie');
    const method=request.method;
    const body=method==='GET'||method==='HEAD'?undefined:await request.arrayBuffer();
    const client=await abortable(discover(url.origin),request.signal);
    const result=await abortable(rawRequest(client,url,{method,headers,body,signal:request.signal}),request.signal);
    const responseHeaders=new Headers(result.headers);
    // Epoxy decodes these encodings before exposing its response stream.
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('transfer-encoding');
    const response=new Response([101,204,205,304].includes(result.status)?null:result.body,
      {status:result.status,statusText:result.statusText,headers:responseHeaders});
    Object.defineProperty(response,'url',{value:url.href});
    return response;
  };
})();
