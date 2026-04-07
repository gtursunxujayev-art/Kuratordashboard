let mockPreviewEnabled = false;
let updatedAt = new Date(0);
let updatedBy: string | null = null;

export function isMockPreviewEnabled(): boolean {
  return mockPreviewEnabled;
}

export function getMockPreviewMeta() {
  return {
    enabled: mockPreviewEnabled,
    updatedAt,
    updatedBy,
  };
}

export function setMockPreviewEnabled(enabled: boolean, actorUserId?: string) {
  mockPreviewEnabled = enabled;
  updatedAt = new Date();
  updatedBy = actorUserId ?? null;
  return getMockPreviewMeta();
}

