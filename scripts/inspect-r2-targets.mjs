import {readFileSync} from 'node:fs';

for(const path of ['lib/backend.js','public/assets/mobile/upload.js','lib/legacy.js','app/uploads/[...path]/route.ts']){
  try{
    const s=readFileSync(path,'utf8');
    console.log('\n===== INSPECT '+path+' =====');
    const needles=['upload','storage','audio_path','tracks','incomingFiles','bridge'];
    const seen=[];
    for(const needle of needles){
      let from=0, count=0;
      while(count<8){
        const i=s.toLowerCase().indexOf(needle.toLowerCase(),from);
        if(i<0)break;
        const a=Math.max(0,i-900), b=Math.min(s.length,i+2200);
        const key=a+':'+b;
        if(!seen.includes(key)){
          console.log('\n--- '+needle+' @ '+i+' ---\n'+s.slice(a,b));
          seen.push(key);
        }
        from=i+needle.length; count++;
      }
    }
  }catch(e){ console.log('INSPECT_FAIL',path,e.message); }
}
