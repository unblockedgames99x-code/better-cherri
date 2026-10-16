import fs from 'node:fs';
import path from 'node:path';

export function patchBranding(source) {
  let s = source;
  const once = (from, to) => {
    if (s.split(from).length !== 2) throw new Error(`Branding patch mismatch: ${from.slice(0, 100)}`);
    s = s.replace(from, to);
  };
  once('XB="Cherri"', 'XB="Better Cherri"');
  once('document.title=g.title;', 'document.title=g.id==="none"?"Better Cherri":g.title;');
  once('Py=`v${zy} \\xB7 ${pM}`', 'Py=`Better Cherri v${globalThis.__BETTER_CHERRI__?.version||"2.2.0"} · based on v${zy}`');
  // Remove the entire front-page link, including its icon and invitation text.
  const start = s.indexOf('(0,eA.jsxs)("a",{href:"https://discord.gg/hUYzETaQ9U"');
  if (start < 0) throw new Error('Discord link patch mismatch');
  const endMarker = 'children:"for more links"})]})';
  const end = s.indexOf(endMarker, start);
  if (end < 0) throw new Error('Discord link end patch mismatch');
  s = s.slice(0, start) + 'null' + s.slice(end + endMarker.length);
  // The upstream heading is rendered through a CSS pseudo-element.
  once('"aria-hidden":"true"}),(0,eA.jsx)("p",{id:"_0ky0mtt"',
    '"aria-label":"Better Cherri",children:"Better Cherri"}),(0,eA.jsx)("p",{id:"_0ky0mtt"');
  // Keep the original analytics account out of the independent fork.
  once('mv=()=>{$D(tCA)}', 'mv=()=>{}');
  // Keep the original encapsulated layout accessible to browser test tools.
  once('g=A.attachShadow({mode:"closed"})', 'g=A.attachShadow({mode:"open"})');
  return s;
}

export const brandingCss = `\n/* Better Cherri: preserve the original theme and layout. */\n._3a6cy3v::before,._3a6cy3v::after{content:none!important}\n._3a6cy3v{font-size:clamp(2.7rem,6vw,4.5rem)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))) {
  const root = process.argv[2] || 'work/cherri/b';
  const bundle = path.join(root, 'assets/bundle-i7rlf846.js');
  fs.writeFileSync(bundle, patchBranding(fs.readFileSync(bundle, 'utf8')));
  fs.appendFileSync(path.join(root, 'assets/index-B8wtnshq-4811c2da.css'), brandingCss);
}
