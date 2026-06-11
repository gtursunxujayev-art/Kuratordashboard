'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  marked: "Belgilandi",
  already_marked: "Avval belgilangan",
  manual_mark_kept: "Qo'lda belgi saqlandi",
  duplicate: "Takroriy so'rov",
  student_not_found: "O'quvchi topilmadi",
  no_lesson: "Dars yo'q",
  not_class_day: "Dars kuni emas",
  invalid_payload: "Noto'g'ri so'rov",
  processing: "Qayta ishlanmoqda",
  ignored_action: "Chiqish hodisasi",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  marked: 'bg-green-100 text-green-800',
  already_marked: 'bg-blue-100 text-blue-800',
  manual_mark_kept: 'bg-yellow-100 text-yellow-800',
  duplicate: 'bg-gray-100 text-gray-600',
  student_not_found: 'bg-red-100 text-red-700',
  no_lesson: 'bg-orange-100 text-orange-800',
  not_class_day: 'bg-purple-100 text-purple-700',
  invalid_payload: 'bg-red-50 text-red-500',
  processing: 'bg-gray-100 text-gray-500',
  ignored_action: 'bg-gray-100 text-gray-500',
};

const FILTER_STATUSES = [
  { value: '', label: 'Barchasi' },
  { value: 'marked', label: "Belgilandi" },
  { value: 'already_marked', label: "Avval belgilangan" },
  { value: 'manual_mark_kept', label: "Qo'lda belgi saqlandi" },
  { value: 'duplicate', label: "Takroriy" },
  { value: 'student_not_found', label: "O'quvchi topilmadi" },
  { value: 'no_lesson', label: "Dars yo'q" },
  { value: 'not_class_day', label: "Dars kuni emas" },
  { value: 'invalid_payload', label: "Noto'g'ri so'rov" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateTime(date: Date | null | undefined): string {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE_CLASS[status] ?? 'bg-gray-100 text-gray-500';
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Counter cards
// ---------------------------------------------------------------------------

function CounterCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-1 border"
      style={{ borderColor: 'var(--kd-border)', background: 'var(--kd-card-bg)' }}
    >
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function FaceIdLogsPage() {
  const { isManager, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [filterStatus, setFilterStatus] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterPhone, setFilterPhone] = useState('');
  const [filterBranch, setFilterBranch] = useState('');

  const eventsQuery = trpc.faceid.listRecentEvents.useQuery(
    {
      limit: 100,
      status: filterStatus || undefined,
      dateFrom: filterDateFrom || undefined,
      dateTo: filterDateTo || undefined,
      phone: filterPhone || undefined,
      branch: filterBranch || undefined,
    },
    { refetchInterval: 30_000 },
  );

  const countsQuery = trpc.faceid.getStatusCounts.useQuery(
    { days: 30 },
    { refetchInterval: 60_000 },
  );

  if (!authLoading && !isManager) {
    router.replace('/dashboard');
    return null;
  }

  const counts = countsQuery.data ?? {};
  const items = eventsQuery.data?.items ?? [];
  const total = eventsQuery.data?.total ?? 0;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Face ID — Kirish jurnali</h1>
          <p className="text-sm text-gray-500 mt-1">
            Face ID qurilmalaridan keladigan hodisalar ro'yxati (so'nggi 30 kun)
          </p>
        </div>
        <button
          onClick={() => { eventsQuery.refetch(); countsQuery.refetch(); }}
          className="text-sm px-3 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Yangilash
        </button>
      </div>

      {/* Status counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        <CounterCard label="Belgilandi" value={counts.marked ?? 0} color="text-green-700" />
        <CounterCard label="Avval belgilangan" value={counts.already_marked ?? 0} color="text-blue-700" />
        <CounterCard label="Qo'lda saqlandi" value={counts.manual_mark_kept ?? 0} color="text-yellow-700" />
        <CounterCard label="Takroriy" value={counts.duplicate ?? 0} color="text-gray-500" />
        <CounterCard label="Topilmadi" value={counts.student_not_found ?? 0} color="text-red-700" />
        <CounterCard label="Dars yo'q" value={counts.no_lesson ?? 0} color="text-orange-700" />
        <CounterCard label="Dars kuni emas" value={counts.not_class_day ?? 0} color="text-purple-700" />
        <CounterCard label="Noto'g'ri so'rov" value={counts.invalid_payload ?? 0} color="text-red-500" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 p-4 rounded-lg border"
        style={{ borderColor: 'var(--kd-border)', background: 'var(--kd-card-bg)' }}>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Holat</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            {FILTER_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Sanadan</label>
          <input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Sanagacha</label>
          <input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Telefon raqam</label>
          <input
            type="text"
            placeholder="Telefon bo'yicha qidirish"
            value={filterPhone}
            onChange={(e) => setFilterPhone(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-44"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Filial / qurilma</label>
          <input
            type="text"
            placeholder="Filial nomi bo'yicha qidirish"
            value={filterBranch}
            onChange={(e) => setFilterBranch(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-52"
          />
        </div>

        {(filterStatus || filterDateFrom || filterDateTo || filterPhone || filterBranch) && (
          <div className="flex flex-col gap-1 justify-end">
            <button
              onClick={() => {
                setFilterStatus('');
                setFilterDateFrom('');
                setFilterDateTo('');
                setFilterPhone('');
                setFilterBranch('');
              }}
              className="text-sm px-3 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Filterni tozalash
            </button>
          </div>
        )}
      </div>

      {/* Results summary */}
      <div className="text-xs text-gray-500 mb-2">
        {eventsQuery.isLoading
          ? 'Yuklanmoqda...'
          : `${total} ta hodisa topildi (${items.length} ta ko'rsatilmoqda)`}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--kd-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr
              className="text-left text-xs font-semibold uppercase tracking-wide"
              style={{ background: 'var(--kd-topbar)', color: '#fff' }}
            >
              <th className="px-3 py-2">Vaqt</th>
              <th className="px-3 py-2">Holat</th>
              <th className="px-3 py-2">O&apos;quvchi</th>
              <th className="px-3 py-2">Telefon</th>
              <th className="px-3 py-2">Tashqi ID</th>
              <th className="px-3 py-2">Dars sanasi</th>
              <th className="px-3 py-2">Filial / qurilma</th>
              <th className="px-3 py-2">Qayta ishlandi</th>
            </tr>
          </thead>
          <tbody>
            {eventsQuery.isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                  Yuklanmoqda...
                </td>
              </tr>
            )}
            {!eventsQuery.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-400">
                  Hodisalar topilmadi
                </td>
              </tr>
            )}
            {items.map((item, idx) => (
              <tr
                key={item.id}
                className="border-t transition-colors hover:bg-gray-50"
                style={{ borderColor: 'var(--kd-border)', background: idx % 2 === 0 ? undefined : 'rgba(0,0,0,0.012)' }}
              >
                <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                  {formatDateTime(item.createdAt)}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={item.status} />
                </td>
                <td className="px-3 py-2">
                  {item.customerName ? (
                    <div>
                      <div className="text-sm text-gray-800">{item.customerName}</div>
                      {item.customerNumber && (
                        <div className="text-xs text-gray-400">{item.customerNumber}</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-gray-600">
                  {item.phone ?? '—'}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs font-mono">
                  {item.externalUserId ? item.externalUserId.slice(0, 12) + (item.externalUserId.length > 12 ? '…' : '') : '—'}
                </td>
                <td className="px-3 py-2 text-gray-700">
                  {item.lessonDate ?? '—'}
                </td>
                <td className="px-3 py-2 text-gray-600 text-xs">
                  {item.branchName ?? '—'}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                  {item.processedAt ? formatDateTime(item.processedAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-gray-400 mt-3">
        Barcha IN hodisalar ko&apos;rsatiladi (mos kelmagan skanlar ham). Qurilma yoki forvarder{' '}
        <code className="bg-gray-100 px-1 rounded">/webhooks/faceid</code> manziliga POST yuborishi kerak.
      </p>
    </div>
  );
}
