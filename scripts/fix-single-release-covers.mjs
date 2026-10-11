import {readFileSync,writeFileSync} from 'node:fs';

function patch(path,fn){
  const before=readFileSync(path,'utf8');
  writeFileSync(path,fn(before));
}

patch('public/assets/mobile/app.js', s => {
  if(!s.includes('VENYL_RELEASE_COVER_FALLBACK_V1')){
    s += `

// VENYL_RELEASE_COVER_FALLBACK_V1
(()=>{
  const ALBUM_MARK='/storage/v1/object/public/albums/';
  const COVER_MARK='/storage/v1/object/public/covers/';

  document.addEventListener('error',e=>{
    const img=e.target;
    if(!(img instanceof HTMLImageElement))return;
    const src=img.currentSrc||img.src||'';
    if(!src.includes(ALBUM_MARK))return;
    if(img.dataset.venylCoverFallback==='1')return;

    // Legacy single releases kept their artwork in the track-cover bucket.
    img.dataset.venylCoverFallback='1';
    const fallback=src.replace(ALBUM_MARK,COVER_MARK);
    if(fallback===src)return;

    e.stopImmediatePropagation();
    img.src=fallback;
  },true);
})();
`;
  }
  return s;
});

patch('lib/mobile-ui.js', s => {
  return s
    .replaceAll('/assets/mobile/app.js?v=player-gesture-3','/assets/mobile/app.js?v=release-cover-fallback-1')
    .replaceAll('/assets/mobile/app.js?v=sites-final-1943','/assets/mobile/app.js?v=release-cover-fallback-1');
});

console.log('Legacy single release cover fallback fixed.');
