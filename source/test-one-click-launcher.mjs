import assert from 'node:assert/strict';
import vm from 'node:vm';
import {makeOneClickLauncher, makeDownloadHelperSource} from './make-one-click-launcher.mjs';
const cdn='https://cdn.jsdelivr.net/gh/unblockedgames99x-code/better-cherri@0123456789abcdef0123456789abcdef01234567/app.js';
const config={rooms:{'better-general':'!general:salix.host','better-games':'!games:salix.host','better-music':'!music:salix.host'},accessToken:'TOKEN_SECRET',password:'PASSWORD_SECRET',session:{token:'NESTED_SECRET'}};
const expected={version:1,provider:'matrix',homeserver:'https://matrix.salix.host',name:'Better Cherri',rooms:config.rooms};
function run(html,{blocked=false}={}) {
  const matches=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(matches.length,1);
  const operations=[],scripts=[];const status={textContent:'',className:''};let click;
  const note={textContent:'Loading…'};
  const child={opener:{secret:'Do not retain'},document:{open(){operations.push('document.open');},write(text){operations.push(['document.write',text]);},close(){operations.push('document.close');},createElement(tag){operations.push(['create',tag]);return {};},getElementById(){return note;},body:{appendChild(script){operations.push('append');scripts.push(script);}}}};
  const context=vm.createContext({document:{getElementById:id=>id==='status'?status:{addEventListener(type,fn){assert.equal(type,'click');click=fn;}}},window:{open(url,target){operations.push(['window.open',url,target]);return blocked?null:child;}},localStorage:{getItem(){throw new Error('No login/session reads allowed.');}},fetch(){throw new Error('No pre-launch fetch allowed.');}});
  vm.runInContext(matches[0][1],context);
  assert.deepEqual(operations,[],'Opening the launcher does not open tabs or read auth.');
  assert.ok(click);click();
  return {child,operations,scripts,status,note};
}
{
  const html=makeOneClickLauncher(cdn,config);
  assert.ok(!html.includes('TOKEN_SECRET'));assert.ok(!html.includes('PASSWORD_SECRET'));assert.ok(!html.includes('NESTED_SECRET'));
  assert.equal((html.match(/<button\b/g)||[]).length,1,'Exactly one launch button.');
  assert.ok(!/type="file"|bookmarklet|javascript:|127\.0\.0\.1|localhost/i.test(html));
  const f=run(html);
  assert.deepEqual(f.operations[0],['window.open','about:blank','_blank'],'Tab opens synchronously before other work.');
  assert.equal(f.child.opener,null);assert.deepEqual(JSON.parse(JSON.stringify(f.child.__BETTER_MATRIX_COMMUNITY__)),expected);
  assert.equal(f.scripts.length,1);assert.equal(f.scripts[0].src,cdn);assert.equal(f.scripts[0].type,undefined,'CDN script is classic JavaScript.');
  f.scripts[0].onload();assert.match(f.status.textContent,/opened/);
  f.scripts[0].onerror();assert.match(f.status.textContent,/could not load from jsDelivr/);assert.equal(f.status.className,'error');assert.equal(f.note.textContent,f.status.textContent);
}
{
  const f=run(makeOneClickLauncher(cdn),{blocked:true});
  assert.equal(f.scripts.length,0);assert.match(f.status.textContent,/Allow pop-ups/);
  assert.equal(f.operations.length,1);assert.equal(f.child.__BETTER_MATRIX_COMMUNITY__,undefined);
}
{
  const html=makeOneClickLauncher(cdn,{name:'</script><script>alert(1)</script>',rooms:{...config.rooms,'better-general':'!evil:<script>'}});
  assert.ok(!html.includes('<script>alert(1)</script>'));assert.ok(!html.includes('!evil:<script>'));
  const f=run(html);assert.equal(f.child.__BETTER_MATRIX_COMMUNITY__.rooms['better-general'],'!evil:<script>');
  assert.throws(()=>makeOneClickLauncher(cdn,{rooms:{...config.rooms,'better-general':'!evil:</script><script>'}}),TypeError);
}
{
  for(const bad of ['http://cdn.jsdelivr.net/gh/unblockedgames99x-code/better-cherri@main/app.js','https://evil.example/app.js','https://cdn.jsdelivr.net/gh/other/repo@main/app.js',cdn+'?token=x',cdn.replace('/app.js','/index.html')])assert.throws(()=>makeOneClickLauncher(bad),TypeError);
  assert.doesNotThrow(()=>makeOneClickLauncher(cdn.replace(/@[a-f0-9]{40}/,'@main')));
  assert.throws(()=>makeOneClickLauncher(cdn,{rooms:{'better-general':'!one:salix.host'}}),TypeError);
  assert.throws(()=>makeOneClickLauncher(cdn,{rooms:{'better-general':'!same:salix.host','better-games':'!same:salix.host','better-music':'!same:salix.host'}}),TypeError);
  assert.throws(()=>makeOneClickLauncher(cdn,{...config,homeserver:'https://evil.example'}),TypeError);
  assert.throws(()=>makeOneClickLauncher(cdn,{...config,provider:'other'}),TypeError);
  const reconstructed=vm.runInNewContext('('+makeOneClickLauncher.toString()+')');
  assert.equal(reconstructed(cdn,config),makeOneClickLauncher(cdn,config),'Function.toString is self-contained for in-app downloads.');
}
{
  const blobs=[],links=[],revoked=[];let timer;
  const context=vm.createContext({Blob:class{constructor(parts,options){blobs.push({parts,options});}},URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(url){revoked.push(url);}},document:{body:{appendChild(link){links.push(link);}},createElement(){return{click(){this.clicked=true;},remove(){this.removed=true;}};}},setTimeout(fn,ms){assert.equal(ms,30000);timer=fn;}});
  vm.runInContext(makeDownloadHelperSource(cdn),context);context.__BETTER_CHERRI_DOWNLOAD_LAUNCHER__(config);
  assert.equal(blobs.length,1);assert.ok(!blobs[0].parts[0].includes('SECRET'));assert.equal(links[0].download,'Better-Cherri-Launcher.html');assert.equal(links[0].clicked,true);assert.equal(links[0].removed,true);timer();assert.deepEqual(revoked,['blob:test']);
}
console.log('One-click launcher: synchronous about:blank, embedded classic CDN script, scoped room-only configuration, safe script escaping, visible failures, and download helper passed. No network requests.');
