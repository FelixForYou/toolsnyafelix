'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const tls = require('tls');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const axios = require('axios');
const QRCode = require('qrcode');
const { Client } = require('ssh2');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 2 * 1024 * 1024,
  cors: false
});

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_TEXT_FILE = 2 * 1024 * 1024;
const sshSessions = new Map();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null,
      frameAncestors: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const sessionMiddleware = session({
  name: 'fxhl.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-change-this-secret-please',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true' ? true : process.env.COOKIE_SECURE === 'false' ? false : 'auto',
    maxAge: 12 * 60 * 60 * 1000
  }
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
});

function sanitizeHost(host) {
  const value = String(host || '').trim();
  if (!value || value.length > 253) throw new Error('Host tidak valid.');
  if (!/^[a-zA-Z0-9._:-]+$/.test(value)) throw new Error('Host mengandung karakter tidak valid.');
  return value;
}

function allowedSSHHost(host) {
  const raw = String(process.env.ALLOWED_SSH_HOSTS || '').trim();
  if (!raw) return true;
  const allow = raw.split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
  return allow.includes(String(host).toLowerCase());
}

function sessionSSH(req) {
  const id = req.session?.sshSessionId;
  if (!id) return null;
  const item = sshSessions.get(id);
  if (!item || item.closed) return null;
  return item;
}

function destroySSHByHttpSession(req) {
  const id = req.session?.sshSessionId;
  if (!id) return;
  const item = sshSessions.get(id);
  if (item) {
    item.closed = true;
    try { item.client.end(); } catch {}
    sshSessions.delete(id);
  }
  delete req.session.sshSessionId;
}

function execSSH(client, command, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Perintah timeout.'));
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        settled = true;
        return reject(err);
      }
      let stdout = '';
      let stderr = '';
      stream.on('data', d => { stdout += d.toString(); });
      stream.stderr.on('data', d => { stderr += d.toString(); });
      stream.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  });
}

function getSftp(client) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });
}

function statSftp(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => err ? reject(err) : resolve(stats));
  });
}

function readDirSftp(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => err ? reject(err) : resolve(list));
  });
}

function mkdirSftp(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => err ? reject(err) : resolve());
  });
}

function renameSftp(sftp, from, to) {
  return new Promise((resolve, reject) => {
    sftp.rename(from, to, (err) => err ? reject(err) : resolve());
  });
}

function unlinkSftp(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (err) => err ? reject(err) : resolve());
  });
}

function rmdirSftp(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remotePath, (err) => err ? reject(err) : resolve());
  });
}

function readTextSftp(sftp, remotePath, maxBytes = MAX_TEXT_FILE) {
  return new Promise(async (resolve, reject) => {
    try {
      const stats = await statSftp(sftp, remotePath);
      if (stats.size > maxBytes) return reject(new Error(`File terlalu besar untuk editor (${Math.round(stats.size / 1024)} KB).`));
      const chunks = [];
      let total = 0;
      const stream = sftp.createReadStream(remotePath);
      stream.on('data', chunk => {
        total += chunk.length;
        if (total > maxBytes) stream.destroy(new Error('File terlalu besar.'));
        else chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
    } catch (err) {
      reject(err);
    }
  });
}

function writeTextSftp(sftp, remotePath, content) {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath, { flags: 'w', mode: 0o644 });
    stream.on('error', reject);
    stream.on('close', resolve);
    stream.end(Buffer.from(content, 'utf8'));
  });
}

function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || p[0] === 0;
  }
  if (net.isIP(ip) === 6) {
    const low = ip.toLowerCase();
    return low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe8') || low.startsWith('fe9') || low.startsWith('fea') || low.startsWith('feb');
  }
  return false;
}

async function ensurePublicUrl(input) {
  const url = new URL(String(input || ''));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Hanya URL http/https yang didukung.');
  if (url.username || url.password) throw new Error('URL dengan kredensial tidak diizinkan.');
  const results = await dns.lookup(url.hostname, { all: true });
  if (!results.length) throw new Error('Domain tidak ditemukan.');
  if (results.some(x => isPrivateIp(x.address))) throw new Error('URL private/internal diblokir untuk fitur ini.');
  return url;
}

const MEDIA_TOOLS = [
  { id: 'tiktok', name: 'TikTok No Watermark', category: 'download', provider: 'TikWM' },
  { id: 'tiktokaudio', name: 'TikTok Audio', category: 'download', provider: 'TikWM' },
  { id: 'tiktokcover', name: 'TikTok Cover', category: 'download', provider: 'TikWM' },
  { id: 'gdrive', name: 'Google Drive Direct Link', category: 'converter', provider: 'local' },
  { id: 'githubzip', name: 'GitHub Repo ZIP', category: 'converter', provider: 'local' },
  { id: 'githubraw', name: 'GitHub Raw Link', category: 'converter', provider: 'local' },
  { id: 'directcheck', name: 'Direct URL Checker', category: 'utility', provider: 'local' }
];

function absoluteTikwmUrl(value) {
  if (!value || typeof value !== 'string') return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return 'https:' + value;
  if (value.startsWith('/')) return 'https://www.tikwm.com' + value;
  return value;
}

function isTikTokHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'tiktok.com' || h.endsWith('.tiktok.com');
}

async function fetchTikTok(urlInput) {
  const url = await ensurePublicUrl(urlInput);
  if (!isTikTokHost(url.hostname)) throw new Error('Masukkan URL TikTok yang valid.');
  const form = new URLSearchParams({ url: url.toString(), hd: '1' });
  const response = await axios.post('https://www.tikwm.com/api/', form.toString(), {
    timeout: 30000,
    maxRedirects: 3,
    validateStatus: () => true,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (compatible; FXHL-WebTool/2.0)'
    }
  });
  if (response.status >= 400) throw new Error(`Provider TikTok HTTP ${response.status}.`);
  const payload = response.data || {};
  if (Number(payload.code) !== 0 || !payload.data) throw new Error(payload.msg || 'TikTok tidak mengembalikan media.');
  const d = payload.data;
  return {
    id: d.id || null,
    title: d.title || null,
    author: d.author ? { id: d.author.id || null, uniqueId: d.author.unique_id || null, nickname: d.author.nickname || null, avatar: absoluteTikwmUrl(d.author.avatar) } : null,
    duration: d.duration ?? null,
    video: absoluteTikwmUrl(d.hdplay || d.play),
    videoSd: absoluteTikwmUrl(d.play),
    watermark: absoluteTikwmUrl(d.wmplay),
    audio: absoluteTikwmUrl(d.music),
    cover: absoluteTikwmUrl(d.cover || d.origin_cover),
    images: Array.isArray(d.images) ? d.images.map(absoluteTikwmUrl).filter(Boolean) : [],
    stats: {
      play: d.play_count ?? null,
      likes: d.digg_count ?? null,
      comments: d.comment_count ?? null,
      shares: d.share_count ?? null
    }
  };
}

function googleDriveDirect(input) {
  const u = new URL(String(input || '').trim());
  if (!/(^|\.)drive\.google\.com$/i.test(u.hostname)) throw new Error('URL harus dari drive.google.com.');
  let id = u.searchParams.get('id');
  const m = u.pathname.match(/\/file\/d\/([^/]+)/i);
  if (!id && m) id = m[1];
  if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error('File ID Google Drive tidak ditemukan.');
  return { fileId: id, url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t` };
}

function githubRepoZip(input) {
  const u = new URL(String(input || '').trim());
  if (u.hostname.toLowerCase() !== 'github.com') throw new Error('URL harus dari github.com.');
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('URL repo GitHub tidak valid.');
  const [owner, repoRaw] = parts;
  const repo = repoRaw.replace(/\.git$/i, '');
  let branch = 'main';
  const tree = parts.indexOf('tree');
  if (tree >= 0 && parts[tree + 1]) branch = parts[tree + 1];
  return { owner, repo, branch, url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/archive/refs/heads/${encodeURIComponent(branch)}.zip` };
}

function githubRaw(input) {
  const u = new URL(String(input || '').trim());
  if (u.hostname.toLowerCase() !== 'github.com') throw new Error('URL harus dari github.com.');
  const parts = u.pathname.split('/').filter(Boolean);
  const blob = parts.indexOf('blob');
  if (blob < 2 || !parts[blob + 1] || parts.length <= blob + 2) throw new Error('Gunakan URL file GitHub yang mengandung /blob/.');
  const owner = parts[0], repo = parts[1], branch = parts[blob + 1], filePath = parts.slice(blob + 2).join('/');
  return { owner, repo, branch, filePath, url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}` };
}

async function ensurePublicHost(host) {
  const clean = sanitizeHost(host);
  if (net.isIP(clean)) {
    if (isPrivateIp(clean)) throw new Error('Host private/internal diblokir.');
    return { host: clean, addresses: [clean] };
  }
  const results = await dns.lookup(clean, { all: true });
  if (!results.length) throw new Error('Host tidak ditemukan.');
  if (results.some(x => isPrivateIp(x.address))) throw new Error('Host private/internal diblokir.');
  return { host: clean, addresses: results.map(x => x.address) };
}

app.get('/login', (req, res) => res.redirect('/'));

// No application-level password gate. This endpoint only disconnects the
// current browser's SSH session; it does not log the user out of the website.
app.post('/api/session/disconnect', (req, res) => {
  destroySSHByHttpSession(req);
  res.json({ ok: true });
});

app.get('/api/auth/status', (req, res) => {
  res.json({
    ok: true,
    authEnabled: false,
    authenticated: true,
    sessionSecretDefault: !process.env.SESSION_SECRET
  });
});

app.use('/api', apiLimiter);

app.get('/api/status', (req, res) => {
  const item = sessionSSH(req);
  res.json({
    ok: true,
    sshConnected: Boolean(item),
    sshHost: item?.host || null,
    sshUser: item?.username || null,
    home: item?.home || null,
    authEnabled: false
  });
});

app.post('/api/ssh/connect', authLimiter, async (req, res) => {
  try {
    destroySSHByHttpSession(req);
    const host = sanitizeHost(req.body?.host);
    if (!allowedSSHHost(host)) return res.status(403).json({ ok: false, error: 'Host ini tidak ada di ALLOWED_SSH_HOSTS.' });
    const port = Number(req.body?.port || 22);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port tidak valid.');
    const username = String(req.body?.username || '').trim();
    if (!username || username.length > 64) throw new Error('Username tidak valid.');
    const authType = req.body?.authType === 'privateKey' ? 'privateKey' : 'password';

    const connectOptions = {
      host,
      port,
      username,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      algorithms: {
        serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa']
      }
    };

    if (authType === 'privateKey') {
      const privateKey = String(req.body?.privateKey || '');
      if (!privateKey.includes('PRIVATE KEY')) throw new Error('Private key tidak valid.');
      connectOptions.privateKey = privateKey;
      if (req.body?.passphrase) connectOptions.passphrase = String(req.body.passphrase);
    } else {
      const password = String(req.body?.password || '');
      if (!password) throw new Error('Password SSH wajib diisi.');
      connectOptions.password = password;
    }

    const client = new Client();
    const sshId = crypto.randomUUID();
    let replied = false;

    const timeout = setTimeout(() => {
      if (replied) return;
      replied = true;
      try { client.end(); } catch {}
      res.status(504).json({ ok: false, error: 'Koneksi SSH timeout.' });
    }, 20000);

    client.once('ready', async () => {
      if (replied) return;
      clearTimeout(timeout);
      let home = '/';
      try {
        const out = await execSSH(client, 'printf %s "$HOME"');
        home = out.stdout || '/';
      } catch {}

      const item = { id: sshId, client, host, port, username, home, createdAt: Date.now(), closed: false };
      sshSessions.set(sshId, item);
      req.session.sshSessionId = sshId;
      req.session.save(() => {
        if (replied) return;
        replied = true;
        res.json({ ok: true, host, port, username, home });
      });
    });

    client.once('error', (err) => {
      if (replied) return;
      clearTimeout(timeout);
      replied = true;
      res.status(400).json({ ok: false, error: err.level === 'client-authentication' ? 'Autentikasi SSH gagal.' : `SSH error: ${err.message}` });
    });

    client.on('close', () => {
      const current = sshSessions.get(sshId);
      if (current) {
        current.closed = true;
        sshSessions.delete(sshId);
      }
    });

    client.connect(connectOptions);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/ssh/disconnect', (req, res) => {
  destroySSHByHttpSession(req);
  res.json({ ok: true });
});

app.get('/api/ssh/stats', async (req, res) => {
  try {
    const item = sessionSSH(req);
    if (!item) return res.status(409).json({ ok: false, error: 'Belum terhubung ke SSH.' });
    const [hostname, uptime, memory, disk, load, os] = await Promise.all([
      execSSH(item.client, 'hostname'),
      execSSH(item.client, 'uptime -p 2>/dev/null || uptime'),
      execSSH(item.client, "free -b | awk '/Mem:/ {print $2, $3, $7}'"),
      execSSH(item.client, "df -B1 / | awk 'NR==2 {print $2, $3, $4, $5}'"),
      execSSH(item.client, 'cat /proc/loadavg 2>/dev/null || true'),
      execSSH(item.client, '. /etc/os-release 2>/dev/null; printf %s "${PRETTY_NAME:-Unknown Linux}"')
    ]);
    const mem = memory.stdout.split(/\s+/).map(Number);
    const d = disk.stdout.split(/\s+/);
    res.json({
      ok: true,
      data: {
        hostname: hostname.stdout,
        uptime: uptime.stdout,
        os: os.stdout,
        load: load.stdout,
        memory: { total: mem[0] || 0, used: mem[1] || 0, available: mem[2] || 0 },
        disk: { total: Number(d[0] || 0), used: Number(d[1] || 0), available: Number(d[2] || 0), percent: d[3] || '0%' }
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const SAFE_SHORTCUTS = {
  system: 'uname -a && echo && cat /etc/os-release 2>/dev/null | head -8',
  disk: 'df -hT',
  memory: 'free -h',
  processes: 'ps aux --sort=-%mem | head -20',
  network: 'ss -tulpn 2>/dev/null | head -80',
  docker: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}" 2>/dev/null || echo "Docker tidak tersedia / butuh izin"',
  pterodactyl: 'systemctl --no-pager --full status wings 2>/dev/null | head -40 || true'
};

app.post('/api/ssh/shortcut', async (req, res) => {
  try {
    const item = sessionSSH(req);
    if (!item) return res.status(409).json({ ok: false, error: 'Belum terhubung ke SSH.' });
    const command = SAFE_SHORTCUTS[String(req.body?.name || '')];
    if (!command) return res.status(404).json({ ok: false, error: 'Shortcut tidak ditemukan.' });
    const out = await execSSH(item.client, command, 20000);
    res.json({ ok: true, ...out });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/sftp/list', async (req, res) => {
  try {
    const item = sessionSSH(req);
    if (!item) return res.status(409).json({ ok: false, error: 'Belum terhubung ke SSH.' });
    const remotePath = String(req.query.path || item.home || '/');
    const sftp = await getSftp(item.client);
    const list = await readDirSftp(sftp, remotePath);
    const rows = list.map(entry => ({
      name: entry.filename,
      size: entry.attrs.size,
      mtime: entry.attrs.mtime * 1000,
      mode: entry.attrs.mode,
      type: entry.attrs.isDirectory() ? 'dir' : entry.attrs.isSymbolicLink() ? 'link' : 'file'
    })).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
    res.json({ ok: true, path: remotePath, entries: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/sftp/read', async (req, res) => {
  try {
    const item = sessionSSH(req);
    if (!item) return res.status(409).json({ ok: false, error: 'Belum terhubung ke SSH.' });
    const remotePath = String(req.query.path || '');
    if (!remotePath) throw new Error('Path wajib diisi.');
    const sftp = await getSftp(item.client);
    const content = await readTextSftp(sftp, remotePath);
    res.json({ ok: true, path: remotePath, content });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/sftp/write', async (req, res) => {
  try {
    const item = sessionSSH(req);
    if (!item) return res.status(409).json({ ok: false, error: 'Belum terhubung ke SSH.' });
    const remotePath = String(req.body?.path || '');
    const content = String(req.body?.content ?? '');
    if (!remotePath) throw new Error('Path wajib diisi.');
    if (Buffer.byteLength(content) > MAX_TEXT_FILE) throw new Error('Isi file terlalu besar.');
    const sftp = await getSftp(item.client);
    await writeTextSftp(sftp, remotePath, content);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
app.post('/api/sftp/upload', upload.single('file'), async (req, res) => {
  try {
    const item = sessionSSH(req);
    if (!item) return res.status(409).json({ ok: false, error: 'Belum terhubung ke SSH.' });
    if (!req.file) throw new Error('File belum dipilih.');
    const target = String(req.body?.target || '');
    if (!target) throw new Error('Target path wajib diisi.');
    const sftp = await getSftp(item.client);
    await new Promise((resolve, reject) => {
      const stream = sftp.createWriteStream(target, { flags: 'w', mode: 0o644 });
      stream.on('error', reject);
      stream.on('close', resolve);
      stream.end(req.file.buffer);
    });
    res.json({ ok: true, target, size: req.file.size });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/sftp/download', async (req, res) => {
  try {
    const item = sessionSSH(req);
    if (!item) return res.status(409).json({ ok: false, error: 'Belum terhubung ke SSH.' });
    const remotePath = String(req.query.path || '');
    if (!remotePath) throw new Error('Path wajib diisi.');
    const sftp = await getSftp(item.client);
    const stats = await statSftp(sftp, remotePath);
    const filename = path.posix.basename(remotePath).replace(/[\r\n"]/g, '_');
    res.setHeader('Content-Length', String(stats.size));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = sftp.createReadStream(remotePath);
    stream.on('error', err => { if (!res.headersSent) res.status(500).end(err.message); else res.destroy(err); });
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/sftp/mkdir', async (req, res) => {
  try {
    const item = sessionSSH(req);
    if (!item) return res.status(409).json({ ok: false, error: 'Belum terhubung ke SSH.' });
    const remotePath = String(req.body?.path || '');
    if (!remotePath) throw new Error('Path wajib diisi.');
    const sftp = await getSftp(item.client);
    await mkdirSftp(sftp, remotePath);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/sftp/rename', async (req, res) => {
  try {
    const item = sessionSSH(req);
    if (!item) return res.status(409).json({ ok: false, error: 'Belum terhubung ke SSH.' });
    const from = String(req.body?.from || '');
    const to = String(req.body?.to || '');
    if (!from || !to) throw new Error('Path asal dan tujuan wajib diisi.');
    const sftp = await getSftp(item.client);
    await renameSftp(sftp, from, to);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.delete('/api/sftp/delete', async (req, res) => {
  try {
    const item = sessionSSH(req);
    if (!item) return res.status(409).json({ ok: false, error: 'Belum terhubung ke SSH.' });
    const remotePath = String(req.body?.path || '');
    if (!remotePath || remotePath === '/' || remotePath === '.' || remotePath === '..') throw new Error('Path tidak aman untuk dihapus.');
    const sftp = await getSftp(item.client);
    const stats = await statSftp(sftp, remotePath);
    if (stats.isDirectory()) await rmdirSftp(sftp, remotePath);
    else await unlinkSftp(sftp, remotePath);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/media/catalog', (req, res) => {
  res.json({ ok: true, tools: MEDIA_TOOLS });
});

app.post('/api/media/tiktok', async (req, res) => {
  try {
    const mode = ['video', 'audio', 'cover'].includes(String(req.body?.mode)) ? String(req.body.mode) : 'video';
    const result = await fetchTikTok(req.body?.url);
    const selected = mode === 'audio' ? result.audio : mode === 'cover' ? result.cover : result.video;
    if (!selected) throw new Error(`Media ${mode} tidak tersedia untuk link ini.`);
    res.json({ ok: true, mode, selected, result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.post('/api/media/convert', async (req, res) => {
  try {
    const type = String(req.body?.type || '');
    const input = String(req.body?.url || '').trim();
    if (!input) throw new Error('URL wajib diisi.');
    let result;
    if (type === 'gdrive') result = googleDriveDirect(input);
    else if (type === 'githubzip') result = githubRepoZip(input);
    else if (type === 'githubraw') result = githubRaw(input);
    else throw new Error('Converter tidak dikenal.');
    res.json({ ok: true, type, result });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.post('/api/util/hash', (req, res) => {
  try {
    const text = String(req.body?.text ?? '');
    const algorithm = ['sha256', 'sha512', 'md5'].includes(String(req.body?.algorithm)) ? String(req.body.algorithm) : 'sha256';
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Input terlalu besar.');
    const hash = crypto.createHash(algorithm).update(text, 'utf8').digest('hex');
    res.json({ ok: true, algorithm, hash });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.post('/api/util/qr', async (req, res) => {
  try {
    const text = String(req.body?.text || '');
    if (!text || text.length > 4000) throw new Error('Teks QR kosong atau terlalu panjang.');
    const dataUrl = await QRCode.toDataURL(text, { margin: 2, width: 512, errorCorrectionLevel: 'M' });
    res.json({ ok: true, dataUrl });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.get('/api/util/dns', async (req, res) => {
  try {
    const host = sanitizeHost(req.query.host);
    const [a, aaaa, mx, txt] = await Promise.allSettled([
      dns.resolve4(host), dns.resolve6(host), dns.resolveMx(host), dns.resolveTxt(host)
    ]);
    const pick = r => r.status === 'fulfilled' ? r.value : [];
    res.json({ ok: true, host, A: pick(a), AAAA: pick(aaaa), MX: pick(mx), TXT: pick(txt) });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.post('/api/util/http-check', async (req, res) => {
  const started = Date.now();
  try {
    const url = await ensurePublicUrl(req.body?.url);
    let response = await axios.head(url.toString(), {
      timeout: 10000,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: { 'User-Agent': 'FXHL-WebTool/1.0' }
    });
    if (response.status === 405) {
      response = await axios.get(url.toString(), {
        timeout: 10000,
        maxRedirects: 0,
        validateStatus: () => true,
        maxContentLength: 64 * 1024,
        responseType: 'text',
        headers: { 'User-Agent': 'FXHL-WebTool/1.0', Range: 'bytes=0-1023' }
      });
    }
    res.json({
      ok: true,
      url: url.toString(),
      status: response.status,
      statusText: response.statusText,
      ms: Date.now() - started,
      server: response.headers.server || null,
      contentType: response.headers['content-type'] || null
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message, ms: Date.now() - started });
  }
});

app.post('/api/util/tcp-check', async (req, res) => {
  const started = Date.now();
  try {
    const { host, addresses } = await ensurePublicHost(req.body?.host);
    const port = Number(req.body?.port || 443);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port tidak valid.');
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const timer = setTimeout(() => socket.destroy(new Error('Timeout')), 5000);
      socket.once('connect', () => { clearTimeout(timer); socket.end(); resolve(); });
      socket.once('error', err => { clearTimeout(timer); reject(err); });
    });
    res.json({ ok: true, host, addresses, port, open: true, ms: Date.now() - started });
  } catch (err) { res.status(400).json({ ok: false, error: err.message, ms: Date.now() - started }); }
});

app.get('/api/util/tls', async (req, res) => {
  try {
    const { host, addresses } = await ensurePublicHost(req.query.host);
    const port = Number(req.query.port || 443);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port tidak valid.');
    const info = await new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false, timeout: 7000 }, () => {
        try {
          const cert = socket.getPeerCertificate(true);
          const authorized = socket.authorized;
          const authorizationError = socket.authorizationError || null;
          socket.end();
          resolve({
            authorized,
            authorizationError,
            subject: cert.subject || null,
            issuer: cert.issuer || null,
            validFrom: cert.valid_from || null,
            validTo: cert.valid_to || null,
            serialNumber: cert.serialNumber || null,
            fingerprint256: cert.fingerprint256 || null,
            subjectAltName: cert.subjectaltname || null
          });
        } catch (e) { socket.destroy(); reject(e); }
      });
      socket.once('timeout', () => socket.destroy(new Error('TLS timeout.')));
      socket.once('error', reject);
    });
    res.json({ ok: true, host, addresses, port, certificate: info });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets'), { maxAge: '1h' }));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/ssh', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'ssh.html')));
app.get('/files', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'files.html')));
app.get('/downloaders', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'downloaders.html')));
app.get('/network', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'network.html')));
app.get('/lookup', (req, res) => res.redirect('/network'));
app.get('/utilities', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'utilities.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'settings.html')));
app.use(express.static(PUBLIC_DIR));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'Endpoint tidak ditemukan.' });
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

io.on('connection', (socket) => {
  let shell = null;

  socket.on('terminal:open', () => {
    if (shell) return;
    const sshId = socket.request.session?.sshSessionId;
    const item = sshId ? sshSessions.get(sshId) : null;
    if (!item || item.closed) return socket.emit('terminal:error', 'Belum terhubung ke SSH.');

    item.client.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (err, stream) => {
      if (err) return socket.emit('terminal:error', err.message);
      shell = stream;
      socket.emit('terminal:ready', { host: item.host, username: item.username });
      stream.on('data', data => socket.emit('terminal:data', data.toString('utf8')));
      stream.stderr?.on('data', data => socket.emit('terminal:data', data.toString('utf8')));
      stream.on('close', () => {
        shell = null;
        socket.emit('terminal:closed');
      });
    });
  });

  socket.on('terminal:input', (data) => {
    if (!shell) return;
    const text = String(data ?? '');
    if (Buffer.byteLength(text) <= 64 * 1024) shell.write(text);
  });

  socket.on('terminal:resize', ({ cols, rows } = {}) => {
    if (!shell) return;
    const c = Math.max(20, Math.min(300, Number(cols) || 100));
    const r = Math.max(5, Math.min(120, Number(rows) || 30));
    try { shell.setWindow(r, c, 0, 0); } catch {}
  });

  socket.on('disconnect', () => {
    try { shell?.end(); } catch {}
    shell = null;
  });
});

setInterval(() => {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [id, item] of sshSessions) {
    if (item.closed || item.createdAt < cutoff) {
      try { item.client.end(); } catch {}
      sshSessions.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`FXHL WebTool running on http://0.0.0.0:${PORT}`);
  console.log('[INFO] Website opens directly; SSH authentication happens only when connecting to a VPS.');
});
