import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { X, Users, Shield, Server, Save, Plus, Edit3, Trash2, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, KeyRound, ChevronDown, RefreshCw, Smartphone, Check } from 'lucide-react';
import { SERVER_PROFILES, type ServerProfileId } from '../lib/serverProfiles';
import { loadServerCreds, saveServerCreds, deleteServerCreds } from '../lib/loginCredsStore';
import { ambilImei, login as webLogin, muatCaptcha, setWebPresensiEpBase } from '../lib/webPresensi';
import {
  fetchAllAppUsers, createAppUser, updateAppUser, deleteAppUser,
  getAdminAuth, setAdminPassword, setAdminUsername as setAdminUsernameApi, verifyAdminCredentials,
  DEFAULT_USER_APP_PERMISSIONS,
  BKD_MENU_DEFS, PONOROGO_MENU_DEFS, normalizeAppPermissions,
  type AppUserSafe, type AppUserPermissions
} from '../lib/appUserManager';

interface Props { onClose: () => void; }

type Tab = 'users' | 'admin' | 'server-creds';

const PROFILE_LABELS: Record<ServerProfileId, string> = { jatim: 'Jatim (Provinsi Jawa Timur)', madiun: 'Madiun (Kabupaten Madiun)', ponorogo: 'Ponorogo (Kabupaten Ponorogo)' };

function deepClone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

function Banner({ type, text }: { type: 'error' | 'success'; text: string }) {
  if (!text) return null;
  const isErr = type === 'error';
  return (
    <div className={`p-3 rounded-xl text-xs font-semibold border flex items-center gap-2 ${isErr ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800/40' : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40'}`}>
      {isErr ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}<span>{text}</span>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => !disabled && onChange(!checked)} className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'} ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  );
}

function CustomSelect({ value, options, onChange }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const selected = options.find(o => o.value === value);
  return (
    <div ref={ref} className="relative min-w-[220px]">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 hover:border-blue-400 dark:hover:border-blue-500 transition-colors shadow-sm">
        <span className="truncate font-semibold">{selected?.label || value}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1.5 w-full max-h-64 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1">
          {options.map(o => {
            const active = o.value === value;
            return (
              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }} className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${active ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                <span className="truncate">{o.label}</span>
                {active && <Check className="w-4 h-4 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProfileMenuEditor({ profileId, perms, onChange, disabled }: { profileId: ServerProfileId; perms: AppUserPermissions; onChange: (p: AppUserPermissions) => void; disabled?: boolean }) {
  const allowed = (perms.profiles as any)[profileId] as boolean;
  const isBkd = profileId === 'jatim' || profileId === 'madiun';
  const menus = isBkd ? BKD_MENU_DEFS : PONOROGO_MENU_DEFS;
  const setProfile = (v: boolean) => {
    const next = deepClone(perms);
    (next.profiles as any)[profileId] = v;
    onChange(next);
  };
  const setMenu = (id: string, v: boolean) => {
    if (id === 'tabBeranda') return;
    const next = deepClone(perms);
    (next.menus as any)[profileId][id] = v;
    onChange(next);
  };
  const setAllMenus = (v: boolean) => {
    const next = deepClone(perms);
    for (const m of menus) (next.menus as any)[profileId][m.id] = m.id === 'tabBeranda' ? true : v;
    onChange(next);
  };
  return (
    <div className={`rounded-2xl border p-3 sm:p-4 space-y-3 ${allowed ? 'border-blue-200 dark:border-blue-800/50 bg-blue-50/40 dark:bg-blue-950/10' : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{PROFILE_LABELS[profileId]}</div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Akses server & menu {profileId === 'ponorogo' ? 'Ponorogo' : 'BKD'}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-bold ${allowed ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500'}`}>{allowed ? 'AKTIF' : 'NONAKTIF'}</span>
          <Toggle checked={allowed} onChange={setProfile} disabled={disabled} />
        </div>
      </div>
      {allowed && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Menu</span>
            <button type="button" onClick={() => setAllMenus(true)} className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">Semua ON</button>
            <button type="button" onClick={() => setAllMenus(false)} className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">Semua OFF</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {menus.map(m => {
              const on = (perms.menus as any)[profileId][m.id] !== false;
              const mandatory = m.id === 'tabBeranda';
              return (
                <button key={m.id} type="button" onClick={() => !mandatory && setMenu(m.id, !on)} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-semibold text-left transition-colors ${mandatory ? 'bg-blue-50/70 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900/60 text-blue-700 dark:text-blue-300' : on ? 'bg-white dark:bg-slate-800 border-emerald-200 dark:border-emerald-900/50 text-slate-700 dark:text-slate-200' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400'}`}>
                  <span className="truncate">{m.label}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${mandatory ? 'bg-blue-100 dark:bg-blue-900/40' : on ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800'}`}>{mandatory ? 'WAJIB' : on ? 'ON' : 'OFF'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<AppUserSafe[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [mode, setMode] = useState<'idle'|'create'|'edit'>('idle');
  const [editingId, setEditingId] = useState<string|null>(null);
  const [showPass, setShowPass] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', confirm: '', permissions: deepClone(DEFAULT_USER_APP_PERMISSIONS) as AppUserPermissions });
  const [confirmDel, setConfirmDel] = useState<string|null>(null);

  const load = async () => { setLoading(true); setErr(''); try { setUsers(await fetchAllAppUsers()); } catch (e:any) { setErr(e?.message || 'Gagal memuat pengguna.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);

  const reset = () => { setMode('idle'); setEditingId(null); setShowPass(false); setForm({ username: '', password: '', confirm: '', permissions: deepClone(DEFAULT_USER_APP_PERMISSIONS) }); };
  const beginEdit = (u: AppUserSafe) => {
    setMode('edit'); setEditingId(u.id); setMsg(''); setErr('');
    setForm({ username: u.username, password: '', confirm: '', permissions: deepClone(normalizeAppPermissions(u.permissions as any)) });
  };
  const save = async () => {
    setErr(''); setMsg('');
    if (!form.username.trim()) return setErr('Username wajib diisi.');
    if (!/^[a-z0-9_.-]+$/i.test(form.username)) return setErr('Username hanya huruf, angka, _ . -');
    if (mode === 'create' && !form.password) return setErr('Password wajib diisi.');
    if (form.password && form.password.length < 4) return setErr('Password minimal 4 karakter.');
    if ((mode === 'create' || form.password) && form.password !== form.confirm) return setErr('Konfirmasi password tidak cocok.');
    if (!form.permissions.profiles.jatim && !form.permissions.profiles.madiun && !form.permissions.profiles.ponorogo) return setErr('Pilih minimal satu server (Jatim/Madiun/Ponorogo).');
    setSaving(true);
    try {
      if (mode === 'create') { await createAppUser(form.username, form.password, form.permissions); setMsg('Pengguna berhasil dibuat.'); }
      else if (editingId) { await updateAppUser(editingId, { username: form.username, password: form.password || undefined, permissions: form.permissions }); setMsg('Pengguna berhasil diperbarui.'); }
      reset(); await load();
    } catch (e:any) { setErr(e?.message || 'Gagal menyimpan.'); } finally { setSaving(false); }
  };
  const remove = async (id: string) => { setSaving(true); setErr(''); try { await deleteAppUser(id); setConfirmDel(null); setMsg('Pengguna dihapus.'); await load(); } catch (e:any) { setErr(e?.message || 'Gagal menghapus.'); } finally { setSaving(false); } };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Users className="w-4 h-4 text-blue-500" /> Akun Pengguna (User)</div>
        {mode === 'idle' && <button type="button" onClick={() => { setMode('create'); setErr(''); setMsg(''); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold"><Plus className="w-3.5 h-3.5" /> Tambah User</button>}
      </div>
      {err && <Banner type="error" text={err} />}{msg && <Banner type="success" text={msg} />}

      {mode !== 'idle' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 space-y-4">
          <div className="flex items-center justify-between"><div className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">{mode === 'create' ? 'Tambah Pengguna' : 'Edit Pengguna'}</div><button type="button" onClick={reset} className="text-xs font-semibold text-slate-500 hover:text-slate-700">Batal</button></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Username</label>
              <input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase().replace(/\s/g,'') }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-400" placeholder="username" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">{mode === 'edit' ? 'Password Baru (opsional)' : 'Password'}</label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="w-full px-3 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-400" placeholder={mode === 'edit' ? 'Kosongkan jika tidak diubah' : 'Password'} />
                <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">{showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
            </div>
            {(mode === 'create' || form.password) && (
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Konfirmasi Password</label>
                <input type={showPass ? 'text' : 'password'} value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-400" placeholder="Ulangi password" />
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white dark:bg-slate-800/60">
              <div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">Izinkan user ubah kredensial server sendiri</div>
              </div>
              <Toggle checked={form.permissions.allowEditServerCreds !== false} onChange={(v) => setForm(f => ({ ...f, permissions: { ...f.permissions, allowEditServerCreds: v } }))} />
            </div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Akses Server & Menu (3 Kartu)</div>
            <div className="space-y-3">
              {(['jatim','madiun','ponorogo'] as ServerProfileId[]).map(pid => (
                <ProfileMenuEditor key={pid} profileId={pid} perms={form.permissions} onChange={(p) => setForm(f => ({ ...f, permissions: p }))} />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={save} disabled={saving} className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Simpan</button>
            <button type="button" onClick={reset} className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold">Batal</button>
          </div>
        </div>
      )}

      {loading ? <div className="py-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Memuat...</div> : users.length === 0 ? <div className="py-6 text-center text-xs text-slate-400">Belum ada akun user.</div> : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">@{u.username}</div>
                <div className="text-[10px] text-slate-500 mt-0.5 flex flex-wrap gap-1">
                  {(['jatim','madiun','ponorogo'] as ServerProfileId[]).filter(p => (u.permissions as any)?.profiles?.[p]).map(p => <span key={p} className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/40 uppercase">{p}</span>)}
                  {!(['jatim','madiun','ponorogo'] as ServerProfileId[]).some(p => (u.permissions as any)?.profiles?.[p]) && <span className="text-amber-600">Tanpa akses server</span>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!(mode === 'edit' && editingId === u.id) && (
                  <button type="button" onClick={() => beginEdit(u)} className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30" title="Edit"><Edit3 className="w-4 h-4" /></button>
                )}
                {confirmDel === u.id ? (
                  <div className="flex items-center gap-1"><button type="button" onClick={() => void remove(u.id)} className="px-2 py-1 rounded bg-rose-600 text-white text-[11px] font-bold">Hapus</button><button type="button" onClick={() => setConfirmDel(null)} className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-[11px] font-bold">Batal</button></div>
                ) : <button type="button" onClick={() => setConfirmDel(u.id)} className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30" title="Hapus"><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminTab() {
  const [adminUsername, setAdminUsernameState] = useState('admin');
  const [newU, setNewU] = useState('');
  const [verifyU, setVerifyU] = useState('');
  const [oldP, setOldP] = useState(''); const [newP, setNewP] = useState(''); const [confP, setConfP] = useState('');
  const [show, setShow] = useState(false);
  const [busyU, setBusyU] = useState(false); const [busyP, setBusyP] = useState(false);
  const [msgU, setMsgU] = useState(''); const [errU, setErrU] = useState('');
  const [msgP, setMsgP] = useState(''); const [errP, setErrP] = useState('');

  useEffect(() => { (async () => { try { const a = await getAdminAuth(); setAdminUsernameState(a.adminUsername || 'admin'); } catch {} })(); }, []);

  const saveUsername = async () => {
    setErrU(''); setMsgU('');
    if (!newU.trim()) return setErrU('Username baru wajib diisi.');
    if (!/^[a-zA-Z0-9_.-]{2,32}$/.test(newU.trim())) return setErrU('Username hanya huruf, angka, _ . - (2-32).');
    if (!verifyU) return setErrU('Masukkan password verifikasi.');
    setBusyU(true);
    try {
      const auth = await getAdminAuth();
      const ok = await verifyAdminCredentials(auth.adminUsername || 'admin', verifyU);
      const hasAny = !!(auth.passwordHash || auth.pinHash || auth.pinEncrypted);
      if (hasAny && !ok) { setErrU('Password verifikasi salah.'); return; }
      await setAdminUsernameApi(newU.trim().toLowerCase(), verifyU);
      setAdminUsernameState(newU.trim().toLowerCase());
      setMsgU('Username admin berhasil diperbarui.'); setNewU(''); setVerifyU('');
    } catch (e:any) { setErrU(e?.message || 'Gagal menyimpan username.'); } finally { setBusyU(false); }
  };

  const savePassword = async () => {
    setErrP(''); setMsgP('');
    if (!oldP || !newP || !confP) return setErrP('Semua kolom password wajib diisi.');
    if (newP.length < 4) return setErrP('Password baru minimal 4 karakter.');
    if (newP !== confP) return setErrP('Konfirmasi password baru tidak cocok.');
    setBusyP(true);
    try {
      const auth = await getAdminAuth();
      const hasAny = !!(auth.passwordHash || auth.pinHash || auth.pinEncrypted);
      if (hasAny) {
        const ok = await verifyAdminCredentials(auth.adminUsername || 'admin', oldP);
        if (!ok) { setErrP('Password lama salah.'); return; }
      }
      await setAdminPassword(newP);
      setMsgP('Password admin berhasil diperbarui.'); setOldP(''); setNewP(''); setConfP('');
    } catch (e:any) { setErrP(e?.message || 'Gagal menyimpan password.'); } finally { setBusyP(false); }
  };

  const inp = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-400';
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        <div className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Shield className="w-4 h-4 text-blue-500" /> Akun Admin Aplikasi (/masuk)</div>
        <div className="text-xs text-slate-500">Username saat ini: <span className="font-bold text-slate-700 dark:text-slate-200">@{adminUsername}</span></div>
        <div className="grid gap-2">
          <label className="text-[11px] font-bold text-slate-500">Username Baru</label>
          <input value={newU} onChange={e => setNewU(e.target.value)} className={inp} placeholder="username admin baru" />
          <label className="text-[11px] font-bold text-slate-500">Password Verifikasi</label>
          <div className="relative"><input type={show ? 'text' : 'password'} value={verifyU} onChange={e => setVerifyU(e.target.value)} className={inp + ' pr-10'} placeholder="password saat ini" /><button type="button" onClick={() => setShow(s=>!s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div>
          {errU && <Banner type="error" text={errU} />}{msgU && <Banner type="success" text={msgU} />}
          <button type="button" onClick={saveUsername} disabled={busyU} className="inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold">{busyU ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Simpan Username Admin</button>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        <div className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><KeyRound className="w-4 h-4 text-blue-500" /> Ganti Password Admin</div>
        <label className="text-[11px] font-bold text-slate-500">Password Lama</label>
        <div className="relative"><input type={show ? 'text' : 'password'} value={oldP} onChange={e => setOldP(e.target.value)} className={inp + ' pr-10'} placeholder="Password lama" /><button type="button" onClick={() => setShow(s=>!s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">{show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div>
        <label className="text-[11px] font-bold text-slate-500">Password Baru</label>
        <input type={show ? 'text' : 'password'} value={newP} onChange={e => setNewP(e.target.value)} className={inp} placeholder="Min. 4 karakter" />
        <label className="text-[11px] font-bold text-slate-500">Konfirmasi Password Baru</label>
        <input type={show ? 'text' : 'password'} value={confP} onChange={e => setConfP(e.target.value)} className={inp} placeholder="Ulangi password baru" />
        {errP && <Banner type="error" text={errP} />}{msgP && <Banner type="success" text={msgP} />}
        <button type="button" onClick={savePassword} disabled={busyP} className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold">{busyP ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Simpan Password Admin</button>
      </div>
    </div>
  );
}

type ImeiState = { open: boolean; loading: boolean; busy: boolean; url: string | null; text: string; info: string; error: string };

function ServerCredsTab() {
  const [forms, setForms] = useState<Record<string, { nip: string; password: string; imei: string }>>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const [targetUser, setTargetUser] = useState<string>('admin');
  const [userList, setUserList] = useState<string[]>(['admin']);
  const [imei, setImei] = useState<Record<string, ImeiState>>({});
  const captchaBlobRef = useRef<Record<string, Blob | null>>({});

  const load = async (account = targetUser) => {
    const entries = await Promise.all(SERVER_PROFILES.map(async p => [p.id, await loadServerCreds(p.id as ServerProfileId, account)] as const));
    const next: any = {};
    for (const [id, c] of entries) next[id] = { nip: c?.nip || '', password: c?.password || '', imei: c?.imei || '' };
    setForms(next);
  };

  useEffect(() => { (async () => { try { const u = await fetchAllAppUsers(); const a = await getAdminAuth(); setUserList([a.adminUsername || 'admin', ...u.map(x => x.username)]); } catch {} })(); }, []);
  useEffect(() => { void load(targetUser); }, [targetUser]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    Object.values(imei).forEach(st => { if (st?.url?.startsWith('blob:')) { try { URL.revokeObjectURL(st.url); } catch {} } });
  }, [imei]);

  const setF = (id: string, patch: Partial<{ nip: string; password: string; imei: string }>) => setForms(prev => ({ ...prev, [id]: { ...(prev[id] || { nip:'',password:'',imei:'' }), ...patch } }));
  const setI = (id: string, patch: Partial<ImeiState>) => setImei(prev => ({ ...prev, [id]: { ...(prev[id] || { open: false, loading: false, busy: false, url: null, text: '', info: '', error: '' }), ...patch } }));

  const closeImei = (id: string) => {
    const st = imei[id];
    if (st?.url?.startsWith('blob:')) { try { URL.revokeObjectURL(st.url); } catch {} }
    captchaBlobRef.current[id] = null;
    setImei(prev => ({ ...prev, [id]: { open: false, loading: false, busy: false, url: null, text: '', info: '', error: '' } }));
  };

  const save = async (id: ServerProfileId) => {
    setBusy(id); setMsg(m=>({...m,[id]:''})); setErr(e=>({...e,[id]:''}));
    try {
      const f = forms[id] || { nip:'',password:'',imei:'' };
      if (!f.nip.trim() || !f.password) { setErr(e=>({...e,[id]:'NIP/username dan password wajib diisi.'})); return; }
      await saveServerCreds(id, { nip: f.nip.trim(), password: f.password, imei: f.imei?.trim() || undefined }, targetUser);
      setMsg(m=>({...m,[id]:`Kredensial tersimpan (terenkripsi) untuk @${targetUser}.`}));
    } catch (e:any) { setErr(er=>({...er,[id]: e?.message || 'Gagal menyimpan.'})); } finally { setBusy(null); }
  };
  const del = async (id: ServerProfileId) => {
    setBusy(id); setMsg(m=>({...m,[id]:''})); setErr(e=>({...e,[id]:''}));
    try { await deleteServerCreds(id, targetUser); setForms(p=>({...p,[id]:{nip:'',password:'',imei:''}})); setMsg(m=>({...m,[id]:`Kredensial dihapus untuk @${targetUser}.`})); closeImei(id); }
    catch (e:any) { setErr(er=>({...er,[id]: e?.message || 'Gagal menghapus.'})); } finally { setBusy(null); }
  };

  const loadCaptcha = async (id: ServerProfileId) => {
    const prevUrl = imei[id]?.url;
    if (prevUrl?.startsWith('blob:')) { try { URL.revokeObjectURL(prevUrl); } catch {} }
    setI(id, { open: true, loading: true, error: '', info: 'Memuat captcha…', url: null });
    try {
      const profile = SERVER_PROFILES.find(p => p.id === id);
      if (profile?.epBaseUrl) setWebPresensiEpBase(profile.epBaseUrl);
      else setWebPresensiEpBase(null);
      const cap = await muatCaptcha();
      captchaBlobRef.current[id] = cap.blob;
      setI(id, { loading: false, url: cap.url, info: 'Ketik kode captcha, lalu klik Verifikasi & Ambil IMEI.' });
    } catch (e: any) {
      setI(id, { loading: false, error: e?.message || 'Gagal memuat captcha.', info: '' });
    }
  };

  const openImei = async (id: ServerProfileId) => {
    const f = forms[id] || { nip: '', password: '', imei: '' };
    if (!f.nip.trim() || !f.password) { setErr(e => ({ ...e, [id]: 'Isi NIP/Username dan Password terlebih dahulu untuk mengambil IMEI.' })); return; }
    setErr(e => ({ ...e, [id]: '' })); setMsg(m => ({ ...m, [id]: '' }));
    await loadCaptcha(id);
  };

  const verifyAndFetchImei = async (id: ServerProfileId) => {
    const f = forms[id] || { nip: '', password: '', imei: '' };
    const st = imei[id];
    const captcha = (st?.text || '').trim();
    if (!f.nip.trim() || !f.password) { setI(id, { error: 'NIP/Username dan Password wajib diisi.' }); return; }
    if (!captcha) { setI(id, { error: 'Isi teks captcha terlebih dahulu.' }); return; }
    setI(id, { busy: true, error: '', info: 'Memverifikasi captcha & login…' });
    try {
      const profile = SERVER_PROFILES.find(p => p.id === id);
      if (profile?.epBaseUrl) setWebPresensiEpBase(profile.epBaseUrl);
      else setWebPresensiEpBase(null);
      await webLogin({ nip: f.nip.trim(), password: f.password, captcha });
      setI(id, { info: 'Login berhasil, mengambil IMEI…' });
      const res = await ambilImei();
      const got = String((res as any)?.imei || (res as any)?.data?.imei || (res as any)?.device_id || '').trim();
      if (!got) throw new Error('IMEI tidak ditemukan dari server. Pastikan akun/perangkat terdaftar lalu coba lagi.');
      setF(id, { imei: got });
      await saveServerCreds(id, { nip: f.nip.trim(), password: f.password, imei: got }, targetUser);
      setI(id, { busy: false, info: 'IMEI berhasil diambil dan disimpan (terenkripsi).' });
      setMsg(m => ({ ...m, [id]: `IMEI berhasil diambil & tersimpan untuk @${targetUser}.` }));
    } catch (e: any) {
      const msgErr = e?.message || 'Gagal verifikasi/mengambil IMEI.';
      const perlu = /captcha|verifikasi|gagal login|salah/i.test(msgErr);
      setI(id, { busy: false, error: msgErr, info: perlu ? 'Memuat captcha baru…' : '' });
      if (perlu) { try { await loadCaptcha(id); } catch {} }
    }
  };

  const inp = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-blue-400';
  const accountOptions = userList.map(u => ({ value: u, label: `@${u}${u === userList[0] ? ' (admin)' : ''}` }));

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Server className="w-4 h-4 text-blue-500" /> Kredensial Server Presensi per Akun</div>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 shrink-0">Akun:</label>
        <CustomSelect value={targetUser} options={accountOptions} onChange={(v) => { setTargetUser(v); }} />
        <div className="text-[11px] text-slate-500">Kredensial milik akun terpilih.</div>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {SERVER_PROFILES.map(p => {
          const f = forms[p.id] || { nip:'',password:'',imei:'' };
          const isBkd = p.mode === 'bkd-rpc';
          const im = imei[p.id] || { open: false, loading: false, busy: false, url: null, text: '', info: '', error: '' };
          return (
            <div key={p.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3 bg-slate-50/60 dark:bg-slate-900/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold text-sm text-slate-800 dark:text-slate-100">{PROFILE_LABELS[p.id as ServerProfileId]}</div>
                </div>
                {isBkd && (
                  <button type="button" onClick={() => im.open ? closeImei(p.id) : void openImei(p.id as ServerProfileId)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-xs font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40">
                    <Smartphone className="w-3.5 h-3.5" /> {im.open ? 'Tutup Ambil IMEI' : 'Ambil IMEI'}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><label className="block text-[11px] font-bold text-slate-500 mb-1">NIP / Username</label><input value={f.nip} onChange={e=>setF(p.id,{nip:e.target.value})} className={inp} placeholder="NIP/username" /></div>
                <div><label className="block text-[11px] font-bold text-slate-500 mb-1">Password</label><div className="relative"><input type={show[p.id] ? 'text':'password'} value={f.password} onChange={e=>setF(p.id,{password:e.target.value})} className={inp + ' pr-10'} placeholder="Password" /><button type="button" onClick={()=>setShow(s=>({...s,[p.id]:!s[p.id]}))} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">{show[p.id]?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}</button></div></div>
                {isBkd && <div className="sm:col-span-2"><label className="block text-[11px] font-bold text-slate-500 mb-1">IMEI / Device ID (BKD)</label><input value={f.imei} onChange={e=>setF(p.id,{imei:e.target.value})} className={inp} placeholder="IMEI/Device ID (bisa diisi manual atau Ambil IMEI)" /></div>}
              </div>

              {isBkd && im.open && (
                <div className="rounded-xl border border-blue-200 dark:border-blue-800/50 bg-white dark:bg-slate-900/60 p-3 sm:p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100">Verifikasi Captcha & Ambil IMEI</div>
                    <button type="button" onClick={() => void loadCaptcha(p.id as ServerProfileId)} disabled={im.loading || im.busy} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60"><RefreshCw className={`w-3.5 h-3.5 ${im.loading ? 'animate-spin' : ''}`} /> Muat Ulang</button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 items-start">
                    <div className="w-full sm:w-[220px] h-[72px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center overflow-hidden shrink-0">
                      {im.loading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : im.url ? <img src={im.url} alt="Captcha" className="w-full h-full object-contain" /> : <span className="text-[11px] text-slate-400">Captcha</span>}
                    </div>
                    <div className="flex-1 w-full space-y-2">
                      <label className="block text-[11px] font-bold text-slate-500">Teks Captcha (otomatis, bisa dikoreksi)</label>
                      <input value={im.text} onChange={e => setI(p.id, { text: e.target.value })} className={inp} placeholder="Masukkan teks captcha" />
                      {im.info && <div className="text-[11px] text-slate-500 flex items-center gap-1.5">{im.busy || im.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />}<span>{im.info}</span></div>}
                      {im.error && <div className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /><span>{im.error}</span></div>}
                      <button type="button" onClick={() => void verifyAndFetchImei(p.id as ServerProfileId)} disabled={im.busy || im.loading} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold w-full sm:w-auto">{im.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Smartphone className="w-4 h-4" />} Verifikasi & Ambil IMEI</button>
                    </div>
                  </div>
                </div>
              )}

              {err[p.id] && <Banner type="error" text={err[p.id]} />}{msg[p.id] && <Banner type="success" text={msg[p.id]} />}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void save(p.id as ServerProfileId)} disabled={busy===p.id} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-bold">{busy===p.id?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>} Simpan</button>
                <button type="button" onClick={() => void del(p.id as ServerProfileId)} disabled={busy===p.id} className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/20 text-xs font-bold"><Trash2 className="w-4 h-4" /> Hapus</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AppAccountManagementModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('users');
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'users', label: 'Pengguna & Akses', icon: <Users className="w-4 h-4" /> },
    { id: 'server-creds', label: 'Kredensial Server', icon: <Server className="w-4 h-4" /> },
    { id: 'admin', label: 'Akun Admin', icon: <Shield className="w-4 h-4" /> },
  ];
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-slate-950/60 p-3 sm:p-4">
      <motion.div initial={{ opacity: 0, scale: 0.98, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="w-full max-w-4xl h-[min(46rem,calc(100dvh-1.5rem))] bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div>
            <div className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">Manajemen Akun & Konfigurasi</div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700 transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex border-b border-slate-200 dark:border-slate-700 shrink-0 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/40 dark:bg-blue-950/10' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>{t.icon}{t.label}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar">
          {tab === 'users' && <UsersTab />}
          {tab === 'server-creds' && <ServerCredsTab />}
          {tab === 'admin' && <AdminTab />}
        </div>
        <div className="shrink-0 border-t border-slate-200 dark:border-slate-700 p-3 sm:p-4 bg-slate-50/60 dark:bg-slate-900/30">
          <button type="button" onClick={onClose} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800">Tutup</button>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
