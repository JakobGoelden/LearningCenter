/*
 * Caching policy of the service worker (public/sw.js): pure functions, no
 * browser APIs. Loaded by sw.js with importScripts() and by tests/pwa.test.ts,
 * so the code that runs is the code that is tested. Plain script, no build
 * step: it puts its API on `self.LcSwPolicy` (globalThis in tests).
 */
(function (root) {
  'use strict';

  // Bump SHELL/ASSETS only when their content format changes. DATA holds the
  // learner's offline copy of the pack: bumping it wipes that copy.
  var CACHES = {
    shell: 'lc-shell-v1', // index.html (under the scope URL), manifest, icons
    assets: 'lc-assets-v1', // hashed build files in assets/ (immutable)
    data: 'lc-data-v1', // GET /__lc/fs/{read,list,mtime,info} answers
    files: 'lc-files-v1', // /__lc/fs/raw copies (PDFs), filled only on request ("available offline", later)
    meta: 'lc-meta-v1', // bookkeeping: which files were served from the offline copy
  };

  var TIMEOUTS = { shell: 3000, data: 4000, raw: 4000 };
  var EVENTS_PATH = 'log/events.jsonl';

  var DATA_OPS = ['read', 'list', 'mtime', 'info'];
  var MUTATION_OPS = ['write', 'append', 'remove'];
  /** Static files from public/ (besides the page), relative to the scope. */
  var STATIC_FILES = [
    'manifest.webmanifest',
    'icons/icon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-192.png',
    'icons/icon-maskable-512.png',
    'icons/apple-touch-icon.png',
  ];
  /** Never handled by the service worker: login, session, admin, AI API. */
  var BYPASS_PREFIXES = ['/__lc/login', '/__lc/logout', '/__lc/join', '/__lc/session', '/__lc/admin', '/api/'];

  function startsWithAny(path, prefixes) {
    for (var i = 0; i < prefixes.length; i++) if (path.indexOf(prefixes[i]) === 0) return true;
    return false;
  }

  /**
   * What the service worker does with a request:
   * - shell: the app page (navigation to the scope or index.html): network first, cached copy as fallback
   * - asset: hashed build file: cache first
   * - static: manifest and icons: network first, cached copy as fallback
   * - data: GET /__lc/fs/{read,list,mtime,info}: network first, offline copy as fallback
   * - raw: GET /__lc/fs/raw: network; an offline copy only if one was stored on purpose
   * - mutation: POST /__lc/fs/{write,append,remove}: network, then the offline copy is brought up to date
   * - events: POST /__lc/events: network, then the offline copy of the log is brought up to date
   * - bypass: not touched (the browser handles it as if there were no service worker)
   * `op` and `path` are set for data, raw and mutation.
   */
  function classify(url, method, mode, scope) {
    var u = new URL(url);
    var s = new URL(scope);
    if (u.origin !== s.origin) return { kind: 'bypass' };
    var p = u.pathname;
    if (startsWithAny(p, BYPASS_PREFIXES)) return { kind: 'bypass' };
    if (p.indexOf('/__lc/fs/') === 0) {
      var op = p.slice('/__lc/fs/'.length);
      var path = u.searchParams.get('path');
      if (path === null && op !== 'info') return { kind: 'bypass' };
      if (method === 'GET' && op === 'raw') return { kind: 'raw', op: op, path: path };
      if (method === 'GET' && DATA_OPS.indexOf(op) >= 0) return { kind: 'data', op: op, path: path || '' };
      if (method === 'POST' && MUTATION_OPS.indexOf(op) >= 0) return { kind: 'mutation', op: op, path: path };
      return { kind: 'bypass' };
    }
    if (p === '/__lc/events') return method === 'POST' ? { kind: 'events', path: EVENTS_PATH } : { kind: 'bypass' };
    if (p.indexOf('/__lc/') === 0) return { kind: 'bypass' };
    if (method !== 'GET') return { kind: 'bypass' };
    if (p.indexOf(s.pathname) !== 0) return { kind: 'bypass' };
    var rel = p.slice(s.pathname.length);
    if (mode === 'navigate') return rel === '' || rel === 'index.html' ? { kind: 'shell' } : { kind: 'bypass' };
    if (rel.indexOf('assets/') === 0) return { kind: 'asset' };
    if (STATIC_FILES.indexOf(rel) >= 0) return { kind: 'static' };
    return { kind: 'bypass' };
  }

  /** One cache key per file and operation, however the app spelled the URL. */
  function dataKey(origin, op, path) {
    if (op === 'info') return origin + '/__lc/fs/info';
    return origin + '/__lc/fs/' + op + '?path=' + encodeURIComponent(path || '');
  }

  function dirOf(path) {
    var i = path.lastIndexOf('/');
    return i < 0 ? '' : path.slice(0, i);
  }
  function baseOf(path) {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  /**
   * Files that others change too (the sync job pulls cards into subjects and
   * dojos, other devices edit the pack): a write to one of them is checked
   * against the server when the app got the file from the offline copy.
   * Files only this device writes (sessions/, work/, the log) are not checked,
   * so writes queued while offline go through.
   */
  function guardsWrites(path) {
    return path === 'pack.json' || /^(subjects|dojos)\/[^/]+\.json$/.test(path);
  }

  /** Cache keys whose answers a change to `path` makes stale. */
  function affectedKeys(origin, path) {
    return {
      read: dataKey(origin, 'read', path),
      mtime: dataKey(origin, 'mtime', path),
      raw: dataKey(origin, 'raw', path),
      list: dataKey(origin, 'list', dirOf(path)),
    };
  }

  /**
   * Whether an answer to a data request is the file API's own answer and may
   * be stored. `res` = {status, redirected, type, contentType}. Not stored:
   * redirects (e.g. to the login page when the session expired), opaque
   * answers, errors, and HTML where the API never sends HTML. A 404 from
   * read/list/mtime is stored: it means "no such file", which the app needs
   * offline too (optional files).
   */
  function isStorableData(res, op, path) {
    if (res.redirected) return false;
    if (res.type === 'opaque' || res.type === 'opaqueredirect' || res.type === 'error') return false;
    var okStatus = res.status === 200 || (res.status === 404 && op !== 'info');
    if (!okStatus) return false;
    var ct = (res.contentType || '').toLowerCase();
    if (op === 'info') return ct.indexOf('json') >= 0;
    if (ct.indexOf('text/html') >= 0 && !/\.html?$/i.test(path || '')) return false;
    return true;
  }

  /** Whether a navigation/static/asset answer may be stored. */
  function isStorableShell(res) {
    if (res.redirected) return false;
    if (res.type === 'opaque' || res.type === 'opaqueredirect' || res.type === 'error') return false;
    return res.status === 200;
  }

  /** Build files a page references: script src, link href, under <scope>assets/. */
  function assetUrlsFromHtml(html, pageUrl, scope) {
    var out = [];
    var re = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    var m;
    while ((m = re.exec(html))) addAsset(out, m[1], pageUrl, scope);
    return out;
  }

  /** Fonts a stylesheet references (woff2 only: what current browsers load). */
  function fontUrlsFromCss(css, cssUrl, scope) {
    var out = [];
    var re = /url\(\s*["']?([^"')]+?\.woff2)(?:[?#][^"')]*)?["']?\s*\)/gi;
    var m;
    while ((m = re.exec(css))) addAsset(out, m[1], cssUrl, scope);
    return out;
  }

  function addAsset(out, ref, base, scope) {
    var u;
    try {
      u = new URL(ref, base);
    } catch (e) {
      return;
    }
    u.hash = '';
    var prefix = new URL('assets/', scope).href;
    if (u.href.indexOf(prefix) === 0 && out.indexOf(u.href) < 0) out.push(u.href);
  }

  /** A cached directory listing with `name` added (null if the listing is not usable). */
  function listWith(json, name) {
    var names = parseList(json);
    if (!names) return null;
    if (names.indexOf(name) < 0) names.push(name);
    return JSON.stringify(names.sort());
  }
  function listWithout(json, name) {
    var names = parseList(json);
    if (!names) return null;
    return JSON.stringify(
      names.filter(function (n) {
        return n !== name;
      }),
    );
  }
  function parseList(json) {
    try {
      var v = JSON.parse(json);
      if (!Array.isArray(v)) return null;
      for (var i = 0; i < v.length; i++) if (typeof v[i] !== 'string') return null;
      return v.slice();
    } catch (e) {
      return null;
    }
  }

  /**
   * The log after POST /__lc/events, like the server does it: events whose id
   * the log already has are skipped, the rest appended as JSON lines. Returns
   * null when the body cannot be read (then the cached log is dropped).
   */
  function logWithEvents(text, body) {
    var events;
    try {
      events = JSON.parse(body).events;
    } catch (e) {
      return null;
    }
    if (!Array.isArray(events)) return null;
    var known = {};
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('"id"') < 0) continue;
      try {
        var id = JSON.parse(lines[i]).id;
        if (typeof id === 'string') known[id] = true;
      } catch (e) {
        /* broken line */
      }
    }
    var out = '';
    for (var j = 0; j < events.length; j++) {
      var ev = events[j];
      if (!ev || typeof ev.id !== 'string') return null;
      if (known[ev.id]) continue;
      known[ev.id] = true;
      out += JSON.stringify(ev) + '\n';
    }
    if (!out) return text;
    return text + (text && text.charAt(text.length - 1) !== '\n' ? '\n' : '') + out;
  }

  root.LcSwPolicy = {
    CACHES: CACHES,
    TIMEOUTS: TIMEOUTS,
    STATIC_FILES: STATIC_FILES,
    EVENTS_PATH: EVENTS_PATH,
    classify: classify,
    dataKey: dataKey,
    dirOf: dirOf,
    baseOf: baseOf,
    affectedKeys: affectedKeys,
    guardsWrites: guardsWrites,
    isStorableData: isStorableData,
    isStorableShell: isStorableShell,
    assetUrlsFromHtml: assetUrlsFromHtml,
    fontUrlsFromCss: fontUrlsFromCss,
    listWith: listWith,
    listWithout: listWithout,
    logWithEvents: logWithEvents,
  };
})(typeof self !== 'undefined' ? self : globalThis);
