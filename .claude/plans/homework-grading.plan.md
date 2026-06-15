# Plan: 作业批改与成长追踪系统

**Source**: 对话需求 — 文件系统驱动的作业批改 + 答案审核门 + 学生成长记录
**Complexity**: Large

## Summary

以**文件系统为数据源、数据库记录元数据**的作业批改系统。教师将作业图片按约定目录结构放入文件夹 → Hermes 扫描发现 → 提取答案模板 → **教师审核确认** → 批量批改 → 生成两份文档（作业总结 + 学生成长记录）。评分规则通过 `config.yaml` 可配置，成长记录累积追加支持长期学习规划。

## 目录结构设计

```
作业/                                    ← rootPath（可配置）
├── 2012级3班/                           ← 班级目录
│   ├── 2025_12_3_语文随堂测试/           ← 单次作业目录
│   │   ├── 答案.png                     ← 教师答案（文件名含"答案"关键词）
│   │   ├── 答案_第2页.png               ← 多页答案（同关键词的图片归为一组）
│   │   ├── 张三/                        ← 多页作业 → 学生子目录
│   │   │   ├── 第1页.png
│   │   │   └── 第2页.png
│   │   ├── 李四.png                     ← 单页作业 → 直接用学生名命名
│   │   ├── 王芳.png
│   │   └── 批改报告_2025_12_3_语文随堂测试.md  ← 🆕 自动生成
│   │
│   ├── 2025_12_10_数学单元测试/
│   │   ├── 答案.png
│   │   ├── 赵明.png
│   │   ├── 李四.png
│   │   └── 批改报告_2025_12_10_数学单元测试.md
│   │
│   ├── 张三_成长记录.md                  ← 🆕 累积式个人档案
│   ├── 李四_成长记录.md
│   ├── 王芳_成长记录.md
│   └── 赵明_成长记录.md
│
├── 2012级4班/
│   └── ...
```

### 文件识别规则

| 规则 | 说明 | 可配置 |
|------|------|--------|
| 答案关键词 | 文件名含 "答案" 即为教师答案（如 `答案.png`、`答案_第2页.png`） | `grading.answerKeyword` |
| 学生识别 | 除答案外的图片/目录，名为学生姓名 | — |
| 多页判断 | 是目录 → 多页作业（目录下所有图片拼为一套）；是单文件 → 单页作业 | — |
| 报告命名 | `批改报告_{作业目录名}.md` | `grading.reportFilename` |
| 成长记录 | `{学生名}_成长记录.md` | `grading.growthFilename` |

## 批改流程

```
教师操作                          Hermes 系统
────────                         ────────────
1. 把图片放入对应目录
                                2. 扫描目录，发现新作业
3. 在界面看到作业列表
   点击"提取答案"
                                4. Qwen-VL 解析答案图片
                                5. 返回结构化答案 → 前端展示
6. 教师逐题核对
   修改不准确的答案/分值
   点击"确认，开始批改"
                                7. 遍历每个学生的图片
                                8. Qwen-VL 逐一批改
                                9. 实时推送进度（3/30）
                                10. 全部完成 → 写入两份文档
11. 查看批改报告
    查看学生成长记录
```

### 关键交互：答案审核门

这是整个流程中最重要的 Teacher-in-the-loop 节点：

- 提取出的答案以**可编辑表格**展示（题目编号、题型、正确答案、分值）
- 教师可以：修改答案文字、调整分值、删除错误的题目、手动添加遗漏的题目
- 确认后的模板存入数据库，作为后续批改的黄金标准
- 已被教师修正过的模板可缓存，下次同类型作业可复用

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| 路由注册 | [routes/index.ts:33](packages/server/src/routes/index.ts#L33) | 导出 `gradingRoutes = new Router()`，在 `index.ts` 中 `app.use(gradingRoutes.routes())` |
| 控制器签名 | [controllers/hermes/kanban.ts:1-15](packages/server/src/controllers/hermes/kanban.ts#L1-L15) | `(ctx: Context) => Promise<void>`，`ctx.body` 返回 JSON |
| 数据库 Schema | [db/hermes/schemas.ts:10-23](packages/server/src/db/hermes/schemas.ts#L10-L23) | `Record<string, string>` 格式，`initAllHermesTables()` 集中创建 |
| 配置读写 | [controllers/hermes/config.ts:164-179](packages/server/src/controllers/hermes/config.ts#L164-L179) | YAML via `safeFileStore`，深合并回写 `config.yaml` |
| 文件操作 | [services/hermes/file-provider.ts](packages/server/src/services/hermes/file-provider.ts) | 文件系统扫描、读写 |
| 客户端 API | [api/hermes/kanban.ts:1-6](packages/client/src/api/hermes/kanban.ts#L1-L6) | `request()` from `api/client` |
| 异步长任务 | [api/hermes/jobs.ts](packages/client/src/api/hermes/jobs.ts) | Job 模式：提交返回 jobId，轮询进度 |
| 错误处理 | [controllers/hermes/kanban.ts:41-46](packages/server/src/controllers/hermes/kanban.ts#L41-L46) | try-catch → `ctx.status = 4xx/5xx` + `{ error }` |

## Files to Change

| File | Action | Why |
|---|---|---|
| `packages/server/src/db/hermes/schemas.ts` | UPDATE | 新增 3 张表 |
| `packages/server/src/db/hermes/grading-store.ts` | CREATE | 元数据 CRUD |
| `packages/server/src/services/hermes/grading/scanner.ts` | CREATE | 扫描目录树，发现班级/作业/学生/答案 |
| `packages/server/src/services/hermes/grading/grader.ts` | CREATE | Qwen-VL API 客户端 + JSON 3 层容错 |
| `packages/server/src/services/hermes/grading/template-extractor.ts` | CREATE | 答案提取 + 教师修正合并 |
| `packages/server/src/services/hermes/grading/batch-grader.ts` | CREATE | 批量批改编排：遍历学生、调 API、推送进度 |
| `packages/server/src/services/hermes/grading/report-writer.ts` | CREATE | 写入批改报告.md + 更新成长记录.md |
| `packages/server/src/services/hermes/grading/growth-analyzer.ts` | CREATE | 读取历史成长记录，分析趋势，生成建议 |
| `packages/server/src/routes/hermes/grading.ts` | CREATE | API 路由（12 个端点） |
| `packages/server/src/controllers/hermes/grading.ts` | CREATE | 业务逻辑 + 权限 + 参数校验 |
| `packages/server/src/routes/index.ts` | UPDATE | 注册 gradingRoutes |
| `packages/client/src/api/hermes/grading.ts` | CREATE | 前端 API + TypeScript 类型 |
| `packages/client/src/stores/hermes/grading.ts` | CREATE | Pinia Store（含轮询逻辑） |
| `packages/client/src/views/hermes/GradingView.vue` | CREATE | 主页面 |
| `packages/client/src/components/hermes/grading/ClassTree.vue` | CREATE | 左侧班级→作业树 |
| `packages/client/src/components/hermes/grading/AnswerReview.vue` | CREATE | 🎯 答案审核编辑面板（核心交互） |
| `packages/client/src/components/hermes/grading/GradingProgress.vue` | CREATE | 实时批改进度条 |
| `packages/client/src/components/hermes/grading/ResultTable.vue` | CREATE | 成绩表格 + 错题分析 |
| `packages/client/src/components/hermes/grading/GrowthTimeline.vue` | CREATE | 学生成长时间线 |
| `packages/skills/homework-grading/SKILL.md` | CREATE | 对话入口 Skill |

## Database Tables

### grading_assignments — 作业元数据
| Field | Type | Description |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | 作业 ID |
| class_name | TEXT NOT NULL | 班级名（如 "2012级3班"） |
| dir_name | TEXT NOT NULL | 目录名（如 "2025_12_3_语文随堂测试"） |
| dir_path | TEXT NOT NULL | 完整路径 |
| subject | TEXT | 学科（从目录名推断） |
| answer_images | TEXT NOT NULL DEFAULT '[]' | 答案图片路径 JSON 数组 |
| student_count | INTEGER NOT NULL DEFAULT 0 | 学生总数 |
| status | TEXT NOT NULL DEFAULT 'discovered' | discovered / template_extracting / template_ready / grading / done / error |
| created_at | INTEGER NOT NULL | Unix 时间戳 |

### grading_templates — 答案模板（含教师修正）
| Field | Type | Description |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | 模板 ID |
| assignment_id | INTEGER NOT NULL UNIQUE | 关联作业 |
| raw_extraction | TEXT NOT NULL | LLM 原始提取 JSON |
| corrected_data | TEXT NOT NULL | 教师修正后的 JSON（初始 = raw） |
| is_confirmed | INTEGER NOT NULL DEFAULT 0 | 教师是否已确认 |
| confirmed_at | INTEGER | 确认时间戳 |
| created_at | INTEGER NOT NULL | Unix 时间戳 |

### grading_results — 单生批改结果
| Field | Type | Description |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | 结果 ID |
| assignment_id | INTEGER NOT NULL | 关联作业 |
| student_name | TEXT NOT NULL | 学生姓名 |
| image_paths | TEXT NOT NULL DEFAULT '[]' | 作业图片路径 JSON |
| score | REAL NOT NULL DEFAULT 0 | 得分 |
| total | REAL NOT NULL DEFAULT 0 | 满分 |
| correct_count | INTEGER NOT NULL DEFAULT 0 | 正确题数 |
| question_count | INTEGER NOT NULL DEFAULT 0 | 总题数 |
| details | TEXT NOT NULL DEFAULT '[]' | JSON: 每题结果 |
| evaluation | TEXT NOT NULL DEFAULT '' | LLM 评语 |
| error_analysis | TEXT | 错题归因 JSON |
| created_at | INTEGER NOT NULL | Unix 时间戳 |

## API Endpoints

```
课堂管理
GET    /api/hermes/grading/classes                     — 列出所有班级
GET    /api/hermes/grading/classes/:name/assignments   — 列出班级下所有作业

作业操作
GET    /api/hermes/grading/assignments/:id             — 作业详情（学生列表、状态）
POST   /api/hermes/grading/assignments/scan            — 扫描 rootPath，发现新作业
POST   /api/hermes/grading/assignments/:id/extract     — 提取答案模板
GET    /api/hermes/grading/assignments/:id/template    — 获取模板（含教师修正版）
PUT    /api/hermes/grading/assignments/:id/template    — 教师保存修正后的模板
POST   /api/hermes/grading/assignments/:id/grade       — 确认并开始批量批改
GET    /api/hermes/grading/assignments/:id/progress    — 轮询批改进度

结果查看
GET    /api/hermes/grading/assignments/:id/report      — 下载/查看作业批改报告
GET    /api/hermes/grading/results?assignment_id=&student= — 查询结果列表

成长记录
GET    /api/hermes/grading/students/:name/growth       — 获取学生成长记录（JSON）
GET    /api/hermes/grading/students/:name/growth/raw   — 原始 MD 内容（供展示）
POST   /api/hermes/grading/students/:name/growth/analyze — 分析趋势生成建议

配置
GET    /api/hermes/grading/config                      — 获取 grading 配置
PUT    /api/hermes/grading/config                      — 更新 grading 配置
```

## Config Structure (config.yaml → grading)

```yaml
grading:
  rootPath: "./作业"                # 作业根目录（相对于 Hermes data 目录或绝对路径）
  answerKeyword: "答案"             # 识别教师答案图片的文件名关键词
  reportPrefix: "批改报告"          # 作业总结报告文件名前缀
  growthSuffix: "_成长记录"         # 学生成长记录文件名后缀（{学生名}_成长记录.md）
  
  models:
    extract: qwen3-vl-plus         # 答案提取
    grade: qwen3-vl-plus           # 学生批改
    trend: qwen3-vl-235b-a22b      # 成长趋势分析（需强推理）
  
  rubrics:
    default:
      objective_rules: "选择题每题{score}分，答对满分答错0分"
      calculation_rules: "计算题：答案正确{score}分；过程对答案错得{partial}分"
      subjective_rules: "主观题：按要点给分，每个要点{score}分"
  
  prompts:
    extract_template: "你是一位{subject}教师，请从以下答案图片中提取..."
    grade_student: "你是一位严格的{grade}{subject}教师，请批改以下学生作业..."
    growth_summary: "你是一位教育分析师，根据以下学生的历史成绩记录，分析趋势..."
  
  growth:
    track_weak_points: true        # 追踪薄弱知识点
    track_strengths: true           # 追踪优势领域
    trend_window: 10               # 趋势分析取最近 N 次记录
    auto_suggestion: true          # 自动生成学习建议
```

## 成长记录 MD 格式

```markdown
# {学生名} — 学习成长记录

**班级**: {班级名}
**首次记录**: {日期}

---

## {作业名} ({日期})
- **学科**: {语文/数学/英语}
- **得分**: {得分}/{满分} ({百分比}%)
- **正确率**: {正确题数}/{总题数}
- **错题**:
  | 题号 | 题型 | 学生答案 | 正确答案 | 失分 |
  |------|------|----------|----------|------|
  | 3 | 填空 | 鸟 | 鸡 | 5 |
- **薄弱点**: {从错题归因提取}
- **进步点**: {从正确题提取的优势}
- **教师评语**: {LLM 生成}

---

## 综合趋势分析

> 此部分由 trend 模型在每次批改后自动更新

| 学科 | 最近 3 次 | 趋势 | 建议 |
|------|-----------|------|------|
| 语文 | 75→85→88 | ↑ 稳步提升 | 古诗文进步明显，继续保持 |
| 数学 | 88→92→90 | → 稳定 | 应用题仍是薄弱环节，需专项练习 |
```

## Tasks

### Phase 1: 基础设施

| # | Task | Description | Mirror | Validate |
|---|---|---|---|---|
| 1 | 数据库 Schema | schemas.ts 新增 3 表 + 索引 + init | [schemas.ts:10](packages/server/src/db/hermes/schemas.ts#L10) | `npm test` |
| 2 | GradingStore | CRUD: 作业、模板、结果 | [sessions-db.ts](packages/server/src/db/hermes/sessions-db.ts) | 单测全部 CRUD |
| 3 | Config 扩展 | GradingConfig 类型 + config.yaml grading 区块读写 | [config.ts:98](packages/server/src/controllers/hermes/config.ts#L98) | `npx tsc --noEmit` |

### Phase 2: 核心服务

| # | Task | Description | Mirror | Validate |
|---|---|---|---|---|
| 4 | Scanner | 递归扫描目录树，识别班级/作业/答案/学生，返回结构化数据 | [local_grader.py](test_dify/local_grader.py) 目录遍历逻辑 | 用 fixtures 目录做集成测试 |
| 5 | TemplateExtractor | 调 Qwen-VL 提取答案图片 → 结构化题目列表，合并教师修正 | [local_grader.py](test_dify/local_grader.py) `extract_templates()` | mock API 单测 |
| 6 | Grader | Qwen-VL API 客户端 + JSON 3 层容错（marker→栈→正则） | [local_grader.py](test_dify/local_grader.py) `grade_student()` | mock 异常 JSON 单测 |
| 7 | BatchGrader | 遍历学生列表 → 逐个调 Grader → 推送进度 → 汇总结果 | Job 模式参考 [jobs.ts](packages/client/src/api/hermes/jobs.ts) | 集成测试 |
| 8 | ReportWriter | 生成批改报告.md + 追加更新成长记录.md | [local_grader.py](test_dify/local_grader.py) `generate_report()` | 快照对比测试 |
| 9 | GrowthAnalyzer | 解析历史成长记录 → 调 trend 模型 → 生成综合趋势分析 | — | 单测 |

### Phase 3: API + 控制器

| # | Task | Description | Mirror | Validate |
|---|---|---|---|---|
| 10 | Routes | 12 个端点 | [kanban.ts:4](packages/server/src/routes/hermes/kanban.ts#L4) | `npm run build` |
| 11 | Controller | 全部端点实现，含权限 + multipart 上传 + 异步 job 返回 | [kanban.ts](packages/server/src/controllers/hermes/kanban.ts) | 集成测试 |
| 12 | Route 注册 | routes/index.ts 中 import + app.use | [index.ts:87](packages/server/src/routes/index.ts#L87) | `npm run build` |

### Phase 4: 前端

| # | Task | Description | Mirror | Validate |
|---|---|---|---|---|
| 13 | API 层 | TypeScript 类型 + request 函数 | [api/hermes/kanban.ts](packages/client/src/api/hermes/kanban.ts) | `npx vue-tsc --noEmit` |
| 14 | Pinia Store | 状态管理 + 进度轮询 | [stores/hermes/kanban.ts](packages/client/src/stores/hermes/kanban.ts) | 单测 |
| 15 | ClassTree 组件 | 左侧导航：班级 → 作业树，状态标记 | Vue 3 + Naive UI Tree | 渲染测试 |
| 16 | AnswerReview 组件 | 🎯 可编辑答案表格（题目/答案/分值），确认按钮 | Vue 3 + Naive UI DataTable | 交互测试 |
| 17 | GradingProgress 组件 | 实时进度条 + 当前学生名 | Naive UI Progress | 渲染测试 |
| 18 | ResultTable 组件 | 成绩总表 + 展开看每题详情 | Naive UI Table | 渲染测试 |
| 19 | GrowthTimeline 组件 | 时间线展示成长记录 + 趋势图表 | Naive UI Timeline | 渲染测试 |
| 20 | GradingView 页面 | 组装所有组件，Tab 切换布局 | Vue 3 Composition API | E2E |

### Phase 5: Skill + 收尾

| # | Task | Description | Mirror | Validate |
|---|---|---|---|---|
| 21 | SKILL.md | `/homework-grading` 对话入口 | 现有 Skill frontmatter 格式 | Skill 列表可见 |
| 22 | E2E 测试 | Playwright 覆盖核心闭环 | [playwright.config.ts](playwright.config.ts) | `npm run test:e2e -- --grep grading` |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| LLM JSON 格式不稳定 | HIGH | 3 层容错 + 答案审核门（教师修正兜底），已在 Python 验证有效 |
| DashScope API 限流 | MEDIUM | 批改为异步 job，可暂停/恢复；支持重试 |
| 大班级（50+人）耗时过长 | MEDIUM | 并发批改（可配置并发数）+ 实时进度 + resumable |
| 目录结构与命名不规范 | HIGH | Scanner 返回警告列表，前端高亮异常；支持教师手动指定答案/学生 |
| 成长记录 MD 解析错误 | MEDIUM | 使用 YAML frontmatter 标记结构化区域，解析失败时重建 |
| 多页答案拼接顺序错误 | LOW | 文件名数字排序 + 前端预览确认 |

## Acceptance

- [ ] 文件夹放入图片 → 扫描即可在界面看到
- [ ] 答案提取 → 教师审核 → 修正 → 确认 完整闭环
- [ ] 批量批改带实时进度，支持 50+ 人大班级
- [ ] 作业目录下自动生成批改报告.md
- [ ] 学生成长记录.md 累积更新，趋势分析可用
- [ ] 配置可在界面修改，下次批改立即生效
- [ ] `/homework-grading` Skill 对话入口可用
- [ ] `npm run build` 零错误
- [ ] 单元测试覆盖率 ≥ 80%
- [ ] E2E 核心流程通过
