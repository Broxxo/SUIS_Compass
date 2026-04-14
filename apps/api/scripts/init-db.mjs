/**
 * 使用 node-pg 执行 init.sql（不依赖本机 psql 命令）
 * 在 apps/api 目录下配置好 .env 后：npm run db:init
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const sqlPath = path.join(__dirname, '..', 'src', 'config', 'init.sql');

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 未设置。请复制 apps/api/.env.example 为 apps/api/.env 并填写。');
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const pool = new pg.Pool({ connectionString: url, ssl: false });

  let lastErr;
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query(sql);
      console.log('init.sql 执行成功');
      await pool.end();
      process.exit(0);
    } catch (e) {
      lastErr = e;
      if (e.code === 'ECONNREFUSED' || e.message?.includes('Connection terminated')) {
        console.warn(`等待数据库就绪 (${i + 1}/30)…`);
        await sleep(1000);
        continue;
      }
      console.error(e);
      await pool.end();
      process.exit(1);
    }
  }
  console.error('无法连接数据库:', lastErr?.message || lastErr);
  await pool.end();
  process.exit(1);
}

main();
