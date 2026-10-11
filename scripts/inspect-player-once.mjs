import {readFileSync} from 'node:fs';
const s=readFileSync('public/assets/mobile/app.js','utf8');
for(const needle of ['function renderPlayer','v-player-title','close-player','player-menu']){
  const i=s.indexOf(needle);
  if(i>=0)console.log('\n[PLAYER-SNIP '+needle+']\n'+s.slice(Math.max(0,i-2600),Math.min(s.length,i+7000))+'\n[/PLAYER-SNIP]\n');
}
