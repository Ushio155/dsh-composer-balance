# dsh-composer-balance

> 在 DeepSeek Harness 的**输入框工具行左端**常驻一枚余额小字 + `↻` 刷新按钮，设置页可配刷新间隔与低余额告警，对话里还能直接问「查一下余额」。

这是已停更插件 [`kte66/dsh-balance`](https://github.com/kte66/dsh-balance) 的**接替实现**，修掉了它的三个实际缺陷，保留它最直观的那部分 UX。

## 为什么会有这个插件

上游 `kte66/dsh-balance` 停更（最后提交 2026-08-16，一天内 6 次提交，1 star，无 release，从未上 npm，不在插件市场目录内），且存在三个必须修的问题：

| 上游缺陷 | 实测 | 本插件 |
| --- | --- | --- |
| 密钥写入临时文件，声明 `mode: 0o600` | **Windows 上该模式不生效**，实测 `0o666`；进程被杀时残留 | 密钥经 **stdin** 传给 `curl --header @-`，**不落盘、不进 argv** |
| HTTP 路由无任何来源策略 | 同浏览器任意页面可读余额 | 校验 `Origin` 与 `Sec-Fetch-Site`，跨源返回 `403` |
| 无条件遮蔽内置 `cordis-panel` 徽标 | DSH 变更该槽位语义即波及内置 UI | 改为**设置项且默认关闭** |

此外：失败指数退避、标签页隐藏时暂停轮询、路由与配置键命名空间化、纯函数带单元测试。
完整取证与取用范围见 [`PROVENANCE.md`](PROVENANCE.md)，威胁模型见 [`SECURITY.md`](SECURITY.md)。

## 与上游/替代品的关系

保留的 UX 契约（这是它的价值所在）：**余额直接常驻输入框区域**，不是悬浮球、不是桌宠、不是侧边栏、也不需要点开面板。

若市场里出现了同样把余额放在输入框区域、且活跃维护的插件，可以平滑迁移：本插件的设置项与上游一致（刷新间隔、低余额阈值），差异仅在配置键与路由名（见 `PROVENANCE.md` 变更摘要）。

## 安装（本地 profile，推荐）

适用于 DSH 以**文件插件**方式加载（随 DSH 启动自动生效，无需审批）。

1. 把本仓库放到**稳定路径**（不要放在会话工作区或临时目录——一旦目录丢失，DSH 会因解析不到 bundle 而**无法启动**）：

   ```
   D:\code_practice\AI_coding\dsh-composer-balance
   ```

2. 编辑 `$DSH_HOME/profiles/<profile>/package.json`：

   ```jsonc
   {
     "dependencies": {
       "dsh-composer-balance": "link:D:/code_practice/AI_coding/dsh-composer-balance"
     },
     "dsh": {
       "profile": {
         "bundles": [
           // …原有 bundles…
           "dsh-composer-balance"
         ]
       }
     }
   }
   ```

   > Windows 路径在 JSON 中用正斜杠。

3. 让 bundle 解析器能找到它——建目录联接（junction）：

   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:DSH_HOME\profiles\web\node_modules\dsh-composer-balance" `
     -Target "D:\code_practice\AI_coding\dsh-composer-balance"
   ```

   或直接在 profile 目录执行 `pnpm install`。

4. 验证解析：

   ```powershell
   node -e "console.log(require.resolve('dsh-composer-balance/package.json', { paths: ['$env:DSH_HOME/profiles/web'] }))"
   ```

5. 确认凭证（插件不硬编码密钥，缺失时显示红色 `余额 —`）：

   ```
   # $DSH_HOME/.credentials.yaml
   DEEPSEEK_API_KEY: sk-xxxx
   ```

6. **重启 DSH**（Host 端改动需重启；此后仅改客户端只需刷新页面）。

## 验证安装

```powershell
# 1) 路由存活：应返回含 balance_infos 的 JSON
curl.exe -sS http://127.0.0.1:3080/ds-composer-balance

# 2) 来源策略生效：应返回 403
curl.exe -sS -H "Origin: http://evil.example" http://127.0.0.1:3080/ds-composer-balance
```

UI 侧：输入框工具行左端出现 `¥ x.xx` 小字 + `↻`；设置页出现「DeepSeek 余额」卡片。

## 设置项

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 自动刷新间隔 | 60 秒 | 允许 5–86400 秒；失败时按 2 的幂退避，上限 15 分钟 |
| 低余额告警阈值 | ¥10 | 低于阈值数字变红并显示 `⚠`；`0` = 关闭 |
| 启用自动刷新 | 开 | 关闭后只能点 `↻` 手动刷新 |
| 隐藏内置 Cordis 徽标 | **关** | 开启会遮蔽内置 UI 入口，仅在明确需要时打开 |

配置存于浏览器 `localStorage`，键 `dsh-composer-balance:config`。

## 模型工具

对话中说「查一下余额」即可触发 `deepseek_balance`，返回按币种的总余额、赠送余额、充值余额与账户可用状态。

## 开发

```powershell
node test/host.test.mjs   # 8 条断言，含"密钥不进 argv"的回归锁
```

- `lib/index.js` — Host 半部：路由 + 模型工具 + 凭证处理（零第三方 import，仅 `node:` 内置）
- `lib/client.js` — 浏览器半部：经典脚本 bundle，改动后**刷新页面即生效**，无需重新构建
- `cordis.patch.yml` — bundle 组合补丁（向 profile 根插入一行）

三条不变量由测试锁定，改动后必须仍成立：**密钥不进 argv、密钥经 stdin 传递、无写密钥到磁盘的路径**。

## 许可

MIT。上游 `kte66/dsh-balance` 在 `package.json` 声明 MIT 但未附 `LICENSE` 文件，取用范围与许可状态说明见 [`PROVENANCE.md`](PROVENANCE.md)。

维护规约、升级自检、发布渠道与卸载步骤见 [`MAINTENANCE.md`](MAINTENANCE.md)。
