import {readFileSync,writeFileSync} from 'node:fs';

function patch(path,fn){
  const before=readFileSync(path,'utf8');
  const after=fn(before);
  if(after===before)console.warn('[player-release-links] no change:',path);
  writeFileSync(path,after);
}

patch('public/assets/mobile/app.js',s=>{
  if(!s.includes('VENYL_FULL_PLAYER_META_LINKS_V1')){
    const anchor="document.addEventListener('click',click);";
    if(!s.includes(anchor))throw new Error('[player-release-links] click anchor missing');
    const extra=anchor+`
// VENYL_FULL_PLAYER_META_LINKS_V1
(()=>{
  const player=$('v-player');
  if(!player)return;
  const norm=v=>String(v||'').replace(/\\s+/g,' ').trim().toLocaleLowerCase('ru');
  player.addEventListener('click',e=>{
    if(player.hidden)return;
    if(e.target.closest('input,button,a'))return;
    const textEl=e.target.closest('h1,h2,h3,h4,p,b,strong,small,span');
    if(!textEl)return;
    const t=s.currentTrack;
    if(!t)return;
    const txt=norm(textEl.textContent);
    const title=norm(t.title);
    const artist=norm(t.artist);
    if(!txt||(!title&&!artist))return;
    if(txt!==title && txt!==artist && !artist.split(',').some(a=>a.trim()&&txt===a.trim()))return;
    e.preventDefault();
    e.stopPropagation();
    const artists=(t.artists||[{id:t.artistId,name:t.artist}]).filter(a=>a&&a.id);
    const artistLinks=artists.map(a=>link('artist',a.name,artists.length>1?'Участник трека':'Артист','user',\`data-id="\${a.id}"\`)).join('');
    let releaseLink='';
    if(t.albumId){
      const kind=t.releaseType==='single'?'Сингл':t.releaseType==='ep'?'EP':'Альбом';
      releaseLink=link('album',t.album||t.title,kind,'music',\`data-id="\${t.albumId}"\`);
    }else{
      releaseLink=link('single-release',t.title,'Сингл','music',\`data-id="\${t.id}"\`);
    }
    sheet('Открыть',artistLinks+releaseLink);
  },true);
})();
`;
    s=s.replace(anchor,extra);
  }
  return s;
});

patch('public/assets/mobile/mobile.css',s=>{
  if(!s.includes('VENYL_FULL_PLAYER_META_LINKS_V1'))s+=`
/* VENYL_FULL_PLAYER_META_LINKS_V1 */
#v-player h1,#v-player h2,#v-player h3,#v-player h4,#v-player p,#v-player b,#v-player strong,#v-player small{cursor:pointer}
`;
  return s;
});

patch('lib/smart-import.js',s=>{
  if(!s.includes('VENYL_SINGLE_EP_RELEASE_COVER_V1')){
    const marker="const row={id:nextId(db,'tracks'),title:t.title,artist:artists.map(a=>a.name).join(', '),artist_id:artists[0].id,album:album.name,album_id:album.id,genre:t.genre,play_count:0,cover_path:album.cover_path||'',audio_path:paths.audio,duration_seconds:t.duration,track_number:t.trackNumber,disc_number:t.discNumber,uploaded_by_user_id:userId,import_hash:t.hash,release_type:t.kind,release_date:t.releaseDate||'',created_at:now};";
    if(!s.includes(marker))throw new Error('[player-release-links] smart import row marker missing');
    s=s.replace(marker,marker+"\n // VENYL_SINGLE_EP_RELEASE_COVER_V1\n if(paths.cover){row.cover_path=paths.cover;if(t.kind==='single'||t.kind==='ep')album.cover_path=paths.cover;}");
  }
  return s;
});

patch('lib/mobile-ui.js',s=>s
 .replace(/\/assets\/mobile\/mobile\.css\?v=[^"']+/g,'/assets/mobile/mobile.css?v=full-meta-links-1')
 .replace(/\/assets\/mobile\/app\.js\?v=[^"']+/g,'/assets/mobile/app.js?v=full-meta-links-1')
);

console.log('Fullscreen metadata links + single/EP release-cover sync installed.');