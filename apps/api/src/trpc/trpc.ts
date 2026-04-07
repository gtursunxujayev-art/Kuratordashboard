import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context';
import superjson from 'superjson';
import { prisma } from '@kuratordashboard/db';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof Error && error.cause.name === 'ZodError'
            ? error.cause
            : null,
      },
    };
  },
});

export const router = t.router;

function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function pick<T>(items: T[], seed: string): T {
  return items[hashSeed(seed) % items.length];
}

function fakeName(seed: string): string {
  const first = pick(['Ali', 'Aziza', 'Behruz', 'Dildora', 'Jasur', 'Madina', 'Sardor', 'Nilufar'], `${seed}:f`);
  const last = pick(['Karimov', 'Qodirova', 'Rasulov', 'Abdullayeva', 'Usmonov', 'Nurmatova'], `${seed}:l`);
  return `${first} ${last}`;
}

function fakeNumber(seed: string): string {
  const base = 100000000 + (hashSeed(seed) % 900000000);
  return String(base);
}

function fakeTelegram(seed: string): string {
  return `@mock_${(hashSeed(seed) % 99999).toString().padStart(5, '0')}`;
}

function fakeRegion(seed: string): string {
  return pick(['Toshkent', 'Samarqand', 'Buxoro', 'Andijon', 'Namangan', 'Fargona'], seed);
}

function fakeCourse(seed: string): string {
  return pick(['Ofline Plus', 'Online Start', 'Intensiv Pro'], seed);
}

function fakeTariff(seed: string): string {
  return pick(['Start', 'Standart', 'Premium', 'VIP'], seed);
}

function fakeEmail(seed: string): string {
  return `mock${hashSeed(seed) % 10000}@example.test`;
}

function fakeText(seed: string): string {
  return `Mock-${hashSeed(seed) % 100000}`;
}

function fakeDate(seed: string): Date {
  const base = new Date('2026-03-01T00:00:00.000Z').getTime();
  const shifted = base + (hashSeed(seed) % (1000 * 60 * 60 * 24 * 40));
  return new Date(shifted);
}

function shouldKeepKey(key: string): boolean {
  return /(^id$|Id$|ID$|tenantId$|page$|limit$|offset$|cursor$|status$|orderIndex$|type$|lessonType$|roles$|isActive$)/.test(key);
}

function maskString(key: string, value: string, seed: string): string {
  if (!value) return value;
  if (shouldKeepKey(key)) return value;
  if (key.toLowerCase().includes('name')) return fakeName(seed);
  if (key.toLowerCase().includes('telegram')) return fakeTelegram(seed);
  if (key.toLowerCase().includes('username')) return fakeTelegram(seed).replace('@', '');
  if (key.toLowerCase().includes('email')) return fakeEmail(seed);
  if (key.toLowerCase().includes('phone')) return fakeNumber(seed);
  if (key.toLowerCase().includes('number')) return fakeNumber(seed);
  if (key.toLowerCase().includes('region')) return fakeRegion(seed);
  if (key.toLowerCase().includes('course')) return fakeCourse(seed);
  if (key.toLowerCase().includes('tariff')) return fakeTariff(seed);
  if (key.toLowerCase().includes('title') || key.toLowerCase().includes('note')) return fakeText(seed);
  if (key.toLowerCase().includes('date') || key.endsWith('At')) {
    return fakeDate(seed).toISOString();
  }
  return value;
}

function maskNumber(key: string, value: number, seed: string): number {
  if (shouldKeepKey(key)) return value;
  if (/(total|count|male|female|percent|attended|pending|completed|missed|lessons|logs|done|target)/i.test(key)) {
    return (hashSeed(seed) % 90) + 1;
  }
  return value;
}

function maskResponseData(value: unknown, path: string[] = []): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return fakeDate(path.join('.'));
  if (Array.isArray(value)) return value.map((item, index) => maskResponseData(item, [...path, String(index)]));

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      if (shouldKeepKey(key)) {
        out[key] = item;
        continue;
      }
      out[key] = maskResponseData(item, [...path, key]);
    }
    return out;
  }

  const currentKey = path[path.length - 1] ?? '';
  const seed = path.join('.');

  if (typeof value === 'string') return maskString(currentKey, value, seed);
  if (typeof value === 'number') return maskNumber(currentKey, value, seed);

  return value;
}

const mockPreviewMiddleware = t.middleware(async (opts) => {
  if (
    opts.ctx.mockPreview
    && opts.type === 'mutation'
    && opts.path !== 'settings.setMockPreview'
    && opts.path !== 'auth.loginWithPassword'
  ) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: "Mock rejim yoqilgan. O'zgartirishlar vaqtincha bloklangan.",
    });
  }

  const result = await opts.next();
  if (!opts.ctx.mockPreview || !result.ok) return result;
  return {
    ...result,
    data: maskResponseData(result.data),
  };
});

export const publicProcedure = t.procedure.use(mockPreviewMiddleware);

function isMissingTenantContextFunctionError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('app.set_tenant_context')
    || (message.includes('schema') && message.includes('app') && message.includes('does not exist'))
    || (message.includes('function') && message.includes('set_tenant_context') && message.includes('does not exist'))
  );
}

export const protectedProcedure = publicProcedure.use(async (opts) => {
  const { ctx } = opts;

  if (!ctx.user || !ctx.tenantId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Tizimga kirish talab etiladi',
    });
  }

  try {
    await prisma.$executeRaw`SELECT app.set_tenant_context(${ctx.tenantId}::uuid, ${ctx.user.userId}::uuid)`;
  } catch (error: any) {
    if (isMissingTenantContextFunctionError(error)) {
      console.warn(
        '[Auth] Tenant context function is missing, falling back to explicit tenantId filters only:',
        error?.message,
      );
      return opts.next({
        ctx: {
          ...ctx,
          user: ctx.user,
          tenantId: ctx.tenantId,
        },
      });
    }

    console.error('[Auth] Failed to set tenant context for RLS:', error?.message);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Tenant database context is not configured',
    });
  }

  return opts.next({
    ctx: {
      ...ctx,
      user: ctx.user,
      tenantId: ctx.tenantId,
    },
  });
});

export const adminProcedure = protectedProcedure.use(async (opts) => {
  const { ctx } = opts;

  if (!ctx.user.roles.includes('Admin')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Faqat adminlar uchun',
    });
  }

  return opts.next();
});

export const managerProcedure = protectedProcedure.use(async (opts) => {
  const { ctx } = opts;
  const roles = ctx.user.roles;

  if (!roles.includes('Admin') && !roles.includes('Manager')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Faqat menejer yoki adminlar uchun',
    });
  }

  return opts.next();
});
