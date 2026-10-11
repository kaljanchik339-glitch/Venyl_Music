const BRIDGE='https://hwulruialugaaufjzsdt.supabase.co/functions/v1/venyl-render-bridge';
const token=process.env.VENYL_RENDER_BRIDGE_TOKEN;
if(!token){console.error('[album-cover-fix] missing bridge token');process.exit(1);}

const jobs=[
  {name:'official-ilovebenzo-1877184251.jpg',lookup:'https://itunes.apple.com/lookup?id=1877184251',expect:'ILOVEBENZO'},
  {name:'official-pauk-1688532210.jpg',lookup:'https://itunes.apple.com/lookup?id=1688532210',expect:'ПАУК'},
  {name:'official-miss-dora.jpg',lookup:'https://itunes.apple.com/lookup?id=1833562939',expect:'Miss'}
];

for(const job of jobs){
  const metaRes=await fetch(job.lookup);
  if(!metaRes.ok){console.error('[album-cover-fix] lookup failed',job.expect,metaRes.status);process.exit(1);}
  const meta=await metaRes.json();
  let item=(meta.results||[]).find(x=>x.wrapperType==='collection'||x.collectionType==='Album');
  if(!item){
    const track=(meta.results||[]).find(x=>x.collectionId&&x.artworkUrl100);
    if(track){
      const cr=await fetch('https://itunes.apple.com/lookup?id='+encodeURIComponent(track.collectionId));
      const cm=await cr.json();
      item=(cm.results||[]).find(x=>x.wrapperType==='collection')||track;
    }
  }
  if(!item?.artworkUrl100){console.error('[album-cover-fix] no artwork',job.expect);process.exit(1);}
  const imageUrl=String(item.artworkUrl100).replace(/100x100bb(?:-\d+)?\.jpg$/,'1200x1200bb.jpg').replace('/100x100bb.jpg','/1200x1200bb.jpg');
  const img=await fetch(imageUrl);
  if(!img.ok){console.error('[album-cover-fix] image failed',job.expect,img.status,imageUrl);process.exit(1);}
  const body=new Uint8Array(await img.arrayBuffer());
  const u=new URL(BRIDGE);
  u.searchParams.set('action','upload');
  u.searchParams.set('bucket','albums');
  u.searchParams.set('name',job.name);
  u.searchParams.set('contentType','image/jpeg');
  const r=await fetch(u,{method:'PUT',headers:{'x-venyl-bridge':token,'Content-Type':'image/jpeg'},body});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){console.error('[album-cover-fix] upload failed',job.expect,r.status,d.error||d.details||'');process.exit(1);}
  console.log('[album-cover-fix] uploaded',job.expect,job.name,body.byteLength);
}
