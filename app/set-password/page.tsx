'use client';

import {FormEvent,useEffect,useState} from 'react';

const SUPABASE_URL='https://hwulruialugaaufjzsdt.supabase.co';
const API_KEY='sb_publishable_fzNkk2LvBG9LQQey4gRY1Q_KgmEwYBi';

declare global { interface Window { VenylAuth?: any } }

export default function SetPassword(){
  const [loaded,setLoaded]=useState(false);
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);

  useEffect(()=>{
    const script=document.createElement('script');
    script.src='/assets/venyl-auth.js?v=set-password-1';
    script.onload=()=>setLoaded(true);
    script.onerror=()=>setMessage('Не удалось загрузить авторизацию Venyl.');
    document.head.appendChild(script);
    return()=>{script.remove()};
  },[]);

  async function submit(e:FormEvent){
    e.preventDefault();
    if(password.length<8){setMessage('Пароль должен быть минимум 8 символов.');return;}
    if(password!==confirm){setMessage('Пароли не совпадают.');return;}
    setLoading(true);setMessage('');
    try{
      const token=await window.VenylAuth?.currentAccessToken?.();
      if(!token) throw new Error('Сначала войди в Venyl через Google этим аккаунтом, затем снова открой эту страницу.');
      const r=await fetch(SUPABASE_URL+'/auth/v1/user',{
        method:'PUT',
        headers:{'Content-Type':'application/json','apikey':API_KEY,'Authorization':'Bearer '+token},
        body:JSON.stringify({password})
      });
      let data:any={}; try{data=await r.json();}catch{}
      if(!r.ok) throw new Error(data?.msg||data?.error_description||data?.message||data?.error||'Не удалось установить пароль.');
      setDone(true);setMessage('Готово. Пароль установлен для этого же аккаунта. Теперь можно входить и через Google, и по email + паролю.');
    }catch(err:any){setMessage(err?.message||'Не удалось установить пароль.');}
    finally{setLoading(false);}
  }

  return <main className="wrap"><section className="card">
    <div className="brand">VENYL</div><h1>Задать пароль</h1>
    <p>Для уже существующего Google-аккаунта Venyl. Почта не нужна.</p>
    {!done&&<form onSubmit={submit}>
      <label>Новый пароль<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required /></label>
      <label>Повтори пароль<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={8} required /></label>
      <button disabled={!loaded||loading}>{loading?'Сохраняю…':loaded?'Установить пароль':'Загружаю…'}</button>
    </form>}
    {message&&<div className={done?'msg ok':'msg'}>{message}</div>}
    <a href="/">← Назад в Venyl</a>
    <style>{`
      *{box-sizing:border-box}html,body{margin:0;background:#0e0e0c;color:#f4efe5;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;-webkit-text-size-adjust:100%}
      .wrap{min-height:100dvh;display:grid;place-items:center;padding:24px}.card{width:min(100%,520px);padding:28px;border:1px solid #312f29;border-radius:24px;background:#151410}
      .brand{font-size:12px;letter-spacing:.34em;color:#d8bb83;font-weight:800}.card h1{font-family:Georgia,serif;font-size:38px;line-height:1.03;margin:14px 0 10px}.card p{color:#aaa397;line-height:1.5;margin:0 0 24px}
      form{display:grid;gap:16px}label{display:grid;gap:8px;color:#bdb5a7;font-size:14px}input{width:100%;min-height:54px;border-radius:15px;border:1px solid #38352e;background:#0d0d0b;color:#fff;padding:0 15px;font-size:16px;outline:none}
      input:focus{border-color:#d8bb83;box-shadow:0 0 0 3px #d8bb8318}button{min-height:54px;border:0;border-radius:999px;background:#d8bb83;color:#171511;font-size:17px;font-weight:650}button:disabled{opacity:.6}
      .msg{margin-top:18px;padding:14px;border:1px solid #773d3d;border-radius:14px;color:#ffb4b4;background:#271717;line-height:1.45}.msg.ok{border-color:#49634b;color:#c8e7c9;background:#172018}
      a{display:block;margin-top:22px;color:#d8bb83;text-decoration:none;text-align:center}
    `}</style>
  </section></main>
}
