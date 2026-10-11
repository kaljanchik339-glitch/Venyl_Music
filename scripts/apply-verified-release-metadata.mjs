const BRIDGE='https://hwulruialugaaufjzsdt.supabase.co/functions/v1/venyl-render-bridge';
const token=process.env.VENYL_RENDER_BRIDGE_TOKEN||'';
if(!token){console.error('[verified-releases] missing bridge token');process.exit(0);}

const META={
  'album:4': {date:'2025-02-14',type:'ep'},
  'album:5': {date:'2018-10-12',type:'album'},
  'album:6': {date:'2019-01-01',type:'album'},
  'album:7': {date:'2018-02-17',type:'ep'},
  'album:8': {date:'2020-01-17',type:'album'},
  'album:9': {date:'2021-05-20',type:'album'},
  'album:10':{date:'2021-05-28',type:'album'},
  'album:11':{date:'2022-10-21',type:'album'},
  'album:12':{date:'2026-02-13',type:'album'},
  'album:13':{date:'2023-06-30',type:'album'},
  'album:14':{date:'2012-04-10',type:'album'},
  'album:15':{date:'2011-01-01',type:'album'},
  'album:16':{date:'2014-10-31',type:'album'},
  'album:17':{date:'2022-08-12',type:'album'},
  'album:20':{date:'2019-11-14',type:'single'},
  'album:21':{date:'2021-04-30',type:'single'},
  'album:43':{date:'2022-05-13',type:'album'},
  'album:44':{date:'2019-11-14',type:'album'},
  'album:45':{date:'2020-10-23',type:'ep'},
  'album:48':{date:'2019-11-08',type:'album'},
  'album:50':{date:'2019-11-22',type:'album'},
  'album:51':{date:'2020-07-17',type:'single'},
  'album:52':{date:'2020-04-10',type:'album'},
  'album:53':{date:'2020-07-17',type:'single'},
  'album:54':{date:'2018-06-15',type:'album'},
  'album:55':{date:'2021-08-13',type:'album'},
  'album:56':{date:'2019-10-28',type:'album'},
  'album:57':{date:'2020-11-12',type:'single'},
  'album:60':{date:'2024-06-28',type:'single'},
  'album:61':{date:'2024-06-28',type:'single'},
  'album:63':{date:'2023-09-29',type:'single'},
  'album:65':{date:'2018-12-07',type:'single'},
  'album:66':{date:'2019-11-29',type:'single'},
  'album:67':{date:'2022-06-03',type:'single'},
  'album:69':{date:'2018-05-27',type:'single'},
  'album:70':{date:'2019-06-07',type:'single'},
  'album:71':{date:'2023-12-15',type:'single'},
  'album:72':{date:'2022-12-16',type:'single'},
  'album:73':{date:'2023-12-29',type:'single'},
  'album:74':{date:'2025-11-28',type:'single'},
  'album:75':{date:'2019-11-01',type:'single'},
  'album:81':{date:'2024-11-22',type:'album'},

  'track:1':  {date:'2022-04-08',type:'single'},
  'track:7':  {date:'2014-10-31',type:'single'},
  'track:14': {date:'2021-03-19',type:'single'},
  'track:15': {date:'2011-01-01',type:'single'},
  'track:18': {date:'2021-08-20',type:'single'},
  'track:19': {date:'2012-10-14',type:'single'},
  'track:20': {date:'2011-01-01',type:'single'},
  'track:22': {date:'2021-03-11',type:'single'},
  'track:123':{date:'2005-09-22',type:'single'},
  'track:180':{date:'2022-11-18',type:'single'},
  'track:191':{date:'2020-07-31',type:'single'},
  'track:214':{date:'2022-07-22',type:'single'},
  'track:226':{date:'2020-09-18',type:'single'},
  'track:283':{date:'2025-10-03',type:'single'},
  'track:291':{date:'2019-11-29',type:'single'}
};

async function load(){
  const r=await fetch(BRIDGE+'?action=state',{headers:{'x-venyl-bridge':token}});
  if(!r.ok)throw new Error('state '+r.status);
  return r.json();
}
async function save(revision,payload){
  const r=await fetch(BRIDGE+'?action=commit',{method:'POST',headers:{'x-venyl-bridge':token,'Content-Type':'application/json'},body:JSON.stringify({revision,payload})});
  if(r.status===409)return false;
  if(!r.ok)throw new Error('commit '+r.status);
  return true;
}
function apply(db){
  db._meta??={};
  db._meta.releaseDateLookup??={};
  const now=new Date().toISOString();
  let changed=0;
  for(const [key,m] of Object.entries(META)){
    const [kind,rawId]=key.split(':');
    const id=Number(rawId);
    if(kind==='album'){
      const a=(db.albums||[]).find(x=>Number(x.id)===id);
      if(!a)continue;
      if(a.release_date!==m.date){a.release_date=m.date;changed++;}
      if(a.release_type!==m.type){a.release_type=m.type;changed++;}
      for(const t of db.tracks||[]){
        if(Number(t.album_id)===id){
          if(t.release_date!==m.date){t.release_date=m.date;changed++;}
          if(!t.release_type||t.release_type==='album'||t.release_type==='single'){
            t.release_type=m.type;
          }
        }
      }
    }else{
      const t=(db.tracks||[]).find(x=>Number(x.id)===id);
      if(!t)continue;
      if(t.release_date!==m.date){t.release_date=m.date;changed++;}
      t.release_type=m.type;
    }
    db._meta.releaseDateLookup[key]={checkedAt:now,date:m.date,source:'web-verified',confidence:100};
  }
  return changed;
}

for(let attempt=0;attempt<6;attempt++){
  const cur=await load();
  const changed=apply(cur.payload);
  const ok=await save(cur.revision,cur.payload);
  if(ok){console.log('[verified-releases] applied',JSON.stringify({entries:Object.keys(META).length,changed}));process.exit(0);}
  await new Promise(r=>setTimeout(r,500*(attempt+1)));
}
throw new Error('Could not commit verified release metadata');
