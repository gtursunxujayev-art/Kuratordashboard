import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@kuratordashboard/db';
import { intensivRouter } from './intensiv';

const describeDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeDatabase('intensive customer sale integration', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let tenantId = '';
  let adminUserId = '';
  let managerUserId = '';
  let normalizedManagerUserId = '';
  let courseId = '';
  let tariffId = '';
  let secondTariffId = '';
  let concurrentTariffId = '';
  let subTariffId = '';
  const originalEnv = {
    endpoint: process.env.DASHBOARDUZ_TELEGRAM_ENDPOINT,
    secret: process.env.DASHBOARDUZ_TELEGRAM_SECRET,
    group: process.env.DASHBOARDUZ_PAYMENT_GROUP_ID,
  };

  const caller = () => intensivRouter.createCaller({
    req: {} as never,
    res: {} as never,
    tenantId,
    user: { userId: adminUserId, tenantId, roles: ['Admin'] },
  });

  beforeAll(async () => {
    process.env.DASHBOARDUZ_TELEGRAM_ENDPOINT = 'https://dashboarduz.example.test/debug/telegram';
    process.env.DASHBOARDUZ_TELEGRAM_SECRET = 'test-secret';
    process.env.DASHBOARDUZ_PAYMENT_GROUP_ID = '-100123456789';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, deliveredCount: 1, failedCount: 0 }),
    })));

    const tenant = await prisma.tenant.create({ data: { name: `intensive-sale-test-${suffix}` } });
    tenantId = tenant.id;
    const [admin, manager] = await Promise.all([
      prisma.user.create({
        data: {
          tenantId,
          username: `intensive-admin-${suffix}`,
          name: 'Intensive Admin',
          roles: ['Admin'],
          authProvider: 'local',
        },
      }),
      prisma.user.create({
        data: {
          tenantId,
          username: `intensive-agent-${suffix}`,
          name: 'Linked Sales Manager',
          roles: ['Agent'],
          authProvider: 'local',
        },
      }),
    ]);
    adminUserId = admin.id;
    managerUserId = manager.id;
    const [, , normalizedManager] = await Promise.all([
      prisma.user.create({
        data: {
          tenantId,
          username: `intensive-kurator-${suffix}`,
          name: 'Not A Sales Manager',
          roles: ['Kurator'],
          authProvider: 'local',
        },
      }),
      prisma.user.create({
        data: {
          tenantId,
          username: `intensive-inactive-${suffix}`,
          name: 'Inactive Agent',
          roles: ['Agent'],
          authProvider: 'local',
          isActive: false,
        },
      }),
      prisma.user.create({
        data: {
          tenantId,
          username: `intensive-lowercase-agent-${suffix}`,
          name: null,
          roles: ['agent'],
          authProvider: 'local',
        },
      }),
    ]);
    normalizedManagerUserId = normalizedManager.id;
    const course = await prisma.course.create({
      data: {
        tenantId,
        name: `Intensive course ${suffix}`,
        category: 'intensive',
        startDate: new Date('2026-08-10T00:00:00.000Z'),
      },
    });
    courseId = course.id;
    const [tariff, secondTariff, concurrentTariff] = await Promise.all([
      prisma.tariff.create({ data: { tenantId, courseId, name: `Primary ${suffix}` } }),
      prisma.tariff.create({ data: { tenantId, courseId, name: `Secondary ${suffix}` } }),
      prisma.tariff.create({ data: { tenantId, courseId, name: `Concurrent ${suffix}` } }),
    ]);
    tariffId = tariff.id;
    secondTariffId = secondTariff.id;
    concurrentTariffId = concurrentTariff.id;
    const subTariff = await prisma.subTariff.create({
      data: { tenantId, tariffId, name: `Region ${suffix}` },
    });
    subTariffId = subTariff.id;
  });

  afterAll(async () => {
    if (tenantId) await prisma.tenant.delete({ where: { id: tenantId } });
    if (originalEnv.endpoint === undefined) delete process.env.DASHBOARDUZ_TELEGRAM_ENDPOINT;
    else process.env.DASHBOARDUZ_TELEGRAM_ENDPOINT = originalEnv.endpoint;
    if (originalEnv.secret === undefined) delete process.env.DASHBOARDUZ_TELEGRAM_SECRET;
    else process.env.DASHBOARDUZ_TELEGRAM_SECRET = originalEnv.secret;
    if (originalEnv.group === undefined) delete process.env.DASHBOARDUZ_PAYMENT_GROUP_ID;
    else process.env.DASHBOARDUZ_PAYMENT_GROUP_ID = originalEnv.group;
    vi.unstubAllGlobals();
    await prisma.$disconnect();
  });

  it('returns active Dashboarduz sales-manager roles with case-insensitive matching', async () => {
    const managers = await caller().managers();
    expect(managers.map((manager) => manager.id)).toContain(managerUserId);
    expect(managers).toContainEqual(expect.objectContaining({
      id: normalizedManagerUserId,
      name: `intensive-lowercase-agent-${suffix}`,
    }));
    expect(managers.some((manager) => manager.name === 'Not A Sales Manager')).toBe(false);
    expect(managers.some((manager) => manager.name === 'Inactive Agent')).toBe(false);
  });

  it('accepts every manager offered by the normalized manager list', async () => {
    const created = await caller().createCustomerSale({
      managerUserId: normalizedManagerUserId,
      customerNumber: '998901110000',
      customerName: 'Normalized Role Manager Customer',
      courseId,
      tariffId: secondTariffId,
      agreementAmount: 0,
      paymentAmount: 0,
    });

    expect(await prisma.income.findUniqueOrThrow({ where: { id: created.saleId } })).toMatchObject({
      managerUserId: normalizedManagerUserId,
    });
  });

  it('requires an active sub-tariff when the selected tariff has options', async () => {
    await expect(caller().createCustomerSale({
      managerUserId,
      customerNumber: '998901110001',
      customerName: 'Missing Sub Tariff',
      courseId,
      tariffId,
      agreementAmount: 1_000_000,
      paymentAmount: 0,
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('creates a sale and roster member, reuses the phone without renaming, and rejects a duplicate active sale', async () => {
    const customerNumber = '998901110002';
    const created = await caller().createCustomerSale({
      managerUserId,
      customerNumber: `+${customerNumber}`,
      customerName: 'Original Customer Name',
      courseId,
      tariffId,
      subTariffId,
      agreementAmount: 1_000_000,
      paymentAmount: 250_000,
    });
    expect(created).toMatchObject({ customerReused: false, remainingDebt: 750_000 });
    expect(created.telegram.delivered).toBe(true);

    const firstSale = await prisma.income.findUniqueOrThrow({ where: { id: created.saleId } });
    expect(firstSale).toMatchObject({
      managerUserId,
      courseId,
      tariffId,
      type: 'new_sale',
      paymentAmount: 250_000,
      remainingDebtAmount: 750_000,
    });
    expect(firstSale.legacyImportMeta).toMatchObject({ saleSubTariffId: subTariffId });
    const systemRun = await prisma.courseRun.findFirstOrThrow({
      where: { tenantId, courseId, tariffId, isSystemManaged: true },
      select: { id: true },
    });
    expect(await prisma.courseRunMember.count({
      where: { tenantId, courseRunId: systemRun.id, customerId: created.customerId },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { tenantId, action: 'intensive_sale_create', resourceId: created.saleId },
    })).toBe(1);

    const reused = await caller().createCustomerSale({
      managerUserId,
      customerNumber,
      customerName: 'Attempted Replacement Name',
      courseId,
      tariffId: secondTariffId,
      agreementAmount: 500_000,
      paymentAmount: 0,
    });
    expect(reused.customerReused).toBe(true);
    expect(reused.customerId).toBe(created.customerId);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: created.customerId } })).toMatchObject({
      name: 'Original Customer Name',
    });

    await expect(caller().createCustomerSale({
      managerUserId,
      customerNumber,
      customerName: 'Ignored Name',
      courseId,
      tariffId,
      subTariffId,
      agreementAmount: 1_000_000,
      paymentAmount: 0,
    })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('serializes duplicate submissions for the same phone and tariff', async () => {
    const input = {
      managerUserId,
      customerNumber: '998901110003',
      customerName: 'Concurrent Customer',
      courseId,
      tariffId: concurrentTariffId,
      agreementAmount: 0,
      paymentAmount: 0,
    };
    const attempts = await Promise.allSettled([
      caller().createCustomerSale(input),
      caller().createCustomerSale(input),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { tenantId_customerNumber: { tenantId, customerNumber: input.customerNumber } },
    });
    expect(await prisma.income.count({
      where: { tenantId, customerId: customer.id, courseId, tariffId: concurrentTariffId, ...{ type: 'new_sale', lifecycleStatus: 'active' } },
    })).toBe(1);
  });

  it('rejects an initial payment larger than the agreement', async () => {
    await expect(caller().createCustomerSale({
      managerUserId,
      customerNumber: '998901110004',
      customerName: 'Invalid Amount',
      courseId,
      tariffId: secondTariffId,
      agreementAmount: 100_000,
      paymentAmount: 100_001,
    })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
