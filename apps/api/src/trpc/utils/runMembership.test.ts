import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@kuratordashboard/db';
import {
  pickPreferredCourseRun,
  resolveCourseRunMemberCustomerIds,
  resolvePreferredRunByCustomer,
} from './runMembership';
import { getCustomersScopedToKurator } from './kuratorScope';

describe('pickPreferredCourseRun', () => {
  const now = new Date('2026-06-28T12:00:00.000Z');
  const run = (id: string, startDate: string, endDate: string) => ({
    id,
    courseId: 'course',
    startDate: new Date(startDate),
    endDate: new Date(endDate),
  });

  it('prefers the active run with the latest start date', () => {
    expect(pickPreferredCourseRun([
      run('older-active', '2026-06-01', '2026-07-10'),
      run('newer-active', '2026-06-20', '2026-07-20'),
      run('upcoming', '2026-07-01', '2026-08-01'),
    ], now)?.id).toBe('newer-active');
  });

  it('then chooses nearest upcoming, then most recently ended', () => {
    expect(pickPreferredCourseRun([
      run('later', '2026-08-01', '2026-09-01'),
      run('nearer', '2026-07-01', '2026-08-01'),
    ], now)?.id).toBe('nearer');
    expect(pickPreferredCourseRun([
      run('old', '2026-01-01', '2026-02-01'),
      run('recent', '2026-05-01', '2026-06-20'),
    ], now)?.id).toBe('recent');
  });
});

const describeDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeDatabase('explicit run membership integration', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const integrationNow = new Date();
  const daysFromNow = (days: number) => {
    const date = new Date(integrationNow);
    date.setDate(date.getDate() + days);
    return date;
  };
  let tenantId = '';
  let courseId = '';
  let customerId = '';
  let runId = '';
  let kuratorId = '';
  let secondKuratorId = '';
  let unassignedCustomerId = '';
  let unassignedRunId = '';

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({ data: { name: `membership-test-${suffix}` } });
    tenantId = tenant.id;
    const course = await prisma.course.create({
      data: { tenantId, name: `course-${suffix}`, category: 'online' },
    });
    courseId = course.id;
    const tariff = await prisma.tariff.create({
      data: { tenantId, courseId, name: `tariff-${suffix}` },
    });
    const [kurator, secondKurator] = await Promise.all([
      prisma.user.create({
        data: {
          tenantId,
          username: `kurator-${suffix}`,
          name: 'Run Owner',
          roles: ['Kurator'],
          authProvider: 'local',
        },
      }),
      prisma.user.create({
        data: {
          tenantId,
          username: `second-kurator-${suffix}`,
          name: 'Other Kurator',
          roles: ['Kurator'],
          authProvider: 'local',
        },
      }),
    ]);
    kuratorId = kurator.id;
    secondKuratorId = secondKurator.id;
    const customer = await prisma.customer.create({
      data: { tenantId, customerNumber: `student-${suffix}`, name: 'Explicit Member' },
    });
    customerId = customer.id;
    const courseRun = await prisma.courseRun.create({
      data: {
        tenantId,
        courseId,
        name: `run-${suffix}`,
        startDate: daysFromNow(-7),
        endDate: daysFromNow(30),
        kuratorUserId: kuratorId,
      },
    });
    runId = courseRun.id;
    const unassignedCustomer = await prisma.customer.create({
      data: { tenantId, customerNumber: `unassigned-${suffix}`, name: 'Unassigned Student' },
    });
    unassignedCustomerId = unassignedCustomer.id;
    const unassignedRun = await prisma.courseRun.create({
      data: {
        tenantId,
        courseId,
        name: `unassigned-run-${suffix}`,
        startDate: daysFromNow(40),
        endDate: daysFromNow(80),
      },
    });
    unassignedRunId = unassignedRun.id;
    await prisma.income.createMany({
      data: [customerId, unassignedCustomerId].map((activeCustomerId) => ({
        tenantId,
        customerId: activeCustomerId,
        managerUserId: kuratorId,
        type: 'new_sale',
        courseId,
        tariffId: tariff.id,
        entryDate: new Date('2026-06-01'),
        paymentAmount: 0,
        remainingDebtAmount: 0,
        lifecycleStatus: 'active',
      })),
    });
    await prisma.courseRunMember.create({
      data: { tenantId, courseRunId: unassignedRunId, customerId: unassignedCustomerId },
    });
  });

  afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } });
    await prisma.$disconnect();
  });

  it('does not treat enrollment as implicit membership', async () => {
    expect(await resolveCourseRunMemberCustomerIds({ tenantId, courseRunId: runId, courseId })).toEqual([]);
    await prisma.courseRunMember.create({ data: { tenantId, courseRunId: runId, customerId } });
    expect(await resolveCourseRunMemberCustomerIds({ tenantId, courseRunId: runId, courseId })).toEqual([customerId]);
  });

  it('rejects an invalid run instead of returning course-wide students', async () => {
    await expect(resolveCourseRunMemberCustomerIds({
      tenantId,
      courseRunId: '00000000-0000-0000-0000-000000000000',
      courseId,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('derives curator scope from run ownership and explicit membership', async () => {
    expect(await getCustomersScopedToKurator({
      tenantId,
      kuratorUserId: kuratorId,
      courseRunId: runId,
    })).toEqual([customerId]);
    expect(await getCustomersScopedToKurator({
      tenantId,
      kuratorUserId: secondKuratorId,
      courseRunId: runId,
    })).toEqual([]);
  });

  it('keeps an unassigned run explicitly unassigned', async () => {
    const preferred = await resolvePreferredRunByCustomer({
      tenantId,
      courseId,
      customerIds: [unassignedCustomerId],
      now: daysFromNow(50),
    });
    expect(preferred.get(unassignedCustomerId)?.id).toBe(unassignedRunId);
    expect(preferred.get(unassignedCustomerId)?.kuratorUserId).toBeNull();
  });

  it('enforces one active assignment cache row per student and run', async () => {
    await prisma.kuratorAssignment.create({
      data: { tenantId, courseRunId: runId, customerId, kuratorUserId: kuratorId, isActive: true },
    });
    await expect(prisma.kuratorAssignment.create({
      data: { tenantId, courseRunId: runId, customerId, kuratorUserId: secondKuratorId, isActive: true },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('keeps tariff-only changes, removes course moves from current runs, and preserves ended history', async () => {
    const customer = await prisma.customer.create({
      data: { tenantId, customerNumber: `move-${suffix}`, name: 'Course Move Student' },
    });
    const [firstTariff, secondTariff] = await Promise.all([
      prisma.tariff.create({ data: { tenantId, courseId, name: `move-a-${suffix}` } }),
      prisma.tariff.create({ data: { tenantId, courseId, name: `move-b-${suffix}` } }),
    ]);
    const endedRun = await prisma.courseRun.create({
      data: {
        tenantId,
        courseId,
        name: `ended-${suffix}`,
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-02-01'),
      },
    });
    await prisma.courseRunMember.createMany({
      data: [runId, endedRun.id].map((courseRunId) => ({
        tenantId,
        courseRunId,
        customerId: customer.id,
      })),
    });
    const sale = await prisma.income.create({
      data: {
        tenantId,
        customerId: customer.id,
        managerUserId: kuratorId,
        type: 'new_sale',
        courseId,
        tariffId: firstTariff.id,
        entryDate: new Date(),
        paymentAmount: 0,
        remainingDebtAmount: 0,
        lifecycleStatus: 'active',
      },
    });

    await prisma.income.update({ where: { id: sale.id }, data: { tariffId: secondTariff.id } });
    expect(await prisma.courseRunMember.count({ where: { courseRunId: runId, customerId: customer.id } })).toBe(1);

    const nextCourse = await prisma.course.create({
      data: { tenantId, name: `next-course-${suffix}`, category: 'online' },
    });
    const nextTariff = await prisma.tariff.create({
      data: { tenantId, courseId: nextCourse.id, name: `next-tariff-${suffix}` },
    });
    await prisma.income.update({
      where: { id: sale.id },
      data: { courseId: nextCourse.id, tariffId: nextTariff.id },
    });

    expect(await prisma.courseRunMember.count({ where: { courseRunId: runId, customerId: customer.id } })).toBe(0);
    expect(await prisma.courseRunMember.count({ where: { courseRunId: endedRun.id, customerId: customer.id } })).toBe(1);
  });

  it('removes current membership only after the last active sale is deleted', async () => {
    const customer = await prisma.customer.create({
      data: { tenantId, customerNumber: `multi-sale-${suffix}`, name: 'Multiple Sale Student' },
    });
    const tariff = await prisma.tariff.create({
      data: { tenantId, courseId, name: `multi-sale-${suffix}` },
    });
    await prisma.courseRunMember.create({ data: { tenantId, courseRunId: runId, customerId: customer.id } });
    const sales = await Promise.all([1, 2].map((index) => prisma.income.create({
      data: {
        tenantId,
        customerId: customer.id,
        managerUserId: kuratorId,
        type: 'new_sale',
        courseId,
        tariffId: tariff.id,
        entryDate: new Date(`2026-06-0${index}`),
        paymentAmount: 0,
        remainingDebtAmount: 0,
        lifecycleStatus: 'active',
      },
    })));

    await prisma.income.delete({ where: { id: sales[0]!.id } });
    expect(await prisma.courseRunMember.count({ where: { courseRunId: runId, customerId: customer.id } })).toBe(1);
    await prisma.income.delete({ where: { id: sales[1]!.id } });
    expect(await prisma.courseRunMember.count({ where: { courseRunId: runId, customerId: customer.id } })).toBe(0);
  });
});
