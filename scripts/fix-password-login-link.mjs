import {readFileSync,writeFileSync} from 'node:fs';

const path='public/assets/mobile/app.js';
let s=readFileSync(path,'utf8');

const old="}catch(err){showAuthGate(err.message||'Не удалось войти.');}finally{if(submit)submit.disabled=false;}});";
const replacement="}catch(err){const msg=String(err?.message||'');if(/invalid login credentials/i.test(msg)){location.assign('/set-password');return;}showAuthGate(msg||'Не удалось войти.');}finally{if(submit)submit.disabled=false;}});";

if(s.includes(old)) s=s.replace(old,replacement);
else if(!s.includes("location.assign('/set-password')")) throw new Error('Password-login submit handler not found');

writeFileSync(path,s);

const uiPath='lib/mobile-ui.js';
let ui=readFileSync(uiPath,'utf8');
ui=ui
 .replaceAll('/assets/mobile/app.js?v=player-gesture-3','/assets/mobile/app.js?v=password-link-1')
 .replaceAll('/assets/mobile/app.js?v=sites-final-1943','/assets/mobile/app.js?v=password-link-1');
writeFileSync(uiPath,ui);

console.log('Password login now routes Google-only accounts to password setup.');
