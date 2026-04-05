'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type DateFilter = 'today' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'all';

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  today: 'Bugun',
  this_week: 'Bu hafta',
  last_week: "O'tgan hafta",
  this_month: 'Bu oy',
  last_month: "O'tgan oy",
  all: 'Hammasi',
};

export default function DashboardPage() {
  const [dateFilter, setDateFilter] = useState<DateFilter>('this_month');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState<string>('');
  const { isAdmin, isManager } = useAuth();

  const { data: stats, isLoading: statsLoading } = trpc.dashboard.stats.useQuery({
    dateFilter,
    courseRunId: selectedCourseRunId || undefined,
  });

  const { data: kuratorList, isLoading: kuratorsLoading } = trpc.dashboard.kuratorList.useQuery(
    { courseRunId: selectedCourseRunId || undefined },
    { enabled: isAdmin || isManager },
  );

  const { data: courseRuns } = trpc.dashboard.courseRuns.useQuery();

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Bosh sahifa</h1>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex bg-white border border-gray-200 rounded-lg overflow-hidden">
          {(Object.keys(DATE_FILTER_LABELS) as DateFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => setDateFilter(filter)}
              className={`px-3 py-2 text-sm font-medium transition-colors ${
                dateFilter === filter ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {DATE_FILTER_LABELS[filter]}
            </button>
          ))}
        </div>

        {courseRuns && courseRuns.length > 0 && (
          <select
            value={selectedCourseRunId}
            onChange={(e) => setSelectedCourseRunId(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
          >
            <option value="">Barcha oqimlar</option>
            {courseRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.name} ({run.course.name})
              </option>
            ))}
          </select>
        )}
      </div>

      {statsLoading ? (
        <div className="text-gray-500 text-sm">Yuklanmoqda...</div>
      ) : stats ? (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-medium text-gray-500 mb-3">Jami o'quvchilar</h2>
            <p className="text-3xl font-bold text-gray-900">Umumiy {stats.total}</p>
            <div className="mt-2 flex gap-4">
              <span className="text-sm text-gray-500">
                Erkaklar - <span className="font-medium text-gray-700">{stats.male}</span>
              </span>
              <span className="text-sm text-gray-500">
                Ayollar - <span className="font-medium text-gray-700">{stats.female}</span>
              </span>
            </div>
          </div>

          {stats.tariffs.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-medium text-gray-500 mb-3">Tariflar bo'yicha</h2>
              <div className="space-y-3">
                {stats.tariffs.map((tariff) => (
                  <div key={tariff.name} className="flex items-baseline gap-3">
                    <span className="font-semibold text-gray-900 w-28 shrink-0">{tariff.name}</span>
                    <span className="text-gray-900 font-medium">{tariff.total}</span>
                    <span className="text-sm text-gray-400">Erkaklar - {tariff.male}</span>
                    <span className="text-sm text-gray-400">Ayollar - {tariff.female}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {(isAdmin || isManager) && (
        <div className="mt-8">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Kuratorlar samaradorligi</h2>
          <p className="text-xs text-gray-400 mb-4">Samaradorlik foizi: vaqtinchalik formula</p>

          {kuratorsLoading ? (
            <div className="text-gray-500 text-sm">Yuklanmoqda...</div>
          ) : kuratorList && kuratorList.length > 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Kurator</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">O'quvchilar</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Samaradorlik</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Bajarilgan</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Bajarilmagan</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Kelmagan/HW yo'q</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {kuratorList.map((kurator) => (
                    <tr key={kurator.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{kurator.name}</td>
                      <td className="px-4 py-3 text-center text-gray-600">{kurator.studentCount}</td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`font-semibold ${
                            kurator.performancePercent >= 80
                              ? 'text-green-600'
                              : kurator.performancePercent >= 50
                              ? 'text-yellow-600'
                              : 'text-red-600'
                          }`}
                        >
                          {kurator.performancePercent}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-green-600">{kurator.completedTasks}</td>
                      <td className="px-4 py-3 text-center text-red-600">{kurator.pendingTasks}</td>
                      <td className="px-4 py-3 text-center text-orange-600">{kurator.missedStudents}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
              Kuratorlar topilmadi
            </div>
          )}
        </div>
      )}
    </div>
  );
}
