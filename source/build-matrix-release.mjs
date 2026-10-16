import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {makeStandardLauncher} from './make-standard-launcher.mjs';

const root=path.resolve('.');
const repo=path.join(root,'work/better-cherri-publish');
const args=process.argv.slice(2);
const ref=args.includes('--ref')?args[args.indexOf('--ref')+1]:'main';
const cdn=`https://cdn.jsdelivr.net/gh/unblockedgames99x-code/better-cherri@${ref}/app.js`;
const launcher=makeStandardLauncher(cdn);
await fs.mkdir(repo,{recursive:true});
await fs.mkdir(path.join(root,'outputs'),{recursive:true});

if(!args.includes('--launcher-only')) {
  const inputIndex=args.indexOf('--app-html');
  const appPath=inputIndex<0?'work/standard-app.html':args[inputIndex+1];
  if(!appPath)throw new Error('--app-html requires a saved HTML file.');
  const app=await fs.readFile(path.resolve(root,appPath),'utf8');
  for(const [index,match] of [...app.matchAll(/<script>([\s\S]*?)<\/script>/g)].entries())new vm.Script(match[1],{filename:'better-app-'+index+'.js'});
  const fallback='https://cdn.jsdelivr.net/gh/unblockedgames99x-code/better-cherri@main/app.js';
  const script=`/* Better Cherri 3.0.1; original Cherri chat. AGPL-3.0. Source and license in this repository. */
(()=>{'use strict';
const loadedFrom=document.currentScript&&document.currentScript.src||'';
const betterReleaseUrl=new RegExp(${JSON.stringify('^https://cdn[.]jsdelivr[.]net/gh/unblockedgames99x-code/better-cherri@(?:main|[a-f0-9]{40})/app[.]js$')}).test(loadedFrom)?loadedFrom:${JSON.stringify(fallback)};
globalThis.__BETTER_CHERRI_RELEASE_URL__=betterReleaseUrl;
const APP=${JSON.stringify(app).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029')};
document.open();document.write(APP);document.close();
globalThis.__BETTER_CHERRI_APP_READY__=true;
})();`;
  new vm.Script(script,{filename:'app.js'});
  const mounted=[];
  const sandbox={document:{currentScript:{src:cdn},open(){mounted.push('open')},write(html){mounted.push(html)},close(){mounted.push('close')}}};
  vm.runInNewContext(script,sandbox);
  if(mounted.length!==3||mounted[1]!==app)throw new Error('CDN app did not mount its exact embedded document.');
  if(sandbox.__BETTER_CHERRI_RELEASE_URL__!==cdn)throw new Error('CDN release URL must be retained.');
  if(sandbox.__BETTER_CHERRI_APP_READY__!==true)throw new Error('The app must signal completion after replacing its document.');
  await fs.writeFile(path.join(repo,'app.js'),script);
  await fs.writeFile(path.join(repo,'app.html'),app);
  await fs.writeFile(path.join(repo,'Better-Cherri.html'),app);
  await fs.writeFile(path.join(root,'outputs/Better-Cherri.html'),app);
  await fs.copyFile(path.join(root,'work/cherri/LICENSE'),path.join(repo,'LICENSE'));
  const sources=['assemble-remote.mjs','build-standard-app.mjs','build-matrix-release.mjs','patch-branding.mjs','patch-games-music.mjs','patch-standard-cherri.mjs','patch-nav.mjs','patch-remote-proxy.mjs','patch-remote-transport.mjs','patch-remote-media.mjs','better-remote-transport.js','make-standard-launcher.mjs','test-standard-cherri.mjs','test-standard-launcher.mjs','test-games-music.mjs','test-nav.mjs'];
  await fs.mkdir(path.join(repo,'source'),{recursive:true});
  for(const name of sources)await fs.copyFile(path.join(root,'work',name),path.join(repo,'source',name));
  await fs.writeFile(path.join(repo,'.nojekyll'),'');
}
await fs.writeFile(path.join(repo,'index.html'),launcher);
await fs.writeFile(path.join(repo,'Better-Cherri-Launcher.html'),launcher);
await fs.writeFile(path.join(root,'outputs/Better-Cherri-Launcher.html'),launcher);
console.log(JSON.stringify({launcherBytes:Buffer.byteLength(launcher),cdn,appRebuilt:!args.includes('--launcher-only')}));
