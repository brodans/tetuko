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
