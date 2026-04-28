'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type DatePreset =
  | 'today'
  | 'week1'
  | 'week2'
  | 'week3'
  | 'week4'
  | 'week5'
  | 'week6'
  | 'all';

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Bugun',
  week1: '1-hafta',
  week2: '2-hafta',
  week3: '3-hafta',
  week4: '4-hafta',
  week5: '5-hafta',
  week6: '6-hafta',
  all: 'Hammasi',
};
const WEEK_PRESETS: DatePreset[] = ['week1', 'week2', 'week3', 'week4', 'week5', 'week6'];

function textColorForBackground(hexColor?: string | null): string {
  if (!hexColor) return '#111827';
  const value = hexColor.trim().replace('#', '');
  if (![3, 6].includes(value.length)) return '#111827';

  const normalized = value.length === 3
    ? value.split('').map((char) => char + char).join('')
    : value;

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);

  if ([r, g, b].some((channel) => Number.isNaN(channel))) return '#111827';

  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.56 ? '#111827' : '#F9FAFB';
}

function formatPoint(value: number | null | undefined): string {
  const safe = value ?? 0;
  if (Number.isInteger(safe)) return String(safe);
  return safe.toFixed(2).replace(/\.?0+$/, '');
}

export default function HisobotPage() {
  const router = useRouter();
  const { isAdmin, isLoading } = useAuth();

  const [courseId, setCourseId] = useState('');
  const [courseRunId, setCourseRunId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [kuratorUserId, setKuratorUserId] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.replace('/dashboard');
    }
  }, [isAdmin, isLoading, router]);

  const { data: courses, error: coursesError } = trpc.dashboard.courses.useQuery(undefined, {
    enabled: isAdmin,
  });
  const { data: courseRuns, error: runsError } = trpc.dashboard.courseRuns.useQuery(undefined, {
    enabled: isAdmin,
  });
  const { data: filterOptions, error: filterOptionsError } = trpc.students.filterOptions.useQuery(undefined, {
    enabled: isAdmin,
  });
  const { data: kurators, error: kuratorsError } = trpc.kurators.list.useQuery(undefined, {
    enabled: isAdmin,
  });

  const filteredRuns = useMemo(
    () => (courseRuns ?? []).filter((run) => run.courseId === courseId),
    [courseId, courseRuns],
  );
  const filteredTariffs = useMemo(
    () => (filterOptions?.tariffs ?? []).filter((tariff) => tariff.courseId === courseId),
    [courseId, filterOptions?.tariffs],
  );

  const reportEnabled = isAdmin && Boolean(courseId);
  const {
    data: report,
    isLoading: reportLoading,
    error: reportError,
  } = trpc.dashboard.amaliyReportMatrix.useQuery(
    {
      courseId,
      courseRunId: courseRunId || undefined,
      tariffId: tariffId || undefined,
      kuratorUserId: kuratorUserId || undefined,
      datePreset,
    },
    {
      enabled: reportEnabled,
      keepPreviousData: true,
    },
  );

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="kd-card p-5 text-sm kd-subtle">Yuklanmoqda...</div>
      </div>
    );
  }

  if (!isAdmin) return null;

  const topError =
    coursesError?.message ||
    runsError?.message ||
    filterOptionsError?.message ||
    kuratorsError?.message ||
    reportError?.message;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="kd-card p-4 md:p-5 space-y-3">
        <h1 className="text-xl font-bold kd-title">Hisobot</h1>
        <p className="text-sm kd-subtle">
          Amaliy mashqlar bo&apos;yicha rangli ball matritsasi
        </p>

        {topError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {topError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs kd-subtle mb-1">Kurs</label>
            <select
              value={courseId}
              onChange={(e) => {
                setCourseId(e.target.value);
                setCourseRunId('');
                setTariffId('');
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            >
              <option value="">Kursni tanlang...</option>
              {(courses ?? []).map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs kd-subtle mb-1">Oqim</label>
            <select
              value={courseRunId}
              onChange={(e) => setCourseRunId(e.target.value)}
              disabled={!courseId}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:opacity-50"
            >
              <option value="">{courseId ? 'Barcha oqimlar' : 'Avval kurs tanlang'}</option>
              {filteredRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs kd-subtle mb-1">Tarif</label>
            <select
              value={tariffId}
              onChange={(e) => setTariffId(e.target.value)}
              disabled={!courseId}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:opacity-50"
            >
              <option value="">Barcha tariflar</option>
              {filteredTariffs.map((tariff) => (
                <option key={tariff.id} value={tariff.id}>
                  {tariff.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs kd-subtle mb-1">Kurator</label>
            <select
              value={kuratorUserId}
              onChange={(e) => setKuratorUserId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            >
              <option value="">Barcha kuratorlar</option>
              {(kurators ?? []).map((kurator) => (
                <option key={kurator.id} value={kurator.id}>
                  {kurator.name ?? kurator.username ?? 'Kurator'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(DATE_PRESET_LABELS) as DatePreset[]).map((preset) => (
            <button
              key={preset}
              onClick={() => setDatePreset(preset)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                datePreset === preset ? 'kd-chip-active' : 'kd-chip'
              }`}
            >
              {DATE_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>

        {report?.meta && (
          <p className="text-xs kd-subtle">
            Davr: {report.meta.dateFrom} - {report.meta.dateToInclusive ?? report.meta.dateFrom}
          </p>
        )}
      </div>

      {!courseId ? (
        <div className="kd-card p-6 text-center text-sm kd-subtle">
          Hisobotni ko&apos;rish uchun kursni tanlang.
        </div>
      ) : reportLoading ? (
        <div className="kd-card p-6 text-center text-sm kd-subtle">Hisobot yuklanmoqda...</div>
      ) : !report ? (
        <div className="kd-card p-6 text-center text-sm kd-subtle">Ma&apos;lumot topilmadi.</div>
      ) : (
        <div className="kd-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[980px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="sticky left-0 z-20 bg-gray-50 text-left px-3 py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[200px]">
                    O&apos;quvchi
                  </th>
                  <th className="text-left px-2 py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[92px] w-[92px]">
                    Tarif
                  </th>
                  <th className="text-left px-2 py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[118px] w-[118px]">
                    Kurator
                  </th>
                  {report.practices.map((practice) => (
                    <th
                      key={practice.id}
                      className="text-center px-2 py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[96px]"
                    >
                      <div className="leading-tight">
                        <p className="text-xs">{practice.name}</p>
                      </div>
                    </th>
                  ))}
                  <th className="sticky right-0 z-20 bg-gray-50 text-center px-2 py-2.5 font-semibold text-gray-700 min-w-[86px]">
                    Jami ball
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.students.length === 0 ? (
                  <tr>
                    <td
                      colSpan={report.practices.length + 4}
                      className="px-4 py-8 text-center text-sm kd-subtle"
                    >
                      Tanlangan filterlar bo&apos;yicha o&apos;quvchilar topilmadi.
                    </td>
                  </tr>
                ) : (
                  report.students.map((student) => (
                    <tr key={student.id} className="border-b border-gray-100">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 border-r border-gray-100 align-top">
                        <p className="font-medium text-gray-900 leading-5">{student.name}</p>
                        <p className="text-[11px] text-gray-500 leading-4">{student.phone ?? '-'}</p>
                      </td>
                      <td className="px-2 py-2 text-gray-700 border-r border-gray-100 align-top text-xs leading-4">
                        {student.tariffName ?? '-'}
                      </td>
                      <td className="px-2 py-2 text-gray-700 border-r border-gray-100 align-top text-xs leading-4">
                        {student.kuratorNames.length > 0 ? student.kuratorNames.join(', ') : '-'}
                      </td>
                      {report.practices.map((practice) => {
                        const cell = student.cells[practice.id];
                        const isColored = cell?.hasLogs && Boolean(cell?.colorHex);
                        const backgroundColor = isColored ? cell.colorHex! : cell?.hasLogs ? '#F3F4F6' : '#FFFFFF';
                        const color = isColored ? textColorForBackground(cell.colorHex) : '#374151';
                        const showWeeklyBreakdown = datePreset === 'all';
                        const showDailyBreakdown = WEEK_PRESETS.includes(datePreset);
                        return (
                          <td
                            key={`${student.id}-${practice.id}`}
                            className="px-1.5 py-1.5 text-center border-r border-gray-100"
                            style={{ backgroundColor, color }}
                          >
                            <div className="font-semibold leading-4">{formatPoint(cell?.points ?? 0)}</div>
                            {showWeeklyBreakdown && cell?.weekPoints && (
                              <div className="mt-0.5 text-[10px] leading-3 whitespace-pre-wrap opacity-90">
                                {`W1:${formatPoint(cell.weekPoints.week1)} W2:${formatPoint(cell.weekPoints.week2)} W3:${formatPoint(cell.weekPoints.week3)}`}
                                <br />
                                {`W4:${formatPoint(cell.weekPoints.week4)} W5:${formatPoint(cell.weekPoints.week5)} W6:${formatPoint(cell.weekPoints.week6)}`}
                              </div>
                            )}
                            {showDailyBreakdown && cell?.dayPoints?.length > 0 && (
                              <div className="mt-0.5 text-[10px] leading-3 whitespace-pre-wrap opacity-90">
                                {cell.dayPoints.map((day) => `${day.label}:${formatPoint(day.points)}`).join(' ')}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="sticky right-0 z-10 bg-white px-2 py-2 text-center font-bold text-gray-900 border-l border-gray-200">
                        {formatPoint(student.totalPoints)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
