export function formatTanggalWaktuLokal(value: Date | number | string = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

export function formatTanggalLokal(value: Date | number | string = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(d);
}
