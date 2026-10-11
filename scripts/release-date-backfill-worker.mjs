import {lookupReleaseDate} from '../lib/release-metadata.js';

const BRIDGE='https://hwulruialugaaufjzsdt.supabase.co/functions/v1/venyl-render-bridge';
const token=process.env.VENYL_RENDER_BRIDGE_TOKEN||'';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

if(!token){
  console.error('[release-backfill] missing bridge token');
  process.exit(0);
}

async function state(){
  const r=await fetch(BRIDGE+'?action=state',{headers:{'x-venyl-bridge':token}});
  if(!r.ok)throw new Error('state '+r.status);
  return r.json();
}
async function commit(revision,payload){
  const r=await fetch(BRIDGE+'?action=commit',{
    method:'POST',
    headers:{'x-venyl-bridge':token,'Content-Type':'application/json'},
    body:JSON.stringify({revision,payload})
  });
  const data=await r.json().catch(()=>({}));
  return {ok:r.ok,status:r.status,data};
}
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
const norm=v=>String(v||'').trim().toLocaleLowerCase('ru').replace(/\s+/g,' ');

function groups(db){
  const albums=new Map((db.albums||[]).map(a=>[Number(a.id),a]));
  const by=new Map();
  for(const t of db.tracks||[]){
    const albumId=Number(t.album_id)||0;
    const key=albumId?'album:'+albumId:'track:'+t.id;
    let g=by.get(key);
    if(!g){
      const a=albumId?albums.get(albumId):null;
      g={
        key,
        albumId,
        title:albumId?(a?.name||t.album||t.title):t.title,
        album:albumId?(a?.name||t.album||t.title):(t.album||t.title),
        artist:t.artist||'',
        trackIds:[],
        existingDate:validDate(a?.release_date)?a.release_date:(validDate(t.release_date)?t.release_date:'')
      };
      by.set(key,g);
    }
    g.trackIds.push(Number(t.id));
    if(!g.existingDate&&validDate(t.release_date))g.existingDate=t.release_date;
  }
  return [...by.values()];
}

function apply(db,g,result){
  db._meta??={};
  db._meta.releaseDateLookup??={};
  const now=new Date().toISOString();
  const date=validDate(result?.date)?result.date:'';
  db._meta.releaseDateLookup[g.key]={
    checkedAt:now,
    date,
    partialDate:String(result?.partialDate||''),
    source:String(result?.source||'none'),
    confidence:Number(result?.confidence)||0,
    matchedTitle:String(result?.matchedTitle||''),
    matchedArtist:String(result?.matchedArtist||'')
  };
  if(!date)return;
  for(const t of db.tracks||[]){
    if(g.trackIds.includes(Number(t.id)))t.release_date=date;
  }
  if(g.albumId){
    const a=(db.albums||[]).find(x=>Number(x.id)===g.albumId);
    if(a)a.release_date=date;
  }
}

let updated=0,unresolved=0,attempted=0;
try{
  for(let loop=0;loop<160;loop++){
    const current=await state();
    const db=current.payload;
    db._meta??={};
    db._meta.releaseDateLookup??={};

    const all=groups(db);
    const pending=all.filter(g=>{
      const done=g.existingDate||db._meta.releaseDateLookup[g.key];
      return !done;
    });
    if(!pending.length){
      const missing=(db.tracks||[]).filter(t=>!validDate(t.release_date)).length;
      console.log('[release-backfill] finished',JSON.stringify({attempted,updated,unresolved,missing}));
      break;
    }

    const g=pending[0];
    attempted++;
    let found;
    if(g.existingDate){
      found={date:g.existingDate,source:'existing',confidence:100};
    }else{
      try{
        found=await lookupReleaseDate({title:g.title,artist:g.artist,album:g.album});
      }catch(e){
        console.warn('[release-backfill] lookup error',g.key,e?.message||String(e));
        found={date:'',source:'error',confidence:0};
      }
    }

    let saved=false;
    for(let retry=0;retry<4&&!saved;retry++){
      const fresh=retry?await state():current;
      const freshDb=fresh.payload;
      const freshGroup=groups(freshDb).find(x=>x.key===g.key);
      if(!freshGroup){saved=true;break;}
      if(freshGroup.existingDate){
        apply(freshDb,freshGroup,{date:freshGroup.existingDate,source:'existing',confidence:100});
      }else{
        apply(freshDb,freshGroup,found);
      }
      const c=await commit(fresh.revision,freshDb);
      if(c.ok){
        saved=true;
      }else if(c.status===409){
        await sleep(700);
      }else{
        throw new Error('commit '+c.status);
      }
    }
    if(!saved)throw new Error('commit conflict');

    if(validDate(found?.date)){
      updated++;
      console.log('[release-backfill] dated',g.key,JSON.stringify({title:g.title,artist:g.artist,date:found.date,source:found.source,confidence:found.confidence}));
    }else{
      unresolved++;
      console.log('[release-backfill] unresolved',g.key,JSON.stringify({title:g.title,artist:g.artist,partialDate:found?.partialDate||'',source:found?.source||'none'}));
    }
    await sleep(150);
  }
}catch(e){
  console.error('[release-backfill] fatal',e?.message||String(e));
}
