import {readFileSync} from 'node:fs';

function dump(path, needles){
  const s=readFileSync(path,'utf8');
  console.log('\n### FILE',path,'LEN',s.length);
  for(const needle of needles){
    let from=0,count=0;
    while(count<5){
      const i=s.toLowerCase().indexOf(needle.toLowerCase(),from);
      if(i<0)break;
      console.log('\n### NEEDLE',needle,'AT',i);
      console.log(s.slice(Math.max(0,i-2200),Math.min(s.length,i+7000)));
      from=i+needle.length;
      count++;
    }
  }
}
dump('public/assets/mobile/app.js',['popularTracks','Популяр','albums','artist','release_type']);
dump('public/assets/mobile/upload.js',['release_type','album','artist','FormData','upload','genre']);
dump('lib/backend.js',['/api/artists/','/api/tracks','/api/albums','release_type','created_at']);
