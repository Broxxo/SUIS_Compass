import fs from 'fs';
import path from 'path';
import pool from '../config/database.js';
import { createRunOnce } from './runOnce.js';
import { ensureUploadDir, resolveUnderUploadDir } from './uploadDir.js';
import { decodeUploadFilename } from './uploadFilename.js';

const ensureOnce = createRunOnce();

export type BinaryStoredFileKind = 'pdf' | 'doc' | 'docx';
export type StoredFileKind = 'text' | BinaryStoredFileKind;

export type StoredFileRecord = {
  id: string;
  moduleKey: string;
  entityId: string;
  kind: StoredFileKind;
  title: string;
  bodyText: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** 管理列表用：所属名称（如项目标题） */
  entityTitle?: string | null;
  createdByName?: string | null;
};

/** PDF 50MB；DOC / DOCX 各 30MB */
export const BINARY_UPLOAD_LIMITS: Record<BinaryStoredFileKind, number> = {
  pdf: 50 * 1024 * 1024,
  doc: 30 * 1024 * 1024,
  docx: 30 * 1024 * 1024,
};

const DEFAULT_MIME: Record<BinaryStoredFileKind, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function reject(message: string, status: number): never {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  throw error;
}

function asKind(raw: unknown): StoredFileKind {
  const value = String(raw ?? '');
  if (value === 'pdf' || value === 'doc' || value === 'docx' || value === 'text') return value;
  return 'text';
}

export function isBinaryStoredFileKind(kind: StoredFileKind): kind is BinaryStoredFileKind {
  return kind === 'pdf' || kind === 'doc' || kind === 'docx';
}

/** 根据文件名 / MIME 判断二进制类型；无法识别则返回 null */
export function detectBinaryKind(originalName: string, mimeType = ''): BinaryStoredFileKind | null {
  const name = decodeUploadFilename(originalName).toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  if (name.endsWith('.docx') || mime.includes('wordprocessingml')) return 'docx';
  if (name.endsWith('.doc') || mime === 'application/msword') return 'doc';
  if (name.endsWith('.pdf') || mime.includes('pdf')) return 'pdf';
  return null;
}

function stripBinaryExtension(name: string): string {
  return name.replace(/\.(pdf|docx|doc)$/i, '');
}

function mapRow(row: Record<string, unknown>): StoredFileRecord {
  const originalName = decodeUploadFilename(String(row.original_name ?? ''));
  const titleRaw = String(row.title ?? '');
  const titleDecoded = decodeUploadFilename(titleRaw);
  return {
    id: String(row.id),
    moduleKey: String(row.module_key ?? ''),
    entityId: String(row.entity_id ?? ''),
    kind: asKind(row.kind),
    title: titleDecoded || stripBinaryExtension(originalName) || titleRaw,
    bodyText: String(row.body_text ?? ''),
    originalName,
    mimeType: String(row.mime_type ?? ''),
    sizeBytes: Number(row.size_bytes ?? 0),
    storagePath: String(row.storage_path ?? ''),
    sortOrder: Number(row.sort_order ?? 0),
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    entityTitle: row.entity_title != null ? String(row.entity_title) : null,
    createdByName: row.created_by_name != null ? String(row.created_by_name) : null,
  };
}

export async function ensureStoredFilesTable(): Promise<void> {
  await ensureOnce.run(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stored_files (
        id VARCHAR(100) PRIMARY KEY,
        module_key VARCHAR(40) NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        kind VARCHAR(20) NOT NULL CHECK (kind IN ('text', 'pdf', 'doc', 'docx')),
        title VARCHAR(200) NOT NULL DEFAULT '',
        body_text TEXT NOT NULL DEFAULT '',
        original_name VARCHAR(255) NOT NULL DEFAULT '',
        mime_type VARCHAR(120) NOT NULL DEFAULT '',
        size_bytes BIGINT NOT NULL DEFAULT 0,
        storage_path TEXT NOT NULL DEFAULT '',
        sort_order INT NOT NULL DEFAULT 0,
        created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
        updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // 已有库：放开 kind 约束以支持 Word 文档
    await pool.query(`
      ALTER TABLE stored_files DROP CONSTRAINT IF EXISTS stored_files_kind_check
    `);
    await pool.query(`
      ALTER TABLE stored_files
        ADD CONSTRAINT stored_files_kind_check
        CHECK (kind IN ('text', 'pdf', 'doc', 'docx'))
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_stored_files_module_entity
        ON stored_files(module_key, entity_id, sort_order)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_stored_files_kind
        ON stored_files(kind, created_at DESC)
    `);
  });
}

export async function listEntityFiles(moduleKey: string, entityId: string): Promise<StoredFileRecord[]> {
  await ensureStoredFilesTable();
  const rows = (
    await pool.query(
      `SELECT f.id, f.module_key, f.entity_id, f.kind, f.title, f.body_text, f.original_name, f.mime_type,
              f.size_bytes, f.storage_path, f.sort_order, f.created_by, f.created_at, f.updated_at,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''),
                       NULLIF(TRIM(u.display_name), ''), u.username) AS created_by_name
       FROM stored_files f
       LEFT JOIN users u ON u.id = f.created_by
       WHERE f.module_key = $1 AND f.entity_id = $2
       ORDER BY f.sort_order ASC, f.created_at ASC`,
      [moduleKey, entityId],
    )
  ).rows as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export async function getStoredFile(id: string): Promise<StoredFileRecord | null> {
  await ensureStoredFilesTable();
  const row = (
    await pool.query(
      `SELECT id, module_key, entity_id, kind, title, body_text, original_name, mime_type,
              size_bytes, storage_path, sort_order, created_by, created_at, updated_at
       FROM stored_files WHERE id = $1`,
      [id],
    )
  ).rows[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export async function createTextAsset(input: {
  moduleKey: string;
  entityId: string;
  title: string;
  bodyText: string;
  userId: string;
}): Promise<StoredFileRecord> {
  await ensureStoredFilesTable();
  const title = String(input.title ?? '').trim().slice(0, 200);
  const bodyText = String(input.bodyText ?? '');
  if (!bodyText.trim() && !title) reject('invalid_text', 400);
  const sort = (
    await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1)::int AS n FROM stored_files WHERE module_key = $1 AND entity_id = $2`,
      [input.moduleKey, input.entityId],
    )
  ).rows[0] as { n: number };
  const id = newId('sfile');
  await pool.query(
    `INSERT INTO stored_files
       (id, module_key, entity_id, kind, title, body_text, sort_order, created_by, updated_by)
     VALUES ($1, $2, $3, 'text', $4, $5, $6, $7, $7)`,
    [id, input.moduleKey, input.entityId, title || (bodyText.slice(0, 40) || '文本'), bodyText, Number(sort.n) + 1, input.userId],
  );
  const created = await getStoredFile(id);
  if (!created) reject('internal', 500);
  return created;
}

export async function updateTextAsset(
  id: string,
  userId: string,
  input: { title: string; bodyText: string },
): Promise<StoredFileRecord | null> {
  await ensureStoredFilesTable();
  const existing = await getStoredFile(id);
  if (!existing || existing.kind !== 'text') return null;
  const title = String(input.title ?? '').trim().slice(0, 200);
  const bodyText = String(input.bodyText ?? '');
  await pool.query(
    `UPDATE stored_files
     SET title = $2, body_text = $3, updated_by = $4, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND kind = 'text'`,
    [id, title || existing.title, bodyText, userId],
  );
  return getStoredFile(id);
}

export async function createBinaryAsset(input: {
  moduleKey: string;
  entityId: string;
  userId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  title?: string;
  kind?: BinaryStoredFileKind;
}): Promise<StoredFileRecord> {
  await ensureStoredFilesTable();
  ensureUploadDir();
  const originalName =
    decodeUploadFilename(String(input.originalName ?? 'document')).trim().slice(0, 255) || 'document';
  const kind = input.kind ?? detectBinaryKind(originalName, input.mimeType);
  if (!kind) reject('invalid_file_type', 400);
  const limit = BINARY_UPLOAD_LIMITS[kind];
  if (!input.buffer?.length) reject('empty_file', 400);
  if (input.buffer.length > limit) reject('file_too_large', 400);
  const mimeType = input.mimeType || DEFAULT_MIME[kind];
  const ext = kind;
  const safeName = originalName.toLowerCase().endsWith(`.${ext}`)
    ? originalName
    : `${stripBinaryExtension(originalName)}.${ext}`;
  const id = newId('sfile');
  const relativePath = path.posix.join(input.moduleKey, input.entityId, `${id}.${ext}`);
  const absPath = resolveUnderUploadDir(relativePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, input.buffer);
  const sort = (
    await pool.query(
      `SELECT COALESCE(MAX(sort_order), -1)::int AS n FROM stored_files WHERE module_key = $1 AND entity_id = $2`,
      [input.moduleKey, input.entityId],
    )
  ).rows[0] as { n: number };
  const title =
    decodeUploadFilename(String(input.title ?? '')).trim().slice(0, 200) || stripBinaryExtension(safeName);
  try {
    await pool.query(
      `INSERT INTO stored_files
         (id, module_key, entity_id, kind, title, original_name, mime_type, size_bytes, storage_path, sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [
        id,
        input.moduleKey,
        input.entityId,
        kind,
        title,
        safeName,
        mimeType,
        input.buffer.length,
        relativePath,
        Number(sort.n) + 1,
        input.userId,
      ],
    );
  } catch (error) {
    try {
      fs.unlinkSync(absPath);
    } catch {
      /* ignore */
    }
    throw error;
  }
  const created = await getStoredFile(id);
  if (!created) reject('internal', 500);
  return created;
}

/** @deprecated 使用 createBinaryAsset；保留兼容旧调用 */
export async function createPdfAsset(input: {
  moduleKey: string;
  entityId: string;
  userId: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  title?: string;
}): Promise<StoredFileRecord> {
  return createBinaryAsset({ ...input, kind: 'pdf' });
}

export async function deleteStoredFile(id: string): Promise<boolean> {
  await ensureStoredFilesTable();
  const existing = await getStoredFile(id);
  if (!existing) return false;
  await pool.query(`DELETE FROM stored_files WHERE id = $1`, [id]);
  if (existing.storagePath) {
    try {
      const abs = resolveUnderUploadDir(existing.storagePath);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {
      /* ignore missing disk file */
    }
  }
  return true;
}

export function absolutePathForStoredFile(file: StoredFileRecord): string | null {
  if (!file.storagePath) return null;
  return resolveUnderUploadDir(file.storagePath);
}

export async function listAllStoredFilesForAdmin(): Promise<StoredFileRecord[]> {
  await ensureStoredFilesTable();
  const rows = (
    await pool.query(
      `SELECT f.id, f.module_key, f.entity_id, f.kind, f.title, f.body_text, f.original_name, f.mime_type,
              f.size_bytes, f.storage_path, f.sort_order, f.created_by, f.created_at, f.updated_at,
              CASE
                WHEN f.module_key = 'project' THEN p.title
                ELSE NULL
              END AS entity_title,
              COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''),
                       NULLIF(TRIM(u.display_name), ''), u.username) AS created_by_name
       FROM stored_files f
       LEFT JOIN school_projects p ON f.module_key = 'project' AND p.id = f.entity_id
       LEFT JOIN users u ON u.id = f.created_by
       ORDER BY f.created_at DESC`,
    )
  ).rows as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export const PROJECT_MODULE_KEY = 'project';
