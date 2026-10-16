import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

// Build a complete HTML document. Chat and account forms stay on Cherri's
// own origin; only public game/music requests use its existing transport.
const root = path.resolve('.');
const source = path.join(root, 'work/remote-cherri/b');
const assetBase = 'https://cdn.jsdelivr.net/gh/cherriunblocked/svg@685e2094ea73d42f9278e5f7e3df1b1a9f183134/b/';
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const inline = value => value.replace(/<\/script/gi, '<\\/script');
const shell = await fs.readFile(path.join(source, 'index.html'), 'utf8');
const cssFile = /"css":\[\["([^\"]+)"/.exec(shell)?.[1];
const scriptConfig = /"js":(\[\[.*?\]\])\}\);<\/script>/.exec(shell);
const mountId = /<main id="([^"]+)"/.exec(shell)?.[1];
if (!cssFile || !scriptConfig || !mountId) throw new Error('Unsupported upstream app shell.');
const files = JSON.parse(scriptConfig[1]).map(entry => entry[0]);
const favicon = /<link rel="icon"[^>]*>/.exec(shell)?.[0] || '<link rel="icon" href="data:,">';
const history = /<script>\(function\(\)\{var r=window,t=\{ps:History\.prototype\.pushState.*?<\/script>/.exec(shell)?.[0] || '';
let css = await fs.readFile(path.join(source, cssFile), 'utf8');
css = css.replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/g, (match, quote, url) => /^(?:data:|https?:|blob:|#)/i.test(url) ? match : `url(${JSON.stringify(new URL(url, assetBase + cssFile).href)})`);
const catalogs = {};
for (const name of await fs.readdir(path.join(source, 'assets/json'))) {
  if (name.endsWith('.json')) catalogs[name] = await fs.readFile(path.join(source, 'assets/json', name), 'utf8');
}
const scripts = [];
for (const file of files) {
  let code = await fs.readFile(path.join(source, file), 'utf8');
  if (file.includes('bundle-')) {
    const assets = /function BC\(A\)\{.*?\}function yM\(A\)/;
    const links = /function Bs\(A\)\{.*?\}function lCA\(A,g\)/;
    if (!assets.test(code) || !links.test(code)) throw new Error('Unsupported bundle asset/link helpers.');
    code = code.replace(assets, 'function BC(A){return window.__BETTER_CHERRI_ASSETS__+A.replace(/^\\/+/ ,"")}function yM(A)');
    code = code.replace(links, 'function Bs(A){return "#"+(A.startsWith("/")?A:"/"+A)}function lCA(A,g)');
    code = code.replace(/window\.location\.origin/g, '(window.__BETTER_CHERRI_URL_BASE__||window.location.origin)');
    code = code.replace(/window\.origin\b/g, '(window.__BETTER_CHERRI_URL_BASE__||window.origin)');
    code = code.replace(/^var __IMPORT_META_URL__=.*?;/, `var __IMPORT_META_URL__=${JSON.stringify(assetBase + file)};`);
  }
  new vm.Script(code, {filename:file});
  scripts.push('<script>' + inline(code) + '</script>');
}
const setup = `
window.__BETTER_CHERRI__={version:"3.0.1",mode:"remote",chatMode:"shared",proxyRequiresHostedMode:false};
window.__BETTER_CHERRI_CHAT_PROVIDER__="cherri";
window.__BETTER_CHERRI_ASSETS__=${json(assetBase)};
window.__BETTER_CHERRI_URL_BASE__="https://cherrion.top";
window.__BETTER_CHERRI_UPSTREAM__="https://cherrion.top/";
window.__SW_FILE__="";window.__swRegistration=Promise.resolve(null);
(()=>{const catalogs=${json(catalogs)},original=window.fetch.bind(window);window.fetch=function(input,options){
const value=typeof input==="string"?input:input&&input.url||String(input),match=/\\/assets\\/json\\/([^/?#]+)(?:[?#]|$)/.exec(value);
if(match&&Object.prototype.hasOwnProperty.call(catalogs,match[1]))return Promise.resolve(new Response(catalogs[match[1]],{status:200,headers:{"Content-Type":"application/json"}}));return original(input,options);
};})();`;
const transport = await fs.readFile(path.join(source, 'better-remote-transport.js'), 'utf8');
new vm.Script(setup); new vm.Script(transport);
const app = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Better Cherri</title>' + favicon + history + '<script>' + inline(setup) + '</script><script>' + inline(transport) + '</script><style>' + css + '</style></head><body><main id="' + mountId + '"></main>' + scripts.join('\n') + '</body></html>';
if (/__betterXmpp|__betterMatrix|__betterCherriRequest|__betterCherriRoomSetup/.test(app)) throw new Error('A custom chat adapter remains in the standard build.');
await fs.writeFile(path.join(root, 'work/standard-app.html'), app);
console.log(JSON.stringify({output:'work/standard-app.html',bytes:Buffer.byteLength(app),chat:'https://cherrion.top/chat',embeddedScripts:files}));
