(function () {
  "use strict";

  var CFG = window.CRYPTCO_CONFIG || {};
  var ENDPOINT = CFG.endpoint || "";
  var POLL_MS = (CFG.pollSeconds || 10) * 1000;
  var CACHE_KEY = "cryptco_prices_v1";
  var CACHE_TTL = (CFG.clientCacheSeconds || 8) * 1000;
  var timer = null;
  var inFlight = false;
  var lastPrices = {};

  function num(v) {
    if (v == null) return NaN;
    var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return isFinite(n) ? n : NaN;
  }

  function money(v) {
    if (v == null || !isFinite(v)) return "—";
    if (v >= 1) {
      return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })
      .replace(/0+$/, "").replace(/\.$/, "");
  }

  function coinAmt(v) {
    if (v == null || !isFinite(v)) return "";
    var max = v >= 1 ? 6 : 8;
    return v.toLocaleString("en-US", { maximumFractionDigits: max, useGrouping: false });
  }

  // ---------- theme ----------
  var THEME_KEY = "cryptco_theme";
  function applyThemeLabel() {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;
    var t = document.documentElement.getAttribute("data-theme");
    btn.setAttribute("aria-pressed", t === "light" ? "true" : "false");
  }
  function currentIsDark() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    return !window.matchMedia || !window.matchMedia("(prefers-color-scheme: light)").matches;
  }
  function toggleTheme() {
    var next = currentIsDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyThemeLabel();
  }

  // ---------- converter ----------
  function toolEl() { return document.querySelector("[data-conv]"); }

  function getSymbol() {
    var tool = toolEl();
    var sel = tool && tool.querySelector("[data-conv-coin]");
    return (sel && sel.value) || (tool && tool.getAttribute("data-symbol")) || "";
  }

  function priceFor(symbol) {
    var tool = toolEl();
    var priceInput = tool && tool.querySelector("[data-conv-price]");
    if (priceInput && priceInput.getAttribute("data-override") === "1") {
      return num(priceInput.value);
    }
    var p = lastPrices[symbol];
    if (p == null) p = num(priceInput && priceInput.value);
    return p;
  }

  function updateCoinLabels(symbol, name) {
    var tool = toolEl();
    if (!tool) return;
    var labels = tool.querySelectorAll("[data-coin-label]");
    for (var i = 0; i < labels.length; i++) labels[i].textContent = symbol;
    tool.setAttribute("data-symbol", symbol);
  }

  function updateRateLine(symbol) {
    var tool = toolEl();
    if (!tool) return;
    var priceInput = tool.querySelector("[data-conv-price]");
    if (!priceInput) return;
    var p = priceFor(symbol);
    if (priceInput.getAttribute("data-override") !== "1") {
      priceInput.setAttribute("data-symbol", symbol);
      priceInput.value = (isFinite(p) && p > 0) ? String(p) : "";
    }
  }

  function recalc(source) {
    var tool = toolEl();
    if (!tool) return;
    var symbol = getSymbol();
    var coinEl = tool.querySelector("[data-conv-coin-amount]");
    var usdEl = tool.querySelector("[data-conv-usd-amount]");
    var p = priceFor(symbol);
    if (!isFinite(p) || p <= 0) return;
    if (source === "usd") {
      var usd = num(usdEl.value);
      if (isFinite(usd)) coinEl.value = coinAmt(usd / p);
    } else {
      var coin = num(coinEl.value);
      if (isFinite(coin)) usdEl.value = coinAmt(coin * p);
    }
  }

  function onCoinChange() {
    var symbol = getSymbol();
    updateCoinLabels(symbol);
    updateRateLine(symbol);
    recalc("coin");
  }

  function onInput(e) {
    var t = e.target;
    if (!t || !t.hasAttribute) return;
    if (t.hasAttribute("data-conv-price")) {
      t.setAttribute("data-override", "1");
      var sym = t.getAttribute("data-symbol");
      lastPrices[sym] = num(t.value);
      recalc("coin");
      return;
    }
    if (t.hasAttribute("data-conv-usd-amount")) { recalc("usd"); return; }
    if (t.hasAttribute("data-conv-coin-amount")) { recalc("coin"); return; }
  }

  function onSearch(e) {
    var q = (e.target.value || "").trim().toLowerCase();
    var tool = toolEl();
    var sel = tool && tool.querySelector("[data-conv-coin]");
    if (!sel) return;
    var firstMatch = null;
    for (var i = 0; i < sel.options.length; i++) {
      var opt = sel.options[i];
      var text = (opt.textContent || "").toLowerCase();
      var match = !q || text.indexOf(q) !== -1;
      opt.hidden = !match;
      if (match && !firstMatch) firstMatch = opt;
    }
    if (q && firstMatch) {
      sel.value = firstMatch.value;
      onCoinChange();
    }
  }

  // ---------- price feed ----------
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || !obj.ts || (Date.now() - obj.ts) > CACHE_TTL) return null;
      return obj.data;
    } catch (e) { return null; }
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data })); } catch (e) {}
  }
  function gotPrices(prices) {
    if (!prices || typeof prices !== "object") return;
    lastPrices = prices;
    var symbol = getSymbol();
    var tool = toolEl();
    var priceInput = tool && tool.querySelector("[data-conv-price]");
    if (priceInput && priceInput.getAttribute("data-override") !== "1") {
      updateRateLine(symbol);
      recalc("coin");
    } else {
      updateRateLine(symbol);
    }
  }
  function fetchPrices() {
    if (!ENDPOINT || inFlight) return;
    var cached = readCache();
    if (cached) { gotPrices(cached); return; }
    inFlight = true;
    var url = ENDPOINT + (ENDPOINT.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now();
    fetch(url, { cache: "no-store", mode: "cors" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var prices = data && (data.prices || data);
        if (prices && typeof prices === "object") { gotPrices(prices); writeCache(prices); }
      })
      .catch(function () {})
      .then(function () { inFlight = false; });
  }

  function init() {
    var btn = document.getElementById("themeToggle");
    if (btn) btn.addEventListener("click", toggleTheme);
    if (!window.matchMedia) applyThemeLabel();
    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) mq.addEventListener("change", applyThemeLabel);
    }
    applyThemeLabel();

    document.addEventListener("input", onInput, true);
    document.addEventListener("change", function (e) {
      var t = e.target;
      if (t && t.hasAttribute && t.hasAttribute("data-conv-coin")) onCoinChange();
    }, true);

    var search = document.getElementById("coinSearch");
    if (search) search.addEventListener("input", onSearch);

    // initialize symbol from URL pre-selection (markup already sets it)
    var sel = toolEl() && toolEl().querySelector("[data-conv-coin]");
    if (sel) {
      var wanted = toolEl().getAttribute("data-symbol");
      if (wanted) sel.value = wanted;
      updateCoinLabels(sel.value || wanted);
      updateRateLine(sel.value || wanted);
    }
    recalc("coin");
    fetchPrices();
    if (timer) clearInterval(timer);
    timer = setInterval(fetchPrices, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") fetchPrices();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
