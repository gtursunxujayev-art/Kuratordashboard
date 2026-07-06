export function isAdminOrManager(roles: string[]): boolean {
  return roles.includes('Admin') || roles.includes('Manager') || roles.includes('Bosh Kurator');
}

export function hasKuratorRole(roles: string[]): boolean {
  return roles.includes('Kurator') || roles.includes('Bosh Kurator');
}
