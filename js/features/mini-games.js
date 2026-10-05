/* ================================================================
 * mini-games.js — 「小游戏」板块控制器
 * ------------------------------------------------------------
 * 职责只有三件：
 *   1. 打开/关闭 #minigames-page（六张卡片）
 *   2. 点卡片时把对应游戏面板 open*Panel()，并盖上浮层背景
 *   3. 游戏关掉后回到六宫格；退出板块时确保没有残留的面板
 *
 * 五子棋不走 open*Panel，它有自己的全屏页。这里只在 wuziqiModule
 * 上加了 openDirect()，棋盘内部逻辑一个字没动。
 * ================================================================ */
(function () {
    'use strict';
    if (window.MiniGames) return;

    /* 六款游戏注册表。opener 用 () => 调，避免加载顺序问题 */
    const GAMES = [
        {
            key: 'wuziqi', name: 'WZ', close: null,
            open: () => openWuziqi()
        },
        {
            key: 'ms', name: 'MS',
            open: () => window.openMsPanel && window.openMsPanel(),
            close: () => window.closeMsPanel && window.closeMsPanel()
        },
        {
            key: 'fishing', name: 'FS',
            open: () => window.openFishPanel && window.openFishPanel(),
            close: () => window.closeFishPanel && window.closeFishPanel()
        },
        {
            key: 'memory', name: 'MG',
            open: () => window.openMemoryPanel && window.openMemoryPanel(),
            close: () => window.closeMemoryPanel && window.closeMemoryPanel()
        },
        {
            key: 'linkup', name: 'LK',
            open: () => window.openLinkupPanel && window.openLinkupPanel(),
            close: () => window.closeLinkupPanel && window.closeLinkupPanel()
        },
        {
            key: 'match3', name: 'M3',
            open: () => window.openMatch3Panel && window.openMatch3Panel(),
            close: () => window.closeMatch3Panel && window.closeMatch3Panel()
        }
    ];

    const host = document.getElementById('mg-game-host');
    const backdrop = document.getElementById('mg-game-backdrop');
    let page = null;
    let activeGame = null;

    function refresh() {
        page = document.getElementById('minigames-page');
    }

    function isOpen() {
        return !!(page && page.classList.contains('active'));
    }

    /* ── 打开板块 ───────────────────────────────────────── */
    function open() {
        refresh();
        if (!page) return;
        page.classList.add('active');
        document.body.classList.add('mg-page-open');
        // 盖住底下页面的滚动
        document.body.style.overflow = 'hidden';
    }

    /* ── 关闭板块（顺带把所有游戏面板收干净） ─────────────── */
    function close() {
        closeAllGames();
        refresh();
        if (!page) return;
        page.classList.remove('active');
        document.body.classList.remove('mg-page-open');
        document.body.style.overflow = '';
    }

    /* ── 游戏浮层 ───────────────────────────────────────── */
    function hideHost() {
        if (host) host.classList.remove('is-on');
        if (backdrop) backdrop.hidden = true;
        document.body.classList.remove('mg-playing');
    }

    /* ── 让浮层按钮一定点得到 ───────────────────────────
       五个游戏的「开始 / 结算」浮层都是 position:absolute; inset:0，
       高度被棋盘舞台限死。内容比舞台高的时候，按钮会被顶到可视区外面 ——
       看着有按钮，点下去没反应（合作扫雷最容易触发）。
       这里在浮层显示后量一下它的真实高度，把舞台撑到刚好装得下。 */
    const STAGE_SEL = '.ms-stage, .mgm-stage, .lk-stage, .m3-stage';

    function fitOverlays() {
        if (!host) return;
        const list = host.querySelectorAll('.pong-overlay:not([hidden])');
        for (let i = 0; i < list.length; i++) {
            const ov = list[i];
            const stage = ov.closest(STAGE_SEL) || ov.parentElement;
            if (!stage) continue;
            stage.style.minHeight = '';
            const need = Math.ceil(ov.scrollHeight) + 12;
            if (need > stage.getBoundingClientRect().height) {
                stage.style.minHeight = need + 'px';
            }
        }
    }

    function showHost() {
        if (host) host.classList.add('is-on');
        if (backdrop) backdrop.hidden = false;
        document.body.classList.add('mg-playing');
        // 等游戏脚本把浮层内容填好再量
        requestAnimationFrame(fitOverlays);
        setTimeout(fitOverlays, 120);
        setTimeout(fitOverlays, 400);
    }

    /* 把所有 open*Panel 藏起来（用游戏自己的 close，别手改 hidden） */
    function closeAllGames() {
        for (const g of GAMES) {
            if (!g.close) continue;
            try { g.close(); } catch (e) { /* ignore */ }
        }
        activeGame = null;
        hideHost();
    }

    /* 五子棋是自带全屏页的老模块：不开浮层背景，
       让它在六宫格上层盖着，退出后自然回到六宫格。
       （#wuziqi-page 在文档里排在 #minigames-page 之后，同层级它在上） */
    function openWuziqi() {
        const m = window.wuziqiModule;
        if (!m || typeof m.openDirect !== 'function') {
            if (window.showNotification) window.showNotification('五子棋模块还没准备好', 'warning');
            return false;
        }
        m.openDirect();
        activeGame = 'wuziqi';
        hideHost();
        return true;
    }

    function openGame(key) {
        if (key === 'wuziqi') { openWuziqi(); return; }
        const g = GAMES.find(x => x.key === key);
        if (!g) return;
        try {
            g.open();
            activeGame = key;
            // 面板可能被脚本设成 hidden=false，这里统一让它浮出来
            showHost();
        } catch (e) {
            if (window.showNotification) {
                window.showNotification('小游戏加载失败：' + (e && e.message ? e.message : e), 'warning');
            }
            hideHost();
        }
    }

    /* 五子棋有自己的全屏页，直接让它自己开；退出时它自己收起，
       六宫格一直留在下层，所以关掉五子棋还能看到六张卡片。
       这里通过 wuziqiModule 上新加的 openDirect 打开，
       棋盘/计时/结算逻辑一行没动。 */

    /* ── 事件绑定 ───────────────────────────────────────── */
    function init() {
        refresh();
        if (!page) return;

        // 卡片
        page.querySelectorAll('.mg-card').forEach(card => {
            card.addEventListener('click', () => openGame(card.dataset.mg));
        });

        // 退出
        const exit = document.getElementById('minigames-exit-btn');
        if (exit) exit.addEventListener('click', close);

        // 点浮层背景：正在玩游戏就先关游戏回六宫格，否则退板块
        if (backdrop) {
            backdrop.addEventListener('click', () => {
                if (activeGame) closeAllGames();
                else close();
            });
        }

        // 面板自己带的 ✕ 只负责关面板，这里同步把浮层背景收掉
        if (host) {
            const obs = new MutationObserver(() => {
                const anyOpen = host.querySelector('.poke-card:not([hidden])');
                if (!anyOpen) { hideHost(); return; }
                // 浮层可能刚被切出来（开始 → 结算），重新量一次高度
                fitOverlays();
            });
            obs.observe(host, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true, characterData: true });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen()) {
                if (activeGame) closeAllGames();
                else close();
            }
        });
    }

    /* ── 邀请按钮：每一款游戏一个「邀 TA 一起玩」 ─────────
       真正的邀请/拒绝/同意流程在 minigame-social.js，
       这里只负责把按钮画到六宫格底部。 */
    const INVITE_ICONS = {
        wuziqi: 'fa-chess-board',
        ms: 'fa-bomb',
        fishing: 'fa-fish-finned',
        memory: 'fa-clone',
        linkup: 'fa-link',
        match3: 'fa-cubes'
    };

    function buildInviteRow() {
        const row = document.getElementById('mg-invite-btns');
        if (!row) return;
        row.innerHTML = '';
        for (const g of GAMES) {
            const btn = document.createElement('button');
            btn.className = 'mg-invite-btn';
            btn.dataset.invite = g.key;
            btn.innerHTML =
                '<i class="fas ' + (INVITE_ICONS[g.key] || 'fa-gamepad') + '"></i>' +
                '<span>邀' + (window.settings?.partnerName ? ' ' + window.settings.partnerName : ' TA') + ' 一起</span>';
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (window.MiniGameSocial && typeof window.MiniGameSocial.invite === 'function') {
                    window.MiniGameSocial.invite(g.key);
                }
            });
            row.appendChild(btn);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    buildInviteRow();

    window.MiniGames = {
        open, close, openGame, closeAllGames, isOpen, GAMES,
        buildInviteRow
    };
})();