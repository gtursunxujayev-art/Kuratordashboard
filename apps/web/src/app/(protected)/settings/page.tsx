'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';

type Tab = 'courseRuns' | 'exercises' | 'regions' | 'assignments';

export default function SettingsPage() {
  const { isAdmin, isLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('courseRuns');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');

  if (!isLoading && !isAdmin) {
    router.replace('/dashboard');
    return null;
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Sozlamalar</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {([
          { key: 'courseRuns', label: 'Kurs oqimlari' },
          { key: 'exercises', label: 'Mashqlar' },
          { key: 'regions', label: 'Viloyatlar' },
          { key: 'assignments', label: "Kurator bog'lash" },
        ] as { key: Tab; label: string }[]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'courseRuns' && <CourseRunsTab onSelectRun={setSelectedCourseRunId} />}
      {activeTab === 'exercises' && (
        <ExercisesTab
          courseRunId={selectedCourseRunId}
          onSelectCourseRun={setSelectedCourseRunId}
        />
      )}
      {activeTab === 'regions' && <RegionsTab />}
      {activeTab === 'assignments' && (
        <AssignmentsTab
          courseRunId={selectedCourseRunId}
          onSelectCourseRun={setSelectedCourseRunId}
        />
      )}
    </div>
  );
}

// ── Course Runs Tab ─────────────────────────────────────────────────────────

function CourseRunsTab({ onSelectRun }: { onSelectRun: (id: string) => void }) {
  const utils = trpc.useContext();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ courseId: '', name: '', startDate: '', baseLessons: 12 });
  const [error, setError] = useState('');

  const { data: courseRuns, isLoading } = trpc.settings.listCourseRuns.useQuery();
  const { data: courses } = trpc.settings.listCourses.useQuery();

  const createMutation = trpc.settings.createCourseRun.useMutation({
    onSuccess: () => {
      void utils.settings.listCourseRuns.invalidate();
      setShowForm(false);
      setForm({ courseId: '', name: '', startDate: '', baseLessons: 12 });
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
      baseLessons: form.baseLessons,
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Kurs</label>
              <select
                value={form.courseId}
                onChange={(e) => setForm({ ...form, courseId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">Tanlang...</option>
                {courses?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
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
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Boshlanish sanasi (Shanba)
              </label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Asosiy darslar soni
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={form.baseLessons}
                onChange={(e) => setForm({ ...form, baseLessons: Number(e.target.value) })}
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
              onClick={() => { setShowForm(false); setError(''); }}
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
                <th className="text-left px-4 py-3 font-medium text-gray-600">Darslar</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {courseRuns.map((run) => (
                <tr key={run.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{run.name}</td>
                  <td className="px-4 py-3 text-gray-600">{run.course.name}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(run.startDate).toLocaleDateString('uz-UZ')}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {new Date(run.endDate).toLocaleDateString('uz-UZ')}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{run.baseLessons}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onSelectRun(run.id)}
                      className="text-blue-600 text-xs hover:underline"
                    >
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

// ── Exercises Tab ────────────────────────────────────────────────────────────

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
            <option key={r.id} value={r.id}>{r.name} ({r.course.name})</option>
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
              + Mashq qo&apos;shish
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
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Maqsad (necha marta)
                  </label>
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
                  onClick={() => { setShowForm(false); setError(''); }}
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
                  {exercises.map((ex) => (
                    <tr key={ex.id}>
                      <td className="px-4 py-3 font-medium text-gray-900">{ex.name}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {ex.type === 'class' ? 'Dars mashqi' : 'Uy vazifasi'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{ex.targetCount} marta</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() =>
                            updateMutation.mutate({ id: ex.id, isActive: !ex.isActive })
                          }
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            ex.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {ex.isActive ? 'Faol' : "Nofaol"}
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

// ── Regions Tab ──────────────────────────────────────────────────────────────

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
              {regions.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-gray-900">{r.name}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => updateMutation.mutate({ id: r.id, isActive: !r.isActive })}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {r.isActive ? 'Faol' : "Nofaol"}
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

// ── Assignments Tab ──────────────────────────────────────────────────────────

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
    { courseRunId: courseRunId || undefined, limit: 100 },
    { enabled: !!courseRunId },
  );

  const assignMutation = trpc.settings.assignStudent.useMutation({
    onSuccess: () => void utils.kurators.assignments.invalidate(),
  });

  const unassignMutation = trpc.settings.unassignStudent.useMutation({
    onSuccess: () => void utils.kurators.assignments.invalidate(),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-gray-900">Kurator — O&apos;quvchi bog&apos;lash</h2>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Kurs oqimi</label>
        <select
          value={courseRunId}
          onChange={(e) => onSelectCourseRun(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm min-w-64"
        >
          <option value="">Oqimni tanlang...</option>
          {courseRuns?.map((r) => (
            <option key={r.id} value={r.id}>{r.name} ({r.course.name})</option>
          ))}
        </select>
      </div>

      {courseRunId && (
        <>
          {/* Assign form */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-medium text-gray-900">Yangi bog&apos;lash</h3>
            <div className="flex gap-3 flex-wrap">
              <select
                value={selectedKuratorId}
                onChange={(e) => setSelectedKuratorId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-48"
              >
                <option value="">Kuratorni tanlang...</option>
                {kurators?.map((k) => (
                  <option key={k.id} value={k.id}>{k.name ?? k.username}</option>
                ))}
              </select>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-48"
              >
                <option value="">O&apos;quvchini tanlang...</option>
                {students?.data.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
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

          {/* Existing assignments */}
          {assignments && assignments.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Kurator</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">O&apos;quvchi</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {assignments.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-3 text-gray-900">{a.kurator.name}</td>
                      <td className="px-4 py-3 text-gray-900">{a.customer.name}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() =>
                            unassignMutation.mutate({
                              kuratorUserId: a.kuratorUserId,
                              customerId: a.customerId,
                              courseRunId: a.courseRunId,
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
