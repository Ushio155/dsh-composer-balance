/* dsh-composer-balance — browser half.
 *
 * A classic-script bundle loaded by the shell at runtime:
 *   window.__ModuleLoader__.load({ id, factory })
 * `require("react")` resolves through the shell's module table.
 *
 * Data comes from the host's same-origin route via fetch('/ds-composer-balance');
 * the API key never reaches the browser. Configuration lives in localStorage.
 *
 * Differences from the abandoned upstream plugin this replaces:
 *  - the built-in "Cordis Plugin" badge is NOT shadowed unless the user opts in
 *    (the upstream plugin unconditionally hid a built-in UI entry, which breaks
 *    the moment the harness changes that slot's semantics);
 *  - failed polls back off instead of hammering the API on a fixed timer;
 *  - polling pauses while the tab is hidden;
 *  - the route is namespaced to this plugin instead of the generic /ds-balance.
 */
window.__ModuleLoader__.load({
  id: 'dsh-composer-balance',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

    var CONFIG_KEY = "dsh-composer-balance:config";
    var ENDPOINT = "/ds-composer-balance";
    var DEFAULT_CONFIG = {
      autoRefresh: true,
      intervalMs: 60000,
      lowBalanceThreshold: 10,
      hideCordisBadge: false,
    };
    var MIN_INTERVAL_MS = 5000;
    var MAX_INTERVAL_MS = 86400000;
    var MAX_BACKOFF_MS = 900000;
    var errorColor = "#d64545";

    function clampInterval(value) {
      if (typeof value !== "number" || !isFinite(value)) return DEFAULT_CONFIG.intervalMs;
      return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, value));
    }

    function readConfig() {
      try {
        var raw = window.localStorage.getItem(CONFIG_KEY);
        if (!raw) {
          return {
            autoRefresh: DEFAULT_CONFIG.autoRefresh,
            intervalMs: DEFAULT_CONFIG.intervalMs,
            lowBalanceThreshold: DEFAULT_CONFIG.lowBalanceThreshold,
            hideCordisBadge: DEFAULT_CONFIG.hideCordisBadge,
          };
        }
        var parsed = JSON.parse(raw);
        return {
          autoRefresh: typeof parsed.autoRefresh === "boolean" ? parsed.autoRefresh : DEFAULT_CONFIG.autoRefresh,
          intervalMs: clampInterval(parsed.intervalMs),
          lowBalanceThreshold:
            typeof parsed.lowBalanceThreshold === "number" && isFinite(parsed.lowBalanceThreshold) && parsed.lowBalanceThreshold >= 0
              ? parsed.lowBalanceThreshold
              : DEFAULT_CONFIG.lowBalanceThreshold,
          hideCordisBadge: typeof parsed.hideCordisBadge === "boolean" ? parsed.hideCordisBadge : DEFAULT_CONFIG.hideCordisBadge,
        };
      } catch (e) {
        return {
          autoRefresh: DEFAULT_CONFIG.autoRefresh,
          intervalMs: DEFAULT_CONFIG.intervalMs,
          lowBalanceThreshold: DEFAULT_CONFIG.lowBalanceThreshold,
          hideCordisBadge: DEFAULT_CONFIG.hideCordisBadge,
        };
      }
    }

    function writeConfig(cfg) {
      try {
        window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
      } catch (e) {
        /* storage unavailable: settings stay in memory for this page */
      }
    }

    function fetchBalance() {
      return window.fetch(ENDPOINT, { cache: "no-store", headers: { accept: "application/json" } }).then(function (res) {
        return res.json();
      });
    }

    function formatAmount(value) {
      var n = Number(value);
      if (!isFinite(n)) return String(value === undefined || value === null ? "" : value);
      return n.toFixed(2);
    }

    function BalancePill() {
      var cfg = React.useState(readConfig());
      var config = cfg[0], setConfig = cfg[1];
      var res = React.useState(null);
      var result = res[0], setResult = res[1];
      var bus = React.useState(false);
      var busy = bus[0], setBusy = bus[1];
      // Consecutive failures drive exponential backoff so a broken key or an
      // offline machine does not issue a request every interval forever.
      var failRef = React.useRef(0);

      var refresh = React.useCallback(function () {
        setBusy(true);
        fetchBalance()
          .then(function (payload) {
            if (payload && payload.ok === true) {
              failRef.current = 0;
            } else {
              failRef.current = failRef.current + 1;
            }
            setResult(payload);
          })
          .catch(function (e) {
            failRef.current = failRef.current + 1;
            setResult({ ok: false, error: "NETWORK", message: String(e && e.message ? e.message : e) });
          })
          .finally(function () {
            setBusy(false);
          });
      }, []);

      React.useEffect(function () {
        setConfig(readConfig());
        refresh();
        // Keep the pill in sync when the settings card saves.
        var onConfig = function () { setConfig(readConfig()); };
        window.addEventListener("ds-composer-balance:config", onConfig);
        return function () { window.removeEventListener("ds-composer-balance:config", onConfig); };
      }, [refresh]);

      React.useEffect(function () {
        if (!config.autoRefresh || config.intervalMs <= 0) return undefined;
        var timer = null;
        var cancelled = false;

        var schedule = function () {
          if (cancelled) return;
          var failures = failRef.current;
          var delay = config.intervalMs;
          if (failures > 0) {
            delay = Math.min(MAX_BACKOFF_MS, config.intervalMs * Math.pow(2, Math.min(failures, 4)));
          }
          timer = window.setTimeout(function () {
            if (cancelled) return;
            // Skip the network call entirely while the tab is hidden.
            if (typeof document !== "undefined" && document.hidden) {
              schedule();
              return;
            }
            fetchBalance()
              .then(function (payload) {
                if (payload && payload.ok === true) {
                  failRef.current = 0;
                } else {
                  failRef.current = failRef.current + 1;
                }
                setResult(payload);
              })
              .catch(function () {
                failRef.current = failRef.current + 1;
              })
              .finally(function () {
                schedule();
              });
          }, delay);
        };

        schedule();
        return function () {
          cancelled = true;
          if (timer !== null) window.clearTimeout(timer);
        };
      }, [config.autoRefresh, config.intervalMs]);

      var label = "余额 —";
      var title = "DeepSeek 余额";
      var color = undefined;
      if (result && result.ok === true) {
        var balances = result.balances || [];
        var primary = balances[0];
        if (primary) {
          var symbol = primary.currency === "CNY" ? "¥" : primary.currency + " ";
          var total = Number(primary.total);
          var below = config.lowBalanceThreshold > 0 && isFinite(total) && total < config.lowBalanceThreshold;
          label = (below ? "⚠ " : "") + symbol + formatAmount(primary.total);
          var detail = balances
            .map(function (b) {
              var sym = b.currency === "CNY" ? "¥" : b.currency + " ";
              return sym + b.total + "（赠送 " + b.granted + "，充值 " + b.toppedUp + "）";
            })
            .join("；");
          title = "DeepSeek 余额：" + (result.isAvailable ? "可用" : "不可用") + "｜" + detail +
            (below ? "｜⚠ 余额低于 ¥" + config.lowBalanceThreshold + "，请及时充值" : "");
          color = below || !result.isAvailable ? errorColor : undefined;
        } else {
          title = "DeepSeek 余额：暂无余额数据";
        }
      } else if (result && result.ok !== true) {
        title = "查询失败 [" + (result.error || "") + "]：" + (result.message || "");
        color = errorColor;
      }

      return React.createElement(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 4 } },
        React.createElement(
          "span",
          {
            title: title,
            style: { fontSize: 12, opacity: 0.75, color: color, whiteSpace: "nowrap", cursor: "default" },
          },
          label
        ),
        React.createElement(
          "button",
          {
            type: "button",
            title: "刷新余额",
            "aria-label": "刷新余额",
            onClick: refresh,
            disabled: busy,
            style: {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 20,
              height: 20,
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: 13,
              opacity: busy ? 0.4 : 0.7,
            },
          },
          busy ? "…" : "↻"
        )
      );
    }

    function SettingsSection() {
      var cfg = React.useState(readConfig());
      var setConfig = cfg[1];
      var iv = React.useState("60");
      var intervalInput = iv[0], setIntervalInput = iv[1];
      var th = React.useState("10");
      var thresholdInput = th[0], setThresholdInput = th[1];
      var au = React.useState(true);
      var auto = au[0], setAuto = au[1];
      var hb = React.useState(false);
      var hideBadge = hb[0], setHideBadge = hb[1];
      var sv = React.useState(false);
      var saved = sv[0], setSaved = sv[1];
      var er = React.useState(null);
      var error = er[0], setError = er[1];

      React.useEffect(function () {
        var current = readConfig();
        setConfig(current);
        setIntervalInput(String(Math.round(current.intervalMs / 1000)));
        setThresholdInput(String(current.lowBalanceThreshold));
        setAuto(current.autoRefresh);
        setHideBadge(current.hideCordisBadge);
      }, []);

      var save = function () {
        var secs = Number(intervalInput);
        if (!isFinite(secs) || secs < MIN_INTERVAL_MS / 1000 || secs > MAX_INTERVAL_MS / 1000) {
          setError("请输入 " + MIN_INTERVAL_MS / 1000 + "–" + MAX_INTERVAL_MS / 1000 + " 之间的数值");
          return;
        }
        var threshold = Number(thresholdInput);
        if (!isFinite(threshold) || threshold < 0) {
          setError("低余额告警阈值请输入 ≥ 0 的数值（0 = 关闭告警）");
          return;
        }
        var next = {
          autoRefresh: auto,
          intervalMs: Math.round(secs * 1000),
          lowBalanceThreshold: threshold,
          hideCordisBadge: hideBadge,
        };
        writeConfig(next);
        setConfig(next);
        setError(null);
        setSaved(true);
        try {
          window.dispatchEvent(new window.Event("ds-composer-balance:config"));
        } catch (e) {
          /* event unavailable: the pill re-reads on next mount */
        }
      };

      var rows = [];
      rows.push(React.createElement("div", { key: "h", style: { fontWeight: 600 } }, "DeepSeek 余额（输入框余额条）"));
      rows.push(React.createElement("div", { key: "d1", style: { marginTop: 4 } }, "自动刷新间隔（秒，" + MIN_INTERVAL_MS / 1000 + "–" + MAX_INTERVAL_MS / 1000 + "）："));
      rows.push(React.createElement("input", { key: "i1", type: "number", min: MIN_INTERVAL_MS / 1000, max: MAX_INTERVAL_MS / 1000, value: intervalInput, onChange: function (e) { setIntervalInput(e.target.value); }, style: { width: 120 } }));
      rows.push(React.createElement("div", { key: "d2", style: { marginTop: 4 } }, "低余额告警阈值（0 = 关闭告警）："));
      rows.push(React.createElement("input", { key: "i2", type: "number", min: 0, step: "any", value: thresholdInput, onChange: function (e) { setThresholdInput(e.target.value); }, style: { width: 120 } }));
      rows.push(React.createElement("label", { key: "l1", style: { display: "flex", alignItems: "center", gap: 6 } },
        React.createElement("input", { type: "checkbox", checked: auto, onChange: function (e) { setAuto(e.target.checked); } }),
        "启用自动刷新"));
      rows.push(React.createElement("label", { key: "l2", style: { display: "flex", alignItems: "center", gap: 6 } },
        React.createElement("input", { type: "checkbox", checked: hideBadge, onChange: function (e) { setHideBadge(e.target.checked); } }),
        "隐藏内置 “Cordis Plugin” 徽标（会遮蔽一个内置 UI 入口，默认关闭）"));
      if (error) rows.push(React.createElement("div", { key: "e1", style: { color: errorColor } }, String(error)));
      if (saved) rows.push(React.createElement("div", { key: "s1", style: { color: "#2e7d32" } }, "已保存（间隔 " + Math.round(config.intervalMs / 1000) + " 秒，告警阈值 ¥" + config.lowBalanceThreshold + "）"));
      rows.push(React.createElement("button", { key: "b1", type: "button", onClick: save }, "保存"));
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, rows);
    }

    var inject = ["slots"];

    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;

      // Balance pill at the leading edge of the composer tool row.
      ctx.slots.inject("conversation.input.left", function () {
        return ctx.slots.register(
          { name: "conversation.input.left", id: "dsh-composer-balance", order: 0, label: "DeepSeek 余额" },
          function () { return React.createElement(BalancePill); }
        );
      });

      // Settings card.
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          { name: "settings.section", id: "dsh-composer-balance", order: 30, label: "DeepSeek 余额" },
          function () { return React.createElement(SettingsSection); }
        );
      });

      // Opt-in shadowing of the built-in Cordis panel entry. Registered only when the
      // user enabled it AND with a lower priority, because the built-in row uses
      // id "cordis-panel" at priority 0: same id at the same priority throws and takes
      // the whole built-in panel down. Default is not to touch built-in UI at all.
      var desired = readConfig().hideCordisBadge;
      if (desired) {
        ctx.slots.inject("sidebar.footer.action", function () {
          return ctx.slots.register(
            { name: "sidebar.footer.action", id: "cordis-panel", priority: -1 },
            function () { return null; }
          );
        });
      }
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
