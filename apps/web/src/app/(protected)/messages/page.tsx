'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Faylni o\'qib bo\'lmadi'));
    reader.readAsDataURL(file);
  });
}

export default function MessagesPage() {
  const { isLoading, isManager } = useAuth();
  const router = useRouter();

  const [courseId, setCourseId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoading && !isManager) router.replace('/dashboard');
  }, [isLoading, isManager, router]);

  const coursesQuery = trpc.settings.listCourses.useQuery(undefined, { enabled: isManager });
  const tariffsQuery = trpc.settings.listTariffsByCourse.useQuery(
    { courseId },
    { enabled: isManager && Boolean(courseId) },
  );

  const recipientsQuery = trpc.messages.listRecipients.useQuery(
    { courseId: courseId || undefined, tariffId: tariffId || undefined, search: search || undefined },
    { enabled: isManager },
  );

  const recipients = recipientsQuery.data ?? [];
  const allSelected = recipients.length > 0 && recipients.every((r) => selectedIds.has(r.id));

  useEffect(() => {
    // Default to selecting everyone matching the current filter.
    setSelectedIds(new Set(recipients.map((r) => r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientsQuery.dataUpdatedAt]);

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(recipients.map((r) => r.id)));
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sendMutation = trpc.messages.send.useMutation({
    onSuccess: (result) => {
      setError('');
      setSuccess(`Yuborildi: ${result.sent}, xato: ${result.failed}, o'tkazib yuborildi: ${result.skipped}`);
      setText('');
      setFile(null);
    },
    onError: (err) => {
      setSuccess('');
      setError(err.message);
    },
  });

  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);

  const handleSend = async () => {
    setError('');
    setSuccess('');
    if (!text.trim()) {
      setError("Xabar matnini kiriting");
      return;
    }
    if (selectedCount === 0) {
      setError("Kamida bitta qabul qiluvchi tanlang");
      return;
    }

    let attachment: { filename: string; mimeType: string; base64: string } | undefined;
    if (file) {
      const base64 = await fileToBase64(file);
      attachment = { filename: file.name, mimeType: file.type || 'application/octet-stream', base64 };
    }

    sendMutation.mutate({
      text: text.trim(),
      recipientCustomerIds: Array.from(selectedIds),
      attachment,
    });
  };

  if (!isLoading && !isManager) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold kd-title">Xabar yuborish</h1>

      <div className="kd-card p-4 space-y-3">
        <p className="text-sm kd-subtle">
          Telegram botga ulangan o&apos;quvchilarga matnli xabar va fayl/rasm yuboring.
        </p>

        <div className="flex flex-wrap gap-2">
          <select
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              setTariffId('');
            }}
            className="px-3 py-2 rounded-lg border text-sm"
          >
            <option value="">Barcha kurslar</option>
            {(coursesQuery.data ?? []).map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>

          <select
            value={tariffId}
            onChange={(e) => setTariffId(e.target.value)}
            disabled={!courseId}
            className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50"
          >
            <option value="">Barcha tariflar</option>
            {(tariffsQuery.data ?? []).map((tariff) => (
              <option key={tariff.id} value={tariff.id}>
                {tariff.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ism yoki raqam bo'yicha qidirish"
            className="px-3 py-2 rounded-lg border text-sm flex-1 min-w-[180px]"
          />
        </div>

        <div className="rounded-lg border max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-black/5">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Hammasini tanlash ({recipients.length})
            </label>
            <span className="text-xs kd-subtle">Tanlangan: {selectedCount}</span>
          </div>
          {recipientsQuery.isLoading && <p className="p-3 text-sm kd-subtle">Yuklanmoqda...</p>}
          {!recipientsQuery.isLoading && recipients.length === 0 && (
            <p className="p-3 text-sm kd-subtle">Ushbu filtr bo&apos;yicha Telegram botga ulangan o&apos;quvchi topilmadi.</p>
          )}
          {recipients.map((recipient) => (
            <label key={recipient.id} className="flex items-center gap-2 px-3 py-2 text-sm border-b last:border-b-0">
              <input
                type="checkbox"
                checked={selectedIds.has(recipient.id)}
                onChange={() => toggleOne(recipient.id)}
              />
              <span className="flex-1">{recipient.name}</span>
              <span className="text-xs kd-subtle">{recipient.customerNumber}</span>
            </label>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Xabar matni"
          rows={4}
          className="w-full px-3 py-2 rounded-lg border text-sm"
        />

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          {file && (
            <button type="button" onClick={() => setFile(null)} className="text-xs text-red-600 underline">
              Faylni olib tashlash
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={handleSend}
          disabled={sendMutation.isLoading}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
        >
          {sendMutation.isLoading ? 'Yuborilmoqda...' : `Yuborish (${selectedCount})`}
        </button>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}
      </div>
    </div>
  );
}
