const BRIDGE='https://hwulruialugaaufjzsdt.supabase.co/functions/v1/venyl-render-bridge';
const token=process.env.VENYL_RENDER_BRIDGE_TOKEN;
if(!token){
  console.error('[storage-cleanup] missing VENYL_RENDER_BRIDGE_TOKEN');
  process.exit(1);
}

const ORPHANS={
  albums:["36d0128c-243c-49ad-bef5-7ec1eca64feb.jpg","4b44257e-c437-41bc-8ee2-83f57fc2d49d.jpg","4f632260-4604-4337-a078-a9c15899f426.jpg","5df2e8e4-e414-4c02-a2ef-c4459ff54ea8.jpg","ae6bc817-65b2-455c-95e8-eb48fbd30e93.jpg","bccf500e-ab7f-4142-b01f-f990f620a549.jpg","dc909441-3300-4a6f-8c35-2acf347165b0.jpg","ee4f6904-c65b-4b1c-b473-96a73f7c86b6.jpg"],
  artists:["0c9e3214-5295-49aa-a4fd-fb372235416d.jpg","1875126b-2020-4926-88d0-a64c45d76754.jpeg","20ce4eb7-e155-48b5-abf3-f50b3ff4f505.jpg","21685066-bb1b-4d15-b81b-99879ff06436.jpg","4b27af6e-8615-480b-92b4-d9eb57545264.jpg","53064b73-a5f2-48eb-b02d-7b1ee66ad589.jpeg","54b07c07-3870-4914-a13a-5a1122e2c461.jpg","65412a84-0926-474d-b0f8-5a500770a83c.jpg","746a396b-c65b-420c-ae93-e0e64028634f.jpg","74e621b7-156a-4de1-86b6-6f7d61bf9006.jpeg","99f43540-0c93-48a9-8de7-b0267db473f7.jpg","b87af8b5-02c1-4a4b-a568-e3fe9e2e3f7c.jpg","d0ec438b-0b8d-41c5-8b9a-e96e185d4f8e.jpeg","fa10e59b-a92a-43c4-bf7e-2c833a0140b9.png"],
  avatars:["74c7b172-ef60-4529-9469-7c34366afdfb.png"],
  covers:["1777900243269_c0485ef9a081dcf960ce4e5d4b904c46.1000x1000x1.png","1d004623-5c4e-4843-a8d2-db0f49246c8a.jpeg","1eaae169-5c0b-42d9-9118-2557ed5a5178.jpg","31f4f33b-3e61-4fa9-bb1a-83d5da8a6993.jpg","36206a9e-23a0-471e-8534-71ebf22b67a6.jpg","430fad4b-d7a0-407f-968a-bc584cdf41fa.jpg","7c3f0760-2f41-4033-8405-33fd1398e744.jpg","c6f20a15-bd6f-4a57-adf6-c4bde6afb133.jpg"],
  tracks:["1777900242925_yung_trappa_feat._-doggystyle_1.mp3","1790841860386_11-doggystyle_feat..mp3","3b57e155-41a4-404b-99d7-ec4fbc0104a3.mp3","b30855df-5b4a-49ad-963e-24e576619b20.mp3","d5eb83c1-e033-4fe8-a320-63ce65ce5ce7.mp3"]
};

let failed=0,deleted=0,skipped=0;
for(const [bucket,names] of Object.entries(ORPHANS)){
  for(const name of names){
    const u=new URL(BRIDGE);
    u.searchParams.set('action','delete');
    u.searchParams.set('bucket',bucket);
    u.searchParams.set('name',name);
    try{
      const r=await fetch(u,{method:'DELETE',headers:{'x-venyl-bridge':token}});
      const d=await r.json().catch(()=>({}));
      if(r.ok&&d.deleted){deleted++;console.log('[storage-cleanup] deleted',bucket,name);}
      else if(r.ok&&d.skipped){skipped++;console.log('[storage-cleanup] skipped',bucket,name);}
      else{failed++;console.error('[storage-cleanup] failed',bucket,name,r.status,d.error||d.details||'');}
    }catch(e){
      failed++;console.error('[storage-cleanup] failed',bucket,name,e?.message||String(e));
    }
  }
}
console.log('[storage-cleanup] summary',JSON.stringify({deleted,skipped,failed}));
if(failed)process.exit(1);
