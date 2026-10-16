/* Hosted XMPP account and community controls for the original Cherri interface.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Community exports contain room IDs only, never a password or session token.
 */
(() => {
  'use strict';
  const host = globalThis;
  const active = new WeakMap();
  let communityControl = null, dialogCounter = 0;
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
  .bcm-status[hidden]{display:none}.bcm-status.bcm-error{color:#ffadb9;background:#3b101b}.bcm-community{display:contents}.bcm-dialog{width:min(720px,calc(100vw - 32px));max-height:calc(100vh - 40px);padding:0;border:1px solid var(--border,#ffc8d238);border-radius:18px;background:var(--bg-1,#170c12);color:var(--bright-text,#fff);overflow:auto}.bcm-dialog::backdrop{background:#000a;backdrop-filter:blur(3px)}.bcm-dialog-header{display:flex;gap:12px;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border,#ffc8d238)}.bcm-dialog-header h2{flex:1}.bcm-dialog-body{padding:16px 20px}.bcm-dialog:not([open]){display:none}
  .bcm-community h2{font-size:15px;margin:0}.bcm-community summary{cursor:pointer;font-weight:600;color:var(--bright-text,#fff)}
  .bcm-community details>div{padding-top:10px}.bcm-community details{margin-top:8px}.bcm-community .bcm-identity{overflow-wrap:anywhere;margin:3px 0;font-size:12px}
  .bcm-community .bcm-tools{max-width:760px}.bcm-community form{margin:12px 0}.bcm-community .bcm-invite{grid-template-columns:minmax(180px,1fr) auto;align-items:end}
  .bcm-toast{position:fixed;right:20px;bottom:20px;z-index:100000;width:min(420px,calc(100vw - 40px));padding:14px 16px;border:1px solid var(--accent,#f17496);border-radius:14px;background:var(--bg-1,#170c12);color:var(--bright-text,#fff);box-shadow:0 10px 35px #0008}.bcm-toast p{margin:0 0 10px;overflow-wrap:anywhere}.bcm-toast button{font-size:12px;padding:6px 10px}
  .bcm-root .bcm-break{overflow-wrap:anywhere}.bcm-root [hidden]{display:none!important}
  @media(max-width:500px){.bcm-dialog-body{padding:12px}.bcm-community .bcm-invite{grid-template-columns:1fr}}
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
    if (!host.__betterXmpp) throw new Error('The hosted chat client is still loading. Reopen Better Cherri and try again.');
    return host.__betterXmpp;
  }
  function safeSession() {
    const s = client().getSession();
    return s?.userId ? {userId: String(s.userId), deviceId: String(s.deviceId || '')} : null;
  }
  function registrationInfo() {
    const value = client().getRegistrationInfo?.() || {};
    return {providerName: String(value.providerName || 'yax.im'), usernameHint: String(value.usernameHint || 'username'), tokenRequired: value.tokenRequired === true,
      termsUrl: value.termsUrl || 'https://yaxim.org/yax.im/tos/', privacyUrl: value.privacyUrl || 'https://yaxim.org/yax.im/privacy/', tokenUrl: value.tokenUrl || null};
  }
  function policyLink(text, value) {
    try {
      const url = new URL(String(value));
      if (url.protocol === 'https:' && !url.username && !url.password) return link(text, url.href);
    } catch {}
    return el('span', text);
  }
  function schema() {
    if (!host.__betterXmppSchema) throw new Error('The community configuration is still loading.');
    return host.__betterXmppSchema;
  }
  function publicConfig(raw) {
    if (raw == null) return null;
    try { return schema().normalize(raw); } catch { return null; }
  }
  function configured(config) { return !!config && schema().channels(config).length > 0; }
  function emit(type, detail) { host.dispatchEvent(new CustomEvent(type, {detail})); }
  function sessionEvents() {
    const session = safeSession();
    for (const type of ['cherri:me', 'cherri:session', 'better-xmpp:session']) emit(type, {session});
  }
  function communityEvent() { emit('better-xmpp:community', {community: publicConfig(client().getCommunity())}); }
  function errorText(error) {
    const text = String(error?.message || error || 'The action could not be completed.');
    if (error?.status === 429 && !/rate limit|seconds/i.test(text)) {
      return 'The chat server is rate limiting this account. Try again in ' + Math.max(1, Math.ceil((Number(error.retryAfterMs) || 1000) / 1000)) + ' seconds. ' + text;
    }
    return text;
  }
  function mount(container, account) {
    if (!container?.replaceChildren) throw new TypeError('Provide a DOM container for Better Cherri account controls.');
    active.get(container)?.();
    let alive = true, busy = false, accountMode = 'login', accountUsername = '', registrationPolicies = [];
    const style = el('style', css);
    const root = el('section', null, {class: 'bcm-root ' + (account ? 'bcm-account' : 'bcm-community')});
    let status, dialog = null, returnFocus = null, toast = null, unsubscribe = null, lastStatusError = '', visibleStatusError = '';
    const control = {open: openCommunity, close: closeCommunity};
    if (!account) communityControl = control;
    function focusedElement() {
      const scope = container.getRootNode?.();
      let focused = scope?.activeElement || document.activeElement;
      while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
      return focused;
    }
    function restoreFocus() {
      const target = returnFocus; returnFocus = null;
      if (target && target.isConnected !== false) target.focus?.();
    }
    function openCommunity() {
      if (!alive || !dialog) return false;
      if (!dialog.open) { returnFocus = focusedElement(); dialog.showModal(); }
      return true;
    }
    function closeCommunity() {
      if (dialog?.open) dialog.close();
      restoreFocus();
    }
    const cleanup = () => {
      alive = false;
      unsubscribe?.(); unsubscribe = null;
      visibleStatusError = lastStatusError = '';
      closeCommunity();
      if (communityControl === control) communityControl = null;
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
    function renderToast() {
      toast?.remove(); toast = null;
      if (!alive || !visibleStatusError) return;
      toast = el('aside', null, {class: 'bcm-toast', role: 'alert'});
      toast.append(el('p', visibleStatusError));
      const row = el('div', null, {class: 'bcm-row'});
      row.append(button('Invites & settings', openCommunity), button('Dismiss', () => { visibleStatusError = ''; renderToast(); }));
      toast.append(row); root.append(toast);
    }
    function communityStatus(event) {
      if (!alive) return;
      if (event?.type === 'community' || event?.type === 'session') {
        lastStatusError = visibleStatusError = ''; renderToast();
      } else if (event?.type === 'status' && event.error) {
        const message = errorText(event.error);
        if (message !== lastStatusError) { lastStatusError = visibleStatusError = message; renderToast(); }
      }
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
        card.append(el('p', 'Open Chatrooms to join the Better Cherri community.'));
        const row = el('div', null, {class: 'bcm-row'});
        row.append(link('Open Chatrooms', '#/chat'), logoutButton()); card.append(row); addStatus(card);
        return;
      }
      const info = registrationInfo();
      if (accountMode === 'register') {
        card.append(el('h2', 'Create your Better Cherri account'));
        card.append(el('p', 'Choose a username and password. No email is required.'));
        const form = el('form', null, {'aria-label': 'Create Better Cherri account'});
        const user = el('input', null, {name: 'chat-new-username', type: 'text', autocomplete: 'username', placeholder: 'yourname', required: '', 'aria-label': 'New username'});
        user.value = accountUsername;
        const pass = el('input', null, {name: 'chat-new-password', type: 'password', autocomplete: 'new-password', required: '', 'aria-label': 'New password'});
        const confirm = el('input', null, {name: 'chat-confirm-password', type: 'password', autocomplete: 'new-password', required: '', 'aria-label': 'Confirm password'});
        for (const [text, field] of [['Username', user], ['Password', pass], ['Confirm password', confirm]]) { const label = el('label', text); label.append(field); form.append(label); }
        const token = el('input', null, {name: 'chat-registration-token', type: 'text', autocomplete: 'off', 'aria-label': 'Registration token', ...(info.tokenRequired ? {required: ''} : {})});
        if (info.tokenRequired) {
          const label = el('label', 'Registration token'); label.append(token); form.append(label);
          const note = el('p', 'This provider requires a single-use anti-spam token. ', {class: 'bcm-small'});
          note.append(policyLink('Complete its human anti-spam check', info.tokenUrl)); form.append(note);
        }
        const agreement = el('label', null, {class: 'bcm-check'});
        const accepted = el('input', null, {name: 'chat-accept-terms', type: 'checkbox', required: '', 'aria-label': 'Accept chat provider terms'});
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
            if (alive) { render(); show('Account created. Open Chatrooms to join Better Cherri.'); }
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
      const form = el('form', null, {'aria-label': 'Better Cherri sign in'});
      const user = el('input', null, {name: 'chat-username', type: 'text', autocomplete: 'username', placeholder: info.usernameHint, required: '', 'aria-label': 'Username'});
      user.value = accountUsername;
      const pass = el('input', null, {name: 'chat-password', type: 'password', autocomplete: 'current-password', required: '', 'aria-label': 'Password'});
      const userLabel = el('label', 'Username'); userLabel.append(user);
      const passLabel = el('label', 'Password'); passLabel.append(pass);
      const submit = el('button', 'Sign in →', {type: 'submit', class: 'bcm-primary'});
      form.append(userLabel, passLabel, submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!alive || busy) return;
        const username = user.value.trim(), password = pass.value;
        accountUsername = username;
        if (!username || !password) { show('Enter your Username and password.', true); return; }
        pass.value = '';
        run(() => client().login(username, password), () => {
          sessionEvents();
          if (alive) { render(); show('Signed in. Open Chatrooms to join Better Cherri.'); }
        });
      });
      card.append(form); addStatus(card);
      const row = el('div', null, {class: 'bcm-row'});
      row.append(button('Create account (no email)', () => { accountMode = 'register'; render(); }));
      card.append(row, el('p', 'Chat is hosted free by ' + info.providerName + '. Create and sign in to your account here in Better Cherri. Sign-in lasts for this open tab.', {class: 'bcm-small'}));
    }
    function communityView() {
      dialog = el('dialog', null, {class: 'bcm-dialog', 'aria-labelledby': 'better-community-title-' + (++dialogCounter)});
      const header = el('div', null, {class: 'bcm-dialog-header'});
      header.append(el('h2', 'Invites & community settings', {id: 'better-community-title-' + dialogCounter}));
      const close = button('Close', closeCommunity); close.setAttribute('aria-label', 'Close community settings'); header.append(close);
      const pane = el('div', null, {class: 'bcm-dialog-body'});
      dialog.append(header, pane); root.append(dialog);
      const currentDialog = dialog;
      dialog.addEventListener('cancel', event => { event.preventDefault(); closeCommunity(); });
      // A render can replace an open dialog while its native close event is
      // still queued. Only the current dialog may return focus to the sidebar.
      dialog.addEventListener('close', () => { if (dialog === currentDialog) restoreFocus(); });
      const session = safeSession();
      if (!session) {
        pane.append(el('h2', 'Private Better Cherri rooms'), el('p', 'Sign in to join rooms with saved messages. No email is required.'));
        pane.append(link('Sign in to chat', '#/login?next=/chat')); addStatus(pane);
        return;
      }
      const config = publicConfig(client().getCommunity()), ready = configured(config);
      pane.append(el('p', 'Signed in as ' + session.userId, {class: 'bcm-identity'}));
      const tools = el('div'); pane.append(tools);
      tools.className = 'bcm-tools';
      tools.append(el('p', 'These rooms are invite-only. Message history is saved on yax.im and follows the host’s retention settings.', {class: 'bcm-small'}));
      if (!ready) tools.append(el('p', 'The shared Better Cherri rooms are being prepared. Ask the community owner for an invitation.', {class: 'bcm-small'}));
      if (ready) {
        const invitation = el('form', null, {class: 'bcm-invite', 'aria-label': 'Invite a member'});
        const label = el('label', 'Invite a member to all community channels');
        const input = el('input', null, {type: 'text', name: 'invite-user', placeholder: 'friend@yax.im', autocomplete: 'off', required: '', 'aria-label': 'Member chat address'});
        label.append(input); const submit = el('button', 'Invite', {type: 'submit', class: 'bcm-primary'}); invitation.append(label, submit);
        invitation.addEventListener('submit', event => {
          event.preventDefault(); const id = input.value.trim();
          if (!id) { show('Enter the member’s full chat address.', true); return; }
          run(() => client().invite(id), result => {
            const failed = (result || []).filter(item => !item.invited);
            show(failed.length ? failed.map(item => item.name + ': ' + (item.error || 'Invitation failed.')).join('\n') : 'Invited ' + id + ' to the community channels.', failed.length > 0);
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
      const input = el('textarea', null, {name: 'community-config', placeholder: '{ "provider": "xmpp", "rooms": { … } }', required: '', spellcheck: 'false', 'aria-label': 'Community configuration to import'});
      label.append(input); form.append(label, el('button', 'Import community', {type: 'submit'}));
      form.addEventListener('submit', event => {
        event.preventDefault();
        run(() => client().setCommunity(JSON.parse(input.value)), () => {
          communityEvent();
          if (alive) { render(); show('Configuration imported. Open Invites & settings, then accept your room invitations.'); }
        });
      });
      importer.append(form);
      const row = el('div', null, {class: 'bcm-row'}); row.append(logoutButton()); tools.append(row);
      addStatus(pane);
    }
    function render() {
      if (!alive) return;
      const previousDialog = dialog, wasOpen = !!previousDialog?.open;
      dialog = null;
      if (wasOpen) previousDialog.close();
      root.replaceChildren();
      try { account ? accountView() : communityView(); }
      catch (error) { addStatus(root); show(errorText(error), true); }
      if (wasOpen && dialog && alive) dialog.showModal();
      if (!account) renderToast();
    }
    render();
    if (!account) unsubscribe = client().subscribe?.(communityStatus) || null;
    return cleanup;
  }
  host.__betterXmppUI = Object.freeze({mountAccount: container => mount(container, true), mountCommunity: container => mount(container, false), openCommunity: () => communityControl?.open() || false});
})();
