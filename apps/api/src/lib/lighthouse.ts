import pool from '../config/database.js';
import type { LighthouseBoard, LighthouseEntry, LighthouseFrame } from './lighthouseTypes.js';

const BOARD_ID = 'school';

function text(value: unknown, max: number): string {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultLighthouseBoard(): LighthouseBoard {
  return {
    front: [
      { id: 'lf-vision', titleZh: '愿景', titleEn: 'Vision', bodyZh: '', bodyEn: '', x: 4, y: 6, w: 32, h: 28 },
      { id: 'lf-mission', titleZh: '使命', titleEn: 'Mission', bodyZh: '', bodyEn: '', x: 64, y: 6, w: 32, h: 28 },
      { id: 'lf-philosophy', titleZh: '教学理念', titleEn: 'Teaching Philosophy', bodyZh: '', bodyEn: '', x: 4, y: 66, w: 32, h: 28 },
      { id: 'lf-competencies', titleZh: '学习者素养', titleEn: 'Learner Competencies', bodyZh: '', bodyEn: '', x: 64, y: 66, w: 32, h: 28 },
    ],
    left: [
      { id: 'll-group', titleZh: '集团发展规划', titleEn: 'Group Development Plan', bodyZh: '', bodyEn: '' },
      { id: 'll-school', titleZh: '学校发展规划', titleEn: 'School Development Plan', bodyZh: '', bodyEn: '' },
      { id: 'll-dept', titleZh: '部门年度工作计划', titleEn: 'Department Annual Plans', bodyZh: '', bodyEn: '' },
    ],
    right: [
      { id: 'lr-teaching', titleZh: '教学管理', titleEn: 'Teaching', bodyZh: '', bodyEn: '' },
      { id: 'lr-students', titleZh: '学生管理', titleEn: 'Students', bodyZh: '', bodyEn: '' },
      { id: 'lr-people', titleZh: '人事与安全', titleEn: 'People and Safety', bodyZh: '', bodyEn: '' },
    ],
  };
}

function cleanFrame(raw: unknown, index: number): LighthouseFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const fallback = defaultLighthouseBoard().front[index];
  const w = num(row.w, 16, 78, fallback?.w ?? 32);
  const h = num(row.h, 14, 72, fallback?.h ?? 28);
  return {
    id: text(row.id, 40) || newId('lf'),
    titleZh: text(row.titleZh, 40),
    titleEn: text(row.titleEn, 80),
    bodyZh: text(row.bodyZh, 8000),
    bodyEn: text(row.bodyEn, 8000),
    x: num(row.x, 0, 100 - w, fallback?.x ?? 4),
    y: num(row.y, 0, 100 - h, fallback?.y ?? 6),
    w,
    h,
  };
}

function cleanEntry(raw: unknown): LighthouseEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const titleZh = text(row.titleZh, 40);
  const titleEn = text(row.titleEn, 80);
  if (!titleZh && !titleEn) return null;
  return {
    id: text(row.id, 40) || newId('le'),
    titleZh,
    titleEn,
    bodyZh: text(row.bodyZh, 8000),
    bodyEn: text(row.bodyEn, 8000),
  };
}

export function sanitizeLighthouseBoard(input: unknown): LighthouseBoard {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const front = Array.isArray(raw.front) ? raw.front.map(cleanFrame).filter((item): item is LighthouseFrame => !!item).slice(0, 8) : [];
  const left = Array.isArray(raw.left) ? raw.left.map(cleanEntry).filter((item): item is LighthouseEntry => !!item).slice(0, 24) : [];
  const right = Array.isArray(raw.right) ? raw.right.map(cleanEntry).filter((item): item is LighthouseEntry => !!item).slice(0, 24) : [];
  const seen = new Set<string>();
  const unique = <T extends { id: string }>(items: T[]): T[] =>
    items.map((item) => {
      let id = item.id;
      while (seen.has(id)) id = newId(id.slice(0, 2) || 'lx');
      seen.add(id);
      return { ...item, id };
    });
  return { front: unique(front), left: unique(left), right: unique(right) };
}

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lighthouse_board (
      id VARCHAR(40) PRIMARY KEY,
      document JSONB NOT NULL,
      updated_by VARCHAR(80),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function loadLighthouseBoard(): Promise<LighthouseBoard> {
  await ensureTable();
  const existing = await pool.query(`SELECT document FROM lighthouse_board WHERE id = $1`, [BOARD_ID]);
  if (existing.rows.length === 0) {
    const board = defaultLighthouseBoard();
    await pool.query(
      `INSERT INTO lighthouse_board (id, document) VALUES ($1, $2::jsonb)`,
      [BOARD_ID, JSON.stringify(board)],
    );
    return board;
  }
  return sanitizeLighthouseBoard(existing.rows[0].document);
}

export async function saveLighthouseBoard(userId: string, input: unknown): Promise<LighthouseBoard> {
  await ensureTable();
  const role = await pool.query(`SELECT role FROM users WHERE id = $1`, [userId]);
  if (role.rows[0]?.role !== 'system-admin') {
    const error = new Error('forbidden') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
  const board = sanitizeLighthouseBoard(input);
  await pool.query(
    `INSERT INTO lighthouse_board (id, document, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (id) DO UPDATE
       SET document = EXCLUDED.document, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [BOARD_ID, JSON.stringify(board), userId],
  );
  return board;
}
