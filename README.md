# Kota Pangan Mandiri – Prototype (Vite + React + Tailwind)

Prototype city-building fokus **pertanian perkotaan** & **ketahanan pangan lokal** (PSI).

## Menjalankan di lokal
1. **Install** Node.js ≥ 18 dan Git.
2. Buka terminal di folder proyek ini, lalu:
   ```bash
   npm install
   npm run dev
   ```
   Buka URL yang ditampilkan (mis. http://localhost:5173).

## Build production
```bash
npm run build
npm run preview
```

## Struktur
- `src/App.jsx` — seluruh prototipe (grid, event cuaca, PSI, pasar, kebijakan, tutorial).
- `src/main.jsx` — bootstrap React.
- `index.html` — entry Vite.
- `tailwind.config.js`, `postcss.config.js`, `src/index.css` — Tailwind.

## GitHub Pages (opsional)
Sudah disertakan workflow **.github/workflows/deploy.yml**. Setelah push ke `main`, workflow akan build dan deploy ke GitHub Pages.

> Jika ini **Project Pages** (bukan user/org pages), Anda mungkin perlu set `base` di `vite.config.js` menjadi `'/NAMA_REPO/'`.

## Lisensi
MIT — bebas digunakan untuk edukasi dan pengembangan lanjut.
