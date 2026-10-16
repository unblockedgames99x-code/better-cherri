import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function patchTransportFactory(input){
  const marker='var Jz={};CB(Jz,{bootController:()=>Lz,bootControllerWithRetry:()=>zw});';
  const factory='globalThis.__betterCherriCreateTransport=(()=>{let initialized;return async function(wisp){xz();await(initialized??=tuA());let transport=new ouA({wisp});await transport.init();return transport;}})();';
  if(input.includes(factory))return input;
  if(input.split(marker).length!==2)throw new Error('The original Epoxy transport export anchor changed.');
  return input.replace(marker,factory+marker);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw new Error('Usage: node patch-remote-transport.mjs input.js output.js');
  await writeFile(output,patchTransportFactory(await readFile(input,'utf8')));
  console.log(JSON.stringify({output,originalTransportFactory:true}));
}
