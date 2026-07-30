'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';

type AttendanceStatus = 'keldi' | 'kelmadi' | 'yolda';
type AttendanceValue = AttendanceStatus | '';
type AttendanceDay = 'dayOne' | 'dayTwo';

const statusMeta: Record<AttendanceStatus, { label: string; className: string }> = {
  keldi: { label: 'Keldi', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  kelmadi: { label: 'Kelmadi', className: 'border-red-200 bg-red-50 text-red-700' },
  yolda: { label: "Yo'lda", className: 'border-sky-200 bg-sky-50 text-sky-700' },
};

function formatMoney(amount: number): string {
  return `${new Intl.NumberFormat('uz-UZ').format(amount)} so'm`;
}

function formatDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('uz-UZ', { day: 'numeric', month: 'short' }).format(parsed);
}

function getTelegramFailureMessage(reason?: string): string {
  if (reason === 'dashboarduz_not_configured') {
    return 'Dashboarduz Telegram ulanishi sozlanmagan';
  }
  return 'Dashboarduz Telegram guruhiga yuborilmadi';
}

function AttendanceSelect({ value, onChange, disabled }: { value: AttendanceValue; onChange: (next: AttendanceStatus) => void; disabled?: boolean }) {
  const selectedClassName = value
    ? statusMeta[value].className
    : 'border-[var(--kd-border)] bg-[var(--kd-surface)] text-[var(--kd-muted)]';

  return (
    <select
      aria-label="Davomat holati"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as AttendanceStatus)}
      className={`w-full min-w-[122px] rounded-lg border px-2.5 py-2 text-sm font-medium outline-none disabled:cursor-not-allowed disabled:opacity-60 ${selectedClassName}`}
    >
      <option value="" disabled>Tanlang</option>
      {Object.entries(statusMeta).map(([status, meta]) => <option key={status} value={status}>{meta.label}</option>)}
    </select>
  );
}

export default function IntensivPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const utils = trpc.useContext();
  const [courseId, setCourseId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [subTariffId, setSubTariffId] = useState('');
  const [attendanceDrafts, setAttendanceDrafts] = useState<Record<string, AttendanceStatus>>({});
  const [paymentDrafts, setPaymentDrafts] = useState<Record<string, string>>({});
  const [savingAttendanceKeys, setSavingAttendanceKeys] = useState<Record<string, boolean>>({});
  const [payingSaleId, setPayingSaleId] = useState<string | null>(null);

  const coursesQuery = trpc.intensiv.courses.useQuery(undefined, { enabled: isManager });
  const tariffsQuery = trpc.intensiv.tariffs.useQuery({ courseId }, { enabled: isManager && Boolean(courseId) });
  const subTariffsQuery = trpc.intensiv.subTariffs.useQuery({ tariffId }, { enabled: isManager && Boolean(tariffId) });
  const listQuery = trpc.intensiv.list.useQuery(
    { courseId, tariffId, ...(subTariffId ? { subTariffId } : {}) },
    { enabled: isManager && Boolean(courseId && tariffId) },
  );
  const saveAttendance = trpc.intensiv.saveAttendance.useMutation();
  const recordPayment = trpc.intensiv.recordPayment.useMutation();

  const students = useMemo(() => listQuery.data?.students ?? [], [listQuery.data?.students]);
  const summary = useMemo(() => {
    const statuses = students.flatMap((student) => {
      return [
        attendanceDrafts[`${student.saleId}:dayOne`] ?? student.dayOneStatus,
        attendanceDrafts[`${student.saleId}:dayTwo`] ?? student.dayTwoStatus,
      ];
    });
    const totalDebt = students.reduce((sum, student) => sum + student.remainingDebt, 0);
    return {
      students: students.length,
      present: statuses.filter((status) => status === 'keldi').length,
      debtors: students.filter((student) => student.remainingDebt > 0).length,
      totalDebt,
    };
  }, [attendanceDrafts, students]);

  const clearRowDrafts = () => {
    setAttendanceDrafts({});
    setPaymentDrafts({});
  };

  const saveAttendanceDay = async (
    student: (typeof students)[number],
    day: AttendanceDay,
    status: AttendanceStatus,
  ) => {
    const cellKey = `${student.saleId}:${day}`;
    setAttendanceDrafts((current) => ({ ...current, [cellKey]: status }));
    setSavingAttendanceKeys((current) => ({ ...current, [cellKey]: true }));
    try {
      await saveAttendance.mutateAsync({ saleId: student.saleId, day, status });
      await utils.intensiv.list.invalidate();
      setAttendanceDrafts((current) => {
        if (current[cellKey] !== status) return current;
        const { [cellKey]: _, ...rest } = current;
        return rest;
      });
    } catch (error) {
      setAttendanceDrafts((current) => {
        const { [cellKey]: _, ...rest } = current;
        return rest;
      });
      toast.show(error instanceof Error ? error.message : 'Davomatni saqlab bo\'lmadi', 'error');
    } finally {
      setSavingAttendanceKeys((current) => {
        const { [cellKey]: _, ...rest } = current;
        return rest;
      });
    }
  };

  const pay = async (student: (typeof students)[number]) => {
    const amount = Number((paymentDrafts[student.saleId] || '').replace(/\D/g, ''));
    if (!Number.isInteger(amount) || amount <= 0 || amount > student.remainingDebt) {
      toast.show("To'lov summasi 1 so'mdan katta va qolgan qarzdan oshmasligi kerak", 'error');
      return;
    }
    setPayingSaleId(student.saleId);
    try {
      const result = await recordPayment.mutateAsync({ saleId: student.saleId, amount });
      setPaymentDrafts((current) => ({ ...current, [student.saleId]: '' }));
      await utils.intensiv.list.invalidate();
      if (result.telegram.delivered) {
        toast.show("To'lov saqlandi va Dashboarduz orqali Telegramga yuborildi", 'success');
      } else {
        toast.show(`To'lov saqlandi, ammo ${getTelegramFailureMessage(result.telegram.reason)}`, 'error');
      }
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "To'lovni saqlab bo'lmadi", 'error');
    } finally {
      setPayingSaleId(null);
    }
  };

  if (!isManager) {
    return <div className="nn-page"><div className="nn-table-card p-8 text-center kd-subtle">Bu sahifa faqat admin va menejerlar uchun.</div></div>;
  }

  return (
    <div className="nn-page intensiv-page">
      <section className="nn-hero intensiv-hero">
        <h1>Intensiv davomat va to'lovlar</h1>
      </section>

      <section className="nn-filter-card intensiv-filter-card">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-medium kd-title">Kurs
            <select value={courseId} onChange={(event) => { setCourseId(event.target.value); setTariffId(''); setSubTariffId(''); clearRowDrafts(); }} className="nn-form-control mt-1">
              <option value="">Kursni tanlang</option>
              {coursesQuery.data?.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium kd-title">Tarif
            <select value={tariffId} disabled={!courseId} onChange={(event) => { setTariffId(event.target.value); setSubTariffId(''); clearRowDrafts(); }} className="nn-form-control mt-1 disabled:opacity-60">
              <option value="">Tarifni tanlang</option>
              {tariffsQuery.data?.map((tariff) => <option key={tariff.id} value={tariff.id}>{tariff.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium kd-title">Sub tarif
            <select value={subTariffId} disabled={!tariffId} onChange={(event) => { setSubTariffId(event.target.value); clearRowDrafts(); }} className="nn-form-control mt-1 disabled:opacity-60">
              <option value="">Barcha sub tariflar</option>
              {subTariffsQuery.data?.map((subTariff) => <option key={subTariff.id} value={subTariff.id}>{subTariff.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      {listQuery.data && <section className="nn-kpi-grid grid-cols-2 lg:grid-cols-4">
        <div className="nn-kpi-card"><span className="nn-kpi-icon">{summary.students}</span><span><p>O'quvchi</p><strong>{summary.students}</strong></span></div>
        <div className="nn-kpi-card"><span className="nn-kpi-icon bg-emerald-100 text-emerald-700">{summary.present}</span><span><p>Keldi</p><strong>{summary.present}</strong></span></div>
        <div className="nn-kpi-card"><span className="nn-kpi-icon bg-orange-100 text-orange-700">{summary.debtors}</span><span><p>Qarzdor</p><strong>{summary.debtors}</strong></span></div>
        <div className="nn-kpi-card"><span className="nn-kpi-icon bg-rose-100 text-rose-700">₮</span><span><p>Jami qarz</p><strong className="text-base">{formatMoney(summary.totalDebt)}</strong></span></div>
      </section>}

      <section className="nn-table-card overflow-hidden">
        {!courseId || !tariffId ? (
          <div className="p-10 text-center kd-subtle">Davomat va qarzlarni ko'rish uchun Kurs va Tarifni tanlang.</div>
        ) : listQuery.isLoading ? (
          <div className="p-10 text-center kd-subtle">Yuklanmoqda...</div>
        ) : listQuery.error ? (
          <div className="p-10 text-center text-red-600">{listQuery.error.message}</div>
        ) : students.length === 0 ? (
          <div className="p-10 text-center kd-subtle">Tanlangan Kurs, Tarif va Sub tarif uchun faol o'quvchi topilmadi.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead className="bg-[#fff8ef] text-[var(--kd-text)]">
                <tr className="border-b border-[var(--kd-border)]">
                  <th className="px-4 py-3 text-left font-semibold">O'quvchi</th>
                  <th className="px-4 py-3 text-left font-semibold">Telefon</th>
                  <th className="px-4 py-3 text-left font-semibold">1-kun <span className="kd-subtle font-normal">{formatDay(listQuery.data.dates.dayOne)}</span></th>
                  <th className="px-4 py-3 text-left font-semibold">2-kun <span className="kd-subtle font-normal">{formatDay(listQuery.data.dates.dayTwo)}</span></th>
                  <th className="px-4 py-3 text-right font-semibold">Qolgan qarz</th>
                  <th className="px-4 py-3 text-left font-semibold">To'lov</th>
                  <th className="px-4 py-3 text-right font-semibold">Amal</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => {
                  const dayOneKey = `${student.saleId}:dayOne`;
                  const dayTwoKey = `${student.saleId}:dayTwo`;
                  const dayOne = attendanceDrafts[dayOneKey] ?? student.dayOneStatus ?? '';
                  const dayTwo = attendanceDrafts[dayTwoKey] ?? student.dayTwoStatus ?? '';
                  const payment = paymentDrafts[student.saleId] || '';
                  const paymentAmount = Number(payment.replace(/\D/g, ''));
                  const paymentInvalid = Boolean(payment) && (!paymentAmount || paymentAmount > student.remainingDebt);
                  return <tr key={student.saleId} className="border-b border-[var(--kd-border)] last:border-0">
                    <td className="px-4 py-3 font-semibold kd-title whitespace-nowrap">{student.name}</td>
                    <td className="px-4 py-3 kd-subtle whitespace-nowrap">{student.phone}</td>
                    <td className="px-4 py-3"><AttendanceSelect value={dayOne} disabled={savingAttendanceKeys[dayOneKey]} onChange={(value) => void saveAttendanceDay(student, 'dayOne', value)} /></td>
                    <td className="px-4 py-3"><AttendanceSelect value={dayTwo} disabled={savingAttendanceKeys[dayTwoKey]} onChange={(value) => void saveAttendanceDay(student, 'dayTwo', value)} /></td>
                    <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${student.remainingDebt ? 'text-rose-700' : 'kd-subtle'}`}>{student.remainingDebt ? formatMoney(student.remainingDebt) : '—'}</td>
                    <td className="px-4 py-3"><input value={payment} disabled={!student.remainingDebt || payingSaleId === student.saleId} inputMode="numeric" placeholder="0" onChange={(event) => setPaymentDrafts((current) => ({ ...current, [student.saleId]: event.target.value.replace(/\D/g, '') }))} className={`nn-form-control min-w-[130px] !py-2 text-center tabular-nums ${paymentInvalid ? '!border-red-400' : ''}`} /></td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-2">
                      <button type="button" disabled={!student.remainingDebt || paymentInvalid || !paymentAmount || payingSaleId === student.saleId} onClick={() => void pay(student)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">{payingSaleId === student.saleId ? 'Yuborilmoqda...' : "To'lov"}</button>
                    </div></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
