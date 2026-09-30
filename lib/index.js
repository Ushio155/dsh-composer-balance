/**
 * dsh-composer-balance — Host half.
 *
 * Provides:
 *  - HTTP endpoint GET /ds-composer-balance (the composer balance pill reads it same-origin)
 *  - Model tool `deepseek_balance` (ask for the balance in conversation)
 *
 * Credential handling (the reason this fork exists):
 *  The API key is resolved live from ctx.credentials and handed to curl on STDIN
 *  (`-H @-`), so it never appears in argv (visible to other local processes via the
 *  process table) and never touches disk (the upstream plugin wrote it to a temp
 *  file whose 0600 mode is silently ignored on Windows, leaving it 0666).
 *
 * Zero third-party imports on purpose: a file plugin linked into a profile may not be
 * able to resolve packages from the harness install, so only node: builtins are used.
 */
import { homedir, tmpdir } from 'node:os'

/** Official DeepSeek balance endpoint. */
export const BALANCE_URL = 'https://api.deepseek.com/user/balance'
/** Platform-appropriate curl binary (Windows ships curl.exe; POSIX systems ship curl). */
export const CURL_NAME = process.platform === 'win32' ? 'curl.exe' : 'curl'
/** Hard request deadline in seconds, passed to curl as --max-time. */
export const REQUEST_TIMEOUT_SECONDS = 20
/** Bounded stdout/stderr collection so a hostile or broken response cannot grow without limit. */
export const MAX_STDOUT_BYTES = 64 * 1024
export const MAX_STDERR_BYTES = 8 * 1024

/**
 * Build the curl invocation for one balance query.
 *
 * The Authorization header is delivered through stdin (`-H @-`), never argv:
 * argv is observable by other processes on the machine, stdin is not.
 *
 * @param executable - absolute path resolved by ctx.subprocess.resolveExecutable.
 * @param apiKey - the live credential value.
 * @returns argv plus the stdin payload carrying the header.
 */
export function buildCurlInvocation(executable, apiKey) {
  return {
    argv: [
      executable,
      '--silent',
      '--show-error',
      '--max-time',
      String(REQUEST_TIMEOUT_SECONDS),
      '--proto',
      '=https',
      '--header',
      '@-',
      BALANCE_URL,
    ],
    stdin: 'Authorization: Bearer ' + apiKey + '\n',
  }
}

/**
 * Parse one balance response body into the plugin's result shape.
 * Pure function so it is unit-testable without a live API.
 *
 * @param text - raw JSON body.
 * @returns a normalized success shape, or a failure shape with a stable error code.
 */
export function parseBalancePayload(text) {
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'BAD_RESPONSE', message: '接口响应不是合法 JSON' }
  }
  if (data === null || typeof data !== 'object') {
    return { ok: false, error: 'BAD_RESPONSE', message: '接口响应不是 JSON 对象' }
  }
  if (data.error) {
    const message = data.error && data.error.message ? String(data.error.message) : 'DeepSeek 接口错误'
    return { ok: false, error: 'API_ERROR', message }
  }
  if (!Array.isArray(data.balance_infos)) {
    return { ok: false, error: 'BAD_RESPONSE', message: '响应缺少 balance_infos 字段' }
  }
  const balances = data.balance_infos.map((entry) => ({
    currency: entry && entry.currency !== undefined ? String(entry.currency) : '',
    total: entry && entry.total_balance !== undefined ? String(entry.total_balance) : '',
    granted: entry && entry.granted_balance !== undefined ? String(entry.granted_balance) : '',
    toppedUp: entry && entry.topped_up_balance !== undefined ? String(entry.topped_up_balance) : '',
  }))
  return { ok: true, isAvailable: data.is_available === true, balances }
}

/**
 * Decide whether a request may read the balance route.
 *
 * The web server carries no origin policy of its own, so this route enforces one:
 * a same-origin browser fetch is allowed, an explicit cross-origin Origin is refused,
 * and a cross-site Sec-Fetch-Site is refused. This keeps a random page open in the
 * same browser from reading the account balance through localhost.
 *
 * @param headers - the incoming request headers.
 * @returns true when the request looks same-origin or non-browser.
 */
export function isSameOriginRequest(headers) {
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site.length > 0 && site !== 'same-origin' && site !== 'none') {
    return false
  }
  const origin = headers['origin']
  if (typeof origin === 'string' && origin.length > 0) {
    const host = headers['host']
    if (typeof host !== 'string' || host.length === 0) return false
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  return true
}

/**
 * Resolve a working directory for the child process.
 * curl does not care where it runs; never fail the query over a missing policy.
 */
export function resolveCwd(ctx) {
  const policy = ctx.get('sandboxPolicy')
  if (policy && typeof policy.workspaceRoot === 'string' && policy.workspaceRoot.length > 0) {
    return policy.workspaceRoot
  }
  try {
    return homedir()
  } catch {
    return tmpdir()
  }
}

/** Render a query result for the model-facing tool. */
export function formatResult(result) {
  if (!result || result.ok !== true) {
    const code = result && result.error ? result.error : 'UNKNOWN'
    const detail = result && result.message ? result.message : '未知错误'
    return 'DeepSeek 余额查询失败 [' + code + ']：' + detail
  }
  const lines = ['DeepSeek 账户余额（查询时间 ' + result.at + '）：']
  lines.push('账户可用：' + (result.isAvailable ? '是' : '否'))
  for (const balance of result.balances || []) {
    lines.push('- ' + balance.currency + '：总额 ' + balance.total +
      '（赠送 ' + balance.granted + '，充值 ' + balance.toppedUp + '）')
  }
  return lines.join('\n')
}

export default {
  name: 'dsh-composer-balance',
  inject: ['credentials', 'subprocess', 'webServer', 'tools'],
  apply(ctx) {
    /** Single-flight guard: concurrent callers share one upstream request. */
    let inFlight = null

    async function queryBalance() {
      if (inFlight !== null) return inFlight
      inFlight = (async () => {
        try {
          const cred = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
          if (!cred || !cred.value) {
            return {
              ok: false,
              error: 'MISSING_CREDENTIAL',
              message: '未配置 DEEPSEEK_API_KEY，请写入 $DSH_HOME/.credentials.yaml',
            }
          }
          const executable = await ctx.subprocess.resolveExecutable(CURL_NAME)
          const invocation = buildCurlInvocation(executable, cred.value)
          const handle = ctx.subprocess.spawn({
            argv: invocation.argv,
            cwd: resolveCwd(ctx),
            stdio: {
              stdin: { data: invocation.stdin },
              stdout: { maxBytes: MAX_STDOUT_BYTES },
              stderr: { maxBytes: MAX_STDERR_BYTES },
            },
            graceMs: 5000,
          })
          const outcome = await handle.done
          const out = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
          const err = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
          if (outcome.exitCode !== 0) {
            return {
              ok: false,
              error: 'CURL_FAIL',
              message: 'curl 退出码 ' + outcome.exitCode + (err ? '：' + err.trim() : ''),
            }
          }
          const parsed = parseBalancePayload(out)
          if (parsed.ok !== true) return parsed
          return { ...parsed, at: new Date().toISOString() }
        } catch (error) {
          const message = error && error.message ? error.message : String(error)
          return { ok: false, error: 'QUERY_FAILED', message }
        } finally {
          inFlight = null
        }
      })()
      return inFlight
    }

    // HTTP endpoint consumed by the composer balance pill (same-origin fetch).
    ctx.webServer.register({
      kind: 'exact',
      path: '/ds-composer-balance',
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', 'allow': 'GET, HEAD' })
          res.end(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED', message: '仅支持 GET' }))
          return
        }
        if (!isSameOriginRequest(req.headers)) {
          res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: 'CROSS_ORIGIN', message: '拒绝跨来源读取余额' }))
          return
        }
        const result = await queryBalance()
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        res.end(JSON.stringify(result))
      },
    })

    // Model tool: "查一下 DeepSeek 余额" in conversation.
    ctx.tools.register({
      name: 'deepseek_balance',
      description: '查询当前 DeepSeek API 账户的剩余余额（按币种的总余额、赠送余额、充值余额）与账户可用状态。无需任何参数。',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'string' },
        render: (args, value) => [{ type: 'text', text: value }],
      },
      execute: async () => formatResult(await queryBalance()),
    })
  },
}
