'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

interface Props {
  customerId: string;
  onClose: () => void;
}

export function StudentDetailModal({ customerId, onClose }: Props) {
  const { isAdmin, isManager } = useAuth();
  const utils = trpc.useContext();

  const { data: student, isLoading } = trpc.students.detail.useQuery({ customerId });

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: '',
    customerNumber: '',
    telegramUsername: '',
    gender: '' as 'male' | 'female' | '',
    region: '',
    secondaryPhone: '',
    specialty: '',
    address: '',
    instagramUsername: '',
    socialMediaConsent: 'unknown' as 'unknown' | 'yes' | 'no',
  });

  const updateMutation = trpc.students.update.useMutation({
    onSuccess: () => {
      void utils.students.detail.invalidate({ customerId });
      void utils.students.list.invalidate();
      setEditing(false);
    },
  });

  const startEditing = () => {
    if (!student) return;
    setForm({
      name: student.name,
      customerNumber: student.customerNumber ?? '',
      telegramUsername: student.telegramUsername ?? '',
      gender: (student.gender as 'male' | 'female') ?? '',
      region: student.region ?? '',
      secondaryPhone: student.secondaryPhone ?? '',
      specialty: student.specialty ?? '',
      address: student.address ?? '',
      instagramUsername: student.instagramUsername ?? '',
      socialMediaConsent: socialConsentToFormValue(student.socialMediaConsent),
    });
    setEditing(true);
  };

  const handleSave = () => {
    updateMutation.mutate({
      customerId,
      name: form.name || undefined,
      customerNumber: form.customerNumber || undefined,
      telegramUsername: form.telegramUsername || undefined,
      gender: form.gender || undefined,
      region: form.region || undefined,
      secondaryPhone: form.secondaryPhone,
      specialty: form.specialty,
      address: form.address,
      instagramUsername: form.instagramUsername,
      socialMediaConsent:
        form.socialMediaConsent === 'unknown' ? null : form.socialMediaConsent === 'yes',
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">
            {isLoading ? 'Yuklanmoqda...' : student?.name ?? "O'quvchi"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            x
          </button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Yuklanmoqda...</div>
        ) : student ? (
          <div className="p-5 space-y-4">
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Ism</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-blue-500 mt-0.5">Dashboard bilan sinxronlashadi</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Raqam</label>
                  <input
                    value={form.customerNumber}
                    onChange={(e) => setForm({ ...form, customerNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Mijoz raqami"
                  />
                  <p className="text-xs text-blue-500 mt-0.5">Dashboard bilan sinxronlashadi</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Telegram</label>
                  <input
                    value={form.telegramUsername}
                    onChange={(e) => setForm({ ...form, telegramUsername: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="username"
                  />
                  <p className="text-xs text-blue-500 mt-0.5">Dashboard bilan sinxronlashadi</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Jins</label>
                  <select
                    value={form.gender}
                    onChange={(e) =>
                      setForm({ ...form, gender: e.target.value as 'male' | 'female' | '' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Tanlanmagan</option>
                    <option value="male">Erkak</option>
                    <option value="female">Ayol</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Viloyat</label>
                  <input
                    value={form.region}
                    onChange={(e) => setForm({ ...form, region: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Ikkinchi telefon raqam</label>
                  <input
                    value={form.secondaryPhone}
                    onChange={(e) => setForm({ ...form, secondaryPhone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="+998..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Sohasi</label>
                  <input
                    value={form.specialty}
                    onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Masalan: SMM, IT, Sotuv"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Yashash manzili</label>
                  <input
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Instagram</label>
                  <input
                    value={form.instagramUsername}
                    onChange={(e) => setForm({ ...form, instagramUsername: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="username"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Ijtimoiy tarmoqqa rozi</label>
                  <select
                    value={form.socialMediaConsent}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        socialMediaConsent: e.target.value as 'unknown' | 'yes' | 'no',
                      })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="unknown">Tanlanmagan</option>
                    <option value="yes">Ha</option>
                    <option value="no">Yo&apos;q</option>
                  </select>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleSave}
                    disabled={updateMutation.isLoading}
                    className="flex-1 py-2 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {updateMutation.isLoading ? 'Saqlanmoqda...' : 'Saqlash'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="flex-1 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50"
                  >
                    Bekor qilish
                  </button>
                </div>

                {updateMutation.error && (
                  <p className="text-sm text-red-600">{updateMutation.error.message}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <InfoRow label="Ism" value={student.name} />
                <InfoRow label="Raqam" value={student.customerNumber ?? '-'} />
                <InfoRow
                  label="Telegram"
                  value={student.telegramUsername ? `@${student.telegramUsername}` : '-'}
                />
                <InfoRow
                  label="Jins"
                  value={student.gender === 'male' ? 'Erkak' : student.gender === 'female' ? 'Ayol' : '-'}
                />
                <InfoRow label="Viloyat" value={student.region ?? '-'} />
                <InfoRow label="Ikkinchi telefon raqam" value={student.secondaryPhone ?? '-'} />
                <InfoRow label="Sohasi" value={student.specialty ?? '-'} />
                <InfoRow label="Yashash manzili" value={student.address ?? '-'} />
                <InfoRow
                  label="Instagram"
                  value={student.instagramUsername ? `@${student.instagramUsername}` : '-'}
                />
                <InfoRow
                  label="Ijtimoiy tarmoqqa rozi"
                  value={socialConsentToLabel(student.socialMediaConsent)}
                />

                {student.incomes.length > 0 && (
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs font-medium text-gray-500 mb-2">Kurs ma&apos;lumotlari</p>
                    {student.incomes.slice(0, 3).map((income) => (
                      <div
                        key={income.id}
                        className="text-sm text-gray-700 mb-1 flex justify-between"
                      >
                        <span>
                          {income.course?.name ?? '-'} / {income.tariff?.name ?? '-'}
                        </span>
                        <span className="text-gray-400 text-xs">
                          {new Date(income.entryDate).toLocaleDateString('uz-UZ')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {(isAdmin || isManager) && (
                  <button
                    onClick={startEditing}
                    className="w-full mt-2 py-2 border border-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
                  >
                    Tahrirlash
                  </button>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function socialConsentToFormValue(value: boolean | null | undefined): 'unknown' | 'yes' | 'no' {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

function socialConsentToLabel(value: boolean | null | undefined): string {
  if (value === true) return 'Ha';
  if (value === false) return "Yo'q";
  return 'Tanlanmagan';
}
