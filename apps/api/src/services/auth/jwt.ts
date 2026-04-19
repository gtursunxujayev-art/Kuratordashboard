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

function getRequiredJWTSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error('[Auth] JWT_SECRET is required. Set JWT_SECRET before starting the API.');
  }
  return secret;
}

const JWT_SECRET = getRequiredJWTSecret();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function assertJWTConfiguration(): void {
  // Accessing the constant guarantees startup validation has already happened.
  void JWT_SECRET;
}

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
