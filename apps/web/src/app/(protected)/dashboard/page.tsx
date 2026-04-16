'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';

type DateFilter = 'today' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'all';

const DATE_FILTER_LABELS: Record<DateFilter, string> = {
  today: 'Bugun',
  this_week: 'Bu hafta',
  last_week: "O'tgan hafta",
  this_month: 'Bu oy',
  last_month: "O'tgan oy",
  all: 'Hammasi',
};

export default function DashboardPage({ forcedCategory }: { forcedCategory?: 'offline' | 'online' | 'intensiv' } = {}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [dateFilter, setDateFilter] = useState<DateFilter>('this_month');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [studentPage, setStudentPage] = useState(1);

  const { data: courses } = trpc.dashboard.courses.useQuery();
  const { data: courseRuns } = trpc.dashboard.courseRuns.useQuery();

  const requestedCategory = useMemo(() => {
    if (forcedCategory) return forcedCategory;
    if (pathname === '/online') return 'online';
    if (pathname === '/intensiv') return 'intensiv';
    if (pathname === '/ofline') return 'offline';
    return (searchParams.get('category') ?? 'offline').toLowerCase();
  }, [forcedCategory, pathname, searchParams]);

  useEffect(() => {
    setSelectedCourseId('');
    setStudentPage(1);
  }, [requestedCategory]);

  useEffect(() => {
    if (!courseRuns || courseRuns.length === 0) return;

    const normalizeCategory = (raw?: string | null) => {
      const value = (raw ?? '').toLowerCase();
      if (value.includes('intens')) return 'intensiv';
      if (value.includes('online') || value.includes('onlayn')) return 'online';
      return 'offline';
    };

    const now = new Date();
    const activeRuns = courseRuns.filter((run) => {
      const start = new Date(run.startDate);
      const end = new Date(run.endDate);
      return start <= now && end >= now;
    });

    const category = normalizeCategory(requestedCategory);
    const matchesCategory = (run: (typeof courseRuns)[number]) =>
      normalizeCategory(run.course.category) === category ||
      run.name.toLowerCase().includes(category) ||
      run.course.name.toLowerCase().includes(category);

    const matchedRun =
      activeRuns.find(matchesCategory) ||
      activeRuns.find((run) => normalizeCategory(run.course.category) === 'offline') ||
      activeRuns[0] ||
      courseRuns.find(matchesCategory) ||
      courseRuns[0];

    if (!selectedCourseId && matchedRun?.courseId) {
      setSelectedCourseId(matchedRun.courseId);
      setStudentPage(1);
    }
  }, [courseRuns, requestedCategory, selectedCourseId]);

  useEffect(() => {
    if (selectedCourseId) return;
    if (courseRuns && courseRuns.length > 0) return;
    if (!courses || courses.length === 0) return;
    setSelectedCourseId(courses[0].id);
  }, [courses, courseRuns, selectedCourseId]);

  const { data: stats, isLoading: statsLoading } = trpc.dashboard.stats.useQuery({
    dateFilter,
    courseId: selectedCourseId || undefined,
  });

  const { data: kuratorList, isLoading: kuratorsLoading } = trpc.dashboard.kuratorList.useQuery({
    dateFilter,
    courseId: selectedCourseId || undefined,
  });

  const { data: students, isLoading: studentsLoading } = trpc.dashboard.studentPerformanceList.useQuery({
    dateFilter,
    courseId: selectedCourseId || undefined,
    page: studentPage,
    limit: 60,
  });

  const totalStudentPages = useMemo(() => {
    if (!students) return 0;
    return Math.max(1, Math.ceil(students.pagination.total / students.pagination.limit));
  }, [students]);

  return (
    <div className="p-5 md:p-6 space-y-5">
      <div className="kd-card p-4">
        <h1 className="text-2xl font-semibold kd-title">Bosh sahifa</h1>
        <p className="text-sm kd-subtle mt-1">Kurs bo'yicha umumiy ko'rsatkichlar va samaradorlik</p>

        <div className="mt-4 flex flex-wrap gap-2">
          <select
            value={selectedCourseId}
            onChange={(e) => {
              setSelectedCourseId(e.target.value);
              setStudentPage(1);
            }}
            className="px-3 py-2 rounded-md text-sm kd-chip"
          >
            <option value="">Barcha kurslar</option>
            {courses?.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>

          {(Object.keys(DATE_FILTER_LABELS) as DateFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => {
                setDateFilter(filter);
                setStudentPage(1);
              }}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                dateFilter === filter ? 'kd-chip-active' : 'kd-chip'
              }`}
            >
              {DATE_FILTER_LABELS[filter]}
            </button>
          ))}
        </div>
      </div>

      {statsLoading ? (
        <div className="kd-card p-5 kd-subtle text-sm">Yuklanmoqda...</div>
      ) : stats ? (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            <CompactStatCard title="Umumiy o'quvchilar" value={String(stats.total)} subtitle={`Erkak: ${stats.male} | Ayol: ${stats.female}`} />
            <CompactStatCard title="Tarif turlari" value={String(stats.tariffs.length)} subtitle="Faol tarif segmentlari" />
            <CompactStatCard
              title="Tanlangan kurs"
              value={selectedCourseId ? '1' : 'Barcha'}
              subtitle={selectedCourseId ? 'Bitta kurs filtri faol' : 'Kurs filtri yoqilmagan'}
            />
            <CompactStatCard title="Davr" value={DATE_FILTER_LABELS[dateFilter]} subtitle="Sana filtri" />
          </div>

          {stats.tariffs.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-base font-semibold kd-title">Tariflar bo'yicha</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                {stats.tariffs.map((tariff) => (
                  <div key={`${tariff.name}-${tariff.total}`} className="kd-card p-3">
                    <p className="text-xs kd-subtle">Tarif</p>
                    <p className="text-base font-semibold kd-title mt-0.5">{tariff.name}</p>
                    <p className="text-xl font-bold kd-title mt-2">{tariff.total}</p>
                    <p className="text-xs kd-subtle mt-1">Erkak: {tariff.male} | Ayol: {tariff.female}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-base font-semibold kd-title">Kuratorlar samaradorligi</h2>
        <p className="text-xs kd-subtle">Har bir karta bosilsa, kurator bo'yicha to'liq sahifa ochiladi.</p>

        {kuratorsLoading ? (
          <div className="kd-card p-5 kd-subtle text-sm">Yuklanmoqda...</div>
        ) : kuratorList && kuratorList.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {kuratorList.map((kurator) => (
              <Link
                key={kurator.id}
                href={`/dashboard/kurators/${kurator.id}?dateFilter=${dateFilter}${
                  selectedCourseId ? `&courseId=${selectedCourseId}` : ''
                }`}
                className="kd-card kd-card-clickable p-3 block"
              >
                <p className="text-sm font-semibold kd-title truncate">{kurator.name}</p>
                <p className="text-2xl font-bold kd-title mt-2">{kurator.performancePercent}%</p>
                <p className="text-xs kd-subtle mt-1">Samaradorlik</p>
                <div className="mt-3 text-xs kd-subtle space-y-0.5">
                  <p>O'quvchilar: {kurator.studentCount}</p>
                  <p>Bajarilgan: {kurator.completedTasks}</p>
                  <p>Bajarilmagan: {kurator.pendingTasks}</p>
                  <p>Kelmagan/HW yo'q: {kurator.missedStudents}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="kd-card p-5 text-sm kd-subtle">Kuratorlar topilmadi</div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold kd-title">O'quvchilar samaradorligi</h2>
        <p className="text-xs kd-subtle">Har bir ism bosilsa, o'quvchi bo'yicha to'liq sahifa ochiladi.</p>

        {studentsLoading ? (
          <div className="kd-card p-5 kd-subtle text-sm">Yuklanmoqda...</div>
        ) : students && students.data.length > 0 ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {students.data.map((student) => (
                <Link
                  key={student.id}
                  href={`/dashboard/students/${student.id}?dateFilter=${dateFilter}${
                    selectedCourseId ? `&courseId=${selectedCourseId}` : ''
                  }`}
                  className="kd-card kd-card-clickable p-3 block"
                >
                  <p className="text-sm font-semibold kd-title truncate">{student.name}</p>
                  <p className="text-xs kd-subtle">Raqam: {student.number}</p>
                  <p className="text-xl font-bold kd-title mt-2">{student.performancePercent}%</p>
                  <div className="mt-2 text-xs kd-subtle space-y-0.5">
                    <p>Vazifa: {student.completedTasks}/{student.completedTasks + student.pendingTasks}</p>
                    <p>Davomat: {student.attendedLessons}/{student.totalLessons}</p>
                    <p>Mashqlar: {student.exerciseLogs}</p>
                  </div>
                </Link>
              ))}
            </div>

            {totalStudentPages > 1 && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setStudentPage((prev) => Math.max(1, prev - 1))}
                  disabled={studentPage === 1}
                  className="px-3 py-1.5 rounded-md text-sm kd-chip disabled:opacity-40"
                >
                  Oldingi
                </button>
                <span className="text-sm kd-subtle">
                  {studentPage} / {totalStudentPages}
                </span>
                <button
                  onClick={() => setStudentPage((prev) => Math.min(totalStudentPages, prev + 1))}
                  disabled={studentPage >= totalStudentPages}
                  className="px-3 py-1.5 rounded-md text-sm kd-chip disabled:opacity-40"
                >
                  Keyingi
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="kd-card p-5 text-sm kd-subtle">O'quvchilar topilmadi</div>
        )}
      </section>
    </div>
  );
}

function CompactStatCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="kd-card p-3">
      <p className="text-xs kd-subtle">{title}</p>
      <p className="text-2xl font-bold kd-title mt-1">{value}</p>
      <p className="text-xs kd-subtle mt-1">{subtitle}</p>
    </div>
  );
}
