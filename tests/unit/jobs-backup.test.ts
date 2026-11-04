import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { backupKey, backupWeek, encryptBackup, decryptBackup } from '@/lib/server/jobs/backup';
describe('encrypted weekly export', () => {
  const key = Buffer.alloc(32, 7), path = 'weekly/2026-11-02/contacts/000000.jsonl.enc';
  it('encrypts content with authenticated encryption and no plain contact details', () => {
    const plain = Buffer.from('{"email":"fiction@example.com"}\n');
    const encrypted = encryptBackup(plain, key, path);
    expect(encrypted.toString()).not.toContain('fiction@example.com');
    expect(decryptBackup(encrypted, key, path)).toEqual(plain);
  });
  it('fails authentication for tampering, a wrong key or a different chunk path', () => {
    const encrypted = encryptBackup(Buffer.from('test'), key, path), altered = Buffer.from(encrypted); altered[altered.length - 1] ^= 1;
    expect(() => decryptBackup(altered, key, path)).toThrow();
    expect(() => decryptBackup(encrypted, Buffer.alloc(32, 8), path)).toThrow();
    expect(() => decryptBackup(encrypted, key, `${path}-other`)).toThrow();
  });
  it('uses a fresh IV on every encryption', () => expect(encryptBackup(Buffer.from('same'), key, path)).not.toEqual(encryptBackup(Buffer.from('same'), key, path)));
  it('requires a 32-byte base64 environment key', () => { expect(backupKey(key.toString('base64'))).toEqual(key); expect(() => backupKey('short')).toThrow(); });
  it('uses Monday as the weekly backup identity', () => { expect(backupWeek('2026-11-04')).toBe('2026-11-02'); expect(backupWeek('2026-11-08')).toBe('2026-11-02'); });
});
