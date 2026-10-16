import {patchMatrixIntegration} from './patch-matrix-integration.mjs';

function excludePrivateSessions(input) {
  const start = input.indexOf('kCA=new Set(['), end = input.indexOf(']),RCA=', start);
  if (start < 0 || end < 0) throw new Error('XMPP private storage filter was not found.');
  let filter = input.slice(start, end + 2);
  const privateKeys = ['better_cherri_matrix_session_v1', 'better_cherri_xmpp_session_v1', 'better_cherri_matrix_event_ids_v1', 'better_cherri_xmpp_event_ids_v1'];
  for (const key of privateKeys) filter = filter.split(JSON.stringify(key) + ',').join('');
  const anchor = '"better_cherri_remote_session_token",';
  if (filter.split(anchor).length !== 2) throw new Error('XMPP private storage exclusion anchor changed.');
  filter = filter.replace(anchor, anchor + privateKeys.map(key => JSON.stringify(key) + ',').join(''));
  let source = input.slice(0, start) + filter + input.slice(end + 2);
  const prefixStart = source.indexOf('RCA=[', start), prefixEnd = source.indexOf('],sV=', prefixStart);
  if (prefixStart < 0 || prefixEnd < 0) throw new Error('XMPP private storage prefix filter was not found.');
  const prefixes = JSON.parse(source.slice(prefixStart + 4, prefixEnd + 1));
  for (const prefix of ['better_cherri_matrix_blocks:', 'better_cherri_xmpp_blocks:']) if (!prefixes.includes(prefix)) prefixes.push(prefix);
  return source.slice(0, prefixStart + 4) + JSON.stringify(prefixes) + source.slice(prefixEnd + 1);
}

function patchChatLayout(input) {
  let source = input;
  const privateEmptyText = 'This channel is private. Ask the Better Cherri owner for an invitation, then accept it in Invites & settings.';
  const oldEmpty = String.raw`children:JB?"No messages yet \u2014 say hi!":"Original Cherri rooms are hidden. Select a Better Cherri room when one is available."`;
  if (!source.includes(privateEmptyText)) {
    if (source.split(oldEmpty).length !== 2) throw new Error('Original Cherri empty channel notice anchor changed.');
    source = source.replace(oldEmpty, 'children:globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="xmpp"&&Jr?.canRead===!1?' + JSON.stringify(privateEmptyText) + ':' + oldEmpty.slice('children:'.length));
  }
  const privateComposerText = 'Invitation required. Open Invites & settings to accept your room invitations.';
  const oldComposer = 'children:Jr?.locked?(0,m.jsxs)(m.Fragment,';
  if (!source.includes(privateComposerText)) {
    if (source.split(oldComposer).length !== 2) throw new Error('Original Cherri locked composer notice anchor changed.');
    source = source.replace(oldComposer, 'children:globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="xmpp"&&Jr?.canRead===!1?' + JSON.stringify(privateComposerText) + ':' + oldComposer.slice('children:'.length));
  }
  const oldChannelIcon = 'children:[sA.viewRoleIds&&sA.viewRoleIds.length>0?';
  const privateChannelIcon = 'children:[globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="xmpp"&&sA.canRead===!1?(0,m.jsx)(At,{size:14,className:"shrink-0"}):sA.viewRoleIds&&sA.viewRoleIds.length>0?';
  if (!source.includes(privateChannelIcon)) {
    if (source.split(oldChannelIcon).length !== 2) throw new Error('Original Cherri channel access icon anchor changed.');
    source = source.replace(oldChannelIcon, privateChannelIcon);
  }
  const oldHost = '(0,eA.jsx)("div",{ref:betterXmppContainer}),';
  const newHost = '(0,eA.jsx)("div",{"data-better-community-dialog-host":"",style:{height:0,minHeight:0,flex:"0 0 0px"},ref:betterXmppContainer}),';
  if (!source.includes(newHost)) {
    if (source.split(oldHost).length !== 2) throw new Error('XMPP community dialog host anchor changed.');
    source = source.replace(oldHost, newHost);
  }
  if (source.includes('"data-better-chat-settings":""')) return source;
  const label = source.indexOf('children:"Channels"');
  const start = source.lastIndexOf('(0,m.jsxs)("button",{onClick:()=>Y("channels"),', label);
  const end = source.indexOf(',(0,m.jsxs)("button",{onClick:()=>Y("friends"),', label);
  if (label < 0 || start < 0 || end < start) throw new Error('Original Cherri Channels button anchor changed.');
  const channels = source.slice(start, end).replace('flex w-full items-center', 'flex min-w-0 flex-1 items-center');
  const row = '(0,m.jsxs)("div",{className:"flex min-w-0 items-center gap-1",children:[' + channels + ',globalThis.__BETTER_CHERRI_CHAT_PROVIDER__==="xmpp"?(0,m.jsx)("button",{"data-better-chat-settings":"",type:"button",title:"Invites & settings","aria-label":"Invites & settings",onClick:()=>window.__betterXmppUI?.openCommunity?.(),className:"flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-(--text-muted) hover:bg-(--bg-2) hover:text-(--bright-text)",style:{fontSize:18},children:"\\u2699"}):null]})';
  return source.slice(0, start) + row + source.slice(end);
}

// Reuse the compiled-client patch anchors, then select the XMPP adapter for
// this build. The original Cherri chat and member components remain intact.
export function patchXmppIntegration(input) {
  if (input.includes('window.__betterXmppRequest(g,I)')) return excludePrivateSessions(patchChatLayout(input));
  let source = patchMatrixIntegration(input);
  for (const [before, after] of [
    ['__BETTER_CHERRI_CHAT_PROVIDER__==="matrix"', '__BETTER_CHERRI_CHAT_PROVIDER__==="xmpp"'],
    ['__BETTER_CHERRI_CHAT_PROVIDER__!=="matrix"', '__BETTER_CHERRI_CHAT_PROVIDER__!=="xmpp"'],
    ['__betterMatrix', '__betterXmpp'],
    ['better-matrix:session', 'better-xmpp:session'],
    ['better-matrix:community', 'better-xmpp:community'],
    ['betterMatrixContainer', 'betterXmppContainer'],
    ['BetterMatrixPage', 'BetterXmppPage'],
    ['better_cherri_matrix_session_v1', 'better_cherri_xmpp_session_v1']
  ]) source = source.split(before).join(after);
  // Old Matrix credentials can still exist in the browser from prior builds.
  // Preserve both exclusions so importing/exporting settings never includes
  // either provider's private account state or per-room event identifiers.
  return excludePrivateSessions(patchChatLayout(source));
}
