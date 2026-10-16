/* Better Cherri room view. Uses the original service; client-side filtering is
   not a server permission or a guarantee that stock clients cannot read rooms. */
(() => {
  'use strict';
  const ROOM = /^better-[a-z0-9][a-z0-9_-]*$/;
  const contexts = new Map();
  let selected = '', active;
  function base(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash
        ? u.href.replace(/\/+$/, '') : '';
    } catch { return ''; }
  }
  function backend(preferred) {
    const chosen = base(preferred);
    if (chosen) selected = chosen;
    return selected || base(globalThis.__betterCherriApi) || base(globalThis.__BETTER_CHERRI_URL_BASE__) || base(globalThis.__BETTER_CHERRI_UPSTREAM__);
  }
  const decode = value => { try { return decodeURIComponent(value); } catch { return ''; } };
  const isRoom = name => typeof name === 'string' && ROOM.test(name);
  const pathOf = value => { try { return new URL(value, 'https://better-cherri.invalid').pathname; } catch { return ''; } };
  function blocked(value) {
    const p = pathOf(value);
    const room = /^\/api\/chat\/channels\/([^/]+)(?:\/|$)/.exec(p);
    if (room && room[1] !== 'reorder') return !isRoom(decode(room[1]));
    return /^\/api\/(?:dm|dms|direct-messages)(?:\/|$)/.test(p);
  }
  function context(token = '') {
    const key = backend() + '\n' + token;
    if (!contexts.has(key)) contexts.set(key, { token, ids: new Set(), profiles: new Map(), messages: new Set(), channels: null, channelAt: 0, participantsAt: 0, online: [] });
    active = contexts.get(key);
    return active;
  }
  const idOf = value => value && typeof value === 'object' ? String(value.id ?? value.userId ?? '') : String(value ?? '');
  function rememberUser(ctx, value) {
    const id = idOf(value);
    if (!id) return;
    ctx.ids.add(id);
    if (value && typeof value === 'object') ctx.profiles.set(id, { ...ctx.profiles.get(id), ...value, id });
  }
  function learnMessage(ctx, value, room) {
    if (!value || typeof value !== 'object' || !isRoom(value.room ?? room)) return;
    if (value.room && room && value.room !== room) return;
    const author = value.fromUserId ?? value.author?.id ?? value.from?.id;
    if (author != null) rememberUser(ctx, { ...(value.author || value.from || {}), id: String(author), ...(value.username ? { username: value.username } : {}), ...(value.display ? { display: value.display } : {}), ...(value.avatarUrl ? { pfp: value.avatarUrl } : {}) });
    if (value.id != null && (author != null || value.content != null)) ctx.messages.add(String(value.id));
  }
  function learnMessages(ctx, value, room) {
    const list = Array.isArray(value) ? value : value?.messages ?? value?.results ?? [];
    for (const message of list) learnMessage(ctx, message, room);
  }
  const known = (ctx, value) => ctx.ids.has(idOf(value));
  const usersOnly = (ctx, list) => Array.isArray(list) ? list.filter(user => known(ctx, user)) : [];
  const idsOnly = (ctx, list) => Array.isArray(list) ? list.filter(id => known(ctx, id)) : [];
  const mapOnly = (ctx, map) => map && typeof map === 'object' && !Array.isArray(map) ? Object.fromEntries(Object.entries(map).filter(([id]) => ctx.ids.has(String(id)))) : {};
  function presence(ctx, value) {
    const result = { ...value };
    for (const key of ['online', 'idle', 'joined', 'left', 'active', 'userIds']) if (Array.isArray(result[key])) result[key] = idsOnly(ctx, result[key]);
    if ('users' in result) result.users = Array.isArray(result.users) ? usersOnly(ctx, result.users) : mapOnly(ctx, result.users);
    if ('activities' in result) result.activities = mapOnly(ctx, result.activities);
    if (Array.isArray(result.online)) ctx.online = result.online;
    if ('count' in result) result.count = ctx.online.length;
    return result;
  }
  function json(value, status = 200, original) {
    const headers = new Headers(original?.headers);
    for (const key of ['Content-Length', 'Content-Encoding', 'Transfer-Encoding']) headers.delete(key);
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify(value), { status, statusText: original?.statusText, headers });
  }
  const denied = message => json({ error: message || 'This version shows and edits only better-* rooms.', code: 'better_room_view_only' }, 403);
  function destination(p) { return backend() + p; }
  // Window.origin reports the inherited security origin of about:blank;
  // location.origin reports the URL's null origin. Never export a session.
  function onServiceOrigin() {
    try { return globalThis.origin === new URL(backend()).origin; } catch { return false; }
  }
  function options(input, init) {
    return { ...init, headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)), credentials: 'omit' };
  }
  async function send(nativeFetch, url, input, init) {
    const opts = options(input, init);
    if (input instanceof Request) return nativeFetch(new Request(new Request(url, input), opts));
    return nativeFetch(url, opts);
  }
  async function readJson(response) { try { return await response.clone().json(); } catch { return null; } }
  async function channels(ctx, nativeFetch, opts) {
    if (ctx.channels && Date.now() - ctx.channelAt < 15000) return ctx.channels;
    if (ctx.channelPromise) return ctx.channelPromise;
    ctx.channelPromise = (async () => {
      const response = await nativeFetch(destination('/api/chat/channels'), { ...opts, method: 'GET', body: undefined });
      if (!response.ok) return null;
      const value = await readJson(response);
      if (!Array.isArray(value)) return null;
      ctx.channels = value.filter(c => isRoom(c?.name));
      ctx.channelAt = Date.now();
      return ctx.channels;
    })();
    try { return await ctx.channelPromise; } finally { ctx.channelPromise = null; }
  }
  async function participants(ctx, nativeFetch, opts) {
    if (Date.now() - ctx.participantsAt < 15000) return;
    if (ctx.participantPromise) return ctx.participantPromise;
    ctx.participantPromise = (async () => {
      const [rooms, me] = await Promise.all([channels(ctx, nativeFetch, opts), nativeFetch(destination('/api/auth/me'), { ...opts, method: 'GET', body: undefined })]);
      if (!me.ok) { ctx.authFailure = me; return; }
      ctx.authFailure = null;
      const account = await readJson(me);
      if (account?.user) rememberUser(ctx, account.user);
      if (!rooms) return;
      await Promise.allSettled(rooms.filter(c => c.kind !== 'voice').map(async room => {
        const response = await nativeFetch(destination('/api/chat/channels/' + encodeURIComponent(room.name) + '/messages'), { ...opts, method: 'GET', body: undefined });
        if (response.ok) learnMessages(ctx, await readJson(response), room.name);
      }));
      ctx.participantsAt = Date.now();
    })();
    try { await ctx.participantPromise; } finally { ctx.participantPromise = null; }
  }
  async function requestBody(input, init) {
    try {
      if (typeof init?.body === 'string') return JSON.parse(init.body);
      if (input instanceof Request && !init?.body) return await input.clone().json();
    } catch {}
    return null;
  }
  function filterFrame(path, frame) {
    if (blocked(path) || !frame || typeof frame !== 'object') return null;
    const u = new URL(path, 'https://better-cherri.invalid');
    const ctx = context(u.searchParams.get('token') || active?.token || '');
    const match = /^\/api\/chat\/channels\/([^/]+)\/stream$/.exec(u.pathname);
    if (match) {
      const room = decode(match[1]);
      if (!isRoom(room) || (frame.room != null && frame.room !== room)) return null;
      learnMessage(ctx, frame, room);
      if (frame.message) learnMessage(ctx, frame.message, room);
      return frame;
    }
    if (u.pathname !== '/api/notify/stream') return frame;
    if (['presence', 'presence_delta', 'presence_resync', 'online'].includes(frame.type)) return presence(ctx, frame);
    if (frame.type === 'voice_rooms_changed') return { ...frame, rooms: Array.isArray(frame.rooms) ? frame.rooms.filter(room => isRoom(room.name)).map(room => ({ ...room, participants: Array.isArray(room.participants) ? room.participants.filter(user => known(ctx, user)) : room.participants })) : frame.rooms };
    if (['channel_activity', 'mention', 'filtered_message'].includes(frame.type)) {
      if (!isRoom(frame.room)) return null;
      if (frame.type === 'filtered_message') learnMessage(ctx, { ...frame, fromUserId: frame.from?.id }, frame.room);
      return frame;
    }
    if (frame.room != null && !isRoom(frame.room)) return null;
    if (frame.userId != null) return known(ctx, frame.userId) ? frame : null;
    // Account notices concern the signed-in user, rather than public rosters.
    if (['warned', 'muted', 'unmuted', 'banned', 'permissions_changed', 'session_revoked'].includes(frame.type)) return frame;
    return null;
  }
  globalThis.__betterCherriBackend = backend;
  globalThis.__betterCherriBlocked = blocked;
  globalThis.__betterCherriSocket = (path, preferred) => {
    const service = backend(preferred);
    if (!service || blocked(path)) throw new Error('This stream is outside the Better Cherri room view.');
    return service.replace(/^https:/, 'wss:') + path;
  };
  globalThis.__betterCherriFilterFrame = filterFrame;
  globalThis.__betterCherriRequest = async (input, init, nativeFetch, publicBase) => {
    backend(publicBase);
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    let url;
    try { url = new URL(raw, /^https?:$/.test(location.protocol) ? location.href : 'https://better-cherri.invalid/'); }
    catch { return nativeFetch(input, init); }
    if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
    // Probe each candidate at its actual URL; the selector must see real health.
    if (url.pathname === '/api/ping') return nativeFetch(input, init);
    const relative = typeof raw === 'string' && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw);
    const allowedOrigins = [backend(), base(globalThis.__betterCherriApi), base(globalThis.__BETTER_CHERRI_URL_BASE__), base(globalThis.__BETTER_CHERRI_UPSTREAM__), /^https?:$/.test(location.protocol) ? location.origin : ''].filter(Boolean).map(value => new URL(value).origin);
    if (!relative && !allowedOrigins.includes(url.origin)) return nativeFetch(input, init);
    if (!backend()) return json({ error: 'No original Cherri service is available.', code: 'cherri_service_unavailable' }, 503);
    // Account requests must originate from Cherri directly. Its account server
    // explicitly rejects the datacenter IP of the Wisp fallback; do not route
    // login/signup through another proxy or retry around that restriction.
    if (/^\/api\/auth\/(?:login|register|reset|forgot|password)(?:\/|$)/.test(url.pathname)
        && !onServiceOrigin()) {
      return json({error:'Open https://cherrion.top/login to sign in or create an account directly on Cherri.',code:'cherri_direct_account_required'},503);
    }
    // The launcher may supply Cherri's original Wisp transport for its API.
    // Choose it before sending; retrying a failed CORS write could duplicate it.
    if (!onServiceOrigin() && typeof globalThis.__betterCherriRemoteFetch === 'function') nativeFetch = globalThis.__betterCherriRemoteFetch;
    const p = url.pathname, method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const opts = options(input, init);
    const token = (opts.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const ctx = context(token);
    if (blocked(p)) return denied();
    const body = method === 'GET' || method === 'HEAD' ? null : await requestBody(input, init);
    if (p === '/api/chat/channels' && method !== 'GET' && method !== 'HEAD' && !isRoom(body?.name)) return denied('New channel names must start with better-, such as better-general.');
    if (p === '/api/chat/channels/reorder' && (!Array.isArray(body?.items) || body.items.some(item => !isRoom(item.name)))) return denied();
    if (/^\/api\/chat\/categories(?:\/|$)/.test(p) && method !== 'GET') return denied('Shared categories cannot be changed from this room view.');
    if (/^\/api\/chat\/(?:audit|chat-log)\//.test(p) && !isRoom(body?.channelName ?? body?.room)) return denied('Choose a better-* room for this action.');
    const messagePath = /^\/api\/chat\/messages\/([^/]+)/.exec(p);
    if (messagePath && !ctx.messages.has(decode(messagePath[1]))) return denied('That message has not been loaded from a Better Cherri room.');
    if (/^\/api\/friends(?:\/|$)/.test(p) && method !== 'GET' && !/\/settings$/.test(p)) {
      const targetKnown = body?.userId != null ? known(ctx, body.userId) : [...ctx.profiles.values()].some(user => user.username && user.username.toLowerCase() === String(body?.username || '').replace(/^@/, '').toLowerCase());
      if (!targetKnown) return denied('Friend actions are available only for known Better Cherri room participants.');
    }
    if (p === '/api/chat/search') {
      const requested = url.searchParams.get('in') || 'all';
      if (requested !== 'all' && !isRoom(requested.replace(/^#/, ''))) return denied();
      if (requested !== 'all') url.searchParams.set('in', requested.replace(/^#/, ''));
      if (requested === 'all') {
        const rooms = await channels(ctx, nativeFetch, opts);
        if (!rooms) return json({ error: 'Unable to load Better Cherri rooms for search.' }, 503);
        let previous = null;
        const cursor = url.searchParams.get('cursor');
        if (cursor?.startsWith('better-rooms:')) {
          try { previous = JSON.parse(decodeURIComponent(cursor.slice(13))); } catch { return json({ error: 'The room search cursor is invalid.' }, 400); }
        }
        const all = await Promise.all(rooms.filter(c => c.kind !== 'voice' && (!previous || previous[c.name] != null)).map(async room => {
          const query = new URLSearchParams(url.search);
          query.set('in', room.name);
          if (previous) query.set('cursor', String(previous[room.name]));
          const response = await nativeFetch(destination(p + '?' + query), { ...opts, method: 'GET' });
          return { response, value: await readJson(response), room: room.name };
        }));
        const failed = all.find(item => !item.response.ok);
        if (failed) return failed.response;
        const results = all.flatMap(item => (item.value?.results || []).filter(message => (message.room ?? item.room) === item.room).map(message => ({ ...message, room: message.room ?? item.room })));
        learnMessages(ctx, results);
        results.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
        const cursors = Object.fromEntries(all.map(item => [item.room, item.value?.nextCursor ?? null]));
        return json({ results, nextCursor: Object.values(cursors).some(value => value != null) ? 'better-rooms:' + encodeURIComponent(JSON.stringify(cursors)) : null });
      }
    }
    if (p === '/api/members' || p === '/api/members/brief' || p === '/api/users/list' || p === '/api/mod/members' || p === '/api/friends' || p === '/api/blocks') await participants(ctx, nativeFetch, opts);
    if ((p === '/api/users/list' || p === '/api/mod/members') && ctx.authFailure) return ctx.authFailure;
    // Build the directory from known participant IDs, never a paged global list.
    if (p === '/api/users/list' || p === '/api/mod/members') {
      const ids = [...ctx.ids];
      const profiles = await Promise.all(ids.length ? Array.from({ length: Math.ceil(ids.length / 200) }, async (_, index) => {
        const response = await nativeFetch(destination('/api/members/brief?ids=' + encodeURIComponent(ids.slice(index * 200, index * 200 + 200).join(','))), { ...opts, method: 'GET' });
        return response.ok ? (await readJson(response))?.users || [] : [];
      }) : []);
      for (const user of profiles.flat()) if (known(ctx, user)) ctx.profiles.set(String(user.id), user);
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const matches = [...ctx.profiles.values()].filter(user => known(ctx, user) && (String(user.username || '') + ' ' + String(user.display || '')).toLowerCase().includes(q));
      if (url.searchParams.get('ids') === '1') return json({ ids: matches.map(user => user.id), total: matches.length });
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 50, 200));
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const list = matches.slice((page - 1) * limit, page * limit);
      return json(p === '/api/mod/members' ? { items: list, total: matches.length } : { users: list, total: matches.length, unknown: [] });
    }
    if (p === '/api/members/brief') url.searchParams.set('ids', (url.searchParams.get('ids') || '').split(',').filter(id => ctx.ids.has(id)).join(','));
    const response = await send(nativeFetch, destination(p + url.search), input, init);
    if (!response.ok) return response;
    if (method !== 'GET' && /^\/api\/chat\/channels(?:\/[^/]+)?$/.test(p)) { ctx.channelAt = 0; ctx.participantsAt = 0; }
    const handled = /^\/api\/(?:auth\/(?:me|login|register|logout)|chat\/(?:channels|categories|search)|members(?:\/brief)?$|presence(?:\/|$)|friends$|blocks$|roles\/(?:top|colors)$|voice\/rooms$)/.test(p);
    if (!handled) return response;
    const value = await readJson(response);
    if (value == null) return response;
    if (p.startsWith('/api/auth/')) {
      if (p === '/api/auth/logout') { contexts.clear(); active = null; }
      else if (value.user) rememberUser(ctx, value.user);
      return response;
    }
    if (p === '/api/chat/channels' && Array.isArray(value)) {
      ctx.channels = value.filter(c => isRoom(c?.name)); ctx.channelAt = Date.now();
      return json(ctx.channels, response.status, response);
    }
    const room = /^\/api\/chat\/channels\/([^/]+)\/(?:messages|pins)$/.exec(p);
    if (room) {
      learnMessages(ctx, value, decode(room[1]));
      if (!Array.isArray(value)) learnMessage(ctx, value, decode(room[1]));
      return response;
    }
    if (p === '/api/chat/search') {
      const filtered = { ...value, results: (value.results || []).filter(message => isRoom(message.room)) };
      learnMessages(ctx, filtered); return json(filtered, response.status, response);
    }
    if (p === '/api/chat/categories' && Array.isArray(value)) {
      const rooms = await channels(ctx, nativeFetch, opts) || [];
      const categories = new Set(rooms.map(room => room.categoryId));
      return json(value.filter(category => categories.has(category.id)), response.status, response);
    }
    if (p === '/api/members') return json(usersOnly(ctx, value), response.status, response);
    if (p === '/api/members/brief') return json({ ...value, users: usersOnly(ctx, value.users) }, response.status, response);
    if (p.startsWith('/api/presence')) return json(presence(ctx, value), response.status, response);
    if (p === '/api/friends') return json({ ...value, friends: (value.friends || []).filter(friend => known(ctx, friend.user)), incoming: (value.incoming || []).filter(friend => known(ctx, friend.user)), outgoing: (value.outgoing || []).filter(friend => known(ctx, friend.user)) }, response.status, response);
    if (p === '/api/blocks') return json({ ...value, blocked: (value.blocked || []).filter(entry => known(ctx, entry.user)) }, response.status, response);
    if (p === '/api/roles/top' || p === '/api/roles/colors') return json(mapOnly(ctx, value), response.status, response);
    if (p === '/api/voice/rooms') return json({ ...value, rooms: (value.rooms || []).filter(room => isRoom(room.name)).map(room => ({ ...room, participants: usersOnly(ctx, room.participants) })) }, response.status, response);
    return response;
  };
})();
