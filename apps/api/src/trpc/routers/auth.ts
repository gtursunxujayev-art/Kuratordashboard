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
      const normalizedLogin = input.login.trim().toLowerCase();

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username: normalizedLogin },
            { email: normalizedLogin },
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

      if (!user || !user.passwordHash) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: "Login yoki parol noto'g'ri",
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
