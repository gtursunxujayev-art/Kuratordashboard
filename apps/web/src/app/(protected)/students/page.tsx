'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/components/ui/toast';
import { BotActionPopup } from '@/components/students/bot-action-popup';
import { StudentDetailModal } from './student-detail-modal';

type SecondaryFilter = 'tariff' | 'region';
type CourseType = '' | 'offline' | 'online' | 'intensiv';

const WITHOUT_OQIM_VALUE = '__WITHOUT_OQIM__';

function downloadBase64File(base64: string, fileName: string, mimeType: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function normalizeCourseCategory(raw?: string | null): Exclude<CourseType, ''> {
  const value = (raw ?? '').toLowerCase();
  if (value.includes('intens')) return 'intensiv';
  if (value.includes('online') || value.includes('onlayn')) return 'online';
  return 'offline';
}

export default function StudentsPage() {
  const [selectedCourseType, setSelectedCourseType] = useState<CourseType>('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedCourseRunId, setSelectedCourseRunId] = useState('');
  const [secondaryFilter, setSecondaryFilter] = useState<SecondaryFilter>('tariff');
  const [selectedTariffId, setSelectedTariffId] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  const { data: filterOptions, error: filterOptionsError } = trpc.students.filterOptions.useQuery();
  const { data: courseRuns, error: courseRunsError } = trpc.dashboard.courseRuns.useQuery();
  const { data: courses, error: coursesError } = trpc.dashboard.courses.useQuery();

  const filteredCourses = useMemo(
    () =>
      (courses ?? []).filter((course) => (
        !selectedCourseType || normalizeCourseCategory(course.category) === selectedCourseType
      )),
    [courses, selectedCourseType],
  );

  const filteredCourseRuns = useMemo(
    () =>
      (courseRuns ?? []).filter((run) => {
        if (selectedCourseId && run.courseId !== selectedCourseId) return false;
        if (!selectedCourseType) return true;
        return normalizeCourseCategory(run.course.category) === selectedCourseType;
      }),
    [courseRuns, selectedCourseId, selectedCourseType],
  );

  const allowedCourseIds = useMemo(
    () => new Set(filteredCourses.map((course) => course.id)),
    [filteredCourses],
  );

  const filteredTariffs = useMemo(() => {
    const tariffs = filterOptions?.tariffs ?? [];
    if (selectedCourseId) {
      return tariffs.filter((tariff) => tariff.courseId === selectedCourseId);
    }
    if (selectedCourseType) {
      return tariffs.filter((tariff) => allowedCourseIds.has(tariff.courseId));
    }
    return tariffs;
  }, [allowedCourseIds, filterOptions?.tariffs, selectedCourseId, selectedCourseType]);

  useEffect(() => {
    if (!selectedCourseId) return;
    if (allowedCourseIds.has(selectedCourseId)) return;
    setSelectedCourseId('');
    setSelectedCourseRunId('');
    setSelectedTariffId('');
    setPage(1);
  }, [allowedCourseIds, selectedCourseId]);

  useEffect(() => {
    if (!selectedCourseRunId || selectedCourseRunId === WITHOUT_OQIM_VALUE) return;
    if (filteredCourseRuns.some((run) => run.id === selectedCourseRunId)) return;
    setSelectedCourseRunId('');
    setPage(1);
  }, [filteredCourseRuns, selectedCourseRunId]);

  const isWithoutOqim = selectedCourseRunId === WITHOUT_OQIM_VALUE;
  const { isManager } = useAuth();
  const [bulkQrMessage, setBulkQrMessage] = useState('');

  const listFilters = {
    courseRunId: !isWithoutOqim && selectedCourseRunId ? selectedCourseRunId : undefined,
    withoutOqim: isWithoutOqim || undefined,
    courseId: selectedCourseId || undefined,
    tariffId: secondaryFilter === 'tariff' && selectedTariffId ? selectedTariffId : undefined,
    region: secondaryFilter === 'region' && selectedRegion ? selectedRegion : undefined,
    search: search || undefined,
  };

  const { data, isLoading, error } = trpc.students.list.useQuery(
    { ...listFilters, page, limit: 50 },
    { keepPreviousData: true },
  );

  const toast = useToast();
  const [busyRow, setBusyRow] = useState<{ id: string; action: 'qr' | 'link' } | null>(null);
  const [botPopup, setBotPopup] = useState<
    { mode: 'qr' | 'link'; studentName: string; fileNameHint?: string; qrDataUrl?: string; link?: string | null } | null
  >(null);

  const rowQrMutation = trpc.clientBot.generateTicketQr.useMutation({
    onSuccess: (result, variables) => {
      const student = data?.data.find((row) => row.id === variables.customerId);
      setBotPopup({
        mode: 'qr',
        studentName: result.customerName,
        fileNameHint: student?.customerNumber ?? undefined,
        qrDataUrl: result.dataUrl,
      });
    },
    onError: (err) => toast.show(err.message, 'error'),
    onSettled: () => setBusyRow(null),
  });

  const rowLinkMutation = trpc.clientBot.createLinkToken.useMutation({
    onSuccess: (result, variables) => {
      const student = data?.data.find((row) => row.id === variables.customerId);
      setBotPopup({
        mode: 'link',
        studentName: student?.name ?? "O'quvchi",
        link: result.deepLink,
      });
    },
    onError: (err) => toast.show(err.message, 'error'),
    onSettled: () => setBusyRow(null),
  });

  const sendAllQrMutation = trpc.clientBot.sendTicketsToFiltered.useMutation({
    onSuccess: (result) => {
      setBulkQrMessage(
        `QR yuborildi: ${result.sent} ta. Botga ulanmagan: ${result.notLinked}. Oqimsiz: ${result.noOqim}.`
          + (result.truncated ? ' (Faqat birinchi 2000 ta o‘quvchi.)' : ''),
      );
    },
    onError: (err) => setBulkQrMessage(err.message),
  });

  const downloadAllQrMutation = trpc.clientBot.downloadTicketsForFiltered.useMutation({
    onSuccess: (result) => {
      downloadBase64File(result.zipBase64, result.fileName, 'application/zip');
      setBulkQrMessage(
        `${result.included} ta QR yuklab olindi.`
          + (result.skipped > 0 ? ` ${result.skipped} ta o‘tkazib yuborildi (oqimsiz).` : '')
          + (result.truncated ? ' (Faqat birinchi 2000 ta o‘quvchi.)' : ''),
      );
    },
    onError: (err) => setBulkQrMessage(err.message),
  });

  const handleDownloadAllQr = () => {
    const total = data?.pagination.total ?? 0;
    if (total === 0) return;
    setBulkQrMessage('');
    downloadAllQrMutation.mutate(listFilters);
  };

  const handleSendAllQr = () => {
    const total = data?.pagination.total ?? 0;
    if (total === 0) return;
    if (!window.confirm(`Filtrlangan ${total} ta o'quvchiga QR chipta yuborilsinmi?`)) return;
    setBulkQrMessage('');
    sendAllQrMutation.mutate(listFilters);
  };

  const totalPages = data ? Math.ceil(data.pagination.total / data.pagination.limit) : 0;

  return (
    <div className="nn-page">
      <section className="nn-hero students-hero">
        <h1>O&apos;quvchilar nazorati</h1>
      </section>

      {(filterOptionsError || courseRunsError || coursesError || error) && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {filterOptionsError?.message || coursesError?.message || courseRunsError?.message || error?.message || "Ma'lumotni yuklashda xatolik"}
        </div>
      )}

      <div className="nn-filter-card flex flex-wrap gap-3">
        <select
          value={selectedCourseType}
          onChange={(e) => {
            setSelectedCourseType(e.target.value as CourseType);
            setSelectedCourseId('');
            setSelectedCourseRunId('');
            setSelectedTariffId('');
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
        >
          <option value="">Barcha kurs turlari</option>
          <option value="offline">Offline</option>
          <option value="online">Online</option>
          <option value="intensiv">Intensiv</option>
        </select>

        <select
          value={selectedCourseId}
          onChange={(e) => {
            setSelectedCourseId(e.target.value);
            setSelectedTariffId('');
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
        >
          <option value="">Barcha kurslar</option>
          {filteredCourses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>

        <select
          value={selectedCourseRunId}
          onChange={(e) => {
            setSelectedCourseRunId(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
        >
          <option value="">Barcha oqimlar</option>
          <option value={WITHOUT_OQIM_VALUE}>Oqimsiz</option>
          {filteredCourseRuns.map((run) => (
            <option key={run.id} value={run.id}>
              {run.name}
            </option>
          ))}
        </select>

        <select
          value={secondaryFilter}
          onChange={(e) => {
            setSecondaryFilter(e.target.value as SecondaryFilter);
            setSelectedTariffId('');
            setSelectedRegion('');
            setPage(1);
          }}
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
        >
          <option value="tariff">Tarif</option>
          <option value="region">Viloyat</option>
        </select>

        {secondaryFilter === 'tariff' ? (
          <select
            value={selectedTariffId}
            onChange={(e) => {
              setSelectedTariffId(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
          >
            <option value="">Barcha tariflar</option>
            {filteredTariffs.map((tariff) => (
              <option key={tariff.id} value={tariff.id}>
                {tariff.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={selectedRegion}
            onChange={(e) => {
              setSelectedRegion(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
          >
            <option value="">Barcha viloyatlar</option>
            {filterOptions?.regions.map((region) => (
              <option key={region.id} value={region.name}>
                {region.name}
              </option>
            ))}
          </select>
        )}

        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Ism yoki raqam bo'yicha qidirish..."
          className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700 w-full sm:min-w-64 sm:w-auto"
        />
      </div>

      {data && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-gray-500">
            Jami: <span className="font-medium text-gray-700">{data.pagination.total}</span> ta o'quvchi
          </p>
          {isManager && data.pagination.total > 0 && (
            <button
              type="button"
              onClick={handleSendAllQr}
              disabled={sendAllQrMutation.isLoading}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {sendAllQrMutation.isLoading ? 'Yuborilmoqda...' : `Barchasiga QR yuborish (${data.pagination.total})`}
            </button>
          )}
          {isManager && data.pagination.total > 0 && (
            <button
              type="button"
              onClick={handleDownloadAllQr}
              disabled={downloadAllQrMutation.isLoading}
              className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {downloadAllQrMutation.isLoading
                ? 'Tayyorlanmoqda...'
                : `QR arxivini yuklab olish (${data.pagination.total})`}
            </button>
          )}
          {bulkQrMessage && <p className="text-sm text-gray-700">{bulkQrMessage}</p>}
        </div>
      )}

      <div className="nn-table-card">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Yuklanmoqda...</div>
        ) : !data || data.data.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">O'quvchilar topilmadi</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Ism</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Raqam</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Telegram</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Viloyat</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Tarif</th>
                  {data.data[0]?.exerciseStats.map((exercise) => (
                    <th key={exercise.name} className="text-center px-4 py-3 font-medium text-gray-600">
                      {exercise.name}
                    </th>
                  ))}
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Davomat</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Bot / QR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.data.map((student) => (
                  <tr
                    key={student.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setSelectedStudentId(student.id)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{student.name}</td>
                    <td className="px-4 py-3 text-gray-600">{student.customerNumber ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {student.telegramUsername ? `@${student.telegramUsername}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{student.region ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-600">{student.tariffName ?? '-'}</td>

                    {student.exerciseStats.map((exercise) => (
                      <td key={exercise.name} className="px-4 py-3 text-center">
                        <span
                          className={exercise.done >= exercise.total ? 'text-green-600 font-medium' : 'text-gray-700'}
                        >
                          {exercise.done}/{exercise.total}
                        </span>
                      </td>
                    ))}

                    <td className="px-4 py-3 text-center">
                      {selectedCourseRunId && !isWithoutOqim ? (
                        <div>
                          <span
                            className={
                              student.attendance.attended >= student.attendance.total
                                ? 'text-green-600 font-medium'
                                : 'text-gray-700'
                            }
                          >
                            {student.attendance.attended}/{student.attendance.total}
                          </span>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            Asosiy: {student.attendance.base.attended}/{student.attendance.base.total}
                            {student.attendance.isPremiumEligible
                              ? ` | Premium: ${student.attendance.premiumExtra.attended}/${student.attendance.premiumExtra.total}`
                              : ''}
                          </p>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <span
                          title={student.telegramChatId ? "Botga ulangan" : "Botga ulanmagan"}
                          className={student.telegramChatId ? 'text-green-600' : 'text-gray-300'}
                        >
                          ●
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBusyRow({ id: student.id, action: 'link' });
                            rowLinkMutation.mutate({ customerId: student.id });
                          }}
                          disabled={busyRow?.id === student.id}
                          className="px-2 py-1 border border-gray-200 rounded text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                        >
                          {busyRow?.id === student.id && busyRow.action === 'link' ? '...' : 'Havola'}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBusyRow({ id: student.id, action: 'qr' });
                            rowQrMutation.mutate({ customerId: student.id });
                          }}
                          disabled={busyRow?.id === student.id}
                          className="px-2 py-1 border border-gray-200 rounded text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                        >
                          {busyRow?.id === student.id && busyRow.action === 'qr' ? '...' : 'QR'}
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Oldingi
          </button>
          <span className="text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Keyingi
          </button>
        </div>
      )}

      {botPopup && (
        <BotActionPopup
          mode={botPopup.mode}
          studentName={botPopup.studentName}
          qrDataUrl={botPopup.qrDataUrl}
          link={botPopup.link}
          fileNameHint={botPopup.fileNameHint}
          onClose={() => setBotPopup(null)}
        />
      )}

      {selectedStudentId && (
        <StudentDetailModal
          customerId={selectedStudentId}
          onClose={() => setSelectedStudentId(null)}
          regions={filterOptions?.regions ?? []}
        />
      )}
    </div>
  );
}
