(function () {
  "use strict";

  var CFG = window.CRYPTCO_CONFIG || {};
  var ENDPOINT = CFG.endpoint || "";
  var POLL_MS = (CFG.pollSeconds || 10) * 1000;
  var CACHE_KEY = "cryptco_prices_v1";
  var CACHE_TTL = (CFG.clientCacheSeconds || 8) * 1000;
  var timer = null;
  var inFlight = false;

  function money(v) {
    if (v == null || isNaN(v)) return "—";
    if (v >= 1) {
      return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 })
      .replace(/0+$/, "").replace(/\.$/, "");
  }

  function coinAmt(v) {
    if (v == null || isNaN(v)) return "—";
    var max = v >= 1 ? 4 : 8;
    return v.toLocaleString("en-US", { maximumFractionDigits: max });
  }

  function applyPrices(prices) {
    if (!prices) return;
    var priceNodes = document.querySelectorAll("[data-live-price]");
    for (var i = 0; i < priceNodes.length; i++) {
      var sym = priceNodes[i].getAttribute("data-live-price");
      if (prices[sym] != null) priceNodes[i].textContent = money(prices[sym]);
    }
    var resultNodes = document.querySelectorAll("[data-live-result]");
    for (var j = 0; j < resultNodes.length; j++) {
      var el = resultNodes[j];
      var s = el.getAttribute("data-symbol");
      var p = prices[s];
      if (p == null) continue;
      var amtAttr = el.getAttribute("data-amount");
      var usdAttr = el.getAttribute("data-usd");
      if (amtAttr != null) {
        el.innerHTML = money(p * parseFloat(amtAttr)) + " <small>USD</small>";
      } else if (usdAttr != null) {
        el.innerHTML = coinAmt(parseFloat(usdAttr) / p) + " <small>" + s + "</small>";
      }
    }
  }

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

  function fetchPrices() {
    if (!ENDPOINT || inFlight) return;
    var cached = readCache();
    if (cached) { applyPrices(cached); return; }
    inFlight = true;
    var url = ENDPOINT + (ENDPOINT.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now();
    fetch(url, { cache: "no-store", mode: "cors" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var prices = data && (data.prices || data);
        if (prices && typeof prices === "object") {
          applyPrices(prices);
          writeCache(prices);
        }
      })
      .catch(function () {})
      .then(function () { inFlight = false; });
  }

  function start() {
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
