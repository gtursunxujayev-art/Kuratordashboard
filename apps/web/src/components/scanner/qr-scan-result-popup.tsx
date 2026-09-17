'use client';

import { useEffect } from 'react';

export type QrScanResult = {
  status: 'marked' | 'already_marked' | 'manual_mark_kept' | 'invalid_ticket' | 'not_class_day' | 'no_lesson';
  customerName?: string;
  customerNumber?: string;
  tariffName?: string | null;
  courseName?: string | null;
  agreementAmount?: number;
  remainingDebt?: number;
};

const POPUP_VISIBLE_MS = 5000;

function statusLabel(status: QrScanResult['status']): { text: string; tone: 'success' | 'info' | 'error' } {
  switch (status) {
    case 'marked':
      return { text: 'Keldi ✓', tone: 'success' };
    case 'already_marked':
      return { text: 'Allaqachon belgilangan', tone: 'info' };
    case 'manual_mark_kept':
      return { text: "Qo'lda belgilangan holat saqlandi", tone: 'info' };
    case 'invalid_ticket':
      return { text: 'QR chipta yaroqsiz', tone: 'error' };
    case 'not_class_day':
      return { text: 'Bugun dars kuni emas', tone: 'error' };
    case 'no_lesson':
      return { text: 'Bugun bu oqim uchun dars yo‘q', tone: 'error' };
    default:
      return { text: '', tone: 'info' };
  }
}

function formatMoney(value?: number): string {
  if (value === undefined || value === null) return '-';
  return new Intl.NumberFormat('uz-UZ').format(value) + " so'm";
}

export function QrScanResultPopup({ result, onClose }: { result: QrScanResult; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, POPUP_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [result, onClose]);

  const { text, tone } = statusLabel(result.status);
  const accent = tone === 'success' ? '#16a34a' : tone === 'error' ? '#dc2626' : '#475569';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-live="assertive"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-4 text-white" style={{ background: accent }}>
          <p className="text-lg font-bold">{text}</p>
        </div>

        <div className="p-6 space-y-3">
          <div>
            <p className="text-xs text-gray-500">O&apos;quvchi</p>
            <p className="text-xl font-bold text-gray-900">{result.customerName ?? '-'}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-gray-500">Telefon</p>
              <p className="text-sm font-medium text-gray-900">{result.customerNumber ?? '-'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Tarif</p>
              <p className="text-sm font-medium text-gray-900">{result.tariffName ?? '-'}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-gray-500">Kurs</p>
              <p className="text-sm font-medium text-gray-900">{result.courseName ?? '-'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Shartnoma</p>
              <p className="text-sm font-medium text-gray-900">{formatMoney(result.agreementAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Qarzi</p>
              <p
                className="text-sm font-bold"
                style={{ color: (result.remainingDebt ?? 0) > 0 ? '#dc2626' : '#16a34a' }}
              >
                {formatMoney(result.remainingDebt)}
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 text-sm font-medium text-gray-600 border-t border-gray-200 hover:bg-gray-50"
        >
          Yopish
        </button>
      </div>
    </div>
  );
}
