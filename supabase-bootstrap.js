const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const JSON_PATH = path.join(DATA_DIR, 'venyl.json');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_KEY);

const TABLES = [
  'users','email_verification_tokens','artists','albums','tracks','track_artists',
  'subscriptions','favorite_tracks','playlists','playlist_tracks','listen_history','comments',
  'user_follows','dismissed_follow_suggestions','chat_messages'
];
const COMPOSITE = { track_artists: ['track_id', 'artist_id'] };
const BUCKETS = ['tracks','covers','artists','avatars','albums','playlists'];
const blank = () => Object.fromEntries(TABLES.map(k => [k, []]));

function readLocal(){ try { return { ...blank(), ...JSON.parse(fs.readFileSync(JSON_PATH,'utf8')) }; } catch { return blank(); } }
function writeLocal(db){ fs.mkdirSync(DATA_DIR,{recursive:true}); fs.writeFileSync(JSON_PATH, JSON.stringify(db,null,2), 'utf8'); }
function norm(table,row){ const r={...row}; if(table==='users'&&'is_verified'in r)r.is_verified=Boolean(r.is_verified); if(table==='playlists'&&'is_public'in r)r.is_public=Boolean(r.is_public); return r; }
function denorm(table,row){ const r={...row}; if(table==='users'&&'is_verified'in r)r.is_verified=r.is_verified?1:0; if(table==='playlists'&&'is_public'in r)r.is_public=Boolean(r.is_public); return r; }
async function request(table,{method='GET',query='',body,prefer}={}){ const headers={apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json'}; if(prefer)headers.Prefer=prefer; const res=await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}); const text=await res.text(); if(!res.ok)throw new Error(`Supabase ${res.status} ${table}: ${text.slice(0,500)}`); return text?JSON.parse(text):null; }
async function storageList(bucket){ const res=await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({prefix:'',limit:1000,offset:0,sortBy:{column:'name',order:'asc'}})}); const text=await res.text(); if(!res.ok)throw new Error(`Storage list ${res.status}: ${text.slice(0,500)}`); return text?JSON.parse(text):[]; }
async function storageUpload(bucket,name,filePath){ const data=fs.readFileSync(filePath); const res=await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(name)}`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/octet-stream','x-upsert':'true'},body:data}); const text=await res.text(); if(!res.ok)throw new Error(`Storage upload ${res.status}: ${text.slice(0,300)}`); }
async function storageDownload(bucket,name,filePath){ const res=await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURIComponent(name)}`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}); if(!res.ok)throw new Error(`Storage download ${res.status} ${bucket}/${name}`); const data=Buffer.from(await res.arrayBuffer()); fs.mkdirSync(path.dirname(filePath),{recursive:true}); fs.writeFileSync(filePath,data); }
function bucketLocalDir(bucket){ return path.join(UPLOADS_DIR,bucket==='tracks'?'tracks':bucket==='covers'?'covers':bucket==='artists'?'artists':bucket==='avatars'?'avatars':bucket==='albums'?'albums':'playlists'); }
async function syncBucket(bucket){ const dir=bucketLocalDir(bucket); fs.mkdirSync(dir,{recursive:true}); const remote=(await storageList(bucket)).filter(x=>x&&x.name); const remoteNames=new Set(remote.map(x=>x.name)); for(const obj of remote){ const local=path.join(dir,obj.name); if(!fs.existsSync(local))await storageDownload(bucket,obj.name,local); } for(const entry of fs.readdirSync(dir,{withFileTypes:true})){ if(!entry.isFile())continue; if(!remoteNames.has(entry.name))await storageUpload(bucket,entry.name,path.join(dir,entry.name)); } }
async function syncStorage(){ for(const bucket of BUCKETS)await syncBucket(bucket); }
async function fetchAll(table){ const out=[]; for(let offset=0;;offset+=1000){ const rows=await request(table,{query:`?select=*&offset=${offset}&limit=1000`}); if(!Array.isArray(rows)||!rows.length)break; out.push(...rows.map(r=>denorm(table,r))); if(rows.length<1000)break; } return out; }
async function upsert(table,rows){ if(!rows.length)return; const conflict=COMPOSITE[table]?.join(',')||'id'; await request(table,{method:'POST',query:`?on_conflict=${encodeURIComponent(conflict)}`,prefer:'resolution=merge-duplicates,return=minimal',body:rows.map(r=>norm(table,r))}); }
function key(table,row){ return COMPOSITE[table]?COMPOSITE[table].map(k=>String(row[k])).join(':'):String(row.id); }
async function deleteMissing(table,oldRows,newRows){ if(!oldRows.length)return; const keep=new Set(newRows.map(r=>key(table,r))); for(const old of oldRows){ if(keep.has(key(table,old)))continue; if(COMPOSITE[table]){const [a,b]=COMPOSITE[table]; await request(table,{method:'DELETE',query:`?${a}=eq.${encodeURIComponent(old[a])}&${b}=eq.${encodeURIComponent(old[b])}`});} else if(old.id!=null)await request(table,{method:'DELETE',query:`?id=eq.${encodeURIComponent(old.id)}`}); } }
async function sync(db,snapshot){ for(const table of TABLES){const current=Array.isArray(db[table])?db[table]:[];const old=Array.isArray(snapshot[table])?snapshot[table]:[];await deleteMissing(table,old,current);await upsert(table,current);} return JSON.parse(JSON.stringify(db)); }

async function main(){
  const local=readLocal();
  if(!CONFIGURED){ require('./server.js'); return; }
  console.log('[Venyl] Supabase storage configured.');
  let remote=blank();
  for(const table of TABLES)remote[table]=await fetchAll(table);
  const remoteHasData=remote.users.length||remote.artists.length||remote.tracks.length;
  if(!remoteHasData){ console.log('[Venyl] Supabase is empty -> importing existing data/venyl.json.'); await sync(local,blank()); writeLocal(local); }
  else { console.log('[Venyl] Restoring database from Supabase.'); writeLocal(remote); }
  await syncStorage();
  require('./server.js');
  let snapshot=remoteHasData?remote:local; let timer=null; let running=false;
  async function flush(){ if(running)return; running=true; try{const current=readLocal();snapshot=await sync(current,snapshot);await syncStorage();}catch(err){console.error('[Venyl Supabase sync]',err.message||err);}finally{running=false;} }
  fs.watchFile(JSON_PATH,{interval:1000},()=>{clearTimeout(timer);timer=setTimeout(()=>flush(),500);});
  setInterval(()=>flush().catch(()=>{}),15000).unref();
  process.on('SIGTERM',async()=>{await flush();process.exit(0);});
  process.on('SIGINT',async()=>{await flush();process.exit(0);});
}
main().catch(err=>{console.error('[Venyl bootstrap]',err.stack||err);if(!CONFIGURED)require('./server.js');else process.exit(1);});
