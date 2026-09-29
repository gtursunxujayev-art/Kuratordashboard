'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/ui/toast';
import { formatDateLocal } from '@/lib/date';

type DateMode = 'today' | 'yesterday' | 'all';
type AttendanceStatus = 'tanlanmagan' | 'keldi' | 'kelmadi';

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

// Saved/selected status colours: keldi = green, kelmadi = red, unset = neutral.
function statusStyle(status: AttendanceStatus): { background: string; color: string; border: string } {
  if (status === 'keldi') return { background: '#16a34a', color: '#ffffff', border: '#15803d' };
  if (status === 'kelmadi') return { background: '#dc2626', color: '#ffffff', border: '#b91c1c' };
  return { background: '#ffffff', color: '#111827', border: '#d1d5db' };
}

function cardTint(status: AttendanceStatus): { background?: string; borderColor?: string } {
  if (status === 'keldi') return { background: '#f0fdf4', borderColor: '#86efac' };
  if (status === 'kelmadi') return { background: '#fef2f2', borderColor: '#fca5a5' };
  return {};
}

function sourceLabel(source: string | null): { text: string; className: string } {
  if (source === 'qr') return { text: 'QR', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (source === 'system') return { text: 'Face ID', className: 'bg-indigo-50 text-indigo-600 border-indigo-200' };
  return { text: "Qo'lda", className: 'bg-gray-50 text-gray-600 border-gray-200' };
}

// "09:14" when marked on the lesson day itself, otherwise "20.09 10:02".
function formatMarkedAt(markedAt: string, lessonDate: string): string {
  const d = new Date(markedAt);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (formatDateLocal(d) === lessonDate) return `${hh}:${mm}`;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}.${month} ${hh}:${mm}`;
}

// How a saved mark was made (QR / Face ID / Qo'lda) and when. Not shown for an
// unsaved local change, since that mark doesn't exist yet.
function MarkSource({
  status,
  source,
  markedAt,
  lessonDate,
}: {
  status: AttendanceStatus;
  source: string | null;
  markedAt: string | null;
  lessonDate: string;
}) {
  if (status === 'tanlanmagan') return null;
  const label = sourceLabel(source);
  const time = markedAt ? formatMarkedAt(markedAt, lessonDate) : '';
  return (
    <span className={`inline-flex items-center gap-1 px-1 py-0.5 rounded text-[10px] font-medium border ${label.className}`}>
      {label.text}
      {time && <span className="font-normal">{time}</span>}
    </span>
  );
}

function slotKey(customerId: string, date: string): string {
  return `${customerId}:base:${date}`;
}

function AttendanceSlotCard({
  date,
  status,
  savedStatus,
  isEdited,
  source,
  markedAt,
  onChange,
}: {
  date: string;
  status: AttendanceStatus;
  savedStatus: AttendanceStatus;
  isEdited: boolean;
  source: string | null;
  markedAt: string | null;
  onChange: (status: AttendanceStatus) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-2" style={cardTint(status)}>
      <div className="flex flex-wrap items-center gap-1 mb-1 min-h-[20px]">
        <span className="text-[11px] kd-subtle">{formatShortDate(date)}</span>
        {!isEdited && (
          <MarkSource status={savedStatus} source={source} markedAt={markedAt} lessonDate={date} />
        )}
      </div>
      <AttendanceStatusSelect value={status} onChange={onChange} />
    </div>
  );
}

export default function DavomatPage() {
  const { isManager } = useAuth();
  const toast = useToast();

  const [selectedCourseId, setSelectedCourseId] = useState('');
  // '' means "Barcha oqimlar" — every oqim of the course, plus students on none.
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [dateMode, setDateMode] = useState<DateMode>('today');

  const [selectedDayBase, setSelectedDayBase] = useState<Record<string, AttendanceStatus>>({});
  const [selectedAllBase, setSelectedAllBase] = useState<Record<string, AttendanceStatus>>({});
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
      ...(selectedCourseRunId ? { courseRunId: selectedCourseRunId } : { courseId: selectedCourseId }),
      date: selectedDate,
      mode: dateMode === 'all' ? 'all' : 'day',
    },
    { enabled: isManager && Boolean(selectedCourseId) },
  );

  const saveMutation = trpc.amaliy.saveAttendanceSlots.useMutation({
    onError: (error) => {
      toast.show(error.message || 'Xatolik yuz berdi', 'error');
      setBusySaveKey(null);
    },
  });

  const students = useMemo(() => attendanceQuery.data?.students ?? [], [attendanceQuery.data?.students]);

  // Unsaved picks are keyed by student (and date for Hammasi); carrying them across a
  // date/course/oqim switch would pre-fill — and then save — them on the wrong day.
  useEffect(() => {
    setSelectedDayBase({});
    setSelectedAllBase({});
  }, [selectedCourseId, selectedCourseRunId, dateMode]);

  const attendanceSummary = useMemo(() => {
    // Students on no oqim can't be marked, so they're reported separately rather than
    // dragging the attendance percentage down.
    const markable = students.filter((student) => student.courseRunId);
    const withoutOqim = students.length - markable.length;
    // Day view: only students who actually have a lesson on this date.
    // Hammasi view: every lesson slot of every student.
    const statuses = dateMode === 'all'
      ? markable.flatMap((student) => student.baseSlots.map((slot) => slot.status))
      : markable.filter((student) => student.isLessonDay).map((student) => student.dayStatuses.base);
    const total = dateMode === 'all' ? markable.length : statuses.length;
    const present = statuses.filter((status) => status === 'keldi').length;
    const absent = statuses.filter((status) => status === 'kelmadi').length;
    const unselected = statuses.filter((status) => status === 'tanlanmagan').length;
    const percent = statuses.length ? Math.round((present / statuses.length) * 100) : 0;
    return { total, present, absent, unselected, percent, withoutOqim };
  }, [dateMode, students]);
  const anyLessonToday = students.some((student) => student.isLessonDay);

  const saveDayStudent = async (student: (typeof students)[number]) => {
    if (!student.courseRunId || !attendanceQuery.data) return;
    const key = `day:${student.id}`;
    setBusySaveKey(key);
    try {
      const dayDate = attendanceQuery.data.dateInfo.date;
      const baseStatus = selectedDayBase[student.id] ?? student.dayStatuses.base;

      await saveMutation.mutateAsync({
        customerId: student.id,
        courseRunId: student.courseRunId,
        baseSlots: [{ date: dayDate, status: baseStatus }],
      });
      toast.show('Davomat saqlandi', 'success');
      await attendanceQuery.refetch();
    } finally {
      setBusySaveKey(null);
    }
  };

  const saveAllStudent = async (student: (typeof students)[number]) => {
    if (!student.courseRunId) return;
    const key = `all:${student.id}`;
    setBusySaveKey(key);
    try {
      const baseSlots = (student.baseSlots ?? []).map((slot) => {
        const keyForSlot = slotKey(student.id, slot.date);
        return {
          date: slot.date,
          status: selectedAllBase[keyForSlot] ?? slot.status,
        };
      });

      await saveMutation.mutateAsync({
        customerId: student.id,
        courseRunId: student.courseRunId,
        baseSlots,
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
    <div className="nn-page">
      <section className="nn-hero davomat-hero">
        <h1>Davomat</h1>
      </section>

      <div className="nn-filter-card space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs kd-subtle mb-1">Kurs</label>
            <select
              value={selectedCourseId}
              onChange={(event) => {
                setSelectedCourseId(event.target.value);
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
              disabled={!selectedCourseId}
              className="w-full px-3 py-2 border rounded-lg text-sm disabled:opacity-50"
            >
              <option value="">Barcha oqimlar</option>
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

      <div className="nn-kpi-grid">
        <div className="nn-kpi-card">
          <span className="nn-kpi-icon" style={{ background: 'var(--kd-accent)' }}>{attendanceSummary.total}</span>
          <span><p className="text-xs kd-subtle">Jami o&apos;quvchi</p><p className="text-2xl font-bold kd-title">{attendanceSummary.total}</p></span>
        </div>
        <div className="nn-kpi-card">
          <span className="nn-kpi-icon" style={{ background: 'var(--nn-cyan)' }}>{attendanceSummary.present}</span>
          <span><p className="text-xs kd-subtle">Kelgan</p><p className="text-2xl font-bold kd-title">{attendanceSummary.present}</p></span>
        </div>
        <div className="nn-kpi-card">
          <span className="nn-kpi-icon" style={{ background: 'var(--kd-accent)' }}>{attendanceSummary.absent}</span>
          <span><p className="text-xs kd-subtle">Kelmagan</p><p className="text-2xl font-bold kd-title">{attendanceSummary.absent}</p></span>
        </div>
        <div className="nn-kpi-card">
          <span className="nn-kpi-icon" style={{ background: 'var(--nn-coral)' }}>{attendanceSummary.percent}%</span>
          <span><p className="text-xs kd-subtle">Davomat</p><p className="text-2xl font-bold kd-title">{attendanceSummary.percent}%</p><p className="text-xs kd-subtle">Tanlanmagan: {attendanceSummary.unselected}{attendanceSummary.withoutOqim > 0 ? ` • Oqimsiz: ${attendanceSummary.withoutOqim}` : ''}</p></span>
        </div>
      </div>

      {!selectedCourseId ? (
        <div className="kd-card p-6 text-center kd-subtle text-sm">Avval kursni tanlang</div>
      ) : attendanceQuery.isLoading ? (
        <div className="kd-card p-6 text-center kd-subtle text-sm">Yuklanmoqda...</div>
      ) : attendanceQuery.error ? (
        <div className="kd-card p-6 text-center text-red-600 text-sm">{attendanceQuery.error.message}</div>
      ) : (
        <div className="space-y-3">
          {dateMode !== 'all' && !anyLessonToday && (
            <div className="kd-card p-4 text-sm kd-subtle">Bu sana dars kuni emas</div>
          )}

          {dateMode === 'all' && attendanceQuery.data?.slotDates.hasInsufficientBase && (
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

                  {!student.courseRunId ? (
                    <p className="text-xs text-amber-700">
                      Oqimga biriktirilmagan — davomat belgilash uchun avval oqim ro&apos;yxatiga qo&apos;shing.
                    </p>
                  ) : dateMode === 'all' ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-semibold kd-subtle mb-2">Asosiy darslar</p>
                        <div className="overflow-x-auto">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-10 gap-2 xl:min-w-[1800px]">
                            {student.baseSlots.map((slot) => {
                              const key = slotKey(student.id, slot.date);
                              const selectedStatus = selectedAllBase[key] ?? slot.status;
                              return (
                                <AttendanceSlotCard
                                  key={slot.date}
                                  date={slot.date}
                                  status={selectedStatus}
                                  savedStatus={slot.status}
                                  isEdited={selectedAllBase[key] !== undefined && selectedAllBase[key] !== slot.status}
                                  source={slot.source}
                                  markedAt={slot.markedAt}
                                  onChange={(nextStatus) =>
                                    setSelectedAllBase((prev) => ({ ...prev, [key]: nextStatus }))
                                  }
                                />
                              );
                            })}
                          </div>
                        </div>
                      </div>

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
                    <div className="grid grid-cols-1 md:grid-cols-[1fr,180px] gap-2">
                      <AttendanceStatusSelect
                        value={selectedDayBase[student.id] ?? student.dayStatuses.base}
                        disabled={!student.isLessonDay || busySaveKey === busyKey}
                        labelPrefix="Asosiy"
                        onChange={(nextStatus) =>
                          setSelectedDayBase((prev) => ({
                            ...prev,
                            [student.id]: nextStatus,
                          }))
                        }
                      />

                      <button
                        onClick={() => void saveDayStudent(student)}
                        disabled={!student.isLessonDay || busySaveKey === busyKey}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                      >
                        {busySaveKey === busyKey ? '...' : 'Saqlash'}
                      </button>
                    </div>
                  )}

                  {dateMode !== 'all' && (
                    <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs kd-subtle">
                      <span>Asosiy: {statusLabel(selectedDayBase[student.id] ?? student.dayStatuses.base)}</span>
                      {(selectedDayBase[student.id] === undefined ||
                        selectedDayBase[student.id] === student.dayStatuses.base) && (
                        <MarkSource
                          status={student.dayStatuses.base}
                          source={student.daySource?.base ?? null}
                          markedAt={student.dayMarkedAt?.base ?? null}
                          lessonDate={attendanceQuery.data?.dateInfo.date ?? ''}
                        />
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
      style={{
        backgroundColor: statusStyle(value).background,
        color: statusStyle(value).color,
        borderColor: statusStyle(value).border,
        fontWeight: value === 'tanlanmagan' ? 500 : 600,
      }}
    >
      {/* Options keep a plain white list so the open dropdown stays readable. */}
      <option value="tanlanmagan" style={{ color: '#111827', backgroundColor: '#ffffff' }}>
        {prefix}Tanlanmagan
      </option>
      <option value="keldi" style={{ color: '#15803d', backgroundColor: '#ffffff' }}>
        {prefix}Keldi
      </option>
      <option value="kelmadi" style={{ color: '#b91c1c', backgroundColor: '#ffffff' }}>
        {prefix}Kelmadi
      </option>
    </select>
  );
}
