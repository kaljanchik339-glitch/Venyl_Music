import {readFileSync,writeFileSync} from 'node:fs';

function patch(path,fn){
  const before=readFileSync(path,'utf8');
  writeFileSync(path,fn(before));
}

patch('public/assets/mobile/app.js', s => {
  // The mini-player must never open the artist/album chooser.
  s=s.replaceAll('class="v-mini-meta" data-v="mini-meta" role="button" tabindex="0"','class="v-mini-meta"');
  s=s.replace(/else if\(act==='mini-meta'\)\{[\s\S]*?return;\}\s*else if\(act==='player'\)\{/,'else if(act=\'player\'){');

  // iOS: the existing player swipe must consume the gesture so Safari cannot pull-to-refresh.
  const oldMove="$('v-player').addEventListener('touchmove',e=>{if(!vPlayerTouchY)return;vPlayerDelta=Math.max(0,e.touches[0].clientY-vPlayerTouchY);if(vPlayerDelta)$('v-player').style.transform='translateY('+Math.min(vPlayerDelta,180)+'px)';},{passive:true});";
  const newMove="$('v-player').addEventListener('touchmove',e=>{if(!vPlayerTouchY)return;vPlayerDelta=Math.max(0,e.touches[0].clientY-vPlayerTouchY);if(vPlayerDelta){e.preventDefault();$('v-player').style.transform='translateY('+Math.min(vPlayerDelta,180)+'px)';}},{passive:false});";
  if(s.includes(oldMove))s=s.replace(oldMove,newMove);

  if(!s.includes('VENYL_MINI_PLAYER_OPEN_FIX_V4')){
    s += `
// VENYL_MINI_PLAYER_OPEN_FIX_V4
(()=>{
  const mini=document.getElementById('v-mini');
  const player=document.getElementById('v-player');
  if(!player)return;
  let savedY=0;
  let rerouting=false;

  const isOpen=()=>!player.hidden&&player.getAttribute('aria-hidden')!=='true';

  function freeze(){
    if(document.documentElement.classList.contains('v-fullplayer-lock'))return;
    savedY=window.scrollY||0;
    document.documentElement.classList.add('v-fullplayer-lock');
    document.body.classList.add('v-fullplayer-lock');
    document.body.style.position='fixed';
    document.body.style.top=(-savedY)+'px';
    document.body.style.left='0';
    document.body.style.right='0';
    document.body.style.width='100%';
  }

  function unfreeze(){
    if(!document.documentElement.classList.contains('v-fullplayer-lock'))return;
    document.documentElement.classList.remove('v-fullplayer-lock');
    document.body.classList.remove('v-fullplayer-lock');
    document.body.style.position='';
    document.body.style.top='';
    document.body.style.left='';
    document.body.style.right='';
    document.body.style.width='';
    window.scrollTo(0,savedY);
  }

  // Re-route ANY mini-player tap to the native in-app "player" action.
  // We deliberately do not call renderPlayer() here because it is scoped inside the app closure.
  if(mini)mini.addEventListener('click',e=>{
    if(rerouting)return;
    const opener=mini.querySelector('[data-v="player"]');
    if(!opener)return;
    e.preventDefault();
    e.stopImmediatePropagation();
    rerouting=true;
    try{opener.click();}finally{rerouting=false;}
  },true);

  new MutationObserver(()=>{if(isOpen())freeze();else unfreeze();})
    .observe(player,{attributes:true,attributeFilter:['hidden','aria-hidden','class']});

  document.addEventListener('touchmove',e=>{
    if(!isOpen())return;
    if(!e.target.closest('#v-player'))e.preventDefault();
  },{passive:false});

  if(isOpen())freeze();
})();
`;
  }
  return s;
});

patch('public/assets/mobile/mobile.css', s => {
  if(!s.includes('VENYL_MINI_PLAYER_OPEN_FIX_V4'))s += `
/* VENYL_MINI_PLAYER_OPEN_FIX_V4 */
html.v-fullplayer-lock,body.v-fullplayer-lock{overflow:hidden!important;overscroll-behavior:none!important;}
body.v-fullplayer-lock{touch-action:none;}
#v-player{overscroll-behavior:contain;will-change:transform;}
#v-player input[type="range"],#v-player button,#v-player a{touch-action:manipulation;}
#v-mini .v-mini-meta{pointer-events:none!important;}
`;
  return s;
});

patch('lib/mobile-ui.js', s => s
  .replace(/\/assets\/mobile\/mobile\.css\?v=[^"']+/g,'/assets/mobile/mobile.css?v=mini-open-4')
  .replace(/\/assets\/mobile\/app\.js\?v=[^"']+/g,'/assets/mobile/app.js?v=mini-open-4')
);

console.log('Mini-player open + fullscreen scroll behavior fixed v4.');
