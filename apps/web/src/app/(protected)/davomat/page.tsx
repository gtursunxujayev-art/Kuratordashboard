'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/ui/toast';

type DateMode = 'today' | 'yesterday' | 'all';
type AttendanceStatus = 'tanlanmagan' | 'keldi' | 'kelmadi';

function formatDateLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getModeDate(mode: Exclude<DateMode, 'all'>): string {
  const today = new Date();
  if (mode === 'today') return formatDateLocal(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return formatDateLocal(yesterday);
}

function formatShortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

function statusLabel(status: AttendanceStatus): string {
  if (status === 'keldi') return 'Keldi';
  if (status === 'kelmadi') return 'Kelmadi';
  return 'Tanlanmagan';
}

function statusTextColor(status: AttendanceStatus): string {
  if (status === 'keldi') return '#15803d';
  if (status === 'kelmadi') return '#b91c1c';
  return '#111827';
}

function slotKey(customerId: string, lessonType: 'base' | 'premium_extra', date: string): string {
  return `${customerId}:${lessonType}:${date}`;
}

export default function DavomatPage() {
  const { isManager } = useAuth();
  const toast = useToast();

  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [dateMode, setDateMode] = useState<DateMode>('today');

  const [selectedDayBase, setSelectedDayBase] = useState<Record<string, AttendanceStatus>>({});
  const [selectedDayPremium, setSelectedDayPremium] = useState<Record<string, AttendanceStatus>>({});
  const [selectedAllBase, setSelectedAllBase] = useState<Record<string, AttendanceStatus>>({});
  const [selectedAllPremium, setSelectedAllPremium] = useState<Record<string, AttendanceStatus>>({});
  const [busySaveKey, setBusySaveKey] = useState<string | null>(null);

  const selectedDate = useMemo(
    () => (dateMode === 'all' ? getModeDate('today') : getModeDate(dateMode)),
    [dateMode],
  );

  const { data: courses } = trpc.dashboard.courses.useQuery();
  const { data: allRuns } = trpc.dashboard.courseRuns.useQuery();
  const courseRuns = useMemo(
    () => (allRuns ?? []).filter((run) => !selectedCourseId || run.courseId === selectedCourseId),
    [allRuns, selectedCourseId],
  );

  const attendanceQuery = trpc.amaliy.listAttendanceStudents.useQuery(
    {
      courseRunId: selectedCourseRunId,
      date: selectedDate,
      mode: dateMode === 'all' ? 'all' : 'day',
    },
    { enabled: isManager && Boolean(selectedCourseRunId) },
  );

  const saveMutation = trpc.amaliy.saveAttendanceSlots.useMutation({
    onError: (error) => {
      toast.show(error.message || 'Xatolik yuz berdi', 'error');
      setBusySaveKey(null);
    },
  });

  const students = attendanceQuery.data?.students ?? [];
  const isLessonDay = attendanceQuery.data?.isLessonDay ?? false;

  const saveDayStudent = async (student: (typeof students)[number]) => {
    if (!selectedCourseRunId || !attendanceQuery.data) return;
    const key = `day:${student.id}`;
    setBusySaveKey(key);
    try {
      const dayDate = attendanceQuery.data.dateInfo.date;
      const baseStatus = selectedDayBase[student.id] ?? student.dayStatuses.base;
      const premiumStatus = student.isPremiumEligible
        ? (selectedDayPremium[student.id] ?? student.dayStatuses.premiumExtra ?? 'tanlanmagan')
        : 'tanlanmagan';

      await saveMutation.mutateAsync({
        customerId: student.id,
        courseRunId: selectedCourseRunId,
        baseSlots: [{ date: dayDate, status: baseStatus }],
        premiumExtraSlots: student.isPremiumEligible
          ? [{ date: dayDate, status: premiumStatus }]
          : [],
      });
      toast.show('Davomat saqlandi', 'success');
      await attendanceQuery.refetch();
    } finally {
      setBusySaveKey(null);
    }
  };

  const saveAllStudent = async (student: (typeof students)[number]) => {
    if (!selectedCourseRunId) return;
    const key = `all:${student.id}`;
    setBusySaveKey(key);
    try {
      const baseSlots = (student.baseSlots ?? []).map((slot) => {
        const keyForSlot = slotKey(student.id, 'base', slot.date);
        return {
          date: slot.date,
          status: selectedAllBase[keyForSlot] ?? slot.status,
        };
      });
      const premiumExtraSlots = student.isPremiumEligible
        ? (student.premiumExtraSlots ?? []).map((slot) => {
            const keyForSlot = slotKey(student.id, 'premium_extra', slot.date);
            return {
              date: slot.date,
              status: selectedAllPremium[keyForSlot] ?? slot.status,
            };
          })
        : [];

      await saveMutation.mutateAsync({
        customerId: student.id,
        courseRunId: selectedCourseRunId,
        baseSlots,
        premiumExtraSlots,
      });
      toast.show('Davomat saqlandi', 'success');
      await attendanceQuery.refetch();
    } finally {
      setBusySaveKey(null);
    }
  };

  if (!isManager) {
    return (
      <div className="p-4 md:p-6">
        <div className="kd-card p-6 text-center kd-subtle text-sm">Bu sahifa faqat admin va menejerlar uchun.</div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-bold kd-title">Davomat</h1>

      <div className="kd-card p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs kd-subtle mb-1">Kurs</label>
            <select
              value={selectedCourseId}
              onChange={(event) => {
                const nextCourseId = event.target.value;
                setSelectedCourseId(nextCourseId);
                setSelectedCourseRunId('');
              }}
              className="w-full px-3 py-2 border rounded-lg text-sm"
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
              value={selectedCourseRunId}
              onChange={(event) => setSelectedCourseRunId(event.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              disabled={!selectedCourseId}
            >
              <option value="">{selectedCourseId ? "Oqimni tanlang..." : "Avval kursni tanlang"}</option>
              {courseRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs kd-subtle mb-1">Sana</label>
            <div className="grid grid-cols-3 gap-1 rounded-md p-1" style={{ background: 'var(--kd-surface-soft)' }}>
              <button
                onClick={() => setDateMode('today')}
                className={`px-2 py-2 rounded text-sm ${dateMode === 'today' ? 'bg-white shadow-sm' : 'kd-subtle'}`}
              >
                Bugun
              </button>
              <button
                onClick={() => setDateMode('yesterday')}
                className={`px-2 py-2 rounded text-sm ${dateMode === 'yesterday' ? 'bg-white shadow-sm' : 'kd-subtle'}`}
              >
                Kecha
              </button>
              <button
                onClick={() => setDateMode('all')}
                className={`px-2 py-2 rounded text-sm ${dateMode === 'all' ? 'bg-white shadow-sm' : 'kd-subtle'}`}
              >
                Hammasi
              </button>
            </div>
          </div>
        </div>
      </div>

      {!selectedCourseId ? (
        <div className="kd-card p-6 text-center kd-subtle text-sm">Avval kursni tanlang</div>
      ) : !selectedCourseRunId ? (
        <div className="kd-card p-6 text-center kd-subtle text-sm">Davomat saqlash uchun oqimni tanlang</div>
      ) : attendanceQuery.isLoading ? (
        <div className="kd-card p-6 text-center kd-subtle text-sm">Yuklanmoqda...</div>
      ) : attendanceQuery.error ? (
        <div className="kd-card p-6 text-center text-red-600 text-sm">{attendanceQuery.error.message}</div>
      ) : (
        <div className="space-y-3">
          {dateMode !== 'all' && !isLessonDay && (
            <div className="kd-card p-4 text-sm kd-subtle">Bu sana dars kuni emas</div>
          )}

          {dateMode === 'all' && (attendanceQuery.data?.slotDates.hasInsufficientBase || attendanceQuery.data?.slotDates.hasInsufficientPremium) && (
            <div className="kd-card p-4 text-xs text-amber-700">
              Oqim davrida dars kunlari yetarli emas, shuning uchun mavjud bo&apos;lgan kunlar ko&apos;rsatildi.
            </div>
          )}

          {students.length === 0 ? (
            <div className="kd-card p-6 text-center kd-subtle text-sm">O&apos;quvchilar topilmadi</div>
          ) : (
            students.map((student) => {
              const busyKey = `${dateMode === 'all' ? 'all' : 'day'}:${student.id}`;
              return (
                <div key={student.id} className="kd-card p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold kd-title">{student.name}</p>
                    <p className="text-xs kd-subtle">
                      {student.customerNumber}
                      {student.tariffName ? ` • ${student.tariffName}` : ''}
                    </p>
                  </div>

                  {dateMode === 'all' ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold kd-subtle mb-2">Asosiy darslar</p>
                        <div className="overflow-x-auto">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-10 gap-2 xl:min-w-[1800px]">
                            {student.baseSlots.map((slot) => {
                              const key = slotKey(student.id, 'base', slot.date);
                              const selectedStatus = selectedAllBase[key] ?? slot.status;
                              const isFaceId = !selectedAllBase[key] && slot.status === 'keldi' && slot.source === 'system';
                              return (
                                <div key={slot.date} className="rounded-lg border border-gray-200 p-2">
                                  <p className="text-[11px] kd-subtle mb-1">{formatShortDate(slot.date)}</p>
                                  {isFaceId && (
                                    <span className="inline-block mb-1 px-1 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-600 font-medium border border-indigo-200">
                                      Face ID
                                    </span>
                                  )}
                                  <AttendanceStatusSelect
                                    value={selectedStatus}
                                    onChange={(nextStatus) =>
                                      setSelectedAllBase((prev) => ({
                                        ...prev,
                                        [key]: nextStatus,
                                      }))
                                    }
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {student.isPremiumEligible && (
                        <div>
                          <p className="text-xs font-semibold kd-subtle mb-2">Premium qo&apos;shimcha</p>
                          <div className="overflow-x-auto">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-10 gap-2 xl:min-w-[1800px]">
                              {student.premiumExtraSlots.map((slot) => {
                                const key = slotKey(student.id, 'premium_extra', slot.date);
                                const selectedStatus = selectedAllPremium[key] ?? slot.status;
                                const isFaceId = !selectedAllPremium[key] && slot.status === 'keldi' && slot.source === 'system';
                                return (
                                  <div key={slot.date} className="rounded-lg border border-gray-200 p-2">
                                    <p className="text-[11px] kd-subtle mb-1">{formatShortDate(slot.date)}</p>
                                    {isFaceId && (
                                      <span className="inline-block mb-1 px-1 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-600 font-medium border border-indigo-200">
                                        Face ID
                                      </span>
                                    )}
                                    <AttendanceStatusSelect
                                      value={selectedStatus}
                                      onChange={(nextStatus) =>
                                        setSelectedAllPremium((prev) => ({
                                          ...prev,
                                          [key]: nextStatus,
                                        }))
                                      }
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end">
                        <button
                          onClick={() => void saveAllStudent(student)}
                          disabled={busySaveKey === busyKey}
                          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                        >
                          {busySaveKey === busyKey ? '...' : 'Saqlash'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-[1fr,1fr,180px] gap-2">
                      <AttendanceStatusSelect
                        value={selectedDayBase[student.id] ?? student.dayStatuses.base}
                        disabled={!isLessonDay || busySaveKey === busyKey}
                        labelPrefix="Asosiy"
                        onChange={(nextStatus) =>
                          setSelectedDayBase((prev) => ({
                            ...prev,
                            [student.id]: nextStatus,
                          }))
                        }
                      />

                      {student.isPremiumEligible ? (
                        <AttendanceStatusSelect
                          value={selectedDayPremium[student.id] ?? student.dayStatuses.premiumExtra ?? 'tanlanmagan'}
                          disabled={!isLessonDay || busySaveKey === busyKey}
                          labelPrefix="Premium"
                          onChange={(nextStatus) =>
                            setSelectedDayPremium((prev) => ({
                              ...prev,
                              [student.id]: nextStatus,
                            }))
                          }
                        />
                      ) : (
                        <div className="w-full px-3 py-2 border rounded-lg text-sm kd-subtle">
                          Premium: mos emas
                        </div>
                      )}

                      <button
                        onClick={() => void saveDayStudent(student)}
                        disabled={!isLessonDay || busySaveKey === busyKey}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                      >
                        {busySaveKey === busyKey ? '...' : 'Saqlash'}
                      </button>
                    </div>
                  )}

                  {dateMode !== 'all' && (
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs kd-subtle">
                      <span>Asosiy: {statusLabel(selectedDayBase[student.id] ?? student.dayStatuses.base)}</span>
                      {!selectedDayBase[student.id] &&
                        student.dayStatuses.base === 'keldi' &&
                        student.daySource?.base === 'system' && (
                          <span className="px-1 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-600 font-medium border border-indigo-200">
                            Face ID
                          </span>
                        )}
                      {student.isPremiumEligible && (
                        <>
                          <span>•</span>
                          <span>Premium: {statusLabel(selectedDayPremium[student.id] ?? student.dayStatuses.premiumExtra ?? 'tanlanmagan')}</span>
                          {!selectedDayPremium[student.id] &&
                            student.dayStatuses.premiumExtra === 'keldi' &&
                            student.daySource?.premiumExtra === 'system' && (
                              <span className="px-1 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-600 font-medium border border-indigo-200">
                                Face ID
                              </span>
                            )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function AttendanceStatusSelect({
  value,
  disabled,
  labelPrefix,
  onChange,
}: {
  value: AttendanceStatus;
  disabled?: boolean;
  labelPrefix?: string;
  onChange: (nextStatus: AttendanceStatus) => void;
}) {
  const prefix = labelPrefix ? `${labelPrefix}: ` : '';
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as AttendanceStatus)}
      className="w-full px-3 py-2 border rounded-lg text-sm disabled:opacity-50"
      style={{ color: statusTextColor(value), fontWeight: value === 'tanlanmagan' ? 500 : 600 }}
    >
      <option value="tanlanmagan" style={{ color: '#111827' }}>
        {prefix}Tanlanmagan
      </option>
      <option value="keldi" style={{ color: '#15803d' }}>
        {prefix}Keldi
      </option>
      <option value="kelmadi" style={{ color: '#b91c1c' }}>
        {prefix}Kelmadi
      </option>
    </select>
  );
}
