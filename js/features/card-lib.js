/* ============================================================
 * wz2 内置字卡适配层 (card-lib.js)
 * ------------------------------------------------------------
 * 数据源：js/card-data.js 里的 window.DEFAULT_CARD_DATA
 *   main / kaomoji / emoji / touch   —— 可直接当回复用的聊天字卡
 *   dict / dict_ext                  —— 词典（语录 + 词库），自由造句分词用
 *   其余功能类（fish/eat/period/…）   —— 其它场景专用，仅作浏览
 *
 * 本文件提供 mochi 自由造句所需的最小 API：
 *   window.getDefaultCardGroups(cat)  读内置字卡分组
 *   window.defaultCardCat(cat)        该分类是否启用
 *   window.isDefaultCardOff(cat, txt) 该张内置字卡是否被用户停用
 *   window.getCustomCards()           用户字卡库（customReplies）
 *   window.ccAppendCards(...)         往字卡库追加（自由造句自动入库用）
 *   window.cardLibSeedPresets()       首次启动把内置字卡灌进字卡库
 * ============================================================ */
(function () {
    'use strict';
    if (window.__wzCardLibLoaded) return;
    window.__wzCardLibLoaded = true;

    /* 分类标签：字卡库里「内置字卡」tab 用 */
    const CAT_LABELS = {
        main: '主字卡', kaomoji: '颜文字', emoji: 'Emoji', touch: '亲昵称呼',
        dict: '词典', dict_ext: '扩充分词词典',
        fish: '摸鱼', eat: '吃饭', period: '经期', water: '喝水', garden: '花园',
        sync: '同频', reach: '伸手', cjian: '抽检', room: '房间', piggy: '小猪存钱',
        drink: '喝的', deskcheck: '查岗', music: '音乐', drift: '漂流瓶', interact: '互动'
    };
    /* 直接进字卡库参与回复抽取的分类（其余仅浏览/其它场景用） */
    const FEED_CATS = ['main', 'kaomoji', 'emoji', 'touch'];

    /* 只有用户没有字卡、或还没播种过时才会灌入，避免覆盖用户自己的库 */
    const SEED_FLAG = 'wzPresetCardsSeeded_v1';

    function DATA() {
        return window.DEFAULT_CARD_DATA || {};
    }
    function catGroups(cat) {
        const d = DATA();
        const g = d[cat];
        return Array.isArray(g) ? g : [];
    }
    function catLabel(cat) {
        return CAT_LABELS[cat] || cat;
    }

    /* ── mochi 兼容 API ───────────────────────────────── */

    window.getDefaultCardGroups = function (cat) {
        return catGroups(cat);
    };

    window.defaultCardCat = function (cat) {
        return catGroups(cat).length > 0;
    };

    /* 内置字卡没有独立的「停用」持久化，沿用字卡库本身的停用集合 */
    function disabledSet() {
        const s = new Set();
        try {
            const raw = localStorage.getItem('disabledReplyItems');
            if (raw) {
                const arr = JSON.parse(raw);
                if (Array.isArray(arr)) arr.forEach(t => s.add(t));
            }
        } catch (e) { /* 读不到就当没停用 */ }
        try {
            (window.customReplyGroups || []).forEach(g => {
                if (g && g.disabled && Array.isArray(g.items)) g.items.forEach(it => s.add(it));
            });
        } catch (e) { /* 分组还没加载完 */ }
        return s;
    }
    window.isDefaultCardOff = function (cat, txt) {
        return disabledSet().has(txt);
    };
    window.wzCardDisabledSet = disabledSet;

    /* 自由造句的「语料·自定义字卡」源用 */
    window.getCustomCards = function () {
        try {
            return Array.isArray(customReplies) ? customReplies : [];
        } catch (e) {
            return Array.isArray(window._customReplies) ? window._customReplies : [];
        }
    };

    /* 造出来的句子自动入库（对应 mochi 的 ccAppendCards）。
       scope: 'public' 进公用字卡库, 'own' 进专属字卡库 —— wz2 只有一套字卡库，
       两者都落在 customReplies 上，由分组名区分。 */
    window.ccAppendCards = function (type, label, texts, scope) {
        try {
            const list = Array.isArray(texts) ? texts : [texts];
            let added = 0;
            const gname = (label || '自由造句') + (scope === 'own' ? '（专属）' : '');
            const target = window.getCustomCards();
            list.forEach(t => {
                const v = String(t == null ? '' : t).trim();
                if (!v || v.indexOf('data:') === 0 || v.indexOf('|||') >= 0) return;
                if (target.indexOf(v) >= 0) return;
                target.push(v);
                added++;
                _ensureGroup(gname, v);
            });
            if (!added) return false;
            _saveReplies();
            return true;
        } catch (e) {
            return false;
        }
    };

    /* ── 分组小工具 ───────────────────────────────────── */

    function _ensureGroup(name, item) {
        try {
            if (!Array.isArray(window.customReplyGroups)) window.customReplyGroups = [];
            let g = window.customReplyGroups.find(x => x && x.name === name);
            if (!g) {
                g = { id: Date.now() + Math.floor(Math.random() * 1000), name: name, color: '#c5a47e', disabled: false, items: [] };
                window.customReplyGroups.push(g);
            }
            if (!Array.isArray(g.items)) g.items = [];
            if (g.items.indexOf(item) < 0) g.items.push(item);
        } catch (e) { /* 分组失败不影响入库 */ }
    }

    function _saveReplies() {
        try {
            if (typeof throttledSaveData === 'function') throttledSaveData();
            else localforage.setItem(getStorageKey('customReplies'), customReplies);
        } catch (e) { /* 忽略：下次改动再存 */ }
        try { window._customReplies = customReplies; } catch (e) {}
    }

    /* ── 首次启动灌入内置字卡 ─────────────────────────── */

    function presetTexts() {
        const out = [];
        FEED_CATS.forEach(cat => {
            catGroups(cat).forEach(g => {
                if (!g || !Array.isArray(g[1])) return;
                g[1].forEach(t => { if (t) out.push(String(t).trim()); });
            });
        });
        return out.filter(Boolean);
    }

    /* 播种：
       - 用户字卡库为空            → 全量灌入（全新用户）
       - 已播种过但库被清空        → 再次灌入（用户主动清空后想恢复）
       - 已经有自己的字卡          → 只补内置里缺的（增量，不覆盖用户内容） */
    function cardLibSeedPresets() {
        try {
            const seedAll = Array.isArray(customReplies) && customReplies.length === 0;
            const already = !!localStorage.getItem(SEED_FLAG);
            if (!seedAll && already) return { seeded: 0, skipped: true };

            const have = new Set(Array.isArray(customReplies) ? customReplies : []);
            let n = 0;
            FEED_CATS.forEach(cat => {
                catGroups(cat).forEach(g => {
                    if (!g || !Array.isArray(g[1])) return;
                    const gname = '内置·' + catLabel(cat) + '·' + (g[0] || '未分组');
                    g[1].forEach(t => {
                        const v = String(t == null ? '' : t).trim();
                        if (!v || have.has(v)) return;
                        customReplies.push(v);
                        have.add(v);
                        n++;
                        _ensureGroup(gname, v);
                    });
                });
            });
            try { localStorage.setItem(SEED_FLAG, '1'); } catch (e) {}
            if (n) {
                _saveReplies();
                try {
                    localforage.setItem(getStorageKey('customReplyGroups'), window.customReplyGroups || []);
                } catch (e) {}
            }
            return { seeded: n, skipped: false };
        } catch (e) {
            return { seeded: 0, error: String(e && e.message || e) };
        }
    }
    window.cardLibSeedPresets = cardLibSeedPresets;

    /* 恢复内置字卡（字卡库里的「恢复内置字卡」按钮用） */
    window.cardLibRestorePresets = function () {
        try {
            const have = new Set(Array.isArray(customReplies) ? customReplies : []);
            let n = 0;
            FEED_CATS.forEach(cat => {
                catGroups(cat).forEach(g => {
                    if (!g || !Array.isArray(g[1])) return;
                    const gname = '内置·' + catLabel(cat) + '·' + (g[0] || '未分组');
                    g[1].forEach(t => {
                        const v = String(t == null ? '' : t).trim();
                        if (!v || have.has(v)) return;
                        customReplies.push(v); have.add(v); n++;
                        _ensureGroup(gname, v);
                    });
                });
            });
            if (n) {
                _saveReplies();
                try { localforage.setItem(getStorageKey('customReplyGroups'), window.customReplyGroups || []); } catch (e) {}
            }
            return n;
        } catch (e) { return 0; }
    };

    /* 内置字卡总览（给「内置字卡」tab / 统计用） */
    window.cardLibPresetSummary = function () {
        const d = DATA();
        const out = [];
        Object.keys(d).forEach(cat => {
            const gs = catGroups(cat);
            if (!gs.length) return;
            let cards = 0;
            gs.forEach(g => { if (g && Array.isArray(g[1])) cards += g[1].length; });
            out.push({ cat: cat, label: catLabel(cat), groups: gs.length, cards: cards, feed: FEED_CATS.indexOf(cat) >= 0 });
        });
        return out;
    };
})();