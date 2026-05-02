'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { StudentDetailModal } from './student-detail-modal';

type SecondaryFilter = 'tariff' | 'region';
type CourseType = '' | 'offline' | 'online' | 'intensiv';

function normalizeCourseCategory(raw?: string | null): Exclude<CourseType, ''> {
  const value = (raw ?? '').toLowerCase();
  if (value.includes('intens')) return 'intensiv';
  if (value.includes('online') || value.includes('onlayn')) return 'online';
  return 'offline';
}

export default function StudentsPage() {
  const [selectedCourseType, setSelectedCourseType] = useState<CourseType>('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [secondaryFilter, setSecondaryFilter] = useState<SecondaryFilter>('tariff');
  const [selectedTariffId, setSelectedTariffId] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  const { data: filterOptions, error: filterOptionsError } = trpc.students.filterOptions.useQuery();
  const { data: courseRuns, error: courseRunsError } = trpc.dashboard.courseRuns.useQuery();
  const { data: courses, error: coursesError } = trpc.dashboard.courses.useQuery();

  const filteredCourses = useMemo(
    () =>
      (courses ?? []).filter((course) => (
        !selectedCourseType || normalizeCourseCategory(course.category) === selectedCourseType
      )),
    [courses, selectedCourseType],
  );

  const filteredCourseRuns = useMemo(
    () =>
      (courseRuns ?? []).filter((run) => {
        if (selectedCourseId && run.courseId !== selectedCourseId) return false;
        if (!selectedCourseType) return true;
        return normalizeCourseCategory(run.course.category) === selectedCourseType;
      }),
    [courseRuns, selectedCourseId, selectedCourseType],
  );

  const allowedCourseIds = useMemo(
    () => new Set(filteredCourses.map((course) => course.id)),
    [filteredCourses],
  );

  const filteredTariffs = useMemo(() => {
    const tariffs = filterOptions?.tariffs ?? [];
    if (selectedCourseId) {
      return tariffs.filter((tariff) => tariff.courseId === selectedCourseId);
    }
    if (selectedCourseType) {
      return tariffs.filter((tariff) => allowedCourseIds.has(tariff.courseId));
    }
    return tariffs;
  }, [allowedCourseIds, filterOptions?.tariffs, selectedCourseId, selectedCourseType]);

  useEffect(() => {
    if (!selectedCourseId) return;
    if (allowedCourseIds.has(selectedCourseId)) return;
    setSelectedCourseId('');
    setSelectedCourseRunId('');
    setSelectedTariffId('');
    setPage(1);
  }, [allowedCourseIds, selectedCourseId]);

  useEffect(() => {
    if (!selectedCourseRunId) return;
    if (filteredCourseRuns.some((run) => run.id === selectedCourseRunId)) return;
    setSelectedCourseRunId('');
    setPage(1);
  }, [filteredCourseRuns, selectedCourseRunId]);

  const { data, isLoading, error } = trpc.students.list.useQuery(
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
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">O'quvchilar</h1>

      {(filterOptionsError || courseRunsError || coursesError || error) && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {filterOptionsError?.message || coursesError?.message || courseRunsError?.message || error?.message || "Ma'lumotni yuklashda xatolik"}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={selectedCourseType}
          onChange={(e) => {
            setSelectedCourseType(e.target.value as CourseType);
            setSelectedCourseId('');
            setSelectedCourseRunId('');
            setSelectedTariffId('');
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
        >
          <option value="">Barcha kurs turlari</option>
          <option value="offline">Offline</option>
          <option value="online">Online</option>
          <option value="intensiv">Intensiv</option>
        </select>

        {filteredCourseRuns.length > 0 && (
          <select
            value={selectedCourseRunId}
            onChange={(e) => {
              setSelectedCourseRunId(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
          >
            <option value="">Barcha oqimlar</option>
            {filteredCourseRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.name}
              </option>
            ))}
          </select>
        )}

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
          {filteredCourses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>

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

        {secondaryFilter === 'tariff' ? (
          <select
            value={selectedTariffId}
            onChange={(e) => {
              setSelectedTariffId(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
          >
            <option value="">Barcha tariflar</option>
            {filteredTariffs.map((tariff) => (
              <option key={tariff.id} value={tariff.id}>
                {tariff.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={selectedRegion}
            onChange={(e) => {
              setSelectedRegion(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
          >
            <option value="">Barcha viloyatlar</option>
            {filterOptions?.regions.map((region) => (
              <option key={region.id} value={region.name}>
                {region.name}
              </option>
            ))}
          </select>
        )}

        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Ism yoki raqam bo'yicha qidirish..."
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700 w-full sm:min-w-64 sm:w-auto"
        />
      </div>

      {data && (
        <p className="text-sm text-gray-500 mb-3">
          Jami: <span className="font-medium text-gray-700">{data.pagination.total}</span> ta o'quvchi
        </p>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Yuklanmoqda...</div>
        ) : !data || data.data.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">O'quvchilar topilmadi</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Ism</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Raqam</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Telegram</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Viloyat</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Tarif</th>
                  {data.data[0]?.exerciseStats.map((exercise) => (
                    <th key={exercise.name} className="text-center px-4 py-3 font-medium text-gray-600">
                      {exercise.name}
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
                    <td className="px-4 py-3 text-gray-600">{student.customerNumber ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {student.telegramUsername ? `@${student.telegramUsername}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{student.region ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{student.tariffName ?? '-'}</td>

                    {student.exerciseStats.map((exercise) => (
                      <td key={exercise.name} className="px-4 py-3 text-center">
                        <span
                          className={exercise.done >= exercise.total ? 'text-green-600 font-medium' : 'text-gray-700'}
                        >
                          {exercise.done}/{exercise.total}
                        </span>
                      </td>
                    ))}

                    <td className="px-4 py-3 text-center">
                      {selectedCourseRunId ? (
                        <div>
                          <span
                            className={
                              student.attendance.attended >= student.attendance.total
                                ? 'text-green-600 font-medium'
                                : 'text-gray-700'
                            }
                          >
                            {student.attendance.attended}/{student.attendance.total}
                          </span>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            Asosiy: {student.attendance.base.attended}/{student.attendance.base.total}
                            {student.attendance.isPremiumEligible
                              ? ` | Premium: ${student.attendance.premiumExtra.attended}/${student.attendance.premiumExtra.total}`
                              : ''}
                          </p>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Oldingi
          </button>
          <span className="text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Keyingi
          </button>
        </div>
      )}

      {selectedStudentId && (
        <StudentDetailModal
          customerId={selectedStudentId}
          onClose={() => setSelectedStudentId(null)}
          regions={filterOptions?.regions ?? []}
        />
      )}
    </div>
  );
}
