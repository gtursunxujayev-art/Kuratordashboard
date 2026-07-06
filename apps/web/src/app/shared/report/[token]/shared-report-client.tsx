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

      <ReportTable report={report} datePreset={parseDatePreset(report.meta.datePreset)} />
    </div>
  );
}
