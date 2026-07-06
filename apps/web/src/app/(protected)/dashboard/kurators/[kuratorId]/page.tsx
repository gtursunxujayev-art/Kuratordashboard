'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { DashboardDetailHeader, DashboardDetailState, SummaryCard } from '@/components/dashboard-detail';

type DateFilter = 'today' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'all';

export default function KuratorDetailPage() {
  const params = useParams<{ kuratorId: string }>();
  const searchParams = useSearchParams();
  const kuratorId = params.kuratorId;
  const courseId = searchParams.get('courseId') || undefined;
  const dateFilter = (searchParams.get('dateFilter') as DateFilter | null) ?? 'all';

  const { data, isLoading } = trpc.dashboard.kuratorDetail.useQuery({
    kuratorUserId: kuratorId,
    courseId,
    dateFilter,
  });

  return (
    <div className="p-5 md:p-6 space-y-5">
      <DashboardDetailHeader title="Kurator samaradorligi" />

      {isLoading ? (
        <DashboardDetailState>Yuklanmoqda...</DashboardDetailState>
      ) : data ? (
        <>
          <div className="kd-card p-4">
            <p className="text-lg font-semibold kd-title">{data.kurator.name ?? data.kurator.username ?? 'Kurator'}</p>
            <p className="text-xs kd-subtle mt-1">{data.kurator.phone ?? data.kurator.email ?? "Bog'lanish yo'q"}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            <SummaryCard title="Samaradorlik" value={`${data.summary.performancePercent}%`} />
            <SummaryCard title="O'quvchilar" value={String(data.summary.studentCount)} />
            <SummaryCard title="Bajarilgan" value={String(data.summary.completedTasks)} />
            <SummaryCard title="Bajarilmagan" value={String(data.summary.pendingTasks)} />
            <SummaryCard title="Kelmagan/HW yo'q" value={String(data.summary.missedStudents)} />
          </div>

          <div className="kd-card p-4">
            <p className="text-sm font-semibold kd-title mb-3">O'quvchilar ro'yxati</p>
            {data.students.length === 0 ? (
              <p className="text-sm kd-subtle">O'quvchilar topilmadi</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left kd-subtle">
                      <th className="py-2">O'quvchi</th>
                      <th className="py-2">Raqam</th>
                      <th className="py-2">Samaradorlik</th>
                      <th className="py-2">Vazifa</th>
                      <th className="py-2">Davomat</th>
                      <th className="py-2">Mashqlar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.students.map((student) => (
                      <tr key={student.id} style={{ borderTop: '1px solid var(--kd-border)' }}>
                        <td className="py-2 pr-3">
                          <Link
                            href={`/dashboard/students/${student.id}?dateFilter=${dateFilter}${
                              courseId ? `&courseId=${courseId}` : ''
                            }`}
                            className="font-medium kd-title hover:underline"
                          >
                            {student.name}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 kd-subtle">{student.number}</td>
                        <td className="py-2 pr-3 kd-title">{student.performancePercent}%</td>
                        <td className="py-2 pr-3 kd-subtle">
                          {student.completedTasks}/{student.completedTasks + student.pendingTasks}
                        </td>
                        <td className="py-2 pr-3 kd-subtle">
                          {student.attendedLessons}/{student.totalLessons}
                        </td>
                        <td className="py-2 pr-3 kd-subtle">{student.exerciseLogs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <DashboardDetailState>Ma&apos;lumot topilmadi</DashboardDetailState>
      )}
    </div>
  );
}
