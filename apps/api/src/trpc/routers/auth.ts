import { router, publicProcedure, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import { verifyPassword } from '../../services/auth/password';
import { signJWT } from '../../services/auth/jwt';

const KD_ALLOWED_ROLES = ['Admin', 'Manager', 'Kurator'] as const;

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

function hasKDAccess(roles: string[]): boolean {
  return roles.some((role) => KD_ALLOWED_ROLES.includes(role as (typeof KD_ALLOWED_ROLES)[number]));
}

async function chooseLoginCandidate(
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

  const tenantIds = Array.from(new Set(passwordMatched.map((candidate) => candidate.tenantId)));
  const [tenantIncomeCounts, tenantCustomerCounts, tenantCourseCounts] = await Promise.all([
    prisma.income.groupBy({
      by: ['tenantId'],
      where: {
        tenantId: { in: tenantIds },
        type: 'new_sale',
        lifecycleStatus: 'active',
      },
      _count: { id: true },
    }),
    prisma.customer.groupBy({
      by: ['tenantId'],
      where: {
        tenantId: { in: tenantIds },
      },
      _count: { id: true },
    }),
    prisma.course.groupBy({
      by: ['tenantId'],
      where: {
        tenantId: { in: tenantIds },
        isActive: true,
      },
      _count: { id: true },
    }),
  ]);

  const incomeCountByTenant = new Map(
    tenantIncomeCounts.map((row) => [row.tenantId, row._count.id]),
  );
  const customerCountByTenant = new Map(
    tenantCustomerCounts.map((row) => [row.tenantId, row._count.id]),
  );
  const courseCountByTenant = new Map(
    tenantCourseCounts.map((row) => [row.tenantId, row._count.id]),
  );

  passwordMatched.sort((left, right) => {
    const rightIncomeCount = incomeCountByTenant.get(right.tenantId) ?? 0;
    const leftIncomeCount = incomeCountByTenant.get(left.tenantId) ?? 0;
    if (rightIncomeCount !== leftIncomeCount) {
      return rightIncomeCount - leftIncomeCount;
    }

    const rightCustomerCount = customerCountByTenant.get(right.tenantId) ?? 0;
    const leftCustomerCount = customerCountByTenant.get(left.tenantId) ?? 0;
    if (rightCustomerCount !== leftCustomerCount) {
      return rightCustomerCount - leftCustomerCount;
    }

    const rightCourseCount = courseCountByTenant.get(right.tenantId) ?? 0;
    const leftCourseCount = courseCountByTenant.get(left.tenantId) ?? 0;
    if (rightCourseCount !== leftCourseCount) {
      return rightCourseCount - leftCourseCount;
    }

    const rightLastLogin = right.lastLoginAt?.getTime() ?? 0;
    const leftLastLogin = left.lastLoginAt?.getTime() ?? 0;
    if (rightLastLogin !== leftLastLogin) {
      return rightLastLogin - leftLastLogin;
    }

    return right.createdAt.getTime() - left.createdAt.getTime();
  });

  return passwordMatched[0];
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

      const candidates = await prisma.user.findMany({
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
      });

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

      const token = signJWT({
        userId: user.id,
        tenantId: user.tenantId,
        roles: user.roles,
        username: user.username ?? undefined,
        name: user.name ?? undefined,
        email: user.email ?? undefined,
        phone: user.phone ?? undefined,
      });

      return {
        success: true,
        token,
        user: {
          userId: user.id,
          tenantId: user.tenantId,
          roles: user.roles,
          username: user.username ?? undefined,
          name: user.name ?? undefined,
          email: user.email ?? undefined,
          phone: user.phone ?? undefined,
        },
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
