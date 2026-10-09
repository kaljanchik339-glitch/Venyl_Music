import {readFileSync,writeFileSync} from 'node:fs';

function patchFile(path, fn) {
  const before=readFileSync(path,'utf8');
  const after=fn(before);
  writeFileSync(path,after);
}

patchFile('lib/mobile-ui.js', s => s
  .replace(
    '<button type="button" data-v="auth-reset">Забыли пароль?</button></div><button class="v-auth-cancel"',
    '<button type="button" data-v="auth-reset">Забыли пароль?</button></div><button type="button" class="v-auth-google-password" data-v="auth-google-password">Задать пароль через Google</button><button class="v-auth-cancel"'
  )
);

patchFile('public/assets/mobile/app.js', s => {
  s=s.replace(
    "async function initialize(){if(sessionStorage.getItem('venyl_password_recovery')==='1'&&VenylAuth?.hasSession?.()){showRecoveryForm();return;}if(!VenylAuth?.hasSession?.())",
    "async function initialize(){if((sessionStorage.getItem('venyl_password_recovery')==='1'||new URLSearchParams(location.search).get('set-password')==='1')&&VenylAuth?.hasSession?.()){showRecoveryForm();return;}if(!VenylAuth?.hasSession?.())"
  );

  if(!s.includes('VENYL_RESET_REQUEST_FIX_V1')){
    s += `

// VENYL_RESET_REQUEST_FIX_V1
(()=>{
  let resetSending=false;

  function authMessage(message,ok=false){
    const box=document.getElementById('v-auth-error');
    if(!box)return;
    box.hidden=false;
    box.textContent=message;
    box.dataset.state=ok?'success':'error';
  }

  document.addEventListener('click',async ev=>{
    const googlePassword=ev.target?.closest?.('[data-v="auth-google-password"]');
    if(googlePassword){
      ev.preventDefault();
      ev.stopImmediatePropagation();
      try{
        await window.VenylAuth.signIn('google','/?set-password=1');
      }catch(err){
        authMessage(err?.message||'Не удалось открыть Google.');
      }
      return;
    }

    const reset=ev.target?.closest?.('[data-v="auth-reset"]');
    if(!reset)return;

    ev.preventDefault();
    ev.stopImmediatePropagation();
    if(resetSending)return;

    const email=document.getElementById('v-auth-email')?.value?.trim();
    if(!email){
      authMessage('Сначала введи email.');
      return;
    }

    const last=Number(sessionStorage.getItem('venyl_last_reset_request')||0);
    if(Date.now()-last<60000){
      authMessage('Письмо уже запрошено. Подожди перед повторной отправкой или задай пароль через Google.');
      return;
    }

    resetSending=true;
    reset.disabled=true;
    const oldText=reset.textContent;
    reset.textContent='Отправляю…';

    try{
      await window.VenylAuth.requestPasswordReset(email);
      sessionStorage.setItem('venyl_last_reset_request',String(Date.now()));
      authMessage('Письмо отправлено. Проверь входящие и спам.',true);
      reset.textContent='Письмо отправлено ✓';
      setTimeout(()=>{
        resetSending=false;
        reset.disabled=false;
        reset.textContent=oldText;
      },60000);
    }catch(err){
      resetSending=false;
      reset.disabled=false;
      reset.textContent=oldText;
      const msg=String(err?.message||'');
      if(/rate limit|429|too many/i.test(msg)){
        authMessage('Supabase временно ограничил отправку писем. Чтобы не ждать, нажми «Задать пароль через Google».');
      }else{
        authMessage(msg||'Не удалось отправить письмо.');
      }
    }
  },true);
})();
`;
  }
  return s;
});

patchFile('public/assets/mobile/mobile.css', s => s + `
.v-auth-google-password{
  width:100%;
  border:1px solid #ffffff14;
  background:#14130f;
  color:var(--v-accent);
  border-radius:13px;
  min-height:44px;
  font:inherit;
  font-size:13px;
  padding:10px 14px;
  cursor:pointer;
}
.v-auth-error[data-state="success"]{
  border-color:#7ea37a55;
  color:#b9d8b4;
  background:#172016;
}
`);
