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
