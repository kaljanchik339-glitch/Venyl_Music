import {readFileSync,writeFileSync} from 'node:fs';

// Restore the actual latest full Venyl UI on the root route.
// The experimental mobile shell remains available at /mobile-preview.
writeFileSync('app/route.ts', `import html from '../lib/ui.js';
import {mobileHtml} from '../lib/mobile-ui.js';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const ua=request.headers.get('user-agent')||'';
 const chMobile=request.headers.get('sec-ch-ua-mobile')||'';
 const isMobile=chMobile==='?1'||/iPhone|iPod|Android.*Mobile|Windows Phone|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua);
 const body=isMobile?mobileHtml():html;
 return new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, no-cache, must-revalidate','Pragma':'no-cache','Vary':'User-Agent, Sec-CH-UA-Mobile','X-Content-Type-Options':'nosniff'}});
}
`);

let ui=readFileSync('lib/ui.js','utf8');

// Keep Google, but expose the email/password flow on the full latest UI as well.
if(!ui.includes('venyl-email-login-btn')){
  const google='Продолжить с Google</button>';
  const email=google+'\\n<button class=\\"auth-btn-full venyl-email-login-btn\\" type=\\"button\\" onclick=\\"location.href=\'/email-login\'\\"><span class=\\"social-mark\\">@</span>Войти по почте и паролю</button>';
  ui=ui.replace(google,email);

  ui=ui.replace('</style></head>', `.venyl-email-login-btn{background:var(--ink3)!important;color:var(--cream)!important;border:1px solid var(--wire3)!important}.venyl-email-login-btn:hover{background:var(--ink4)!important;border-color:var(--accent-border)!important}</style></head>`);
}

// Make sure the full-site auth asset is always fresh on iPhone/Safari.
ui=ui
  .replaceAll('/assets/venyl-auth.js?v=1','/assets/venyl-auth.js?v=full-20261009')
  .replaceAll('/assets/venyl-auth.js?v=3','/assets/venyl-auth.js?v=full-20261009')
  .replaceAll('/assets/venyl-auth.js?v=4','/assets/venyl-auth.js?v=full-20261009')
  .replaceAll('/assets/venyl-auth.js?v=5','/assets/venyl-auth.js?v=full-20261009');

writeFileSync('lib/ui.js',ui);
