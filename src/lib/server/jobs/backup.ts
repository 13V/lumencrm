import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { localClock, type JobContext } from './shared';

const MAGIC = Buffer.from('LUMENB1\n');
export function backupKey(value = process.env.BACKUP_ENCRYPTION_KEY): Buffer {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('backup_key_must_be_32_bytes_base64');
  const key = Buffer.from(value, 'base64'); if (key.length !== 32) throw new Error('backup_key_must_be_32_bytes_base64'); return key;
}
export function encryptBackup(content: Uint8Array, key: Buffer, path: string): Buffer {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(path));
  const ciphertext = Buffer.concat([cipher.update(content), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}
export function decryptBackup(content: Buffer, key: Buffer, path: string): Buffer {
  if (content.length < MAGIC.length + 28 || !content.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('unsupported_backup_format');
  const decipher = createDecipheriv('aes-256-gcm', key, content.subarray(MAGIC.length, MAGIC.length + 12));
  decipher.setAAD(Buffer.from(path)); decipher.setAuthTag(content.subarray(MAGIC.length + 12, MAGIC.length + 28));
  return Buffer.concat([decipher.update(content.subarray(MAGIC.length + 28)), decipher.final()]);
}
export function backupWeek(day: string): string {
  const date = new Date(`${day}T12:00:00Z`), weekday = date.getUTCDay(); date.setUTCDate(date.getUTCDate() - ((weekday + 6) % 7)); return date.toISOString().slice(0, 10);
}
export async function weeklyBackup(context: JobContext): Promise<number> {
  const key = backupKey(), prefix = `weekly/${backupWeek(localClock(context.now).day)}`, snapshotAt = context.now.toISOString();
  const names = await context.db.rpc('backup_table_names');
  if (names.error || !Array.isArray(names.data)) throw new Error('backup_schema_failed');
  const manifest: { format: string; created_at: string; consistency: string; chunks: { table: string; path: string; rows: number; sha256: string }[] } = { format: 'lumen-encrypted-logical-v1', created_at: snapshotAt, consistency: 'Logical paginated export; use Supabase daily backups for a transaction-consistent database restore.', chunks: [] };
  let rows = 0;
  for (const table of names.data as string[]) {
    if (!/^[a-z][a-z0-9_]+$/.test(table)) throw new Error('invalid_backup_table');
    for (let offset = 0; offset < 500_000; offset += 100) {
      const result = await context.db.from(table).select('*').lte('created_at', snapshotAt).order('id').range(offset, offset + 99);
      if (result.error) throw new Error('backup_table_read_failed');
      const data = result.data ?? [];
      if (!data.length) break;
      const path = `${prefix}/${table}/${String(offset / 100).padStart(6, '0')}.jsonl.enc`;
      const plain = Buffer.from(data.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
      const encrypted = encryptBackup(plain, key, path);
      const uploaded = await context.db.storage.from('crm-backups').upload(path, encrypted, { contentType: 'application/octet-stream', upsert: true, cacheControl: '0' });
      if (uploaded.error) throw new Error('backup_upload_failed');
      manifest.chunks.push({ table, path, rows: data.length, sha256: createHash('sha256').update(encrypted).digest('hex') }); rows += data.length;
      if (data.length < 100) break;
      if (offset === 499_900) throw new Error('backup_table_limit_reached');
    }
  }
  const manifestPath = `${prefix}/manifest.json.enc`;
  const upload = await context.db.storage.from('crm-backups').upload(manifestPath, encryptBackup(Buffer.from(JSON.stringify(manifest)), key, manifestPath), { contentType: 'application/octet-stream', upsert: true, cacheControl: '0' });
  if (upload.error) throw new Error('backup_manifest_failed');
  return rows;
}
export async function expireOldBackups(context: JobContext): Promise<number> {
  const oldest = new Date(context.now.getTime() - 35 * 86400_000).toISOString().slice(0, 10);
  const directories = await context.db.storage.from('crm-backups').list('weekly', { limit: 100, sortBy: { column: 'name', order: 'asc' } });
  if (directories.error) throw new Error('backup_retention_list_failed');
  let count = 0;
  const collect = async (prefix: string, depth = 0): Promise<string[]> => {
    if (depth > 2) throw new Error('unexpected_backup_directory');
    const files: string[] = [];
    for (let offset = 0; offset < 100_000; offset += 1000) {
      const result = await context.db.storage.from('crm-backups').list(prefix, { limit: 1000, offset });
      if (result.error) throw new Error('backup_retention_list_failed');
      for (const entry of result.data ?? []) {
        if (entry.id) files.push(`${prefix}/${entry.name}`); else files.push(...await collect(`${prefix}/${entry.name}`, depth + 1));
      }
      if (!result.data || result.data.length < 1000) break;
    }
    return files;
  };
  for (const directory of directories.data ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(directory.name) || directory.name >= oldest) continue;
    const paths = await collect(`weekly/${directory.name}`);
    for (let offset = 0; offset < paths.length; offset += 100) {
      const removed = await context.db.storage.from('crm-backups').remove(paths.slice(offset, offset + 100));
      if (removed.error) throw new Error('backup_retention_remove_failed');
      count += Math.min(100, paths.length - offset);
    }
  }
  return count;
}
