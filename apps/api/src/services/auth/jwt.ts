import jwt from 'jsonwebtoken';

export interface JWTPayload {
  userId: string;
  tenantId: string;
  roles: string[];
  username?: string;
  name?: string;
  email?: string;
  phone?: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-min-32-chars!!';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function signJWT(payload: JWTPayload): string {
  return jwt.sign(payload as object, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyJWT(token: string): JWTPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    throw new Error('Invalid or expired token');
  }
}
