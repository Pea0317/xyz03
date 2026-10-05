/* ============================================================
 * wz2 自由造句（复刻自 mochi js/dream-free.js）
 * ------------------------------------------------------------
 * 原版思路：从字卡库抽一句当「语料」，按造句手法把它截字重造句
 *          后当作对方的回复发出来。
 *
 * 造句手法（settings.freeSentenceStyle）
 *   0 = 语气词：随机插入语气词 / 加逗号 / 加空格 / 加句尾语气 / 截尾
 *   1 = 撤回式：把句子从某个词间隙截断（像“话说一半收回去了”）
 *   2 = 换字卡：拿别的字卡里的词插进句子里，或换尾
 *
 * 语料三源（按权重抽，mochi 默认 50/25/25）
 *   自定义字卡(50) / 默认聊天字卡(25) / 词典语录(25)
 *
 * 句尾标点：默认池 ['。','。','。','~','！','……']，已有标点则不补
 *
 * 造出来的句子自动进「梦角自由造句」分组，且不参与语料，避免自我循环
 * ============================================================ */
(function () {
    'use strict';
    if (window.__wzDreamFreeLoaded) return;
    window.__wzDreamFreeLoaded = true;

    const FILL_WORDS = ['想你', '抱抱', '亲亲', '嘿嘿', '哦', '呀', '啦', '嘛', '呢', '哼',
        '想你了', '最喜欢你', '晚安', '早安', '嘿嘿嘿', '哼哼', '呜呜', '嘻嘻', '好耶', '喵'];
    const SUFFIXES = ['呀', '啦', '哦', '呢', '嘛', '哟', '哈', '嘿嘿'];
    const END_PUNCT_DEFAULT = ['。', '。', '。', '~', '！', '……'];
    const END_PUNCT_OK = /[。．！？!?~～…，、,.;；:：）)”’"]/;
    const HAN = /[\u4e00-\u9fff]/;
    /* 自动入库用的分组名：这些卡只当「产物」展示，不再回头当语料 */
    const MJFREE_GROUP = '梦角自由造句';

    let lastSrc = '';   // 连续防复读：上一条造句的源卡不立刻重抽
    let segDict = null; // 切词词典缓存
    let segMax = 4;     // 正向最大匹配窗口上限

    /* ── 分词词典 ──────────────────────────────────────
       忠实取 mochi 的来源：dict 分类里名字以「词库」开头的分组。
       另外把 dict_ext 的 1.4 万条主题词也并进来做切词（全是真词，
       分词质量比单字词库好很多），最长词上限 8 与原版一致。      */
    function getSegDict() {
        if (segDict) return segDict;
        segDict = new Set();
        segMax = 4;
        try {
            const gs = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || [];
            gs.forEach(g => {
                if (!g || typeof g[0] !== 'string' || g[0].indexOf('词库') !== 0) return;
                (g[1] || []).forEach(wd => {
                    if (typeof wd !== 'string' || wd.length < 2) return;
                    segDict.add(wd);
                    if (wd.length > segMax && wd.length <= 8) segMax = wd.length;
                });
            });
        } catch (e) { /* 没有词典也能跑，退化成单字切分 */ }
        try {
            const xs = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict_ext')) || [];
            xs.forEach(g => {
                if (!g || !Array.isArray(g[1])) return;
                g[1].forEach(wd => {
                    if (typeof wd !== 'string' || wd.length < 2 || wd.length > 8) return;
                    segDict.add(wd);
                    if (wd.length > segMax) segMax = wd.length;
                });
            });
        } catch (e) { /* 同上 */ }
        return segDict;
    }

    /* 正向最大匹配切词：非汉字整段并成一个 token，汉字按词典最长匹配 */
    function segment(s) {
        const str = String(s == null ? '' : s);
        const dict = getSegDict();
        const out = [];
        let i = 0;
        while (i < str.length) {
            if (!HAN.test(str[i])) {
                let j = i;
                while (j < str.length && !HAN.test(str[j])) j++;
                out.push(str.slice(i, j));
                i = j;
                continue;
            }
            let len = 0;
            for (let L = Math.min(segMax, str.length - i); L >= 2; L--) {
                if (dict.has(str.slice(i, i + L))) { len = L; break; }
            }
            if (!len) len = 1;
            out.push(str.slice(i, i + len));
            i += len;
        }
        return out;
    }

    const isWordTok = t => HAN.test(t); // 含汉字＝词 token

    /* ── 语料过滤：太短/太长、含 data:/分隔符、汉字不足 4 个的都不做语料 ── */
    function filterCorpus(list) {
        return (list || []).filter(function (s) {
            if (typeof s !== 'string') return false;
            if (s.length < 4 || s.length > 30) return false;
            if (s.indexOf('data:') === 0 || s.indexOf('|||') >= 0) return false;
            if (/[\uD800-\uDBFF]/.test(s)) return false;
            return (s.match(/[\u4e00-\u9fff]/g) || []).length >= 4;
        });
    }

    /* 梦角自由造句产物不回头当语料（mochi 的同款防自我循环） */
    function isMfreeGenerated(t) {
        try {
            const gs = window.customReplyGroups || [];
            for (let i = 0; i < gs.length; i++) {
                const g = gs[i];
                if (g && g.name === MJFREE_GROUP && Array.isArray(g.items) && g.items.indexOf(t) >= 0) return true;
            }
        } catch (e) { /* 分组读不到就不排除 */ }
        return false;
    }

    function customPool() {
        let cards = [];
        try { cards = (window.getCustomCards && window.getCustomCards()) || []; } catch (e) { cards = []; }
        return filterCorpus(cards.filter(t => !isMfreeGenerated(t)));
    }

    const DEF_CATS = ['main', 'kaomoji', 'emoji', 'touch'];
    function defaultPool() {
        try {
            const all = [];
            DEF_CATS.forEach(cat => {
                if (window.defaultCardCat && !window.defaultCardCat(cat)) return;
                const gs = (window.getDefaultCardGroups && window.getDefaultCardGroups(cat)) || [];
                gs.forEach(g => ((g && g[1]) || []).forEach(t => {
                    if (window.isDefaultCardOff && window.isDefaultCardOff(cat, t)) return;
                    all.push(t);
                }));
            });
            return filterCorpus(all);
        } catch (e) { return []; }
    }

    function dictPool() {
        try {
            const gs = (window.getDefaultCardGroups && window.getDefaultCardGroups('dict')) || [];
            const all = gs.reduce((a, g) => a.concat((g && g[1]) || []), []);
            return filterCorpus(all.filter(t => !(window.isDefaultCardOff && window.isDefaultCardOff('dict', t))));
        } catch (e) { return []; }
    }

    /* 三语料源按权重抽（权重不必凑够 100，按比例归一） */
    const SRC_W = { cc: 50, def: 25, dict: 25 };
    function pickSourcePool() {
        const srcs = [];
        const p1 = customPool(); if (p1.length) srcs.push({ w: SRC_W.cc, pool: p1 });
        const p2 = defaultPool(); if (p2.length) srcs.push({ w: SRC_W.def, pool: p2 });
        const p3 = dictPool(); if (p3.length) srcs.push({ w: SRC_W.dict, pool: p3 });
        if (!srcs.length) return null;
        let total = 0;
        srcs.forEach(s => { total += s.w; });
        if (total <= 0) return srcs[Math.floor(Math.random() * srcs.length)].pool;
        let r = Math.random() * total;
        for (let i = 0; i < srcs.length; i++) { r -= srcs[i].w; if (r < 0) return srcs[i].pool; }
        return srcs[srcs.length - 1].pool;
    }

    /* 撤回式：随机挑一个「截断点」保留前半段（按位置加权，偏向截得靠后） */
    function recallCut(s) {
        const str = String(s == null ? '' : s);
        const toks = segment(str);
        if (toks.length < 3) return null;
        const gaps = [];
        for (let i = 2; i < toks.length; i++) {
            const keep = toks.slice(0, i).join('');
            if ((keep.match(/[\u4e00-\u9fff]/g) || []).length >= 4) gaps.push(i);
        }
        if (!gaps.length) return null;
        let total = 0, acc = [];
        gaps.forEach(gi => { total += gi; acc.push(total); });
        const r = Math.random() * total;
        let gi = gaps[gaps.length - 1];
        for (let k = 0; k < gaps.length; k++) { if (r < acc[k]) { gi = gaps[k]; break; } }
        const out = toks.slice(0, gi).join('').replace(/[，、,\s]+$/, '');
        return (out !== str && out.length >= 4) ? out : null;
    }

    /* 词池：全部语料切词后收集长度≥2 的词，用于换字卡 */
    function wordPool(excludeSrc) {
        const pool = [];
        customPool().concat(defaultPool(), dictPool()).forEach(card => {
            if (card === excludeSrc) return;
            segment(card).forEach(t => {
                if (t.length >= 2 && isWordTok(t) && pool.indexOf(t) < 0) pool.push(t);
            });
        });
        return pool;
    }

    /* ── 六种造句手法 ────────────────────────────────── */
    function rebuild(s, mode, material) {
        const str = String(s == null ? '' : s);
        if (mode === 'recall') return recallCut(str);
        if (mode === 'suffix') {
            const base = str.replace(/[，。！？、…～\s]+$/, '');
            if (base.length < 3) return null;
            const out = base + SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
            return out !== str ? out : null;
        }
        if (mode === 'addtail') {
            let word = null;
            if (material === 'cards') {
                const wp = wordPool(str);
                if (wp.length) word = wp[Math.floor(Math.random() * wp.length)];
            } else {
                word = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
            }
            if (!word) return null;
            const base = str.replace(/[，。！？、…～\s]+$/, '');
            const out = base + word;
            return out !== str ? out : null;
        }
        if (mode === 'tailcut') {
            const base = str.replace(/[，。！？、…～\s]+$/, '');
            if (base.length < 4) return null;
            const cut = 1 + Math.floor(Math.random() * Math.min(2, base.length - 2));
            return base.slice(0, base.length - cut);
        }
        const toks = segment(str);
        if (toks.length < 3) return null;
        /* 只落在词与词的间隙上，不会把一个词劈成两半 */
        const gaps = [];
        for (let i = 1; i < toks.length; i++) {
            if (isWordTok(toks[i - 1]) && isWordTok(toks[i])) gaps.push(i);
        }
        if (!gaps.length) return null;
        const gi = gaps[Math.floor(Math.random() * gaps.length)];
        if (mode === 'cutfill') {
            const rest = toks.slice(gi);
            const wi = Math.floor(Math.random() * rest.length);
            let fill;
            if (material === 'cards') {
                const wp = wordPool(str);
                fill = wp.length ? wp[Math.floor(Math.random() * wp.length)] : FILL_WORDS[Math.floor(Math.random() * FILL_WORDS.length)];
            } else {
                fill = FILL_WORDS[Math.floor(Math.random() * FILL_WORDS.length)];
            }
            const out = toks.slice(0, gi).join('') + fill + rest.filter((_, k) => k !== wi).join('');
            return out !== str ? out : null;
        }
        const sep = mode === 'comma' ? '，' : ' ';
        const out = toks.slice(0, gi).join('') + sep + toks.slice(gi).join('');
        return out !== str ? out : null;
    }

    /* 句尾标点：已有标点就不补 */
    function withEndPunct(txt) {
        if (!txt || typeof txt !== 'string') return txt;
        if (END_PUNCT_OK.test(txt.charAt(txt.length - 1))) return txt;
        return txt + END_PUNCT_DEFAULT[Math.floor(Math.random() * END_PUNCT_DEFAULT.length)];
    }

    /* ── 对外：抽一句造好的句子 ─────────────────────────── */
    window.dreamFreePick = function () {
        try {
            if (!settings.freeSentenceEnabled) return null;
            const prob = Number(settings.freeSentenceProb);
            if (!isFinite(prob) || prob <= 0 || Math.random() * 100 >= prob) return null;
            const pool = pickSourcePool();
            if (!pool || !pool.length) return null;

            const style = Math.max(0, Math.min(2, parseInt(settings.freeSentenceStyle, 10) || 0));
            const pickOf = arr => arr[Math.floor(Math.random() * arr.length)];
            for (let t = 0; t < 8; t++) {
                const s = pool[Math.floor(Math.random() * pool.length)];
                if (s === lastSrc) continue;           // 防止连着两条同一个源
                let mode, material = 'fixed';
                if (style === 1) {
                    const r = Math.random();
                    mode = r < 0.5 ? 'recall' : (r < 0.75 ? 'comma' : 'space');
                } else if (style === 2) {
                    material = 'cards';
                    mode = pickOf(['cutfill', 'comma', 'space', 'addtail', 'tailcut']);
                } else {
                    mode = pickOf(['cutfill', 'comma', 'space', 'suffix', 'tailcut']);
                }
                const txt = withEndPunct(rebuild(s, mode, material));
                if (txt && txt !== s) { lastSrc = s; return { text: txt, src: s }; }
            }
            return null;
        } catch (e) { return null; }
    };

    /* 自动入库：默认 80% 进公用字卡库 / 20% 进专属字卡库。
       wz2 只有一套字卡库，用分组名区分来源。 */
    window.dreamFreeSave = function (txt) {
        try {
            if (typeof window.ccAppendCards !== 'function') return false;
            const pubProb = 80;
            const usePublic = Math.random() * 100 < pubProb;
            return !!window.ccAppendCards('mjfree', MJFREE_GROUP, [txt], usePublic ? 'public' : 'own');
        } catch (e) { return false; }
    };

    window.dreamFreeSegment = segment;
    window.dreamFreeRebuild = rebuild;
    window.dreamFreeSegDictSize = function () { return getSegDict().size; };
    /* 调试/测试用 */
    window.dreamFreeTest = function (n) {
        const out = [];
        const on = settings.freeSentenceEnabled;
        const prob = settings.freeSentenceProb;
        const style = settings.freeSentenceStyle;
        settings.freeSentenceEnabled = true;
        settings.freeSentenceProb = 100;
        for (let i = 0; i < (n || 10); i++) {
            const r = window.dreamFreePick();
            out.push(r ? r.text : null);
        }
        settings.freeSentenceEnabled = on;
        settings.freeSentenceProb = prob;
        settings.freeSentenceStyle = style;
        return out;
    };
})();