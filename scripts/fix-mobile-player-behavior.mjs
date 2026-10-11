import {readFileSync,writeFileSync} from 'node:fs';

function patch(path,fn){
  const before=readFileSync(path,'utf8');
  writeFileSync(path,fn(before));
}

patch('public/assets/mobile/app.js', s => {
  s=s.replaceAll('class="v-mini-meta" data-v="mini-meta" role="button" tabindex="0"','class="v-mini-meta"');
  s=s.replace(/else if\(act==='mini-meta'\)\{[\s\S]*?return;\}\s*else if\(act==='player'\)\{/,'else if(act===\'player\'){');

  if(!s.includes('VENYL_FULL_PLAYER_GESTURE_FIX_V3')){
    s += '\n// VENYL_FULL_PLAYER_GESTURE_FIX_V3\n(()=>{\n'+
      'const player=document.getElementById(\'v-player\');\n'+
      'const mini=document.getElementById(\'v-mini\');\n'+
      'if(!player)return;\n'+
      'let savedY=0,startY=0,lastY=0,dragging=false;\n'+
      'const isOpen=()=>!player.hidden&&player.getAttribute(\'aria-hidden\')!==\'true\';\n'+
      'function freeze(){if(document.documentElement.classList.contains(\'v-fullplayer-lock\'))return;savedY=window.scrollY||0;document.documentElement.classList.add(\'v-fullplayer-lock\');document.body.classList.add(\'v-fullplayer-lock\');document.body.style.position=\'fixed\';document.body.style.top=(-savedY)+\'px\';document.body.style.left=\'0\';document.body.style.right=\'0\';document.body.style.width=\'100%\';}\n'+
      'function unfreeze(){if(!document.documentElement.classList.contains(\'v-fullplayer-lock\'))return;document.documentElement.classList.remove(\'v-fullplayer-lock\');document.body.classList.remove(\'v-fullplayer-lock\');document.body.style.position=\'\';document.body.style.top=\'\';document.body.style.left=\'\';document.body.style.right=\'\';document.body.style.width=\'\';window.scrollTo(0,savedY);}\n'+
      'new MutationObserver(()=>{if(isOpen())freeze();else unfreeze();}).observe(player,{attributes:true,attributeFilter:[\'hidden\',\'aria-hidden\',\'class\']});\n'+
      'if(mini)mini.addEventListener(\'click\',e=>{e.preventDefault();e.stopImmediatePropagation();try{renderPlayer();}catch{}},true);\n'+
      'player.addEventListener(\'touchstart\',e=>{if(!isOpen()||e.touches.length!==1)return;if(e.target.closest(\'input[type="range"],button,a\'))return;startY=e.touches[0].clientY;lastY=startY;dragging=true;e.stopImmediatePropagation();},{capture:true,passive:true});\n'+
      'player.addEventListener(\'touchmove\',e=>{if(!dragging||!isOpen())return;lastY=e.touches[0].clientY;const dy=Math.max(0,lastY-startY);if(dy>0){e.preventDefault();e.stopImmediatePropagation();player.style.transform=\'translate3d(0,\'+Math.min(dy,220)+\'px,0)\';}},{capture:true,passive:false});\n'+
      'player.addEventListener(\'touchend\',e=>{if(!dragging)return;const dy=Math.max(0,lastY-startY);dragging=false;player.style.transform=\'\';e.preventDefault();e.stopImmediatePropagation();if(dy>90){try{closePlayer();}catch{player.hidden=true;player.setAttribute(\'aria-hidden\',\'true\');unfreeze();}}startY=0;lastY=0;},{capture:true,passive:false});\n'+
      'document.addEventListener(\'touchmove\',e=>{if(!isOpen())return;if(!e.target.closest(\'#v-player\'))e.preventDefault();},{passive:false});\n'+
      'if(isOpen())freeze();\n'+
      '})();\n';
  }
  return s;
});

patch('public/assets/mobile/mobile.css', s => {
  if(!s.includes('VENYL_FULL_PLAYER_GESTURE_FIX_V3')) s += '\n/* VENYL_FULL_PLAYER_GESTURE_FIX_V3 */\nhtml.v-fullplayer-lock,body.v-fullplayer-lock{overflow:hidden!important;overscroll-behavior:none!important;}\nbody.v-fullplayer-lock{touch-action:none;}\n#v-player{overscroll-behavior:contain;touch-action:pan-y;will-change:transform;}\n#v-player input[type="range"],#v-player button,#v-player a{touch-action:manipulation;}\n#v-mini .v-mini-meta{pointer-events:none!important;}\n';
  return s;
});

patch('lib/mobile-ui.js', s => s
  .replace(/\\/assets\\/mobile\\/mobile\\.css\\?v=[^"']+/g,'/assets/mobile/mobile.css?v=player-gesture-3')
  .replace(/\\/assets\\/mobile\\/app\\.js\\?v=[^"']+/g,'/assets/mobile/app.js?v=player-gesture-3')
);

console.log('Mini-player and fullscreen gesture behavior fixed.');