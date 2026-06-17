/** 根据连接串与 PGSSL 环境变量决定是否启用 PostgreSQL SSL（Zeabur/Neon 等托管库常用） */
export function resolvePgSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
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
    // ignore malformed URL
  }

  return false;
}
