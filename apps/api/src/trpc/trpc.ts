import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context';
import superjson from 'superjson';

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

export const protectedProcedure = t.procedure.use(async (opts) => {
  const { ctx } = opts;

  if (!ctx.user || !ctx.tenantId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Tizimga kirish talab etiladi',
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
