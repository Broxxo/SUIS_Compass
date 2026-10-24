import pool from '../config/database.js';

/** 模块额外授权：不跟学年走，一档 = 该模块的管理/填写权限。 */
export const MODULE_PERMISSION_KEYS = [
  'calendar-month',
  'calendar-week',
  'open-lessons',
  'curriculum',
  'student-center',
  'teacher-center',
  'mailbox',
  'lighthouse',
  'admin',
] as const;

export type ModulePermissionKey = (typeof MODULE_PERMISSION_KEYS)[number];

export type ModulePermissionGrant = {
  id: string;
  moduleKey: ModulePermissionKey;
  userId: string;
  userName: string;
  grantedBy: string | null;
  createdAt: string | null;
};

export type ModulePermissionCatalogItem = {
  key: ModulePermissionKey;
  labelZh: string;
  labelEn: string;
  defaultAccessZh: string;
  defaultAccessEn: string;
  elevatedZh: string;
  elevatedEn: string;
};

export const MODULE_PERMISSION_CATALOG: ModulePermissionCatalogItem[] = [
  {
    key: 'calendar-month',
    labelZh: '校历 · 月历',
    labelEn: 'Calendar · Month',
    defaultAccessZh: '全体教职工可查看。管理员与协调员可以修改全部月历。',
    defaultAccessEn: 'All staff can view. Admins and coordinators can edit the whole month calendar.',
    elevatedZh: '可改周主题，并填写全部模块的月历焦点。',
    elevatedEn: 'Can edit week themes and all month-view module focuses.',
  },
  {
    key: 'calendar-week',
    labelZh: '校历 · 周历',
    labelEn: 'Calendar · Week',
    defaultAccessZh:
      '全体教职工可查看。组长可新建并修改自己创建的事项（含过往周，不限模块）。协调员可在分管学部模块新建，并修改这些模块里组长创建的事项。管理员可改全部。',
    defaultAccessEn:
      'All staff can view. Leads can create and edit events they created, including past weeks, on any module. Coordinators can create on their division modules and edit events created there by leads. Admins can edit all.',
    elevatedZh: '可在全部模块中新建本周及以后的事项，并修改、删除全部周历事项（含过往周）。',
    elevatedEn: 'Can create events on every module from this week onward, and edit or delete all week events including past weeks.',
  },
  {
    key: 'open-lessons',
    labelZh: '公开课',
    labelEn: 'Open lessons',
    defaultAccessZh: '全体教职工可查看组内/校级课，并填写自己的组内课与日常课。学科组长与「教学管理」协调员可管其学科组；校级课需组长或管理员新建。',
    defaultAccessEn: 'Staff view group/school lessons and fill their own group/routine lessons. Subject leads and teaching coordinators manage their groups; school-level needs a lead or admin.',
    elevatedZh: '可管理全部学科组的公开课，并新建校级公开课。',
    elevatedEn: 'Can manage open lessons for every subject group and create school-level lessons.',
  },
  {
    key: 'curriculum',
    labelZh: '课程河流',
    labelEn: 'Curriculum river',
    defaultAccessZh: '全体教职工可查看；管理员可管理课程；学科组长可编辑单元格子。',
    defaultAccessEn: 'All staff can view; admins manage courses; subject leads edit unit cells.',
    elevatedZh: '可进行课程河流的管理操作（含新建课程等，与管理员同等）。',
    elevatedEn: 'Full curriculum management including creating courses, like an admin.',
  },
  {
    key: 'student-center',
    labelZh: '学生中心',
    labelEn: 'Student center',
    defaultAccessZh: '全体教职工可进入；可见范围由班主任、任课、年级组长等岗位决定。管理员可看全校。',
    defaultAccessEn: 'All staff can enter; scope follows homeroom, teaching, and grade-head posts. Admins see the whole school.',
    elevatedZh: '可按管理员范围查看与操作学生中心。',
    elevatedEn: 'Student-center access at admin scope.',
  },
  {
    key: 'teacher-center',
    labelZh: '教师中心',
    labelEn: 'Teacher center',
    defaultAccessZh: '全体教职工可进入；默认可看自己。学科组长看本组；管理员可看全校。',
    defaultAccessEn: 'All staff can enter; default is self. Subject leads see their group; admins see the school.',
    elevatedZh: '可按管理员范围查看与操作教师中心。',
    elevatedEn: 'Teacher-center access at admin scope.',
  },
  {
    key: 'mailbox',
    labelZh: '信箱',
    labelEn: 'Mailbox',
    defaultAccessZh: '全体教职工可写信与查看自己的信件。管理员可查看全部并回复、改状态。',
    defaultAccessEn: 'Staff write and see their own messages. Admins see all, reply, and change status.',
    elevatedZh: '可查看全部信件并回复、处理（与管理员信箱权限相同）。',
    elevatedEn: 'Can view all messages, reply, and manage status like an admin.',
  },
  {
    key: 'lighthouse',
    labelZh: '协和灯塔',
    labelEn: 'Xiehe Lighthouse',
    defaultAccessZh: '全体教职工可查看。管理员与系统管理员可编辑。',
    defaultAccessEn: 'All staff can view. Admins and system admins can edit.',
    elevatedZh: '可编辑灯塔墙上的发布内容。',
    elevatedEn: 'Can edit published lighthouse wall content.',
  },
  {
    key: 'admin',
    labelZh: '后台入口',
    labelEn: 'Admin panel',
    defaultAccessZh: '仅管理员与系统管理员可进入后台。',
    defaultAccessEn: 'Only admins and system-admins can open the admin panel.',
    elevatedZh: '可进入后台管理（数据库浏览仍仅系统管理员）。',
    elevatedEn: 'Can open the admin panel (database browser stays system-admin only).',
  },
];

const KEY_SET = new Set<string>(MODULE_PERMISSION_KEYS);

let ensured = false;

export async function ensureModulePermissionGrantsTable(): Promise<void> {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS module_permission_grants (
      id VARCHAR(100) PRIMARY KEY,
      module_key VARCHAR(40) NOT NULL,
      user_id VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      granted_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (module_key, user_id)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_module_permission_grants_user
      ON module_permission_grants(user_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_module_permission_grants_module
      ON module_permission_grants(module_key)
  `);
  ensured = true;
}

function isModuleKey(value: string): value is ModulePermissionKey {
  return KEY_SET.has(value);
}

function newId(): string {
  return `mpg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const NAME_SQL = `COALESCE(NULLIF(TRIM(u.name_zh), ''), NULLIF(TRIM(u.name_en), ''),
  NULLIF(TRIM(u.display_name), ''), u.username, u.id)`;

export async function listModuleGrantsForUser(userId: string): Promise<ModulePermissionKey[]> {
  if (!userId) return [];
  await ensureModulePermissionGrantsTable();
  const rows = (
    await pool.query(`SELECT module_key FROM module_permission_grants WHERE user_id = $1`, [userId])
  ).rows as Array<{ module_key: string }>;
  return rows.map((row) => row.module_key).filter(isModuleKey);
}

export async function userHasModuleGrant(userId: string, moduleKey: ModulePermissionKey): Promise<boolean> {
  if (!userId) return false;
  await ensureModulePermissionGrantsTable();
  const row = (
    await pool.query(
      `SELECT 1 FROM module_permission_grants WHERE user_id = $1 AND module_key = $2 LIMIT 1`,
      [userId, moduleKey],
    )
  ).rows[0];
  return Boolean(row);
}

export async function listAllModulePermissionGrants(): Promise<ModulePermissionGrant[]> {
  await ensureModulePermissionGrantsTable();
  const rows = (
    await pool.query(
      `SELECT g.id, g.module_key, g.user_id, g.granted_by, g.created_at,
              ${NAME_SQL} AS user_name
       FROM module_permission_grants g
       JOIN users u ON u.id = g.user_id
       ORDER BY g.module_key ASC, user_name ASC`,
    )
  ).rows as Array<{
    id: string;
    module_key: string;
    user_id: string;
    granted_by: string | null;
    created_at: Date | string | null;
    user_name: string;
  }>;
  return rows
    .filter((row) => isModuleKey(row.module_key))
    .map((row) => ({
      id: row.id,
      moduleKey: row.module_key as ModulePermissionKey,
      userId: row.user_id,
      userName: row.user_name,
      grantedBy: row.granted_by,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));
}

export async function getModulePermissionOverview() {
  const grants = await listAllModulePermissionGrants();
  const byModule = new Map<ModulePermissionKey, ModulePermissionGrant[]>();
  for (const key of MODULE_PERMISSION_KEYS) byModule.set(key, []);
  for (const grant of grants) {
    byModule.get(grant.moduleKey)?.push(grant);
  }
  return MODULE_PERMISSION_CATALOG.map((item) => ({
    ...item,
    grants: byModule.get(item.key) ?? [],
  }));
}

export async function addModulePermissionGrant(input: {
  moduleKey: string;
  userId: string;
  grantedBy?: string | null;
}): Promise<ModulePermissionGrant> {
  await ensureModulePermissionGrantsTable();
  if (!isModuleKey(input.moduleKey)) throw new Error('invalid_module');
  const userId = input.userId.trim();
  if (!userId) throw new Error('user_required');
  const userRow = (
    await pool.query(
      `SELECT u.id, u.role, ${NAME_SQL} AS user_name FROM users u WHERE u.id = $1`,
      [userId],
    )
  ).rows[0] as { id: string; role: string; user_name: string } | undefined;
  if (!userRow) throw new Error('user_not_found');
  if (userRow.role === 'student') throw new Error('student_forbidden');
  const id = newId();
  try {
    await pool.query(
      `INSERT INTO module_permission_grants (id, module_key, user_id, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (module_key, user_id) DO UPDATE SET
         granted_by = EXCLUDED.granted_by,
         updated_at = CURRENT_TIMESTAMP`,
      [id, input.moduleKey, userId, input.grantedBy ?? null],
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      // unique hit on race: fetch existing
    } else {
      throw error;
    }
  }
  const row = (
    await pool.query(
      `SELECT g.id, g.module_key, g.user_id, g.granted_by, g.created_at, ${NAME_SQL} AS user_name
       FROM module_permission_grants g
       JOIN users u ON u.id = g.user_id
       WHERE g.module_key = $1 AND g.user_id = $2`,
      [input.moduleKey, userId],
    )
  ).rows[0] as {
    id: string;
    module_key: string;
    user_id: string;
    granted_by: string | null;
    created_at: Date | string | null;
    user_name: string;
  };
  return {
    id: row.id,
    moduleKey: row.module_key as ModulePermissionKey,
    userId: row.user_id,
    userName: row.user_name,
    grantedBy: row.granted_by,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

export async function deleteModulePermissionGrant(id: string): Promise<boolean> {
  await ensureModulePermissionGrantsTable();
  const result = await pool.query(`DELETE FROM module_permission_grants WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
