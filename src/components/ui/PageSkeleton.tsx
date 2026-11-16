import { Card, Skeleton, SkeletonList, SkeletonTable } from './Surface';

type SkeletonVariant = 'dashboard' | 'table' | 'list' | 'form' | 'web' | 'detail';

function pickVariant(pageId: string): SkeletonVariant {
  if (!pageId) return 'dashboard';
  if (pageId === 'tabBeranda') return 'dashboard';
  if (pageId === 'tabWeb') return 'web';
  if (['tabPresensi', 'tabAbsen', 'tabInputAktivitas'].includes(pageId)) return 'form';
  if (['tabLaporan', 'tabReport', 'tabPerizinan', 'tabIzin', 'tabLog', 'tabAktivitas', 'tabLogPresensiInstansi', 'tabReview', 'tabDatabase', 'tabUnor', 'tabPresetOtomatisasi', 'tabAutomasi'].includes(pageId)) return 'table';
  if (['tabLokasiAbsen'].includes(pageId)) return 'detail';
  return 'list';
}

function HeaderSkeleton() {
  return (
    <div className="flex items-start justify-between gap-3 sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Skeleton className="w-11 h-11 rounded-2xl shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-6 w-44 max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Skeleton className="h-9 w-24 rounded-xl hidden sm:block" />
        <Skeleton className="h-9 w-9 sm:w-24 rounded-xl" />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-slate-200/70 dark:border-slate-700/60 bg-white dark:bg-slate-800/60 p-4 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-4 rounded" />
            </div>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <SkeletonList rows={4} />
        </Card>
        <Card>
          <Skeleton className="h-4 w-28 mb-4" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-36" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton />
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          <Skeleton className="h-9 w-28 rounded-xl" />
          <Skeleton className="h-9 w-24 rounded-xl" />
          <Skeleton className="h-9 w-24 rounded-xl" />
        </div>
        <SkeletonTable columns={6} rows={6} />
      </Card>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <Skeleton className="h-4 w-32 mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`space-y-1.5 ${i === 0 ? 'sm:col-span-2' : ''}`}>
                <Skeleton className="h-3 w-24" />
                <Skeleton className={`w-full rounded-xl ${i === 0 ? 'h-24' : 'h-10'}`} />
              </div>
            ))}
          </div>
          <div className="mt-5 flex gap-2">
            <Skeleton className="h-10 w-32 rounded-xl" />
            <Skeleton className="h-10 w-28 rounded-xl" />
          </div>
        </Card>
        <Card>
          <Skeleton className="h-4 w-28 mb-4" />
          <Skeleton className="aspect-video w-full rounded-xl mb-3" />
          <SkeletonList rows={3} />
        </Card>
      </div>
    </div>
  );
}

function WebSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton />
      <Card>
        <div className="flex flex-wrap gap-2 mb-4 border-b border-slate-200 dark:border-slate-700 pb-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-28 rounded-xl" />
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton className="h-10 w-full max-w-md rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </Card>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <Skeleton className="h-4 w-32 mb-4" />
          <Skeleton className="aspect-square sm:aspect-video w-full rounded-xl" />
        </Card>
        <Card>
          <Skeleton className="h-4 w-28 mb-4" />
          <SkeletonList rows={5} />
        </Card>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <HeaderSkeleton />
      <Card>
        <SkeletonList rows={6} />
      </Card>
    </div>
  );
}

export default function PageSkeleton({ pageId }: { pageId?: string }) {
  const variant = pickVariant(pageId || '');
  switch (variant) {
    case 'dashboard': return <DashboardSkeleton />;
    case 'table': return <TableSkeleton />;
    case 'form': return <FormSkeleton />;
    case 'web': return <WebSkeleton />;
    case 'detail': return <DetailSkeleton />;
    default: return <ListSkeleton />;
  }
}
