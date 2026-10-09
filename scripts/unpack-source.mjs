import {readFileSync,readdirSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';

const parts=readdirSync(new URL('../source-pack/',import.meta.url)).filter(x=>x.endsWith('.txt')).sort();
const packed=parts.map(name=>readFileSync(new URL('../source-pack/'+name,import.meta.url),'utf8')).join('');
const pack=JSON.parse(packed);
for(const [name,data] of Object.entries(pack)){
  mkdirSync(dirname(name),{recursive:true});
  writeFileSync(name,gunzipSync(Buffer.from(data,'base64')));
}

// Render/Next build does not use the Cloudflare-only database bindings or Edge Function source.
rmSync('db',{recursive:true,force:true});
rmSync('lib/bridge-edge.ts',{force:true});

function patch(path, fn){
  const before=readFileSync(path,'utf8');
  const after=fn(before);
  writeFileSync(path,after);
}

// Google is now the only social sign-in method shown by Venyl.
patch('lib/mobile-ui.js', s => s
  .replace('Войди через Google или Apple — и откроются треки, альбомы, артисты, избранное и твоя медиатека.','Войди через Google — и откроются треки, альбомы, артисты, избранное и твоя медиатека.')
  .replace(/<button class="v-auth-provider v-auth-apple" data-v="login-apple">[\s\S]*?<\/button>/,'')
);
patch('public/assets/mobile/app.js', s => s
  .replaceAll('Вход в Venyl — через Google или Apple.','Вход в Venyl — через Google.')
  .replace("+'<button class=\"v-button v-primary v-wide\" data-v=\"login-google\">Продолжить с Google</button><button class=\"v-button v-wide\" data-v=\"login-apple\">Продолжить с Apple</button>'", "+'<button class=\"v-button v-primary v-wide\" data-v=\"login-google\">Продолжить с Google</button>'")
  .replace("\n else if(act==='login-apple'){VenylAuth.signIn('apple',location.pathname+location.search);return;}", '')
);
patch('public/assets/venyl-auth.js', s => s
  .replace("if(provider!=='google'&&provider!=='apple')throw new Error('Unsupported provider');","if(provider!=='google')throw new Error('Unsupported provider');")
);
patch('lib/backend.js', s => s
  .replaceAll('Войди через Google или Apple','Войди через Google')
  .replaceAll('В этой версии вход выполняется через Google или Apple.','В этой версии вход выполняется через Google.')
  .replaceAll('Учётная запись управляется через Google или Apple.','Учётная запись управляется через Google.')
  .replaceAll('Вход выполняется через Google или Apple; паролей Venyl нет.','Вход выполняется через Google; паролей Venyl нет.')
);
patch('lib/legacy.js', s => s
  .replaceAll('Вход через Google или Apple','Вход через Google')
  .replaceAll('Войди через Google или Apple.','Войди через Google.')
);
patch('lib/ui.js', s => s
  .replaceAll('Без паролей Venyl. Используй Google или Apple.','Без паролей Venyl. Используй Google.')
  .replaceAll('<button class=\\"auth-btn-full venyl-apple-btn\\" type=\\"button\\" onclick=\\"VenylAuth.signIn(\'apple\',\'/\')\\"><span class=\\"social-mark apple\\">●</span>Продолжить с Apple</button>','')
);
patch('public/assets/mobile/mobile.css', s => s.replace(/\.v-auth-apple\{[^}]*\}/g,''));

// VENYL_EMAIL_PASSWORD_AUTH_V2
// Keep Google OAuth, add Supabase email/password auth, and map the configured
// Supabase user to Venyl administrator privileges without hard-coding identity data.

patch('lib/mobile-ui.js', s => s
  .replace('Войди через Google — и откроются треки, альбомы, артисты, избранное и твоя медиатека.','Войди через Google или по почте и паролю — и откроются треки, альбомы, артисты, избранное и твоя медиатека.')
  .replace('</button><div id="v-auth-error" class="v-auth-error"',
    '</button><button class="v-auth-provider v-auth-email" data-v="login-email"><span class="v-provider-mail" aria-hidden="true">@</span><span>Войти по почте и паролю</span></button><form id="v-auth-password-form" class="v-auth-password-form" hidden><label id="v-auth-email-label">Email<input id="v-auth-email" name="email" type="email" autocomplete="email" required maxlength="254"></label><label><span id="v-auth-password-label">Пароль</span><input id="v-auth-password" name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128"></label><button id="v-auth-submit" class="v-auth-provider v-auth-submit" type="submit">Войти</button><div class="v-auth-secondary"><button type="button" data-v="auth-signup">Создать аккаунт</button><button type="button" data-v="auth-reset">Забыли пароль?</button></div><button class="v-auth-cancel" type="button" data-v="cancel-email">Назад</button></form><div id="v-auth-error" class="v-auth-error"')
);

patch('public/assets/venyl-auth.js', s => s
  .replace("    const error=h.get('error_description')||h.get('error');",
           "    const error=h.get('error_description')||h.get('error');\n    const type=h.get('type')||'';")
  .replace("      writeSession({access_token:access,refresh_token:refresh||'',expires_in:Number(h.get('expires_in')||3600),token_type:h.get('token_type')||'bearer'});",
           "      writeSession({access_token:access,refresh_token:refresh||'',expires_in:Number(h.get('expires_in')||3600),token_type:h.get('token_type')||'bearer'});\n      if(type==='recovery')sessionStorage.setItem('venyl_password_recovery','1');")
  .replace("  async function signOut(){",
`  async function authJson(url,options){
    const r=await rawFetch(url,options);let d={};
    try{d=await r.json();}catch{}
    if(!r.ok)throw new Error(d.error_description||d.msg||d.message||d.error||'Ошибка авторизации');
    return d;
  }
  async function signInWithPassword(email,password){
    const d=await authJson(SUPABASE_URL+'/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json','apikey':PUBLISHABLE_KEY},body:JSON.stringify({email,password})});
    writeSession(d);return d;
  }
  async function signUpWithPassword(email,password){
    const d=await authJson(SUPABASE_URL+'/auth/v1/signup?redirect_to='+encodeURIComponent(location.origin+'/'),{method:'POST',headers:{'Content-Type':'application/json','apikey':PUBLISHABLE_KEY},body:JSON.stringify({email,password})});
    if(d.access_token)writeSession(d);return d;
  }
  async function requestPasswordReset(email){
    return authJson(SUPABASE_URL+'/auth/v1/recover?redirect_to='+encodeURIComponent(location.origin+'/'),{method:'POST',headers:{'Content-Type':'application/json','apikey':PUBLISHABLE_KEY},body:JSON.stringify({email})});
  }
  async function updatePassword(password){
    const token=await currentAccessToken();if(!token)throw new Error('Сессия восстановления истекла.');
    return authJson(SUPABASE_URL+'/auth/v1/user',{method:'PUT',headers:{'Content-Type':'application/json','apikey':PUBLISHABLE_KEY,'Authorization':'Bearer '+token},body:JSON.stringify({password})});
  }

  async function signOut(){`)
  .replace("window.VenylAuth={signIn,signOut,readSession,hasSession:()=>!!readSession(),refreshSession,currentAccessToken,SUPABASE_URL};",
           "window.VenylAuth={signIn,signInWithPassword,signUpWithPassword,requestPasswordReset,updatePassword,signOut,readSession,hasSession:()=>!!readSession(),refreshSession,currentAccessToken,SUPABASE_URL};")
);

patch('public/assets/mobile/app.js', s => s
  .replace(" const authGate=$('v-auth-gate'),authError=$('v-auth-error');",
           " const authGate=$('v-auth-gate'),authError=$('v-auth-error'),authForm=$('v-auth-password-form');")
  .replace(" function hideAuthGate(){document.documentElement.classList.remove('v-auth-required');if(authGate)authGate.hidden=true;if(authError){authError.hidden=true;authError.textContent='';}}",
` function hideAuthGate(){document.documentElement.classList.remove('v-auth-required');if(authGate)authGate.hidden=true;if(authError){authError.hidden=true;authError.textContent='';}}
 function showRecoveryForm(){showAuthGate();document.querySelector('[data-v=login-google]')?.setAttribute('hidden','');document.querySelector('[data-v=login-email]')?.setAttribute('hidden','');if(authForm){authForm.hidden=false;authForm.dataset.mode='recovery';$('v-auth-email-label').hidden=true;$('v-auth-password-label').textContent='Новый пароль';$('v-auth-password').autocomplete='new-password';$('v-auth-submit').textContent='Сохранить новый пароль';authForm.querySelector('.v-auth-secondary')?.setAttribute('hidden','');authForm.querySelector('[data-v=cancel-email]')?.setAttribute('hidden','');$('v-auth-password')?.focus();}}`)
  .replaceAll('Вход в Venyl — через Google.','Вход в Venyl — через Google или почту и пароль.')
  .replace("+'<button class=\"v-button v-primary v-wide\" data-v=\"login-google\">Продолжить с Google</button>'",
           "+'<button class=\"v-button v-primary v-wide\" data-v=\"login-google\">Продолжить с Google</button><button class=\"v-button v-wide\" data-v=\"login-email\">Войти по почте и паролю</button>'")
  .replace(" if(act==='login-google'){VenylAuth.signIn('google',location.pathname+location.search);return;}",
` if(act==='login-google'){VenylAuth.signIn('google',location.pathname+location.search);return;}
 else if(act==='login-email'){b.hidden=true;if(authForm){authForm.hidden=false;authForm.dataset.mode='login';}$('v-auth-email')?.focus();return;}
 else if(act==='cancel-email'){if(authForm){authForm.hidden=true;authForm.dataset.mode='login';}const x=document.querySelector('[data-v=login-email]');if(x)x.hidden=false;return;}
 else if(act==='auth-signup'){const email=$('v-auth-email')?.value.trim(),password=$('v-auth-password')?.value||'';if(!email||password.length<8){showAuthGate('Укажи email и пароль минимум из 8 символов.');return;}b.disabled=true;const d=await VenylAuth.signUpWithPassword(email,password);if(d?.access_token){location.reload();return;}showAuthGate('Аккаунт создан. Проверь почту и подтверди email, затем войди.');return;}
 else if(act==='auth-reset'){const email=$('v-auth-email')?.value.trim();if(!email){showAuthGate('Сначала введи email.');return;}b.disabled=true;await VenylAuth.requestPasswordReset(email);showAuthGate('Ссылка для смены пароля отправлена на почту.');return;}`)
  .replace(" document.addEventListener('click',click);",
` if(authForm)authForm.addEventListener('submit',async e=>{e.preventDefault();const submit=$('v-auth-submit');if(submit)submit.disabled=true;if(authError){authError.hidden=true;authError.textContent='';}try{const password=$('v-auth-password')?.value||'';if(password.length<8)throw Error('Пароль должен быть минимум 8 символов.');if(authForm.dataset.mode==='recovery'){await VenylAuth.updatePassword(password);sessionStorage.removeItem('venyl_password_recovery');location.reload();return;}const email=$('v-auth-email')?.value.trim();if(!email)throw Error('Укажи email.');await VenylAuth.signInWithPassword(email,password);location.reload();}catch(err){showAuthGate(err.message||'Не удалось войти.');}finally{if(submit)submit.disabled=false;}});
 document.addEventListener('click',click);`)
  .replace(" async function initialize(){if(!VenylAuth?.hasSession?.())",
           " async function initialize(){if(sessionStorage.getItem('venyl_password_recovery')==='1'&&VenylAuth?.hasSession?.()){showRecoveryForm();return;}if(!VenylAuth?.hasSession?.())")
);

patch('public/assets/mobile/mobile.css', s => s + `
.v-auth-email{background:#1c1b17;color:var(--v-text);border-color:#ffffff18}
.v-provider-mail{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;border:1px solid #d8bb8355;color:var(--v-accent);font-weight:800}
.v-auth-password-form{display:grid;gap:12px;padding:16px;border:1px solid var(--v-line);border-radius:18px;background:#171612}
.v-auth-password-form[hidden]{display:none!important}
.v-auth-password-form label{display:grid;gap:7px;color:var(--v-secondary);font-size:12px;text-align:left}
.v-auth-password-form input{width:100%;min-height:48px;border-radius:13px;border:1px solid var(--v-line);background:#0f0f0d;color:var(--v-text);padding:0 14px;font:inherit;outline:none}
.v-auth-password-form input:focus{border-color:var(--v-accent);box-shadow:0 0 0 3px #d8bb8315}
.v-auth-submit{background:var(--v-accent);color:#171611;border-color:var(--v-accent)}
.v-auth-secondary{display:flex;justify-content:space-between;gap:12px}
.v-auth-secondary[hidden]{display:none!important}
.v-auth-secondary button,.v-auth-cancel{border:0;background:transparent;color:var(--v-muted);font:inherit;font-size:12px;padding:7px;cursor:pointer}
`);


await import('./apply-email-auth.mjs');
