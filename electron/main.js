const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { spawn } = require("child_process");
const { globalShortcut } = require("electron");
const MARKET_CONFIG_PATH = path.join(__dirname, "..", "market-config.json");
const EASTMONEY_SEARCH_TOKEN = "D43BF722C8E33BDC906FB84D85E326E8";
const AUTO_LEVEL_PROFILES = {
  conservative: {
    label: "保守",
    supportLookback: 10,
    supportBufferAtr: 0.3,
    costAtrMultiplier: 1.2,
    rewardRisk: 1.5,
    minRiskPercent: 0.025,
  },
  balanced: {
    label: "均衡",
    supportLookback: 20,
    supportBufferAtr: 0.5,
    costAtrMultiplier: 1.5,
    rewardRisk: 2,
    minRiskPercent: 0.035,
  },
  aggressive: {
    label: "激进",
    supportLookback: 30,
    supportBufferAtr: 0.8,
    costAtrMultiplier: 2,
    rewardRisk: 3,
    minRiskPercent: 0.05,
  },
};
const DEFAULT_AUTO_LEVEL_PROFILE = "balanced";
const ATR_PERIOD = 14;

let win;
let bubbleWin;
let monitor;
let mousePassthrough = false;
let marketTimer = null;
let focusUiTimer = null;
let marketConfigWatcher = null;
let suppressConfigWatch = false;
let marketState = {
  config: null,
  quote: null,
  lastAlert: null,
  error: "",
  matchState: {},
  bubbleMode: "market",
  bubbleVisible: true,
  focusState: "idle",
  focusStats: {
    dayKey: "",
    currentTypingStartedAt: 0,
    lastTypingDurationMs: 0,
    totalTypingDurationMs: 0,
    currentTypingKeyCount: 0,
    lastTypingKeyCount: 0,
    totalTypingKeyCount: 0,
  },
};

function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ensureFocusStatsDay() {
  const key = todayKey();
  if (marketState.focusStats.dayKey !== key) {
    marketState.focusStats = {
      dayKey: key,
      currentTypingStartedAt: marketState.focusState === "typing" ? Date.now() : 0,
      lastTypingDurationMs: 0,
      totalTypingDurationMs: 0,
      currentTypingKeyCount: 0,
      lastTypingKeyCount: 0,
      totalTypingKeyCount: 0,
    };
  }
}

function getFocusSummary() {
  ensureFocusStatsDay();
  const now = Date.now();
  const currentTypingDurationMs =
    marketState.focusState === "typing" && marketState.focusStats.currentTypingStartedAt
      ? now - marketState.focusStats.currentTypingStartedAt
      : 0;

  return {
    state: marketState.focusState,
    currentTypingDurationMs,
    lastTypingDurationMs: marketState.focusStats.lastTypingDurationMs,
    totalTypingDurationMs: marketState.focusStats.totalTypingDurationMs + currentTypingDurationMs,
    currentTypingKeyCount: marketState.focusStats.currentTypingKeyCount,
    lastTypingKeyCount: marketState.focusStats.lastTypingKeyCount,
    totalTypingKeyCount: marketState.focusStats.totalTypingKeyCount,
  };
}

function loadMarketConfig() {
  const raw = fs.readFileSync(MARKET_CONFIG_PATH, "utf8");
  return normalizeMarketConfig(parseMarketConfigShape(JSON.parse(raw)));
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function parseSimpleStrategyConfig(item, { hasStop, hasTake }) {
  const rawStrategy = item?.strategy ?? item?.riskProfile ?? item?.plan ?? null;
  const strategyRequested = rawStrategy !== null && rawStrategy !== undefined;
  const strategyObject = rawStrategy && typeof rawStrategy === "object" ? rawStrategy : {};
  const modeHint =
    normalizeStrategyModeValue(strategyObject.mode) || normalizeStrategyModeValue(rawStrategy) || null;

  return {
    ...strategyObject,
    mode: strategyObject.mode || modeHint || (strategyRequested || !hasStop || !hasTake ? "auto" : "manual"),
    profile:
      strategyObject.profile ||
      strategyObject.riskProfile ||
      strategyObject.plan ||
      (typeof rawStrategy === "string" && !modeHint ? rawStrategy : undefined) ||
      DEFAULT_AUTO_LEVEL_PROFILE,
    autoStopLoss:
      typeof strategyObject.autoStopLoss === "boolean"
        ? strategyObject.autoStopLoss
        : strategyRequested
          ? modeHint !== "manual"
          : !hasStop,
    autoTakeProfit:
      typeof strategyObject.autoTakeProfit === "boolean"
        ? strategyObject.autoTakeProfit
        : strategyRequested
          ? modeHint !== "manual"
          : !hasTake,
  };
}

function parseMarketConfigShape(rawConfig) {
  if (Array.isArray(rawConfig)) {
    const symbols = rawConfig.map((item, index) => {
      const hasStop = hasOwn(item, "stop") || hasOwn(item, "stopLossPrice");
      const hasTake = hasOwn(item, "take") || hasOwn(item, "takeProfitPrice");

      return {
        id: item?.id || item?.code || item?.name || `symbol-${index + 1}`,
        enabled: item?.enabled !== false,
        name: item?.name || "",
        code: item?.code || "",
        market: item?.market || "",
        levels: {
          costPrice: item?.cost ?? item?.costPrice ?? null,
          stopLossPrice: item?.stop ?? item?.stopLossPrice ?? null,
          takeProfitPrice: item?.take ?? item?.takeProfitPrice ?? null,
        },
        strategy: parseSimpleStrategyConfig(item, { hasStop, hasTake }),
      };
    });

    return {
      pollIntervalMs: 20000,
      fireOnBoot: false,
      activeSymbolId: symbols[0]?.id || "",
      symbols,
    };
  }

  return rawConfig;
}

function normalizeMarketConfig(rawConfig) {
  const pollIntervalMs = Number(rawConfig?.pollIntervalMs) > 0 ? Number(rawConfig.pollIntervalMs) : 20000;
  const fireOnBoot = rawConfig?.fireOnBoot === true;

  const symbols = Array.isArray(rawConfig?.symbols)
    ? rawConfig.symbols.map(normalizeSymbolConfig).filter(Boolean)
    : rawConfig?.symbol
      ? [
          normalizeSymbolConfig({
            id: rawConfig.symbol.code,
            enabled: true,
            ...rawConfig.symbol,
            levels: rawConfig.levels || {},
          }),
        ].filter(Boolean)
      : [];

  const activeSymbolId = resolveActiveSymbolId(rawConfig?.activeSymbolId, symbols);

  return {
    pollIntervalMs,
    fireOnBoot,
    activeSymbolId,
    symbols,
  };
}

function normalizeSymbolConfig(symbol) {
  if (!symbol) return null;

  const name = String(symbol.name || "").trim();
  const code = String(symbol.code || "").trim();
  if (!name && !code) return null;

  const levels = {
    costPrice: normalizePrice(symbol.levels?.costPrice),
    stopLossPrice: normalizePrice(symbol.levels?.stopLossPrice),
    takeProfitPrice: normalizePrice(symbol.levels?.takeProfitPrice),
  };

  return {
    id: String(symbol.id || code || name).trim(),
    enabled: symbol.enabled !== false,
    name: name || code,
    code,
    market: String(symbol.market || "").toUpperCase() === "SZ" ? "SZ" : "SH",
    levels,
    strategy: normalizeStrategyConfig(symbol.strategy, levels),
  };
}

function normalizePrice(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Number(numeric.toFixed(2)) : null;
}

function normalizeStrategyModeValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["auto", "automatic", "自动"].includes(normalized)) return "auto";
  if (["manual", "手动"].includes(normalized)) return "manual";
  return null;
}

function normalizeStrategyProfile(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["保守", "conservative"].includes(normalized)) return "conservative";
  if (["激进", "aggressive"].includes(normalized)) return "aggressive";
  return "balanced";
}

function normalizeStrategyConfig(strategy, levels = {}) {
  const raw = strategy && typeof strategy === "object" ? strategy : {};
  const modeHint = normalizeStrategyModeValue(raw.mode) || normalizeStrategyModeValue(strategy);
  const profile = normalizeStrategyProfile(raw.profile || raw.riskProfile || raw.plan || strategy);
  const autoStopLoss = raw.autoStopLoss === true || (modeHint === "auto" && raw.autoStopLoss !== false);
  const autoTakeProfit = raw.autoTakeProfit === true || (modeHint === "auto" && raw.autoTakeProfit !== false);
  const mode = autoStopLoss || autoTakeProfit || modeHint === "auto" ? "auto" : "manual";

  return {
    mode,
    profile,
    autoStopLoss: mode === "auto" ? autoStopLoss : false,
    autoTakeProfit: mode === "auto" ? autoTakeProfit : false,
    basis: String(raw.basis || "").trim(),
    atr14: normalizePrice(raw.atr14),
    supportPrice: normalizePrice(raw.supportPrice),
    computedAt: String(raw.computedAt || "").trim(),
    rewardRisk: Number(raw.rewardRisk) > 0 ? Number(raw.rewardRisk) : null,
    note: String(raw.note || "").trim(),
  };
}

function saveMarketConfig(config) {
  suppressConfigWatch = true;
  fs.writeFileSync(MARKET_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  setTimeout(() => {
    suppressConfigWatch = false;
  }, 600);
}

function resolveActiveSymbolId(requestedId, symbols) {
  if (symbols.length === 0) {
    return "";
  }

  if (requestedId && symbols.some((symbol) => symbol.id === requestedId && symbol.enabled)) {
    return requestedId;
  }

  const enabled = symbols.find((symbol) => symbol.enabled);
  return enabled ? enabled.id : symbols[0].id;
}

function getActiveSymbolConfig(config = marketState.config) {
  if (!config || !Array.isArray(config.symbols) || config.symbols.length === 0) {
    return null;
  }

  return (
    config.symbols.find((symbol) => symbol.id === config.activeSymbolId && symbol.enabled) ||
    config.symbols.find((symbol) => symbol.enabled) ||
    config.symbols[0]
  );
}

function quoteCodeFromConfig(config) {
  const symbol = getActiveSymbolConfig(config);
  const market = String(symbol?.market || "").toUpperCase();
  const code = String(symbol?.code || "").trim();
  return `${market === "SZ" ? "sz" : "sh"}${code}`;
}

function createQuoteRequestUrl(config) {
  return `https://qt.gtimg.cn/q=${quoteCodeFromConfig(config)}`;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "petclaw-market/1.0",
            Accept: "application/json,text/plain,*/*",
          },
        },
        (response) => {
          let data = "";

          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            data += chunk;
          });

          response.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (error) {
              reject(error);
            }
          });
        },
      )
      .on("error", reject);
  });
}

function requestQuote(config) {
  return new Promise((resolve, reject) => {
    https
      .get(
        createQuoteRequestUrl(config),
        {
          headers: {
            "User-Agent": "petclaw-market/1.0",
            Accept: "text/plain,*/*",
          },
        },
        (response) => {
          let data = "";

          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            data += chunk;
          });

          response.on("end", () => {
            try {
              resolve(parseQuotePayload(data, config));
            } catch (error) {
              reject(error);
            }
          });
        },
      )
      .on("error", reject);
  });
}

async function requestIntradaySeries(config) {
  const symbol = getActiveSymbolConfig(config);
  const market = String(symbol?.market || "").toUpperCase() === "SZ" ? "sz" : "sh";
  const code = String(symbol?.code || "").trim();
  if (!code) {
    return [];
  }

  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${market}${code}`;
  const payload = await requestJson(url);
  const rawRows = payload?.data?.[`${market}${code}`]?.data?.data || [];
  if (!Array.isArray(rawRows)) {
    return [];
  }

  return rawRows.map(parseMinuteRow).filter(Boolean);
}

function parseMinuteRow(row) {
  const parts = Array.isArray(row) ? row : String(row || "").trim().split(/\s+/);
  if (parts.length < 2) return null;

  const time = String(parts[0] || "").trim();
  const price = parseNumber(parts[1]);
  if (!time || typeof price !== "number") {
    return null;
  }

  return {
    time,
    price,
  };
}

function enrichQuoteWithPosition(config, quote, intraday) {
  const symbol = getActiveSymbolConfig(config);
  const costPrice = symbol?.levels?.costPrice;
  const positionChangePercent =
    typeof costPrice === "number" && costPrice > 0 && typeof quote?.price === "number"
      ? Number((((quote.price - costPrice) / costPrice) * 100).toFixed(2))
      : null;

  return {
    ...quote,
    intraday: Array.isArray(intraday) ? intraday : [],
    positionChangePercent,
  };
}

async function requestDailyKlines(symbol, limit = 80) {
  const code = String(symbol?.code || "").trim();
  const market = String(symbol?.market || "").toUpperCase() === "SZ" ? "sz" : "sh";
  if (!code) {
    throw new Error("股票代码缺失，无法计算自动止盈止损");
  }

  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${market}${code},day,,,${limit},qfq`;
  const payload = await requestJson(url);
  const series =
    payload?.data?.[`${market}${code}`]?.qfqday ||
    payload?.data?.[`${market}${code}`]?.day ||
    [];
  const rows = Array.isArray(series) ? series.map(parseKlineRow).filter(Boolean) : [];

  if (rows.length < ATR_PERIOD + 2) {
    throw new Error(`${symbol.name || code} 日线数据不足，暂时无法自动计算止盈止损`);
  }

  return rows;
}

function parseKlineRow(line) {
  const parts = Array.isArray(line) ? line : String(line || "").split(",");
  if (parts.length < 5) return null;

  const open = parseNumber(parts[1]);
  const close = parseNumber(parts[2]);
  const high = parseNumber(parts[3]);
  const low = parseNumber(parts[4]);

  if (![open, close, high, low].every((value) => typeof value === "number")) {
    return null;
  }

  return {
    date: parts[0],
    open,
    close,
    high,
    low,
  };
}

function completedKlines(rows) {
  if (!Array.isArray(rows) || rows.length <= 1) {
    return Array.isArray(rows) ? rows.slice() : [];
  }

  return rows.slice(0, -1);
}

function computeAtr(rows, period = ATR_PERIOD) {
  const series = completedKlines(rows);
  if (series.length < period + 1) return null;

  const trValues = [];
  for (let index = 1; index < series.length; index += 1) {
    const current = series[index];
    const previous = series[index - 1];
    const trueRange = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
    trValues.push(trueRange);
  }

  const recent = trValues.slice(-period);
  if (recent.length < period) return null;
  const total = recent.reduce((sum, value) => sum + value, 0);
  return total / recent.length;
}

function computeRecentSupport(rows, lookback) {
  const series = completedKlines(rows);
  if (series.length === 0) return null;

  const window = series.slice(-Math.max(lookback, 1));
  const lows = window.map((row) => row.low).filter((value) => typeof value === "number");
  if (lows.length === 0) return null;
  return Math.min(...lows);
}

function computeAutoStopLoss(costPrice, atr, supportPrice, profileConfig) {
  if (
    typeof costPrice !== "number" ||
    typeof atr !== "number" ||
    typeof supportPrice !== "number" ||
    !profileConfig
  ) {
    return null;
  }

  const supportStop = supportPrice - atr * profileConfig.supportBufferAtr;
  const atrStop = costPrice - atr * profileConfig.costAtrMultiplier;
  let riskAmount = costPrice - Math.min(supportStop, atrStop);
  const minimumRiskAmount = costPrice * profileConfig.minRiskPercent;

  if (!Number.isFinite(riskAmount) || riskAmount <= 0) {
    riskAmount = minimumRiskAmount;
  }

  if (riskAmount < minimumRiskAmount) {
    riskAmount = minimumRiskAmount;
  }

  return normalizePrice(costPrice - riskAmount);
}

function computeAutoTakeProfit(costPrice, stopLossPrice, rewardRisk) {
  if (
    typeof costPrice !== "number" ||
    typeof stopLossPrice !== "number" ||
    !(costPrice > stopLossPrice) ||
    !(Number(rewardRisk) > 0)
  ) {
    return null;
  }

  return normalizePrice(costPrice + (costPrice - stopLossPrice) * Number(rewardRisk));
}

function shouldAutoComputeLevels(symbol) {
  const strategy = symbol?.strategy || {};
  return (
    typeof symbol?.levels?.costPrice === "number" &&
    (strategy.autoStopLoss === true || strategy.autoTakeProfit === true)
  );
}

async function enrichSymbolLevels(symbol) {
  if (!shouldAutoComputeLevels(symbol)) {
    return symbol;
  }

  const profileKey = normalizeStrategyProfile(symbol.strategy?.profile);
  const profileConfig = AUTO_LEVEL_PROFILES[profileKey] || AUTO_LEVEL_PROFILES[DEFAULT_AUTO_LEVEL_PROFILE];
  const levels = symbol.levels || {};

  try {
    const klines = await requestDailyKlines(symbol);
    const atr = computeAtr(klines, ATR_PERIOD);
    const supportPrice = computeRecentSupport(klines, profileConfig.supportLookback);
    let stopLossPrice = levels.stopLossPrice;

    if (symbol.strategy?.autoStopLoss) {
      stopLossPrice = computeAutoStopLoss(levels.costPrice, atr, supportPrice, profileConfig);
    }

    let takeProfitPrice = levels.takeProfitPrice;
    if (symbol.strategy?.autoTakeProfit) {
      takeProfitPrice = computeAutoTakeProfit(levels.costPrice, stopLossPrice, profileConfig.rewardRisk);
    }

    return {
      ...symbol,
      levels: {
        ...levels,
        stopLossPrice,
        takeProfitPrice,
      },
      strategy: {
        ...symbol.strategy,
        mode: "auto",
        profile: profileKey,
        basis: "support-atr-2r",
        atr14: normalizePrice(atr),
        supportPrice: normalizePrice(supportPrice),
        computedAt: new Date().toISOString(),
        rewardRisk: profileConfig.rewardRisk,
        note: `${profileConfig.label}策略：前低下方 + ATR 缓冲，止盈按 ${profileConfig.rewardRisk}R 计算`,
      },
    };
  } catch (error) {
    return {
      ...symbol,
      strategy: {
        ...symbol.strategy,
        mode: "auto",
        profile: profileKey,
        basis: "support-atr-2r",
        rewardRisk: profileConfig.rewardRisk,
        note: error?.message || String(error),
      },
    };
  }
}

function parseQuotePayload(rawText, config) {
  const symbol = getActiveSymbolConfig(config);
  const match = String(rawText).trim().match(/^v_[^=]+="(.*)";?$/);
  if (!match) {
    throw new Error("行情返回格式异常");
  }

  const parts = match[1].split("~");
  return {
    code: parts[2] || symbol?.code || "",
    name: symbol?.name || parts[1] || symbol?.code || "",
    price: parseNumber(parts[3]),
    previousClose: parseNumber(parts[4]),
    open: parseNumber(parts[5]),
    change: parseNumber(parts[31]),
    changePercent: parseNumber(parts[32]),
    high: parseNumber(parts[33]),
    low: parseNumber(parts[34]),
    updatedAt: parts[30] || "",
  };
}

function parseNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

async function resolveSymbolByName(name) {
  const keyword = String(name || "").trim();
  if (!keyword) {
    throw new Error("股票名称不能为空");
  }

  const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(keyword)}&type=14&token=${EASTMONEY_SEARCH_TOKEN}`;
  const payload = await requestJson(url);
  const rows = payload?.QuotationCodeTable?.Data || [];
  const candidates = rows.filter((row) => row?.Classify === "AStock" || String(row?.SecurityTypeName || "").includes("A"));
  const matched =
    candidates.find((row) => row?.Name === keyword) ||
    candidates.find((row) => String(row?.Name || "").includes(keyword)) ||
    candidates[0];

  if (!matched) {
    throw new Error(`未找到股票：${keyword}`);
  }

  return {
    id: String(matched.Code || keyword).trim(),
    name: String(matched.Name || keyword).trim(),
    code: String(matched.Code || "").trim(),
    market:
      String(matched.MarketType || "").trim() === "0" ||
      String(matched.QuoteID || "").startsWith("0.")
        ? "SZ"
        : "SH",
  };
}

async function resolveMarketConfig(rawConfig) {
  const config = normalizeMarketConfig(rawConfig);
  const symbols = await Promise.all(
    config.symbols.map(async (symbol) => {
      let nextSymbol = symbol;

      if (symbol.name) {
        try {
          const resolved = await resolveSymbolByName(symbol.name);
          nextSymbol = {
            ...nextSymbol,
            id: resolved.id || nextSymbol.id,
            name: resolved.name || nextSymbol.name,
            code: resolved.code || nextSymbol.code,
            market: resolved.market || nextSymbol.market,
          };
        } catch (error) {
          if (!symbol.code) {
            throw error;
          }
        }
      }

      return enrichSymbolLevels({
        ...nextSymbol,
        strategy: normalizeStrategyConfig(nextSymbol.strategy, nextSymbol.levels),
      });
    }),
  );

  return {
    ...config,
    activeSymbolId: resolveActiveSymbolId(config.activeSymbolId, symbols),
    symbols,
  };
}

function buildAlert(kind, config, quote) {
  if (!quote || quote.price === null) return null;

  const symbol = getActiveSymbolConfig(config);
  if (!symbol) return null;

  const levels = symbol.levels || {};
  const nextMatches = {
    cost: typeof levels.costPrice === "number" ? quote.price >= levels.costPrice : undefined,
    stopLoss: typeof levels.stopLossPrice === "number" ? quote.price <= levels.stopLossPrice : undefined,
    takeProfit: typeof levels.takeProfitPrice === "number" ? quote.price >= levels.takeProfitPrice : undefined,
  };

  const previous = marketState.matchState || {};
  marketState.matchState = nextMatches;

  if (kind === "boot" && !config.fireOnBoot) {
    return null;
  }

  if (typeof nextMatches.stopLoss === "boolean" && nextMatches.stopLoss && !previous.stopLoss) {
    return {
      title: "止损提醒",
      level: "danger",
      message: `${symbol.name} 已到 ${quote.price.toFixed(2)} 元，跌破止损价 ${levels.stopLossPrice.toFixed(2)} 元。`,
      triggeredAt: new Date().toISOString(),
    };
  }

  if (typeof nextMatches.cost === "boolean" && nextMatches.cost && !previous.cost) {
    return {
      title: "回本提醒",
      level: "warning",
      message: `${symbol.name} 已回到 ${quote.price.toFixed(2)} 元，达到成本价 ${levels.costPrice.toFixed(2)} 元。`,
      triggeredAt: new Date().toISOString(),
    };
  }

  if (typeof nextMatches.takeProfit === "boolean" && nextMatches.takeProfit && !previous.takeProfit) {
    return {
      title: "止盈提醒",
      level: "warning",
      message: `${symbol.name} 已到 ${quote.price.toFixed(2)} 元，达到止盈价 ${levels.takeProfitPrice.toFixed(2)} 元。`,
      triggeredAt: new Date().toISOString(),
    };
  }

  return null;
}

function broadcastMarketSnapshot(channel = "market-snapshot") {
  const activeSymbol = getActiveSymbolConfig();
  const payload = {
    config: marketState.config,
    activeSymbol,
    quote: marketState.quote,
    lastAlert: marketState.lastAlert,
    error: marketState.error,
    bubbleMode: marketState.bubbleMode,
    bubbleVisible: marketState.bubbleVisible,
    focusState: marketState.focusState,
    focusSummary: getFocusSummary(),
  };

  win?.webContents.send(channel, payload);
  bubbleWin?.webContents.send(channel, payload);
}

function applyMarketConfig(config, options = {}) {
  marketState.config = config;
  marketState.quote = null;
  marketState.lastAlert = null;
  marketState.error = "";
  marketState.matchState = {};

  if (marketTimer) {
    clearInterval(marketTimer);
    marketTimer = null;
  }

  if (config.symbols.length === 0) {
    marketState.error = "market-config.json 里至少要有 1 只股票。";
    broadcastMarketSnapshot("market-snapshot");
    return;
  }

  void pollMarket(options.kind || "boot");

  marketTimer = setInterval(() => {
    void pollMarket("tick");
  }, config.pollIntervalMs);
}

async function reloadMarketConfig() {
  try {
    const nextConfig = await resolveMarketConfig(loadMarketConfig());
    saveMarketConfig(nextConfig);
    applyMarketConfig(nextConfig, { kind: "boot" });
  } catch (error) {
    marketState.error = error?.message || String(error);
    broadcastMarketSnapshot("market-snapshot");
  }
}

function switchActiveSymbol(step) {
  const config = marketState.config;
  if (!config || !Array.isArray(config.symbols)) {
    return;
  }

  const enabledSymbols = config.symbols.filter((symbol) => symbol.enabled);
  if (enabledSymbols.length === 0) {
    return;
  }

  const currentIndex = enabledSymbols.findIndex((symbol) => symbol.id === config.activeSymbolId);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + step + enabledSymbols.length) % enabledSymbols.length;
  const nextConfig = {
    ...config,
    activeSymbolId: enabledSymbols[nextIndex].id,
  };
  saveMarketConfig(nextConfig);
  applyMarketConfig(nextConfig, { kind: "boot" });
}

function watchMarketConfig() {
  if (marketConfigWatcher) {
    return;
  }

  let reloadTimer = null;
  marketConfigWatcher = fs.watch(MARKET_CONFIG_PATH, () => {
    if (suppressConfigWatch) {
      return;
    }
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }
    reloadTimer = setTimeout(() => {
      void reloadMarketConfig();
    }, 250);
  });
}

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = 240;
  const height = 240;

  win = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + area.width - width - 24),
    y: Math.round(area.y + area.height - height - 40),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, "screen-saver");
  win.loadFile(path.join(__dirname, "renderer", "cat.html"));
  win.on("move", syncBubblePosition);
  win.on("closed", () => {
    win = null;
  });
}

function createBubbleWindow() {
  const width = 236;
  const height = 264;
  const { x, y } = getBubblePosition();

  bubbleWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  bubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubbleWin.setAlwaysOnTop(true, "screen-saver");
  bubbleWin.setIgnoreMouseEvents(true, { forward: true });
  bubbleWin.loadFile(path.join(__dirname, "renderer", "market-bubble.html"));
  if (!marketState.bubbleVisible) {
    bubbleWin.hide();
  }
  bubbleWin.on("closed", () => {
    bubbleWin = null;
  });
}

function getBubblePosition() {
  if (!win) {
    const display = screen.getPrimaryDisplay();
    const area = display.workArea;
    return {
      x: Math.round(area.x + area.width - 222),
      y: Math.round(area.y + area.height - 370),
    };
  }

  const [catX, catY] = win.getPosition();
  return {
    x: Math.round(catX - 14),
    y: Math.round(catY - 196),
  };
}

function syncBubblePosition() {
  if (!win || !bubbleWin || bubbleWin.isDestroyed()) return;
  const { x, y } = getBubblePosition();
  bubbleWin.setPosition(x, y);
}

function setMousePassthrough(ignore) {
  if (!win || mousePassthrough === ignore) return;
  mousePassthrough = ignore;
  if (ignore) {
    win.setIgnoreMouseEvents(true, { forward: true });
  } else {
    win.setIgnoreMouseEvents(false);
  }
}

async function pollMarket(kind = "tick") {
  if (!marketState.config) {
    return;
  }

  try {
    const [quote, intraday] = await Promise.all([
      requestQuote(marketState.config),
      requestIntradaySeries(marketState.config).catch(() => []),
    ]);
    marketState.quote = enrichQuoteWithPosition(marketState.config, quote, intraday);
    marketState.error = "";

    const alert = buildAlert(kind, marketState.config, marketState.quote);
    if (alert) {
      marketState.lastAlert = alert;
      broadcastMarketSnapshot("market-alert");
    } else {
      broadcastMarketSnapshot("market-snapshot");
    }
  } catch (error) {
    marketState.error = error?.message || String(error);
    broadcastMarketSnapshot("market-snapshot");
  }
}

async function startMarketMonitor() {
  ensureFocusStatsDay();
  const config = await resolveMarketConfig(loadMarketConfig());
  saveMarketConfig(config);
  applyMarketConfig(config, { kind: "boot" });
  watchMarketConfig();
}

function startMonitor() {
  const helperPath = path.join(__dirname, "..", "build", "key-monitor");
  monitor = spawn(helperPath, [], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  monitor.on("error", (err) => {
    console.error("Failed to start key-monitor:", err?.message || err);
  });

  monitor.stdout.on("data", (buf) => {
    const lines = buf.toString("utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      if (line === "key") {
        ensureFocusStatsDay();
        marketState.focusStats.currentTypingKeyCount += 1;
        marketState.focusStats.totalTypingKeyCount += 1;
        if (marketState.bubbleVisible && marketState.bubbleMode === "focus") {
          broadcastMarketSnapshot("market-snapshot");
        }
        continue;
      }

      if (line === "typing" || line === "idle") {
        ensureFocusStatsDay();
        const previousState = marketState.focusState;
        const now = Date.now();

        if (line === "typing" && previousState !== "typing") {
          marketState.focusStats.currentTypingStartedAt = now;
          if (marketState.focusStats.currentTypingKeyCount === 0) {
            marketState.focusStats.currentTypingKeyCount = 0;
          }
        }

        if (line === "idle" && previousState === "typing" && marketState.focusStats.currentTypingStartedAt) {
          const duration = now - marketState.focusStats.currentTypingStartedAt;
          marketState.focusStats.lastTypingDurationMs = duration;
          marketState.focusStats.totalTypingDurationMs += duration;
          marketState.focusStats.lastTypingKeyCount = marketState.focusStats.currentTypingKeyCount;
          marketState.focusStats.currentTypingStartedAt = 0;
          marketState.focusStats.currentTypingKeyCount = 0;
        }

        marketState.focusState = line;
        win?.webContents.send("cat-state", line);
        broadcastMarketSnapshot("market-snapshot");
      }
    }
  });

  monitor.stderr.on("data", (buf) => {
    const text = buf.toString("utf8").trim();
    if (text) console.error(text);
  });

  monitor.on("exit", (code, signal) => {
    if (code || signal) {
      console.error(`key-monitor exited (code=${code}, signal=${signal})`);
    }
  });
}

app.whenReady().then(async () => {
  app.dock.hide();
  createWindow();
  createBubbleWindow();
  startMonitor();
  await startMarketMonitor();
  focusUiTimer = setInterval(() => {
    if (marketState.bubbleVisible && marketState.bubbleMode === "focus") {
      broadcastMarketSnapshot("market-snapshot");
    }
  }, 1000);
  globalShortcut.register("CommandOrControl+Shift+M", () => {
    toggleBubbleMode();
  });
  globalShortcut.register("CommandOrControl+Shift+B", () => {
    toggleBubbleVisible();
  });
  globalShortcut.register("CommandOrControl+Shift+R", () => {
    void reloadMarketConfig();
  });
  globalShortcut.register("CommandOrControl+Shift+[", () => {
    switchActiveSymbol(-1);
  });
  globalShortcut.register("CommandOrControl+Shift+]", () => {
    switchActiveSymbol(1);
  });
});

function toggleBubbleMode() {
  marketState.bubbleMode = marketState.bubbleMode === "market" ? "focus" : "market";
  if (!marketState.bubbleVisible && bubbleWin) {
    bubbleWin.showInactive();
    marketState.bubbleVisible = true;
  }
  broadcastMarketSnapshot("market-snapshot");
}

function toggleBubbleVisible() {
  marketState.bubbleVisible = !marketState.bubbleVisible;

  if (!bubbleWin || bubbleWin.isDestroyed()) {
    return;
  }

  if (marketState.bubbleVisible) {
    bubbleWin.showInactive();
    syncBubblePosition();
  } else {
    bubbleWin.hide();
  }

  broadcastMarketSnapshot("market-snapshot");
}

ipcMain.handle("quit-app", () => {
  app.quit();
});

ipcMain.handle("drag-window", (_event, deltaX, deltaY) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + deltaX), Math.round(y + deltaY));
  syncBubblePosition();
});

ipcMain.handle("set-mouse-passthrough", (_event, ignore) => {
  setMousePassthrough(Boolean(ignore));
});

ipcMain.handle("get-market-snapshot", () => ({
  config: marketState.config,
  activeSymbol: getActiveSymbolConfig(),
  quote: marketState.quote,
  lastAlert: marketState.lastAlert,
  error: marketState.error,
  bubbleMode: marketState.bubbleMode,
  bubbleVisible: marketState.bubbleVisible,
  focusState: marketState.focusState,
  focusSummary: getFocusSummary(),
}));

ipcMain.handle("toggle-bubble-mode", () => {
  toggleBubbleMode();
  return {
    bubbleMode: marketState.bubbleMode,
    bubbleVisible: marketState.bubbleVisible,
  };
});

ipcMain.handle("toggle-bubble-visible", () => {
  toggleBubbleVisible();
  return {
    bubbleMode: marketState.bubbleMode,
    bubbleVisible: marketState.bubbleVisible,
  };
});

app.on("before-quit", () => {
  if (monitor) {
    monitor.kill();
    monitor = null;
  }

  if (marketTimer) {
    clearInterval(marketTimer);
    marketTimer = null;
  }

  if (focusUiTimer) {
    clearInterval(focusUiTimer);
    focusUiTimer = null;
  }

  if (marketConfigWatcher) {
    marketConfigWatcher.close();
    marketConfigWatcher = null;
  }

  globalShortcut.unregisterAll();
});
