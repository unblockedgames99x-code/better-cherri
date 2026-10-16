import assert from 'node:assert/strict';
import vm from 'node:vm';
import {makeStandardLauncher} from './make-standard-launcher.mjs';

const cdn='https://cdn.jsdelivr.net/gh/unblockedgames99x-code/better-cherri@0123456789abcdef0123456789abcdef01234567/app.js';
function run(html,{blocked=false,autoSeed=true}={}) {
  const matches=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(matches.length,1);
  const operations=[],scripts=[],timers=new Map(),listeners=new Map();const status={textContent:'',className:''};let click,now=0,nextTimer=1;
  let note={textContent:'Loading…'};
  const makeDocument=()=>({documentElement:{},head:{appendChild(node){operations.push(['head.append',node]);}},open(){throw new Error('Parent document.open would replace about:blank URL.');},write(){throw new Error('Parent document.write is prohibited.');},close(){throw new Error('Parent document.close is unnecessary.');},createElement(tag){operations.push(['create',tag]);return {tagName:tag.toUpperCase(),attributes:{},isConnected:false,setAttribute(name,value){this.attributes[name]=value;}};},getElementById(){return note;},body:{style:{},replaceChildren(node){operations.push('seed');note=node;},appendChild(script){operations.push('append');script.isConnected=true;scripts.push(script);}}});
  const child={opener:{secret:'Do not retain'},closed:false,location:{href:'about:blank'},document:makeDocument(),addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};
  const button={disabled:false,addEventListener(type,fn){assert.equal(type,'click');click=fn;}};
  const context=vm.createContext({setTimeout(fn,delay){const id=nextTimer++;timers.set(id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);},document:{getElementById:id=>id==='status'?status:button},window:{open(url,target){operations.push(['window.open',url,target]);return blocked?null:child;}},localStorage:{getItem(){throw new Error('No login/session reads allowed.');}},fetch(){throw new Error('No pre-launch fetch allowed.');}});
  const advance=ms=>{const target=now+ms;for(;;){const due=[...timers.entries()].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;now=due[1].at;timers.delete(due[0]);due[1].fn();}now=target;};
  vm.runInContext(matches[0][1],context);
  assert.deepEqual(operations,[],'Opening the launcher does not open tabs or read auth.');
  assert.ok(click);click();
  if(autoSeed&&!blocked)advance(0);
  return {child,operations,scripts,status,get note(){return note;},button,timers,advance,click,fireLoad(){listeners.get('load')?.();},replaceDocument(){for(const script of scripts)script.isConnected=false;child.document=makeDocument();}};
}
{
  const html=makeStandardLauncher(cdn);
  assert.equal((html.match(/<button\b/g)||[]).length,1,'Exactly one launch button.');
  assert.match(html,/Cherri's original chat, games and music\./);
  assert.ok(!/type="file"|bookmarklet|javascript:|127\.0\.0\.1|localhost|private chat|yax\.im|matrix|xmpp|community|download.helper/i.test(html));
  const f=run(html);
  assert.deepEqual(f.operations[0],['window.open','about:blank','_blank'],'Tab opens synchronously before other work.');
  assert.equal(f.child.opener,null);
  assert.equal(f.child.document.title,'Better Cherri');assert.equal(f.child.document.documentElement.lang,'en');
  assert.equal(f.note.id,'better-launch-status');assert.match(f.note.textContent,/Loading Better Cherri/);
  assert.ok(!html.includes('child.document.open('));assert.ok(!html.includes('child.document.write('));
  assert.equal(f.scripts.length,1);assert.equal(f.scripts[0].src,cdn);assert.equal(f.scripts[0].type,undefined,'CDN script is classic JavaScript.');
  f.click();assert.equal(f.scripts.length,1,'Repeated clicks while loading cannot open another tab.');
  f.scripts[0].onload();assert.match(f.status.textContent,/opened/);
  assert.equal(f.timers.size,0);assert.equal(f.button.disabled,false);
  f.scripts[0].onerror();assert.match(f.status.textContent,/opened/,'Late errors cannot undo a completed launch.');
  const errorCase=run(html);errorCase.scripts[0].onerror();assert.match(errorCase.status.textContent,/could not load from jsDelivr/);assert.equal(errorCase.status.className,'error');assert.equal(errorCase.note.textContent,errorCase.status.textContent);
}
{
  const f=run(makeStandardLauncher(cdn),{autoSeed:false});
  assert.equal(f.scripts.length,0,'CDN injection is deferred until the blank document can settle.');
  assert.deepEqual(f.operations,[['window.open','about:blank','_blank']],'The tab still opens during the original click.');
  f.replaceDocument();f.fireLoad();assert.equal(f.scripts.length,1);
  f.advance(0);assert.equal(f.scripts.length,1,'Load and timer paths do not duplicate the CDN script.');
  const stale=f.scripts[0];f.replaceDocument();stale.onerror();stale.onload();assert.ok(!f.status.className,'Discarded scripts cannot report load errors.');assert.match(f.status.textContent,/Loading/,'A discarded script cannot prematurely complete loading.');
  f.advance(100);assert.equal(f.scripts.length,2,'A committed blank navigation is re-seeded.');
  f.scripts[1].onload();assert.equal(f.timers.size,0);assert.match(f.status.textContent,/opened/);
}
{
  const f=run(makeStandardLauncher(cdn));f.advance(45000);assert.match(f.status.textContent,/taking too long/);assert.equal(f.timers.size,0);assert.equal(f.button.disabled,false);
  const closed=run(makeStandardLauncher(cdn));closed.child.closed=true;closed.advance(100);assert.match(closed.status.textContent,/tab was closed/);assert.equal(closed.timers.size,0);
  const moved=run(makeStandardLauncher(cdn));moved.child.location.href='https://example.test/';moved.advance(100);assert.match(moved.status.textContent,/navigated away/);assert.equal(moved.scripts.length,1,'No CDN code is injected into an unrelated page.');
}
{
  const f=run(makeStandardLauncher(cdn));
  const seeds=f.operations.filter(operation=>operation==='seed').length;
  f.scripts[0].isConnected=false;
  f.child.__BETTER_CHERRI_APP_READY__=true;
  // Readiness must stop the watcher before inspecting the replaced page.
  Object.defineProperty(f.child,'document',{get(){throw new Error('A ready app must not be inspected or re-seeded.');}});
  Object.defineProperty(f.child,'location',{get(){throw new Error('Readiness comes before URL checks.');}});
  f.advance(100);
  assert.match(f.status.textContent,/opened/);assert.equal(f.timers.size,0);assert.equal(f.button.disabled,false);
  f.advance(50000);assert.equal(f.scripts.length,1);assert.equal(f.operations.filter(operation=>operation==='seed').length,seeds,'Detached mounted source does not trigger a reload loop.');
}
{
  const f=run(makeStandardLauncher(cdn),{blocked:true});
  assert.equal(f.scripts.length,0);assert.match(f.status.textContent,/Allow pop-ups/);
  assert.equal(f.operations.length,1);assert.equal(f.button.disabled,false);
}
{
  const f=run(makeStandardLauncher(cdn),{autoSeed:false});
  Object.defineProperty(f.child,'document',{get(){throw new Error('Access denied');}});
  f.advance(0);assert.match(f.status.textContent,/could not open/);assert.equal(f.timers.size,0);assert.equal(f.button.disabled,false);
}
{
  const f=run(makeStandardLauncher(cdn),{autoSeed:false});
  f.child.document.body=null;f.advance(0);assert.equal(f.scripts.length,0,'Incomplete initial documents wait for another tick.');
  f.replaceDocument();f.advance(100);assert.equal(f.scripts.length,1);
  f.scripts[0].onload();assert.equal(f.timers.size,0);
}
{
  for(const bad of [undefined,null,42,{},'http://cdn.jsdelivr.net/gh/unblockedgames99x-code/better-cherri@main/app.js','https://evil.example/app.js','https://cdn.jsdelivr.net/gh/other/repo@main/app.js',cdn+'?token=x',cdn.replace('/app.js','/index.html'),cdn+'\n</script><script>alert(1)</script>'])assert.throws(()=>makeStandardLauncher(bad),TypeError);
  assert.doesNotThrow(()=>makeStandardLauncher(cdn.replace(/@[a-f0-9]{40}/,'@main')));
  const reconstructed=vm.runInNewContext('('+makeStandardLauncher.toString()+')');
  assert.equal(reconstructed(cdn),makeStandardLauncher(cdn),'The generator has no external runtime dependencies.');
}
console.log('Standard launcher: synchronous about:blank, pinned classic CDN script, document replacement recovery, readiness before DOM access, visible failures, no account reads, and one-button behavior passed. No network requests.');
