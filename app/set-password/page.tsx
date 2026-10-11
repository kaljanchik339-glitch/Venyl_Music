'use client';

import {FormEvent,useEffect,useState} from 'react';

const SUPABASE_URL='https://hwulruialugaaufjzsdt.supabase.co';
const API_KEY='sb_publishable_fzNkk2LvBG9LQQey4gRY1Q_KgmEwYBi';
const SESSION_KEY='venyl_supabase_session_v1';

type Session={access_token:string;refresh_token?:string;expires_in?:number;expires_at?:number;token_type?:string};

function saveSession(s:Session){
  const expiresIn=Number(s.expires_in||3600);
  const value={...s,expires_at:s.expires_at||Date.now()+Math.max(60,expiresIn-30)*1000};
  localStorage.setItem(SESSION_KEY,JSON.stringify(value));
  return value;
}
function readSession():Session|null{
  try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}
}
async function refreshSession(s:Session){
  if(!s.refresh_token)return null;
  const r=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{
    method:'POST',
    headers:{'Content-Type':'application/json','apikey':API_KEY},
    body:JSON.stringify({refresh_token:s.refresh_token})
  });
  if(!r.ok)return null;
  return saveSession(await r.json());
}
async function resolveSession(){
  const h=new URLSearchParams(location.hash.replace(/^#/,''));
  const access=h.get('access_token');
  if(access){
    const next=saveSession({
      access_token:access,
      refresh_token:h.get('refresh_token')||'',
      expires_in:Number(h.get('expires_in')||3600),
      token_type:h.get('token_type')||'bearer'
    });
    history.replaceState(null,'',location.pathname+location.search);
    return next;
  }
  let s=readSession();
  if(!s)return null;
  if(Number(s.expires_at||0)>Date.now()+15000)return s;
  s=await refreshSession(s);
  return s;
}

export default function SetPassword(){
  const [ready,setReady]=useState(false);
  const [signedIn,setSignedIn]=useState(false);
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);

  useEffect(()=>{(async()=>{
    try{
      const s=await resolveSession();
      if(!s?.access_token){setReady(true);return;}
      const r=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:API_KEY,Authorization:'Bearer '+s.access_token}});
      if(!r.ok){setReady(true);return;}
      const u=await r.json();
      setEmail(String(u?.email||''));
      setSignedIn(true);
    }catch(err:any){setMessage(err?.message||'Не удалось проверить аккаунт.');}
    finally{setReady(true);}
  })()},[]);

  function google(){
    const u=new URL(SUPABASE_URL+'/auth/v1/authorize');
    u.searchParams.set('provider','google');
    u.searchParams.set('redirect_to',location.origin+'/set-password');
    location.assign(u.toString());
  }

  async function submit(e:FormEvent){
    e.preventDefault();
    if(password.length<8){setMessage('Пароль должен быть минимум 8 символов.');return;}
    if(password!==confirm){setMessage('Пароли не совпадают.');return;}
    setLoading(true);setMessage('');
    try{
      const s=await resolveSession();
      if(!s?.access_token)throw new Error('Сначала подтверди этот аккаунт через Google.');
      const r=await fetch(SUPABASE_URL+'/auth/v1/user',{
        method:'PUT',
        headers:{'Content-Type':'application/json','apikey':API_KEY,'Authorization':'Bearer '+s.access_token},
        body:JSON.stringify({password})
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d?.msg||d?.error_description||d?.message||d?.error||'Не удалось установить пароль.');

      const vr=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=password',{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':API_KEY},
        body:JSON.stringify({email,password})
      });
      const vd=await vr.json().catch(()=>({}));
      if(!vr.ok)throw new Error('Пароль сохранился, но проверочный вход не прошёл. Попробуй ещё раз.');
      saveSession(vd);
      setDone(true);
      setMessage('Пароль установлен и проверен. Теперь вход по email + паролю работает.');
    }catch(err:any){setMessage(err?.message||'Не удалось установить пароль.');}
    finally{setLoading(false);}
  }

  return <main className="wrap"><section className="card">
    <div className="brand">VENYL</div>
    <h1>Пароль для Venyl</h1>
    {!ready&&<p>Проверяю аккаунт…</p>}
    {ready&&!done&&!signedIn&&<>
      <p>Чтобы безопасно привязать пароль к существующему админ-аккаунту, один раз подтверди его через Google.</p>
      <button className="google" type="button" onClick={google}>Подтвердить через Google</button>
    </>}
    {ready&&!done&&signedIn&&<>
      <p>Аккаунт: <b>{email}</b>. Можешь поставить тот же пароль, которым пользовался раньше.</p>
      <form onSubmit={submit}>
        <label>Пароль<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required /></label>
        <label>Повтори пароль<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={8} required /></label>
        <button disabled={loading}>{loading?'Проверяю…':'Установить и проверить пароль'}</button>
      </form>
    </>}
    {message&&<div className={done?'msg ok':'msg'}>{message}</div>}
    {done&&<a className="primaryLink" href="/email-login">Войти по email и паролю →</a>}
    <a href="/">← Назад в Venyl</a>
    <style>{`
      *{box-sizing:border-box}html,body{margin:0;background:#0e0e0c;color:#f4efe5;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;-webkit-text-size-adjust:100%}
      .wrap{min-height:100dvh;display:grid;place-items:center;padding:24px}.card{width:min(100%,520px);padding:28px;border:1px solid #312f29;border-radius:24px;background:#151410}
      .brand{font-size:12px;letter-spacing:.34em;color:#d8bb83;font-weight:800}.card h1{font-family:Georgia,serif;font-size:38px;line-height:1.03;margin:14px 0 10px}.card p{color:#aaa397;line-height:1.5;margin:0 0 24px}.card b{color:#f4efe5}
      form{display:grid;gap:16px}label{display:grid;gap:8px;color:#bdb5a7;font-size:14px}input{width:100%;min-height:54px;border-radius:15px;border:1px solid #38352e;background:#0d0d0b;color:#fff;padding:0 15px;font-size:16px;outline:none}
      input:focus{border-color:#d8bb83;box-shadow:0 0 0 3px #d8bb8318}button{width:100%;min-height:54px;border:0;border-radius:999px;background:#d8bb83;color:#171511;font-size:17px;font-weight:650}button:disabled{opacity:.6}
      .google{background:#f3eee4}.msg{margin-top:18px;padding:14px;border:1px solid #773d3d;border-radius:14px;color:#ffb4b4;background:#271717;line-height:1.45}.msg.ok{border-color:#49634b;color:#c8e7c9;background:#172018}
      a{display:block;margin-top:22px;color:#d8bb83;text-decoration:none;text-align:center}.primaryLink{padding:14px;border:1px solid #d8bb8355;border-radius:999px}
    `}</style>
  </section></main>
}
