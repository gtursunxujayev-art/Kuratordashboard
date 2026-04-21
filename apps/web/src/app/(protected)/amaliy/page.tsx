'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/components/ui/toast';

type DateMode = 'today' | 'yesterday' | 'all';

const DAY_NAMES = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

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

function formatTime(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function AmaliyPage() {
  const { isAdmin, user: authUser } = useAuth();
  const toast = useToast();

  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [dateMode, setDateMode] = useState<DateMode>('today');
  const [studentSheetOpen, setStudentSheetOpen] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [busyExerciseId, setBusyExerciseId] = useState<string | null>(null);
  const [busyAttendance, setBusyAttendance] = useState<'base' | 'premium_extra' | null>(null);

  const { data: courseRuns } = trpc.dashboard.courseRuns.useQuery();

  const { data: students } = trpc.amaliy.studentList.useQuery({
    courseRunId: selectedCourseRunId || undefined,
  });

  const selectedDate = getModeDate(dateMode === 'all' ? 'today' : dateMode);

  const { data: exerciseData, refetch: refetchExercises } = trpc.amaliy.getStudentExercises.useQuery(
    {
      customerId: selectedStudentId ?? '',
      date: selectedDate,
      mode: dateMode === 'all' ? 'all' : 'day',
      courseRunId: selectedCourseRunId || undefined,
    },
    { enabled: !!selectedStudentId },
  );

  const { data: recentLogs, refetch: refetchRecentLogs } = trpc.amaliy.listRecentLogs.useQuery(
    {
      customerId: selectedStudentId ?? '',
      date: selectedDate,
      courseRunId: selectedCourseRunId || undefined,
    },
    { enabled: !!selectedStudentId && dateMode !== 'all' },
  );

  const logMutation = trpc.amaliy.logExercise.useMutation({
    onSuccess: () => {
      toast.show('Qo\'shildi', 'success');
      void refetchExercises();
      void refetchRecentLogs();
    },
    onError: (e) => toast.show(e.message || 'Xatolik', 'error'),
    onSettled: () => setBusyExerciseId(null),
  });

  const removeMutation = trpc.amaliy.removeExerciseLog.useMutation({
    onSuccess: () => {
      toast.show('Olib tashlandi', 'success');
      void refetchExercises();
      void refetchRecentLogs();
    },
    onError: (e) => toast.show(e.message || 'Xatolik', 'error'),
    onSettled: () => setBusyExerciseId(null),
  });

  const attendanceMutation = trpc.amaliy.markAttendance.useMutation({
    onSuccess: () => {
      toast.show('Davomat saqlandi', 'success');
      void refetchExercises();
    },
    onError: (e) => toast.show(e.message || 'Xatolik', 'error'),
    onSettled: () => setBusyAttendance(null),
  });

  const handleLogExercise = (exerciseDefinitionId: string) => {
    if (!selectedStudentId || dateMode === 'all') return;
    setBusyExerciseId(exerciseDefinitionId);
    logMutation.mutate({
      customerId: selectedStudentId,
      exerciseDefinitionId,
      completedAt: selectedDate,
    });
  };

  const handleRemoveExercise = (exerciseDefinitionId: string) => {
    if (!selectedStudentId || dateMode === 'all' || !recentLogs) return;
    const myMostRecent = recentLogs.find(
      (log) => log.exerciseDefinitionId === exerciseDefinitionId && log.loggedByUserId === authUser?.userId,
    );
    if (!myMostRecent) {
      toast.show("Faqat o'zingiz kiritgan yozuvni olib tashlay olasiz", 'error');
      return;
    }
    setBusyExerciseId(exerciseDefinitionId);
    removeMutation.mutate({ logId: myMostRecent.id });
  };

  const handleMarkAttendance = (lessonType: 'base' | 'premium_extra', attended: boolean) => {
    if (!selectedStudentId || !exerciseData?.courseRunId) return;
    setBusyAttendance(lessonType);
    attendanceMutation.mutate({
      customerId: selectedStudentId,
      courseRunId: exerciseData.courseRunId,
      lessonDate: selectedDate,
      lessonType,
      attended,
    });
  };

  const selectedStudent = students?.find((student) => student.id === selectedStudentId);

  const filteredStudents = useMemo(() => {
    if (!students) return [];
    const q = studentSearch.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.phone ?? '').toLowerCase().includes(q) ||
        (s.telegramUsername ?? '').toLowerCase().includes(q),
    );
  }, [students, studentSearch]);

  const myLogsByExercise = useMemo(() => {
    const map = new Map<string, typeof recentLogs>();
    if (!recentLogs) return map;
    for (const log of recentLogs) {
      const arr = map.get(log.exerciseDefinitionId) ?? [];
      arr.push(log);
      map.set(log.exerciseDefinitionId, arr as typeof recentLogs);
    }
    return map;
  }, [recentLogs]);

  const classExercises = (exerciseData?.exercises ?? []).filter((e) => e.type === 'class');
  const homeworkExercises = (exerciseData?.exercises ?? []).filter((e) => e.type === 'homework');

  const dateLabel = useMemo(() => {
    if (dateMode === 'all') return 'Barcha mashqlar (admin rejim)';
    const d = new Date(selectedDate);
    const day = DAY_NAMES[d.getDay()];
    const kind = exerciseData?.isClassDay ? 'Dars kuni' : 'Uy vazifasi';
    return `${day}, ${selectedDate} — ${kind}`;
  }, [dateMode, selectedDate, exerciseData?.isClassDay]);

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-xl font-bold kd-title mb-4 hidden md:block">Amaliy</h1>

      {/* Course run selector */}
      {courseRuns && courseRuns.length > 0 && (
        <div className="mb-3">
          <label className="block text-xs kd-subtle mb-1">Oqim</label>
          <select
            value={selectedCourseRunId}
            onChange={(e) => setSelectedCourseRunId(e.target.value)}
            className="w-full md:w-auto px-3 py-2.5 border rounded-lg text-sm"
          >
            <option value="">Barcha oqimlar</option>
            {courseRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Mobile student bar */}
      <div className="md:hidden mb-3">
        <button
          onClick={() => setStudentSheetOpen(true)}
          className="w-full kd-card px-4 py-3 text-left flex items-center justify-between"
        >
          <div className="min-w-0">
            <p className="text-xs kd-subtle">O'quvchi</p>
            <p className="font-semibold kd-title truncate">
              {selectedStudent ? selectedStudent.name : 'Tanlang'}
            </p>
          </div>
          <span className="text-xs kd-subtle ml-3 shrink-0">O'zgartirish ›</span>
        </button>
      </div>

      <div className="md:flex md:gap-4">
        {/* Desktop student list */}
        <div className="hidden md:block w-64 shrink-0">
          <div className="kd-card overflow-hidden">
            <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--kd-border)' }}>
              <input
                type="text"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder="Qidirish..."
                className="w-full px-2 py-1.5 text-sm border rounded"
              />
            </div>
            <div className="divide-y max-h-[calc(100vh-280px)] overflow-y-auto" style={{ borderColor: 'var(--kd-border)' }}>
              {filteredStudents.length === 0 ? (
                <div className="p-4 text-center kd-subtle text-sm">Bo'sh</div>
              ) : (
                filteredStudents.map((student) => (
                  <button
                    key={student.id}
                    onClick={() => setSelectedStudentId(student.id)}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                      selectedStudentId === student.id ? 'bg-blue-50 text-blue-600 font-medium' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium kd-title">{student.name}</div>
                    {student.phone && <div className="text-xs kd-subtle mt-0.5">{student.phone}</div>}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Detail area */}
        <div className="flex-1 min-w-0">
          {!selectedStudentId ? (
            <div className="kd-card p-8 text-center">
              <p className="kd-subtle text-sm">O'quvchini tanlang</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Header + date mode */}
              <div className="kd-card p-3 md:p-4">
                <h2 className="font-semibold kd-title text-base md:text-lg">{selectedStudent?.name}</h2>
                <p className="text-xs kd-subtle mt-0.5">{dateLabel}</p>

                <div className="mt-3 grid grid-cols-2 md:flex md:inline-flex gap-1 p-1 rounded-lg" style={{ background: 'var(--kd-surface-soft)' }}>
                  {(['today', 'yesterday'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setDateMode(mode)}
                      className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        dateMode === mode ? 'bg-white shadow-sm kd-title' : 'kd-subtle'
                      }`}
                    >
                      {mode === 'today' ? 'Bugun' : 'Kecha'}
                    </button>
                  ))}
                  {isAdmin && (
                    <button
                      onClick={() => setDateMode('all')}
                      className={`col-span-2 md:col-auto px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                        dateMode === 'all' ? 'bg-white shadow-sm kd-title' : 'kd-subtle'
                      }`}
                    >
                      Hammasi
                    </button>
                  )}
                </div>
              </div>

              {!exerciseData ? (
                <div className="kd-card p-6 text-center kd-subtle text-sm">Yuklanmoqda...</div>
              ) : exerciseData.exercises.length === 0 && !exerciseData.courseRunId ? (
                <div className="kd-card p-6 text-center kd-subtle text-sm">Faol oqim yo'q</div>
              ) : (
                <>
                  {/* Attendance */}
                  {exerciseData.courseRunId && exerciseData.isClassDay && dateMode !== 'all' && (
                    <details open className="kd-card">
                      <summary className="p-3 md:p-4 cursor-pointer flex items-center justify-between">
                        <span className="font-semibold kd-title">Davomat</span>
                        <span className="text-xs kd-subtle">
                          Asosiy: {exerciseData.attendanceSummary.base.attended}/{exerciseData.attendanceSummary.base.total}
                          {exerciseData.attendanceSummary.isPremiumEligible
                            ? ` · Premium: ${exerciseData.attendanceSummary.premiumExtra.attended}/${exerciseData.attendanceSummary.premiumExtra.total}`
                            : ''}
                        </span>
                      </summary>
                      <div className="px-3 pb-3 md:px-4 md:pb-4 space-y-3">
                        <AttendanceRow
                          label="Asosiy dars"
                          onMark={(attended) => handleMarkAttendance('base', attended)}
                          busy={busyAttendance === 'base'}
                        />
                        {exerciseData.attendanceSummary.isPremiumEligible && (
                          <AttendanceRow
                            label="Premium/VIP qo'shimcha"
                            onMark={(attended) => handleMarkAttendance('premium_extra', attended)}
                            busy={busyAttendance === 'premium_extra'}
                          />
                        )}
                      </div>
                    </details>
                  )}

                  {/* Class exercises */}
                  {classExercises.length > 0 && (
                    <details open={exerciseData.isClassDay} className="kd-card">
                      <summary className="p-3 md:p-4 cursor-pointer font-semibold kd-title">
                        Dars mashqlari ({classExercises.length})
                      </summary>
                      <div className="px-3 pb-3 md:px-4 md:pb-4 space-y-2">
                        {classExercises.map((exercise) => (
                          <ExerciseRow
                            key={exercise.id}
                            exercise={exercise}
                            dateMode={dateMode}
                            busy={busyExerciseId === exercise.id}
                            myLogs={myLogsByExercise.get(exercise.id) ?? []}
                            allLogsForExercise={(recentLogs ?? []).filter((l) => l.exerciseDefinitionId === exercise.id)}
                            onAdd={() => handleLogExercise(exercise.id)}
                            onRemove={() => handleRemoveExercise(exercise.id)}
                          />
                        ))}
                      </div>
                    </details>
                  )}

                  {/* Homework exercises */}
                  {homeworkExercises.length > 0 && (
                    <details open={!exerciseData.isClassDay} className="kd-card">
                      <summary className="p-3 md:p-4 cursor-pointer font-semibold kd-title">
                        Uy vazifalari ({homeworkExercises.length})
                      </summary>
                      <div className="px-3 pb-3 md:px-4 md:pb-4 space-y-2">
                        {homeworkExercises.map((exercise) => (
                          <ExerciseRow
                            key={exercise.id}
                            exercise={exercise}
                            dateMode={dateMode}
                            busy={busyExerciseId === exercise.id}
                            myLogs={myLogsByExercise.get(exercise.id) ?? []}
                            allLogsForExercise={(recentLogs ?? []).filter((l) => l.exerciseDefinitionId === exercise.id)}
                            onAdd={() => handleLogExercise(exercise.id)}
                            onRemove={() => handleRemoveExercise(exercise.id)}
                          />
                        ))}
                      </div>
                    </details>
                  )}

                  {exerciseData.exercises.length === 0 && (
                    <div className="kd-card p-6 text-center kd-subtle text-sm">
                      Bu rejim uchun mashqlar topilmadi
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile student sheet */}
      {studentSheetOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--kd-bg)' }}>
          <div className="sticky top-0 p-3 flex items-center gap-2 border-b" style={{ borderColor: 'var(--kd-border)', background: 'var(--kd-surface)' }}>
            <button
              onClick={() => setStudentSheetOpen(false)}
              className="w-10 h-10 rounded-md kd-subtle"
              aria-label="Yopish"
            >
              ✕
            </button>
            <input
              type="text"
              autoFocus
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
              placeholder="Ism, telefon yoki telegram..."
              className="flex-1 px-3 py-2.5 border rounded-lg text-sm"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredStudents.length === 0 ? (
              <div className="p-6 text-center kd-subtle text-sm">Topilmadi</div>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--kd-border)' }}>
                {filteredStudents.map((student) => (
                  <button
                    key={student.id}
                    onClick={() => {
                      setSelectedStudentId(student.id);
                      setStudentSheetOpen(false);
                      setStudentSearch('');
                    }}
                    className={`w-full text-left px-4 py-3 ${
                      selectedStudentId === student.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="font-medium kd-title">{student.name}</div>
                    {student.phone && <div className="text-xs kd-subtle mt-0.5">{student.phone}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AttendanceRow({
  label,
  onMark,
  busy,
}: {
  label: string;
  onMark: (attended: boolean) => void;
  busy: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium kd-title mb-1.5">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onMark(true)}
          disabled={busy}
          className="px-4 py-3 rounded-lg font-medium text-sm text-white bg-green-600 hover:bg-green-700 disabled:opacity-50"
        >
          Keldi
        </button>
        <button
          onClick={() => onMark(false)}
          disabled={busy}
          className="px-4 py-3 rounded-lg font-medium text-sm text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
        >
          Kelmadi
        </button>
      </div>
    </div>
  );
}

function ExerciseRow({
  exercise,
  dateMode,
  busy,
  myLogs,
  allLogsForExercise,
  onAdd,
  onRemove,
}: {
  exercise: {
    id: string;
    name: string;
    targetCount: number;
    doneToday: number;
    doneTotal: number;
  };
  dateMode: DateMode;
  busy: boolean;
  myLogs: Array<{ id: string; loggedByUserId: string; loggedByName: string | null; completedAt: Date | string }>;
  allLogsForExercise: Array<{ id: string; loggedByName: string | null; completedAt: Date | string }>;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const isViewOnly = dateMode === 'all';
  const complete = exercise.doneTotal >= exercise.targetCount;
  const canRemove = !isViewOnly && myLogs.length > 0;
  const latest = allLogsForExercise[0];

  return (
    <div className="border rounded-lg p-3" style={{ borderColor: 'var(--kd-border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium kd-title">{exercise.name}</p>
          <p className="text-xs kd-subtle mt-0.5">
            {isViewOnly
              ? `Jami: ${exercise.doneTotal}/${exercise.targetCount}`
              : `Bugun: ${exercise.doneToday} · Jami: ${exercise.doneTotal}/${exercise.targetCount}`}
          </p>
          {latest && !isViewOnly && (
            <p className="text-[11px] kd-subtle mt-0.5">
              Oxirgi: {latest.loggedByName ?? '—'} · {formatTime(latest.completedAt)}
            </p>
          )}
        </div>
        {complete && !isViewOnly && (
          <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 shrink-0">Bajarildi</span>
        )}
      </div>

      {!isViewOnly && (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={onRemove}
            disabled={busy || !canRemove}
            aria-label="Olib tashlash"
            className="w-11 h-11 rounded-lg border font-bold text-lg disabled:opacity-40"
            style={{ borderColor: 'var(--kd-border)' }}
          >
            −
          </button>
          <div className="flex-1 text-center text-sm kd-subtle">
            {exercise.doneToday} bugun
          </div>
          <button
            onClick={onAdd}
            disabled={busy}
            className="flex-1 h-11 rounded-lg bg-blue-600 text-white font-medium text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '...' : "+ Qo'shish"}
          </button>
        </div>
      )}
    </div>
  );
}
