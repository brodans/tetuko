import { bersihkanNamaBerkas } from './unduh';
import { isAndroidTetuko, saveReportOnAndroid } from './androidNative';

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__ || w.__TAURI_METADATA__);
}

function mimeToExt(mime?: string, fallback = 'bin'): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('json')) return 'json';
  if (m.includes('csv')) return 'csv';
  if (m.includes('spreadsheet') || m.includes('excel') || m.includes('sheet')) return 'xlsx';
  if (m.includes('plain')) return 'txt';
  return fallback;
}

function ensureExt(name: string, mime?: string): string {
  const clean = bersihkanNamaBerkas(name);
  if (/\.[a-z0-9]{1,8}$/i.test(clean)) return clean;
  return `${clean}.${mimeToExt(mime)}`;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function saveBlobWithDialog(
  blob: Blob,
  suggestedName: string,
  mimeHint?: string,
): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const name = ensureExt(suggestedName, mimeHint || blob.type);
  const path = await save({ defaultPath: name });
  if (!path) return null;
  const bytes = await blobToUint8Array(blob);
  await writeFile(path, bytes);
  return path;
}

export async function saveTextWithDialog(
  content: string,
  suggestedName: string,
): Promise<string | null> {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  return saveBlobWithDialog(blob, suggestedName, 'text/plain');
}

export async function saveDataUrlWithDialog(
  dataUrl: string,
  suggestedName: string,
): Promise<string | null> {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(dataUrl);
  if (!m) {
    const blob = new Blob([dataUrl], { type: 'text/plain;charset=utf-8' });
    return saveBlobWithDialog(blob, suggestedName, 'text/plain');
  }
  const mime = m[1] || 'application/octet-stream';
  const isBase64 = !!m[2];
  const data = m[3] || '';
  const bytes = isBase64 ? base64ToUint8Array(data) : new TextEncoder().encode(decodeURIComponent(data));
  const blob = new Blob([bytes as BlobPart], { type: mime });
  return saveBlobWithDialog(blob, suggestedName, mime);
}

export async function revealInFileManager(path: string): Promise<void> {
  if (!isTauriRuntime() || !path) return;
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(path);
    return;
  } catch {
    // fallback below
  }
  try {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    // open parent folder best-effort by opening the path (file manager may focus/select depending on platform)
    await openPath(path);
  } catch {
    // ignore
  }
}

export async function saveBlobSmart(options: {
  blob: Blob;
  filename: string;
  mimeHint?: string;
  showToast?: (message: string, opts?: { action?: { label: string; onClick: () => void | Promise<void> }; durationMs?: number }) => void;
  successMessage?: string;
  onCancel?: () => void;
}): Promise<{ saved: boolean; path?: string; cancelled?: boolean }> {
  const { blob, filename, mimeHint, showToast, successMessage, onCancel } = options;
  if (isTauriRuntime()) {
    // Android: simpan langsung ke folder Unduhan lewat MediaStore (tanpa SAF).
    if (isAndroidTetuko()) {
      const name = ensureExt(filename, mimeHint || blob.type);
      const ok = await saveReportOnAndroid(blob, name, mimeHint || blob.type);
      if (ok) {
        showToast?.(successMessage || 'Berkas disimpan di folder Unduhan.', { durationMs: 6000 });
        return { saved: true };
      }
    }
    try {
      const path = await saveBlobWithDialog(blob, filename, mimeHint || blob.type);
      if (!path) {
        onCancel?.();
        return { saved: false, cancelled: true };
      }
      showToast?.(successMessage || `Berkas berhasil disimpan.`, {
        durationMs: 9000,
        action: {
          label: 'Buka lokasi',
          onClick: async () => { await revealInFileManager(path); },
        },
      });
      return { saved: true, path };
    } catch (e: any) {
      throw e;
    }
  }

  // Web fallback: trigger browser download (no reliable way to reveal location)
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = bersihkanNamaBerkas(filename);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast?.(successMessage || 'Berkas berhasil diunduh.', { durationMs: 5000 });
  return { saved: true };
}

export async function saveBlobToCacheAndOpen(blob: Blob, filename: string, mimeHint?: string): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  const { writeFile, mkdir } = await import('@tauri-apps/plugin-fs');
  const { cacheDir, join } = await import('@tauri-apps/api/path');
  const { openPath } = await import('@tauri-apps/plugin-opener');
  const name = ensureExt(filename, mimeHint || blob.type);
  const dir = await cacheDir();
  const folder = await join(dir, 'tetuko-reports');
  try { await mkdir(folder, { recursive: true }); } catch {}
  const path = await join(folder, name);
  const bytes = await blobToUint8Array(blob);
  await writeFile(path, bytes);
  try {
    await openPath(path);
  } catch {
    // Fallback: try opening as file URL via opener
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(path);
    } catch {}
  }
  return path;
}
