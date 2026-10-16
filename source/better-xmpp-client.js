/* SPDX-License-Identifier: AGPL-3.0-or-later
 * Hosted XMPP transport for Better Cherri. Strophe.js supplies TLS WebSocket
 * framing and SCRAM authentication. Passwords stay in memory for sign-in;
 * public community exports contain only room addresses. No E2EE is enabled. */
(() => {
  'use strict';
  const SERVICE = 'wss://xmpp.yaxim.org/xmpp-websocket', DOMAIN = 'yax.im', MUC = 'chat.yax.im';
  const NAMES = ['better-general', 'better-games', 'better-music'];
  const COMMUNITY_KEY = 'better_cherri_xmpp_community_v1', IDS_KEY = 'better_cherri_xmpp_event_ids_v1';
  const NS = { client: 'jabber:client', register: 'jabber:iq:register', data: 'jabber:x:data', muc: 'http://jabber.org/protocol/muc', user: 'http://jabber.org/protocol/muc#user', owner: 'http://jabber.org/protocol/muc#owner', admin: 'http://jabber.org/protocol/muc#admin', disco: 'http://jabber.org/protocol/disco#info', mam: 'urn:xmpp:mam:2', rsm: 'http://jabber.org/protocol/rsm', forward: 'urn:xmpp:forward:0', delay: 'urn:xmpp:delay', sid: 'urn:xmpp:sid:0', reply: 'urn:xmpp:reply:0', correct: 'urn:xmpp:message-correct:0', reactions: 'urn:xmpp:reactions:0', retract: 'urn:xmpp:message-retract:1', chat: 'http://jabber.org/protocol/chatstates' };
  let connection = null, session = null, community = null, connecting = false, creating = null, nick = '';
  const listeners = new Set(), rooms = new Map(), eventIndex = new Map(), aliases = new Map(), reserved = new Map(), pendingIQ = new Set(), pendingEcho = new Map();
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  function uuid() { if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID().replace(/-/g,'');if(globalThis.crypto?.getRandomValues){const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));return Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');}throw error('Secure random numbers are unavailable in this browser.','BETTER_XMPP_CRYPTO',503); }
  const bare = value => String(value || '').split('/')[0];
  const validJid = value => typeof value === 'string' && /^[a-zA-Z0-9._=+-]{1,128}@[a-zA-Z0-9.-]{1,253}$/.test(value);
  const validRoom = value => typeof value === 'string' && /^better-[a-f0-9]{32}-(?:general|games|music)@chat\.yax\.im$/.test(value);
  function error(message, code = 'BETTER_XMPP_ERROR', status = 400) { return Object.assign(new Error(message), { code, status }); }
  function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
  function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function emit(value) {
    for (const listener of [...listeners]) { try { listener(clone(value)); } catch {} }
    if (['session', 'community'].includes(value.type)) { try { globalThis.dispatchEvent(new CustomEvent('better-xmpp:' + value.type, { detail: clone(value[value.type]) })); } catch {} }
  }
  const getSession = () => session ? { userId: session.userId, deviceId: session.deviceId } : null;
  function sdk() { if (!globalThis.Strophe?.Connection || !globalThis.$build) throw error('The chat connection library did not load. Reopen Better Cherri.', 'BETTER_XMPP_SDK', 503); return globalThis.Strophe; }
  function requireConnection() { if (!connection?.authenticated || !session) throw error('Sign in to Better Cherri chat first.', 'BETTER_XMPP_SIGN_IN', 401); return connection; }
  function xml(name, attrs = {}, children = []) { const b = globalThis.$build(name, attrs); for (const child of children.flat().filter(child => child != null)) { if (typeof child === 'string') b.t(child); else b.cnode(child).up(); } return b.tree(); }
  const children = element => Array.from(element?.children || element?.childNodes || []).filter(child => child.nodeType === 1);
  const local = element => element?.localName || String(element?.nodeName || '').split(':').at(-1);
  const xmlns = element => element?.namespaceURI || element?.getAttribute?.('xmlns') || '';
  const child = (element, name, ns) => children(element).find(value => local(value) === name && (!ns || xmlns(value) === ns));
  const descendants = (element, name, ns) => children(element).flatMap(value => [...(local(value) === name && (!ns || xmlns(value) === ns) ? [value] : []), ...descendants(value, name, ns)]);
  const text = element => element?.textContent || '';
  const attr = (element, name) => element?.getAttribute?.(name) || '';
  function stanzaError(stanza) { const e = child(stanza, 'error'), condition = children(e).find(value => local(value) !== 'text'); const code = local(condition) || 'request-failed'; return error(text(child(e, 'text')) || 'The chat server rejected this operation (' + code + ').', code, ['forbidden','not-authorized','registration-required'].includes(code) ? 403 : code === 'conflict' ? 409 : code === 'resource-constraint' ? 429 : code === 'feature-not-implemented' ? 501 : 400); }
  function normalizeCommunity(value, partial = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || (value.provider && value.provider !== 'xmpp') || (value.server && value.server !== DOMAIN)) throw error('Use a Better Cherri community on yax.im.');
    const selected = {};
    let namespace='';
    for (const name of NAMES) { if (partial && value.rooms?.[name] == null) continue; const address=value.rooms?.[name];if (!validRoom(address)||!address.endsWith('-'+name.slice(7)+'@'+MUC)) throw error('A valid private room address is required for ' + name + '.');const group=address.slice(7,39);if(namespace&&namespace!==group)throw error('All channels must belong to the same Better Cherri community.');namespace=group;selected[name] = address; }
    if (new Set(Object.values(selected)).size !== Object.keys(selected).length) throw error('Each channel needs its own private room.');
    return { version: 1, provider: 'xmpp', server: DOMAIN, name: 'Better Cherri', rooms: selected };
  }
  const getCommunity = () => community ? normalizeCommunity(community, true) : null;
  function roomId(name) { if (!NAMES.includes(name) || !validRoom(community?.rooms?.[name])) throw error('That Better Cherri room is not configured.', 'BETTER_ROOM_NOT_CONFIGURED', 404); return community.rooms[name]; }
  const roomName = jid => NAMES.find(name => community?.rooms?.[name] === bare(jid));
  function room(name) { roomId(name); if (!rooms.has(name)) rooms.set(name, { joined: false, joining: null, own: null, occupants: new Map(), events: new Map(), refs: new Map(), features: new Set(), verifiedAt: 0 }); return rooms.get(name); }
  function setCommunity(value) {
    const selected = normalizeCommunity(typeof value === 'string' ? JSON.parse(value) : value);
    if (connection?.authenticated) for (const name of rooms.keys()) if (rooms.get(name).joined) connection.send(xml('presence', { xmlns: NS.client, to: roomId(name) + '/' + nick, type: 'unavailable' }));
    for (const data of rooms.values()) data.joining?.reject(error('The selected community changed.'));
    rooms.clear(); eventIndex.clear(); community = selected; write(COMMUNITY_KEY, getCommunity()); emit({ type: 'community', community: getCommunity() }); return getCommunity();
  }
  function user(id, display) { return { id, username: id, display: display || String(id).split('@')[0], pfp: '', avatarUrl: '', bio: '', badges: [], roles: [], isAdmin: false, isMod: false, isOwner: false, allowMessages: false, activity: null }; }
  async function me() { requireConnection(); return user(session.userId); }
  async function restore() { return connection?.authenticated ? getSession() : null; }
  function iq(stanza, { unauthenticated = false, conn = connection, timeout = 15000 } = {}) {
    if (!conn || (!unauthenticated && (!conn.authenticated || !session))) return Promise.reject(error('Sign in to Better Cherri chat first.', 'BETTER_XMPP_SIGN_IN', 401));
    const id = attr(stanza, 'id') || 'bc-iq-' + uuid(); stanza.setAttribute('id', id);
    return new Promise((resolve, reject) => {
      let settled = false, handler, timer;
      const done = (failure, response) => { if (settled) return; settled = true; clearTimeout(timer); pendingIQ.delete(cancel); if (handler) conn.deleteHandler(handler); failure ? reject(failure) : resolve(response); };
      const cancel = () => done(error('The chat connection closed before the server replied.', 'BETTER_XMPP_CONNECTION', 503)); pendingIQ.add(cancel);
      timer = setTimeout(() => done(error('The chat server did not confirm this operation. Check the room before trying again.', 'BETTER_XMPP_TIMEOUT', 504)), timeout);
      if (unauthenticated) { handler = conn._addSysHandler(response => { attr(response, 'type') === 'error' ? done(stanzaError(response)) : done(null, response); return false; }, null, 'iq', null, id); conn.send(stanza); conn.flush?.(); }
      else conn.sendIQ(stanza, response => done(null, response), response => done(response ? stanzaError(response) : error('The chat server did not reply.', 'BETTER_XMPP_TIMEOUT', 504)), timeout);
    });
  }
  function clearConnection(reason) {
    session = null;
    for (const cancel of [...pendingIQ]) cancel();
    for (const pending of pendingEcho.values()) { clearTimeout(pending.timer); pending.reject(error(reason || 'The chat connection closed.', 'BETTER_XMPP_CONNECTION', 503)); } pendingEcho.clear();
    eventIndex.clear();
    for (const data of rooms.values()) { data.joined = false; data.verifiedAt = 0; data.joining?.reject(error('The chat connection closed.', 'BETTER_XMPP_CONNECTION', 503)); data.joining = null; data.occupants.clear(); data.events.clear(); data.refs.clear(); data.own=null; }
    emit({ type: 'session', session: null }); emit({ type: 'status', connected: false, error: reason || 'Sign in again to reconnect chat.' });
  }
  function username(value) { const input = String(value || '').trim(); const name = input.endsWith('@' + DOMAIN) ? input.slice(0, -DOMAIN.length - 1) : input; if (!/^[a-z0-9._-]{2,64}$/.test(name)) throw error('Use a username with at least two lowercase letters or numbers on yax.im.', 'BETTER_XMPP_USERNAME'); return name; }
  async function login(value, password) {
    if (connecting) throw error('A chat connection is already starting.', 'BETTER_XMPP_BUSY', 409);
    const name = username(value), secret = String(password || ''); if (!secret) throw error('Enter your password.');
    if (connection) await logout();
    const S = sdk(); connecting = true;
    const conn = new S.Connection(SERVICE, { mechanisms: [S.SASLSHA512, S.SASLSHA384, S.SASLSHA256, S.SASLSHA1].filter(Boolean) });
    connection = conn;
    try {
      await new Promise((resolve, reject) => {
        let settled = false; const timer = setTimeout(() => finish(error('Sign-in timed out. Try again when the server is reachable.', 'BETTER_XMPP_TIMEOUT', 504)), 20000);
        function finish(failure) { if (settled) return; settled = true; clearTimeout(timer); failure ? reject(failure) : resolve(); }
        conn.connect(name + '@' + DOMAIN + '/better-' + uuid().slice(0, 10), secret, status => {
          if (status === S.Status.CONNECTED) {
            if(connection!==conn){conn.pass=null;conn.disconnect?.();return;}
            if (bare(conn.jid) !== name + '@' + DOMAIN) return finish(error('The server returned a different account identity.', 'BETTER_XMPP_IDENTITY', 401));
            conn.pass = null; // SDK-derived SCRAM keys remain only in this tab.
            session = { userId: bare(conn.jid), deviceId: String(conn.jid).split('/')[1] || '' }; nick = name + '-bc-' + uuid().slice(0, 7);
            conn.addHandler(handlePresence, null, 'presence'); conn.addHandler(handleMessage, null, 'message');
            conn.send(xml('presence', { xmlns: NS.client })); emit({ type: 'session', session: getSession() }); emit({ type: 'status', connected: true }); finish();
          } else if ([S.Status.AUTHFAIL, S.Status.CONNFAIL, S.Status.ERROR, S.Status.DISCONNECTED, S.Status.CONNTIMEOUT].includes(status)) {
            const failure = error(status === S.Status.AUTHFAIL ? 'Your username or password was rejected. The server may also restrict a newly registered account for spam prevention.' : 'The chat connection closed. Sign in again to reconnect.', status === S.Status.AUTHFAIL ? 'BETTER_XMPP_AUTH' : 'BETTER_XMPP_CONNECTION', status === S.Status.AUTHFAIL ? 401 : 503);
            if (connection === conn) clearConnection(failure.message); finish(failure);
          }
        });
      });
      return getSession();
    } catch (failure) { conn.pass = null; conn.disconnect?.(); if (connection === conn) { connection = null; session = null; } throw failure; }
    finally { connecting = false; }
  }
  function getRegistrationInfo() { return { providerName: 'yax.im', usernameHint: 'username@yax.im', tokenRequired: false, termsUrl: 'https://yaxim.org/yax.im/tos/', privacyUrl: 'https://yaxim.org/yax.im/privacy/', sessionOnly: true }; }
  async function register(value, password, tokenOrOptions = {}, fourth = {}) {
    const options = typeof tokenOrOptions === 'object' && tokenOrOptions ? tokenOrOptions : fourth;
    if (options.acceptTerms !== true) throw error('Read and accept the server terms and privacy policy first.', 'BETTER_REGISTRATION_TERMS_REQUIRED');
    const name = username(value), secret = String(password || ''); if (secret.length < 8 || secret.length > 1024) throw error('Choose a password with 8 to 1,024 characters.');
    if (connecting) throw error('A chat connection is already starting.', 'BETTER_XMPP_BUSY', 409);
    const S = sdk(), conn = new S.Connection(SERVICE, { mechanisms: [S.SASLSHA1].filter(Boolean) }); conn.do_authentication = false; connecting = true;
    let created = false;
    try {
      await new Promise((resolve, reject) => {
        let settled = false; const timer = setTimeout(() => done(error('The registration connection timed out.', 'BETTER_XMPP_TIMEOUT', 504)), 15000);
        function done(failure) { if (settled) return; settled = true; clearTimeout(timer); failure ? reject(failure) : resolve(); }
        conn.xmlInput = stanza => { if (local(stanza) === 'features' || descendants(stanza, 'features').length) Promise.resolve().then(() => done()); };
        conn.connect(DOMAIN, '', status => { if ([S.Status.CONNFAIL, S.Status.ERROR, S.Status.DISCONNECTED, S.Status.CONNTIMEOUT].includes(status)) done(error('Registration is not currently reachable.', 'BETTER_XMPP_CONNECTION', 503)); });
      });
      const result = await iq(xml('iq', { xmlns: NS.client, type: 'get', to: DOMAIN }, [xml('query', { xmlns: NS.register })]), { conn, unauthenticated: true });
      const query = child(result, 'query', NS.register), form = child(query, 'x', NS.data);
      if (!query || child(query, 'x', 'jabber:x:oob')) throw error('This server now requires an external registration step. Better Cherri will not bypass it.', 'BETTER_REGISTRATION_UNSUPPORTED');
      let submission;
      if (form) {
        const fields = children(form).filter(value => local(value) === 'field');
        if (!fields.some(field => attr(field, 'var') === 'username') || !fields.some(field => attr(field, 'var') === 'password')) throw error('The server did not offer normal account registration.', 'BETTER_REGISTRATION_UNSUPPORTED');
        const unsupported = fields.find(field => child(field, 'required') && !['username', 'password', 'FORM_TYPE'].includes(attr(field, 'var')));
        if (unsupported) throw error('The server now requires extra registration verification. No email, CAPTCHA, or invitation check will be bypassed.', 'BETTER_REGISTRATION_UNSUPPORTED');
        submission = xml('x', { xmlns: NS.data, type: 'submit' }, fields.filter(field => ['username', 'password', 'FORM_TYPE'].includes(attr(field, 'var'))).map(field => xml('field', { var: attr(field, 'var') }, [xml('value', {}, [attr(field, 'var') === 'username' ? name : attr(field, 'var') === 'password' ? secret : text(child(field, 'value')) || NS.register])])));
      } else {
        if (!child(query, 'username') || !child(query, 'password') || children(query).some(field => !['username','password','instructions'].includes(local(field)))) throw error('The server registration requirements are not supported.', 'BETTER_REGISTRATION_UNSUPPORTED');
        submission = [xml('username', {}, [name]), xml('password', {}, [secret])];
      }
      await iq(xml('iq', { xmlns: NS.client, type: 'set', to: DOMAIN }, [xml('query', { xmlns: NS.register }, Array.isArray(submission) ? submission : [submission])]), { conn, unauthenticated: true }); created = true;
    } finally { connecting = false; conn.pass = null; conn.disconnect?.(); }
    try { return await login(name, secret); }
    catch (failure) { if (created) { failure.accountCreated = true; failure.message = 'Your account was created, but sign-in did not finish. Sign in using your new username and password. ' + failure.message; } throw failure; }
  }
  async function logout() {
    const old = connection; connection = null; clearConnection();
    if (old) { old.pass = null; old.disconnect?.(); } return { ok: true };
  }
  function handlePresence(stanza) {
    const name = roomName(attr(stanza, 'from')); if (!name) return true;
    const data = room(name), from = attr(stanza, 'from'), occupant = from.split('/').slice(1).join('/'), x = child(stanza, 'x', NS.user), item = child(x, 'item');
    if (attr(stanza, 'type') === 'error') { data.joining?.reject(stanzaError(stanza)); data.joining = null; return true; }
    const self = descendants(x, 'status').some(value => attr(value, 'code') === '110');
    if (attr(stanza, 'type') === 'unavailable') { data.occupants.delete(occupant); if (self) { data.joined = false; data.verifiedAt = 0; emit({ type: 'membership', room: name, joined: false }); } }
    else {
      const jid = bare(attr(item, 'jid')); if (validJid(jid)) data.occupants.set(occupant, { jid, affiliation: attr(item, 'affiliation'), role: attr(item, 'role') });
      if (self) { data.joined = true; data.own = { jid: session?.userId, affiliation: attr(item, 'affiliation'), role: attr(item, 'role') }; data.joining?.resolve({ created: descendants(x, 'status').some(value => attr(value, 'code') === '201') }); data.joining = null; }
    }
    emit({ type: 'members', room: name }); return true;
  }
  async function joinRoom(name) {
    requireConnection(); const data = room(name); if (data.joined) return { created: false }; if (data.joining) return data.joining.promise;
    let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; });
    const timer = setTimeout(() => { data.joining = null; reject(error('The server did not confirm room membership.', 'BETTER_XMPP_TIMEOUT', 504)); }, 15000);
    data.joining = { promise, resolve: value => { clearTimeout(timer); resolve(value); }, reject: failure => { clearTimeout(timer); reject(failure); } };
    connection.send(xml('presence', { xmlns: NS.client, to: roomId(name) + '/' + nick }, [xml('x', { xmlns: NS.muc }, [xml('history', { maxstanzas: '0' })])])); connection.flush?.(); return promise;
  }
  async function disco(name) { const result = await iq(xml('iq', { xmlns: NS.client, type: 'get', to: roomId(name) }, [xml('query', { xmlns: NS.disco })])); return new Set(descendants(result, 'feature').map(value => attr(value, 'var'))); }
  function formFields(form) { return new Map(children(form).filter(value => local(value) === 'field').map(field => [attr(field, 'var'), { type: attr(field, 'type'), required: !!child(field, 'required'), values: children(field).filter(value => local(value) === 'value').map(text), element: field }])); }
  const REQUIREMENTS = { 'muc#roomconfig_persistentroom': '1', 'muc#roomconfig_membersonly': '1', 'muc#roomconfig_publicroom': '0', 'muc#roomconfig_whois': 'anyone', 'muc#roomconfig_allowinvites': '0', 'muc#roomconfig_enablearchiving': '1' };
  const truth = value => value === '1' || value === 'true';
  function privateForm(fields,archiveVerified=false) { return Object.entries(REQUIREMENTS).every(([key,value]) => (key==='muc#roomconfig_enablearchiving'&&!fields.has(key)&&archiveVerified)||(fields.has(key) && (value === '1' ? truth(fields.get(key).values[0]) : value === '0' ? ['0','false'].includes(fields.get(key).values[0]) : fields.get(key).values[0] === value))); }
  async function ownerFields(name) { const result = await iq(xml('iq', { xmlns: NS.client, type: 'get', to: roomId(name) }, [xml('query', { xmlns: NS.owner })])); const form = child(child(result, 'query', NS.owner), 'x', NS.data); if (!form) throw error('The server did not supply room configuration.', 'BETTER_ROOM_UNSUPPORTED', 409); return formFields(form); }
  async function configurePrivate(name) {
    const fields = await ownerFields(name);
    const forcedArchive=!fields.has('muc#roomconfig_enablearchiving')&&(await disco(name)).has(NS.mam);
    for (const key of Object.keys(REQUIREMENTS)) if (!fields.has(key)&&!(key==='muc#roomconfig_enablearchiving'&&forcedArchive)) throw error('The server cannot verify required private, persistent room settings (' + key + ').', 'BETTER_ROOM_UNSUPPORTED', 409);
    const overrides = { ...REQUIREMENTS, 'muc#roomconfig_roomname': 'Better Cherri · ' + name.slice(7), 'muc#roomconfig_changesubject': '0', 'muc#roomconfig_moderatedroom': '0' };
    const submitted = [];
    for (const [key, field] of fields) {
      const values = Object.hasOwn(overrides, key) ? [overrides[key]] : field.values;
      if (field.required && !values.length) throw error('The room requires an unsupported setting (' + key + ').', 'BETTER_ROOM_UNSUPPORTED', 409);
      submitted.push(xml('field', { var: key }, values.map(value => xml('value', {}, [value]))));
    }
    await iq(xml('iq', { xmlns: NS.client, type: 'set', to: roomId(name) }, [xml('query', { xmlns: NS.owner }, [xml('x', { xmlns: NS.data, type: 'submit' }, submitted)])]));
    if (!privateForm(await ownerFields(name),(await disco(name)).has(NS.mam))) throw error('The server did not retain the private room settings. Chat remains disconnected for this room.', 'BETTER_ROOM_NOT_PRIVATE', 403);
  }
  async function verifyRoom(name, force = false) {
    const data = room(name); await joinRoom(name);
    if (!force && data.verifiedAt && Date.now() - data.verifiedAt < 15000) return data;
    const features = await disco(name);
    for (const feature of ['muc_membersonly','muc_hidden','muc_persistent','muc_nonanonymous',NS.mam]) if (!features.has(feature)) throw error('The room is missing required private, persistent archive support (' + feature + ').', 'BETTER_ROOM_NOT_PRIVATE', 403);
    if (!['owner','admin','member'].includes(data.own?.affiliation)) throw error('Your account is not a member of this private room.', 'forbidden', 403);
    if (data.own.affiliation === 'owner' && !privateForm(await ownerFields(name),features.has(NS.mam))) throw error('The room’s private archive settings changed. Ask its owner to restore them.', 'BETTER_ROOM_NOT_PRIVATE', 403);
    data.features = features; data.verifiedAt = Date.now(); return data;
  }
  async function createCommunity() {
    requireConnection(); if (creating) return creating;
    creating = (async () => {
      if (!community) community = normalizeCommunity({ rooms: {} }, true);
      const group = Object.values(community.rooms)[0]?.slice(7,39)||uuid();
      for (const name of NAMES) {
        if (community.rooms[name]) { await verifyRoom(name); continue; }
        community.rooms[name] = 'better-' + group + '-' + name.slice(7) + '@' + MUC;
        let newlyCreated = false;
        try {
          newlyCreated = (await joinRoom(name)).created;
          if (!newlyCreated) throw error('The new room address already exists. Try setup again.', 'BETTER_ROOM_CONFLICT', 409);
          await configurePrivate(name); await verifyRoom(name, true);
          await getMessages(name, { limit: 1 }); // Confirm actual member-scoped MAM access.
          write(COMMUNITY_KEY, getCommunity()); emit({ type: 'community', community: getCommunity() });
        } catch (failure) {
          if (newlyCreated) try { await iq(xml('iq', { xmlns: NS.client, type: 'set', to: roomId(name) }, [xml('query', { xmlns: NS.owner }, [xml('destroy')])])); } catch {}
          delete community.rooms[name]; rooms.delete(name); throw failure;
        }
      }
      return getCommunity();
    })();
    try { return await creating; } finally { creating = null; }
  }
  async function joinCommunity() { requireConnection(); const results=[]; for (const name of NAMES) try { await verifyRoom(name, true); results.push({name,joined:true}); } catch(failure) { results.push({name,joined:false,error:failure.message,code:failure.code}); } emit({type:'membership',results}); return results; }
  async function listChannels() { requireConnection(); const list=[]; for (const [position,name] of NAMES.entries()) if (community?.rooms?.[name]) { await verifyRoom(name); list.push({name,kind:'text',position,categoryId:1,locked:false,canPost:true,allowMedia:false,allowAnyLink:true,trustedOnly:false,slowmode:0,wordFilter:false,postRoleIds:[],viewRoleIds:[]}); } return list; }
  async function affiliations(name, affiliation) { const result=await iq(xml('iq',{xmlns:NS.client,type:'get',to:roomId(name)},[xml('query',{xmlns:NS.admin},[xml('item',{affiliation})])])); return descendants(child(result,'query',NS.admin),'item').map(item=>bare(attr(item,'jid'))).filter(validJid); }
  async function listMembers() {
    requireConnection(); const members=new Map();
    for (const channel of await listChannels()) {
      const data=room(channel.name); for(const {jid} of data.occupants.values()) members.set(jid,user(jid));
      for(const affiliation of ['owner','admin','member']) try { for(const jid of await affiliations(channel.name,affiliation)) members.set(jid,user(jid)); } catch(failure) { if(failure.status!==403) throw failure; }
    }
    return [...members.values()].sort((a,b)=>a.display.localeCompare(b.display));
  }
  async function invite(jid) {
    if(!validJid(jid))throw error('Enter a full chat address, such as friend@yax.im.'); const results=[];
    for(const name of NAMES) try {
      const data=await verifyRoom(name); if(!['owner','admin'].includes(data.own?.affiliation))throw error('Only this room’s owner can add members.','forbidden',403);
      await iq(xml('iq',{xmlns:NS.client,type:'set',to:roomId(name)},[xml('query',{xmlns:NS.admin},[xml('item',{jid,affiliation:'member'})])]));
      connection.send(xml('message',{xmlns:NS.client,to:roomId(name)},[xml('x',{xmlns:NS.user},[xml('invite',{to:jid},[xml('reason',{},['Join Better Cherri'])])])])); results.push({name,invited:true});
    } catch(failure) { results.push({name,invited:false,error:failure.message,code:failure.code}); }
    return results;
  }
  function numericId(name,eventId,stamp) {
    const key=roomId(name)+'\n'+eventId; if(aliases.has(key))return aliases.get(key);
    let hash=2166136261;for(const c of eventId)hash=Math.imul(hash^c.charCodeAt(0),16777619);
    const bucket=Math.max(1,Math.min(8000000000000,Date.parse(stamp)||Date.now()))*1000;let id;
    for(let i=0;i<1000;i++){const candidate=bucket+(((hash>>>0)+i)%1000);if(!reserved.has(candidate)||reserved.get(candidate)===key){id=candidate;break;}}
    if(id==null)throw error('Too many messages share one timestamp to display safely.','BETTER_MESSAGE_ID_CAPACITY',409);
    aliases.set(key,id);reserved.set(id,key);write(IDS_KEY,[...aliases]);return id;
  }
  function sender(name,stanza,archived=false) {
    const data=room(name), from=attr(stanza,'from'), occupant=from.split('/').slice(1).join('/');
    // Live payload extensions are sender-controlled. Only server-delivered
    // presence establishes a live occupant's real JID. For matched MAM
    // results, Prosody appends its authoritative muc#user item LAST.
    const serverX=children(stanza).filter(value=>local(value)==='x'&&xmlns(value)===NS.user).at(-1);
    const item=children(serverX).filter(value=>local(value)==='item').at(-1);
    const archiveJid=bare(attr(item,'jid')),mapped=data.occupants.get(occupant)?.jid;
    const trusted=archived?validJid(archiveJid):validJid(mapped);
    const id=trusted?(archived?archiveJid:mapped):roomId(name)+'#unknown-'+occupant;
    return {id,display:occupant||'Member',key:id,trusted};
  }
  function learn(name,stanza,archiveId,stamp) {
    if(bare(attr(stanza,'from'))!==roomId(name)||attr(stanza,'type')!=='groupchat')return null;
    if(archiveId&&child(stanza,'retracted',NS.retract)){const data=room(name),existing=data.events.get(archiveId);if(existing){if(existing.id!=null){eventIndex.delete(existing.id);emit({type:'delete',room:name,messageId:existing.id});}data.events.delete(archiveId);}return null;}
    if(!child(stanza,'body')&&!child(stanza,'replace',NS.correct)&&!child(stanza,'reactions',NS.reactions)&&!child(stanza,'retract',NS.retract))return null;
    const data=room(name), sid=children(stanza).filter(value=>local(value)==='stanza-id'&&xmlns(value)===NS.sid&&attr(value,'by')===roomId(name)).at(-1), eventId=archiveId||attr(sid,'id');
    if(!eventId)return null;
    const wire=attr(stanza,'id')||attr(child(stanza,'origin-id',NS.sid),'id')||eventId;
    const sentAt=archiveId?(stamp||new Date().toISOString()):new Date().toISOString();
    const event={eventId,wire,origin:attr(child(stanza,'origin-id',NS.sid),'id'),stanza,from:sender(name,stanza,!!archiveId),sentAt}; data.events.set(eventId,event);data.refs.set(eventId,eventId);if(!data.refs.has(wire))data.refs.set(wire,eventId);if(event.origin&&!data.refs.has(event.origin))data.refs.set(event.origin,eventId);
    if(!child(stanza,'replace',NS.correct)&&!child(stanza,'reactions',NS.reactions)&&!child(stanza,'retract',NS.retract)) {event.id=numericId(name,eventId,sentAt);eventIndex.set(event.id,{name,eventId});}
    return event;
  }
  function referenced(data,reference,authorKey,from) {
    const exact=data.events.get(reference);if(exact&&exact.id!=null&&(!authorKey||exact.from.key===authorKey))return exact;
    return [...data.events.values()].filter(event=>event.id!=null&&(event.wire===reference||event.origin===reference)&&(!authorKey||event.from.key===authorKey)&&(!from||attr(event.stanza,'from')===from)).sort((a,b)=>Date.parse(a.sentAt)-Date.parse(b.sentAt))[0];
  }
  function mapMessage(name,event) {
    if(!event||event.id==null)return null;const data=room(name);let content=text(child(event.stanza,'body')),editedAt=null,deleted=false;const reactionSets=new Map();
    for(const mutation of data.events.values()) {
      const replace=child(mutation.stanza,'replace',NS.correct),retract=child(mutation.stanza,'retract',NS.retract),reactions=child(mutation.stanza,'reactions',NS.reactions);
      const reference=replace||retract||reactions;if(!reference||referenced(data,attr(reference,'id'),replace||retract?mutation.from.key:null)?.eventId!==event.eventId)continue;
      if((replace||retract)&&(!mutation.from.trusted||!event.from.trusted||mutation.from.key!==event.from.key))continue;
      if(replace&&(!editedAt||Date.parse(mutation.sentAt)>=Date.parse(editedAt))){content=text(child(mutation.stanza,'body'));editedAt=mutation.sentAt;}
      if(retract)deleted=true;
      if(reactions){const previous=reactionSets.get(mutation.from.id);if(!previous||Date.parse(mutation.sentAt)>=Date.parse(previous.at))reactionSets.set(mutation.from.id,{at:mutation.sentAt,emojis:children(reactions).filter(value=>local(value)==='reaction').map(text)});}
    }
    if(deleted)return null;
    const reactionUsers=new Map();for(const[id,entry]of reactionSets)for(const emoji of entry.emojis){if(!reactionUsers.has(emoji))reactionUsers.set(emoji,new Set());reactionUsers.get(emoji).add(id);}
    const reply=child(event.stanza,'reply',NS.reply),target=referenced(data,attr(reply,'id'),null,attr(reply,'to'));
    return {id:event.id,eventId:event.eventId,room:name,fromUserId:event.from.id,username:event.from.id,display:event.from.display,avatarUrl:'',badges:'[]',content,sentAt:event.sentAt,editedAt,replyToId:target?.id??null,replyUsername:target?.from.id||null,replyContent:target?text(child(target.stanza,'body')):null,reactions:[...reactionUsers].map(([emoji,ids])=>({emoji,userIds:[...ids]}))};
  }
  function findMessage(id) { const found=eventIndex.get(Number(id));if(!found||!community?.rooms?.[found.name])throw error('Reload this private room before changing that message.','BETTER_MESSAGE_UNKNOWN',404);const event=room(found.name).events.get(found.eventId);if(!event)throw error('Message unavailable.','BETTER_MESSAGE_UNKNOWN',404);return {...found,event}; }
  function getCachedMessage(id) {try{const found=findMessage(id);return mapMessage(found.name,found.event);}catch{return null;}}
  function handleMessage(stanza) {
    const name=roomName(attr(stanza,'from'));if(!name)return true;
    let wire=attr(stanza,'id');if(!pendingEcho.has(wire))wire=attr(child(stanza,'origin-id',NS.sid),'id');let pending=pendingEcho.get(wire);
    if(pending&&pending.name!==name)pending=null;
    if(attr(stanza,'type')==='error'){if(pending){clearTimeout(pending.timer);pendingEcho.delete(wire);pending.reject(stanzaError(stanza));}return true;}
    const data=room(name);if(!data.joined||!data.verifiedAt)return true;
    const liveSender=sender(name,stanza);if(!liveSender.trusted)return true;
    if(pending&&(liveSender.id!==pending.userId||payloadSignature(stanza)!==pending.signature))pending=null;
    const composing=child(stanza,'composing',NS.chat);if(composing){if(liveSender.id!==session?.userId)emit({type:'typing',room:name,userId:liveSender.id,username:liveSender.id});}
    const event=learn(name,stanza);if(!event){if(pending){clearTimeout(pending.timer);pendingEcho.delete(wire);pending.reject(error('The server did not supply a saved archive ID. Reload before trying again.','BETTER_ARCHIVE_CONFIRMATION',503));}return true;}
    const replace=child(stanza,'replace',NS.correct),reactions=child(stanza,'reactions',NS.reactions),retract=child(stanza,'retract',NS.retract),reference=replace||reactions||retract;
    if(reference){const target=referenced(data,attr(reference,'id'),replace||retract?event.from.key:null),message=mapMessage(name,target);if(target?.id!=null){if(replace&&message)emit({type:'edit',room:name,message});else if(reactions&&message)emit({type:'reaction',room:name,messageId:target.id,reactions:message.reactions});else if(retract&&!message)emit({type:'delete',room:name,messageId:target.id});}}
    else {const message=mapMessage(name,event);if(message)emit({type:'message',room:name,message});}
    if(pending){clearTimeout(pending.timer);pendingEcho.delete(wire);pending.resolve(event);}return true;
  }
  function payloadSignature(stanza){const reply=child(stanza,'reply',NS.reply),replace=child(stanza,'replace',NS.correct),retract=child(stanza,'retract',NS.retract),reactions=child(stanza,'reactions',NS.reactions);return JSON.stringify({body:text(child(stanza,'body')),reply:reply?[attr(reply,'id'),attr(reply,'to')]:null,replace:replace?attr(replace,'id'):null,retract:retract?attr(retract,'id'):null,reactions:reactions?[attr(reactions,'id'),children(reactions).filter(value=>local(value)==='reaction').map(text)]:null});}
  async function getMessages(name,options={}) {
    const data=await verifyRoom(name);const queryId='bc-mam-'+uuid(),results=[];let rawCount=0;const conn=requireConnection();
    const handler=conn.addHandler(stanza=>{
      if(attr(stanza,'from')!==roomId(name))return true;const result=child(stanza,'result',NS.mam);if(attr(result,'queryid')!==queryId)return true;
      rawCount++;const forwarded=child(result,'forwarded',NS.forward),message=child(forwarded,'message'),delay=child(forwarded,'delay',NS.delay);if(message){const event=learn(name,message,attr(result,'id'),attr(delay,'stamp'));if(event)results.push(event);}return true;
    },NS.mam,'message');
    try {
      const limit=Math.min(100,Math.max(1,Number(options.limit)||50));const before=options.before==null?'':String(options.before);
      const response=await iq(xml('iq',{xmlns:NS.client,type:'set',to:roomId(name)},[xml('query',{xmlns:NS.mam,queryid:queryId},[xml('x',{xmlns:NS.data,type:'submit'},[xml('field',{var:'FORM_TYPE',type:'hidden'},[xml('value',{},[NS.mam])])]),xml('set',{xmlns:NS.rsm},[xml('max',{},[String(limit)]),xml('before',{},[before])])])]));
      const fin=child(response,'fin',NS.mam);if(!fin)throw error('The server did not confirm saved message history.','BETTER_ARCHIVE_UNSUPPORTED',503);
      const cursor=text(child(child(fin,'set',NS.rsm),'first'));const messages=results.map(event=>mapMessage(name,event)).filter(Boolean).sort((a,b)=>a.id-b.id);
      return {messages,before:cursor||null,exhausted:truth(attr(fin,'complete'))||!rawCount||!cursor||cursor===before};
    } finally {conn.deleteHandler(handler);}
  }
  async function confirmedSend(name,childrenToSend) {
    await verifyRoom(name);const wire='bc-msg-'+uuid();const conn=requireConnection();
    const stanza=xml('message',{xmlns:NS.client,type:'groupchat',to:roomId(name),id:wire},[...childrenToSend,xml('origin-id',{xmlns:NS.sid,id:wire}),xml('store',{xmlns:'urn:xmpp:hints'})]);
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pendingEcho.delete(wire);reject(error('The server did not confirm saving this message. Reload the room before trying again.','BETTER_XMPP_TIMEOUT',504));},15000);pendingEcho.set(wire,{resolve,reject,timer,name,userId:session.userId,signature:payloadSignature(stanza)});conn.send(stanza);conn.flush?.();});
  }
  function body(value){const content=String(value??'');if(!content.trim()||content.length>8000)throw error('Enter a message with 1 to 8,000 characters.');return content;}
  async function sendMessage(name,value){const input=typeof value==='string'?{content:value}:value||{},payload=[xml('body',{},[body(input.content)])];if(input.replyToId!=null){const target=findMessage(input.replyToId);if(target.name!==name)throw error('Replies must stay in the same private room.');payload.push(xml('reply',{xmlns:NS.reply,to:attr(target.event.stanza,'from'),id:target.event.wire}));}const event=await confirmedSend(name,payload);return mapMessage(name,event);}
  async function edit(id,value){const target=findMessage(id);if(target.event.from.id!==session?.userId)throw error('You can edit only your own messages.','forbidden',403);await confirmedSend(target.name,[xml('body',{},[body(typeof value==='string'?value:value?.content)]),xml('replace',{xmlns:NS.correct,id:target.event.wire})]);return getCachedMessage(id);}
  async function remove(id){const target=findMessage(id);if(target.event.from.id!==session?.userId)throw error('You can delete only your own messages.','forbidden',403);const data=await verifyRoom(target.name);if(!data.features.has(NS.retract))throw error('This room server does not advertise saved message retraction.','BETTER_RETRACTION_UNSUPPORTED',501);await confirmedSend(target.name,[xml('body',{},['[Message deleted]']),xml('retract',{xmlns:NS.retract,id:target.event.eventId})]);return{ok:true};}
  async function react(id,emoji){if(typeof emoji!=='string'||!emoji.trim()||emoji.length>64)throw error('Choose a reaction emoji.');const target=findMessage(id),message=getCachedMessage(id);if(!message)throw error('Message unavailable.');const selected=message.reactions.filter(reaction=>reaction.userIds.includes(session?.userId)).map(reaction=>reaction.emoji);const next=selected.includes(emoji)?selected.filter(value=>value!==emoji):[...selected,emoji];await confirmedSend(target.name,[xml('body',{},['[Reaction updated]']),xml('reactions',{xmlns:NS.reactions,id:target.event.eventId},next.map(value=>xml('reaction',{},[value])))]);return{reactions:getCachedMessage(id)?.reactions||[]};}
  async function typing(name){await verifyRoom(name);connection.send(xml('message',{xmlns:NS.client,type:'groupchat',to:roomId(name)},[xml('composing',{xmlns:NS.chat})]));return{ok:true};}
  async function search(){throw error('This server does not provide full-text archive search through this version.','BETTER_SEARCH_UNSUPPORTED',501);}
  function subscribe(listener){if(typeof listener!=='function')throw error('A chat subscription callback is required.');listeners.add(listener);return()=>listeners.delete(listener);}
  try{const configured=globalThis.__BETTER_XMPP_COMMUNITY__||read(COMMUNITY_KEY);if(configured)community=normalizeCommunity(configured,true);}catch{}
  try{for(const item of read(IDS_KEY)||[])if(Array.isArray(item)&&typeof item[0]==='string'&&Number.isSafeInteger(item[1])&&item[1]>0&&!reserved.has(item[1])){aliases.set(item[0],item[1]);reserved.set(item[1],item[0]);}}catch{}
  globalThis.__betterXmpp=Object.freeze({SERVICE,DOMAIN,MUC,ROOM_NAMES:Object.freeze(NAMES),login,register,getRegistrationInfo,restore,whoami:restore,logout,getSession,me,createCommunity,setCommunity,getCommunity,exportCommunity:()=>JSON.stringify(getCommunity(),null,2),joinCommunity,listChannels,channels:listChannels,listMembers,members:listMembers,invite,getMessages,messages:getMessages,sendMessage,send:sendMessage,edit,remove,react,typing,search,subscribe,getCachedMessage});
})();
