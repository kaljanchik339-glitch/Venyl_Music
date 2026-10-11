import {readFileSync} from 'node:fs';

function show(path, terms){
  const s=readFileSync(path,'utf8');
  console.log('\n=== INSPECT '+path+' ===');
  for(const term of terms){
    let from=0,count=0;
    while(count<3){
      const i=s.indexOf(term,from);
      if(i<0)break;
      const a=Math.max(0,i-1800), b=Math.min(s.length,i+4200);
      console.log('\n--- TERM '+JSON.stringify(term)+' @'+i+' ---\n'+s.slice(a,b));
      from=i+term.length; count++;
    }
  }
}
show('public/assets/mobile/app.js',[
  "name==='artist'",
  "Показать все",
  "Популярные релизы",
  "Последние релизы",
  "release_type",
  "created_at"
]);
show('public/assets/mobile/upload.js',[
  "release_type",
  "album",
  "created_at",
  "FormData",
  "/api/tracks",
  "/api/albums"
]);
show('lib/backend.js',[
  "path==='/api/tracks'",
  "path==='/api/albums'",
  "/api/artists/",
  "release_type",
  "created_at"
]);
