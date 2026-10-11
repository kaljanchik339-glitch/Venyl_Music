import {readFileSync} from 'node:fs';
for(const path of ['public/assets/mobile/app.js','public/assets/mobile/upload.js','lib/backend.js']){
  const s=readFileSync(path,'utf8');
  console.log('\n### FILE',path,'LEN',s.length);
  for(const kw of ['Недавно','недавно','recent','release_date','release_type','Редакт','edit-track','update-track','artist','releases']){
    let from=0,n=0;
    while(n<8){
      const i=s.toLowerCase().indexOf(kw.toLowerCase(),from);
      if(i<0)break;
      console.log('\n### HIT',kw,'AT',i,'\n'+s.slice(Math.max(0,i-700),Math.min(s.length,i+1800)).replace(/\n/g,'\\n'));
      from=i+kw.length;n++;
    }
  }
}
