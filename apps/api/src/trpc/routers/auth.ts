import { router, publicProcedure, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import { verifyPassword } from '../../services/auth/password';
import { signJWT } from '../../services/auth/jwt';

const KD_ALLOWED_ROLES = ['Admin', 'Manager', 'Kurator', 'Bosh Kurator'] as const;

type LoginUserCandidate = {
  id: string;
  tenantId: string;
  username: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  roles: string[];
  passwordHash: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

function mapAuthUser(user: LoginUserCandidate) {
  return {
    userId: user.id,
    tenantId: user.tenantId,
    roles: user.roles,
    username: user.username ?? undefined,
    name: user.name ?? undefined,
    email: user.email ?? undefined,
    phone: user.phone ?? undefined,
  };
}

function isTransientDatabaseConnectionError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toUpperCase();
  if (code === 'P1001' || code === 'P1002' || code === 'P1017') return true;

  const message = String((error as { message?: string })?.message || '').toLowerCase();
  return (
    message.includes("can't reach database server")
    || message.includes('timed out fetching a new connection')
    || message.includes('server has closed the connection')
  );
}

async function withDatabaseWakeRetry<T>(query: () => Promise<T>): Promise<T> {
  const delaysMs = [0, 1500, 3000];
  let lastError: unknown;

  for (const delayMs of delaysMs) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      return await query();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseConnectionError(error)) throw error;
    }
  }

  throw lastError;
}

function hasKDAccess(roles: string[]): boolean {
  return roles.some((role) => KD_ALLOWED_ROLES.includes(role as (typeof KD_ALLOWED_ROLES)[number]));
}

export async function chooseLoginCandidate(
  candidates: LoginUserCandidate[],
  password: string,
): Promise<LoginUserCandidate | null> {
  const passwordMatched: LoginUserCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.passwordHash) continue;
    if (!hasKDAccess(candidate.roles)) continue;

    const isValid = await verifyPassword(password, candidate.passwordHash);
    if (isValid) {
      passwordMatched.push(candidate);
    }
  }

  if (passwordMatched.length === 0) return null;
  if (passwordMatched.length === 1) return passwordMatched[0];
  throw new TRPCError({
    code: 'CONFLICT',
    message: 'Login bir nechta hisobga mos keldi. Global noyob username bilan kiring.',
  });
}

export const authRouter = router({
  loginWithPassword: publicProcedure
    .input(
      z.object({
        login: z.string().min(1),
        password: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const rawLogin = input.login.trim();
      const normalizedLogin = rawLogin.toLowerCase();
      const normalizedPhone = rawLogin.replace(/[^\d+]/g, '');
      const phoneCandidates = Array.from(
        new Set(
          [rawLogin, normalizedPhone, normalizedPhone.replace(/^\+/, ''), `+${normalizedPhone.replace(/^\+/, '')}`]
            .map((v) => v.trim())
            .filter((v) => v.length > 0),
        ),
      );

      const candidates = await withDatabaseWakeRetry(() =>
        prisma.user.findMany({
          where: {
            OR: [
              { username: rawLogin },
              { username: normalizedLogin },
              { email: rawLogin },
              { email: normalizedLogin },
              ...phoneCandidates.map((phone) => ({ phone })),
            ],
            isActive: true,
          },
          select: {
            id: true,
            tenantId: true,
            username: true,
            name: true,
            email: true,
            phone: true,
            roles: true,
            passwordHash: true,
            lastLoginAt: true,
            createdAt: true,
          },
          orderBy: [{ lastLoginAt: 'desc' }, { createdAt: 'desc' }],
          take: 50,
        }),
      );

      const user = await chooseLoginCandidate(candidates, input.password);
      if (!user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: "Login yoki parol noto'g'ri",
        });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const authUser = mapAuthUser(user);
      const token = signJWT(authUser);

      return {
        success: true,
        token,
        user: authUser,
      };
    }),

  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.user.userId },
      select: {
        id: true,
        tenantId: true,
        username: true,
        name: true,
        email: true,
        phone: true,
        roles: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Foydalanuvchi topilmadi' });
    }

    return user;
  }),
});
