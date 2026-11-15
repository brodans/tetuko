import { invoke } from '@tauri-apps/api/core';

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export interface NativeAutomationPayload {
  profiles: Record<string, any>;
  runtime?: any;
}

export async function syncNativeAutomation(payload: NativeAutomationPayload): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('automation_sync', { payload });
  } catch (e) {
    console.warn('[nativeAutomation] sync gagal', e);
  }
}

export async function setNativeScheduler(profileId: string, enabled: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    await invoke('automation_set_scheduler', { profileId, enabled });
  } catch (e) {
    console.warn('[nativeAutomation] set scheduler gagal', e);
  }
}

export async function getNativeAutomationState(): Promise<any | null> {
  if (!isTauriRuntime()) return null;
  try {
    return await invoke('automation_get_state');
  } catch {
    return null;
  }
}

export function isNativeAutomationPreferred(): boolean {
  return isTauriRuntime();
}
