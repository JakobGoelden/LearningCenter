/*
 * LearningCenter service worker: the installed app keeps working offline.
 *
 * Plain script, no build step (public/ is copied into dist/ as is). Which
 * request is handled how lives in sw-policy.js (pure functions, unit-tested);
 * this file wires it to the Cache API. Registered by src/pwa/register.ts in
 * production builds only.
 *
 * - The page: network first (3 s), else the cached copy. A new page is only
 *   kept once all build files it references are cached, so the offline copy
 *   is always a complete app.
 * - Build files (assets/, hashed): cache first; lazily loaded ones (SQL engine,
 *   KaTeX fonts) are cached when first fetched.
 * - Pack files (GET /__lc/fs/read|list|mtime|info): network first (4 s), else
 *   the offline copy. Login redirects and errors are passed through, never
 *   stored. After a successful write/append/remove/events POST the offline copy
 *   is brought to the written state, so it never serves what was overwritten.
 * - A write to pack.json, subjects/ or dojos/ whose content the app got from
 *   the offline copy (not the server) is checked first: if the server has a different version, the write
 *   is refused with 409 instead of overwriting changes made elsewhere.
 */
/* global LcSwPolicy */
// Change this line whenever sw-policy.js changes, so every browser notices the
// update (not all compare imported scripts).
var VERSION = '2026-11-12.3';
importScripts('sw-policy.js?v=' + VERSION);

var P = self.LcSwPolicy;
var C = P.CACHES;
var ORIGIN = self.location.origin;
var SCOPE = self.registration.scope; // e.g. https://learn.goelden.dev/
var SHELL_KEY = SCOPE;

var STALE_MESSAGE =
  'This file changed on the server since the app loaded it from the offline copy. Reload the app, then try again.';
var SESSION_MESSAGE = 'Not logged in any more (the session expired). Reload the app and log in, then try again.';

// ---------------------------------------------------------------------------
// Bookkeeping against races between reads and writes of the same file.

/** Bumped for a cache key whenever a write may change its answer; a read only stores its answer if unchanged. */
var generations = new Map();
function generation(key) {
  return generations.get(key) || 0;
}
function bump(keys) {
  for (var k in keys) generations.set(keys[k], generation(keys[k]) + 1);
}
/** Puts of read answers in flight; a write waits for them, so its own put lands last. */
var pendingPuts = new Set();
function track(promise) {
  var p = promise.catch(function () {});
  pendingPuts.add(p);
  p.then(function () {
    pendingPuts.delete(p);
  });
  return promise;
}

/** Marks a file whose content was served from the offline copy, with what was served. */
function markKey(path) {
  return ORIGIN + '/__lc-sw/served-offline?path=' + encodeURIComponent(path);
}
function setMark(path, status, text, gen) {
  return caches.open(C.meta).then(function (meta) {
    // A write to the file since it was served settled the question.
    if (generation(P.dataKey(ORIGIN, 'read', path)) !== gen) return;
    return meta.put(
      markKey(path),
      new Response(JSON.stringify({ status: status, text: text }), { headers: { 'content-type': 'application/json' } }),
    );
  });
}
function clearMark(path) {
  return caches.open(C.meta).then(function (meta) {
    return meta.delete(markKey(path));
  });
}

function info(res) {
  return { status: res.status, redirected: res.redirected, type: res.type, contentType: res.headers.get('content-type') };
}
function textResponse(text, status, type) {
  return new Response(text, { status: status || 200, headers: { 'content-type': type || 'text/plain; charset=utf-8' } });
}
/**
 * The answer from the offline copy, marked as such (FROM_CACHE_HEADER in
 * src/storage/dev-fs.ts), so the app treats its content as possibly old and
 * does not take the times it read as the server's.
 */
function fromCopy(res) {
  var headers = new Headers(res.headers);
  headers.set('x-lc-offline-copy', '1');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: headers });
}

function isRedirect(res) {
  return res.redirected || res.type === 'opaqueredirect';
}

function delay(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Network first: the network answer if it comes within `ms` and is not a
 * server error (5xx); else the cached answer if there is one; else whatever
 * the network gives in the end. Resolves to {res, fromCache, settled}, where
 * `settled` resolves to the network answer ({res} or {err}) when it arrives.
 */
async function networkFirst(network, ms, cachedPromise) {
  var settled = network.then(
    function (res) {
      return { res: res };
    },
    function (err) {
      return { err: err };
    },
  );
  var first = await Promise.race([settled, delay(ms).then(function () {
    return null;
  })]);
  if (first && first.res && first.res.status < 500) return { res: first.res, fromCache: false, settled: settled };
  var cached = await cachedPromise;
  if (cached) return { res: cached, fromCache: true, settled: settled };
  var outcome = first || (await settled);
  if (outcome.err) throw outcome.err;
  return { res: outcome.res, fromCache: false, settled: settled };
}

// ---------------------------------------------------------------------------
// Install, activate

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(precache().catch(function () {}));
});

self.addEventListener('activate', function (event) {
  var keep = Object.keys(C).map(function (k) {
    return C[k];
  });
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (n) {
              return n.indexOf('lc-') === 0 && keep.indexOf(n) < 0;
            })
            .map(function (n) {
              return caches.delete(n);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

/** Caches the page, its build files and the static files, so a fresh install works offline at once. */
async function precache() {
  var jobs = P.STATIC_FILES.map(function (rel) {
    var url = new URL(rel, SCOPE).href;
    return fetch(url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(function (res) {
        if (!P.isStorableShell(info(res))) return;
        return caches.open(C.shell).then(function (c) {
          return c.put(url, res);
        });
      })
      .catch(function () {});
  });
  // The page asked for this before the worker was in charge; offline start-up needs it.
  var infoKey = P.dataKey(ORIGIN, 'info', '');
  jobs.push(
    fetch(infoKey, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (res) {
        if (!P.isStorableData(info(res), 'info', '')) return;
        return caches.open(C.data).then(function (c) {
          return c.put(infoKey, res);
        });
      })
      .catch(function () {}),
  );
  var page = await fetch(SHELL_KEY, { cache: 'no-cache', credentials: 'same-origin' });
  if (P.isStorableShell(info(page)) && isHtml(page)) jobs.push(commitShell(page));
  await Promise.all(jobs);
}

function isHtml(res) {
  return (res.headers.get('content-type') || '').toLowerCase().indexOf('text/html') >= 0;
}

/**
 * Keeps `res` (the page) as the offline page once every build file it needs
 * is cached; then drops build files only the previous page needed. Throws
 * (and keeps the previous page) when a script or stylesheet cannot be fetched.
 */
async function commitShell(res) {
  var html = await res.text();
  var shell = await caches.open(C.shell);
  var assets = await caches.open(C.assets);
  var wanted = await shellAssets(html, assets, true);
  var old = await shell.match(SHELL_KEY);
  var oldHtml = old ? await old.text() : null;
  if (oldHtml === html) return;
  await shell.put(SHELL_KEY, textResponse(html, 200, 'text/html; charset=utf-8'));
  if (oldHtml === null) return;
  var before = await shellAssets(oldHtml, assets, false);
  await Promise.all(
    before
      .filter(function (url) {
        return wanted.indexOf(url) < 0;
      })
      .map(function (url) {
        return assets.delete(url);
      }),
  );
}

/** Build files a page needs (scripts, stylesheets, fonts of the stylesheets); fetches missing ones if `fetchMissing`. */
async function shellAssets(html, assets, fetchMissing) {
  var urls = P.assetUrlsFromHtml(html, SCOPE, SCOPE);
  var all = urls.slice();
  for (var i = 0; i < urls.length; i++) {
    var res = await cachedAsset(assets, urls[i], fetchMissing, true);
    if (!res || !/\.css$/i.test(new URL(urls[i]).pathname)) continue;
    var fonts = P.fontUrlsFromCss(await res.text(), urls[i], SCOPE);
    for (var f = 0; f < fonts.length; f++) if (all.indexOf(fonts[f]) < 0) all.push(fonts[f]);
    // Fonts are a nice-to-have: a failure does not block the page.
    await Promise.all(
      fonts.map(function (url) {
        return cachedAsset(assets, url, fetchMissing, false);
      }),
    );
  }
  return all;
}

async function cachedAsset(assets, url, fetchMissing, required) {
  var hit = await assets.match(url);
  if (hit || !fetchMissing) return hit;
  try {
    var res = await fetch(url, { credentials: 'same-origin' });
    if (!P.isStorableShell(info(res))) throw new Error('cannot cache ' + url + ': ' + res.status);
    await assets.put(url, res.clone());
    return res;
  } catch (e) {
    if (required) throw e;
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Fetch

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  var cls;
  try {
    cls = P.classify(req.url, req.method, req.mode, SCOPE);
  } catch (e) {
    return;
  }
  switch (cls.kind) {
    case 'shell':
      return handleShell(event);
    case 'asset':
      return event.respondWith(handleAsset(event));
    case 'static':
      return handleStatic(event);
    case 'data':
      return handleData(event, cls);
    case 'raw':
      return event.respondWith(handleRaw(event, cls));
    case 'mutation':
    case 'events':
      return event.respondWith(handleMutation(event, cls));
    default:
      return; // the browser handles it
  }
});

function handleShell(event) {
  var network = fetch(event.request);
  var bg = network
    .then(function (res) {
      if (P.isStorableShell(info(res)) && isHtml(res)) return commitShell(res.clone());
    })
    .catch(function () {});
  event.waitUntil(bg);
  var cached = caches.open(C.shell).then(function (c) {
    return c.match(SHELL_KEY);
  });
  event.respondWith(
    networkFirst(network, P.TIMEOUTS.shell, cached).then(function (r) {
      return r.res;
    }),
  );
}

async function handleAsset(event) {
  var assets = await caches.open(C.assets);
  var hit = await assets.match(event.request.url);
  if (hit) return hit;
  var res = await fetch(event.request);
  if (P.isStorableShell(info(res))) event.waitUntil(assets.put(event.request.url, res.clone()).catch(function () {}));
  return res;
}

function handleStatic(event) {
  var url = event.request.url.split('?')[0].split('#')[0];
  var network = fetch(event.request);
  event.waitUntil(
    network
      .then(function (res) {
        if (!P.isStorableShell(info(res))) return;
        var copy = res.clone();
        return caches.open(C.shell).then(function (c) {
          return c.put(url, copy);
        });
      })
      .catch(function () {}),
  );
  var cached = caches.open(C.shell).then(function (c) {
    return c.match(url);
  });
  event.respondWith(
    networkFirst(network, P.TIMEOUTS.shell, cached).then(function (r) {
      return r.res;
    }),
  );
}

function handleData(event, cls) {
  var key = P.dataKey(ORIGIN, cls.op, cls.path);
  var startGen = generation(key);
  var isRead = cls.op === 'read';
  var network = fetch(event.request);
  // Registered first, so the answer is cloned before the page reads it.
  var stored = network.then(
    function (res) {
      if (!P.isStorableData(info(res), cls.op, cls.path)) return null;
      var forCache = res.clone();
      var forText = isRead ? res.clone() : null;
      return caches.open(C.data).then(function (data) {
        if (generation(key) !== startGen) return null; // a write to this file happened meanwhile
        return track(data.put(key, forCache)).then(function () {
          return forText
            ? forText.text().then(function (text) {
                return { status: res.status, text: text };
              })
            : { status: res.status, text: null };
        });
      });
    },
    function () {
      return null;
    },
  ).catch(function () {
    return null; // e.g. storage full: the answer still reaches the app
  });
  var cached = caches.open(C.data).then(function (c) {
    return c.match(key);
  });
  var done;
  var bg = new Promise(function (resolve) {
    done = resolve;
  });
  event.waitUntil(bg);
  event.respondWith(
    networkFirst(network, P.TIMEOUTS.data, cached).then(
      function (r) {
        if (!isRead) {
          done(stored);
          return r.fromCache ? fromCopy(r.res) : r.res;
        }
        if (!r.fromCache) {
          // The app now has the server's version of the file.
          var fresh = P.isStorableData(info(r.res), cls.op, cls.path);
          done(Promise.all([stored, fresh ? clearMark(cls.path).catch(function () {}) : null]));
          return r.res;
        }
        // Served from the offline copy: remember what the app got. If the
        // network answers later with the same content, the mark goes again.
        var served = r.res.clone();
        var answer = fromCopy(r.res);
        var marked = served.text().then(function (text) {
          return setMark(cls.path, r.res.status, r.res.status === 404 ? null : text, startGen).then(function () {
            return { status: r.res.status, text: r.res.status === 404 ? null : text };
          });
        });
        done(
          Promise.all([marked, stored])
            .then(function (both) {
              var was = both[0];
              var now = both[1];
              if (!now) return;
              var nowText = now.status === 404 ? null : now.text;
              if (nowText === was.text) return clearMark(cls.path);
            })
            .catch(function () {}),
        );
        return answer;
      },
      function (err) {
        done();
        throw err;
      },
    ),
  );
}

async function handleRaw(event, cls) {
  var key = P.dataKey(ORIGIN, 'raw', cls.path);
  var files = await caches.open(C.files);
  var cached = await files.match(key);
  if (!cached) return fetch(event.request);
  var r = await networkFirst(fetch(event.request), P.TIMEOUTS.raw, Promise.resolve(cached));
  return r.res;
}

async function handleMutation(event, cls) {
  var req = event.request;
  var path = cls.path;
  var body = await req.clone().text();
  var keys = P.affectedKeys(ORIGIN, path);
  if (cls.op === 'write' && P.guardsWrites(path)) {
    var refusal = await guardWrite(path);
    if (refusal) return refusal;
  }
  bump(keys);
  var res;
  try {
    res = await fetch(req);
  } finally {
    bump(keys);
  }
  // A redirect (to the login page) means nothing was written, although the
  // final page says 200: tell the app instead of letting it count as saved.
  if (isRedirect(res)) return textResponse(SESSION_MESSAGE, 401);
  if (res.ok) {
    await applyMutation(cls, body, keys).catch(function () {
      return dropKeys(keys);
    });
  } else if (res.status >= 500) {
    // Maybe written in part: do not trust the offline copy of this file.
    await dropKeys(keys).catch(function () {});
  }
  return res;
}

/**
 * Before writing a file the app got from the offline copy: compare that copy
 * with the server's version. Returns a refusal (Response) or null to go on.
 */
async function guardWrite(path) {
  var meta = await caches.open(C.meta);
  var mark = await meta.match(markKey(path));
  if (!mark) return null;
  var served = await mark.json();
  var readKey = P.dataKey(ORIGIN, 'read', path);
  var startGen = generation(readKey);
  var fresh = await fetch(readKey, { cache: 'no-store', credentials: 'same-origin' }); // offline: rejects like the write would
  if (isRedirect(fresh)) return textResponse(SESSION_MESSAGE, 401);
  if (fresh.status !== 200 && fresh.status !== 404) {
    return textResponse('Could not check whether the file changed on the server (' + fresh.status + '). Try again.', 503);
  }
  var text = fresh.status === 404 ? null : await fresh.clone().text();
  var servedText = served.status === 404 ? null : served.text;
  if (text === servedText) {
    await meta.delete(markKey(path));
    return null;
  }
  if (P.isStorableData(info(fresh), 'read', path)) {
    var data = await caches.open(C.data);
    if (generation(readKey) === startGen) await track(data.put(readKey, fresh));
  }
  return textResponse(STALE_MESSAGE, 409);
}

/** Brings the offline copy to the state after a successful change of `cls.path`. */
async function applyMutation(cls, body, keys) {
  await Promise.all(Array.from(pendingPuts));
  var data = await caches.open(C.data);
  var files = await caches.open(C.files);
  var name = P.baseOf(cls.path);
  await data.delete(keys.mtime);
  await files.delete(keys.raw);
  if (cls.op === 'write') {
    await data.put(keys.read, textResponse(body));
    await clearMark(cls.path);
    await updateList(data, keys.list, name, true);
  } else if (cls.op === 'remove') {
    await data.put(keys.read, textResponse('not found', 404));
    await clearMark(cls.path);
    await updateList(data, keys.list, name, false);
  } else {
    // append, events: extend the cached copy if there is one.
    var cached = await data.match(keys.read);
    if (cached) {
      var before = cached.status === 404 ? '' : await cached.text();
      var after = cls.kind === 'events' ? P.logWithEvents(before, body) : before + body;
      if (after === null) await data.delete(keys.read);
      else await data.put(keys.read, textResponse(after));
    }
    await updateList(data, keys.list, name, true);
  }
}

async function updateList(data, key, name, add) {
  var cached = await data.match(key);
  if (!cached) return;
  if (cached.status === 404) {
    if (add) await data.put(key, textResponse(JSON.stringify([name]), 200, 'application/json'));
    return;
  }
  var json = await cached.text();
  var next = add ? P.listWith(json, name) : P.listWithout(json, name);
  if (next === null) await data.delete(key);
  else await data.put(key, textResponse(next, 200, 'application/json'));
}

async function dropKeys(keys) {
  var data = await caches.open(C.data);
  await Promise.all([data.delete(keys.read), data.delete(keys.mtime), data.delete(keys.list)]);
}
