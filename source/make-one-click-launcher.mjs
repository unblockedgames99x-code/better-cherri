/* A small CDN-backed launcher. Keep this function self-contained: the app also
 * embeds its source to download launchers containing public community IDs. */
export function makeOneClickLauncher(cdnUrl, community = null) {
  if (typeof cdnUrl !== 'string' || !/^https:\/\/cdn\.jsdelivr\.net\/gh\/unblockedgames99x-code\/better-cherri@(?:main|[a-f0-9]{40})\/app\.js$/.test(cdnUrl)) {
    throw new TypeError('Use the Better Cherri app.js link on jsDelivr.');
  }
  let config = null;
  if (community != null) {
    if (typeof community !== 'object' || Array.isArray(community)) throw new TypeError('Provide a public Better Cherri room configuration.');
    if (community.provider != null && community.provider !== 'xmpp') throw new TypeError('This launcher uses hosted Better Cherri chat rooms.');
    if (community.server != null && community.server !== 'yax.im') throw new TypeError('This launcher uses the yax.im chat service.');
    const rooms = {};
    let namespace = null;
    for (const name of ['better-general', 'better-games', 'better-music']) {
      const id = community.rooms?.[name];
      const match = typeof id === 'string' && new RegExp('^(better-[a-f0-9]{32})-' + name.slice(7) + '@chat\\.yax\\.im$').exec(id);
      if (!match) throw new TypeError('A valid private chat address is required for ' + name + '.');
      if (namespace && namespace !== match[1]) throw new TypeError('All channels must belong to the same Better Cherri community.');
      namespace = match[1];
      rooms[name] = id;
    }
    if (new Set(Object.values(rooms)).size !== 3) throw new TypeError('Each channel needs its own chat room.');
    config = {version: 1, provider: 'xmpp', server: 'yax.im', name: 'Better Cherri', rooms};
  }
  const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Better Cherri</title>
<style>html,body{margin:0;min-height:100%;background:#0d090c;color:#fff;font:15px/1.5 Inter,system-ui,sans-serif}body{min-height:100vh;display:grid;place-items:center}.card{box-sizing:border-box;width:min(440px,calc(100% - 32px));padding:32px;border:1px solid #ffc8d238;border-radius:24px;background:#171116}h1{margin:0 0 10px;font-size:30px;letter-spacing:-1px}p{color:#c7aeb7;margin:0 0 24px}button{width:100%;border:0;border-radius:12px;padding:13px 18px;font:600 15px Inter,system-ui,sans-serif;background:#f17496;color:#170911;cursor:pointer}button:focus-visible{outline:3px solid #fff;outline-offset:4px}#status{margin:16px 0 0;font-size:13px;min-height:20px;overflow-wrap:anywhere}#status.error{color:#ffadb9}</style></head>
<body><main class="card"><h1>Better Cherri</h1><p>Games, music, and private chat with saved messages.</p><button id="launch" type="button">Launch Better Cherri</button><p id="status" role="status" aria-live="polite"></p></main>
<script>(()=>{'use strict';
const cdn=${json(cdnUrl)},community=${json(config)};
const status=document.getElementById('status'),button=document.getElementById('launch');
button.addEventListener('click',()=>{
  if(button.disabled)return;
  const child=window.open('about:blank','_blank');
  if(!child){status.className='error';status.textContent='Your browser blocked the new tab. Allow pop-ups for this launcher, then click Launch Better Cherri again.';return;}
  child.opener=null;button.disabled=true;
  status.className='';status.textContent='Loading Better Cherri in the new tab…';
  let finished=false,seededDocument=null,seededScript=null,watchTimer=null,timeoutTimer=null;
  const clean=()=>{if(watchTimer!==null)clearTimeout(watchTimer);if(timeoutTimer!==null)clearTimeout(timeoutTimer);try{child.removeEventListener('load',onWindowLoad);}catch{}};
  const fail=message=>{if(finished)return;finished=true;clean();button.disabled=false;status.className='error';status.textContent=message;try{const note=child.document.getElementById('better-launch-status');if(note)note.textContent=message;}catch{}};
  const done=()=>{if(finished)return;finished=true;clean();button.disabled=false;status.className='';status.textContent='Better Cherri opened in the new tab.';};
  function seed(){
    if(finished)return;
    try{
      if(child.__BETTER_CHERRI_APP_READY__===true){done();return;}
      if(child.closed){fail('The Better Cherri tab was closed before it finished loading. Click Launch Better Cherri to reopen it.');return;}
      if(child.location.href.split('#')[0]!=='about:blank'){fail('The new tab navigated away before Better Cherri loaded. Click Launch Better Cherri to try again.');return;}
      const doc=child.document;
      if(!doc.documentElement||!doc.head||!doc.body)return;
      if(seededDocument===doc&&seededScript&&seededScript.isConnected)return;
      seededDocument=doc;
      if(community)child.__BETTER_XMPP_COMMUNITY__=community;
      doc.documentElement.lang='en';doc.title='Better Cherri';
      const charset=doc.createElement('meta');charset.setAttribute('charset','utf-8');
      const viewport=doc.createElement('meta');viewport.setAttribute('name','viewport');viewport.setAttribute('content','width=device-width,initial-scale=1');
      doc.head.appendChild(charset);doc.head.appendChild(viewport);
      doc.body.style.cssText='background:#0d090c;color:#fff;font:15px system-ui;padding:32px';
      const loading=doc.createElement('p');loading.id='better-launch-status';loading.setAttribute('role','status');loading.textContent='Loading Better Cherri…';doc.body.replaceChildren(loading);
      const script=doc.createElement('script');seededScript=script;script.src=cdn;script.async=true;
      script.onload=done;
      script.onerror=()=>{try{if(child.document!==doc)return;}catch{}fail('Better Cherri could not load from jsDelivr. Check your connection and try again.');};
      doc.body.appendChild(script);
    }catch{fail('The launcher could not open Better Cherri. Allow pop-ups and try again.');}
  }
  function watch(){seed();if(!finished)watchTimer=setTimeout(watch,100);}
  function onWindowLoad(){seed();}
  child.addEventListener('load',onWindowLoad);
  timeoutTimer=setTimeout(()=>fail('Better Cherri is taking too long to load from jsDelivr. Check your connection and try again.'),45000);
  // The requested about:blank navigation may replace the initial document.
  // Let it commit, and re-seed if that replacement discards the first script.
  watchTimer=setTimeout(watch,0);
});})();</script></body></html>`;
}

export function makeDownloadHelperSource(cdnUrl) {
  // Validate the URL before embedding code. No session information is included.
  makeOneClickLauncher(cdnUrl);
  const safeUrl = JSON.stringify(cdnUrl).replace(/</g, '\\u003c');
  return `globalThis.__BETTER_CHERRI_DOWNLOAD_LAUNCHER__ = function(community) {
    const make = (${makeOneClickLauncher.toString()});
    const html = make(${safeUrl}, community);
    const blob = new Blob([html], {type:'text/html;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'Better-Cherri-Launcher.html';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };`;
}
