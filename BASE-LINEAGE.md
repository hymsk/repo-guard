# Base lineage / 基座派生边界

本组件按 `agent-plugin-base` 模板派生，不把它当作 SDK 依赖，也不在运行时引用相邻目录。

## Recorded origin / 已记录来源

- 模板名称：`agent-plugin-base`。
- 原始来源提交：`69f1fedc55bb3814d00bf0d8efda22fbe936219b`。
- 该提交中基座子树的 Git tree object ID（SHA-1）：`362613ef3455e1cc681444ab334654578d0f1a00`。
- 上述提交和子树已在维护者的本地历史中核对；它们不是已发布的基座版本、独立仓库提交或公开下载地址。
- 公开仓库：[hymsk/agent-plugin-base](https://github.com/hymsk/agent-plugin-base)；已记录的公开首个 commit 为 [`c61318a`](https://github.com/hymsk/agent-plugin-base/commit/c61318aa0149d796e3b3cc1bb920e590ce3cc5f2)。原始基线提交和树对象仍不是该公开仓库中的可访问提交；当前基座已发生后续变化，公开版本不能直接冒充原始派生基线。该公开 commit 作为后续比较参考。

`repo-guard` was developed from the `agent-plugin-base` source template, not from a published SDK. The commit and Git tree ID above identify the recorded original baseline verified in local history. They do not establish public availability, a standalone-repository commit, authorship certification or a signed release. The current base contains later changes; its first public version must not be represented as the original derivation baseline without comparison.

The public base repository is [hymsk/agent-plugin-base](https://github.com/hymsk/agent-plugin-base), whose first public commit is [`c61318a`](https://github.com/hymsk/agent-plugin-base/commit/c61318aa0149d796e3b3cc1bb920e590ce3cc5f2). The original tree is not published as a resolvable public commit; this public revision is the later comparison reference, and the differences remain described below. Do not publish private enclosing history just to make the original commit resolvable. A tree ID alone cannot let readers reconstruct unavailable source.

## Inherited structure / 沿用约定

- `agent-plugin.json` 是宿主中立定义，`src/plugin.mjs` 是业务 handler。
- `src/core/{manifest,protocol,dispatch}.mjs` 负责声明、canonical event 和派发。
- `scripts/host-hook.mjs` / `opencode.mjs` 是薄宿主桥。
- `src/build.mjs` 生成三端 marketplace / module 原生产物。
- `scripts/agent-plugin.mjs` 默认安装计划、显式 `--apply`，CodeAgent 委托复用组件原生安装逻辑。

## Intentional differences / 本地必要差异

1. 仅支持 `tool.before`，不复制示例 skills/MCP 或通用能力表，未声明能力不生成。
2. 事件必须有显式绝对 cwd；非法输入、空返回值、运行异常按拒绝处理。三端受保护工具共用 handler。
3. Codex 与 Claude 均使用标准 PreToolUse deny；启动 wrapper 将入口/import/子进程失败映射为 exit 2。
4. OpenCode 仅一个默认插件导出，在插件的 `tool` 属性注册专属会话开关，关闭通过宿主权限 API。
5. 固定运行文件清单，不打包私有 CSV；公开构建摘要用于过期检查，不再另设私有安装目录。
6. staged build 完成结构校验后替换 dist；产物不含构建机绝对路径。OpenCode 显式依赖验证过的 SDK，最低 Node 22。
7. 原生安装需核验来源/版本与失败结果；Codex trust 留给用户，不修改信任哈希。

后续基座升级应逐项比较这些差异并跑本组件回归，不自动覆盖安全语义。
这是模板派生关系，不是两个项目共享一个运行时包。通用 SDK 抽取不在本次范围。

In English: the inherited foundations are the neutral manifest, shared handler, canonical dispatch, thin host bridges and generated host packages. The guard deliberately restricts events to `tool.before`, validates explicit cwd/input, uses denial on protected-call failures and exit-2 hook wrappers, provides a permission-gated OpenCode session switch, and adds fixed inventories, freshness checks and native installation handling. It requires Node.js 22+ and an explicitly pinned OpenCode SDK. These are guard-specific changes, not guarantees supplied by the base.

## Maintenance and licensing / 维护与许可

Neither building nor running the guard requires a base checkout or package. Review future base changes individually and run the guard's own regression gates; never overwrite its policy or failure semantics automatically. Both current source distributions use AGPL-3.0-or-later. Preserve [LICENSE](LICENSE), [NOTICE](NOTICE) and this provenance record, and provide matching complete source/build scripts with generated packages. This record does not claim that an unavailable historical snapshot was already a licensed public release.
