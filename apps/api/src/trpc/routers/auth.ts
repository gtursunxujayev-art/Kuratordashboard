import { router, publicProcedure, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { prisma } from '@kuratordashboard/db';
import { TRPCError } from '@trpc/server';
import { verifyPassword } from '../../services/auth/password';
import { signJWT } from '../../services/auth/jwt';

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

      const user = await prisma.user.findFirst({
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
        },
      });

      if (!user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: "Login yoki parol noto'g'ri",
        });
      }

      if (!user.passwordHash) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Bu akkauntda parol orqali kirish sozlanmagan. Admin bilan bog'laning.",
        });
      }

      const isValid = await verifyPassword(input.password, user.passwordHash);
      if (!isValid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: "Login yoki parol noto'g'ri",
        });
      }

      // Only allow Kuratordashboard roles
      const allowedRoles = ['Admin', 'Manager', 'Kurator'];
      const hasAccess = user.roles.some((r) => allowedRoles.includes(r));
      if (!hasAccess) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "Sizda bu tizimga kirish huquqi yo'q",
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
