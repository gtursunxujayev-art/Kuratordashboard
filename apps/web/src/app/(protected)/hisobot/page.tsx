'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { ReportTable } from '@/components/report-table';
import {
  DATE_PRESET_LABELS,
  type DatePreset,
} from '@/app/shared/report/report-table-layout';

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
              data-testid="hisobot-course"
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
              data-testid="hisobot-run"
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
              data-testid="hisobot-tariff"
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
              data-testid="hisobot-kurator"
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
              data-testid={`hisobot-preset-${preset}`}
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
                  data-testid="hisobot-share-link"
                  ref={shareLinkInputRef}
                  type="text"
                  readOnly
                  value={`${typeof window !== 'undefined' ? window.location.origin : ''}/shared/report/${shareToken}`}
                  className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-gray-50 select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  data-testid="hisobot-copy-share-link"
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
                data-testid="hisobot-create-share-link"
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
          <ReportTable
            report={report}
            datePreset={datePreset}
            emptyMessage="Tanlangan filterlar bo'yicha o'quvchilar topilmadi."
          />
        </div>
      )}
    </div>
  );
}
