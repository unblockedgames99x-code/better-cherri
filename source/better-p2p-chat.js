/* Better Cherri live rooms. Chitchatter hosts the browser client and uses
   public connection services; messages travel between participating browsers.
   Room secrets are shared invite capabilities, not account memberships. */
(() => {
  'use strict';
  const HOST = 'https://chitchatter.im';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ROOM_NAME = /^better-[a-z0-9][a-z0-9_-]{0,47}$/;
  const BASE_STATUS = 'Messages connect directly between room participants. No saved history remains when everyone leaves.';

  function validateRooms(value) {
    if (!Array.isArray(value) || value.length !== 3) throw new Error('This launcher needs three configured Better Cherri rooms.');
    const ids = new Set(), names = new Set(), secrets = new Set();
    return value.map(room => {
      if (!room || typeof room !== 'object' || typeof room.name !== 'string' || !ROOM_NAME.test(room.name) ||
          typeof room.label !== 'string' || !room.label.trim() || room.label.length > 48 ||
          typeof room.id !== 'string' || !UUID.test(room.id) ||
          typeof room.secret !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(room.secret)) {
        throw new Error('The Better Cherri room configuration is invalid. Use an updated launcher.');
      }
      let secretBytes;
      try { secretBytes = atob(room.secret); } catch { throw new Error('A Better Cherri room secret is invalid.'); }
      if (secretBytes.length !== 32 || btoa(secretBytes) !== room.secret || new Set(secretBytes).size < 2) {
        throw new Error('Each Better Cherri room needs its own random 32-byte secret.');
      }
      const id = room.id.toLowerCase();
      if (ids.has(id) || names.has(room.name) || secrets.has(room.secret)) throw new Error('Better Cherri rooms must have separate names, IDs, and secrets.');
      ids.add(id); names.add(room.name); secrets.add(room.secret);
      return Object.freeze({name: room.name, label: room.label.trim(), id, secret: room.secret});
    });
  }

  function privateRoomUrl(room) {
    // Only validated UUIDs and a fixed host enter the path. The secret stays in
    // the fragment, which is not sent in an HTTP request to the hosted client.
    return HOST + '/private/' + room.id + '?embed#secret=' + encodeURIComponent(room.secret);
  }

  function mount(container, options = {}) {
    if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('Better Cherri chat needs a DOM container.');
    const doc = container.ownerDocument || document;
    const el = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const root = el('section', 'bcp2p');
    const style = el('style');
    style.textContent = '.bcp2p{--bc-pink:#ef7193;--bc-bg:#10090d;--bc-panel:#1b1116;--bc-line:#38212c;--bc-muted:#c4a7b4;box-sizing:border-box;display:flex;flex-direction:column;min-height:100%;height:100%;color:#f9eef3;background:var(--bc-bg);font:14px/1.5 Inter,system-ui,sans-serif}.bcp2p *{box-sizing:border-box}.bcp2p header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px;padding:20px 24px;border-bottom:1px solid var(--bc-line)}.bcp2p h1{margin:0;font-size:21px;line-height:1.3;letter-spacing:-.4px}.bcp2p p{margin:7px 0 0;color:var(--bc-muted)}.bcp2p .bcp2p-layout{display:grid;grid-template-columns:205px minmax(0,1fr);flex:1;min-height:530px;overflow:hidden}.bcp2p aside{padding:20px 12px;border-right:1px solid var(--bc-line);background:#150d12}.bcp2p .bcp2p-side-label{margin:0 10px 12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--bc-muted)}.bcp2p .bcp2p-room{display:block;width:100%;text-align:left;padding:11px 13px;margin:4px 0;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--bc-muted);font:inherit;cursor:pointer}.bcp2p .bcp2p-room:hover{background:#24151d;color:#fff}.bcp2p .bcp2p-room[aria-pressed=true]{background:#3b1b2b;border-color:#633147;color:#ffd4e3}.bcp2p .bcp2p-room-name{display:block;font-size:11px;opacity:.75}.bcp2p .bcp2p-main{display:flex;flex-direction:column;min-width:0;min-height:0}.bcp2p .bcp2p-room-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:15px 20px;border-bottom:1px solid var(--bc-line)}.bcp2p h2{font-size:16px;margin:0}.bcp2p .bcp2p-actions{display:flex;gap:9px;flex-wrap:wrap}.bcp2p .bcp2p-action{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border:1px solid #633147;border-radius:9px;background:#2d1722;color:#ffd4e3;text-decoration:none;font:inherit;cursor:pointer}.bcp2p .bcp2p-action:hover{background:#482238}.bcp2p button:focus-visible,.bcp2p a:focus-visible,.bcp2p input:focus-visible{outline:2px solid #ffa9c4;outline-offset:3px}.bcp2p .bcp2p-status{margin:0;padding:10px 20px;border-bottom:1px solid var(--bc-line);font-size:12px}.bcp2p .bcp2p-frame{display:block;width:100%;height:100%;min-height:430px;flex:1;border:0;background:#121212}.bcp2p .bcp2p-invite{margin:12px 20px;padding:10px;width:calc(100% - 40px);border:1px solid #633147;border-radius:8px;background:#21121b;color:#fff;font:12px/1.5 monospace}.bcp2p footer{padding:12px 20px;border-top:1px solid var(--bc-line);color:var(--bc-muted);font-size:12px}.bcp2p .bcp2p-error{padding:32px;max-width:660px}.bcp2p [hidden]{display:none!important}@media(max-width:700px){.bcp2p header{padding:17px}.bcp2p .bcp2p-layout{grid-template-columns:1fr;overflow:visible}.bcp2p aside{display:flex;gap:5px;flex-wrap:wrap;border-right:0;border-bottom:1px solid var(--bc-line);padding:10px}.bcp2p .bcp2p-side-label{width:100%;margin:0 7px 3px}.bcp2p .bcp2p-room{width:auto;flex:1;min-width:90px;padding:8px}.bcp2p .bcp2p-room-name{font-size:10px}.bcp2p .bcp2p-room-head{padding:13px}.bcp2p .bcp2p-frame{min-height:520px}.bcp2p .bcp2p-status{padding:10px 13px}}';
    root.append(style);
    let rooms;
    try { rooms = validateRooms(globalThis.__BETTER_CHERRI_P2P_ROOMS__); }
    catch (error) {
      const errorCard = el('div', 'bcp2p-error');
      errorCard.append(el('h1', '', 'Better Cherri chat'), el('p', '', error.message));
      root.append(errorCard); container.replaceChildren(root);
      return () => { if (root.parentNode === container) root.remove(); };
    }

    let destroyed = false, activeIndex = -1;
    const header = el('header');
    const introduction = el('div');
    introduction.append(el('h1', '', options.membersOnly ? 'Better Cherri members' : 'Better Cherri chat'));
    introduction.append(el('p', '', options.membersOnly
      ? 'Members are the peers shown inside the selected room. Only currently connected peers appear.'
      : 'Private live rooms for your Better Cherri group. No Cherri account is needed.'));
    header.append(introduction);
    const layout = el('div', 'bcp2p-layout');
    const sidebar = el('aside');
    sidebar.setAttribute('aria-label', 'Better Cherri rooms');
    sidebar.append(el('p', 'bcp2p-side-label', 'Better Cherri rooms'));
    const main = el('div', 'bcp2p-main');
    const roomHeader = el('div', 'bcp2p-room-head');
    const title = el('h2');
    const actions = el('div', 'bcp2p-actions');
    const open = el('a', 'bcp2p-action', 'Open room directly');
    open.target = '_blank'; open.rel = 'noopener noreferrer'; open.referrerPolicy = 'no-referrer';
    const copy = el('button', 'bcp2p-action', 'Copy private invite');
    copy.type = 'button';
    actions.append(open, copy); roomHeader.append(title, actions);
    const status = el('p', 'bcp2p-status', BASE_STATUS);
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const manualInvite = el('input', 'bcp2p-invite');
    manualInvite.type = 'text'; manualInvite.readOnly = true; manualInvite.hidden = true;
    manualInvite.setAttribute('aria-label', 'Private room invite to copy');
    const iframe = el('iframe', 'bcp2p-frame');
    iframe.referrerPolicy = 'no-referrer';
    iframe.setAttribute('allow', 'camera; microphone; display-capture; fullscreen');
    iframe.setAttribute('allowfullscreen', '');
    // No sandbox is added: browser prompts govern media, fullscreen and
    // user-triggered downloads, as on the hosted Chitchatter client itself.
    iframe.addEventListener('error', () => {
      if (!destroyed) status.textContent = 'The embedded chat could not load. Use “Open room directly” to try the hosted room.';
    });
    const footer = el('footer', '', 'The member list is inside the room. Anyone with its private invite can join. Public connection services can be unavailable or blocked by a network.');
    main.append(roomHeader, status, manualInvite, iframe, footer);
    layout.append(sidebar, main); root.append(header, layout); container.replaceChildren(root);

    const buttons = rooms.map((room, index) => {
      const button = el('button', 'bcp2p-room');
      button.type = 'button';
      button.append(el('span', '', '# ' + room.label), el('span', 'bcp2p-room-name', room.name));
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => selectRoom(index));
      sidebar.append(button);
      return button;
    });

    function selectRoom(index) {
      if (destroyed || activeIndex === index) return;
      activeIndex = index;
      const room = rooms[index];
      const invite = privateRoomUrl(room);
      title.textContent = '# ' + room.label;
      buttons.forEach((button, buttonIndex) => button.setAttribute('aria-pressed', String(buttonIndex === index)));
      status.textContent = BASE_STATUS;
      manualInvite.hidden = true; manualInvite.value = '';
      open.href = invite;
      iframe.title = 'Better Cherri ' + room.label + ' private live room';
      // Reusing one iframe disconnects the previous room when its URL changes.
      // Re-selecting an active room deliberately leaves its peer session intact.
      iframe.src = invite;
    }

    copy.addEventListener('click', async () => {
      if (destroyed || activeIndex < 0) return;
      const room = rooms[activeIndex];
      const invite = privateRoomUrl(room);
      try {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(invite);
        if (!destroyed) status.textContent = room.label + ' invite copied. Anyone with this private invite can join.';
      } catch {
        if (destroyed) return;
        manualInvite.value = invite; manualInvite.hidden = false;
        manualInvite.focus(); manualInvite.select();
        status.textContent = 'Copy the highlighted ' + room.label + ' private invite to share that room.';
      }
    });
    selectRoom(0);

    return () => {
      if (destroyed) return;
      destroyed = true;
      // Removing the iframe tears down its peer connection without navigating
      // the user's top-level Better Cherri page.
      iframe.remove();
      if (root.parentNode === container) root.remove();
    };
  }

  globalThis.__betterCherriP2P = Object.freeze({mount});
})();
