# 🗓️ Tododo (v1.0.1)

Tododo adalah aplikasi desktop manajemen tugas terpadu dengan kalender yang sangat ringan, dioptimalkan secara ketat untuk performa terbaik di Windows. Dibangun dengan Electron dan antarmuka *vanilla* JavaScript, HTML, & CSS tanpa framework pihak ketiga yang berat.

<p align="center">
  <a href="https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPOSITORY_NAME/releases/latest/download/Tododo.Setup.1.0.0.exe">
    <img src="https://img.shields.io/badge/📥_Download_Tododo_v1.0.1_untuk_Windows-0056b3?style=for-the-badge&logo=windows&logoColor=white" alt="Download Tododo" />
  </a>
</p>

> **Catatan Download:** Silakan ganti URL download di atas dengan link rilis `.exe` Github Anda (di menu **Releases**). Saat ini format file *installer* yang akan otomatis terunduh adalah `Tododo Setup 1.0.0.exe`.

---

## ✨ Fitur Utama

- ⚡ **Sangat Ringan:** Menghindari rendering DOM berat. Tidak ada *Node Integration* untuk keamanan penuh.
- 🎯 **Quick Input (NLP-lite):** Parsing input bahasa alami cepat (contoh: `Rapat klien #work !high @besok`). Mendukung mode *batch* paste text *multi-line* atau pemisah `;` (titik koma).
- 📅 **Sinkronisasi Hari Libur Indonesia:** Menggunakan REST API gratis dari `libur.deno.dev`. Menampilkan libur nasional dan cuti bersama otomatis. Lengkap dengan sistem *offline cache*.
- 🔔 **Sistem Pengingat (Reminder):** Push-Notification bawaan operasi sistem (Native OS Notifications) dengan sistem repetisi harian/mingguan/bulanan.
- 📌 **Window "Selalu di Atas" (Always on Top):** Mode *pin* sehingga aplikasi tetap menempel di layar teratas.
- 📦 **Ekspor & Impor (JSON):** Keamanan pencadangan penuh ke penyimpanan lokal PC. Pencadangan mencakup resolusi task, filter dan repetisi tanpa khawatir kehilangan data.

---

## 🚀 Instalasi Mandiri (Untuk Developer)

Jika Anda ingin mereplika pembangunan atau memodifikasi source code:

1. **Clone repository ini**
   ```bash
   git clone https://github.com/USERNAME/REPO_NAME.git
   cd REPO_NAME
   ```

2. **Dapatkan *Dependencies***
   ```bash
   npm install
   ```

3. **Jalankan Aplikasi dalam Mode Pengembang**
   ```bash
   npm start
   ```

4. **Kompilasi ulang menjadi Executeable (.exe)**
   ```bash
   npm run build
   ```
   *Instaler baru akan tersimpan berdampingan di folder `/dist/`.*

---

## 👨‍💻 Kredit dan Terima Kasih
- Dikembangkan oleh **Eben**
- Engine menggunakan [Electron](https://www.electronjs.org/)
- UI Framework dikembangkan murni menggunakan Vanilla JS, CSS3, & HTML5
- API Kalender dan Hari Libur oleh [api-hari-libur](https://github.com/radyakaze/api-hari-libur) (Deno)

---

<p align="center">
  Dibuat dengan ❤️ untuk produktivitas yang bebas macet.
</p>
