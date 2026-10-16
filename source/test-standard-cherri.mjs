import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {patchStandardCherri, standardFetchRouter, standardRouteView} from './patch-standard-cherri.mjs';

const original = await readFile(new URL('./upstream-bundle.js', import.meta.url), 'utf8');
const patched = patchStandardCherri(original);
new vm.Script(patched);
assert.equal(patchStandardCherri(patched), patched);
for (const value of ['GM="session_token"', '/api/auth/login', '/api/auth/register', '/api/chat/channels', 'try{g.onMessage(JSON.parse(w.data))}catch{}', 'Browse every public profile in the database.']) assert.ok(patched.includes(value), 'Original Cherri behavior missing: ' + value);
for (const value of ['__betterXmpp', '__betterMatrix', '__betterCherriRequest', 'Original Cherri rooms are hidden', 'Invitation required.', 'better-general', '__BETTER_XMPP_DEFAULT_COMMUNITY__', 'mountAccount(']) assert.ok(!patched.includes(value), 'Custom chat behavior remains: ' + value);
assert.throws(() => patchStandardCherri(original + ' __betterXmpp'), /without private chat patches/);

function node(type, props) { return {type, props}; }
const jsx = {jsx:node, jsxs:node};
const nativeComponent = () => 'original';
function render(id, pathname = '/' + id, search = '', native = false) {
  const context = vm.createContext({origin:native?'https://cherrion.top':'https://unblockedgames99x-code.github.io', URL, Me:() => ({pathname,search}), eA:jsx, pkA:new Proxy({}, {get:() => nativeComponent})});
  vm.runInContext(standardRouteView, context);
  return context.d6({id});
}
for (const id of ['chat','members','login','reset','profile','profile/view','shop','achievements','mod','activity','assistant']) {
  const view = render(id, id === 'profile/view'?'/profile/view/test':'/' + id, '?next=%2Fchat');
  assert.equal(view.type, 'div');
  const [frame, fallback] = view.props.children;
  assert.equal(frame.type, 'iframe');
  assert.equal(new URL(frame.props.src).origin, 'https://cherrion.top');
  assert.equal(new URL(frame.props.src).search, '?next=%2Fchat');
  assert.equal(frame.props.style.flex, 1);
  assert.ok(!('sandbox' in frame.props));
  assert.equal(fallback.props.children.type, 'a');
  assert.equal(fallback.props.children.props.href, frame.props.src);
  assert.equal(fallback.props.children.props.rel, 'noopener noreferrer');
  assert.equal(render(id, '/' + id, '', true).type, nativeComponent);
}
for (const id of ['home','g','music','emu','tools','extensions','changelog','settings']) assert.equal(render(id).type, nativeComponent);
assert.equal(new URL(render('profile/view', '//untrusted.example/name').props.children[0].props.src).origin, 'https://cherrion.top');

function transport(native = false) {
  const calls = [], proxied = [];
  const fetch = async (input, options) => { calls.push({input,options}); return new Response('native'); };
  const proxy = async input => { proxied.push(input); return new Response('public'); };
  const origin = native?'https://cherrion.top':'https://unblockedgames99x-code.github.io';
  const context = vm.createContext({origin, URL, Request, Response, Headers, location:{origin,href:origin + '/better-cherri/app.html'}, wpA(){}, Mv:() => true, NE:() => 'https://cherrion.top', fetch, __betterCherriRemoteFetch:proxy});
  context.window=context;
  vm.runInContext(standardFetchRouter, context);
  return {context,calls,proxied};
}
const remote = transport();
for (const path of ['/api/music/search?q=hi','/api/music/stream?id=123','/api/emulator/arcade/games','/api/gmshelf/catalog','/api/extensions/catalog','/api/presence/count','/api/suggest?q=hi','/api/playlists/search?q=hi','/api/ping']) {
  const response = await remote.context.fetch(path, {headers:{Authorization:'Bearer secret',Cookie:'session=secret','X-Api-Key':'secret','X-Auth-Token':'secret',Range:'bytes=0-'},credentials:'include'});
  assert.equal(await response.text(), 'public');
  const sent=remote.proxied.at(-1);
  assert.equal(new URL(sent.url).origin,'https://cherrion.top');
  for (const name of ['authorization','cookie','x-api-key','x-auth-token']) assert.equal(sent.headers.get(name),null);
  assert.equal(sent.headers.get('range'),'bytes=0-');
  assert.equal(sent.credentials,'omit');
}
await remote.context.fetch('/api/music/search?token=secret&ACCESS_TOKEN=secret&session_token=secret&authorization=secret&q=ok');
assert.equal(new URL(remote.proxied.at(-1).url).search,'?q=ok');
await remote.context.fetch(new URL('https://unblockedgames99x-code.github.io/api/ping'));
assert.equal(remote.proxied.at(-1).url,'https://cherrion.top/api/ping');
await remote.context.fetch(new Request('https://unblockedgames99x-code.github.io/api/music/ping',{method:'HEAD',headers:{Authorization:'Bearer secret'},credentials:'include'}));
assert.equal(remote.proxied.at(-1).method,'HEAD');
assert.equal(remote.proxied.at(-1).headers.get('authorization'),null);
const previous=remote.proxied.length;
for (const path of ['/api/auth/login','/api/auth/register','/api/auth/me','/api/chat/channels','/api/chat/channels/general/messages','/api/members','/api/users/settings','/api/shop','/api/playlists','/api/voice/join','/api/emulator/roms/private-id','/api/music/../auth/me']) assert.equal((await remote.context.fetch(path)).status,401);
for (const method of ['POST','PUT','PATCH','DELETE']) assert.equal((await remote.context.fetch('/api/music/source',{method,body:'x'})).status,401);
assert.equal(remote.proxied.length,previous);
assert.equal(remote.calls.length,0);
await remote.context.fetch('https://example.org/api/music/search');
await remote.context.fetch('https://example.org/image.png');
assert.equal(remote.calls.length,2);
assert.equal(remote.proxied.length,previous);

const native = transport(true);
await native.context.fetch('/api/auth/login',{method:'POST',headers:{Authorization:'Bearer native'},body:'password'});
assert.equal(native.calls[0].input,'https://cherrion.top/api/auth/login');
assert.equal(native.calls[0].options.headers.Authorization,'Bearer native');
assert.equal(native.proxied.length,0);
await native.context.fetch(new URL('https://cherrion.top/api/chat/channels'));
assert.equal(native.calls[1].input,'https://cherrion.top/api/chat/channels');
const request=new Request('https://cherrion.top/api/auth/me',{headers:{Authorization:'Bearer native'}});
await native.context.fetch(request);
assert.equal(native.calls[2].input.headers.get('authorization'),'Bearer native');

const uiSource=/function UI\(\)\{[^}]+\}/.exec(patched)[0];
for (const [origin, expected] of [['https://cherrion.top','native-token'],['https://unblockedgames99x-code.github.io',null],['null',null]]) {
  let reads=0;
  const context=vm.createContext({origin,GM:'session_token',localStorage:{getItem(key){reads++;assert.equal(key,'session_token');return 'native-token';}}});
  vm.runInContext(uiSource,context);
  assert.equal(context.UI(),expected);
  assert.equal(reads,expected===null?0:1);
}
const storageSource=patched.slice(patched.indexOf('kCA=new Set(['),patched.indexOf(',FCA=new Set(['));
const storageContext=vm.createContext({pG:'cherri_settings_unpushed',c0:'cherri_wallpaper'});
vm.runInContext('var '+storageSource,storageContext);
for (const key of ['session_token','better_cherri_session_token','better_cherri_remote_session_token','better_cherri_matrix_session_v1','better_cherri_xmpp_session_v1','better_cherri_matrix_event_ids_v1','better_cherri_xmpp_event_ids_v1','better_cherri_matrix_blocks:person','better_cherri_xmpp_blocks:person']) assert.equal(storageContext.sV(key),true,'Private legacy key exported: '+key);
assert.equal(storageContext.sV('cherri_theme'),false);
console.log('Standard Cherri tests passed: original channels/auth/sockets, native-origin pages, private request isolation, public games/music transport.');
