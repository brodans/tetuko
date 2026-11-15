/**
 * Notifikasi native/web (Tauri desktop atau Web Notification API).
 */
export async function kirimNotifikasiNative(title: string, message: string): Promise<void> {
  // Tauri plugin-notification (desktop)
  try {
    const { sendNotification, isPermissionGranted, requestPermission } =
      await import('@tauri-apps/plugin-notification');
    let permitted: boolean = await isPermissionGranted();
    if (!permitted) {
      const permission: string = await requestPermission();
      permitted = permission === 'granted';
    }
    if (permitted) {
      await sendNotification({ title, body: message });
      return;
    }
  } catch {
    // di luar Tauri / plugin tidak tersedia
  }

  // Web Notification API
  try {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body: message, icon: '/assets/icon-192.png' });
        return;
      }
      if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification(title, { body: message, icon: '/assets/icon-192.png' });
          return;
        }
      }
    }
  } catch {
    // abaikan
  }

  console.info(`[Notifikasi] ${title}: ${message}`);
}
