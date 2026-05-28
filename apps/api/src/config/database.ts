import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 始终从 apps/api/.env 加载（无论从仓库根目录还是 apps/api 启动 workspace 脚本） */
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set!');
  process.exit(1);
}

/** 默认 80：在 Postgres max_connections=100 时留余量给管理连接/第二实例；生产可在 .env 按库上限调高 */
const poolMax = Math.min(100, Math.max(10, parseInt(process.env.PG_POOL_MAX || '80', 10) || 80));

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // 勿因单条空闲连接被 PG 断开就退出整个 API（如 OrbStack/DB 重启时的 57P01）
  console.error('Unexpected error on idle PostgreSQL client', err);
});

export default pool;
