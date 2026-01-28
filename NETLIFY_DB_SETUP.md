# Netlify DB 集成指南

## 📋 为什么选择 Netlify DB？

1. **零配置集成**：与 Netlify 深度集成，自动配置环境变量
2. **一键安装**：在 Dashboard 点击即可，无需额外注册
3. **统一平台**：代码、部署、数据库都在 Netlify
4. **PostgreSQL**：基于 Neon 的 PostgreSQL，功能强大
5. **自动扩展**：按需扩展，节省成本

---

## 🚀 快速开始

### 步骤 1：安装 Netlify DB

#### 方式一：通过 Dashboard（推荐）
1. 登录 [Netlify Dashboard](https://app.netlify.com)
2. 选择你的项目
3. 点击左侧菜单的 **Extensions** 或 **Add database**
4. 搜索 "Neon database" 并点击 **Install**
5. 点击 **Create new database**
6. 等待几秒钟，数据库自动创建完成

#### 方式二：通过 CLI
```bash
# 在项目根目录运行
npx netlify db init
```

**重要提示：** 7 天内需要链接 Neon 账户以持久化数据库（仍可免费使用）

---

### 步骤 2：安装依赖

```bash
# 安装 Neon 客户端（推荐）
npm install @neondatabase/serverless

# 或者使用 Netlify 官方包
npm install @netlify/neon
```

---

### 步骤 3：创建数据库表结构

在 Netlify Functions 中创建初始化脚本，或直接在 Neon Dashboard 中执行 SQL：

```sql
-- 创建课程表
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject_category JSONB,
  grade_range TEXT,
  textbook_version TEXT,
  color TEXT NOT NULL,
  weekly_periods INTEGER DEFAULT 2,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 创建学期数据表
CREATE TABLE IF NOT EXISTS semester_data (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  grade INTEGER NOT NULL,
  semester TEXT NOT NULL CHECK (semester IN ('Semester 1', 'Semester 2')),
  units JSONB DEFAULT '[]'::jsonb,
  weekly_periods INTEGER DEFAULT 2,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(course_id, grade, semester)
);

-- 创建用户设置表
CREATE TABLE IF NOT EXISTS user_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  key_concepts JSONB DEFAULT '[]'::jsonb,
  category_order JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_semester_data_course ON semester_data(course_id);
CREATE INDEX IF NOT EXISTS idx_semester_data_grade ON semester_data(grade, semester);
```

---

### 步骤 4：创建 Netlify Functions API

创建 `netlify/functions/courses.ts`：

```typescript
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NETLIFY_DATABASE_URL!);

export const handler = async (event: any) => {
  // 设置 CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    switch (event.httpMethod) {
      case 'GET':
        const courses = await sql`SELECT * FROM courses ORDER BY created_at DESC`;
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(courses),
        };

      case 'POST':
        const newCourse = JSON.parse(event.body);
        await sql`
          INSERT INTO courses (id, name, subject_category, grade_range, textbook_version, color, weekly_periods)
          VALUES (${newCourse.id}, ${newCourse.name}, ${JSON.stringify(newCourse.subjectCategory)}, 
                  ${newCourse.gradeRange}, ${newCourse.textbookVersion}, ${newCourse.color}, ${newCourse.weeklyPeriods})
        `;
        return {
          statusCode: 201,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true }),
        };

      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }
  } catch (error: any) {
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
```

创建 `netlify/functions/semester-data.ts`：

```typescript
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NETLIFY_DATABASE_URL!);

export const handler = async (event: any) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { courseId, grade, semester } = event.queryStringParameters || {};

    switch (event.httpMethod) {
      case 'GET':
        if (courseId && grade && semester) {
          const [data] = await sql`
            SELECT * FROM semester_data 
            WHERE course_id = ${courseId} AND grade = ${grade} AND semester = ${semester}
          `;
          return {
            statusCode: 200,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(data || null),
          };
        }
        // 获取所有学期数据
        const allData = await sql`SELECT * FROM semester_data`;
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(allData),
        };

      case 'POST':
      case 'PUT':
        const semesterData = JSON.parse(event.body);
        await sql`
          INSERT INTO semester_data (id, course_id, grade, semester, units, weekly_periods)
          VALUES (${semesterData.id || `${courseId}-${grade}-${semester}`}, 
                  ${semesterData.courseId}, ${semesterData.grade}, ${semesterData.semester},
                  ${JSON.stringify(semesterData.units)}, ${semesterData.weeklyPeriods})
          ON CONFLICT (id) 
          DO UPDATE SET 
            units = ${JSON.stringify(semesterData.units)},
            weekly_periods = ${semesterData.weeklyPeriods},
            updated_at = NOW()
        `;
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true }),
        };

      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }
  } catch (error: any) {
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
```

创建 `netlify/functions/user-settings.ts`：

```typescript
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NETLIFY_DATABASE_URL!);

export const handler = async (event: any) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    switch (event.httpMethod) {
      case 'GET':
        const [settings] = await sql`SELECT * FROM user_settings WHERE id = 'default'`;
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(settings || { keyConcepts: [], categoryOrder: [] }),
        };

      case 'POST':
      case 'PUT':
        const { keyConcepts, categoryOrder } = JSON.parse(event.body);
        await sql`
          INSERT INTO user_settings (id, key_concepts, category_order)
          VALUES ('default', ${JSON.stringify(keyConcepts)}, ${JSON.stringify(categoryOrder)})
          ON CONFLICT (id) 
          DO UPDATE SET 
            key_concepts = ${JSON.stringify(keyConcepts)},
            category_order = ${JSON.stringify(categoryOrder)},
            updated_at = NOW()
        `;
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true }),
        };

      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }
  } catch (error: any) {
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
    };
  }
};
```

---

### 步骤 5：创建云存储适配器

创建 `src/lib/netlifyStorage.ts`：

```typescript
import { Course, SemesterData } from '../types';

const API_BASE = '/.netlify/functions';

// 课程相关
export async function saveCoursesCloud(courses: Course[]): Promise<void> {
  // 批量保存（简化版：逐个保存）
  for (const course of courses) {
    await fetch(`${API_BASE}/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(course),
    });
  }
}

export async function loadCoursesCloud(): Promise<Course[]> {
  const response = await fetch(`${API_BASE}/courses`);
  if (!response.ok) throw new Error('Failed to load courses');
  const courses = await response.json();
  // 转换数据库格式到应用格式
  return courses.map((c: any) => ({
    id: c.id,
    name: c.name,
    subjectCategory: c.subject_category,
    gradeRange: c.grade_range,
    textbookVersion: c.textbook_version,
    color: c.color,
    weeklyPeriods: c.weekly_periods,
  }));
}

// 学期数据相关
export async function saveSemesterDataCloud(semesterData: SemesterData): Promise<void> {
  await fetch(`${API_BASE}/semester-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: `${semesterData.courseId}-${semesterData.grade}-${semesterData.semester}`,
      courseId: semesterData.courseId,
      grade: semesterData.grade,
      semester: semesterData.semester,
      units: semesterData.units,
      weeklyPeriods: semesterData.weeklyPeriods,
    }),
  });
}

export async function loadSemesterDataCloud(
  courseId: string,
  grade: number,
  semester: 'Semester 1' | 'Semester 2'
): Promise<SemesterData | null> {
  const response = await fetch(
    `${API_BASE}/semester-data?courseId=${courseId}&grade=${grade}&semester=${semester}`
  );
  if (!response.ok) return null;
  const data = await response.json();
  if (!data) return null;
  
  return {
    courseId: data.course_id,
    grade: data.grade,
    semester: data.semester,
    units: data.units,
    weeklyPeriods: data.weekly_periods,
  };
}

// 用户设置相关
export async function saveUserSettingsCloud(settings: {
  keyConcepts: string[];
  categoryOrder: string[];
}): Promise<void> {
  await fetch(`${API_BASE}/user-settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

export async function loadUserSettingsCloud(): Promise<{
  keyConcepts: string[];
  categoryOrder: string[];
}> {
  const response = await fetch(`${API_BASE}/user-settings`);
  if (!response.ok) {
    return { keyConcepts: [], categoryOrder: [] };
  }
  const data = await response.json();
  return {
    keyConcepts: data.key_concepts || [],
    categoryOrder: data.category_order || [],
  };
}
```

---

### 步骤 6：修改存储层支持双模式

修改 `src/lib/storage.ts`，添加云存储支持（参考 CLOUD_UPGRADE.md 中的步骤四）

---

### 步骤 7：配置 TypeScript 和构建

确保 `tsconfig.json` 包含 Netlify Functions 类型：

```json
{
  "compilerOptions": {
    "types": ["@netlify/functions"]
  }
}
```

安装类型定义：
```bash
npm install --save-dev @netlify/functions
```

---

## 📝 部署检查清单

- [ ] 在 Netlify Dashboard 安装 Neon 扩展
- [ ] 创建数据库并执行 SQL 初始化脚本
- [ ] 安装 `@neondatabase/serverless`
- [ ] 创建 Netlify Functions（courses, semester-data, user-settings）
- [ ] 创建云存储适配器
- [ ] 修改存储层支持双模式
- [ ] 测试本地开发（`netlify dev`）
- [ ] 部署到 Netlify
- [ ] 测试生产环境 API

---

## 🔄 数据迁移

在设置界面添加"迁移到云端"功能，将 localStorage 数据上传到 Netlify DB。

---

## 💡 优势总结

1. **零配置**：环境变量自动设置
2. **统一平台**：所有服务在 Netlify
3. **PostgreSQL**：强大的 SQL 数据库
4. **自动扩展**：按需扩展，节省成本
5. **简单集成**：与现有 Netlify 部署无缝集成
