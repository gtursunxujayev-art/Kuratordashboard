'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { StudentDetailModal } from './student-detail-modal';

type SecondaryFilter = 'tariff' | 'region';

export default function StudentsPage() {
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [secondaryFilter, setSecondaryFilter] = useState<SecondaryFilter>('tariff');
  const [selectedTariffId, setSelectedTariffId] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  const { data: filterOptions } = trpc.students.filterOptions.useQuery();
  const { data: courseRuns } = trpc.dashboard.courseRuns.useQuery();

  const filteredTariffs = selectedCourseId
    ? (filterOptions?.tariffs ?? []).filter((t) => t.courseId === selectedCourseId)
    : (filterOptions?.tariffs ?? []);

  const { data, isLoading } = trpc.students.list.useQuery(
    {
      courseRunId: selectedCourseRunId || undefined,
      courseId: selectedCourseId || undefined,
      tariffId: secondaryFilter === 'tariff' && selectedTariffId ? selectedTariffId : undefined,
      region: secondaryFilter === 'region' && selectedRegion ? selectedRegion : undefined,
      search: search || undefined,
      page,
      limit: 50,
    },
    { keepPreviousData: true },
  );

  const totalPages = data ? Math.ceil(data.pagination.total / data.pagination.limit) : 0;

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">O&apos;quvchilar</h1>

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* Course run */}
        {courseRuns && courseRuns.length > 0 && (
          <select
            value={selectedCourseRunId}
            onChange={(e) => { setSelectedCourseRunId(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
          >
            <option value="">Barcha oqimlar</option>
            {courseRuns.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        )}

        {/* Course filter */}
        <select
          value={selectedCourseId}
          onChange={(e) => {
            setSelectedCourseId(e.target.value);
            setSelectedTariffId('');
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
        >
          <option value="">Barcha kurslar</option>
          {filterOptions?.courses.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* Secondary filter type */}
        <select
          value={secondaryFilter}
          onChange={(e) => {
            setSecondaryFilter(e.target.value as SecondaryFilter);
            setSelectedTariffId('');
            setSelectedRegion('');
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
        >
          <option value="tariff">Tarif</option>
          <option value="region">Viloyat</option>
        </select>

        {/* Secondary filter value */}
        {secondaryFilter === 'tariff' ? (
          <select
            value={selectedTariffId}
            onChange={(e) => { setSelectedTariffId(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
          >
            <option value="">Barcha tariflar</option>
            {filteredTariffs.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        ) : (
          <select
            value={selectedRegion}
            onChange={(e) => { setSelectedRegion(e.target.value); setPage(1); }}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
          >
            <option value="">Barcha viloyatlar</option>
            {filterOptions?.regions.map((r) => (
              <option key={r.id} value={r.name}>{r.name}</option>
            ))}
          </select>
        )}

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="Ism yoki telefon bo'yicha qidirish..."
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700 min-w-64"
        />
      </div>

      {/* Total count */}
      {data && (
        <p className="text-sm text-gray-500 mb-3">
          Jami: <span className="font-medium text-gray-700">{data.pagination.total}</span> ta o&apos;quvchi
        </p>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Yuklanmoqda...</div>
        ) : !data || data.data.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">O&apos;quvchilar topilmadi</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Ism</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Telefon</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Telegram</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Viloyat</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Tarif</th>
                  {data.data[0]?.exerciseStats.map((ex) => (
                    <th key={ex.name} className="text-center px-4 py-3 font-medium text-gray-600">
                      {ex.name}
                    </th>
                  ))}
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Davomat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.data.map((student) => (
                  <tr
                    key={student.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setSelectedStudentId(student.id)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{student.name}</td>
                    <td className="px-4 py-3 text-gray-600">{student.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {student.telegramUsername ? `@${student.telegramUsername}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{student.region ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{student.tariffName ?? '—'}</td>
                    {student.exerciseStats.map((ex) => (
                      <td key={ex.name} className="px-4 py-3 text-center">
                        <span
                          className={
                            ex.done >= ex.total ? 'text-green-600 font-medium' : 'text-gray-700'
                          }
                        >
                          {ex.done}/{ex.total}
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center">
                      {selectedCourseRunId ? (
                        <span
                          className={
                            student.attendance.attended >= student.attendance.total
                              ? 'text-green-600 font-medium'
                              : 'text-gray-700'
                          }
                        >
                          {student.attendance.attended}/{student.attendance.total}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Oldingi
          </button>
          <span className="text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Keyingi
          </button>
        </div>
      )}

      {/* Student detail modal */}
      {selectedStudentId && (
        <StudentDetailModal
          customerId={selectedStudentId}
          onClose={() => setSelectedStudentId(null)}
        />
      )}
    </div>
  );
}
