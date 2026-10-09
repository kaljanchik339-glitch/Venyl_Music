import {readFileSync,readdirSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {gunzipSync} from 'node:zlib';

const parts=readdirSync(new URL('../source-pack/',import.meta.url)).filter(x=>x.endsWith('.txt')).sort();
const packed=parts.map(name=>readFileSync(new URL('../source-pack/'+name,import.meta.url),'utf8')).join('');
const pack=JSON.parse(packed);
for(const [name,data] of Object.entries(pack)){
  mkdirSync(dirname(name),{recursive:true});
  writeFileSync(name,gunzipSync(Buffer.from(data,'base64')));
}

// Render/Next build does not use the Cloudflare-only database bindings or Edge Function source.
rmSync('db',{recursive:true,force:true});
rmSync('lib/bridge-edge.ts',{force:true});

function patch(path, fn){
  const before=readFileSync(path,'utf8');
  const after=fn(before);
  writeFileSync(path,after);
}

// Google is now the only social sign-in method shown by Venyl.
patch('lib/mobile-ui.js', s => s
  .replace('Войди через Google или Apple — и откроются треки, альбомы, артисты, избранное и твоя медиатека.','Войди через Google — и откроются треки, альбомы, артисты, избранное и твоя медиатека.')
  .replace(/<button class="v-auth-provider v-auth-apple" data-v="login-apple">[\s\S]*?<\/button>/,'')
);
patch('public/assets/mobile/app.js', s => s
  .replaceAll('Вход в Venyl — через Google или Apple.','Вход в Venyl — через Google.')
  .replace("+'<button class=\"v-button v-primary v-wide\" data-v=\"login-google\">Продолжить с Google</button><button class=\"v-button v-wide\" data-v=\"login-apple\">Продолжить с Apple</button>'", "+'<button class=\"v-button v-primary v-wide\" data-v=\"login-google\">Продолжить с Google</button>'")
  .replace("\n else if(act==='login-apple'){VenylAuth.signIn('apple',location.pathname+location.search);return;}", '')
);
patch('public/assets/venyl-auth.js', s => s
  .replace("if(provider!=='google'&&provider!=='apple')throw new Error('Unsupported provider');","if(provider!=='google')throw new Error('Unsupported provider');")
);
patch('lib/backend.js', s => s
  .replaceAll('Войди через Google или Apple','Войди через Google')
  .replaceAll('В этой версии вход выполняется через Google или Apple.','В этой версии вход выполняется через Google.')
  .replaceAll('Учётная запись управляется через Google или Apple.','Учётная запись управляется через Google.')
  .replaceAll('Вход выполняется через Google или Apple; паролей Venyl нет.','Вход выполняется через Google; паролей Venyl нет.')
);
patch('lib/legacy.js', s => s
  .replaceAll('Вход через Google или Apple','Вход через Google')
  .replaceAll('Войди через Google или Apple.','Войди через Google.')
);
patch('lib/ui.js', s => s
  .replaceAll('Без паролей Venyl. Используй Google или Apple.','Без паролей Venyl. Используй Google.')
  .replaceAll('<button class=\\"auth-btn-full venyl-apple-btn\\" type=\\"button\\" onclick=\\"VenylAuth.signIn(\'apple\',\'/\')\\"><span class=\\"social-mark apple\\">●</span>Продолжить с Apple</button>','')
);
patch('public/assets/mobile/mobile.css', s => s.replace(/\.v-auth-apple\{[^}]*\}/g,''));
