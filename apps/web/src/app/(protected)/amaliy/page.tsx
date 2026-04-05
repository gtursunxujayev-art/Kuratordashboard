'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type DateMode = 'today' | 'yesterday' | 'all';

const DAY_NAMES = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0] ?? '';
}

function getModeDate(mode: DateMode): string {
  const today = new Date();
  if (mode === 'today') return formatDate(today);
  if (mode === 'yesterday') {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    return formatDate(y);
  }
  return formatDate(today); // 'all' uses today's date for class detection
}

export default function AmaliyPage() {
  const { isAdmin } = useAuth();
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [dateMode, setDateMode] = useState<DateMode>('today');
  const [loggingExerciseId, setLoggingExerciseId] = useState<string | null>(null);

  const { data: courseRuns } = trpc.dashboard.courseRuns.useQuery();

  const { data: students } = trpc.amaliy.studentList.useQuery({
    courseRunId: selectedCourseRunId || undefined,
  });

  const selectedDate = getModeDate(dateMode === 'all' ? 'today' : dateMode);

  const { data: exerciseData, refetch: refetchExercises } = trpc.amaliy.getStudentExercises.useQuery(
    {
      customerId: selectedStudentId ?? '',
      date: selectedDate,
      courseRunId: selectedCourseRunId || undefined,
    },
    { enabled: !!selectedStudentId },
  );

  const logMutation = trpc.amaliy.logExercise.useMutation({
    onSuccess: () => {
      setLoggingExerciseId(null);
      void refetchExercises();
    },
  });

  const attendanceMutation = trpc.amaliy.markAttendance.useMutation({
    onSuccess: () => void refetchExercises(),
  });

  const handleLogExercise = (exerciseDefinitionId: string) => {
    if (!selectedStudentId) return;
    setLoggingExerciseId(exerciseDefinitionId);
    logMutation.mutate({
      customerId: selectedStudentId,
      exerciseDefinitionId,
      completedAt: selectedDate,
    });
  };

  const selectedStudent = students?.find((s) => s.id === selectedStudentId);

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Amaliy</h1>

      {/* Course run filter */}
      {courseRuns && courseRuns.length > 0 && (
        <div className="mb-4">
          <select
            value={selectedCourseRunId}
            onChange={(e) => setSelectedCourseRunId(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
          >
            <option value="">Barcha oqimlar</option>
            {courseRuns.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-4">
        {/* Student list */}
        <div className="w-64 shrink-0">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">O&apos;quvchilar</p>
            </div>
            <div className="divide-y divide-gray-100 max-h-[calc(100vh-280px)] overflow-y-auto">
              {!students || students.length === 0 ? (
                <div className="p-4 text-center text-gray-400 text-sm">Bo&apos;sh</div>
              ) : (
                students.map((student) => (
                  <button
                    key={student.id}
                    onClick={() => setSelectedStudentId(student.id)}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                      selectedStudentId === student.id
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium">{student.name}</div>
                    {student.phone && (
                      <div className="text-xs text-gray-400 mt-0.5">{student.phone}</div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Exercise panel */}
        <div className="flex-1">
          {!selectedStudentId ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <p className="text-gray-400 text-sm">O&apos;quvchini tanlang</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200">
              {/* Header */}
              <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="font-semibold text-gray-900">{selectedStudent?.name}</h2>
                  {exerciseData && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {exerciseData.isClassDay
                        ? `Dars kuni — ${DAY_NAMES[new Date(selectedDate).getDay()]} (Dars mashqlari)`
                        : `${DAY_NAMES[new Date(selectedDate).getDay()]} (Uy vazifalari)`}
                    </p>
                  )}
                </div>

                {/* Date filter */}
                <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
                  {(['today', 'yesterday'] as DateMode[]).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setDateMode(mode)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        dateMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {mode === 'today' ? 'Bugun' : 'Kecha'}
                    </button>
                  ))}
                  {isAdmin && (
                    <button
                      onClick={() => setDateMode('all')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                        dateMode === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      Hammasi
                    </button>
                  )}
                </div>
              </div>

              {/* Exercises */}
              <div className="p-4">
                {!exerciseData ? (
                  <div className="text-center text-gray-400 text-sm py-6">Yuklanmoqda...</div>
                ) : exerciseData.exercises.length === 0 ? (
                  <div className="text-center text-gray-400 text-sm py-6">
                    {exerciseData.courseRunId
                      ? 'Bu kun uchun mashqlar topilmadi'
                      : "Faol oqim yo'q"}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Attendance for class days */}
                    {exerciseData.isClassDay && exerciseData.courseRunId && (
                      <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-100">
                        <div>
                          <p className="text-sm font-medium text-blue-800">Davomat</p>
                          <p className="text-xs text-blue-500 mt-0.5">Bu dars kuni</p>
                        </div>
                        <button
                          onClick={() =>
                            attendanceMutation.mutate({
                              customerId: selectedStudentId,
                              courseRunId: exerciseData.courseRunId!,
                              lessonDate: selectedDate,
                              attended: true,
                            })
                          }
                          disabled={attendanceMutation.isLoading}
                          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          Keldi ✓
                        </button>
                      </div>
                    )}

                    {exerciseData.exercises.map((ex) => (
                      <div
                        key={ex.id}
                        className="flex items-center justify-between p-3 border border-gray-100 rounded-lg"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900">{ex.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            Bugun: {ex.doneToday} | Jami: {ex.doneTotal}/{ex.targetCount}
                          </p>
                        </div>
                        <button
                          onClick={() => handleLogExercise(ex.id)}
                          disabled={logMutation.isLoading && loggingExerciseId === ex.id}
                          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                            ex.doneTotal >= ex.targetCount
                              ? 'bg-green-50 text-green-600 border border-green-200'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          } disabled:opacity-50`}
                        >
                          {logMutation.isLoading && loggingExerciseId === ex.id
                            ? '...'
                            : ex.doneTotal >= ex.targetCount
                            ? 'Bajarildi ✓'
                            : "Qo'shish +"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
