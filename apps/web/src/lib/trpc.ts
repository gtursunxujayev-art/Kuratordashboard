import { createTRPCReact, type CreateTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@kuratordashboard/api-types';

export const trpc: CreateTRPCReact<AppRouter, unknown, null> = createTRPCReact<AppRouter>();

function normalizeBaseUrl(url?: string) {
  return (url || 'http://localhost:3001').replace(/\/+$/, '');
}

const MOCK_PREVIEW_KEY = 'kd-mock-preview';

export function createTRPCClient() {
  const apiBaseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL);

  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${apiBaseUrl}/api/trpc`,
        headers() {
          const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
          const mockPreview = typeof window !== 'undefined' ? localStorage.getItem(MOCK_PREVIEW_KEY) : '0';
          return {
            Authorization: token ? `Bearer ${token}` : '',
            'x-kd-mock-preview': mockPreview === '1' ? '1' : '0',
          };
        },
      }),
    ],
    transformer: superjson,
  });
}

export const trpcClient = typeof window !== 'undefined' ? createTRPCClient() : (null as unknown as ReturnType<typeof createTRPCClient>);

export type { AppRouter };
