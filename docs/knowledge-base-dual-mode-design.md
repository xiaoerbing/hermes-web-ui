# 知识库双模式设计：个人知识库 + 学校共享知识库

> 分析日期：2026-06-13
> 关联：[education-research-feature-mapping.md](./education-research-feature-mapping.md) · [teacher-needs-analysis.md](./teacher-needs-analysis.md) · [knowledge-base.plan.md](../.claude/plans/knowledge-base.plan.md)

---

## 一、场景定义

| 知识库类型 | 数据归属 | 可见范围 | 典型用途 |
|-----------|---------|---------|---------|
| **个人知识库** | 每个教师私有 | 仅自己 | 个人备课素材、教学反思、班级资料、收藏 |
| **学校共享知识库** | 学校组织公有 | 全校教师 | 集体备课资料、校本课程、真题库、课标、名师课例 |

两者运行在**同一 Hermes 服务实例**上，通过 `scope` 字段隔离。

---

## 二、设计思路：沿用 Hermes 已有隔离模式

Hermes 已有 Profile 级别的数据隔离模式（`upload-paths.ts` + `user-auth.ts`），知识库直接复用：

```
{appHome}/knowledge-base/
├── personal/{user_id}/{collection_id}/   ← 个人 KB
│   └── files/                            ← 原始文档存储
└── shared/{collection_id}/               ← 学校共享 KB
    └── files/
```

```
数据库隔离：
  SELECT * FROM kb_collections
  WHERE scope = 'personal' AND owner_user_id = :userId   -- 个人
  SELECT * FROM kb_collections
  WHERE scope = 'shared'                                 -- 共享（全校可见）
```

---

## 三、数据库设计

```sql
-- 知识库集合
CREATE TABLE kb_collections (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  scope         TEXT NOT NULL CHECK(scope IN ('personal','shared')),
  owner_user_id INTEGER,              -- 个人库=用户ID，共享库=NULL
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 文档
CREATE TABLE kb_docs (
  id            TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES kb_collections(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  file_path     TEXT,
  file_type     TEXT,                  -- pdf/markdown/txt
  status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','indexing','ready','error')),
  chunk_count   INTEGER DEFAULT 0,
  metadata_json TEXT DEFAULT '{}',     -- {"subject":"语文","grade":"八年级","tags":["散文"]}
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 分块 + 向量
CREATE TABLE kb_chunks (
  id            TEXT PRIMARY KEY,
  doc_id        TEXT NOT NULL REFERENCES kb_docs(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  embedding     BLOB,                  -- float32 二进制
  token_count   INTEGER DEFAULT 0,
  UNIQUE(doc_id, chunk_index)
);
```

### 隔离逻辑

| scope | 查询条件 | 谁可见 |
|-------|---------|--------|
| `personal` | `owner_user_id = :currentUserId` | 仅文档拥有者 |
| `shared` | 无额外条件 | 所有已认证教师 |

---

## 四、前端设计

### 页面结构

```
┌──────────────────────────────────────────────────────┐
│  [📁 我的知识库]  [📂 学校共享库]        🔍 搜索...  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│  │ 语文备课资料   │ │ 班级管理     │ │ ➕ 新建集合   │  │
│  │ 12 文档       │ │ 5 文档       │ │              │  │
│  └──────────────┘ └──────────────┘ └──────────────┘  │
│                                                      │
├──────────────────────────────────────────────────────┤
│  📤 上传 │ 📊 索引状态 │ 🔄 推荐到共享库                │
└──────────────────────────────────────────────────────┘
```

### Store（核心状态）

```typescript
interface KnowledgeBaseState {
  activeTab: 'personal' | 'shared'      // Tab 切换
  personalCollections: KbCollection[]
  sharedCollections: KbCollection[]
  documents: KbDoc[]
  searchQuery: string
  searchResults: KbSearchResult[]
}
```

---

## 五、权限模型（沿用现有角色）

| Hermes 角色 | 个人 KB | 共享 KB 查看 | 共享 KB 管理（增删改） |
|-------------|--------|-------------|---------------------|
| `super_admin`（教研组长） | ✓ | ✓ | ✓ |
| `admin`（普通教师） | ✓ | ✓ | ✗（需管理员审核入库） |

### 共享入库流程

```
教师上传资源到个人库 → 点击"推荐到共享库"
    → super_admin 审核
    → 通过 → 复制到 shared 存储 → 全校可见
    → 驳回 → 留在个人库 + 驳回原因
```

---

## 六、API

```
个人集合：
  GET    /api/hermes/knowledge-base/collections/personal
  POST   /api/hermes/knowledge-base/collections/personal

共享集合：
  GET    /api/hermes/knowledge-base/collections/shared
  POST   /api/hermes/knowledge-base/collections/shared       ← super_admin only

文档：
  POST   /api/hermes/knowledge-base/documents/upload
  DELETE /api/hermes/knowledge-base/documents/:id

检索（核心）：
  POST   /api/hermes/knowledge-base/search
    body: {
      "query": "藤野先生的文章结构分析",
      "scope": "all"              // "personal" | "shared" | "all"
    }
```

---

## 七、聊天集成：并行检索双 KB

```
用户发消息 → handle-bridge-run.ts 构建上下文前：

  1. 生成 query embedding
  2. 并行检索：
     ├─ personal/{userId}  → score: [0.92, 0.85, 0.71]
     └─ shared/*           → score: [0.88, 0.79, 0.65]
  3. 合并 + 按分数重排序 → topK=5
  4. 注入 system prompt：
     "[个人资料] doc1... doc2...
      [学校共享] shared_doc1... shared_doc2...
      ---
      用户问题：藤野先生的文章结构分析"
```

---

## 八、部署

**推荐：单服务器部署** — 一条命令，双模式共用同一 SQLite + 文件系统。

```
学校服务器
└── Hermes Web UI :8648
    ├── SQLite（personal + shared 在同一库，scope 字段隔离）
    └── 文件存储（knowledge-base/personal/ + shared/）
```

---

## 九、涉及文件

| 文件 | 操作 |
|------|------|
| `packages/server/src/db/hermes/knowledge-schemas.ts` | CREATE — 3 张表 |
| `packages/server/src/db/hermes/knowledge-store.ts` | CREATE — Store 类 |
| `packages/server/src/routes/hermes/knowledge-base.ts` | CREATE — API 路由 |
| `packages/server/src/controllers/hermes/knowledge-base.ts` | CREATE — 控制器 |
| `packages/server/src/services/hermes/knowledge-base/*` | CREATE — 解析/embedding/检索 |
| `packages/client/src/views/hermes/KnowledgeBaseView.vue` | CREATE — 双 Tab 页面 |
| `packages/client/src/stores/hermes/knowledge-base.ts` | CREATE — Store |
| `packages/client/src/api/hermes/knowledge-base.ts` | CREATE — API 客户端 |
| `packages/server/src/services/hermes/run-chat/handle-bridge-run.ts` | UPDATE — 双 scope 检索注入 |
