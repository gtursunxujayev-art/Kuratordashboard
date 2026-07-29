'use client';

import { trpc } from '@/lib/trpc';
import { ReportTable } from '@/components/report-table';
import { parseDatePreset } from '@/app/shared/report/report-table-layout';

export default function SharedReportClient({ token }: { token: string }) {
  const {
    data: report,
    isLoading: reportLoading,
    error: reportError,
  } = trpc.dashboard.sharedReport.useQuery(
    { token },
    { retry: false },
  );

  if (reportLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen nn-app-shell">
        <div className="kd-card p-5 kd-subtle text-sm">Yuklanmoqda...</div>
      </div>
    );
  }

  if (reportError) {
    const msg = reportError.message === 'Havola yaroqsiz yoki muddati tugagan'
      ? 'Bu havola yaroqsiz yoki muddati tugagan.'
      : reportError.message;
    return (
      <div className="flex items-center justify-center min-h-screen nn-app-shell p-6">
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
      <div className="flex items-center justify-center min-h-screen nn-app-shell">
        <div className="kd-card p-5 text-gray-500 text-sm">Ma&apos;lumot topilmadi.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen nn-app-shell p-4 md:p-6 lg:p-8">
      <div className="nn-hero mb-4">
        <h1>{report.meta.courseName}</h1>
        <p>
          {report.meta.courseRunName ? report.meta.courseRunName + ' — ' : ''}
          Davr: {report.meta.dateFrom} - {report.meta.dateToInclusive ?? report.meta.dateFrom}
        </p>
      </div>

      <div className="nn-table-card">
        <ReportTable report={report} datePreset={parseDatePreset(report.meta.datePreset)} />
      </div>
    </div>
  );
}
