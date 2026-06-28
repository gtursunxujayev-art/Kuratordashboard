'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import {
  DATE_PRESET_LABELS,
  WEEK_KEYS,
  type DatePreset,
  getReportTableLayout,
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
  const date = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return true;
  const day = date.getDay();
  if (practiceType === 'class') return day === 0 || day === 6;
  if (practiceType === 'homework' || practiceType === 'extra') return day >= 1 && day <= 5;
  return true;
}

export default function HisobotPage() {
  const router = useRouter();
  const { user, isAdmin, isManager, isLoading } = useAuth();

  const [courseId, setCourseId] = useState('');
  const [courseRunId, setCourseRunId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [kuratorUserId, setKuratorUserId] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const shareLinkInputRef = useRef<HTMLInputElement>(null);
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const [stickySubHeaderTop, setStickySubHeaderTop] = useState(0);

  const generateShareToken = trpc.settings.generateReportShareToken.useMutation();

  const resetShareState = () => {
    setShareToken(null);
    setShareLinkCopied(false);
  };

  const markShareLinkCopied = () => {
    setShareLinkCopied(true);
    window.setTimeout(() => setShareLinkCopied(false), 2000);
  };

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
    () =>
      (courseRuns ?? []).filter(
        (run) => run.courseId === courseId && (!kuratorUserId || run.kuratorUserId === kuratorUserId),
      ),
    [courseId, courseRuns, kuratorUserId],
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
  const { data: tariffScopeReport } = trpc.dashboard.amaliyReportMatrix.useQuery(
    {
      courseId,
      courseRunId: courseRunId || undefined,
      kuratorUserId: kuratorUserId || undefined,
      datePreset,
    },
    {
      enabled: reportEnabled && Boolean(tariffId),
      keepPreviousData: true,
    },
  );
  const filteredTariffs = useMemo(
    () => {
      const courseTariffs = (filterOptions?.tariffs ?? []).filter((tariff) => tariff.courseId === courseId);
      const tariffSourceReport = tariffId ? tariffScopeReport : report;
      if (!tariffSourceReport) {
        return courseTariffs;
      }

      const visibleTariffNames = new Set(
        tariffSourceReport.students
          .map((student) => student.tariffName?.trim())
          .filter((tariffName): tariffName is string => Boolean(tariffName)),
      );

      return courseTariffs.filter((tariff) => visibleTariffNames.has(tariff.name));
    },
    [courseId, filterOptions?.tariffs, report, tariffId, tariffScopeReport],
  );

  useEffect(() => {
    if (!courseRunId || filteredRuns.some((run) => run.id === courseRunId)) return;
    resetShareState();
    setCourseRunId('');
  }, [courseRunId, filteredRuns]);

  useEffect(() => {
    if (!tariffId || filteredTariffs.some((tariff) => tariff.id === tariffId)) return;
    resetShareState();
    setTariffId('');
  }, [filteredTariffs, tariffId]);

  const topError =
    coursesError?.message ||
    runsError?.message ||
    filterOptionsError?.message ||
    kuratorsError?.message ||
    reportError?.message;
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
    datePreset,
    dateFrom: report?.meta.dateFrom,
    dateToInclusive: report?.meta.dateToInclusive,
    practiceTypes: (report?.practices ?? []).map((practice) => practice.type),
    practiceCount: report?.practices.length ?? 0,
  });

  useEffect(() => {
    const updateStickyOffsets = () => {
      const nextSubHeaderTop = headerRowRef.current?.offsetHeight ?? 0;
      setStickySubHeaderTop(nextSubHeaderTop);
    };

    updateStickyOffsets();

    const resizeObserver = new ResizeObserver(() => updateStickyOffsets());
    if (headerRowRef.current) {
      resizeObserver.observe(headerRowRef.current);
    }

    window.addEventListener('resize', updateStickyOffsets);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateStickyOffsets);
    };
  }, [hasSubColumns, report?.practices.length, datePreset]);

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="kd-card p-5 text-sm kd-subtle">Yuklanmoqda...</div>
      </div>
    );
  }

  if (!isManager) return null;

  return (
    <div className="px-8 md:px-14 lg:px-20 py-4 md:py-6 space-y-4">
      <div className="kd-card p-4 md:p-5 space-y-3">
        <h1 className="text-lg md:text-xl font-bold kd-title">Hisobot</h1>
        <p className="text-xs md:text-sm kd-subtle">
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
                resetShareState();
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
              onChange={(e) => {
                resetShareState();
                setCourseRunId(e.target.value);
              }}
              disabled={!courseId}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:opacity-50"
            >
              <option value="">{courseId ? 'Barcha oqimlar' : 'Avval kurs tanlang'}</option>
              {!filteredRuns.length && courseId && kuratorUserId ? (
                <option value="" disabled>Tanlangan kurator uchun oqim topilmadi</option>
              ) : null}
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
              onChange={(e) => {
                resetShareState();
                setTariffId(e.target.value);
              }}
              disabled={!courseId}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:opacity-50"
            >
              <option value="">Barcha tariflar</option>
              {!filteredTariffs.length && courseId && kuratorUserId ? (
                <option value="" disabled>Tanlangan kurator uchun tarif topilmadi</option>
              ) : null}
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
              onChange={(e) => {
                resetShareState();
                setKuratorUserId(e.target.value);
              }}
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
              onClick={() => {
                if (preset === datePreset) return;
                resetShareState();
                setDatePreset(preset);
              }}
              className={`px-2.5 md:px-3 py-1.5 md:py-2 rounded-md text-xs md:text-sm font-medium transition-colors ${
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

        {isAdmin && datePreset === 'all' && report && (
          <div className="border-t border-gray-200 pt-3 mt-1">
            {shareToken ? (
              <div className="flex items-center gap-2">
                <input
                  ref={shareLinkInputRef}
                  type="text"
                  readOnly
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}/shared/report/${shareToken}`}
                  className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-gray-50 select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() => {
                    const url = `${window.location.origin}/shared/report/${shareToken}`;
                    navigator.clipboard.writeText(url).then(() => {
                      markShareLinkCopied();
                    }).catch(() => {
                      const input = shareLinkInputRef.current;
                      if (!input) return;
                      input.focus();
                      input.select();
                      if (document.execCommand('copy')) {
                        markShareLinkCopied();
                      }
                    });
                  }}
                  className="px-3 py-1.5 rounded-md text-xs font-medium kd-chip-active whitespace-nowrap"
                >
                  {shareLinkCopied ? 'Nusxalandi ✓' : 'Nusxalash'}
                </button>
                <button
                  type="button"
                  onClick={resetShareState}
                  className="px-2 py-1.5 rounded-md text-xs kd-chip whitespace-nowrap"
                >
                  Yopish
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const result = await generateShareToken.mutateAsync({
                      courseId,
                      courseRunId: courseRunId || undefined,
                      tariffId: tariffId || undefined,
                      kuratorUserId: kuratorUserId || undefined,
                    });
                    setShareToken(result.token);
                    setShareLinkCopied(false);
                  } catch {
                    // Error handled by tRPC
                  }
                }}
                disabled={generateShareToken.isPending}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {generateShareToken.isPending ? 'Yaratilmoqda...' : "🔗 Umumiy havola olish"}
              </button>
            )}
          </div>
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
        <div className="kd-card p-0">
          <div className="overflow-x-auto overflow-y-visible rounded-[inherit]">
            <table className={`w-full text-xs md:text-sm border-collapse ${tableMinWidth}`}>
              <thead>
                <tr ref={headerRowRef} className="bg-gray-50 border-b border-gray-200">
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    style={{ top: 0 }}
                    className="sticky left-0 z-30 bg-gray-50 text-center px-1 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[32px] md:min-w-[40px] w-[32px] md:w-[40px]"
                  >
                    №
                  </th>
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    style={{ top: 0 }}
                    className="sticky left-[32px] md:left-[40px] z-30 bg-gray-50 text-left px-2 md:px-3 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[140px] md:min-w-[180px]"
                  >
                    O&apos;quvchi
                  </th>
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    style={{ top: 0 }}
                    className="sticky z-20 bg-gray-50 text-left px-1.5 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[58px] w-[58px] md:min-w-[92px] md:w-[92px]"
                  >
                    Tarif
                  </th>
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    style={{ top: 0 }}
                    className="sticky z-20 bg-gray-50 text-left px-1.5 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 border-r border-gray-200 min-w-[68px] w-[68px] md:min-w-[118px] md:w-[118px]"
                  >
                    Kurator
                  </th>
                  {isTodayPreset
                    ? report.practices.map((practice, pIdx) => (
                        <th
                          key={practice.id}
                          style={{ top: 0 }}
                          className={`sticky z-20 bg-gray-50 text-center px-1 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 min-w-[46px] md:min-w-[96px] ${pIdx < report.practices.length - 1 ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-200'}`}
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
                          style={{ top: 0 }}
                          className={`sticky z-20 bg-gray-50 text-center px-1 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 ${pIdx < report.practices.length - 1 ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-200'}`}
                        >
                          <div className="leading-tight">
                            <p className="text-[10px] md:text-xs">{practice.name}</p>
                          </div>
                        </th>
                      ))}
                  <th
                    rowSpan={hasSubColumns ? 2 : 1}
                    style={{ top: 0 }}
                    className="sticky right-0 z-30 bg-gray-50 text-center px-1.5 md:px-2 py-2 md:py-2.5 font-semibold text-gray-700 min-w-[58px] w-[58px] md:min-w-[82px] md:w-[82px]"
                  >
                    Jami ball
                  </th>
                </tr>
                {hasSubColumns && (
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {report.practices.flatMap((practice, pIdx) =>
                      subColumns.map((subColumn, sIdx) => {
                        const isSelectedWeek = datePreset === subColumn.key;
                        const isLastCol = sIdx === subColumns.length - 1;
                        const isPracticeDivider = isLastCol && pIdx < report.practices.length - 1;
                        return (
                          <th
                            key={`${practice.id}-${subColumn.key}`}
                            style={{ top: stickySubHeaderTop }}
                            className={`text-center px-0.5 md:px-1 py-1 md:py-1.5 text-[10px] md:text-[11px] font-semibold min-w-[36px] md:min-w-[48px] ${
                              isPracticeDivider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-200'
                            } sticky z-20 bg-gray-50 ${
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
                  report.students.map((student, idx) => (
                    <tr key={student.id} className="border-b border-gray-100">
                      <td className="sticky left-0 z-10 bg-white text-center px-1 md:px-2 py-1.5 md:py-2 border-r border-gray-100 align-middle text-xs md:text-sm text-gray-500 font-medium">
                        {idx + 1}
                      </td>
                      <td className="sticky left-[32px] md:left-[40px] z-10 bg-white px-2 md:px-3 py-1.5 md:py-2 border-r border-gray-100 align-middle whitespace-nowrap">
                        <div className="flex items-baseline gap-2 whitespace-nowrap">
                          <p className="font-medium text-gray-900 leading-4 md:leading-5 text-sm md:text-base">{student.name}</p>
                          <p className="text-[10px] md:text-[11px] text-gray-500 leading-3.5 md:leading-4">{student.customerNumber ?? '-'}</p>
                        </div>
                      </td>
                      <td className="px-1.5 md:px-2 py-1.5 md:py-2 text-gray-700 border-r border-gray-100 align-middle text-[11px] md:text-xs leading-4 whitespace-nowrap">
                        {student.tariffName ?? '-'}
                      </td>
                      <td
                        title={student.kuratorNames.length > 0 ? student.kuratorNames.join(', ') : '-'}
                        className="px-1.5 md:px-2 py-1.5 md:py-2 text-gray-700 border-r border-gray-100 align-middle text-[11px] md:text-xs leading-4 whitespace-nowrap"
                      >
                        <span className="block truncate">
                          {student.kuratorNames.length > 0 ? student.kuratorNames.join(', ') : '-'}
                        </span>
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
                                key={`${student.id}-${practice.id}-today`}
                                className={`px-0.5 md:px-2 py-1.5 md:py-2 text-center font-semibold text-sm md:text-base ${isDivider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100'}`}
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
                                    key={`${student.id}-${practice.id}-empty-week`}
                                    className={`px-0.5 md:px-1 py-1 md:py-1.5 text-center font-medium text-sm md:text-base text-gray-300 ${isDivider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100'}`}
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
                                    key={`${student.id}-${practice.id}-${dayColumn.key}`}
                                    className={`px-0.5 md:px-1 py-1 md:py-1.5 text-center font-semibold text-sm md:text-base ${isDivider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100'}`}
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
                                  key={`${student.id}-${practice.id}-${weekKey}`}
                                  className={`px-0.5 md:px-1 py-1 md:py-1.5 text-center font-semibold text-sm md:text-base ${isDivider ? 'border-r-2 border-r-gray-300' : 'border-r border-gray-100'}`}
                                  style={{ backgroundColor, color }}
                                >
                                  {!isApplicable || !hasLog ? '-' : formatPoint(points)}
                                </td>
                              );
                            });
                          })}
                      <td className="sticky right-0 z-10 bg-white px-1.5 md:px-2 py-1.5 md:py-2 text-center font-bold text-gray-900 border-l border-gray-200 text-sm md:text-base align-middle">
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
