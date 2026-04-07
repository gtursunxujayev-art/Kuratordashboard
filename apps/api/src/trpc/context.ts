import type { Request, Response } from 'express';
import type { JWTPayload } from '../services/auth/jwt';
import { isMockPreviewEnabled } from '../services/mock-preview';

export interface Context {
  req: Request;
  res: Response;
  user?: JWTPayload;
  tenantId?: string;
  mockPreview?: boolean;
}

export async function createContext(opts: { req: Request; res: Response }): Promise<Context> {
  const authHeader = opts.req.headers.authorization;
  let user: JWTPayload | undefined;
  let tenantId: string | undefined;
  const mockPreview = isMockPreviewEnabled();

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const { verifyJWT } = await import('../services/auth/jwt');
      user = verifyJWT(token);
      tenantId = user.tenantId;
    } catch {
      // Invalid token — user remains undefined
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    mockPreview,
    ...(user ? { user } : {}),
    ...(tenantId ? { tenantId } : {}),
  };
}
