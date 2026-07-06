export function isPremiumTariffName(name: string | null | undefined): boolean {
  const normalized = (name ?? '').toLowerCase();
  return normalized.includes('premium') || normalized.includes('vip');
}
