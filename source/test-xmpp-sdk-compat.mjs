import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Exercise the actual vendored browser distribution, without opening a socket
// or sending an account, registration, membership, or message request.
const sandbox = {
  console, crypto: webcrypto, TextEncoder, TextDecoder, URL, Uint8Array,
  ArrayBuffer, btoa, atob, escape, unescape,
  document: {cookie: ''},
  setTimeout: () => 1, clearTimeout() {},
  setInterval: () => 1, clearInterval() {},
  WebSocket: class { constructor() { throw new Error('This audit must not open a socket.'); } }
};
vm.createContext(sandbox);
vm.runInContext(await fs.readFile(new URL('./better-xmpp-sdk.js', import.meta.url), 'utf8'), sandbox);
const S = sandbox.Strophe;
assert.equal(typeof S.Connection, 'function');
assert.equal(typeof sandbox.$build, 'function');
assert.equal(typeof sandbox.$iq, 'function');
assert.equal(typeof sandbox.$msg, 'function');
assert.equal(typeof sandbox.$pres, 'function');
for (const method of ['connect', 'send', 'sendIQ', 'flush', 'disconnect', 'addHandler', 'deleteHandler', '_addSysHandler']) {
  assert.equal(typeof S.Connection.prototype[method], 'function', method);
}
const mechanisms = [S.SASLSHA512, S.SASLSHA384, S.SASLSHA256, S.SASLSHA1];
assert.ok(mechanisms.every(value => typeof value === 'function'));
const conn = new S.Connection('wss://xmpp.yaxim.org/xmpp-websocket', {mechanisms});
assert.deepEqual(Object.keys(conn.mechanisms).sort(), ['SCRAM-SHA-1', 'SCRAM-SHA-256', 'SCRAM-SHA-384', 'SCRAM-SHA-512']);
assert.equal(conn.sm, undefined, 'The client does not opt in to SDK sessionStorage stream state.');

// The registration code relies on observing preauth stream features, then on
// a system IQ handler that is allowed to run before authentication.
conn.do_authentication = false;
let featureCallbacks = 0, authCalls = 0;
conn.xmlInput = () => featureCallbacks++;
conn.authenticate = () => authCalls++;
conn._proto._connect_cb = () => undefined;
conn._proto._no_auth_received = () => { throw new Error('The fixture advertises supported SCRAM.'); };
const features = {
  nodeName: 'stream:features', childNodes: [],
  getElementsByTagNameNS: (namespace, name) => name === 'features' ? [{}] : [],
  getElementsByTagName: name => name === 'mechanism' ? [{textContent: 'SCRAM-SHA-1'}] : []
};
conn._connect_cb(features);
assert.equal(featureCallbacks, 1);
assert.equal(authCalls, 0, 'Registration must never attempt SASL before creating the account.');
assert.equal(conn.authenticated, false);
const handler = conn._addSysHandler(() => false, null, 'iq', null, 'registration-audit');
assert.equal(handler.user, false, 'Normal user handlers would be suppressed before authentication.');
assert.equal(conn.addHandlers.includes(handler), true);
assert.equal(S.Status.CONNECTED, 5);
console.log('Vendored XMPP SDK: browser globals, SCRAM-only mechanisms, preauth feature observation and system IQ handlers passed; no socket or account writes.');
