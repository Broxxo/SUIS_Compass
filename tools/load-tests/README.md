# 学业报告 + 教学诊断 压测

模拟一次期末/期中考试后**先锋小学 + 先锋初中**两学段教师并发填写。

## 一键压测

```bash
npm run load:report
npm run load:report -- --fast   # 1 轮 · 小学期末+期末诊断 · 跳过三层复查 · 并行写入
```

默认：

- **3 轮**连续覆盖写入
- **2025-26 下学期**（`Semester 2`）**小学期末学业报告**（G1–G6）+ **初中期末学业报告**（G7–G9）**同时**压测
- **仅学业报告**（学科评价 + 班主任评语 + 班科分析），不含教学诊断 KISS
- 学科/班主任并发 **64**、班科分析 **16**、总耗时 **≤120s**

单学段示例：

```bash
npm run load:report -- --rounds=2 --templates=小学期末学业报告 --template-ranges=1-6
```

## 可选参数

| 参数 | 默认 | 说明 |
|------|------|------|
| `--rounds` | 3 | 连续覆盖写入轮次 |
| `--concurrency` | 64 | 学科/班主任并发（勿超过 PG 连接池 ~80） |
| `--insight-concurrency` | 16 | 班科分析并发（payload 大，宜低） |
| `--templates` | 小学期末学业报告,初中期末学业报告 | 多学段模板标题（逗号分隔） |
| `--template-ranges` | 1-6,7-9 | 与 `--templates` 一一对应的年级范围 |
| `--term` | Semester 2 | 学期：`Semester 1` / `Semester 2`（或 `上学期` / `下学期`） |
| `--reports-only` | 是（默认） | 仅压测学业报告，跳过教学诊断 |
| `--with-portraits` | 否 | 同时压测教学诊断 KISS |
| `--portrait-templates` | — | 教学诊断模板（需配合 `--with-portraits`） |
| `--max-wall-ms` | 120000 | 总耗时上限（毫秒） |
| `--timeout-ms` | 25000 | 单请求超时 |
| `--retries` | 2 | 失败重试次数 |
| `--verify-all-rounds=1` | 否 | 每轮都校验（默认仅最后一轮） |
| `--fast` | 否 | **1 轮**压测「小学期末学业报告」+「期末教学诊断」；跳过学科设置日志与三层复查；班主任/班科/KISS **并行** |
| `--skip-tier-verify` | 否 | 跳过三层一致性 HTTP 复查 |

兼容旧参数：`--template`、`--portrait-template` 仍可用。

环境：`apps/api/.env` 中 `DATABASE_URL`；API 默认 `http://127.0.0.1:8080`。

### 账号密码（本地压测）

从**本地库** `users.password` 明文列导出（仅开发数据；云上库通常只有 `password_hash`，无法导出）：

```bash
npm run export:load-credentials
```

生成 `tools/load-tests/credentials.local.json`（**已 gitignore，勿提交 Git**）。压测脚本会按 `username` 自动取密码，无需每次 `--password=`。

示例结构见 `tools/load-tests/credentials.local.example.json`。

**线上压测（JWT）**：设置 `API_BASE_URL=https://你的域名` 即可；**单教师脚本默认纯 API，不需要 `DATABASE_URL`**。密码优先 `credentials.local.json`（若与线上账号一致），否则 `LOAD_TEST_PASSWORD` 或 `--password=`。

### 单教师链路（推荐第一步）

模拟真实登录，先测一位教师完整填写链路，再逐步扩到年级组/全校：

```bash
API_BASE_URL=https://suiscompass.preview.aliyun-zeabur.cn \
LOAD_TEST_PASSWORD='你的教师密码' \
npm run load:report:teacher -- \
  --teacher-name=胡恒星 \
  --template=小学期末学业报告 \
  --grades=1-6 \
  --concurrency=8
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `--teacher-name` | — | 教师中文名 / 显示名（与 `--username` 二选一） |
| `--username` | — | 直接指定登录用户名 |
| `--template` | 小学期末学业报告 | 报告模板标题 |
| `--grades` | 1-6 | 年级范围 |
| `--concurrency` | 8 | 同学科并发（单教师建议 4–12） |
| `--insight-concurrency` | 4 | 班科分析并发 |
| `--password` | — | 或环境变量 `LOAD_TEST_PASSWORD` |

流程：登录 → `my-progress` → 学科/班主任/班科写入 → 再查进度 → DB 校验 → 抽样读学生报告。

### 年级组压测（如四年级全校）

多教师合并执行，自动使用 `credentials.local.json`：

```bash
API_BASE_URL=https://suiscompass.preview.aliyun-zeabur.cn \
npm run load:report:grade -- \
  --grade=4 \
  --template=小学期末学业报告 \
  --concurrency=16 \
  --insight-concurrency=8
```

| 参数 | 默认 | 说明 |
|------|------|------|
| `--grade` | — | 单年级，如 `4` |
| `--grades` | — | 或范围 `4-4` / `1-6` |
| `--template` | 小学期末学业报告 | 报告模板标题 |
| `--concurrency` | 16 | 学科/班主任并发 |
| `--insight-concurrency` | 8 | 班科分析并发 |

需凭据文件中含 **admin/system-admin**（拉取全校班级）及全部 **teacher** 账号。

## 每轮写入内容

1. **学科报告**：考试科按各学科配置的**满分**生成得分（得分率覆盖 6 段）；非考试科仅维度等第
2. **班科分析**：五段式班级整体分析 + **全班 25 人**个别学情/支持计划
3. **班主任综合评价**：多段文字评语（含学生姓名、亮点、建议）
4. **教学诊断 KISS**（`--with-portraits`）：全体任课/班主任教师 × 期中 + 期末 Keep/Improve/Stop/Start

分阶段执行：**学科 → 班主任+KISS → 班科分析**，避免并发打满数据库连接池导致 API 假死。

## 校验

- 各学段考试分数跨度与得分率段覆盖
- 班科分析轮次标记 + 全班个别学生分析行数
- 班主任评语长度与轮次标记
- **三层一致性**：后台学年配置 → 教师压测任务 → 学生 GET 报告 API（`verifyReportTierConsistency.ts`）

结果：`tools/load-tests/artifacts/report-load-*.json`（已 gitignore）

## 数据准备

```bash
npm run seed:g16:test-students      # G1–G6 压测学生与班级
npm run seed:g789:classes-students  # G7–G9 班级与学生
npm run seed:report:import-dimensions   # 模板维度导入学年预设（可选）
npm run seed:report:midterm-primary-test  # 小学段期中学业报告测试模板（可选）
```

压测前可先做配置审计：

```bash
npm run audit:report-templates
```

## 脚本一览（保留集）

| 脚本 | npm 命令 | 用途 |
|------|----------|------|
| `run-report-load-test.ts` | `load:report` | CLI 入口 |
| `reportLoadRunner.ts` | — | HTTP 执行、校验 |
| `reportLoadContext.ts` | — | 任务计划与学年纳入规则 |
| `verifyReportTierConsistency.ts` | — | 三层一致性复查 |
| `audit-report-templates.ts` | `audit:report-templates` | 压测前模板/岗位/纳入审计 |
| `seed-g16-loadtest-students.ts` | `seed:g16:test-students` | 小学压测数据 |
| `seed-g789-classes-students.ts` | `seed:g789:classes-students` | 初中压测数据 |
| `import-report-dimensions-to-preset.ts` | `seed:report:import-dimensions` | 维度导入预设 |
| `seed-midterm-primary-test-report.ts` | `seed:report:midterm-primary-test` | 期中测试模板种子 |
