/* Cherri REST and logical stream compatibility for the hosted Matrix client.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Matrix credentials remain inside __betterMatrix; the original UI sees only
 * an opaque, non-secret identity marker. No handled endpoint falls through to
 * Cherri's account or shared chat servers.
 */
(() => {
  'use strict';
  const root = globalThis;
  const contexts = new Map();
  const scoped = p => /^\/api\/(?:auth(?:\/|$)|chat(?:\/|$)|members(?:\/|$)|friends(?:\/|$)|blocks(?:\/|$)|presence(?:\/|$)|roles(?:\/|$)|voice(?:\/|$)|polls(?:\/|$)|saves(?:\/|$)|mod(?:\/|$))/.test(p) ||
    /^\/api\/me\/(?:permissions|chat-status)$/.test(p) ||
    /^\/api\/users\/(?:list|equipped|settings|profile\/|[^/]+\/(?:view|roles)$)/.test(p);
  const response = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}});
  const fail = (status, message) => Object.assign(new Error(message), {status});
  const client = () => {
    if (!root.__betterMatrix) throw fail(503, 'The hosted Better Cherri chat client is not ready.');
    return root.__betterMatrix;
  };
  const safeSession = () => { try { return root.__betterMatrix?.getSession?.() || null; } catch { return null; } };
  const contextKey = () => {
    const s = safeSession();
    if (!s?.userId) return null;
    let rooms = null; try { rooms = root.__betterMatrix?.getCommunity?.()?.rooms || null; } catch {}
    return String(s.userId) + '\n' + String(s.deviceId || '') + '\n' + JSON.stringify(rooms);
  };
  function sessionToken() {
    const s = safeSession();
    if (!s?.userId) return null;
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({sub: String(s.userId)})))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return 'eyJ0eXAiOiJCQyJ9.' + encoded + '.matrix';
  }
  async function invoke(names, ...args) {
    const c = client();
    for (const n of names) if (typeof c[n] === 'function') return c[n](...args);
    throw fail(501, 'This chat feature is not available in this version.');
  }
  function context() {
    const s = safeSession();
    if (!s?.userId) throw fail(401, 'Sign in to your hosted Better Cherri chat account.');
    const key = contextKey();
    let ctx = contexts.get(key);
    if (!ctx) {
      for (const old of contexts.values()) old.unsubscribe?.();
      contexts.clear();
      ctx = {key, userId: String(s.userId), rooms: new Map(), index: new Map(), presence: {online: [String(s.userId)], idle: []}, unsubscribe: null};
      contexts.set(key, ctx);
      if (typeof client().subscribe === 'function') ctx.unsubscribe = client().subscribe(event => { if (contextKey() === key) updateContext(ctx, event); });
    }
    return ctx;
  }
  function roomCache(ctx, room) {
    let cache = ctx.rooms.get(room);
    if (!cache) ctx.rooms.set(room, cache = {messages: new Map(), pages: new Map(), oldestToken: undefined, exhausted: false});
    return cache;
  }
  function remember(ctx, room, messages) {
    const cache = roomCache(ctx, room);
    for (const m of messages || []) if (m && typeof m.id === 'number' && Number.isFinite(m.id)) {
      const row = {...m, room: m.room || room, reactions: Array.isArray(m.reactions) ? m.reactions : []};
      cache.messages.set(row.id, row); ctx.index.set(row.id, {room, message: row});
    }
  }
  function updateContext(ctx, event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'message' && event.room && event.message) remember(ctx, event.room, [event.message]);
    else if (event.type === 'edit' && event.message) {
      const known = ctx.index.get(event.message.id);
      remember(ctx, event.room || known?.room || event.message.room, [{...known?.message, ...event.message}]);
    } else if (event.type === 'delete') {
      const found = ctx.index.get(event.messageId);
      if (found) roomCache(ctx, found.room).messages.delete(event.messageId);
      ctx.index.delete(event.messageId);
    } else if (event.type === 'reaction') {
      const found = ctx.index.get(event.messageId);
      if (found) remember(ctx, found.room, [{...found.message, reactions: event.reactions || []}]);
    } else if (event.type === 'presence') ctx.presence = {online: event.online || [], idle: event.idle || []};
  }
  function sorted(cache) { return [...cache.messages.values()].sort((a, b) => a.id - b.id); }
  function refreshMessages(ctx, room, collected) {
    const refresh = client().getCachedMessage;
    if (typeof refresh !== 'function') return;
    const cache = roomCache(ctx, room);
    // A subsequent raw Matrix page can contain an edit, reaction, or redaction
    // relating to a message already collected from an earlier page.
    for (const id of [...cache.messages.keys()]) {
      const fresh = refresh(id);
      if (fresh) { remember(ctx, room, [fresh]); if (collected.has(id)) collected.set(id, fresh); }
      else { cache.messages.delete(id); ctx.index.delete(id); collected.delete(id); }
    }
  }
  async function loadPage(ctx, room, options) {
    const collected = new Map(), seen = new Set();
    let cursor = options.before, before = null, exhausted = false;
    const wanted = Math.max(1, Number(options.limit) || 50);
    // Matrix pages include edits, reactions, and room-state events. Fill the
    // Cherri page with messages before applying its '<50 means no more' rule.
    do {
      const result = await invoke(['getMessages', 'messages'], room, {...options, ...(cursor != null ? {before: cursor} : {})});
      const chunk = Array.isArray(result) ? result : result?.messages || [];
      remember(ctx, room, chunk);
      for (const m of chunk) collected.set(m.id, m);
      refreshMessages(ctx, room, collected);
      before = Array.isArray(result) ? null : result?.before;
      exhausted = Array.isArray(result) || result?.exhausted === true || before == null || before === cursor || seen.has(before);
      if (before != null) seen.add(before);
      cursor = before;
    } while (collected.size < wanted && !exhausted);
    const rows = [...collected.values()].sort((a, b) => a.id - b.id);
    const cache = roomCache(ctx, room);
    if (rows.length) cache.pages.set(Math.min(...rows.map(m => m.id)), before ?? null);
    if (options.before !== undefined || cache.oldestToken === undefined) {
      cache.oldestToken = before ?? null;
      cache.exhausted = exhausted;
    }
    return rows.slice().sort((a, b) => a.id - b.id);
  }
  async function messages(ctx, room, params) {
    const limit = Math.max(1, Math.min(200, Number(params.get('limit')) || 50));
    const before = params.has('before') ? Number(params.get('before')) : null;
    const after = params.has('after') ? Number(params.get('after')) : null;
    const cache = roomCache(ctx, room);
    if (before == null) {
      const latest = await loadPage(ctx, room, {limit});
      if (after != null) return sorted(cache).filter(m => m.id > after).slice(0, limit);
      return latest.slice(-limit);
    }
    if (!cache.pages.size) await loadPage(ctx, room, {limit: Math.max(50, limit)});
    let rows = sorted(cache).filter(m => m.id < before);
    // Cherri uses numeric before cursors; Matrix uses opaque pagination tokens.
    // Keep each loaded page boundary so older scroll never treats a numeric ID
    // as a Matrix token. Missing search-jump boundaries walk actual history.
    const candidates = [...cache.pages].filter(([id]) => id >= before).sort((a, b) => a[0] - b[0]);
    let token = candidates.length ? candidates[0][1] : cache.oldestToken;
    let seenTokens = new Set();
    while (rows.length < limit && !cache.exhausted) {
      if (token == null || seenTokens.has(token)) { cache.exhausted = true; break; }
      seenTokens.add(token);
      await loadPage(ctx, room, {before: token, limit: Math.max(50, limit)});
      token = cache.oldestToken;
      rows = sorted(cache).filter(m => m.id < before);
    }
    return rows.slice(-limit);
  }
  const members = async () => {
    const rows = await invoke(['listMembers', 'members']);
    return Array.isArray(rows) ? rows : rows?.users || [];
  };
  const channels = async () => {
    const rows = await invoke(['listChannels', 'channels']);
    return Array.isArray(rows) ? rows : rows?.channels || [];
  };
  async function actualRoom(name) {
    if (!(await channels()).some(c => c.name === name)) throw fail(404, 'This private Better Cherri room is not joined.');
  }
  const storageKey = ctx => 'better_cherri_matrix_blocks:' + ctx.userId;
  const blockIds = ctx => { try { const ids = JSON.parse(localStorage.getItem(storageKey(ctx)) || '[]'); return new Set(Array.isArray(ids) ? ids.map(String) : []); } catch { return new Set(); } };
  function storeBlocks(ctx, ids) { try { localStorage.setItem(storageKey(ctx), JSON.stringify([...ids])); } catch {} }
  async function request(input, init = {}) {
    let url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, 'https://better-cherri.invalid/'); }
    catch { return null; }
    const p = url.pathname;
    if (!scoped(p)) return null;
    const method = String(init.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
    let body = {};
    try {
      if (init.body !== undefined) body = typeof init.body === 'string' ? JSON.parse(init.body || '{}') : init.body;
      else if (typeof Request !== 'undefined' && input instanceof Request && !['GET', 'HEAD'].includes(method)) body = await input.clone().json().catch(() => ({}));
      if (p === '/api/auth/logout') {
        await invoke(['logout']);
        for (const ctx of contexts.values()) ctx.unsubscribe?.();
        contexts.clear();
        root.dispatchEvent?.(new Event('cherri:me')); root.dispatchEvent?.(new Event('cherri:session'));
        return response({ok: true});
      }
      if (p.startsWith('/api/auth/') && p !== '/api/auth/me') return response({error: 'Use the Better Cherri hosted chat sign-in screen.', code: 'matrix_account_screen'}, 405);
      if (p === '/api/presence/count' && !safeSession()) return response({count: 0});
      if (p === '/api/presence/heartbeat' && !safeSession()) return response({ok: true, count: 0});
      const ctx = context();
      if (p === '/api/auth/me') return response({user: await invoke(['me'])});
      if (p === '/api/me/permissions') return response({permissions: 0, mediaRevoked: true});
      if (p === '/api/mod/access') return response({chat: false, audit: false, permissions: 0});
      if (p === '/api/me/chat-status') return response({banned: false, muted: false, reason: null, until: null});
      if (p === '/api/chat/channels' && method === 'GET') return response(await channels());
      if (p === '/api/chat/categories' && method === 'GET') return response([{id: 1, name: 'Better Cherri', position: 0}]);
      if (p === '/api/roles/colors' || p === '/api/roles/top') return response({});
      if (p === '/api/roles') return response([]);
      if (p === '/api/members') return response(await members());
      if (p === '/api/members/brief') {
        const ids = new Set((url.searchParams.get('ids') || '').split(','));
        return response({users: (await members()).filter(u => ids.has(u.id))});
      }
      if (p === '/api/users/list') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const rows = (await members()).filter(u => [u.username, u.display, u.id].some(x => String(x || '').toLowerCase().includes(q)));
        if (url.searchParams.get('ids')) return response({ids: rows.map(u => u.id), total: rows.length});
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 50));
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        return response({users: rows.slice((page - 1) * limit, page * limit), total: rows.length, unknown: []});
      }
      const profile = p.match(/^\/api\/users\/profile\/([^/]+)$/);
      if (profile) {
        const name = decodeURIComponent(profile[1]).toLowerCase();
        const user = (await members()).find(u => [u.username, u.id].some(x => String(x).toLowerCase() === name));
        if (!user) throw fail(404, 'Better Cherri member not found.');
        return response(user);
      }
      if (p === '/api/users/equipped') return response({});
      if (/^\/api\/users\/[^/]+\/roles$/.test(p)) return response([]);
      if (/^\/api\/users\/[^/]+\/view$/.test(p)) return response({ok: true});
      if (p === '/api/friends') return response({friends: [], incoming: [], outgoing: []});
      if (p === '/api/blocks') return response({blocked: (await members()).filter(u => blockIds(ctx).has(u.id)).map(user => ({user}))});
      if (['/api/blocks/add', '/api/blocks/remove'].includes(p) && method === 'POST') {
        const ids = blockIds(ctx); if (p.endsWith('/add')) ids.add(String(body.userId)); else ids.delete(String(body.userId));
        storeBlocks(ctx, ids); return response({ok: true});
      }
      if (p === '/api/presence') return response({...ctx.presence, count: ctx.presence.online.length});
      if (p === '/api/presence/count') return response({count: ctx.presence.online.length});
      if (p === '/api/presence/heartbeat') return response({ok: true, count: ctx.presence.online.length});
      if (p === '/api/presence/scope') return response({scope: 'none'});
      if (p === '/api/presence/activity' || p === '/api/presence/activity/public') return response(method === 'GET' ? {at: Date.now(), activities: {}} : {ok: true});
      if (p === '/api/voice/rooms') return response({rooms: []});
      if (p === '/api/chat/search' && method === 'GET') {
        const name = url.searchParams.get('in');
        if (name && name !== 'all') await actualRoom(name);
        const result = await invoke(['search'], name && name !== 'all' ? name : null, url.searchParams.get('q') || '', 50);
        let rows = Array.isArray(result) ? result : result?.results || [];
        const from = url.searchParams.getAll('from'), mentions = url.searchParams.getAll('mentions');
        if (from.length) rows = rows.filter(m => from.includes(m.username));
        if (mentions.length) rows = rows.filter(m => mentions.every(name => String(m.content || '').includes('@' + name)));
        for (const key of ['before', 'after']) {
          const value = Date.parse(url.searchParams.get(key));
          if (Number.isFinite(value)) rows = rows.filter(m => key === 'before' ? Date.parse(m.sentAt) < value : Date.parse(m.sentAt) > value);
        }
        for (const m of rows) remember(ctx, m.room, [m]);
        return response({results: rows, nextCursor: result?.nextCursor ?? null});
      }
      const room = p.match(/^\/api\/chat\/channels\/([^/]+)\/(messages|typing|pins|bot|upload)$/);
      if (room) {
        const name = decodeURIComponent(room[1]); await actualRoom(name);
        if (room[2] === 'messages' && method === 'GET') return response(await messages(ctx, name, url.searchParams));
        if (room[2] === 'messages' && method === 'POST') {
          if (body.poll || body.gifId || body.track || body.playlist || body.partyInvite) throw fail(501, 'This hosted chat version currently supports text, replies, edits, and reactions.');
          const row = await invoke(['sendMessage', 'send'], name, {content: String(body.content || ''), replyToId: body.replyToId ?? null});
          remember(ctx, name, [row]); return response(row, 201);
        }
        if (room[2] === 'typing' && method === 'POST') { await invoke(['typing'], name); return response({ok: true}); }
        if (room[2] === 'pins' && method === 'GET') return response([]);
      }
      const msg = p.match(/^\/api\/chat\/messages\/(\d+)(\/react)?$/);
      if (msg) {
        const id = Number(msg[1]);
        if (msg[2] && method === 'POST') return response(await invoke(['react'], id, String(body.emoji || '')));
        if (method === 'PATCH') {
          const row = await invoke(['edit'], id, {content: String(body.content || '')});
          const known = ctx.index.get(id); if (known) remember(ctx, known.room, [{...known.message, ...row}]);
          return response(row || {ok: true});
        }
        if (method === 'DELETE') { await invoke(['remove'], id); updateContext(ctx, {type: 'delete', messageId: id}); return response({ok: true}); }
      }
      throw fail(501, 'This Cherri feature is not available through the hosted Better Cherri chat service.');
    } catch (error) {
      const status = Number(error.status || error.statusCode || error.httpStatus) || 502;
      return response({error: error.message || 'The hosted Better Cherri chat request failed.', code: error.code || error.errcode || 'matrix_request_failed'}, status >= 400 && status < 600 ? status : 502);
    }
  }
  function stream(path, callbacks = {}) {
    let url; try { url = new URL(path, 'https://better-cherri.invalid/'); } catch { return null; }
    const roomMatch = url.pathname.match(/^\/api\/chat\/channels\/([^/]+)\/stream$/);
    const notify = url.pathname === '/api/notify/stream';
    if (!roomMatch && !notify) return null;
    let closed = false, opened = false, unsubscribe = null, ctx;
    const room = roomMatch ? decodeURIComponent(roomMatch[1]) : null;
    const deliver = frame => { if (!closed) callbacks.onMessage?.(frame); };
    Promise.resolve().then(async () => {
      ctx = context();
      if (room) await actualRoom(room);
      if (closed) return;
      unsubscribe = client().subscribe(event => {
        if (closed || contextKey() !== ctx.key) return;
        updateContext(ctx, event);
        if (notify) {
          if (event.type === 'message') deliver({type: 'channel_activity', room: event.room});
          else if (event.type === 'presence') deliver({type: 'presence', ...ctx.presence});
          else if (event.type === 'members' || event.type === 'membership') deliver({type: 'members_changed'});
          return;
        }
        if (event.room !== room) return;
        if (event.type === 'message') deliver(event.message);
        else if (event.type === 'edit') deliver({type: 'edit', messageId: event.message.id, content: event.message.content, editedAt: event.message.editedAt});
        else if (event.type === 'delete') deliver({type: 'delete', messageId: event.messageId});
        else if (event.type === 'reaction') deliver({type: 'reaction', messageId: event.messageId, reactions: event.reactions});
        else if (event.type === 'typing') deliver({type: 'typing', ...(event.users ? {users: event.users} : {userId: event.userId, username: event.username})});
      });
      opened = true; callbacks.onOpen?.();
      if (notify) deliver({type: 'presence', ...ctx.presence});
    }).catch(error => { if (!closed) callbacks.onError?.(error); });
    return {
      close() { closed = true; opened = false; unsubscribe?.(); },
      isOpen() { return opened && !closed; },
      send(raw) {
        if (closed) return;
        let data; try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
        if (notify && data?.sub === 'presence' && ctx) deliver({type: 'presence', ...ctx.presence});
        if (room && (data?.typing || data?.type === 'typing')) invoke(['typing'], room).catch(() => {});
      }
    };
  }
  root.__betterMatrixRequest = request;
  root.__betterMatrixStream = stream;
  root.__betterMatrixSessionToken = sessionToken;
})();
