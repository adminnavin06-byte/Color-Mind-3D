/*!
 * playables-sdk.js  -  thin, rule-enforcing wrapper around the YouTube Playables SDK (ytgame)
 *
 * Load order in index.html (SDK first, as the certification requires):
 *   <script src="https://www.youtube.com/game_api/v1"></script>
 *   <script src="playables-sdk.js"></script>
 *   ...game code...
 *
 * What it guarantees (from the Playables certification requirements):
 *  - Safe no-op outside YouTube (local testing): in-memory save only; no browser storage is ever used.
 *  - firstFrameReady() before gameReady(), each called at most once.
 *  - saveData() is never sent before loadData() has settled (it is queued, latest wins); data is
 *    validated (string, well-formed UTF-16, <= 3 MiB) before it is sent.
 *  - No Page Visibility API, no navigator.language, no network calls, no eval/workers/wasm.
 *  - Language comes only from ytgame.system.getLanguage().
 *  - sendScore() always sends a non-negative safe integer.
 */
(function (g) {
  'use strict';
  var raw = (typeof g.ytgame === 'object' && g.ytgame && g.ytgame.IN_PLAYABLES_ENV) ? g.ytgame : null;
  var MAX_SAVE_BYTES = 3 * 1024 * 1024;
  var st = { first: false, ready: false, loaded: !raw, pending: null, mem: null };

  function safe(fn, dflt) { try { return fn(); } catch (e) { return dflt; } }
  function noop() {}
  function byteLength(s) { return safe(function () { return new TextEncoder().encode(s).length; }, s.length * 3); }
  function valid(s) {
    return typeof s === 'string' && (!s.isWellFormed || s.isWellFormed()) && byteLength(s) <= MAX_SAVE_BYTES;
  }

  function flush() {
    st.loaded = true;
    if (st.pending !== null) { var p = st.pending; st.pending = null; api.saveData(p); }
  }

  var api = {
    version: '1.0.0',
    /** true only when running inside YouTube Playables */
    inPlayables: !!raw,

    /** Call while a loading/splash screen that says "loading" is visible. */
    firstFrameReady: function () {
      if (st.first) return; st.first = true;
      if (raw) safe(function () { raw.game.firstFrameReady(); });
    },
    /** Call only once the game is interactive (title/menu shown, loading screen gone). */
    gameReady: function () {
      if (st.ready) return;
      if (!st.first) api.firstFrameReady();
      st.ready = true;
      if (raw) safe(function () { raw.game.gameReady(); });
    },

    /**
     * Load saved progress. Always resolves to a string ('' if nothing / failure).
     * opts: { timeoutMs:6000, onLate:function(str) }
     * If the cloud load is slower than timeoutMs the game may start; onLate gets the data later.
     */
    loadData: function (opts) {
      opts = opts || {};
      if (!raw) { st.loaded = true; return Promise.resolve(typeof st.mem === 'string' ? st.mem : ''); }
      var lp = Promise.resolve().then(function () { return raw.game.loadData(); });
      var timedOut = false;
      var timeout = new Promise(function (res) { setTimeout(function () { timedOut = true; res(''); }, opts.timeoutMs || 6000); });
      return Promise.race([lp.then(function (v) { return typeof v === 'string' ? v : ''; }, function () { return ''; }), timeout]).then(function (v) {
        if (timedOut) {
          lp.then(function (late) { if (typeof late === 'string' && opts.onLate) safe(function () { opts.onLate(late); }); flush(); }, flush);
        } else { flush(); }
        return v;
      });
    },

    /** Save progress. Returns a Promise<boolean> (false = queued/invalid/failed). */
    saveData: function (str) {
      if (!valid(str)) return Promise.resolve(false);
      if (!raw) { st.mem = str; return Promise.resolve(true); }
      if (!st.loaded) { st.pending = str; return Promise.resolve(false); }
      return Promise.resolve().then(function () { return raw.game.saveData(str); }).then(function () { return true; }, function () { return false; });
    },

    /** BCP-47 tag from YouTube (e.g. "hi-IN"), or null outside Playables. */
    getLanguage: function () {
      if (!raw) return Promise.resolve(null);
      return Promise.resolve().then(function () { return raw.system.getLanguage(); }).then(function (l) { return l ? String(l) : null; }, function () { return null; });
    },

    /** YouTube mute state. Game audio MUST be silent when this is false. */
    isAudioEnabled: function () { return raw ? safe(function () { return raw.system.isAudioEnabled() !== false; }, true) : true; },
    onAudioChange: function (cb) { return raw ? safe(function () { return raw.system.onAudioEnabledChange(function (v) { cb(v !== false); }); }, noop) : noop; },
    /** Pause everything (loop, music, input, timers) until onResume. Save progress here. */
    onPause: function (cb) { return raw ? safe(function () { return raw.system.onPause(cb); }, noop) : noop; },
    onResume: function (cb) { return raw ? safe(function () { return raw.system.onResume(cb); }, noop) : noop; },

    /** Send the player's BEST score (must equal the best score stored in the save). */
    sendScore: function (n) {
      n = Math.floor(Number(n));
      if (!isFinite(n) || n < 0) return Promise.resolve(false);
      n = Math.min(n, Number.MAX_SAFE_INTEGER);
      if (!raw) return Promise.resolve(false);
      return Promise.resolve().then(function () { return raw.engagement.sendScore({ value: n }); }).then(function () { return true; }, function () { return false; });
    },

    logError: function () { if (raw) safe(function () { raw.health.logError(); }); },
    logWarning: function () { if (raw) safe(function () { raw.health.logWarning(); }); }
  };

  g.PlayablesSDK = api;
})(window);
