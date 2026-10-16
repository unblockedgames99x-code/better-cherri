import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const schemaSource=await fs.readFile(new URL('./better-xmpp-schema.js',import.meta.url),'utf8');
const schemaContext=vm.createContext({});vm.runInContext(schemaSource,schemaContext);const schema=schemaContext.__betterXmppSchema;
const defaultConfig=schema.createDefault('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','alice@yax.im');
const source=await fs.readFile(new URL('./better-xmpp-client.js',import.meta.url),'utf8');
const NS={client:'jabber:client',data:'jabber:x:data',register:'jabber:iq:register',user:'http://jabber.org/protocol/muc#user',owner:'http://jabber.org/protocol/muc#owner',admin:'http://jabber.org/protocol/muc#admin',muc:'http://jabber.org/protocol/muc',disco:'http://jabber.org/protocol/disco#info',mam:'urn:xmpp:mam:2',rsm:'http://jabber.org/protocol/rsm',sid:'urn:xmpp:sid:0',forward:'urn:xmpp:forward:0',delay:'urn:xmpp:delay'};
const normalized=value=>JSON.parse(JSON.stringify(value));
class Element {
  constructor(name,attrs={},kids=[]){this.nodeType=1;this.nodeName=name;this.localName=name.split(':').at(-1);this.attrs={...attrs};this.childNodes=[];for(const kid of kids)this.appendChild(kid);}
  get children(){return this.childNodes.filter(value=>typeof value!=='string');}
  get namespaceURI(){return this.attrs.xmlns||this.parentNode?.namespaceURI||'';}
  get textContent(){return this.childNodes.map(value=>typeof value==='string'?value:value.textContent).join('');}
  getAttribute(name){return this.attrs[name]??null;}
  setAttribute(name,value){this.attrs[name]=String(value);}
  appendChild(value){if(typeof value!=='string')value.parentNode=this;this.childNodes.push(value);return value;}
  clone(){return new Element(this.nodeName,{...this.attrs},this.childNodes.map(value=>typeof value==='string'?value:value.clone()));}
}
class Builder {
  constructor(name,attrs){this.root=new Element(name,attrs);this.stack=[this.root];}
  t(value){this.stack.at(-1).appendChild(String(value));return this;}
  cnode(value){this.stack.at(-1).appendChild(value);this.stack.push(value);return this;}
  up(){if(this.stack.length>1)this.stack.pop();return this;}
  tree(){return this.root;}
}
const e=(name,attrs={},kids=[])=>new Element(name,attrs,kids);
const kids=element=>element?.children||[];
const child=(element,name,ns)=>kids(element).find(value=>value.localName===name&&(!ns||value.namespaceURI===ns));
const all=(element,name)=>kids(element).flatMap(value=>[...(value.localName===name?[value]:[]),...all(value,name)]);
const val=(element,name)=>element?.getAttribute(name)||'';
const storage=()=>{const data=new Map();return{data,getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
const defaults=()=>({'FORM_TYPE':'http://jabber.org/protocol/muc#roomconfig','muc#roomconfig_persistentroom':'0','muc#roomconfig_membersonly':'0','muc#roomconfig_publicroom':'1','muc#roomconfig_whois':'moderators','{http://prosody.im/protocol/muc}roomconfig_allowmemberinvites':'1','muc#roomconfig_enablearchiving':'0','muc#roomconfig_roomname':'','muc#roomconfig_changesubject':'1','muc#roomconfig_moderatedroom':'0'});

function server(){
  const rooms=new Map(),accounts=new Map([['alice','alice-password'],['bob','bob-password']]),connections=[],requests=[];
  let archiveNumber=0,registrationExtra=false,omitSetting='',forcedArchive=false,mutateSettings=false,noArchiveIds=false,echoHook=null,discoFailure='';
  const failure=(iq,code='forbidden')=>e('iq',{xmlns:NS.client,type:'error',id:val(iq,'id'),from:val(iq,'to')},[e('error',{type:'cancel'},[e(code,{xmlns:'urn:ietf:params:xml:ns:xmpp-stanzas'})])]);
  const reply=(iq,payload=[])=>e('iq',{xmlns:NS.client,type:'result',id:val(iq,'id'),from:val(iq,'to')},payload);
  const field=(key,value)=>e('field',{var:key,type:key==='FORM_TYPE'?'hidden':'text-single'},[e('value',{},[value])]);
  const archive=(room,stanza,sender='alice@yax.im',stamp)=>{
    const id='archive-'+(++archiveNumber),copy=stanza.clone();copy.attrs.from=room.id+'/'+(room.present.get(sender)?.nick||sender.split('@')[0]);copy.attrs.type='groupchat';
    copy.appendChild(e('x',{xmlns:NS.user},[e('item',{jid:sender,affiliation:room.members.get(sender)||'member',role:'participant'})]));
    if(!noArchiveIds)copy.appendChild(e('stanza-id',{xmlns:NS.sid,by:room.id,id}));
    const event={id,stanza:copy,stamp:stamp||new Date(1760000000000+archiveNumber*10).toISOString()};room.archive.push(event);return event;
  };
  function presence(conn,stanza){
    const to=val(stanza,'to');if(!to)return;const[id,nick]=to.split('/');if(!id.endsWith('@chat.yax.im'))return;
    let room=rooms.get(id),created=false;
    if(!room){room={id,creator:conn.bare,members:new Map([[conn.bare,'owner']]),settings:defaults(),archive:[],present:new Map()};if(forcedArchive)delete room.settings['muc#roomconfig_enablearchiving'];rooms.set(id,room);created=true;}
    if(val(stanza,'type')==='unavailable'){room.present.delete(conn.bare);return;}
    if(!room.members.has(conn.bare)){conn.deliver(e('presence',{xmlns:NS.client,from:to,type:'error'},[e('error',{type:'auth'},[e('registration-required',{xmlns:'urn:ietf:params:xml:ns:xmpp-stanzas'})])]));return;}
    room.present.set(conn.bare,{conn,nick});
    for(const[jid,present]of room.present)conn.deliver(e('presence',{xmlns:NS.client,from:id+'/'+present.nick},[e('x',{xmlns:NS.user},[e('item',{jid,affiliation:room.members.get(jid),role:room.members.get(jid)==='owner'?'moderator':'participant'}),...(jid===conn.bare?[e('status',{code:'110'}),...(created?[e('status',{code:'201'})]:[])]:[])])]));
    for(const[jid,present]of room.present)if(jid!==conn.bare)present.conn.deliver(e('presence',{xmlns:NS.client,from:id+'/'+nick},[e('x',{xmlns:NS.user},[e('item',{jid:conn.bare,affiliation:room.members.get(conn.bare),role:'participant'})])]));
  }
  function message(conn,stanza){
    const room=rooms.get(val(stanza,'to'));if(!room)return;
    if(!room.members.has(conn.bare)){conn.deliver(e('message',{xmlns:NS.client,from:room.id,type:'error',id:val(stanza,'id')},[e('error',{type:'auth'},[e('forbidden',{xmlns:'urn:ietf:params:xml:ns:xmpp-stanzas'})])]));return;}
    if(child(stanza,'composing')){for(const present of room.present.values())present.conn.deliver(e('message',{xmlns:NS.client,from:room.id+'/'+room.present.get(conn.bare).nick,type:'groupchat'},[e('composing',{xmlns:'http://jabber.org/protocol/chatstates'})]));return;}
    if(!child(stanza,'body'))return;
    const event=archive(room,stanza,conn.bare);
    const broadcast=()=>{for(const present of room.present.values())present.conn.deliver(event.stanza.clone());};
    if(echoHook){const hook=echoHook;echoHook=null;hook({conn,stanza,room,event,broadcast});}else broadcast();
  }
  function handleIQ(conn,iq){
    requests.push({conn,iq:iq.clone()});const to=val(iq,'to'),type=val(iq,'type');const query=child(iq,'query');
    if(query?.namespaceURI===NS.register){
      if(type==='get')return reply(iq,[e('query',{xmlns:NS.register},[e('x',{xmlns:NS.data,type:'form'},[e('field',{var:'FORM_TYPE',type:'hidden'},[e('value',{},[NS.register])]),e('field',{var:'username'},[e('required')]),e('field',{var:'password',type:'text-private'},[e('required')]),...(registrationExtra?[e('field',{var:'email'},[e('required')])]:[])])])]);
      const values=Object.fromEntries(all(query,'field').map(item=>[val(item,'var'),child(item,'value')?.textContent]));
      if(accounts.has(values.username))return failure(iq,'conflict');if(registrationExtra)return failure(iq,'not-acceptable');accounts.set(values.username,values.password);return reply(iq);
    }
    if(query?.namespaceURI===NS.disco&&discoFailure)return failure(iq,discoFailure);
    const room=rooms.get(to);if(!room)return failure(iq,'item-not-found');if(!room.members.has(conn.bare))return failure(iq,'forbidden');
    if(query?.namespaceURI===NS.owner){
      if(room.members.get(conn.bare)!=='owner')return failure(iq,'forbidden');
      if(child(query,'destroy')){rooms.delete(to);return reply(iq);}
      if(type==='get')return reply(iq,[e('query',{xmlns:NS.owner},[e('x',{xmlns:NS.data,type:'form'},Object.entries(room.settings).filter(([key])=>key!==omitSetting).map(([key,value])=>field(key,value)))])]);
      for(const item of all(query,'field'))room.settings[val(item,'var')]=child(item,'value')?.textContent||'';
      if(mutateSettings)room.settings['muc#roomconfig_publicroom']='1';return reply(iq);
    }
    if(query?.namespaceURI===NS.disco){
      const features=['muc','urn:xmpp:message-retract:1'];const settings=room.settings;
      if(settings['muc#roomconfig_membersonly']==='1')features.push('muc_membersonly');if(settings['muc#roomconfig_publicroom']==='0')features.push('muc_hidden');if(settings['muc#roomconfig_persistentroom']==='1')features.push('muc_persistent');if(settings['muc#roomconfig_whois']==='anyone')features.push('muc_nonanonymous');if(forcedArchive||settings['muc#roomconfig_enablearchiving']==='1')features.push(NS.mam);
      return reply(iq,[e('query',{xmlns:NS.disco},features.map(feature=>e('feature',{var:feature})))]);
    }
    if(query?.namespaceURI===NS.admin){
      const item=child(query,'item'),affiliation=val(item,'affiliation');
      if(type==='set'){if(!['owner','admin'].includes(room.members.get(conn.bare)))return failure(iq,'forbidden');room.members.set(val(item,'jid'),affiliation);return reply(iq);}
      return reply(iq,[e('query',{xmlns:NS.admin},[...room.members].filter(([,role])=>role===affiliation).map(([jid,role])=>e('item',{jid,affiliation:role})))]);
    }
    if(query?.namespaceURI===NS.mam){
      if(!forcedArchive&&room.settings['muc#roomconfig_enablearchiving']!=='1')return failure(iq,'feature-not-implemented');
      const set=child(query,'set',NS.rsm),before=child(set,'before')?.textContent||'',limit=Number(child(set,'max')?.textContent)||50,end=before?room.archive.findIndex(event=>event.id===before):room.archive.length,start=Math.max(0,end-limit),page=room.archive.slice(start,end);
      for(const event of page)conn.deliver(e('message',{xmlns:NS.client,from:room.id},[e('result',{xmlns:NS.mam,queryid:val(query,'queryid'),id:event.id},[e('forwarded',{xmlns:NS.forward},[e('delay',{xmlns:NS.delay,stamp:event.stamp}),event.stanza.clone()])])]));
      return reply(iq,[e('fin',{xmlns:NS.mam,complete:start===0?'true':'false'},[e('set',{xmlns:NS.rsm},page.length?[e('first',{},[page[0].id]),e('last',{},[page.at(-1).id])]:[])])]);
    }
    return failure(iq,'feature-not-implemented');
  }
  class Connection {
    constructor(service,options){assert.equal(service,'wss://xmpp.yaxim.org/xmpp-websocket');this.service=service;this.options=options;this.handlers=[];this.connected=false;this.authenticated=false;this.do_authentication=true;connections.push(this);}
    connect(jid,password,callback){this.jid=jid;this.bare=jid.split('/')[0];this.pass=password;this.callback=callback;queueMicrotask(()=>{this.connected=true;callback(1);if(this.do_authentication===false){this.xmlInput?.(e('features',{xmlns:'http://etherx.jabber.org/streams'},[e('mechanism',{},['SCRAM-SHA-1'])]));return;}if(accounts.get(this.bare.split('@')[0])!==password){callback(4);return;}this.authenticated=true;callback(5);});}
    addHandler(callback,ns,name,type,id){const handler={callback,ns,name,type,id,user:true};this.handlers.push(handler);return handler;}
    _addSysHandler(callback,ns,name,type,id){const handler=this.addHandler(callback,ns,name,type,id);handler.user=false;return handler;}
    deleteHandler(handler){this.handlers=this.handlers.filter(value=>value!==handler);}
    deliver(stanza){queueMicrotask(()=>{for(const handler of [...this.handlers]){if(handler.user&&!this.authenticated)continue;if(handler.name&&handler.name!==stanza.localName)continue;if(handler.type&&handler.type!==val(stanza,'type'))continue;if(handler.id&&handler.id!==val(stanza,'id'))continue;if(handler.ns&&stanza.namespaceURI!==handler.ns&&!all(stanza,'result').some(value=>value.namespaceURI===handler.ns))continue;if(handler.callback(stanza)===false)this.deleteHandler(handler);}});}
    sendIQ(stanza,onResult,onError){queueMicrotask(()=>{const result=handleIQ(this,stanza);queueMicrotask(()=>val(result,'type')==='error'?onError(result):onResult(result));});return val(stanza,'id');}
    send(stanza){requests.push({conn:this,sent:stanza.clone()});if(stanza.localName==='presence')queueMicrotask(()=>presence(this,stanza));else if(stanza.localName==='message')queueMicrotask(()=>message(this,stanza));else if(stanza.localName==='iq')queueMicrotask(()=>this.deliver(handleIQ(this,stanza)));}
    flush(){}
    disconnect(){this.pass=null;this.authenticated=false;this.connected=false;for(const room of rooms.values())room.present.delete(this.bare);queueMicrotask(()=>this.callback?.(6));}
  }
  const Strophe={Connection,Status:{ERROR:0,CONNFAIL:2,AUTHFAIL:4,CONNECTED:5,DISCONNECTED:6,CONNTIMEOUT:10},SASLSHA1:class{},SASLSHA256:class{},SASLSHA384:class{},SASLSHA512:class{}};
  return{rooms,accounts,connections,requests,Strophe,archive,setEchoHook:value=>{echoHook=value;},setRegistrationExtra:value=>{registrationExtra=value;},setMissingSetting:value=>{omitSetting=value;},setForcedArchive:value=>{forcedArchive=value;},setMutateSettings:value=>{mutateSettings=value;},setNoArchiveIds:value=>{noArchiveIds=value;},setDiscoFailure:value=>{discoFailure=value;}};
}
function client(remote,store=storage(),config,options={}){let random=0;const events=[];const ctx=vm.createContext({Strophe:remote.Strophe,$build:(name,attrs)=>new Builder(name,attrs),localStorage:store,crypto:{randomUUID:()=> (++random).toString(16).padStart(32,'0')},Uint8Array,Date,Map,Set,Object,JSON,Promise,Array,String,Number,Math,Error,setTimeout,clearTimeout,console,queueMicrotask,__BETTER_XMPP_COMMUNITY__:config,__BETTER_XMPP_DEFAULT_COMMUNITY__:options.defaultCommunity||defaultConfig,__BETTER_XMPP_PREVIOUS_DEFAULT_OWNERS__:options.previousOwners,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},dispatchEvent:event=>events.push(event),fetch:()=>{throw Error('No HTTP requests are allowed in this mock test.');}});vm.runInContext(schemaSource,ctx,{filename:'better-xmpp-schema.js'});vm.runInContext(source,ctx,{filename:'better-xmpp-client.js'});return{api:ctx.__betterXmpp,store,events};}

const remote=server(),alice=client(remote);
assert.equal(alice.api.getSession(),null);assert.equal(alice.api.getRegistrationInfo().tokenRequired,false);
const emptyRemote=server(),nonowner=client(emptyRemote);await nonowner.api.login('bob','bob-password');
const emptyStatuses=[];nonowner.api.subscribe(event=>{if(event.type==='status')emptyStatuses.push(event);});
const locked=await nonowner.api.listChannels();assert.equal(locked.length,13);assert(locked.every(channel=>channel.locked&&!channel.canRead&&!channel.canPost));
assert(locked.every(channel=>channel.accessState==='not-created'&&channel.accessErrorCode==='item-not-found'&&channel.accessMessage.includes('alice@yax.im')),'missing rooms are distinguished from invitations and identify the designated owner');
assert.equal(emptyStatuses.length,1);assert.match(emptyStatuses[0].error,/not been initialized.*alice@yax\.im/);
await nonowner.api.listChannels();assert.equal(emptyStatuses.length,1,'repeated empty channel loads emit one deduplicated setup diagnostic');
assert.equal(emptyRemote.rooms.size,0,'listing the shared default never creates a per-user community or missing MUC');
assert.equal(emptyRemote.requests.some(row=>row.sent?.localName==='presence'&&val(row.sent,'to').includes('@chat.yax.im')),false,'nonowners do not send room-creating presence to missing MUCs');
await assert.rejects(nonowner.api.createCommunity(),failure=>failure.code==='forbidden');await assert.rejects(nonowner.api.getMessages('general'),failure=>failure.code==='item-not-found');assert.deepEqual(normalized(await nonowner.api.listMembers()),[]);await nonowner.api.logout();
await assert.rejects(alice.api.register('newbie','newbie-password',{}),failure=>failure.code==='BETTER_REGISTRATION_TERMS_REQUIRED');assert.equal(remote.connections.length,0);
const newbie=client(remote);const registered=await newbie.api.register('newbie','newbie-password',{acceptTerms:true});assert.equal(registered.userId,'newbie@yax.im');assert(remote.accounts.has('newbie'));
assert(remote.requests.filter(row=>row.iq&&child(row.iq,'query',NS.register)&&val(row.iq,'type')==='set').length===1,'one actual registration IQ is submitted');
assert.equal([...newbie.store.data.values()].join('').includes('newbie-password'),false,'passwords are never persisted');assert.equal(remote.connections.at(-1).pass,null,'SDK raw password is cleared after SCRAM succeeds');
assert(remote.connections.at(-1).options.mechanisms.every(value=>value!==undefined));
remote.setRegistrationExtra(true);const blockedRegistration=client(remote);const registrationBefore=remote.requests.filter(row=>row.iq&&val(row.iq,'type')==='set'&&child(row.iq,'query',NS.register)).length;
await assert.rejects(blockedRegistration.api.register('emailneeded','long-password',{acceptTerms:true}),failure=>failure.code==='BETTER_REGISTRATION_UNSUPPORTED');
assert.equal(remote.accounts.has('emailneeded'),false);assert.equal(remote.requests.filter(row=>row.iq&&val(row.iq,'type')==='set'&&child(row.iq,'query',NS.register)).length,registrationBefore,'required email/verification is never skipped');remote.setRegistrationExtra(false);

await alice.api.login('alice@yax.im','alice-password');assert.equal((await alice.api.me()).id,'alice@yax.im');
const firstOwnerChannels=await alice.api.listChannels();assert.equal(firstOwnerChannels.length,13);assert(firstOwnerChannels.every(channel=>channel.canRead&&channel.canPost&&!channel.locked),'first normal Chat entry automatically initializes the designated owner’s shared private channels');
const cfg=alice.api.getCommunity();assert.equal(Object.keys(cfg.rooms).length,13);assert.equal(remote.rooms.size,13);
for(const room of remote.rooms.values()){assert.equal(room.settings['muc#roomconfig_persistentroom'],'1');assert.equal(room.settings['muc#roomconfig_membersonly'],'1');assert.equal(room.settings['muc#roomconfig_publicroom'],'0');assert.equal(room.settings['muc#roomconfig_whois'],'anyone');assert.equal(room.settings['{http://prosody.im/protocol/muc}roomconfig_allowmemberinvites'],'0');assert.equal(room.settings['muc#roomconfig_enablearchiving'],'1');}
assert.equal(alice.api.exportCommunity().includes('password'),false);assert.equal(alice.api.exportCommunity().includes('alice-password'),false);assert.equal(alice.api.exportCommunity().includes('scram'),false);
await alice.api.createCommunity();assert.equal(remote.rooms.size,13,'repeated setup reuses persisted rooms');
const evilCfg=normalized(cfg);evilCfg.rooms.art=cfg.rooms.general;assert.throws(()=>alice.api.setCommunity(evilCfg),/valid private room/);
const splitCfg=normalized(cfg);splitCfg.rooms.art=splitCfg.rooms.art.replace(/[0-9a-f]{32}/,'ffffffffffffffffffffffffffffffff');assert.throws(()=>alice.api.setCommunity(splitCfg),/same Better Cherri/);
assert.deepEqual(normalized((await alice.api.listChannels()).map(value=>value.name)),['rules','announcements','updates','links','general','general-2','art','share-music','member-shitpost','suggest-games','tag-ideas','suggest-features','report-issues']);

const sent=await alice.api.sendMessage('better-general','Saved message');assert.equal(sent.fromUserId,'alice@yax.im');assert.equal(typeof sent.id,'number');
const reply=await alice.api.sendMessage('better-general',{content:'Saved reply',replyToId:sent.id});assert.equal(reply.replyToId,sent.id);
await alice.api.edit(sent.id,{content:'Edited saved message'});assert.equal(alice.api.getCachedMessage(sent.id).content,'Edited saved message');
assert.deepEqual(normalized((await alice.api.react(sent.id,'🍒')).reactions),[{emoji:'🍒',userIds:['alice@yax.im']}]);assert.deepEqual(normalized((await alice.api.react(sent.id,'🍒')).reactions),[]);
const latest=await alice.api.getMessages('better-general',{limit:2});assert.equal(latest.messages.length<2,true,'raw archive mutation entries do not become fake messages');assert(latest.before,'raw relation-only pages retain a history cursor');assert.equal(latest.exhausted,false);
const older=await alice.api.getMessages('better-general',{limit:10,before:latest.before});assert.equal(older.messages.length,2);assert.equal(older.messages.find(message=>message.id===sent.id).content,'Edited saved message');
const previousStore=alice.store;await alice.api.logout();assert.equal(alice.api.getSession(),null);assert.equal(alice.api.getCachedMessage(sent.id),null,'logout clears previous account history from the public adapter');const reloaded=client(remote,previousStore);assert.equal(await reloaded.api.restore(),null,'raw passwords and reusable login secrets are not stored');await reloaded.api.login('alice','alice-password');const history=await reloaded.api.getMessages('better-general',{limit:20});assert.equal(history.messages.length,2,'room archive survives closing the original client');assert.equal(history.messages.find(message=>message.eventId===sent.eventId).id,sent.id,'numeric message aliases persist across reload');assert.equal(history.messages.find(message=>message.eventId===sent.eventId).content,'Edited saved message');

const bob=client(remote);await bob.api.login('bob','bob-password');bob.api.setCommunity(cfg);
const denied=await bob.api.joinCommunity();assert(denied.every(value=>!value.joined),'room addresses do not grant private membership');await assert.rejects(bob.api.getMessages('better-general'),failure=>failure.code==='forbidden');
const deniedChannels=await bob.api.listChannels();assert(deniedChannels.every(channel=>channel.accessState==='invitation-required'&&channel.accessErrorCode==='forbidden'&&channel.accessMessage.includes('bob@yax.im')&&channel.accessMessage.includes('alice@yax.im')),'existing private membership denial names the current account and actual configured owner');
assert((await reloaded.api.invite('bob@yax.im')).every(value=>value.invited));assert((await bob.api.joinCommunity()).every(value=>value.joined));assert.deepEqual(normalized((await bob.api.listMembers()).map(value=>value.id)),['alice@yax.im','bob@yax.im']);
const memberChannels=await bob.api.listChannels();assert(memberChannels.filter(channel=>channel.categoryId===1).every(channel=>channel.canRead&&!channel.canPost&&!channel.locked));
const beforeInfoWrite=remote.requests.length;await assert.rejects(bob.api.sendMessage('rules','Not allowed'),failure=>failure.code==='forbidden');assert.equal(remote.requests.filter(row=>row.sent?.localName==='message').length,remote.requests.slice(0,beforeInfoWrite).filter(row=>row.sent?.localName==='message').length,'nonowner Info writes never reach the server');
const infoMessage=await reloaded.api.sendMessage('rules','Community rules');const memberInfo=await bob.api.getMessages('rules');const infoReaction=await bob.api.react(memberInfo.messages.find(message=>message.eventId===infoMessage.eventId).id,'👍');assert.equal(infoReaction.reactions[0].userIds[0],'bob@yax.im','read-only Info channels retain member reactions');
const memberHistory=await bob.api.getMessages('better-general',{limit:20});assert.equal(memberHistory.messages.length,2,'invited members can read retained room history');
const writeCount=remote.requests.length;await assert.rejects(bob.api.edit(memberHistory.messages.find(message=>message.eventId===sent.eventId).id,'Impersonate'),failure=>failure.code==='forbidden');assert.equal(remote.requests.length,writeCount,'another sender cannot be edited');
const observed=[];const unsubscribe=bob.api.subscribe(event=>observed.push(event));await reloaded.api.sendMessage('better-general','Live delivery');await new Promise(resolve=>setTimeout(resolve,0));assert(observed.some(event=>event.type==='message'&&event.message.content==='Live delivery'));unsubscribe();
// A member can include arbitrary extension XML. Prosody appends authoritative
// archive metadata last; live identity must come from verified room presence.
const generalRoom=remote.rooms.get(cfg.rooms.general),aliceConn=generalRoom.present.get('alice@yax.im').conn;
const forgedPayload=e('message',{xmlns:NS.client,type:'groupchat',to:generalRoom.id,id:'forged-bob-wire'},[e('body',{},['Forged author attempt']),e('x',{xmlns:NS.user},[e('item',{jid:'alice@yax.im'})]),e('stanza-id',{xmlns:NS.sid,by:generalRoom.id,id:sent.eventId})]);
const forgedEvent=remote.archive(generalRoom,forgedPayload,'bob@yax.im');
const liveAuthors=[];const stopAuthors=reloaded.api.subscribe(event=>liveAuthors.push(event));aliceConn.deliver(forgedEvent.stanza.clone());await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(liveAuthors.find(event=>event.type==='message'&&event.message.content==='Forged author attempt').message.fromUserId,'bob@yax.im','live payload cannot forge another occupant identity');stopAuthors();
const forgedHistory=await reloaded.api.getMessages('better-general',{limit:100});const forgedMessage=forgedHistory.messages.find(message=>message.content==='Forged author attempt');
assert.equal(forgedMessage.fromUserId,'bob@yax.im','MAM uses the last server-appended JID, ignoring the forged first item');assert.equal(forgedMessage.eventId,forgedEvent.id,'server-assigned archive ID wins over a forged earlier stanza-id');
await assert.rejects(reloaded.api.edit(forgedMessage.id,'Claim ownership'),failure=>failure.code==='forbidden');
let releaseOwnEcho;remote.setEchoHook(({conn,stanza,room,event,broadcast})=>{
  const bobSpoof=stanza.clone();bobSpoof.appendChild(e('x',{xmlns:NS.user},[e('item',{jid:'alice@yax.im'})]));const savedSpoof=remote.archive(room,bobSpoof,'bob@yax.im');conn.deliver(savedSpoof.stanza.clone());
  const altered=event.stanza.clone();child(altered,'body').childNodes=['Server changed payload'];conn.deliver(altered);
  const otherRoom=remote.rooms.get(cfg.rooms.art),wrongRoom=remote.archive(otherRoom,stanza,'alice@yax.im');conn.deliver(wrongRoom.stanza.clone());
  releaseOwnEcho=broadcast;
});
let sendSettled=false;const guardedSend=reloaded.api.sendMessage('better-general','Expected own echo').then(message=>{sendSettled=true;return message;});await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(typeof releaseOwnEcho,'function');assert.equal(sendSettled,false,'another sender, altered payload or another room cannot confirm the send');releaseOwnEcho();const confirmed=await guardedSend;assert.equal(confirmed.content,'Expected own echo');assert.equal(confirmed.fromUserId,'alice@yax.im');
await reloaded.api.edit(confirmed.id,'Verified edit after duplicate origin ID');assert.equal(reloaded.api.getCachedMessage(confirmed.id).content,'Verified edit after duplicate origin ID','forged duplicate client IDs cannot redirect an owned correction');
await reloaded.api.remove(sent.id);assert.equal(reloaded.api.getCachedMessage(sent.id),null);await assert.rejects(reloaded.api.search('better-general','Saved'),failure=>failure.code==='BETTER_SEARCH_UNSUPPORTED');
const tombstoneEvents=[];const stopTombstones=reloaded.api.subscribe(event=>tombstoneEvents.push(event));
const originalReply=generalRoom.archive.find(event=>event.id===reply.eventId);originalReply.stanza.childNodes=originalReply.stanza.childNodes.filter(value=>typeof value==='string'||value.localName!=='body');originalReply.stanza.appendChild(e('retracted',{xmlns:'urn:xmpp:message-retract:1',stamp:new Date().toISOString()}));
await reloaded.api.getMessages('better-general',{limit:100});assert.equal(reloaded.api.getCachedMessage(reply.id),null,'a matched MAM tombstone removes previously cached original content');assert(tombstoneEvents.some(event=>event.type==='delete'&&event.room==='general'&&event.messageId===reply.id),'a trusted tombstone immediately removes the visible React message through the existing delete stream');stopTombstones();
assert.equal(remote.requests.some(row=>row.iq&&val(row.iq,'to')&&!['yax.im',...Object.values(cfg.rooms)].includes(val(row.iq,'to'))),false,'no global rooms or users are queried');

const unsupportedRemote=server();unsupportedRemote.setMissingSetting('muc#roomconfig_membersonly');const unsupported=client(unsupportedRemote);await unsupported.api.login('alice','alice-password');await assert.rejects(unsupported.api.createCommunity(),failure=>failure.code==='BETTER_ROOM_UNSUPPORTED');assert.equal(unsupportedRemote.rooms.size,0,'a newly created room is destroyed if mandatory privacy cannot be established');
const noInviteRemote=server();noInviteRemote.setMissingSetting('{http://prosody.im/protocol/muc}roomconfig_allowmemberinvites');const noInvite=client(noInviteRemote);await noInvite.api.login('alice','alice-password');await assert.rejects(noInvite.api.createCommunity(),failure=>failure.code==='BETTER_ROOM_UNSUPPORTED');assert.equal(noInviteRemote.rooms.size,0,'missing actual Prosody invitation control fails closed');await noInvite.api.logout();
const ignoredRemote=server();ignoredRemote.setMutateSettings(true);const ignored=client(ignoredRemote);await ignored.api.login('alice','alice-password');await assert.rejects(ignored.api.createCommunity(),failure=>failure.code==='BETTER_ROOM_NOT_PRIVATE');assert.equal(ignoredRemote.rooms.size,0,'silently ignored privacy settings do not produce public chat');
const forcedRemote=server();forcedRemote.setForcedArchive(true);const forced=client(forcedRemote);await forced.api.login('alice','alice-password');const forcedCfg=await forced.api.createCommunity();assert.equal(Object.keys(forcedCfg.rooms).length,13,'room-scoped MAM proves forced archives when the configuration toggle is omitted');
const deniedStore={getItem(){throw Error('Denied');},setItem(){throw Error('Denied');}};const memoryClient=client(server(),deniedStore);await memoryClient.api.login('alice','alice-password');assert.equal(memoryClient.api.getSession().userId,'alice@yax.im','storage denial does not block a session-only login');
const legacyRemote=server(),legacyNs='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',legacyCfg={version:1,provider:'xmpp',server:'yax.im',rooms:Object.fromEntries(['general','games','music'].map(name=>['better-'+name,'better-'+legacyNs+'-'+name+'@chat.yax.im']))};
for(const id of Object.values(legacyCfg.rooms))legacyRemote.rooms.set(id,{id,creator:'alice@yax.im',members:new Map([['alice@yax.im','owner']]),settings:{...defaults(),'muc#roomconfig_persistentroom':'1','muc#roomconfig_membersonly':'1','muc#roomconfig_publicroom':'0','muc#roomconfig_whois':'anyone','{http://prosody.im/protocol/muc}roomconfig_allowmemberinvites':'0','muc#roomconfig_enablearchiving':'1'},archive:[],present:new Map()});
legacyRemote.archive(legacyRemote.rooms.get(legacyCfg.rooms['better-music']),e('message',{xmlns:NS.client,type:'groupchat',id:'legacy-history'},[e('body',{},['Existing music history'])]),'alice@yax.im');
const legacyStore=storage();legacyStore.setItem('better_cherri_xmpp_community_v1',JSON.stringify(legacyCfg));const legacyClient=client(legacyRemote,legacyStore);await legacyClient.api.login('alice','alice-password');
const legacyChannels=await legacyClient.api.listChannels();assert.equal(legacyChannels.length,14);assert.equal(legacyRemote.rooms.size,14);assert.equal(legacyClient.api.getCommunity().rooms['share-music'],legacyCfg.rooms['better-music']);assert.equal(legacyClient.api.getCommunity().rooms.games,legacyCfg.rooms['better-games']);assert.equal(legacyClient.api.getCommunity().ownerJid,'alice@yax.im','legacy owner is adopted only after real ownership checks');assert.equal((await legacyClient.api.getMessages('better-music')).messages[0].content,'Existing music history','legacy saved history survives template extension');await legacyClient.api.logout();
const explicit=client(server(),legacyStore,cfg);assert.equal(explicit.api.getCommunity().namespace,cfg.namespace,'explicit configured launcher wins over saved community and shared default');
const switched=client(remote,storage(),cfg);await switched.api.login('bob','bob-password');const changingAccess=switched.api.assertRoomAccess('general');const changedCfg=schema.createDefault('cccccccccccccccccccccccccccccccc','alice@yax.im');switched.api.setCommunity(changedCfg);await assert.rejects(changingAccess,failure=>failure.code==='BETTER_COMMUNITY_CHANGED');assert.equal(remote.rooms.has(changedCfg.rooms.general),false,'switching during preflight cannot create a different room before its existence was checked');await switched.api.logout();
const foreignOwnerRemote=server(),claimedId=defaultConfig.rooms.rules,claimedSettings={...defaults(),'muc#roomconfig_persistentroom':'1','muc#roomconfig_membersonly':'1','muc#roomconfig_publicroom':'0','muc#roomconfig_whois':'anyone','{http://prosody.im/protocol/muc}roomconfig_allowmemberinvites':'0','muc#roomconfig_enablearchiving':'1'};foreignOwnerRemote.rooms.set(claimedId,{id:claimedId,creator:'bob@yax.im',members:new Map([['bob@yax.im','owner'],['alice@yax.im','member']]),settings:claimedSettings,archive:[],present:new Map()});const ownership=client(foreignOwnerRemote);await ownership.api.login('alice','alice-password');await assert.rejects(ownership.api.createCommunity(),failure=>failure.code==='BETTER_ROOM_OWNER_MISMATCH');assert.equal(foreignOwnerRemote.rooms.size,1);assert.equal(foreignOwnerRemote.requests.some(row=>row.iq&&val(row.iq,'type')==='set'&&child(row.iq,'query',NS.owner)),false,'an already claimed planned room is never overwritten or destroyed');await ownership.api.logout();
const lateOwnerRemote=server(),lateId=defaultConfig.rooms['report-issues'];lateOwnerRemote.rooms.set(lateId,{id:lateId,creator:'bob@yax.im',members:new Map([['bob@yax.im','owner'],['alice@yax.im','member']]),settings:{...claimedSettings},archive:[],present:new Map()});const lateOwnership=client(lateOwnerRemote);await lateOwnership.api.login('alice','alice-password');await assert.rejects(lateOwnership.api.createCommunity(),failure=>failure.code==='BETTER_ROOM_OWNER_MISMATCH');assert.equal(lateOwnerRemote.rooms.size,1,'all-room preflight finds a late ownership conflict before creating any earlier missing channels');assert.equal(lateOwnerRemote.requests.some(row=>row.sent?.localName==='presence'&&val(row.sent,'to').startsWith(defaultConfig.rooms.rules+'/')),false);assert.equal(lateOwnerRemote.requests.some(row=>row.iq&&val(row.iq,'type')==='set'&&child(row.iq,'query',NS.owner)),false);await lateOwnership.api.logout();

const unavailableRemote=server();unavailableRemote.setDiscoFailure('service-unavailable');const unavailable=client(unavailableRemote);await unavailable.api.login('bob','bob-password');const unavailableStatuses=[];unavailable.api.subscribe(event=>{if(event.type==='status')unavailableStatuses.push(event);});const unavailableChannels=await unavailable.api.listChannels();assert(unavailableChannels.every(channel=>channel.accessState==='unavailable'&&channel.accessErrorCode==='service-unavailable'));assert.equal(unavailableStatuses.length,1);assert.match(unavailableStatuses[0].error,/service-unavailable/);assert.doesNotMatch(unavailableStatuses[0].error,/invitation/i,'provider failures never become a misleading invitation notice');assert.equal(unavailableRemote.rooms.size,0);await unavailable.api.listChannels();assert.equal(unavailableStatuses.length,1);unavailableRemote.setDiscoFailure('');await unavailable.api.listChannels();assert.equal(unavailableStatuses.length,2,'a distinct access failure updates the diagnostic');await unavailable.api.logout();

const oldDefault={...normalized(defaultConfig),ownerJid:'bob@yax.im'},migrationOptions={previousOwners:['bob@yax.im']};
const explicitMigration=client(server(),storage(),oldDefault,migrationOptions);assert.equal(explicitMigration.api.getCommunity().ownerJid,'alice@yax.im','an explicit old downloaded launcher receives the exact shared-default owner correction');assert.deepEqual(normalized(explicitMigration.api.getCommunity().rooms),normalized(oldDefault.rooms),'owner correction retains every room and saved-history address');
explicitMigration.api.setCommunity(oldDefault);assert.equal(explicitMigration.api.getCommunity().ownerJid,'alice@yax.im','importing the previous default after startup also receives its exact owner correction');
const migratedStore=storage();migratedStore.setItem('better_cherri_xmpp_community_v1',JSON.stringify(oldDefault));const savedMigration=client(server(),migratedStore,undefined,migrationOptions);assert.equal(savedMigration.api.getCommunity().ownerJid,'alice@yax.im','a saved old release default cannot shadow its owner correction');
const noMigration=client(server(),storage(),oldDefault);assert.equal(noMigration.api.getCommunity().ownerJid,'bob@yax.im','no owner metadata changes without an explicit release migration');
const customOwner=client(server(),storage(),{...oldDefault,ownerJid:'carol@yax.im'},migrationOptions);assert.equal(customOwner.api.getCommunity().ownerJid,'carol@yax.im','custom owner metadata is preserved');
const otherNamespace=schema.createDefault('dddddddddddddddddddddddddddddddd','bob@yax.im'),otherCommunity=client(server(),storage(),otherNamespace,migrationOptions);assert.equal(otherCommunity.api.getCommunity().ownerJid,'bob@yax.im','other imported communities are never migrated');
const extraRoom={...oldDefault,rooms:{...oldDefault.rooms,games:'better-'+oldDefault.namespace+'-games@chat.yax.im'}},customRooms=client(server(),storage(),extraRoom,migrationOptions);assert.equal(customRooms.api.getCommunity().ownerJid,'bob@yax.im','an alternate room-address set is not the release default');
const legacyMigration=client(server(),storage(),{...normalized(legacyCfg),ownerJid:'bob@yax.im'},migrationOptions);assert.equal(legacyMigration.api.getCommunity().ownerJid,'bob@yax.im','legacy configurations retain their owner and archive addresses');
const migrationRemote=server();migrationRemote.rooms.set(lateId,{id:lateId,creator:'bob@yax.im',members:new Map([['bob@yax.im','owner']]),settings:{...claimedSettings},archive:[],present:new Map()});const migrationAcl=client(migrationRemote,storage(),oldDefault,migrationOptions);await migrationAcl.api.login('alice','alice-password');await assert.rejects(migrationAcl.api.createCommunity(),failure=>failure.code==='forbidden');assert.deepEqual([...migrationRemote.rooms.get(lateId).members],[['bob@yax.im','owner']],'owner metadata migration never adds membership or transfers server ownership');assert.equal(migrationRemote.rooms.size,1);assert.equal(migrationRemote.requests.some(row=>row.iq&&val(row.iq,'type')==='set'),false);await migrationAcl.api.logout();
await newbie.api.logout();await bob.api.logout();await reloaded.api.logout();await unsupported.api.logout();await ignored.api.logout();await forced.api.logout();await memoryClient.api.logout();
console.log('XMPP client tests passed: native registration, SCRAM-only SDK configuration, no credential persistence, private persistent member ACLs, forced/verified MAM archives, history after reload, replies/edits/reactions/retraction, numeric IDs, live delivery, and fail-closed privacy. All SDK/server traffic was mocked.');
