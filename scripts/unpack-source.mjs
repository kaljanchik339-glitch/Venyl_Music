import {readFileSync,readdirSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';
const parts=readdirSync(new URL('../source-pack/',import.meta.url)).filter(x=>x.endsWith('.txt')).sort();
const packed=parts.map(name=>readFileSync(new URL('../source-pack/'+name,import.meta.url),'utf8')).join('');
const pack=JSON.parse(packed);
for(const [name,data] of Object.entries(pack)){mkdirSync(dirname(name),{recursive:true});writeFileSync(name,gunzipSync(Buffer.from(data,'base64')));}
// Render/Next build does not use the Cloudflare-only database bindings or Edge Function source.
rmSync('db',{recursive:true,force:true});
rmSync('lib/bridge-edge.ts',{force:true});
