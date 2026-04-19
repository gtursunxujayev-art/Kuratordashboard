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
      {activeTab === 'courseRuns' && (
        <CourseRunsTab
          selectedRunId={selectedCourseRunId}
          onSelectRun={setSelectedCourseRunId}
          onOpenAssignments={() => setActiveTab('assignments')}
        />
      )}
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
  onOpenAssignments,
}: {
  selectedRunId: string;
  onSelectRun: (id: string) => void;
  onOpenAssignments: () => void;
}) {
  const utils = trpc.useContext();
  const [showForm, setShowForm] = useState(false);
  const [createTariffId, setCreateTariffId] = useState('');
  const [createStudentIds, setCreateStudentIds] = useState<string[]>([]);
  const [createStudentsOpen, setCreateStudentsOpen] = useState(false);
  const [pendingCreatePrefill, setPendingCreatePrefill] = useState<{
    tariffId: string;
    studentIds: string[];
  } | null>(null);
  const [selectedTariffId, setSelectedTariffId] = useState('');
  const [selectedKuratorId, setSelectedKuratorId] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    courseId: '',
    name: '',
    startDate: '',
    durationWeeks: 6,
    baseLessons: 12,
    premiumExtraLessons: 2,
  });
  const [error, setError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');

  const { data: courseRuns, isLoading } = trpc.settings.listCourseRuns.useQuery();
  const { data: courses } = trpc.settings.listCourses.useQuery();
  const { data: kurators } = trpc.settings.listKurators.useQuery();
  const { data: createTariffs } = trpc.settings.listTariffsByCourse.useQuery(
    { courseId: form.courseId || '' },
    { enabled: Boolean(showForm && form.courseId) },
  );
  const { data: runTariffs } = trpc.settings.listTariffsByCourseRun.useQuery(
    { courseRunId: selectedRunId },
    { enabled: Boolean(selectedRunId) },
  );
  const { data: studentsForCreate, isLoading: studentsForCreateLoading } = trpc.students.list.useQuery(
    {
      courseId: form.courseId || undefined,
      tariffId: createTariffId || undefined,
      page: 1,
      limit: 200,
    },
    { enabled: Boolean(showForm && form.courseId) },
  );
  const {
    data: studentsForRun,
    isLoading: studentsLoading,
    error: studentsError,
    refetch: refetchStudentsForRun,
  } = trpc.students.list.useQuery(
    {
      courseRunId: selectedRunId || undefined,
      tariffId: selectedTariffId || undefined,
      page: 1,
      limit: 200,
    },
    { enabled: Boolean(selectedRunId) },
  );

  const createMutation = trpc.settings.createCourseRun.useMutation();
  const assignBulkMutation = trpc.settings.assignStudentsBulk.useMutation({
    onSuccess: (result) => {
      setAssignError('');
      setAssignSuccess(`${result.assignedCount} ta o'quvchi kuratorga biriktirildi.`);
      setSelectedStudentIds([]);
      void utils.kurators.assignments.invalidate();
    },
    onError: (err) => {
      setAssignSuccess('');
      setAssignError(err.message);
    },
  });

  const createStudentOptions = useMemo(
    () => studentsForCreate?.data ?? [],
    [studentsForCreate?.data],
  );
  const studentOptions = useMemo(() => studentsForRun?.data ?? [], [studentsForRun?.data]);

  useEffect(() => {
    if (pendingCreatePrefill) {
      setSelectedTariffId(pendingCreatePrefill.tariffId);
      setSelectedStudentIds(pendingCreatePrefill.studentIds);
      setPendingCreatePrefill(null);
    } else {
      setSelectedTariffId('');
      setSelectedStudentIds([]);
    }
    setAssignError('');
    setAssignSuccess('');
  }, [selectedRunId]);

  useEffect(() => {
    setSelectedStudentIds([]);
  }, [selectedTariffId]);

  useEffect(() => {
    setCreateTariffId('');
    setCreateStudentIds([]);
    setCreateStudentsOpen(false);
  }, [form.courseId]);

  useEffect(() => {
    setCreateStudentIds([]);
  }, [createTariffId]);

  const handleCreate = async () => {
    if (!form.courseId || !form.name || !form.startDate) {
      setError("Barcha maydonlarni to'ldiring");
      setCreateSuccess('');
      return;
    }

    try {
      setError('');
      setCreateSuccess('');
      const createdRun = await createMutation.mutateAsync({
        courseId: form.courseId,
        name: form.name,
        startDate: form.startDate,
        durationWeeks: form.durationWeeks,
        baseLessons: form.baseLessons,
        premiumExtraLessons: form.premiumExtraLessons,
      });

      await utils.settings.listCourseRuns.invalidate();
      setPendingCreatePrefill({
        tariffId: createTariffId,
        studentIds: createStudentIds,
      });
      onSelectRun(createdRun.id);
      setShowForm(false);
      setCreateSuccess("Oqim yaratildi. Endi o'quvchilarni pastdagi bo'limda kuratorga biriktiring.");
      setForm({
        courseId: '',
        name: '',
        startDate: '',
        durationWeeks: 6,
        baseLessons: 12,
        premiumExtraLessons: 2,
      });
      setCreateTariffId('');
      setCreateStudentIds([]);
      setCreateStudentsOpen(false);
      setSelectedKuratorId('');
      void refetchStudentsForRun();
    } catch (err: any) {
      setCreateSuccess('');
      setError(err?.message ?? "Oqim yaratishda xatolik yuz berdi");
    }
  };

  const toggleStudent = (studentId: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId],
    );
  };

  const selectAllStudents = () => {
    setSelectedStudentIds(studentOptions.map((s) => s.id));
  };

  const clearSelectedStudents = () => {
    setSelectedStudentIds([]);
  };

  const toggleCreateStudent = (studentId: string) => {
    setCreateStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId],
    );
  };

  const selectAllCreateStudents = () => {
    setCreateStudentIds(createStudentOptions.map((student) => student.id));
  };

  const clearCreateStudents = () => {
    setCreateStudentIds([]);
  };

  const handleBulkAssign = () => {
    setAssignError('');
    setAssignSuccess('');
    if (!selectedRunId || !selectedKuratorId || selectedStudentIds.length === 0) {
      setAssignError("Oqim, kurator va kamida bitta o'quvchini tanlang.");
      return;
    }
    assignBulkMutation.mutate({
      courseRunId: selectedRunId,
      kuratorUserId: selectedKuratorId,
      customerIds: selectedStudentIds,
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

          <div className="border border-gray-200 rounded-lg p-3 space-y-3">
            <h4 className="text-sm font-medium text-gray-900">Yangi oqim uchun tarif va o'quvchilar (ixtiyoriy)</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Tariflar ro'yxati</label>
                <select
                  value={createTariffId}
                  onChange={(e) => setCreateTariffId(e.target.value)}
                  disabled={!form.courseId}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">Barcha tariflar</option>
                  {createTariffs?.map((tariff) => (
                    <option key={tariff.id} value={tariff.id}>
                      {tariff.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => setCreateStudentsOpen((prev) => !prev)}
                  disabled={!form.courseId}
                  className="w-full px-3 py-2 border border-gray-300 text-left text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  {createStudentIds.length > 0
                    ? `O'quvchilar tanlandi: ${createStudentIds.length}`
                    : "O'quvchilarni tanlang..."}
                </button>
              </div>
            </div>

            {!form.courseId && (
              <p className="text-xs text-gray-500">Avval kursni tanlang, keyin tarif va o'quvchilar ro'yxati chiqadi.</p>
            )}

            {form.courseId && createStudentsOpen && (
              <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllCreateStudents}
                    disabled={createStudentOptions.length === 0}
                    className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
                  >
                    Barchasini tanlash
                  </button>
                  <button
                    type="button"
                    onClick={clearCreateStudents}
                    disabled={createStudentIds.length === 0}
                    className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
                  >
                    Tozalash
                  </button>
                  <span className="text-xs text-gray-500">
                    O'quvchilar ({createStudentOptions.length}) • Tanlangan: {createStudentIds.length}
                  </span>
                </div>

                <div className="max-h-64 overflow-auto border border-gray-200 rounded-lg p-3">
                  {studentsForCreateLoading ? (
                    <p className="text-sm text-gray-500">Yuklanmoqda...</p>
                  ) : createStudentOptions.length === 0 ? (
                    <p className="text-sm text-gray-500">Bu filtrda o'quvchilar topilmadi.</p>
                  ) : (
                    <div className="space-y-2">
                      {createStudentOptions.map((student) => (
                        <label key={student.id} className="flex items-center gap-2 text-sm text-gray-800">
                          <input
                            type="checkbox"
                            checked={createStudentIds.includes(student.id)}
                            onChange={() => toggleCreateStudent(student.id)}
                            className="h-4 w-4"
                          />
                          <span>
                            {student.customerNumber} - {student.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {createSuccess && <p className="text-sm text-green-600">{createSuccess}</p>}

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

      {selectedRunId && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-900">Oqim bo'yicha o'quvchilarni tanlash</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Tariflar ro'yxati</label>
              <select
                value={selectedTariffId}
                onChange={(e) => setSelectedTariffId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">Barcha tariflar</option>
                {runTariffs?.map((tariff) => (
                  <option key={tariff.id} value={tariff.id}>
                    {tariff.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Kurator tanlash</label>
              <select
                value={selectedKuratorId}
                onChange={(e) => setSelectedKuratorId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">Kuratorni tanlang...</option>
                {kurators?.map((kurator) => (
                  <option key={kurator.id} value={kurator.id}>
                    {kurator.name ?? kurator.username}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={selectAllStudents}
                disabled={studentOptions.length === 0}
                className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                Barchasini tanlash
              </button>
              <button
                type="button"
                onClick={clearSelectedStudents}
                disabled={selectedStudentIds.length === 0}
                className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                Tozalash
              </button>
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 max-h-72 overflow-auto">
            <div className="text-xs text-gray-500 mb-2">
              O'quvchilar ({studentOptions.length}) • Tanlangan: {selectedStudentIds.length}
            </div>
            {studentsLoading ? (
              <p className="text-sm text-gray-500">Yuklanmoqda...</p>
            ) : studentsError ? (
              <div className="space-y-2">
                <p className="text-sm text-red-600">{studentsError.message}</p>
                <button
                  type="button"
                  onClick={() => void refetchStudentsForRun()}
                  className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs rounded-md hover:bg-gray-50"
                >
                  Qayta yuklash
                </button>
              </div>
            ) : studentOptions.length === 0 ? (
              <p className="text-sm text-gray-500">Bu filtrda o'quvchilar topilmadi.</p>
            ) : (
              <div className="space-y-2">
                {studentOptions.map((student) => (
                  <label key={student.id} className="flex items-center gap-2 text-sm text-gray-800">
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.includes(student.id)}
                      onChange={() => toggleStudent(student.id)}
                      className="h-4 w-4"
                    />
                    <span>
                      {student.customerNumber} - {student.name}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {assignError && <p className="text-sm text-red-600">{assignError}</p>}
          {assignSuccess && <p className="text-sm text-green-600">{assignSuccess}</p>}

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleBulkAssign}
              disabled={
                assignBulkMutation.isLoading ||
                !selectedRunId ||
                !selectedKuratorId ||
                selectedStudentIds.length === 0
              }
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {assignBulkMutation.isLoading ? 'Biriktirilmoqda...' : "Tanlanganlarni kuratorga biriktirish"}
            </button>
            <button
              type="button"
              onClick={onOpenAssignments}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
            >
              Kurator bog'lash tabiga o'tish
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
                    <button
                      type="button"
                      onClick={() => {
                        onSelectRun(run.id);
                        onOpenAssignments();
                      }}
                      className="text-blue-600 text-xs hover:underline"
                    >
                      {selectedRunId === run.id ? 'Tanlangan' : 'Tanlash'}
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



