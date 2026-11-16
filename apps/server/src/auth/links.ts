import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Personal links for customer people: a random token per person and project. The database keeps its
 * SHA-256 (to find it) and an AES-256-GCM encrypted copy (to show the same link again later).
 */
export class LinkBox {
  private key: Buffer;
  constructor(secret: string) {
    this.key = createHash('sha256').update(`spm-link:${secret}`).digest();
  }

  static newToken(): string {
    return randomBytes(32).toString('base64url');
  }

  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  encrypt(token: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
  }

  decrypt(stored: string): string | null {
    try {
      const [iv, tag, data] = stored.split('.').map((p) => Buffer.from(p, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv!);
      decipher.setAuthTag(tag!);
      return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}
