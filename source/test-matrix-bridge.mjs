import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const listeners = new Set(), calls = [];
let signedIn = true;
let communityRoom = '!first:example.org', idOffset = 0;
const me = {id: '@owner:example.org', username: 'owner', display: 'Owner', roles: [], badges: []};
const user = {id: '@member:example.org', username: 'member', display: 'Member', roles: [], badges: []};
const make = id => ({id, room: 'better-general', fromUserId: me.id, username: me.username, content: 'Message ' + id, sentAt: new Date(1700000000000 + id).toISOString(), editedAt: null, reactions: []});
const events = [];
const storage = new Map();
const sandbox = {
  console, URL, Response, Request, Headers, Event, btoa, atob, encodeURIComponent, decodeURIComponent, unescape, escape, setTimeout, clearTimeout,
  localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v)},
  dispatchEvent: event => events.push(event.type),
  __betterMatrix: {
    getSession: () => signedIn ? {userId: me.id, deviceId: 'TEST'} : null,
    getCommunity: () => ({rooms: {'better-general': communityRoom}}),
    me: async () => me,
    listChannels: async () => [{name: 'better-general', kind: 'text', categoryId: 1, canPost: true}],
    listMembers: async () => [me, user],
    getMessages: async (room, options) => {
      calls.push({kind: 'messages', room, options});
      if (options.before === 'page-2') return {messages: Array.from({length: 50}, (_, i) => make(51 + i)), before: 'page-3'};
      if (options.before === 'page-3') return {messages: Array.from({length: 50}, (_, i) => make(1 + i)), before: null};
      return {messages: Array.from({length: 50}, (_, i) => make(idOffset + 101 + i)), before: 'page-2'};
    },
    sendMessage: async (room, body) => {calls.push({kind: 'send', room, body}); return {...make(151), ...body};},
    edit: async (id, body) => ({...make(id), ...body, editedAt: new Date().toISOString()}),
    remove: async id => {calls.push({kind: 'remove', id});},
    react: async (id, emoji) => ({reactions: [{emoji, userIds: [me.id]}]}),
    typing: async room => {calls.push({kind: 'typing', room});},
    search: async options => {calls.push({kind: 'search', options}); return {results: [make(77)], nextCursor: null};},
    logout: async () => {signedIn = false;},
    subscribe: callback => {listeners.add(callback); return () => listeners.delete(callback);}
  }
};
vm.runInNewContext(await fs.readFile(new URL('./better-matrix-bridge.js', import.meta.url), 'utf8'), sandbox);
const req = async (path, init) => {
  const response = await sandbox.__betterMatrixRequest(path, init);
  return {status: response?.status, data: await response?.json()};
};
assert.equal(await sandbox.__betterMatrixRequest('/api/music/search?q=x'), null);
assert.equal(await sandbox.__betterMatrixRequest('https://lrclib.net/api/search?q=x'), null);
assert.equal((await req('/api/auth/me')).data.user.id, me.id);
const token = sandbox.__betterMatrixSessionToken();
assert.equal(JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub, me.id);
assert.equal(token.includes('TEST'), false);
assert.equal((await req('/api/me/permissions')).data.permissions, 0);
assert.equal((await req('/api/chat/channels')).data[0].name, 'better-general');
assert.deepEqual((await req('/api/members/brief?ids=' + encodeURIComponent(user.id))).data.users.map(u => u.id), [user.id]);
assert.equal((await req('/api/users/list?q=member&limit=1&page=1')).data.total, 1);
assert.equal((await req('/api/users/profile/owner')).data.id, me.id);
assert.equal((await req('/api/chat/channels/general/messages')).status, 404);
assert.equal(calls.length, 0);
let result = await req('/api/chat/channels/better-general/messages');
assert.deepEqual(result.data.map(m => m.id), Array.from({length: 50}, (_, i) => i + 101));
result = await req('/api/chat/channels/better-general/messages?before=101&limit=50');
assert.deepEqual(result.data.map(m => m.id), Array.from({length: 50}, (_, i) => i + 51));
assert.equal(calls.at(-1).options.before, 'page-2');
result = await req('/api/chat/channels/better-general/messages?before=20&limit=50');
assert.deepEqual(result.data.map(m => m.id), Array.from({length: 19}, (_, i) => i + 1));
assert.equal(calls.at(-1).options.before, 'page-3');
result = await req('/api/chat/channels/better-general/messages?after=145&limit=50');
assert.deepEqual(result.data.map(m => m.id), [146, 147, 148, 149, 150]);
result = await req('/api/chat/channels/better-general/messages', {method: 'POST', body: JSON.stringify({content: 'reply', replyToId: 145})});
assert.equal(result.status, 201); assert.equal(result.data.replyToId, 145);
const beforeUnsupported = calls.length;
assert.equal((await req('/api/chat/channels/better-general/messages', {method: 'POST', body: JSON.stringify({content: 'poll', poll: {q: 'x'}})})).status, 501);
assert.equal(calls.length, beforeUnsupported);
assert.equal((await req('/api/auth/login', {method: 'POST', body: '{}'})).status, 405);
assert.equal((await req('/api/mod/ban', {method: 'POST', body: '{}'})).status, 501);
assert.equal((await req('/api/saves')).status, 501);
assert.equal((await req('/api/chat/messages/151', {method: 'PATCH', body: JSON.stringify({content: 'edited'})})).data.content, 'edited');
assert.equal((await req('/api/chat/messages/151/react', {method: 'POST', body: JSON.stringify({emoji: '👍'})})).data.reactions[0].emoji, '👍');
await req('/api/blocks/add', {method: 'POST', body: JSON.stringify({userId: user.id})});
assert.equal((await req('/api/blocks')).data.blocked[0].user.id, user.id);
await req('/api/blocks/remove', {method: 'POST', body: JSON.stringify({userId: user.id})});
assert.equal((await req('/api/blocks')).data.blocked.length, 0);
const frames = [], notifyFrames = [];
let opens = 0;
const stream = sandbox.__betterMatrixStream('/api/chat/channels/better-general/stream?token=marker', {onOpen: () => opens++, onMessage: frame => frames.push(frame)});
const notify = sandbox.__betterMatrixStream('/api/notify/stream?token=marker', {onMessage: frame => notifyFrames.push(frame)});
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(opens, 1); assert.equal(stream.isOpen(), true);
const emit = event => {for (const listener of [...listeners]) listener(event);};
emit({type: 'message', room: 'better-general', message: make(152)});
emit({type: 'message', room: 'other', message: {...make(153), room: 'other'}});
emit({type: 'edit', room: 'better-general', message: {...make(152), content: 'new', editedAt: 'now'}});
emit({type: 'reaction', room: 'better-general', messageId: 152, reactions: [{emoji: 'x', userIds: [me.id]}]});
emit({type: 'delete', room: 'better-general', messageId: 152});
assert.deepEqual(frames.map(f => f.type || 'message'), ['message', 'edit', 'reaction', 'delete']);
assert.equal(notifyFrames.some(f => f.type === 'channel_activity' && f.room === 'better-general'), true);
stream.send('{"typing":true}'); await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(calls.at(-1).kind, 'typing');
stream.close(); assert.equal(stream.isOpen(), false);
const beforeClose = frames.length; emit({type: 'message', room: 'better-general', message: make(154)}); assert.equal(frames.length, beforeClose);
communityRoom = '!second:example.org'; idOffset = 1000;
const beforeSwitch = notifyFrames.length;
emit({type: 'message', room: 'better-general', message: make(155)});
assert.equal(notifyFrames.length, beforeSwitch);
result = await req('/api/chat/channels/better-general/messages?after=0&limit=50');
assert.deepEqual(result.data.map(m => m.id), Array.from({length: 50}, (_, i) => i + 1101));
notify.close();
await req('/api/auth/logout', {method: 'POST', body: '{}'});
assert.equal(sandbox.__betterMatrixSessionToken(), null);
assert.equal((await req('/api/chat/channels')).status, 401);
assert.deepEqual(events, ['cherri:me', 'cherri:session']);
signedIn = true;
sandbox.__betterMatrix.getMessages = async (room, options) => {
  if (options.before === 'sparse-2') return {messages: Array.from({length: 10}, (_, i) => make(i + 41)), before: 'sparse-3'};
  if (options.before === 'sparse-3') return {messages: Array.from({length: 40}, (_, i) => make(i + 1)), before: null, exhausted: true};
  return {messages: Array.from({length: 5}, (_, i) => make(i + 51)), before: 'sparse-2'};
};
vm.runInNewContext(await fs.readFile(new URL('./better-matrix-bridge.js', import.meta.url), 'utf8'), sandbox);
result = await req('/api/chat/channels/better-general/messages');
assert.equal(result.data.length, 50);
assert.deepEqual(result.data.map(m => m.id), Array.from({length: 50}, (_, i) => i + 6));
result = await req('/api/chat/channels/better-general/messages?before=6&limit=50');
assert.deepEqual(result.data.map(m => m.id), [1, 2, 3, 4, 5]);
const currentMessages = new Map();
sandbox.__betterMatrix.getCachedMessage = id => currentMessages.get(Number(id)) || null;
sandbox.__betterMatrix.getMessages = async (room, options) => {
  let rows, before;
  if (options.before === 'relation-2') {
    rows = Array.from({length: 45}, (_, i) => make(i + 6)); before = 'relation-3';
    currentMessages.set(51, {...make(51), content: 'Edit learned on a later raw page', reactions: [{emoji: '👍', userIds: [user.id]}]});
    currentMessages.delete(55);
  } else if (options.before === 'relation-3') {
    rows = Array.from({length: 5}, (_, i) => make(i + 1)); before = null;
  } else {
    rows = Array.from({length: 5}, (_, i) => make(i + 51)); before = 'relation-2';
  }
  for (const row of rows) currentMessages.set(row.id, row);
  return {messages: rows, before};
};
vm.runInNewContext(await fs.readFile(new URL('./better-matrix-bridge.js', import.meta.url), 'utf8'), sandbox);
result = await req('/api/chat/channels/better-general/messages');
assert.equal(result.data.length, 50, 'A later-page redaction must not prematurely exhaust a sparse Matrix page.');
assert.equal(result.data.some(m => m.id === 55), false);
assert.equal(result.data.find(m => m.id === 51).content, 'Edit learned on a later raw page');
assert.equal(result.data.find(m => m.id === 51).reactions[0].emoji, '👍');
console.log('Matrix Cherri bridge: schema, numeric pagination, chat mutations, member isolation, logical streams, and logout passed; no network calls.');
