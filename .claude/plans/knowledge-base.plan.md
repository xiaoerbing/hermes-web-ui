# Plan: 知识库（Knowledge Base / RAG）功能

**Source**: 用户需求分析
**Complexity**: Large
**Status**: 已记录，待启动

## Summary

基于 Hermes Web UI 现有架构，新增知识库（RAG）功能模块。核心能力：文档上传解析 → 文本分块 → Embedding 向量化 → 向量存储 → 语义检索 → 聊天上下文注入。

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| 三层架构 | `packages/server/src/routes/hermes/` + `controllers/hermes/` + `services/hermes/` | 新增路由 → 控制器 → 服务 |
| Pinia Store | `packages/client/src/stores/hermes/chat.ts` | Setup Store 语法 |
| API 客户端 | `packages/client/src/api/hermes/sessions.ts` | 统一使用 `request<T>()` 封装 |
| 数据库 | `packages/server/src/db/hermes/session-store.ts` | SQLite Store 模式 |

## Files to Change

| File | Action | Why |
|---|---|---|
| `packages/server/src/routes/hermes/knowledge-base.ts` | CREATE | REST API 路由 |
| `packages/server/src/controllers/hermes/knowledge-base.ts` | CREATE | 请求处理 |
| `packages/server/src/services/hermes/knowledge-base/*` | CREATE | 核心业务逻辑 |
| `packages/server/src/db/hermes/knowledge-store.ts` | CREATE | 文档/分块/索引表 |
| `packages/server/src/db/hermes/schemas.ts` | UPDATE | 添加表定义 |
| `packages/client/src/views/hermes/KnowledgeBaseView.vue` | CREATE | 知识库主页面 |
| `packages/client/src/stores/hermes/knowledge-base.ts` | CREATE | Pinia Store |
| `packages/client/src/api/hermes/knowledge-base.ts` | CREATE | API 客户端 |
| `packages/server/src/services/hermes/run-chat/handle-bridge-run.ts` | UPDATE | 注入检索结果到聊天上下文 |

## Tasks

### Phase 1: 基础设施
- 创建 knowledge_docs / knowledge_chunks 表
- 实现 DocumentParser（PDF/Markdown/TXT）
- 实现 TextChunker

### Phase 2: Embedding + 检索
- 实现 EmbeddingService（调用 LLM API）
- 实现 VectorStore（SQLite BLOB）
- 实现语义检索 + 重排序

### Phase 3: 前端 + 集成
- 知识库页面 + 文档管理
- 聊天上下文注入

## Validation

```bash
npm run test:coverage && npm run build
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Embedding API 成本 | Medium | 支持本地 embedding 模型 |
| PDF 解析复杂 | Medium | 优先 Markdown/TXT |
| 向量检索性能 | Medium | 先 SQLite，量大再迁移向量库 |
