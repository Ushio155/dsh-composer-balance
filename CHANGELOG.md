# CHANGELOG

本项目遵循语义化版本。项目起源于对已停更插件 `kte66/dsh-balance` @ `617876a` 的**接替实现**——它是 **MIT 派生作品**（派生范围与实测重合度见 [PROVENANCE.md](PROVENANCE.md)），不是独立重写。

## 0.1.0 — 2026-09-30

首个版本：接替 `kte66/dsh-balance`，保留"余额常驻输入框"UX，修复其安全与健壮性缺陷。

### 安全

- **密钥不再落盘**：改用 `curl --header @-` 经 stdin 传递 `Authorization` 头。上游写临时文件并声明 `mode: 0o600`，而该模式在 Windows 上被 Node 静默忽略（实测 `0o666`），且进程异常终止时不会清理。
- **密钥不进 argv**：以单元测试锁定（argv 可被同机其它进程读取）。
- **新增同源策略**：`Sec-Fetch-Site: cross-site` 或 `Origin` host 不匹配时返回 `403 CROSS_ORIGIN`；上游路由无任何来源检查。
- 限制方法为 `GET`/`HEAD`（其余 `405`），响应加 `no-store` 与 `nosniff`。

### 变更

- **不再默认遮蔽内置 UI**：上游无条件以 `priority: -1` 顶掉内置 `cordis-panel` 徽标；现改为设置项，默认关闭。
- 路由改名 `/ds-balance` → `/ds-composer-balance`；配置键 `ds-balance:config` → `dsh-composer-balance:config`（避免与其它余额插件冲突）。
- 包名 `@local/ds-balance` → `dsh-composer-balance`。

### 健壮性

- 轮询失败按 2 的幂退避（上限 15 分钟），成功即复位；上游为固定间隔持续打接口。
- 标签页隐藏时跳过网络请求。
- 并发查询合并为单次上游请求（single-flight）。
- 请求固定 HTTPS（`--proto =https`）并带 `--max-time 20`；stdout/stderr 有界采集。
- cwd 解析在缺少 `sandboxPolicy` 时回退到 home/tmp，不再直接失败。
- 支持多币种展示（上游只取第一个）。

### 测试

- 新增 `test/host.test.mjs`：8 条断言覆盖 argv 无密钥、HTTPS 固定、响应解析的四类失败分支、`is_available` 严格布尔语义、同源判定的允许与拒绝路径、模型工具渲染。

### 文档与许可

- 新增 `PROVENANCE.md` 的**实测重合度**章节与可复现脚本 `tools/similarity-audit.mjs`。
- **更正不实声明**：本文件与 PROVENANCE 早期版本称本插件为"独立重写/不存在逐字相同的段落"，实测不成立——`lib/client.js` 与上游行重合 **51.3%**、`lib/index.js` **36.2%**，最长逐字连续块 **12 行**。现已按 **MIT 派生作品**如实记录。
- 许可链核查：上游全部 6 个提交均无 `LICENSE` 文件，MIT 仅存在于 `package.json`；上游与其他同名 npm 包仅有通用样板重合，其上方无第三方权利人。
