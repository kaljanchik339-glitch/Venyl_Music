
const BASE='';
const state={tracks:[],filtered:[],artists:[],currentArtist:null,currentIdx:-1,currentTrack:null,isPlaying:false,favorites:new Set(JSON.parse(localStorage.getItem('venyl_favorites')||'[]')),genres:new Set(),user:null,isAdmin:false,albumFiles:[]};
const audio=qs('audioEl');

function qs(id){return document.getElementById(id)}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtTime(s){s=Number(s||0);return Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0')}
function saveFavs(){localStorage.setItem('venyl_favorites',JSON.stringify([...state.favorites]))}
async function api(url,options={}){const res=await fetch(BASE+url,{credentials:'include',...options});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Ошибка запроса');return data}

let toastTimer;
function toast(msg,type=''){
  const el=qs('toast');
  el.textContent=msg;
  el.className='toast show'+(type?' '+type:'');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),2800);
}

function updateUserUI(){
  qs('sidebarName').textContent=state.user?state.user.name:'Гость';
  qs('sidebarEmail').textContent=state.user?state.user.email:'Нажми чтобы войти';
  const initials=state.user?((state.user.name||'U').split(/\s+/).filter(Boolean).slice(0,2).map(v=>(v[0]||'').toUpperCase()).join('')||'U'):'GU';
  qs('avatarInitials').textContent=initials;
  document.querySelectorAll('.admin-only').forEach(el=>el.style.display=state.isAdmin?'flex':'none');
}
async function loadSession(){try{const data=await api('/api/auth/me');state.user=data.user||null;state.isAdmin=!!data.user?.isAdmin}catch{state.user=null;state.isAdmin=false}updateUserUI()}
async function loadTracks(){const data=await api('/api/tracks').catch(()=>({tracks:[]}));state.tracks=Array.isArray(data.tracks)?data.tracks:[];state.filtered=[...state.tracks];renderGenres();renderTracks();updatePlayerMeta()}
async function loadArtists(){const data=await api('/api/artists').catch(()=>({artists:[]}));state.artists=data.artists||[];renderArtists();renderArtistSelect()}

function renderGenres(){
  state.genres.clear();
  state.tracks.forEach(t=>{if(t.genre)t.genre.split(',').forEach(g=>state.genres.add(g.trim()))});
  qs('genreGrid').innerHTML='<div class="genre-chip active" onclick="filterByGenre(null,this)">Все</div>'+[...state.genres].filter(Boolean).map(g=>`<div class="genre-chip" onclick='filterByGenre(${JSON.stringify(g)},this)'>${esc(g)}</div>`).join('');
}

function renderArtists(){
  const grid=qs('artistGrid');
  if(!state.artists.length){grid.innerHTML='<div style="color:var(--muted)">Артистов пока нет</div>';return}
  grid.innerHTML=state.artists.map(a=>`
    <div class="artist-pill" onclick="openArtistProfile(${a.id})">
      <div class="artist-pill-avatar">${a.photoUrl?`<img src="${a.photoUrl}" alt="">`:esc((a.name||'?')[0].toUpperCase())}</div>
      <span class="artist-pill-name">${esc(a.name)}</span>
      <span class="artist-pill-count">· ${a.trackCount||0}</span>
    </div>`).join('');
}

function renderArtistSelect(){
  const sel=qs('albumArtistSelect');if(!sel)return;
  sel.innerHTML=state.artists.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('');
}

function filterByGenre(g,el){
  document.querySelectorAll('.genre-chip').forEach(c=>c.classList.remove('active'));
  if(el)el.classList.add('active');
  state.filtered=g?state.tracks.filter(t=>(t.genre||'').includes(g)):[...state.tracks];
  renderTracks();
}

function filterTracks(){
  const q=(qs('searchInput').value||'').toLowerCase().trim();
  state.filtered=state.tracks.filter(t=>!q||(t.title||'').toLowerCase().includes(q)||(t.artist||'').toLowerCase().includes(q)||(t.album||'').toLowerCase().includes(q)||(t.genre||'').toLowerCase().includes(q));
  renderTracks();
}

function renderTracks(list=state.filtered,targetId='tracksList'){
  const listEl=qs(targetId);if(!listEl)return;
  if(targetId==='tracksList')qs('trackCount').textContent=list.length+' треков';
  if(!list.length){
    listEl.innerHTML=`<div class="empty-state"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/></svg><p>Треки не найдены</p></div>`;
    return;
  }
  listEl.innerHTML=list.map((t,i)=>{
    const isPlay=state.currentTrack&&state.currentTrack.id===t.id;
    return `<div class="track-row${isPlay?' playing':''}" onclick="playTrackFromList(${i},'${targetId}')">
      <div class="track-num">${isPlay?'<div class="eq-bars" style="margin:auto"><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div></div>':i+1}</div>
      <div class="track-cover">${t.coverUrl?`<img src="${t.coverUrl}" alt="">`:'<div class="cover-fallback"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/></svg></div>'}</div>
      <div class="track-info"><div class="track-name">${esc(t.title)}</div><div class="track-artist" onclick="event.stopPropagation();if(${t.artistId||0})openArtistProfile(${t.artistId||0})">${esc(t.artist)}</div></div>
      <div class="track-album-cell">${esc(t.album)}</div>
      <div>${t.genre?`<span class="track-genre-pill">${esc(t.genre.split(',')[0].trim())}</span>`:''}</div>
      <div class="track-actions" onclick="event.stopPropagation()">
        <div class="icon-btn${state.favorites.has(t.id)?' active':''}" onclick="toggleFav(${t.id})" title="В избранное" style="${state.favorites.has(t.id)?'color:var(--red);border-color:rgba(224,82,82,0.3)':''}">
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"/></svg>
        </div>
        ${state.isAdmin?`<div class="icon-btn" onclick="editTrack(${t.id})" title="Редактировать"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg></div><div class="icon-btn danger" onclick="deleteTrack(${t.id})" title="Удалить"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg></div>`:''}</div></div>`;
  }).join('');
}

function getCurrentList(targetId){if(targetId==='artistTracksList'&&state.currentArtist)return state.currentArtist.tracks;return state.filtered}
function playTrackFromList(idx,targetId){const list=getCurrentList(targetId);playTrackObject(list[idx],idx,list)}
function playTrackObject(t,idx,list){
  if(!t)return;
  state.currentIdx=idx;state.currentTrack=t;state.playList=list||state.filtered;
  updatePlayerMeta();
  if(t.audioUrl){
    audio.src=t.audioUrl;
    audio.play().then(()=>{state.isPlaying=true;updatePlayBtn();qs('eqBars').style.display='flex';renderTracks();if(state.currentArtist)renderTracks(state.currentArtist.tracks,'artistTracksList')})
    .catch(()=>{state.isPlaying=false;updatePlayBtn();toast('Не удалось воспроизвести трек','err')});
  }
}
function updatePlayerMeta(){
  const t=state.currentTrack;
  qs('npCover').innerHTML=t?(t.coverUrl?`<img src="${t.coverUrl}" style="width:100%;height:100%;object-fit:cover">`:'<svg viewBox="0 0 20 20" fill="currentColor"><path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/></svg>'):'';
  qs('npTitle').textContent=t?t.title:'Выберите трек';
  qs('npArtist').textContent=t?(t.artist||'—'):'—';
}
function togglePlay(){
  if(!state.currentTrack){if(state.filtered[0])playTrackObject(state.filtered[0],0,state.filtered);return}
  if(state.isPlaying){audio.pause();state.isPlaying=false;qs('eqBars').style.display='none'}
  else{audio.play().catch(()=>{});state.isPlaying=true;qs('eqBars').style.display='flex'}
  updatePlayBtn();
}
function updatePlayBtn(){
  qs('playIcon').innerHTML=state.isPlaying
    ?'<rect x="5" y="3" width="4" height="14" rx="1"/><rect x="11" y="3" width="4" height="14" rx="1"/>'
    :'<polygon points="4,3 17,10 4,17"/>';
}
function nextTrack(){const l=state.playList||state.filtered;if(!l.length)return;const i=(state.currentIdx+1)%l.length;playTrackObject(l[i],i,l)}
function prevTrack(){const l=state.playList||state.filtered;if(!l.length)return;const i=(state.currentIdx-1+l.length)%l.length;playTrackObject(l[i],i,l)}
function shuffle(){if(!state.filtered.length)return;const i=Math.floor(Math.random()*state.filtered.length);playTrackObject(state.filtered[i],i,state.filtered);toast('Перемешано')}
function toggleRepeat(){audio.loop=!audio.loop;qs('repeatBtn').classList.toggle('active',audio.loop);toast(audio.loop?'Повтор включён':'Повтор выключен')}
function playRandom(){shuffle()}
function seekTo(e){if(!audio.duration)return;const r=qs('progBar').getBoundingClientRect();audio.currentTime=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*audio.duration}
function setVolume(v){audio.volume=Number(v)/100}

audio.addEventListener('timeupdate',()=>{if(!audio.duration)return;qs('progFill').style.width=(audio.currentTime/audio.duration*100)+'%';qs('curTime').textContent=fmtTime(audio.currentTime);qs('durTime').textContent=fmtTime(audio.duration)});
audio.addEventListener('ended',nextTrack);
audio.addEventListener('play',()=>{state.isPlaying=true;qs('eqBars').style.display='flex';updatePlayBtn()});
audio.addEventListener('pause',()=>{state.isPlaying=false;qs('eqBars').style.display='none';updatePlayBtn()});

function toggleFav(id){
  if(!id)return;
  if(state.favorites.has(id))state.favorites.delete(id);
  else{state.favorites.add(id);toast('В избранном','ok')}
  saveFavs();renderTracks();if(state.currentArtist)renderTracks(state.currentArtist.tracks,'artistTracksList');
}
function toggleFavCurrent(){if(state.currentTrack)toggleFav(state.currentTrack.id)}

async function deleteTrack(id){
  if(!state.isAdmin)return toast('Удаление доступно только админу','err');
  if(!confirm('Удалить этот трек для всех?'))return;
  await api('/api/tracks/'+id,{method:'DELETE'}).then(async()=>{toast('Трек удалён');await loadTracks();await loadArtists();if(state.currentArtist)openArtistProfile(state.currentArtist.artist.id)}).catch(e=>toast(e.message||'Не удалось удалить трек','err'));
}

function openUpload(){if(!state.isAdmin)return toast('Загрузка доступна только админу','err');qs('uploadModal').classList.add('open')}
function closeUpload(){qs('uploadModal').classList.remove('open')}
function handleAudio(e){const f=e.target.files[0];if(f){qs('uploadTitle').value=f.name.replace(/\.[^.]+$/,'');qs('audioDrop').querySelector('.drop-text').innerHTML=`<span class="file-name">${esc(f.name)}</span>`;qs('audioDrop').classList.add('has-file')}}
async function submitUpload(){
  if(!state.isAdmin)return;
  const fd=new FormData();
  const title=qs('uploadTitle').value.trim(),artist=qs('uploadArtist').value.trim(),album=qs('uploadAlbum').value.trim(),genre=qs('uploadGenre').value.trim(),audioFile=qs('audioFile').files[0],cover=qs('coverFile').files[0];
  if(!title)return toast('Введи название','err');if(!artist)return toast('Введи артиста','err');if(!audioFile)return toast('Выбери аудио','err');
  fd.append('audio',audioFile);fd.append('title',title);fd.append('artist',artist);
  if(album)fd.append('album',album);if(genre)fd.append('genre',genre);if(cover)fd.append('cover',cover);
  try{
    const r=await fetch('/api/tracks/upload',{method:'POST',body:fd,credentials:'include'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||'Ошибка загрузки');
    toast('Трек загружен','ok');closeUpload();
    ['audioFile','coverFile','uploadTitle','uploadArtist','uploadAlbum','uploadGenre'].forEach(id=>qs(id).value='');
    qs('audioDrop').querySelector('.drop-text').innerHTML='Нажми или перетащи <span>MP3, WAV, FLAC</span>';
    qs('audioDrop').classList.remove('has-file');
    await loadTracks();await loadArtists();
  }catch(e){toast(e.message||'Ошибка загрузки','err')}
}

async function openArtistProfile(id){
  if(!id)return toast('Профиль артиста не найден','err');
  try{
    const data=await api('/api/artists/'+id);
    state.currentArtist=data;
    qs('homeView').style.display='none';
    qs('artistProfileView').style.display='block';
    const a=data.artist;
    qs('artistProfileView').innerHTML=`
      <div class="artist-profile-hero">
        <div class="artist-profile-deco"></div>
        <div class="artist-photo-wrap">
          <div class="artist-photo">${a.photoUrl?`<img src="${a.photoUrl}" alt="">`:'<span style="font-size:40px">${esc((a.name||'?')[0])}</span>'}</div>
          <div class="artist-verified"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></div>
        </div>
        <div class="artist-meta">
          <div class="artist-badge">Профиль артиста</div>
          <div class="artist-name">${esc(a.name)}</div>
          <div class="artist-stats">
            <div class="artist-stat"><div class="artist-stat-val">${data.tracks.length}</div><div class="artist-stat-label">Треков</div></div>
            <div class="artist-stat"><div class="artist-stat-val">${data.albums.length}</div><div class="artist-stat-label">Альбомов</div></div>
          </div>
          <div class="artist-bio">${esc(a.bio||'Биография пока не добавлена.')}</div>
          <div class="profile-actions">
            ${state.isAdmin?`<button class="btn-primary" onclick="openArtistEdit(${a.id})"><svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>Редактировать</button><button class="btn-ghost" onclick="openArtistTrackModal(${a.id})">+ Трек</button><button class="btn-ghost" onclick="openAlbumModal(${a.id})">+ Альбом</button><button class="btn-ghost" style="color:var(--red);border-color:rgba(224,82,82,0.2)" onclick="deleteArtist(${a.id})">Удалить</button>`:''}<button class="btn-ghost" onclick="backHome()">← Назад</button>
          </div>
        </div>
      </div>
      ${data.albums.length?`
      <div class="mb-section">
        <div class="section-head"><div class="section-title">Альбомы</div><span style="font-size:12px;color:var(--muted)">${data.albums.length}</span></div>
        <div class="albums-grid">
          ${data.albums.map(al=>`
            <div class="album-card" onclick="filterArtistAlbum(${JSON.stringify(al.name)})">
              <div class="album-cover">${al.coverUrl?`<img src="${al.coverUrl}" alt="">`:'<div class="album-cover-placeholder"><svg width="32" height="32" viewBox="0 0 20 20" fill="currentColor" style="color:var(--muted);opacity:.4"><path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z"/></svg></div>'}</div>
              <div><div class="album-card-name">${esc(al.name)}</div>${al.description?`<div class="album-card-desc">${esc(al.description)}</div>`:''}</div>
              ${state.isAdmin?`<div class="album-card-actions"><div class="icon-btn" onclick="event.stopPropagation();editAlbum(${al.id})"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg></div><div class="icon-btn danger" onclick="event.stopPropagation();deleteAlbum(${al.id})"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg></div></div>`:''}
            </div>`).join('')}
        </div>
      </div>`:''}
      <div class="mb-section">
        <div class="section-head">
          <div class="section-title">Треки артиста</div>
          <span style="font-size:12px;color:var(--muted)">${data.tracks.length} треков</span>
        </div>
        <div class="tracks-header">
          <div class="tracks-col" style="text-align:center">#</div>
          <div></div>
          <div class="tracks-col">Название</div>
          <div class="tracks-col">Альбом</div>
          <div class="tracks-col">Жанр</div>
          <div></div>
        </div>
        <div class="tracks-list" id="artistTracksList"></div>
      </div>`;
    const initialName=a.name;
    const firstChar=esc((a.name||'?')[0].toUpperCase());
    qs('artistProfileView').querySelector('.artist-photo').innerHTML=a.photoUrl?`<img src="${a.photoUrl}" alt="">`:`<span style="font-family:'Instrument Serif',serif;font-size:40px;color:var(--accent)">${firstChar}</span>`;
    renderTracks(data.tracks,'artistTracksList');
  }catch(e){toast(e.message||'Не удалось открыть профиль','err')}
}

function filterArtistAlbum(name){if(!state.currentArtist)return;renderTracks(state.currentArtist.tracks.filter(t=>t.album===name),'artistTracksList')}
function backHome(){qs('artistProfileView').style.display='none';qs('homeView').style.display='block'}

function openArtistEdit(id=null){
  if(!state.isAdmin)return toast('Только для админа','err');
  qs('artistEditId').value=id||'';
  qs('artistEditTitle').textContent=id?'Редактировать артиста':'Новый артист';
  qs('artistEditName').value='';qs('artistEditBio').value='';qs('artistPhotoFile').value='';
  if(id&&state.currentArtist){qs('artistEditName').value=state.currentArtist.artist.name||'';qs('artistEditBio').value=state.currentArtist.artist.bio||''}
  qs('artistEditModal').classList.add('open');
}
function closeArtistEdit(){qs('artistEditModal').classList.remove('open')}
async function saveArtistProfile(){
  const id=qs('artistEditId').value,name=qs('artistEditName').value.trim(),bio=qs('artistEditBio').value.trim(),photo=qs('artistPhotoFile').files[0];
  if(!name)return toast('Введи имя артиста','err');
  const fd=new FormData();fd.append('name',name);fd.append('bio',bio);if(photo)fd.append('photo',photo);
  try{
    const url=id?'/api/artists/'+id:'/api/artists',method=id?'PUT':'POST';
    const r=await fetch(url,{method,body:fd,credentials:'include'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||'Ошибка сохранения');
    toast('Профиль сохранён','ok');closeArtistEdit();await loadArtists();await loadTracks();if(id)openArtistProfile(id);
  }catch(e){toast(e.message||'Не удалось сохранить','err')}
}
async function deleteArtist(id){
  if(!state.isAdmin)return;
  if(!confirm('Удалить профиль артиста и все его треки/альбомы?'))return;
  try{await api('/api/artists/'+id,{method:'DELETE'});toast('Профиль артиста удалён');backHome();await loadTracks();await loadArtists()}
  catch(e){toast(e.message||'Не удалось удалить профиль','err')}
}

function openArtistTrackModal(id){
  if(!state.isAdmin)return;
  qs('artistTrackArtistId').value=id;
  ['artistAudioFile','artistCoverFile','artistTrackTitle','artistTrackAlbum','artistTrackGenre','artistTrackFeatured'].forEach(x=>qs(x).value='');
  qs('artistTrackModal').classList.add('open');
}
function closeArtistTrackModal(){qs('artistTrackModal').classList.remove('open')}
function handleArtistAudio(e){const f=e.target.files[0];if(f)qs('artistTrackTitle').value=f.name.replace(/\.[^.]+$/,'')}
async function submitArtistTrack(){
  const id=qs('artistTrackArtistId').value,title=qs('artistTrackTitle').value.trim(),audioFile=qs('artistAudioFile').files[0];
  if(!title)return toast('Введи название','err');if(!audioFile)return toast('Выбери аудио','err');
  const fd=new FormData();fd.append('audio',audioFile);fd.append('title',title);fd.append('album',qs('artistTrackAlbum').value.trim());fd.append('genre',qs('artistTrackGenre').value.trim());fd.append('featured_artists',qs('artistTrackFeatured').value.trim());
  const cover=qs('artistCoverFile').files[0];if(cover)fd.append('cover',cover);
  try{
    const r=await fetch('/api/artists/'+id+'/tracks/upload',{method:'POST',body:fd,credentials:'include'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||'Ошибка');
    toast('Трек добавлен','ok');closeArtistTrackModal();await loadTracks();await loadArtists();openArtistProfile(id);
  }catch(e){toast(e.message||'Не удалось добавить трек','err')}
}

function openAlbumModal(artistId=null){
  if(!state.isAdmin)return toast('Только для админа','err');
  state.albumFiles=[];renderAlbumTracksMeta();renderArtistSelect();
  if(artistId)qs('albumArtistSelect').value=String(artistId);
  ['albumName','albumDescription','albumCoverFile','albumAudioFiles'].forEach(id=>qs(id).value='');
  qs('albumModal').classList.add('open');
}
function closeAlbumModal(){qs('albumModal').classList.remove('open')}
function handleAlbumFiles(e){state.albumFiles=[...e.target.files];renderAlbumTracksMeta()}
function renderAlbumTracksMeta(){
  const box=qs('albumTracksMeta');if(!state.albumFiles.length){box.innerHTML='';return}
  box.innerHTML='<div class="form-label" style="margin:16px 0 10px">Метаданные треков</div>'+
    state.albumFiles.map((f,i)=>`<div style="background:var(--ink3);border:1px solid var(--wire);border-radius:var(--r);padding:12px;margin-bottom:8px">
      <div style="font-size:12px;color:var(--muted2);margin-bottom:8px;font-weight:600">${esc(f.name)}</div>
      <div class="form-row"><input class="form-input album-track-title" data-index="${i}" placeholder="Название трека" value="${esc(f.name.replace(/\.[^.]+$/,''))}"><input class="form-input album-track-genre" data-index="${i}" placeholder="Жанр"></div>
      <input class="form-input album-track-artists" data-index="${i}" placeholder="Фиты через запятую" style="margin-top:8px;width:100%">
    </div>`).join('');
}
async function submitAlbum(){
  if(!state.isAdmin)return;
  const artistId=qs('albumArtistSelect').value,name=qs('albumName').value.trim(),description=qs('albumDescription').value.trim();
  if(!artistId)return toast('Выбери артиста','err');if(!name)return toast('Введи название альбома','err');if(!state.albumFiles.length)return toast('Добавь треки','err');
  const fd=new FormData();fd.append('name',name);fd.append('description',description);
  const cover=qs('albumCoverFile').files[0];if(cover)fd.append('album_cover',cover);
  state.albumFiles.forEach(f=>fd.append('audios',f));
  const titles=[...document.querySelectorAll('.album-track-title')].map((el,i)=>({title:el.value.trim()||state.albumFiles[i].name.replace(/\.[^.]+$/,''),genre:(document.querySelectorAll('.album-track-genre')[i]?.value||'').trim(),artists:(document.querySelectorAll('.album-track-artists')[i]?.value||'').trim()}));
  fd.append('tracks_meta',JSON.stringify(titles));
  try{
    const r=await fetch('/api/artists/'+artistId+'/albums/create',{method:'POST',body:fd,credentials:'include'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||'Не удалось создать альбом');
    toast('Альбом создан','ok');closeAlbumModal();await loadTracks();await loadArtists();openArtistProfile(Number(artistId));
  }catch(e){toast(e.message||'Не удалось создать альбом','err')}
}

async function editTrack(id){
  const t=state.tracks.find(x=>x.id===id)||(state.currentArtist?.tracks||[]).find(x=>x.id===id);if(!t)return;
  const title=prompt('Название трека',t.title);if(title===null)return;
  const artist=prompt('Артисты через запятую',t.artist||'');if(artist===null)return;
  const album=prompt('Альбом',t.album||'');if(album===null)return;
  const genre=prompt('Жанр',t.genre||'');if(genre===null)return;
  try{
    await api('/api/tracks/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,artist,album,genre})});
    toast('Трек обновлён','ok');await loadTracks();await loadArtists();if(state.currentArtist)openArtistProfile(state.currentArtist.artist.id);
  }catch(e){toast(e.message||'Не удалось обновить трек','err')}
}
async function editAlbum(id){
  const al=state.currentArtist?.albums?.find(x=>x.id===id);if(!al)return;
  const name=prompt('Название альбома',al.name);if(name===null)return;
  const description=prompt('Описание альбома',al.description||'');if(description===null)return;
  const fd=new FormData();fd.append('name',name);fd.append('description',description);
  try{
    const r=await fetch('/api/albums/'+id,{method:'PUT',body:fd,credentials:'include'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||'Не удалось обновить альбом');
    toast('Альбом обновлён','ok');await loadTracks();await loadArtists();if(state.currentArtist)openArtistProfile(state.currentArtist.artist.id);
  }catch(e){toast(e.message||'Не удалось обновить альбом','err')}
}
async function deleteAlbum(id){
  if(!confirm('Удалить альбом? Треки останутся, но без альбома.'))return;
  try{
    await api('/api/albums/'+id,{method:'DELETE'});
    toast('Альбом удалён');await loadTracks();await loadArtists();if(state.currentArtist)openArtistProfile(state.currentArtist.artist.id);
  }catch(e){toast(e.message||'Не удалось удалить альбом','err')}
}

function showLogin(){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));qs('loginPage').classList.add('active')}
function showRegister(){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));qs('registerPage').classList.add('active')}
function showApp(){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));qs('app').classList.add('active')}
async function doLogin(){
  try{await api('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:qs('loginEmail').value.trim(),password:qs('loginPass').value})});await loadSession();showApp();toast('Добро пожаловать!','ok')}
  catch(e){toast(e.message||'Неверный email или пароль','err')}
}
async function doRegister(){
  try{const data=await api('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:qs('registerName').value.trim(),email:qs('registerEmail').value.trim(),password:qs('registerPass').value})});toast(data.message||'Проверь почту','ok');showLogin()}
  catch(e){toast(e.message||'Не удалось зарегистрироваться','err')}
}
async function logout(){try{await api('/api/auth/logout',{method:'POST'})}catch{}state.user=null;state.isAdmin=false;updateUserUI();toast('Ты вышел из аккаунта')}
function handleSidebarUserClick(){if(state.user){if(confirm('Выйти из аккаунта?'))logout()}else showLogin()}

function showSection(s,el){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(el)el.classList.add('active');
  backHome();
  if(s==='favorites'){state.filtered=state.tracks.filter(t=>state.favorites.has(t.id));qs('trackCount').textContent=state.filtered.length+' в избранном';renderTracks();return}
  if(s==='artists'){toast('Раздел артистов — нажми на имя в списке');return}
  state.filtered=[...state.tracks];renderTracks();
}

document.addEventListener('DOMContentLoaded',async()=>{
  setVolume(qs('volSlider').value);
  await loadSession();await loadTracks();await loadArtists();
});
