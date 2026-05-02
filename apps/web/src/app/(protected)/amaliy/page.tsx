'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/components/ui/toast';

type DateMode = 'today' | 'yesterday' | 'custom' | 'all';
type AmaliyMode = 'students' | 'practice';
type ColorPointOption = {
  id: string;
  label: string;
  colorHex: string;
  points: number;
};
type SlotItem = {
  date: string;
  selectedColorOptionId: string | null;
  selectedColorHex: string | null;
  selectedPoints: number | null;
  isSaved: boolean;
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

function keyForExerciseSlot(exerciseId: string, date: string): string {
  return `${exerciseId}:${date}`;
}

function keyForPracticeStudentSlot(studentId: string, date: string): string {
  return `${studentId}:${date}`;
}

function formatShortDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const day = String(parsed.getDate()).padStart(2, '0');
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

export default function AmaliyPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const canUseHammasi = isManager;

  const [mode, setMode] = useState<AmaliyMode>('students');
  const [dateMode, setDateMode] = useState<DateMode>('today');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [customDate, setCustomDate] = useState<string>(formatDateLocal(new Date()));
  const [hammasiDate, setHammasiDate] = useState<string>(formatDateLocal(new Date()));

  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [selectedPracticeId, setSelectedPracticeId] = useState<string>('');

  const [selectedColorByExercise, setSelectedColorByExercise] = useState<Record<string, string>>({});
  const [selectedColorByPracticeStudent, setSelectedColorByPracticeStudent] = useState<Record<string, string>>({});
  const [selectedColorByExerciseSlot, setSelectedColorByExerciseSlot] = useState<Record<string, string>>({});
  const [selectedColorByPracticeStudentSlot, setSelectedColorByPracticeStudentSlot] = useState<Record<string, string>>({});

  const [busyStudentExerciseKey, setBusyStudentExerciseKey] = useState<string | null>(null);
  const [busyPracticeStudentKey, setBusyPracticeStudentKey] = useState<string | null>(null);
  const [busyAttendance, setBusyAttendance] = useState<'base' | 'premium_extra' | null>(null);
  const [busySlotSaveKey, setBusySlotSaveKey] = useState<string | null>(null);

  const [hiddenStudentExerciseKeys, setHiddenStudentExerciseKeys] = useState<Set<string>>(new Set());
  const [vanishingStudentExerciseKeys, setVanishingStudentExerciseKeys] = useState<Set<string>>(new Set());
  const [hiddenPracticeStudentKeys, setHiddenPracticeStudentKeys] = useState<Set<string>>(new Set());
  const [vanishingPracticeStudentKeys, setVanishingPracticeStudentKeys] = useState<Set<string>>(new Set());

  const selectedDate = useMemo(() => {
    if (dateMode === 'all') return hammasiDate || getModeDate('today');
    if (dateMode === 'custom') return customDate;
    return getModeDate(dateMode);
  }, [customDate, dateMode, hammasiDate]);

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
    { enabled: Boolean(selectedStudentId) && (dateMode !== 'all' || Boolean(selectedCourseRunId)) },
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
      includeCompleted: dateMode === 'all',
    },
    { enabled: Boolean(selectedPracticeId) && (dateMode !== 'all' || Boolean(selectedCourseRunId)) },
  );

  const logMutation = trpc.amaliy.logExercise.useMutation({
    onError: (error) => {
      toast.show(error.message || 'Xatolik yuz berdi', 'error');
      setBusyStudentExerciseKey(null);
      setBusyPracticeStudentKey(null);
    },
  });
  const saveSlotsMutation = trpc.amaliy.saveExerciseSlots.useMutation({
    onError: (error) => {
      toast.show(error.message || 'Xatolik yuz berdi', 'error');
      setBusySlotSaveKey(null);
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
    if (!selectedStudentId) return;
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

      toast.show('Saqlandi', 'success');
      if (dateMode === 'all') {
        void refetchStudentExercises();
      } else {
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
      }
    } finally {
      setBusyStudentExerciseKey(null);
    }
  };

  const completePracticeStudent = async (studentId: string) => {
    if (!selectedPracticeId) return;
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

      toast.show('Saqlandi', 'success');
      if (dateMode === 'all') {
        void refetchPracticeStudents();
      } else {
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
      }
    } finally {
      setBusyPracticeStudentKey(null);
    }
  };

  const saveStudentExerciseSlots = async (exercise: (NonNullable<typeof exerciseData>['exercises'])[number]) => {
    if (!selectedStudentId || !selectedCourseRunId) return;
    const slotKey = `student:${selectedStudentId}:${exercise.id}`;
    setBusySlotSaveKey(slotKey);
    try {
      const payload = (exercise.slots ?? []).map((slot: SlotItem) => {
        const key = keyForExerciseSlot(exercise.id, slot.date);
        const next = selectedColorByExerciseSlot[key];
        const selectedColorOptionId =
          next !== undefined
            ? (next || null)
            : (slot.selectedColorOptionId ?? null);
        return {
          date: slot.date,
          colorOptionId: selectedColorOptionId,
        };
      });

      await saveSlotsMutation.mutateAsync({
        customerId: selectedStudentId,
        exerciseDefinitionId: exercise.id,
        courseRunId: selectedCourseRunId,
        slots: payload,
      });
      toast.show('Saqlandi', 'success');
      void refetchStudentExercises();
      void refetchRecentLogs();
    } finally {
      setBusySlotSaveKey(null);
    }
  };

  const savePracticeStudentSlots = async (studentId: string, slots: SlotItem[]) => {
    if (!selectedPracticeId || !selectedCourseRunId) return;
    const slotKey = `practice:${selectedPracticeId}:${studentId}`;
    setBusySlotSaveKey(slotKey);
    try {
      const payload = slots.map((slot) => {
        const key = keyForPracticeStudentSlot(studentId, slot.date);
        const next = selectedColorByPracticeStudentSlot[key];
        const selectedColorOptionId =
          next !== undefined
            ? (next || null)
            : (slot.selectedColorOptionId ?? null);
        return {
          date: slot.date,
          colorOptionId: selectedColorOptionId,
        };
      });

      await saveSlotsMutation.mutateAsync({
        customerId: studentId,
        exerciseDefinitionId: selectedPracticeId,
        courseRunId: selectedCourseRunId,
        slots: payload,
      });
      toast.show('Saqlandi', 'success');
      void refetchPracticeStudents();
    } finally {
      setBusySlotSaveKey(null);
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
            <div className="grid grid-cols-4 gap-1 rounded-md p-1" style={{ background: 'var(--kd-surface-soft)' }}>
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
                disabled={!canUseHammasi}
                className={`px-2 py-2 rounded text-sm ${
                  dateMode === 'all' ? 'bg-white shadow-sm' : 'kd-subtle'
                } disabled:opacity-40`}
              >
                Hammasi
              </button>
              <button
                onClick={() => setDateMode('custom')}
                disabled={!canUseHammasi}
                className={`px-2 py-2 rounded text-sm ${
                  dateMode === 'custom' ? 'bg-white shadow-sm' : 'kd-subtle'
                } disabled:opacity-40`}
              >
                Sana
              </button>
            </div>
            {canUseHammasi && (
              <div className="mt-2">
                <input
                  type="date"
                  value={dateMode === 'all' ? hammasiDate : customDate}
                  onChange={(e) => {
                    if (dateMode === 'all') {
                      setHammasiDate(e.target.value);
                    } else {
                      setCustomDate(e.target.value);
                      setDateMode('custom');
                    }
                  }}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
            )}
          </div>
        </div>

        <p className="text-xs kd-subtle">{dayLabel}</p>
      </div>

      {mode === 'students' ? (
        <div className="space-y-3">
          {dateMode === 'all' && !selectedCourseRunId ? (
            <div className="kd-card p-6 text-center kd-subtle text-sm">Hammasi uchun avval oqimni tanlang</div>
          ) : !selectedStudentId ? (
            <div className="kd-card p-6 text-center kd-subtle text-sm">O'quvchini tanlang</div>
          ) : (
            <>
              <div className="kd-card p-4">
                <p className="text-lg font-semibold kd-title">{selectedStudent?.name ?? "O'quvchi"}</p>
                <p className="text-xs kd-subtle mt-1">
                  {dateMode === 'all'
                    ? "Butun kurs mashqlari"
                    : exerciseData?.isClassDay
                      ? 'Dars kuni'
                      : 'Uy vazifasi kuni'}
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
                              Tanlangan sana: {exercise.doneToday} · Jami: {exercise.doneTotal}/{exercise.targetCount}
                            </p>
                          </div>
                        </div>

                        {dateMode === 'all' ? (
                          <div className="mt-3 space-y-3">
                            {exercise.hasInsufficientEligibleDates && (
                              <p className="text-xs text-amber-700">
                                Oqim sanalarida mashq turi bo&apos;yicha kunlar yetarli emas.
                              </p>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                              {(exercise.slots ?? []).map((slot: SlotItem) => {
                                const slotKey = keyForExerciseSlot(exercise.id, slot.date);
                                const slotSelectedColorId =
                                  selectedColorByExerciseSlot[slotKey] !== undefined
                                    ? selectedColorByExerciseSlot[slotKey]
                                    : (slot.selectedColorOptionId ?? '');
                                const slotSelectedColor = exerciseOptions.find((option) => option.id === slotSelectedColorId);
                                return (
                                  <div key={slot.date} className="rounded-lg border border-gray-200 p-2">
                                    <p className="text-[11px] kd-subtle mb-1">{formatShortDate(slot.date)}</p>
                                    <ColorPointsSelect
                                      options={exerciseOptions}
                                      value={slotSelectedColorId}
                                      selectedColorHex={slotSelectedColor?.colorHex ?? slot.selectedColorHex ?? undefined}
                                      allowEmpty
                                      emptyLabel="Tanlanmagan"
                                      disabled={exerciseOptions.length === 0}
                                      onChange={(nextId) =>
                                        setSelectedColorByExerciseSlot((prev) => ({ ...prev, [slotKey]: nextId }))
                                      }
                                    />
                                  </div>
                                );
                              })}
                            </div>
                            <button
                              onClick={() => void saveStudentExerciseSlots(exercise)}
                              disabled={busySlotSaveKey === `student:${selectedStudentId}:${exercise.id}` || exerciseOptions.length === 0}
                              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                            >
                              {busySlotSaveKey === `student:${selectedStudentId}:${exercise.id}` ? '...' : 'Saqlash'}
                            </button>
                          </div>
                        ) : (
                          <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr,180px] gap-2">
                            <ColorPointsSelect
                              options={exerciseOptions}
                              value={selectedColorId}
                              selectedColorHex={selectedColor?.colorHex}
                              disabled={exerciseOptions.length === 0}
                              onChange={(nextId) =>
                                setSelectedColorByExercise((prev) => ({ ...prev, [exercise.id]: nextId }))
                              }
                            />
                            <button
                              onClick={() => void completeStudentExercise(exercise.id)}
                              disabled={
                                busyStudentExerciseKey === rowKey ||
                                exerciseOptions.length === 0
                              }
                              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                            >
                              {busyStudentExerciseKey === rowKey ? '...' : 'Saqlash'}
                            </button>
                          </div>
                        )}
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
          {dateMode === 'all' && !selectedCourseRunId ? (
            <div className="kd-card p-6 text-center kd-subtle text-sm">Hammasi uchun avval oqimni tanlang</div>
          ) : !selectedCourseRunId ? (
            <div className="kd-card p-6 text-center kd-subtle text-sm">Avval oqimni tanlang</div>
          ) : !selectedPracticeId ? (
            <div className="kd-card p-6 text-center kd-subtle text-sm">Amaliy mashqni tanlang</div>
          ) : (
            <>
              <div className="kd-card p-4">
                <p className="text-sm kd-subtle">Tanlangan mashq</p>
                <p className="text-lg font-semibold kd-title">{currentPractice?.name ?? 'Mashq'}</p>
                <p className="text-xs kd-subtle mt-1">
                  {dateMode === 'all' ? "O'quvchilar" : "Qolgan o'quvchilar"}: {visiblePracticeStudents.length}
                </p>
                {dateMode === 'all' && (practiceStudents ?? [])[0]?.hasInsufficientEligibleDates && (
                  <p className="text-xs text-amber-700 mt-2">
                    Oqim sanalarida mashq turi bo&apos;yicha kunlar yetarli emas.
                  </p>
                )}
              </div>

              {visiblePracticeStudents.length === 0 ? (
                <div className="kd-card p-6 text-center kd-subtle text-sm">
                  {dateMode === 'all'
                    ? "Bu mashq uchun o'quvchilar topilmadi."
                    : "Tanlangan sana uchun barcha o'quvchilar bajarilgan."}
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
                            <p className="text-xs kd-subtle">{student.customerNumber}</p>
                          </div>
                          {dateMode === 'all' && (
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                student.completedForDate
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {student.completedForDate ? 'Bajarilgan' : 'Bajarilmagan'}
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[1fr,180px] gap-2">
                          {dateMode === 'all' ? (
                            <div className="col-span-full space-y-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                {(student.slots ?? []).map((slot: SlotItem) => {
                                  const slotKey = keyForPracticeStudentSlot(student.id, slot.date);
                                  const slotSelectedColorId =
                                    selectedColorByPracticeStudentSlot[slotKey] !== undefined
                                      ? selectedColorByPracticeStudentSlot[slotKey]
                                      : (slot.selectedColorOptionId ?? '');
                                  const slotSelectedColor = practiceOptions.find((option) => option.id === slotSelectedColorId);
                                  return (
                                    <div key={slot.date} className="rounded-lg border border-gray-200 p-2">
                                      <p className="text-[11px] kd-subtle mb-1">{formatShortDate(slot.date)}</p>
                                      <ColorPointsSelect
                                        options={practiceOptions}
                                        value={slotSelectedColorId}
                                        selectedColorHex={slotSelectedColor?.colorHex ?? slot.selectedColorHex ?? undefined}
                                        allowEmpty
                                        emptyLabel="Tanlanmagan"
                                        disabled={practiceOptions.length === 0}
                                        onChange={(nextId) =>
                                          setSelectedColorByPracticeStudentSlot((prev) => ({ ...prev, [slotKey]: nextId }))
                                        }
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                              <button
                                onClick={() => void savePracticeStudentSlots(student.id, (student.slots ?? []) as SlotItem[])}
                                disabled={busySlotSaveKey === `practice:${selectedPracticeId}:${student.id}` || practiceOptions.length === 0}
                                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                              >
                                {busySlotSaveKey === `practice:${selectedPracticeId}:${student.id}` ? '...' : 'Saqlash'}
                              </button>
                            </div>
                          ) : (
                            <>
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
                                {busyPracticeStudentKey === rowKey ? '...' : 'Saqlash'}
                              </button>
                            </>
                          )}
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
  allowEmpty,
  emptyLabel,
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
  allowEmpty?: boolean;
  emptyLabel?: string;
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
          <>
            {allowEmpty && <option value="">{emptyLabel || 'Tanlanmagan'}</option>}
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} ({option.points} ball)
              </option>
            ))}
          </>
        )}
      </select>
    </div>
  );
}
