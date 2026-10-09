import {readFileSync,readdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const dir=new URL('./final-sites-parts/',import.meta.url);
const parts=readdirSync(dir).filter(x=>/^part\d+\.txt$/.test(x)).sort();
const packed=parts.map(name=>readFileSync(new URL('./final-sites-parts/'+name,import.meta.url),'utf8').trim()).join('');
const code=Buffer.from(packed,'base64').toString('utf8');
const temp=new URL('./.restore-final-sites-mobile.runtime.mjs',import.meta.url);
writeFileSync(temp,code);
try{
  await import(pathToFileURL(temp.pathname).href+'?v='+Date.now());
} finally {
  try{unlinkSync(temp);}catch{}
}
