# AxonHub Cloudflare 改造实施计划

> **执行入口：** 推荐后续使用 `/oh-my-claudecode:team` 执行；若要串行执行则用 `/oh-my-claudecode:ralph`。

**目标：** 在空仓 `/data/workspace/uhub` 中实现一个 Cloudflare 原生的个人版 AxonHub：管理员可配置渠道与签发 API key，朋友可通过独立 portal 用 key 登录查看状态/可用端点/请求历史，网关提供 OpenAI-compatible `/v1/chat/completions`。

**架构：** bun monorepo + 双前端入口（admin / portal）+ 单 Hono Worker API。D1 作为 SQLite 落地与业务真相源，Durable Objects 做 `maxConcurrency`，Analytics Engine 只做聚合统计，R2 延后到 v1 再接入。

**技术栈：** Bun、TypeScript、React 19、TanStack Router/Query、Tailwind v4、shadcn/ui、jotai、Hono、tRPC、Drizzle、Cloudflare Workers、D1、Durable Objects、Better Auth。

---

## 0. YAGNI 边界

本计划明确 **不做**：
- multi-project
- 企业级 RBAC / scope matrix
- GraphQL
- 多 profile API key 系统
- Anthropic / Gemini 全协议一次性兼容
- thread-aware trace 会话图谱
- R2 payload 持久化（延后到 v1）

MVP 只保留：
- admin 登录
- 渠道管理
- API key 签发
- endpoint/channel allowlist
- `maxConcurrency`
- `/v1/chat/completions`
- portal 登录与历史查看
- `trace_id` 级请求追踪

---

## 1. 目标目录结构

```text
/data/workspace/uhub/
├─ apps/
│  ├─ admin-web/
│  │  ├─ src/
│  │  │  ├─ routes/
│  │  │  ├─ features/auth/
│  │  │  ├─ features/channels/
│  │  │  ├─ features/api-keys/
│  │  │  └─ lib/
│  │  ├─ package.json
│  │  └─ vite.config.ts
│  ├─ key-portal/
│  │  ├─ src/
│  │  │  ├─ routes/
│  │  │  ├─ features/login/
│  │  │  ├─ features/overview/
│  │  │  ├─ features/history/
│  │  │  └─ lib/
│  │  ├─ package.json
│  │  └─ vite.config.ts
│  └─ api-worker/
│     ├─ src/
│     │  ├─ index.ts
│     │  ├─ env.ts
│     │  ├─ middleware/
│     │  ├─ lib/
│     │  ├─ auth/
│     │  ├─ db/
│     │  ├─ routers/
│     │  │  ├─ admin/
│     │  │  ├─ portal/
│     │  │  └─ gateway/
│     │  ├─ services/
│     │  ├─ repositories/
│     │  ├─ durable-objects/
│     │  └─ analytics/
│     ├─ wrangler.jsonc
│     └─ package.json
├─ packages/
│  ├─ ui/
│  ├─ shared/
│  │  ├─ src/contracts/
│  │  ├─ src/schemas/
│  │  ├─ src/constants/
│  │  └─ src/types/
│  ├─ db/
│  │  ├─ src/schema/
│  │  ├─ src/client/
│  │  └─ migrations/
│  └─ config/
│     └─ src/
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ .omc/plans/
├─ package.json
├─ bunfig.toml
├─ tsconfig.json
└─ biome.json
```

---

## 2. 首批 D1 schema 设计

### 2.1 认证相关
Better Auth 表使用其 D1 适配器的官方 schema，不手写魔改。MVP 只启用 email/password admin 登录。

预期包含：
- `user`
- `session`
- `account`
- `verification`

### 2.2 业务表（MVP）

#### `channels`
```sql
id text primary key,
name text not null unique,
provider text not null,
base_url text not null,
status text not null check(status in ('active','disabled')),
config_json text not null,
created_at integer not null,
updated_at integer not null
```

#### `api_keys`
```sql
id text primary key,
label text not null,
key_prefix text not null unique,
key_hash text not null unique,
status text not null check(status in ('active','disabled','expired','revoked')),
expires_at integer,
max_concurrency integer not null,
created_by_admin_id text not null,
last_used_at integer,
revoked_at integer,
created_at integer not null,
updated_at integer not null
```

#### `api_key_channel_rules`
```sql
api_key_id text not null,
channel_id text not null,
primary key (api_key_id, channel_id)
```

#### `api_key_endpoint_rules`
```sql
api_key_id text not null,
endpoint text not null,
primary key (api_key_id, endpoint)
```

MVP endpoint 枚举只放：
- `chat_completions`

v1 再扩：
- `responses`
- `embeddings`
- `models`

#### `portal_sessions`
```sql
id text primary key,
api_key_id text not null,
expires_at integer not null,
last_seen_at integer not null,
revoked_at integer,
created_at integer not null
```

#### `requests`
```sql
id text primary key,
api_key_id text not null,
endpoint text not null,
model text,
channel_id text,
trace_id text,
status text not null check(status in ('pending','processing','completed','failed','rejected')),
http_status integer,
latency_ms integer,
request_size integer,
response_size integer,
payload_ref text,
started_at integer not null,
finished_at integer,
created_at integer not null
```

### 2.3 首批索引

```sql
create index idx_requests_api_key_created_at on requests(api_key_id, created_at desc);
create index idx_requests_trace_id on requests(trace_id);
create index idx_api_keys_status on api_keys(status);
create index idx_portal_sessions_api_key_id on portal_sessions(api_key_id);
create index idx_channels_status on channels(status);
```

---

## 3. 路由与认证分层

## 3.1 API Worker 路由

### 管理面
- `POST /api/auth/*` — Better Auth
- `GET /trpc/admin.channels.list`
- `POST /trpc/admin.channels.create`
- `PATCH /trpc/admin.channels.update`
- `GET /trpc/admin.apiKeys.list`
- `POST /trpc/admin.apiKeys.create`
- `POST /trpc/admin.apiKeys.revoke`
- `GET /trpc/admin.requests.list`

### Portal
- `POST /portal/auth/exchange`
- `POST /portal/auth/logout`
- `GET /trpc/portal.me`
- `GET /trpc/portal.endpoints.list`
- `GET /trpc/portal.requests.list`

### Gateway
- `POST /v1/chat/completions`
- `GET /healthz`

## 3.2 身份规则

### Admin user
- 只允许访问 `/api/auth/*` 与 `/trpc/admin.*`
- 认证方式：Better Auth session cookie
- cookie 只在 admin 子域生效

### Portal session
- 只允许访问 `/portal/auth/*` 与 `/trpc/portal.*`
- 认证方式：`portal_sessions` + HttpOnly cookie
- cookie 只在 portal 子域生效

### Raw API key caller
- 只允许访问 `/v1/*`
- 认证方式：`Authorization: Bearer <raw key>`
- 不允许访问 admin / portal 私有查询接口

### 强制约束
- key 被 `disabled / expired / revoked` 后：
  - gateway 立即拒绝
  - portal session 同步失效

---

## 4. maxConcurrency 的 Durable Objects 实现顺序

### Phase A：接口与契约
先定义共享契约：
- `packages/shared/src/contracts/concurrency.ts`
- `packages/shared/src/constants/endpoints.ts`

定义 DO 输入输出：
- `acquire(apiKeyId, limit, requestId, ttlMs)`
- `release(apiKeyId, requestId)`
- `snapshot(apiKeyId)`

### Phase B：DO 实现
文件：
- `apps/api-worker/src/durable-objects/api-key-concurrency-do.ts`

职责：
- 维护活跃 lease map
- 过期 lease 自动清理
- 拒绝超过 `maxConcurrency` 的请求

### Phase C：网关接入
文件：
- `apps/api-worker/src/routers/gateway/chat-completions.ts`
- `apps/api-worker/src/middleware/require-api-key.ts`

顺序：
1. 校验 raw key
2. 读取 `api_keys.max_concurrency`
3. `acquire`
4. 写 `requests` 初始记录
5. 调上游 channel
6. 成功/失败更新 `requests`
7. `finally release`

### Phase D：异常恢复
- lease TTL 默认 60s~120s
- stream 中断也要 `finally release`
- portal/admin 暴露当前并发快照只做调试，不做 MVP 必需页面

**不要做：**
- 用 D1 做分布式锁
- 在 MVP 做多级限流（用户级/渠道级/全局级）
- 在 MVP 做队列补偿系统

---

## 5. 实施里程碑

## Milestone 0：仓库骨架与开发链路

**目标**：项目能在本地用 Bun 跑起来，Cloudflare Worker / 两个前端都能独立启动。

**创建**
- `package.json`
- `bunfig.toml`
- `tsconfig.json`
- `biome.json`
- `apps/admin-web/*`
- `apps/key-portal/*`
- `apps/api-worker/*`
- `packages/shared/*`
- `packages/db/*`
- `packages/config/*`

**验收**
- `bun install` 成功
- 三个 app 都能启动基础 dev server / worker dev
- monorepo import path 正常

**提交点**
- `chore: bootstrap bun monorepo for cloudflare axonhub clone`

---

## Milestone 1：D1 与认证基础

**目标**：admin 能登录；D1 schema 就位。

**创建/修改**
- `apps/api-worker/src/auth/better-auth.ts`
- `apps/api-worker/src/index.ts`
- `packages/db/src/schema/*.ts`
- `packages/db/migrations/0001_init.sql`
- `apps/admin-web/src/routes/sign-in.tsx`
- `apps/admin-web/src/features/auth/*`

**验收**
- D1 migration 可执行
- admin 登录成功，cookie 正常
- 未登录访问 `/trpc/admin.*` 返回 401

**提交点**
- `feat: add admin auth and initial d1 schema`

---

## Milestone 2：渠道管理

**目标**：admin 可 CRUD channels。

**创建/修改**
- `apps/api-worker/src/routers/admin/channels.ts`
- `apps/api-worker/src/services/channels/*`
- `apps/admin-web/src/features/channels/*`
- `packages/shared/src/schemas/channels.ts`

**验收**
- 可创建 / 编辑 / 禁用 channel
- 前后端校验一致
- 禁用 channel 不会在 gateway 中被选用

**提交点**
- `feat: add admin channel management`

---

## Milestone 3：API key 签发与 portal exchange

**目标**：admin 可签发 key；朋友可用 raw key 交换 portal session。

**创建/修改**
- `apps/api-worker/src/routers/admin/api-keys.ts`
- `apps/api-worker/src/routers/portal/auth.ts`
- `apps/api-worker/src/services/api-keys/*`
- `apps/api-worker/src/services/portal-sessions/*`
- `apps/key-portal/src/routes/login.tsx`
- `apps/key-portal/src/features/login/*`
- `packages/shared/src/schemas/api-keys.ts`

**关键规则**
- create key 时一次性返回 raw key
- 落库只存 `prefix + hash`
- 必填：`label`、`channel rules`、`endpoint rules`、`maxConcurrency`
- 可选：`expiresAt`

**验收**
- admin 能创建 key
- portal 能用 raw key exchange 成登录态
- 失效 key 无法 exchange

**提交点**
- `feat: add api key issuance and portal session exchange`

---

## Milestone 4：Gateway MVP + 请求历史

**目标**：`/v1/chat/completions` 可走通，且请求历史写入 D1。

**创建/修改**
- `apps/api-worker/src/routers/gateway/chat-completions.ts`
- `apps/api-worker/src/middleware/require-api-key.ts`
- `apps/api-worker/src/services/gateway/*`
- `apps/api-worker/src/services/request-log/*`
- `apps/api-worker/src/repositories/requests-repo.ts`
- `packages/shared/src/schemas/gateway.ts`

**网关顺序**
1. 认证 raw key
2. 校验 endpoint allowlist
3. 解析 model 与 route selection
4. 校验 channel allowlist
5. 写入 `requests(pending)`
6. 调用上游
7. 更新请求状态、延迟、http status、size

**验收**
- 合法 key 可调用 `/v1/chat/completions`
- 不允许 endpoint 的 key 被拒绝
- request 历史可写入 D1
- `trace_id` 可从 header 透传/生成

**提交点**
- `feat: add gateway chat completions and request logging`

---

## Milestone 5：Durable Objects 并发门禁

**目标**：`maxConcurrency` 生效。

**创建/修改**
- `apps/api-worker/src/durable-objects/api-key-concurrency-do.ts`
- `apps/api-worker/src/lib/concurrency.ts`
- `apps/api-worker/wrangler.jsonc`
- `tests/integration/gateway-concurrency.test.ts`

**验收**
- 并发超限时返回 429
- 请求结束后能释放 lease
- 异常中断不会长期卡死 key

**提交点**
- `feat: enforce api key max concurrency with durable objects`

---

## Milestone 6：Portal 概览与历史页面

**目标**：朋友登录 portal 后能看 key 状态、允许端点、最近请求。

**创建/修改**
- `apps/key-portal/src/routes/index.tsx`
- `apps/key-portal/src/routes/history.tsx`
- `apps/key-portal/src/features/overview/*`
- `apps/key-portal/src/features/history/*`
- `apps/api-worker/src/routers/portal/me.ts`
- `apps/api-worker/src/routers/portal/requests.ts`

**验收**
- portal 首页展示：label / status / expiresAt / maxConcurrency / allowed endpoints
- history 页展示最近请求、状态、耗时、trace_id
- revoked/expired key 的 portal session 自动失效

**提交点**
- `feat: add key portal overview and request history`

---

## Milestone 7：v1 聚合统计与运维补强

**目标**：补上 AE dashboard、revoke/rotate、审计。

**创建/修改**
- `apps/api-worker/src/analytics/*`
- `apps/admin-web/src/features/dashboard/*`
- `apps/api-worker/src/routers/admin/audit.ts`
- `apps/api-worker/src/routers/admin/api-key-rotation.ts`

**验收**
- AE 能看到按 endpoint / channel 的聚合统计
- revoke 后 gateway 与 portal 同步失效
- rotate 会产生新 raw key，旧 key 作废

**提交点**
- `feat: add analytics dashboard and api key lifecycle operations`

---

## 6. 测试与验证顺序

## 6.1 Unit（最先写）
先覆盖纯逻辑：
- key hash / prefix
- endpoint allowlist
- channel allowlist
- expiry / revoked 判断
- route selection
- DO lease acquire / release / ttl

文件建议：
- `tests/unit/api-keys.test.ts`
- `tests/unit/authorization-rules.test.ts`
- `tests/unit/concurrency-do.test.ts`

## 6.2 Integration
在 Worker + D1 + DO 层验证：
- admin 创建 channel / key
- portal exchange
- gateway 成功与拒绝路径
- 超并发 429
- revoke 后 portal/gateway 同时失效

文件建议：
- `tests/integration/admin-api.test.ts`
- `tests/integration/portal-auth.test.ts`
- `tests/integration/gateway-chat.test.ts`
- `tests/integration/gateway-concurrency.test.ts`

## 6.3 E2E
只做主链路：
1. admin 登录
2. 创建 channel
3. 创建 key
4. portal 登录
5. 发起请求
6. portal/history 可见

文件建议：
- `tests/e2e/admin-to-portal-flow.spec.ts`

## 6.4 Observability
最后验证：
- D1 请求记录与 AE 聚合口径一致
- `trace_id` 可串联一次生命周期
- 429 能在统计里单独区分

---

## 7. 执行顺序建议（给 team/ralph/executor）

推荐执行顺序：
1. Milestone 0
2. Milestone 1
3. Milestone 2 + 3
4. Milestone 4
5. Milestone 5
6. Milestone 6
7. Milestone 7

并行边界：
- `admin-web` 与 `key-portal` 可以并行，但前提是 shared contracts 已稳定
- `gateway` 与 `portal history` 不能并行过早开始，必须等 `requests` schema 固定
- `Durable Objects` 必须在 gateway happy path 稳定后接入

---

## 8. 风险与缓解

### 风险 1：Better Auth + D1 适配成本超预期
**缓解**：先只做 email/password admin，不接 OAuth。

### 风险 2：过早支持多 endpoint 导致授权模型复杂化
**缓解**：MVP 只支持 `chat_completions`，其余 endpoint 仅保留枚举位。

### 风险 3：请求 payload 过大拖慢 D1
**缓解**：MVP 只存 metadata，不存 body/chunks。

### 风险 4：portal 页面过早做太多运营视图
**缓解**：只做 overview + history，两页够用。

---

## 9. 完成定义（Definition of Done）

MVP 完成时，必须同时满足：
- admin 能登录
- admin 能配置至少一个 channel
- admin 能签发 key，并设置 channel / endpoint / maxConcurrency / expiry
- 朋友能通过 portal 用 key 登录
- `/v1/chat/completions` 可用
- request 历史能在 portal 中看到
- 超并发会返回 429
- revoked / expired key 会立即失效

---

## 10. 推荐下一步

如果直接进入执行，推荐用 OMC：
- **并行实现**：`/oh-my-claudecode:team`
- **串行实现**：`/oh-my-claudecode:ralph`

推荐先执行到 **Milestone 4**，拿到完整主链路，再接 **Milestone 5/6**。
