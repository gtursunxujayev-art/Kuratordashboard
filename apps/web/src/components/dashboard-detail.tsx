import Link from 'next/link';

export function DashboardDetailHeader({ title }: { title: string }) {
  return (
    <div className="kd-card kd-topbar p-4 flex items-center justify-between">
      <h1 className="text-xl font-semibold kd-title">{title}</h1>
      <Link href="/dashboard" className="px-3 py-2 rounded-md text-sm kd-chip">Ortga</Link>
    </div>
  );
}

export function DashboardDetailState({ children }: { children: string }) {
  return <div className="kd-card p-5 text-sm kd-subtle">{children}</div>;
}

export function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="kd-card p-3">
      <p className="text-xs kd-subtle">{title}</p>
      <p className="text-2xl font-bold kd-title mt-1">{value}</p>
    </div>
  );
}
