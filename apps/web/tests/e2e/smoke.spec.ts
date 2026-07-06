import { expect, test } from '@playwright/test';

test('login page renders the credential form', async ({ page }) => {
  await page.goto('/auth/login');
  await expect(page.getByRole('button', { name: /kirish/i })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('invalid public report token shows an error instead of a broken table', async ({ page }) => {
  await page.goto('/shared/report/invalid-token');
  await expect(page.getByText('Xatolik')).toBeVisible();
});

test('Hisobot filters, share invalidation, public parity, and sticky header', async ({ page }) => {
  test.skip(!process.env.E2E_SEEDED, 'Requires the deterministic PostgreSQL E2E seed');

  await page.goto('/auth/login');
  await page.getByPlaceholder('login, email yoki +998...').fill('e2e-admin');
  await page.getByPlaceholder('••••••••').fill('E2E-password-123!');
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.waitForURL('**/dashboard');
  await page.goto('/hisobot');

  await page.getByTestId('hisobot-course').selectOption({ label: 'E2E Course' });
  await expect(page.getByTestId('report-student-row')).toHaveCount(30);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () => {
    const y = (await page.getByTestId('report-sticky-header-cell').boundingBox())?.y;
    return y !== undefined && Math.abs(y) <= 1;
  }).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByTestId('hisobot-kurator').selectOption({ label: 'E2E Run Owner' });
  await page.getByTestId('hisobot-run').selectOption({ label: 'E2E Explicit Run' });
  await expect(page.getByTestId('report-student-row')).toHaveCount(10);

  const headerPosition = await page.getByTestId('report-header').evaluate((element) =>
    window.getComputedStyle(element.querySelector('th')!).position,
  );
  expect(headerPosition).toBe('sticky');

  await page.getByTestId('hisobot-preset-all').click();
  await page.getByTestId('hisobot-create-share-link').click();
  const shareInput = page.getByTestId('hisobot-share-link');
  await expect(shareInput).toBeVisible();
  const shareUrl = await shareInput.inputValue();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('forced fallback')) },
    });
    document.execCommand = () => true;
  });
  await page.getByTestId('hisobot-copy-share-link').click();
  await expect(page.getByTestId('hisobot-copy-share-link')).toHaveText(/Nusxalandi/);

  await page.getByTestId('hisobot-tariff').selectOption({ label: 'E2E Premium' });
  await expect(shareInput).toHaveCount(0);
  await page.getByTestId('hisobot-create-share-link').click();
  const filteredShareUrl = await page.getByTestId('hisobot-share-link').inputValue();
  expect(filteredShareUrl).not.toBe(shareUrl);

  await page.goto(filteredShareUrl);
  await expect(page.getByTestId('report-student-row')).toHaveCount(10);
});

test('Amaliy drafts and saved slots stay isolated by student and exercise', async ({ page }) => {
  test.skip(!process.env.E2E_SEEDED, 'Requires the deterministic PostgreSQL E2E seed');

  await page.goto('/auth/login');
  await page.getByPlaceholder('login, email yoki +998...').fill('e2e-admin');
  await page.getByPlaceholder('••••••••').fill('E2E-password-123!');
  await page.getByRole('button', { name: 'Kirish' }).click();
  await page.waitForURL('**/dashboard');
  await page.goto('/amaliy');

  await page.getByTestId('amaliy-course').selectOption({ label: 'E2E Course' });
  await page.getByTestId('amaliy-run').selectOption({ label: 'E2E Explicit Run' });
  await page.getByTestId('amaliy-student').selectOption({ label: 'E2E Student 01' });
  await page.getByTestId('amaliy-date-all').click();

  const studentSlots = page.locator('[data-testid^="amaliy-student-slot-"]');
  await expect(studentSlots.first()).toBeVisible();
  await studentSlots.first().selectOption({ label: 'E2E Bajarildi (1 ball)' });

  await page.getByTestId('amaliy-student').selectOption({ label: 'E2E Student 02' });
  await expect(studentSlots.first()).toHaveValue('');
  await page.getByTestId('amaliy-student').selectOption({ label: 'E2E Student 01' });
  await expect(studentSlots.first()).toHaveValue('');

  await page.getByTestId('amaliy-mode-practice').click();
  await page.getByTestId('amaliy-practice').selectOption({ label: 'E2E Audio' });
  const practiceSlots = page.locator('[data-testid^="amaliy-practice-slot-"]');
  await expect(practiceSlots.first()).toBeVisible();
  await practiceSlots.first().selectOption({ label: 'E2E Bajarildi (1 ball)' });
  await page.getByTestId('amaliy-practice').selectOption({ label: 'E2E Sport' });
  await expect(practiceSlots.first()).toHaveValue('');

  await page.getByTestId('amaliy-mode-students').click();
  await page.getByTestId('amaliy-student').selectOption({ label: 'E2E Student 01' });
  await studentSlots.first().selectOption({ label: 'E2E Bajarildi (1 ball)' });
  await page.locator('[data-testid^="amaliy-student-save-"]').first().click();
  await expect(page.getByText('Saqlandi').last()).toBeVisible();

  await page.getByTestId('amaliy-student').selectOption({ label: 'E2E Student 02' });
  await expect(studentSlots.first()).toHaveValue('');
  await page.getByTestId('amaliy-student').selectOption({ label: 'E2E Student 01' });
  await expect(studentSlots.first()).toHaveValue(/.+/);
});
