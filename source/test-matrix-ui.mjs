import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// Small DOM fixture: behavior tests make no browser or network requests.
class Element extends EventTarget {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.value = ''; this._text = ''; this.disabled = false; this.hidden = false; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this._text = ''; this.append(...nodes); }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; } }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set innerHTML(_) { throw new Error('Untrusted HTML must never be rendered.'); }
  querySelectorAll(selector) { return this.all().filter(node => node.tagName === selector.toUpperCase()); }
  all() { return this.children.flatMap(node => [node, ...node.all()]); }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}
class DetailEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
const source = await readFile(new URL('./better-matrix-ui.js', import.meta.url), 'utf8');
const cfg = {version:1,provider:'matrix',homeserver:'https://matrix.salix.host',name:'Better Cherri',rooms:{'better-general':'!general:salix.host','better-games':'!games:salix.host','better-music':'!music:salix.host'}};
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(options = {}) {
  let session = options.session ?? null, community = options.community ?? null;
  const calls = [], events = [], copied = [], downloads = [];
  const client = {
    getSession: () => clone(session), getCommunity: () => clone(community),
    getRegistrationInfo: () => options.registrationInfo ?? {providerName:'Salix',usernameHint:'@username:salix.host',tokenRequired:true,termsUrl:'https://salix.host/terms/',tokenUrl:'https://salix.host/matrix/'},
    login: async (username, password) => { calls.push(['login',username,password]); if (options.login) return options.login(); session={userId:'@member:salix.host',deviceId:'device',accessToken:'SESSION_SECRET'}; return clone(session); },
    register: async (username,password,token,registrationOptions) => { calls.push(['register',username,password,token,clone(registrationOptions)]); if (options.register) return options.register(); session={userId:'@newmember:salix.host',deviceId:'newdevice',accessToken:'NEW_SESSION_SECRET'}; return clone(session); },
    logout: async () => { calls.push(['logout']); session=null; },
    createCommunity: async () => { calls.push(['create']); community=clone(cfg); return clone(community); },
    setCommunity: value => { calls.push(['import',clone(value)]); if (!value.rooms || Object.keys(value.rooms).length !== 3) throw new Error('Three room IDs are required.'); community=clone(cfg); return clone(community); },
    invite: async id => { calls.push(['invite',id]); return options.inviteResult ?? Object.keys(cfg.rooms).map(name => ({name,invited:true})); },
    joinCommunity: async () => { calls.push(['join']); return Object.keys(cfg.rooms).map(name => ({name,joined:true})); },
    listMembers: async () => { calls.push(['members']); return []; }
  };
  const context = vm.createContext({URL,document:{createElement:tag=>new Element(tag)},CustomEvent:DetailEvent,__betterMatrix:client,dispatchEvent:event=>{events.push(event);return true;},navigator:{clipboard:{writeText:async text=>copied.push(text)}},__BETTER_CHERRI_DOWNLOAD_LAUNCHER__:async config=>downloads.push(config),fetch:()=>{throw new Error('UI must not send its own network requests.');}});
  vm.runInContext(source, context);
  const container = new Element('div');
  return {container, calls, events, copied, downloads, ui:context.__betterMatrixUI, getSession:()=>session, setSession:value=>{session=value;}};
}
const nodes = (f, tag) => f.container.all().filter(node => node.tagName === tag.toUpperCase());
const byName = (f, name) => f.container.all().find(node => node.getAttribute('name') === name);
const btn = (f, text) => nodes(f,'button').find(node => node.textContent === text);
const form = (f, label) => nodes(f,'form').find(node => node.getAttribute('aria-label') === label);
const click = node => { assert.ok(node, 'The requested control exists.'); node.dispatchEvent(new Event('click')); };
const submit = node => { assert.ok(node, 'The requested form exists.'); node.dispatchEvent(new Event('submit',{cancelable:true})); };

{
  const f = fixture(); f.ui.mountAccount(f.container);
  assert.deepEqual(f.calls, [], 'Mount does not log in, register, or create rooms.');
  assert.equal(byName(f,'matrix-password').getAttribute('type'),'password');
  const anchors = nodes(f,'a');
  assert.ok(btn(f,'Create account (no email)'),'Create account is an in-app mode button.');
  assert.ok(!anchors.some(node=>/register|signup/.test(node.getAttribute('href'))),'No external account signup link.');
  assert.match(f.container.textContent,/No email is required/);
  assert.ok(!anchors.some(node=>/account\.matrix\.org/.test(node.getAttribute('href'))));
  assert.ok(!anchors.some(node=>node.textContent==='Reset password'));
  for (const node of anchors) assert.equal(node.getAttribute('rel'),'noopener noreferrer');
  submit(form(f,'Matrix sign in')); await tick(); assert.deepEqual(f.calls, [], 'Empty credentials never transmit.');
  byName(f,'matrix-username').value='  @member:salix.host  ';
  byName(f,'matrix-password').value='PASSWORD_SECRET';
  submit(form(f,'Matrix sign in'));
  assert.equal(byName(f,'matrix-password').value,'','Password input clears before login resolves.');
  await tick();
  assert.deepEqual(f.calls,[['login','@member:salix.host','PASSWORD_SECRET']]);
  assert.deepEqual(f.events.map(event=>event.type),['cherri:me','cherri:session','better-matrix:session']);
  assert.ok(!JSON.stringify(f.events.map(event=>event.detail)).includes('SESSION_SECRET'));
  const chat=nodes(f,'a').find(node=>node.getAttribute('href')==='#/chat');
  assert.equal(chat.getAttribute('target'),null,'Internal Chatrooms navigation remains in the app.');
  click(btn(f,'Sign out')); await tick(); assert.equal(f.getSession(),null);
}
{
  const f=fixture();f.ui.mountAccount(f.container);click(btn(f,'Create account (no email)'));
  assert.deepEqual(f.calls,[],'Opening Create account does not register or request an anti-spam token.');
  assert.ok(form(f,'Create Better Cherri account'));
  assert.equal(nodes(f,'iframe').length,0,'The provider’s blocked iframe is never embedded.');
  assert.ok(!nodes(f,'input').some(node=>node.getAttribute('type')==='email'));
  for(const name of ['matrix-new-password','matrix-confirm-password']){
    assert.equal(byName(f,name).getAttribute('type'),'password');assert.equal(byName(f,name).getAttribute('autocomplete'),'new-password');
  }
  assert.equal(byName(f,'matrix-accept-terms').checked,undefined,'Terms are never automatically accepted.');
  submit(form(f,'Create Better Cherri account'));await tick();assert.equal(f.calls.length,0);
  byName(f,'matrix-new-username').value='newmember';byName(f,'matrix-new-password').value='NEW_PASSWORD';byName(f,'matrix-confirm-password').value='DIFFERENT';
  submit(form(f,'Create Better Cherri account'));await tick();assert.match(f.container.textContent,/passwords do not match/);assert.equal(f.calls.length,0);
  byName(f,'matrix-confirm-password').value='NEW_PASSWORD';submit(form(f,'Create Better Cherri account'));await tick();assert.match(f.container.textContent,/anti-spam check/);assert.equal(f.calls.length,0);
  byName(f,'matrix-registration-token').value='HUMAN_TOKEN';submit(form(f,'Create Better Cherri account'));await tick();assert.match(f.container.textContent,/accept the provider/);assert.equal(f.calls.length,0);
  byName(f,'matrix-accept-terms').checked=true;submit(form(f,'Create Better Cherri account'));
  assert.equal(byName(f,'matrix-new-password').value,'');assert.equal(byName(f,'matrix-confirm-password').value,'');assert.equal(byName(f,'matrix-registration-token').value,'');
  await tick();assert.deepEqual(f.calls,[['register','newmember','NEW_PASSWORD','HUMAN_TOKEN',{acceptTerms:true,acceptedPolicies:[]}]]);
  assert.deepEqual(f.events.map(event=>event.type),['cherri:me','cherri:session','better-matrix:session']);
  assert.ok(!JSON.stringify(f.events.map(event=>event.detail)).includes('NEW_SESSION_SECRET'));
  assert.ok(!f.calls.some(call=>call[0]==='create'),'Account creation does not silently create rooms.');
}
{
  const f=fixture({registrationInfo:{providerName:'Hosted Chat',usernameHint:'@username:example.test',tokenRequired:false,termsUrl:'https://example.test/terms'}});
  f.ui.mountAccount(f.container);click(btn(f,'Create account (no email)'));
  assert.equal(byName(f,'matrix-registration-token'),undefined,'Direct-registration providers do not display token steps.');
  assert.ok(!nodes(f,'a').some(node=>/salix|register/.test(node.getAttribute('href'))),'No external signup or token redirect is required.');
  byName(f,'matrix-new-username').value='newmember';byName(f,'matrix-new-password').value='NEW_PASSWORD';byName(f,'matrix-confirm-password').value='NEW_PASSWORD';byName(f,'matrix-accept-terms').checked=true;
  submit(form(f,'Create Better Cherri account'));await tick();assert.equal(f.calls[0][0],'register');assert.equal(f.calls[0][3],'');
}
{
  const error=Object.assign(new Error('Read and accept the chat server policy.'),{code:'BETTER_REGISTRATION_TERMS_REQUIRED',policies:[{id:'privacy',name:'Privacy policy',url:'https://example.test/privacy'}]});
  const f=fixture({registrationInfo:{providerName:'Hosted Chat',tokenRequired:false,termsUrl:'https://example.test/terms'},register:async()=>{throw error;}});
  f.ui.mountAccount(f.container);click(btn(f,'Create account (no email)'));
  const fill=()=>{byName(f,'matrix-new-username').value='newmember';byName(f,'matrix-new-password').value='NEW_PASSWORD';byName(f,'matrix-confirm-password').value='NEW_PASSWORD';byName(f,'matrix-accept-terms').checked=true;};
  fill();submit(form(f,'Create Better Cherri account'));await tick();
  assert.ok(nodes(f,'a').some(node=>node.getAttribute('href')==='https://example.test/privacy'));
  const policy=nodes(f,'input').find(node=>node.getAttribute('aria-label')==='Accept Privacy policy');assert.ok(policy);assert.equal(policy.checked,undefined);
  fill();submit(form(f,'Create Better Cherri account'));await tick();assert.equal(f.calls.length,1,'Server terms need an explicit fresh checkbox action.');
  policy.checked=true;submit(form(f,'Create Better Cherri account'));await tick();assert.deepEqual(f.calls[1][4].acceptedPolicies,['privacy']);
}
{
  let finish;
  const f=fixture({registrationInfo:{providerName:'Hosted Chat',tokenRequired:false,termsUrl:'https://example.test/terms'},register:()=>new Promise(resolve=>{finish=resolve;})});
  const stop=f.ui.mountAccount(f.container);click(btn(f,'Create account (no email)'));
  byName(f,'matrix-new-username').value='newmember';byName(f,'matrix-new-password').value='NEW_PASSWORD';byName(f,'matrix-confirm-password').value='NEW_PASSWORD';byName(f,'matrix-accept-terms').checked=true;
  submit(form(f,'Create Better Cherri account'));stop();finish({userId:'@newmember:salix.host'});await tick();
  assert.equal(f.container.children.length,0);assert.equal(f.events.length,0,'Destroyed signup cannot rerender or fire session events.');
}
{
  const error=Object.assign(new Error('Please wait.'),{status:429,retryAfterMs:3200});
  const f=fixture({login:async()=>{throw error;}}); f.ui.mountAccount(f.container);
  byName(f,'matrix-username').value='member'; byName(f,'matrix-password').value='secret';
  submit(form(f,'Matrix sign in')); await tick();
  assert.match(f.container.textContent,/rate limiting.*4 seconds/i);
  assert.equal(f.events.length,0); assert.equal(btn(f,'Sign in →').disabled,false);
}
{
  let finish;
  const f=fixture({login:()=>new Promise(resolve=>{finish=resolve;})});
  const stop=f.ui.mountAccount(f.container);
  byName(f,'matrix-username').value='member';byName(f,'matrix-password').value='secret';
  submit(form(f,'Matrix sign in')); stop(); finish({userId:'@member:salix.host'}); await tick();
  assert.equal(f.container.children.length,0,'Cleanup prevents late async rendering.');
  assert.equal(f.events.length,0,'Destroyed mounts do not dispatch login refreshes.');
}
{
  const f=fixture({session:{userId:'@owner:salix.host'}}); f.ui.mountCommunity(f.container);
  assert.deepEqual(f.calls,[]); assert.ok(btn(f,'Create private rooms'));
  assert.equal(nodes(f,'details')[0].open,true);
  assert.ok(!btn(f,'Download community launcher'));
  click(btn(f,'Create private rooms')); await tick();
  assert.deepEqual(f.calls,[['create']]);
  assert.equal(nodes(f,'details')[0].open,false,'Configured controls collapse to leave the original chat visible.');
  assert.ok(!btn(f,'Create private rooms'));
  assert.deepEqual(f.events.map(event=>event.type),['better-matrix:community']);
}
{
  const dirty={...cfg,accessToken:'CONFIG_SECRET',password:'PASSWORD_SECRET',rooms:{...cfg.rooms,shared:'!stock:salix.host'}};
  const f=fixture({session:{userId:'<img src=x onerror=alert(1)>',accessToken:'SESSION_SECRET'},community:dirty});
  f.ui.mountCommunity(f.container); assert.deepEqual(f.calls,[]);
  assert.ok(f.container.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.equal(nodes(f,'img').length,0,'Untrusted IDs render only as text.');
  click(btn(f,'Copy configuration')); await tick();
  const exported=JSON.parse(f.copied[0]); assert.deepEqual(exported,cfg);
  assert.ok(!f.copied[0].includes('SECRET')); assert.ok(!f.copied[0].includes('stock'));
  click(btn(f,'Download community launcher')); await tick();
  assert.deepEqual(clone(f.downloads[0]),cfg); assert.ok(!JSON.stringify(f.downloads).includes('SECRET'));
  byName(f,'invite-user').value='@friend:salix.host'; submit(form(f,'Invite a member')); await tick();
  assert.ok(f.calls.some(call=>call[0]==='invite'&&call[1]==='@friend:salix.host'));
  click(btn(f,'Accept room invitations')); await tick();
  assert.ok(f.calls.some(call=>call[0]==='join')); assert.ok(f.events.some(event=>event.type==='better-matrix:community'));
}
{
  const f=fixture({session:{userId:'@member:salix.host'}}); f.ui.mountCommunity(f.container);
  byName(f,'community-config').value='{not json'; submit(form(f,'Import community configuration')); await tick();
  assert.equal(f.calls.length,0,'Invalid JSON is not sent to the client.');
  assert.ok(nodes(f,'div').some(node=>node.getAttribute('role')==='alert'));
  byName(f,'community-config').value=JSON.stringify(cfg); submit(form(f,'Import community configuration')); await tick();
  assert.deepEqual(f.calls.map(call=>call[0]),['import'],'Import does not silently create or join rooms.');
  assert.equal(f.events[0].type,'better-matrix:community');
}
{
  const f=fixture({session:{userId:'@member:salix.host'},community:cfg,inviteResult:[{name:'better-general',invited:false,error:'Matrix is rate limiting this account. Try again in 5 seconds.'}]});
  f.ui.mountCommunity(f.container);byName(f,'invite-user').value='@friend:salix.host';submit(form(f,'Invite a member'));await tick();
  assert.match(f.container.textContent,/better-general: Matrix is rate limiting/);
  const firstStop=f.ui.mountAccount(f.container); f.ui.mountCommunity(f.container); firstStop();
  assert.ok(f.container.children.length>0,'An older cleanup cannot remove a newer mount.');
}
{
  const f=fixture();const stop=f.ui.mountAccount(f.container);
  const chat=new Element('article');chat.textContent='Original React chat';
  f.container.append(chat);stop();
  assert.deepEqual(f.container.children,[chat],'Effect cleanup removes only its own nodes, preserving newly committed React chat.');
}
console.log('Matrix UI: native no-email signup, explicit password/terms/token actions, login, room creation/import/invitations, safe exports, errors, event refreshes, and async cleanup passed. No network requests.');
