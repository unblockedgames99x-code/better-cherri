/* SPDX-License-Identifier: AGPL-3.0-or-later
 * Public community schema only. This factory is shared by the browser client,
 * launcher and release generator; it never handles account credentials. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = Object.assign({ createSchema: factory }, api);
  else root.__betterXmppSchema = api;
})(typeof globalThis === 'object' ? globalThis : this, function createSchema() {
  'use strict';
  const SERVER = 'yax.im', MUC = 'chat.yax.im';
  const groups = [
    { id: 1, name: 'Info', names: ['rules', 'announcements', 'updates', 'links'] },
    { id: 2, name: 'Social', names: ['general', 'general-2', 'art', 'share-music', 'member-shitpost'] },
    { id: 3, name: 'Suggestions', names: ['suggest-games', 'tag-ideas', 'suggest-features', 'report-issues'] }
  ];
  const names = groups.flatMap(group => group.names), allowed = [...names, 'games'];
  const aliases = { 'better-general': 'general', 'better-games': 'games', 'better-music': 'share-music', music: 'share-music' };
  const copy = value => JSON.parse(JSON.stringify(value));
  const fail = message => { throw Object.assign(new Error(message), { code: 'BETTER_COMMUNITY_INVALID', status: 400 }); };
  const validJid = value => typeof value === 'string' && /^[a-zA-Z0-9._=+-]{1,128}@[a-zA-Z0-9.-]{1,253}$/.test(value);
  function normalizeRoomName(value) { const name = aliases[value] || value; if (!allowed.includes(name)) fail('That Better Cherri channel is not configured.'); return name; }
  function categories() { return groups.map(({ id, name }, position) => ({ id, name, position })); }
  function address(namespace, name) { return 'better-' + namespace + '-' + name + '@' + MUC; }
  function createDefault(namespace, ownerJid) {
    if (!/^[a-f0-9]{32}$/.test(namespace || '')) fail('A 32-character hexadecimal community namespace is required.');
    if (!validJid(ownerJid) || !ownerJid.endsWith('@' + SERVER)) fail('The community owner must have a yax.im account.');
    return { version: 2, provider: 'xmpp', server: SERVER, name: 'Better Cherri', namespace, ownerJid, rooms: Object.fromEntries(names.map(name => [name, address(namespace, name)])) };
  }
  function normalize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || (value.provider && value.provider !== 'xmpp') || (value.server && value.server !== SERVER)) fail('Use a Better Cherri community on yax.im.');
    const legacy = value.version === 1 || (value.version == null && Object.hasOwn(value.rooms || {}, 'better-general')) || value.legacy === true;
    if (!legacy && value.version !== 2) fail('Unsupported Better Cherri community version.');
    const source = value.rooms;
    if (!source || typeof source !== 'object' || Array.isArray(source)) fail('Private room addresses are required.');
    const selected = {}; let namespace = value.namespace || '';
    for (const [original, room] of Object.entries(source)) {
      const name = normalizeRoomName(original);
      if (Object.hasOwn(selected, name)) fail('Each channel needs its own private room.');
      const match = typeof room === 'string' && room.match(/^better-([a-f0-9]{32})-([a-z0-9-]+)@chat\.yax\.im$/);
      const suffix = legacy && name === 'share-music' ? 'music' : name;
      if (!match || match[2] !== suffix) fail('A valid private room address is required for ' + name + '.');
      if (namespace && namespace !== match[1]) fail('All channels must belong to the same Better Cherri community.');
      namespace = match[1]; selected[name] = room;
    }
    if (!/^[a-f0-9]{32}$/.test(namespace) || !Object.keys(selected).length) fail('A valid community namespace and private room addresses are required.');
    if (legacy && (!selected.general || !selected.games || !selected['share-music'])) fail('Legacy imports must retain general, games and music history.');
    let ownerJid = value.ownerJid || null;
    if (ownerJid != null && (!validJid(ownerJid) || !ownerJid.endsWith('@' + SERVER))) fail('The community owner must have a yax.im account.');
    if (!legacy && !ownerJid) fail('The community owner is required.');
    for (const name of names) if (!selected[name]) selected[name] = address(namespace, name);
    if (new Set(Object.values(selected)).size !== Object.keys(selected).length) fail('Each channel needs its own private room.');
    const result = { version: 2, provider: 'xmpp', server: SERVER, name: 'Better Cherri', namespace, ownerJid, rooms: selected };
    if (legacy) result.legacy = true;
    return result;
  }
  function channels(value) {
    const cfg = normalize(value); const list = [];
    for (const group of groups) for (const name of group.names) list.push({ name, categoryId: group.id });
    if (cfg.rooms.games) list.splice(list.findIndex(channel => channel.name === 'share-music'), 0, { name: 'games', categoryId: 2 });
    return list.map((channel, position) => ({ ...channel, position, kind: 'text', locked: true, canRead: false, joined: false, canPost: false, allowMedia: false, allowAnyLink: true, trustedOnly: false, slowmode: 0, wordFilter: false, postRoleIds: [], viewRoleIds: [] }));
  }
  return Object.freeze({ SERVER, MUC, ROOM_NAMES: Object.freeze(names.slice()), normalize, normalizeRoomName, createDefault, channels, categories, clone: copy });
});
