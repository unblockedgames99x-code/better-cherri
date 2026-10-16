import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {parseLauncherApp} from './native-origin-bookmarklet.mjs';
import {makeOneClickLauncher,makeDownloadHelperSource} from './make-one-click-launcher.mjs';

const root=path.resolve('.');
const repo=path.join(root,'work/better-cherri-publish');
const args=process.argv.slice(2);
const ref=args.includes('--ref')?args[args.indexOf('--ref')+1]:'main';
const cdn=`https://cdn.jsdelivr.net/gh/unblockedgames99x-code/better-cherri@${ref}/app.js`;
const launcher=makeOneClickLauncher(cdn);
await fs.mkdir(repo,{recursive:true});
await fs.mkdir(path.join(root,'outputs'),{recursive:true});

if(!args.includes('--launcher-only')) {
  const app=parseLauncherApp(await fs.readFile(path.join(root,'work/matrix-full-launcher.html'),'utf8'));
  for(const [index,match] of [...app.matchAll(/<script>([\s\S]*?)<\/script>/g)].entries())new vm.Script(match[1],{filename:'matrix-app-'+index+'.js'});
  const fallback='https://cdn.jsdelivr.net/gh/unblockedgames99x-code/better-cherri@main/app.js';
  const helper=makeDownloadHelperSource(fallback).replace(`make(${JSON.stringify(fallback)}, community)`,'make(betterReleaseUrl, community)');
  if(!helper.includes('make(betterReleaseUrl, community)'))throw new Error('Download helper source changed.');
  const script=`/* Better Cherri 2.0.0; AGPL-3.0. Source and license in this repository. */
(()=>{'use strict';
const loadedFrom=document.currentScript&&document.currentScript.src||'';
const betterReleaseUrl=new RegExp(${JSON.stringify('^https://cdn[.]jsdelivr[.]net/gh/unblockedgames99x-code/better-cherri@(?:main|[a-f0-9]{40})/app[.]js$')}).test(loadedFrom)?loadedFrom:${JSON.stringify(fallback)};
globalThis.__BETTER_CHERRI_RELEASE_URL__=betterReleaseUrl;
${helper}
const APP=${JSON.stringify(app).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')};
document.open();document.write(APP);document.close();
})();`;
  new vm.Script(script,{filename:'app.js'});
  const mounted=[];
  const sandbox={document:{currentScript:{src:cdn},open(){mounted.push('open')},write(html){mounted.push(html)},close(){mounted.push('close')}}};
  vm.runInNewContext(script,sandbox);
  if(mounted.length!==3||mounted[1]!==app)throw new Error('CDN app did not mount its exact embedded document.');
  if(typeof sandbox.__BETTER_CHERRI_DOWNLOAD_LAUNCHER__!=='function')throw new Error('Missing community launcher export.');
  if(sandbox.__BETTER_CHERRI_RELEASE_URL__!==cdn)throw new Error('CDN release URL must be retained.');
  await fs.writeFile(path.join(repo,'app.js'),script);
  await fs.copyFile(path.join(root,'work/cherri/LICENSE'),path.join(repo,'LICENSE'));
  const sources=['assemble-remote.mjs','build-remote-launcher.mjs','build-matrix-release.mjs','patch-branding.mjs','patch-games-music.mjs','patch-chat.mjs','patch-nav.mjs','patch-room-view.mjs','patch-matrix-integration.mjs','patch-remote-proxy.mjs','patch-remote-transport.mjs','patch-remote-media.mjs','better-cherri-rooms-bridge.js','better-remote-transport.js','better-cherri-room-setup.js','better-p2p-chat.js','native-origin-bookmarklet.mjs','make-one-click-launcher.mjs','better-matrix-client.js','better-matrix-bridge.js','better-matrix-ui.js','test-matrix-client.mjs','test-matrix-bridge.mjs','test-matrix-ui.mjs','test-matrix-integration.mjs','test-one-click-launcher.mjs','test-games-music.mjs','test-nav.mjs'];
  await fs.mkdir(path.join(repo,'source'),{recursive:true});
  for(const name of sources)await fs.copyFile(path.join(root,'work',name),path.join(repo,'source',name));
  await fs.writeFile(path.join(repo,'.nojekyll'),'');
}
await fs.writeFile(path.join(repo,'index.html'),launcher);
await fs.writeFile(path.join(repo,'Better-Cherri-Launcher.html'),launcher);
await fs.writeFile(path.join(root,'outputs/Better-Cherri-Launcher.html'),launcher);
console.log(JSON.stringify({launcherBytes:Buffer.byteLength(launcher),cdn,appRebuilt:!args.includes('--launcher-only')}));
