import { prisma } from '@kuratordashboard/db';

// Shared phone-matching logic used by both the FaceID webhook and the client
// Telegram bot's contact-share fallback. Dashboarduz stores the phone number in
// customers.customerNumber. Compare on the last 9 digits then confirm a full
// normalized match, requiring exactly one candidate to avoid ambiguous matches.

export type MatchedCustomerByPhone = {
  id: string;
  tenantId: string;
  customerNumber: string;
  faceIdExternalId: string | null;
};

export function normalizePhone(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export async function matchCustomerByPhone(
  phone: string,
  tenantScopeId: string | null,
): Promise<MatchedCustomerByPhone | null> {
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 7) return null;

  const tenantWhere = tenantScopeId ? { tenantId: tenantScopeId } : {};
  const last9 = normalizedPhone.slice(-9);

  const candidates = await prisma.customer.findMany({
    where: { ...tenantWhere, customerNumber: { contains: last9 } },
    select: { id: true, tenantId: true, customerNumber: true, faceIdExternalId: true },
    take: 25,
  });

  const exact = candidates.filter((c) => {
    const normalized = normalizePhone(c.customerNumber);
    return normalized.length >= 7 && normalized.slice(-9) === last9;
  });

  if (exact.length === 1) return exact[0];

  if (exact.length > 1) {
    console.log(
      JSON.stringify({
        level: 'warn',
        event: 'customer_phone_match_ambiguous',
        phoneMasked: `***${normalizedPhone.slice(-4)}`,
        matchCount: exact.length,
      }),
    );
  }

  return null;
}
