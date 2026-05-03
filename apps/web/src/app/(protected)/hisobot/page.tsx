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
const WEEK_KEYS = ['week1', 'week2', 'week3', 'week4', 'week5', 'week6'] as const;
type WeekKey = (typeof WEEK_KEYS)[number];
const WEEK_COLUMN_LABELS: Record<WeekKey, string> = {
  week1: 'W1',
  week2: 'W2',
  week3: 'W3',
  week4: 'W4',
  week5: 'W5',
  week6: 'W6',
};

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

function buildDayColumns(dateFrom?: string, dateToInclusive?: string | null): Array<{ key: string; label: string }> {
  if (!dateFrom || !dateToInclusive) return [];
  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateToInclusive}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) return [];

  const dayLabels = ['Yak', 'Du', 'Se', 'Chor', 'Pay', 'Ju', 'Shan'] as const;
  const columns: Array<{ key: string; label: string }> = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    columns.push({ key: `${y}-${m}-${d}`, label: dayLabels[cursor.getDay()] });
    cursor.setDate(cursor.getDate() + 1);
  }
  return columns;
}

function dayTypeForDateKey(dateKey: string): 'weekday' | 'weekend' | 'unknown' {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const day = date.getDay();
  return day === 0 || day === 6 ? 'weekend' : 'weekday';
}

function isPracticeEligibleOnDate(practiceType: string, dayKey: string): boolean {
  const date = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return true;
  const day = date.getDay();
  if (practiceType === 'class') return day === 0 || day === 6;
  if (practiceType === 'homework' || practiceType === 'extra') return day >= 1 && day <= 5;
  return true;
}

export default function HisobotPage() {
  const router = useRouter();
  const { isManager, isLoading } = useAuth();

  const [courseId, setCourseId] = useState('');
  const [courseRunId, setCourseRunId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [kuratorUserId, setKuratorUserId] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');

  useEffect(() => {
    if (!isLoading && !isManager) {
      router.replace('/dashboard');
    }
  }, [isManager, isLoading, router]);

  const { data: courses, error: coursesError } = trpc.dashboard.courses.useQuery(undefined, {
    enabled: isManager,
  });
  const { data: courseRuns, error: runsError } = trpc.dashboard.courseRuns.useQuery(undefined, {
    enabled: isManager,
  });
  const { data: filterOptions, error: filterOptionsError } = trpc.students.filterOptions.useQuery(undefined, {
    enabled: isManager,
  });
  const { data: kurators, error: kuratorsError } = trpc.kurators.list.useQuery(undefined, {
    enabled: isManager,
  });

  const filteredRuns = useMemo(
    () => (courseRuns ?? []).filter((run) => run.courseId === courseId),
    [courseId, courseRuns],
  );
  const filteredTariffs = useMemo(
    () => (filterOptions?.tariffs ?? []).filter((tariff) => tariff.courseId === courseId),
    [courseId, filterOptions?.tariffs],
  );

  const reportEnabled = isManager && Boolean(courseId);
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

  if (!isManager) return null;

  const topError =
    coursesError?.message ||
    runsError?.message ||
    filterOptionsError?.message ||
    kuratorsError?.message ||
    reportError?.message;
  const isTodayPreset = datePreset === 'today';
  const isWeekPreset = WEEK_PRESETS.includes(datePreset);
  const hasSubColumns = !isTodayPreset;
  const dayColumnsRaw = buildDayColumns(report?.meta.dateFrom, report?.meta.dateToInclusive);
  const runDayMode = useMemo<'weekday' | 'weekend' | 'mixed'>(() => {
    const practiceTypes = new Set((report?.practices ?? []).map((practice) => practice.type));
    if (practiceTypes.size === 0) return 'mixed';
    const allWeekday = Array.from(practiceTypes).every((type) => type === 'homework' || type === 'extra');
    if (allWeekday) return 'weekday';
    const allWeekend = Array.from(practiceTypes).every((type) => type === 'class');
    if (allWeekend) return 'weekend';
    return 'mixed';
  }, [report?.practices]);
  const dayColumns = useMemo(() => {
    if (runDayMode === 'weekday') {
      return dayColumnsRaw.filter((column) => dayTypeForDateKey(column.key) === 'weekday');
    }
    if (runDayMode === 'weekend') {
      return dayColumnsRaw.filter((column) => dayTypeForDateKey(column.key) === 'weekend');
    }
    return dayColumnsRaw;
  }, [dayColumnsRaw, runDayMode]);
  const subColumns =
    isTodayPreset
      ? [] as Array<{ key: string; label: string }>
      : isWeekPreset
        ? dayColumns
        : WEEK_KEYS.map((weekKey) => ({ key: weekKey, label: DATE_PRESET_LABELS[weekKey] }));
  const perPracticeColumnCount = isTodayPreset ? 1 : Math.max(subColumns.length, 1);
  const tableMinWidth = isTodayPreset ? 'min-w-[860px]' : 'min-w-[980px]';
  const emptyColSpan = report ? report.practices.length * perPracticeColumnCount + 4 : 4;

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
            <table className={`w-full text-sm border-collapse ${tableMinWidth}`}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    className="sticky left-0 z-20 bg-gray-50 text-left px-3 py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[200px]"
                  >
                    O&apos;quvchi
                  </th>
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    className="text-left px-2 py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[92px] w-[92px]"
                  >
                    Tarif
                  </th>
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    className="text-left px-2 py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[118px] w-[118px]"
                  >
                    Kurator
                  </th>
                  {isTodayPreset
                    ? report.practices.map((practice) => (
                        <th
                          key={practice.id}
                          className="text-center px-2 py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[96px]"
                        >
                          <div className="leading-tight">
                            <p className="text-xs">{practice.name}</p>
                          </div>
                        </th>
                      ))
                    : report.practices.map((practice) => (
                        <th
                          key={practice.id}
                          colSpan={perPracticeColumnCount}
                          className="text-center px-2 py-2.5 font-semibold text-gray-700 border-r border-gray-200"
                        >
                          <div className="leading-tight">
                            <p className="text-xs">{practice.name}</p>
                          </div>
                        </th>
                      ))}
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    className="sticky right-0 z-20 bg-gray-50 text-center px-2 py-2.5 font-semibold text-gray-700 min-w-[82px] w-[82px]"
                  >
                    Jami ball
                  </th>
                </tr>
                {!isTodayPreset && (
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {report.practices.flatMap((practice) =>
                      subColumns.map((subColumn) => {
                        const isSelectedWeek = datePreset === subColumn.key;
                        return (
                          <th
                            key={`${practice.id}-${subColumn.key}`}
                            className={`text-center px-1 py-1.5 text-[11px] font-semibold border-r border-gray-200 min-w-[48px] ${
                              isSelectedWeek ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600'
                            }`}
                          >
                            {subColumn.label}
                          </th>
                        );
                      }),
                    )}
                  </tr>
                )}
              </thead>
              <tbody>
                {report.students.length === 0 ? (
                  <tr>
                    <td colSpan={emptyColSpan} className="px-4 py-8 text-center text-sm kd-subtle">
                      Tanlangan filterlar bo&apos;yicha o&apos;quvchilar topilmadi.
                    </td>
                  </tr>
                ) : (
                  report.students.map((student) => (
                    <tr key={student.id} className="border-b border-gray-100">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 border-r border-gray-100 align-top">
                        <p className="font-medium text-gray-900 leading-5">{student.name}</p>
                        <p className="text-[11px] text-gray-500 leading-4">{student.customerNumber ?? '-'}</p>
                      </td>
                      <td className="px-2 py-2 text-gray-700 border-r border-gray-100 align-top text-xs leading-4">
                        {student.tariffName ?? '-'}
                      </td>
                      <td className="px-2 py-2 text-gray-700 border-r border-gray-100 align-top text-xs leading-4">
                        {student.kuratorNames.length > 0 ? student.kuratorNames.join(', ') : '-'}
                      </td>
                      {isTodayPreset
                        ? report.practices.map((practice) => {
                            const cell = student.cells[practice.id];
                            const isApplicable = isPracticeEligibleOnDate(practice.type, report.meta.dateFrom);
                            const hasLog = cell?.hasLogs ?? false;
                            const points = cell?.points ?? 0;
                            const colorHex = hasLog ? (cell?.colorHex ?? null) : null;
                            const isColored = Boolean(colorHex) && hasLog && isApplicable;
                            const backgroundColor = isColored ? colorHex! : '#FFFFFF';
                            const color = isColored ? textColorForBackground(colorHex) : '#374151';

                            return (
                              <td
                                key={`${student.id}-${practice.id}-today`}
                                className="px-2 py-2 text-center border-r border-gray-100 font-semibold"
                                style={{ backgroundColor, color }}
                              >
                                {!isApplicable || !hasLog ? '-' : formatPoint(points)}
                              </td>
                            );
                          })
                        : report.practices.flatMap((practice) => {
                            const cell = student.cells[practice.id];
                            if (isWeekPreset) {
                              const dayStatsByDate = new Map((cell?.dayStats ?? []).map((day) => [day.date, day]));
                              return subColumns.map((dayColumn) => {
                                const stat = dayStatsByDate.get(dayColumn.key);
                                const isApplicable = stat?.isApplicable ?? isPracticeEligibleOnDate(practice.type, dayColumn.key);
                                const hasLog = stat?.hasLog ?? false;
                                const points = stat?.points ?? 0;
                                const dayColor = hasLog ? (stat?.colorHex ?? null) : null;
                                const isColored = Boolean(dayColor) && hasLog && isApplicable;
                                const backgroundColor = isColored ? dayColor! : '#FFFFFF';
                                const color = isColored ? textColorForBackground(dayColor) : '#374151';
                                return (
                                  <td
                                    key={`${student.id}-${practice.id}-${dayColumn.key}`}
                                    className="px-1 py-1.5 text-center border-r border-gray-100 font-semibold"
                                    style={{ backgroundColor, color }}
                                  >
                                    {!isApplicable || !hasLog ? '-' : formatPoint(points)}
                                  </td>
                                );
                              });
                            }

                            return WEEK_KEYS.map((weekKey) => {
                              const weekStat = cell?.weekStats?.[weekKey];
                              const points = weekStat?.points ?? cell?.weekPoints?.[weekKey] ?? 0;
                              const hasLog = weekStat?.hasLog ?? false;
                              const isApplicable = weekStat?.isApplicable ?? true;
                              const weekColor = hasLog ? (weekStat?.colorHex ?? cell?.weekColors?.[weekKey] ?? null) : null;
                              const isColored = Boolean(weekColor) && hasLog && isApplicable;
                              const backgroundColor = isColored ? weekColor! : '#FFFFFF';
                              const color = isColored ? textColorForBackground(weekColor) : '#374151';

                              return (
                                <td
                                  key={`${student.id}-${practice.id}-${weekKey}`}
                                  className="px-1 py-1.5 text-center border-r border-gray-100 font-semibold"
                                  style={{ backgroundColor, color }}
                                >
                                  {!isApplicable || !hasLog ? '-' : formatPoint(points)}
                                </td>
                              );
                            });
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
