/* ============================================================
 * wz2 × mochi 兼容层（小游戏专用）
 * ------------------------------------------------------------
 * wz2 的五个小游戏是从 mochi 原样搬过来的，代码里引用了一批 mochi
 * 的全局函数。这里只补 wz2 真正能对上的那几个，并且**故意不提供**
 * 心意币钱包相关的全局，让游戏自然跳过金币结算，而不是塞一堆假实现。
 *
 * 故意不提供（游戏代码全部是 typeof 守卫，会自己跳过）：
 *   giftWalletChange / giftWallet* / arcadeMult / arcadeMarkLuckyPlayed
 *   arcadeTryDrop / recordGiftBox / getInteractPool
 *   ↑ 这些都跟 mochi 的「心意币」经济系统绑在一起，wz2 没有钱包。
 *     不定义 → 游戏里的 `if (window.giftWalletChange)` 直接为假 →
 *     该跳过的结算就跳过，玩法本身不受影响。
 *
 * 提供了：
 *   activePrefix / activeStore / xyStore   存储命名空间 → wz2 的 localforage
 *   chatAddIn / chatAddSystem              游戏结果插进聊天
 *   openModal                              合作扫雷的「小收藏」面板
 * ============================================================ */
(function () {
    'use strict';
    if (window.__wzMochiCompat) return;
    window.__wzMochiCompat = true;

    /* wz2 没有钱包，所有「心意币」结算整体关掉。
       五个游戏里凡是算钱的地方都先看这个开关，关掉后：
         · 结算面板不再出现金币行
         · 钓鱼的「出售」变成清空收获（避免收获堆着不清）
       捕鱼、烹饪、翻牌配对、扫雷推理这些玩法本身一点不受影响。 */
    window.MG_NO_COIN = true;

    const APP_PREFIX = (typeof window.APP_PREFIX === 'string' && window.APP_PREFIX)
        ? window.APP_PREFIX
        : 'wz2-';

    /* mochi 那边每个联系人的存储前缀，这里统一成 wz2 的一套 key */
    const NS = APP_PREFIX + 'minigame';
    const cache = new Map();

    function nsKey(key, tag) {
        return NS + (tag ? ':' + tag : '') + ':' + key;
    }

    /* ── 同步存储适配层 ──────────────────────────────
       mochi 的 activeStore()/xyStore() 是同步 get/set，底层是
       localStorage。wz2 其它地方用 localforage（异步）。这里用
       localStorage 做同步层，单独加前缀，跟主数据完全不冲突。 */
    function makeStore(tag) {
        return {
            get(key) {
                try {
                    const raw = localStorage.getItem(nsKey(key, tag));
                    if (raw === null) {
                        // 也容一下 mochi 原始 key（万一有旧数据）
                        const alt = localStorage.getItem(key);
                        return alt === null ? undefined : alt;
                    }
                    return raw;
                } catch (e) { return undefined; }
            },
            set(key, val) {
                try {
                    const s = (typeof val === 'string') ? val : JSON.stringify(val);
                    localStorage.setItem(nsKey(key, tag), s);
                    cache.set(nsKey(key, tag), val);
                    return true;
                } catch (e) { return false; }
            },
            del(key) {
                try {
                    localStorage.removeItem(nsKey(key, tag));
                    cache.delete(nsKey(key, tag));
                    return true;
                } catch (e) { return false; }
            }
        };
    }

    const defaultStore = makeStore();

    /* mochi: window.activePrefix() → 当前联系人的存储前缀 */
    if (typeof window.activePrefix !== 'function') {
        window.activePrefix = function () { return NS; };
    }

    /* mochi: window.activeStore() → 当前联系人的同步存储对象 */
    if (typeof window.activeStore !== 'function') {
        window.activeStore = function () { return defaultStore; };
    }

    /* mochi: window.xyStore(ns) → 指定命名空间的存储对象
       （记忆翻牌用它存「最佳成绩」等，按 ns 隔开才不会互相踩） */
    if (typeof window.xyStore !== 'function') {
        window.xyStore = function (ns) {
            const tag = ns ? String(ns) : 'default';
            const s = makeStore(tag);
            return {
                get: (k) => s.get(k),
                set: (k, v) => s.set(k, v),
                del: (k) => s.del(k)
            };
        };
    }

    /* ── 聊天：把游戏结果插进 wz2 的聊天记录 ───────────────
       mochi 的 chatAddIn(text, {silent}) 是「让对方说一句话」，
       chatAddSystem(text, meta) 是插一条系统事件（对局结果）。
       wz2 里普通消息走顶层 addMessage({sender, text})，
       事件类走 window._addCallEvent(icon, label, detail)。 */
    function pushChat(text, isSystem) {
        const t = String(text == null ? '' : text).trim();
        if (!t) return false;
        try {
            if (isSystem) {
                if (typeof window._addCallEvent === 'function') {
                    window._addCallEvent('fa-gamepad', t, null);
                    return true;
                }
                return false;
            }
            // addMessage 在 core.js 里是顶层 const，属于全局词法环境但不是
            // window 属性，所以要按裸标识符取（typeof 未声明是安全的）
            let add = null;
            try { if (typeof addMessage === 'function') add = addMessage; } catch (e) { add = null; }
            if (!add && typeof window.addMessage === 'function') add = window.addMessage;
            if (add) {
                // 对话方名字取 wz2 的设置（就是聊天里显示的那个 TA）
                let who = 'TA';
                try { if (typeof settings === 'object' && settings.partnerName) who = settings.partnerName; } catch (e) { }
                add({
                    id: 'mg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                    sender: who,
                    text: t,
                    timestamp: new Date(),
                    status: 'received',
                    favorited: false,
                    note: null,
                    type: 'normal'
                });
                return true;
            }
        } catch (e) { /* 聊天接口不在就安静跳过，游戏本身照跑 */ }
        return false;
    }

    if (typeof window.chatAddIn !== 'function') {
        window.chatAddIn = function (text) { return pushChat(text, false); };
    }
    if (typeof window.chatAddSystem !== 'function') {
        window.chatAddSystem = function (text) { return pushChat(text, true); };
    }

    /* ── openModal：合作扫雷的「小收藏」用 ──────────────
       mochi 的签名是 openModal(title, sub, onInput, opts)。
       wz2 已经有自己的 openModal，这里只在缺失时补一个最简版，
       保证点了「小收藏」有反应而不是静默失败。 */
    if (typeof window.openModal !== 'function') {
        window.openModal = function (title, sub, onInput, opts) {
            try {
                const o = opts || {};
                const body = (o.staticText || sub || '') +
                    (o.pills && o.pills.length
                        ? '\n\n' + o.pills.map(p => '· ' + (p.label || p.name || '')).join('\n')
                        : '');
                if (typeof window.showNotification === 'function') {
                    window.showNotification(title + (body ? '：' + body : ''), 'info');
                    return;
                }
                alert(title + (body ? '\n\n' + body : ''));
            } catch (e) { /* ignore */ }
        };
    }

    window.__wzMochiCompatNS = NS;
})();