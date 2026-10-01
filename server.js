require('dotenv').config();

const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).trim();
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Render/Proxy + baseline security headers.
app.set('trust proxy', 1);


const rootDir = __dirname;
const uploadsDir = path.join(rootDir, 'uploads');
const tracksDir = path.join(uploadsDir, 'tracks');
const coversDir = path.join(uploadsDir, 'covers');
const artistsDir = path.join(uploadsDir, 'artists');
const avatarsDir = path.join(uploadsDir, 'avatars');
const albumsDir = path.join(uploadsDir, 'albums');
const playlistCoversDir = path.join(uploadsDir, 'playlists');
const importsDir = path.join(uploadsDir, 'imports');
const dataDir = path.join(rootDir, 'data');
const jsonPath = path.join(dataDir, 'venyl.json');
for (const dir of [uploadsDir, tracksDir, coversDir, artistsDir, avatarsDir, albumsDir, playlistCoversDir, importsDir, dataDir]) fs.mkdirSync(dir, { recursive: true });

const blank = () => ({ users: [], email_verification_tokens: [], artists: [], albums: [], tracks: [], track_artists: [], subscriptions: [], favorite_tracks: [], playlists: [], playlist_tracks: [], listen_history: [], comments: [], user_follows: [], playlist_likes: [], user_subscriptions: [], user_follow_dismissals: [], chat_messages: [], playlist_collaborators: [] });
let db = blank();
function loadDb(){
  try { db = { ...blank(), ...JSON.parse(fs.readFileSync(jsonPath, 'utf8')) }; }
  catch { db = blank(); saveDb(); }
  for (const k of Object.keys(blank())) if (!Array.isArray(db[k])) db[k] = [];
}
function saveDb(){ fs.writeFileSync(jsonPath, JSON.stringify(db, null, 2), 'utf8'); }
function nextId(table){ return (db[table].reduce((m, r) => Math.max(m, Number(r.id)||0), 0) + 1); }
function now(){ return new Date().toISOString().replace('T',' ').slice(0,19); }
loadDb();
if(!Array.isArray(db.listen_history)) db.listen_history=[]; if(!Array.isArray(db.comments)) db.comments=[];
for (const u of db.users) { if (!u.role) u.role = (ADMIN_EMAIL && String(u.email).toLowerCase() === ADMIN_EMAIL) ? 'admin' : 'user'; if (u.nickname_color == null) u.nickname_color = ''; }

// Social/identity migration. Keep legacy user_follows usable and copy it into the new table once.
for (const rel of db.user_subscriptions) { rel.user_id=Number(rel.user_id); rel.target_user_id=Number(rel.target_user_id); }
for (const d of db.user_follow_dismissals) { d.user_id=Number(d.user_id); d.follower_user_id=Number(d.follower_user_id); }
for (const m of db.chat_messages) { m.id=Number(m.id); m.from_user_id=Number(m.from_user_id); m.to_user_id=Number(m.to_user_id); if(m.track_id!=null)m.track_id=Number(m.track_id); m.read_at=m.read_at||null; }
// Normalize social relations around one canonical table. Older builds used user_follows.
// Merge all valid legacy relations into user_subscriptions, deduplicate both tables,
// and then mirror the canonical table back to user_follows for compatibility.
{
  const seen = new Set();
  const merged = [];
  for (const r of [...db.user_subscriptions, ...db.user_follows]) {
    const follower = Number(r.user_id ?? r.follower_id);
    const target = Number(r.target_user_id ?? r.following_id);
    if (!follower || !target || follower === target) continue;
    if (!db.users.some(u=>Number(u.id)===follower) || !db.users.some(u=>Number(u.id)===target)) continue;
    const key = `${follower}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ id: 0, user_id:follower, target_user_id:target, created_at:r.created_at||now() });
  }
  merged.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  let sid = 1; for (const r of merged) r.id = sid++;
  db.user_subscriptions = merged;
  db.user_follows = merged.map((r,i)=>({id:i+1,follower_id:r.user_id,following_id:r.target_user_id,created_at:r.created_at}));
}

function normalizeNickname(value){ return String(value || '').trim().replace(/\s+/g, ' '); }
function nicknameKey(value){ return normalizeNickname(value).toLocaleLowerCase('ru-RU'); }
function isArtistNameTaken(name){ const key=nicknameKey(name); return !!key && db.artists.some(a=>nicknameKey(a.name)===key); }
function isUserNicknameTaken(name, excludeUserId=null){ const key=nicknameKey(name); return !!key && db.users.some(u=>Number(u.id)!==Number(excludeUserId)&&nicknameKey(u.name)===key); }
function makeUniqueNickname(baseName, excludeUserId=null){
  const base=normalizeNickname(baseName); if(!base)return '';
  let candidate=base, suffix=2;
  while(isUserNicknameTaken(candidate,excludeUserId) || isArtistNameTaken(candidate)){ candidate=`${base}${suffix}`; suffix+=1; }
  return candidate;
}
// Repair old accounts: keep the earliest user on the bare nickname and suffix later duplicates.
{
  const used=new Set();
  for(const u of [...db.users].sort((a,b)=>Number(a.id)-Number(b.id))){
    const baseName=normalizeNickname(u.name)||`user${u.id}`; let candidate=baseName, suffix=2;
    while(used.has(nicknameKey(candidate)) || isArtistNameTaken(candidate)){ candidate=`${baseName}${suffix}`; suffix+=1; }
    u.name=candidate; used.add(nicknameKey(candidate));
  }
}
saveDb();

const NICKNAME_CHANGE_MS = 30 * 24 * 60 * 60 * 1000;
const AVATAR_CHANGE_MS = 7 * 24 * 60 * 60 * 1000;
function isAdminUser(user){ return Boolean(user && (String(user.role || '').toLowerCase() === 'admin' || (ADMIN_EMAIL && String(user.email).toLowerCase() === ADMIN_EMAIL))); }
function normalizeRole(role){ return String(role || 'user').toLowerCase() === 'admin' ? 'admin' : 'user'; }
function toIsoOrNull(v){ if(!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
function getProfileWindows(user){
  const nickAt = toIsoOrNull(user?.last_nick_change_at);
  const avatarAt = toIsoOrNull(user?.last_avatar_change_at);
  const nickNext = nickAt ? new Date(new Date(nickAt).getTime() + NICKNAME_CHANGE_MS).toISOString() : null;
  const avatarNext = avatarAt ? new Date(new Date(avatarAt).getTime() + AVATAR_CHANGE_MS).toISOString() : null;
  return { nickAt, avatarAt, nickNext, avatarNext };
}
function canChangeNickname(user){ if (isAdminUser(user)) return true; const { nickNext } = getProfileWindows(user); return !nickNext || Date.now() >= new Date(nickNext).getTime(); }
function canChangeAvatar(user){ if (isAdminUser(user)) return true; const { avatarNext } = getProfileWindows(user); return !avatarNext || Date.now() >= new Date(avatarNext).getTime(); }

function buildMailer() {
  const ok = process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM;
  if (!ok) return null;
  return nodemailer.createTransport({
    host: String(process.env.SMTP_HOST).trim(),
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
}
const mailer = buildMailer();
const mailerStatus = { configured: Boolean(mailer), ready: false, error: '' };
if (mailer) {
  mailer.verify().then(() => {
    mailerStatus.ready = true;
    console.log('[Venyl mail] SMTP connection verified.');
  }).catch(err => {
    mailerStatus.error = String(err?.message || err);
    console.error('[Venyl mail] SMTP verification failed:', mailerStatus.error);
  });
} else {
  mailerStatus.error = 'SMTP environment variables are missing.';
  console.warn('[Venyl mail] SMTP is not configured. Email verification is disabled.');
}

function createJwt(user) { return jwt.sign({ id: user.id, email: user.email, name: user.name, ver: user.token_version || 0 }, JWT_SECRET, { expiresIn: '30d' }); }
function setAuthCookie(res, token) { res.cookie('venyl_token', token, { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION, maxAge: 30*24*60*60*1000, path: '/' }); }
function publicUser(u){ if(!u) return null; const windows = getProfileWindows(u); const isAdmin = isAdminUser(u); return { id:u.id, name:u.name, email:u.email, bio:u.bio||'', role: normalizeRole(u.role || (ADMIN_EMAIL && String(u.email).toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user')), avatarUrl: u.avatar_path ? `/uploads/avatars/${u.avatar_path}` : '', nicknameColor: u.nickname_color || '', isVerified: !!u.is_verified, isAdmin, lastNickChangeAt: windows.nickAt, lastAvatarChangeAt: windows.avatarAt, nicknameCanChangeAt: windows.nickNext, avatarCanChangeAt: windows.avatarNext, canChangeNickname: canChangeNickname(u), canChangeAvatar: canChangeAvatar(u) }; }
function adminUserRow(u){ return { id:u.id, name:u.name, email:u.email, role: normalizeRole(u.role || (ADMIN_EMAIL && String(u.email).toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user')), createdAt:u.created_at || '', nicknameColor:u.nickname_color || '', bio:u.bio || '', avatarUrl:u.avatar_path ? `/uploads/avatars/${u.avatar_path}` : '', isVerified:!!u.is_verified, password:'Скрыт. Админ может задать новый пароль, но не посмотреть текущий.' }; }
function authRequired(req, res, next) {
  try {
    const token = req.cookies.venyl_token;
    if (!token) return res.status(401).json({ error: 'Нужно войти в аккаунт.' });
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => Number(u.id) === Number(payload.id));
    if (!user) return res.status(401).json({ error: 'Пользователь не найден.' });
    if ((payload.ver ?? 0) !== (user.token_version ?? 0)) return res.status(401).json({ error: 'Сессия устарела. Войди заново.' });
    req.user = user; next();
  } catch { res.status(401).json({ error: 'Сессия недействительна.' }); }
}
function getOptionalUser(req){
  try {
    const token=req.cookies?.venyl_token;
    if(!token) return null;
    const payload=jwt.verify(token, JWT_SECRET);
    const user=db.users.find(u=>Number(u.id)===Number(payload.id));
    if(!user) return null;
    if((payload.ver ?? 0)!==(user.token_version ?? 0)) return null;
    return user;
  } catch { return null; }
}

function adminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Нужно войти в аккаунт.' });
  if (!req.user.is_verified) return res.status(403).json({ error: 'Сначала подтверди email.' });
  if (!ADMIN_EMAIL) return res.status(500).json({ error: 'ADMIN_EMAIL не настроен в .env' });
  if (!isAdminUser(req.user)) return res.status(403).json({ error: 'Доступно только администратору.' });
  next();
}
async function sendVerificationEmail(user, token) {
  if (!mailer) throw new Error('SMTP не настроен. Проверь SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS и MAIL_FROM.');
  const verifyUrl = `${APP_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  try {
    const info = await mailer.sendMail({
      from: process.env.MAIL_FROM,
      to: user.email,
      subject: 'Подтверди аккаунт Venyl',
      html: `<p>Привет, ${user.name}!</p><p><a href="${verifyUrl}">Подтвердить email</a></p><p>Или открой ссылку:</p><p>${verifyUrl}</p>`,
    });
    mailerStatus.ready = true;
    mailerStatus.error = '';
    console.log(`[Venyl mail] Verification email sent to ${user.email}; messageId=${info.messageId || 'n/a'}`);
    return info;
  } catch (err) {
    mailerStatus.ready = false;
    mailerStatus.error = String(err?.message || err);
    console.error(`[Venyl mail] Failed to send verification email to ${user.email}:`, mailerStatus.error);
    throw err;
  }
}

function sanitizeBase(name = '') { return String(name).normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'file'; }
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'audio' || file.fieldname === 'audios') return cb(null, tracksDir);
    if (file.fieldname === 'cover') return cb(null, coversDir);
    if (file.fieldname === 'photo') return cb(null, artistsDir);
    if (file.fieldname === 'avatar') return cb(null, avatarsDir);
    if (file.fieldname === 'album_cover') return cb(null, albumsDir);
    if (file.fieldname === 'playlist_cover') return cb(null, playlistCoversDir);
    cb(new Error('Неизвестное поле файла.'));
  },
  filename: (req, file, cb) => { const ext = path.extname(file.originalname || ''); const base = sanitizeBase(path.basename(file.originalname || 'file', ext)); cb(null, `${Date.now()}_${base}${ext.toLowerCase()}`); },
});
function fileFilter(req, file, cb) {
  const audio = ['audio/mpeg','audio/wav','audio/x-wav','audio/flac','audio/x-flac','audio/ogg','audio/mp4'].includes(String(file.mimetype||'').toLowerCase());
  const image = ['image/jpeg','image/png','image/webp','image/gif'].includes(String(file.mimetype||'').toLowerCase());
  if (['audio','audios'].includes(file.fieldname)) return cb(null, audio);
  if (['cover','photo','avatar','album_cover','playlist_cover'].includes(file.fieldname)) return cb(null, image);
  cb(new Error('Неизвестный или неподдерживаемый тип файла.'));
}
const upload = multer({ storage, fileFilter, limits: { fileSize: 1024*1024*120 } });
const zipStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, importsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${sanitizeBase(path.basename(file.originalname || 'album', path.extname(file.originalname || ''))) || 'album'}.zip`),
});
const zipUpload = multer({
  storage: zipStorage,
  limits: { fileSize: 1024 * 1024 * 500 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, ext === '.zip' || String(file.mimetype || '').toLowerCase().includes('zip'));
  },
});
function decodeId3Text(buf){
  if(!buf || !buf.length) return '';
  const enc=buf[0]; const body=buf.subarray(1);
  if(enc===1){ try{return body.toString('utf16le').replace(/\u0000+$/g,'').replace(/^\uFEFF/,'').trim();}catch{} }
  if(enc===2){ try{ const out=[]; for(let i=0;i+1<body.length;i+=2) out.push(String.fromCharCode(body[i]*256+body[i+1])); return out.join('').replace(/\u0000+$/g,'').replace(/^\uFEFF/,'').trim(); }catch{} }
  return body.toString(enc===3?'utf8':'latin1').replace(/\u0000+$/g,'').trim();
}
function readId3Tags(filePath){
  try{
    const fd=fs.openSync(filePath,'r'); const head=Buffer.alloc(10); fs.readSync(fd,head,0,10,0);
    if(head.toString('ascii',0,3)!=='ID3'){fs.closeSync(fd);return {};} 
    const version=head[3]; const size=((head[6]&0x7f)<<21)|((head[7]&0x7f)<<14)|((head[8]&0x7f)<<7)|(head[9]&0x7f);
    const max=Math.min(size, 1024*1024); const buf=Buffer.alloc(max); fs.readSync(fd,buf,0,max,10); fs.closeSync(fd);
    const out={}; let pos=0;
    while(pos+10<=buf.length){
      const id=buf.toString('ascii',pos,pos+4); if(!/^[A-Z0-9]{4}$/.test(id) || /^\x00+$/.test(id)) break;
      let frameSize=version>=4 ? ((buf[pos+4]&0x7f)<<21)|((buf[pos+5]&0x7f)<<14)|((buf[pos+6]&0x7f)<<7)|(buf[pos+7]&0x7f) : buf.readUInt32BE(pos+4);
      if(!frameSize || pos+10+frameSize>buf.length) break;
      const data=buf.subarray(pos+10,pos+10+frameSize);
      const key={TIT2:'title',TPE1:'artist',TPE2:'albumArtist',TALB:'album',TRCK:'track',TPOS:'disc',TCON:'genre',TDRC:'year',TYER:'year'}[id];
      if(key && !out[key]) out[key]=decodeId3Text(data);
      pos += 10+frameSize;
    }
    return out;
  }catch{return {};} 
}
async function listZipEntries(zipPath){
  if(process.platform !== 'win32'){
    const {stdout}=await execFileAsync('unzip',['-Z1',zipPath],{maxBuffer:2*1024*1024});
    return stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  }
  const script=`Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g,"''")}').Entries | ForEach-Object { $_.FullName }`;
  const {stdout}=await execFileAsync('powershell',['-NoProfile','-Command',script],{maxBuffer:2*1024*1024});
  return stdout.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
}
async function extractZipSafe(zipPath,targetDir){
  const entries=await listZipEntries(zipPath);
  for(const entry of entries){
    const normalized=entry.replace(/\\/g,'/');
    if(normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error('ZIP содержит небезопасный путь.');
  }
  if(process.platform !== 'win32') await execFileAsync('unzip',['-q','-o',zipPath,'-d',targetDir],{maxBuffer:2*1024*1024});
  else await execFileAsync('powershell',['-NoProfile','-Command',`Expand-Archive -LiteralPath '${zipPath.replace(/'/g,"''")}' -DestinationPath '${targetDir.replace(/'/g,"''")}' -Force`],{maxBuffer:2*1024*1024});
  return entries;
}
function walkFiles(dir){
  const out=[]; for(const name of fs.readdirSync(dir,{withFileTypes:true})){ const p=path.join(dir,name.name); if(name.isDirectory()) out.push(...walkFiles(p)); else out.push(p); } return out;
}
function findFirstFile(files, names){
  const wanted=new Set(names.map(x=>x.toLowerCase()));
  return files.find(f=>wanted.has(path.basename(f).toLowerCase())) || files.find(f=>/\.(jpe?g|png|webp)$/i.test(f));
}
function deleteFileSafe(fullPath){ try { if (fullPath && fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch {} }
function cleanupRequestFiles(req){ const files = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : []; for (const f of files) deleteFileSafe(f.path); if (req.file) deleteFileSafe(req.file.path); }

const coverUrlCache = new Map();
function resolveCoverUrl(coverPath) {
  if (!coverPath) return '';
  if (coverUrlCache.has(coverPath)) return coverUrlCache.get(coverPath);
  let url = '';
  if (fs.existsSync(path.join(coversDir, coverPath))) url = `/uploads/covers/${coverPath}`;
  else if (fs.existsSync(path.join(albumsDir, coverPath))) url = `/uploads/albums/${coverPath}`;
  coverUrlCache.set(coverPath, url); return url;
}
function invalidateCoverCache(p){ if (p) coverUrlCache.delete(p); }
function mapArtist(row){ return { id: row.id, name: row.name, bio: row.bio || '', photoUrl: row.photo_path ? `/uploads/artists/${row.photo_path}` : '', createdAt: row.created_at }; }
function mapAlbum(row){ return { id: row.id, artistId: row.artist_id, name: row.name, description: row.description || '', coverUrl: row.cover_path ? `/uploads/albums/${row.cover_path}` : '', createdAt: row.created_at }; }
function getTrackArtistsForMap(row){
  const relIds = db.track_artists
    .filter(rel => Number(rel.track_id) === Number(row.id))
    .map(rel => Number(rel.artist_id));
  const uniqueIds = [...new Set([Number(row.artist_id)||0, ...relIds].filter(Boolean))];
  const byId = uniqueIds
    .map(id => db.artists.find(a => Number(a.id) === Number(id)))
    .filter(Boolean);
  if (byId.length) return byId.map(a => ({ id: a.id, name: a.name, photoUrl: a.photo_path ? `/uploads/artists/${a.photo_path}` : '' }));
  return String(row.artist || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .map(name => {
      const a = db.artists.find(x => String(x.name).toLowerCase() === name.toLowerCase());
      return a ? { id: a.id, name: a.name, photoUrl: a.photo_path ? `/uploads/artists/${a.photo_path}` : '' } : { id: null, name, photoUrl: '' };
    });
}
function mapTrack(row){
  const artists = getTrackArtistsForMap(row);
  return { id: row.id, title: row.title, artist: row.artist, artists, artistId: row.artist_id || (artists[0]?.id || null), album: row.album || '', albumId: row.album_id || null, genre: row.genre || '', playCount: Number(row.play_count) || 0, coverUrl: resolveCoverUrl(row.cover_path), audioUrl: `/uploads/tracks/${row.audio_path}`, createdAt: row.created_at };
}
function ensureArtist(name){
  const clean = String(name || '').trim() || 'Unknown Artist';
  let a = db.artists.find(x => String(x.name).toLowerCase() === clean.toLowerCase());
  if (!a) { a = { id: nextId('artists'), name: clean, bio: '', photo_path: '', created_at: now() }; db.artists.push(a); saveDb(); }
  return a;
}
function ensureArtists(names){ return String(names || '').split(',').map(v => v.trim()).filter(Boolean).map(ensureArtist); }
function syncTrackArtists(trackId, artists){ db.track_artists = db.track_artists.filter(x => Number(x.track_id) !== Number(trackId)); for (const a of artists) if (!db.track_artists.some(x => Number(x.track_id)===Number(trackId) && Number(x.artist_id)===Number(a.id))) db.track_artists.push({ track_id: Number(trackId), artist_id: Number(a.id) }); }
function ensureAlbum(artistId, albumName, coverPath = '', description = ''){
  const clean = String(albumName || '').trim(); if (!clean) return null;
  let al = db.albums.find(x => Number(x.artist_id) === Number(artistId) && String(x.name).toLowerCase() === clean.toLowerCase());
  if (!al) { al = { id: nextId('albums'), artist_id: Number(artistId), name: clean, cover_path: coverPath || '', description: description || '', created_at: now() }; db.albums.push(al); }
  else { if (coverPath) al.cover_path = coverPath; if (description) al.description = description; }
  saveDb(); return al;
}
function sortTracksByPopularity(list){ return [...list].sort((a,b)=>((Number(b.play_count)||0)-(Number(a.play_count)||0)) || (Number(b.id)||0)-(Number(a.id)||0)); }
function getArtistTrackCount(artist){
  return db.tracks.filter(t=>Number(t.artist_id)===Number(artist.id)||String(t.artist||'').toLowerCase().split(',').map(s=>s.trim()).includes(String(artist.name).toLowerCase())).length;
}
function getArtistTrackList(artistId, artistName=''){
  const trackIds=new Set(db.track_artists.filter(x=>Number(x.artist_id)===Number(artistId)).map(x=>Number(x.track_id)));
  return sortTracksByPopularity(db.tracks.filter(t=>
    Number(t.artist_id)===Number(artistId) ||
    trackIds.has(Number(t.id)) ||
    (artistName && String(t.artist||'').toLowerCase().split(',').map(s=>s.trim()).includes(String(artistName).toLowerCase()))
  ));
}
function enrichArtist(row, userId = null){
  const artist = mapArtist(row);
  artist.trackCount = getArtistTrackCount(row);
  artist.isSubscribed = userId ? db.subscriptions.some(s => Number(s.user_id)===Number(userId) && Number(s.artist_id)===Number(row.id)) : false;
  return artist;
}
function getUserSubscriptions(userId){
  return db.subscriptions
    .filter(s=>Number(s.user_id)===Number(userId))
    .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0) || (Number(b.id)||0)-(Number(a.id)||0));
}
function getSubscribedArtistsForUser(userId){
  return getUserSubscriptions(userId)
    .map(sub=>db.artists.find(a=>Number(a.id)===Number(sub.artist_id)))
    .filter(Boolean)
    .map(a=>enrichArtist(a, userId));
}
function getSubscribedTracksForUser(userId){
  const ids = new Set(getUserSubscriptions(userId).map(s=>Number(s.artist_id)));
  const tracks = db.tracks.filter(t=>{
    if (ids.has(Number(t.artist_id))) return true;
    return db.track_artists.some(rel=>Number(rel.track_id)===Number(t.id) && ids.has(Number(rel.artist_id)));
  });
  return sortTracksByPopularity(tracks).map(mapTrack);
}

function getFavoriteTrackIdsForUser(userId){
  return new Set(
    db.favorite_tracks
      .filter(f=>Number(f.user_id)===Number(userId))
      .map(f=>Number(f.track_id))
  );
}
function getFavoriteTracksForUser(userId){
  const ids = getFavoriteTrackIdsForUser(userId);
  return db.tracks
    .filter(t=>ids.has(Number(t.id)))
    .sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0) || (Number(b.id)||0)-(Number(a.id)||0))
    .map(mapTrack);
}

function getPlaylistCollaborators(playlistId){
  return db.playlist_collaborators.filter(x=>Number(x.playlist_id)===Number(playlistId));
}
function isPlaylistCollaborator(userId, playlistId){
  return db.playlist_collaborators.find(x=>Number(x.playlist_id)===Number(playlistId) && Number(x.user_id)===Number(userId));
}
function mapPlaylist(row){
  const items = db.playlist_tracks.filter(x=>Number(x.playlist_id)===Number(row.id));
  const collaborators = getPlaylistCollaborators(row.id);
  return { id: row.id, userId: row.user_id, name: row.name, isPublic: !!row.is_public, likeCount: db.playlist_likes.filter(x=>Number(x.playlist_id)===Number(row.id)).length, coverUrl: row.cover_path ? `/uploads/playlists/${row.cover_path}` : '', trackCount: items.length, collaboratorCount: collaborators.length, collaborative: collaborators.length > 0, createdAt: row.created_at || '', updatedAt: row.updated_at || '' };
}
function getUserPlaylist(userId, playlistId){
  return db.playlists.find(p=>Number(p.id)===Number(playlistId) && (Number(p.user_id)===Number(userId) || !!isPlaylistCollaborator(userId, playlistId)));
}
function getEditablePlaylist(userId, playlistId){
  const pl=db.playlists.find(p=>Number(p.id)===Number(playlistId));
  if(!pl) return null;
  if(Number(pl.user_id)===Number(userId)) return pl;
  const c=isPlaylistCollaborator(userId, playlistId);
  return c && String(c.role||'editor')==='editor' ? pl : null;
}
function getPlaylistTracks(playlistId){
  const items = db.playlist_tracks
    .filter(x=>Number(x.playlist_id)===Number(playlistId))
    .sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0) || (Number(a.id)||0)-(Number(b.id)||0));
  return items.map(item=>{
    const t = db.tracks.find(x=>Number(x.id)===Number(item.track_id));
    return t ? mapTrack(t) : null;
  }).filter(Boolean);
}
function normalizePlaylistPositions(playlistId){
  const items = db.playlist_tracks
    .filter(x=>Number(x.playlist_id)===Number(playlistId))
    .sort((a,b)=>(Number(a.position)||0)-(Number(b.position)||0) || (Number(a.id)||0)-(Number(b.id)||0));
  items.forEach((item, idx)=>{ item.position = idx + 1; });
}
function normalizeCompoundArtistProfiles(){
  // Repair artist profiles created by older importers from collaboration strings
  // such as `SLAVA MARLOW/MORGENSHTERN`. Real collaborations should be represented
  // by multiple artist records + track_artists relations, not a new combined profile.
  const compoundArtists=db.artists.filter(a=>/[\/]/.test(String(a.name||'')) || /\b(?:feat\.?|ft\.?|featuring)\b/i.test(String(a.name||'')));
  for(const compound of compoundArtists){
    const parts=splitArtists(compound.name);
    if(parts.length<2) continue;
    const individual=parts.map(ensureArtist);
    const ids=new Set(individual.map(a=>Number(a.id)));
    for(const t of db.tracks){
      const rels=db.track_artists.filter(r=>Number(r.track_id)===Number(t.id));
      const referencesCompound=Number(t.artist_id)===Number(compound.id) || rels.some(r=>Number(r.artist_id)===Number(compound.id)) || String(t.artist||'').toLocaleLowerCase('ru-RU').includes(String(compound.name).toLocaleLowerCase('ru-RU'));
      if(!referencesCompound) continue;
      const currentIds=rels.map(r=>Number(r.artist_id)).filter(id=>id && id!==Number(compound.id));
      const current=currentIds.map(id=>db.artists.find(a=>Number(a.id)===id)).filter(Boolean);
      const merged=[];
      for(const a of [...individual,...current]) if(!merged.some(x=>Number(x.id)===Number(a.id))) merged.push(a);
      const main=merged[0];
      if(!main) continue;
      t.artist_id=main.id;
      t.artist=merged.map(a=>a.name).join(', ');
      syncTrackArtists(t.id,merged);
    }
    for(const al of db.albums){
      if(Number(al.artist_id)===Number(compound.id)) al.artist_id=individual[0].id;
    }
    // Preserve follows by moving them to all individual artists.
    const subs=db.subscriptions.filter(x=>Number(x.artist_id)===Number(compound.id));
    for(const sub of subs){
      for(const a of individual){
        if(!db.subscriptions.some(x=>Number(x.user_id)===Number(sub.user_id)&&Number(x.artist_id)===Number(a.id))){
          db.subscriptions.push({id:nextId('subscriptions'),user_id:Number(sub.user_id),artist_id:a.id,created_at:sub.created_at||now()});
        }
      }
    }
    db.subscriptions=db.subscriptions.filter(x=>Number(x.artist_id)!==Number(compound.id));
    const stillUsed=db.tracks.some(t=>Number(t.artist_id)===Number(compound.id)) || db.track_artists.some(r=>Number(r.artist_id)===Number(compound.id)) || db.albums.some(a=>Number(a.artist_id)===Number(compound.id));
    if(!stillUsed) db.artists=db.artists.filter(a=>Number(a.id)!==Number(compound.id));
  }
}

function reconcileRelations(){
  for (const u of db.users) {
    if (typeof u.avatar_path !== 'string') u.avatar_path = '';
    if (typeof u.nickname_color !== 'string') u.nickname_color = '';
    if (typeof u.bio !== 'string') u.bio = '';
    if (!('last_nick_change_at' in u)) u.last_nick_change_at = null;
    if (!('last_avatar_change_at' in u)) u.last_avatar_change_at = null;
  }
  for (const p of db.playlists) {
    if (typeof p.cover_path !== 'string') p.cover_path = '';
    if (!p.updated_at) p.updated_at = p.created_at || now();
  }
  for (const c of db.playlist_collaborators) {
    c.playlist_id=Number(c.playlist_id); c.user_id=Number(c.user_id); c.role=c.role==='editor'?'editor':'editor'; c.created_at=c.created_at||now();
  }
  for (const t of db.tracks) {
    if (typeof t.play_count !== 'number') t.play_count = Number(t.play_count) || 0;
    const artists = ensureArtists(t.artist); const main = artists[0];
    if (main) { t.artist_id = t.artist_id || main.id; t.artist = artists.map(a => a.name).join(', '); syncTrackArtists(t.id, artists); }
    if (main && t.album && !t.album_id) { const album = ensureAlbum(main.id, t.album); if (album) t.album_id = album.id; }
  }
  saveDb();
}
normalizeCompoundArtistProfiles();
reconcileRelations();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/uploads/tracks', express.static(tracksDir));
app.use('/uploads/covers', express.static(coversDir));
app.use('/uploads/artists', express.static(artistsDir));
app.use('/uploads/avatars', express.static(avatarsDir));
app.use('/uploads/albums', express.static(albumsDir));
app.use('/uploads/playlists', express.static(playlistCoversDir));
app.use(express.static(path.join(rootDir, 'public')));

const rateLimitStore = new Map();
let rateLimitCleanupAt = 0;
function rateLimit(maxRequests, windowMs, keyFn) {
  return (req, res, next) => {
    const nowMs = Date.now();
    const key = String((keyFn ? keyFn(req) : (req.ip || req.connection.remoteAddress || 'unknown')) || 'unknown').slice(0, 200);
    if (nowMs - rateLimitCleanupAt > 5*60*1000) {
      for (const [k, v] of rateLimitStore) if (nowMs > v.resetAt) rateLimitStore.delete(k);
      rateLimitCleanupAt = nowMs;
    }
    const e = rateLimitStore.get(key);
    if (!e || nowMs > e.resetAt) { rateLimitStore.set(key, {count:1, resetAt:nowMs+windowMs}); return next(); }
    if (e.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((e.resetAt-nowMs)/1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({error:'Слишком много запросов. Подожди немного.', retryAfter});
    }
    e.count++;
    next();
  };
}
const authLimiter = rateLimit(10, 15*60*1000, req => `${req.ip||'unknown'}:${String(req.body?.email||'').trim().toLowerCase()}`);
const uploadLimiter = rateLimit(20, 60*60*1000);
// Cover changes are lightweight metadata edits and should not consume the general upload quota.
const coverUploadLimiter = rateLimit(120, 10*60*1000);

app.get('/api/health', (req, res) => res.json({
  ok: true,
  mode: 'json-db',
  mailerConfigured: mailerStatus.configured,
  mailerReady: mailerStatus.ready,
  mailerError: mailerStatus.error || null,
  appBaseUrl: APP_BASE_URL,
  adminConfigured: Boolean(ADMIN_EMAIL),
}));
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try { const requestedName = normalizeNickname(req.body.name); const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
    if (!requestedName || !email || password.length < 8) return res.status(400).json({ error: 'Укажи ник, email и пароль минимум 8 символов.' });
    if (db.users.some(u => String(u.email).toLowerCase() === email)) return res.status(400).json({ error: 'Такой email уже зарегистрирован.' });
    if (isArtistNameTaken(requestedName)) return res.status(400).json({ error: 'Этот ник занят именем существующего артиста. Выбери другой ник.' });
    const name = makeUniqueNickname(requestedName);
    const user = { id: nextId('users'), name, email, role: (ADMIN_EMAIL && email === ADMIN_EMAIL) ? 'admin' : 'user', password_hash: await bcrypt.hash(password, 10), avatar_path: '', bio: '', nickname_color: '', last_nick_change_at: null, last_avatar_change_at: null, is_verified: mailer ? 0 : 1, token_version: 0, created_at: now() };
    db.users.push(user); const token = crypto.randomBytes(32).toString('hex'); if (mailer) db.email_verification_tokens.push({ id: nextId('email_verification_tokens'), user_id: user.id, token, expires_at: new Date(Date.now()+24*3600*1000).toISOString(), created_at: now() }); saveDb();
    let verificationSent = false;
    let verificationError = '';
    if (mailer) {
      try { await sendVerificationEmail(user, token); verificationSent = true; }
      catch (err) { verificationError = String(err?.message || err); }
    }
    setAuthCookie(res, createJwt(user));
    res.json({
      ok: true,
      user: publicUser(user),
      verificationSent,
      message: !mailer
        ? 'Аккаунт создан, но SMTP не настроен — письмо не отправлено.'
        : verificationSent
          ? 'Аккаунт создан. Проверь почту для подтверждения.'
          : 'Аккаунт создан, но письмо не отправилось. Открой профиль и нажми «Отправить письмо повторно».',
      mailError: verificationError || undefined,
    });
  } catch(e){ res.status(500).json({ error: e.message || 'Не удалось зарегистрироваться.' }); }
});
const resendVerificationLimiter = rateLimit(3, 15*60*1000);
app.post('/api/auth/resend-verification', authRequired, resendVerificationLimiter, async (req, res) => {
  try {
    if (req.user.is_verified) return res.status(400).json({ error: 'Email уже подтверждён.' });
    if (!mailer) return res.status(503).json({ error: 'SMTP не настроен на сервере.' });
    const token = crypto.randomBytes(32).toString('hex');
    db.email_verification_tokens = db.email_verification_tokens.filter(t => Number(t.user_id) !== Number(req.user.id));
    db.email_verification_tokens.push({ id: nextId('email_verification_tokens'), user_id: req.user.id, token, expires_at: new Date(Date.now()+24*3600*1000).toISOString(), created_at: now() });
    saveDb();
    await sendVerificationEmail(req.user, token);
    res.json({ ok: true, message: 'Письмо с подтверждением отправлено повторно.' });
  } catch (err) {
    res.status(503).json({ error: `Не удалось отправить письмо: ${String(err?.message || err)}` });
  }
});
app.get('/api/auth/verify-email', (req, res) => { const token = String(req.query.token || ''); const rec = db.email_verification_tokens.find(t => t.token === token); if (!rec) return res.status(400).send('Ссылка недействительна.'); const u = db.users.find(x => Number(x.id) === Number(rec.user_id)); if (u) u.is_verified = 1; db.email_verification_tokens = db.email_verification_tokens.filter(t => t.token !== token); saveDb(); res.redirect('/'); });
app.post('/api/auth/login', authLimiter, async (req, res) => { const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || ''); const u = db.users.find(x => String(x.email).toLowerCase() === email); if (!u || !(await bcrypt.compare(password, u.password_hash))) return res.status(401).json({ error: 'Неверный email или пароль.' }); setAuthCookie(res, createJwt(u)); res.json({ ok:true, user: publicUser(u) }); });
app.post('/api/auth/logout', (req, res) => { res.clearCookie('venyl_token'); res.json({ ok:true }); });
app.get('/api/auth/me', (req, res) => { try { const p = jwt.verify(req.cookies.venyl_token || '', JWT_SECRET); const u = db.users.find(x => Number(x.id) === Number(p.id)); res.json({ user: publicUser(u) }); } catch { res.json({ user:null }); } });


function publicProfileUser(u){
  if(!u) return null;
  const pids=new Set(db.playlists.filter(p=>Number(p.user_id)===Number(u.id)).map(p=>Number(p.id)));
  const trackCount=db.tracks.filter(t=>Number(t.uploaded_by_user_id)===Number(u.id)).length;
  const playlistCount=pids.size;
  const followerCount=db.user_subscriptions.filter(r=>Number(r.target_user_id)===Number(u.id)).length;
  const followingCount=db.user_subscriptions.filter(r=>Number(r.user_id)===Number(u.id)).length;
  return { id:u.id, name:u.name, avatarUrl:u.avatar_path ? `/uploads/avatars/${u.avatar_path}` : '', nicknameColor:u.nickname_color||'', createdAt:u.created_at||'', trackCount, playlistCount, followerCount, followingCount };
}
function getPublicProfile(id){
  const u=db.users.find(x=>Number(x.id)===Number(id));
  if(!u) return null;
  const user=publicProfileUser(u);
  const tracks=db.tracks.filter(t=>Number(t.uploaded_by_user_id)===Number(u.id)).sort((a,b)=>(Number(b.play_count)||0)-(Number(a.play_count)||0)).map(mapTrack);
  const playlists=db.playlists.filter(pl=>Number(pl.user_id)===Number(u.id)).sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0)).map(mapPlaylist);
  return {user,tracks,playlists};
}
app.get('/api/users', authRequired, (req,res)=>{
  const q=String(req.query.q||'').trim().toLowerCase();
  if(!q) return res.json({users:[]});
  const currentId=Number(req.user.id);
  const following=new Set(db.user_subscriptions.filter(r=>Number(r.user_id)===currentId).map(r=>Number(r.target_user_id)));
  let users=db.users.filter(Boolean).map(publicProfileUser).filter(u=>u.id!==currentId);
  users=users.filter(u=>String(u.name||'').toLowerCase().includes(q));
  users=users.map(u=>({...u,isFollowing:following.has(Number(u.id))}));
  users.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'ru'));
  res.json({users});
});

function userRelation(viewerId, targetId){
  const a=Number(viewerId), b=Number(targetId);
  return {following:db.user_subscriptions.some(r=>Number(r.user_id)===a&&Number(r.target_user_id)===b), followedBy:db.user_subscriptions.some(r=>Number(r.user_id)===b&&Number(r.target_user_id)===a)};
}
function publicUserWithRelation(viewerId, u){
  return {...publicProfileUser(u), ...userRelation(viewerId,u.id)};
}
app.post('/api/users/:id/follow', authRequired, (req,res)=>{
  const targetId=Number(req.params.id);
  if(targetId===Number(req.user.id)) return res.status(400).json({error:'Нельзя подписаться на самого себя.'});
  const target=db.users.find(u=>Number(u.id)===targetId);
  if(!target) return res.status(404).json({error:'Пользователь не найден.'});
  if(!db.user_subscriptions.some(r=>Number(r.user_id)===Number(req.user.id)&&Number(r.target_user_id)===targetId)){
    db.user_subscriptions.push({id:nextId('user_subscriptions'),user_id:Number(req.user.id),target_user_id:targetId,created_at:now()});
    db.user_follow_dismissals=db.user_follow_dismissals.filter(d=>!(Number(d.user_id)===targetId&&Number(d.follower_user_id)===Number(req.user.id)));
    saveDb();
  }
  res.json({ok:true,user:publicUserWithRelation(req.user.id,target)});
});
app.delete('/api/users/:id/follow', authRequired, (req,res)=>{
  const targetId=Number(req.params.id);
  db.user_subscriptions=db.user_subscriptions.filter(r=>!(Number(r.user_id)===Number(req.user.id)&&Number(r.target_user_id)===targetId));
  saveDb();
  const target=db.users.find(u=>Number(u.id)===targetId);
  if(!target) return res.status(404).json({error:'Пользователь не найден.'});
  res.json({ok:true,user:publicUserWithRelation(req.user.id,target)});
});
app.get('/api/users/:id/followers', authRequired, (req,res)=>{
  const targetId=Number(req.params.id);
  const target=db.users.find(u=>Number(u.id)===targetId);
  if(!target) return res.status(404).json({error:'Пользователь не найден.'});
  const followers=db.user_subscriptions.filter(r=>Number(r.target_user_id)===targetId).map(r=>db.users.find(u=>Number(u.id)===Number(r.user_id))).filter(Boolean).map(u=>publicUserWithRelation(req.user.id,u));
  followers.sort((a,b)=>String(a.name).localeCompare(String(b.name),'ru'));
  res.json({users:followers});
});
app.get('/api/social/followers', authRequired, (req,res)=>{
  const me=Number(req.user.id);
  const following=new Set(db.user_subscriptions.filter(r=>Number(r.user_id)===me).map(r=>Number(r.target_user_id)));
  const dismissed=new Set(db.user_follow_dismissals.filter(d=>Number(d.user_id)===me).map(d=>Number(d.follower_user_id)));
  const users=db.user_subscriptions.filter(r=>Number(r.target_user_id)===me).map(r=>db.users.find(u=>Number(u.id)===Number(r.user_id))).filter(Boolean).filter(u=>!dismissed.has(Number(u.id))).map(u=>({...publicProfileUser(u),isFollowing:following.has(Number(u.id))}));
  res.json({users});
});
app.post('/api/social/followers/:id/dismiss', authRequired, (req,res)=>{
  const followerId=Number(req.params.id);
  const exists=db.user_subscriptions.some(r=>Number(r.user_id)===followerId&&Number(r.target_user_id)===Number(req.user.id));
  if(!exists) return res.status(404).json({error:'Подписчик не найден.'});
  if(!db.user_follow_dismissals.some(d=>Number(d.user_id)===Number(req.user.id)&&Number(d.follower_user_id)===followerId)) db.user_follow_dismissals.push({id:nextId('user_follow_dismissals'),user_id:Number(req.user.id),follower_user_id:followerId,created_at:now()});
  saveDb(); res.json({ok:true});
});


function areUsersMutuallyFollowing(a,b){
  const x=Number(a), y=Number(b);
  if(!x || !y || x===y) return false;
  return db.user_subscriptions.some(r=>Number(r.user_id)===x&&Number(r.target_user_id)===y) &&
         db.user_subscriptions.some(r=>Number(r.user_id)===y&&Number(r.target_user_id)===x);
}
function chatUser(u, viewerId){
  const base=publicProfileUser(u);
  return {...base, unread: db.chat_messages.filter(m=>Number(m.from_user_id)===Number(u.id)&&Number(m.to_user_id)===Number(viewerId)&&!m.read_at).length};
}
app.get('/api/chat/conversations', authRequired, (req,res)=>{
  const me=Number(req.user.id);
  const ids=[...new Set(db.user_subscriptions.filter(r=>Number(r.user_id)===me).map(r=>Number(r.target_user_id)).filter(id=>areUsersMutuallyFollowing(me,id)))];
  const users=ids.map(id=>db.users.find(u=>Number(u.id)===id)).filter(Boolean).map(u=>{
    const msgs=db.chat_messages.filter(m=>(Number(m.from_user_id)===me&&Number(m.to_user_id)===Number(u.id))||(Number(m.from_user_id)===Number(u.id)&&Number(m.to_user_id)===me)).sort((a,b)=>Number(a.id)-Number(b.id));
    const last=msgs[msgs.length-1];
    return {...chatUser(u,me), lastMessage:last?{id:last.id,text:last.text||'',trackId:last.track_id||null,fromUserId:last.from_user_id,createdAt:last.created_at}:null};
  }).sort((a,b)=>new Date(b.lastMessage?.createdAt||0)-new Date(a.lastMessage?.createdAt||0));
  res.json({users,totalUnread:users.reduce((n,u)=>n+(u.unread||0),0)});
});
app.get('/api/chat/:userId/messages', authRequired, (req,res)=>{
  const me=Number(req.user.id), other=Number(req.params.userId);
  const otherUser=db.users.find(u=>Number(u.id)===other);
  if(!otherUser) return res.status(404).json({error:'Пользователь не найден.'});
  if(!areUsersMutuallyFollowing(me,other)) return res.status(403).json({error:'Чат доступен только между взаимными подписками.'});
  const messages=db.chat_messages.filter(m=>(Number(m.from_user_id)===me&&Number(m.to_user_id)===other)||(Number(m.from_user_id)===other&&Number(m.to_user_id)===me)).sort((a,b)=>Number(a.id)-Number(b.id)).map(m=>({id:m.id,fromUserId:m.from_user_id,toUserId:m.to_user_id,text:m.text||'',trackId:m.track_id||null,createdAt:m.created_at,readAt:m.read_at||null}));
  db.chat_messages.filter(m=>Number(m.from_user_id)===other&&Number(m.to_user_id)===me&&!m.read_at).forEach(m=>m.read_at=now());
  saveDb();
  res.json({user:chatUser(otherUser,me),messages});
});
app.post('/api/chat/:userId/messages', authRequired, (req,res)=>{
  const me=Number(req.user.id), other=Number(req.params.userId), text=String(req.body.text||'').trim();
  const trackId=req.body.trackId==null||req.body.trackId===''?null:Number(req.body.trackId);
  const otherUser=db.users.find(u=>Number(u.id)===other);
  if(!otherUser) return res.status(404).json({error:'Пользователь не найден.'});
  if(!areUsersMutuallyFollowing(me,other)) return res.status(403).json({error:'Чат доступен только между взаимными подписками.'});
  if(!text && !trackId) return res.status(400).json({error:'Сообщение не может быть пустым.'});
  if(text.length>2000) return res.status(400).json({error:'Сообщение слишком длинное.'});
  if(trackId && !db.tracks.some(t=>Number(t.id)===trackId)) return res.status(404).json({error:'Трек не найден.'});
  const msg={id:nextId('chat_messages'),from_user_id:me,to_user_id:other,text,track_id:trackId,created_at:now(),read_at:null};
  db.chat_messages.push(msg); saveDb();
  res.json({ok:true,message:{id:msg.id,fromUserId:me,toUserId:other,text,trackId,createdAt:msg.created_at,readAt:null}});
});
app.post('/api/chat/:userId/read', authRequired, (req,res)=>{
  const me=Number(req.user.id), other=Number(req.params.userId);
  if(!areUsersMutuallyFollowing(me,other)) return res.status(403).json({error:'Чат недоступен.'});
  db.chat_messages.filter(m=>Number(m.from_user_id)===other&&Number(m.to_user_id)===me&&!m.read_at).forEach(m=>m.read_at=now());
  saveDb(); res.json({ok:true});
});

app.get('/api/users/:id', authRequired, (req,res)=>{
  const profile=getPublicProfile(req.params.id);
  if(!profile) return res.status(404).json({error:'Пользователь не найден.'});
  profile.user={...profile.user,...userRelation(req.user.id,profile.user.id)};
  res.json(profile);
});


app.get('/api/admin/users', authRequired, adminOnly, (req, res) => {
  for (const u of db.users) {
    if (!u.role) u.role = (ADMIN_EMAIL && String(u.email).toLowerCase() === ADMIN_EMAIL) ? 'admin' : 'user';
    if (u.nickname_color == null) u.nickname_color = '';
  }
  saveDb();
  res.json({ users: db.users.map(adminUserRow).sort((a,b)=>Number(a.id)-Number(b.id)) });
});

app.put('/api/admin/users/:id', authRequired, adminOnly, express.json(), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const target = db.users.find(u => Number(u.id) === id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
    const name = normalizeNickname(req.body.name ?? target.name);
    const email = String(req.body.email ?? target.email).trim().toLowerCase();
    const role = normalizeRole(req.body.role ?? target.role);
    const nicknameColor = String(req.body.nicknameColor ?? target.nickname_color ?? '').trim();
    const password = String(req.body.password || '');
    if (!name || !email) return res.status(400).json({ error: 'Имя и почта обязательны.' });
    if (name !== target.name && isArtistNameTaken(name)) return res.status(400).json({ error: 'Этот ник занят именем существующего артиста.' });
    if (name !== target.name && isUserNicknameTaken(name, id)) return res.status(400).json({ error: 'Этот ник уже занят другим пользователем.' });
    const duplicate = db.users.find(u => Number(u.id) !== id && String(u.email).toLowerCase() === email);
    if (duplicate) return res.status(400).json({ error: 'Такая почта уже используется.' });
    target.name = name;
    target.email = email;
    target.role = role;
    target.nickname_color = /^#[0-9a-fA-F]{6}$/.test(nicknameColor) ? nicknameColor : '';
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Новый пароль должен быть минимум 8 символов.' });
      target.password_hash = await bcrypt.hash(password, 10);
      target.token_version = (Number(target.token_version) || 0) + 1;
    }
    saveDb();
    if (Number(req.user.id) === id) setAuthCookie(res, createJwt(target));
    res.json({ ok:true, user: adminUserRow(target), users: db.users.map(adminUserRow).sort((a,b)=>Number(a.id)-Number(b.id)), currentUser: Number(req.user.id)===id ? publicUser(target) : publicUser(req.user) });
  } catch(e) { res.status(500).json({ error: e.message || 'Не удалось обновить пользователя.' }); }
});


app.delete('/api/admin/users/:id', authRequired, adminOnly, (req, res) => {
  try {
    const id = Number(req.params.id);
    const target = db.users.find(u => Number(u.id) === id);
    if (!target) return res.status(404).json({ error: 'Пользователь не найден.' });
    if (Number(req.user.id) === id) return res.status(400).json({ error: 'Нельзя удалить свой аккаунт из админ-панели.' });

    if (target.avatar_path) deleteFileSafe(path.join(avatarsDir, target.avatar_path));
    db.users = db.users.filter(u => Number(u.id) !== id);
    db.email_verification_tokens = db.email_verification_tokens.filter(t => Number(t.user_id) !== id && Number(t.userId) !== id);
    db.subscriptions = db.subscriptions.filter(x => Number(x.user_id) !== id && Number(x.userId) !== id);
    db.user_subscriptions = db.user_subscriptions.filter(x => Number(x.user_id) !== id && Number(x.target_user_id) !== id);
    db.user_follow_dismissals = db.user_follow_dismissals.filter(x => Number(x.user_id) !== id && Number(x.follower_user_id) !== id);
    db.user_follows = db.user_follows.filter(x => Number(x.follower_id) !== id && Number(x.following_id) !== id);
    db.chat_messages = db.chat_messages.filter(x => Number(x.from_user_id) !== id && Number(x.to_user_id) !== id);
    db.favorite_tracks = db.favorite_tracks.filter(x => Number(x.user_id) !== id && Number(x.userId) !== id);
    db.user_follows = db.user_follows.filter(x=>Number(x.follower_id)!==id && Number(x.following_id)!==id);
    db.playlist_likes = db.playlist_likes.filter(x=>Number(x.user_id)!==id);
    const userPlaylistIds = new Set(db.playlists.filter(x => Number(x.user_id) === id || Number(x.userId) === id).map(x => Number(x.id)));
    for (const pl of db.playlists.filter(x => userPlaylistIds.has(Number(x.id)))) if (pl.cover_path) deleteFileSafe(path.join(playlistCoversDir, pl.cover_path));
    db.playlists = db.playlists.filter(x => !userPlaylistIds.has(Number(x.id)));
    db.playlist_tracks = db.playlist_tracks.filter(x => !userPlaylistIds.has(Number(x.playlist_id)));
    db.playlist_collaborators = db.playlist_collaborators.filter(x => !userPlaylistIds.has(Number(x.playlist_id)));
    for (const p of db.playlists) {
    if (typeof p.cover_path !== 'string') p.cover_path = '';
    if (!p.updated_at) p.updated_at = p.created_at || now();
  }
  for (const c of db.playlist_collaborators) {
    c.playlist_id=Number(c.playlist_id); c.user_id=Number(c.user_id); c.role=c.role==='editor'?'editor':'editor'; c.created_at=c.created_at||now();
  }
  for (const t of db.tracks) {
      if (Number(t.uploaded_by_user_id) === id) t.uploaded_by_user_id = null;
    }

    saveDb();
    res.json({ ok:true, users: db.users.map(adminUserRow).sort((a,b)=>Number(a.id)-Number(b.id)) });
  } catch(e) { res.status(500).json({ error: e.message || 'Не удалось удалить пользователя.' }); }
});

app.put('/api/profile', authRequired, uploadLimiter, upload.single('avatar'), (req, res) => {
  try {
    const user = req.user;
    const isAdmin = isAdminUser(user);
    const requestedName = String(req.body.name ?? '').trim();
    const requestedColor = String(req.body.nicknameColor ?? '').trim();
    const requestedBio = String(req.body.bio ?? user.bio ?? '').trim().slice(0, 500);
    const hasAvatarUpload = Boolean(req.file);
    if (!requestedName && !hasAvatarUpload && !('bio' in req.body) && !(isAdmin && 'nicknameColor' in req.body)) {
      if (req.file) deleteFileSafe(req.file.path);
      return res.status(400).json({ error: 'Нет данных для обновления профиля.' });
    }
    if (requestedName && requestedName !== user.name) {
      if (!isAdmin && !canChangeNickname(user)) {
        if (req.file) deleteFileSafe(req.file.path);
        return res.status(403).json({ error: `Ник можно менять только раз в месяц. Следующая смена будет доступна после ${new Date(getProfileWindows(user).nickNext).toLocaleDateString('ru-RU')}.` });
      }
      if (isArtistNameTaken(requestedName)) {
        if (req.file) deleteFileSafe(req.file.path);
        return res.status(400).json({ error: 'Этот ник занят именем существующего артиста.' });
      }
      if (isUserNicknameTaken(requestedName, user.id)) {
        if (req.file) deleteFileSafe(req.file.path);
        return res.status(400).json({ error: 'Этот ник уже занят другим пользователем.' });
      }
      user.name = normalizeNickname(requestedName);
      user.last_nick_change_at = new Date().toISOString();
    }
    if (hasAvatarUpload) {
      if (!isAdmin && !canChangeAvatar(user)) {
        deleteFileSafe(req.file.path);
        return res.status(403).json({ error: `Аватар можно менять только раз в неделю. Следующая смена будет доступна после ${new Date(getProfileWindows(user).avatarNext).toLocaleDateString('ru-RU')}.` });
      }
      if (user.avatar_path) deleteFileSafe(path.join(avatarsDir, user.avatar_path));
      user.avatar_path = path.basename(req.file.filename);
      user.last_avatar_change_at = new Date().toISOString();
    }
    if ('bio' in req.body) user.bio = requestedBio;
    if (isAdmin && 'nicknameColor' in req.body) {
      user.nickname_color = /^#[0-9a-fA-F]{6}$/.test(requestedColor) ? requestedColor : '';
    }
    saveDb();
    setAuthCookie(res, createJwt(user));
    res.json({ ok: true, user: publicUser(user) });
  } catch (e) {
    if (req.file) deleteFileSafe(req.file.path);
    res.status(500).json({ error: e.message || 'Не удалось обновить профиль.' });
  }
});


function publicSocialUser(u){
  if(!u) return null;
  return {id:Number(u.id),name:u.name||'',avatarUrl:u.avatar_path?`/uploads/avatars/${u.avatar_path}`:'',nicknameColor:u.nickname_color||''};
}
function socialTrack(id){
  const t=db.tracks.find(x=>Number(x.id)===Number(id));
  return t ? mapTrack(t) : null;
}
function activitySortDesc(a,b){ return new Date(b.createdAt||0)-new Date(a.createdAt||0) || Number(b.id||0)-Number(a.id||0); }

app.get('/api/social/feed', authRequired, (req,res)=>{
  const me=Number(req.user.id);
  const following=new Set(db.user_subscriptions.filter(r=>Number(r.user_id)===me).map(r=>Number(r.target_user_id)));
  if(!following.size) return res.json({items:[]});
  const items=[];
  for(const row of db.listen_history){
    const actor=Number(row.user_id);
    if(!following.has(actor)) continue;
    const track=socialTrack(row.track_id); const user=db.users.find(u=>Number(u.id)===actor);
    if(!track||!user) continue;
    items.push({id:`listen:${row.id}`,kind:'listen',createdAt:row.played_at,actor:publicSocialUser(user),track});
  }
  for(const row of db.favorite_tracks){
    const actor=Number(row.user_id);
    if(!following.has(actor)||actor===me) continue;
    const track=socialTrack(row.track_id); const user=db.users.find(u=>Number(u.id)===actor);
    if(!track||!user) continue;
    items.push({id:`favorite:${row.id}`,kind:'favorite',createdAt:row.created_at,actor:publicSocialUser(user),track});
  }
  for(const row of db.comments){
    const actor=Number(row.user_id);
    if(!following.has(actor)||actor===me) continue;
    const track=socialTrack(row.track_id); const user=db.users.find(u=>Number(u.id)===actor);
    if(!track||!user) continue;
    items.push({id:`comment:${row.id}`,kind:'comment',createdAt:row.created_at,actor:publicSocialUser(user),track,text:String(row.text||'').slice(0,180)});
  }
  for(const row of db.user_subscriptions){
    const actor=Number(row.user_id), target=Number(row.target_user_id);
    if(!following.has(actor)||actor===me) continue;
    const actorUser=db.users.find(u=>Number(u.id)===actor), targetUser=db.users.find(u=>Number(u.id)===target);
    if(!actorUser||!targetUser) continue;
    items.push({id:`follow:${row.id}`,kind:'follow',createdAt:row.created_at,actor:publicSocialUser(actorUser),target:publicSocialUser(targetUser)});
  }
  res.json({items:items.sort(activitySortDesc).slice(0,40)});
});

app.get('/api/social/listening-now', authRequired, (req,res)=>{
  const me=Number(req.user.id);
  const following=new Set(db.user_subscriptions.filter(r=>Number(r.user_id)===me).map(r=>Number(r.target_user_id)));
  const cutoff=Date.now()-20*60*1000;
  const latest=new Map();
  for(const row of db.listen_history){
    const uid=Number(row.user_id), ts=new Date(row.played_at||0).getTime();
    if(!uid||uid===me||!following.has(uid)||!ts||ts<cutoff) continue;
    const prev=latest.get(uid); if(!prev||ts>prev.ts) latest.set(uid,{row,ts});
  }
  const users=[...latest.entries()].map(([uid,{row,ts}])=>{
    const u=db.users.find(x=>Number(x.id)===uid), track=socialTrack(row.track_id);
    if(!u||!track) return null;
    return {user:publicSocialUser(u),track,playedAt:new Date(ts).toISOString()};
  }).filter(Boolean).sort((a,b)=>new Date(b.playedAt)-new Date(a.playedAt));
  res.json({users:users.slice(0,20)});
});

app.get('/api/social/notifications', authRequired, (req,res)=>{
  const me=Number(req.user.id);
  const items=[];
  const seen=new Set();
  const push=(item)=>{ if(!item||seen.has(item.id))return;seen.add(item.id);items.push(item); };
  db.user_subscriptions.filter(r=>Number(r.target_user_id)===me).forEach(r=>{
    const actor=db.users.find(u=>Number(u.id)===Number(r.user_id)); if(!actor)return;
    push({id:`follow:${r.id}`,kind:'follow',createdAt:r.created_at,actor:publicSocialUser(actor),text:`${actor.name} подписался на тебя.`});
  });
  const myTrackIds=new Set(db.tracks.filter(t=>Number(t.uploaded_by_user_id)===me).map(t=>Number(t.id)));
  db.comments.filter(c=>myTrackIds.has(Number(c.track_id))&&Number(c.user_id)!==me).forEach(c=>{
    const actor=db.users.find(u=>Number(u.id)===Number(c.user_id)), track=socialTrack(c.track_id); if(!actor||!track)return;
    push({id:`comment:${c.id}`,kind:'comment',createdAt:c.created_at,actor:publicSocialUser(actor),track,text:`${actor.name} прокомментировал «${track.title}».`});
  });
  db.favorite_tracks.filter(f=>myTrackIds.has(Number(f.track_id))&&Number(f.user_id)!==me).forEach(f=>{
    const actor=db.users.find(u=>Number(u.id)===Number(f.user_id)), track=socialTrack(f.track_id); if(!actor||!track)return;
    push({id:`favorite:${f.id}`,kind:'favorite',createdAt:f.created_at,actor:publicSocialUser(actor),track,text:`${actor.name} добавил «${track.title}» в избранное.`});
  });
  db.playlist_likes.filter(l=>Number(l.user_id)!==me).forEach(l=>{
    const pl=db.playlists.find(p=>Number(p.id)===Number(l.playlist_id)&&Number(p.user_id)===me), actor=db.users.find(u=>Number(u.id)===Number(l.user_id)); if(!pl||!actor)return;
    push({id:`playlist-like:${l.id}`,kind:'playlist_like',createdAt:l.created_at,actor:publicSocialUser(actor),playlist:{id:pl.id,name:pl.name},text:`${actor.name} лайкнул плейлист «${pl.name}».`});
  });
  db.chat_messages.filter(m=>Number(m.to_user_id)===me&&!m.read_at).forEach(m=>{
    const actor=db.users.find(u=>Number(u.id)===Number(m.from_user_id)); if(!actor)return;
    push({id:`chat:${m.id}`,kind:'chat',createdAt:m.created_at,actor:publicSocialUser(actor),text:`Новое сообщение от ${actor.name}.`});
  });
  items.sort(activitySortDesc);
  res.json({items:items.slice(0,60),unreadChat:items.filter(x=>x.kind==='chat').length, total:items.length});
});

app.get('/api/tracks', (req, res) => res.json({ tracks: sortTracksByPopularity(db.tracks).map(mapTrack) }));
app.post('/api/tracks/:id/listen', rateLimit(120, 60*1000), (req,res)=>{ const id=Number(req.params.id); const t=db.tracks.find(x=>Number(x.id)===id); if(!t) return res.status(404).json({error:'Трек не найден.'}); t.play_count=Number(t.play_count)||0; t.play_count += 1; const user=getOptionalUser(req); db.listen_history.push({id:nextId('listen_history'),user_id:user?.id||null,track_id:id,played_at:now()}); if(db.listen_history.length>50000) db.listen_history=db.listen_history.slice(-50000); saveDb(); res.json({ok:true, playCount:t.play_count}); });
app.get('/api/favorites', authRequired, (req,res)=>{
  const favorites = getFavoriteTracksForUser(req.user.id);
  const favoriteTrackIds = [...getFavoriteTrackIdsForUser(req.user.id)];
  res.json({ favorites, favoriteTrackIds });
});
app.post('/api/tracks/:id/favorite', authRequired, (req,res)=>{
  const trackId=Number(req.params.id);
  const track=db.tracks.find(x=>Number(x.id)===trackId);
  if(!track) return res.status(404).json({error:'Трек не найден.'});
  const existing=db.favorite_tracks.find(f=>Number(f.user_id)===Number(req.user.id) && Number(f.track_id)===trackId);
  let favorited=true;
  if(existing){
    db.favorite_tracks=db.favorite_tracks.filter(f=>!(Number(f.user_id)===Number(req.user.id) && Number(f.track_id)===trackId));
    favorited=false;
  }else{
    db.favorite_tracks.push({id:nextId('favorite_tracks'), user_id:Number(req.user.id), track_id:trackId, created_at:now()});
  }
  saveDb();
  const favorites = getFavoriteTracksForUser(req.user.id);
  const favoriteTrackIds = [...getFavoriteTrackIdsForUser(req.user.id)];
  res.json({ ok:true, favorited, track: mapTrack(track), favorites, favoriteTrackIds });
});

const bulkPreviewStore = new Map();
const BULK_PREVIEW_TTL_MS = 30 * 60 * 1000;
function cleanupBulkPreviews(){
  const cutoff=Date.now()-BULK_PREVIEW_TTL_MS;
  for(const [id,p] of bulkPreviewStore){
    if(p.createdAt < cutoff){
      try{if(p.zipPath)fs.unlinkSync(p.zipPath);}catch{}
      try{if(p.tempDir)fs.rmSync(p.tempDir,{recursive:true,force:true});}catch{}
      bulkPreviewStore.delete(id);
    }
  }
}
setInterval(cleanupBulkPreviews, 5*60*1000).unref();
function cleanMetaText(v){ return String(v||'').replace(/\0/g,'').trim(); }
const BULK_BAD_ALBUM_NAMES = new Set([
  'mp3lav.com','mp3fly.net','mp3fly','unknown','unknown album','новая музыка','new music','single','singles'
]);
function isUsefulAlbumName(value){
  const clean=cleanMetaText(value);
  if(!clean) return false;
  return !BULK_BAD_ALBUM_NAMES.has(clean.toLocaleLowerCase('ru-RU')) && !/^(?:https?:\/\/)?(?:www\.)?(mp3lav|mp3fly)\./i.test(clean);
}
function splitArtists(value){
  const raw=cleanMetaText(value);
  if(!raw) return [];
  // Collaboration credits should point to individual artist records.
  // Many downloaded tags use `Artist A/Artist B` for a collaboration.
  // Keep well-known slash-containing names such as AC/DC intact.
  const protectedNames=[];
  let normalized=raw
    .replace(/\bAC\s*\/\s*DC\b/ig, m=>{ const token=`__VENYL_ARTIST_${protectedNames.length}__`; protectedNames.push(m.replace(/\s*\/\s*/g,'/')); return token; })
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+/ig, ', ')
    .replace(/\s*\b(?:x|with)\s*/ig, ', ')
    .replace(/\s*[&+]\s*/g, ', ')
    .replace(/\s*\/\s*/g, ', ');
  normalized=normalized.replace(/__VENYL_ARTIST_(\d+)__/g,(_,i)=>protectedNames[Number(i)]);
  return normalized
    .split(/[,;|]+/)
    .map(x=>x.trim())
    .filter(Boolean)
    .filter((x,i,a)=>a.findIndex(y=>y.toLocaleLowerCase('ru-RU')===x.toLocaleLowerCase('ru-RU'))===i);
}

function splitTitleAndFeaturedArtists(title){
  const raw=cleanMetaText(title);
  const m=raw.match(/^(.*?)(?:\s*\((?:feat\.?|ft\.?|featuring)\s+([^()]+)\)|\s*\[(?:feat\.?|ft\.?|featuring)\s+([^\]]+)\]|\s+(?:feat\.?|ft\.?|featuring)\s+(.+))$/i);
  if(!m) return {title:raw,featured:[]};
  return {title:cleanMetaText(m[1]),featured:splitArtists(m[2]||m[3]||m[4]||'')};
}
function parseFilenameArtistsAndTitle(file){
  const base=path.basename(file,path.extname(file));
  const clean=base.replace(/[_]+/g,' ').replace(/\s+/g,' ').trim();
  const m=clean.match(/^(.+?)\s+-\s+(.+)$/);
  if(!m) return {artists:[],title:clean};
  const rawArtists=m[1].replace(/\s+(?:feat\.?|ft\.?|featuring)\s+/ig, ', ');
  const parsedTitle=splitTitleAndFeaturedArtists(m[2]);
  return {artists:splitArtists(rawArtists).concat(parsedTitle.featured),title:parsedTitle.title};
}
function relativeCoverForAudio(audioFile, allFiles){
  const dir=path.dirname(audioFile);
  const names=['cover.jpg','cover.jpeg','cover.png','cover.webp','folder.jpg','folder.jpeg','folder.png','folder.webp','front.jpg','front.jpeg','front.png','front.webp'];
  const local=names.map(n=>path.join(dir,n)).find(f=>fs.existsSync(f));
  if(local)return local;
  const root=names.map(n=>allFiles.find(f=>path.basename(f).toLowerCase()===n)).find(Boolean);
  return root || findFirstFile(allFiles,names);
}
function parseBulkLibrary(files){
  const audioFiles=files.filter(f=>/\.(mp3|wav|flac|ogg|m4a)$/i.test(f));
  const items=audioFiles.map(file=>{
    const meta=readId3Tags(file)||{};
    const fn=parseFilenameArtistsAndTitle(file);
    const metaTitle=cleanMetaText(meta.title);
    const titleParts=splitTitleAndFeaturedArtists(metaTitle || fn.title);
    const rawArtist=cleanMetaText(meta.artist||meta.albumArtist||'');
    let artists=splitArtists(rawArtist);
    if(!artists.length) artists=fn.artists.slice(0);
    artists=[...new Map(artists.concat(titleParts.featured, metaTitle ? [] : fn.artists).map(x=>[x.toLocaleLowerCase('ru-RU'),x])).values()];
    const primaryArtist=artists[0]||'Unknown Artist';
    const albumArtist=cleanMetaText(meta.albumArtist) && !/^(?:mp3lav|mp3fly)/i.test(cleanMetaText(meta.albumArtist)) ? splitArtists(meta.albumArtist)[0] : primaryArtist;
    const albumCandidate=cleanMetaText(meta.album);
    const album=isUsefulAlbumName(albumCandidate) ? albumCandidate : '';
    const title=titleParts.title || fn.title || path.basename(file,path.extname(file));
    const trackNumber=parseInt(String(meta.track||'').split('/')[0],10)||0;
    const discNumber=parseInt(String(meta.disc||'').split('/')[0],10)||0;
    const cover=relativeCoverForAudio(file,files);
    return {file,title,artists,artist:primaryArtist,albumArtist,album,genre:cleanMetaText(meta.genre),year:cleanMetaText(meta.year),trackNumber,discNumber,cover,relative:path.relative(path.dirname(files[0]||file),file)};
  });

  // Only create an album when a meaningful album tag exists AND at least two tracks
  // actually share that same album/album artist. Otherwise these are imported as tracks/singles.
  const albumCandidates=new Map();
  for(const item of items){
    if(!item.album) continue;
    const key=`${item.albumArtist.toLocaleLowerCase('ru-RU')}\u0000${item.album.toLocaleLowerCase('ru-RU')}`;
    if(!albumCandidates.has(key)) albumCandidates.set(key,[]);
    albumCandidates.get(key).push(item);
  }
  const validAlbumKeys=new Set([...albumCandidates.entries()].filter(([,arr])=>arr.length>=2).map(([k])=>k));
  for(const item of items){
    const key=`${item.albumArtist.toLocaleLowerCase('ru-RU')}\u0000${item.album.toLocaleLowerCase('ru-RU')}`;
    if(!validAlbumKeys.has(key)) item.album='';
  }

  const groups=new Map();
  for(const item of items){
    const key=item.album ? `album\u0000${item.albumArtist.toLocaleLowerCase('ru-RU')}\u0000${item.album.toLocaleLowerCase('ru-RU')}` : `single\u0000${item.file}`;
    if(!groups.has(key)) groups.set(key,{key,artist:item.albumArtist,album:item.album,genre:item.genre,cover:item.cover,tracks:[]});
    const g=groups.get(key);
    if(!g.cover&&item.cover)g.cover=item.cover;
    if(!g.genre&&item.genre)g.genre=item.genre;
    g.tracks.push(item);
  }
  for(const g of groups.values()) g.tracks.sort((a,b)=>a.discNumber-b.discNumber||a.trackNumber-b.trackNumber||a.file.localeCompare(b.file,'ru'));
  const warnings=[];
  const missingArtist=items.filter(x=>x.artist==='Unknown Artist').length;
  if(missingArtist)warnings.push(`${missingArtist} треков без исполнителя — будет создан Unknown Artist.`);
  const realAlbums=[...new Set(items.filter(x=>x.album).map(x=>`${x.albumArtist}\u0000${x.album}`))].length;
  warnings.push(`Импортировано как треки: ${items.length}. Реальных альбомных групп: ${realAlbums}. Одиночные треки альбом не создают.`);
  const seen=new Set(),duplicates=[];
  for(const x of items){
    const key=[x.artist,x.album,x.title].map(v=>v.toLocaleLowerCase('ru-RU')).join('\u0000');
    if(seen.has(key))duplicates.push(x); else seen.add(key);
  }
  if(duplicates.length)warnings.push(`${duplicates.length} возможных дубликатов внутри архива.`);
  return {items,groups:[...groups.values()],warnings};
}
function bulkPreviewResponse(parsed){
  return {
    totalTracks:parsed.items.length,
    artists:[...new Set(parsed.items.map(x=>x.albumArtist))].sort((a,b)=>a.localeCompare(b,'ru')),
    albums:parsed.groups.map(g=>({artist:g.artist,album:g.album,count:g.tracks.length,cover:!!g.cover,tracks:g.tracks.map(t=>({title:t.title,artist:t.artists.join(', '),album:t.album,genre:t.genre,trackNumber:t.trackNumber,discNumber:t.discNumber}))})),
    warnings:parsed.warnings
  };
}
async function receiveBulkZip(req,res,next){
  zipUpload.single('album_zip')(req,res,err=>{ if(err)return res.status(400).json({error:err.message||'Не удалось загрузить ZIP.'}); next(); });
}

app.post('/api/albums/import-preview', authRequired, adminOnly, receiveBulkZip, async (req,res)=>{
  const zipPath=req.file?.path; let tempDir='';
  try{
    if(!zipPath)return res.status(400).json({error:'Выбери ZIP-архив.'});
    tempDir=path.join(importsDir,`preview_${Date.now()}_${Math.random().toString(36).slice(2,8)}`); fs.mkdirSync(tempDir,{recursive:true});
    await extractZipSafe(zipPath,tempDir);
    const files=walkFiles(tempDir), parsed=parseBulkLibrary(files);
    if(!parsed.items.length)throw new Error('В ZIP не найдено аудио.');
    const previewId=crypto.randomUUID();
    bulkPreviewStore.set(previewId,{createdAt:Date.now(),zipPath,tempDir,parsed});
    res.json({ok:true,previewId,preview:bulkPreviewResponse(parsed)});
    tempDir='';
  }catch(e){res.status(400).json({error:e.message||'Не удалось прочитать ZIP.'}); try{if(zipPath)fs.unlinkSync(zipPath);}catch{} try{if(tempDir)fs.rmSync(tempDir,{recursive:true,force:true});}catch{}}
});

async function importBulkPreview(previewId, userId){
  const entry=bulkPreviewStore.get(previewId);
  if(!entry)throw new Error('Предпросмотр устарел. Выбери ZIP ещё раз.');
  const {parsed,tempDir}=entry;
  const created=[], skipped=[], createdGroups=[];
  for(const group of parsed.groups){
    const artistNames=splitArtists(group.artist||'Unknown Artist');
    const albumArtistName=artistNames[0]||'Unknown Artist';
    const mainArtist=ensureArtist(albumArtistName);
    let album=group.album ? ensureAlbum(mainArtist.id,group.album,'') : null;
    let groupCoverPath='';
    if(group.cover){
      const ext=path.extname(group.cover).toLowerCase()||'.jpg';
      const coverName=`${Date.now()}_${sanitizeBase(`${albumArtistName}-${group.album}`)}${ext}`;
      const coverDir=album ? albumsDir : coversDir;
      fs.copyFileSync(group.cover,path.join(coverDir,coverName));
      groupCoverPath=coverName;
      if(album)album.cover_path=coverName;
    }
    if(album)createdGroups.push({artist:mainArtist.name,album:album.name,count:group.tracks.length});
    for(const item of group.tracks){
      const artists=[...new Map((item.artists.length?item.artists:[albumArtistName]).map(name=>[String(name).toLocaleLowerCase('ru-RU'),ensureArtist(name)])).values()];
      const main=artists[0]||mainArtist;
      const duplicate=db.tracks.find(t=>String(t.title||'').toLocaleLowerCase('ru-RU')===item.title.toLocaleLowerCase('ru-RU') && String(t.artist||'').toLocaleLowerCase('ru-RU')===artists.map(a=>a.name).join(', ').toLocaleLowerCase('ru-RU') && String(t.album||'').toLocaleLowerCase('ru-RU')===String(group.album||'').toLocaleLowerCase('ru-RU'));
      if(duplicate){skipped.push({title:item.title,artist:item.artists.join(', '),reason:'Уже существует'});continue;}
      const ext=path.extname(item.file).toLowerCase()||'.mp3';
      const destName=`${Date.now()}_${Math.random().toString(36).slice(2,8)}_${sanitizeBase(`${item.trackNumber||created.length+1}-${item.title}`)}${ext}`;
      const dest=path.join(tracksDir,destName); fs.copyFileSync(item.file,dest);
      const tr={id:nextId('tracks'),title:item.title,artist:artists.map(a=>a.name).join(', '),artist_id:main.id,album:album?album.name:'',album_id:album?album.id:null,genre:item.genre||group.genre||'',play_count:0,cover_path:album?.cover_path||groupCoverPath||'',audio_path:destName,uploaded_by_user_id:userId,created_at:now()};
      db.tracks.push(tr);syncTrackArtists(tr.id,artists);created.push(mapTrack(tr));
    }
  }
  saveDb();
  return {created,skipped,groups:createdGroups,total:parsed.items.length};
}

app.post('/api/albums/import-preview/commit', authRequired, adminOnly, async (req,res)=>{
  try{
    const previewId=String(req.body.previewId||''); if(!previewId)return res.status(400).json({error:'Предпросмотр не найден.'});
    const result=await importBulkPreview(previewId,req.user.id);
    const entry=bulkPreviewStore.get(previewId); bulkPreviewStore.delete(previewId);
    try{if(entry?.zipPath)fs.unlinkSync(entry.zipPath);}catch{} try{if(entry?.tempDir)fs.rmSync(entry.tempDir,{recursive:true,force:true});}catch{}
    res.json({ok:true,count:result.created.length,skipped:result.skipped.length,groups:result.groups,tracks:result.created,skippedTracks:result.skipped,total:result.total});
  }catch(e){res.status(400).json({error:e.message||'Не удалось импортировать музыку.'});}
});

// Backwards-compatible endpoint: direct ZIP import now uses the same universal grouping engine.
app.post('/api/albums/import-zip', authRequired, adminOnly, receiveBulkZip, async (req,res)=>{
  const zipPath=req.file?.path; let tempDir='';
  try{
    if(!zipPath)return res.status(400).json({error:'Выбери ZIP-архив.'});
    tempDir=path.join(importsDir,`direct_${Date.now()}_${Math.random().toString(36).slice(2,8)}`); fs.mkdirSync(tempDir,{recursive:true}); await extractZipSafe(zipPath,tempDir);
    const parsed=parseBulkLibrary(walkFiles(tempDir)); if(!parsed.items.length)throw new Error('В ZIP не найдено аудио.');
    const id=crypto.randomUUID(); bulkPreviewStore.set(id,{createdAt:Date.now(),zipPath,tempDir,parsed});
    const result=await importBulkPreview(id,req.user.id); bulkPreviewStore.delete(id);
    res.json({ok:true,count:result.created.length,skipped:result.skipped.length,groups:result.groups,tracks:result.created,skippedTracks:result.skipped,total:result.total});
    tempDir='';
  }catch(e){res.status(400).json({error:e.message||'Не удалось импортировать музыку.'});}
  finally{try{if(zipPath)fs.unlinkSync(zipPath);}catch{} try{if(tempDir)fs.rmSync(tempDir,{recursive:true,force:true});}catch{}}
});

app.post('/api/tracks/upload', authRequired, adminOnly, uploadLimiter, upload.fields([{name:'audio',maxCount:1},{name:'cover',maxCount:1}]), (req,res)=>{ try{ const title=String(req.body.title||'').trim(), artistName=String(req.body.artist||'').trim(), albumName=String(req.body.album||'').trim(), genre=String(req.body.genre||'').trim(); const audioFile=req.files?.audio?.[0], coverFile=req.files?.cover?.[0]; if(!title||!artistName||!audioFile){ cleanupRequestFiles(req); return res.status(400).json({error:'Укажи название, артиста и аудиофайл.'}); } const artists=ensureArtists(artistName), main=artists[0], album=albumName?ensureAlbum(main.id, albumName):null; const tr={id:nextId('tracks'), title, artist:artists.map(a=>a.name).join(', '), artist_id:main.id, album:album?album.name:albumName, album_id:album?album.id:null, genre, play_count:0, cover_path:coverFile?path.basename(coverFile.filename):(album?.cover_path||''), audio_path:path.basename(audioFile.filename), uploaded_by_user_id:req.user.id, created_at:now()}; db.tracks.push(tr); syncTrackArtists(tr.id, artists); saveDb(); res.json({ok:true, track:mapTrack(tr)}); }catch(e){ cleanupRequestFiles(req); res.status(500).json({error:e.message||'Не удалось загрузить трек.'}); } });
app.delete('/api/tracks/:id', authRequired, adminOnly, (req,res)=>{ const id=Number(req.params.id); const t=db.tracks.find(x=>Number(x.id)===id); if(!t) return res.status(404).json({error:'Трек не найден.'}); deleteFileSafe(path.join(tracksDir,t.audio_path)); if(t.cover_path){ deleteFileSafe(path.join(coversDir,t.cover_path)); invalidateCoverCache(t.cover_path); } db.tracks=db.tracks.filter(x=>Number(x.id)!==id); db.track_artists=db.track_artists.filter(x=>Number(x.track_id)!==id); db.favorite_tracks=db.favorite_tracks.filter(x=>Number(x.track_id)!==id); db.playlist_tracks=db.playlist_tracks.filter(x=>Number(x.track_id)!==id); db.listen_history=db.listen_history.filter(x=>Number(x.track_id)!==id); db.comments=db.comments.filter(x=>Number(x.track_id)!==id); saveDb(); res.json({ok:true}); });
app.put('/api/tracks/:id', authRequired, adminOnly, coverUploadLimiter, upload.single('cover'), (req,res)=>{ const id=Number(req.params.id); const t=db.tracks.find(x=>Number(x.id)===id); if(!t){ if(req.file) deleteFileSafe(req.file.path); return res.status(404).json({error:'Трек не найден.'}); } const title=String(req.body.title||t.title).trim(), artistNames=String(req.body.artist||t.artist).trim(), albumName=String(req.body.album||'').trim(), genre=String(req.body.genre||'').trim(); const artists=ensureArtists(artistNames), main=artists[0], album=albumName?ensureAlbum(main.id, albumName):null; const oldCover=t.cover_path||''; const oldAlbumId=t.album_id||null; Object.assign(t,{title, artist:artists.map(a=>a.name).join(', '), artist_id:main.id, album:album?album.name:albumName, album_id:album?album.id:null, genre}); if(req.file){ if(oldCover && (!oldAlbumId || !db.albums.some(a=>Number(a.id)===Number(oldAlbumId) && String(a.cover_path||'')===String(oldCover)))) { deleteFileSafe(path.join(coversDir,oldCover)); invalidateCoverCache(oldCover); } t.cover_path=path.basename(req.file.filename); } else if(!t.cover_path && album?.cover_path) t.cover_path=album.cover_path; syncTrackArtists(id, artists); saveDb(); res.json({ok:true, track:mapTrack(t)}); });



app.get('/api/discover', rateLimit(60, 60*1000), (req,res)=>{
  const limit=(n,arr)=>arr.slice(0,n);
  const tracks=[...db.tracks].sort((a,b)=>(Number(b.play_count)||0)-(Number(a.play_count)||0)||Number(b.id)-Number(a.id));
  const newTracks=[...db.tracks].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)||Number(b.id)-Number(a.id));
  const artistPlayCounts=new Map();
  for(const t of db.tracks){
    const count=Number(t.play_count)||0;
    getTrackArtistsForMap(t).forEach(a=>artistPlayCounts.set(Number(a.id),(artistPlayCounts.get(Number(a.id))||0)+count));
  }
  const artists=[...db.artists].sort((a,b)=>(artistPlayCounts.get(Number(b.id))||0)-(artistPlayCounts.get(Number(a.id))||0)||Number(b.id)-Number(a.id)).slice(0,12).map(mapArtist);
  const albums=[...db.albums].map(a=>({row:a,plays:db.tracks.filter(t=>Number(t.album_id)===Number(a.id)).reduce((n,t)=>n+(Number(t.play_count)||0),0)})).sort((a,b)=>b.plays-a.plays||Number(b.row.id)-Number(a.row.id)).slice(0,12).map(x=>mapAlbum(x.row));
  res.json({
    trending:limit(12,tracks).map(t=>mapTrack(t)),
    newReleases:limit(12,newTracks).map(t=>mapTrack(t)),
    popularArtists:artists,
    popularAlbums:albums
  });
});

app.get('/api/search', rateLimit(60, 60*1000), (req,res)=>{
  const q=String(req.query.q||'').trim().toLowerCase();
  if(q.length<2) return res.json({tracks:[],artists:[],albums:[]});
  const tokens=q.split(/\s+/).filter(Boolean);
  const scoreText=(text)=>{
    const hay=String(text||'').toLowerCase();
    let score=0;
    if(hay===q) score+=100;
    if(hay.startsWith(q)) score+=60;
    if(hay.includes(q)) score+=30;
    for(const token of tokens) if(hay.includes(token)) score+=8;
    return score;
  };
  const tracks=db.tracks.map(t=>({row:t,score:scoreText([t.title,t.artist,t.album,t.genre].join(' '))})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score || (Number(b.row.play_count)||0)-(Number(a.row.play_count)||0)).slice(0,12).map(x=>mapTrack(x.row));
  const artists=db.artists.map(a=>({row:a,score:scoreText([a.name,a.bio].join(' '))})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>mapArtist(x.row));
  const albums=db.albums.map(a=>({row:a,score:scoreText([a.name,a.description].join(' '))})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>mapAlbum(x.row));
  res.json({tracks,artists,albums});
});

app.get('/api/history', authRequired, (req,res)=>{
  const rows=db.listen_history.filter(x=>Number(x.user_id)===Number(req.user.id)).sort((a,b)=>new Date(b.played_at||0)-new Date(a.played_at||0) || Number(b.id)-Number(a.id)).slice(0,100);
  const history=rows.map(row=>{ const t=db.tracks.find(x=>Number(x.id)===Number(row.track_id)); return t?{...mapTrack(t),playedAt:row.played_at}:null; }).filter(Boolean);
  res.json({history});
});

app.get('/api/me/stats', authRequired, (req,res)=>{
  const rows=db.listen_history.filter(x=>Number(x.user_id)===Number(req.user.id));
  const byTrack=new Map();
  const byGenre=new Map();
  for(const row of rows){
    const t=db.tracks.find(x=>Number(x.id)===Number(row.track_id));
    if(!t) continue;
    byTrack.set(Number(t.id),(byTrack.get(Number(t.id))||0)+1);
    for(const g of String(t.genre||'').split(',').map(v=>v.trim()).filter(Boolean)) byGenre.set(g,(byGenre.get(g)||0)+1);
  }
  const estimatedMinutes=Math.round(rows.length*3.5);
  res.json({stats:{plays:rows.length,uniqueTracks:byTrack.size,minutes:estimatedMinutes,minutesEstimated:true,genres:[...byGenre.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,plays])=>({name,plays}))}});

});

app.get('/api/me/wrapped', authRequired, (req,res)=>{
  const uid=Number(req.user.id);
  const history=db.listen_history.filter(h=>Number(h.user_id)===uid);
  const byTrack=new Map(db.tracks.map(t=>[Number(t.id),t]));
  const counts=new Map(); for(const h of history){const id=Number(h.track_id); counts.set(id,(counts.get(id)||0)+1);}
  const topTracks=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,plays])=>{const t=byTrack.get(id);return t?{...mapTrack(t),plays}:null}).filter(Boolean);
  const artistCounts=new Map(); for(const [id,plays] of counts){const t=byTrack.get(id); if(!t)continue; artistCounts.set(t.artist,(artistCounts.get(t.artist)||0)+plays);}
  const topArtists=[...artistCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,plays])=>({name,plays}));
  const genreCounts=new Map(); for(const [id,plays] of counts){const t=byTrack.get(id); if(!t)continue; const g=String(t.genre||'').split(',')[0].trim(); if(g)genreCounts.set(g,(genreCounts.get(g)||0)+plays);}
  const topGenres=[...genreCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,plays])=>({name,plays}));
  const minutes=Math.round(history.reduce((sum,h)=>sum+Number(byTrack.get(Number(h.track_id))?.duration_seconds||180),0)/60);
  const favoriteCount=db.favorite_tracks.filter(f=>Number(f.user_id)===uid).length;
  const days=new Map(); history.forEach(h=>{const d=String(h.played_at||'').slice(0,10); if(d)days.set(d,(days.get(d)||0)+1);});
  const bestDay=[...days.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  res.json({stats:{plays:history.length,uniqueTracks:counts.size,minutes,favoriteCount,bestDay,topTracks,topArtists,topGenres}});
});

app.get('/api/recommendations', authRequired, (req,res)=>{
  const userId=Number(req.user.id);
  const favIds=getFavoriteTrackIdsForUser(userId);
  const history=db.listen_history
    .filter(x=>Number(x.user_id)===userId)
    .sort((a,b)=>new Date(a.played_at||0)-new Date(b.played_at||0));
  const genreScore=new Map(), artistScore=new Map(), playCounts=new Map();
  const seen=new Set();

  const addSignals=(t,genreWeight,artistWeight)=>{
    for(const g of String(t.genre||'').split(',').map(v=>v.trim()).filter(Boolean)) genreScore.set(g,(genreScore.get(g)||0)+genreWeight);
    for(const a of getTrackArtistsForMap(t)) artistScore.set(Number(a.id),(artistScore.get(Number(a.id))||0)+artistWeight);
  };

  for(const id of favIds){
    const t=db.tracks.find(x=>Number(x.id)===Number(id));
    if(!t) continue;
    seen.add(Number(t.id));
    addSignals(t,7,9);
  }

  history.forEach((row,idx)=>{
    const t=db.tracks.find(x=>Number(x.id)===Number(row.track_id));
    if(!t) return;
    const id=Number(t.id);
    playCounts.set(id,(playCounts.get(id)||0)+1);
    seen.add(id);
    const recency=1+(idx/Math.max(1,history.length))*3;
    addSignals(t,recency,recency*2.4);
  });

  const exclude=new Set(String(req.query.exclude||'').split(',').map(Number).filter(Boolean));
  const genreTop=[...genreScore.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name])=>name);
  const genreSet=new Set(genreTop.map(x=>String(x).toLowerCase()));
  const coldStart=history.length===0 && favIds.size===0;

  const candidates=db.tracks.filter(t=>{
    const id=Number(t.id);
    return !exclude.has(id) && !favIds.has(id);
  }).map(t=>{
    const id=Number(t.id);
    const genres=String(t.genre||'').split(',').map(v=>v.trim()).filter(Boolean);
    const artists=getTrackArtistsForMap(t).map(a=>Number(a.id)).filter(Boolean);
    let score=Math.log1p(Number(t.play_count)||0)*0.8;
    const reasons=[];
    let matchedGenre=false, matchedArtist=false;
    if(coldStart){
      score += Math.min(10,Math.log1p(Number(t.play_count)||0)*1.8);
      reasons.push('Популярно в Venyl');
    }
    for(const g of genres){
      const gs=genreScore.get(g)||0;
      if(gs>0){score+=gs*1.9; matchedGenre=true;}
      if(genreSet.has(String(g).toLowerCase())) score+=2.5;
    }
    for(const a of artists){
      const as=artistScore.get(a)||0;
      if(as>0){score+=as; matchedArtist=true;}
    }
    const repeats=playCounts.get(id)||0;
    if(repeats) score-=Math.min(7,repeats*1.8);
    if(seen.has(id)) score-=3.2;
    const ageDays=Math.max(0,(Date.now()-new Date(t.created_at||Date.now()).getTime())/86400000);
    if(ageDays<45){score+=Math.max(0,6-ageDays/8); if(!coldStart) reasons.push('Новый релиз');}
    if(matchedArtist) reasons.push('Похожий артист');
    else if(matchedGenre) reasons.push('Твой жанр');
    return {t,score,reasons};
  }).sort((a,b)=>b.score-a.score || (Number(b.t.play_count)||0)-(Number(a.t.play_count)||0) || Number(b.t.id)-Number(a.t.id));

  const picked=[], artistCounts=new Map(), genreCounts=new Map();
  for(const item of candidates){
    const artists=getTrackArtistsForMap(item.t).map(a=>Number(a.id)).filter(Boolean);
    const genres=String(item.t.genre||'').split(',').map(v=>v.trim()).filter(Boolean);
    const maxArtist=artists.reduce((m,id)=>Math.max(m,artistCounts.get(id)||0),0);
    const topGenreCount=genres.reduce((m,g)=>Math.max(m,genreCounts.get(g)||0),0);
    if(picked.length<12 && maxArtist>=3) continue;
    if(picked.length<10 && topGenreCount>=5) continue;
    const track=mapTrack(item.t);
    track.reason=item.reasons[0]||'Подобрано для тебя';
    picked.push(track);
    artists.forEach(id=>artistCounts.set(id,(artistCounts.get(id)||0)+1));
    genres.forEach(g=>genreCounts.set(g,(genreCounts.get(g)||0)+1));
    if(picked.length>=20) break;
  }
  res.json({tracks:picked,meta:{coldStart,topGenres:genreTop}});
});

app.get('/api/tracks/:id/comments', (req,res)=>{
  const trackId=Number(req.params.id);
  if(!db.tracks.some(t=>Number(t.id)===trackId)) return res.status(404).json({error:'Трек не найден.'});
  const comments=db.comments.filter(c=>Number(c.track_id)===trackId).sort((a,b)=>new Date(a.created_at||0)-new Date(b.created_at||0)).slice(-100).map(c=>{const u=db.users.find(x=>Number(x.id)===Number(c.user_id)); return {id:c.id,text:c.text,createdAt:c.created_at,user:u?{id:u.id,name:u.name,avatarUrl:u.avatar_path?`/uploads/avatars/${u.avatar_path}`:'',nicknameColor:u.nickname_color||''}:null};});
  res.json({comments});
});
app.post('/api/tracks/:id/comments', authRequired, express.json(), rateLimit(30, 60*1000), (req,res)=>{
  const trackId=Number(req.params.id), text=String(req.body.text||'').trim();
  if(!db.tracks.some(t=>Number(t.id)===trackId)) return res.status(404).json({error:'Трек не найден.'});
  if(!text) return res.status(400).json({error:'Комментарий не может быть пустым.'});
  if(text.length>1000) return res.status(400).json({error:'Комментарий слишком длинный.'});
  const c={id:nextId('comments'),track_id:trackId,user_id:Number(req.user.id),text,created_at:now()}; db.comments.push(c); saveDb();
  res.json({ok:true,comment:{id:c.id,text:c.text,createdAt:c.created_at,user:{id:req.user.id,name:req.user.name,avatarUrl:req.user.avatar_path?`/uploads/avatars/${req.user.avatar_path}`:'',nicknameColor:req.user.nickname_color||''}}});
});
app.delete('/api/comments/:id', authRequired, (req,res)=>{
  const id=Number(req.params.id), c=db.comments.find(x=>Number(x.id)===id);
  if(!c) return res.status(404).json({error:'Комментарий не найден.'});
  if(Number(c.user_id)!==Number(req.user.id) && !isAdminUser(req.user)) return res.status(403).json({error:'Недостаточно прав.'});
  db.comments=db.comments.filter(x=>Number(x.id)!==id); saveDb(); res.json({ok:true});
});

app.get('/api/playlists', authRequired, (req,res)=>{
  const playlists = db.playlists
    .filter(p=>Number(p.user_id)===Number(req.user.id) || !!isPlaylistCollaborator(req.user.id,p.id))
    .sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0) || (Number(b.id)||0)-(Number(a.id)||0))
    .map(mapPlaylist);
  res.json({ playlists });
});
app.post('/api/playlists', authRequired, uploadLimiter, upload.single('playlist_cover'), (req,res)=>{
  try{
    const name=String(req.body.name||'').trim();
    if(!name){ if(req.file) deleteFileSafe(req.file.path); return res.status(400).json({error:'Укажи название плейлиста.'}); }
    const pl={id:nextId('playlists'), user_id:Number(req.user.id), name, cover_path:req.file?path.basename(req.file.filename):'', is_public:false, created_at:now(), updated_at:now()};
    db.playlists.push(pl); saveDb();
    res.json({ok:true, playlist:mapPlaylist(pl), playlists:db.playlists.filter(p=>Number(p.user_id)===Number(req.user.id)).map(mapPlaylist)});
  }catch(e){ if(req.file) deleteFileSafe(req.file.path); res.status(500).json({error:e.message||'Не удалось создать плейлист.'}); }
});
app.get('/api/playlists/:id', authRequired, (req,res)=>{
  const pl=getUserPlaylist(req.user.id, req.params.id);
  if(!pl) return res.status(404).json({error:'Плейлист не найден или недоступен.'});
  res.json({ playlist:mapPlaylist(pl), tracks:getPlaylistTracks(pl.id) });
});
app.put('/api/playlists/:id', authRequired, uploadLimiter, upload.single('playlist_cover'), (req,res)=>{
  try{
    const pl=getEditablePlaylist(req.user.id, req.params.id);
    if(!pl){ if(req.file) deleteFileSafe(req.file.path); return res.status(404).json({error:'Плейлист не найден или недоступен.'}); }
    const name=String(req.body.name??pl.name).trim();
    if(!name){ if(req.file) deleteFileSafe(req.file.path); return res.status(400).json({error:'Название плейлиста не может быть пустым.'}); }
    pl.name=name;
    if(req.file){ if(pl.cover_path) deleteFileSafe(path.join(playlistCoversDir, pl.cover_path)); pl.cover_path=path.basename(req.file.filename); }
    if(Object.prototype.hasOwnProperty.call(req.body,'isPublic')){
      const raw=String(req.body.isPublic).toLowerCase();
      pl.is_public=raw==='true'||raw==='1'||raw==='on';
    }
    pl.updated_at=now(); saveDb();
    res.json({ok:true, playlist:mapPlaylist(pl), tracks:getPlaylistTracks(pl.id)});
  }catch(e){ if(req.file) deleteFileSafe(req.file.path); res.status(500).json({error:e.message||'Не удалось обновить плейлист.'}); }
});
app.delete('/api/playlists/:id', authRequired, (req,res)=>{
  const pl=getUserPlaylist(req.user.id, req.params.id);
  if(!pl) return res.status(404).json({error:'Плейлист не найден или недоступен.'});
  if(pl.cover_path) deleteFileSafe(path.join(playlistCoversDir, pl.cover_path));
  db.playlist_tracks=db.playlist_tracks.filter(x=>Number(x.playlist_id)!==Number(pl.id));
  db.playlists=db.playlists.filter(x=>Number(x.id)!==Number(pl.id));
  db.playlist_likes=db.playlist_likes.filter(x=>Number(x.playlist_id)!==Number(pl.id));
  db.playlist_collaborators=db.playlist_collaborators.filter(x=>Number(x.playlist_id)!==Number(pl.id));
  saveDb(); res.json({ok:true, playlists:db.playlists.filter(p=>Number(p.user_id)===Number(req.user.id)).map(mapPlaylist)});
});
app.post('/api/playlists/:id/tracks', authRequired, express.json(), (req,res)=>{
  const pl=getEditablePlaylist(req.user.id, req.params.id);
  if(!pl) return res.status(404).json({error:'Плейлист не найден или недоступен.'});
  const trackId=Number(req.body.trackId);
  const track=db.tracks.find(t=>Number(t.id)===trackId);
  if(!track) return res.status(404).json({error:'Трек не найден.'});
  let item=db.playlist_tracks.find(x=>Number(x.playlist_id)===Number(pl.id) && Number(x.track_id)===trackId);
  if(!item){
    const maxPos=db.playlist_tracks.filter(x=>Number(x.playlist_id)===Number(pl.id)).reduce((m,x)=>Math.max(m, Number(x.position)||0),0);
    item={id:nextId('playlist_tracks'), playlist_id:Number(pl.id), track_id:trackId, position:maxPos+1, created_at:now()};
    db.playlist_tracks.push(item);
  }
  pl.updated_at=now(); saveDb();
  res.json({ok:true, playlist:mapPlaylist(pl), tracks:getPlaylistTracks(pl.id)});
});
app.delete('/api/playlists/:id/tracks/:trackId', authRequired, (req,res)=>{
  const pl=getEditablePlaylist(req.user.id, req.params.id);
  if(!pl) return res.status(404).json({error:'Плейлист не найден или недоступен.'});
  db.playlist_tracks=db.playlist_tracks.filter(x=>!(Number(x.playlist_id)===Number(pl.id) && Number(x.track_id)===Number(req.params.trackId)));
  normalizePlaylistPositions(pl.id); pl.updated_at=now(); saveDb();
  res.json({ok:true, playlist:mapPlaylist(pl), tracks:getPlaylistTracks(pl.id)});
});
app.put('/api/playlists/:id/reorder', authRequired, express.json(), (req,res)=>{
  const pl=getEditablePlaylist(req.user.id, req.params.id);
  if(!pl) return res.status(404).json({error:'Плейлист не найден или недоступен.'});
  const ids=Array.isArray(req.body.trackIds)?req.body.trackIds.map(Number).filter(Boolean):[];
  const current=db.playlist_tracks.filter(x=>Number(x.playlist_id)===Number(pl.id));
  const currentIds=new Set(current.map(x=>Number(x.track_id)));
  if(ids.length!==current.length || ids.some(id=>!currentIds.has(id))) return res.status(400).json({error:'Неверный порядок треков.'});
  ids.forEach((trackId, idx)=>{ const item=current.find(x=>Number(x.track_id)===trackId); if(item) item.position=idx+1; });
  pl.updated_at=now(); saveDb();
  res.json({ok:true, playlist:mapPlaylist(pl), tracks:getPlaylistTracks(pl.id)});
});



app.get('/api/playlists/:id/collaborators', authRequired, (req,res)=>{
  const pl=db.playlists.find(x=>Number(x.id)===Number(req.params.id));
  if(!pl) return res.status(404).json({error:'Плейлист не найден.'});
  const me=Number(req.user.id);
  if(Number(pl.user_id)!==me && !isPlaylistCollaborator(me,pl.id)) return res.status(403).json({error:'Нет доступа.'});
  const owner=db.users.find(u=>Number(u.id)===Number(pl.user_id));
  const collaborators=getPlaylistCollaborators(pl.id).map(c=>{const u=db.users.find(x=>Number(x.id)===Number(c.user_id)); return {userId:c.user_id,name:u?.name||'Пользователь',avatarUrl:u?.avatar_path?`/uploads/avatars/${u.avatar_path}`:'',role:'editor',createdAt:c.created_at||''};});
  res.json({owner:owner?{userId:owner.id,name:owner.name,avatarUrl:owner.avatar_path?`/uploads/avatars/${owner.avatar_path}`:''}:null,collaborators});
});
app.post('/api/playlists/:id/collaborators', authRequired, express.json(), (req,res)=>{
  const pl=db.playlists.find(x=>Number(x.id)===Number(req.params.id));
  if(!pl) return res.status(404).json({error:'Плейлист не найден.'});
  if(Number(pl.user_id)!==Number(req.user.id)) return res.status(403).json({error:'Только владелец может добавлять участников.'});
  const targetId=Number(req.body.userId);
  const target=db.users.find(u=>Number(u.id)===targetId);
  if(!target || targetId===Number(pl.user_id)) return res.status(400).json({error:'Пользователь не найден или уже является владельцем.'});
  if(isPlaylistCollaborator(targetId,pl.id)) return res.status(409).json({error:'Пользователь уже участник.'});
  db.playlist_collaborators.push({id:nextId('playlist_collaborators'),playlist_id:Number(pl.id),user_id:targetId,role:'editor',created_at:now()});
  pl.updated_at=now(); saveDb();
  res.json({ok:true,collaborators:getPlaylistCollaborators(pl.id)});
});
app.delete('/api/playlists/:id/collaborators/:userId', authRequired, (req,res)=>{
  const pl=db.playlists.find(x=>Number(x.id)===Number(req.params.id));
  if(!pl) return res.status(404).json({error:'Плейлист не найден.'});
  const me=Number(req.user.id), targetId=Number(req.params.userId);
  if(me!==Number(pl.user_id)) return res.status(403).json({error:'Только владелец может управлять участниками.'});
  db.playlist_collaborators=db.playlist_collaborators.filter(c=>!(Number(c.playlist_id)===Number(pl.id)&&Number(c.user_id)===targetId));
  pl.updated_at=now(); saveDb(); res.json({ok:true});
});

app.get('/api/users/:id/public-playlists', (req,res)=>{
  const id=Number(req.params.id); if(!db.users.some(u=>Number(u.id)===id)) return res.status(404).json({error:'Пользователь не найден.'});
  res.json({playlists:db.playlists.filter(p=>Number(p.user_id)===id&&!!p.is_public).map(mapPlaylist)});
});
app.put('/api/playlists/:id/visibility', authRequired, express.json(), (req,res)=>{
  const pl=getUserPlaylist(req.user.id, req.params.id); if(!pl) return res.status(404).json({error:'Плейлист не найден.'});
  pl.is_public=Boolean(req.body.isPublic); pl.updated_at=now(); saveDb(); res.json({ok:true,playlist:mapPlaylist(pl)});
});
app.get('/api/public/playlists/:id', (req,res)=>{
  const pl=db.playlists.find(x=>Number(x.id)===Number(req.params.id)&&!!x.is_public); if(!pl) return res.status(404).json({error:'Публичный плейлист не найден.'});
  const u=db.users.find(x=>Number(x.id)===Number(pl.user_id)); res.json({playlist:mapPlaylist(pl),tracks:getPlaylistTracks(pl.id),owner:u?{id:u.id,name:u.name,avatarUrl:u.avatar_path?`/uploads/avatars/${u.avatar_path}`:'',bio:u.bio||''}:null});
});
app.post('/api/public/playlists/:id/like', authRequired, (req,res)=>{
  const pl=db.playlists.find(x=>Number(x.id)===Number(req.params.id)&&!!x.is_public); if(!pl) return res.status(404).json({error:'Публичный плейлист не найден.'});
  const me=Number(req.user.id); const existing=db.playlist_likes.find(x=>Number(x.playlist_id)===Number(pl.id)&&Number(x.user_id)===me); let liked=true;
  if(existing){ db.playlist_likes=db.playlist_likes.filter(x=>!(Number(x.playlist_id)===Number(pl.id)&&Number(x.user_id)===me)); liked=false; } else db.playlist_likes.push({id:nextId('playlist_likes'),playlist_id:Number(pl.id),user_id:me,created_at:now()});
  saveDb(); res.json({ok:true,liked,likeCount:db.playlist_likes.filter(x=>Number(x.playlist_id)===Number(pl.id)).length});
});

app.get('/api/artists', (req,res)=>{
  let currentUser = null;
  try {
    const p = jwt.verify(req.cookies.venyl_token || '', JWT_SECRET);
    currentUser = db.users.find(x => Number(x.id) === Number(p.id)) || null;
  } catch {}
  const artists=[...db.artists].sort((a,b)=>String(a.name).localeCompare(String(b.name),'ru'));
  res.json({ artists: artists.map(a=>enrichArtist(a, currentUser?.id || null)) });
});
app.get('/api/artists/feed', authRequired, (req,res)=>{
  const subscribedArtists = getSubscribedArtistsForUser(req.user.id);
  const tracks = getSubscribedTracksForUser(req.user.id);
  res.json({ subscribedArtists, tracks });
});
app.post('/api/artists/:id/subscribe', authRequired, (req,res)=>{
  const artistId=Number(req.params.id);
  const artist=db.artists.find(a=>Number(a.id)===artistId);
  if(!artist) return res.status(404).json({error:'Артист не найден.'});
  let sub=db.subscriptions.find(s=>Number(s.user_id)===Number(req.user.id) && Number(s.artist_id)===artistId);
  let subscribed=true;
  if(sub){
    db.subscriptions=db.subscriptions.filter(s=>!(Number(s.user_id)===Number(req.user.id) && Number(s.artist_id)===artistId));
    subscribed=false;
  }else{
    sub={id:nextId('subscriptions'), user_id:Number(req.user.id), artist_id:artistId, created_at:now()};
    db.subscriptions.push(sub);
  }
  saveDb();
  const subscribedArtists = getSubscribedArtistsForUser(req.user.id);
  const tracks = getSubscribedTracksForUser(req.user.id);
  res.json({ ok:true, subscribed, artist: enrichArtist(artist, req.user.id), subscribedArtists, tracks });
});
app.get('/api/artists/:id', (req,res)=>{
  let currentUser = null;
  try {
    const p = jwt.verify(req.cookies.venyl_token || '', JWT_SECRET);
    currentUser = db.users.find(x => Number(x.id) === Number(p.id)) || null;
  } catch {}
  const id=Number(req.params.id);
  const a=db.artists.find(x=>Number(x.id)===id);
  if(!a) return res.status(404).json({error:'Артист не найден.'});
  const tracks=getArtistTrackList(id, a.name).map(mapTrack);
  const albums=db.albums.filter(x=>Number(x.artist_id)===id).sort((x,y)=>y.id-x.id).map(mapAlbum);
  res.json({artist:enrichArtist(a, currentUser?.id || null), tracks, albums});
});

app.get('/api/albums/:id', (req,res)=>{
  const id=Number(req.params.id);
  const album=db.albums.find(x=>Number(x.id)===id);
  if(!album) return res.status(404).json({error:'Альбом не найден.'});
  const artist=db.artists.find(x=>Number(x.id)===Number(album.artist_id));
  const tracks=sortTracksByPopularity(db.tracks.filter(t=>Number(t.album_id)===id)).map(mapTrack);
  const totalPlays=tracks.reduce((sum,t)=>sum+(Number(t.play_count)||0),0);
  res.json({ album: mapAlbum(album), artist: artist ? mapArtist(artist) : null, tracks, totalPlays });
});
app.post('/api/artists', authRequired, adminOnly, uploadLimiter, upload.single('photo'), (req,res)=>{ try{ const name=String(req.body.name||'').trim(), bio=String(req.body.bio||'').trim(); if(!name){ if(req.file) deleteFileSafe(req.file.path); return res.status(400).json({error:'Укажи имя артиста.'}); } if(db.artists.some(a=>String(a.name).toLowerCase()===name.toLowerCase())){ if(req.file) deleteFileSafe(req.file.path); return res.status(400).json({error:'Такой артист уже есть.'}); } const a={id:nextId('artists'), name, bio, photo_path:req.file?path.basename(req.file.filename):'', created_at:now()}; db.artists.push(a); saveDb(); res.json({ok:true, artist:mapArtist(a)}); }catch(e){ if(req.file) deleteFileSafe(req.file.path); res.status(500).json({error:e.message||'Не удалось создать артиста.'}); } });
app.put('/api/artists/:id', authRequired, adminOnly, uploadLimiter, upload.single('photo'), (req,res)=>{ const id=Number(req.params.id); const a=db.artists.find(x=>Number(x.id)===id); if(!a){ if(req.file) deleteFileSafe(req.file.path); return res.status(404).json({error:'Артист не найден.'}); } const old=a.name; a.name=String(req.body.name||a.name).trim(); a.bio=String(req.body.bio??a.bio??'').trim(); if(req.file){ if(a.photo_path) deleteFileSafe(path.join(artistsDir,a.photo_path)); a.photo_path=path.basename(req.file.filename); } for(const t of db.tracks) if(Number(t.artist_id)===id || String(t.artist).toLowerCase()===old.toLowerCase()) t.artist=a.name; saveDb(); res.json({ok:true, artist:mapArtist(a)}); });
app.delete('/api/artists/:id', authRequired, adminOnly, (req,res)=>{ const id=Number(req.params.id); const a=db.artists.find(x=>Number(x.id)===id); if(!a) return res.status(404).json({error:'Артист не найден.'}); for(const t of db.tracks.filter(t=>Number(t.artist_id)===id||String(t.artist).toLowerCase()===String(a.name).toLowerCase())){ deleteFileSafe(path.join(tracksDir,t.audio_path)); if(t.cover_path) deleteFileSafe(path.join(coversDir,t.cover_path)); } for(const al of db.albums.filter(x=>Number(x.artist_id)===id)) if(al.cover_path) deleteFileSafe(path.join(albumsDir,al.cover_path)); if(a.photo_path) deleteFileSafe(path.join(artistsDir,a.photo_path)); const deletedTrackIds = new Set(db.tracks.filter(t=>Number(t.artist_id)===id||String(t.artist).toLowerCase()===String(a.name).toLowerCase()).map(t=>Number(t.id))); db.tracks=db.tracks.filter(t=>!deletedTrackIds.has(Number(t.id))); db.albums=db.albums.filter(x=>Number(x.artist_id)!==id); db.artists=db.artists.filter(x=>Number(x.id)!==id); db.track_artists=db.track_artists.filter(x=>Number(x.artist_id)!==id && !deletedTrackIds.has(Number(x.track_id))); db.subscriptions=db.subscriptions.filter(x=>Number(x.artist_id)!==id); db.favorite_tracks=db.favorite_tracks.filter(x=>!deletedTrackIds.has(Number(x.track_id))); db.playlist_tracks=db.playlist_tracks.filter(x=>!deletedTrackIds.has(Number(x.track_id))); saveDb(); res.json({ok:true}); });
app.post('/api/artists/:id/tracks/upload', authRequired, adminOnly, uploadLimiter, upload.fields([{name:'audio',maxCount:1},{name:'cover',maxCount:1}]), (req,res)=>{ try{ const artistId=Number(req.params.id); const artist=db.artists.find(a=>Number(a.id)===artistId); if(!artist){ cleanupRequestFiles(req); return res.status(404).json({error:'Артист не найден.'}); } const title=String(req.body.title||'').trim(), albumName=String(req.body.album||'').trim(), genre=String(req.body.genre||'').trim(); const audioFile=req.files?.audio?.[0], coverFile=req.files?.cover?.[0]; if(!title||!audioFile){ cleanupRequestFiles(req); return res.status(400).json({error:'Укажи название и аудиофайл.'}); } const artists=[artist,...ensureArtists(req.body.featured_artists).filter(a=>Number(a.id)!==artist.id)], album=albumName?ensureAlbum(artist.id,albumName):null; const tr={id:nextId('tracks'), title, artist:artists.map(a=>a.name).join(', '), artist_id:artist.id, album:album?album.name:albumName, album_id:album?album.id:null, genre, play_count:0, cover_path:coverFile?path.basename(coverFile.filename):(album?.cover_path||''), audio_path:path.basename(audioFile.filename), uploaded_by_user_id:req.user.id, created_at:now()}; db.tracks.push(tr); syncTrackArtists(tr.id, artists); saveDb(); res.json({ok:true, track:mapTrack(tr)}); }catch(e){ cleanupRequestFiles(req); res.status(500).json({error:e.message||'Не удалось добавить трек артисту.'}); } });
app.post('/api/artists/:id/albums/create', authRequired, adminOnly, uploadLimiter, upload.fields([{name:'album_cover',maxCount:1},{name:'audios',maxCount:30}]), (req,res)=>{ try{ const artistId=Number(req.params.id); const artist=db.artists.find(a=>Number(a.id)===artistId); if(!artist){ cleanupRequestFiles(req); return res.status(404).json({error:'Артист не найден.'}); } const albumName=String(req.body.name||'').trim(), description=String(req.body.description||'').trim(); const audios=req.files?.audios||[]; if(!albumName||!audios.length){ cleanupRequestFiles(req); return res.status(400).json({error:'Укажи название альбома и добавь аудиофайлы.'}); } let meta=JSON.parse(String(req.body.tracks_meta||'[]')); const cover=req.files?.album_cover?.[0]; const album=ensureAlbum(artist.id, albumName, cover?path.basename(cover.filename):'', description); const created=[]; audios.forEach((file,i)=>{ const m=meta[i]||{}; const title=String(m.title||'').trim()||path.basename(file.originalname,path.extname(file.originalname)); const artists=[artist,...ensureArtists(m.artists).filter(a=>Number(a.id)!==artist.id)]; const tr={id:nextId('tracks'), title, artist:artists.map(a=>a.name).join(', '), artist_id:artist.id, album:album.name, album_id:album.id, genre:String(m.genre||'').trim(), play_count:0, cover_path:album.cover_path||'', audio_path:path.basename(file.filename), uploaded_by_user_id:req.user.id, created_at:now()}; db.tracks.push(tr); syncTrackArtists(tr.id, artists); created.push(mapTrack(tr)); }); saveDb(); res.json({ok:true, album:mapAlbum(album), tracks:created}); }catch(e){ cleanupRequestFiles(req); res.status(500).json({error:e.message||'Не удалось создать альбом.'}); } });
app.put('/api/albums/:id', authRequired, adminOnly, coverUploadLimiter, upload.single('album_cover'), (req,res)=>{ const id=Number(req.params.id); const al=db.albums.find(x=>Number(x.id)===id); if(!al){ if(req.file) deleteFileSafe(req.file.path); return res.status(404).json({error:'Альбом не найден.'}); } al.name=String(req.body.name||al.name).trim(); al.description=String(req.body.description??al.description??'').trim(); if(req.file){ if(al.cover_path) deleteFileSafe(path.join(albumsDir,al.cover_path)); invalidateCoverCache(al.cover_path); al.cover_path=path.basename(req.file.filename); } for(const t of db.tracks.filter(t=>Number(t.album_id)===id)){ t.album=al.name; if(al.cover_path) t.cover_path=al.cover_path; } saveDb(); res.json({ok:true, album:mapAlbum(al)}); });
app.delete('/api/albums/:id', authRequired, adminOnly, (req,res)=>{ const id=Number(req.params.id); const al=db.albums.find(x=>Number(x.id)===id); if(!al) return res.status(404).json({error:'Альбом не найден.'}); if(al.cover_path) deleteFileSafe(path.join(albumsDir,al.cover_path)); db.albums=db.albums.filter(x=>Number(x.id)!==id); for(const t of db.tracks.filter(t=>Number(t.album_id)===id)){ t.album=''; t.album_id=null; } saveDb(); res.json({ok:true}); });

app.use((err, req, res, next)=>{
  if (err && err instanceof multer.MulterError) return res.status(400).json({error:'Ошибка загрузки файла: '+err.message});
  if (err && err.message && /unsupported|неизвестный/i.test(err.message)) return res.status(400).json({error:err.message});
  if(err){ console.error(err); return res.status(500).json({error:'Внутренняя ошибка сервера.'}); }
  next();
});

app.get('*', (req,res)=> res.sendFile(path.join(rootDir, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Venyl running on ${APP_BASE_URL}`));
