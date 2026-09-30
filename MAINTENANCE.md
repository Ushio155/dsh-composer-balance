# MAINTENANCE — 接替协议与维护规约

本文件是本插件作为 `kte66/dsh-balance` **接替者**的操作契约：谁在维护、依据什么判断该动手、以及升级 DSH 后如何自检。

## 1. 接替关系

| 项 | 内容 |
| --- | --- |
| 被接替者 | `kte66/dsh-balance` @ `617876a`（2026-08-16 后停更，详见 `PROVENANCE.md`） |
| 接替者 | `dsh-composer-balance`（本仓库） |
| 接替依据 | 上游停更取证 + 三个必须修复的缺陷（密钥落盘、无来源策略、默认遮蔽内置 UI） |
| 接替范围 | **仅**"余额常驻输入框 + deepseek_balance 工具"这条 UX；不跟进上游若将来新增的功能 |

## 2. 定期复核（建议每 90 天）

发现下列任一情况，即应重新评估"继续自维护"还是"切换到生态内活跃替代品"：

1. **上游复活**：`kte66/dsh-balance` 出现新提交 → 对比其是否修复了本仓库 §PROVENANCE 的缺陷；若已修复且维护稳定，可考虑回归上游，把本仓库降级为个人分支。
2. **生态出现等价替代**：市场内出现**同样把余额常驻输入框区域**且活跃维护的插件 → 评估迁移成本（本插件的差异点见 `README.md` 的"与上游/替代品的关系"）。
3. **DSH 破坏性变更**：`ctx.credentials` / `ctx.subprocess` / `ctx.webServer` / `ctx.tools` 或客户端槽位变更 → 按 §4 自检。

复核用命令（本地即可，无需联网）：

```powershell
# 上游是否复活（未认证 API，每小时 60 次限额，够用）
node --input-type=module -e "const r=await fetch('https://api.github.com/repos/kte66/dsh-balance',{headers:{'User-Agent':'dsh'}});const j=await r.json();console.log('pushed',j.pushed_at,'stars',j.stargazers_count,'archived',j.archived)"
```

## 3. 变更纪律

- **测试先行**：任何触及密钥处理、路由策略、解析逻辑的改动，必须在 `test/host.test.mjs` 补一条**能失败**的断言。禁止只改代码不补断言。
- **密钥相关的三条不变量**（改动后必须仍成立，由测试锁定）：
  1. API Key 不出现在 `argv`；
  2. API Key 经 `stdin` 传递；
  3. 产物中不存在写密钥到磁盘的代码路径。
- **内置 UI 只读原则**：不得在默认配置下注册任何遮蔽内置槽位条目的逻辑。
- **提交信息**：`<type>: <中文简述>`，type 取 `feat` / `fix` / `docs` / `test` / `chore`。

## 4. DSH 升级后的自检清单

升级 DSH 后按顺序执行，任一步失败即定位到该层：

1. **组合成功**：重启后 DSH 正常启动，无 `cannot resolve profile bundle`。
2. **解析成功**：
   ```powershell
   node -e "console.log(require.resolve('dsh-composer-balance/package.json', { paths: ['$env:DSH_HOME/profiles/web'] }))"
   ```
3. **路由存活**（应返回 JSON 且含 `balance_infos`，而非 SPA 的 HTML）：
   ```powershell
   curl.exe -sS http://127.0.0.1:3080/ds-composer-balance
   ```
4. **来源策略生效**（应返回 403）：
   ```powershell
   curl.exe -sS -H "Origin: http://evil.example" http://127.0.0.1:3080/ds-composer-balance
   ```
5. **UI 存活**：输入框工具行左端出现余额小字 + ↻（客户端改动**只需刷新页面**，无需重启）。
6. **工具存活**：对话中说「查一下余额」能触发 `deepseek_balance`。

若第 3 步返回 HTML：说明路由未注册，通常是 bundle 未加载（检查 profile 的 `dsh.profile.bundles`）。
若第 5 步失败但第 3 步正常：说明客户端槽位名变更，需按 DSH 当前槽位定义调整 `lib/client.js` 的 `conversation.input.left`。

## 5. 版本与兼容策略

- 版本号 `MAJOR.MINOR.PATCH`：破坏性配置/路由变更 → `MAJOR`；新增设置项或功能 → `MINOR`；修复 → `PATCH`。
- **配置向后兼容**：`localStorage` 键 `dsh-composer-balance:config` 一旦发布不再改名；新增字段必须给默认值，且读取时容忍缺失（现有 `readConfig` 已按此实现）。
- **路由路径稳定**：`/ds-composer-balance` 不随版本变化。
- **零第三方运行时依赖**：继续只使用 `node:` 内置模块与宿主注入的 seam。这条约束是刻意的——文件插件 link 进 profile 后未必能解析到 harness 安装目录下的第三方包。

## 6. 发布与分发

| 渠道 | 状态 | 命令 |
| --- | --- | --- |
| GitHub（源码 + tag） | 主渠道 | `git push` + `git tag vX.Y.Z` |
| 本地 profile（自用） | 已接线 | `link:` + `node_modules` 目录联接，见 README |
| npm | 未发布（无 npm 凭证） | 需先配置 `~/.npmrc` token，再 `npm publish` |
| 插件市场目录 | 未收录 | 市场目录源自 awesome-dsh-plugin 精选列表，需向该列表提 PR；收录后会带能力扫描 |

## 7. 卸载

1. 从 `$DSH_HOME/profiles/web/package.json` 的 `dependencies` 删除 `"dsh-composer-balance": "link:<路径>"`；
2. 从 `dsh.profile.bundles` 删除 `"dsh-composer-balance"`；
3. 删除 `profiles/web/node_modules/dsh-composer-balance`（目录联接/symlink）；
4. 删除插件目录本体（若在版本控制下，先确认已推送）；
5. 重启 DSH。
