# repo-guard

> 面向 Codex、Claude Code 和 OpenCode 的跨宿主安全插件。

[English](README.md) · [GitHub 仓库](https://github.com/hymsk/repo-guard) · [行为规范](SPEC.md) · [贡献指南](CONTRIBUTING.md) · [安全边界](SECURITY.md) · [发布指南](RELEASE.md)

`repo-guard` 是在受支持工具执行前实施仓库访问策略的安全插件。它使用互斥的白名单或黑名单识别 Git 仓库，并通过可配置的祖先目录标记拒绝敏感目录访问。插件预检 Codex、Claude Code 和 OpenCode 中已映射的 Read/Bash 调用；OpenCode 还支持 batch 预检和按会话启停。

本项目基于 [Agent Plugin Base](https://github.com/hymsk/agent-plugin-base) 源码模板构建，沿用基座的宿主中立 manifest、共享 handler、事件归一化和宿主适配结构，并独立实现仓库策略、目录预检与原生安装管理。两者是源码模板关系，不是运行时依赖：安装或运行 `repo-guard` 不需要检出 Agent Plugin Base。来源基线和主要差异见 [BASE-LINEAGE.md](BASE-LINEAGE.md)。

> [!IMPORTANT]
> `repo-guard` 是工具执行前的纵深防御措施，不是 OS 沙箱、完整 shell 解析器或数据防泄漏系统。请同时使用操作系统权限、宿主权限和隔离环境限制实际访问能力，并在部署环境中验证所用宿主版本的行为。

## 使用场景

- **只允许已批准的仓库**：使用白名单模式，仅当所选 Git remote 与当前 CSV 条目匹配时，才允许已映射的 Read/Bash 调用。
- **阻止已知敏感仓库**：使用黑名单模式拒绝命中的仓库，同时允许其他具有合法 remote 身份的仓库。
- **在 Git 检查前保护目录树**：在任一祖先目录放置 `.ai-forbidden` 或自定义标记，拒绝其下受支持的访问，包括非 Git 路径。

## 安装

### 环境要求

- Node.js **22+**、npm、Git 和 POSIX shell（Linux、macOS 或 WSL）；当前 hook wrapper 不支持原生 Windows。
- 所选宿主对应的 CLI。OpenCode SDK 固定为 `@opencode-ai/plugin@1.18.31`，准备相关依赖时需要访问 npm registry。

从源码安装：

```bash
git clone https://github.com/hymsk/repo-guard.git
cd repo-guard
npm run build
npm run validate
node scripts/agent-plugin.mjs install --host all             # 查看安装计划
node scripts/agent-plugin.mjs install --host opencode --apply
# 也可以按需选择 codex 或 claude。
```

项目目前不提供 registry 安装包。`install` 默认只输出计划；只有显式传入 `--apply` 才会调用宿主 CLI。安装使用宿主原生注册，不需要手工合并 hook 或配置。执行前应审阅目标，安装后保留源码与 `dist` 路径并重启宿主。Codex 用户还须在 `/hooks` 中审阅并信任 hook；注册存在不代表 hook 已激活，宿主策略也可能禁用 hooks。

## 配置

策略使用插件配置项，不再读取 `REPO_GUARD_POLICY_MODE`、`REPO_GUARD_WHITELIST_CSV`、`REPO_GUARD_BLACKLIST_CSV`、`REPO_GUARD_FORBIDDEN_MARKER`、`REPO_GUARD_REMOTE` 环境变量。

### OpenCode 原生插件选项

在 `opencode.json` 的既有插件条目中使用 `[地址, 配置对象]`（不要重复添加同一插件）：

```json
{
  "plugin": [
    ["file:///absolute/path/to/repo-guard/dist/opencode/package", {
      "policyMode": "whitelist",
      "whitelistCsv": "/absolute/path/to/whitelist.csv",
      "forbiddenMarker": ".ai-forbidden",
      "remote": "origin"
    }]
  ]
}
```

两种模式互斥：白名单模式省略 `blacklistCsv`，黑名单模式省略 `whitelistCsv`，不要填写空字符串。即使两项都配置，也只读取当前模式对应的 CSV。插件地址保持现有安装地址；原生选项修改后重启宿主。安装器保留已有选项，不生成真实策略路径。

### 三端共用的插件配置文件

Codex/Claude hook 读取 `~/.repo-guard/config.json`，内容就是上面的配置对象，示例见 `examples/config.json`。OpenCode 也可使用此文件；优先级为 **默认值 < 用户插件配置文件 < OpenCode 原生选项**。配置文件和 CSV 每次调用重新读取，OpenCode 原生选项按实例保存，不写入环境变量或全局共享状态。

| 配置项 | 默认值 / 要求 |
| --- | --- |
| `policyMode` | `whitelist`，可选 `blacklist` |
| `whitelistCsv` | 白名单模式需要绝对路径；黑名单模式可省略、不读取 |
| `blacklistCsv` | 黑名单模式需要绝对路径；白名单模式可省略、不读取 |
| `forbiddenMarker` | `.ai-forbidden`，单个文件名 |
| `remote` | `origin`，目标 remote 名称 |

未知配置项、错误类型、相对 CSV 路径、损坏或不可读配置都会拒绝受保护调用。用户配置文件缺失时使用默认值及 OpenCode 显式选项；配置文件存在但损坏时不静默回退。不会在目标仓库寻找配置，避免被访问仓库通过自己的文件放宽限制。配置和真实名单放在仓库外，不打包进运行产物；安装/更新不覆盖它们。日志与会话状态目录的旧高级环境开关不属于仓库策略配置，本次保持不变。

### 黑白名单模式

`policyMode` 默认 `whitelist`，未知值拒绝受保护调用。

| 模式 | 唯一生效的名单 | 命中时 | 未命中时 |
| --- | --- | --- | --- |
| `whitelist` | `whitelistCsv` | 允许 | 拒绝 |
| `blacklist` | `blacklistCsv` | 拒绝 | 允许合法 remote |

每次只重新加载当前模式对应的 CSV，仅读取 `repo` 列。另一名单文件即使存在、命中同一仓库、缺失或损坏，也不参与判断；配置项本身若提供仍须满足类型及绝对路径校验。黑名单示例见 `examples/blacklist.csv`。黑名单模式下，黑名单缺失、不可读、结构错误或含空/非法 `repo` 单元格时拒绝仓库授权，不能退化为空黑名单；若确实需要空黑名单，显式提供仅含 `repo` 表头的 CSV。

```json
{
  "policyMode": "blacklist",
  "blacklistCsv": "/absolute/path/to/blacklist.csv"
}
```

### 目录禁止标记（先于 Git）

默认标记名称为 `.ai-forbidden`，可通过 `"forbiddenMarker": ".no-ai"` 替换。配置必须是单个文件名（ASCII 字母、数字、点、下划线、连字符，最多 255 字符），不能是路径、通配符、`.` 或 `..`；无效配置拒绝受保护调用。

- 对 Read 目标所在目录（目标本身是目录时包含该目录）、Bash cwd/workdir、识别出的路径和 `cd` 目标，逐层检查所有祖先直到文件系统根，不在 `.git` 边界停止。
- 同时检查词法路径和符号链接解析后的真实路径及其祖先；不存在的后续路径也检查已有父目录。无法解析的符号链接、权限或元数据读取错误拒绝。
- 为避免符号链接后接 `..` 被错误折叠，受保护路径及 workdir 含 `..` 段时保守拒绝，请改用不含父目录段的绝对路径。
- 任一级存在标记即拒绝该目录及其后代访问；只检查存在性，不读取内容。标记是目录或失效符号链接也视为存在。
- 一次 Read/Bash 调用的全部已识别路径先完成标记检查，再调用 Git。标记优先于黑白名单，对非 Git 和无 remote 目录同样有效，不被白名单放行覆盖。
- OpenCode batch 先预检全部受保护子调用的目录标记，再执行各子调用的仓库策略检查。
- 每次调用重新检查，移除标记后不保留旧拒绝缓存。OpenCode `repo_guard_mode off` 会停用整个插件拦截，包括标记检查；重新启用后恢复。

这仍只覆盖本插件支持的 Read/Bash（及 OpenCode batch 内对应调用），不拦截其他工具。对无法由轻量预检安全解析的 Bash 语法（例如重定向、管道、shell substitution、glob、反斜杠转义和 `--option=/path` 参数）直接拒绝；已接受的命令仍不是完整 shell 解析，不保证递归后代访问、硬链接别名或 TOCTOU 防护，也不提供 OS 沙箱保证。
硬链接别名也不具备完整防护。Git 根目录探测失败目前被视为非 Git 放行，不能宣传为 Git 不可用时默认拒绝。插件自己不读取仓库内配置，但宿主原生的项目配置仍受宿主信任模型控制。

CSV 示例使用 `name,repo,details`，格式参见 `examples/whitelist.csv`（全英文合成数据，不自动启用）。只读取表头精确为 `repo` 的列，列的位置不限；`name`、`details`、`repo_path` 等其他列不参与授权。

匹配规则：

- 仅接受 `https://host/path`、`ssh://[user@]host/path`、`user@host:path`，不接受 HTTP 或裸仓库路径。
- HTTPS 和 SSH 的访问方式及用户名不参与仓库身份；完整域名、有效端口和完整仓库路径必须一致，不做后缀、前缀或路径兜底匹配。
- 域名不区分大小写，仓库路径区分大小写；去除末尾 `/` 和一个 `.git` 后缀。
- HTTPS 默认端口 443、SSH 默认端口 22 等价于省略端口；其他端口保留并严格匹配。例如 SSH 的 443 **不等于** HTTPS 默认 443；两端相同的非默认端口可匹配。
- 为避免隐式路径改写，拒绝查询、片段、百分号编码、反斜杠、点路径段、重复中间斜杠、域名末尾点等模糊地址。
- 支持 UTF-8 BOM、CSV 引号、逗号和多行说明；缺少或重复 `repo` 表头、非法引号或列数不一致会使整份策略无效。白名单空白或非法 `repo` 单元格不会产生授权；黑名单出现此类单元格使整份策略无效并拒绝仓库授权。

**兼容变化**：不再从 `repo_path` 授权；旧 CSV 只要有有效 `repo` 列仍可使用。原来仅凭同路径或 HTTP 地址获得的授权将被拒绝。
**不再隐式使用内置名单。** 白名单模式未设置、相对路径、文件不可读或删除时，有 remote 的仓库无法命中白名单。
配置有效且无禁止标记时，非 Git、确认目标 remote 不存在的仓库仍放行（目标由 `remote` 指定，默认 `origin`）。目标 remote 已存在但 URL 为空、缺失、非法或协议不受支持时拒绝；已识别 Git 仓库但读取 remote 列表失败时也拒绝。仅保留合成示例；真实名单通过上述插件配置项指定，不提交、不打包。

## 安装产物与更新行为

三端产物：

```text
dist/codex/       # 本地 marketplace + plugins/repo-guard
dist/claude/      # 本地 marketplace + plugins/repo-guard
dist/opencode/   # package/ 原生 module，带 SDK dependency
```

生成的运行包不引用源目录或相邻基座，可独立搬迁。OpenCode 原生安装计划按当前位置生成 `file:` 路径；安装后需保留该路径，移动后应重新安装。
OpenCode `--apply` 会先在包目录准备 `@opencode-ai/plugin` 依赖（禁用 lifecycle scripts），需要 npm registry 可达；仅写 dependencies 不代表依赖已经就绪。

Codex/Claude 使用宿主原生 marketplace 和 plugin 命令，不再直接合并用户 hooks/settings 或写 OpenCode loader。
安装/更新后重启宿主。**Codex 仍须在 `/hooks` 审阅信任 hook；安装存在不代表 hook 已信任。**
组织策略关闭 hooks、仅允许受管 hooks、宿主超时等情况不由本插件强制覆盖。
CodeAgent 通过 `codeagent.json` 与 `scripts/codeagent-install.mjs` 委托组件安装，不修改核心管理器或默认启用清单。

本地构建摘要和目标收据用于识别版本/源码变化；`dist/.native-install/` 保存安装锁与公开摘要收据。
`current` 只证明原生注册和构建收据一致，不证明 hook 信任或运行时防护已生效。
Codex/Claude 更新可能采用精确同源插件的卸载→重装，Claude 保留插件数据；这不是原子更新，失败会保留阶段和已执行步骤，不自动回滚。
多个宿主逐端执行并独立报告成功或失败，不承诺跨宿主整体回滚。发现遗留安装锁时先核对正在运行的操作，不自动释放不确定锁。
OpenCode 更新先在 staging 目录准备完整包及 SDK，校验通过再发布；失败恢复旧运行树和收据。发布采用两次 rename，不承诺强杀窗口或发布瞬间零中断。
已准备依赖的 OpenCode 包若源码变化，普通 `build` 会拒绝破坏该包，应使用 `install --host opencode --apply` 更新。
收据按配置目标摘要分目录保存；CodeAgent 入口拒绝指向目标 HOME 之外的宿主配置覆盖变量。

卸载先查看计划：

```bash
node scripts/agent-plugin.mjs uninstall --host codex
node scripts/agent-plugin.mjs uninstall --host claude
node scripts/agent-plugin.mjs uninstall --host opencode
```

Codex/Claude 支持时通过 `--apply` 调用原生命令；OpenCode 无原生卸载命令时给出手工移除该插件 `plugin[]` 条目的说明，不自行改写配置。
旧 `read-audit` 挂接、用户 hooks 或单独 loader 应由用户按原安装方式明确卸载；本插件不扫描/删除旧配置。避免同时启用新旧入口。

## 能力与边界

- 中立能力仅 `tool.before`；Codex/Claude 检查原生 `Read/Bash`，Codex shell/unified exec 按宿主映射到 Bash。
- OpenCode 检查 `read`、`bash`、batch 内直接受保护调用；超 100 项、嵌套或非法 batch 拒绝。
- 三端共享仓库检查：工作目录显式传入，Bash 相对 workdir 基于会话/项目目录解析。
- 正常放行不授予权限，拒绝使用宿主标准协议。非法输入、handler 异常及 bridge 启动失败拒绝；合法但未知工具不改变。
- 不覆盖所有 MCP/编辑工具/托管工具或交互 shell 后续输入；不是完整 shell 解析器或 OS 沙箱。不同 Git 服务间相同仓库路径不会互相授权。
- 宿主可并发执行其他 hooks；独立插件**不保证阻止审计插件采集或上报**。

OpenCode 专属工具 `repo_guard_mode`：`action=status|on|off`。关闭需 `context.ask` 请求 `repo_guard_disable`；拒绝或接口缺失不改变状态。若要求每次人工确认，将宿主该权限设置为 `ask`。
默认按 sessionID 隔离标记文件；`REPO_GUARD_DISABLED_FILE` 是高级全局覆盖，可能取消会话隔离。不支持旧 shell 开关捷径。

默认不写日志；`REPO_GUARD_LOG_LEVEL=debug` 日志可能包含路径、仓库及命令片段，仅用于受控本地排障，不直接分享。
其中原始 remote URL 或命令可能包含凭据，日志不是脱敏产物。漏洞报告请使用合成复现，私下联系 `lxj_hymsk@163.com`；不承诺响应时限或维护版本 SLA，详见 [安全说明](SECURITY.md)。

## 验证

```bash
npm run check
npm run build
npm run validate
npm test
npm run test:standalone # 固定公开清单导出后，在隔离 HOME 中重复离线验证
npm run test:host  # 可选：隔离 HOME 的 OpenCode 原生安装/加载，可能下载 SDK
```

`validate` 是本地结构/摘要校验，不等同于宿主原生校验。测试使用合成策略和临时目录；不需要模型请求。
默认测试不依赖 CodeAgent 源码或 Python。外部管理器集成测试需显式执行 `node tests/codeagent-install.test.mjs --manager-scripts /absolute/path/to/codeagent/scripts`，需要 Python 3；传入路径错误时失败，不将未运行报告为通过。
真实模型会话下的放行/拒绝、Codex trust 和组织权限仍需在部署环境验收。

离线测试验证合成协议和安装行为，不证明真实宿主已启用。可选 `test:host` 面向 OpenCode 1.18.31 的隔离安装、SDK schema、权限拒绝、hook 调用及 `debug config` 加载。宣称原生兼容前，请按 [RELEASE.md](RELEASE.md) 记录准确版本、平台和结果；真实模型端到端及跨平台验收仍是独立检查。

### 隔离宿主启动依赖

OpenCode 1.18.31 加载外部插件前，会等待**宿主配置目录**的 SDK 依赖准备。这与插件包自身的 `node_modules` 是两层独立依赖。
此前 `test:host` 只准备了插件包 SDK，冷 HOME 中的 `debug config` 因宿主自动依赖准备而超时；无业务逻辑的最小插件也可复现。
现在测试在临时配置目录用 npm 真实安装对应 SDK 并生成 `package-lock.json`，核对实际 SDK 和锁文件版本后再加载插件；不伪造锁文件或空依赖目录。
测试使用独立 npm cache、有限下载超时、禁用 lifecycle scripts，不读取或修改日常宿主配置。npm 不可达时会在明确的依赖准备阶段失败，而不是误报为插件初始化超时。
这只是隔离测试前置条件；生产安装器不会擅自覆盖宿主 `package.json` 或锁文件。真实环境出现类似超时，应先检查对应配置目录的依赖准备状态，而不是延长插件 hook 超时。

## 开发与源码导出

```bash
node scripts/export-source.mjs /absolute/path/to/new-public-source
```

目标必须不存在且位于当前源码树之外。仅复制 `public-files.json` 中逐个审阅的普通文件，不复制 Git 历史、私有名单、用户配置、日志、依赖、构建缓存或内部辅助脚本；拒绝清单中的符号链接。导出用于生成可审阅的源码树，不创建 Git 历史、tag 或托管 Release 元数据。分发前检查导出目录；不要直接递归复制工作目录或推送现有工作区历史。见 [贡献指南](CONTRIBUTING.md)。

## 许可证

Copyright (C) 2026 hymsk。项目按 [AGPL-3.0-or-later](LICENSE) 授权，不附带保证。源码派生关系和依赖边界见 [NOTICE](NOTICE)。源码包使用 `private: true` 防止 npm 误发布，但不限制许可证授予的权利。
