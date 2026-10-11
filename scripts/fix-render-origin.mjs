import {readFileSync,writeFileSync} from 'node:fs';

const path='lib/backend.js';
let s=readFileSync(path,'utf8');

if(!s.includes('function getPublicOrigin(request,url)')){
  s=s.replace(
`export async function handleApi(request,identity,env,attempt=0){
 if(!identity)return Response.json({error:'Войди через Google или Apple'},{status:401});
 const url=new URL(request.url);`,
`function getPublicOrigin(request,url){
 const forwardedHost=String(request.headers.get('x-forwarded-host')||request.headers.get('host')||'').split(',')[0].trim();
 const forwardedProto=String(request.headers.get('x-forwarded-proto')||'').split(',')[0].trim()||url.protocol.replace(':','');
 if(!forwardedHost)return url.origin;
 try{return new URL(forwardedProto+'://'+forwardedHost).origin;}catch{return url.origin;}
}
export async function handleApi(request,identity,env,attempt=0){
 if(!identity)return Response.json({error:'Войди через Google или Apple'},{status:401});
 const url=new URL(request.url);
 const publicOrigin=getPublicOrigin(request,url);`);

  s=s.replace(
` if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return Response.json({error:'Недопустимый источник запроса'},{status:403});`,
` const requestOrigin=request.headers.get('origin');
 if(!['GET','HEAD'].includes(request.method)&&requestOrigin&&requestOrigin!==url.origin&&requestOrigin!==publicOrigin)return Response.json({error:'Недопустимый источник запроса'},{status:403});`);

  s=s.replace(
`const parsed=await parseBody(request);const context={secret:'Supabase Auth verifies each request server-side',origin:url.origin,dirty};`,
`const parsed=await parseBody(request);const context={secret:'Supabase Auth verifies each request server-side',origin:publicOrigin,dirty};`);

  s=s.replace(
`const req={method:request.method,path:url.pathname,url:url.pathname+url.search,origin:url.origin,`,
`const req={method:request.method,path:url.pathname,url:url.pathname+url.search,origin:publicOrigin,`);
}

writeFileSync(path,s);
console.log('Render public-origin validation fixed.');
