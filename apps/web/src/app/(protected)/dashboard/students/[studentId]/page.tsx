'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { DashboardDetailHeader, DashboardDetailState, SummaryCard } from '@/components/dashboard-detail';

type DateFilter = 'today' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'all';

export default function DashboardStudentDetailPage() {
  const params = useParams<{ studentId: string }>();
  const searchParams = useSearchParams();
  const studentId = params.studentId;
  const courseId = searchParams.get('courseId') || undefined;
  const dateFilter = (searchParams.get('dateFilter') as DateFilter | null) ?? 'all';

  const { data, isLoading } = trpc.dashboard.studentPerformanceDetail.useQuery({
    customerId: studentId,
    courseId,
    dateFilter,
  });

  return (
    <div className="p-5 md:p-6 space-y-5">
      <DashboardDetailHeader title="O'quvchi samaradorligi" />

      {isLoading ? (
        <DashboardDetailState>Yuklanmoqda...</DashboardDetailState>
      ) : data ? (
        <>
          <div className="kd-card p-4">
            <p className="text-lg font-semibold kd-title">{data.customer.name}</p>
            <p className="text-xs kd-subtle mt-1">Raqam: {data.customer.customerNumber}</p>
            <p className="text-xs kd-subtle">Telegram: {data.customer.telegramUsername ? `@${data.customer.telegramUsername}` : '—'}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <SummaryCard title="Samaradorlik" value={`${data.performance.performancePercent}%`} />
            <SummaryCard
              title="Vazifalar"
              value={`${data.homeworkSummary.completed}/${data.homeworkSummary.total}`}
            />
            <SummaryCard title="Davomat" value={`${data.performance.attendedLessons}/${data.performance.totalLessons}`} />
            <SummaryCard title="Mashqlar" value={String(data.performance.exerciseLogs)} />
          </div>

          <div className="kd-card p-4">
            <p className="text-sm font-semibold kd-title mb-2">Kurs / Tarif</p>
            {data.customer.incomes.length === 0 ? (
              <p className="text-sm kd-subtle">Faol kurs topilmadi</p>
            ) : (
              <div className="space-y-1 text-sm">
                {data.customer.incomes.map((income) => (
                  <p key={income.id} className="kd-subtle">
                    {income.course?.name ?? "Noma'lum kurs"} / {income.tariff?.name ?? "Noma'lum tarif"}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="kd-card p-4">
              <p className="text-sm font-semibold kd-title mb-2">So'nggi vazifalar</p>
              <div className="space-y-2 max-h-72 overflow-auto pr-1">
                {data.recentTasks.length === 0 ? (
                  <p className="text-sm kd-subtle">Vazifalar yo'q</p>
                ) : (
                  data.recentTasks.map((task) => (
                    <div key={task.id} className="kd-card p-2">
                      <p className="text-sm kd-title">{task.title}</p>
                      <p className="text-xs kd-subtle">
                        {task.completedAt ? 'Bajarilgan' : 'Bajarilmagan'}
                        {task.kurator?.name ? ` | ${task.kurator.name}` : ''}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="kd-card p-4">
              <p className="text-sm font-semibold kd-title mb-2">So'nggi davomat</p>
              <div className="space-y-2 max-h-72 overflow-auto pr-1">
                {data.recentAttendance.length === 0 ? (
                  <p className="text-sm kd-subtle">Davomat yo'q</p>
                ) : (
                  data.recentAttendance.map((row) => (
                    <div key={row.id} className="kd-card p-2 text-sm">
                      <p className="kd-title">{new Date(row.lessonDate).toLocaleDateString('uz-UZ')}</p>
                      <p className="text-xs kd-subtle">
                        {row.lessonType === 'premium_extra' ? 'Premium' : 'Asosiy'} | {row.attended ? 'Keldi' : 'Kelmagan'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="kd-card p-4">
              <p className="text-sm font-semibold kd-title mb-2">So'nggi mashqlar</p>
              <div className="space-y-2 max-h-72 overflow-auto pr-1">
                {data.recentExercises.length === 0 ? (
                  <p className="text-sm kd-subtle">Mashqlar yo'q</p>
                ) : (
                  data.recentExercises.map((row) => (
                    <div key={row.id} className="kd-card p-2 text-sm">
                      <p className="kd-title">{row.exerciseDefinition.name}</p>
                      <p className="text-xs kd-subtle">
                        {row.exerciseDefinition.type === 'class'
                          ? 'Dars'
                          : row.exerciseDefinition.type === 'homework'
                            ? 'Uy vazifasi'
                            : "Qo'shimcha"} |{' '}
                        {new Date(row.completedAt).toLocaleDateString('uz-UZ')}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      ) : (
        <DashboardDetailState>Ma&apos;lumot topilmadi</DashboardDetailState>
      )}
    </div>
  );
}
