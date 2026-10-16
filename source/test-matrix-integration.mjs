import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {patchGamesMusic} from './patch-games-music.mjs';
import {patchBranding} from './patch-branding.mjs';
import {patchChat} from './patch-chat.mjs';
import {patchNavigation} from './patch-nav.mjs';
import {patchRoomView} from './patch-room-view.mjs';
import {patchMatrixIntegration} from './patch-matrix-integration.mjs';

const original = await fs.readFile(new URL('./upstream-bundle.js', import.meta.url), 'utf8');
let baseline = patchGamesMusic(original).source;
baseline = patchBranding(baseline);
baseline = patchChat(baseline);
baseline = patchNavigation(baseline).source;
baseline = patchRoomView(baseline);
const source = patchMatrixIntegration(baseline);
new vm.Script(source, {filename: 'better-cherri-matrix-integration.js'});
assert.equal(patchMatrixIntegration(source), source, 'Applying the Matrix patch twice must be idempotent.');
const segment = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Required original bundle anchors must exist: ' + start);
  return source.slice(a, b);
};
const sessionCode = segment('function UI(){', 'function be(');
const cacheCode = segment('function Vi(){', 'function I0(');
const streamCode = segment('function Y0(A,g){', 'function DeA(');
const routeCode = segment('function d6({id:A}){', 'function kkA(');
const fetchCode = segment('if(wpA(),!0){let A=window.fetch.bind(window);window.fetch=', 'var oRA=');

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); return true; }
  };
}
const storage = new Map([['session_token', 'original-cherri-session']]);
let marker = 'eyJ0eXAiOiJCQyJ9.' + Buffer.from(JSON.stringify({sub: '@tester:matrix.org'})).toString('base64url') + '.matrix';
let logoutCalls = 0, sessionEvents = 0, meEvents = 0;
const auth = {globalThis: null, window: null, GM: 'session_token', Wt: 'cherri:me', A0: new Map([['/api/auth/me', {token: 'old'}]]), Event, atob,
  localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
  __BETTER_CHERRI_CHAT_PROVIDER__: 'matrix', __betterMatrixSessionToken: () => marker,
  __betterMatrix: {logout: async () => {logoutCalls++; marker = null;}}
};
Object.assign(auth, eventTarget()); auth.window = auth; auth.globalThis = auth;
auth.addEventListener('cherri:session', () => sessionEvents++); auth.addEventListener('cherri:me', () => meEvents++);
vm.runInNewContext(cacheCode + sessionCode, auth);
assert.equal(auth.UI(), marker);
assert.equal(auth.Oy(), '@tester:matrix.org', 'The original current-user helper must read the Matrix marker.');
auth.NM('THIS_IS_A_PRIVATE_MATRIX_ACCESS_TOKEN');
assert.equal(storage.get('session_token'), 'original-cherri-session');
assert.equal([...storage.values()].includes('THIS_IS_A_PRIVATE_MATRIX_ACCESS_TOKEN'), false);
auth.dispatchEvent(new Event('better-matrix:session'));
assert.equal(auth.A0.size, 0); assert.equal(meEvents, 1);
auth.Xy(); await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(logoutCalls, 1); assert.equal(auth.UI(), null); assert.equal(sessionEvents, 1); assert.equal(meEvents, 2);
assert.equal(storage.get('session_token'), 'original-cherri-session');
auth.__BETTER_CHERRI_CHAT_PROVIDER__ = 'rooms';
auth.NM('updated-original-session'); assert.equal(auth.UI(), 'updated-original-session');
auth.Xy(); assert.equal(storage.has('session_token'), false); assert.equal(logoutCalls, 1);

const fallbackCalls = [], nativeCalls = [];
let mode = 'handled';
const fetchContext = {globalThis: null, window: null, Headers, Request, Response, URL, wpA() {}, NE: () => 'https://cherrion.top',
  __BETTER_CHERRI_CHAT_PROVIDER__: 'matrix',
  fetch: async (...args) => {nativeCalls.push(args); return new Response('native');},
  __betterMatrixRequest: async () => {if (mode === 'handled') return new Response('{"private":true}', {headers: {'Content-Type': 'application/json'}}); if (mode === 'reject') throw new Error('Matrix unavailable'); return null;},
  __betterCherriRequest: async (...args) => {fallbackCalls.push(args); return new Response('public');}
};
fetchContext.globalThis = fetchContext; fetchContext.window = fetchContext;
vm.runInNewContext(fetchCode, fetchContext);
assert.equal(await (await fetchContext.fetch('/api/chat/channels')).text(), '{"private":true}');
assert.equal(fallbackCalls.length, 0); assert.equal(nativeCalls.length, 0);
mode = 'reject'; await assert.rejects(fetchContext.fetch('/api/chat/channels'), /Matrix unavailable/); assert.equal(fallbackCalls.length, 0);
mode = 'public';
const publicOptions = {headers: {Authorization: 'Bearer matrix-marker', 'X-Test': 'preserved'}};
await fetchContext.fetch('/api/music/search?q=hello', publicOptions);
assert.equal(fallbackCalls.length, 1);
assert.equal(fallbackCalls[0][1].headers.has('Authorization'), false);
assert.equal(fallbackCalls[0][1].headers.get('X-Test'), 'preserved');
assert.equal(publicOptions.headers.Authorization, 'Bearer matrix-marker', 'Removing authorization must not mutate the caller options.');
const publicRequest = new Request('https://cherrion.top/api/music/public-operation', {method: 'POST', headers: {Authorization: 'Bearer private-marker', 'Content-Type': 'application/json'}, body: '{"x":1}'});
await fetchContext.fetch(publicRequest);
assert.equal(fallbackCalls[1][0].method, 'POST');
assert.equal(await fallbackCalls[1][0].text(), '{"x":1}');
assert.equal(fallbackCalls[1][0].headers.has('Authorization'), false); assert.equal(fallbackCalls[1][1].headers.has('Authorization'), false);
fetchContext.__BETTER_CHERRI_CHAT_PROVIDER__ = 'rooms';
await fetchContext.fetch('/api/music/search', publicOptions);
assert.equal(fallbackCalls.at(-1)[1], publicOptions, 'Non-Matrix mode must preserve the existing router behavior.');

let matrixStreams = 0, nativeSockets = 0;
const logical = {close() {}, send() {}, isOpen: () => true};
const streamContext = {globalThis: null, window: null, __BETTER_CHERRI_CHAT_PROVIDER__: 'matrix',
  __betterMatrixStream(path, callbacks) {matrixStreams++; return path.includes('/chat/') ? logical : null;},
  WebSocket: class {constructor() {nativeSockets++; throw new Error('Native socket must not open for Matrix.');}}
};
streamContext.globalThis = streamContext; streamContext.window = streamContext;
vm.runInNewContext(streamCode, streamContext);
assert.equal(streamContext.Y0('/api/chat/channels/better-general/stream?token=marker', {}), logical);
assert.equal(streamContext.Y0('/api/unsupported-stream', {}).isOpen(), false);
assert.equal(matrixStreams, 2); assert.equal(nativeSockets, 0);

function routeHarness() {
  const target = eventTarget(), slots = [], pending = [];
  let hookIndex = 0, loggedIn = false, mounts = [], cleanups = [];
  const originalChat = () => {}, originalMembers = () => {}, originalHome = () => {};
  const equalDeps = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const context = {globalThis: null, window: null, Event, __BETTER_CHERRI_CHAT_PROVIDER__: 'matrix', __BETTER_CHERRI_NATIVE_ORIGIN__: false,
    HB: () => () => {}, Vt() {}, OB: 'cherri://', UI: () => loggedIn ? 'matrix-marker' : null,
    pkA: {chat: originalChat, members: originalMembers, home: originalHome},
    __betterMatrixUI: {
      mountAccount(container) {mounts.push({kind: 'account', container}); return () => cleanups.push('account');},
      mountCommunity(container) {mounts.push({kind: 'community', container}); return () => cleanups.push('community');}
    },
    eA: {jsx: (type, props, key) => ({type, props, key}), jsxs: (type, props, key) => ({type, props, key})},
    NA: {
      useState(value) {const n = hookIndex++; slots[n] ||= {kind: 'state', value: typeof value === 'function' ? value() : value}; return [slots[n].value, next => {slots[n].value = typeof next === 'function' ? next(slots[n].value) : next;}];},
      useRef(value) {const n = hookIndex++; slots[n] ||= {kind: 'ref', value: {current: value}}; return slots[n].value;},
      useEffect(callback, deps) {const n = hookIndex++; const old = slots[n]; if (!old || !equalDeps(old.deps, deps)) pending.push(() => {old?.cleanup?.(); const cleanup = callback(); slots[n] = {kind: 'effect', deps, cleanup};});}
    }
  };
  Object.assign(context, target); context.globalThis = context; context.window = context;
  vm.runInNewContext(routeCode, context);
  const walk = node => {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(walk)];
  };
  return {context, mounts, cleanups, originalChat, originalMembers, originalHome,
    setLoggedIn(value) {loggedIn = value;},
    render(id) {
      hookIndex = 0;
      const tree = context.d6({id});
      for (const node of walk(tree)) if (node.props?.ref && typeof node.props.ref === 'object') node.props.ref.current = {tagName: node.type, testContainer: true};
      for (const effect of pending.splice(0)) effect();
      return {tree, nodes: walk(tree)};
    },
    destroy() {for (const slot of slots) slot?.cleanup?.();}
  };
}
const ui = routeHarness();
let rendered = ui.render('chat');
assert.equal(rendered.nodes.some(n => n.type === ui.originalChat), false);
assert.equal(ui.mounts.at(-1).kind, 'account');
assert.equal(rendered.nodes.some(n => n.type === 'iframe'), false);
for (const name of ['better-cherri:rooms-created', 'better-matrix:community', 'better-matrix:session']) assert.equal(ui.context.listeners.get(name)?.size, 1);
ui.setLoggedIn(true); ui.context.dispatchEvent(new Event('better-matrix:session'));
rendered = ui.render('chat');
assert.equal(rendered.nodes.some(n => n.type === ui.originalChat), true, 'Signed-in Matrix chat must render the original Cherri component.');
assert.equal(rendered.nodes.some(n => n.type === 'iframe'), false);
assert.equal(ui.mounts.at(-1).kind, 'community'); assert.equal(ui.cleanups.includes('account'), true);
const chatKey = rendered.nodes.find(n => n.type === ui.originalChat).key;
ui.context.dispatchEvent(new Event('better-matrix:community'));
rendered = ui.render('chat');
assert.equal(rendered.nodes.find(n => n.type === ui.originalChat).key, chatKey + 1, 'Changing configured rooms must remount the actual Cherri page.');
assert.equal(ui.cleanups.at(-1), 'community');
rendered = ui.render('members'); assert.equal(rendered.nodes.some(n => n.type === ui.originalMembers), true);
rendered = ui.render('login'); assert.equal(ui.mounts.at(-1).kind, 'account');
assert.equal(rendered.nodes.some(n => n.type === ui.originalChat || n.type === ui.originalMembers), false);
rendered = ui.render('home'); assert.equal(rendered.tree.type, ui.originalHome);
ui.setLoggedIn(false); ui.context.dispatchEvent(new Event('better-matrix:session')); rendered = ui.render('members');
assert.equal(ui.mounts.at(-1).kind, 'account'); assert.equal(rendered.nodes.some(n => n.type === ui.originalMembers), false);
ui.destroy();
for (const name of ['better-cherri:rooms-created', 'better-matrix:community', 'better-matrix:session']) assert.equal(ui.context.listeners.get(name)?.size, 0, 'Route cleanup must remove its event subscriptions.');

console.log('Matrix integration: full compiled bundle parses; patch idempotence, virtual session, credential separation, fetch/socket routing, original chat/member UI, and event remount/cleanup passed.');
