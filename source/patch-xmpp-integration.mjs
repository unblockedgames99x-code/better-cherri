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

// Reuse the compiled-client patch anchors, then select the XMPP adapter for
// this build. The original Cherri chat and member components remain intact.
export function patchXmppIntegration(input) {
  if (input.includes('window.__betterXmppRequest(g,I)')) return excludePrivateSessions(input);
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
  return excludePrivateSessions(source);
}
