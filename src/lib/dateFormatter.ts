/**
 * Tanggal & waktu (WIB-aware). Modul terpadu untuk BKD dan Ponorogo.
 */

export function getTodayWIB(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    const offset = 7 * 60;
    const wibTime = new Date(d.getTime() + (offset + d.getTimezoneOffset()) * 60000);
    return wibTime.toISOString().split('T')[0];
  }
}

export function getNowWIBTime(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return geserKeWib(d).toISOString().slice(11, 16);
  }
}

export function getTodayWIBWithDaysOffset(hari: number): string {
  const dasar = geserKeWib(new Date());
  dasar.setDate(dasar.getDate() + hari);
  return dasar.toISOString().slice(0, 10);
}

export function getTodayWIBWithOffset(monthsOffset: number): string {
  const [year, month, day] = getTodayWIB().split('-').map(Number);
  const targetMonth = new Date(Date.UTC(year, month - 1 + monthsOffset, 1));
  const targetYear = targetMonth.getUTCFullYear();
  const targetMonthIndex = targetMonth.getUTCMonth();
  const targetDay = Math.min(day, new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate());
  const y = String(targetYear).padStart(4, '0');
  const m = String(targetMonthIndex + 1).padStart(2, '0');
  const dd = String(targetDay).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function timeToMinutes(value: string | null | undefined): number | null {
  const cocok = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(value ?? ''));
  if (!cocok) return null;
  const jam = Number(cocok[1]);
  const menit = Number(cocok[2]);
  if (!Number.isFinite(jam) || !Number.isFinite(menit)) return null;
  if (jam > 23 || menit > 59) return null;
  return jam * 60 + menit;
}

/**
 * Format tanggal-waktu ringkas. Default mengembalikan '' untuk input kosong (kompatibel BKD).
 * Gunakan emptyAsDash=true untuk perilaku gaya Ponorogo ('-').
 */
export function formatCompactDateTime(val: string | null | undefined, opts?: { emptyAsDash?: boolean; relative?: boolean }): string {
  if (!val) return opts?.emptyAsDash ? '-' : '';
  const cleanVal = String(val).trim();
  if (!cleanVal) return opts?.emptyAsDash ? '-' : '';

  const relative = opts?.relative !== false; // default: try relative (BKD-friendly)
  const d = new Date(cleanVal);
  if (relative && !Number.isNaN(d.getTime())) {
    const hariIni = getTodayWIB();
    const tanggal = getTodayWIB(d);
    if (tanggal === hariIni) return `Hari ini, ${getNowWIBTime(d)}`;
    const kemarin = geserKeWib(new Date());
    kemarin.setDate(kemarin.getDate() - 1);
    if (tanggal === getTodayWIB(kemarin)) return `Kemarin, ${getNowWIBTime(d)}`;
  }

  const match = cleanVal.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!match) return cleanVal;
  const date = `${Number(match[3])} ${SHORT_MONTHS_ID[Number(match[2]) - 1] || match[2]} ${match[1]}`;
  return match[4] && match[5] ? `${date}, ${match[4]}:${match[5]}` : date;
}

export function formatBeautifulDateTime(val: string | null | undefined): string {
  if (!val) return '-';
  const cleanVal = String(val).trim();
  if (!cleanVal) return '-';

  const dateTimeRegex = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?/;
  const match = cleanVal.match(dateTimeRegex);
  if (match) {
    const year = match[1];
    const monthIndex = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hour = match[4];
    const minute = match[5];
    const second = match[6];
    const monthName = MONTHS_FULL_ID[monthIndex] || match[2];
    let formatted = `${day} ${monthName} ${year}`;
    if (hour && minute) {
      formatted += `, ${hour}:${minute}`;
      if (second) formatted += ` WIB`;
    }
    return formatted;
  }

  const timeRegex = /^(\d{2}):(\d{2})(?::(\d{2}))?/;
  const matchTime = cleanVal.match(timeRegex);
  if (matchTime) return `${matchTime[1]}:${matchTime[2]} WIB`;

  const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const matchDate = cleanVal.match(dateRegex);
  if (matchDate) {
    const year = matchDate[1];
    const monthIndex = parseInt(matchDate[2], 10) - 1;
    const day = parseInt(matchDate[3], 10);
    const monthName = MONTHS_FULL_ID[monthIndex] || matchDate[2];
    return `${day} ${monthName} ${year}`;
  }
  return String(val);
}

export const SHORT_MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'] as const;

export const MONTHS_FULL_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
] as const;

function geserKeWib(d: Date): Date {
  const offsetDetik = (7 * 60 + d.getTimezoneOffset()) * 60_000;
  return new Date(d.getTime() + offsetDetik);
}
