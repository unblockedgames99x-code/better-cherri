/* Creates only the three requested rooms through Cherri's supported API.
   A native-origin session and an existing Better Cherri role are required.
   Mounting/checking never writes; creation requires the button click. */
(() => {
  'use strict';
  const API = 'https://cherrion.top';
  const NAMES = Object.freeze(['better-general', 'better-games', 'better-music']);
  const mounted = new WeakMap();
  const safeMessage = value => typeof value === 'string' ? value.slice(0, 500) : '';
  const exactRole = (ids, roleId) => Array.isArray(ids) && ids.length > 0
    && ids.every(id => String(id) === String(roleId));
  const verifiedAccess = (room, roleId) => exactRole(room?.viewRoleIds, roleId)
    && exactRole(room?.postRoleIds, roleId);
  const nativeOrigin = () => globalThis.__BETTER_CHERRI_NATIVE_ORIGIN__ === true
    && globalThis.origin === API;

  function controller(options = {}) {
    const fetcher = options.fetch || ((...args) => globalThis.fetch(...args));
    const enabled = options.enabled || nativeOrigin;
    const token = options.getToken || (() => {
      try { return globalThis.localStorage.getItem('session_token') || ''; } catch { return ''; }
    });
    const setToken = options.setToken || (value => {
      try { globalThis.localStorage.setItem('session_token', value); } catch { /* Keep the current account UI's behavior. */ }
    });
    const publish = options.onChange || (() => {});
    const acceptedNames = new Map();
    let checking = null, creating = null;
    let state = { phase: 'idle', message: '', rooms: [], missing: [...NAMES], canCreate: false, role: null, user: null };
    const update = values => { state = { ...state, ...values }; publish(snapshot()); };
    const snapshot = () => ({ ...state, rooms: [...state.rooms], missing: [...state.missing], role: state.role && { ...state.role }, user: state.user && { ...state.user } });
    function headers() {
      const result = { 'Content-Type': 'application/json' };
      const currentToken = token();
      if (currentToken) result.Authorization = 'Bearer ' + currentToken;
      return result;
    }
    async function read(path, auth) {
      const response = await fetcher(API + path, { method: 'GET', headers: auth, credentials: 'same-origin', cache: 'no-store' });
      const value = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(safeMessage(value?.error) || `Cherri returned ${response.status} while checking room setup.`);
        error.status = response.status;
        throw error;
      }
      return value;
    }
    function check() {
      if (checking) return checking;
      checking = (async () => {
        if (!enabled()) {
          update({ phase: 'unavailable', canCreate: false, message: 'Open Better Cherri on Cherri’s site to connect rooms with your Cherri account.' });
          return snapshot();
        }
        update({ phase: 'checking', canCreate: false, message: 'Checking Better Cherri rooms…' });
        try {
          const auth = headers();
          const [account, permissions, channels] = await Promise.all([
            read('/api/auth/me', auth), read('/api/me/permissions', auth), read('/api/chat/channels', auth)
          ]);
          // Match the original account helper's native session-rotation contract.
          // A response from a previous account must never replace a newer session.
          if (typeof account?.token === 'string' && account.token
            && auth.Authorization === 'Bearer ' + token()) {
            setToken(account.token);
          }
          if (!account?.user?.id) {
            update({ phase: 'signed-out', canCreate: false, user: null, message: 'Sign in with your Cherri account to use Better Cherri rooms.' });
            return snapshot();
          }
          if (!Array.isArray(channels)) throw new Error('Cherri returned an unexpected channel list. No rooms were changed.');
          const rooms = channels.filter(room => NAMES.includes(room?.name));
          const missing = NAMES.filter(name => !rooms.some(room => room.name === name));
          const granted = Number.isSafeInteger(permissions?.permissions) ? permissions.permissions : 0;
          const mayCreate = (granted & (1 | 4)) !== 0;
          update({ user: { id: account.user.id, username: account.user.username || '' }, rooms, missing, role: null });
          const unconfirmed = [...acceptedNames].filter(([name, roleId]) => !verifiedAccess(rooms.find(room => room.name === name), roleId)).map(([name]) => name);
          if (unconfirmed.length) {
            update({ phase: 'verification-needed', canCreate: false,
              message: `Cherri accepted ${unconfirmed.map(name => '#' + name).join(', ')}, but this account cannot confirm their Better-role viewing and posting settings. The account may need the Better Cherri role. Those creation requests will not be repeated.` });
            return snapshot();
          }
          if (!mayCreate && missing.length) {
            update({ phase: 'permission-needed', canCreate: false, message: 'Cherri’s server has not enabled channel creation for this account. Existing Better Cherri rooms remain available.' });
            return snapshot();
          }
          let roles;
          try { roles = await read('/api/roles', headers()); }
          catch (error) {
            if (!missing.length) {
              update({ phase: 'ready', canCreate: false, message: 'All three Better Cherri rooms are connected. Access follows Cherri’s server permissions.' });
              return snapshot();
            }
            throw error;
          }
          if (!Array.isArray(roles)) throw new Error('Cherri returned an unexpected role list. No rooms were changed.');
          const matches = roles.filter(role => typeof role?.name === 'string'
            && /^(?:better cherri|better-cherri)$/i.test(role.name.trim())
            && (typeof role.id === 'number' && Number.isSafeInteger(role.id) || typeof role.id === 'string' && role.id.length > 0));
          if (matches.length !== 1) {
            update({ phase: missing.length ? 'role-needed' : 'ready', canCreate: false,
              message: missing.length
                ? (matches.length ? 'More than one Better Cherri role exists. No rooms were changed.' : 'Cherri’s server needs a Better Cherri role before private Better rooms can be created. No public rooms will be created.')
                : 'All three Better Cherri rooms are connected. Access follows Cherri’s server permissions.' });
            return snapshot();
          }
          const role = { id: matches[0].id, name: matches[0].name };
          const unrestricted = rooms.some(room => Array.isArray(room.viewRoleIds) && room.viewRoleIds.length === 0);
          const unknownAccess = rooms.some(room => !Array.isArray(room.viewRoleIds) || !Array.isArray(room.postRoleIds));
          if (!missing.length) {
            update({ phase: unknownAccess ? 'verification-needed' : 'ready', canCreate: false, role,
              message: unknownAccess ? 'All three Better Cherri rooms exist, but Cherri did not provide their full access settings. Better-only access cannot be confirmed; no permissions were changed.'
                : unrestricted ? 'All three Better Cherri rooms exist. Some existing rooms allow everyone to view; their permissions have not been changed.'
                  : rooms.every(room => verifiedAccess(room, role.id))
                    ? 'All three Better Cherri rooms are connected with viewing and posting restricted to the Better Cherri role.'
                    : 'All three Better Cherri rooms exist with other access settings. Their permissions have not been changed.' });
          } else {
            update({ phase: 'available', canCreate: true, role,
              message: `Create ${missing.length} missing Better Cherri ${missing.length === 1 ? 'room' : 'rooms'} with viewing and posting restricted to the Better Cherri role.` });
          }
        } catch (error) {
          update({ phase: error.status === 401 ? 'signed-out' : 'error', canCreate: false,
            message: error.status === 401 ? 'Sign in with your Cherri account to use Better Cherri rooms.'
              : safeMessage(error.message) || 'Could not check Cherri’s room setup. No rooms were changed.' });
        }
        return snapshot();
      })().finally(() => { checking = null; });
      return checking;
    }
    function create() {
      if (creating) return creating;
      creating = (async () => {
        await check();
        if (!state.canCreate || !state.role || !enabled()) return snapshot();
        const roleId = state.role.id;
        const pending = [...state.missing];
        const auth = headers();
        update({ phase: 'creating', canCreate: false, message: 'Creating Better Cherri rooms…' });
        const accepted = [], verified = [];
        for (const name of pending) {
          let wasAccepted = false;
          try {
            const response = await fetcher(API + '/api/chat/channels', {
              method: 'POST', headers: auth, credentials: 'same-origin',
              body: JSON.stringify({ name, kind: 'text', postRoleIds: [roleId], viewRoleIds: [roleId] })
            });
            const value = await response.json().catch(() => null);
            if (!response.ok) {
              throw new Error(safeMessage(value?.error) || `Cherri returned ${response.status} while creating #${name}.`);
            }
            // A successful write is never repeated. Confirm the actual resource
            // and its ACLs through the channel list rather than trusting a POST echo.
            wasAccepted = true;
            accepted.push(name);
            acceptedNames.set(name, roleId);
            const channels = await read('/api/chat/channels', headers());
            if (!Array.isArray(channels)) throw new Error(`Cherri accepted #${name}, but returned an unreadable channel list. Its access settings could not be confirmed.`);
            const rooms = channels.filter(room => NAMES.includes(room?.name));
            update({ rooms, missing: NAMES.filter(item => !rooms.some(room => room.name === item)) });
            const actual = rooms.find(room => room.name === name);
            if (!actual) throw new Error(`Cherri accepted #${name}, but it is not visible to this account. The account may need the Better Cherri role. Its access settings could not be confirmed.`);
            if (!verifiedAccess(actual, roleId)) throw new Error(`Cherri accepted #${name}, but its viewing and posting settings could not be confirmed as restricted to the Better Cherri role.`);
            verified.push(name);
          } catch (error) {
            const detail = safeMessage(error.message) || 'Cherri could not create the room.';
            update({ phase: wasAccepted ? 'verification-needed' : 'error', canCreate: false,
              message: `${wasAccepted && !detail.startsWith('Cherri accepted') ? `Cherri accepted #${name}, but its room and access settings could not be confirmed. ` : ''}${detail}${verified.length ? ` Verified ${verified.map(item => '#' + item).join(', ')} before stopping.` : ''} No further rooms were created, and no request was retried.` });
            options.onCreated?.(accepted);
            return snapshot();
          }
        }
        update({ phase: 'ready', canCreate: false, message: `Created and verified ${verified.map(item => '#' + item).join(', ')} with viewing and posting restricted to the Better Cherri role. Existing room permissions were not changed.` });
        options.onCreated?.(accepted);
        return snapshot();
      })().finally(() => { creating = null; });
      return creating;
    }
    return Object.freeze({ check, create, getState: snapshot });
  }

  function mount(container) {
    if (!nativeOrigin() || !container || mounted.has(container)) return;
    const doc = container.ownerDocument;
    const banner = doc.createElement('section');
    banner.setAttribute('aria-label', 'Better Cherri room setup');
    banner.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border-3,#38262b);background:var(--bg-2,#1c1216);color:var(--bright-text,#fff);font:13px system-ui,sans-serif;';
    const status = doc.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'flex:1 1 280px;margin:0;line-height:1.5;';
    const actions = doc.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
    const button = label => {
      const item = doc.createElement('button');
      item.type = 'button';
      item.textContent = label;
      item.style.cssText = 'border:1px solid var(--border-3,#5a3844);border-radius:9px;padding:8px 12px;background:var(--bg-3,#302027);color:inherit;font:inherit;cursor:pointer;';
      return item;
    };
    const refresh = button('Check rooms');
    const create = button('Create Better rooms');
    create.hidden = true;
    actions.append(refresh, create);
    banner.append(status, actions);
    container.replaceChildren(banner);
    const api = controller({
      onChange: value => {
        status.textContent = value.message;
        create.hidden = !value.canCreate;
        create.disabled = !value.canCreate;
        refresh.disabled = value.phase === 'creating' || value.phase === 'checking';
        banner.setAttribute('data-state', value.phase);
      },
      onCreated: rooms => {
        if (!rooms.length) return;
        globalThis.dispatchEvent(new CustomEvent('better-cherri:rooms-created', { detail: { rooms } }));
      }
    });
    mounted.set(container, api);
    refresh.addEventListener('click', () => { api.check(); });
    create.addEventListener('click', () => { api.create(); });
    api.check();
  }
  globalThis.__betterCherriRoomSetup = Object.freeze({ mount, createController: controller });
})();
