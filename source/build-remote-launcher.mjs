import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeNativeBookmarklet } from './native-origin-bookmarklet.mjs';
import { randomUUID, randomBytes } from 'node:crypto';

// This builder embeds the reviewed fork. It deliberately does not include the
// upstream signed bootstrap/updater, which would replace these modifications.
const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value.`);
  return args[index + 1];
};
const source = path.resolve(option('--repo', path.join(workspace, 'work/cherri')));
const output = path.resolve(option('--out', path.join(workspace, 'outputs/Better-Cherri-Launcher.html')));
const chatMode = option('--chat-mode', 'rooms');
if (!['disabled', 'shared', 'rooms'].includes(chatMode)) throw new Error('--chat-mode must be disabled, shared, or rooms.');
const chatProvider = option('--chat-provider', 'xmpp');
if (!['cherri', 'chitchatter', 'matrix', 'xmpp'].includes(chatProvider)) throw new Error('--chat-provider must be cherri, chitchatter, matrix, or xmpp.');
const apiBase = new URL(option('--api-base', 'https://cherrion.top')).origin;
const upstreamUrl = new URL(option('--upstream-url', `${apiBase}/`)).href;
if (!apiBase.startsWith('https:') || !upstreamUrl.startsWith('https:')) throw new Error('Remote service URLs must use HTTPS.');
const commit = option('--asset-ref', '685e2094ea73d42f9278e5f7e3df1b1a9f183134');
if (!/^[\w.-]+$/.test(commit)) throw new Error('Invalid upstream asset ref.');
const assetBase = `https://cdn.jsdelivr.net/gh/cherriunblocked/svg@${commit}/b/`;
const jsonForScript = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const inlineScript = value => value.replace(/<\/script/gi, '<\\/script');

const shell = await fs.readFile(path.join(source, 'b/index.html'), 'utf8');
const cssFile = /"css":\[\["([^\"]+)"/.exec(shell)?.[1];
const scriptConfig = /"js":(\[\[.*?\]\])\}\);<\/script>/.exec(shell);
const root = /<main id="([^"]+)"/.exec(shell)?.[1];
if (!cssFile || !scriptConfig || !root) throw new Error('Unsupported upstream app shell.');
const scriptFiles = JSON.parse(scriptConfig[1]).map(entry => entry[0]);
const favicon = /<link rel="icon"[^>]*>/.exec(shell)?.[0] ?? '<link rel="icon" href="data:,">';
const historyScript = /<script>\(function\(\)\{var r=window,t=\{ps:History\.prototype\.pushState.*?<\/script>/.exec(shell)?.[0] ?? '';
const bridge = await fs.readFile(path.join(source, 'b/better-cherri-bridge.js'), 'utf8');
const transport = await fs.readFile(path.join(source, 'b/better-remote-transport.js'), 'utf8');
const roomSetup = await fs.readFile(path.join(source, 'b/better-cherri-room-setup.js'), 'utf8');
const matrixScripts = chatProvider === 'matrix' ? await Promise.all(['better-matrix-client.js','better-matrix-bridge.js','better-matrix-ui.js'].map(file=>fs.readFile(path.join(source,'b',file),'utf8'))) : [];
const xmppScripts = chatProvider === 'xmpp' ? await Promise.all(['better-xmpp-sdk.js','better-xmpp-client.js','better-xmpp-bridge.js','better-xmpp-ui.js'].map(file=>fs.readFile(path.join(source,'b',file),'utf8'))) : [];
let p2pRooms = [], p2pScript = '';
if (chatProvider === 'chitchatter') {
  const configPath = path.resolve(option('--community-config', path.join(workspace, 'work/better-p2p-community.json')));
  try { p2pRooms = JSON.parse(await fs.readFile(configPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    p2pRooms = ['general', 'games', 'music'].map(name => ({ name:'better-'+name, label:name[0].toUpperCase()+name.slice(1), id:randomUUID(), secret:randomBytes(32).toString('base64') }));
    await fs.mkdir(path.dirname(configPath), { recursive:true });
    await fs.writeFile(configPath, JSON.stringify(p2pRooms), { flag:'wx' });
  }
  if (!Array.isArray(p2pRooms) || p2pRooms.length !== 3 ||
      p2pRooms.some((room,index)=>room.name!==['better-general','better-games','better-music'][index] || !/^[0-9a-f-]{36}$/i.test(room.id) || !/^[A-Za-z0-9+/]{43}=$/.test(room.secret)) ||
      new Set(p2pRooms.map(room=>room.id)).size!==3 || new Set(p2pRooms.map(room=>room.secret)).size!==3) throw new Error('Invalid private live-room configuration. Existing room access was not changed.');
  p2pScript = await fs.readFile(path.join(source, 'b/better-p2p-chat.js'), 'utf8');
}

let css = await fs.readFile(path.join(source, 'b', cssFile), 'utf8');
css = css.replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/g, (match, quote, url) => {
  if (/^(?:data:|https?:|blob:|#)/i.test(url)) return match;
  return `url(${JSON.stringify(new URL(url, assetBase + cssFile).href)})`;
});
const catalogs = {};
for (const name of await fs.readdir(path.join(source, 'b/assets/json'))) {
  if (name.endsWith('.json')) catalogs[name] = await fs.readFile(path.join(source, 'b/assets/json', name), 'utf8');
}

const scripts = [];
for (const file of scriptFiles) {
  let code = await fs.readFile(path.join(source, 'b', file), 'utf8');
  if (file.includes('bundle-')) {
    const assets = /function BC\(A\)\{.*?\}function yM\(A\)/;
    const links = /function Bs\(A\)\{.*?\}function lCA\(A,g\)/;
    if (!assets.test(code) || !links.test(code)) throw new Error('Unsupported bundle asset/link helpers.');
    code = code.replace(assets, 'function BC(A){return window.__BETTER_CHERRI_ASSETS__+A.replace(/^\\/+/,"")}function yM(A)');
    code = code.replace(links, 'function Bs(A){return "#"+(A.startsWith("/")?A:"/"+A)}function lCA(A,g)');
    // Give URL-building helpers a hierarchical base while preserving the real
    // browser origin. This does not enable a service worker in about:blank.
    code = code.replace(/window\.location\.origin/g, '(window.__BETTER_CHERRI_URL_BASE__||window.location.origin)');
    code = code.replace(/window\.origin\b/g, '(window.__BETTER_CHERRI_URL_BASE__||window.origin)');
    code = code.replace(/^var __IMPORT_META_URL__=.*?;/, `var __IMPORT_META_URL__=${JSON.stringify(assetBase + file)};`);
  }
  scripts.push(`<script>${inlineScript(code)}</script>`);
}

const setup = `
window.__BETTER_CHERRI__={version:${jsonForScript(chatProvider === 'xmpp'?'2.1.0':chatProvider === 'matrix'?'2.0.0':chatProvider === 'chitchatter'?'1.3.0':'1.2.0')},mode:"remote",chatMode:${jsonForScript(chatMode)},proxyRequiresHostedMode:false};
window.__BETTER_CHERRI_CHAT_PROVIDER__=${jsonForScript(chatProvider)};
window.__BETTER_CHERRI_P2P_ROOMS__=${jsonForScript(p2pRooms)};
window.__BETTER_CHERRI_NATIVE_ORIGIN__=window.__BETTER_CHERRI_CHAT_PROVIDER__==="cherri"&&globalThis.origin===${jsonForScript(apiBase)};
window.__BETTER_CHERRI_ASSETS__=${jsonForScript(assetBase)};
window.__BETTER_CHERRI_URL_BASE__=${jsonForScript(apiBase)};
window.__BETTER_CHERRI_UPSTREAM__=${jsonForScript(upstreamUrl)};
globalThis.__betterCherriApi=${jsonForScript(chatMode !== 'disabled' ? apiBase : '')};
window.__SW_FILE__="";
window.__swRegistration=Promise.resolve(null);
(function(){
  var catalogs=${jsonForScript(catalogs)},original=window.fetch.bind(window);
  window.fetch=function(input,options){
    var value=typeof input==="string"?input:input&&input.url||String(input),match=/\\/assets\\/json\\/([^/?#]+)(?:[?#]|$)/.exec(value);
    if(match&&Object.prototype.hasOwnProperty.call(catalogs,match[1]))return Promise.resolve(new Response(catalogs[match[1]],{status:200,headers:{"Content-Type":"application/json"}}));
    return original(input,options);
  };
})();`;

const appHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Better Cherri</title>${favicon}${historyScript}<script>${inlineScript(setup)}</script><script>${inlineScript(transport)}</script><script>${inlineScript(bridge)}</script><script>${inlineScript(roomSetup)}</script>${matrixScripts.map(code=>'<script>'+inlineScript(code)+'</script>').join('')}${xmppScripts.map(code=>'<script>'+inlineScript(code)+'</script>').join('')}${p2pScript?'<script>'+inlineScript(p2pScript)+'</script>':''}<style>${css}</style></head><body><main id="${root}"></main>${scripts.join('\n')}</body></html>`;
const bookmarkletHref = makeNativeBookmarklet().replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const chatNotice = chatMode === 'rooms'
  ? 'Chat is unavailable in this launcher. Original rooms and shared member lists are hidden.'
  : chatMode === 'shared'
  ? 'Chat connects to Cherri’s shared rooms.'
  : 'Private Better Cherri chat stays disconnected in this build.';
const launcherHtml = `<!doctype html>
<!-- Better Cherri fork. Upstream: https://github.com/cherriunblocked/svg
     Upstream assets pinned to ${commit}. AGPL-3.0.
     Single-file client; remote assets and original online services need internet.
     This build does not start or require a local server. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Better Cherri Launcher</title>${favicon}
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0c0a0c;color:#f5edf2;font:15px/1.55 system-ui,sans-serif}main{width:min(520px,100%);padding:32px;background:#171317;border:1px solid #332730;border-radius:22px}h1{font-size:30px;letter-spacing:-1px;margin:0 0 8px}p{color:#b9a9b3;margin:0 0 22px}button,a{font:inherit}button{padding:13px 19px;background:#f2b4d3;color:#28151f;font-weight:700;border:0;border-radius:11px;cursor:pointer}button:hover{background:#ffd0e7}button:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #ffd0e7;outline-offset:4px}.fine{font-size:12px;margin:15px 0 0;color:#ad9aa8}#status{margin-top:18px;color:#eab9d5;min-height:24px}a{color:#efb6d2}details{margin-top:22px;font-size:13px;color:#b9a9b3}summary{cursor:pointer}details p{margin:10px 0 0;font-size:13px}#same{margin-left:14px;font-size:13px}</style></head>
<body><main>${['matrix','xmpp'].includes(chatProvider) ? `<h1>Better Cherri</h1><p>The original Cherri chat interface, with private rooms and saved messages on free hosted chat.</p><button id="launch">Launch Better Cherri</button><a id="same" href="#" hidden>Open in this tab</a><div id="status" role="status" aria-live="polite"></div><p class="fine">No server on your PC. Create your free chat account inside the app. Room setup is required once for your community.</p>` : chatProvider === 'chitchatter' ? `<h1>Better Cherri</h1><p>Three private live-chat rooms, plus your games and music. No account, paid hosting, or server on your PC is required.</p>
<button id="launch">Launch Better Cherri</button><a id="same" href="#" hidden>Open in this tab</a><div id="status" role="status" aria-live="polite"></div>
<p class="fine">Share this same launcher with your members so everyone enters the same General, Games, and Music rooms. It contains the room access keys.</p><p class="fine">Chat is live-only. History disappears when everyone leaves. Browser and network limits apply.</p><details><summary>How private live chat works</summary><p>Chitchatter connects room participants using encrypted browser-to-browser connections. Anyone with this launcher or an invite link can join its rooms. The member list shows connected participants of the current room.</p><p>The chat interface comes from Chitchatter; the rest of Better Cherri keeps its existing interface and Cherri-hosted game/music services. Free signaling and relay availability determine which networks can connect.</p><p><a href="https://github.com/jeremyckahn/chitchatter" target="_blank" rel="noopener">Chitchatter source and documentation</a></p></details>` : `<h1>Better Cherri</h1><p>Use Cherri’s own sign-in and servers. Nothing needs to run as a server on your PC.</p>
<ol style="padding-left:22px;color:#b9a9b3"><li style="margin-bottom:16px">Drag <a id="native-bookmarklet" draggable="true" href="${bookmarkletHref}" style="display:inline-block;padding:8px 14px;border:1px solid #785569;border-radius:9px;font-weight:700">Better Cherri</a> to your browser’s bookmarks bar.</li><li style="margin-bottom:16px"><a href="${apiBase}/" target="_blank" rel="noopener">Open Cherri</a> and sign in normally.</li><li>While on Cherri, click the Better Cherri bookmark. In the new about:blank tab, choose this downloaded launcher HTML file.</li></ol>
<p class="fine">Chat uses your Cherri account directly with this launch method. Better rooms still require the server’s room-creation permission and a Better Cherri access role. The app checks these before offering room setup.</p>
<div id="status" role="status" aria-live="polite"></div>
<details><summary>Other launch option</summary><p>Opening directly from this file supports games and music. ${chatNotice}</p><button id="launch" style="margin-top:14px">Open games and music</button><a id="same" href="#" hidden>Open in this tab</a></details>`}
<details><summary>About this launcher</summary><p>The modified app and game lists are included in this file. Images, fonts, music, and games load online. The bookmark reads the selected HTML locally; it does not upload the file or copy account tokens.</p><p>Based on <a href="https://github.com/cherriunblocked/svg" target="_blank" rel="noopener">Cherri</a>, licensed under AGPL-3.0. Modified source and license accompany this release.</p></details></main>
<script>
"use strict";
const APP=${jsonForScript(appHtml)};
const status=document.getElementById("status"),same=document.getElementById("same");
function mount(target){target.document.open();target.document.write(APP);target.document.close();}
document.getElementById("launch").onclick=function(){try{var popup=window.open("about:blank","_blank");if(!popup){same.hidden=false;throw new Error("Allow popups, then launch again. You can also open Better Cherri in this tab.");}mount(popup);popup.opener=null;status.textContent="Better Cherri opened in a new about:blank tab.";}catch(error){status.textContent=error.message;}};
same.onclick=function(event){event.preventDefault();mount(window);};
</script></body></html>`;

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, launcherHtml);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(launcherHtml), chatMode, chatProvider, privateLiveRooms:p2pRooms.length, apiBase, upstreamUrl, assetBase, embeddedScripts: scriptFiles, catalogs: Object.keys(catalogs) }));
