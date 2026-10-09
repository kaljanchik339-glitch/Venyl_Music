'use client';

import {FormEvent,useState} from 'react';

const SUPABASE_URL='https://hwulruialugaaufjzsdt.supabase.co';
const API_KEY='sb_publishable_fzNkk2LvBG9LQQey4gRY1Q_KgmEwYBi';
const SESSION_KEY='venyl_supabase_session_v1';

function saveSession(data:any){
  if(!data?.access_token)return;
  const expiresIn=Number(data.expires_in||3600);
  data.expires_at=Date.now()+Math.max(60,expiresIn-30)*1000;
  localStorage.setItem(SESSION_KEY,JSON.stringify(data));
}

export default function EmailLogin(){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');

  async function submit(e:FormEvent){
    e.preventDefault();
    setLoading(true);setMessage('');
    try{
      const r=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=password',{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':API_KEY},
        body:JSON.stringify({email:email.trim(),password})
      });
      let data:any={};try{data=await r.json();}catch{}
      if(!r.ok){
        const raw=String(data?.error_description||data?.msg||data?.message||data?.error||'');
        if(/invalid login credentials/i.test(raw)) throw new Error('Неверный email или пароль. Если раньше входил только через Google — нажми «Задать пароль через Google».');
        throw new Error(raw||'Не удалось войти.');
      }
      saveSession(data);
      location.replace('/');
    }catch(err:any){setMessage(err?.message||'Не удалось войти.');}
    finally{setLoading(false);}
  }

  function google(){
    const redirect=location.origin+'/';
    const u=new URL(SUPABASE_URL+'/auth/v1/authorize');
    u.searchParams.set('provider','google');
    u.searchParams.set('redirect_to',redirect);
    sessionStorage.setItem('venyl_auth_return_to','/');
    location.assign(u.toString());
  }

  return <main className="wrap"><section className="card">
    <div className="brand">VENYL</div>
    <h1>Войти в Venyl</h1>
    <p className="sub">Тот же аккаунт, та же медиатека и админ-доступ.</p>

    <button className="google" type="button" onClick={google}>Продолжить с Google</button>
    <div className="or"><span/>или<span/></div>

    <form onSubmit={submit}>
      <label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
      <label>Пароль<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required /></label>
      <button className="primary" disabled={loading}>{loading?'Вхожу…':'Войти'}</button>
    </form>

    {message&&<div className="msg">{message}</div>}

    <div className="links">
      <a href="/forgot-password">Забыли пароль?</a>
      <a href="/set-password">Задать пароль через Google</a>
    </div>
    <a className="back" href="/">← Назад</a>
    <style>{`
      *{box-sizing:border-box}html,body{margin:0;background:#08080c;color:#f2eee8;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
      .wrap{min-height:100dvh;display:grid;place-items:center;padding:24px}.card{width:min(100%,500px);padding:30px;border:1px solid rgba(255,255,255,.08);border-radius:26px;background:#0f0f16;box-shadow:0 24px 70px #0008}
      .brand{font-size:12px;letter-spacing:.34em;color:#c8a96e;font-weight:800}.card h1{font-family:Georgia,serif;font-weight:500;font-size:42px;line-height:1.02;margin:14px 0 9px}.sub{color:#9a98a8;line-height:1.5;margin:0 0 24px}
      button{font:inherit;cursor:pointer}.google,.primary{width:100%;min-height:54px;border-radius:999px;font-size:16px;font-weight:700}.google{border:0;background:#f2eee8;color:#171717}.primary{border:0;background:#c8a96e;color:#08080c}.primary:disabled{opacity:.55}
      .or{display:flex;align-items:center;gap:12px;color:#777586;font-size:12px;margin:18px 0}.or span{height:1px;background:rgba(255,255,255,.08);flex:1}
      form{display:grid;gap:15px}label{display:grid;gap:8px;color:#a6a6bf;font-size:13px}input{width:100%;height:54px;border-radius:15px;border:1px solid rgba(255,255,255,.1);background:#161620;color:#f2eee8;padding:0 15px;font-size:16px;outline:none}input:focus{border-color:#c8a96e;box-shadow:0 0 0 3px rgba(200,169,110,.08)}
      .msg{margin-top:16px;padding:13px 14px;border-radius:14px;border:1px solid rgba(217,79,79,.4);background:rgba(217,79,79,.08);color:#ffb7b7;line-height:1.45;font-size:13px}
      .links{display:flex;justify-content:space-between;gap:14px;margin-top:18px;flex-wrap:wrap}.links a,.back{color:#c8a96e;text-decoration:none;font-size:13px}.back{display:block;text-align:center;margin-top:25px;color:#85859b}
    `}</style>
  </section></main>
}
