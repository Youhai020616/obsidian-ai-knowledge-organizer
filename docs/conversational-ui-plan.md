# 对话式 UI 重构实现计划

将面板式插件重构为对话式 agent 界面:对话流为主,提案卡片作为 AI 回复,审阅在对话内完成。

## 设计定稿(见 mockup)

- **三段式**:顶栏(身份 + `[n 待审]` 聚合 + 新会话 / 历史 / 设置) / 对话流 / 底部输入区(输入 + 内联模型 + 范围 + 发送)
- 提案卡片 = AI 回复,Apply / Reject 在卡上
- `[n 待审]` 徽标跨会话聚合 `status==='pending'` 的提案(对话式的安全网)
- 模型选择器只列已配 key 的 provider;选择 = 本次会话覆盖,Settings 管全局默认
- 空状态用 chips 承接旧的 7 个动作入口
- 日志 / 历史进顶栏 🕘,不再常驻主视图

## 数据模型(types.ts)

新增 `Conversation` / `ChatMessage`;`OrganizerState` 增加 `conversations[]`、`activeConversationId`。
`proposals[]` 仍是 source of truth,message 只引用 `proposalId` —— **不复制提案数据**。

```ts
interface Conversation { id; title; createdAt; updatedAt; messages: ChatMessage[] }
type ChatMessage =
  | { id; role:'user'; at; text }
  | { id; role:'assistant'; at; text?; citations?: CandidateNote[]; proposalIds?: string[] }
  | { id; role:'system'; at; kind:'progress'|'error'; text }
```

## 实现步骤

1. 数据模型 + 默认值 / 向后兼容迁移(types.ts / defaults.ts)
2. 主类会话管理(ensureActiveConversation / appendMessage / startNewConversation)+ 动作方法接入对话流
3. 视图三段式重构(renderTopbar / renderChat / renderComposer)+ 消息渲染 + 提案卡片复用
4. 指令路由(`/` slash 命令 + 自然语言 → askVault)+ 空状态 chips + 模型 / 范围 pill
5. styles.css 对话式重写
6. build + test 验证(保持 23 测试绿)

## 风险与边界

- 工作树有未提交的纯格式化改动(引号统一),重构 OrganizerView 时会自然吸收,不 stash / checkout / reset。
- 核心写入 / 回滚逻辑(applyProposalToVault / rollbackProposal / backup)**零改动**,风险集中在表现层与会话状态。
- 阶段 1 先在 main.ts 内重构 OrganizerView;视图拆分独立文件留待后续打磨。
- `lastAsk` / `auditLog` 保留(向后兼容),逐步被会话 / 历史入口取代。
