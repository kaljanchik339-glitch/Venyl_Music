import {readFileSync} from 'node:fs';
const s=readFileSync('public/assets/mobile/app.js','utf8');
for(const term of ['Недавно добав','Недавно вышед','recent','home']){
  const i=s.toLowerCase().indexOf(term.toLowerCase());
  if(i>=0){
    console.log('\n### HOME_INSPECT '+term+' @'+i+'\n'+s.slice(Math.max(0,i-2600),Math.min(s.length,i+5200)));
  }
}
