# 学业报告压测

## 一键压测

```bash
npm run load:report -- --rounds=5
```

可选参数：

| 参数 | 默认 | 说明 |
|------|------|------|
| `--rounds` | 5 | 连续轮次，每轮覆盖上一轮数据 |
| `--concurrency` | 50 | 并发请求数 |
| `--template` | 期中学业报告（测试） | 报告模板标题 |
| `--grade-min` / `--grade-max` | 4 / 6 | 班级年级范围 |
| `--timeout-ms` | 30000 | 单请求超时 |

环境：`apps/api/.env` 中配置 `DATABASE_URL`；API 默认 `http://127.0.0.1:8080`。

## 行为说明

1. **启动前**：读取学年维度预设 + 模板学科，按年级打印「参加评价 / 考试 / 非考试」学科列表。
2. **每轮写入**：学科报告（考试科含测评成绩）→ 班科教学反思（考试科含学科成绩分析）→ 班主任评语。
3. **每轮校验**：评语轮次标记、考试科有分、非考试科无分、反思与分析完整性。
4. **结果**：终端 JSON + `tools/load-tests/artifacts/report-load-*.json`。

## 数据准备（可选）

```bash
npm run seed:g456:test-students
npm run seed:report:midterm-primary-test
```

## 模块

- `scripts/reportLoadContext.ts` — 任务计划与年级学科矩阵
- `scripts/reportLoadRunner.ts` — HTTP 执行与校验
- `scripts/run-report-load-test.ts` — CLI 入口
