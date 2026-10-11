import {readFileSync,writeFileSync} from 'node:fs';

function patch(path,fn){
  const before=readFileSync(path,'utf8');
  const after=fn(before);
  if(after===before)console.warn('[release-details] no change:',path);
  writeFileSync(path,after);
}
function replaceOne(s,from,to,label){
  if(!s.includes(from))throw new Error('[release-details] target missing: '+label);
  return s.replace(from,to);
}

patch('lib/backend.js',s=>{
  const anchor="  if(url.pathname.startsWith('/api/import/'))return handleSmartImport({request,identity,env,state,user:effectiveUser,isOwner,bridge});";
  if(!s.includes("release-date'&&request.method==='PUT'")){
    const block=`  const releaseDateMatch=url.pathname.match(/^\\/api\\/admin\\/tracks\\/(\\d+)\\/release-date$/);
  if(releaseDateMatch&&request.method==='PUT'){
   if(!isOwner)return Response.json({error:'Только владелец'},{status:403});
   const body=await request.json().catch(()=>({}));
   const releaseDate=String(body?.releaseDate||'').trim();
   if(releaseDate&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(releaseDate))return Response.json({error:'Дата должна быть в формате ГГГГ-ММ-ДД'},{status:400});
   if(releaseDate&&!Number.isFinite(Date.parse(releaseDate+'T00:00:00Z')))return Response.json({error:'Некорректная дата релиза'},{status:400});
   const trackId=Number(releaseDateMatch[1]);
   const track=db.tracks.find(t=>Number(t.id)===trackId);
   if(!track)return Response.json({error:'Трек не найден'},{status:404});
   track.release_date=releaseDate;
   if(!track.release_type)track.release_type='single';
   let album=track.album_id?db.albums.find(a=>Number(a.id)===Number(track.album_id)):null;
   if(!album){
    const nextAlbumId=Math.max(0,...db.albums.map(a=>Number(a.id)||0))+1;
    album={id:nextAlbumId,artist_id:track.artist_id,name:track.title,cover_path:'',description:'',release_type:track.release_type||'single',release_date:releaseDate,created_at:track.created_at||new Date().toISOString()};
    db.albums.push(album);track.album_id=nextAlbumId;track.album=track.title;
   }else{
    album.release_date=releaseDate;
    if(!album.release_type)album.release_type=track.release_type||'single';
    for(const t of db.tracks)if(Number(t.album_id)===Number(album.id))t.release_date=releaseDate;
   }
   const saved=await bridge(env,'commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state.revision,payload:db})});
   if(saved.status===409)return Response.json({error:'Каталог изменился. Повтори сохранение.'},{status:409});
   if(!saved.ok)return Response.json({error:'Не удалось сохранить дату релиза'},{status:503});
   return Response.json({ok:true,releaseDate,albumId:track.album_id});
  }
`;
    s=replaceOne(s,anchor,block+anchor,'admin release-date route');
  }
  return s;
});

patch('public/assets/mobile/app.js',s=>{
  const oldAdmin="(s.isAdmin?link('delete-track','Удалить трек','','trash',`data-id=\"${t.id}\"`):'')";
  const newAdmin="(s.isAdmin?link('edit-release-date','Изменить дату релиза','','edit',`data-id=\"${t.id}\"`)+link('delete-track','Удалить трек','','trash',`data-id=\"${t.id}\"`):'')";
  if(s.includes(oldAdmin))s=s.replace(oldAdmin,newAdmin);

  const deleteAnchor=" else if(act==='delete-track'){if(s.isAdmin&&confirm('Удалить этот трек для всех?')){";
  if(!s.includes("act==='edit-release-date'")){
    const editBranch=` else if(act==='edit-release-date'){
  const t=trackMap.get(+id)||s.tracks.find(x=>Number(x.id)===Number(id));if(!t)return;
  sheet('Дата релиза',\`<form id="v-release-date-edit" class="v-form"><label>Дата выхода<input name="releaseDate" type="date" value="${'${'}esc(t.releaseDate||'')${'}'}" required></label><p class="v-sub">Эта дата используется в «Недавно вышедшее» и в дискографии артиста.</p><div class="v-error" role="alert"></div><button class="v-button v-primary" type="submit">Сохранить</button></form>\`);
  const f=$('v-release-date-edit');f.onsubmit=async e=>{e.preventDefault();const submit=f.querySelector('button[type=submit]');submit.disabled=true;try{const releaseDate=f.elements.releaseDate.value;await api('/api/admin/tracks/'+id+'/release-date',{releaseDate},{method:'PUT'});closeSheet();await loadCatalog();await navigate();toast('Дата релиза сохранена');}catch(err){f.querySelector('.v-error').textContent=err.message;}finally{submit.disabled=false;}};
 }
`;
    s=replaceOne(s,deleteAnchor,editBranch+deleteAnchor,'edit release date click handler');
  }

  const oldRecent="+section('Недавно вышедшие',rows([...s.tracks].sort((a,b)=>Date.parse(b.releaseDate||0)-Date.parse(a.releaseDate||0)||Number(b.id)-Number(a.id)).slice(0,8)));";
  const newRecent="+section('Недавно вышедшее',rows(s.tracks.filter(t=>{const d=Date.parse(t.releaseDate||'');return Number.isFinite(d)&&d<=Date.now();}).sort((a,b)=>Date.parse(b.releaseDate)-Date.parse(a.releaseDate)||Number(b.id)-Number(a.id)).slice(0,8)));";
  if(s.includes(oldRecent))s=s.replace(oldRecent,newRecent);

  const oldArtist="function artistReleases(d){const tracks=d.tracks||[],counts=new Map(),normTitle=v=>String(v||'').trim().toLocaleLowerCase('ru').replace(/[^a-zа-яё0-9]+/gi,'');for(const t of tracks)if(t.albumId)counts.set(Number(t.albumId),(counts.get(Number(t.albumId))||0)+1);const albumTitles=new Set(tracks.filter(t=>t.albumId).map(t=>normTitle(t.title)).filter(Boolean));const out=(d.albums||[]).filter(a=>(counts.get(Number(a.id))||0)>0).map(a=>({...a,nav:'album',title:a.name,artist:d.artist?.name||'',releaseType:releaseKind(a,counts.get(Number(a.id))||0),releaseDate:a.releaseDate||tracks.find(t=>Number(t.albumId)===Number(a.id))?.releaseDate||a.createdAt||''}));for(const t of tracks)if(!t.albumId&&!albumTitles.has(normTitle(t.title)))out.push({...t,nav:'single-release',name:t.title,title:t.title,releaseType:'single',releaseDate:t.releaseDate||t.createdAt||''});return out.sort((a,b)=>Date.parse(releaseStamp(b)||0)-Date.parse(releaseStamp(a)||0)||Number(b.id)-Number(a.id));}";
  const newArtist="function artistReleases(d){const tracks=d.tracks||[],counts=new Map(),normTitle=v=>String(v||'').trim().toLocaleLowerCase('ru').replace(/[^a-zа-яё0-9]+/gi,'');for(const t of tracks)if(t.albumId)counts.set(Number(t.albumId),(counts.get(Number(t.albumId))||0)+1);const albumTitles=new Set(tracks.filter(t=>t.albumId).map(t=>normTitle(t.title)).filter(Boolean));const seen=new Set(),out=[];for(const a of d.albums||[]){const n=counts.get(Number(a.id))||0;if(!n)continue;const first=tracks.find(t=>Number(t.albumId)===Number(a.id));out.push({...a,nav:'album',title:a.name,artist:d.artist?.name||'',coverUrl:a.coverUrl||first?.coverUrl||'',releaseType:releaseKind(a,n),releaseDate:a.releaseDate||first?.releaseDate||a.createdAt||''});seen.add(Number(a.id));}for(const t of tracks){if(t.albumId&&!seen.has(Number(t.albumId))){out.push({id:t.albumId,nav:'album',name:t.album||t.title,title:t.album||t.title,artist:d.artist?.name||t.artist,coverUrl:t.coverUrl||'',releaseType:releaseKind(t,counts.get(Number(t.albumId))||1),releaseDate:t.releaseDate||t.createdAt||''});seen.add(Number(t.albumId));}else if(!t.albumId&&!albumTitles.has(normTitle(t.title)))out.push({...t,nav:'single-release',name:t.title,title:t.title,releaseType:'single',releaseDate:t.releaseDate||t.createdAt||''});}return out.sort((a,b)=>Date.parse(releaseStamp(b)||0)-Date.parse(releaseStamp(a)||0)||Number(b.id)-Number(a.id));}";
  if(s.includes(oldArtist))s=s.replace(oldArtist,newArtist);

  const oldAlbum="const x=d[name];if(name==='playlist')currentPlaylist=";
  const newAlbum="const x=d[name];if(name==='album'&&!x.coverUrl&&pageTracks[0]?.coverUrl)x.coverUrl=pageTracks[0].coverUrl;if(name==='playlist')currentPlaylist=";
  if(s.includes(oldAlbum))s=s.replace(oldAlbum,newAlbum);

  return s;
});

patch('lib/mobile-ui.js',s=>s
 .replace(/\/assets\/mobile\/mobile\.css\?v=[^"']+/g,'/assets/mobile/mobile.css?v=release-details-1')
 .replace(/\/assets\/mobile\/app\.js\?v=[^"']+/g,'/assets/mobile/app.js?v=release-details-1')
 .replace(/\/assets\/mobile\/upload\.js\?v=[^"']+/g,'/assets/mobile/upload.js?v=release-details-1')
);

console.log('Release details fixed: edit date, true recency, single covers.');
