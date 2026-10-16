/* A small CDN-backed launcher. Keep this function self-contained: the app also
 * embeds its source to download launchers containing public community IDs. */
export function makeOneClickLauncher(cdnUrl, community = null) {
  if (typeof cdnUrl !== 'string' || !/^https:\/\/cdn\.jsdelivr\.net\/gh\/unblockedgames99x-code\/better-cherri@(?:main|[a-f0-9]{40})\/app\.js$/.test(cdnUrl)) {
    throw new TypeError('Use the Better Cherri app.js link on jsDelivr.');
  }
  let config = null;
  if (community != null) {
    if (typeof community !== 'object' || Array.isArray(community)) throw new TypeError('Provide a public Better Cherri room configuration.');
    if (community.provider != null && community.provider !== 'matrix') throw new TypeError('This launcher uses Matrix rooms.');
    if (community.homeserver != null && community.homeserver !== 'https://matrix.salix.host') throw new TypeError('This launcher uses the Salix Matrix homeserver.');
    const rooms = {};
    for (const name of ['better-general', 'better-games', 'better-music']) {
      const id = community.rooms?.[name];
      if (typeof id !== 'string' || !/^![^\s/\\?#]{1,500}:[^\s/\\?#]{1,250}$/.test(id)) throw new TypeError('A valid Matrix room ID is required for ' + name + '.');
      rooms[name] = id;
    }
    if (new Set(Object.values(rooms)).size !== 3) throw new TypeError('Each channel needs its own Matrix room.');
    config = {version: 1, provider: 'matrix', homeserver: 'https://matrix.salix.host', name: 'Better Cherri', rooms};
  }
  const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Better Cherri</title>
<style>html,body{margin:0;min-height:100%;background:#0d090c;color:#fff;font:15px/1.5 Inter,system-ui,sans-serif}body{min-height:100vh;display:grid;place-items:center}.card{box-sizing:border-box;width:min(440px,calc(100% - 32px));padding:32px;border:1px solid #ffc8d238;border-radius:24px;background:#171116}h1{margin:0 0 10px;font-size:30px;letter-spacing:-1px}p{color:#c7aeb7;margin:0 0 24px}button{width:100%;border:0;border-radius:12px;padding:13px 18px;font:600 15px Inter,system-ui,sans-serif;background:#f17496;color:#170911;cursor:pointer}button:focus-visible{outline:3px solid #fff;outline-offset:4px}#status{margin:16px 0 0;font-size:13px;min-height:20px;overflow-wrap:anywhere}#status.error{color:#ffadb9}</style></head>
<body><main class="card"><h1>Better Cherri</h1><p>Games, music, and private chat with saved messages.</p><button id="launch" type="button">Launch Better Cherri</button><p id="status" role="status" aria-live="polite"></p></main>
<script>(()=>{'use strict';const cdn=${json(cdnUrl)},community=${json(config)};const status=document.getElementById('status');document.getElementById('launch').addEventListener('click',()=>{let child;try{child=window.open('about:blank','_blank');if(!child){status.className='error';status.textContent='Your browser blocked the new tab. Allow pop-ups for this launcher, then click Launch Better Cherri again.';return;}child.opener=null;if(community)child.__BETTER_MATRIX_COMMUNITY__=community;child.document.open();child.document.write('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Better Cherri</title></head><body style="background:#0d090c;color:#fff;font:15px system-ui;padding:32px"><p id="better-launch-status" role="status">Loading Better Cherri…</p></body></html>');child.document.close();const script=child.document.createElement('script');script.src=cdn;script.async=true;script.onerror=()=>{status.className='error';status.textContent='Better Cherri could not load from jsDelivr. Check your connection and try again.';try{const note=child.document.getElementById('better-launch-status');if(note)note.textContent=status.textContent;}catch{}};script.onload=()=>{status.className='';status.textContent='Better Cherri opened in the new tab.';};child.document.body.appendChild(script);status.className='';status.textContent='Loading Better Cherri in the new tab…';}catch(error){status.className='error';status.textContent='The launcher could not open Better Cherri. Allow pop-ups and try again.';}});})();</script></body></html>`;
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
