const fs=require('fs');
const html=fs.readFileSync('public/index.html','utf8');

const requiredIds=[
  'app','mainContent','homeView','discoverView','myMusicView','artistsView','favoritesView',
  'playlistsView','chatView','adminPanelView','searchView','searchInput','audioEl','playBtn',
  'progBar','progFill','volSlider','loginPage','registerPage','uploadModal','profileModal',
  'chatLayout','chatConversations','chatMessages','mobileMenuBtn','mobileMenuSheet'
];

const ids=[...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map(m=>m[1]);
const duplicates=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
const missing=requiredIds.filter(id=>!ids.includes(id));
if(duplicates.length) throw new Error('Duplicate ids: '+duplicates.join(', '));
if(missing.length) throw new Error('Missing required ids: '+missing.join(', '));
if(/<(?:button|a) \.nav-item/i.test(html)) throw new Error('Malformed navigation markup remains');

const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
scripts.forEach((code,i)=>{
  try{new Function(code)}
  catch(err){throw new Error('Inline script '+(i+1)+' syntax error: '+err.message)}
});

const handlerCode=[...html.matchAll(/\b(?:onclick|onchange|oninput|onkeydown|onkeyup|onsubmit)\s*=\s*["']([^"']*)["']/gi)].map(m=>m[1]).join('\n');
const called=new Set([...handlerCode.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]));
const declared=new Set([
  ...[...html.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]),
  ...[...html.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)].map(m=>m[1])
]);
const ignore=new Set(['if','for','while','switch','catch','find','replace','stringify','stopPropagation','preventDefault','focus','select','click','Number','String','Boolean','Array','Object','Date','JSON','Math','parseInt','parseFloat','encodeURIComponent','decodeURIComponent','setTimeout','clearTimeout','confirm']);
const unresolved=[...called].filter(x=>!declared.has(x)&&!ignore.has(x));
if(unresolved.length) throw new Error('Unresolved inline handlers: '+unresolved.sort().join(', '));

const apiRefs=[...new Set([...html.matchAll(/\/api\/[A-Za-z0-9_?&=./:$\{\}-]+/g)].map(m=>m[0]))];
if(apiRefs.length<30) throw new Error('Unexpectedly low API reference count: '+apiRefs.length);

console.log('UI check passed');
console.log('ids:',ids.length,'inline scripts:',scripts.length,'api refs:',apiRefs.length);
