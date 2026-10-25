import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/** apps/api 根目录（本地默认把 uploads 放在这里，勿与 dist 混放） */
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * 上传根目录：
 * - Zeabur：设 UPLOAD_DIR=/data/uploads（Volume 挂在 /data）
 * - 本地：不设则使用 apps/api/uploads
 */
export function getUploadDir(): string {
  const fromEnv = process.env.UPLOAD_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(apiRoot, 'uploads');
}

/** 确保上传根目录存在；返回绝对路径 */
export function ensureUploadDir(): string {
  const dir = getUploadDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 把相对路径解析到上传根下，防止 .. 逃逸。
 * relativePath 例如 `projects/spj-1/a.pdf`
 */
export function resolveUnderUploadDir(relativePath: string): string {
  const root = path.resolve(getUploadDir());
  const resolved = path.resolve(root, relativePath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    const error = new Error('invalid_upload_path') as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  return resolved;
}
