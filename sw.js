/**
 * sw.js — Service Worker（离线可用）
 * 安装时预缓存站点全部本地资源 + CDN 基础库；运行期缓存优先，
 * 保证保存到手机 / 安装到手机后，断网也能全功能使用。
 */

const VERSION = 'wz2-v3';
const CACHE = 'wz2-' + VERSION;

// 站点全部本地资源（相对 sw.js 所在目录解析，可整体挪到任意子目录/域名下）
const LOCAL_ASSETS = [
    'assets/audio/campfire.mp3',
    'assets/audio/Group 1171276782.svg',
    'assets/audio/invite_exercise.mp3',
    'assets/audio/invite_sleep.mp3',
    'assets/audio/invite_study.mp3',
    'assets/audio/invite_videocall.mp3',
    'assets/audio/invite_work.mp3',
    'assets/audio/rain.mp3',
    'assets/audio/silence.mp3',
    'css/call-records.css',
    'css/cinema.css',
    'css/companion.css',
    'css/global-msg-banner.css',
    'css/music-local.css',
    'css/my-sticker-groups.css',
    'css/period.css',
    'css/shop.css',
    'css/styles.css',
    'css/survey.css',
    'css/wuziqi.css',
    'index.html',
    'js/app.js',
    'js/backup-engine.js',
    'js/cloud-media.js',
    'js/cloud-media-migration.js',
    'js/cloud-sync.js',
    'js/cloud-sync-engine.js',
    'js/cloud-sync-ui.js',
    'js/config.js',
    'js/core.js',
    'js/data.js',
    'js/features.js',
    'js/features/album.js',
    'js/features/anniversary.js',
    'js/features/app-center.js',
    'js/features/call.js',
    'js/features/call-records.js',
    'js/features/cinema.js',
    'js/features/companion.js',
    'js/features/companion-diary.js',
    'js/features/envelope.js',
    'js/features/gift-cabinet.js',
    'js/features/global-msg-banner.js',
    'js/features/group-chat.js',
    'js/features/moments.js',
    'js/features/mood.js',
    'js/features/moyu.js',
    'js/features/period.js',
    'js/features/red-packet.js',
    'js/features/reply-library.js',
    'js/features/save-to-phone.js',
    'js/features/shop.js',
    'js/features/survey.js',
    'js/features/ta-phone.js',
    'js/features/theme-editor.js',
    'js/features/voice-tts.js',
    'js/features/wuziqi.js',
    'js/games.js',
    'js/listeners.js',
    'js/listeners-step2.js',
    'js/listeners-sticker.js',
    'js/listeners-voice.js',
    'js/onboarding.js',
    'js/state.js',
    'js/utils.js',
    'manifest.json',
    'index.html',
    '',
    'sw.js',
];

// CDN 基础库（图标字体/字体文件通过解析 css 内的 url() 尽量一并预缓存）
const CDN_ASSETS = [
    'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css',
    'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600&display=swap',
];

const PRECACHE = LOCAL_ASSETS.concat(CDN_ASSETS);

// 预缓存 css 里引用的子资源（字体等）；跨域读不到文本时静默跳过
async function precacheCssFonts(url, cache) {
    try {
        const res = await fetch(url, { credentials: 'omit' });
        if (!res.ok || res.type === 'opaque') return;
        const text = await res.text();
        const urls = Array.from(text.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g), m => new URL(m[2], url).href);
        if (urls.length) {
            await Promise.allSettled(urls.map(u => cache.add(u)));
        }
    } catch (e) { /* ignore */ }
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        await Promise.allSettled(PRECACHE.map(u => cache.add(new Request(u, { credentials: 'omit' }))));
        await Promise.allSettled(CDN_ASSETS
            .filter(u => /\.css($|\?)/.test(u))
            .map(u => precacheCssFonts(u, cache)));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    // 页面导航：网络优先，断网回退到缓存的 index.html（单页应用离线可用）
    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const net = await fetch(req);
                if (net && (net.ok || net.type === 'opaque')) {
                    const copy = net.clone();
                    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
                }
                return net;
            } catch (e) {
                const cachedIndex = await caches.match('index.html');
                if (cachedIndex) return cachedIndex;
                const cached = await caches.match(req);
                return cached || Response.error();
            }
        })());
        return;
    }

    // 其它 GET：缓存优先 + 后台刷新（stale-while-revalidate），冷资源联网请求并顺手入缓存
    event.respondWith((async () => {
        const cached = await caches.match(req);
        if (cached) {
            fetch(req, { credentials: 'omit' }).then(net => {
                if (net && (net.ok || net.type === 'opaque') && net.status >= 200) {
                    caches.open(CACHE).then(c => c.put(req, net)).catch(() => {});
                }
            }).catch(() => {});
            return cached;
        }
        try {
            const net = await fetch(req, { credentials: 'omit' });
            if (net && (net.ok || net.type === 'opaque')) {
                const copy = net.clone();
                caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
            }
            return net;
        } catch (e) {
            const fallback = await caches.match(req);
            return fallback || Response.error();
        }
    })());
});