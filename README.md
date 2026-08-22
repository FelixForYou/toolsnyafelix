# FXHL WebTool v2 — No BetaBotz

Web multi-page dengan gaya neobrutalism untuk SSH/SFTP, media tools, network tools, dan developer utilities.

## Perubahan versi ini

- Tidak ada `APP_PASSWORD`.
- Tidak ada `BETABOTZ_API_KEY`.
- Tidak ada `BETABOTZ_ACCESS_KEY`.
- Tidak ada request ke `api.betabotz.eu.org`.
- REST API Explorer BetaBotz dihapus.
- Halaman lookup BetaBotz diganti menjadi **Network Tools**.
- TikTok downloader memakai provider no-key terpisah.
- Google Drive/GitHub converter tidak memakai API key.

## Fitur

### SSH

- Login VPS via password.
- Login VPS via private key.
- Terminal interaktif melalui WebSocket.
- Resize terminal.
- Live server stats.
- Quick command.
- Disconnect session.

### SFTP

- Browse folder.
- Upload file.
- Download file.
- Edit file teks.
- Rename.
- Create folder.
- Delete file/folder kosong.

### Media Tools

- TikTok video no-watermark.
- TikTok audio.
- TikTok cover.
- Google Drive direct-link converter.
- GitHub repository ZIP link.
- GitHub blob → raw link.
- Direct URL HTTP checker.

### Network Tools

- DNS A/AAAA/MX/TXT lookup.
- HTTP status checker.
- TCP single-port checker untuk target publik.
- TLS certificate inspector.
- URL parser.

### Developer Utilities

- JSON formatter/minifier.
- Base64 encode/decode.
- URL encode/decode.
- SHA-256/SHA-512/MD5 hash.
- UUID generator.
- Password generator.
- Unix timestamp converter.
- JWT decoder (tanpa verifikasi signature).
- QR generator.
- DNS checker.
- HTTP checker.

## Environment

Salin `.env.example` menjadi `.env`:

```env
PORT=3000
NODE_ENV=production
COOKIE_SECURE=auto
SESSION_SECRET=ganti-dengan-random-panjang-minimal-32-karakter
ALLOWED_SSH_HOSTS=
```

`ALLOWED_SSH_HOSTS` opsional. Contoh:

```env
ALLOWED_SSH_HOSTS=1.2.3.4,node.example.com
```

## Menjalankan

```bash
npm install
npm start
```

Buka `http://IP:3000`.

## Deploy

### VPS / Pterodactyl

Ini target utama untuk seluruh fitur karena SSH membutuhkan:

- proses Node persistent;
- WebSocket;
- koneksi TCP keluar ke port SSH VPS.

Jika memakai Nginx/Cloudflare, pastikan WebSocket diteruskan.

### Vercel

UI statis dan endpoint HTTP sederhana dapat diadaptasi ke Vercel Functions, tetapi **terminal SSH interaktif tidak dapat mengandalkan arsitektur serverless Vercel ini**. Untuk skenario Vercel, gunakan:

```text
Frontend Vercel
     ↓ HTTPS/WSS
Backend SSH di VPS/Pterodactyl
     ↓ TCP 22
VPS tujuan
```

Project ini masih berupa satu server Node agar versi VPS mudah dijalankan. Jika ingin frontend Vercel + backend VPS dipisahkan, URL backend perlu dijadikan environment/config frontend.

## TikTok

TikTok media menggunakan provider no-key pihak ketiga. Tidak ada API key yang perlu diisi pada project. Karena provider eksternal dapat mengubah endpoint/rate-limit, bagian ini tidak bisa dijamin selamanya tanpa maintenance.

Gunakan downloader hanya untuk konten publik yang memang kamu punya izin/hak untuk menyimpan.

## Security

Dashboard tidak memakai app password. Karena itu, jika domain dibuka ke internet:

1. aktifkan HTTPS;
2. isi `ALLOWED_SSH_HOSTS` agar koneksi SSH hanya menuju server yang kamu izinkan;
3. pertimbangkan Cloudflare Access/WAF untuk membatasi siapa yang dapat membuka dashboard;
4. jangan commit `.env` atau private key SSH ke GitHub;
5. jangan gunakan web ini untuk mengakses server yang bukan milikmu/tanpa izin.
