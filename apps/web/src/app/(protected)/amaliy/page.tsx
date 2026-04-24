'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/components/ui/toast';

type DateMode = 'today' | 'yesterday' | 'all';
type AmaliyMode = 'students' | 'practice';
type ColorPointOption = {
  id: string;
  label: string;
  colorHex: string;
  points: number;
};

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

function keyForStudentExercise(studentId: string, date: string, exerciseId: string): string {
  return `${studentId}:${date}:${exerciseId}`;
}

function keyForPracticeStudent(practiceId: string, date: string, studentId: string): string {
  return `${practiceId}:${date}:${studentId}`;
}

export default function AmaliyPage() {
  const { user: authUser, isAdmin } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState<AmaliyMode>('students');
  const [dateMode, setDateMode] = useState<DateMode>('today');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');

  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedPracticeId, setSelectedPracticeId] = useState<string>('');

  const [selectedColorByExercise, setSelectedColorByExercise] = useState<Record<string, string>>({});
  const [selectedColorByPracticeStudent, setSelectedColorByPracticeStudent] = useState<Record<string, string>>({});

  const [busyStudentExerciseKey, setBusyStudentExerciseKey] = useState<string | null>(null);
  const [busyPracticeStudentKey, setBusyPracticeStudentKey] = useState<string | null>(null);
  const [busyAttendance, setBusyAttendance] = useState<'base' | 'premium_extra' | null>(null);

  const [hiddenStudentExerciseKeys, setHiddenStudentExerciseKeys] = useState<Set<string>>(new Set());
  const [vanishingStudentExerciseKeys, setVanishingStudentExerciseKeys] = useState<Set<string>>(new Set());
  const [hiddenPracticeStudentKeys, setHiddenPracticeStudentKeys] = useState<Set<string>>(new Set());
  const [vanishingPracticeStudentKeys, setVanishingPracticeStudentKeys] = useState<Set<string>>(new Set());

  const selectedDate = getModeDate(dateMode === 'all' ? 'today' : dateMode);

  const { data: courseRuns } = trpc.dashboard.courseRuns.useQuery();
  const selectedCourseId = useMemo(
    () => (courseRuns ?? []).find((run) => run.id === selectedCourseRunId)?.courseId ?? '',
    [courseRuns, selectedCourseRunId],
  );
  const { data: students } = trpc.amaliy.studentList.useQuery({
    courseRunId: selectedCourseRunId || undefined,
  });

  const { data: exerciseData, refetch: refetchStudentExercises } = trpc.amaliy.getStudentExercises.useQuery(
    {
      customerId: selectedStudentId,
      date: selectedDate,
      mode: dateMode === 'all' ? 'all' : 'day',
      courseRunId: selectedCourseRunId || undefined,
    },
    { enabled: Boolean(selectedStudentId) },
  );

  const { data: recentLogs, refetch: refetchRecentLogs } = trpc.amaliy.listRecentLogs.useQuery(
    {
      customerId: selectedStudentId,
      date: selectedDate,
      courseRunId: selectedCourseRunId || undefined,
    },
    { enabled: Boolean(selectedStudentId) && dateMode !== 'all' },
  );

  const { data: practices } = trpc.settings.listExerciseDefinitions.useQuery(
    { courseId: selectedCourseId },
    { enabled: Boolean(selectedCourseId) },
  );

  const { data: practiceStudents, refetch: refetchPracticeStudents } = trpc.amaliy.listPracticeStudents.useQuery(
    {
      exerciseDefinitionId: selectedPracticeId,
      date: selectedDate,
      courseRunId: selectedCourseRunId || undefined,
    },
    { enabled: Boolean(selectedPracticeId) && dateMode !== 'all' },
  );

  const logMutation = trpc.amaliy.logExercise.useMutation({
    onError: (error) => {
      toast.show(error.message || 'Xatolik yuz berdi', 'error');
      setBusyStudentExerciseKey(null);
      setBusyPracticeStudentKey(null);
    },
  });

  const attendanceMutation = trpc.amaliy.markAttendance.useMutation({
    onSuccess: () => {
      toast.show('Davomat saqlandi', 'success');
      void refetchStudentExercises();
    },
    onError: (error) => toast.show(error.message || 'Xatolik', 'error'),
    onSettled: () => setBusyAttendance(null),
  });

  const selectedStudent = useMemo(
    () => (students ?? []).find((student) => student.id === selectedStudentId),
    [students, selectedStudentId],
  );

  const doneTodaySet = useMemo(
    () => new Set((recentLogs ?? []).map((row) => row.exerciseDefinitionId)),
    [recentLogs],
  );

  const visibleExercises = useMemo(() => {
    if (!exerciseData) return [];
    if (dateMode === 'all') return exerciseData.exercises;

    return exerciseData.exercises.filter((exercise) => {
      const key = keyForStudentExercise(selectedStudentId, selectedDate, exercise.id);
      return !doneTodaySet.has(exercise.id) && !hiddenStudentExerciseKeys.has(key);
    });
  }, [dateMode, doneTodaySet, exerciseData, hiddenStudentExerciseKeys, selectedDate, selectedStudentId]);

  const visiblePracticeStudents = useMemo(() => {
    const base = practiceStudents ?? [];
    if (!selectedPracticeId || dateMode === 'all') return base;

    return base.filter((student) => {
      const key = keyForPracticeStudent(selectedPracticeId, selectedDate, student.id);
      return !hiddenPracticeStudentKeys.has(key);
    });
  }, [dateMode, hiddenPracticeStudentKeys, practiceStudents, selectedDate, selectedPracticeId]);

  const dayLabel = useMemo(() => {
    const d = new Date(selectedDate);
    return `${DAY_NAMES[d.getDay()]}, ${selectedDate}`;
  }, [selectedDate]);

  const completeStudentExercise = async (exerciseId: string) => {
    if (!selectedStudentId || dateMode === 'all') return;
    const exercise = (exerciseData?.exercises ?? []).find((item) => item.id === exerciseId);
    const exerciseOptions: ColorPointOption[] = (exercise?.colorPoints ?? []).map((row) => ({
      id: row.colorOptionId,
      label: row.label,
      colorHex: row.colorHex,
      points: row.points,
    }));

    if (exerciseOptions.length === 0) {
      toast.show('Avval admin rang va ball sozlamalarini kiritsin', 'error');
      return;
    }

    const selectedColorId = selectedColorByExercise[exerciseId] || exerciseOptions[0]?.id;
    if (!selectedColorId) {
      toast.show('Rang tanlang', 'error');
      return;
    }

    const actionKey = keyForStudentExercise(selectedStudentId, selectedDate, exerciseId);
    setBusyStudentExerciseKey(actionKey);

    try {
      await logMutation.mutateAsync({
        customerId: selectedStudentId,
        exerciseDefinitionId: exerciseId,
        colorOptionId: selectedColorId,
        completedAt: selectedDate,
      });

      toast.show('Bajarildi', 'success');
      setVanishingStudentExerciseKeys((prev) => new Set(prev).add(actionKey));

      setTimeout(() => {
        setVanishingStudentExerciseKeys((prev) => {
          const next = new Set(prev);
          next.delete(actionKey);
          return next;
        });
        setHiddenStudentExerciseKeys((prev) => new Set(prev).add(actionKey));
        void refetchStudentExercises();
        void refetchRecentLogs();
      }, 480);
    } finally {
      setBusyStudentExerciseKey(null);
    }
  };

  const completePracticeStudent = async (studentId: string) => {
    if (!selectedPracticeId || dateMode === 'all') return;
    const practiceOptions: ColorPointOption[] = (currentPractice?.colorPoints ?? []).map((row) => ({
      id: row.colorOptionId,
      label: row.colorOption.label,
      colorHex: row.colorOption.colorHex,
      points: row.points,
    }));

    if (practiceOptions.length === 0) {
      toast.show('Avval admin rang va ball sozlamalarini kiritsin', 'error');
      return;
    }

    const selectedColorId =
      selectedColorByPracticeStudent[studentId] || practiceOptions[0]?.id;
    if (!selectedColorId) {
      toast.show('Rang tanlang', 'error');
      return;
    }

    const actionKey = keyForPracticeStudent(selectedPracticeId, selectedDate, studentId);
    setBusyPracticeStudentKey(actionKey);

    try {
      await logMutation.mutateAsync({
        customerId: studentId,
        exerciseDefinitionId: selectedPracticeId,
        colorOptionId: selectedColorId,
        completedAt: selectedDate,
      });

      toast.show('Bajarildi', 'success');
      setVanishingPracticeStudentKeys((prev) => new Set(prev).add(actionKey));

      setTimeout(() => {
        setVanishingPracticeStudentKeys((prev) => {
          const next = new Set(prev);
          next.delete(actionKey);
          return next;
        });
        setHiddenPracticeStudentKeys((prev) => new Set(prev).add(actionKey));
        void refetchPracticeStudents();
      }, 480);
    } finally {
      setBusyPracticeStudentKey(null);
    }
  };

  const handleAttendance = (lessonType: 'base' | 'premium_extra', attended: boolean) => {
    if (!selectedStudentId || !exerciseData?.courseRunId || dateMode === 'all') return;
    setBusyAttendance(lessonType);
    attendanceMutation.mutate({
      customerId: selectedStudentId,
      courseRunId: exerciseData.courseRunId,
      lessonDate: selectedDate,
      lessonType,
      attended,
    });
  };

  const currentPractice = (practices ?? []).find((practice) => practice.id === selectedPracticeId);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-xl font-bold kd-title">Amaliy</h1>

      <div className="kd-card p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setMode('students')}
            className={`px-3 py-2 rounded-md text-sm font-medium ${
              mode === 'students' ? 'kd-chip-active' : 'kd-chip'
            }`}
          >
            By Students
          </button>
          <button
            onClick={() => setMode('practice')}
            className={`px-3 py-2 rounded-md text-sm font-medium ${
              mode === 'practice' ? 'kd-chip-active' : 'kd-chip'
            }`}
          >
            By Amaliy
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs kd-subtle mb-1">Oqim</label>
            <select
              value={selectedCourseRunId}
              onChange={(e) => {
                setSelectedCourseRunId(e.target.value);
                setSelectedPracticeId('');
              }}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="">Barcha oqimlar</option>
              {(courseRuns ?? []).map((run) => (
                <option key={run.id} value={run.id}>
                  {run.name}
                </option>
              ))}
            </select>
          </div>

          {mode === 'students' ? (
            <div>
              <label className="block text-xs kd-subtle mb-1">O'quvchi</label>
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="">Tanlang...</option>
                {(students ?? []).map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs kd-subtle mb-1">Amaliy mashq</label>
              <select
                value={selectedPracticeId}
                onChange={(e) => setSelectedPracticeId(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                disabled={!selectedCourseRunId}
              >
                <option value="">
                  {selectedCourseRunId ? 'Mashqni tanlang...' : 'Avval oqimni tanlang'}
                </option>
                {(practices ?? []).filter((item) => item.isActive).map((practice) => (
                  <option key={practice.id} value={practice.id}>
                    {practice.name}
                  </option>
                ))}
              </select>
            </div>
          )}

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
                disabled={!isAdmin}
                className={`px-2 py-2 rounded text-sm ${
                  dateMode === 'all' ? 'bg-white shadow-sm' : 'kd-subtle'
                } disabled:opacity-40`}
              >
                Hammasi
              </button>
            </div>
          </div>
        </div>

        <p className="text-xs kd-subtle">
          {dayLabel}
          {dateMode === 'all' ? ' · Faqat ko\'rish rejimi' : ''}
        </p>
      </div>

      {mode === 'students' ? (
        <div className="space-y-3">
          {!selectedStudentId ? (
            <div className="kd-card p-6 text-center kd-subtle text-sm">O'quvchini tanlang</div>
          ) : (
            <>
              <div className="kd-card p-4">
                <p className="text-lg font-semibold kd-title">{selectedStudent?.name ?? "O'quvchi"}</p>
                <p className="text-xs kd-subtle mt-1">
                  {exerciseData?.isClassDay ? 'Dars kuni' : 'Uy vazifasi kuni'}
                </p>
              </div>

              {exerciseData?.courseRunId && exerciseData.isClassDay && dateMode !== 'all' && (
                <div className="kd-card p-4 space-y-3">
                  <p className="text-sm font-semibold kd-title">Davomat</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <button
                      onClick={() => handleAttendance('base', true)}
                      disabled={busyAttendance === 'base'}
                      className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                    >
                      Asosiy keldi
                    </button>
                    <button
                      onClick={() => handleAttendance('base', false)}
                      disabled={busyAttendance === 'base'}
                      className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      Asosiy kelmadi
                    </button>
                  </div>

                  {exerciseData.attendanceSummary.isPremiumEligible && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <button
                        onClick={() => handleAttendance('premium_extra', true)}
                        disabled={busyAttendance === 'premium_extra'}
                        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                      >
                        Premium keldi
                      </button>
                      <button
                        onClick={() => handleAttendance('premium_extra', false)}
                        disabled={busyAttendance === 'premium_extra'}
                        className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
                      >
                        Premium kelmadi
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {visibleExercises.length === 0 ? (
                  <div className="kd-card p-6 text-center kd-subtle text-sm">
                    {dateMode === 'all'
                      ? 'Bu sana rejimida mashqlar topilmadi'
                      : "Bugungi tanlangan sana uchun bajarilmagan mashq qolmadi"}
                  </div>
                ) : (
                  visibleExercises.map((exercise) => {
                    const rowKey = keyForStudentExercise(selectedStudentId, selectedDate, exercise.id);
                    const exerciseOptions: ColorPointOption[] = (exercise.colorPoints ?? []).map((row) => ({
                      id: row.colorOptionId,
                      label: row.label,
                      colorHex: row.colorHex,
                      points: row.points,
                    }));
                    const selectedColorId =
                      selectedColorByExercise[exercise.id] || exerciseOptions[0]?.id || '';
                    const selectedColor = exerciseOptions.find((option) => option.id === selectedColorId);

                    return (
                      <div
                        key={exercise.id}
                        className={`kd-card p-4 ${vanishingStudentExerciseKeys.has(rowKey) ? 'kd-dust-out' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold kd-title">{exercise.name}</p>
                            <p className="text-xs kd-subtle mt-1">
                              Bugun: {exercise.doneToday} · Jami: {exercise.doneTotal}/{exercise.targetCount}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr,180px] gap-2">
                          <ColorPointsSelect
                            options={exerciseOptions}
                            value={selectedColorId}
                            selectedColorHex={selectedColor?.colorHex}
                            disabled={dateMode === 'all' || exerciseOptions.length === 0}
                            onChange={(nextId) =>
                              setSelectedColorByExercise((prev) => ({ ...prev, [exercise.id]: nextId }))
                            }
                          />
                          <button
                            onClick={() => void completeStudentExercise(exercise.id)}
                            disabled={
                              dateMode === 'all' ||
                              busyStudentExerciseKey === rowKey ||
                              exerciseOptions.length === 0
                            }
                            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                          >
                            {busyStudentExerciseKey === rowKey ? '...' : 'Bajarildi'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {!selectedCourseRunId ? (
            <div className="kd-card p-6 text-center kd-subtle text-sm">Avval oqimni tanlang</div>
          ) : !selectedPracticeId ? (
            <div className="kd-card p-6 text-center kd-subtle text-sm">Amaliy mashqni tanlang</div>
          ) : dateMode === 'all' ? (
            <div className="kd-card p-6 text-center kd-subtle text-sm">
              By Amaliy rejimida Hammasi faqat ko'rish uchun emas. Bugun yoki Kecha tanlang.
            </div>
          ) : (
            <>
              <div className="kd-card p-4">
                <p className="text-sm kd-subtle">Tanlangan mashq</p>
                <p className="text-lg font-semibold kd-title">{currentPractice?.name ?? 'Mashq'}</p>
                <p className="text-xs kd-subtle mt-1">
                  Qolgan o'quvchilar: {visiblePracticeStudents.length}
                </p>
              </div>

              {visiblePracticeStudents.length === 0 ? (
                <div className="kd-card p-6 text-center kd-subtle text-sm">
                  Tanlangan sana uchun barcha o'quvchilar bajarilgan.
                </div>
              ) : (
                <div className="space-y-2">
                  {visiblePracticeStudents.map((student) => {
                    const rowKey = keyForPracticeStudent(selectedPracticeId, selectedDate, student.id);
                    const practiceOptions: ColorPointOption[] = (currentPractice?.colorPoints ?? []).map((row) => ({
                      id: row.colorOptionId,
                      label: row.colorOption.label,
                      colorHex: row.colorOption.colorHex,
                      points: row.points,
                    }));
                    const selectedColorId =
                      selectedColorByPracticeStudent[student.id] || practiceOptions[0]?.id || '';
                    const selectedColor = practiceOptions.find((option) => option.id === selectedColorId);

                    return (
                      <div
                        key={student.id}
                        className={`kd-card p-4 ${vanishingPracticeStudentKeys.has(rowKey) ? 'kd-dust-out' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div>
                            <p className="text-sm font-semibold kd-title">{student.name}</p>
                            <p className="text-xs kd-subtle">{student.phone}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[1fr,180px] gap-2">
                          <ColorPointsSelect
                            options={practiceOptions}
                            value={selectedColorId}
                            selectedColorHex={selectedColor?.colorHex}
                            disabled={practiceOptions.length === 0}
                            onChange={(nextId) =>
                              setSelectedColorByPracticeStudent((prev) => ({ ...prev, [student.id]: nextId }))
                            }
                          />
                          <button
                            onClick={() => void completePracticeStudent(student.id)}
                            disabled={busyPracticeStudentKey === rowKey || practiceOptions.length === 0}
                            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                          >
                            {busyPracticeStudentKey === rowKey ? '...' : 'Bajarildi'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ColorPointsSelect({
  options,
  value,
  selectedColorHex,
  disabled,
  onChange,
}: {
  options: Array<{
    id: string;
    label: string;
    colorHex: string;
    points: number;
  }>;
  value: string;
  selectedColorHex?: string;
  disabled?: boolean;
  onChange: (nextId: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block w-4 h-4 rounded-full border border-gray-300 shrink-0"
        style={{ backgroundColor: selectedColorHex || '#D1D5DB' }}
      />
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg text-sm disabled:opacity-50"
      >
        {options.length === 0 ? (
          <option value="">Ranglar yo'q</option>
        ) : (
          options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} ({option.points} ball)
            </option>
          ))
        )}
      </select>
    </div>
  );
}
