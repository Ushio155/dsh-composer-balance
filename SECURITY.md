# SECURITY — 凭证与威胁模型

本插件的核心安全承诺只有一条，但它决定了本 fork 为何存在：

> **DeepSeek API Key 不出现在命令行参数里，也不以任何形式写入磁盘。**

## 密钥的生命周期

```
$DSH_HOME/.credentials.yaml
        │  ctx.credentials.resolve('DEEPSEEK_API_KEY')   ← 每次查询实时读取，不缓存
        ▼
   Host 进程内字符串
        │  curl --header @-  （stdin 管道）
        ▼
   curl 子进程 ── Authorization: Bearer … ──► https://api.deepseek.com/user/balance
```

- **不进 argv**：argv 可被同机其它进程通过进程表读取。上游做法（临时文件 + `--header @file`）已避免 argv 泄露，本项目保留该优点。
- **不落盘**：上游把密钥写进 `%TEMP%` 下的临时文件并声明 `mode: 0o600`。**在 Windows 上该模式被 Node 静默忽略**，实测生成的文件权限是 `0o666`，且进程被杀时 `finally` 的删除不会执行。本项目改为 stdin 传递，临时文件这一环节被彻底移除。
- **不进浏览器**：客户端只 `fetch('/ds-composer-balance')`，响应体仅含余额数字，永不含密钥。
- **不进日志**：错误对象只保留 `message`；不打印请求头或凭证对象。

## HTTP 路由策略

`GET|HEAD /ds-composer-balance`

| 检查 | 行为 |
| --- | --- |
| 非 `GET`/`HEAD` | `405` + `Allow: GET, HEAD` |
| `Sec-Fetch-Site` 为 `cross-site`/`same-site` | `403` `CROSS_ORIGIN` |
| `Origin` 存在且 host 与请求 `Host` 不一致 | `403` `CROSS_ORIGIN` |
| 其余（同源浏览器请求、无来源头的本机客户端） | 允许 |

说明：`dsh-host-webserver` 自身**不带 TLS、认证或来源策略**（其官方文档明确如此），因此来源策略必须由路由属主承担。该路由默认只监听回环地址（`127.0.0.1`）。若有人把 DSH 改为 `0.0.0.0` 绑定，同网段设备将可读取余额数字（**不能**窃取密钥）。

## 已识别的残余风险

| 风险 | 严重度 | 说明与缓解 |
| --- | --- | --- |
| 同机同用户进程读取余额 | 低 | 路由只回余额数字，不含密钥；如需更强隔离请依赖操作系统账户边界 |
| `ctx.credentials` 被其它插件滥用 | 中 | 属 DSH 凭证机制的固有边界，非本插件引入；只安装可信插件 |
| 上游许可瑕疵 | 低 | 上游 `package.json` 声明 MIT 但无 `LICENSE` 文件，见 `PROVENANCE.md` |
| 依赖 DSH 内部 API | 中 | 使用 `credentials`/`subprocess`/`webServer`/`tools` 四个 seam；DSH 升级可能变更，见 `MAINTENANCE.md` 的兼容性检查清单 |
| `curl` 可被 PATH 劫持 | 低 | 经 `ctx.subprocess.resolveExecutable('curl.exe')` 解析；Windows 系统自带 `curl.exe` 在 `System32` 下 |

## 报告与处置

1. 发现密钥泄露路径（例如某处把 key 写进 argv 或日志），**先视为已泄露**：到 DeepSeek 开放平台轮换该 Key。
2. 再修代码，并在 `test/host.test.mjs` 中补一条**能失败**的断言（禁止只加注释）。
3. 若是上游继承来的问题，在 `PROVENANCE.md` 的"变更摘要"中登记。
