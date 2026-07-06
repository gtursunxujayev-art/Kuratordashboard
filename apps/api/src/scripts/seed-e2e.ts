import { prisma } from '@kuratordashboard/db';
import { hashPassword } from '../services/auth/password';

async function main(): Promise<void> {
  const existing = await prisma.tenant.findUnique({ where: { subdomain: 'e2e-ci' }, select: { id: true } });
  if (existing) await prisma.tenant.delete({ where: { id: existing.id } });

  const tenant = await prisma.tenant.create({ data: { name: 'E2E Tenant', subdomain: 'e2e-ci' } });
  const passwordHash = await hashPassword('E2E-password-123!');
  const [admin, owner, otherKurator] = await Promise.all([
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        username: 'e2e-admin',
        name: 'E2E Admin',
        roles: ['Admin'],
        authProvider: 'local',
        passwordHash,
      },
    }),
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        username: 'e2e-owner',
        name: 'E2E Run Owner',
        roles: ['Kurator'],
        authProvider: 'local',
      },
    }),
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        username: 'e2e-other-kurator',
        name: 'E2E Other Kurator',
        roles: ['Kurator'],
        authProvider: 'local',
      },
    }),
  ]);
  const course = await prisma.course.create({
    data: { tenantId: tenant.id, name: 'E2E Course', category: 'online', isActive: true },
  });
  const tariff = await prisma.tariff.create({
    data: { tenantId: tenant.id, courseId: course.id, name: 'E2E Premium', isActive: true },
  });
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
  const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 35);
  const run = await prisma.courseRun.create({
    data: {
      tenantId: tenant.id,
      courseId: course.id,
      name: 'E2E Explicit Run',
      startDate,
      endDate,
      durationWeeks: 6,
      kuratorUserId: owner.id,
    },
  });
  const [audioExercise, sportExercise, completedColor] = await Promise.all([
    prisma.exerciseDefinition.create({
      data: {
        tenantId: tenant.id,
        courseId: course.id,
        name: 'E2E Audio',
        type: 'homework',
        targetCount: 5,
        orderIndex: 1,
      },
    }),
    prisma.exerciseDefinition.create({
      data: {
        tenantId: tenant.id,
        courseId: course.id,
        name: 'E2E Sport',
        type: 'homework',
        targetCount: 5,
        orderIndex: 2,
      },
    }),
    prisma.exerciseColorOption.create({
      data: {
        tenantId: tenant.id,
        label: 'E2E Bajarildi',
        colorHex: '#22C55E',
        points: 1,
        orderIndex: 1,
      },
    }),
  ]);
  await prisma.exerciseDefinitionColorPoint.createMany({
    data: [audioExercise.id, sportExercise.id].map((exerciseDefinitionId) => ({
      tenantId: tenant.id,
      exerciseDefinitionId,
      colorOptionId: completedColor.id,
      points: 1,
    })),
  });

  for (let index = 1; index <= 30; index += 1) {
    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        customerNumber: `E2E-${String(index).padStart(3, '0')}`,
        name: `E2E Student ${String(index).padStart(2, '0')}`,
      },
    });
    await prisma.income.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        managerUserId: admin.id,
        type: 'new_sale',
        courseId: course.id,
        tariffId: tariff.id,
        entryDate: startDate,
        paymentAmount: 0,
        remainingDebtAmount: 0,
        lifecycleStatus: 'active',
      },
    });
    if (index <= 10) {
      await prisma.courseRunMember.create({
        data: { tenantId: tenant.id, courseRunId: run.id, customerId: customer.id },
      });
    }
  }

  process.stdout.write(JSON.stringify({
    login: 'e2e-admin',
    course: course.name,
    run: run.name,
    owner: owner.name,
    otherKurator: otherKurator.name,
  }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
