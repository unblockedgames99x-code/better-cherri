// This bookmark runs only when the user invokes it on the official Cherri site.
// The chosen launcher is read through a user-controlled file input. No account
// storage, cookies, or credentials are copied into the bookmark or another site.

export function parseLauncherApp(html) {
  if (typeof html !== 'string') throw new Error('Choose the Better Cherri launcher HTML file.');
  const prefix = 'const APP=';
  const suffix = ';\nconst status=';
  const marker = html.indexOf(prefix);
  if (marker < 0) throw new Error('This file is not a Better Cherri launcher.');
  const start = marker + prefix.length;
  const end = html.indexOf(suffix, start);
  if (end <= start) throw new Error('The launcher is incomplete. Download it again.');
  let app;
  try {
    app = JSON.parse(html.slice(start, end));
  } catch {
    throw new Error('The launcher contains invalid app data. Download it again.');
  }
  if (typeof app !== 'string' || !/^<!doctype html>/i.test(app.trimStart()) ||
      !app.includes('window.__BETTER_CHERRI__=') || !app.includes('Better Cherri')) {
    throw new Error('The selected file does not contain the Better Cherri app.');
  }
  return app;
}

function launchFromNativeOrigin(parseApp) {
  'use strict';
  if (globalThis.origin !== 'https://cherrion.top') {
    alert('Open https://cherrion.top/ first, then click the Better Cherri bookmark.');
    return;
  }

  let child;
  try {
    // Open synchronously, while the bookmark click still has user activation.
    child = window.open('about:blank', '_blank');
  } catch {
    alert('Better Cherri could not open a tab. Allow popups on cherrion.top, then click the bookmark again.');
    return;
  }
  if (!child) {
    alert('Allow popups on cherrion.top, then click the Better Cherri bookmark again.');
    return;
  }

  try {
    const doc = child.document;
    doc.documentElement.lang = 'en';
    const meta = doc.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width,initial-scale=1';
    const style = doc.createElement('style');
    style.textContent = '*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0c0a0c;color:#f5edf2;font:15px/1.55 system-ui,sans-serif}main{width:min(560px,100%);padding:32px;background:#171317;border:1px solid #332730;border-radius:22px}h1{font-size:28px;line-height:1.2;margin:0 0 16px}p{color:#b9a9b3}label{display:block;margin:24px 0 8px;font-weight:600}input{display:block;max-width:100%;font:inherit;color:inherit}input::file-selector-button{margin-right:12px;padding:11px 15px;border:0;border-radius:9px;background:#f2b4d3;color:#28151f;cursor:pointer}#better-status{min-height:48px;margin-top:22px;color:#eab9d5}';
    doc.head.replaceChildren(meta, style);
    doc.title = 'Launch Better Cherri';

    const card = doc.createElement('main');
    const heading = doc.createElement('h1');
    heading.textContent = 'Launch Better Cherri';
    const description = doc.createElement('p');
    description.textContent = 'Choose your downloaded launcher. Better Cherri will open here using Cherri’s own servers and your normal connection.';
    const label = doc.createElement('label');
    label.htmlFor = 'better-launcher-file';
    label.textContent = 'Better-Cherri-Launcher.html';
    const input = doc.createElement('input');
    input.id = 'better-launcher-file';
    input.type = 'file';
    input.accept = '.html,text/html';
    const status = doc.createElement('p');
    status.id = 'better-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'No server or installation is needed.';
    card.append(heading, description, label, input, status);
    doc.body.replaceChildren(card);
    // The origin inherited at creation remains intact when the opener is cleared.
    child.opener = null;

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      input.disabled = true;
      status.textContent = 'Reading Better Cherri…';
      try {
        const app = parseApp(await file.text());
        if (child.closed) throw new Error('The Better Cherri tab was closed. Click the bookmark again.');
        doc.open();
        doc.write(app);
        doc.close();
      } catch (error) {
        status.textContent = error && error.message ? error.message : 'The launcher could not be loaded. Choose the HTML file again.';
        input.disabled = false;
      }
    });
  } catch {
    alert('Better Cherri could not prepare its tab. Open https://cherrion.top/ and try the bookmark again.');
  }
}

export function makeNativeBookmarkletSource() {
  return `(()=>{const parseApp=${parseLauncherApp.toString()};(${launchFromNativeOrigin.toString()})(parseApp)})();void 0`;
}

export function makeNativeBookmarklet() {
  return 'javascript:' + encodeURIComponent(makeNativeBookmarkletSource());
}
