import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './nativeAutomation';

export type TrayNavigateTarget =
  | 'absen:jatim'
  | 'absen:madiun'
  | 'absen:ponorogo'
  | 'ponorogo:produktifitas-harian'
  | 'ponorogo:database'
  | 'preset';

export async function getAutostartEnabled(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    return await invoke<boolean>('get_autostart_enabled');
  } catch {
    return false;
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return await invoke<boolean>('set_autostart_enabled', { enabled });
}

export async function listenTrayNavigate(cb: (target: TrayNavigateTarget) => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const un = await listen<{ target?: string }>('tetuko://tray-navigate', (ev) => {
    const t = String(ev?.payload?.target || '') as TrayNavigateTarget;
    if (t) cb(t);
  });
  return un;
}

export async function listenAutostartChanged(cb: (enabled: boolean) => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const un = await listen<{ enabled?: boolean }>('tetuko://autostart-changed', (ev) => {
    cb(!!ev?.payload?.enabled);
  });
  return un;
}
