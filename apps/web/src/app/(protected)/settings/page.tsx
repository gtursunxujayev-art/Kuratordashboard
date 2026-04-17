'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';

type Tab = 'templates' | 'courseRuns' | 'exercises' | 'regions' | 'users' | 'assignments';

export default function SettingsPage() {
  const { isAdmin, isLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('templates');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');

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
      {activeTab === 'courseRuns' && <CourseRunsTab onSelectRun={setSelectedCourseRunId} />}
      {activeTab === 'exercises' && (
        <ExercisesTab courseRunId={selectedCourseRunId} onSelectCourseRun={setSelectedCourseRunId} />
      )}
      {activeTab === 'regions' && <RegionsTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'assignments' && (
        <AssignmentsTab courseRunId={selectedCourseRunId} onSelectCourseRun={setSelectedCourseRunId} />
      )}
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

  const { data, isLoading } = trpc.settings.listScheduleTemplates.useQuery();
  const upsertMutation = trpc.settings.upsertScheduleTemplate.useMutation({
    onSuccess: () => {
      void utils.settings.listScheduleTemplates.invalidate();
      setError('');
    },
    onError: (err) => setError(err.message),
  });

  const handleSave = () => {
    upsertMutation.mutate(form);
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

        <button
          onClick={handleSave}
          disabled={upsertMutation.isLoading || !form.courseCategory.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {upsertMutation.isLoading ? 'Saqlanmoqda...' : 'Saqlash'}
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
                      onClick={() =>
                        setForm({
                          courseCategory: item.courseCategory,
                          durationWeeks: item.durationWeeks,
                          baseLessons: item.baseLessons,
                          premiumExtraLessons: item.premiumExtraLessons,
                        })
                      }
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

function CourseRunsTab({ onSelectRun }: { onSelectRun: (id: string) => void }) {
  const utils = trpc.useContext();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    courseId: '',
    name: '',
    startDate: '',
    durationWeeks: 6,
    baseLessons: 12,
    premiumExtraLessons: 2,
  });
  const [error, setError] = useState('');

  const { data: courseRuns, isLoading } = trpc.settings.listCourseRuns.useQuery();
  const { data: courses } = trpc.settings.listCourses.useQuery();

  const createMutation = trpc.settings.createCourseRun.useMutation({
    onSuccess: () => {
      void utils.settings.listCourseRuns.invalidate();
      setShowForm(false);
      setForm({
        courseId: '',
        name: '',
        startDate: '',
        durationWeeks: 6,
        baseLessons: 12,
        premiumExtraLessons: 2,
      });
      setError('');
    },
    onError: (err) => setError(err.message),
  });

  const handleCreate = () => {
    if (!form.courseId || !form.name || !form.startDate) {
      setError("Barcha maydonlarni to'ldiring");
      return;
    }

    createMutation.mutate({
      courseId: form.courseId,
      name: form.name,
      startDate: form.startDate,
      durationWeeks: form.durationWeeks,
      baseLessons: form.baseLessons,
      premiumExtraLessons: form.premiumExtraLessons,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Kurs oqimlari</h2>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          + Yangi oqim
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-900">Yangi oqim yaratish</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Kurs</label>
              <select
                value={form.courseId}
                onChange={(e) => setForm({ ...form, courseId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
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
              <label className="block text-xs font-medium text-gray-500 mb-1">Boshlanish (Shanba)</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
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

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={createMutation.isLoading}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isLoading ? 'Yaratilmoqda...' : 'Yaratish'}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
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
                    <button onClick={() => onSelectRun(run.id)} className="text-blue-600 text-xs hover:underline">
                      Tanlash
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

function ExercisesTab({
  courseRunId,
  onSelectCourseRun,
}: {
  courseRunId: string;
  onSelectCourseRun: (id: string) => void;
}) {
  const utils = trpc.useContext();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: 'class' as 'class' | 'homework',
    targetCount: 1,
    orderIndex: 0,
  });
  const [error, setError] = useState('');

  const { data: courseRuns } = trpc.settings.listCourseRuns.useQuery();
  const { data: exercises, isLoading } = trpc.settings.listExerciseDefinitions.useQuery(
    { courseRunId },
    { enabled: !!courseRunId },
  );

  const createMutation = trpc.settings.addExerciseDefinition.useMutation({
    onSuccess: () => {
      void utils.settings.listExerciseDefinitions.invalidate();
      setShowForm(false);
      setForm({ name: '', type: 'class', targetCount: 1, orderIndex: 0 });
      setError('');
    },
    onError: (err) => setError(err.message),
  });

  const updateMutation = trpc.settings.updateExerciseDefinition.useMutation({
    onSuccess: () => void utils.settings.listExerciseDefinitions.invalidate(),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Amaliy mashqlar</h2>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Kurs oqimi</label>
        <select
          value={courseRunId}
          onChange={(e) => onSelectCourseRun(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700 min-w-64"
        >
          <option value="">Oqimni tanlang...</option>
          {courseRuns?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({r.course.name})
            </option>
          ))}
        </select>
      </div>

      {courseRunId && (
        <>
          <div className="flex justify-end">
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
            >
              + Mashq qo'shish
            </button>
          </div>

          {showForm && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
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

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() =>
                    createMutation.mutate({
                      courseRunId,
                      name: form.name,
                      type: form.type,
                      targetCount: form.targetCount,
                      orderIndex: form.orderIndex,
                    })
                  }
                  disabled={createMutation.isLoading}
                  className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-50"
                >
                  Saqlash
                </button>
                <button
                  onClick={() => {
                    setShowForm(false);
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
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Holati</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {exercises.map((exercise) => (
                    <tr key={exercise.id}>
                      <td className="px-4 py-3 font-medium text-gray-900">{exercise.name}</td>
                      <td className="px-4 py-3 text-gray-600">{exercise.type === 'class' ? 'Dars mashqi' : 'Uy vazifasi'}</td>
                      <td className="px-4 py-3 text-gray-600">{exercise.targetCount} marta</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => updateMutation.mutate({ id: exercise.id, isActive: !exercise.isActive })}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            exercise.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {exercise.isActive ? 'Faol' : 'Nofaol'}
                        </button>
                      </td>
                    </tr>
                  ))}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3 text-gray-900">{user.name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{user.roles.includes('Manager') ? 'Menejer' : 'Kurator'}</td>
                  <td className="px-4 py-3 text-gray-700">{user.username ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{user.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-700">{user.phone ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {user.isActive ? 'Faol' : 'Nofaol'}
                    </span>
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

function AssignmentsTab({
  courseRunId,
  onSelectCourseRun,
}: {
  courseRunId: string;
  onSelectCourseRun: (id: string) => void;
}) {
  const utils = trpc.useContext();
  const [selectedKuratorId, setSelectedKuratorId] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');

  const { data: courseRuns } = trpc.settings.listCourseRuns.useQuery();
  const { data: kurators } = trpc.settings.listKurators.useQuery();
  const { data: assignments } = trpc.kurators.assignments.useQuery(
    { courseRunId: courseRunId || undefined },
    { enabled: !!courseRunId },
  );
  const { data: students } = trpc.students.list.useQuery(
    { courseRunId: courseRunId || undefined, page: 1, limit: 100 },
    { enabled: !!courseRunId },
  );

  const studentOptions = useMemo(() => students?.data ?? [], [students?.data]);

  const assignMutation = trpc.settings.assignStudent.useMutation({
    onSuccess: () => void utils.kurators.assignments.invalidate(),
  });

  const unassignMutation = trpc.settings.unassignStudent.useMutation({
    onSuccess: () => void utils.kurators.assignments.invalidate(),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Kurator - O'quvchi bog'lash</h2>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Kurs oqimi</label>
        <select
          value={courseRunId}
          onChange={(e) => onSelectCourseRun(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm min-w-64"
        >
          <option value="">Oqimni tanlang...</option>
          {courseRuns?.map((run) => (
            <option key={run.id} value={run.id}>
              {run.name} ({run.course.name})
            </option>
          ))}
        </select>
      </div>

      {courseRunId && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-medium text-gray-900">Yangi bog'lash</h3>
            <div className="flex gap-3 flex-wrap">
              <select
                value={selectedKuratorId}
                onChange={(e) => setSelectedKuratorId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-48"
              >
                <option value="">Kuratorni tanlang...</option>
                {kurators?.map((kurator) => (
                  <option key={kurator.id} value={kurator.id}>
                    {kurator.name ?? kurator.username}
                  </option>
                ))}
              </select>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-48"
              >
                <option value="">O'quvchini tanlang...</option>
                {studentOptions.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  assignMutation.mutate({
                    kuratorUserId: selectedKuratorId,
                    customerId: selectedCustomerId,
                    courseRunId,
                  })
                }
                disabled={!selectedKuratorId || !selectedCustomerId || assignMutation.isLoading}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {assignMutation.isLoading ? '...' : "Bog'lash"}
              </button>
            </div>
          </div>

          {assignments && assignments.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Kurator</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">O'quvchi</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {assignments.map((assignment) => (
                    <tr key={assignment.id}>
                      <td className="px-4 py-3 text-gray-900">{assignment.kurator.name}</td>
                      <td className="px-4 py-3 text-gray-900">{assignment.customer.name}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() =>
                            unassignMutation.mutate({
                              kuratorUserId: assignment.kuratorUserId,
                              customerId: assignment.customerId,
                              courseRunId: assignment.courseRunId,
                            })
                          }
                          className="text-red-500 text-xs hover:underline"
                        >
                          Ajratish
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
