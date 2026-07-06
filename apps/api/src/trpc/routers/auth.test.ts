import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../services/auth/password';

let chooseLoginCandidate: typeof import('./auth').chooseLoginCandidate;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';
  ({ chooseLoginCandidate } = await import('./auth'));
});

describe('ambiguous tenant login', () => {
  it('rejects duplicate email or phone credentials instead of guessing a tenant', async () => {
    const passwordHash = await hashPassword('same-password');
    const createdAt = new Date();
    const candidates = ['tenant-a', 'tenant-b'].map((tenantId, index) => ({
      id: `user-${index}`,
      tenantId,
      username: `unique-user-${index}`,
      name: null,
      email: 'duplicate@example.test',
      phone: null,
      roles: ['Manager'],
      passwordHash,
      lastLoginAt: null,
      createdAt,
    }));

    await expect(chooseLoginCandidate(candidates, 'same-password')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
