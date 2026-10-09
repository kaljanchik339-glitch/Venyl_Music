'use client';

import {FormEvent,useState} from 'react';

const SUPABASE_URL='https://hwulruialugaaufjzsdt.supabase.co';
const API_KEY='sb_publishable_fzNkk2LvBG9LQQey4gRY1Q_KgmEwYBi';

export default function ForgotPassword(){
  const [email,setEmail]=useState('');
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [ok,setOk]=useState(false);

  async function submit(e:FormEvent){
    e.preventDefault();
    if(!email.trim()) return;
    setLoading(true); setMessage(''); setOk(false);
    try{
      const redirect=window.location.origin+'/reset-password';
      const r=await fetch(SUPABASE_URL+'/auth/v1/recover?redirect_to='+encodeURIComponent(redirect),{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':API_KEY},
        body:JSON.stringify({email:email.trim()})
      });
      let data:any={}; try{data=await r.json();}catch{}
      if(!r.ok){
        if(r.status===429) throw new Error('Слишком много запросов на письмо. Подожди немного и попробуй ещё раз.');
        throw new Error(data?.msg||data?.error_description||data?.message||data?.error||'Не удалось отправить письмо.');
      }
      setOk(true);
      setMessage('Письмо отправлено. Открой самое новое письмо от Supabase/Venyl и нажми ссылку восстановления.');
    }catch(err:any){ setMessage(err?.message||'Не удалось отправить письмо.'); }
    finally{ setLoading(false); }
  }

  return <main className="wrap">
    <section className="card">
      <div className="brand">VENYL</div>
      <h1>Восстановить пароль</h1>
      <p>Введи email аккаунта. Мы отправим новую ссылку для установки пароля.</p>
      <form onSubmit={submit}>
        <label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="venylmusic@gmail.com" required /></label>
        <button disabled={loading}>{loading?'Отправляю…':'Отправить ссылку'}</button>
      </form>
      {message&&<div className={ok?'msg ok':'msg'}>{message}</div>}
      <a href="/">← Назад в Venyl</a>
    </section>
    <style>{`
      *{box-sizing:border-box}html,body{margin:0;background:#0e0e0c;color:#f4efe5;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif;-webkit-text-size-adjust:100%}
      .wrap{min-height:100dvh;display:grid;place-items:center;padding:24px}.card{width:min(100%,520px);padding:28px;border:1px solid #312f29;border-radius:24px;background:#151410}
      .brand{font-size:12px;letter-spacing:.34em;color:#d8bb83;font-weight:800}.card h1{font-family:Georgia,serif;font-size:38px;line-height:1.03;margin:14px 0 12px}.card p{color:#aaa397;line-height:1.55;margin:0 0 24px}
      form{display:grid;gap:16px}label{display:grid;gap:8px;color:#bdb5a7;font-size:14px}input{width:100%;min-height:54px;border-radius:15px;border:1px solid #38352e;background:#0d0d0b;color:#fff;padding:0 15px;font-size:16px;outline:none}
      input:focus{border-color:#d8bb83;box-shadow:0 0 0 3px #d8bb8318}button{min-height:54px;border:0;border-radius:999px;background:#d8bb83;color:#171511;font-size:17px;font-weight:650}button:disabled{opacity:.6}
      .msg{margin-top:18px;padding:14px;border:1px solid #773d3d;border-radius:14px;color:#ffb4b4;background:#271717}.msg.ok{border-color:#49634b;color:#c8e7c9;background:#172018}
      a{display:block;margin-top:22px;color:#b7ae9f;text-decoration:none;text-align:center}
    `}</style>
  </main>
}
