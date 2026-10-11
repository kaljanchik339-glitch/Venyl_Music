import {readFileSync,writeFileSync} from 'node:fs';

function patch(path,fn){
  const before=readFileSync(path,'utf8');
  const after=fn(before);
  if(after===before)console.warn('[release-system] no change:',path);
  writeFileSync(path,after);
}
function must(s,from,to,label){
  if(!s.includes(from))throw new Error('[release-system] target missing: '+label);
  return s.replace(from,to);
}

writeFileSync('lib/release-metadata.js',String.raw`
let lastMusicBrainzCall=0;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const clean=v=>String(v||'').normalize('NFKC').toLocaleLowerCase('ru').replace(/[’‘\`]/g,"'").replace(/\([^)]*(?:remaster|live|karaoke|instrumental)[^)]*\)/gi,' ').replace(/\[[^\]]*(?:remaster|live|karaoke|instrumental)[^\]]*\]/gi,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const primaryArtist=v=>String(v||'').split(/\s*[,;&]\s*|\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0]?.trim()||'';
const fullDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):'';
const yearOf=v=>/^\d{4}/.test(String(v||''))?String(v).slice(0,4):'';
const exactish=(a,b)=>{a=clean(a);b=clean(b);return !!a&&!!b&&(a===b||a.includes(b)||b.includes(a));};
function artistText(item){return (item?.['artist-credit']||[]).map(x=>x?.artist?.name||x?.name||'').filter(Boolean).join(', ');}
async function mb(path,params){
 const elapsed=Date.now()-lastMusicBrainzCall;if(elapsed<1100)await wait(1100-elapsed);
 lastMusicBrainzCall=Date.now();
 const u=new URL('https://musicbrainz.org/ws/2/'+path);for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
 const r=await fetch(u,{headers:{'Accept':'application/json','User-Agent':'Venyl/1.0 (https://venyl-music.onrender.com)'}});
 if(!r.ok)throw new Error('MusicBrainz '+r.status);return r.json();
}
async function fromMusicBrainz({title,artist,album}){
 const lead=primaryArtist(artist);const release=String(album||title||'').trim();
 const q='release:"'+release.replace(/"/g,'')+'" AND artistname:"'+lead.replace(/"/g,'')+'"';
 try{
  const d=await mb('release-group/',{query:q,fmt:'json',limit:'8'});
  const c=(d['release-groups']||[]).map(x=>({x,score:Number(x.score)||0,title:x.title,artist:artistText(x),date:x['first-release-date']||''}))
    .filter(c=>c.score>=80&&exactish(c.title,release)&&exactish(c.artist,lead)).sort((a,b)=>b.score-a.score)[0];
  if(c?.date)return {date:c.date,source:'musicbrainz-release',confidence:c.score,matchedTitle:c.title,matchedArtist:c.artist};
 }catch{}
 try{
  const q2='recording:"'+String(title||'').replace(/"/g,'')+'" AND artistname:"'+lead.replace(/"/g,'')+'"';
  const d=await mb('recording/',{query:q2,fmt:'json',limit:'8'});
  const c=(d.recordings||[]).map(x=>({x,score:Number(x.score)||0,title:x.title,artist:artistText(x),date:x['first-release-date']||''}))
    .filter(c=>c.score>=82&&exactish(c.title,title)&&exactish(c.artist,lead)).sort((a,b)=>b.score-a.score)[0];
  if(c?.date)return {date:c.date,source:'musicbrainz-recording',confidence:c.score,matchedTitle:c.title,matchedArtist:c.artist};
 }catch{}
 return null;
}
async function fromItunes({title,artist,album},expectedYear=''){
 try{
  const lead=primaryArtist(artist),u=new URL('https://itunes.apple.com/search');
  u.searchParams.set('term',[lead,album||title].filter(Boolean).join(' '));u.searchParams.set('entity','song');u.searchParams.set('limit','30');
  const r=await fetch(u,{headers:{'Accept':'application/json'}});if(!r.ok)return null;const d=await r.json();
  const release=String(album||title||'');
  const items=(d.results||[]).filter(x=>exactish(x.artistName,lead)&&(exactish(x.trackName,title)||exactish(x.collectionName,release))).map(x=>{
   let score=0;if(clean(x.trackName)===clean(title))score+=60;else if(exactish(x.trackName,title))score+=40;
   if(clean(x.artistName)===clean(lead))score+=30;else if(exactish(x.artistName,lead))score+=20;
   if(clean(x.collectionName)===clean(release))score+=10;
   const date=String(x.releaseDate||'').slice(0,10);if(expectedYear&&yearOf(date)===expectedYear)score+=15;
   return {x,score,date};
  }).filter(x=>fullDate(x.date)&&x.score>=75).sort((a,b)=>b.score-a.score);
  const c=items[0];if(!c)return null;
  return {date:c.date,source:'itunes',confidence:Math.min(99,c.score),matchedTitle:c.x.trackName,matchedArtist:c.x.artistName};
 }catch{return null;}
}
export async function lookupReleaseDate(input){
 const title=String(input?.title||'').trim(),artist=String(input?.artist||'').trim(),album=String(input?.album||'').trim();
 if(!title||!artist)return {date:'',source:'none',confidence:0};
 const mbResult=await fromMusicBrainz({title,artist,album});
 if(mbResult&&fullDate(mbResult.date))return {...mbResult,date:fullDate(mbResult.date)};
 const expectedYear=yearOf(mbResult?.date||'');
 const it=await fromItunes({title,artist,album},expectedYear);
 if(it&&(!expectedYear||yearOf(it.date)===expectedYear))return it;
 return {date:'',partialDate:mbResult?.date||'',source:mbResult?.source||'none',confidence:mbResult?.confidence||0};
}
`);

patch('lib/smart-import.js',s=>{
  if(!s.includes("from './release-metadata.js'"))s=s.replace("import {normal,artistNames,findDuplicate,cleanText,cleanImportRow,looksBroken} from './import-shared.js';","import {normal,artistNames,findDuplicate,cleanText,cleanImportRow,looksBroken} from './import-shared.js';\nimport {lookupReleaseDate} from './release-metadata.js';");
  s=must(s,
    " t.trackNumber=Math.max(0,Math.min(9999,Math.floor(Number(input.trackNumber)||0)));t.discNumber=Math.max(1,Math.min(999,Math.floor(Number(input.discNumber)||1)));",
    " t.trackNumber=Math.max(0,Math.min(9999,Math.floor(Number(input.trackNumber)||0)));t.discNumber=Math.max(1,Math.min(999,Math.floor(Number(input.discNumber)||1)));\n t.releaseDate=String(input.releaseDate||'').trim();if(t.releaseDate&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(t.releaseDate))throw fail('Дата релиза должна быть в формате ГГГГ-ММ-ДД');",
    'smart validate release date');
  s=must(s,
    " let album=albumFor(db,t);if(!album){album={id:nextId(db,'albums'),artist_id:owner.id,name:t.album,cover_path:'',description:'',release_type:t.kind,created_at:now};db.albums.push(album);}",
    " let album=albumFor(db,t);if(!album){album={id:nextId(db,'albums'),artist_id:owner.id,name:t.album,cover_path:'',description:'',release_type:t.kind,release_date:t.releaseDate||'',created_at:now};db.albums.push(album);}else if(t.releaseDate&&!album.release_date)album.release_date=t.releaseDate;",
    'smart album release date');
  s=must(s,
    " const row={id:nextId(db,'tracks'),title:t.title,artist:artists.map(a=>a.name).join(', '),artist_id:artists[0].id,album:album.name,album_id:album.id,genre:t.genre,play_count:0,cover_path:album.cover_path||'',audio_path:paths.audio,duration_seconds:t.duration,track_number:t.trackNumber,disc_number:t.discNumber,uploaded_by_user_id:userId,import_hash:t.hash,release_type:t.kind,created_at:now};",
    " const row={id:nextId(db,'tracks'),title:t.title,artist:artists.map(a=>a.name).join(', '),artist_id:artists[0].id,album:album.name,album_id:album.id,genre:t.genre,play_count:0,cover_path:album.cover_path||'',audio_path:paths.audio,duration_seconds:t.duration,track_number:t.trackNumber,disc_number:t.discNumber,uploaded_by_user_id:userId,import_hash:t.hash,release_type:t.kind,release_date:t.releaseDate||'',created_at:now};",
    'smart track release date');
  s=must(s,
    "   const t=validateItem(body);const duplicate=findDuplicate(db.tracks,t);if(duplicate)return respond({skipped:true,trackId:duplicate.id});",
    "   const t=validateItem(body);const duplicate=findDuplicate(db.tracks,t);if(duplicate)return respond({skipped:true,trackId:duplicate.id});if(!t.releaseDate){const found=await lookupReleaseDate(t);if(found.date)t.releaseDate=found.date;}",
    'smart auto lookup');
  return s;
});

patch('lib/legacy.js',s=>{
  s=must(s,
    "function mapAlbum(row){ return { id: row.id, artistId: row.artist_id, name: row.name, releaseType: row.release_type || '', description: row.description || '', coverUrl: row.cover_path ? `/uploads/albums/${row.cover_path}` : '', createdAt: row.created_at }; }",
    "function mapAlbum(row){ return { id: row.id, artistId: row.artist_id, name: row.name, releaseType: row.release_type || '', releaseDate: row.release_date || '', description: row.description || '', coverUrl: row.cover_path ? `/uploads/albums/${row.cover_path}` : '', createdAt: row.created_at }; }",
    'mapAlbum releaseDate');
  s=must(s,
    "  return { id: row.id, title: row.title, artist: row.artist, artists, artistId: row.artist_id || (artists[0]?.id || null), album: row.album || '', albumId: row.album_id || null, releaseType: row.release_type || '', genre: row.genre || '', playCount: Number(row.play_count) || 0, duration:Number(row.duration_seconds)||0, trackNumber:Number(row.track_number)||0, discNumber:Number(row.disc_number)||1, coverUrl: resolveCoverUrl(row.cover_path), audioUrl: `/uploads/tracks/${row.audio_path}`, createdAt: row.created_at };",
    "  return { id: row.id, title: row.title, artist: row.artist, artists, artistId: row.artist_id || (artists[0]?.id || null), album: row.album || '', albumId: row.album_id || null, releaseType: row.release_type || '', releaseDate: row.release_date || '', genre: row.genre || '', playCount: Number(row.play_count) || 0, duration:Number(row.duration_seconds)||0, trackNumber:Number(row.track_number)||0, discNumber:Number(row.disc_number)||1, coverUrl: resolveCoverUrl(row.cover_path), audioUrl: `/uploads/tracks/${row.audio_path}`, createdAt: row.created_at };",
    'mapTrack releaseDate');
  s=must(s,
    "  const albums=db.albums.filter(x=>Number(x.artist_id)===id).sort((x,y)=>y.id-x.id).map(mapAlbum);",
    "  const albums=db.albums.filter(x=>Number(x.artist_id)===id).sort((x,y)=>Date.parse(y.release_date||y.created_at||0)-Date.parse(x.release_date||x.created_at||0)||Number(y.id)-Number(x.id)).map(mapAlbum);",
    'artist albums date sort');
  return s;
});

patch('lib/backend.js',s=>{
  if(!s.includes("from './release-metadata.js'"))s=s.replace("import {parseBody} from './router.js';","import {parseBody} from './router.js';\nimport {lookupReleaseDate} from './release-metadata.js';");
  const anchor=" // Reject unsupported archive endpoints before reading any request bytes.";
  if(!s.includes("url.pathname==='/api/metadata/release-date'"))s=must(s,anchor,
` if(url.pathname==='/api/metadata/release-date'&&request.method==='GET'){
  const found=await lookupReleaseDate({title:url.searchParams.get('title')||'',artist:url.searchParams.get('artist')||'',album:url.searchParams.get('album')||''});
  return Response.json(found,{headers:{'Cache-Control':'no-store'}});
 }
${anchor}`,'metadata route');
  if(!s.includes("/api/admin/release-dates/backfill")){
    const parseMatch=s.match(/(^|\n)([ \t]*)const parsed=await parseBody\(request\);/);
    if(!parseMatch)throw new Error('[release-system] target missing: backfill route');
    const parsePos=s.indexOf(parseMatch[0])+parseMatch[1].length;
    const indent=parseMatch[2]||' ';
    const block=`${indent}if(url.pathname==='/api/admin/release-dates/backfill'&&request.method==='POST'){
${indent} if(!isOwner&&user?.role!=='admin')return Response.json({error:'Только владелец'},{status:403});
${indent} db._meta.releaseDateLookup??={};const checked=db._meta.releaseDateLookup;
${indent} const pending=db.tracks.filter(t=>!t.release_date&&(!checked[t.id]||Date.now()-Date.parse(checked[t.id].checkedAt||0)>30*86400000));
${indent} if(!pending.length){const remaining=db.tracks.filter(t=>!t.release_date).length;return Response.json({done:true,remaining});}
${indent} const t=pending[0];const found=await lookupReleaseDate({title:t.title,artist:t.artist,album:t.album||t.title});
${indent} if(found.date){t.release_date=found.date;if(t.album_id){const al=db.albums.find(a=>Number(a.id)===Number(t.album_id));if(al&&!al.release_date)al.release_date=found.date;}}
${indent} checked[t.id]={checkedAt:new Date().toISOString(),date:found.date||'',partialDate:found.partialDate||'',source:found.source||'none',confidence:Number(found.confidence)||0};
${indent} const r=await bridge(env,'commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:state.revision,payload:db})});
${indent} if(r.status===409)return Response.json({error:'Каталог изменился. Повтори.'},{status:409});if(!r.ok)throw Error('Не удалось сохранить дату релиза');
${indent} const remaining=db.tracks.filter(x=>!x.release_date).length;return Response.json({done:false,updated:!!found.date,trackId:t.id,date:found.date||'',source:found.source||'',remaining});
${indent}}
`;
    s=s.slice(0,parsePos)+block+s.slice(parsePos);
  }
  return s;
});

patch('public/assets/mobile/app.js',s=>{
  if(!s.includes('VENYL_RELEASE_SYSTEM_V1')){
    s=must(s,
      " const time=n=>Number.isFinite(n)?Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0'):'0:00';",
      ` const time=n=>Number.isFinite(n)?Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0'):'0:00';
 const releaseStamp=x=>x?.releaseDate||x?.createdAt||'';
 const releaseYear=x=>{const d=releaseStamp(x);return /^\\d{4}/.test(d)?d.slice(0,4):'';};
 const releaseKind=(x,count=0)=>x?.releaseType==='single'?'single':x?.releaseType==='ep'?'ep':x?.releaseType==='album'?'album':count===1?'single':'album';
 const releaseLabel=k=>k==='single'?'Сингл':k==='ep'?'EP':'Альбом';
 const releaseDateText=x=>{const d=releaseStamp(x);if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(d))return releaseYear(x);try{return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric'}).format(new Date(d+'T12:00:00'));}catch{return d;}};
 function artistReleases(d){const tracks=d.tracks||[],counts=new Map();for(const t of tracks)if(t.albumId)counts.set(Number(t.albumId),(counts.get(Number(t.albumId))||0)+1);const out=(d.albums||[]).map(a=>({...a,nav:'album',title:a.name,artist:d.artist?.name||'',releaseType:releaseKind(a,counts.get(Number(a.id))||0),releaseDate:a.releaseDate||tracks.find(t=>Number(t.albumId)===Number(a.id))?.releaseDate||a.createdAt||''}));for(const t of tracks)if(!t.albumId)out.push({...t,nav:'single-release',name:t.title,title:t.title,releaseType:'single',releaseDate:t.releaseDate||t.createdAt||''});return out.sort((a,b)=>Date.parse(releaseStamp(b)||0)-Date.parse(releaseStamp(a)||0)||Number(b.id)-Number(a.id));}
 function releaseCards(items){return '<div class="v-release-grid">'+items.map(r=>'<button class="v-release-card" data-v="'+r.nav+'" data-id="'+r.id+'">'+art(r.coverUrl,'v-release-art')+'<span class="v-copy"><b>'+esc(r.title||r.name)+'</b><small>'+esc(releaseLabel(r.releaseType)+(releaseYear(r)?' · '+releaseYear(r):''))+'</small></span></button>').join('')+'</div>';}
 function releaseFilters(artistId,active=''){return '<div class="v-release-filters">'+[['single','Треки'],['ep','EP'],['album','Альбомы']].map(([k,l])=>'<button class="v-filter '+(active===k?'active':'')+'" data-v="release-filter" data-id="'+artistId+'" data-filter="'+k+'" aria-pressed="'+(active===k)+'">'+l+'</button>').join('')+'</div>';}
 function artistScreen(d){const x=d.artist;pageTracks=remember(d.tracks||[]);const rels=artistReleases(d),latest=rels.slice(0,4);screen.innerHTML='<div class="v-hero v-artist">'+art(x.photoUrl,'v-art',true)+'<div class="v-kicker">АРТИСТ</div><h1>'+esc(x.name)+'</h1><p class="v-sub">'+pageTracks.length+' треков</p>'+(x.bio?'<p class="v-sub">'+esc(x.bio)+'</p>':'')+'<button class="v-button" data-v="follow-artist" data-id="'+x.id+'">'+(x.isSubscribed?'Вы подписаны':'Подписаться')+'</button></div>'+section('Популярное',rows([...pageTracks].sort((a,b)=>b.playCount-a.playCount).slice(0,6),true))+section('Последние релизы',latest.length?releaseCards(latest):empty('Релизов пока нет'),rels.length?'<button class="v-text-button" data-v="artist-releases" data-id="'+x.id+'">Показать все</button>':'');}
 function discographyScreen(d,filter=''){const rels=artistReleases(d),shown=filter?rels.filter(r=>r.releaseType===filter):rels;screen.innerHTML='<div class="v-kicker">ДИСКОГРАФИЯ</div><h1>'+esc(d.artist.name)+'</h1>'+releaseFilters(d.artist.id,filter)+(shown.length?releaseCards(shown):empty('Здесь пока нет релизов'));}
 // VENYL_RELEASE_SYSTEM_V1`,
      'release helpers');

    s=must(s,
      " async function navigate(){const version=++routeVersion;listPages.clear();currentPlaylist=null;route=decodeURIComponent(location.hash.slice(1)||'home');searchAbort?.abort();clearTimeout(searchTimer);const [name,id]=route.split('/');",
      " async function navigate(){const version=++routeVersion;listPages.clear();currentPlaylist=null;route=decodeURIComponent(location.hash.slice(1)||'home');searchAbort?.abort();clearTimeout(searchTimer);const [name,id,sub]=route.split('/');",
      'route sub filter');

    {
      const branch=/ else if\(\['artist','album','playlist'\]\.includes\(name\)\)\{[\s\S]*?\}\n else if\(name==='track'\)/;
      if(!branch.test(s))throw new Error('[release-system] target missing: artist branch');
      const newBranch=" else if(name==='artist'){const d=await api('/api/artists/'+encodeURIComponent(id));if(version!==routeVersion)return;artistScreen(d);}\n else if(name==='artist-releases'){const d=await api('/api/artists/'+encodeURIComponent(id));if(version!==routeVersion)return;pageTracks=remember(d.tracks||[]);discographyScreen(d,sub||'');}\n else if(name==='single-release'){const t=trackMap.get(+id)||s.tracks.find(x=>Number(x.id)===Number(id));if(!t){screen.innerHTML=empty('Релиз не найден');pageTracks=[];}else{pageTracks=remember([t]);screen.innerHTML='<div class=\"v-hero\">'+art(t.coverUrl,'v-art',true)+'<div class=\"v-kicker\">СИНГЛ</div><h1>'+esc(t.title)+'</h1>'+(t.artistId?'<button class=\"v-text-button\" data-v=\"artist\" data-id=\"'+t.artistId+'\">'+esc(t.artist)+'</button>':'<p class=\"v-sub\">'+esc(t.artist)+'</p>')+'<p class=\"v-sub\">'+esc(releaseDateText(t))+'</p>'+actions(pageTracks)+'</div>'+rows(pageTracks);}}\n else if(['album','playlist'].includes(name)){const d=await api('/api/'+({album:'albums',playlist:'playlists'}[name])+'/'+encodeURIComponent(id));if(version!==routeVersion)return;pageTracks=remember(d.tracks||[]);const x=d[name];if(name==='playlist')currentPlaylist={id:x.id,canEdit:d.canEdit,canDelete:!!(d.canDelete??d.canEdit),tracks:pageTracks};screen.innerHTML=`<div class=\"v-hero\">${art(x.coverUrl,'v-art',true)}<div class=\"v-kicker\">${name==='playlist'?'ПЛЕЙЛИСТ':x.releaseType==='single'?'СИНГЛ':x.releaseType==='ep'?'EP':'АЛЬБОМ'}</div><h1>${esc(x.name)}</h1>${d.artist&&name==='album'?`<button class=\"v-text-button\" data-v=\"artist\" data-id=\"${d.artist.id}\">${esc(d.artist.name)}</button>`:''}<p class=\"v-sub\">${pageTracks.length} треков${releaseYear(x)?' · '+releaseYear(x):''}</p>${x.bio?`<p class=\"v-sub\">${esc(x.bio)}</p>`:''}${actions(pageTracks)}${name==='album'&&s.isAdmin?`<button class=\"v-button v-danger\" data-v=\"delete-album\" data-id=\"${x.id}\">${icon('trash')}Удалить альбом</button>`:''}${name==='playlist'&&currentPlaylist?.canDelete?`<button class=\"v-button v-danger\" data-v=\"delete-playlist\" data-id=\"${x.id}\">${icon('trash')}Удалить плейлист</button>`:''}</div>`+rows(pageTracks);}\n else if(name==='track')";
      s=s.replace(branch,newBranch);
    }

    s=must(s,
      "<label>Тип<select name=\"kind\"><option value=\"single\">Сингл</option><option value=\"album\">Альбом</option><option value=\"ep\">EP</option></select></label><label>Обложка до 8 МБ",
      "<label>Тип<select name=\"kind\"><option value=\"single\">Сингл</option><option value=\"album\">Альбом</option><option value=\"ep\">EP</option></select></label><label>Дата релиза<div class=\"v-date-line\"><input name=\"releaseDate\" type=\"date\" required><button class=\"v-text-button\" id=\"v-release-lookup\" type=\"button\">Найти автоматически</button></div></label><label>Обложка до 8 МБ",
      'upload release date field');

    {
      const before=s;
      s=s.replace(/else if\(\[([^\]]*'user'[^\]]*)\]\.includes\(act\)\)\{/,(_m,list)=>{
        let next=list;if(!next.includes("'artist-releases'"))next+=",'artist-releases','single-release'";return "else if(["+next+"].includes(act)){";
      });
      if(s===before)throw new Error('[release-system] target missing: navigation actions');
    }

    s=must(s,
      " else if(act==='follow-artist'){b.disabled=true;const d=await api('/api/artists/'+id+'/subscribe',{});b.textContent=d.subscribed?'Вы подписаны':'Подписаться';}",
      " else if(act==='artist-releases'){location.hash='artist-releases/'+id;}else if(act==='release-filter'){const k=b.dataset.filter||'',active=route.split('/')[2]||'';location.hash='artist-releases/'+id+(active===k?'':'/'+k);}\n else if(act==='follow-artist'){b.disabled=true;const d=await api('/api/artists/'+id+'/subscribe',{});b.textContent=d.subscribed?'Вы подписаны':'Подписаться';}",
      'release click handlers');

    s=must(s,
      " async function loadCatalog(){const [tracks,artists]=await Promise.all([api('/api/tracks'),api('/api/artists')]);s.tracks=remember(tracks.tracks||[]);s.artists=artists.artists||[];const byId=new Map();for(const t of s.tracks){if(!t.albumId)continue;let a=byId.get(t.albumId);if(!a){a={id:t.albumId,name:t.album,artist:s.artists.find(a=>a.id===t.artistId)?.name||t.artist,coverUrl:t.coverUrl,releaseType:t.releaseType,createdAt:t.createdAt};byId.set(t.albumId,a);}if(Date.parse(t.createdAt)>Date.parse(a.createdAt))a.createdAt=t.createdAt;}albums=[...byId.values()];}",
      " async function loadCatalog(){const [tracks,artists]=await Promise.all([api('/api/tracks'),api('/api/artists')]);s.tracks=remember(tracks.tracks||[]);s.artists=artists.artists||[];const byId=new Map();for(const t of s.tracks){if(!t.albumId)continue;let a=byId.get(t.albumId);if(!a){a={id:t.albumId,name:t.album,artist:s.artists.find(a=>a.id===t.artistId)?.name||t.artist,coverUrl:t.coverUrl,releaseType:t.releaseType,releaseDate:t.releaseDate||'',createdAt:t.createdAt};byId.set(t.albumId,a);}if(t.releaseDate&&!a.releaseDate)a.releaseDate=t.releaseDate;if(Date.parse(t.createdAt)>Date.parse(a.createdAt))a.createdAt=t.createdAt;}albums=[...byId.values()].sort((a,b)=>Date.parse(releaseStamp(b)||0)-Date.parse(releaseStamp(a)||0));}",
      'catalog release date');

    s=must(s,
      "s.user=result[1].status==='fulfilled'?result[1].value.user:null;s.isAdmin=!!s.user?.isAdmin;",
      "s.user=result[1].status==='fulfilled'?result[1].value.user:null;s.isAdmin=!!s.user?.isAdmin;if(s.isAdmin)setTimeout(()=>releaseDateBackfill(),2500);",
      'start backfill');

    const initAnchor=" async function initialize(){try{";
    s=must(s,initAnchor,
` async function releaseDateBackfill(){if(window.__venylReleaseBackfill||!s.isAdmin)return;window.__venylReleaseBackfill=true;try{for(let i=0;i<320;i++){if(!navigator.onLine)break;let d;try{d=await api('/api/admin/release-dates/backfill',{});}catch(e){if(e.status===409){await new Promise(r=>setTimeout(r,1500));continue;}break;}if(d.done)break;await new Promise(r=>setTimeout(r,1200));}await loadCatalog();if(route.startsWith('artist/'))navigate();}finally{window.__venylReleaseBackfill=false;}}
${initAnchor}`,'background backfill');
  }
  return s;
});

patch('client/mobile-upload.js',s=>{
  if(!s.includes('releaseDate:fields.releaseDate.value')){
    s=must(s,
      " const fields=form.elements,status=form.querySelector('[role=status]'),progress=form.querySelector('progress'),submit=form.querySelector('button[type=submit]');let file=null,row=null,embedded=null,pending=null,busy=false,scanId=0;",
      " const fields=form.elements,status=form.querySelector('[role=status]'),progress=form.querySelector('progress'),submit=form.querySelector('button[type=submit]');let file=null,row=null,embedded=null,pending=null,busy=false,scanId=0;const lookup=form.querySelector('#v-release-lookup');",
      'upload lookup button');
    s=must(s,
      "for(const key of ['title','artist','album','kind'])fields[key].value=row[key]||'';show('Теги прочитаны. Проверь название и артистов перед загрузкой.'+(embedded?' Встроенная обложка найдена.':''));",
      "for(const key of ['title','artist','album','kind'])fields[key].value=row[key]||'';show('Теги прочитаны. Ищем дату релиза…');try{const q=new URLSearchParams({title:fields.title.value,artist:fields.artist.value,album:fields.album.value});const found=await api('/api/metadata/release-date?'+q);if(found.date)fields.releaseDate.value=found.date;show(found.date?'Дата релиза найдена: '+found.date+'. Проверь данные перед загрузкой.':'Теги прочитаны. Дату релиза не нашли автоматически — укажи её вручную.'+(embedded?' Встроенная обложка найдена.':''),false);}catch{show('Теги прочитаны. Дату релиза укажи вручную.'+(embedded?' Встроенная обложка найдена.':''));}",
      'auto lookup after tags');
    s=must(s,
      "const metadata=cleanImportRow({...row,title:fields.title.value,artist:fields.artist.value,album:fields.album.value,kind:fields.kind.value});",
      "const metadata=cleanImportRow({...row,title:fields.title.value,artist:fields.artist.value,album:fields.album.value,kind:fields.kind.value,releaseDate:fields.releaseDate.value});",
      'submit release date');
    s=s.replace(" form.addEventListener('input',e=>{if(e.target!==fields.audio){pending=null;onDirty(true);}});",
      " if(lookup)lookup.onclick=async()=>{try{lookup.disabled=true;show('Ищем дату релиза…');const q=new URLSearchParams({title:fields.title.value,artist:fields.artist.value,album:fields.album.value});const found=await api('/api/metadata/release-date?'+q);if(found.date){fields.releaseDate.value=found.date;pending=null;onDirty(true);show('Дата найдена: '+found.date);}else show('Точную дату автоматически найти не удалось. Укажи её вручную.',true);}catch(e){show(e.message||'Не удалось найти дату.',true);}finally{lookup.disabled=false;}};\n form.addEventListener('input',e=>{if(e.target!==fields.audio){pending=null;onDirty(true);}});");
  }
  return s;
});

patch('public/assets/mobile/mobile.css',s=>{
 if(!s.includes('VENYL_RELEASE_SYSTEM_CSS_V1'))s+=String.raw`
/* VENYL_RELEASE_SYSTEM_CSS_V1 */
.v-release-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:12px}
.v-release-card{display:flex;flex-direction:column;gap:9px;text-align:left;border:0;background:transparent;color:var(--v-text);padding:0;min-width:0}
.v-release-art{width:100%;aspect-ratio:1;border-radius:12px;object-fit:cover;background:var(--v-surface)}
.v-release-card .v-copy b{font-size:15px;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.v-release-card .v-copy small{margin-top:4px;color:var(--v-secondary)}
.v-release-filters{display:flex;gap:8px;overflow-x:auto;padding:4px 0 18px;scrollbar-width:none}
.v-release-filters::-webkit-scrollbar{display:none}
.v-filter{flex:0 0 auto;border:1px solid var(--v-line);background:var(--v-surface);color:var(--v-text);border-radius:999px;padding:9px 15px;font-size:14px;font-weight:700}
.v-filter.active{background:var(--v-text);color:var(--v-bg);border-color:var(--v-text)}
.v-date-line{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px}
.v-date-line .v-text-button{white-space:nowrap}
@media(max-width:390px){.v-release-grid{gap:11px}.v-date-line{grid-template-columns:1fr}.v-date-line .v-text-button{text-align:left;padding-left:0}}
`;
 return s;
});

patch('lib/mobile-ui.js',s=>s
 .replace(/\/assets\/mobile\/mobile\.css\?v=[^"']+/g,'/assets/mobile/mobile.css?v=releases-1')
 .replace(/\/assets\/mobile\/app\.js\?v=[^"']+/g,'/assets/mobile/app.js?v=releases-1')
 .replace(/\/assets\/mobile\/upload\.js\?v=[^"']+/g,'/assets/mobile/upload.js?v=releases-1')
);

console.log('Release system installed.');
