import { hash, verify } from '@node-rs/argon2';

// Argon2id with the library defaults (m = 19 MiB, t = 2, p = 1), as recommended by OWASP.
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (!passwordHash) {
    // Same work as a real check, so timing does not reveal unknown users.
    await hash(password);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
