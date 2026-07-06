'use client';

import { useEffect, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@/lib/trpc';
import {
  WEEK_KEYS,
  getReportTableLayout,
  type DatePreset,
} from '@/app/shared/report/report-table-layout';

type Report = inferRouterOutputs<AppRouter>['dashboard']['amaliyReportMatrix'];

interface ReportTableProps {
  report: Report;
  datePreset: DatePreset;
  emptyMessage?: string;
}

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
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.56 ? '#111827' : '#F9FAFB';
}

function formatPoint(value: number | null | undefined): string {
  const safe = value ?? 0;
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(2).replace(/\.?0+$/, '');
}

function isPracticeEligibleOnDate(practiceType: string, dayKey: string): boolean {
  const date = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return true;
  const day = date.getDay();
  if (practiceType === 'class') return day === 0 || day === 6;
  if (practiceType === 'homework' || practiceType === 'extra') return day >= 1 && day <= 5;
  return true;
}

export function ReportTable({ report, datePreset, emptyMessage = "Ma'lumot topilmadi." }: ReportTableProps) {
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const [subHeaderTop, setSubHeaderTop] = useState(0);
  const layout = getReportTableLayout({
    datePreset,
    dateFrom: report.meta.dateFrom,
    dateToInclusive: report.meta.dateToInclusive,
    practiceTypes: report.practices.map((practice) => practice.type),
    practiceCount: report.practices.length,
  });

  useEffect(() => {
    const update = () => setSubHeaderTop(headerRowRef.current?.offsetHeight ?? 0);
    update();
    const observer = new ResizeObserver(update);
    if (headerRowRef.current) observer.observe(headerRowRef.current);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [layout.hasSubColumns, report.practices.length]);

  const stickyHeader = 'sticky z-20 bg-gray-50';
  return (
    <div className="overflow-x-auto xl:overflow-visible rounded-[inherit]">
      <table data-testid="report-table" className={`w-full text-xs md:text-sm border-collapse ${layout.tableMinWidth}`}>
        <thead>
          <tr ref={headerRowRef} data-testid="report-header" className="bg-gray-50 border-b border-gray-200">
            <th data-testid="report-sticky-header-cell" rowSpan={layout.hasSubColumns ? 2 : 1} style={{ top: 0 }} className={`${stickyHeader} left-0 z-30 text-center px-1 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[32px] md:min-w-[40px] w-[32px] md:w-[40px]`}>№</th>
            <th rowSpan={layout.hasSubColumns ? 2 : 1} style={{ top: 0 }} className={`${stickyHeader} left-[32px] md:left-[40px] z-30 text-left px-2 md:px-3 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[140px] md:min-w-[180px]`}>O&apos;quvchi</th>
            <th rowSpan={layout.hasSubColumns ? 2 : 1} style={{ top: 0 }} className={`${stickyHeader} text-left px-1.5 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[58px] w-[58px] md:min-w-[92px] md:w-[92px]`}>Tarif</th>
            <th rowSpan={layout.hasSubColumns ? 2 : 1} style={{ top: 0 }} className={`${stickyHeader} text-left px-1.5 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[68px] w-[68px] md:min-w-[118px] md:w-[118px]`}>Kurator</th>
            {report.practices.map((practice, index) => (
              <th
                key={practice.id}
                colSpan={layout.isTodayPreset ? 1 : layout.perPracticeColumnCount}
                style={{ top: 0 }}
                className={`${stickyHeader} text-center px-1 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 ${layout.isTodayPreset ? 'min-w-[46px] md:min-w-[96px]' : ''} ${index < report.practices.length - 1 ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-200'}`}
              >
                <span className="text-[10px] md:text-xs leading-tight">{practice.name}</span>
              </th>
            ))}
            <th rowSpan={layout.hasSubColumns ? 2 : 1} style={{ top: 0 }} className={`${stickyHeader} right-0 z-30 text-center px-1.5 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 min-w-[58px] w-[58px] md:min-w-[82px] md:w-[82px]`}>Jami ball</th>
          </tr>
          {layout.hasSubColumns && (
            <tr className="bg-gray-50 border-b border-gray-200">
              {report.practices.flatMap((practice, practiceIndex) =>
                layout.subColumns.map((column, columnIndex) => {
                  const divider = columnIndex === layout.subColumns.length - 1 && practiceIndex < report.practices.length - 1;
                  return (
                    <th
                      key={`${practice.id}-${column.key}`}
                      style={{ top: subHeaderTop }}
                      className={`sticky z-20 bg-gray-50 text-center px-0.5 md:px-1 py-1 md:py-1.5 text-[10px] md:text-[11px] font-semibold min-w-[36px] md:min-w-[48px] ${divider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-200'} ${datePreset === column.key ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600'}`}
                    >
                      {column.label}
                    </th>
                  );
                }),
              )}
            </tr>
          )}
        </thead>
        <tbody>
          {report.students.length === 0 ? (
            <tr><td colSpan={layout.emptyColSpan} className="px-4 py-8 text-center text-sm text-gray-500">{emptyMessage}</td></tr>
          ) : report.students.map((student, studentIndex) => (
            <tr key={student.id} data-testid="report-student-row" className="border-b border-gray-100">
              <td className="sticky left-0 z-10 bg-white text-center px-1 md:px-2 py-1.5 md:py-2 border-r border-gray-100 align-middle text-xs md:text-sm text-gray-500 font-medium">{studentIndex + 1}</td>
              <td className="sticky left-[32px] md:left-[40px] z-10 bg-white px-2 md:px-3 py-1.5 md:py-2 border-r border-gray-100 align-middle whitespace-nowrap">
                <div className="flex items-baseline gap-2 whitespace-nowrap">
                  <span className="font-medium text-gray-900 leading-4 md:leading-5 text-sm md:text-base">{student.name}</span>
                  <span className="text-[10px] md:text-[11px] text-gray-500 leading-3.5 md:leading-4">{student.customerNumber ?? '-'}</span>
                </div>
              </td>
              <td className="px-1.5 md:px-2 py-1.5 md:py-2 text-gray-700 border-r border-gray-100 align-middle text-[11px] md:text-xs leading-4 whitespace-nowrap">{student.tariffName ?? '-'}</td>
              <td title={student.kuratorNames[0] ?? '-'} className="px-1.5 md:px-2 py-1.5 md:py-2 text-gray-700 border-r border-gray-100 align-middle text-[11px] md:text-xs leading-4 whitespace-nowrap"><span className="block truncate">{student.kuratorNames[0] ?? '-'}</span></td>
              {layout.isTodayPreset
                ? report.practices.map((practice, practiceIndex) => {
                    const cell = student.cells[practice.id];
                    const applicable = isPracticeEligibleOnDate(practice.type, report.meta.dateFrom);
                    const hasLog = cell?.hasLogs ?? false;
                    const colorHex = hasLog ? cell?.colorHex : null;
                    const colored = Boolean(colorHex) && applicable;
                    return (
                      <td key={`${student.id}-${practice.id}-today`} className={`px-0.5 md:px-2 py-1.5 md:py-2 text-center font-semibold text-sm md:text-base ${practiceIndex < report.practices.length - 1 ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100'}`} style={{ backgroundColor: colored ? colorHex! : '#FFFFFF', color: colored ? textColorForBackground(colorHex) : '#374151' }}>
                        {!applicable || !hasLog ? '-' : formatPoint(cell?.points)}
                      </td>
                    );
                  })
                : report.practices.flatMap((practice, practiceIndex) => {
                    const cell = student.cells[practice.id];
                    if (layout.isEmptyWeek) {
                      return <td key={`${student.id}-${practice.id}-empty`} className={`px-0.5 md:px-1 py-1 md:py-1.5 text-center text-gray-300 ${practiceIndex < report.practices.length - 1 ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100'}`}>—</td>;
                    }
                    if (layout.isWeekPreset) {
                      const byDate = new Map((cell?.dayStats ?? []).map((day) => [day.date, day]));
                      return layout.subColumns.map((column, columnIndex) => {
                        const stat = byDate.get(column.key);
                        const applicable = stat?.isApplicable ?? isPracticeEligibleOnDate(practice.type, column.key);
                        const hasLog = stat?.hasLog ?? false;
                        const colorHex = hasLog ? stat?.colorHex : null;
                        const colored = Boolean(colorHex) && applicable;
                        const divider = columnIndex === layout.subColumns.length - 1 && practiceIndex < report.practices.length - 1;
                        return <td key={`${student.id}-${practice.id}-${column.key}`} className={`px-0.5 md:px-1 py-1 md:py-1.5 text-center font-semibold text-sm md:text-base ${divider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100'}`} style={{ backgroundColor: colored ? colorHex! : '#FFFFFF', color: colored ? textColorForBackground(colorHex) : '#374151' }}>{!applicable || !hasLog ? '-' : formatPoint(stat?.points)}</td>;
                      });
                    }
                    return WEEK_KEYS.map((weekKey, weekIndex) => {
                      const stat = cell?.weekStats?.[weekKey];
                      const hasLog = stat?.hasLog ?? false;
                      const applicable = stat?.isApplicable ?? true;
                      const colorHex = hasLog ? (stat?.colorHex ?? cell?.weekColors?.[weekKey]) : null;
                      const colored = Boolean(colorHex) && applicable;
                      const divider = weekIndex === WEEK_KEYS.length - 1 && practiceIndex < report.practices.length - 1;
                      return <td key={`${student.id}-${practice.id}-${weekKey}`} className={`px-0.5 md:px-1 py-1 md:py-1.5 text-center font-semibold text-sm md:text-base ${divider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100'}`} style={{ backgroundColor: colored ? colorHex! : '#FFFFFF', color: colored ? textColorForBackground(colorHex) : '#374151' }}>{!applicable || !hasLog ? '-' : formatPoint(stat?.points ?? cell?.weekPoints?.[weekKey])}</td>;
                    });
                  })}
              <td className="sticky right-0 z-10 bg-white px-1.5 md:px-2 py-1.5 md:py-2 text-center font-bold text-gray-900 border-l border-gray-200 text-sm md:text-base align-middle">{formatPoint(student.totalPoints)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
