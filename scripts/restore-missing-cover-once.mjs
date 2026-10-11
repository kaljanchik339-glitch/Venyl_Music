const BRIDGE='https://hwulruialugaaufjzsdt.supabase.co/functions/v1/venyl-render-bridge';
const token=process.env.VENYL_RENDER_BRIDGE_TOKEN;
if(!token){console.error('[cover-restore] missing bridge token');process.exit(1);}
const source='https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/bf/09/b8/bf09b8d3-2b52-2f30-28a8-85071114e35b/cover.jpg/1200x1200bb.jpg';
const name='bccf500e-ab7f-4142-b01f-f990f620a549.jpg';
const src=await fetch(source);
if(!src.ok){console.error('[cover-restore] source failed',src.status);process.exit(1);}
const body=new Uint8Array(await src.arrayBuffer());
const u=new URL(BRIDGE);
u.searchParams.set('action','upload');
u.searchParams.set('bucket','covers');
u.searchParams.set('name',name);
u.searchParams.set('contentType','image/jpeg');
const r=await fetch(u,{method:'PUT',headers:{'x-venyl-bridge':token,'Content-Type':'image/jpeg'},body});
const d=await r.json().catch(()=>({}));
if(!r.ok){console.error('[cover-restore] upload failed',r.status,d.error||d.details||'');process.exit(1);}
console.log('[cover-restore] restored',name,body.byteLength);
