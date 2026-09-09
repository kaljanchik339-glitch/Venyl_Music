const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'public', 'index.html');
if (!fs.existsSync(file)) process.exit(0);

let html = fs.readFileSync(file, 'utf8');
html = html.replace(
  /<div class="nav-section(?![^>]*admin-only)">\s*<div class="nav-label">(?:Управление|Manage|Administration|Керування)<\/div>/i,
  m => m.replace('class="nav-section"', 'class="nav-section admin-only"')
);

const marker = '</head>';
if (!html.includes('id="venylAdminVisibilityFix"')) {
  const fix = `<style id="venylAdminVisibilityFix">.venyl-admin-hidden{display:none!important}</style>\n<script id="venylAdminVisibilityFixScript">\n(()=>{\n const apply=()=>{\n  const els=document.querySelectorAll('.admin-only');\n  els.forEach(el=>el.classList.add('venyl-admin-hidden'));\n  fetch('/api/auth/me',{credentials:'same-origin'}).then(r=>r.ok?r.json():{user:null}).then(({user})=>{\n   if(user && user.isAdmin) els.forEach(el=>el.classList.remove('venyl-admin-hidden'));\n  }).catch(()=>{});\n };\n if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true}); else apply();\n})();\n</script>\n`;
  html = html.replace(marker, fix + marker);
}

fs.writeFileSync(file, html, 'utf8');
