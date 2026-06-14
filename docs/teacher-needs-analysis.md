# 教师核心需求 × Hermes 可实施方案分析

> 需求来源：一线教师实际教学痛点 + 国家中小学智慧教育平台对接
> 分析日期：2026-06-13
> 关联文档：[education-research-feature-mapping.md](./education-research-feature-mapping.md)

---

## 需求总览

| # | 教师需求 | 痛点 | Hermes 实现方向 | 开发量 |
|---|---------|------|----------------|--------|
| 1 | **写稿子** | 教案、论文、方案撰写耗时 | AI 写作助手 | 小 |
| 2 | **做 PPT** | 课件制作费时 | AI PPT 生成 → .pptx 导出 | 中 |
| 3 | **处理数据** | 成绩/问卷分析繁琐 | 自然语言数据分析 | 小 |
| 4 | **批改作业 + 分析（文科）** | 主观题批改难 | AI 按 Rubric 评分 + 学情追踪 | 大 |
| 5 | **备课搜资料 + 学校资料库** | 资源零散、无共享 | RAG 知识库 + 校本资源共享 | 中 |

---

## 需求一：写稿子 — AI 写作助手

### 教师常见写作类型

| 文稿类型 | 频次 | 结构特点 |
|----------|------|----------|
| 教案/教学设计 | 每天 | 固定模板（目标/重难点/过程/反思） |
| 教学反思 | 每周 | 自由文本，基于课堂实际 |
| 教研论文 | 每月 | 结构化（摘要/引言/论证/结论） |
| 活动方案/通知 | 按需 | 格式化 |
| 课题材料 | 按阶段 | 高度结构化，有评审标准 |

### 实现方案

```
教师选择文稿类型 → 填写关键信息 → LLM 生成初稿
    → ChatView 中对话式修改 → 一键导出 Word/Markdown
```

**复用：** ChatView 对话界面 — 无需新建页面，在现有聊天中完成全流程。

**核心工作：**
1. 编写 6 个写作 Prompt 模板（教案/论文/活动方案/通知/课题材料/反思）
2. 课标文档注入知识库（RAG），写作时自动引用
3. 文档导出服务（Markdown → DOCX/PDF）

**涉及文件：**

| 文件 | 操作 |
|------|------|
| `packages/skills/teacher-writer/SKILL.md` | CREATE |
| `packages/server/src/services/hermes/document-export.ts` | CREATE |

**开发量：1-2 周**（核心是高质量 Prompt 模板打磨）

---

## 需求二：做 PPT — AI 课件生成

### 现有流程 vs AI 流程

```
传统：确定主题 → 多平台搜集素材 → 设计大纲 → 逐页制作 → 调整美化
AI：  输入课题 → AI 搜知识库 → 生成大纲 → 教师确认 → python-pptx 生成 → 下载微调
```

### 实现方案

复用 Hermes **Agent Bridge（Python 已就绪）**，新增 python-pptx 生成能力：

```
教师输入（课题 + 年级 + 学科）
    → LLM 搜索知识库资源 + 生成大纲 JSON
    → 教师确认/调整大纲
    → Python Agent 调用 python-pptx 生成 .pptx
    → 教师下载，在 PowerPoint/WPS 中微调
```

**涉及文件：**

| 文件 | 操作 |
|------|------|
| `packages/skills/ppt-generator/SKILL.md` | CREATE |
| `packages/server/src/services/hermes/agent-bridge/python/ppt_generator.py` | CREATE |
| `packages/client/src/components/hermes/education/PptGenerator.vue` | CREATE |

**开发量：2-3 周**

---

## 需求三：处理数据 — 自然语言数据分析

### 使用场景

教师上传 Excel/CSV → 用自然语言提问 → AI 分析并生成图表

```
"分析一下这次期中考试的成绩分布"
"找出进步最大的5个学生"
"对比一班和二班的各科平均分"
```

### 实现方案

复用 Hermes 的 **ChatView 工具调用**机制：
- 教师上传文件 → Agent Bridge → Python pandas/matplotlib 分析
- 结果以 Markdown 表格 + 图片形式内嵌回复

**涉及文件：**

| 文件 | 操作 |
|------|------|
| `packages/skills/data-analyst/SKILL.md` | CREATE |
| `packages/server/src/services/hermes/agent-bridge/python/data_analyzer.py` | CREATE |

**开发量：1 周**（Python 脚本 + Skill 提示词）

---

## 需求四：批改作业 + 分析（文科）★ 最核心

### 两种批改模式

#### 客观题（自动批改）
教师上传答案模板 → 学生提交 → 自动匹配 → 即时得分 + 错题统计

#### 主观题（AI 评价）★ 文科重点
LLM 按 Rubric（评分标准）多维度评分：
- 内容完整性 | 逻辑结构 | 语言表达 | 知识准确性 | 创新性

### 完整流程

```
教师创建作业（题目 + 答案 + Rubric）
    → 学生在线提交（文本 / 上传文件 + OCR）
    → AI 自动批改
        ├─ 客观题：匹配答案
        └─ 主观题：多维 Rubric 评分 + 逐项评语
    → 教师复核（调整不合理评分）
    → 一键返回学生

学情面板：
    ├─ 班级整体：平均分 / 分布 / 常见错误 Top 10
    ├─ 个人追踪：进步趋势 / 薄弱知识点
    └─ 文科技能雷达图：论证 / 表达 / 知识广度
```

**涉及文件：**

| 文件 | 操作 |
|------|------|
| `packages/server/src/routes/hermes/homework.ts` | CREATE |
| `packages/server/src/controllers/hermes/homework.ts` | CREATE |
| `packages/server/src/services/hermes/homework-grader.ts` | CREATE |
| `packages/server/src/db/hermes/homework-store.ts` | CREATE |
| `packages/skills/essay-grader/SKILL.md` | CREATE |
| `packages/client/src/views/hermes/HomeworkView.vue` | CREATE |
| `packages/client/src/stores/hermes/homework.ts` | CREATE |

**开发量：4-6 周**（核心复杂度在 Rubric 评分准确率打磨）

---

## 需求五：备课搜资料 + 学校资料库

### 数据来源

```
┌─────────────────────────────────┐
│         学校统一资料库            │
│                                 │
│  ① 国家智慧教育平台同步           │
│  ② 教师个人上传                  │
│  ③ AI 自动生成（课件/作业）       │
│  ④ 教研组集体建设                 │
└─────────────────────────────────┘
```

### 与 Hermes 已有功能的复用

| Hermes 能力 | 在资料库中的角色 |
|------------|----------------|
| 文件管理 | 资源上传/浏览/下载/预览 |
| 知识库（规划） | 语义搜索 + RAG 检索 |
| Profile 系统 | 教师个人空间 vs 学校公共空间 |
| 权限系统 | 学科组隔离 |
| Cron Job | 定期同步平台资源 |

**开发量：2-4 周**（依赖已规划的知识库模块）

---

## 重点：对接国家中小学智慧教育平台 (basic.smartedu.cn)

### 平台概况

教育部主办的国家级平台，涵盖：全学段课程视频、课件、教学设计、电子教材、教师研修、课后服务资源。

### 对接难点

| 难点 | 影响 |
|------|------|
| 平台可能无公开 API | 高 |
| gov.cn 域名有严格反爬策略 | 中 |
| 部分资源有版权限制 | 中 |
| 数百万资源，全量同步不现实 | 中 |

### 三层降级对接方案

```
方案 A（最优）：官方 API
├─ 条件：平台提供开放接口
├─ 实现：MCP Server 调用 API 获取资源列表
└─ 优势：合规、稳定

方案 B（推荐首选）：浏览器插件 + 按需收录
├─ 条件：无 API 但有公开页面
├─ 实现：
│   1. 开发 Chrome Extension
│   2. 教师浏览平台 → 点击"收录到校本库"
│   3. 插件抓取标题/链接/标签 → POST 到 Hermes
│   4. 存链接+元数据，Hermes 搜索
└─ 优势：合规（仅存链接+元数据）、教师按需收集

方案 C（兜底）：手动导入
├─ 教师下载 → 上传 Hermes → AI 解析标签
└─ 优势：零合规风险
```

### 涉及文件

| 文件 | 操作 |
|------|------|
| `packages/extension/` | CREATE（Chrome 插件） |
| `packages/server/src/services/hermes/smartedu-sync.ts` | CREATE |
| `packages/server/src/routes/hermes/smartedu.ts` | CREATE |

**开发量：2-3 周**

---

## 总体开发路线

```
第 1-2 周：写稿子 + 处理数据（快赢，教师立即可用）
第 3-4 周：学校资料库 + 知识库 RAG
第 5-6 周：做PPT + smartedu.cn 浏览器插件对接
第 7-10 周：批改作业 + 学情分析（最核心，最复杂）
```

| 需求 | 开发量 | 可交付时间 |
|------|--------|-----------|
| 写稿子 | 小 | 第 2 周 |
| 处理数据 | 小 | 第 1 周 |
| 学校资料库 | 中 | 第 4 周 |
| 做 PPT | 中 | 第 6 周 |
| smartedu.cn 对接 | 中 | 第 6 周 |
| 批改作业 + 分析 | 大 | 第 10 周 |

---

## 总结

七个需求中：
- **写稿子 + 处理数据**可立即基于现有 ChatView 实现，几乎零成本
- **学校资料库**依赖已规划的知识库能力，属于自然延伸
- **作业批改**最复杂但教师最迫切，建议分阶段：先客观题自动批改（快），再主观题 AI 评价（深）
- **smartedu.cn 对接**推荐从浏览器插件起步，合规且灵活，未来有 API 再升级
