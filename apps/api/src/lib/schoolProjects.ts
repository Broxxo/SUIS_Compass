import pool from '../config/database.js';
import { createRunOnce } from './runOnce.js';

const ensureOnce = createRunOnce();

export type ProjectStatus = 'active' | 'done' | 'paused';

export type ProjectOwner = { id: string; name: string };

export type SchoolProjectItem = {
  id: string;
  projectId: string;
  groupLabel: string;
  title: string;
  summary: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  owners: ProjectOwner[];
  sortOrder: number;
};

export type SchoolProject = {
  id: string;
  title: string;
  summary: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  lead: ProjectOwner | null;
  participants: ProjectOwner[];
  canEditProject: boolean;
  canEditItems: boolean;
  sortOrder: number;
  items: SchoolProjectItem[];
};

export type ProjectStaff = { id: string; name: string };

type ProjectInput = {
  title: string;
  summary: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  participantIds: string[];
};

type ItemInput = {
  title: string;
  summary: string;
  groupLabel: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  ownerIds: string[];
};

const GUIDE_ITEMS: Array<{ group: string; title: string }> = [
  { group: 'A. 课程理念与课程体系', title: '协和的教育理念' },
  { group: 'A. 课程理念与课程体系', title: '课程目标：落地学习者素养' },
  { group: 'A. 课程理念与课程体系', title: '课程架构：先锋课程与课程图谱' },
  { group: 'A. 课程理念与课程体系', title: '国家课程、校本课程、CCA、ECA' },
  { group: 'A. 课程理念与课程体系', title: '学科课程体系' },
  { group: 'A. 课程理念与课程体系', title: '跨学科课程的实施标准与要求' },
  { group: 'B. 课程组织与学科治理', title: '学科组工作指南' },
  { group: 'B. 课程组织与学科治理', title: '学期课程纲要' },
  { group: 'B. 课程组织与学科治理', title: '纵向衔接与横向协同' },
  { group: 'B. 课程组织与学科治理', title: '新教师怎么带' },
  { group: 'C. 学习评价与学生支持', title: '学生评价政策' },
  { group: 'C. 学习评价与学生支持', title: '形成性评价与终结性评价' },
  { group: 'C. 学习评价与学生支持', title: '考试与质量分析规范' },
  { group: 'C. 学习评价与学生支持', title: '学生支持' },
  { group: 'C. 学习评价与学生支持', title: '桥梁课程与内部直升评价' },
  { group: 'D. 课堂教学与学习设计', title: '单元教学设计' },
  { group: 'D. 课堂教学与学习设计', title: '作业与学习任务设计' },
  { group: 'D. 课堂教学与学习设计', title: '小组合作教学规范' },
  { group: 'D. 课堂教学与学习设计', title: '课堂观摩与反馈标准' },
  { group: 'D. 课堂教学与学习设计', title: '合作课规范与中外合作契约' },
  { group: 'E. 课程质量保障与持续改进', title: '课程的评价' },
  { group: 'E. 课程质量保障与持续改进', title: '课程修订与指南修订机制' },
  { group: 'E. 课程质量保障与持续改进', title: '课程纲要修订' },
  { group: 'E. 课程质量保障与持续改进', title: '年度教学项目清单与特色课程案例' },
];

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function asStatus(raw: unknown): ProjectStatus {
  return raw === 'done' || raw === 'paused' ? raw : 'active';
}

function asDate(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error('invalid_date') as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  return text;
}

function asOwnerIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = [...new Set(raw.map((id) => String(id ?? '').trim()).filter(Boolean))];
  if (ids.length > 12) {
    const error = new Error('too_many_owners') as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  return ids;
}

export function parseProjectInput(body: unknown): ProjectInput {
  const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const title = String(rec.title ?? '').trim();
  if (!title || title.length > 120) {
    const error = new Error('invalid_title') as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  const summary = String(rec.summary ?? '').trim();
  if (summary.length > 2000) {
    const error = new Error('invalid_summary') as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  const startDate = asDate(rec.startDate);
  const endDate = asDate(rec.endDate);
  if (startDate && endDate && endDate < startDate) {
    const error = new Error('invalid_period') as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  return {
    title,
    summary,
    status: asStatus(rec.status),
    startDate,
    endDate,
    participantIds: asOwnerIds(rec.participantIds),
  };
}

export function parseItemInput(body: unknown): ItemInput {
  const base = parseProjectInput(body);
  const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const groupLabel = String(rec.groupLabel ?? '').trim();
  if (groupLabel.length > 80) {
    const error = new Error('invalid_group') as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  return {
    title: base.title,
    summary: base.summary,
    groupLabel,
    status: base.status,
    startDate: base.startDate,
    endDate: base.endDate,
    ownerIds: asOwnerIds(rec.ownerIds),
  };
}

async function assertOwners(ownerIds: string[]): Promise<void> {
  if (ownerIds.length === 0) return;
  const rows = (
    await pool.query(
      `SELECT id FROM users
       WHERE id = ANY($1::varchar[])
         AND role IN ('teacher', 'admin', 'system-admin')`,
      [ownerIds],
    )
  ).rows as Array<{ id: string }>;
  if (rows.length !== ownerIds.length) {
    const error = new Error('unknown_owner') as Error & { status?: number };
    error.status = 400;
    throw error;
  }
}

function reject(message: string, status: number): never {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  throw error;
}

async function assertItemOwners(projectId: string, ownerIds: string[], keptIds: string[] = []): Promise<void> {
  await assertOwners(ownerIds);
  const access = await projectAccess(projectId);
  if (!access) reject('not_found', 404);
  const allowed = new Set(access.participantIds);
  if (access.leadId) allowed.add(access.leadId);
  for (const id of keptIds) allowed.add(id);
  if (ownerIds.some((id) => !allowed.has(id))) reject('owner_not_member', 400);
}

export async function ensureSchoolProjectTables(): Promise<void> {
  await ensureOnce.run(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_projects (
        id VARCHAR(100) PRIMARY KEY,
        title VARCHAR(120) NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'paused')),
        start_date DATE,
        end_date DATE,
        owner_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        sort_order INT NOT NULL DEFAULT 0,
        created_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
        updated_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_project_items (
        id VARCHAR(100) PRIMARY KEY,
        project_id VARCHAR(100) NOT NULL REFERENCES school_projects(id) ON DELETE CASCADE,
        group_label VARCHAR(80) NOT NULL DEFAULT '',
        title VARCHAR(120) NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'paused')),
        start_date DATE,
        end_date DATE,
        owner_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_school_project_items_project
        ON school_project_items(project_id, sort_order)
    `);
    await pool.query(`
      ALTER TABLE school_projects
        ADD COLUMN IF NOT EXISTS lead_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL
    `);
    await pool.query(`
      ALTER TABLE school_projects
        ADD COLUMN IF NOT EXISTS participant_ids JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    await pool.query(`
      UPDATE school_projects
      SET lead_id = created_by
      WHERE lead_id IS NULL AND created_by IS NOT NULL
    `);
    await pool.query(`
      UPDATE school_projects
      SET lead_id = (
        SELECT id FROM users
        WHERE role = 'system-admin'
        ORDER BY created_at ASC NULLS LAST, id ASC
        LIMIT 1
      )
      WHERE lead_id IS NULL
    `);
    const count = (await pool.query(`SELECT COUNT(*)::int AS n FROM school_projects`)).rows[0] as { n: number };
    if (Number(count.n) > 0) return;
    const projectId = 'spj-curriculum-guide';
    await pool.query(
      `INSERT INTO school_projects
         (id, title, summary, status, start_date, end_date, owner_ids, participant_ids, lead_id, sort_order)
       VALUES (
         $1, $2, $3, 'active', '2026-09-01', '2027-06-30', '[]'::jsonb, '[]'::jsonb,
         (SELECT id FROM users WHERE role = 'system-admin' ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1),
         0
       )`,
      [
        projectId,
        '《课程实施指南》编撰与实施',
        '学术委员会牵头，各学科组承担其中的子项目。每一章都从真实问题做起，试过、议过、改过之后再写进指南。负责人与各子项目截止日期待认领。',
      ],
    );
    for (let i = 0; i < GUIDE_ITEMS.length; i++) {
      const item = GUIDE_ITEMS[i];
      await pool.query(
        `INSERT INTO school_project_items
           (id, project_id, group_label, title, summary, status, owner_ids, sort_order)
         VALUES ($1, $2, $3, $4, '', 'active', '[]'::jsonb, $5)`,
        [`spi-guide-${i + 1}`, projectId, item.group, item.title, i],
      );
    }
  });
}

function parseIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => String(id ?? '').trim()).filter(Boolean);
}

function dateText(raw: unknown): string | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    const month = String(raw.getMonth() + 1).padStart(2, '0');
    const day = String(raw.getDate()).padStart(2, '0');
    return `${raw.getFullYear()}-${month}-${day}`;
  }
  const text = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

type ProjectAccess = { leadId: string | null; participantIds: string[] };

async function projectAccess(projectId: string): Promise<ProjectAccess | null> {
  const row = (
    await pool.query(`SELECT lead_id, participant_ids FROM school_projects WHERE id = $1`, [projectId])
  ).rows[0] as { lead_id: string | null; participant_ids: unknown } | undefined;
  if (!row) return null;
  return { leadId: row.lead_id, participantIds: parseIds(row.participant_ids) };
}

export async function userLeadsProject(projectId: string, userId: string): Promise<boolean> {
  const access = await projectAccess(projectId);
  return access?.leadId === userId;
}

export async function userCanEditItems(projectId: string, userId: string): Promise<boolean> {
  const access = await projectAccess(projectId);
  if (!access) return false;
  return access.leadId === userId || access.participantIds.includes(userId);
}

export async function listProjectStaff(): Promise<ProjectStaff[]> {
  const rows = (
    await pool.query(
      `SELECT id,
              COALESCE(NULLIF(TRIM(name_zh), ''), NULLIF(TRIM(name_en), ''),
                       NULLIF(TRIM(display_name), ''), username) AS name
       FROM users
       WHERE role IN ('teacher', 'admin', 'system-admin')
       ORDER BY name ASC`,
    )
  ).rows as Array<{ id: string; name: string }>;
  return rows.map((row) => ({ id: row.id, name: String(row.name) }));
}

export async function listSchoolProjects(userId: string): Promise<SchoolProject[]> {
  await ensureSchoolProjectTables();
  const staff = await listProjectStaff();
  const byId = new Map(staff.map((person) => [person.id, person]));
  const peopleOf = (raw: unknown): ProjectOwner[] =>
    parseIds(raw).map((id) => byId.get(id) ?? { id, name: id });
  const personOf = (id: unknown): ProjectOwner | null => {
    const text = String(id ?? '').trim();
    if (!text) return null;
    return byId.get(text) ?? { id: text, name: text };
  };

  const projects = (
    await pool.query(
      `SELECT id, title, summary, status, start_date, end_date, lead_id, participant_ids, sort_order
       FROM school_projects
       ORDER BY sort_order ASC, created_at ASC`,
    )
  ).rows as Array<Record<string, unknown>>;
  const items = (
    await pool.query(
      `SELECT id, project_id, group_label, title, summary, status, start_date, end_date, owner_ids, sort_order
       FROM school_project_items
       ORDER BY sort_order ASC, created_at ASC`,
    )
  ).rows as Array<Record<string, unknown>>;
  const itemsByProject = new Map<string, SchoolProjectItem[]>();
  for (const row of items) {
    const projectId = String(row.project_id);
    const list = itemsByProject.get(projectId) ?? [];
    list.push({
      id: String(row.id),
      projectId,
      groupLabel: String(row.group_label ?? ''),
      title: String(row.title),
      summary: String(row.summary ?? ''),
      status: asStatus(row.status),
      startDate: dateText(row.start_date),
      endDate: dateText(row.end_date),
      owners: peopleOf(row.owner_ids),
      sortOrder: Number(row.sort_order ?? 0),
    });
    itemsByProject.set(projectId, list);
  }
  return projects.map((row) => {
    const lead = personOf(row.lead_id);
    const participants = peopleOf(row.participant_ids).filter((person) => person.id !== lead?.id);
    const canEditProject = lead?.id === userId;
    return {
      id: String(row.id),
      title: String(row.title),
      summary: String(row.summary ?? ''),
      status: asStatus(row.status),
      startDate: dateText(row.start_date),
      endDate: dateText(row.end_date),
      lead,
      participants,
      canEditProject,
      canEditItems: canEditProject || participants.some((person) => person.id === userId),
      sortOrder: Number(row.sort_order ?? 0),
      items: itemsByProject.get(String(row.id)) ?? [],
    };
  });
}

export async function createSchoolProject(userId: string, input: ProjectInput): Promise<void> {
  await ensureSchoolProjectTables();
  const participantIds = input.participantIds.filter((id) => id !== userId);
  await assertOwners(participantIds);
  const sort = (await pool.query(`SELECT COALESCE(MAX(sort_order), -1)::int AS n FROM school_projects`)).rows[0] as {
    n: number;
  };
  await pool.query(
    `INSERT INTO school_projects
       (id, title, summary, status, start_date, end_date, lead_id, participant_ids, sort_order, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $7, $7)`,
    [
      newId('spj'),
      input.title,
      input.summary,
      input.status,
      input.startDate,
      input.endDate,
      userId,
      JSON.stringify(participantIds),
      Number(sort.n) + 1,
    ],
  );
}

export async function updateSchoolProject(projectId: string, userId: string, input: ProjectInput): Promise<boolean> {
  await ensureSchoolProjectTables();
  if (!(await userLeadsProject(projectId, userId))) return false;
  const participantIds = input.participantIds.filter((id) => id !== userId);
  await assertOwners(participantIds);
  const result = await pool.query(
    `UPDATE school_projects
     SET title = $2, summary = $3, status = $4, start_date = $5, end_date = $6,
         participant_ids = $7::jsonb, updated_by = $8, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND lead_id = $8`,
    [projectId, input.title, input.summary, input.status, input.startDate, input.endDate, JSON.stringify(participantIds), userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteSchoolProject(projectId: string, userId: string): Promise<boolean> {
  await ensureSchoolProjectTables();
  const result = await pool.query(`DELETE FROM school_projects WHERE id = $1 AND lead_id = $2`, [projectId, userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function createSchoolProjectItem(projectId: string, userId: string, input: ItemInput): Promise<boolean> {
  await ensureSchoolProjectTables();
  if (!(await userCanEditItems(projectId, userId))) return false;
  await assertItemOwners(projectId, input.ownerIds);
  const sort = (
    await pool.query(`SELECT COALESCE(MAX(sort_order), -1)::int AS n FROM school_project_items WHERE project_id = $1`, [
      projectId,
    ])
  ).rows[0] as { n: number };
  await pool.query(
    `INSERT INTO school_project_items
       (id, project_id, group_label, title, summary, status, start_date, end_date, owner_ids, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      newId('spi'),
      projectId,
      input.groupLabel,
      input.title,
      input.summary,
      input.status,
      input.startDate,
      input.endDate,
      JSON.stringify(input.ownerIds),
      Number(sort.n) + 1,
    ],
  );
  return true;
}

export async function updateSchoolProjectItem(
  projectId: string,
  itemId: string,
  userId: string,
  input: ItemInput,
): Promise<boolean> {
  await ensureSchoolProjectTables();
  if (!(await userCanEditItems(projectId, userId))) return false;
  const existing = (
    await pool.query(`SELECT owner_ids FROM school_project_items WHERE project_id = $1 AND id = $2`, [projectId, itemId])
  ).rows[0] as { owner_ids: unknown } | undefined;
  if (!existing) return false;
  await assertItemOwners(projectId, input.ownerIds, parseIds(existing.owner_ids));
  const result = await pool.query(
    `UPDATE school_project_items
     SET group_label = $3, title = $4, summary = $5, status = $6, start_date = $7, end_date = $8,
         owner_ids = $9::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE project_id = $1 AND id = $2`,
    [
      projectId,
      itemId,
      input.groupLabel,
      input.title,
      input.summary,
      input.status,
      input.startDate,
      input.endDate,
      JSON.stringify(input.ownerIds),
    ],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteSchoolProjectItem(projectId: string, itemId: string, userId: string): Promise<boolean> {
  await ensureSchoolProjectTables();
  if (!(await userCanEditItems(projectId, userId))) return false;
  const result = await pool.query(`DELETE FROM school_project_items WHERE project_id = $1 AND id = $2`, [
    projectId,
    itemId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function claimSchoolProjectItem(projectId: string, itemId: string, userId: string): Promise<boolean> {
  await ensureSchoolProjectTables();
  if (!(await userCanEditItems(projectId, userId))) return false;
  const row = (
    await pool.query(`SELECT owner_ids FROM school_project_items WHERE project_id = $1 AND id = $2`, [projectId, itemId])
  ).rows[0] as { owner_ids: unknown } | undefined;
  if (!row) return false;
  const ownerIds = parseIds(row.owner_ids);
  if (!ownerIds.includes(userId)) ownerIds.push(userId);
  const result = await pool.query(
    `UPDATE school_project_items
     SET owner_ids = $3::jsonb, updated_at = CURRENT_TIMESTAMP
     WHERE project_id = $1 AND id = $2`,
    [projectId, itemId, JSON.stringify(ownerIds)],
  );
  return (result.rowCount ?? 0) > 0;
}
