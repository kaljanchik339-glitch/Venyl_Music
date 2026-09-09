require('dotenv').config();

const path = require('path');
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

const rootDir = __dirname;
const uploadsDir = path.join(rootDir, 'uploads');
const tracksDir = path.join(uploadsDir, 'tracks');
const coversDir = path.join(uploadsDir, 'covers');
const artistsDir = path.join(uploadsDir, 'artists');
const avatarsDir = path.join(uploadsDir, 'avatars');
const albumsDir = path.join(uploadsDir, 'albums');
const playlistCoversDir = path.join(uploadsDir, 'playlists');
const dataDir = path.join(rootDir, 'data');
const jsonPath = path.join(dataDir, 'venyl.json');
for (const dir of [uploadsDir, tracksDir, coversDir, artistsDir, avatarsDir, albumsDir, playlistCoversDir, dataDir]) fs.mkdirSync(dir, { recursive: true });

const blank = () => ({ users: [], email_verification_tokens: [], artists: [], albums: [], tracks: [], track_artists: [], subscriptions: [], favorite_tracks: [], playlists: [], playlist_tracks: [], listen_history: [], comments: [], user_follows: [], playlist_likes: [], user_subscriptions: [], user_follow_dismissals: [], chat_messages: [] });
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
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}
const mailer = buildMailer();

function createJwt(user) { return jwt.sign({ id: user.id, email: user.email, name: user.name, ver: user.token_version || 0 }, JWT_SECRET, { expiresIn: '30d' }); }
function setAuthCookie(res, token) { res.cookie('venyl_token', token, { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION }); }
function publicUser(u){ if(!u) return null; const windows = getProfileWindows(u); const isAdmin = isAdminUser(u); return { id:u.id, name:u.name, email:u.email, role: normalizeRole(u.role || (ADMIN_EMAIL && String(u.email).toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user')), avatarUrl: u.avatar_path ? `/uploads/avatars/${u.avatar_path}` : '', nicknameColor: u.nickname_color || '', isVerified: !!u.is_verified, isAdmin, lastNickChangeAt: windows.nickAt, lastAvatarChangeAt: windows.avatarAt, nicknameCanChangeAt: windows.nickNext, avatarCanChangeAt: windows.avatarNext, canChangeNickname: canChangeNickname(u), canChangeAvatar: canChangeAvatar(u) }; }
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
  if (!mailer) return;
  const verifyUrl = `${APP_BASE_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await mailer.sendMail({ from: process.env.MAIL_FROM, to: user.email, subject: 'Подтверди аккаунт Venyl', html: `<p>Привет, ${user.name}!</p><p><a href="${verifyUrl}">Подтвердить email</a></p><p>${verifyUrl}</p>` });
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

function mapPlaylist(row){
  const items = db.playlist_tracks.filter(x=>Number(x.playlist_id)===Number(row.id));
  return { id: row.id, userId: row.user_id, name: row.name, isPublic: !!row.is_public, likeCount: db.playlist_likes.filter(x=>Number(x.playlist_id)===Number(row.id)).length, coverUrl: row.cover_path ? `/uploads/playlists/${row.cover_path}` : '', trackCount: items.length, createdAt: row.created_at || '', updatedAt: row.updated_at || '' };
}
function getUserPlaylist(userId, playlistId){
  return db.playlists.find(p=>Number(p.id)===Number(playlistId) && Number(p.user_id)===Number(userId));
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
  for (const t of db.tracks) {
    if (typeof t.play_count !== 'number') t.play_count = Number(t.play_count) || 0;
    const artists = ensureArtists(t.artist); const main = artists[0];
    if (main) { t.artist_id = t.artist_id || main.id; t.artist = artists.map(a => a.name).join(', '); syncTrackArtists(t.id, artists); }
    if (main && t.album && !t.album_id) { const album = ensureAlbum(main.id, t.album); if (album) t.album_id = album.id; }
  }
  saveDb();
}
reconcileRelations();

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use('/uploads/tracks', express.static(tracksDir));
app.use('/uploads/covers', express.static(coversDir));
app.use('/uploads/artists', express.static(artistsDir));
app.use('/uploads/avatars', express.static(avatarsDir));
app.use('/uploads/albums', express.static(albumsDir));
app.use('/uploads/playlists', express.static(playlistCoversDir));
app.use(express.static(path.join(rootDir, 'public')));

const rateLimitStore = new Map();
function rateLimit(maxRequests, windowMs) { return (req, res, next) => { const ip = req.ip || req.connection.remoteAddress || 'unknown'; const nowMs = Date.now(); const e = rateLimitStore.get(ip); if (!e || nowMs > e.resetAt) { rateLimitStore.set(ip, {count:1, resetAt:nowMs+windowMs}); return next(); } if (e.count >= maxRequests) return res.status(429).json({error:'Слишком много запросов. Подожди немного.'}); e.count++; next(); }; }
const authLimiter = rateLimit(10, 15*60*1000);

app.get('/api/health', (req, res) => res.json({ ok: true, mode: 'json-db', mailerConfigured: Boolean(mailer), adminConfigured: Boolean(ADMIN_EMAIL) }));
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try { const requestedName = normalizeNickname(req.body.name); const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
    if (!requestedName || !email || password.length < 8) return res.status(400).json({ error: 'Укажи ник, email и пароль минимум 8 символов.' });
    if (db.users.some(u => String(u.email).toLowerCase() === email)) return res.status(400).json({ error: 'Такой email уже зарегистрирован.' });
    if (isArtistNameTaken(requestedName)) return res.status(400).json({ error: 'Этот ник занят именем существующего артиста. Выбери другой ник.' });
    const name = makeUniqueNickname(requestedName);
    const user = { id: nextId('users'), name, email, role: (ADMIN_EMAIL && email === ADMIN_EMAIL) ? 'admin' : 'user', password_hash: await bcrypt.hash(password, 10), avatar_path: '', nickname_color: '', last_nick_change_at: null, last_avatar_change_at: null, is_verified: mailer ? 0 : 1, token_version: 0, created_at: now() };
    db.users.push(user); const token = crypto.randomBytes(32).toString('hex'); if (mailer) db.email_verification_tokens.push({ id: nextId('email_verification_tokens'), user_id: user.id, token, expires_at: new Date(Date.now()+24*3600*1000).toISOString(), created_at: now() }); saveDb();
    await sendVerificationEmail(user, token).catch(()=>{});
    setAuthCookie(res, createJwt(user));
    res.json({ ok: true, user: publicUser(user), message: mailer ? 'Аккаунт создан. Проверь почту для подтверждения.' : 'Аккаунт создан. Email подтверждён автоматически, потому что SMTP не настроен.' });
  } catch(e){ res.status(500).json({ error: e.message || 'Не удалось зарегистрироваться.' }); }
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
    for (const p of db.playlists) {
    if (typeof p.cover_path !== 'string') p.cover_path = '';
    if (!p.updated_at) p.updated_at = p.created_at || now();
  }
  for (const t of db.tracks) {
      if (Number(t.uploaded_by_user_id) === id) t.uploaded_by_user_id = null;
    }

    saveDb();
    res.json({ ok:true, users: db.users.map(adminUserRow).sort((a,b)=>Number(a.id)-Number(b.id)) });
  } catch(e) { res.status(500).json({ error: e.message || 'Не удалось удалить пользователя.' }); }
});

app.put('/api/profile', authRequired, upload.single('avatar'), (req, res) => {
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
app.post('/api/tracks/upload', authRequired, adminOnly, upload.fields([{name:'audio',maxCount:1},{name:'cover',maxCount:1}]), (req,res)=>{ try{ const title=String(req.body.title||'').trim(), artistName=String(req.body.artist||'').trim(), albumName=String(req.body.album||'').trim(), genre=String(req.body.genre||'').trim(); const audioFile=req.files?.audio?.[0], coverFile=req.files?.cover?.[0]; if(!title||!artistName||!audioFile){ cleanupRequestFiles(req); return res.status(400).json({error:'Укажи название, артиста и аудиофайл.'}); } const artists=ensureArtists(artistName), main=artists[0], album=albumName?ensureAlbum(main.id, albumName):null; const tr={id:nextId('tracks'), title, artist:artists.map(a=>a.name).join(', '), artist_id:main.id, album:album?album.name:albumName, album_id:album?album.id:null, genre, play_count:0, cover_path:coverFile?path.basename(coverFile.filename):(album?.cover_path||''), audio_path:path.basename(audioFile.filename), uploaded_by_user_id:req.user.id, created_at:now()}; db.tracks.push(tr); syncTrackArtists(tr.id, artists); saveDb(); res.json({ok:true, track:mapTrack(tr)}); }catch(e){ cleanupRequestFiles(req); res.status(500).json({error:e.message||'Не удалось загрузить трек.'}); } });
app.delete('/api/tracks/:id', authRequired, adminOnly, (req,res)=>{ const id=Number(req.params.id); const t=db.tracks.find(x=>Number(x.id)===id); if(!t) return res.status(404).json({error:'Трек не найден.'}); deleteFileSafe(path.join(tracksDir,t.audio_path)); if(t.cover_path){ deleteFileSafe(path.join(coversDir,t.cover_path)); invalidateCoverCache(t.cover_path); } db.tracks=db.tracks.filter(x=>Number(x.id)!==id); db.track_artists=db.track_artists.filter(x=>Number(x.track_id)!==id); db.favorite_tracks=db.favorite_tracks.filter(x=>Number(x.track_id)!==id); db.playlist_tracks=db.playlist_tracks.filter(x=>Number(x.track_id)!==id); db.listen_history=db.listen_history.filter(x=>Number(x.track_id)!==id); db.comments=db.comments.filter(x=>Number(x.track_id)!==id); saveDb(); res.json({ok:true}); });
app.put('/api/tracks/:id', authRequired, adminOnly, (req,res)=>{ const id=Number(req.params.id); const t=db.tracks.find(x=>Number(x.id)===id); if(!t) return res.status(404).json({error:'Трек не найден.'}); const title=String(req.body.title||t.title).trim(), artistNames=String(req.body.artist||t.artist).trim(), albumName=String(req.body.album||'').trim(), genre=String(req.body.genre||'').trim(); const artists=ensureArtists(artistNames), main=artists[0], album=albumName?ensureAlbum(main.id, albumName):null; Object.assign(t,{title, artist:artists.map(a=>a.name).join(', '), artist_id:main.id, album:album?album.name:albumName, album_id:album?album.id:null, genre, cover_path:t.cover_path||(album?.cover_path||'')}); syncTrackArtists(id, artists); saveDb(); res.json({ok:true, track:mapTrack(t)}); });


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

app.get('/api/recommendations', authRequired, (req,res)=>{
  const favIds=getFavoriteTrackIdsForUser(req.user.id);
  const history=db.listen_history.filter(x=>Number(x.user_id)===Number(req.user.id)).sort((a,b)=>new Date(a.played_at||0)-new Date(b.played_at||0));
  const genreScore=new Map(), artistScore=new Map(), seen=new Set();
  for(const id of favIds){
    const t=db.tracks.find(x=>Number(x.id)===Number(id)); if(!t) continue;
    seen.add(Number(t.id));
    for(const g of String(t.genre||'').split(',').map(v=>v.trim()).filter(Boolean)) genreScore.set(g,(genreScore.get(g)||0)+6);
    for(const a of getTrackArtistsForMap(t)) artistScore.set(Number(a.id),(artistScore.get(Number(a.id))||0)+7);
  }
  const recent=history.slice(-100);
  recent.forEach((row,idx)=>{
    const t=db.tracks.find(x=>Number(x.id)===Number(row.track_id)); if(!t) return;
    seen.add(Number(t.id));
    const recency=1+(idx/Math.max(1,recent.length))*2;
    for(const g of String(t.genre||'').split(',').map(v=>v.trim()).filter(Boolean)) genreScore.set(g,(genreScore.get(g)||0)+recency);
    for(const a of getTrackArtistsForMap(t)) artistScore.set(Number(a.id),(artistScore.get(Number(a.id))||0)+recency*2.5);
  });
  const excludeRaw=String(req.query.exclude||'').split(',').map(Number).filter(Boolean);
  const exclude=new Set(excludeRaw);
  const candidates=db.tracks.filter(t=>!favIds.has(Number(t.id))&&!exclude.has(Number(t.id))).map(t=>{
    let score=Math.log1p(Number(t.play_count)||0)*0.7;
    for(const g of String(t.genre||'').split(',').map(v=>v.trim()).filter(Boolean)) score+=(genreScore.get(g)||0)*1.8;
    for(const a of getTrackArtistsForMap(t)) score+=artistScore.get(Number(a.id))||0;
    if(seen.has(Number(t.id))) score-=2;
    const ageDays=Math.max(0,(Date.now()-new Date(t.created_at||Date.now()).getTime())/86400000);
    if(ageDays<30) score+=Math.max(0,5-ageDays/6);
    return {t,score};
  }).sort((a,b)=>b.score-a.score || (Number(b.t.play_count)||0)-(Number(a.t.play_count)||0) || Number(b.t.id)-Number(a.t.id));
  const picked=[], artistCounts=new Map();
  for(const item of candidates){
    const artists=getTrackArtistsForMap(item.t).map(a=>Number(a.id)).filter(Boolean);
    const maxArtist=artists.reduce((m,id)=>Math.max(m,artistCounts.get(id)||0),0);
    if(maxArtist>=3 && picked.length<12) continue;
    picked.push(mapTrack(item.t));
    artists.forEach(id=>artistCounts.set(id,(artistCounts.get(id)||0)+1));
    if(picked.length>=20) break;
  }
  res.json({tracks:picked});
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
    .filter(p=>Number(p.user_id)===Number(req.user.id))
    .sort((a,b)=>new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0) || (Number(b.id)||0)-(Number(a.id)||0))
    .map(mapPlaylist);
  res.json({ playlists });
});
app.post('/api/playlists', authRequired, upload.single('playlist_cover'), (req,res)=>{
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
app.put('/api/playlists/:id', authRequired, upload.single('playlist_cover'), (req,res)=>{
  try{
    const pl=getUserPlaylist(req.user.id, req.params.id);
    if(!pl){ if(req.file) deleteFileSafe(req.file.path); return res.status(404).json({error:'Плейлист не найден или недоступен.'}); }
    const name=String(req.body.name??pl.name).trim();
    if(!name){ if(req.file) deleteFileSafe(req.file.path); return res.status(400).json({error:'Название плейлиста не может быть пустым.'}); }
    pl.name=name;
    if(req.file){ if(pl.cover_path) deleteFileSafe(path.join(playlistCoversDir, pl.cover_path)); pl.cover_path=path.basename(req.file.filename); }
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
  saveDb(); res.json({ok:true, playlists:db.playlists.filter(p=>Number(p.user_id)===Number(req.user.id)).map(mapPlaylist)});
});
app.post('/api/playlists/:id/tracks', authRequired, express.json(), (req,res)=>{
  const pl=getUserPlaylist(req.user.id, req.params.id);
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
  const pl=getUserPlaylist(req.user.id, req.params.id);
  if(!pl) return res.status(404).json({error:'Плейлист не найден или недоступен.'});
  db.playlist_tracks=db.playlist_tracks.filter(x=>!(Number(x.playlist_id)===Number(pl.id) && Number(x.track_id)===Number(req.params.trackId)));
  normalizePlaylistPositions(pl.id); pl.updated_at=now(); saveDb();
  res.json({ok:true, playlist:mapPlaylist(pl), tracks:getPlaylistTracks(pl.id)});
});
app.put('/api/playlists/:id/reorder', authRequired, express.json(), (req,res)=>{
  const pl=getUserPlaylist(req.user.id, req.params.id);
  if(!pl) return res.status(404).json({error:'Плейлист не найден или недоступен.'});
  const ids=Array.isArray(req.body.trackIds)?req.body.trackIds.map(Number).filter(Boolean):[];
  const current=db.playlist_tracks.filter(x=>Number(x.playlist_id)===Number(pl.id));
  const currentIds=new Set(current.map(x=>Number(x.track_id)));
  if(ids.length!==current.length || ids.some(id=>!currentIds.has(id))) return res.status(400).json({error:'Неверный порядок треков.'});
  ids.forEach((trackId, idx)=>{ const item=current.find(x=>Number(x.track_id)===trackId); if(item) item.position=idx+1; });
  pl.updated_at=now(); saveDb();
  res.json({ok:true, playlist:mapPlaylist(pl), tracks:getPlaylistTracks(pl.id)});
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
app.post('/api/artists', authRequired, adminOnly, upload.single('photo'), (req,res)=>{ try{ const name=String(req.body.name||'').trim(), bio=String(req.body.bio||'').trim(); if(!name){ if(req.file) deleteFileSafe(req.file.path); return res.status(400).json({error:'Укажи имя артиста.'}); } if(db.artists.some(a=>String(a.name).toLowerCase()===name.toLowerCase())){ if(req.file) deleteFileSafe(req.file.path); return res.status(400).json({error:'Такой артист уже есть.'}); } const a={id:nextId('artists'), name, bio, photo_path:req.file?path.basename(req.file.filename):'', created_at:now()}; db.artists.push(a); saveDb(); res.json({ok:true, artist:mapArtist(a)}); }catch(e){ if(req.file) deleteFileSafe(req.file.path); res.status(500).json({error:e.message||'Не удалось создать артиста.'}); } });
app.put('/api/artists/:id', authRequired, adminOnly, upload.single('photo'), (req,res)=>{ const id=Number(req.params.id); const a=db.artists.find(x=>Number(x.id)===id); if(!a){ if(req.file) deleteFileSafe(req.file.path); return res.status(404).json({error:'Артист не найден.'}); } const old=a.name; a.name=String(req.body.name||a.name).trim(); a.bio=String(req.body.bio??a.bio??'').trim(); if(req.file){ if(a.photo_path) deleteFileSafe(path.join(artistsDir,a.photo_path)); a.photo_path=path.basename(req.file.filename); } for(const t of db.tracks) if(Number(t.artist_id)===id || String(t.artist).toLowerCase()===old.toLowerCase()) t.artist=a.name; saveDb(); res.json({ok:true, artist:mapArtist(a)}); });
app.delete('/api/artists/:id', authRequired, adminOnly, (req,res)=>{ const id=Number(req.params.id); const a=db.artists.find(x=>Number(x.id)===id); if(!a) return res.status(404).json({error:'Артист не найден.'}); for(const t of db.tracks.filter(t=>Number(t.artist_id)===id||String(t.artist).toLowerCase()===String(a.name).toLowerCase())){ deleteFileSafe(path.join(tracksDir,t.audio_path)); if(t.cover_path) deleteFileSafe(path.join(coversDir,t.cover_path)); } for(const al of db.albums.filter(x=>Number(x.artist_id)===id)) if(al.cover_path) deleteFileSafe(path.join(albumsDir,al.cover_path)); if(a.photo_path) deleteFileSafe(path.join(artistsDir,a.photo_path)); const deletedTrackIds = new Set(db.tracks.filter(t=>Number(t.artist_id)===id||String(t.artist).toLowerCase()===String(a.name).toLowerCase()).map(t=>Number(t.id))); db.tracks=db.tracks.filter(t=>!deletedTrackIds.has(Number(t.id))); db.albums=db.albums.filter(x=>Number(x.artist_id)!==id); db.artists=db.artists.filter(x=>Number(x.id)!==id); db.track_artists=db.track_artists.filter(x=>Number(x.artist_id)!==id && !deletedTrackIds.has(Number(x.track_id))); db.subscriptions=db.subscriptions.filter(x=>Number(x.artist_id)!==id); db.favorite_tracks=db.favorite_tracks.filter(x=>!deletedTrackIds.has(Number(x.track_id))); db.playlist_tracks=db.playlist_tracks.filter(x=>!deletedTrackIds.has(Number(x.track_id))); saveDb(); res.json({ok:true}); });
app.post('/api/artists/:id/tracks/upload', authRequired, adminOnly, upload.fields([{name:'audio',maxCount:1},{name:'cover',maxCount:1}]), (req,res)=>{ try{ const artistId=Number(req.params.id); const artist=db.artists.find(a=>Number(a.id)===artistId); if(!artist){ cleanupRequestFiles(req); return res.status(404).json({error:'Артист не найден.'}); } const title=String(req.body.title||'').trim(), albumName=String(req.body.album||'').trim(), genre=String(req.body.genre||'').trim(); const audioFile=req.files?.audio?.[0], coverFile=req.files?.cover?.[0]; if(!title||!audioFile){ cleanupRequestFiles(req); return res.status(400).json({error:'Укажи название и аудиофайл.'}); } const artists=[artist,...ensureArtists(req.body.featured_artists).filter(a=>Number(a.id)!==artist.id)], album=albumName?ensureAlbum(artist.id,albumName):null; const tr={id:nextId('tracks'), title, artist:artists.map(a=>a.name).join(', '), artist_id:artist.id, album:album?album.name:albumName, album_id:album?album.id:null, genre, play_count:0, cover_path:coverFile?path.basename(coverFile.filename):(album?.cover_path||''), audio_path:path.basename(audioFile.filename), uploaded_by_user_id:req.user.id, created_at:now()}; db.tracks.push(tr); syncTrackArtists(tr.id, artists); saveDb(); res.json({ok:true, track:mapTrack(tr)}); }catch(e){ cleanupRequestFiles(req); res.status(500).json({error:e.message||'Не удалось добавить трек артисту.'}); } });
app.post('/api/artists/:id/albums/create', authRequired, adminOnly, upload.fields([{name:'album_cover',maxCount:1},{name:'audios',maxCount:30}]), (req,res)=>{ try{ const artistId=Number(req.params.id); const artist=db.artists.find(a=>Number(a.id)===artistId); if(!artist){ cleanupRequestFiles(req); return res.status(404).json({error:'Артист не найден.'}); } const albumName=String(req.body.name||'').trim(), description=String(req.body.description||'').trim(); const audios=req.files?.audios||[]; if(!albumName||!audios.length){ cleanupRequestFiles(req); return res.status(400).json({error:'Укажи название альбома и добавь аудиофайлы.'}); } let meta=JSON.parse(String(req.body.tracks_meta||'[]')); const cover=req.files?.album_cover?.[0]; const album=ensureAlbum(artist.id, albumName, cover?path.basename(cover.filename):'', description); const created=[]; audios.forEach((file,i)=>{ const m=meta[i]||{}; const title=String(m.title||'').trim()||path.basename(file.originalname,path.extname(file.originalname)); const artists=[artist,...ensureArtists(m.artists).filter(a=>Number(a.id)!==artist.id)]; const tr={id:nextId('tracks'), title, artist:artists.map(a=>a.name).join(', '), artist_id:artist.id, album:album.name, album_id:album.id, genre:String(m.genre||'').trim(), play_count:0, cover_path:album.cover_path||'', audio_path:path.basename(file.filename), uploaded_by_user_id:req.user.id, created_at:now()}; db.tracks.push(tr); syncTrackArtists(tr.id, artists); created.push(mapTrack(tr)); }); saveDb(); res.json({ok:true, album:mapAlbum(album), tracks:created}); }catch(e){ cleanupRequestFiles(req); res.status(500).json({error:e.message||'Не удалось создать альбом.'}); } });
app.put('/api/albums/:id', authRequired, adminOnly, upload.single('album_cover'), (req,res)=>{ const id=Number(req.params.id); const al=db.albums.find(x=>Number(x.id)===id); if(!al){ if(req.file) deleteFileSafe(req.file.path); return res.status(404).json({error:'Альбом не найден.'}); } al.name=String(req.body.name||al.name).trim(); al.description=String(req.body.description??al.description??'').trim(); if(req.file){ if(al.cover_path) deleteFileSafe(path.join(albumsDir,al.cover_path)); invalidateCoverCache(al.cover_path); al.cover_path=path.basename(req.file.filename); } for(const t of db.tracks.filter(t=>Number(t.album_id)===id)){ t.album=al.name; if(al.cover_path) t.cover_path=al.cover_path; } saveDb(); res.json({ok:true, album:mapAlbum(al)}); });
app.delete('/api/albums/:id', authRequired, adminOnly, (req,res)=>{ const id=Number(req.params.id); const al=db.albums.find(x=>Number(x.id)===id); if(!al) return res.status(404).json({error:'Альбом не найден.'}); if(al.cover_path) deleteFileSafe(path.join(albumsDir,al.cover_path)); db.albums=db.albums.filter(x=>Number(x.id)!==id); for(const t of db.tracks.filter(t=>Number(t.album_id)===id)){ t.album=''; t.album_id=null; } saveDb(); res.json({ok:true}); });

app.use((err, req, res, next)=>{
  if (err && err instanceof multer.MulterError) return res.status(400).json({error:'Ошибка загрузки файла: '+err.message});
  if (err && err.message && /unsupported|неизвестный/i.test(err.message)) return res.status(400).json({error:err.message});
  if(err){ console.error(err); return res.status(500).json({error:'Внутренняя ошибка сервера.'}); }
  next();
});

app.get('*', (req,res)=> res.sendFile(path.join(rootDir, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Venyl running on ${APP_BASE_URL}`));
