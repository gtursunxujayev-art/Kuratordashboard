'use client';

import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';

type WeekKey = 'week1' | 'week2' | 'week3' | 'week4' | 'week5' | 'week6';
const WEEK_KEYS: WeekKey[] = ['week1', 'week2', 'week3', 'week4', 'week5', 'week6'];
const DATE_PRESET_LABELS: Record<string, string> = {
  today: 'Bugun',
  week1: '1-hafta',
  week2: '2-hafta',
  week3: '3-hafta',
  week4: '4-hafta',
  week5: '5-hafta',
  week6: '6-hafta',
  all: 'Hammasi',
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
  const from = new Date(dateFrom + 'T00:00:00');
  const to = new Date(dateToInclusive + 'T00:00:00');
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()) return [];
  const dayLabels = ['Yak', 'Du', 'Se', 'Chor', 'Pay', 'Ju', 'Shan'] as const;
  const columns: Array<{ key: string; label: string }> = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    columns.push({ key: y + '-' + m + '-' + d, label: dayLabels[cursor.getDay()] });
    cursor.setDate(cursor.getDate() + 1);
  }
  return columns;
}

function dayTypeForDateKey(dateKey: string): 'weekday' | 'weekend' | 'unknown' {
  const date = new Date(dateKey + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return 'unknown';
  const day = date.getDay();
  return day === 0 || day === 6 ? 'weekend' : 'weekday';
}

function isPracticeEligibleOnDate(practiceType: string, dayKey: string): boolean {
  const date = new Date(dayKey + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return true;
  const day = date.getDay();
  if (practiceType === 'class') return day === 0 || day === 6;
  if (practiceType === 'homework' || practiceType === 'extra') return day >= 1 && day <= 5;
  return true;
}

export default function SharedReportPage({ params }: { params: { token: string } }) {
  const { data: report, isLoading, error } = trpc.dashboard.sharedReport.useQuery(
    { token: params.token },
    { retry: false },
  );

  const isTodayPreset = report?.meta.datePreset === 'today';
  const isWeekPreset = report?.meta.datePreset
    ? ['week1', 'week2', 'week3', 'week4', 'week5', 'week6'].includes(report.meta.datePreset)
    : false;
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
  const tableMinWidth = isTodayPreset ? 'min-w-[720px] md:min-w-[960px]' : 'min-w-[840px] md:min-w-[1080px]';
  const emptyColSpan = report ? report.practices.length * perPracticeColumnCount + 5 : 5;

  return (
    <div className="min-h-screen bg-white">
      {isLoading && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-gray-500 text-sm">Yuklanmoqda...</div>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center min-h-screen p-6">
          <div className="text-center">
            <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-700 max-w-md">
              <p className="font-semibold mb-1">Xatolik</p>
              <p>{error.message === 'Havola yaroqsiz yoki muddati tugagan' ? 'Bu havola yaroqsiz yoki muddati tugagan.' : error.message}</p>
            </div>
          </div>
        </div>
      )}

      {report && (
        <div className="p-4 md:p-6 lg:p-8">
          <div className="mb-4 pb-3 border-b border-gray-200">
            <h1 className="text-lg md:text-xl font-bold text-gray-900">{report.meta.courseName}</h1>
            <p className="text-xs md:text-sm text-gray-500 mt-1">
              {report.meta.courseRunName ? report.meta.courseRunName + ' \u2014 ' : ''}
              Davr: {report.meta.dateFrom} - {report.meta.dateToInclusive ?? report.meta.dateFrom}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className={'w-full text-xs md:text-sm border-collapse ' + tableMinWidth}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    className="sticky left-0 z-20 bg-gray-50 text-center px-1 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[32px] md:min-w-[40px] w-[32px] md:w-[40px]"
                  >
                    №
                  </th>
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    className="sticky left-[32px] md:left-[40px] z-20 bg-gray-50 text-left px-2 md:px-3 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[140px] md:min-w-[180px]"
                  >
                    O'quvchi
                  </th>
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    className="text-left px-1.5 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[58px] w-[58px] md:min-w-[92px] md:w-[92px]"
                  >
                    Tarif
                  </th>
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    className="text-left px-1.5 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[68px] w-[68px] md:min-w-[118px] md:w-[118px]"
                  >
                    Kurator
                  </th>
                  {isTodayPreset
                    ? report.practices.map((practice) => (
                        <th
                          key={practice.id}
                          className="text-center px-1 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[46px] md:min-w-[96px]"
                        >
                          <div className="leading-tight">
                            <p className="text-[10px] md:text-xs">{practice.name}</p>
                          </div>
                        </th>
                      ))
                    : report.practices.map((practice) => (
                        <th
                          key={practice.id}
                          colSpan={perPracticeColumnCount}
                          className="text-center px-1 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200"
                        >
                          <div className="leading-tight">
                            <p className="text-[10px] md:text-xs">{practice.name}</p>
                          </div>
                        </th>
                      ))}
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    className="sticky right-0 z-20 bg-gray-50 text-center px-1.5 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 min-w-[58px] w-[58px] md:min-w-[82px] md:w-[82px]"
                  >
                    Jami ball
                  </th>
                </tr>
                {!isTodayPreset && (
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {report.practices.flatMap((practice) =>
                      subColumns.map((subColumn) => (
                        <th
                          key={practice.id + '-' + subColumn.key}
                          className="text-center px-0.5 md:px-1 py-1 md:py-1.5 text-[10px] md:text-[11px] font-semibold border-r border-gray-200 min-w-[36px] md:min-w-[48px] text-gray-600"
                        >
                          {subColumn.label}
                        </th>
                      )),
                    )}
                  </tr>
                )}
              </thead>
              <tbody>
                {report.students.length === 0 ? (
                  <tr>
                    <td colSpan={emptyColSpan} className="px-4 py-8 text-center text-sm text-gray-500">
                      Ma'lumot topilmadi.
                    </td>
                  </tr>
                ) : (
                  report.students.map((student, idx) => (
                    <tr key={student.id} className="border-b border-gray-100">
                      <td className="sticky left-0 z-10 bg-white text-center px-1 md:px-2 py-1.5 md:py-2 border-r border-gray-100 align-top text-xs md:text-sm text-gray-500 font-medium">
                        {idx + 1}
                      </td>
                      <td className="sticky left-[32px] md:left-[40px] z-10 bg-white px-2 md:px-3 py-1.5 md:py-2 border-r border-gray-100 align-top">
                        <p className="font-medium text-gray-900 leading-4 md:leading-5 text-sm md:text-base">{student.name}</p>
                        <p className="text-[10px] md:text-[11px] text-gray-500 leading-3.5 md:leading-4">{student.customerNumber ?? '-'}</p>
                      </td>
                      <td className="px-1.5 md:px-2 py-1.5 md:py-2 text-gray-700 border-r border-gray-100 align-top text-[11px] md:text-xs leading-4">
                        {student.tariffName ?? '-'}
                      </td>
                      <td className="px-1.5 md:px-2 py-1.5 md:py-2 text-gray-700 border-r border-gray-100 align-top text-[11px] md:text-xs leading-4">
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
                                key={student.id + '-' + practice.id + '-today'}
                                className="px-0.5 md:px-2 py-1.5 md:py-2 text-center border-r border-gray-100 font-semibold text-sm md:text-base"
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
                                    key={student.id + '-' + practice.id + '-' + dayColumn.key}
                                    className="px-0.5 md:px-1 py-1 md:py-1.5 text-center border-r border-gray-100 font-semibold text-sm md:text-base"
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
                                  key={student.id + '-' + practice.id + '-' + weekKey}
                                  className="px-0.5 md:px-1 py-1 md:py-1.5 text-center border-r border-gray-100 font-semibold text-sm md:text-base"
                                  style={{ backgroundColor, color }}
                                >
                                  {!isApplicable || !hasLog ? '-' : formatPoint(points)}
                                </td>
                              );
                            });
                          })}
                      <td className="sticky right-0 z-10 bg-white px-1.5 md:px-2 py-1.5 md:py-2 text-center font-bold text-gray-900 border-l border-gray-200 text-sm md:text-base">
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
