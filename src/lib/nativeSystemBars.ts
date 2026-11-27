/**
 * Overlay gelap native (image lightbox, developer inspector, dll).
 *
 * Saat overlay gelap dibuka pada mode terang, status bar & navigation bar
 * Android tetap memakai ikon gelap sehingga tidak terlihat di atas latar
 * gelap. Helper ini memaksa ikon bar menjadi terang selama overlay aktif
 * (ref-count, aman untuk overlay bertumpuk) lalu mengembalikan tema semula.
 *
 * Di lingkungan non-native (web/Vercel/desktop) helper ini no-op.
 */

import { currentAppThemeIsDark, isAndroidTetuko, setAndroidSystemBarsDark } from './androidNative';

let activeDarkOverlays = 0;
let previousTheme: boolean | null = null;

export function acquireNativeDarkOverlay(): () => void {
  if (!isAndroidTetuko()) return () => {};

  activeDarkOverlays += 1;
  if (activeDarkOverlays === 1) {
    previousTheme = currentAppThemeIsDark();
    setAndroidSystemBarsDark(true);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeDarkOverlays = Math.max(0, activeDarkOverlays - 1);
    if (activeDarkOverlays === 0) {
      const restore = previousTheme ?? false;
      previousTheme = null;
      setAndroidSystemBarsDark(restore);
    }
  };
}
