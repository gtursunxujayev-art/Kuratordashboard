'use client';

import { useState } from 'react';

type Props = {
  mode: 'qr' | 'link';
  studentName: string;
  qrDataUrl?: string;
  link?: string | null;
  fileNameHint?: string;
  onClose: () => void;
};

export function BotActionPopup({ mode, studentName, qrDataUrl, link, fileNameHint, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the link stays visible below so it can be copied by hand.
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white shadow-xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-900 truncate">{studentName}</p>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
            x
          </button>
        </div>

        <div className="p-5 space-y-3">
          {mode === 'qr' && qrDataUrl && (
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR chipta" className="w-56 h-56 border border-gray-200 rounded-lg" />
              <a
                href={qrDataUrl}
                download={`qr-${fileNameHint ?? studentName}.png`}
                className="text-xs text-blue-600 underline"
              >
                Yuklab olish
              </a>
              <p className="text-[11px] text-gray-500 text-center">
                Yangi QR yaratildi — bu o&apos;quvchining oldingi QR kodi endi ishlamaydi.
              </p>
            </div>
          )}

          {mode === 'link' && (
            link ? (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Botga ulanish havolasi (7 kun amal qiladi)</p>
                <p className="text-xs break-all bg-gray-50 border border-gray-200 rounded-lg p-2 select-all">{link}</p>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                >
                  {copied ? 'Nusxalandi ✓' : 'Nusxalash'}
                </button>
              </div>
            ) : (
              <p className="text-sm text-red-600">
                Havola yaratilmadi. CLIENT_BOT_USERNAME sozlanmagan bo&apos;lishi mumkin.
              </p>
            )
          )}
        </div>
      </div>
    </div>
  );
}
