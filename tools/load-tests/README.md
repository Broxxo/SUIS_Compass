# 学业报告 + 教学诊断 压测

模拟一次期末/期中考试后**先锋小学 + 先锋初中**两学段教师并发填写。

## 一键压测

```bash
npm run load:report
```

默认：

- **3 轮**连续覆盖写入
- **2025-26 下学期**（`Semester 2`）**小学期末学业报告**（G1–G6）+ **初中期末学业报告**（G7–G9）**同时**压测
- **仅学业报告**（学科评价 + 班主任评语 + 班科分析），不含教学诊断 KISS
- 学科/班主任并发 **64**、班科分析 **16**、总耗时 **≤120s**

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

兼容旧参数：`--template`、`--portrait-template` 仍可用。

环境：`apps/api/.env` 中 `DATABASE_URL`；API 默认 `http://127.0.0.1:8080`。

## 每轮写入内容

1. **学科报告**：考试科测评成绩覆盖 6 个分数段（10–100）；非考试科仅维度等第
2. **班科分析**：五段式班级整体分析 + **全班 25 人**个别学情/支持计划
3. **班主任综合评价**：多段文字评语（含学生姓名、亮点、建议）
4. **教学诊断 KISS**：全体任课/班主任教师 × 期中 + 期末 Keep/Improve/Stop/Start

分阶段执行：**学科 → 班主任+KISS → 班科分析**，避免并发打满数据库连接池导致 API 假死。

## 校验

- 各学段考试分数跨度与分数段覆盖
- 班科分析轮次标记 + 全班个别学生分析行数
- 班主任评语长度与轮次标记
- 期中/期末教学诊断 KISS 提交覆盖率

结果：`tools/load-tests/artifacts/report-load-*.json`

## 数据准备

```bash
npm run seed:g16:test-students
npm run seed:g789:classes-students
```

## 模块

- `scripts/reportLoadContext.ts` — 任务计划（多学段合并）
- `scripts/reportLoadRunner.ts` — HTTP 执行与校验
- `scripts/run-report-load-test.ts` — CLI 入口
