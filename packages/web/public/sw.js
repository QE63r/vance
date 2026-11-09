/* 梵境 PWA 的最小 service worker：只缓存 /app/ 壳，连不上时也能打开页面。
   实时数据永远走 WebSocket；这里不碰 /ws，也不缓存任何审批/产出。 */
const CACHE = "vance-shell-v1";

self.addEventListener("install", (event) => {
  const scope = self.registration.scope;
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          scope,
          new URL("manifest.json", scope).href,
          new URL("icons/icon-192.png", scope).href,
          new URL("icons/icon-512.png", scope).href,
          new URL("icons/icon-maskable-512.png", scope).href,
        ]),
      )
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(scope.pathname)) return;

  // 页面导航：先走网络（保证拿到最新构建），断网时回缓存壳
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(self.registration.scope)));
    return;
  }

  // 构建产物有内容哈希：缓存优先，后台顺手更新
  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const network = fetch(req)
          .then((res) => {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)));
            return res;
          })
          .catch(() => hit);
        return hit || network;
      }),
    );
  }
});
