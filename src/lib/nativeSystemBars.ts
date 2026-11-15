/**
 * Overlay gelap native (no-op di lingkungan non-native).
 * Dipertahankan agar komponen yang memakai ref-count overlay tetap aman.
 */

let activeDarkOverlays = 0;

export function acquireNativeDarkOverlay(): () => void {
  activeDarkOverlays += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeDarkOverlays = Math.max(0, activeDarkOverlays - 1);
  };
}
