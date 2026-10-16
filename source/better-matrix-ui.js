/* Hosted account and community controls for the original Cherri interface.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Community exports contain room IDs only, never a password or session token.
 */
(() => {
  'use strict';
  const host = globalThis;
  const active = new WeakMap();
  const names = ['better-general', 'better-games', 'better-music'];
  const base = 'https://matrix.salix.host';
  const css = `
  .bcm-root{font-family:var(--cherri-font,Inter,system-ui,sans-serif);color:var(--bright-text,#fff);font-size:14px;line-height:1.5;box-sizing:border-box}
  .bcm-root *{box-sizing:border-box}.bcm-root button,.bcm-root input,.bcm-root textarea{font:inherit}
  .bcm-root button,.bcm-root a,.bcm-root summary{touch-action:manipulation}.bcm-root a{color:var(--accent,#f17496);text-decoration:underline;text-underline-offset:3px}
  .bcm-account{min-height:65vh;display:grid;place-items:center;padding:28px 16px}.bcm-card{width:100%;max-width:390px}
  .bcm-root h2{font-size:20px;line-height:1.3;margin:0 0 8px;font-weight:700}.bcm-root p{margin:8px 0;color:var(--text,#c7aeb7)}
  .bcm-root form{display:grid;gap:12px;margin:20px 0 12px}.bcm-root label{display:grid;gap:5px;font-size:13px;color:var(--text,#c7aeb7)}
  .bcm-root input,.bcm-root textarea{width:100%;background:var(--bg-2,#1b1016);color:var(--bright-text,#fff);border:1px solid var(--border,#ffc8d238);border-radius:12px;padding:10px 12px;outline-offset:3px}
  .bcm-root textarea{min-height:115px;resize:vertical;font-family:ui-monospace,monospace;font-size:12px}
  .bcm-root button{border:1px solid var(--border,#ffc8d238);border-radius:12px;padding:9px 14px;background:var(--bg-2,#1b1016);color:var(--bright-text,#fff);cursor:pointer}
  .bcm-root button.bcm-primary{background:var(--accent,#f17496);color:var(--bg,#12090d);border-color:transparent;font-weight:600}.bcm-root button:disabled{opacity:.55;cursor:wait}
  .bcm-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.bcm-small{font-size:12px!important}.bcm-status{margin-top:12px;padding:10px 12px;border-radius:12px;white-space:pre-line;overflow-wrap:anywhere;background:var(--bg-2,#1b1016)}
  .bcm-root label.bcm-check{display:flex;gap:9px;align-items:flex-start}.bcm-root .bcm-check input{width:16px;height:16px;margin-top:3px;padding:0;flex:none}.bcm-root .bcm-switch{margin-top:12px}
  .bcm-status[hidden]{display:none}.bcm-status.bcm-error{color:#ffadb9;background:#3b101b}.bcm-community{padding:12px 18px;border-bottom:1px solid var(--border,#ffc8d238);background:var(--bg-1,#170c12)}
  .bcm-community h2{font-size:15px;margin:0}.bcm-community summary{cursor:pointer;font-weight:600;color:var(--bright-text,#fff)}
  .bcm-community details>div{padding-top:10px}.bcm-community details{margin-top:8px}.bcm-community .bcm-identity{overflow-wrap:anywhere;margin:3px 0;font-size:12px}
  .bcm-community .bcm-tools{max-width:760px}.bcm-community form{margin:12px 0}.bcm-community .bcm-invite{grid-template-columns:minmax(180px,1fr) auto;align-items:end}
  .bcm-root .bcm-break{overflow-wrap:anywhere}.bcm-root [hidden]{display:none!important}
  @media(max-width:500px){.bcm-community{padding:10px 12px}.bcm-community .bcm-invite{grid-template-columns:1fr}}
  `;
  function el(tag, text, attributes = {}) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    for (const [name, value] of Object.entries(attributes)) {
      if (value != null) node.setAttribute(name, String(value));
    }
    return node;
  }
  function link(text, href) { return el('a', text, href.startsWith('#') ? {href} : {href, target: '_blank', rel: 'noopener noreferrer'}); }
  function client() {
    if (!host.__betterMatrix) throw new Error('The hosted chat client is still loading. Reopen Better Cherri and try again.');
    return host.__betterMatrix;
  }
  function safeSession() {
    const s = client().getSession();
    return s?.userId ? {userId: String(s.userId), deviceId: String(s.deviceId || '')} : null;
  }
  function registrationInfo() {
    const value = client().getRegistrationInfo?.() || {};
    return {providerName: String(value.providerName || 'Salix'), usernameHint: String(value.usernameHint || '@username:salix.host'), tokenRequired: value.tokenRequired !== false,
      termsUrl: value.termsUrl || 'https://salix.host/terms/', privacyUrl: value.privacyUrl || null, tokenUrl: value.tokenUrl || 'https://salix.host/matrix/'};
  }
  function policyLink(text, value) {
    try {
      const url = new URL(String(value));
      if (url.protocol === 'https:' && !url.username && !url.password) return link(text, url.href);
    } catch {}
    return el('span', text);
  }
  function publicConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const rooms = {};
    for (const name of names) {
      const id = raw.rooms?.[name];
      if (typeof id === 'string' && /^![^\s/\\?#]{1,500}:[^\s/\\?#]{1,250}$/.test(id)) rooms[name] = id;
    }
    return {version: 1, provider: 'matrix', homeserver: base, name: 'Better Cherri', rooms};
  }
  function configured(config) { return !!config && names.every(name => config.rooms[name]); }
  function emit(type, detail) { host.dispatchEvent(new CustomEvent(type, {detail})); }
  function sessionEvents() {
    const session = safeSession();
    for (const type of ['cherri:me', 'cherri:session', 'better-matrix:session']) emit(type, {session});
  }
  function communityEvent() { emit('better-matrix:community', {community: publicConfig(client().getCommunity())}); }
  function errorText(error) {
    const text = String(error?.message || error || 'The action could not be completed.');
    if (error?.status === 429 && !/rate limit|seconds/i.test(text)) {
      return 'Matrix is rate limiting this account. Try again in ' + Math.max(1, Math.ceil((Number(error.retryAfterMs) || 1000) / 1000)) + ' seconds. ' + text;
    }
    return text;
  }
  function mount(container, account) {
    if (!container?.replaceChildren) throw new TypeError('Provide a DOM container for Better Cherri account controls.');
    active.get(container)?.();
    let alive = true, busy = false, accountMode = 'login', accountUsername = '', registrationPolicies = [];
    const style = el('style', css);
    const root = el('section', null, {class: 'bcm-root ' + (account ? 'bcm-account' : 'bcm-community')});
    let status;
    const cleanup = () => {
      alive = false;
      if (active.get(container) === cleanup) {
        active.delete(container);
        // React may already have committed the real chat into this slot before
        // its previous effect cleans up. Remove only this mount's own nodes.
        if (style.parentNode === container) style.remove();
        if (root.parentNode === container) root.remove();
      }
    };
    active.set(container, cleanup);
    container.replaceChildren(style, root);
    function show(text, error = false) {
      if (!alive || !status) return;
      status.textContent = String(text);
      status.hidden = !text;
      status.className = 'bcm-status' + (error ? ' bcm-error' : '');
      status.setAttribute('role', error ? 'alert' : 'status');
    }
    function setBusy(value) {
      if (!alive) return;
      busy = value;
      for (const button of root.querySelectorAll('button')) button.disabled = value;
    }
    async function run(action, success, failure) {
      if (!alive || busy) return;
      setBusy(true); show('');
      try {
        const result = await action();
        if (alive) await success?.(result);
      } catch (error) { if (alive) await failure?.(error); show(errorText(error), true); }
      finally { setBusy(false); }
    }
    function button(text, action, primary = false) {
      const node = el('button', text, {type: 'button', class: primary ? 'bcm-primary' : ''});
      node.addEventListener('click', () => { if (alive && !busy) action(); });
      return node;
    }
    function addStatus(parent) {
      status = el('div', '', {class: 'bcm-status', role: 'status', 'aria-live': 'polite'});
      status.hidden = true; parent.append(status);
    }
    function details(parent, title, open = false) {
      const node = el('details'); node.open = open;
      const inner = el('div'); node.append(el('summary', title), inner); parent.append(node);
      return inner;
    }
    function logoutButton() {
      return button('Sign out', () => run(async () => {
        try { await client().logout(); }
        finally { if (alive) { sessionEvents(); render(); } }
      }));
    }
    function accountView() {
      const card = el('div', null, {class: 'bcm-card'});
      root.append(card);
      const session = safeSession();
      if (session) {
        card.append(el('h2', 'You’re signed in'), el('p', session.userId, {class: 'bcm-break'}));
        card.append(el('p', 'Open Chatrooms to create or join your private Better Cherri community.'));
        const row = el('div', null, {class: 'bcm-row'});
        row.append(link('Open Chatrooms', '#/chat'), logoutButton()); card.append(row); addStatus(card);
        return;
      }
      const info = registrationInfo();
      if (accountMode === 'register') {
        card.append(el('h2', 'Create your Better Cherri account'));
        card.append(el('p', 'Choose a username and password. No email is required.'));
        const form = el('form', null, {'aria-label': 'Create Better Cherri account'});
        const user = el('input', null, {name: 'matrix-new-username', type: 'text', autocomplete: 'username', placeholder: 'yourname', required: '', 'aria-label': 'New username'});
        user.value = accountUsername;
        const pass = el('input', null, {name: 'matrix-new-password', type: 'password', autocomplete: 'new-password', required: '', 'aria-label': 'New password'});
        const confirm = el('input', null, {name: 'matrix-confirm-password', type: 'password', autocomplete: 'new-password', required: '', 'aria-label': 'Confirm password'});
        for (const [text, field] of [['Username', user], ['Password', pass], ['Confirm password', confirm]]) { const label = el('label', text); label.append(field); form.append(label); }
        const token = el('input', null, {name: 'matrix-registration-token', type: 'text', autocomplete: 'off', 'aria-label': 'Registration token', ...(info.tokenRequired ? {required: ''} : {})});
        if (info.tokenRequired) {
          const label = el('label', 'Registration token'); label.append(token); form.append(label);
          const note = el('p', 'This provider requires a single-use anti-spam token. ', {class: 'bcm-small'});
          note.append(policyLink('Complete its human anti-spam check', info.tokenUrl)); form.append(note);
        }
        const agreement = el('label', null, {class: 'bcm-check'});
        const accepted = el('input', null, {name: 'matrix-accept-terms', type: 'checkbox', required: '', 'aria-label': 'Accept chat provider terms'});
        const terms = el('span', 'I agree to '); terms.append(policyLink(info.providerName + '’s terms of service', info.termsUrl));
        if (info.privacyUrl) terms.append(el('span', ' and '), policyLink('privacy policy', info.privacyUrl));
        agreement.append(accepted, terms); form.append(agreement);
        const policyChecks = [];
        for (const policy of registrationPolicies) {
          const label = el('label', null, {class: 'bcm-check'});
          const checkbox = el('input', null, {type: 'checkbox', required: '', 'aria-label': 'Accept ' + policy.name});
          const text = el('span', 'I agree to '); text.append(policyLink(policy.name, policy.url)); label.append(checkbox, text); form.append(label);
          policyChecks.push({id: policy.id, checkbox});
        }
        form.append(el('button', 'Create account →', {type: 'submit', class: 'bcm-primary'}));
        form.addEventListener('submit', event => {
          event.preventDefault();
          if (!alive || busy) return;
          const username = user.value.trim(), password = pass.value, registrationToken = token.value.trim();
          accountUsername = username;
          if (!username || !password || !confirm.value) { show('Choose a username and enter your password twice.', true); return; }
          if (password !== confirm.value) { show('Your passwords do not match.', true); return; }
          if (info.tokenRequired && !registrationToken) { show('Complete the provider’s human anti-spam check and enter its registration token.', true); return; }
          if (!accepted.checked || policyChecks.some(item => !item.checkbox.checked)) { show('Read and accept the provider’s terms before creating your account.', true); return; }
          const options = {acceptTerms: true, acceptedPolicies: policyChecks.map(item => item.id)};
          pass.value = ''; confirm.value = ''; token.value = '';
          run(() => client().register(username, password, registrationToken, options), () => {
            sessionEvents();
            if (alive) { render(); show('Account created. Open Chatrooms to connect your private rooms.'); }
          }, error => {
            if (error?.code === 'BETTER_REGISTRATION_TERMS_REQUIRED' && Array.isArray(error.policies)) {
              registrationPolicies = error.policies.filter(item => item && typeof item.id === 'string' && typeof item.url === 'string').map(item => ({id: item.id, name: String(item.name || item.id), url: item.url}));
              render();
            }
          });
        });
        card.append(form); addStatus(card);
        card.append(button('Already have an account? Sign in', () => { accountMode = 'login'; render(); }));
        card.append(el('p', 'Chat is hosted free by ' + info.providerName + '. Keep your password; your account does not require an email address.', {class: 'bcm-small'}));
        return;
      }
      card.append(el('h2', 'Sign in to Better Cherri chat'));
      card.append(el('p', 'Sign in for private rooms and saved messages. No email is required.'));
      const form = el('form', null, {'aria-label': 'Matrix sign in'});
      const user = el('input', null, {name: 'matrix-username', type: 'text', autocomplete: 'username', placeholder: info.usernameHint, required: '', 'aria-label': 'Matrix username'});
      user.value = accountUsername;
      const pass = el('input', null, {name: 'matrix-password', type: 'password', autocomplete: 'current-password', required: '', 'aria-label': 'Matrix password'});
      const userLabel = el('label', 'Username'); userLabel.append(user);
      const passLabel = el('label', 'Password'); passLabel.append(pass);
      const submit = el('button', 'Sign in →', {type: 'submit', class: 'bcm-primary'});
      form.append(userLabel, passLabel, submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!alive || busy) return;
        const username = user.value.trim(), password = pass.value;
        accountUsername = username;
        if (!username || !password) { show('Enter your Matrix username and password.', true); return; }
        pass.value = '';
        run(() => client().login(username, password), () => {
          sessionEvents();
          if (alive) { render(); show('Signed in. Open Chatrooms to connect your rooms.'); }
        });
      });
      card.append(form); addStatus(card);
      const row = el('div', null, {class: 'bcm-row'});
      row.append(button('Create account (no email)', () => { accountMode = 'register'; render(); }));
      card.append(row, el('p', 'Chat is hosted free by ' + info.providerName + '. Create and sign in to your account here in Better Cherri.', {class: 'bcm-small'}));
    }
    function communityView() {
      const session = safeSession();
      if (!session) {
        root.append(el('h2', 'Private Better Cherri rooms'), el('p', 'Sign in to create or join rooms with saved messages. No email is required.'));
        root.append(link('Sign in to chat', '#/login?next=/chat')); addStatus(root);
        return;
      }
      const config = publicConfig(client().getCommunity()), ready = configured(config);
      root.append(el('h2', ready ? 'Better Cherri · private rooms' : 'Connect your Better Cherri rooms'));
      root.append(el('p', 'Signed in as ' + session.userId, {class: 'bcm-identity'}));
      const tools = details(root, ready ? 'Invites and community settings' : 'Set up or join your community', !ready);
      tools.className = 'bcm-tools';
      tools.append(el('p', 'These rooms are invite-only. Messages are stored on Matrix and remain available when everyone is offline.', {class: 'bcm-small'}));
      if (!ready) {
        tools.append(button(config && Object.keys(config.rooms).length ? 'Finish creating private rooms' : 'Create private rooms', () => run(() => client().createCommunity(), result => {
          const created = publicConfig(result);
          communityEvent();
          if (alive) { render(); show(configured(created) ? 'Your General, Games, and Music rooms are ready.' : 'Some rooms are still being created. Try again to finish setup.'); }
        }), true));
        tools.append(el('p', 'Create once as the community owner. Members import the same configuration and accept your invitation.', {class: 'bcm-small'}));
      }
      if (ready) {
        const invitation = el('form', null, {class: 'bcm-invite', 'aria-label': 'Invite a member'});
        const label = el('label', 'Invite a Matrix member to all three rooms');
        const input = el('input', null, {type: 'text', name: 'invite-user', placeholder: '@friend:salix.host', autocomplete: 'off', required: '', 'aria-label': 'Member Matrix ID'});
        label.append(input); const submit = el('button', 'Invite', {type: 'submit', class: 'bcm-primary'}); invitation.append(label, submit);
        invitation.addEventListener('submit', event => {
          event.preventDefault(); const id = input.value.trim();
          if (!id) { show('Enter the member’s full Matrix ID.', true); return; }
          run(() => client().invite(id), result => {
            const failed = (result || []).filter(item => !item.invited);
            show(failed.length ? failed.map(item => item.name + ': ' + (item.error || 'Invitation failed.')).join('\n') : 'Invited ' + id + ' to all three rooms.', failed.length > 0);
            if (!failed.length) input.value = '';
          });
        });
        tools.append(invitation);
        const row = el('div', null, {class: 'bcm-row'});
        row.append(button('Accept room invitations', () => run(() => client().joinCommunity(), result => {
          const failed = (result || []).filter(item => !item.joined);
          communityEvent();
          if (alive) { render(); show(failed.length ? failed.map(item => item.name + ': ' + (item.error || 'Not invited yet.')).join('\n') : 'Joined your Better Cherri rooms.', failed.length > 0); }
        })));
        row.append(button('Download community launcher', () => run(() => {
          if (typeof host.__BETTER_CHERRI_DOWNLOAD_LAUNCHER__ !== 'function') throw new Error('The configured launcher download is unavailable in this build.');
          return host.__BETTER_CHERRI_DOWNLOAD_LAUNCHER__(publicConfig(client().getCommunity()));
        }, () => show('The launcher download contains your room configuration. It contains no login credentials.'))));
        tools.append(row);
        const sharing = details(tools, 'Copy community configuration');
        const exported = el('textarea', null, {readonly: '', 'aria-label': 'Public community configuration', spellcheck: 'false'});
        exported.value = JSON.stringify(config, null, 2);
        sharing.append(el('p', 'Share this configuration with invited members. It contains room IDs, and does not grant entry by itself.', {class: 'bcm-small'}), exported);
        sharing.append(button('Copy configuration', () => run(async () => {
          const text = JSON.stringify(publicConfig(client().getCommunity()), null, 2);
          if (!host.navigator?.clipboard?.writeText) { exported.focus(); exported.select(); return false; }
          try { await host.navigator.clipboard.writeText(text); return true; }
          catch { exported.focus(); exported.select(); return false; }
        }, copied => show(copied ? 'Community configuration copied.' : 'Select and copy the configuration above.'))));
      }
      const importer = details(tools, ready ? 'Import a different community' : 'Join an existing community');
      const form = el('form', null, {'aria-label': 'Import community configuration'});
      const label = el('label', 'Paste the community configuration from its owner');
      const input = el('textarea', null, {name: 'community-config', placeholder: '{ "provider": "matrix", "rooms": { … } }', required: '', spellcheck: 'false', 'aria-label': 'Community configuration to import'});
      label.append(input); form.append(label, el('button', 'Import community', {type: 'submit'}));
      form.addEventListener('submit', event => {
        event.preventDefault();
        run(() => client().setCommunity(JSON.parse(input.value)), () => {
          communityEvent();
          if (alive) { render(); show('Configuration imported. Open Invites and community settings, then accept your room invitations.'); }
        });
      });
      importer.append(form);
      const row = el('div', null, {class: 'bcm-row'}); row.append(logoutButton()); tools.append(row);
      addStatus(root);
    }
    function render() {
      if (!alive) return;
      root.replaceChildren();
      try { account ? accountView() : communityView(); }
      catch (error) { addStatus(root); show(errorText(error), true); }
    }
    render();
    return cleanup;
  }
  host.__betterMatrixUI = Object.freeze({mountAccount: container => mount(container, true), mountCommunity: container => mount(container, false)});
})();
