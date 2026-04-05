import bcrypt from 'bcryptjs';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEY_LENGTH = 64;

// Use the same format as Dashboarduz so credentials are compatible in a shared DB.
// Format: "<saltHex>:<hashHex>"
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Dashboarduz format
  if (storedHash.includes(':')) {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) {
      return false;
    }

    const calculatedHash = scryptSync(password, salt, KEY_LENGTH);
    const storedBuffer = Buffer.from(hash, 'hex');

    if (calculatedHash.length !== storedBuffer.length) {
      return false;
    }

    return timingSafeEqual(calculatedHash, storedBuffer);
  }

  // Backward compatibility for any legacy bcrypt hashes
  return bcrypt.compare(password, storedHash);
}
