# Ruang 3D

Studio lokal berbasis React, Vite, Three.js, dan GaussianSplats3D. Bisa melihat Gaussian Splats, membuka mesh GLB, dan mengirim satu foto ke Meshy untuk menghasilkan model 3D bertekstur.

## Asal project

Project ini dikembangkan dari [panjielaksono/3dgs](https://github.com/panjielaksono/3dgs), dengan riwayat commit awal tetap dipertahankan. Pengembangan Ruang 3D menambahkan viewer GLB, galeri lokal, kontrol kamera, screenshot, validasi file, integrasi Meshy, dan tampilan baru. Model Gaussian dan sebagian aset bawaan berasal dari project awal; atribusi ini tidak menetapkan lisensi baru untuk aset tersebut.

## Menjalankan

Node.js sesuai lockfile: 20.19+ atau 22.12+; disarankan Node.js 24. Node 24 sudah tersedia pada komputer ini.

```powershell
cd D:\magang\3D\3dgs
npm install
npm run dev
```

Buka alamat Local yang tampil di terminal. Port normal 5173, tetapi Vite memilih port berikutnya jika sudah dipakai. Biarkan terminal terbuka. Ctrl+C menghentikan server.

Alternatif Windows: klik dua kali `start.bat`. Script memasang dependency jika belum tersedia, menjalankan server, dan membuka browser. Koneksi internet diperlukan untuk instalasi awal dan generasi AI; viewer dan demo bawaan bekerja secara lokal setelah dependency terpasang.

## Mengaktifkan gambar menjadi model 3D

1. Buat API key pada akun Meshy yang memiliki akses API dan kredit.
2. Salin `.env.example` menjadi `.env` jika belum ada. Pada implementasi ini `.env` kosong sudah disiapkan jika sebelumnya tidak tersedia.
3. Isi `MESHY_API_KEY=key_milikmu` di `.env`, simpan, lalu restart `npm run dev`.
4. Buka tab **Gambar → 3D**, pilih JPG/PNG maksimal 10 MB.
5. Tekan **Buat model 3D**. Ini mengirim gambar ke Meshy dan menggunakan kredit akun. Aplikasi tidak mengirim gambar hanya karena dipilih atau di-drag.
6. Status tugas diperiksa berkala. Jika selesai, GLB diunduh oleh server ke folder `data`, ditambahkan ke galeri, dan dibuka otomatis.
7. Klik **Unduh model** untuk menyimpan GLB atau **Screenshot → Unduh PNG** untuk menyimpan tampilan.

API key hanya dibaca konfigurasi server, bukan bundle browser. Jangan gunakan awalan `VITE_` untuk key. `.env` dan `data/` diabaikan Git.

Dokumentasi provider: https://docs.meshy.ai/en/api/image-to-3d

Foto tunggal menghasilkan perkiraan mesh oleh AI. Sisi yang tidak tampak pada foto diperkirakan; hasilnya bukan rekonstruksi terukur, dan bukan Gaussian Splatting. Gunakan objek utuh, tajam, latar sederhana, serta sudut yang memperlihatkan bentuk objek dengan jelas.

Tanpa API key, viewer, galeri, screenshot, dan kedua demo tetap bisa dipakai. Generasi foto sungguhan belum bisa diverifikasi tanpa key/kredit. Tes integrasi menggunakan respons provider simulasi, tidak mengirim foto atau menggunakan kredit nyata.

## File yang diterima

| Jenis | Format | Batas |
|---|---|---|
| Gambar untuk AI | JPG/JPEG, PNG | 10 MB |
| Gaussian Splatting | PLY, SPLAT, KSPLAT | 250 MB |
| Mesh 3D | GLB versi 2 | 250 MB |

PLY harus memiliki data Gaussian seperti opacity, scale, dan rotation. PLY point cloud/mesh biasa tidak didukung viewer Gaussian. GLB sebaiknya memiliki tekstur tertanam; aset eksternal yang tidak bisa dijangkau dapat menyebabkan loading gagal. Browser perlu WebGL yang berfungsi. KSPLAT yang tidak sesuai akan ditolak loader saat dibuka.

File bisa dipilih melalui **Buka model**, atau di-drag ke halaman. Gambar yang di-drag menjadi gambar sumber AI. Model lokal yang dibuka akan disalin ke galeri server. Model baru mengganti model yang sedang terlihat.

## Kontrol dan galeri

- Drag kiri: putar; scroll: zoom; drag kanan: geser.
- **Fit model**: pusatkan objek dan sesuaikan jarak kamera terhadap batas objek.
- **Reset kamera**: kembali ke posisi awal setelah model dimuat.
- Preset: Depan, Samping, Atas, Perspektif.
- Background, kualitas resolusi render, putar otomatis, fullscreen.
- Loading bisa dibatalkan. Error tidak menutup akses memilih model lain.
- **Screenshot** membuka preview hasil canvas; **Unduh PNG** menyimpan gambar.
- Galeri dan riwayat AI bertahan pada restart karena tersimpan di `data/index.json` dan file model di `data/`.
- Setelah refresh saat AI belum selesai: buka **Riwayat AI → Lanjutkan / cek hasil**. Jangan mengirim generasi baru hanya karena pemeriksaan status terhenti.
- **Salin link lokal** menggunakan `?model=<id>`. Link hanya membuka model pada server lokal yang sama; bukan link publik. Untuk membagikan ke orang lain, kirim GLB atau PNG yang diunduh.

Server hanya mendengarkan 127.0.0.1 dan API menolak origin/host lain. Deployment publik memerlukan server backend terpisah dengan autentikasi, kuota upload/generasi, dan penyimpanan yang sesuai. Build `dist` saja tidak menyediakan API, galeri server, atau AI.

## Alur program

```text
index.html → main.jsx → App.jsx
                         ├─ Viewer → Three.js + OrbitControls
                         │            ├─ GLB → GLTFLoader
                         │            └─ PLY/SPLAT/KSPLAT → GaussianSplats3D
                         ├─ Buka model → validasi → POST /api/models → data/ → viewer
                         └─ Gambar → POST /api/tasks → Meshy (API key server)
                                      → GET /api/tasks/:id → progress
                                      → GLB selesai → data/ → galeri → viewer
```

`src/modelFiles.js`: validasi gambar/model dan batas ukuran. `src/viewer.js`: renderer, kamera, kontrol, pembersihan resource, screenshot. `src/App.jsx`: UI, status, pergantian model, polling AI. `server/api.js`: integrasi provider serta penyimpanan file/metadata. `vite.config.js`: memasang API lokal pada dev dan preview.

## Verifikasi dan build

```powershell
npm test
npm run lint
npm run build
npm run preview
```

Preview juga menyediakan API lokal melalui konfigurasi Vite. Restart preview setelah mengubah `.env`. `npm run demo` membuat ulang robot GLB bawaan secara deterministik.

Tes mencakup format invalid, galeri upload/download, penolakan origin lain, key belum tersedia, serta alur AI simulasi sampai model tersimpan. Uji browser dilakukan untuk Gaussian bawaan, demo GLB, unggah model ke galeri, reload model tersimpan, dan preview screenshot. Format SPLAT/KSPLAT lain belum diuji memakai fixture nyata.

## Batas pengembangan saat ini

Belum ada hosting/link publik, anotasi, perbandingan dua model, rekonstruksi multi-foto, atau training Gaussian Splats. Integrasi AI yang tersedia adalah satu foto melalui Meshy. Kualitas viewer mengubah resolusi render, bukan menyederhanakan jumlah splat/polygon. Model besar tetap dapat membutuhkan RAM/GPU yang cukup.
