'use client';

import { trpc } from '@/lib/trpc';
import {
  WEEK_KEYS,
  getReportTableLayout,
  parseDatePreset,
} from '@/app/shared/report/report-table-layout';

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

function isPracticeEligibleOnDate(practiceType: string, dayKey: string): boolean {
  const date = new Date(dayKey + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return true;
  const day = date.getDay();
  if (practiceType === 'class') return day === 0 || day === 6;
  if (practiceType === 'homework' || practiceType === 'extra') return day >= 1 && day <= 5;
  return true;
}

export default function SharedReportClient({ token }: { token: string }) {
  const {
    data: report,
    isLoading: reportLoading,
    error: reportError,
  } = trpc.dashboard.sharedReport.useQuery(
    { token },
    { retry: false },
  );

  const {
    emptyColSpan,
    hasSubColumns,
    isEmptyWeek,
    isTodayPreset,
    isWeekPreset,
    perPracticeColumnCount,
    subColumns,
    tableMinWidth,
  } = getReportTableLayout({
    datePreset: parseDatePreset(report?.meta.datePreset),
    dateFrom: report?.meta.dateFrom,
    dateToInclusive: report?.meta.dateToInclusive,
    practiceTypes: (report?.practices ?? []).map((practice) => practice.type),
    practiceCount: report?.practices.length ?? 0,
  });

  if (reportLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="text-gray-500 text-sm">Yuklanmoqda...</div>
      </div>
    );
  }

  if (reportError) {
    const msg = reportError.message === 'Havola yaroqsiz yoki muddati tugagan'
      ? 'Bu havola yaroqsiz yoki muddati tugagan.'
      : reportError.message;
    return (
      <div className="flex items-center justify-center min-h-screen bg-white p-6">
        <div className="text-center">
          <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-700 max-w-md">
            <p className="font-semibold mb-1">Xatolik</p>
            <p>{msg}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="text-gray-500 text-sm">Ma'lumot topilmadi.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white p-4 md:p-6 lg:p-8">
      <div className="mb-4 pb-3 border-b border-gray-200">
        <h1 className="text-lg md:text-xl font-bold text-gray-900">{report.meta.courseName}</h1>
        <p className="text-xs md:text-sm text-gray-500 mt-1">
          {report.meta.courseRunName ? report.meta.courseRunName + ' — ' : ''}
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
                O&apos;quvchi
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
                ? report.practices.map((practice, pIdx) => (
                    <th
                      key={practice.id}
                      className={'text-center px-1 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 min-w-[46px] md:min-w-[96px] ' + (pIdx < report.practices.length - 1 ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-200')}
                    >
                      <div className="leading-tight">
                        <p className="text-[10px] md:text-xs">{practice.name}</p>
                      </div>
                    </th>
                  ))
                : report.practices.map((practice, pIdx) => (
                    <th
                      key={practice.id}
                      colSpan={perPracticeColumnCount}
                      className={'text-center px-1 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 ' + (pIdx < report.practices.length - 1 ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-200')}
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
            {hasSubColumns && (
              <tr className="bg-gray-50 border-b border-gray-200">
                {report.practices.flatMap((practice, pIdx) =>
                  subColumns.map((subColumn, sIdx) => {
                    const isLastCol = sIdx === subColumns.length - 1;
                    const isDivider = isLastCol && pIdx < report.practices.length - 1;
                    return (
                    <th
                      key={practice.id + '-' + subColumn.key}
                      className={'text-center px-0.5 md:px-1 py-1 md:py-1.5 text-[10px] md:text-[11px] font-semibold min-w-[36px] md:min-w-[48px] text-gray-600 ' + (isDivider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-200')}
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
                <td colSpan={emptyColSpan} className="px-4 py-8 text-center text-sm text-gray-500">
                  Ma&apos;lumot topilmadi.
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
                    ? report.practices.map((practice, pIdx) => {
                        const cell = student.cells[practice.id];
                        const isApplicable = isPracticeEligibleOnDate(practice.type, report.meta.dateFrom);
                        const hasLog = cell?.hasLogs ?? false;
                        const points = cell?.points ?? 0;
                        const colorHex = hasLog ? (cell?.colorHex ?? null) : null;
                        const isColored = Boolean(colorHex) && hasLog && isApplicable;
                        const backgroundColor = isColored ? colorHex! : '#FFFFFF';
                        const color = isColored ? textColorForBackground(colorHex) : '#374151';
                        const isDivider = pIdx < report.practices.length - 1;
                        return (
                          <td
                            key={student.id + '-' + practice.id + '-today'}
                            className={'px-0.5 md:px-2 py-1.5 md:py-2 text-center font-semibold text-sm md:text-base ' + (isDivider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100')}
                            style={{ backgroundColor, color }}
                          >
                            {!isApplicable || !hasLog ? '-' : formatPoint(points)}
                          </td>
                        );
                      })
                    : report.practices.flatMap((practice, pIdx) => {
                        const cell = student.cells[practice.id];
                        if (isWeekPreset) {
                          if (isEmptyWeek) {
                            const isDivider = pIdx < report.practices.length - 1;
                            return (
                              <td
                                key={student.id + '-' + practice.id + '-empty-week'}
                                className={'px-0.5 md:px-1 py-1 md:py-1.5 text-center font-medium text-sm md:text-base text-gray-300 ' + (isDivider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100')}
                              >
                                -
                              </td>
                            );
                          }

                          const dayStatsByDate = new Map((cell?.dayStats ?? []).map((day) => [day.date, day]));
                          return subColumns.map((dayColumn, dIdx) => {
                            const stat = dayStatsByDate.get(dayColumn.key);
                            const isApplicable = stat?.isApplicable ?? isPracticeEligibleOnDate(practice.type, dayColumn.key);
                            const hasLog = stat?.hasLog ?? false;
                            const points = stat?.points ?? 0;
                            const dayColor = hasLog ? (stat?.colorHex ?? null) : null;
                            const isColored = Boolean(dayColor) && hasLog && isApplicable;
                            const backgroundColor = isColored ? dayColor! : '#FFFFFF';
                            const color = isColored ? textColorForBackground(dayColor) : '#374151';
                            const isLastCol = dIdx === subColumns.length - 1;
                            const isDivider = isLastCol && pIdx < report.practices.length - 1;
                            return (
                              <td
                                key={student.id + '-' + practice.id + '-' + dayColumn.key}
                                className={'px-0.5 md:px-1 py-1 md:py-1.5 text-center font-semibold text-sm md:text-base ' + (isDivider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100')}
                                style={{ backgroundColor, color }}
                              >
                                {!isApplicable || !hasLog ? '-' : formatPoint(points)}
                              </td>
                            );
                          });
                        }

                        return WEEK_KEYS.map((weekKey, wIdx) => {
                          const weekStat = cell?.weekStats?.[weekKey];
                          const points = weekStat?.points ?? cell?.weekPoints?.[weekKey] ?? 0;
                          const hasLog = weekStat?.hasLog ?? false;
                          const isApplicable = weekStat?.isApplicable ?? true;
                          const weekColor = hasLog ? (weekStat?.colorHex ?? cell?.weekColors?.[weekKey] ?? null) : null;
                          const isColored = Boolean(weekColor) && hasLog && isApplicable;
                          const backgroundColor = isColored ? weekColor! : '#FFFFFF';
                          const color = isColored ? textColorForBackground(weekColor) : '#374151';
                          const isLastCol = wIdx === WEEK_KEYS.length - 1;
                          const isDivider = isLastCol && pIdx < report.practices.length - 1;
                          return (
                            <td
                              key={student.id + '-' + practice.id + '-' + weekKey}
                              className={'px-0.5 md:px-1 py-1 md:py-1.5 text-center font-semibold text-sm md:text-base ' + (isDivider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100')}
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
  );
}
