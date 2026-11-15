(function () {
  "use strict";

  var CFG = window.CRYPTCO_CONFIG || {};
  var ENDPOINT = CFG.endpoint || "";
  var POLL_MS = (CFG.pollSeconds || 10) * 1000;
  var CACHE_KEY = "cryptco_prices_v1";
  var CACHE_TTL = (CFG.clientCacheSeconds || 8) * 1000;
  var timer = null;
  var inFlight = false;

  // Prices the user typed by hand override the live feed for that coin.
  var manual = {};

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
    if (v == null || !isFinite(v)) return "—";
    var max = v >= 1 ? 4 : 8;
    return v.toLocaleString("en-US", { maximumFractionDigits: max });
  }

  function recalc(scope) {
    // scope: a card or document. Recompute every converter result within.
    var roots;
    if (scope && scope.querySelectorAll) {
      roots = scope.querySelectorAll("[data-conv-result]");
    } else {
      roots = document.querySelectorAll("[data-conv-result]");
    }
    for (var i = 0; i < roots.length; i++) {
      var result = roots[i];
      var card = result.closest(".card");
      if (!card) continue;
      var amtEl = card.querySelector("[data-conv-amount]");
      var priceEl = card.querySelector("[data-conv-price]");
      var coinSel = card.querySelector("[data-conv-coin]");
      var mode = result.getAttribute("data-mode") || "coin";
      var symbol = (coinSel && coinSel.value) || result.getAttribute("data-symbol") || "";
      var amt = num(amtEl && amtEl.value);
      var price = num(priceEl && priceEl.value);
      if (!isFinite(price) || !isFinite(amt)) {
        result.innerHTML = "—";
        continue;
      }
      if (mode === "usd") {
        var coins = price > 0 ? amt / price : NaN;
        result.innerHTML = coinAmt(coins) + " <small>" + symbol + "</small>";
      } else {
        var usd = amt * price;
        result.innerHTML = money(usd) + " <small>USD</small>";
      }
    }
  }

  function applyPrices(prices) {
    if (!prices) return;
    // Update every price input that the user hasn't manually edited.
    var inputs = document.querySelectorAll("[data-conv-price]");
    var changed = false;
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var sym = el.getAttribute("data-symbol");
      if (manual[sym]) continue; // user override wins
      if (prices[sym] != null) {
        var next = String(prices[sym]);
        if (el.value !== next) { el.value = next; changed = true; }
      }
    }
    if (changed) recalc();
  }

  // Recompute on any edit; mark price as manually overridden.
  function onInput(e) {
    var t = e.target;
    if (t && t.hasAttribute && t.hasAttribute("data-conv-price")) {
      manual[t.getAttribute("data-symbol")] = true;
    }
    if (t && t.hasAttribute && t.hasAttribute("data-conv-coin")) {
      // switching coin on the home converter: adopt live price if available
      var sym = t.value;
      var card = t.closest(".card");
      var priceEl = card && card.querySelector("[data-conv-price]");
      var result = card && card.querySelector("[data-conv-result]");
      if (priceEl) priceEl.setAttribute("data-symbol", sym);
      if (result) result.setAttribute("data-symbol", sym);
      if (priceEl && !manual[sym]) {
        var p = lastPrices[sym];
        if (p != null) priceEl.value = String(p);
      }
    }
    recalc(t && t.closest ? t.closest(".card") : null);
  }

  var lastPrices = {};

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
    applyPrices(prices);
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
        if (prices && typeof prices === "object") {
          gotPrices(prices);
          writeCache(prices);
        }
      })
      .catch(function () {})
      .then(function () { inFlight = false; });
  }

  function start() {
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    recalc();
    fetchPrices();
    if (timer) clearInterval(timer);
    timer = setInterval(fetchPrices, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") fetchPrices();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
