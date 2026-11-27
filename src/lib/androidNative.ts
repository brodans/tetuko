/**
 * Bridge komunikasi antara React frontend dan native Android (TetukoBridge).
 * Digunakan untuk menjaga automasi presensi tetap hidup di background Android.
 */

interface AndroidTetukoInterface {
  startForegroundService?: (title?: string, content?: string) => void;
  stopForegroundService?: () => void;
  requestNotificationPermission?: () => void;
  requestBatteryOptimizationExemption?: () => void;
  isIgnoringBatteryOptimizations?: () => boolean;
  showNotification?: (title: string, message: string) => boolean;
  setTheme?: (dark: boolean) => void;
  openReportBase64?: (base64: string, filename: string, mime: string) => void;
  saveReportBase64?: (base64: string, filename: string, mime: string) => boolean;
}

function getAndroidBridge(): AndroidTetukoInterface | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as Record<string, unknown>).AndroidTetuko as
    | AndroidTetukoInterface
    | undefined;
}

export function isAndroidTetuko(): boolean {
  return typeof getAndroidBridge() !== 'undefined';
}

export function startAndroidForegroundService(
  title = 'TETUKO Automasi Aktif',
  content = 'Scheduler presensi berjalan di latar belakang',
): void {
  try {
    getAndroidBridge()?.startForegroundService?.(title, content);
  } catch (err) {
    console.warn('[AndroidBridge] Gagal menyalakan Foreground Service:', err);
  }
}

export function stopAndroidForegroundService(): void {
  try {
    getAndroidBridge()?.stopForegroundService?.();
  } catch (err) {
    console.warn('[AndroidBridge] Gagal menghentikan Foreground Service:', err);
  }
}

export function requestAndroidNotificationPermission(): void {
  try {
    getAndroidBridge()?.requestNotificationPermission?.();
  } catch (err) {
    console.warn('[AndroidBridge] Gagal meminta izin notifikasi:', err);
  }
}

export function requestAndroidBatteryOptimization(): void {
  try {
    getAndroidBridge()?.requestBatteryOptimizationExemption?.();
  } catch (err) {
    console.warn('[AndroidBridge] Gagal meminta izin optimasi baterai:', err);
  }
}

export function androidBatteryOptimizationDiizinkan(): boolean {
  try {
    return getAndroidBridge()?.isIgnoringBatteryOptimizations?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Atur tampilan status bar & navigation bar Android (ikon terang/gelap).
 * `dark = true` membuat ikon bar menjadi putih — dipakai saat overlay gelap
 * (image lightbox, developer inspector) dibuka pada mode terang.
 */
export function setAndroidSystemBarsDark(dark: boolean): void {
  try {
    getAndroidBridge()?.setTheme?.(dark);
  } catch (err) {
    console.warn('[AndroidBridge] Gagal mengatur tema system bar:', err);
  }
}

/** Tema aplikasi saat ini menurut DOM/localStorage (fallback: terang). */
export function currentAppThemeIsDark(): boolean {
  try {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) return true;
    if (typeof window !== 'undefined') {
      const v = window.localStorage.getItem('theme');
      if (v === 'dark') return true;
      if (v === 'light') return false;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Buka berkas laporan (PDF/Excel/CSV) lewat aplikasi eksternal Android
 * (Chrome, Google Drive, PDF Viewer, dll). Berkas ditulis ke cache aplikasi
 * oleh native lalu dibagikan via FileProvider.
 * @returns `true` bila bridge native berhasil dipanggil.
 */
function cleanMime(mime: string | undefined, blob: Blob): string {
  const base = String(mime || blob.type || '').split(';')[0].trim().toLowerCase();
  return base || 'application/octet-stream';
}

function readBlobAsBase64(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const raw = String(reader.result || '');
          const comma = raw.indexOf(',');
          const base64 = comma >= 0 ? raw.slice(comma + 1) : raw;
          resolve(base64 || null);
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

/** Buka berkas lewat aplikasi eksternal Android (Chrome/PDF viewer/Excel). */
export async function openReportOnAndroid(blob: Blob, filename: string, mime?: string): Promise<boolean> {
  const bridge = getAndroidBridge();
  if (!bridge?.openReportBase64) return false;
  const base64 = await readBlobAsBase64(blob);
  if (!base64) return false;
  try {
    bridge.openReportBase64(base64, filename, cleanMime(mime, blob));
    return true;
  } catch (err) {
    console.warn('[AndroidBridge] Gagal membuka laporan:', err);
    return false;
  }
}

/**
 * Simpan berkas ke folder Unduhan Android (MediaStore) agar tetap ada dan
 * terlihat di aplikasi Files. Lebih andal daripada dialog SAF di WebView.
 */
export async function saveReportOnAndroid(blob: Blob, filename: string, mime?: string): Promise<boolean> {
  const bridge = getAndroidBridge();
  if (!bridge?.saveReportBase64) return false;
  const base64 = await readBlobAsBase64(blob);
  if (!base64) return false;
  try {
    return bridge.saveReportBase64(base64, filename, cleanMime(mime, blob)) === true;
  } catch (err) {
    console.warn('[AndroidBridge] Gagal menyimpan laporan:', err);
    return false;
  }
}

export function showAndroidNotification(title: string, message: string): boolean {
  try {
    const bridge = getAndroidBridge();
    if (bridge?.showNotification) {
      bridge.showNotification(title, message);
      return true;
    }
  } catch (err) {
    console.warn('[AndroidBridge] Gagal mengirim notifikasi Android:', err);
  }
  return false;
}
