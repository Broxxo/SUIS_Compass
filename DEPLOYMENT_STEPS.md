# Netlify DB 云端部署详细步骤

## ✅ 已完成
- [x] Netlify DB 安装
- [x] 依赖安装（@neondatabase/serverless, @netlify/neon）
- [x] Neon 账号注册
- [x] 进入 Neon Dashboard

---

## 📋 接下来的步骤

### 步骤 1：获取数据库连接信息（2分钟）

1. **在 Neon Dashboard 中：**
   - 点击右上角的 **"Connect"** 按钮
   - 选择 **"Connection string"** 或 **"Connection pooling"**
   - 复制连接字符串（格式类似：`postgresql://user:password@host/database`）

2. **在 Netlify Dashboard 中：**
   - 进入你的项目
   - 点击 **Site settings** → **Environment variables**
   - 确认 `NETLIFY_DATABASE_URL` 已自动设置（Netlify DB 会自动配置）
   - 如果没有，手动添加：
     - Key: `NETLIFY_DATABASE_URL`
     - Value: 从 Neon Dashboard 复制的连接字符串

**验证：** 在 Netlify Dashboard 的 Environment variables 中应该能看到 `NETLIFY_DATABASE_URL`

---

### 步骤 2：创建数据库表结构（5分钟）

#### 方式一：使用 Neon Dashboard SQL Editor（推荐）

1. **在 Neon Dashboard 左侧菜单：**
   - 点击 **"SQL Editor"**

2. **执行以下 SQL 脚本：**

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

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_semester_data_course ON semester_data(course_id);
CREATE INDEX IF NOT EXISTS idx_semester_data_grade ON semester_data(grade, semester);
CREATE INDEX IF NOT EXISTS idx_courses_created ON courses(created_at);
```

3. **点击 "Run" 执行脚本**

4. **验证表已创建：**
   - 点击左侧菜单的 **"Tables"**
   - 应该能看到三个表：`courses`, `semester_data`, `user_settings`

---

### 步骤 3：创建 Netlify Functions 目录结构（1分钟）

在项目根目录创建以下目录结构：

```bash
mkdir -p netlify/functions
```

你的项目结构应该是：
```
curriculum-roadmap/
├── src/
├── netlify/
│   └── functions/
│       ├── courses.ts
│       ├── semester-data.ts
│       └── user-settings.ts
├── package.json
└── ...
```

---

### 步骤 4：创建 Netlify Functions（15分钟）

#### 4.1 创建 `netlify/functions/courses.ts`

```typescript
import { Handler } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NETLIFY_DATABASE_URL!);

export const handler: Handler = async (event) => {
  // 设置 CORS 头
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  };

  // 处理 OPTIONS 预检请求
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    switch (event.httpMethod) {
      case 'GET':
        // 获取所有课程
        const courses = await sql`
          SELECT 
            id,
            name,
            subject_category as "subjectCategory",
            grade_range as "gradeRange",
            textbook_version as "textbookVersion",
            color,
            weekly_periods as "weeklyPeriods"
          FROM courses 
          ORDER BY created_at DESC
        `;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(courses),
        };

      case 'POST':
        // 创建新课程
        const newCourse = JSON.parse(event.body || '{}');
        await sql`
          INSERT INTO courses (
            id, name, subject_category, grade_range, 
            textbook_version, color, weekly_periods
          )
          VALUES (
            ${newCourse.id},
            ${newCourse.name},
            ${JSON.stringify(newCourse.subjectCategory)},
            ${newCourse.gradeRange || null},
            ${newCourse.textbookVersion || null},
            ${newCourse.color},
            ${newCourse.weeklyPeriods || 2}
          )
        `;
        return {
          statusCode: 201,
          headers,
          body: JSON.stringify({ success: true }),
        };

      case 'PUT':
        // 更新课程
        const updatedCourse = JSON.parse(event.body || '{}');
        await sql`
          UPDATE courses
          SET 
            name = ${updatedCourse.name},
            subject_category = ${JSON.stringify(updatedCourse.subjectCategory)},
            grade_range = ${updatedCourse.gradeRange || null},
            textbook_version = ${updatedCourse.textbookVersion || null},
            color = ${updatedCourse.color},
            weekly_periods = ${updatedCourse.weeklyPeriods || 2},
            updated_at = NOW()
          WHERE id = ${updatedCourse.id}
        `;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };

      case 'DELETE':
        // 删除课程
        const { id } = event.queryStringParameters || {};
        if (!id) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Course ID is required' }),
          };
        }
        await sql`DELETE FROM courses WHERE id = ${id}`;
        return {
          statusCode: 200,
          headers,
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
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
```

#### 4.2 创建 `netlify/functions/semester-data.ts`

```typescript
import { Handler } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NETLIFY_DATABASE_URL!);

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { courseId, grade, semester } = event.queryStringParameters || {};

    switch (event.httpMethod) {
      case 'GET':
        if (courseId && grade && semester) {
          // 获取特定学期数据
          const [data] = await sql`
            SELECT 
              course_id as "courseId",
              grade,
              semester,
              units,
              weekly_periods as "weeklyPeriods"
            FROM semester_data 
            WHERE course_id = ${courseId} 
              AND grade = ${parseInt(grade)} 
              AND semester = ${semester}
          `;
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify(data || null),
          };
        }
        // 获取所有学期数据（用于导出）
        const allData = await sql`
          SELECT 
            course_id as "courseId",
            grade,
            semester,
            units,
            weekly_periods as "weeklyPeriods"
          FROM semester_data
        `;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(allData),
        };

      case 'POST':
      case 'PUT':
        // 保存或更新学期数据
        const semesterData = JSON.parse(event.body || '{}');
        const dataId = `${semesterData.courseId}-${semesterData.grade}-${semesterData.semester}`;
        
        await sql`
          INSERT INTO semester_data (
            id, course_id, grade, semester, units, weekly_periods
          )
          VALUES (
            ${dataId},
            ${semesterData.courseId},
            ${semesterData.grade},
            ${semesterData.semester},
            ${JSON.stringify(semesterData.units || [])},
            ${semesterData.weeklyPeriods || 2}
          )
          ON CONFLICT (id) 
          DO UPDATE SET 
            units = ${JSON.stringify(semesterData.units || [])},
            weekly_periods = ${semesterData.weeklyPeriods || 2},
            updated_at = NOW()
        `;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true }),
        };

      case 'DELETE':
        // 删除特定学期数据
        if (!courseId || !grade || !semester) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'courseId, grade, and semester are required' }),
          };
        }
        const deleteId = `${courseId}-${grade}-${semester}`;
        await sql`DELETE FROM semester_data WHERE id = ${deleteId}`;
        return {
          statusCode: 200,
          headers,
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
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
```

#### 4.3 创建 `netlify/functions/user-settings.ts`

```typescript
import { Handler } from '@netlify/functions';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NETLIFY_DATABASE_URL!);

export const handler: Handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    switch (event.httpMethod) {
      case 'GET':
        // 获取用户设置
        const [settings] = await sql`
          SELECT 
            key_concepts as "keyConcepts",
            category_order as "categoryOrder"
          FROM user_settings 
          WHERE id = 'default'
        `;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(settings || { keyConcepts: [], categoryOrder: [] }),
        };

      case 'POST':
      case 'PUT':
        // 保存用户设置
        const { keyConcepts, categoryOrder } = JSON.parse(event.body || '{}');
        await sql`
          INSERT INTO user_settings (id, key_concepts, category_order)
          VALUES ('default', ${JSON.stringify(keyConcepts || [])}, ${JSON.stringify(categoryOrder || [])})
          ON CONFLICT (id) 
          DO UPDATE SET 
            key_concepts = ${JSON.stringify(keyConcepts || [])},
            category_order = ${JSON.stringify(categoryOrder || [])},
            updated_at = NOW()
        `;
        return {
          statusCode: 200,
          headers,
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
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' }),
    };
  }
};
```

---

### 步骤 5：安装 Netlify Functions 类型定义（1分钟）

```bash
npm install --save-dev @netlify/functions
```

确保 `tsconfig.json` 包含：

```json
{
  "compilerOptions": {
    "types": ["@netlify/functions", "vite/client"]
  }
}
```

---

### 步骤 6：创建云存储适配器（10分钟）

创建 `src/lib/netlifyStorage.ts`：

```typescript
import { Course, SemesterData } from '../types';

const API_BASE = '/.netlify/functions';

// 课程相关
export async function saveCoursesCloud(courses: Course[]): Promise<void> {
  // 先删除所有现有课程，然后批量创建
  // 简化版：逐个保存（可以优化为批量操作）
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
  if (!response.ok) {
    throw new Error('Failed to load courses');
  }
  return await response.json();
}

// 学期数据相关
export async function saveSemesterDataCloud(semesterData: SemesterData): Promise<void> {
  const response = await fetch(`${API_BASE}/semester-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(semesterData),
  });
  if (!response.ok) {
    throw new Error('Failed to save semester data');
  }
}

export async function loadSemesterDataCloud(
  courseId: string,
  grade: number,
  semester: 'Semester 1' | 'Semester 2'
): Promise<SemesterData | null> {
  const response = await fetch(
    `${API_BASE}/semester-data?courseId=${courseId}&grade=${grade}&semester=${semester}`
  );
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return data || null;
}

// 用户设置相关
export async function saveUserSettingsCloud(settings: {
  keyConcepts: string[];
  categoryOrder: string[];
}): Promise<void> {
  const response = await fetch(`${API_BASE}/user-settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error('Failed to save user settings');
  }
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
    keyConcepts: data.keyConcepts || [],
    categoryOrder: data.categoryOrder || [],
  };
}
```

---

### 步骤 7：修改存储层支持双模式（15分钟）

修改 `src/lib/storage.ts`，添加存储模式切换：

```typescript
// 在文件顶部添加
export type StorageMode = 'local' | 'cloud';

let currentStorageMode: StorageMode = 
  (import.meta.env.VITE_STORAGE_MODE as StorageMode) || 'local';

export function setStorageMode(mode: StorageMode) {
  currentStorageMode = mode;
  // 可选：保存到 localStorage
  localStorage.setItem('storage-mode', mode);
}

export function getStorageMode(): StorageMode {
  // 从 localStorage 读取（如果设置了）
  const saved = localStorage.getItem('storage-mode');
  return (saved as StorageMode) || currentStorageMode;
}

// 修改 saveCourses 函数
export async function saveCourses(courses: Course[]): Promise<void> {
  if (getStorageMode() === 'cloud') {
    const { saveCoursesCloud } = await import('./netlifyStorage');
    await saveCoursesCloud(courses);
  } else {
    // 原有的 localStorage 逻辑
    try {
      localStorage.setItem(STORAGE_KEYS.COURSES, JSON.stringify(courses));
    } catch (error) {
      console.error('Failed to save courses to localStorage:', error);
    }
  }
}

// 修改 loadCourses 函数
export async function loadCourses(): Promise<Course[]> {
  if (getStorageMode() === 'cloud') {
    const { loadCoursesCloud } = await import('./netlifyStorage');
    return await loadCoursesCloud();
  } else {
    // 原有的 localStorage 逻辑
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.COURSES);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load courses from localStorage:', error);
    }
    return [];
  }
}

// 类似地修改其他函数：saveSemesterData, loadSemesterData, saveKeyConcepts, loadKeyConcepts, saveCategoryOrder, loadCategoryOrder
```

**注意：** 需要将所有同步函数改为异步函数，并更新所有调用处。

---

### 步骤 8：本地测试（10分钟）

1. **安装 Netlify CLI（如果还没有）：**
   ```bash
   npm install -g netlify-cli
   ```

2. **启动本地开发服务器：**
   ```bash
   netlify dev
   ```
   这会同时启动：
   - Vite 开发服务器（前端）
   - Netlify Functions（后端 API）
   - 自动加载环境变量

3. **测试 API：**
   - 打开浏览器访问 `http://localhost:8888`
   - 打开开发者工具 Network 标签
   - 尝试添加课程，查看 API 调用是否成功

4. **测试数据库连接：**
   - 在应用中添加一个课程
   - 在 Neon Dashboard 的 SQL Editor 中执行：
     ```sql
     SELECT * FROM courses;
     ```
   - 应该能看到新添加的课程

---

### 步骤 9：部署到 Netlify（5分钟）

1. **提交代码：**
   ```bash
   git add .
   git commit -m "Add Netlify DB integration"
   git push
   ```

2. **在 Netlify Dashboard：**
   - 项目会自动部署（如果已配置自动部署）
   - 或手动触发部署：**Deploys** → **Trigger deploy**

3. **验证部署：**
   - 等待部署完成
   - 访问你的网站
   - 测试功能是否正常

---

### 步骤 10：数据迁移（可选，5分钟）

在设置界面添加"迁移到云端"功能：

1. 导出 localStorage 数据（已有功能）
2. 切换到云存储模式
3. 导入数据到云端

---

## ✅ 检查清单

- [ ] 步骤 1：获取数据库连接信息
- [ ] 步骤 2：创建数据库表结构
- [ ] 步骤 3：创建 Functions 目录
- [ ] 步骤 4：创建三个 Functions 文件
- [ ] 步骤 5：安装类型定义
- [ ] 步骤 6：创建云存储适配器
- [ ] 步骤 7：修改存储层支持双模式
- [ ] 步骤 8：本地测试
- [ ] 步骤 9：部署到 Netlify
- [ ] 步骤 10：数据迁移（可选）

---

## 🐛 常见问题

### 问题 1：环境变量未设置
**解决：** 在 Netlify Dashboard → Site settings → Environment variables 中检查 `NETLIFY_DATABASE_URL`

### 问题 2：CORS 错误
**解决：** 确保 Functions 中设置了正确的 CORS 头

### 问题 3：数据库连接失败
**解决：** 检查连接字符串是否正确，确保 Neon 数据库处于活动状态

### 问题 4：表不存在
**解决：** 在 Neon Dashboard 的 SQL Editor 中执行表创建脚本

---

## 📞 需要帮助？

如果遇到问题，告诉我：
1. 具体在哪一步
2. 错误信息是什么
3. 我可以帮你调试
