import {readFileSync,writeFileSync} from 'node:fs';

function replaceAllIn(path, replacements){
  let source=readFileSync(path,'utf8');
  for(const [from,to] of replacements) source=source.split(from).join(to);
  writeFileSync(path,source);
}

replaceAllIn('lib/ui.js', [
  ['/assets/venyl-auth.js?v=1','/assets/venyl-auth.js?v=4']
]);

replaceAllIn('lib/mobile-ui.js', [
  ['/assets/mobile/mobile.css?v=1','/assets/mobile/mobile.css?v=4'],
  ['/assets/mobile/app.js?v=2','/assets/mobile/app.js?v=4']
]);
