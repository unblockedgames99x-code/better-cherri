import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('./better-matrix-client.js', import.meta.url), 'utf8');
const BASE = 'https://matrix.salix.host';
const API = '/_matrix/client/v3';
const NAMES = ['better-general', 'better-games', 'better-music'];
const json = (data, status = 200, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const normalized = data => JSON.parse(JSON.stringify(data));
const store = () => { const data = new Map(); return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };

function server() {
  const requests = [], rooms = new Map(), users = new Map([['alice', '@alice:salix.host'], ['bob', '@bob:salix.host']]);
  let roomNumber = 0, eventNumber = 0, failNext = null, syncHandler = null, aborted = 0;
  const userFor = headers => headers.get('Authorization')?.replace('Bearer token-', '@').replace(/$/, ':salix.host');
  const makeEvent = (room, type, sender, content, extra = {}) => ({ event_id: '$event' + (++eventNumber), room_id: room, origin_server_ts: 1760000000000 + eventNumber * 10, type, sender, content, ...extra });
  const privateState = room => [
    { type: 'm.room.join_rules', state_key: '', content: { join_rule: room.public ? 'public' : 'invite' } },
    { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'joined' } },
    { type: 'm.room.guest_access', state_key: '', content: { guest_access: 'forbidden' } },
    ...[...room.members].map(id => ({ type: 'm.room.member', state_key: id, content: { membership: 'join', displayname: id.split(':')[0].slice(1) } }))
  ];
  const fetch = async (input, init = {}) => {
    const url = new URL(input), path = decodeURIComponent(url.pathname.slice(API.length)), headers = new Headers(init.headers), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null, user = userFor(headers);
    requests.push({ url: url.href, path, query: url.searchParams, method, body, headers: Object.fromEntries(headers), signal: init.signal, credentials: init.credentials, redirect: init.redirect });
    assert.equal(url.origin, BASE, 'all requests use only the approved host');
    assert.equal(init.redirect, 'error', 'bearer tokens cannot follow redirects');
    assert.equal(init.credentials, 'omit');
    if (failNext) { const failure = failNext; failNext = null; return failure(); }
    if (path === '/login') { assert.equal(headers.get('Authorization'), null); return json({ user_id: users.get(body.identifier.user.replace(/^@/, '').split(':')[0]), device_id: 'D1', access_token: 'token-' + body.identifier.user.replace(/^@/, '').split(':')[0] }); }
    if (!user || ![...users.values()].includes(user)) return json({ errcode: 'M_UNKNOWN_TOKEN', error: 'Invalid token' }, 401);
    if (path === '/account/whoami') return json({ user_id: user, device_id: 'D1' });
    if (path === '/logout') return json({});
    if (path.startsWith('/profile/')) return json({ displayname: path.split('/').at(-1).split(':')[0].slice(1) });
    if (path === '/createRoom') {
      const id = '!room' + (++roomNumber) + ':salix.host';
      rooms.set(id, { id, creator: user, members: new Set([user]), invited: new Set(), events: [], state: body, public: false });
      return json({ room_id: id });
    }
    if (path === '/joined_rooms') return json({ joined_rooms: [...rooms.values()].filter(room => room.members.has(user)).map(room => room.id) });
    if (path.startsWith('/join/')) {
      const room = rooms.get(path.slice('/join/'.length));
      if (!room || (!room.members.has(user) && !room.invited.has(user))) return json({ errcode: 'M_FORBIDDEN', error: 'Invite required' }, 403);
      room.members.add(user); room.invited.delete(user); return json({ room_id: room.id });
    }
    if (path === '/sync') {
      if (syncHandler) return syncHandler({ url, init, user });
      return new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => { aborted++; reject(new DOMException('Aborted', 'AbortError')); }, { once: true }); });
    }
    if (path === '/search') {
      const selected = body.search_categories.room_events.filter.rooms;
      assert(selected.every(id => rooms.has(id)));
      return json({ search_categories: { room_events: { results: selected.flatMap(id => rooms.get(id).events.filter(event => event.content?.body?.includes(body.search_categories.room_events.search_term)).map(result => ({ result }))) } } });
    }
    const match = /^\/rooms\/([^/]+)\/(.+)$/.exec(path);
    if (!match) throw Error('Unexpected request: ' + method + ' ' + path);
    const room = rooms.get(match[1]), route = match[2];
    if (!room || !room.members.has(user)) return json({ errcode: 'M_FORBIDDEN', error: 'Not a member' }, 403);
    if (route === 'state') return json(privateState(room));
    if (route === 'joined_members') return json({ joined: Object.fromEntries([...room.members].map(id => [id, { display_name: id, displayname: id.split(':')[0].slice(1) }])) });
    if (route === 'invite') { if (user !== room.creator) return json({ errcode: 'M_FORBIDDEN', error: 'Owner only' }, 403); room.invited.add(body.user_id); return json({}); }
    if (route === 'messages') {
      const before = url.searchParams.get('from'), all = [...room.events].reverse(), limit = Number(url.searchParams.get('limit')) || 50, offset = before ? Number(before.replace('page-', '')) : 0;
      return json({ chunk: all.slice(offset, offset + limit), end: offset + limit < all.length ? 'page-' + (offset + limit) : null, state: [] });
    }
    if (route.startsWith('send/')) { const type = route.split('/')[1], event = makeEvent(room.id, type, user, body); room.events.push(event); return json({ event_id: event.event_id }); }
    if (route.startsWith('redact/')) { const target = route.split('/')[1], event = makeEvent(room.id, 'm.room.redaction', user, { redacts: target }, { redacts: target }); room.events.push(event); return json({ event_id: event.event_id }); }
    if (route.startsWith('typing/')) return json({});
    throw Error('Unexpected room route: ' + route);
  };
  return { fetch, requests, rooms, makeEvent, setFailure: fn => { failNext = fn; }, setSync: fn => { syncHandler = fn; }, get aborted() { return aborted; } };
}

function client(remote, storage = store(), config) {
  let uuid = 0;
  const events = [];
  const ctx = vm.createContext({ fetch: remote.fetch, localStorage: storage, Response, Request, Headers, URL, URLSearchParams, AbortController, DOMException, setTimeout, clearTimeout, console, crypto: { randomUUID: () => 'test-' + (++uuid) }, __BETTER_MATRIX_COMMUNITY__: config, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, dispatchEvent: event => events.push(event) });
  vm.runInContext(source, ctx, { filename: 'better-matrix-client.js' });
  return { api: ctx.__betterMatrix, storage, events };
}
const waitUntil = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('Timed out waiting for async mock'); };

const remote = server(), alice = client(remote);
assert.equal(alice.api.getSession(), null);
const priorHostStorage = store();
priorHostStorage.setItem('better_cherri_matrix_session_v1', JSON.stringify({ userId: '@alice:matrix.org', deviceId: 'D1', accessToken: 'old-matrix-org-token' }));
const priorHostClient = client(remote, priorHostStorage);
assert.equal(priorHostClient.api.getSession(), null, 'a previous provider session is not restored or sent to Salix');
assert.equal(remote.requests.length, 0);
await assert.rejects(alice.api.login('@alice:matrix.org', 'secret-password'), /salix.host account/);
assert.equal(remote.requests.length, 0, 'another homeserver account is not sent to Salix login');
await alice.api.login('@alice:salix.host', 'secret-password');
assert.deepEqual(normalized(alice.api.getSession()), { userId: '@alice:salix.host', deviceId: 'D1' });
assert.equal(JSON.stringify(alice.api.getSession()).includes('token-'), false);
assert.equal([...alice.storage.data.values()].join('').includes('secret-password'), false, 'passwords are never persisted');
assert.equal(alice.events.at(-1).type, 'better-matrix:session');
const community = await alice.api.createCommunity();
assert.equal(Object.keys(community.rooms).length, 3);
assert.equal(remote.requests.filter(item => item.path === '/createRoom').length, 3);
for (const room of remote.rooms.values()) {
  assert.equal(room.state.visibility, 'private'); assert.equal(room.state.preset, 'private_chat');
  const state = Object.fromEntries(room.state.initial_state.map(item => [item.type, item.content]));
  assert.equal(state['m.room.join_rules'].join_rule, 'invite');
  assert.equal(state['m.room.history_visibility'].history_visibility, 'joined');
  assert.equal(state['m.room.guest_access'].guest_access, 'forbidden');
  assert.equal(room.state.power_level_content_override.invite, 50);
  assert.equal(room.state.initial_state.some(item => item.type === 'm.room.encryption'), false, 'no false E2EE claim');
}
await alice.api.createCommunity();
assert.equal(remote.requests.filter(item => item.path === '/createRoom').length, 3, 'retrying setup does not duplicate existing rooms');
const createBefore = remote.requests.length;
assert.throws(() => alice.api.setCommunity({ ...community, homeserver: 'https://evil.example' }), /Salix hosted Matrix server/);
assert.equal(remote.requests.length, createBefore, 'invalid endpoint never receives tokens');
alice.api.setCommunity({ ...community, accessToken: 'secret-leak', password: 'bad', session: { token: 'secret' } });
assert.equal(alice.api.exportCommunity().includes('secret'), false, 'exports contain only public room configuration');
assert.equal(alice.api.exportCommunity().includes('token'), false);
assert.equal(alice.api.exportCommunity().includes('password'), false);
assert.deepEqual(normalized((await alice.api.listChannels()).map(item => item.name)), NAMES);

const general = remote.rooms.get(community.rooms['better-general']);
general.events.push(remote.makeEvent(general.id, 'm.room.message', '@alice:salix.host', { msgtype: 'm.text', body: 'Saved first message' }));
general.events.push(remote.makeEvent(general.id, 'm.room.message', '@bob:salix.host', { msgtype: 'm.text', body: 'Second message' }));
const firstPage = await alice.api.getMessages('better-general', { limit: 1 });
assert.equal(firstPage.messages.length, 1); assert.equal(firstPage.messages[0].content, 'Second message');
assert.equal(typeof firstPage.messages[0].id, 'number'); assert.equal(firstPage.before, 'page-1');
const olderPage = await alice.api.getMessages('better-general', { limit: 1, before: firstPage.before });
assert.equal(olderPage.messages[0].content, 'Saved first message');
assert(olderPage.messages[0].id < firstPage.messages[0].id, 'IDs support original Cherri chronological comparisons');
const restored = client(remote, alice.storage);
assert.equal((await restored.api.restore()).userId, '@alice:salix.host');
const restoredMessages = await restored.api.getMessages('better-general');
assert.equal(restoredMessages.messages.length, 2, 'saved history reloads from the host');
assert.equal(restoredMessages.messages[0].id, olderPage.messages[0].id, 'server event IDs map consistently after reload');

const verifiedStorage = store();
verifiedStorage.setItem('better_cherri_matrix_session_v1', JSON.stringify({ userId: '@alice:salix.host', deviceId: 'D1', accessToken: 'token-alice' }));
const needsVerification = client(remote, verifiedStorage);
const whoamiBefore = remote.requests.filter(item => item.path === '/account/whoami').length;
const checkedUsers = await Promise.all([needsVerification.api.me(), needsVerification.api.me()]);
assert(checkedUsers.every(user => user.id === '@alice:salix.host'));
assert.equal(remote.requests.filter(item => item.path === '/account/whoami').length - whoamiBefore, 1, 'concurrent restored account reads share one server identity verification');
await needsVerification.api.me();
assert.equal(remote.requests.filter(item => item.path === '/account/whoami').length - whoamiBefore, 1, 'verified sessions do not repeatedly verify whoami');
const wrongStorage = store();
wrongStorage.setItem('better_cherri_matrix_session_v1', JSON.stringify({ userId: '@bob:salix.host', deviceId: 'D1', accessToken: 'token-alice' }));
const wrongIdentity = client(remote, wrongStorage);
const beforeWrongIdentity = remote.requests.length;
await assert.rejects(wrongIdentity.api.me(), error => error.code === 'M_UNKNOWN_TOKEN' && /does not match/.test(error.message));
assert.equal(wrongIdentity.api.getSession(), null, 'a public profile cannot validate a mismatched stored user ID');
assert.equal(wrongStorage.getItem('better_cherri_matrix_session_v1'), null);
assert.equal(remote.requests.slice(beforeWrongIdentity).some(item => item.path.startsWith('/profile/')), false, 'mismatched identity is rejected before loading any public profile');
const expiredStorage = store();
expiredStorage.setItem('better_cherri_matrix_session_v1', JSON.stringify({ userId: '@alice:salix.host', deviceId: 'D1', accessToken: 'expired' }));
const expiredIdentity = client(remote, expiredStorage);
await assert.rejects(expiredIdentity.api.me(), error => error.code === 'M_UNKNOWN_TOKEN');
assert.equal(expiredIdentity.api.getSession(), null);
assert.equal(expiredStorage.getItem('better_cherri_matrix_session_v1'), null, 'expired restored tokens are cleared');

// Deliberately find two event IDs sharing the original 1,000-value hash
// suffix. They must remain separate list keys and separate mutation targets.
const hashSuffix = value => { let hash = 2166136261; for (const c of value) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619); return (hash >>> 0) % 1000; };
const buckets = new Map(); let collision;
for (let i = 0; i < 10000; i++) { const id = '$collision-' + i, hash = hashSuffix(id); if (buckets.has(hash)) { collision = [buckets.get(hash), id]; break; } buckets.set(hash, id); }
assert(collision);
const games = remote.rooms.get(community.rooms['better-games']);
for (const [index, event_id] of collision.entries()) games.events.push({ event_id, room_id: games.id, origin_server_ts: 1760000019999, type: 'm.room.message', sender: '@alice:salix.host', content: { msgtype: 'm.text', body: 'Collision ' + index } });
const collisionPage = await alice.api.getMessages('better-games');
assert.equal(collisionPage.messages.length, 2);
assert.notEqual(collisionPage.messages[0].id, collisionPage.messages[1].id, 'colliding hashes reserve different numeric IDs');
assert.equal(Math.floor(collisionPage.messages[0].id / 1000), Math.floor(collisionPage.messages[1].id / 1000), 'collision probing stays inside the timestamp bucket');
const collisionIds = Object.fromEntries(collisionPage.messages.map(message => [message.eventId, message.id]));
games.events.reverse();
const afterReloadCollision = client(remote, alice.storage);
const collisionReload = await afterReloadCollision.api.getMessages('better-games');
for (const message of collisionReload.messages) assert.equal(message.id, collisionIds[message.eventId], 'persisted aliases survive reversed event order after reload');
await alice.api.edit(collisionPage.messages[0].id, 'Changed collision only');
assert.equal(games.events.at(-1).content['m.relates_to'].event_id, collisionPage.messages[0].eventId);
await alice.api.react(collisionPage.messages[1].id, '✅');
assert.equal(games.events.at(-1).content['m.relates_to'].event_id, collisionPage.messages[1].eventId);
assert.equal(alice.api.getCachedMessage(collisionPage.messages[0].id).reactions.length, 0);

const writesBefore = remote.requests.length;
await assert.rejects(alice.api.edit(firstPage.messages[0].id, { content: 'impersonate' }), error => error.code === 'M_FORBIDDEN');
assert.equal(remote.requests.length, writesBefore, 'editing another sender does not produce a write');
const sent = await alice.api.send('better-general', { content: 'Persistent reply', replyToId: olderPage.messages[0].id, fromUserId: '@evil:salix.host' });
assert.equal(sent.fromUserId, '@alice:salix.host', 'message identity comes from the authenticated session');
assert.equal(sent.replyToId, olderPage.messages[0].id);
assert.equal(general.events.at(-1).sender, '@alice:salix.host');
assert.equal(general.events.at(-1).content['m.relates_to']['m.in_reply_to'].event_id, olderPage.messages[0].eventId);
await alice.api.edit(sent.id, { content: 'Edited reply' });
assert.equal(alice.api.getCachedMessage(sent.id).content, 'Edited reply');
assert(alice.api.getCachedMessage(sent.id).editedAt);
const reaction = await alice.api.react(sent.id, '🍒');
assert.deepEqual(normalized(reaction.reactions), [{ emoji: '🍒', userIds: ['@alice:salix.host'] }]);
assert.deepEqual(normalized((await alice.api.react(sent.id, '🍒')).reactions), [], 'repeat reaction toggles off by redaction');
await alice.api.remove(sent.id);
assert.equal(alice.api.getCachedMessage(sent.id), null);
await assert.rejects(alice.api.remove(123), error => error.code === 'BETTER_MESSAGE_UNKNOWN');
await assert.rejects(alice.api.getMessages('general'), error => error.code === 'BETTER_ROOM_NOT_CONFIGURED');

const bob = client(remote);
await bob.api.login('bob', 'bob-password'); bob.api.setCommunity(community);
assert.deepEqual(normalized(await bob.api.listChannels()), [], 'uninvited accounts have no channel access');
await assert.rejects(bob.api.getMessages('better-general'), error => error.code === 'M_FORBIDDEN');
assert((await bob.api.joinCommunity()).every(item => !item.joined), 'room IDs do not grant membership');
const invites = await alice.api.invite('@bob:salix.host');
assert(invites.every(item => item.invited));
assert((await bob.api.joinCommunity()).every(item => item.joined), 'only accepted invitations join private rooms');
assert.deepEqual(normalized((await bob.api.listMembers()).map(member => member.id)), ['@alice:salix.host', '@bob:salix.host']);
assert((await alice.api.invite('@federated:example.org')).every(item => item.invited), 'federated Matrix accounts may be invited without a Salix suffix restriction');
for (const name of NAMES) assert(remote.rooms.get(community.rooms[name]).invited.has('@federated:example.org'));
// A different joined Matrix room is never listed or queried for members/history.
remote.rooms.set('!outside:salix.host', { id: '!outside:salix.host', creator: '@alice:salix.host', members: new Set(['@alice:salix.host', '@outside:salix.host']), invited: new Set(), events: [], state: {}, public: false });
assert.equal((await alice.api.listMembers()).some(member => member.id === '@outside:salix.host'), false);
assert.equal(remote.requests.some(item => item.path.startsWith('/rooms/!outside:salix.host/')), false);

remote.setFailure(() => json({ errcode: 'M_LIMIT_EXCEEDED', error: 'Slow down', retry_after_ms: 2300 }, 429, { 'Retry-After': '3' }));
const before429 = remote.requests.length;
await assert.rejects(alice.api.send('better-general', 'Do not repeat'), error => error.status === 429 && error.retryAfterMs === 3000 && /3 seconds/.test(error.message));
assert.equal(remote.requests.length - before429, 1, 'mutating requests are never automatically retried on rate limits');
remote.setFailure(() => { throw TypeError('Network failed'); });
const beforeFailure = remote.requests.length;
await assert.rejects(alice.api.send('better-general', 'Network write'), error => error.code === 'BETTER_MATRIX_NETWORK');
assert.equal(remote.requests.length - beforeFailure, 1, 'ambiguous failed writes are not retried');

const syncMessages = [], syncEvent = remote.makeEvent(general.id, 'm.room.message', '@bob:salix.host', { msgtype: 'm.text', body: 'Live event' });
let syncCalls = 0;
remote.setSync(({ url, init }) => {
  const filter = JSON.parse(url.searchParams.get('filter'));
  assert.deepEqual(filter.room.rooms, Object.values(community.rooms));
  if (++syncCalls === 1) return json({ next_batch: 'batch-1', rooms: { join: { [general.id]: { timeline: { events: [syncEvent] } }, '!outside:salix.host': { timeline: { events: [{ ...syncEvent, room_id: '!outside:salix.host', content: { msgtype: 'm.text', body: 'Never visible' } }] } } } } });
  return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { reject(new DOMException('Aborted', 'AbortError')); }, { once: true }));
});
const unsubscribe = alice.api.subscribe(event => syncMessages.push(event));
await waitUntil(() => syncCalls >= 2);
assert(syncMessages.some(event => event.type === 'message' && event.message.content === 'Live event'));
assert.equal(syncMessages.some(event => event.type === 'message' && event.message.content === 'Never visible'), false);
const pending = remote.requests.at(-1).signal;
unsubscribe(); assert.equal(pending.aborted, true, 'unsubscribing cancels the long poll');
const countAfter = remote.requests.length;
await new Promise(resolve => setTimeout(resolve, 150));
assert.equal(remote.requests.length, countAfter, 'cancelled sync does not restart');

const untrusted = client(remote, alice.storage); untrusted.api.setCommunity(community);
general.public = true;
await assert.rejects(untrusted.api.getMessages('better-general'), error => error.code === 'BETTER_ROOM_NOT_PRIVATE');
general.public = false;
remote.setFailure(() => json({ errcode: 'M_UNKNOWN_TOKEN', error: 'Expired' }, 401));
await assert.rejects(untrusted.api.whoami(), error => error.code === 'M_UNKNOWN_TOKEN');
assert.equal(untrusted.api.getSession(), null);
assert.equal(untrusted.events.at(-1).type, 'better-matrix:session');
assert.equal(untrusted.events.at(-1).detail, null);
let releaseLogout;
remote.setFailure(() => new Promise(resolve => { releaseLogout = () => resolve(json({})); }));
const logoutBefore = remote.requests.filter(item => item.path === '/logout').length;
const logoutPromise = bob.api.logout();
assert.equal(bob.api.getSession(), null);
assert.equal(bob.storage.getItem('better_cherri_matrix_session_v1'), null);
assert.equal(bob.events.at(-1).detail, null, 'logout immediately notifies the UI while network revocation is pending');
const pendingLogoutRequest = remote.requests.at(-1);
assert.equal(pendingLogoutRequest.path, '/logout');
assert.equal(pendingLogoutRequest.headers.authorization, 'Bearer token-bob', 'revocation captures the old Authorization header before clearing it');
releaseLogout(); await logoutPromise;
assert.equal(remote.requests.filter(item => item.path === '/logout').length - logoutBefore, 1, 'logout sends exactly one revocation request');
assert(bob.api.getCommunity(), 'signing out keeps only the public community configuration');
const deniedStorage = { getItem() { throw Error('Storage denied'); }, setItem() { throw Error('Storage denied'); }, removeItem() { throw Error('Storage denied'); } };
const memoryOnly = client(remote, deniedStorage);
await memoryOnly.api.login('alice', 'memory-password'); memoryOnly.api.setCommunity(community);
assert.equal(memoryOnly.api.getSession().userId, '@alice:salix.host', 'about:blank storage denial falls back to an in-memory session');
assert.equal((await memoryOnly.api.getMessages('better-general')).messages.length > 0, true);
console.log('Matrix client tests passed: private room creation/invites, persistent history, scoped members, authenticated edits/replies/reactions, token isolation, rate limits and sync cancellation. All server requests were mocked.');
