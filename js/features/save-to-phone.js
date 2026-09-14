/**
 * save-to-phone.js — 保存到手机（PWA 安装 / 创建快捷方式）+ 改网站名
 * 参考 wz/manifest.json 的 PWA 方案：
 *   · 保存到手机/安装网站：浏览器自带 beforeinstallprompt（安装）/ iOS 添加到主屏幕（快捷方式）
 *   · 可更改网站名字：同步到 document.title、启动页标题、manifest 应用名、下载后安装显示名
 *   · 离线全功能：sw.js 预缓存全部本地资源 + CDN 基础库，安装后断网也能用
 * 依赖：settings（全局）、saveData（core.js）、showNotification、JSZip（可选）
 */

(function () {
    'use strict';

    const DEFAULT_NAME = '传讯';
    const ICON_URL = 'https://file.youtochat.com/images/20260216/1771224856844_qdqqd.jpeg';

    let deferredPrompt = null;   // beforeinstallprompt 抓取的安装入口
    let manifestBlobUrl = null; // 动态生成的 manifest（blob），用于写入新名字

    // ─── 小工具 ────────────────────────────────────────────────────────────

    function getSettings() {
        return (typeof settings !== 'undefined' && settings) || window.settings || {};
    }

    function getStoreName() {
        // 优先从 localStorage 读取（改名时同步写入，刷新最可靠），
        // 其次才读 settings.siteName（localforage 持久化，可能有加载时序问题）
        let v = null;
        try { v = localStorage.getItem('siteName'); } catch (e) {}
        if (!v || typeof v !== 'string' || !v.trim()) {
            const s = getSettings();
            v = s.siteName;
        }
        return (typeof v === 'string' && v.trim()) ? v.trim() : DEFAULT_NAME;
    }

    function isStandalone() {
        return (typeof window.navigator !== 'undefined' && window.navigator.standalone === true) ||
            (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
    }

    function isIOS() {
        return /iphone|ipad|ipod/i.test(window.navigator?.userAgent || '') ||
            (typeof window.navigator !== 'undefined' && window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    }

    function supportsSw() {
        return 'serviceWorker' in navigator && /^https?:$/.test(location.protocol);
    }

    function notify(msg, type) {
        try { if (typeof window.showNotification === 'function') window.showNotification(msg, type || 'info'); } catch (e) {}
    }

    // ─── 应用网站名字到各处 ────────────────────────────────────────────────

    function applySiteName(name) {
        name = (name || DEFAULT_NAME).trim() || DEFAULT_NAME;

        document.title = name;

        const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
        if (appleTitle) appleTitle.setAttribute('content', name.slice(0, 20));

        const desc = document.querySelector('meta[name="description"]');
        if (desc) desc.setAttribute('content', '你们专属的私密空间 · ' + name);

        // 注：启动页大字属于可自定义的开场动画（customIntros），不在此覆盖；
        // 未配置开场动画时，加载页标题会走 core.js 回退逻辑显示该名字。
        applyManifestName(name);
    }

    function applyManifestName(name) {
        const link = document.getElementById('app-manifest-link');
        if (!link) return;
        try {
            if (manifestBlobUrl) URL.revokeObjectURL(manifestBlobUrl);
            const m = {
                name: name,
                short_name: name.slice(0, 12),
                description: '你们专属的私密空间 · ' + name,
                start_url: './',
                scope: './',
                display: 'standalone',
                orientation: 'portrait',
                background_color: '#000000',
                theme_color: '#000000',
                icons: [
                    { src: ICON_URL, sizes: '192x192', type: 'image/jpeg', purpose: 'any' },
                    { src: ICON_URL, sizes: '512x512', type: 'image/jpeg', purpose: 'any' }
                ]
            };
            manifestBlobUrl = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/manifest+json' }));
            link.href = manifestBlobUrl;
        } catch (e) {
            console.warn('[save-to-phone] manifest 动态生成失败，回退静态 manifest.json', e);
        }
    }

    // ─── 保存名字 ──────────────────────────────────────────────────────────

    function saveSiteName(name) {
        name = (name || '').trim();
        if (!name) { notify('网站名字不能为空', 'error'); return; }
        if (name.length > 20) name = name.slice(0, 20);

        const s = getSettings();
        s.siteName = name;

        applySiteName(name);

        // 双写：localStorage 直存（刷新立即可读，不依赖 settings 加载时序）+ settings 持久化
        try { localStorage.setItem('siteName', name); } catch (e) {}
        try { if (typeof saveData === 'function') saveData(); } catch (e) { console.warn('[save-to-phone] 保存设置失败', e); }

        const input = document.getElementById('stp-name-input');
        if (input) input.value = name;

        // 已安装的情况下，主屏幕名字可能要下次重装才生效——提醒一下
        if (isStandalone()) {
            notify('网站名字已更新为「' + name + '」，已安装图标名字可能需重新保存到手机后生效', 'info');
        }
    }

    // ─── 安装状态 / 触发安装 ───────────────────────────────────────────────

    function renderStatus() {
        const el = document.getElementById('stp-status');
        const swEl = document.getElementById('stp-sw-status');
        const installBtn = document.getElementById('stp-install-btn');
        const shortcutBtn = document.getElementById('stp-shortcut-btn');
        if (!el) return;

        const fileMode = /^file:/.test(location.protocol);
        const swOk = supportsSw();
        const installed = isStandalone();

        // SW / 离线说明
        if (swEl) {
            if (fileMode) {
                swEl.textContent = '离线不可用：当前以文件方式打开，Service Worker 需要 http(s) 环境。建议本地起服务或部署到服务器/Pages。';
            } else if (swOk) {
                swEl.textContent = '离线可用：已启用 Service Worker，首次联网打开会缓存全部资源，之后断网也能正常使用。';
            } else {
                swEl.textContent = '当前浏览器不支持离线缓存，安装后功能需联网使用。';
            }
        }

        if (installed) {
            el.textContent = '✓ 已保存到手机（正在以独立应用方式运行）';
            el.style.color = 'var(--accent-color, #c5a47e)';
        } else if (fileMode) {
            el.textContent = '当前是文件方式打开的，浏览器不允许直接“保存到手机”。' +
                (isIOS() ? ' 可先把站点部署到服务器，再用 Safari 打开 → 分享 → 添加到主屏幕。' : ' 部署到服务器后刷新即可试试点「保存到手机」。');
        } else if (deferredPrompt) {
            el.textContent = '★ 可以保存到手机了：点下方「保存到手机」安装网站（或点「创建快捷方式」）。';
            if (installBtn) {
                installBtn.classList.add('modal-btn-primary');
                installBtn.classList.remove('modal-btn-secondary');
            }
        } else if (isIOS()) {
            el.textContent = 'iPhone/iPad：点底部「分享」按钮 → 「添加到主屏幕」，即可把网站存到手机桌面。';
        } else {
            el.textContent = '稍等片刻：Chrome / Edge 会在合适时机弹出安装入口；也可以点「创建快捷方式」。';
        }
    }

    function showShortcutSteps() {
        const steps = document.getElementById('stp-shortcut-steps');
        if (!steps) return;
        let html;
        if (isIOS()) {
            html = '① 打开 Safari 访问本网站<br>② 点底部「分享」按钮（方框向上箭头）<br>③ 下滑选择「添加到主屏幕」<br>④ 再次确认，桌面就会出现网站图标';
        } else if (/android/i.test(window.navigator?.userAgent || '')) {
            html = '① 打开 Chrome / Edge / 系统浏览器访问本网站<br>② 点右上角「⋮」菜单<br>③ 选择「安装应用」/「添加到主屏幕」<br>（优先选「安装应用」，会走完整的离线模式）';
        } else {
            html = '① 桌面版 Chrome / Edge：点地址栏右侧的「安装」图标<br>② 手机浏览器：菜单里选「安装应用」/「添加到主屏幕」<br>③ 也可以稍等浏览器自动弹出安装提示';
        }
        steps.innerHTML = html;
        steps.classList.add('active');
    }

    async function triggerInstall() {
        const status = document.getElementById('stp-status');
        const steps = document.getElementById('stp-shortcut-steps');
        if (steps) steps.classList.remove('active');

        if (deferredPrompt) {
            const p = deferredPrompt;
            deferredPrompt = null;
            try {
                await p.prompt();
                const choice = await p.userChoice;
                if (choice && choice.outcome === 'accepted') {
                    if (status) status.textContent = '✓ 正在保存到手机…稍后可在桌面/主屏幕找到应用';
                } else {
                    if (status) status.textContent = '未完成保存，可再试一次或点「创建快捷方式」';
                }
            } catch (e) {
                console.warn('[save-to-phone] 安装引导失败', e);
                showShortcutSteps();
            }
            return;
        }

        // 没有系统安装入口：交给浏览器菜单 / iOS 分享
        if (isIOS()) {
            showShortcutSteps();
        } else {
            showShortcutSteps();
        }
    }

    function bindUi() {
        const card = document.getElementById('install-settings');
        if (card) card.addEventListener('click', () => {
            const modal = document.getElementById('install-modal');
            if (modal && typeof showModal === 'function') showModal(modal);
        });

        const closeBtn = document.getElementById('install-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', () => {
            const modal = document.getElementById('install-modal');
            if (modal && typeof hideModal === 'function') hideModal(modal);
        });

        const input = document.getElementById('stp-name-input');
        if (input) {
            input.addEventListener('change', () => saveSiteName(input.value));
            // 输入时自动保存（防抖 800ms），无需手动点「保存名字」
            let _nameDebounce = null;
            input.addEventListener('input', () => {
                clearTimeout(_nameDebounce);
                _nameDebounce = setTimeout(() => {
                    const v = input.value.trim();
                    if (v) saveSiteName(v);
                }, 800);
            });
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
        }

        const saveNameBtn = document.getElementById('stp-name-save');
        if (saveNameBtn) saveNameBtn.addEventListener('click', () => {
            const v = (input && input.value) || '';
            saveSiteName(v);
        });

        const installBtn = document.getElementById('stp-install-btn');
        if (installBtn) installBtn.addEventListener('click', triggerInstall);

        const shortcutBtn = document.getElementById('stp-shortcut-btn');
        if (shortcutBtn) shortcutBtn.addEventListener('click', showShortcutSteps);

        const downloadBtn = document.getElementById('stp-download-btn');
        if (downloadBtn) downloadBtn.addEventListener('click', downloadSitePackage);
    }

    // ─── Service Worker 注册 ──────────────────────────────────────────────

    function registerServiceWorker() {
        if (!supportsSw()) return;
        if (document.getElementById('save-to-phone-sw-registered')) return;
        const tag = document.createElement('span');
        tag.id = 'save-to-phone-sw-registered';
        tag.style.display = 'none';
        document.body.appendChild(tag);
        try {
            navigator.serviceWorker.register('sw.js').then((reg) => {
                console.log('[save-to-phone] Service Worker 注册成功，作用域：', reg.scope);
            }).catch((err) => {
                console.warn('[save-to-phone] Service Worker 注册失败', err);
                renderStatus();
            });
        } catch (e) {
            console.warn('[save-to-phone] Service Worker 注册异常', e);
        }
    }

    // ─── 下载离线安装包（ZIP）────────────────────────────────────────────
    // 与 sw.js 预缓存清单保持一致，保证下载后离线全功能可用；另补 save-to-phone.js 自身。

    const SITE_FILES = [
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
        'manifest.json',
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
        'sw.js'
    ];

    const BINARY_RE = /\.(mp3|svg|jpe?g|png|gif|webp|ico)$/i;

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function buildManifestJson(name) {
        return JSON.stringify({
            name: name,
            short_name: name.slice(0, 12),
            description: '你们专属的私密空间 · ' + name,
            start_url: './',
            scope: './',
            display: 'standalone',
            orientation: 'portrait',
            background_color: '#000000',
            theme_color: '#000000',
            icons: [
                { src: ICON_URL, sizes: '192x192', type: 'image/jpeg', purpose: 'any' },
                { src: ICON_URL, sizes: '512x512', type: 'image/jpeg', purpose: 'any' }
            ]
        }, null, 2);
    }

    function rewriteIndexTitle(html, name) {
        return html
            .replace(/<title>[\s\S]*?<\/title>/i, '<title>' + escapeHtml(name) + '</title>')
            .replace(/(name=["']apple-mobile-web-app-title["']\s+content=["'])[^"']*(["'])/i, '$1' + escapeHtml(name.slice(0, 20)) + '$2');
    }

    function rewriteManifest(text, name) {
        try {
            const m = JSON.parse(text);
            m.name = name;
            m.short_name = name.slice(0, 12);
            m.description = '你们专属的私密空间 · ' + name;
            return JSON.stringify(m, null, 2) + '\n';
        } catch (e) {
            return buildManifestJson(name) + '\n';
        }
    }

    function saveBlob(blob, fileName) {
        if (typeof downloadFileFallback === 'function') {
            downloadFileFallback(blob, fileName);
            return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName; a.style.display = 'none';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function downloadSitePackage() {
        const btn = document.getElementById('stp-download-btn');
        const statusEl = document.getElementById('stp-download-status');
        const name = getStoreName();

        if (typeof JSZip === 'undefined') {
            notify('打包库未加载，请联网刷新后再试', 'error');
            return;
        }

        if (btn) { btn.disabled = true; btn.style.opacity = '0.55'; }
        if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = '正在打包…'; }

        try {
            const zip = new JSZip();
            for (let i = 0; i < SITE_FILES.length; i++) {
                const path = SITE_FILES[i];
                if (!path) continue;
                if (statusEl) statusEl.textContent = '正在打包 ' + path + '（' + (i + 1) + '/' + SITE_FILES.length + '）';
                try {
                    const res = await fetch(path, { credentials: 'same-origin', cache: 'no-cache' });
                    if (!res.ok) { console.warn('[save-to-phone] 缺少文件，跳过', path); continue; }
                    if (BINARY_RE.test(path)) {
                        zip.file(path, await res.arrayBuffer(), { binary: true });
                    } else {
                        let text = await res.text();
                        if (path === 'index.html') text = rewriteIndexTitle(text, name);
                        else if (path === 'manifest.json') text = rewriteManifest(text, name);
                        zip.file(path, text);
                    }
                } catch (e) {
                    console.warn('[save-to-phone] 打包失败，跳过', path, e);
                }
            }

            if (!zip.files['manifest.json']) zip.file('manifest.json', buildManifestJson(name) + '\n');

            if (statusEl) statusEl.textContent = '正在生成 ZIP…';
            const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
            const slug = name.replace(/[\\/:*?"<>|]/g, '') || 'site';
            saveBlob(blob, slug + '-离线安装包.zip');
            notify('已下载，解压后本地起服务或部署即可离线全功能使用', 'success');
        } catch (e) {
            console.error('[save-to-phone] 打包失败', e);
            notify('打包失败：' + (e && e.message ? e.message : String(e)), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.style.opacity = ''; }
            if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }
        }
    }

    // ─── 初始化 ────────────────────────────────────────────────────────────

    function init() {
        // 就地应用默认名（settings 可能在随后才从存储读回来）
        applySiteName(getStoreName());

        bindUi();

        // 抓取系统安装事件
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
            renderStatus();
        });
        window.addEventListener('appinstalled', () => {
            deferredPrompt = null;
            renderStatus();
            notify('网站已保存到手机 ✓', 'success');
        });
        if (typeof window.matchMedia === 'function') {
            try {
                window.matchMedia('(display-mode: standalone)').addEventListener('change', () => renderStatus());
            } catch (e) {}
        }

        renderStatus();

        registerServiceWorker();
    }

    // 应用数据加载完成（含 settings.siteName）后再应用一次名字
    document.addEventListener('app-data-ready', () => {
        applySiteName(getStoreName());
        renderStatus();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 0);
    }

    // ─── 导出（供测试） ─────────────────────────────────────────────────────
    window.__saveToPhone = {
        getName: getStoreName,
        appName: () => document.getElementById('welcome-title-glitch')?.textContent || document.title,
        installed: isStandalone,
        state: () => ({
            title: document.title,
            manifestHref: document.getElementById('app-manifest-link')?.getAttribute('href') || '',
            manifestIsBlob: !!(manifestBlobUrl && document.getElementById('app-manifest-link') && document.getElementById('app-manifest-link').getAttribute('href') === manifestBlobUrl),
            promptCaptured: !!deferredPrompt,
            swRegistered: !!document.getElementById('save-to-phone-sw-registered'),
            statusText: document.getElementById('stp-status')?.textContent || '',
        }),
    };
})();