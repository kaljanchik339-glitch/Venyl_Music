import {readFileSync,writeFileSync} from 'node:fs';

const uiPath='lib/mobile-ui.js';
let ui=readFileSync(uiPath,'utf8');

const oldReset='<button type="button" data-v="auth-reset">Забыли пароль?</button>';
const newReset='<a class="v-auth-reset-link" href="/forgot-password">Забыли пароль?</a>';
if(ui.includes(oldReset)) ui=ui.replaceAll(oldReset,newReset);

const headMarker='<head>';
const early=`<head><script>(function(){try{var h=location.hash||'';if(h.indexOf('type=recovery')!==-1&&location.pathname!=='/reset-password'){location.replace('/reset-password'+h);}}catch(e){}})();</script>`;
if(ui.includes(headMarker) && !ui.includes("location.replace('/reset-password'+h)")) ui=ui.replace(headMarker,early);

writeFileSync(uiPath,ui);

const cssPath='public/assets/mobile/mobile.css';
let css=readFileSync(cssPath,'utf8');
css += `
.v-auth-reset-link{border:0;background:transparent;color:var(--v-muted);font:inherit;font-size:12px;padding:7px;cursor:pointer;text-decoration:none}
.v-auth-set-password-link{display:block;margin-top:8px;text-align:center;color:var(--v-muted);font-size:12px;text-decoration:none}
`;
writeFileSync(cssPath,css);
