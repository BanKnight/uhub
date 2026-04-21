# defaultTestModel 设计

日期：2026-04-20

## 背景

对照 AxonHub 后，当前 uhub 在 structured channel 配置上的最小差距是：AxonHub 将“支持的模型集合”和“默认测试模型”分离建模，而 uhub 目前只有 `models`。

当前约束：
- 仅围绕 `openai` / `anthropic` / `gemini`
- 优先 integration / e2e / CI 稳定
- 禁止把新增语义回退到 `configJson`
- 不扩大 gateway 运行时语义

## 目标

新增一个独立的、可空的结构化字段 `defaultTestModel`，用于 admin 管理面的 channel 元数据表达。

这个字段的目的仅是：
- 在 channel 配置中明确“默认测试模型”
- 让后续测试入口或管理功能有稳定字段可读
- 与 `models` 的“允许模型集合”职责分离

## 非目标

本轮明确不做：
- 不将 `defaultTestModel` 用作 gateway fallback model
- 不让 request log / analytics / portal usage 读取该字段
- 不向 `configJson` 新增任何写入或兼容回退语义
- 不做历史数据回填
- 不引入 openai / anthropic / gemini 之外的新 provider 语义

## 方案比较

### 方案 A：新增独立字段（选定）
- 新增 nullable `defaultTestModel`
- 约束：为空，或必须属于 `models`
- gateway 完全忽略该字段

优点：
- 语义清晰，贴近 AxonHub
- 风险低，不影响现有请求链路
- 不再依赖 `models[0]` 这种隐式约定

缺点：
- 需要 DB / shared schema / admin UI / integration 一起改动

### 方案 B：沿用 `models[0]` 作为默认值

优点：
- 无需新增字段

缺点：
- 列表顺序承载业务语义，表达含混
- 后续 UI 编辑和排序容易引入隐式行为
- 不利于与 AxonHub 对齐

### 方案 C：本轮不实现

优点：
- 零实现风险

缺点：
- 结构化 gap 原样保留
- 后续仍无法清晰表达“默认测试模型”

## 最终设计

### 1. 数据模型

在 `channels` 表新增一个 nullable 列：
- `default_test_model`

在 worker schema 与 shared contract 中新增：
- `defaultTestModel: string | null`

约束：
- `defaultTestModel === null` 时合法
- `defaultTestModel !== null` 时，必须存在于 `models` 中

### 2. 读写边界

#### 写入
- admin create/update channel 时可传 `defaultTestModel`
- service 层原样持久化该字段

#### 读取
- admin channels list / create / update / status 返回值包含该字段
- admin-web 在 channel 列表中展示该字段
- portal usage / history / analytics / audit 不读取该字段
- gateway channel 选择与转发逻辑不读取该字段

### 3. Admin 交互

admin 表单继续保留：
- `models` 文本输入

新增：
- 一个 `defaultTestModel` 下拉选择器

交互规则：
- 候选项来自当前 `models` 输入解析结果
- 允许空值（表示未设置）
- 编辑已有 channel 时：
  - 若现值存在于 `models` 中，则正常回填
  - 若现值不在 `models` 中，则显示为空
- 若用户修改 `models` 后导致当前 `defaultTestModel` 失效，则自动清空

选择“下拉”而不是自由文本输入，是为了让约束前置到 UI，减少无效提交。

### 4. 运行时边界

`defaultTestModel` 仅是 admin 元数据。

明确禁止：
- 在 `proxy-request` 中当作缺省 model 注入
- 在任何协议转换逻辑中使用
- 在 request truth / cost truth / analytics 中派生新语义

### 5. 验证

最小验证集：
- `bun tests/run-with-local-worker.ts bun run test:integration:admin:channel-structured`
- `bun tests/run-with-local-worker.ts bun run test:integration:openai`
- `bun run test:integration:ci`
- `bun run check`

新增/调整断言重点：
- create channel 返回 `defaultTestModel`
- update channel 返回 `defaultTestModel`
- list channel 返回 `defaultTestModel`
- 当 `models` 删除当前默认值后，更新结果中的 `defaultTestModel` 自动变为 `null`
- 现有 gateway / portal / analytics 行为保持不变

## 风险与控制

风险：
- admin 表单状态同步增加一层依赖：`defaultTestModel` 依赖 `models`
- contract 扩面后，测试 helper 和集成断言需要同步收口

控制：
- 字段只进入结构化管理面，不进入运行时
- UI 使用下拉而非自由文本，减少无效状态
- 保持 migration 最小化：只新增 nullable 列，不做 backfill

## 实现边界总结

本轮实现应只覆盖：
- DB 列
- shared schema / worker service contract
- admin-web create/edit/list
- admin-channel-structured 与相关质量门验证

本轮不应覆盖：
- gateway fallback
- request log / audit / analytics 派生语义
- configJson 回退写入
