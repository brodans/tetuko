import { Card, Skeleton, SkeletonList, SkeletonTable } from './Surface';

function HeaderSkeleton({
  withActions = true,
  actionCount = 2,
  subtitleWide = false,
}: {
  withActions?: boolean;
  actionCount?: number;
  subtitleWide?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Skeleton className="w-11 h-11 rounded-2xl shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-6 sm:h-7 w-40 sm:w-52 max-w-full" />
          <Skeleton className={`h-4 ${subtitleWide ? 'w-72' : 'w-56'} max-w-full`} />
        </div>
      </div>
      {withActions && (
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {Array.from({ length: actionCount }).map((_, i) => (
            <Skeleton key={i} className={`${i === 0 ? 'hidden sm:block h-9 w-24' : 'h-9 w-9 sm:w-24'} rounded-xl`} />
          ))}
        </div>
      )}
    </div>
  );
}

function StatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid ${count === 4 ? 'grid-cols-2 lg:grid-cols-4' : count === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'} gap-4`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-800/60 p-4 shadow-sm space-y-3">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-4 rounded" />
          </div>
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3 w-28 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function FilterBar({ fields = 4, buttons = 2 }: { fields?: number; buttons?: number }) {
  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-1 ${fields >= 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : fields === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3`}>
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-20 ml-1" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: buttons }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/** Beranda BKD/Ponorogo dashboard-like */
function BerandaSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton withActions actionCount={2} subtitleWide />
      <StatGrid count={4} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <SkeletonList rows={4} />
        </Card>
        <Card className="space-y-3">
          <Skeleton className="h-4 w-28" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
              <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-36 max-w-full" />
              </div>
              <Skeleton className="w-4 h-4 rounded shrink-0" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

/** Presensi / Submit Presensi */
function PresensiSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton withActions actionCount={2} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3 w-24 ml-1" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </div>
            ))}
            <div className="sm:col-span-2 space-y-1.5">
              <Skeleton className="h-3 w-28 ml-1" />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Skeleton className="h-10 w-36 rounded-xl" />
            <Skeleton className="h-10 w-28 rounded-xl" />
          </div>
        </Card>
        <div className="space-y-4">
          <Card className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </Card>
          <Card className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <SkeletonList rows={3} />
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Tabel/laporan/list dengan filter */
function TablePageSkeleton({ fields = 4, columns = 6 }: { fields?: number; columns?: number }) {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton withActions actionCount={2} />
      <Card className="space-y-4">
        <FilterBar fields={fields} buttons={3} />
        <SkeletonTable columns={columns} rows={6} />
      </Card>
    </div>
  );
}

/** Preset Otomatisasi (kartu preset) */
function PresetPageSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton withActions actionCount={2} />
      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
          <Skeleton className="h-9 w-36 rounded-xl" />
        </div>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-20 col-span-2" />
            </div>
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: 7 }).map((__, j) => <Skeleton key={j} className="h-5 w-7 rounded-md" />)}
            </div>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/50">
              <Skeleton className="h-8 w-28 rounded-xl" />
              <Skeleton className="h-8 w-20 rounded-xl" />
              <Skeleton className="h-8 w-20 rounded-xl" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Lokasi Absen (peta + daftar) */
function LokasiSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton withActions actionCount={2} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="aspect-square sm:aspect-[4/3] w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Skeleton className="h-3 w-20 ml-1" /><Skeleton className="h-10 w-full rounded-xl" /></div>
            <div className="space-y-1.5"><Skeleton className="h-3 w-20 ml-1" /><Skeleton className="h-10 w-full rounded-xl" /></div>
          </div>
        </Card>
        <Card className="space-y-3">
          <div className="flex items-center justify-between"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-24 rounded-xl" /></div>
          <SkeletonList rows={5} />
        </Card>
      </div>
    </div>
  );
}

/** Web Presensi */
function WebPresensiSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton withActions actionCount={1} />
      <Card className="space-y-4">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-28 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-40 rounded-xl" />
          </div>
          <Skeleton className="h-40 md:h-full min-h-[10rem] w-full rounded-xl" />
        </div>
        <SkeletonTable columns={6} rows={4} />
      </Card>
    </div>
  );
}

/** Produktivitas input (Ponorogo) */
function ProduktivitasSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton withActions actionCount={2} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 space-y-4">
          <Skeleton className="h-4 w-40" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`space-y-1.5 ${i >= 2 ? 'sm:col-span-2' : ''}`}>
                <Skeleton className="h-3 w-24 ml-1" />
                <Skeleton className={`${i >= 2 ? 'h-24' : 'h-10'} w-full rounded-xl`} />
              </div>
            ))}
          </div>
          <div className="flex gap-2"><Skeleton className="h-10 w-32 rounded-xl" /><Skeleton className="h-10 w-28 rounded-xl" /></div>
        </Card>
        <Card className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <SkeletonList rows={4} />
        </Card>
      </div>
    </div>
  );
}

/** Review Produktivitas / Unor / Database (tabel berat) */
function DataHeavySkeleton() {
  return <TablePageSkeleton fields={3} columns={7} />;
}

export default function PageSkeleton({ pageId }: { pageId?: string }) {
  switch (pageId) {
    case 'tabBeranda':
      return <BerandaSkeleton />;
    case 'tabPresensi':
    case 'tabAbsen':
      return <PresensiSkeleton />;
    case 'tabPerizinan':
    case 'tabIzin':
      return <TablePageSkeleton fields={4} columns={6} />;
    case 'tabLaporan':
    case 'tabReport':
    case 'tabLog':
    case 'tabAktivitas':
    case 'tabLogPresensiInstansi':
      return <TablePageSkeleton fields={4} columns={6} />;
    case 'tabPresetOtomatisasi':
    case 'tabAutomasi':
      return <PresetPageSkeleton />;
    case 'tabLokasiAbsen':
      return <LokasiSkeleton />;
    case 'tabWeb':
      return <WebPresensiSkeleton />;
    case 'tabInputAktivitas':
      return <ProduktivitasSkeleton />;
    case 'tabReview':
    case 'tabDatabase':
    case 'tabUnor':
      return <DataHeavySkeleton />;
    default:
      return <TablePageSkeleton fields={3} columns={5} />;
  }
}
