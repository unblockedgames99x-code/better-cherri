/* Better Cherri's browser-only Matrix transport. No Matrix password or access
   token is included in community exports. Rooms are invite-only and retain
   history on Matrix; this client does not enable end-to-end encryption. */
(() => {
  'use strict';
  const BASE = 'https://matrix.salix.host';
  const PREFIX = '/_matrix/client/v3';
  const SESSION_KEY = 'better_cherri_matrix_session_v1';
  const COMMUNITY_KEY = 'better_cherri_matrix_community_v1';
  const IDS_KEY = 'better_cherri_matrix_event_ids_v1';
  const ROOM_NAMES = Object.freeze(['better-general', 'better-games', 'better-music']);
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const listeners = new Set();
  const roomCache = new Map();
  const numericEvents = new Map();
  const savedIds = new Map();
  const reservedIds = new Map();
  const profiles = new Map();
  let session = null, community = null, syncRun = null, syncSince = '', creation = null, verifiedSession = null, verificationPromise = null;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  function storageGet(key) { try { return JSON.parse(globalThis.localStorage.getItem(key) || 'null'); } catch { return null; } }
  function storageSet(key, value) { try { value == null ? globalThis.localStorage.removeItem(key) : globalThis.localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function matrixError(message, code = 'BETTER_MATRIX_ERROR', status = 400, retryAfterMs = 0) {
    const error = new Error(message);
    Object.assign(error, { code, status, retryAfterMs });
    return error;
  }
  const validRoom = value => typeof value === 'string' && /^![^\s/\\?#]{1,500}:[^\s/\\?#]{1,250}$/.test(value);
  const validUser = value => typeof value === 'string' && /^@[^\s:]{1,255}:[a-zA-Z0-9.-]+(?::\d+)?$/.test(value);
  const safeSession = () => session ? { userId: session.userId, deviceId: session.deviceId } : null;
  function emit(value) {
    for (const listener of [...listeners]) { try { listener(clone(value)); } catch {} }
    if (value.type === 'session') {
      try { globalThis.dispatchEvent(new CustomEvent('better-matrix:session', { detail: clone(value.session) })); } catch {}
    }
  }
  function normalizeCommunity(value, partial = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw matrixError('Paste a Better Cherri community configuration.');
    if (value.provider && value.provider !== 'matrix') throw matrixError('This configuration is not a Matrix community.');
    if (value.homeserver && value.homeserver !== BASE) throw matrixError('This build uses the Salix hosted Matrix server.');
    const rooms = {};
    for (const name of ROOM_NAMES) {
      if (value.rooms?.[name] == null && partial) continue;
      if (!validRoom(value.rooms?.[name])) throw matrixError('A valid private Matrix room ID is required for ' + name + '.');
      rooms[name] = value.rooms[name];
    }
    if (new Set(Object.values(rooms)).size !== Object.keys(rooms).length) throw matrixError('Each Better Cherri channel must use a different Matrix room.');
    // Deliberately copy only public fields: never spread an imported session.
    return { version: 1, provider: 'matrix', homeserver: BASE, name: 'Better Cherri', rooms };
  }
  function resetCaches() { roomCache.clear(); numericEvents.clear(); profiles.clear(); syncSince = ''; }
  function setCommunity(value) {
    const next = normalizeCommunity(typeof value === 'string' ? JSON.parse(value) : value);
    stopSync(); resetCaches(); community = next; storageSet(COMMUNITY_KEY, community);
    emit({ type: 'community', community: getCommunity() }); startSync();
    return getCommunity();
  }
  function getCommunity() { return community ? normalizeCommunity(community, true) : null; }
  function requireSession() { if (!session) throw matrixError('Sign in with a Matrix account to connect Better Cherri chat.', 'M_MISSING_TOKEN', 401); }
  function roomId(name) {
    if (!ROOM_NAMES.includes(name) || !validRoom(community?.rooms?.[name])) throw matrixError('This channel is not configured for Better Cherri.', 'BETTER_ROOM_NOT_CONFIGURED', 404);
    return community.rooms[name];
  }
  const nameOf = id => ROOM_NAMES.find(name => community?.rooms?.[name] === id);
  const enc = value => encodeURIComponent(String(value));
  function cache(name) {
    roomId(name);
    if (!roomCache.has(name)) roomCache.set(name, { events: new Map(), ids: new Map(), checkedAt: 0, private: false, members: new Map() });
    return roomCache.get(name);
  }
  function allowed(method, path) {
    if (method === 'GET' && /^\/(?:login|account\/whoami|joined_rooms|sync)$/.test(path)) return true;
    if (method === 'POST' && /^\/(?:login|logout|createRoom|search)$/.test(path)) return true;
    if (method === 'POST' && /^\/join\/[^/]+$/.test(path)) return true;
    if (method === 'GET' && /^\/profile\/[^/]+$/.test(path)) return true;
    if (method === 'GET' && /^\/rooms\/[^/]+\/(?:state|messages|joined_members|event\/[^/]+)$/.test(path)) return true;
    if (method === 'POST' && /^\/rooms\/[^/]+\/invite$/.test(path)) return true;
    if (method === 'PUT' && /^\/rooms\/[^/]+\/(?:send\/(?:m\.room\.message|m\.reaction)\/[^/]+|redact\/[^/]+\/[^/]+|typing\/[^/]+)$/.test(path)) return true;
    return false;
  }
  async function request(method, path, body, { auth = true, query, signal } = {}) {
    if (!allowed(method, path) || /[?#\\]/.test(path)) throw matrixError('Unsupported Matrix operation.', 'BETTER_OPERATION_NOT_ALLOWED');
    if (auth) requireSession();
    const requestSession = auth ? session : null;
    const url = new URL(BASE + PREFIX + path);
    if (query) for (const [key, value] of Object.entries(query)) if (value != null && value !== '') url.searchParams.set(key, String(value));
    if (url.origin !== BASE || !url.pathname.startsWith(PREFIX + '/')) throw matrixError('Invalid Matrix endpoint.');
    const headers = { Accept: 'application/json' };
    if (auth) headers.Authorization = 'Bearer ' + requestSession.accessToken;
    if (body != null) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await nativeFetch(url.href, { method, headers, ...(body != null ? { body: JSON.stringify(body) } : {}), signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      throw matrixError('Could not reach Matrix. Check your connection, then try again. The action was not automatically retried.', 'BETTER_MATRIX_NETWORK', 503);
    }
    let result;
    try { result = await response.json(); } catch { throw matrixError('Matrix returned an unreadable response.', 'BETTER_MATRIX_RESPONSE', response.status); }
    if (!response.ok) {
      let retryAfterMs = Number(result?.retry_after_ms) || 0;
      const retry = response.headers.get('Retry-After');
      if (retry) { const seconds = Number(retry); retryAfterMs = Math.max(retryAfterMs, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now()); }
      const code = result?.errcode || 'BETTER_MATRIX_ERROR';
      const message = response.status === 429 ? 'Matrix is rate limiting this account. Try again in ' + Math.max(1, Math.ceil(retryAfterMs / 1000)) + ' seconds.' : result?.error || 'Matrix rejected the request.';
      const error = matrixError(message, code, response.status, Math.max(0, retryAfterMs));
      if (auth && session === requestSession && (response.status === 401 || code === 'M_UNKNOWN_TOKEN')) { session = null; verifiedSession = null; verificationPromise = null; storageSet(SESSION_KEY, null); stopSync(); emit({ type: 'session', session: null }); }
      throw error;
    }
    return result;
  }
  function userShape(id, value = {}) {
    const username = id?.startsWith('@') ? id.slice(1) : String(id || '');
    return { id, username, display: value.displayname || value.display_name || value.display || username, pfp: '', avatarUrl: '', bio: '', badges: [], roles: [], isAdmin: false, isMod: false, isOwner: false, allowMessages: false, activity: null };
  }
  function learnProfile(id, value) { if (validUser(id)) profiles.set(id, { ...(profiles.get(id) || {}), ...value }); }
  async function ensureVerified() {
    requireSession();
    if (verifiedSession === session) return safeSession();
    if (!verificationPromise || verificationPromise.session !== session) {
      const check = { session, promise: null };
      verificationPromise = check;
      check.promise = whoami().finally(() => { if (verificationPromise === check) verificationPromise = null; });
    }
    return verificationPromise.promise;
  }
  async function me() {
    await ensureVerified();
    requireSession();
    const currentUser = session.userId;
    if (!profiles.has(currentUser)) {
      try { learnProfile(currentUser, await request('GET', '/profile/' + enc(currentUser))); } catch (error) { if (error.status === 401) throw error; }
    }
    if (session?.userId !== currentUser) throw matrixError('The Matrix session changed while loading your account.', 'M_UNKNOWN_TOKEN', 401);
    return userShape(currentUser, profiles.get(currentUser));
  }
  async function whoami() {
    requireSession();
    const checkedSession = session;
    const result = await request('GET', '/account/whoami');
    if (session !== checkedSession) throw matrixError('The Matrix session changed while it was being verified.', 'M_UNKNOWN_TOKEN', 401);
    if (result.user_id !== checkedSession.userId) { session = null; verifiedSession = null; verificationPromise = null; storageSet(SESSION_KEY, null); stopSync(); emit({ type: 'session', session: null }); throw matrixError('The saved Matrix session does not match this account.', 'M_UNKNOWN_TOKEN', 401); }
    verifiedSession = checkedSession;
    return safeSession();
  }
  async function restore() {
    if (!session) return null;
    await ensureVerified(); startSync(); return safeSession();
  }
  async function login(username, password) {
    const user = String(username || '').trim();
    if (!user || !password) throw matrixError('Enter your Matrix username and password.');
    if (user.startsWith('@') && (!validUser(user) || !user.endsWith(':salix.host'))) throw matrixError('Use a salix.host account with this hosted option.');
    const result = await request('POST', '/login', { type: 'm.login.password', identifier: { type: 'm.id.user', user }, password: String(password), initial_device_display_name: 'Better Cherri' }, { auth: false });
    if (!validUser(result.user_id) || !result.user_id.endsWith(':salix.host') || typeof result.access_token !== 'string' || !result.access_token) throw matrixError('Salix did not return a usable session.');
    stopSync(); resetCaches();
    session = { userId: result.user_id, deviceId: String(result.device_id || ''), accessToken: result.access_token };
    verifiedSession = session; verificationPromise = null;
    storageSet(SESSION_KEY, session); emit({ type: 'session', session: safeSession() }); startSync();
    return safeSession();
  }
  async function logout() {
    stopSync();
    // request() captures the current Authorization header before its first
    // await. Clear the local session immediately while revocation runs once.
    const pending = session ? request('POST', '/logout', {}) : Promise.resolve();
    session = null; verifiedSession = null; verificationPromise = null;
    storageSet(SESSION_KEY, null); resetCaches(); emit({ type: 'session', session: null });
    await pending;
  }
  async function verifyRoom(name, force = false) {
    const data = cache(name);
    if (!force && data.private && Date.now() - data.checkedAt < 15000) return data;
    const state = await request('GET', '/rooms/' + enc(roomId(name)) + '/state');
    if (!Array.isArray(state)) throw matrixError('Matrix returned invalid room state.');
    const content = type => state.find(event => event.type === type && event.state_key === '')?.content;
    data.private = content('m.room.join_rules')?.join_rule === 'invite' && content('m.room.history_visibility')?.history_visibility === 'joined' && content('m.room.guest_access')?.guest_access === 'forbidden';
    data.checkedAt = Date.now();
    if (!data.private) throw matrixError('This room is not configured as an invite-only Better Cherri room. Ask its owner to restore the private room settings.', 'BETTER_ROOM_NOT_PRIVATE', 403);
    if (content('m.room.encryption')) throw matrixError('This room uses end-to-end encryption, which this Better Cherri adapter cannot decrypt.', 'BETTER_ENCRYPTION_UNSUPPORTED', 409);
    const membership = state.find(event => event.type === 'm.room.member' && event.state_key === session?.userId)?.content?.membership;
    if (membership && membership !== 'join') throw matrixError('Accept your invitation to this Better Cherri room first.', 'M_FORBIDDEN', 403);
    for (const event of state) if (event.type === 'm.room.member' && event.content?.membership === 'join') { learnProfile(event.state_key, event.content); data.members.set(event.state_key, event.content); }
    return data;
  }
  async function createCommunity() {
    requireSession();
    if (creation) return creation;
    creation = (async () => {
      if (!community) community = normalizeCommunity({ rooms: {} }, true);
      for (const name of ROOM_NAMES) {
        if (community.rooms[name]) continue;
        const result = await request('POST', '/createRoom', {
          visibility: 'private', preset: 'private_chat', name: 'Better Cherri · ' + name.replace('better-', ''), topic: 'Private Better Cherri ' + name.replace('better-', '') + ' room',
          initial_state: [
            { type: 'm.room.join_rules', state_key: '', content: { join_rule: 'invite' } },
            { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'joined' } },
            { type: 'm.room.guest_access', state_key: '', content: { guest_access: 'forbidden' } }
          ],
          power_level_content_override: { users_default: 0, events_default: 0, state_default: 50, invite: 50, kick: 50, ban: 50, redact: 50, events: { 'm.room.power_levels': 100, 'm.room.join_rules': 100, 'm.room.history_visibility': 100, 'm.room.guest_access': 100, 'm.room.encryption': 100 } }
        });
        if (!validRoom(result.room_id)) throw matrixError('Matrix did not return a room ID.');
        community.rooms[name] = result.room_id;
        storageSet(COMMUNITY_KEY, getCommunity());
        emit({ type: 'community', community: getCommunity() });
      }
      startSync(); return getCommunity();
    })();
    try { return await creation; } finally { creation = null; }
  }
  async function joinCommunity() {
    requireSession();
    const joined = new Set((await request('GET', '/joined_rooms')).joined_rooms || []), result = [];
    for (const name of ROOM_NAMES) {
      const id = roomId(name);
      try { if (!joined.has(id)) await request('POST', '/join/' + enc(id), {}); await verifyRoom(name, true); result.push({ name, joined: true }); }
      catch (error) { result.push({ name, joined: false, error: error.message, code: error.code }); }
    }
    emit({ type: 'membership', results: result }); startSync(); return result;
  }
  async function listChannels() {
    requireSession();
    if (!community) return [];
    const joined = new Set((await request('GET', '/joined_rooms')).joined_rooms || []), channels = [];
    for (let position = 0; position < ROOM_NAMES.length; position++) {
      const name = ROOM_NAMES[position];
      if (!community.rooms[name] || !joined.has(roomId(name))) continue;
      await verifyRoom(name);
      channels.push({ name, kind: 'text', position, categoryId: 1, locked: false, canPost: true, allowMedia: false, allowAnyLink: true, trustedOnly: false, slowmode: 0, wordFilter: false, postRoleIds: [], viewRoleIds: [] });
    }
    return channels;
  }
  async function listMembers() {
    const members = new Map();
    for (const channel of await listChannels()) {
      const result = await request('GET', '/rooms/' + enc(roomId(channel.name)) + '/joined_members');
      const current = cache(channel.name); current.members.clear();
      for (const [id, profile] of Object.entries(result.joined || {})) if (validUser(id)) { learnProfile(id, profile); current.members.set(id, profile); members.set(id, userShape(id, profiles.get(id))); }
    }
    return [...members.values()].sort((a, b) => a.display.localeCompare(b.display));
  }
  async function invite(userId) {
    if (!validUser(userId)) throw matrixError('Enter a full Matrix ID, such as @yourfriend:salix.host.');
    const result = [];
    for (const name of ROOM_NAMES) {
      try { await verifyRoom(name); await request('POST', '/rooms/' + enc(roomId(name)) + '/invite', { user_id: userId }); result.push({ name, invited: true }); }
      catch (error) { result.push({ name, invited: false, error: error.message, code: error.code }); }
    }
    return result;
  }
  function numericId(name, event) {
    const data = cache(name);
    if (data.ids.has(event.event_id)) return data.ids.get(event.event_id);
    let hash = 2166136261;
    for (const c of String(event.event_id)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    const key = roomId(name) + '\n' + event.event_id;
    const saved = savedIds.get(key);
    const time = Number(event.origin_server_ts) || 0;
    const bucket = Math.max(1, Math.min(8000000000000, Math.floor(time))) * 1000;
    const available = id => (!reservedIds.has(id) || reservedIds.get(id) === key) && (!numericEvents.has(id) || (numericEvents.get(id).eventId === event.event_id && numericEvents.get(id).room === name));
    let id = saved && available(saved) ? saved : null;
    // Cherri uses numeric IDs for list keys and history cursors. Different
    // Matrix event IDs may share a hash suffix, so reserve an unused suffix
    // rather than letting React silently drop one of the messages.
    if (id == null) for (let offset = 0; offset < 1000; offset++) { const candidate = bucket + (((hash >>> 0) + offset) % 1000); if (available(candidate)) { id = candidate; break; } }
    if (id == null) throw matrixError('Too many messages share one Matrix timestamp to display safely. Refresh after loading an earlier history page.', 'BETTER_NUMERIC_ID_CAPACITY', 409);
    data.ids.set(event.event_id, id); numericEvents.set(id, { room: name, eventId: event.event_id });
    savedIds.set(key, id);
    reservedIds.set(id, key);
    return id;
  }
  function persistIds() {
    // Event IDs and their numeric aliases are public room metadata, with no
    // messages, passwords or account tokens. Keep aliases across page reloads.
    storageSet(IDS_KEY, [...savedIds]);
  }
  function rememberEvents(name, events) {
    const data = cache(name);
    for (const event of events || []) {
      if (!event || typeof event !== 'object' || typeof event.event_id !== 'string') continue;
      if (event.room_id && event.room_id !== roomId(name)) continue;
      data.events.set(event.event_id, clone(event));
      if (event.type === 'm.room.message' && event.content?.['m.relates_to']?.rel_type !== 'm.replace') numericId(name, event);
      if (event.type === 'm.room.member' && validUser(event.state_key)) { learnProfile(event.state_key, event.content); event.content?.membership === 'join' ? data.members.set(event.state_key, event.content) : data.members.delete(event.state_key); }
    }
    persistIds();
  }
  function redactedIds(data) {
    const redacted = new Set();
    for (const event of data.events.values()) {
      if (event.unsigned?.redacted_because) redacted.add(event.event_id);
      if (event.type === 'm.room.redaction') { const target = event.redacts || event.content?.redacts; if (target) redacted.add(target); }
    }
    return redacted;
  }
  function mapMessage(name, event, redacted = redactedIds(cache(name))) {
    const data = cache(name);
    if (!event || event.type !== 'm.room.message' || Object.prototype.hasOwnProperty.call(event, 'state_key') || event.content?.['m.relates_to']?.rel_type === 'm.replace' || redacted.has(event.event_id)) return null;
    if (!['m.text', 'm.notice', 'm.emote'].includes(event.content?.msgtype) || typeof event.content.body !== 'string') return null;
    let content = event.content.body, editedAt = null;
    const bundledEdit = event.unsigned?.['m.relations']?.['m.replace'];
    const edits = [...data.events.values()].filter(candidate => candidate.type === 'm.room.message' && !Object.prototype.hasOwnProperty.call(candidate, 'state_key') && candidate.sender === event.sender && candidate.content?.['m.relates_to']?.rel_type === 'm.replace' && candidate.content['m.relates_to'].event_id === event.event_id && !redacted.has(candidate.event_id));
    if (bundledEdit && bundledEdit.sender === event.sender && !redacted.has(bundledEdit.event_id)) edits.push(bundledEdit);
    edits.sort((a, b) => (a.origin_server_ts || 0) - (b.origin_server_ts || 0) || String(a.event_id).localeCompare(String(b.event_id)));
    const edit = edits.at(-1);
    if (typeof edit?.content?.['m.new_content']?.body === 'string') { content = edit.content['m.new_content'].body; editedAt = new Date(edit.origin_server_ts || event.origin_server_ts).toISOString(); }
    const reactionUsers = new Map();
    for (const candidate of data.events.values()) {
      const relation = candidate.content?.['m.relates_to'];
      if (candidate.type !== 'm.reaction' || relation?.rel_type !== 'm.annotation' || relation.event_id !== event.event_id || typeof relation.key !== 'string' || redacted.has(candidate.event_id)) continue;
      if (!reactionUsers.has(relation.key)) reactionUsers.set(relation.key, new Set());
      reactionUsers.get(relation.key).add(candidate.sender);
    }
    const replyEvent = data.events.get(event.content?.['m.relates_to']?.['m.in_reply_to']?.event_id);
    const replyProfile = replyEvent && userShape(replyEvent.sender, profiles.get(replyEvent.sender));
    const from = userShape(event.sender, profiles.get(event.sender));
    return { id: numericId(name, event), eventId: event.event_id, room: name, fromUserId: event.sender, username: from.username, display: from.display, avatarUrl: '', badges: '[]', content, sentAt: new Date(Number(event.origin_server_ts) || 0).toISOString(), editedAt, replyToId: replyEvent ? numericId(name, replyEvent) : null, replyUsername: replyProfile?.username || null, replyContent: replyEvent?.content?.body || null, reactions: [...reactionUsers].map(([emoji, users]) => ({ emoji, userIds: [...users] })) };
  }
  function findMessage(id) {
    const found = numericEvents.get(Number(id));
    if (!found || !community?.rooms?.[found.room]) throw matrixError('Reload this Better Cherri room before changing that message.', 'BETTER_MESSAGE_UNKNOWN', 404);
    const event = cache(found.room).events.get(found.eventId);
    if (!event) throw matrixError('The message is not available in this room.', 'BETTER_MESSAGE_UNKNOWN', 404);
    return { ...found, event };
  }
  async function getMessages(name, options = {}) {
    await verifyRoom(name);
    if (typeof options === 'string') options = { before: options };
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 50));
    if (options.before != null && typeof options.before !== 'string') throw matrixError('Invalid Matrix history cursor.');
    const result = await request('GET', '/rooms/' + enc(roomId(name)) + '/messages', undefined, { query: { dir: 'b', limit, from: options.before, filter: JSON.stringify({ lazy_load_members: true }) } });
    rememberEvents(name, result.state); rememberEvents(name, result.chunk);
    const redacted = redactedIds(cache(name));
    const messages = (result.chunk || []).map(event => mapMessage(name, event, redacted)).filter(Boolean).sort((a, b) => a.id - b.id);
    return { messages, before: result.end || null, exhausted: !result.end || result.end === options.before || !(result.chunk || []).length };
  }
  const txn = () => 'bc_' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + '_' + Math.random().toString(36).slice(2));
  function bodyText(value) { const text = String(value ?? ''); if (!text.trim()) throw matrixError('Enter a message.'); if (text.length > 8000) throw matrixError('Messages may contain up to 8,000 characters.'); return text; }
  async function sendMessage(name, value) {
    await verifyRoom(name);
    const input = typeof value === 'string' ? { content: value } : value || {};
    const content = { msgtype: 'm.text', body: bodyText(input.content) };
    if (input.replyToId != null) {
      const target = findMessage(input.replyToId);
      if (target.room !== name) throw matrixError('Replies must stay in the same Better Cherri room.');
      content['m.relates_to'] = { 'm.in_reply_to': { event_id: target.eventId } };
    }
    const result = await request('PUT', '/rooms/' + enc(roomId(name)) + '/send/m.room.message/' + txn(), content);
    if (typeof result.event_id !== 'string') throw matrixError('Matrix did not return a saved message ID.');
    const event = { event_id: result.event_id, room_id: roomId(name), sender: session.userId, type: 'm.room.message', origin_server_ts: Date.now(), content };
    rememberEvents(name, [event]);
    const message = mapMessage(name, event);
    emit({ type: 'message', room: name, message }); return message;
  }
  async function edit(id, value) {
    requireSession();
    const target = findMessage(id);
    if (target.event.sender !== session.userId) throw matrixError('You can edit only your own messages.', 'M_FORBIDDEN', 403);
    await verifyRoom(target.room);
    const body = bodyText(typeof value === 'string' ? value : value?.content);
    const replacement = { ...target.event.content, body };
    const content = { msgtype: 'm.text', body: '* ' + body, 'm.new_content': replacement, 'm.relates_to': { rel_type: 'm.replace', event_id: target.eventId } };
    const result = await request('PUT', '/rooms/' + enc(roomId(target.room)) + '/send/m.room.message/' + txn(), content);
    rememberEvents(target.room, [{ event_id: result.event_id, room_id: roomId(target.room), sender: session.userId, type: 'm.room.message', origin_server_ts: Date.now(), content }]);
    const message = mapMessage(target.room, target.event);
    emit({ type: 'edit', room: target.room, message }); return message;
  }
  async function remove(id) {
    const target = findMessage(id); await verifyRoom(target.room);
    const result = await request('PUT', '/rooms/' + enc(roomId(target.room)) + '/redact/' + enc(target.eventId) + '/' + txn(), {});
    rememberEvents(target.room, [{ event_id: result.event_id, room_id: roomId(target.room), sender: session.userId, type: 'm.room.redaction', origin_server_ts: Date.now(), redacts: target.eventId, content: { redacts: target.eventId } }]);
    emit({ type: 'delete', room: target.room, messageId: Number(id) }); return { ok: true };
  }
  async function react(id, emoji) {
    requireSession();
    if (typeof emoji !== 'string' || !emoji.trim() || emoji.length > 64) throw matrixError('Choose a reaction emoji.');
    const target = findMessage(id); await verifyRoom(target.room);
    const data = cache(target.room), redacted = redactedIds(data);
    const existing = [...data.events.values()].find(event => event.type === 'm.reaction' && event.sender === session.userId && !redacted.has(event.event_id) && event.content?.['m.relates_to']?.event_id === target.eventId && event.content['m.relates_to'].key === emoji);
    if (existing) {
      const result = await request('PUT', '/rooms/' + enc(roomId(target.room)) + '/redact/' + enc(existing.event_id) + '/' + txn(), {});
      rememberEvents(target.room, [{ event_id: result.event_id, type: 'm.room.redaction', sender: session.userId, origin_server_ts: Date.now(), redacts: existing.event_id, content: { redacts: existing.event_id } }]);
    } else {
      const content = { 'm.relates_to': { rel_type: 'm.annotation', event_id: target.eventId, key: emoji } };
      const result = await request('PUT', '/rooms/' + enc(roomId(target.room)) + '/send/m.reaction/' + txn(), content);
      rememberEvents(target.room, [{ event_id: result.event_id, type: 'm.reaction', sender: session.userId, origin_server_ts: Date.now(), content }]);
    }
    const reactions = mapMessage(target.room, target.event)?.reactions || [];
    emit({ type: 'reaction', room: target.room, messageId: Number(id), reactions }); return { reactions };
  }
  async function typing(name, isTyping = true) {
    await verifyRoom(name);
    await request('PUT', '/rooms/' + enc(roomId(name)) + '/typing/' + enc(session.userId), { typing: !!isTyping, timeout: 10000 });
    return { ok: true };
  }
  async function search(name, query, limit = 50) {
    requireSession();
    const rooms = name ? [roomId(name)] : (await listChannels()).map(channel => roomId(channel.name));
    if (!rooms.length) return [];
    for (const id of rooms) await verifyRoom(nameOf(id));
    const result = await request('POST', '/search', { search_categories: { room_events: { search_term: String(query || '').slice(0,500), order_by: 'recent', filter: { rooms, limit: Math.min(100, Math.max(1, Number(limit) || 50)) } } } });
    const messages = [];
    for (const item of result.search_categories?.room_events?.results || []) { const event = item.result, room = nameOf(event?.room_id); if (!room || !rooms.includes(event.room_id)) continue; rememberEvents(room, [event]); const message = mapMessage(room, event); if (message) messages.push(message); }
    return messages.sort((a, b) => b.id - a.id);
  }
  async function processSync(result) {
    for (const [id, value] of Object.entries(result.rooms?.join || {})) {
      const name = nameOf(id); if (!name) continue;
      const data = cache(name), timeline = value.timeline?.events || [];
      const state = [...(value.state?.events || []), ...timeline].filter(event => event.state_key === '');
      if (state.some(event => ['m.room.join_rules', 'm.room.history_visibility', 'm.room.guest_access', 'm.room.encryption'].includes(event.type))) { data.checkedAt = 0; data.private = false; }
      // Imported configurations are untrusted. Do not emit even an initial
      // timeline until the server confirms this room's private settings.
      await verifyRoom(name);
      rememberEvents(name, value.state?.events); rememberEvents(name, timeline);
      for (const event of timeline) {
        const relation = event.content?.['m.relates_to'];
        if (event.type === 'm.room.message' && relation?.rel_type === 'm.replace') { const original = data.events.get(relation.event_id); if (original?.sender === event.sender) { const message = mapMessage(name, original); if (message) emit({ type: 'edit', room: name, message }); } }
        else if (event.type === 'm.room.message') { const message = mapMessage(name, event); if (message) emit({ type: 'message', room: name, message }); }
        else if (event.type === 'm.reaction' && relation?.rel_type === 'm.annotation') { const original = data.events.get(relation.event_id), message = mapMessage(name, original); if (message) emit({ type: 'reaction', room: name, messageId: message.id, reactions: message.reactions }); }
        else if (event.type === 'm.room.redaction') {
          const targetId = event.redacts || event.content?.redacts, target = data.events.get(targetId);
          if (target?.type === 'm.room.message' && target.content?.['m.relates_to']?.rel_type !== 'm.replace') emit({ type: 'delete', room: name, messageId: numericId(name, target) });
          else if (target?.type === 'm.reaction') { const message = mapMessage(name, data.events.get(target.content?.['m.relates_to']?.event_id)); if (message) emit({ type: 'reaction', room: name, messageId: message.id, reactions: message.reactions }); }
          else if (target?.content?.['m.relates_to']?.rel_type === 'm.replace') { const message = mapMessage(name, data.events.get(target.content['m.relates_to'].event_id)); if (message) emit({ type: 'edit', room: name, message }); }
        }
        if (event.type === 'm.room.member') emit({ type: 'members', room: name });
      }
      for (const event of value.ephemeral?.events || []) if (event.type === 'm.typing') for (const userId of event.content?.user_ids || []) if (userId !== session?.userId && data.members.has(userId)) emit({ type: 'typing', room: name, userId, username: userShape(userId, profiles.get(userId)).username });
    }
    for (const [id] of Object.entries(result.rooms?.leave || {})) { const name = nameOf(id); if (name) { roomCache.delete(name); emit({ type: 'membership', room: name, joined: false }); } }
  }
  function sleep(ms, signal) {
    return new Promise(resolve => { const timer = setTimeout(done, ms); function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); } signal?.addEventListener('abort', done, { once: true }); if (signal?.aborted) done(); });
  }
  function stopSync() { const run = syncRun; syncRun = null; if (run) run.abort(); }
  function startSync() {
    if (syncRun || !session || !listeners.size || !community || ROOM_NAMES.some(name => !community.rooms[name])) return;
    const controller = new AbortController(); syncRun = controller;
    (async () => {
      let delay = 1000;
      while (syncRun === controller && !controller.signal.aborted && session) {
        try {
          const filter = { presence: { limit: 0 }, room: { rooms: ROOM_NAMES.map(roomId), timeline: { limit: 50 }, state: { lazy_load_members: true } } };
          const result = await request('GET', '/sync', undefined, { query: { since: syncSince, timeout: 25000, set_presence: 'offline', filter: JSON.stringify(filter) }, signal: controller.signal });
          if (syncRun !== controller || controller.signal.aborted) break;
          await processSync(result); syncSince = result.next_batch || syncSince; delay = 1000;
          emit({ type: 'status', connected: true });
          // A server/proxy may return immediately; do not create a busy loop.
          await sleep(100, controller.signal);
        } catch (error) {
          if (controller.signal.aborted || syncRun !== controller) break;
          emit({ type: 'status', connected: false, error: error.message, code: error.code, retryAfterMs: error.retryAfterMs || delay });
          if (!session || error.status === 401) break;
          await sleep(Math.max(delay, error.retryAfterMs || 0), controller.signal); delay = Math.min(30000, delay * 2);
        }
      }
      if (syncRun === controller) syncRun = null;
    })();
  }
  function subscribe(nameOrListener, callback) {
    const room = typeof nameOrListener === 'string' ? nameOrListener : null;
    if (room && !ROOM_NAMES.includes(room)) throw matrixError('Unknown Better Cherri room.');
    const listener = room ? value => { if (!value.room || value.room === room) callback(value); } : nameOrListener;
    if (typeof listener !== 'function') throw matrixError('A subscription callback is required.');
    listeners.add(listener); startSync(); let closed = false;
    return () => { if (closed) return; closed = true; listeners.delete(listener); if (!listeners.size) stopSync(); };
  }
  try { const saved = storageGet(SESSION_KEY); if (saved && validUser(saved.userId) && saved.userId.endsWith(':salix.host') && typeof saved.accessToken === 'string' && saved.accessToken) session = { userId: saved.userId, deviceId: String(saved.deviceId || ''), accessToken: saved.accessToken }; } catch {}
  try { const configured = globalThis.__BETTER_MATRIX_COMMUNITY__ || storageGet(COMMUNITY_KEY); if (configured) community = normalizeCommunity(configured, true); } catch {}
  try { for (const item of storageGet(IDS_KEY) || []) if (Array.isArray(item) && typeof item[0] === 'string' && item[0].length < 1500 && Number.isSafeInteger(item[1]) && item[1] > 0 && !reservedIds.has(item[1])) { savedIds.set(item[0], item[1]); reservedIds.set(item[1], item[0]); } } catch {}
  globalThis.__betterMatrix = Object.freeze({ BASE, ROOM_NAMES, login, restore, whoami, logout, getSession: safeSession, me, createCommunity, setCommunity, getCommunity, exportCommunity: () => JSON.stringify(getCommunity(), null, 2), joinCommunity, listChannels, channels: listChannels, listMembers, members: listMembers, invite, getMessages, messages: getMessages, sendMessage, send: sendMessage, edit, editMessage: edit, remove, deleteMessage: remove, react, reactMessage: react, typing, search, subscribe, getCachedMessage: id => { try { const found = findMessage(id); return mapMessage(found.room, found.event); } catch { return null; } } });
})();
