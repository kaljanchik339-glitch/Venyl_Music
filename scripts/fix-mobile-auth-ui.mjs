import {readFileSync,writeFileSync} from 'node:fs';

function patchFile(path, fn) {
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  if (after === before) console.warn('No changes in', path);
  writeFileSync(path, after);
}

// iOS: never autofocus the email/password fields when the auth panel opens.
// Safari auto-zooms focused controls when their font size is below 16px.
patchFile('public/assets/mobile/app.js', s => s
  .replace("$('v-auth-email')?.focus();return;", "return;")
  .replace("$('v-auth-password')?.focus();}}", "}}")
);

// Keep inputs at >=16px on iOS and opt out of text-size adjustment.
// Center the @ glyph independently from the surrounding text baseline.
patchFile('public/assets/mobile/mobile.css', s => s + `
html{-webkit-text-size-adjust:100%}
.v-auth-password-form input{
  font-size:16px!important;
  line-height:1.2;
}
.v-provider-mail{
  display:inline-flex!important;
  align-items:center!important;
  justify-content:center!important;
  width:22px!important;
  height:22px!important;
  min-width:22px!important;
  padding:0!important;
  line-height:1!important;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif!important;
  font-size:16px!important;
  font-weight:700!important;
  letter-spacing:0!important;
  text-align:center!important;
  vertical-align:middle!important;
  transform:translateY(-0.5px);
}
`);

// Fresh asset URLs so Safari cannot reuse the buggy JS/CSS.
patchFile('lib/ui.js', s => s
  .replaceAll('/assets/venyl-auth.js?v=4','/assets/venyl-auth.js?v=5')
  .replaceAll('/assets/venyl-auth.js?v=3','/assets/venyl-auth.js?v=5')
  .replaceAll('/assets/venyl-auth.js?v=1','/assets/venyl-auth.js?v=5')
);
patchFile('lib/mobile-ui.js', s => s
  .replaceAll('/assets/mobile/mobile.css?v=4','/assets/mobile/mobile.css?v=5')
  .replaceAll('/assets/mobile/mobile.css?v=3','/assets/mobile/mobile.css?v=5')
  .replaceAll('/assets/mobile/mobile.css?v=1','/assets/mobile/mobile.css?v=5')
  .replaceAll('/assets/mobile/app.js?v=4','/assets/mobile/app.js?v=5')
  .replaceAll('/assets/mobile/app.js?v=3','/assets/mobile/app.js?v=5')
  .replaceAll('/assets/mobile/app.js?v=2','/assets/mobile/app.js?v=5')
);
