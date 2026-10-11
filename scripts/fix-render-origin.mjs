import {readFileSync,writeFileSync} from 'node:fs';

const path='lib/backend.js';
let s=readFileSync(path,'utf8');

const urlLine=" const url=new URL(request.url);";
if(!s.includes(" const publicOrigin=")){
  if(!s.includes(urlLine))throw new Error('handleApi URL line not found');
  s=s.replace(urlLine, ` const url=new URL(request.url);
 const forwardedHost=String(request.headers.get('x-forwarded-host')||request.headers.get('host')||'').split(',')[0].trim();
 const forwardedProto=String(request.headers.get('x-forwarded-proto')||'').split(',')[0].trim()||url.protocol.replace(':','');
 let publicOrigin=url.origin;
 if(forwardedHost){try{publicOrigin=new URL(forwardedProto+'://'+forwardedHost).origin;}catch{}}
`);
}

const oldCheck=" if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return Response.json({error:'Недопустимый источник запроса'},{status:403});";
const newCheck=` const requestOrigin=request.headers.get('origin');
 if(!['GET','HEAD'].includes(request.method)&&requestOrigin&&requestOrigin!==url.origin&&requestOrigin!==publicOrigin)return Response.json({error:'Недопустимый источник запроса'},{status:403});`;
if(s.includes(oldCheck))s=s.replace(oldCheck,newCheck);

s=s.replace(
  "const parsed=await parseBody(request);const context={secret:'Supabase Auth verifies each request server-side',origin:url.origin,dirty};",
  "const parsed=await parseBody(request);const context={secret:'Supabase Auth verifies each request server-side',origin:publicOrigin,dirty};"
);
s=s.replace(
  "const req={method:request.method,path:url.pathname,url:url.pathname+url.search,origin:url.origin,",
  "const req={method:request.method,path:url.pathname,url:url.pathname+url.search,origin:publicOrigin,"
);

if(!s.includes(" const publicOrigin="))throw new Error('publicOrigin was not inserted');
if(!s.includes("requestOrigin!==publicOrigin"))throw new Error('origin validation was not patched');

writeFileSync(path,s);
console.log('Render public-origin validation fixed.');
