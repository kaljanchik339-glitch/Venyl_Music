import {existsSync,readFileSync} from 'node:fs';
for(const path of ['public/assets/mobile/app.js','lib/backend.js']){
  if(!existsSync(path))continue;
  const s=readFileSync(path,'utf8');
  console.log('\n### FILE',path,'LEN',s.length);
  for(const kw of ['edit-track','Редактировать','rename','delete-track','/api/tracks/','request.method===\'PUT\'','request.method===\'PATCH\'','release_date']){
    let from=0,n=0;
    while(n<12){
      const i=s.toLowerCase().indexOf(kw.toLowerCase(),from);
      if(i<0)break;
      console.log('\n### HIT',kw,'AT',i,'\n'+s.slice(Math.max(0,i-1000),Math.min(s.length,i+2600)).replace(/\n/g,'\\n'));
      from=i+kw.length;n++;
    }
  }
}
