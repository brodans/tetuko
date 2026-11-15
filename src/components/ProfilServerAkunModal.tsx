import { useEffect, useState } from 'react';
import { Camera, KeyRound, ShieldCheck, Upload } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useServerContext } from '../hooks/useServerContext';
import { useToast } from './ui/Toast';
import { Modal } from './ui/Modal';
import { ActionButton, Alert, Card, CardTitle, Field, PasswordField } from './ui/Surface';
import { rpcUpdateFoto, rpcUpdateProfil } from '../lib/apiCalls';
import { fotoProfileValid } from '../lib/viewModels';

const MAX_PHOTO_BYTES = 3_000_000;

function validasiPassword(pw: string): string | null {
  if (pw.length < 8) return 'Password baru minimal 8 karakter.';
  if (!/[A-Z]/.test(pw)) return 'Password baru harus memuat huruf besar.';
  if (!/[0-9]/.test(pw)) return 'Password baru harus memuat angka.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password baru harus memuat karakter spesial.';
  return null;
}

export default function ProfilServerAkunModal({ onClose }: { onClose: () => void }) {
  const { pegawai, setPegawai } = useAppContext();
  const { context, ready } = useServerContext();
  const toast = useToast();

  const [mode, setMode] = useState<'password' | 'foto'>('password');

  const [passwordLama, setPasswordLama] = useState('');
  const [passwordBaru, setPasswordBaru] = useState('');
  const [konfirmasi, setKonfirmasi] = useState('');
  const [gantiSibuk, setGantiSibuk] = useState(false);
  const [gantiError, setGantiError] = useState<string | null>(null);

  const [fotoBerkas, setFotoBerkas] = useState<File | null>(null);
  const [fotoPratinjau, setFotoPratinjau] = useState<string>('');
  const [unggahSibuk, setUnggahSibuk] = useState(false);
  const [unggahError, setUnggahError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (fotoPratinjau) URL.revokeObjectURL(fotoPratinjau);
    };
  }, [fotoPratinjau]);

  const handleGantiPratinjau = (berikutnya: string) => {
    setFotoPratinjau((pratinjauLama) => {
      if (pratinjauLama) URL.revokeObjectURL(pratinjauLama);
      return berikutnya;
    });
  };

  const handleGantiPassword = async () => {
    setGantiError(null);
    if (!passwordLama) return setGantiError('Password lama wajib diisi.');
    if (!passwordBaru) return setGantiError('Password baru wajib diisi.');
    if (passwordBaru !== konfirmasi) return setGantiError('Password baru tidak sama dengan konfirmasi.');
    const masalah = validasiPassword(passwordBaru);
    if (masalah) return setGantiError(masalah);

    setGantiSibuk(true);
    try {
      const result = await rpcUpdateProfil(context, { passwordLama, passwordBaru });
      if (result === null) return setGantiError('Server pusat menolak. Periksa password lama Anda.');
      if (result.result === false) return setGantiError(result.message || 'Server menolak penggantian password.');
      toast.success(result.message || 'Password server pusat berhasil diganti.');
      setPasswordLama('');
      setPasswordBaru('');
      setKonfirmasi('');
    } catch (err: any) {
      setGantiError(err?.message ?? 'Gagal mengganti password server pusat.');
    } finally {
      setGantiSibuk(false);
    }
  };

  const handlePilihFoto = (file: File | null) => {
    setUnggahError(null);
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) return setUnggahError(`Foto maksimal ${Math.round(MAX_PHOTO_BYTES / 1_000_000)} MB.`);
    if (!/^image\/(jpeg|jpg|png)$/i.test(file.type)) return setUnggahError('Foto harus berupa JPG atau PNG.');
    setFotoBerkas(file);
    handleGantiPratinjau(URL.createObjectURL(file));
  };

  const handleUnggahFoto = async () => {
    setUnggahError(null);
    if (!fotoBerkas) return setUnggahError('Pilih foto terlebih dahulu.');
    setUnggahSibuk(true);
    try {
      const base64 = await bacaBase64(fotoBerkas);
      const result = await rpcUpdateFoto(context, { image64: base64 });
      if (result === null) return setUnggahError('Server pusat menolak unggahan foto.');
      if (result.result === false) return setUnggahError(result.message || 'Server menolak unggahan foto.');
      const urlBaru = fotoProfileValid((result as any).url);
      if (urlBaru) setPegawai((prev: any) => (prev ? { ...prev, profilePic: urlBaru } : prev));
      toast.success((result as any).message || 'Foto profil berhasil diperbarui.');
      setFotoBerkas(null);
      handleGantiPratinjau('');
    } catch (err: any) {
      setUnggahError(err?.message ?? 'Gagal mengunggah foto profil.');
    } finally {
      setUnggahSibuk(false);
    }
  };

  if (!pegawai || !ready) {
    return (
      <Modal open onClose={onClose} size="sm" title="Profil Akun Server" icon={<ShieldCheck className="w-5 h-5 text-blue-500" />}>
        <Alert tone="amber">Hubungkan akun ke server pusat terlebih dahulu.</Alert>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Profil Akun Server"
      icon={<ShieldCheck className="w-5 h-5 text-blue-500" />}
      footer={
        <div className="flex items-center gap-2">
          <ActionButton variant="ghost" size="sm" onClick={onClose}>Tutup</ActionButton>
          {mode === 'password' ? (
            <ActionButton className="flex-1" loading={gantiSibuk} onClick={() => void handleGantiPassword()} icon={<KeyRound className="w-4 h-4" />}>
              Ganti Password
            </ActionButton>
          ) : (
            <ActionButton className="flex-1" loading={unggahSibuk} disabled={!fotoBerkas} onClick={() => void handleUnggahFoto()} icon={<Upload className="w-4 h-4" />}>
              Unggah Foto
            </ActionButton>
          )}
        </div>
      }
    >
      <div className="min-h-[22rem] space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMode('password')}
            className={`flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${mode === 'password' ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
          >
            <KeyRound className="w-4 h-4" /> Password
          </button>
          <button
            type="button"
            onClick={() => setMode('foto')}
            className={`flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${mode === 'foto' ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
          >
            <Camera className="w-4 h-4" /> Foto Profil
          </button>
        </div>

        {mode === 'password' ? (
          <>
            {gantiError && <Alert tone="rose">{gantiError}</Alert>}
            <Field label="Password Lama" hint="Masukkan password server pusat yang sedang digunakan.">
              <PasswordField value={passwordLama} onChange={(v) => setPasswordLama(v.replace(/\s/g, ''))} autoComplete="current-password" />
            </Field>
            <Field label="Password Baru" hint="Min. 8 karakter, huruf besar, angka, dan simbol.">
              <PasswordField value={passwordBaru} onChange={(v) => setPasswordBaru(v.replace(/\s/g, ''))} autoComplete="new-password" />
            </Field>
            <Field label="Ulangi Password Baru">
              <PasswordField value={konfirmasi} onChange={(v) => setKonfirmasi(v.replace(/\s/g, ''))} autoComplete="new-password" />
            </Field>
          </>
        ) : (
          <>
            {unggahError && <Alert tone="rose">{unggahError}</Alert>}
            <Card className="bg-slate-50/60 dark:bg-slate-900/30">
              <CardTitle>Foto Saat Ini</CardTitle>
              <div className="flex items-center gap-4">
                {(pegawai as any).profilePic ? (
                  <img src={(pegawai as any).profilePic} alt="Foto profil server" className="w-16 h-16 rounded-2xl object-cover border border-slate-200 dark:border-slate-700" />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                    <Camera className="w-6 h-6 text-slate-400" />
                  </div>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400">Ubah foto profil akun server pusat (JPG/PNG, maks. 3 MB).</p>
              </div>
            </Card>

            {fotoPratinjau && (
              <div className="flex items-center gap-4">
                <img src={fotoPratinjau} alt="Pratinjau foto" className="w-16 h-16 rounded-2xl object-cover border border-blue-200 dark:border-blue-500/40" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{fotoBerkas?.name}</p>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{fotoBerkas ? Math.round(fotoBerkas.size / 1000) : 0} KB</p>
                </div>
              </div>
            )}

            <Field label="Pilih Foto" hint="JPG atau PNG, maksimal 3 MB.">
              <label className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <Upload className="w-4 h-4" /> Pilih Berkas
                <input type="file" className="hidden" accept="image/jpeg,image/png" onChange={(e) => handlePilihFoto(e.target.files?.[0] ?? null)} />
              </label>
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

function bacaBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      if (!base64) reject(new Error('Gagal membaca berkas.'));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error('Gagal membaca berkas.'));
    reader.readAsDataURL(file);
  });
}
