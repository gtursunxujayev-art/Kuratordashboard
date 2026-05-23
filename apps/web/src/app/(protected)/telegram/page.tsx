'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

export default function TelegramPage() {
  const { isLoading, isManager, isKurator } = useAuth();
  const router = useRouter();
  const canUsePage = isManager || isKurator;

  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);

  const selfStatusQuery = trpc.settings.telegramSelfStatus.useQuery(undefined, {
    enabled: canUsePage,
  });

  const createTokenMutation = trpc.settings.createTelegramLinkToken.useMutation({
    onSuccess: async (result) => {
      setError('');
      setSuccess('Telegram ulash tokeni yaratildi.');
      setToken(result.token);
      setDeepLink(result.deepLink ?? null);
      await selfStatusQuery.refetch();
    },
    onError: (err) => {
      setSuccess('');
      setError(err.message);
    },
  });

  if (!isLoading && !canUsePage) {
    router.replace('/dashboard');
    return null;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold kd-title">Telegram</h1>

      <div className="kd-card p-4 space-y-3">
        <p className="text-sm kd-subtle">
          Bu sahifa orqali o&apos;zingizning Telegram chatni bog&apos;lab, hisobotlarni qabul qilishingiz mumkin.
        </p>
        <p className="text-xs kd-subtle">Token bir marta ishlatiladi va 30 daqiqada tugaydi.</p>
        <p className="text-xs kd-subtle">Timezone: {selfStatusQuery.data?.timezone ?? 'Asia/Tashkent'}</p>
        <p className="text-xs kd-subtle">
          Bot sozlangan: {selfStatusQuery.data?.configured ? 'Ha' : "Yo'q"}
          {selfStatusQuery.data?.botUsername ? ` (@${selfStatusQuery.data.botUsername})` : ''}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => createTokenMutation.mutate()}
            disabled={createTokenMutation.isLoading}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
          >
            {createTokenMutation.isLoading ? 'Yaratilmoqda...' : 'Telegram ulash tokeni olish'}
          </button>
        </div>

        {deepLink && (
          <p className="text-sm break-all">
            Deep-link:{' '}
            <a href={deepLink} target="_blank" rel="noreferrer" className="text-blue-600 underline">
              {deepLink}
            </a>
          </p>
        )}
        {token && <p className="text-xs kd-subtle break-all">Token: {token}</p>}

        {selfStatusQuery.data?.receiver ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 space-y-1">
            <p>
              Ulangan chat: <span className="font-semibold">{selfStatusQuery.data.receiver.telegramName ?? '-'}</span>
            </p>
            <p>Username: {selfStatusQuery.data.receiver.username ? `@${selfStatusQuery.data.receiver.username}` : '-'}</p>
            <p>TG ID: {selfStatusQuery.data.receiver.chatId}</p>
          </div>
        ) : (
          <p className="text-sm text-red-600">Siz uchun Telegram receiver hali bog&apos;lanmagan.</p>
        )}

        {selfStatusQuery.error && <p className="text-sm text-red-600">{selfStatusQuery.error.message}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}
      </div>
    </div>
  );
}

