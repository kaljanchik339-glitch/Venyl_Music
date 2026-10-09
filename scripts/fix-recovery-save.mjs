import {readFileSync,writeFileSync} from 'node:fs';

const path='public/assets/mobile/app.js';
let s=readFileSync(path,'utf8');

if(!s.includes('VENYL_RECOVERY_SAVE_FIX_V1')){
s += `

// VENYL_RECOVERY_SAVE_FIX_V1
// Recovery links create a valid Supabase session. Handle the password-save
// action in capture phase so no legacy click/submit handler can swallow it.
(()=>{
  let saving=false;

  function recoveryForm(){
    return document.getElementById('v-auth-password-form');
  }
  function isRecovery(){
    const form=recoveryForm();
    return !!form && form.dataset.mode==='recovery';
  }
  function showRecoveryMessage(message,ok=false){
    const box=document.getElementById('v-auth-error');
    if(!box)return;
    box.hidden=false;
    box.textContent=message;
    box.dataset.state=ok?'success':'error';
  }

  async function saveRecoveryPassword(ev){
    if(!isRecovery()||saving)return;
    if(ev){ev.preventDefault();ev.stopImmediatePropagation();}

    const input=document.getElementById('v-auth-password');
    const button=document.getElementById('v-auth-submit');
    const password=input?.value||'';

    if(password.length<8){
      showRecoveryMessage('Пароль должен содержать минимум 8 символов.');
      input?.focus();
      return;
    }

    saving=true;
    if(button){
      button.disabled=true;
      button.textContent='Сохраняю…';
    }

    try{
      if(!window.VenylAuth?.updatePassword) throw new Error('Функция смены пароля не загрузилась.');
      await window.VenylAuth.updatePassword(password);
      sessionStorage.removeItem('venyl_password_recovery');

      if(button){
        button.textContent='Пароль сохранён ✓';
        button.disabled=true;
      }
      showRecoveryMessage('Пароль изменён. Сейчас вернём тебя на вход.',true);

      setTimeout(async()=>{
        try{await window.VenylAuth.signOut?.();}catch{}
        location.replace('/');
      },700);
    }catch(err){
      saving=false;
      if(button){
        button.disabled=false;
        button.textContent='Сохранить новый пароль';
      }
      showRecoveryMessage(err?.message||'Не удалось изменить пароль. Попробуй ещё раз.');
    }
  }

  document.addEventListener('click',ev=>{
    const btn=ev.target?.closest?.('#v-auth-submit');
    if(btn&&isRecovery()) void saveRecoveryPassword(ev);
  },true);

  document.addEventListener('submit',ev=>{
    if(ev.target?.id==='v-auth-password-form'&&isRecovery()) void saveRecoveryPassword(ev);
  },true);
})();
`;
}

writeFileSync(path,s);
