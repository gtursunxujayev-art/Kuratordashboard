'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';

type Tab = 'templates' | 'courseRuns' | 'exercises' | 'regions' | 'users' | 'assignments';

export default function SettingsPage() {
  const { isAdmin, isLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('templates');
  const [selectedExerciseCourseId, setSelectedExerciseCourseId] = useState('');
  const [selectedCourseRunIdInTab, setSelectedCourseRunIdInTab] = useState('');

  if (!isLoading && !isAdmin) {
    router.replace('/dashboard');
    return null;
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Sozlamalar</h1>

      <div className="flex gap-1 mb-6 kd-topbar rounded-lg p-1 w-fit flex-wrap">
        {([
          { key: 'templates', label: 'Jadval shablonlari' },
          { key: 'courseRuns', label: 'Kurs oqimlari' },
          { key: 'exercises', label: 'Mashqlar' },
          { key: 'regions', label: 'Viloyatlar' },
          { key: 'users', label: 'Foydalanuvchilar' },
          { key: 'assignments', label: "Kurator bog'lash" },
        ] as { key: Tab; label: string }[]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-white/90 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'templates' && <ScheduleTemplatesTab />}
      {activeTab === 'courseRuns' && (
        <CourseRunsTab
          selectedRunId={selectedCourseRunIdInTab}
          onSelectRun={setSelectedCourseRunIdInTab}
        />
      )}
      {activeTab === 'exercises' && (
        <ExercisesTab courseId={selectedExerciseCourseId} onSelectCourse={setSelectedExerciseCourseId} />
      )}
      {activeTab === 'regions' && <RegionsTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'assignments' && <AssignmentsTab />}
    </div>
  );
}

function ScheduleTemplatesTab() {
  const utils = trpc.useContext();
  const [form, setForm] = useState({
    courseCategory: 'offline',
    durationWeeks: 6,
    baseLessons: 12,
    premiumExtraLessons: 2,
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const { data, isLoading, error: queryError, refetch } = trpc.settings.listScheduleTemplates.useQuery();
  const upsertMutation = trpc.settings.upsertScheduleTemplate.useMutation({
    onSuccess: () => {
      void utils.settings.listScheduleTemplates.invalidate();
      void refetch();
      setEditingTemplateId(null);
      setError('');
      setSuccess("Jadval shabloni muvaffaqiyatli saqlandi.");
    },
    onError: (err) => {
      setSuccess('');
      setError(err.message);
    },
  });

  const handleSave = () => {
    setSuccess('');
    upsertMutation.mutate({
      id: editingTemplateId ?? undefined,
      ...form,
    });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Kurs turi bo'yicha jadval shablonlari</h2>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Kurs turi</label>
            <input
              value={form.courseCategory}
              onChange={(e) => setForm({ ...form, courseCategory: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="offline"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Davomiylik (hafta)</label>
            <input
              type="number"
              min={1}
              max={52}
              value={form.durationWeeks}
              onChange={(e) => setForm({ ...form, durationWeeks: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Asosiy darslar</label>
            <input
              type="number"
              min={1}
              max={200}
              value={form.baseLessons}
              onChange={(e) => setForm({ ...form, baseLessons: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Premium/VIP qo'shimcha</label>
            <input
              type="number"
              min={0}
              max={50}
              value={form.premiumExtraLessons}
              onChange={(e) => setForm({ ...form, premiumExtraLessons: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {queryError && <p className="text-sm text-red-600">{queryError.message}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}
        {editingTemplateId && (
          <p className="text-sm text-blue-700">
            Tahrirlanmoqda: <span className="font-semibold">{form.courseCategory}</span>
          </p>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={upsertMutation.isLoading || !form.courseCategory.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {upsertMutation.isLoading ? 'Saqlanmoqda...' : editingTemplateId ? 'Yangilash' : 'Saqlash'}
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Yuklanmoqda...</div>
      ) : !data || data.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Shablonlar topilmadi
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Kurs turi</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Hafta</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Asosiy</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Premium/VIP</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 text-gray-900">{item.courseCategory}</td>
                  <td className="px-4 py-3 text-gray-700">{item.durationWeeks}</td>
                  <td className="px-4 py-3 text-gray-700">{item.baseLessons}</td>
                  <td className="px-4 py-3 text-gray-700">{item.premiumExtraLessons}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setForm({
                          courseCategory: item.courseCategory,
                          durationWeeks: item.durationWeeks,
                          baseLessons: item.baseLessons,
                          premiumExtraLessons: item.premiumExtraLessons,
                        });
                        setEditingTemplateId(item.id);
                        setError('');
                        setSuccess(`Tahrirlash uchun yuklandi: ${item.courseCategory}`);
                      }}
                      className="text-blue-600 text-xs hover:underline"
                    >
                      Tahrirlash
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CourseRunsTab({
  selectedRunId,
  onSelectRun,
}: {
  selectedRunId: string;
  onSelectRun: (id: string) => void;
}) {
  const utils = trpc.useContext();
  const [showForm, setShowForm] = useState(false);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const [form, setForm] = useState({
    courseId: '',
    name: '',
    durationWeeks: 6,
    baseLessons: 12,
    premiumExtraLessons: 2,
  });
  const [error, setError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState('');
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);

  const { data: courseRuns, isLoading } = trpc.settings.listCourseRuns.useQuery();
  const { data: courses } = trpc.settings.listCourses.useQuery();

  const isEditing = editingRunId !== null;

  const createMutation = trpc.settings.createCourseRun.useMutation();
  const updateMutation = trpc.settings.updateCourseRun.useMutation();
  const deleteCourseRunMutation = trpc.settings.deleteCourseRun.useMutation();

  const resetForm = () => {
    setForm({
      courseId: '',
      name: '',
      durationWeeks: 6,
      baseLessons: 12,
      premiumExtraLessons: 2,
    });
  };

  const openCreate = () => {
    setEditingRunId(null);
    resetForm();
    setError('');
    setCreateSuccess('');
    setShowForm(true);
  };

  const openEdit = (run: {
    id: string;
    courseId: string;
    name: string;
    durationWeeks: number;
    baseLessons: number;
    premiumExtraLessons: number;
  }) => {
    setEditingRunId(run.id);
    setForm({
      courseId: run.courseId,
      name: run.name,
      durationWeeks: run.durationWeeks,
      baseLessons: run.baseLessons,
      premiumExtraLessons: run.premiumExtraLessons,
    });
    setError('');
    setCreateSuccess('');
    setShowForm(true);
    onSelectRun(run.id);
  };

  const handleSave = async () => {
    if (!form.name) {
      setError("Oqim nomini kiriting");
      setCreateSuccess('');
      return;
    }
    if (!isEditing && !form.courseId) {
      setError("Kursni tanlang");
      setCreateSuccess('');
      return;
    }

    try {
      setError('');
      setCreateSuccess('');

      if (isEditing && editingRunId) {
        await updateMutation.mutateAsync({
          courseRunId: editingRunId,
          name: form.name,
          durationWeeks: form.durationWeeks,
          baseLessons: form.baseLessons,
          premiumExtraLessons: form.premiumExtraLessons,
        });
        await utils.settings.listCourseRuns.invalidate();
        setCreateSuccess('Oqim yangilandi.');
        setShowForm(false);
        setEditingRunId(null);
        resetForm();
      } else {
        const createdRun = await createMutation.mutateAsync({
          courseId: form.courseId,
          name: form.name,
          durationWeeks: form.durationWeeks,
          baseLessons: form.baseLessons,
          premiumExtraLessons: form.premiumExtraLessons,
        });
        await utils.settings.listCourseRuns.invalidate();
        onSelectRun(createdRun.id);
        setShowForm(false);
        setCreateSuccess("Oqim yaratildi. Kuratorga biriktirish uchun Kurator bog'lash tabiga o'ting.");
        resetForm();
      }
    } catch (err: any) {
      setCreateSuccess('');
      setError(err?.message ?? 'Saqlashda xatolik yuz berdi');
    }
  };

  const handleDeleteCourseRun = async (runId: string, runName: string) => {
    const confirmed = window.confirm(`"${runName}" oqimini o'chirmoqchimisiz?`);
    if (!confirmed) {
      return;
    }

    setDeleteError('');
    setDeleteSuccess('');
    setDeletingRunId(runId);

    try {
      await deleteCourseRunMutation.mutateAsync({ courseRunId: runId });
      await utils.settings.listCourseRuns.invalidate();

      if (selectedRunId === runId) {
        onSelectRun('');
      }
      if (editingRunId === runId) {
        setEditingRunId(null);
        setShowForm(false);
        resetForm();
      }

      setDeleteSuccess('Oqim muvaffaqiyatli o\'chirildi.');
    } catch (err: any) {
      setDeleteError(err?.message ?? "Oqimni o'chirishda xatolik yuz berdi");
    } finally {
      setDeletingRunId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Kurs oqimlari</h2>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          + Yangi oqim
        </button>
      </div>

      {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
      {deleteSuccess && <p className="text-sm text-green-600">{deleteSuccess}</p>}

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-900">
            {isEditing ? 'Oqimni tahrirlash' : 'Yangi oqim yaratish'}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Kurs</label>
              <select
                value={form.courseId}
                onChange={(e) => setForm({ ...form, courseId: e.target.value })}
                disabled={isEditing}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100 disabled:text-gray-500"
              >
                <option value="">Tanlang...</option>
                {courses?.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Oqim nomi</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Aprel 2026 oqimi"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Davomiylik (hafta)</label>
              <input
                type="number"
                min={1}
                max={52}
                value={form.durationWeeks}
                onChange={(e) => setForm({ ...form, durationWeeks: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Asosiy darslar</label>
              <input
                type="number"
                min={1}
                max={200}
                value={form.baseLessons}
                onChange={(e) => setForm({ ...form, baseLessons: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Premium/VIP qo'shimcha</label>
              <input
                type="number"
                min={0}
                max={50}
                value={form.premiumExtraLessons}
                onChange={(e) => setForm({ ...form, premiumExtraLessons: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Boshlanish sanasi kursning `start date` qiymatidan avtomatik olinadi.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {createSuccess && <p className="text-sm text-green-600">{createSuccess}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={createMutation.isLoading || updateMutation.isLoading}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isEditing
                ? updateMutation.isLoading
                  ? 'Saqlanmoqda...'
                  : 'Saqlash'
                : createMutation.isLoading
                ? 'Yaratilmoqda...'
                : 'Yaratish'}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setEditingRunId(null);
                setError('');
              }}
              className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50"
            >
              Bekor qilish
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-gray-500 text-sm">Yuklanmoqda...</div>
      ) : !courseRuns || courseRuns.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Oqimlar topilmadi
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Nomi</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Kurs</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Boshlanish</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tugash</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Hafta</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Asosiy</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Premium/VIP</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {courseRuns.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{run.name}</td>
                  <td className="px-4 py-3 text-gray-600">{run.course.name}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(run.startDate).toLocaleDateString('uz-UZ')}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(run.endDate).toLocaleDateString('uz-UZ')}</td>
                  <td className="px-4 py-3 text-gray-600">{run.durationWeeks}</td>
                  <td className="px-4 py-3 text-gray-600">{run.baseLessons}</td>
                  <td className="px-4 py-3 text-gray-600">{run.premiumExtraLessons}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          openEdit({
                            id: run.id,
                            courseId: run.courseId,
                            name: run.name,
                            durationWeeks: run.durationWeeks,
                            baseLessons: run.baseLessons,
                            premiumExtraLessons: run.premiumExtraLessons,
                          })
                        }
                        className="text-blue-600 text-xs hover:underline"
                      >
                        {editingRunId === run.id ? 'Tahrirlanmoqda' : 'Tahrirlash'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteCourseRun(run.id, run.name)}
                        disabled={deleteCourseRunMutation.isLoading && deletingRunId === run.id}
                        className="text-red-600 text-xs hover:underline disabled:opacity-50"
                      >
                        {deleteCourseRunMutation.isLoading && deletingRunId === run.id
                          ? "O'chirilmoqda..."
                          : "O'chirish"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExercisesTab({
  courseId,
  onSelectCourse,
}: {
  courseId: string;
  onSelectCourse: (id: string) => void;
}) {
  type ExerciseColorOption = {
    id: string;
    label: string;
    colorHex: string;
    orderIndex: number;
    isActive: boolean;
  };

  const utils = trpc.useContext();
  const [showForm, setShowForm] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    type: 'class' as 'class' | 'homework',
    targetCount: 1,
    orderIndex: 0,
  });
  const [exerciseColorPoints, setExerciseColorPoints] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [colorError, setColorError] = useState('');
  const [colorSuccess, setColorSuccess] = useState('');
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [colorForm, setColorForm] = useState({
    label: '',
    colorHex: '#22C55E',
    orderIndex: 0,
    isActive: true,
  });

  const { data: courses } = trpc.settings.listCourses.useQuery();
  const { data: exercises, isLoading } = trpc.settings.listExerciseDefinitions.useQuery(
    { courseId },
    { enabled: !!courseId },
  );
  const { data: colorOptions, isLoading: colorOptionsLoading } = trpc.settings.listExerciseColorOptions.useQuery();

  const activeColorOptions = useMemo(
    () => ((colorOptions ?? []) as ExerciseColorOption[])
      .filter((option) => option.isActive)
      .sort((left, right) => left.orderIndex - right.orderIndex),
    [colorOptions],
  );

  useEffect(() => {
    setExerciseColorPoints((prev) => {
      const next: Record<string, number> = {};
      for (const option of activeColorOptions) {
        next[option.id] = prev[option.id] ?? 0;
      }
      return next;
    });
  }, [activeColorOptions]);

  const createMutation = trpc.settings.addExerciseDefinition.useMutation({
    onSuccess: async () => {
      await utils.settings.listExerciseDefinitions.invalidate();
      setShowForm(false);
      setEditingExerciseId(null);
      setForm({ name: '', type: 'class', targetCount: 1, orderIndex: 0 });
      setError('');
    },
    onError: (err) => setError(err.message),
  });

  const updateMutation = trpc.settings.updateExerciseDefinition.useMutation({
    onSuccess: async () => {
      await utils.settings.listExerciseDefinitions.invalidate();
      setShowForm(false);
      setEditingExerciseId(null);
      setForm({ name: '', type: 'class', targetCount: 1, orderIndex: 0 });
      setError('');
    },
    onError: (err) => setError(err.message),
  });

  const upsertColorMutation = trpc.settings.upsertExerciseColorOption.useMutation({
    onSuccess: async () => {
      await utils.settings.listExerciseColorOptions.invalidate();
      await utils.settings.listExerciseDefinitions.invalidate();
      setEditingColorId(null);
      setColorForm({
        label: '',
        colorHex: '#22C55E',
        orderIndex: 0,
        isActive: true,
      });
      setColorError('');
      setColorSuccess("Rang sozlamasi saqlandi");
    },
    onError: (err) => {
      setColorSuccess('');
      setColorError(err.message);
    },
  });

  const setColorActiveMutation = trpc.settings.setExerciseColorOptionActive.useMutation({
    onSuccess: async () => {
      await utils.settings.listExerciseColorOptions.invalidate();
      await utils.settings.listExerciseDefinitions.invalidate();
    },
  });

  const openCreateForm = () => {
    const nextPoints: Record<string, number> = {};
    for (const option of activeColorOptions) {
      nextPoints[option.id] = 0;
    }
    setEditingExerciseId(null);
    setForm({ name: '', type: 'class', targetCount: 1, orderIndex: 0 });
    setExerciseColorPoints(nextPoints);
    setError('');
    setShowForm(true);
  };

  const openEditForm = (exercise: any) => {
    const nextPoints: Record<string, number> = {};
    for (const option of activeColorOptions) {
      const found = exercise.colorPoints.find((row: any) => row.colorOptionId === option.id);
      nextPoints[option.id] = found?.points ?? 0;
    }

    setEditingExerciseId(exercise.id);
    setForm({
      name: exercise.name,
      type: exercise.type,
      targetCount: exercise.targetCount,
      orderIndex: exercise.orderIndex,
    });
    setExerciseColorPoints(nextPoints);
    setError('');
    setShowForm(true);
  };

  const handleSaveExercise = () => {
    if (!courseId) {
      setError('Avval kursni tanlang');
      return;
    }
    if (!form.name.trim()) {
      setError('Mashq nomini kiriting');
      return;
    }
    if (activeColorOptions.length === 0) {
      setError("Avval kamida bitta faol rang qo'shing");
      return;
    }

    const colorPointsPayload = activeColorOptions.map((option) => ({
      colorOptionId: option.id,
      points: Math.max(0, Number(exerciseColorPoints[option.id] ?? 0)),
    }));

    if (editingExerciseId) {
      updateMutation.mutate({
        id: editingExerciseId,
        name: form.name,
        type: form.type,
        targetCount: form.targetCount,
        orderIndex: form.orderIndex,
        colorPoints: colorPointsPayload,
      });
      return;
    }

    createMutation.mutate({
      courseId,
      name: form.name,
      type: form.type,
      targetCount: form.targetCount,
      orderIndex: form.orderIndex,
      colorPoints: colorPointsPayload,
    });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Amaliy mashqlar</h2>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Amaliy ranglari</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Nomi</label>
            <input
              value={colorForm.label}
              onChange={(e) => setColorForm({ ...colorForm, label: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="Masalan: A'lo"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Rang</label>
            <input
              type="color"
              value={colorForm.colorHex}
              onChange={(e) => setColorForm({ ...colorForm, colorHex: e.target.value })}
              className="w-full h-10 px-1 py-1 border border-gray-300 rounded-md bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Tartib</label>
            <input
              type="number"
              min={0}
              max={999}
              value={colorForm.orderIndex}
              onChange={(e) => setColorForm({ ...colorForm, orderIndex: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={() =>
                upsertColorMutation.mutate({
                  ...(editingColorId ? { id: editingColorId } : {}),
                  label: colorForm.label,
                  colorHex: colorForm.colorHex,
                  orderIndex: colorForm.orderIndex,
                  isActive: colorForm.isActive,
                })
              }
              disabled={upsertColorMutation.isLoading || !colorForm.label.trim()}
              className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {upsertColorMutation.isLoading ? '...' : editingColorId ? 'Yangilash' : "Qo'shish"}
            </button>
            {editingColorId && (
              <button
                onClick={() => {
                  setEditingColorId(null);
                  setColorForm({
                    label: '',
                    colorHex: '#22C55E',
                    orderIndex: 0,
                    isActive: true,
                  });
                  setColorError('');
                  setColorSuccess('');
                }}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
              >
                Bekor
              </button>
            )}
          </div>
        </div>

        {colorError && <p className="text-sm text-red-600">{colorError}</p>}
        {colorSuccess && <p className="text-sm text-green-700">{colorSuccess}</p>}

        {colorOptionsLoading ? (
          <p className="text-sm text-gray-500">Ranglar yuklanmoqda...</p>
        ) : !colorOptions || colorOptions.length === 0 ? (
          <p className="text-sm text-gray-500">Hozircha rang sozlamalari yo'q</p>
        ) : (
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Nomi</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Rang</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Tartib</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Holat</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Amal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {((colorOptions ?? []) as ExerciseColorOption[]).map((option) => (
                  <tr key={option.id}>
                    <td className="px-4 py-2 text-gray-900">{option.label}</td>
                    <td className="px-4 py-2">
                      <div className="inline-flex items-center gap-2">
                        <span
                          className="inline-block w-4 h-4 rounded-full border border-gray-300"
                          style={{ backgroundColor: option.colorHex }}
                        />
                        <span className="text-gray-700">{option.colorHex}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{option.orderIndex}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          option.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {option.isActive ? 'Faol' : 'Nofaol'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="inline-flex items-center gap-3">
                        <button
                          onClick={() => {
                            setEditingColorId(option.id);
                            setColorForm({
                              label: option.label,
                              colorHex: option.colorHex,
                              orderIndex: option.orderIndex,
                              isActive: option.isActive,
                            });
                            setColorError('');
                            setColorSuccess('');
                          }}
                          className="text-blue-600 text-xs hover:underline"
                        >
                          Tahrirlash
                        </button>
                        <button
                          onClick={() =>
                            setColorActiveMutation.mutate({
                              id: option.id,
                              isActive: !option.isActive,
                            })
                          }
                          className="text-xs text-gray-700 hover:underline"
                        >
                          {option.isActive ? 'Nofaol qilish' : 'Faol qilish'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Kurs</label>
        <select
          value={courseId}
          onChange={(e) => onSelectCourse(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700 min-w-64"
        >
          <option value="">Kursni tanlang...</option>
          {courses?.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
      </div>

      {courseId && (
        <>
          <div className="flex justify-end">
            <button
              onClick={openCreateForm}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              + Mashq qo'shish
            </button>
          </div>

          {showForm && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Mashq nomi</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Shat"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Turi</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as 'class' | 'homework' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="class">Dars mashqi</option>
                    <option value="homework">Uy vazifasi</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Maqsad (necha marta)</label>
                  <input
                    type="number"
                    min={1}
                    value={form.targetCount}
                    onChange={(e) => setForm({ ...form, targetCount: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Tartib</label>
                  <input
                    type="number"
                    min={0}
                    value={form.orderIndex}
                    onChange={(e) => setForm({ ...form, orderIndex: Number(e.target.value) })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-700 mb-2">Ranglar bo&apos;yicha ball</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {activeColorOptions.map((option) => (
                    <div key={option.id}>
                      <label className="block text-xs text-gray-600 mb-1">{option.label}</label>
                      <input
                        type="number"
                        min={0}
                        value={exerciseColorPoints[option.id] ?? 0}
                        onChange={(e) =>
                          setExerciseColorPoints((prev) => ({
                            ...prev,
                            [option.id]: Number(e.target.value),
                          }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={handleSaveExercise}
                  disabled={createMutation.isLoading || updateMutation.isLoading}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50"
                >
                  {createMutation.isLoading || updateMutation.isLoading
                    ? 'Saqlanmoqda...'
                    : editingExerciseId
                    ? 'Yangilash'
                    : 'Saqlash'}
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
                    setEditingExerciseId(null);
                    setError('');
                  }}
                  className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg"
                >
                  Bekor
                </button>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="text-gray-500 text-sm">Yuklanmoqda...</div>
          ) : !exercises || exercises.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
              Mashqlar topilmadi
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Nomi</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Turi</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Maqsad</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Maks. ball</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Holati</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Amal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {exercises.map((exercise) => {
                    const activePoints = exercise.colorPoints
                      .filter((row) => row.colorOption.isActive)
                      .map((row) => row.points);
                    const maxColorPoint = activePoints.length > 0 ? Math.max(...activePoints) : 0;
                    const maxTotalPoints = maxColorPoint * exercise.targetCount;

                    return (
                      <tr key={exercise.id}>
                        <td className="px-4 py-3 font-medium text-gray-900">{exercise.name}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {exercise.type === 'class' ? 'Dars mashqi' : 'Uy vazifasi'}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{exercise.targetCount} marta</td>
                        <td className="px-4 py-3 text-gray-600">{maxTotalPoints}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() =>
                              updateMutation.mutate({ id: exercise.id, isActive: !exercise.isActive })
                            }
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              exercise.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {exercise.isActive ? 'Faol' : 'Nofaol'}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => openEditForm(exercise)}
                            className="text-blue-600 text-xs hover:underline"
                          >
                            Tahrirlash
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RegionsTab() {
  const utils = trpc.useContext();
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const { data: regions, isLoading } = trpc.settings.listRegions.useQuery();
  const addMutation = trpc.settings.addRegion.useMutation({
    onSuccess: () => {
      void utils.settings.listRegions.invalidate();
      setNewName('');
      setError('');
    },
    onError: (err) => setError(err.message),
  });
  const updateMutation = trpc.settings.updateRegion.useMutation({
    onSuccess: () => void utils.settings.listRegions.invalidate(),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Viloyatlar</h2>

      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Viloyat nomi..."
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm flex-1 max-w-xs"
          onKeyDown={(e) => e.key === 'Enter' && addMutation.mutate({ name: newName })}
        />
        <button
          onClick={() => addMutation.mutate({ name: newName })}
          disabled={!newName || addMutation.isLoading}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {addMutation.isLoading ? '...' : "Qo'shish"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {isLoading ? (
        <div className="text-gray-500 text-sm">Yuklanmoqda...</div>
      ) : !regions || regions.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500 text-sm">
          Viloyatlar topilmadi
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Viloyat</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Holati</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {regions.map((region) => (
                <tr key={region.id}>
                  <td className="px-4 py-3 text-gray-900">{region.name}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => updateMutation.mutate({ id: region.id, isActive: !region.isActive })}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        region.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {region.isActive ? 'Faol' : 'Nofaol'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UsersTab() {
  const utils = trpc.useContext();
  const [error, setError] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [updateSuccess, setUpdateSuccess] = useState('');
  const [nameDraftByUserId, setNameDraftByUserId] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    role: 'Kurator' as 'Kurator' | 'Manager',
    name: '',
    username: '',
    email: '',
    phone: '',
    password: '',
  });

  const { data: users, isLoading } = trpc.settings.listStaffUsers.useQuery();
  const createMutation = trpc.settings.createStaffUser.useMutation({
    onSuccess: () => {
      void utils.settings.listStaffUsers.invalidate();
      setForm({
        role: 'Kurator',
        name: '',
        username: '',
        email: '',
        phone: '',
        password: '',
      });
      setError('');
    },
    onError: (err) => setError(err.message),
  });

  const updateNameMutation = trpc.settings.updateStaffUserName.useMutation({
    onSuccess: async () => {
      await utils.settings.listStaffUsers.invalidate();
      setUpdateError('');
      setUpdateSuccess("Foydalanuvchi ismi saqlandi");
    },
    onError: (err) => {
      setUpdateSuccess('');
      setUpdateError(err.message);
    },
  });

  useEffect(() => {
    if (!users) {
      return;
    }
    setNameDraftByUserId((prev) => {
      const next = { ...prev };
      for (const user of users) {
        if (next[user.id] === undefined) {
          next[user.id] = user.name ?? '';
        }
      }
      return next;
    });
  }, [users]);

  const handleCreate = () => {
    if (!form.password.trim()) {
      setError('Parol kiriting');
      return;
    }
    if (!form.username.trim() && !form.email.trim() && !form.phone.trim()) {
      setError('Username, email yoki telefondan bittasi majburiy');
      return;
    }
    createMutation.mutate({
      role: form.role,
      name: form.name || undefined,
      username: form.username || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      password: form.password,
    });
  };

  const handleSaveName = (userId: string) => {
    setUpdateError('');
    setUpdateSuccess('');
    const nextName = (nameDraftByUserId[userId] ?? '').trim();
    updateNameMutation.mutate({
      userId,
      name: nextName || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Kurator va Menejer qo'shish</h2>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Rol</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as 'Kurator' | 'Manager' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="Kurator">Kurator</option>
              <option value="Manager">Menejer</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Ism</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="Ali Valiyev"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="ali_valiyev"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Telefon</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="+998901234567"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Parol</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="Kamida 6 belgi"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {updateError && <p className="text-sm text-red-600">{updateError}</p>}
        {updateSuccess && <p className="text-sm text-green-700">{updateSuccess}</p>}

        <button
          onClick={handleCreate}
          disabled={createMutation.isLoading}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {createMutation.isLoading ? "Yaratilmoqda..." : "Foydalanuvchi qo'shish"}
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-500 text-sm">Yuklanmoqda...</div>
      ) : !users || users.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-500 text-sm">
          Hozircha kurator/menejer yo'q
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Ism</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Rol</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Username</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Telefon</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Holat</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3 text-gray-900">
                    <input
                      value={nameDraftByUserId[user.id] ?? user.name ?? ''}
                      onChange={(e) =>
                        setNameDraftByUserId((prev) => ({
                          ...prev,
                          [user.id]: e.target.value,
                        }))}
                      className="w-full min-w-48 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                      placeholder="Ism kiriting"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-700">{user.roles.includes('Manager') ? 'Menejer' : 'Kurator'}</td>
                  <td className="px-4 py-3 text-gray-700">{user.username ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{user.email ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{user.phone ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {user.isActive ? 'Faol' : 'Nofaol'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleSaveName(user.id)}
                      disabled={updateNameMutation.isLoading}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {updateNameMutation.isLoading && updateNameMutation.variables?.userId === user.id
                        ? 'Saqlanmoqda...'
                        : 'Saqlash'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
function AssignmentsTab() {
  const utils = trpc.useContext();
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [attachRunId, setAttachRunId] = useState('');
  const [attachKuratorId, setAttachKuratorId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const { data: courses } = trpc.settings.listCourses.useQuery();
  const { data: courseRuns, isLoading: courseRunsLoading } = trpc.settings.listCourseRuns.useQuery();
  const { data: kurators } = trpc.settings.listKurators.useQuery();

  const filteredRuns = useMemo(
    () => (courseRuns ?? []).filter((run) => !selectedCourseId || run.courseId === selectedCourseId),
    [courseRuns, selectedCourseId],
  );

  const attachRun = useMemo(
    () => filteredRuns.find((run) => run.id === attachRunId),
    [filteredRuns, attachRunId],
  );
  const replacementWarning = attachRun?.kurator
    ? `${attachRun.kurator.name ?? attachRun.kurator.username ?? 'Kurator'} bilan almashtiriladi`
    : '';

  const handleSettled = () => {
    void utils.settings.listCourseRuns.invalidate();
  };

  const attachMutation = trpc.settings.attachKuratorToRun.useMutation({
    onSuccess: (data) => {
      setError('');
      setSuccess(`Kurator biriktirildi (${data.syncedCount} o'quvchi sinxronlandi)`);
      setAttachKuratorId('');
      handleSettled();
    },
    onError: (err) => {
      setSuccess('');
      setError(err.message);
    },
  });

  const detachMutation = trpc.settings.detachKuratorFromRun.useMutation({
    onSuccess: () => {
      setError('');
      setSuccess('Kurator ajratildi');
      handleSettled();
    },
    onError: (err) => {
      setSuccess('');
      setError(err.message);
    },
  });

  const handleAttach = () => {
    if (!attachRunId) {
      setError('Oqimni tanlang');
      setSuccess('');
      return;
    }
    if (!attachKuratorId) {
      setError('Kuratorni tanlang');
      setSuccess('');
      return;
    }
    attachMutation.mutate({ courseRunId: attachRunId, kuratorUserId: attachKuratorId });
  };

  const handleDetach = (runId: string, runName: string) => {
    const ok = window.confirm(`"${runName}" oqimidan kuratorni ajratmoqchimisiz?`);
    if (!ok) return;
    detachMutation.mutate({ courseRunId: runId });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Kurator - Kurs oqimi bog'lash</h2>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Kurs</label>
        <select
          value={selectedCourseId}
          onChange={(e) => {
            setSelectedCourseId(e.target.value);
            setAttachRunId('');
          }}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm min-w-64"
        >
          <option value="">Barcha kurslar</option>
          {courses?.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-medium text-gray-900">Yangi bog'lash</h3>
        <div className="flex gap-3 flex-wrap">
          <select
            value={attachRunId}
            onChange={(e) => setAttachRunId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-56"
          >
            <option value="">Kurs oqimini tanlang...</option>
            {filteredRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.name} ({run.course.name})
                {run.kurator ? ` - ${run.kurator.name ?? run.kurator.username}` : ''}
              </option>
            ))}
          </select>
          <select
            value={attachKuratorId}
            onChange={(e) => setAttachKuratorId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-48"
          >
            <option value="">Kuratorni tanlang...</option>
            {kurators?.map((kurator) => (
              <option key={kurator.id} value={kurator.id}>
                {kurator.name ?? kurator.username}
              </option>
            ))}
          </select>
          <button
            onClick={handleAttach}
            disabled={!attachRunId || !attachKuratorId || attachMutation.isLoading}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {attachMutation.isLoading ? '...' : "Bog'lash"}
          </button>
        </div>
        {replacementWarning && (
          <p className="text-xs text-amber-600">{replacementWarning}</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-700">{success}</p>}
      </div>

      {courseRunsLoading ? (
        <div className="text-gray-500 text-sm">Yuklanmoqda...</div>
      ) : filteredRuns.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500 text-sm">
          Oqimlar topilmadi
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Oqim</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Kurs</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Boshlanish</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Tugash</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Hozirgi kurator</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRuns.map((run) => {
                const kuratorLabel = run.kurator
                  ? run.kurator.name ?? run.kurator.username ?? 'Kurator'
                  : '—';
                const isDetaching = detachMutation.isLoading && detachMutation.variables?.courseRunId === run.id;
                return (
                  <tr key={run.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{run.name}</td>
                    <td className="px-4 py-3 text-gray-600">{run.course.name}</td>
                    <td className="px-4 py-3 text-gray-600">{new Date(run.startDate).toLocaleDateString('uz-UZ')}</td>
                    <td className="px-4 py-3 text-gray-600">{new Date(run.endDate).toLocaleDateString('uz-UZ')}</td>
                    <td className="px-4 py-3 text-gray-700">{kuratorLabel}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setAttachRunId(run.id);
                            setAttachKuratorId(run.kurator?.id ?? '');
                            setError('');
                            setSuccess('');
                          }}
                          className="text-blue-600 text-xs hover:underline"
                        >
                          O'zgartirish
                        </button>
                        {run.kurator && (
                          <button
                            type="button"
                            onClick={() => handleDetach(run.id, run.name)}
                            disabled={isDetaching}
                            className="text-red-600 text-xs hover:underline disabled:opacity-50"
                          >
                            {isDetaching ? 'Ajratilmoqda...' : 'Ajratish'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}



