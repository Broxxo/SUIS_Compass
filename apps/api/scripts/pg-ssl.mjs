/** 与 apps/api/src/config/pgSsl.ts 保持一致（供 init-db.mjs 使用） */
export function resolvePgSsl(connectionString) {
  if (process.env.PGSSL === 'false') return false;
  if (process.env.PGSSL === 'true') return { rejectUnauthorized: false };

  try {
    const url = new URL(connectionString.replace(/^postgres(ql)?:\/\//, 'https://'));
    const mode = url.searchParams.get('sslmode')?.toLowerCase();
    if (mode === 'require' || mode === 'verify-ca' || mode === 'prefer') {
      return { rejectUnauthorized: false };
    }
    if (mode === 'verify-full') {
      return { rejectUnauthorized: true };
    }
  } catch {
    // ignore
  }

  return false;
}
