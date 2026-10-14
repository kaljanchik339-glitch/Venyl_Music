import {readFileSync,writeFileSync} from 'node:fs';

function patch(path,fn){
  const before=readFileSync(path,'utf8');
  const after=fn(before);
  if(after===before)console.warn('[release-auth-fix] no change:',path);
  writeFileSync(path,after);
}

patch('lib/legacy.js',s=>{
  s=s.replace(
    "coverUrl: row.cover_path ? `/uploads/covers/${row.cover_path}` : '', releaseType:",
    "coverUrl: row.cover_path ? `/uploads/${row.cover_bucket==='albums'?'albums':'covers'}/${row.cover_path}` : '', releaseType:"
  );
  s=s.replace(
    "function mapAlbum(row){ return { id: row.id, artistId: row.artist_id, name: row.name, releaseType: row.release_type || '', releaseDate: row.release_date || '', description: row.description || '', coverUrl: row.cover_path ? `/uploads/albums/${row.cover_path}` : '', createdAt: row.created_at }; }",
    "function mapAlbum(row){ const bucket=row.cover_bucket==='covers'?'covers':'albums'; return { id: row.id, artistId: row.artist_id, name: row.name, releaseType: row.release_type || '', releaseDate: row.release_date || '', description: row.description || '', coverUrl: row.cover_path ? `/uploads/${bucket}/${row.cover_path}` : '', createdAt: row.created_at }; }"
  );
  return s;
});

patch('lib/smart-import.js',s=>{
  s=s.replace(
    "if(paths.cover){row.cover_path=paths.cover;if(t.kind==='single'||t.kind==='ep')album.cover_path=paths.cover;}",
    "if(paths.cover){row.cover_path=paths.cover;if(t.kind==='single'||t.kind==='ep'){album.cover_path=paths.cover;album.cover_bucket='covers';}}"
  );
  return s;
});

patch('lib/backend.js',s=>{
  s=s.replace(
    "album={id:nextAlbumId,artist_id:track.artist_id,name:track.title,cover_path:'',description:'',release_type:track.release_type||'single',release_date:releaseDate,created_at:track.created_at||new Date().toISOString()};",
    "album={id:nextAlbumId,artist_id:track.artist_id,name:track.title,cover_path:track.cover_path||'',cover_bucket:track.cover_path?'covers':'',description:'',release_type:track.release_type||'single',release_date:releaseDate,created_at:track.created_at||new Date().toISOString()};"
  );
  s=s.replace(
    "}else{\n    album.release_date=releaseDate;",
    "}else{\n    album.release_date=releaseDate;if(!album.cover_path&&track.cover_path){album.cover_path=track.cover_path;album.cover_bucket='covers';}"
  );
  return s;
});

patch('public/assets/mobile/app.js',s=>{
  s=s.replace(
    "coverUrl:a.coverUrl||first?.coverUrl||'',releaseType:releaseKind(a,n)",
    "coverUrl:(a.releaseType==='single'||a.releaseType==='ep')?(first?.coverUrl||a.coverUrl||''):(a.coverUrl||first?.coverUrl||''),releaseType:releaseKind(a,n)"
  );
  s=s.replace(
    "if(name==='album'&&!x.coverUrl&&pageTracks[0]?.coverUrl)x.coverUrl=pageTracks[0].coverUrl;",
    "if(name==='album'&&pageTracks[0]?.coverUrl&&(x.releaseType==='single'||x.releaseType==='ep'||!x.coverUrl))x.coverUrl=pageTracks[0].coverUrl;"
  );
  s=s.replace(
    "else if(act==='login-email'){b.hidden=true;if(authForm){authForm.hidden=false;authForm.dataset.mode='login';}$('v-auth-email')?.focus();return;}",
    "else if(act==='login-email'){location.assign('/email-login');return;}"
  );
  return s;
});

patch('lib/mobile-ui.js',s=>s
 .replace(/\/assets\/mobile\/app\.js\?v=[^"']+/g,'/assets/mobile/app.js?v=release-auth-fix-1')
);

console.log('Release covers + email auth routing fixed.');


// VENYL_R2_PLAYBACK_V1: serve migrated audio directly from Cloudflare R2.
// Supabase remains responsible for authentication, catalog and artwork.
patch('lib/legacy.js',s=>{
  const publicBase='https://pub-83b1a4dba0ee44ff829e3e405b0b1ea3.r2.dev';
  const old='audioUrl: \`/uploads/tracks/\${row.audio_path}\`';
  const replacement='audioUrl: row.audio_path ? '+JSON.stringify(publicBase)+' + \'/\' + String(row.audio_path).split(\'/\').map(encodeURIComponent).join(\'/\') : \'\'';
  if(!s.includes(old)&&!s.includes(replacement))throw new Error('[R2] audioUrl mapping not found');
  return s.replaceAll(old,replacement);
});
console.log('Cloudflare R2 playback URL configured.');


// VENYL_MOBILE_NATIVE_FEEL_V1: preserve visuals, suppress browser-only gestures.
patch('public/assets/mobile/mobile.css',css=>{
  if(css.includes('VENYL_MOBILE_NATIVE_FEEL_V1'))return css;
  return css+String.raw`
/* VENYL_MOBILE_NATIVE_FEEL_V1 */
html{-webkit-text-size-adjust:100%;overscroll-behavior-y:none;}
body{-webkit-touch-callout:none;overscroll-behavior-y:none;}
img,svg{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-user-drag:none;}
button,a,[role="button"],.v-mini-meta{-webkit-tap-highlight-color:transparent;touch-action:manipulation;}
input,textarea,[contenteditable="true"]{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default;}
`;
});
patch('public/assets/mobile/app.js',js=>{
  if(js.includes('VENYL_MOBILE_NATIVE_FEEL_V1'))return js;
  return js+String.raw`
// VENYL_MOBILE_NATIVE_FEEL_V1
(()=> {
  // Prevent iOS double-tap zoom without blocking normal scrolling or controls.
  let lastTouch=0;
  document.addEventListener('touchend',e=>{
    const t=e.target;
    if(t?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    const now=Date.now();
    if(now-lastTouch<300 && e.cancelable)e.preventDefault();
    lastTouch=now;
  },{passive:false});
  // Prevent long-press image download menus; keep links and text inputs usable.
  document.addEventListener('contextmenu',e=>{
    if(e.target?.closest?.('img,svg'))e.preventDefault();
  });

})();
`;
});
patch('lib/mobile-ui.js',s=>s
 .replace(/\/assets\/mobile\/mobile\.css\?v=[^"']+/g,'/assets/mobile/mobile.css?v=native-feel-1')
 .replace(/\/assets\/mobile\/app\.js\?v=[^"']+/g,'/assets/mobile/app.js?v=native-feel-1')
);
console.log('Venyl mobile native-feel enhancements applied.');


// VENYL_ARCHIVE_MERGE_20261009_V1
// Non-destructive port of the archived iOS audio-file chooser and PWA metadata.
// Existing catalog, R2 audio mapping, login and UI remain authoritative.
patch('public/assets/mobile/app.js',js=>{
  const accept='.mp3,.m4a,.wav,.flac,.ogg,.opus,.aac,.aif,.aiff,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/flac';
  return js.replace(/(<input\b[^>]*\bname=["']audio["'][^>]*\btype=["']file["'][^>]*\baccept=["'])audio\/\*(['"])/g,'$1'+accept+'$2')
           .replace(/(<input\b[^>]*\btype=["']file["'][^>]*\bname=["']audio["'][^>]*\baccept=["'])audio\/\*(['"])/g,'$1'+accept+'$2');
});
console.log('Archived iPhone audio file chooser merged without replacing current Venyl.');




// VENYL_MEDIA_SESSION_STABILITY_V3
// The real playback controller owns Media Session. Avoid competing observers,
// multiple action handlers, and 4+ position updates per second.
patch('public/assets/mobile/playback.js',js=>{
  const original="audio.addEventListener('timeupdate',()=>{sample();changed(false);metadata();});";
  if(!js.includes(original))throw new Error('[MediaSession] playback timeupdate hook changed');
  js=js.replace(original,"audio.addEventListener('timeupdate',()=>{sample();changed(false);});");
  const old="function metadata(){if(!('mediaSession'in navigator)||!state.currentTrack)return;";
  if(!js.includes(old))throw new Error('[MediaSession] metadata function changed');
  const begin=js.indexOf(old);
  const end=js.indexOf('\n function play(',begin);
  if(end<0)throw new Error('[MediaSession] play function not found');
  const replacement=String.raw`let lastMediaTrackId=null,lastMediaCover='',lastMediaPosition=-1;
 function metadata(){
  if(!('mediaSession' in navigator)||!state.currentTrack)return;
  const t=state.currentTrack,ms=navigator.mediaSession;
  const cover=t.coverUrl?new URL(t.coverUrl,location.href).href:'';
  if(lastMediaTrackId!==t.id||lastMediaCover!==cover){
   try{ms.metadata=new MediaMetadata({title:t.title||'Venyl',artist:t.artist||'',album:t.album||'',artwork:cover?[{src:cover}]:[]});lastMediaTrackId=t.id;lastMediaCover=cover;}catch(e){console.warn('[Venyl] Now Playing metadata',e);}
  }
  try{ms.playbackState=audio.paused?'paused':'playing';}catch{}
  if(Number.isFinite(audio.duration)&&audio.duration>0&&ms.setPositionState){
   const pos=Math.max(0,Math.min(audio.duration,audio.currentTime||0));
   if(lastMediaPosition<0||Math.abs(pos-lastMediaPosition)>10||audio.paused){
    try{ms.setPositionState({duration:audio.duration,playbackRate:audio.playbackRate||1,position:pos});lastMediaPosition=pos;}catch{}
   }
  }
 }`;
  js=js.slice(0,begin)+replacement+js.slice(end);
  js=js.replace("audio.addEventListener('seeking',()=>{","audio.addEventListener('seeking',()=>{lastMediaPosition=-1;");
  js=js.replace("audio.addEventListener('seeked',()=>{","audio.addEventListener('seeked',()=>{lastMediaPosition=-1;metadata();");
  return js;
});
patch('lib/mobile-ui.js',s=>s.replace(/\/assets\/mobile\/app\.js\?v=[^"']+/g,'/assets/mobile/app.js?v=ios-stable-3'));
console.log('Single-owner Media Session; redundant observers and position update storm removed.');
