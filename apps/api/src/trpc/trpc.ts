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

export const publicProcedure = t.procedure;

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

  const dbUser = await prisma.user.findFirst({
    where: {
      id: ctx.user.userId,
      tenantId: ctx.tenantId,
      isActive: true,
    },
    select: {
      id: true,
      tenantId: true,
      roles: true,
      username: true,
      name: true,
      email: true,
      phone: true,
    },
  });

  if (!dbUser) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Tizimga kirish talab etiladi',
    });
  }

  const revalidatedUser = {
    userId: dbUser.id,
    tenantId: dbUser.tenantId,
    roles: dbUser.roles,
    username: dbUser.username ?? undefined,
    name: dbUser.name ?? undefined,
    email: dbUser.email ?? undefined,
    phone: dbUser.phone ?? undefined,
  };

  try {
    await prisma.$executeRaw`SELECT app.set_tenant_context(${revalidatedUser.tenantId}::uuid, ${revalidatedUser.userId}::uuid)`;
  } catch (error: any) {
    if (isMissingTenantContextFunctionError(error)) {
      console.warn(
        '[Auth] Tenant context function is missing, falling back to explicit tenantId filters only:',
        error?.message,
      );
      return opts.next({
        ctx: {
          ...ctx,
          user: revalidatedUser,
          tenantId: revalidatedUser.tenantId,
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
      user: revalidatedUser,
      tenantId: revalidatedUser.tenantId,
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

  if (!roles.includes('Admin') && !roles.includes('Manager') && !roles.includes('Bosh Kurator')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Faqat menejer yoki adminlar uchun',
    });
  }

  return opts.next();
});
