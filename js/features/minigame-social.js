/* ================================================================
 * minigame-social.js — 六宫格小游戏的「互相邀请 / 认输 / 中途退出」
 * ------------------------------------------------------------
 * 参照 D:\wz2\js\features\companion.js 的陪伴板块玩法，行为完全对齐：
 *
 *  1. 邀请流程
 *     · 用户发起 → 「正在邀请」等待页（可取消）→ 35% 拒绝 / 65% 接受
 *       拒绝：4~12 秒后回复，过渡画面 + 聊天记录留痕
 *       接受：1~3 秒后回复，过渡画面 → 直接开局
 *     · 梦角发起 → 来电式邀请页（拒绝 / 接受），60 秒未响应自动错过
 *       拒绝：过渡画面 + 聊天记录留痕
 *       接受：过渡画面 → 直接开局
 *
 *  2. 动画
 *     开局与结束都走 .companion-transition（与陪伴板块同一套 CSS、
 *     同一段 3.5s 停留 + 1s 淡出），台词用 TRANSITION 库里的同款口吻。
 *
 *  3. 概率（按需求对齐现有实现）
 *     · 主动发起邀请 = 主动发起语音通话的概率
 *       语音通话 = 15~60 分钟检查一次 × 25% 触发 × 50%(通话/陪伴二选一) × 50%(语音/视频)
 *       = 6.25% / 轮
 *     · 对方认输 = 五子棋的概率：对方每回合 5%，五子棋另有「满 10 手」的前置条件，
 *       这里统一按「满 10 回合」对齐（wuziqi.js:345）
 *     · 对方中途退出 = 3%（小游戏原本没有中途退出概率，按需求统一取 3%）
 *
 *  4. 双向权利
 *     · 认输：用户有按钮，梦角按概率触发
 *     · 中途退出：用户有按钮，梦角按 3% 触发
 * ================================================================ */
(function () {
    'use strict';
    if (window.MiniGameSocial) return;

    /* ─── 概率常量 ─────────────────────────────────────── */

    // 主动发起邀请：与「主动发起语音通话」同一概率（0.25 × 0.5 × 0.5）
    const PROACTIVE_INVITE_CHANCE = 0.25 * 0.5 * 0.5;
    const RANDOM_CHECK_MIN_MIN = 15;   // 与陪伴板块一致：15~60 分钟检查一次
    const RANDOM_CHECK_MAX_MIN = 60;
    // 用户邀请 → 梦角拒绝（与 companion.js:709 / wuziqi.js:16 一致）
    const REJECT_CHANCE = 0.35;
    // 梦角每回合认输（五子棋 wuziqi.js:345 的 0.05）
    const PARTNER_FORFEIT_CHANCE = 0.05;
    const FORFEIT_MIN_TURN = 10;       // 满 10 回合才可能认输（同五子棋满 10 手）
    // 梦角中途退出（需求：原代码没有的一律 3%）
    const PARTNER_QUIT_CHANCE = 0.03;
    const PARTNER_QUIT_CHECK_MS = 5 * 60 * 1000;  // 与陪伴板块提前离开同为 5 分钟一查

    /* ─── 台词库 ───────────────────────────────────────── */

    // 梦角主动邀请的台词（对应陪伴板块 INVITE_LINES 的口吻）
    const INVITE_LINES = {
        wuziqi: ['要不要一起下局五子棋？', '手痒了，来一局？'],
        ms:     ['一起扫个雷好不好？', '来玩局合作扫雷？'],
        fishing:['陪我去钓会儿鱼吧？', '想钓鱼了，一起吗？'],
        memory: ['一起玩局记忆翻牌？', '来比比谁记得清？'],
        linkup: ['来玩局连连看吧？', '一起连连看，陪我一会？'],
        match3: ['一起玩局消消乐？', '来三消吧，陪我放松下？'],
    };
    // 用户邀请 → 梦角接受（陪伴板块 TRANSITION_LINES.userInviteAccept 同款）
    const USER_INVITE_ACCEPT = ['我来了……', '来了来了，这局我要认真……', '棋盘都备好了……'];
    // 用户邀请 → 梦角拒绝（companion.js REJECT_LINES 同款）
    const USER_INVITE_REJECT = ['现在有点事，下次吧', '抱歉，现在没空', '还在忙，晚点再陪你玩', '等我一会儿，现在不行'];
    // 梦角邀请 → 用户拒绝（TRANSITION_LINES.partnerInviteReject 同款）
    const PARTNER_INVITE_REJECT = ['好，下次玩……', '好，你先忙……', '下次再来一局……'];
    // 梦角邀请 → 用户接受（TRANSITION_LINES.partnerInviteAccept 同款）
    const PARTNER_INVITE_ACCEPT = ['我在等你……', '等你好久了……', '你终于来了……'];
    // 用户认输
    const USER_FORFEIT = ['这局算你赢……', '我认输了……', '下不过你了……'];
    // 梦角认输（wuziqi.js PARTNER_FORFEIT_LINES 同款）
    const PARTNER_FORFEIT = ['我认输了……', '你赢了呢，这局我认输', '这局让给你啦'];
    // 用户中途退出（TRANSITION_LINES.userExit 同款）
    const USER_EXIT = ['那下次再玩……', '那这次先到这里……'];
    // 梦角中途退出（companion.js FAREWELL_LINES 同款）
    const PARTNER_EXIT = ['有点事，我先走了', '突然有点事，下次再跟你玩', '抱歉，得走了', '我先离开了，你继续'];
    // 结束（正常打完）
    const GAME_OVER = ['这局结束啦……', '玩得开心，下次再来……', '好险，差点就赢了……'];

    /* ─── 小工具 ───────────────────────────────────────── */

    const pick = arr => arr[Math.floor(Math.random() * arr.length)];

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function partnerName() {
        return window.settings?.partnerName ||
            document.getElementById('partner-name')?.textContent.trim() ||
            '梦角';
    }

    function partnerAvatar() {
        const img = document.querySelector('#partner-avatar img,[id*="partner-avatar"] img,.partner-avatar img');
        return img ? img.src : null;
    }

    function chatEvent(icon, label, detail) {
        if (typeof window._addCallEvent === 'function') {
            try { window._addCallEvent(icon, label, detail); } catch (e) { /* ignore */ }
        }
    }

    function notify(text, kind) {
        if (typeof window.showNotification === 'function') {
            try { window.showNotification(text, kind || 'info'); } catch (e) { /* ignore */ }
        }
    }

    /* ─── 过渡画面（与 companion.js:473 showCompanionTransition 同款）────────
       直接复用 .companion-transition 的样式和时序：
       下一帧加 active 渐入 → 3.5s 后渐出 → 再 1s 移除并回调 */
    let _transitionTimers = [];

    function showTransition(text, onComplete) {
        _transitionTimers.forEach(t => clearTimeout(t));
        _transitionTimers = [];
        document.querySelectorAll('.companion-transition').forEach(el => el.remove());

        const src = partnerAvatar();
        const avatarHtml = src
            ? `<img src="${src}">`
            : `<i class="fas fa-user"></i>`;

        const el = document.createElement('div');
        el.className = 'companion-transition';
        el.innerHTML = `
            <div class="stars"></div>
            <div class="glow"></div>
            <div class="companion-transition-message">
                <div class="companion-transition-avatar">${avatarHtml}</div>
                <div class="companion-transition-bubble">${esc(text)}</div>
            </div>
        `;
        document.documentElement.appendChild(el);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => el.classList.add('active'));
        });

        const t1 = setTimeout(() => {
            el.classList.remove('active');
            const t2 = setTimeout(() => {
                if (el.isConnected) el.remove();
                if (typeof onComplete === 'function') onComplete();
            }, 1000);
            _transitionTimers.push(t2);
        }, 3500);
        _transitionTimers.push(t1);
    }

    /* ─── 六个游戏的接入表 ───────────────────────────────
       label/icon  : 邀请页与聊天记录用
       start()     : 面板打开后真正点「开始」
       state()     : { turn:'ta'|'user'|null, over:bool, started:bool }
       forfeit(who): 'user' | 'partner'，由各游戏自己的结算函数接管
       quit()      : 关掉面板 */

    const G = window.MiniGames?.GAMES || [];

    function findGame(key) { return G.find(x => x.key === key); }

    function clickIfPresent(id) {
        const el = document.getElementById(id);
        if (!el || el.hidden) return false;
        try { el.click(); return true; } catch (e) { return false; }
    }

    const ADAPTER = {
        wuziqi: {
            label: '五子棋', icon: 'fa-chess-board', panel: 'wuziqi-page', panelClass: 'active',
            start() {
                // 棋盘 openDirect 就绪，第一回合就是用户
                return true;
            },
            state() {
                const s = window.wuziqiModule?._debug?.state;
                if (!s) return { turn: null, over: true, started: false };
                return { turn: s.turn === 2 ? 'ta' : (s.turn === 1 ? 'user' : null), over: !!s.gameOver, started: true };
            },
            forfeit(who) {
                const d = window.wuziqiModule?._debug;
                if (!d) return;
                // forceEnd 的入参是「谁认输」（wuziqi.js:464/470）
                d.forceEnd(who === 'user' ? 'userForfeit' : 'partnerForfeit');
            },
            quit() { window.wuziqiModule?.closeDirect?.(); },
        },
        ms: {
            label: '合作扫雷', icon: 'fa-bomb', panel: 'chat-ms-panel',
            start() { return clickIfPresent('ms-btn-start'); },
            state() {
                const s = window.__msDebug?.st?.();
                if (!s || !s.started) return { turn: null, over: true, started: false };
                return { turn: s.turn === 2 ? 'ta' : (s.turn === 1 ? 'user' : null), over: !!s.over, started: true };
            },
            forfeit(who) { window.__msDebug?.forfeit?.(who); },
            quit() { window.closeMsPanel?.(); },
        },
        fishing: {
            label: '钓鱼', icon: 'fa-fish-finned', panel: 'chat-fish-panel',
            start() { return true; },   // 打开即可钓，没有开始按钮
            state() {
                const s = window.__fishDebug?.state?.();
                if (!s || !s.open) return { turn: null, over: true, started: false };
                return { turn: s.ta === 'biting' || s.ta === 'waiting' ? 'ta' : 'user', over: false, started: true };
            },
            forfeit() { /* 钓鱼无胜负，认输 = 收起鱼竿（收官） */ window.closeFishPanel?.(); window.MiniGameSocial?.endSession?.(); },
            quit() { window.closeFishPanel?.(); window.MiniGameSocial?.endSession?.(); },
        },
        memory: {
            label: '记忆翻牌', icon: 'fa-clone', panel: 'chat-memory-panel',
            start() { return clickIfPresent('memory-overlay-btn'); },
            state() {
                const g = window.__mgmDebug?.st?.();
                if (!g || !g.cards || !g.cards.length) return { turn: null, over: true, started: false };
                // 结束时仍报 started，监视器才能收到 over 并收掉会话
                const ended = g.phase === 'ended';
                return { turn: ended ? null : (g.turn === 'ta' ? 'ta' : 'user'), over: ended, started: true };
            },
            forfeit(who) { window.__mgmDebug?.forfeit?.(who); },
            quit() { window.closeMemoryPanel?.(); },
        },
        linkup: {
            label: '连连看', icon: 'fa-link', panel: 'chat-linkup-panel',
            start() { return clickIfPresent('lk-btn-start'); },
            state() {
                const s = window.__lkDebug?.st?.();
                if (!s || !s.started) return { turn: null, over: true, started: false };
                return { turn: s.turn === 2 ? 'ta' : (s.turn === 1 ? 'user' : null), over: !!s.over, started: true };
            },
            forfeit(who) { window.__lkDebug?.forfeit?.(who); },
            quit() { window.closeLinkupPanel?.(); },
        },
        match3: {
            label: '消消乐', icon: 'fa-cubes', panel: 'chat-match3-panel',
            start() { return clickIfPresent('m3-btn-start'); },
            state() {
                const s = window.__m3Debug?.st?.();
                if (!s || !s.started) return { turn: null, over: true, started: false };
                return { turn: s.turn === 2 ? 'ta' : (s.turn === 1 ? 'user' : null), over: !!s.over, started: true };
            },
            forfeit(who) { window.__m3Debug?.forfeit?.(who); },
            quit() { window.closeMatch3Panel?.(); },
        },
    };

    function meta(key) {
        const a = ADAPTER[key];
        if (!a) return null;
        const g = findGame(key);
        return { key, label: a.label, icon: a.icon, adapter: a, game: g };
    }

    /* ─── 运行时状态 ───────────────────────────────────── */

    let _sessionKey = null;      // 正在一起玩的游戏 key
    let _sessionInitiator = null; // 'user' | 'partner'
    let _turnSeen = 0;           // 已经过的对方回合数（认输前置条件）
    let _lastTurn = null;
    let _invitingTimer = null;
    let _autoTimer = null;
    let _quitTimer = null;
    let _watchTimer = null;
    let _forceResult = null;     // 测试：'reject' | 'accept'
    let _forcePartnerForfeit = false;
    let _forcePartnerQuit = false;
    let _quitConfirmOpen = false;

    function isBusy() {
        if (_sessionKey) return true;
        if (document.getElementById('companion-page')?.classList.contains('active')) return true;
        if (document.getElementById('wuziqi-page')?.classList.contains('active')) return true;
        if (document.getElementById('call-window')?.classList.contains('visible')) return true;
        if (document.getElementById('call-incoming-overlay')?.classList.contains('visible')) return true;
        if (document.getElementById('call-mini-pill')?.classList.contains('visible')) return true;
        if (document.querySelector('.companion-transition, .mg-inviting-overlay, .mg-incoming-overlay')) return true;
        // 用户自己正在玩某个小游戏（未经邀请流程直接打开的）时，不弹梦角的邀请
        if (document.querySelector('.pong-page:not([hidden]), .c4-page:not([hidden]), .mg-game-hub.open, #minigames-page.active')) {
            const panelOpen = Array.from(document.querySelectorAll('.pong-page, .c4-page'))
                .some(el => !el.hidden && el.offsetParent !== null);
            if (panelOpen) return true;
        }
        return false;
    }

    function stopInvite() {
        clearTimeout(_invitingTimer); _invitingTimer = null;
        document.querySelectorAll('.mg-inviting-overlay').forEach(el => el.remove());
    }

    function stopIncoming() {
        document.querySelectorAll('.mg-incoming-overlay').forEach(el => el.remove());
    }

    /* ─── 用户发起邀请 ─────────────────────────────────── */

    function invite(key, opts) {
        const m = meta(key);
        if (!m) return false;
        opts = opts || {};
        if (isBusy()) { notify('现在不方便', 'info'); return false; }

        window.MiniGames?.open?.();

        const avSrc = partnerAvatar();
        const overlay = document.createElement('div');
        overlay.className = 'mg-inviting-overlay';
        const sessionId = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        overlay.dataset.sessionId = sessionId;
        overlay.innerHTML = `
            <div class="mg-inviting-card">
                <div class="mg-inviting-title">邀请${esc(partnerName())}一起玩</div>
                <div class="mg-inviting-game"><i class="fas ${m.icon}"></i><span>${esc(m.label)}</span></div>
                <div class="mg-inviting-av">
                    <div class="mg-inviting-ring"></div>
                    <div class="mg-inviting-av-img">${avSrc ? `<img src="${avSrc}">` : '<i class="fas fa-user"></i>'}</div>
                </div>
                <div class="mg-inviting-dots"><span></span><span></span><span></span></div>
                <div class="mg-inviting-wait">等待${esc(partnerName())}回应…</div>
                <button class="mg-inviting-cancel" id="mg-social-cancel">
                    <i class="fas fa-xmark"></i>
                    <span>取消</span>
                </button>
            </div>
        `;
        document.documentElement.appendChild(overlay);

        overlay.querySelector('#mg-social-cancel').addEventListener('click', () => {
            clearTimeout(_invitingTimer); _invitingTimer = null;
            overlay.remove();
            chatEvent('fa-circle-xmark', `取消了对${partnerName()}的${m.label}邀请`, null);
        });

        const forced = _forceResult;
        _forceResult = null;   // 用完即清，避免影响下一次（与 wuziqi.js:648 一致）

        const willReject = forced === 'reject' ? true
            : forced === 'accept' ? false
            : Math.random() < REJECT_CHANCE;

        const stillThis = () => {
            const el = document.querySelector('.mg-inviting-overlay');
            return el && el.dataset.sessionId === sessionId;
        };

        if (willReject) {
            const delay = 4000 + Math.random() * 8000;
            _invitingTimer = setTimeout(() => {
                if (!stillThis()) return;
                overlay.remove();
                chatEvent('fa-heart-crack', `${partnerName()}拒绝了对${m.label}的邀请`, null);
                notify(`${partnerName()} 拒绝了${m.label}邀请`, 'info');
                showTransition(`${pick(USER_INVITE_REJECT)}……`);
            }, delay);
        } else {
            const delay = 1000 + Math.random() * 2000;
            _invitingTimer = setTimeout(() => {
                if (!stillThis()) return;
                overlay.remove();
                showTransition(pick(USER_INVITE_ACCEPT), () => {
                    beginSession(key, 'user', { skipTransition: true });
                });
            }, delay);
        }
        return true;
    }

    /* ─── 梦角发起邀请 ─────────────────────────────────── */

    function showIncoming(key) {
        const m = meta(key);
        if (!m) return false;
        if (isBusy()) return false;
        if (typeof window._cinemaShouldBlockInterruptions === 'function'
            && window._cinemaShouldBlockInterruptions()) return false;

        const name = partnerName();
        const avSrc = partnerAvatar();
        const line = pick(INVITE_LINES[key] || INVITE_LINES.study);

        stopIncoming();
        const overlay = document.createElement('div');
        overlay.className = 'mg-incoming-overlay';
        overlay.dataset.game = key;
        overlay.innerHTML = `
            <div class="mg-incoming-card">
                <div class="mg-incoming-av">
                    <div class="mg-incoming-ring"></div>
                    <div class="mg-incoming-ring second"></div>
                    <div class="mg-incoming-av-img">${avSrc ? `<img src="${avSrc}">` : '<i class="fas fa-user"></i>'}</div>
                </div>
                <div class="mg-incoming-name">${esc(name)}</div>
                <div class="mg-incoming-status"><span class="mg-dot"></span>想和你一起玩…</div>
                <div class="mg-incoming-quote"><i class="fas ${m.icon}"></i><span>“${esc(line)}”</span></div>
                <div class="mg-incoming-btns">
                    <button class="mg-btn-reject" id="mg-social-reject">
                        <div class="mg-btn-circle reject"><i class="fas fa-xmark"></i></div>
                        <span>拒绝</span>
                    </button>
                    <button class="mg-btn-accept" id="mg-social-accept">
                        <div class="mg-btn-circle accept"><i class="fas fa-heart"></i></div>
                        <span>接受</span>
                    </button>
                </div>
            </div>
        `;
        document.documentElement.appendChild(overlay);

        // 后台推送通知
        try {
            if (typeof window._sendPartnerNotification === 'function') {
                window._sendPartnerNotification(name + ' 邀请你玩游戏', `想和你一起玩${m.label}，快来看看吧 ✨`);
            }
        } catch (e) { /* ignore */ }

        // 60 秒未接听自动消失 → 错过
        const autoTimer = setTimeout(() => {
            if (!overlay.isConnected) return;
            overlay.remove();
            chatEvent('fa-heart-crack', `错过了${name}的${m.label}邀请`, null);
            stopIncoming();
        }, 60000);

        overlay.querySelector('#mg-social-reject').addEventListener('click', () => {
            clearTimeout(autoTimer);
            overlay.remove();
            chatEvent('fa-heart-crack', `我拒绝了这次${m.label}邀请`, null);
            showTransition(pick(PARTNER_INVITE_REJECT));
        });

        overlay.querySelector('#mg-social-accept').addEventListener('click', () => {
            clearTimeout(autoTimer);
            overlay.remove();
            showTransition(pick(PARTNER_INVITE_ACCEPT), () => {
                beginSession(key, 'partner', { skipTransition: true });
            });
        });

        return true;
    }

    /* ─── 真正开局 ─────────────────────────────────────── */

    function beginSession(key, initiator, opts) {
        opts = opts || {};
        const m = meta(key);
        if (!m) return false;

        const go = () => {
            window.MiniGames?.openGame?.(key);
            setTimeout(() => { try { m.adapter.start(); } catch (e) { /* ignore */ } }, 260);
            _sessionKey = key;
            _sessionInitiator = initiator;
            _turnSeen = 0;
            _lastTurn = null;
            buildControlBar(m);
            startWatch();
            startPartnerQuitCheck();
            if (typeof window._sendPartnerNotification === 'function') {
                try { window._sendPartnerNotification(
                    '开始一起玩' + m.label,
                    (initiator === 'user' ? nameOrMe() : partnerName()) + ' 邀请你一起玩' + m.label
                ); } catch (e) { /* ignore */ }
            }
        };

        if (opts.skipTransition) { go(); return true; }
        showTransition(pick(GAME_OVER), go);
        return true;
    }

    function nameOrMe() {
        return window.settings?.myName || '我';
    }

    /* ─── 局中控制条（用户侧：认输 / 退出） ─────────────── */

    function controlBar() {
        return document.getElementById('mg-social-bar');
    }

    function buildControlBar(m) {
        removeControlBar();
        const bar = document.createElement('div');
        bar.id = 'mg-social-bar';
        bar.className = 'mg-social-bar';
        bar.innerHTML = `
            <div class="mg-bar-who"><i class="fas ${m.icon}"></i><span>${esc(m.label)}</span></div>
            <button class="mg-bar-btn forfeit" id="mg-bar-forfeit"><i class="fas fa-flag"></i><span>认输</span></button>
            <button class="mg-bar-btn quit" id="mg-bar-quit"><i class="fas fa-door-open"></i><span>退出</span></button>
        `;
        document.body.appendChild(bar);

        bar.querySelector('#mg-bar-forfeit').addEventListener('click', () => {
            confirmThen('认输', `确定要认输吗？这局算${partnerName()}赢。`, () => userForfeit(m));
        });
        bar.querySelector('#mg-bar-quit').addEventListener('click', () => {
            confirmThen('退出游戏', '确定要中途退出吗？', () => userQuit(m));
        });
    }

    function removeControlBar() {
        const b = controlBar();
        if (b) b.remove();
    }

    function confirmThen(title, body, onOk) {
        if (_quitConfirmOpen) return;
        _quitConfirmOpen = true;
        const box = document.createElement('div');
        box.className = 'mg-confirm';
        box.innerHTML = `
            <div class="mg-confirm-card">
                <div class="mg-confirm-title">${esc(title)}</div>
                <div class="mg-confirm-body">${esc(body)}</div>
                <div class="mg-confirm-btns">
                    <button class="mg-confirm-no" id="mg-confirm-no">再想想</button>
                    <button class="mg-confirm-yes" id="mg-confirm-yes">确定</button>
                </div>
            </div>
        `;
        document.body.appendChild(box);
        const done = () => { _quitConfirmOpen = false; if (box.isConnected) box.remove(); };
        box.querySelector('#mg-confirm-no').addEventListener('click', done);
        box.querySelector('#mg-confirm-yes').addEventListener('click', () => { done(); onOk(); });
    }

    /* ─── 用户认输 / 退出 ──────────────────────────────── */

    // 用户认输：先把游戏本身推进到「认输结算页」（面板留着），
    // 再盖一层过渡画面把认输台词演出来。顺序和陪伴板块的告别一致。
    function userForfeit(m) {
        try { m.adapter.forfeit('user'); } catch (e) { /* ignore */ }
        // keepPanel：让游戏自己的认输结算页留在屏幕上，别把面板关掉
        endSession({ keepPanel: true });
        showTransition(pick(USER_FORFEIT), () => {
            chatEvent(m.icon, `${partnerName()}赢了这局${m.label}`, null);
        });
    }

    function userQuit(m) {
        endSession();
        showTransition(pick(USER_EXIT), () => {
            chatEvent('fa-door-open', `中途退出了${m.label}`, null);
        });
    }

    /* ─── 梦角认输 / 中途退出 ──────────────────────────── */

    // 梦角认输：同样先把游戏推到认输结算页，面板留着给用户看结果。
    function partnerForfeit(m) {
        if (!_sessionKey) return;
        try { m.adapter.forfeit('partner'); } catch (e) { /* ignore */ }
        chatEvent(m.icon, `${partnerName()}认输了`, null);
        endSession({ keepPanel: true });
        showTransition(pick(PARTNER_FORFEIT));
    }

    function partnerQuit(m) {
        if (!_sessionKey) return;
        endSession();
        chatEvent('fa-door-open', `${partnerName()}中途退出了${m.label}`, null);
        showTransition(`${pick(PARTNER_EXIT)}……`);
    }

    /* ─── 结束一局（停掉所有计时器与控制条） ───────────── */

    function endSession(opts) {
        opts = opts || {};
        clearInterval(_watchTimer); _watchTimer = null;
        clearTimeout(_quitTimer); _quitTimer = null;
        removeControlBar();
        const key = _sessionKey;
        const m = key ? meta(key) : null;
        _sessionKey = null;
        _sessionInitiator = null;
        _turnSeen = 0; _lastTurn = null;
        if (!opts.keepPanel && m) {
            try { m.adapter.quit(); } catch (e) { /* ignore */ }
        }
        if (!opts.keepPanel) {
            try { window.MiniGames?.closeAllGames?.(); } catch (e) { /* ignore */ }
        }
    }

    /* ─── 回合监视：对方认输（5%） ─────────────────────── */

    function startWatch() {
        clearInterval(_watchTimer);
        _watchTimer = setInterval(() => {
            if (!_sessionKey) { clearInterval(_watchTimer); _watchTimer = null; return; }
            const m = meta(_sessionKey);
            if (!m) { endSession(); return; }
            let s;
            try { s = m.adapter.state(); } catch (e) { return; }

            // 面板被关掉（用户手动关、收竿、认输结算后自己关）→ 收掉会话，
            // 否则控制条会残留、对方还可能继续认输/退出
            if (m.panel) {
                const el = document.getElementById(m.panel);
                const shown = m.panelClass
                    ? !!el && el.classList.contains(m.panelClass)
                    : !!el && !el.hidden && el.getClientRects().length > 0;
                if (!shown) { endSession(); return; }
            }

            if (!s || !s.started) return;

            // 测试强制认输：不受「满 10 回合」限制，立刻触发
            if (_forcePartnerForfeit) {
                _forcePartnerForfeit = false;
                partnerForfeit(m);
                return;
            }

            if (s.turn !== _lastTurn) {
                _lastTurn = s.turn;
                if (s.turn === 'ta') _turnSeen++;
                // 对方满 10 回合后，每次轮到对方都有 5% 认输（五子棋同概率）
                if (s.turn === 'ta' && _turnSeen >= FORFEIT_MIN_TURN) {
                    if (Math.random() < PARTNER_FORFEIT_CHANCE) {
                        partnerForfeit(m);
                        return;
                    }
                }
            }

            // 局终（对方赢/打完）也收掉会话
            if (s.over) {
                const label = m.label;
                endSession({ keepPanel: true });
                showTransition(pick(GAME_OVER), () => {
                    chatEvent(m.icon, `一局${label}结束了`, null);
                });
            }
        }, 700);
    }

    /* ─── 梦角中途退出（3%，5 分钟一查） ───────────────── */

    function startPartnerQuitCheck() {
        clearTimeout(_quitTimer);
        _quitTimer = setTimeout(function tick() {
            if (!_sessionKey) { _quitTimer = null; return; }
            const m = meta(_sessionKey);
            if (!m) { endSession(); return; }
            if (Math.random() < PARTNER_QUIT_CHANCE) {
                partnerQuit(m);
                return;
            }
            _quitTimer = setTimeout(tick, PARTNER_QUIT_CHECK_MS);
        }, PARTNER_QUIT_CHECK_MS);
    }

    /* ─── 随机主动邀请（= 语音通话概率） ───────────────── */

    function scheduleRandomGameInvite() {
        clearTimeout(_autoTimer);
        const ms = (RANDOM_CHECK_MIN_MIN + Math.random() * (RANDOM_CHECK_MAX_MIN - RANDOM_CHECK_MIN_MIN)) * 60 * 1000;
        _autoTimer = setTimeout(() => {
            if (Math.random() < PROACTIVE_INVITE_CHANCE) {
                try { showIncoming(pickRandomGameKey()); } catch (e) { /* ignore */ }
            }
            scheduleRandomGameInvite();
        }, ms);
    }

    function stopRandomGameInvite() {
        clearTimeout(_autoTimer);
        _autoTimer = null;
    }

    function pickRandomGameKey() {
        const keys = Object.keys(ADAPTER);
        return keys[Math.floor(Math.random() * keys.length)];
    }

    function triggerRandomGameInvite(key) {
        stopRandomGameInvite();
        showIncoming(key || pickRandomGameKey());
        scheduleRandomGameInvite();
    }

    /* ─── 对外接口 ─────────────────────────────────────── */

    window.MiniGameSocial = {
        invite,
        showIncoming,
        endSession,
        stopRandomGameInvite,
        scheduleRandomGameInvite,

        // 测试钩子
        testInviteReject: (key) => { _forceResult = 'reject'; return invite(key); },
        testInviteAccept: (key) => { _forceResult = 'accept'; return invite(key); },
        testIncoming: (key) => showIncoming(key),
        testPartnerForfeit: () => {
            _forcePartnerForfeit = true;
            // 监视器每 700ms 跑一次，最多等 1.5s 就该看到结算页
            return true;
        },
        testPartnerQuit: () => {
            _forcePartnerQuit = false;
            const key = _sessionKey;
            if (!key) return false;
            const m = meta(key);
            if (!m) return false;
            partnerQuit(m);
            return true;
        },
        testGameOver: () => {
            const key = _sessionKey || 'wuziqi';
            const m = meta(key);
            if (m) { endSession({ keepPanel: true }); showTransition(pick(GAME_OVER)); }
        },

        // 状态
        get sessionKey() { return _sessionKey; },
        get sessionInitiator() { return _sessionInitiator; },
        isSessionActive: () => !!_sessionKey,

        // 概率常量（便于核对）
        PROBABILITIES: {
            proactiveInvite: PROACTIVE_INVITE_CHANCE,
            inviteRejected: REJECT_CHANCE,
            partnerForfeit: PARTNER_FORFEIT_CHANCE,
            partnerQuit: PARTNER_QUIT_CHANCE,
        },
        ADAPTER,
    };

    // 页面载入后开始随机调度
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleRandomGameInvite);
    } else {
        scheduleRandomGameInvite();
    }

    // 用户从六宫格直接退出板块时，如果正在局中也一并收干净
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.id === 'minigames-exit-btn' && _sessionKey) endSession();
    }, true);
})();