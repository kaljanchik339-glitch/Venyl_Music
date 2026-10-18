import { readFileSync, writeFileSync } from 'node:fs';

const path = 'lib/backend.js';
let source = readFileSync(path, 'utf8');
const target = "const stateResponse=await bridge(env,'state');if(!stateResponse.ok)throw Error('Хранилище недоступно');";
if (!source.includes(target)) {
  throw new Error('Storage state bridge signature changed; refusing unsafe patch');
}
const replacement = `const stateResponse=await (async()=>{
    let lastError;
    for(let attempt=0;attempt<3;attempt++){
      try{
        const response=await bridge(env,'state');
        if(response.ok)return response;
        if(![408,429,500,502,503,504].includes(response.status)){
          console.error('Venyl state bridge permanent HTTP error:',response.status);
          return response;
        }
        lastError=new Error('Storage state bridge HTTP '+response.status);
      }catch(error){lastError=error;}
      if(attempt<2)await new Promise(resolve=>setTimeout(resolve,250*(2**attempt)));
    }
    console.error('Venyl state bridge failed after retries:',lastError?.message||'unknown error');
    throw new Error('Хранилище временно недоступно');
  })();if(!stateResponse.ok)throw Error('Хранилище недоступно');`;
source=source.replace(target,replacement);
writeFileSync(path,source);
console.log('Venyl storage bridge: transient retry patch applied');
