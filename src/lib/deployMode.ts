/**
 * Deployment/runtime mode flags.
 * - Vercel deployment: automation features are completely disabled (no menus, no permissions, no scheduler).
 * - Dev (npm run dev / vite dev) and Tauri (desktop): automation remains fully available.
 */
export const IS_VERCEL_DEPLOY = (() => {
  const v = String(import.meta.env?.VITE_VERCEL ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
})();

export const AUTOMATION_AVAILABLE = !IS_VERCEL_DEPLOY;