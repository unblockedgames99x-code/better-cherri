import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { patchGamesMusic } from './patch-games-music.mjs';

const root = path.resolve(process.argv[2] || 'work/cherri');
const upstream = fs.readFileSync(path.join(root, 'b/assets/bundle-i7rlf846.js'), 'utf8');
const alreadyPatched = upstream.includes('async function betterCherriAllGames(){');
const {source, edits} = alreadyPatched ? {source:upstream,edits:[]} : patchGamesMusic(upstream);
if (!alreadyPatched) assert.ok(edits.length >= 16);
assert.ok(!source.includes('The 6,000 legacy games have been removed'));
assert.ok(source.includes('[B,Q]=(0,yB.useState)("better-all")'));
assert.ok(source.includes('fA.id==="all"&&Q("better-all")'));
assert.ok(source.includes('u==="one"?(0,M.jsx)(vM,{size:13})'));
assert.throws(() => patchGamesMusic(source), /expected 1 matches/);
new vm.Script(source, {filename: 'patched-cherri.js'});

const helper = source.slice(source.indexOf('async function betterCherriAllGames(){'), source.indexOf('function sEA(){'));
const context = {
  BC: value => value,
  XI: value => value.startsWith('/') ? 'https://backend.example' + value : value,
  eEA: '/fruit/', QEA: '/covers', BEA: '/stores',
  rj: ['ckv','seraph','truffled','ugs','gn-math'].map(id => ({id})),
  setTimeout, clearTimeout, AbortController,
  fetch: async url => {
    if (url.startsWith('/api/')) throw new Error('dynamic server offline');
    return {ok:true, json:async()=>JSON.parse(fs.readFileSync(path.join(root,'b',url),'utf8'))};
  },
  eN: async () => ({getGames:async()=>({games:[{id:1,name:'Test Lumin game',image_token:'x'}]}),getImageUrl:()=>'https://example.test/cover.png'})
};
vm.createContext(context);
vm.runInContext(helper,context);
const games=await context.betterCherriAllGames();
const expected = ['fruit','ckv','seraph','truffled','ugs','gn-math'].flatMap(id => JSON.parse(fs.readFileSync(path.join(root,`b/assets/json/${id}.json`),'utf8'))).length;
assert.ok(games.length > 4000 && games.length <= expected + 1);
assert.equal(games.filter(game=>game.launch==='lumin:1').length,1);
assert.ok(games.find(game=>game.id==='fruit:1on1soccer').launch.includes('/fruit/atlas-games/1on1soccer/index.html'));
assert.ok(games.find(game=>game.id==='gn-math:0').img.includes('/covers/gn-math/0.png'));
assert.ok(games.find(game=>game.id==='gn-math:0').launch.includes('/stores/gn-math/0.html'));
assert.equal(new Set(games.map(game=>game.launch)).size,games.length);
context.fetch=async()=>{throw new Error('offline')};
context.eN=async()=>{throw new Error('offline')};
await assert.rejects(context.betterCherriAllGames(),/catalogs are unavailable/);

// Execute the actual generated host state transition and ended callback.
const cycleSource=source.match(/repeat:(b\.repeat==="off"\|\|b\.repeat===!1\?"all":b\.repeat==="all"\|\|b\.repeat===!0\?"one":"off")/)[1];
const cycle=new Function('b',`return (${cycleSource})`);
assert.equal(cycle({repeat:'off'}),'all');
assert.equal(cycle({repeat:'all'}),'one');
assert.equal(cycle({repeat:'one'}),'off');
assert.equal(cycle({repeat:false}),'all');
const endedSource=source.match(/let X=(\(\)=>\{if\(rA\.current\.repeat==="one"\)\{b\.currentTime=0,mA\.set\(0\),b\.play\(\)\.catch\(\(\)=>\{\}\);return\}NB\(\)\});return b\.addEventListener\("ended",X\)/)[1];
let nextCalls=0,playCalls=0,progress=-1;
const audio={currentTime:99,play:()=>{playCalls++;return Promise.resolve()}};
const state={current:{repeat:'one'}};
const ended=new Function('rA','b','mA','NB',`return (${endedSource})`)(state,audio,{set:value=>{progress=value}},()=>{nextCalls++});
ended();
assert.equal(audio.currentTime,0);
assert.equal(progress,0);
assert.equal(playCalls,1);
assert.equal(nextCalls,0);
state.current.repeat='all';ended();
state.current.repeat='off';ended();
assert.equal(nextCalls,2);
console.log(JSON.stringify({passed:true,alreadyPatched,gameCount:games.length,staticCatalogRows:expected,guardedEdits:edits.length}));
