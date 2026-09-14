/**
 * wuziqi.js — 五子棋对弈模块（陪伴功能板块 · 五子棋）
 * 对弈逻辑移植自 yinselis.github.io/Trace 的五子棋（gomoku）
 * 邀请/拒绝/随机主动邀请概率 参考 companion.js 的陪伴功能板块
 * 依赖：localforage, APP_PREFIX, getStorageKey, showNotification, _addCallEvent
 */

(function () {
    'use strict';

    // ─── 常量 ────────────────────────────────────────────────────────────────

    const STORAGE_KEY = 'wuziqiData';

    // 梦角拒绝用户邀请的概率（与陪伴板块一致：0.35）
    const REJECT_CHANCE = 0.35;
    // 梦角主动邀请的随机调度（与陪伴板块一致：15~60 分钟检查一次，25% 概率发起）
    const RANDOM_CHECK_MIN_MIN = 15;
    const RANDOM_CHECK_MAX_MIN = 60;
    const RANDOM_FIRE_CHANCE = 0.25;

    const BUBBLE_LINES = [
        '这一步走这里吧。',
        '看我的哦！',
        '小心了？',
        '你下得好快呀…',
        '棋子放这里比较靠近你。',
        '陪你下一局真开心。',
        '哈哈，这步妙手！',
        '再让我想想哦…',
        '我这步可不简单。',
        '要追上你了！',
        '棋盘上认真的人最可爱。',
    ];

    const INVITE_QUOTES = [
        '要不要一起下局五子棋？',
        '想找个人下五子棋了，陪我玩会儿好吗？',
        '一起切磋一下棋局吧？',
        '手有点痒了，来一局五子棋吧？',
        '五子棋大战，敢不敢来？',
    ];

    // 用户邀请 → 梦角接受 / 拒绝 的过渡台词（第一人称）
    const ACCEPT_LINES = [
        '我来了……',
        '好，陪你下一局……',
        '棋盘都备好了……',
        '来了来了，这局我要认真……',
    ];
    const REJECT_LINES = [
        '现在有点事，下次吧',
        '还在忙，晚点再陪你下',
        '这局先欠着，下次补给你',
        '抱歉，现在没空陪你下棋',
    ];
    // 梦角邀请 → 用户拒绝 的过渡台词
    const PARTNER_REJECT_LINES = [
        '好，下次再下……',
        '那下次找你……',
        '棋局先留到下次……',
        '这次先算了，下次赢你……',
    ];
    // 梦角主动认输时的小气泡
    const PARTNER_FORFEIT_LINES = [
        '我认输了……',
        '你赢了呢，这局我认输',
        '下不过你了，认输啦',
        '你太厉害，这局让给你啦',
    ];

    // ─── 运行状态 ──────────────────────────────────────────────────────────

    let wzData = { wins: 0, loses: 0, forfeits: 0, games: 0, history: [] };

    let gomokuSize = 9;     // 默认速战 9x9（与 Trace 一致）
    let diff = 'ai';        // 'ai' | 'random'
    let board = [];         // 0 空 | 1 我(黑) | 2 Ta(白)
    let turn = 1;           // 1 我 | 2 Ta
    let gameOver = false;
    let moveCount = 0;
    let canvas = null, ctx = null, cell = 0;

    let _sessionInitiator = 'user';   // 'user' | 'partner'
    let _forceResult = null;          // 测试：'reject' | 'accept' | null
    let _invitingTimer = null;
    let _autoTimer = null;
    let _transitionTimers = [];
    let _gameTimerInterval = null;
    let _gameStartAt = 0;
    let _elapsedBase = 0;
    let _lastSize = 9;

    // ─── 小工具 ────────────────────────────────────────────────────────────

    function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function getPartnerName() {
        return window.settings?.partnerName ||
            document.getElementById('partner-name')?.textContent.trim() ||
            '梦角';
    }
    function getMyName() { return window.settings?.myName || '我'; }

    function getPartnerAvatarSrc() {
        const img = document.querySelector('#partner-avatar img,[id*="partner-avatar"] img,.partner-avatar img');
        return img ? img.src : null;
    }
    function getMyAvatarSrc() {
        const img = document.querySelector('#my-avatar img,.my-avatar img');
        return img ? img.src : null;
    }

    function sendChatEvent(icon, label, detail) {
        if (typeof window._addCallEvent === 'function') {
            window._addCallEvent(icon, label, detail);
        } else {
            let tries = 0;
            const t = setInterval(() => {
                if (typeof window._addCallEvent === 'function') {
                    clearInterval(t);
                    window._addCallEvent(icon, label, detail);
                }
                if (++tries > 25) clearInterval(t);
            }, 200);
        }
    }

    function notify(msg, type) {
        if (typeof window.showNotification === 'function') {
            try { window.showNotification(msg, type || 'info'); } catch (e) {}
        }
    }

    function fmtClock(seconds) {
        seconds = Math.max(0, Math.floor(seconds || 0));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const pad = n => String(n).padStart(2, '0');
        if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
        return `${pad(m)}:${pad(s)}`;
    }
    function fmtTimeText(seconds) {
        seconds = Math.max(0, Math.floor(seconds || 0));
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
    }

    function dataKey() {
        return typeof getStorageKey === 'function'
            ? getStorageKey(STORAGE_KEY)
            : (window.APP_PREFIX || 'CHAT_APP_V3_') + STORAGE_KEY;
    }
    async function loadWzqData() {
        try {
            const saved = await localforage.getItem(dataKey());
            if (saved) wzData = Object.assign({ wins: 0, loses: 0, forfeits: 0, games: 0, history: [] }, saved);
        } catch (e) { console.warn('[wuziqi] 加载战绩失败', e); }
    }
    async function saveWzqData() {
        try { await localforage.setItem(dataKey(), wzData); }
        catch (e) { console.warn('[wuziqi] 保存战绩失败', e); }
    }

    // ─── 动画 keyframes（与 companion.js 共用命名）─────────────────────────
    function injectKeyframes() {
        if (document.getElementById('wuziqi-keyframes')) return;
        const style = document.createElement('style');
        style.id = 'wuziqi-keyframes';
        style.textContent = `
            @keyframes companionFadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes companionPopIn { from { opacity: 0; transform: scale(0.94) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            @keyframes companionPulseRing {
                0% { transform: scale(0.95); opacity: 0.6; }
                70% { transform: scale(1.15); opacity: 0; }
                100% { transform: scale(1.15); opacity: 0; }
            }
            @keyframes companionDot {
                0%, 60%, 100% { opacity: 0.3; transform: scale(1); }
                30% { opacity: 1; transform: scale(1.4); }
            }
        `;
        document.head.appendChild(style);
    }

    // ─── 过渡画面（复用 companion 的 .companion-transition 样式）────────────
    function showTransition(text, onComplete) {
        _transitionTimers.forEach(t => clearTimeout(t));
        _transitionTimers = [];
        document.querySelectorAll('.companion-transition').forEach(el => el.remove());

        const avSrc = getPartnerAvatarSrc();
        const avatarHtml = avSrc
            ? `<img src="${avSrc}">`
            : `<i class="fas fa-user"></i>`;

        const el = document.createElement('div');
        el.className = 'companion-transition';
        el.innerHTML = `
            <div class="stars"></div>
            <div class="glow"></div>
            <div class="companion-transition-message">
                <div class="companion-transition-avatar">${avatarHtml}</div>
                <div class="companion-transition-bubble">${escapeHtml(text)}</div>
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

    // ─── 对局流程（移植自 Trace gomoku）────────────────────────────────────

    function initBoard(size) {
        gomokuSize = size;
        _lastSize = size;
        turn = 1;
        gameOver = false;
        moveCount = 0;
        board = [];
        for (let i = 0; i < size; i++) board[i] = new Array(size).fill(0);

        canvas = document.getElementById('wuziqi-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');

        // 自适应屏幕大小
        const maxW = Math.min(window.innerWidth - 48, 420);
        cell = Math.floor(maxW / (size + 1));
        canvas.width = cell * (size + 1);
        canvas.height = cell * (size + 1);

        drawBoard();
    }

    function drawBoard() {
        if (!ctx || !canvas) return;
        ctx.fillStyle = '#faf9f2';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#b9b3a6';
        ctx.lineWidth = 1;
        for (let i = 0; i < gomokuSize; i++) {
            ctx.beginPath();
            ctx.moveTo(cell, cell + i * cell);
            ctx.lineTo(canvas.width - cell, cell + i * cell);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cell + i * cell, cell);
            ctx.lineTo(cell + i * cell, canvas.height - cell);
            ctx.stroke();
        }
        for (let r = 0; r < gomokuSize; r++) {
            for (let c = 0; c < gomokuSize; c++) {
                if (board[r][c] !== 0) drawStone(c, r, board[r][c]);
            }
        }
    }

    function drawStone(c, r, player) {
        ctx.beginPath();
        ctx.arc(cell + c * cell, cell + r * cell, cell * 0.4, 0, 2 * Math.PI);
        ctx.fillStyle = player === 1 ? '#16161a' : '#f7f5ef';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#16161a';
        ctx.stroke();
        // 轻微高光
        if (player === 1) {
            ctx.beginPath();
            ctx.arc(cell + c * cell - cell * 0.12, cell + r * cell - cell * 0.12, cell * 0.09, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fill();
        }
    }

    function doUserMove(row, col) {
        if (gameOver || turn !== 1) return false;
        if (col < 0 || col >= gomokuSize || row < 0 || row >= gomokuSize) return false;
        if (board[row][col] !== 0) return false;
        board[row][col] = 1;
        moveCount++;
        drawBoard();
        if (checkWin(row, col, 1)) {
            endGame('user');
            return true;
        }
        turn = 2;
        setTimeout(taMakeMove, 600 + Math.random() * 800); // 模拟思考延迟
        return true;
    }

    function taMakeMove() {
        if (gameOver) return;
        let bestMoves = [];
        if (diff === 'random') {
            for (let r = 0; r < gomokuSize; r++) {
                for (let c = 0; c < gomokuSize; c++) {
                    if (board[r][c] === 0) bestMoves.push({ r, c });
                }
            }
        } else {
            let bestScore = -1;
            for (let r = 0; r < gomokuSize; r++) {
                for (let c = 0; c < gomokuSize; c++) {
                    if (board[r][c] === 0) {
                        const score = evaluatePos(r, c, 2) * 1.1 + evaluatePos(r, c, 1);
                        if (score > bestScore) { bestScore = score; bestMoves = [{ r, c }]; }
                        else if (score === bestScore) bestMoves.push({ r, c });
                    }
                }
            }
        }

        if (bestMoves.length > 0) {
            const move = bestMoves[Math.floor(Math.random() * bestMoves.length)];
            board[move.r][move.c] = 2;
            moveCount++;
            drawBoard();

            // Ta 落子时的小气泡（30% 概率）
            if (Math.random() < 0.3) showTaBubble(pickRandom(BUBBLE_LINES));

            if (checkWin(move.r, move.c, 2)) { endGame('partner'); return; }
            // 双方都可以认输：梦角偶尔主动认输（开局一段时间后、低概率）
            if (moveCount >= 10 && Math.random() < 0.05) { doPartnerForfeit(); return; }
            turn = 1;
        }
    }

    function evaluatePos(r, c, player) {
        let score = 0;
        const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
        dirs.forEach(d => {
            let count = 1, open = 0;
            for (let step = 1; step <= 4; step++) {
                const nr = r + d[0] * step, nc = c + d[1] * step;
                if (nr >= 0 && nr < gomokuSize && nc >= 0 && nc < gomokuSize) {
                    if (board[nr][nc] === player) count++;
                    else if (board[nr][nc] === 0) { open++; break; }
                    else break;
                } else break;
            }
            for (let step = 1; step <= 4; step++) {
                const nr = r - d[0] * step, nc = c - d[1] * step;
                if (nr >= 0 && nr < gomokuSize && nc >= 0 && nc < gomokuSize) {
                    if (board[nr][nc] === player) count++;
                    else if (board[nr][nc] === 0) { open++; break; }
                    else break;
                } else break;
            }
            if (count >= 5) score += 100000;
            else if (count === 4 && open === 2) score += 10000;
            else if (count === 4 && open === 1) score += 1000;
            else if (count === 3 && open === 2) score += 1000;
            else if (count === 3 && open === 1) score += 100;
            else if (count === 2 && open === 2) score += 100;
            else score += count;
        });
        return score;
    }

    function checkWin(r, c, player) {
        const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
        for (let d of dirs) {
            let count = 1;
            for (let step = 1; step <= 4; step++) {
                const nr = r + d[0] * step, nc = c + d[1] * step;
                if (nr >= 0 && nr < gomokuSize && nc >= 0 && nc < gomokuSize && board[nr][nc] === player) count++;
                else break;
            }
            for (let step = 1; step <= 4; step++) {
                const nr = r - d[0] * step, nc = c - d[1] * step;
                if (nr >= 0 && nr < gomokuSize && nc >= 0 && nc < gomokuSize && board[nr][nc] === player) count++;
                else break;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    function showTaBubble(text) {
        const bubble = document.getElementById('wuziqi-ta-bubble');
        if (!bubble) return;
        bubble.textContent = text;
        bubble.classList.add('show');
        clearTimeout(bubble._t);
        bubble._t = setTimeout(() => bubble.classList.remove('show'), 3000);
    }

    // ─── 对局计时（右上角玻璃球 · 正计时）───────────────────────────────────
    function startGameTimer() {
        stopGameTimer();
        _gameStartAt = Date.now();
        _elapsedBase = 0;
        updateTimerDisplay();
        _gameTimerInterval = setInterval(updateTimerDisplay, 1000);
    }
    function stopGameTimer() {
        if (_gameTimerInterval) clearInterval(_gameTimerInterval);
        _gameTimerInterval = null;
    }
    function getElapsed() {
        if (!_gameStartAt) return 0;
        return Math.floor((Date.now() - _gameStartAt) / 1000) + _elapsedBase;
    }
    function updateTimerDisplay() {
        const el = document.getElementById('wuziqi-timer-display');
        if (el) el.textContent = fmtClock(getElapsed());
    }

    // ─── 结束对局 ──────────────────────────────────────────────────────────

    function recordGame(result) {
        wzData.games++;
        if (result === 'win' || result === 'partnerForfeit') wzData.wins++;
        else if (result === 'lose') wzData.loses++;
        else wzData.forfeits++;
        wzData.history.unshift({ result, moves: moveCount, size: gomokuSize, ts: Date.now() });
        if (wzData.history.length > 30) wzData.history.length = 30;
        saveWzqData();
    }

    function endGame(winner) {
        if (gameOver) return;
        gameOver = true;
        stopGameTimer();

        const partnerName = getPartnerName();
        const titleEl = document.getElementById('wuziqi-result-title');
        const subEl = document.getElementById('wuziqi-result-sub');

if (winner === 'user') {
            recordGame('win');
            sendChatEvent('fa-trophy', `五子棋连下 ${moveCount} 手，你在 ${partnerName} 之前五连获胜`, null);
            notify('这局你赢了！', 'success');
            if (titleEl) titleEl.textContent = '你赢了 🎉';
            if (subEl) subEl.textContent = `${moveCount} 手击败了${partnerName} · 战况 ${wzData.wins}胜 ${wzData.loses}负`;
        } else if (winner === 'partner') {
            recordGame('lose');
            sendChatEvent('fa-trophy', `五子棋这局你输给了${partnerName}`, null);
            notify(`这局 ${partnerName} 赢了`, 'info');
            if (titleEl) titleEl.textContent = '这局你输了';
            if (subEl) subEl.textContent = `${partnerName} 率先五连 · 战况 ${wzData.wins}胜 ${wzData.loses}负`;
        } else if (winner === 'userForfeit') {
            recordGame('userForfeit');
            sendChatEvent('fa-flag', '你主动认输，结束了这局五子棋', null);
            notify('你主动认输啦', 'info');
            if (titleEl) titleEl.textContent = '你认输了';
            if (subEl) subEl.textContent = `本局到此结束 · 战况 ${wzData.wins}胜 ${wzData.loses}负`;
        } else if (winner === 'partnerForfeit') {
            recordGame('partnerForfeit');
            sendChatEvent('fa-flag', `${partnerName} 主动认输，你赢了这局五子棋`, null);
            notify(`${partnerName} 认输了，你赢啦！`, 'success');
            if (titleEl) titleEl.textContent = '你赢了！';
            if (subEl) subEl.textContent = `${partnerName} 主动认输 · 战况 ${wzData.wins}胜 ${wzData.loses}负`;
        }

        const resultBox = document.getElementById('wuziqi-result');
        if (resultBox) setTimeout(() => resultBox.classList.add('show'), 500);
    }

    function doPartnerForfeit() {
        if (gameOver) return;
        showTaBubble(pickRandom(PARTNER_FORFEIT_LINES));
        // 给气泡一点展示时间再弹出结果
        setTimeout(() => endGame('partnerForfeit'), 1000);
    }

    function restartGame() {
        const resultBox = document.getElementById('wuziqi-result');
        if (resultBox) resultBox.classList.remove('show');
        initBoard(_lastSize);
        updatePills(_lastSize);
        startGameTimer();
        const hint = document.getElementById('wuziqi-hint-text');
        if (hint) hint.textContent = '黑棋先行 · 点击棋盘落子';
    }

    // ─── 全屏对弈页 ────────────────────────────────────────────────────────

    function doOpenWuziqiPage(initiator) {
        _sessionInitiator = initiator || 'user';
        const partnerName = getPartnerName();

        const page = document.getElementById('wuziqi-page');
        if (!page) { notify('五子棋页面加载失败，请刷新重试', 'error'); return; }

        // 保护：如果正处于陪伴页，先把陪伴页收起来，避免层级冲突
        const cp = document.getElementById('companion-page');
        if (cp && cp.classList.contains('active')) cp.classList.remove('active');

        // 头像
        const meAv = document.getElementById('wuziqi-me-avatar');
        const taAv = document.getElementById('wuziqi-ta-avatar');
        if (meAv) meAv.src = getMyAvatarSrc() || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        if (taAv) taAv.src = getPartnerAvatarSrc() || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        const taName = document.getElementById('wuziqi-ta-name');
        if (taName) taName.innerHTML = escapeHtml(partnerName) + '<span class="wzq-stone wzq-stone-white"></span>';

        page.classList.add('active');
        document.body.style.overflow = 'hidden';
        document.querySelectorAll('#companion-modal-dynamic').forEach(el => el.remove());

        initBoard(_lastSize);
        updatePills(_lastSize);
        startGameTimer();

        const hint = document.getElementById('wuziqi-hint-text');
        if (hint) hint.textContent = '黑棋先行 · 点击棋盘落子';

        // 对弈开始留痕
        if (initiator === 'user') {
            sendChatEvent('fa-chess-board', `你对${partnerName}发起了五子棋对弈`, null);
        } else {
            sendChatEvent('fa-chess-board', `${partnerName}邀请你下了一局五子棋`, null);
        }
    }

    function closeWuziqiPage(silent) {
        const page = document.getElementById('wuziqi-page');
        if (page) page.classList.remove('active');
        document.body.style.overflow = '';
        document.querySelectorAll('#wuziqi-result').forEach(el => el.classList.remove('show'));
        document.querySelectorAll('#wuziqi-exit-confirm').forEach(el => el.classList.remove('active'));
        stopGameTimer();
        if (typeof window.stopCurrentSound === 'function') { try { window.stopCurrentSound(); } catch (e) {} }
        if (!silent) sendChatEvent('fa-chess-board', '五子棋对弈结束', null);
    }

    // 尺寸 / 难度 pill 高亮
    function updatePills(size) {
        document.querySelectorAll('#wuziqi-page .wzq-pill[data-size]').forEach(b => {
            b.classList.toggle('active', String(b.getAttribute('data-size')) === String(size));
        });
    }

    // ─── 用户主动邀请 ──────────────────────────────────────────────────────

    function startInviting() {
        const page = document.getElementById('wuziqi-page');
        if (page && page.classList.contains('active')) return;

        // 收起陪伴选择弹窗
        document.querySelectorAll('#companion-modal-dynamic').forEach(el => el.remove());
        const staticModal = document.getElementById('companion-modal');
        if (staticModal) staticModal.classList.remove('active');

        showWuziqiInviting();
    }

    function showWuziqiInviting() {
        const partnerName = getPartnerName();
        const avSrc = getPartnerAvatarSrc();

        document.querySelectorAll('#wuziqi-inviting-overlay').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.id = 'wuziqi-inviting-overlay';
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(15,15,20,0.92)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'animation:companionFadeIn 0.3s ease',
        ].join(';'));

        const avatarHtml = avSrc
            ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user" style="font-size:34px;color:rgba(255,255,255,.85);"></i>`;

        overlay.innerHTML = `
            <div style="
                display:flex;flex-direction:column;align-items:center;gap:18px;
                color:#fff;animation:companionPopIn 0.4s ease;
            ">
                <div style="position:relative;width:96px;height:96px;">
                    <div style="
                        position:absolute;inset:-6px;border-radius:50%;
                        border:2px solid rgba(var(--accent-color-rgb,197,164,126),0.5);
                        animation:companionPulseRing 1.6s ease-out infinite;
                    "></div>
                    <div style="
                        position:absolute;inset:-14px;border-radius:50%;
                        border:2px solid rgba(var(--accent-color-rgb,197,164,126),0.3);
                        animation:companionPulseRing 1.6s ease-out infinite 0.5s;
                    "></div>
                    <div style="
                        width:96px;height:96px;border-radius:50%;overflow:hidden;
                        background:rgba(255,255,255,0.1);
                        display:flex;align-items:center;justify-content:center;
                        border:2px solid rgba(255,255,255,0.15);
                        position:relative;z-index:1;
                    ">${avatarHtml}</div>
                </div>
                <div style="font-size:20px;font-weight:600;letter-spacing:1px;">${escapeHtml(partnerName)}</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.6);display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-chess-board" style="color:var(--accent-color, #c5a47e);"></i>
                    <span>邀请一起下五子棋 · 切磋一局</span>
                    <span class="inviting-dots" style="display:inline-flex;gap:3px;">
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite;"></span>
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite 0.2s;"></span>
                        <span style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.6);animation:companionDot 1.2s infinite 0.4s;"></span>
                    </span>
                </div>
                <button id="wuziqi-inviting-cancel" style="
                    margin-top:30px;width:64px;height:64px;border-radius:50%;border:none;
                    background:linear-gradient(135deg,#ff5252,#c62828);
                    color:#fff;font-size:22px;cursor:pointer;
                    box-shadow:0 6px 20px rgba(255,82,82,.45);
                    display:flex;align-items:center;justify-content:center;
                ">
                    <i class="fas fa-xmark"></i>
                </button>
                <div style="font-size:11px;color:rgba(255,255,255,0.35);">取消</div>
            </div>
        `;

        injectKeyframes();
        const sessionId = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        overlay.dataset.sessionId = sessionId;
        document.documentElement.appendChild(overlay);

        overlay.querySelector('#wuziqi-inviting-cancel').addEventListener('click', () => {
            clearTimeout(_invitingTimer);
            closeInviting();
            sendChatEvent('fa-circle-xmark', `取消了对${partnerName}的五子棋邀请`, null);
        });

        const forced = _forceResult;
        _forceResult = null;

        const willReject = forced === 'reject'
            ? true
            : forced === 'accept'
                ? false
                : Math.random() < REJECT_CHANCE;

        const isStillThisSession = () => {
            const el = document.getElementById('wuziqi-inviting-overlay');
            return el && el.dataset.sessionId === sessionId;
        };

        if (willReject) {
            const delay = 4000 + Math.random() * 8000;
            _invitingTimer = setTimeout(() => {
                if (!isStillThisSession()) return;
                closeInviting();
                sendChatEvent('fa-heart-crack', `${partnerName}拒绝了你的五子棋邀请`, null);
                notify(`${partnerName} 拒绝了下棋邀请`, 'info');
                showTransition(`${pickRandom(REJECT_LINES)}……`);
            }, delay);
        } else {
            const delay = 1000 + Math.random() * 2000;
            _invitingTimer = setTimeout(() => {
                if (!isStillThisSession()) return;
                closeInviting();
                showTransition(pickRandom(ACCEPT_LINES), () => {
                    doOpenWuziqiPage('user');
                });
            }, delay);
        }
    }

    function closeInviting() {
        document.querySelectorAll('#wuziqi-inviting-overlay').forEach(el => el.remove());
    }

    // ─── 梦角主动邀请 ──────────────────────────────────────────────────────

    function canTrigger() {
        if (document.getElementById('wuziqi-page')?.classList.contains('active')) return false;
        if (document.getElementById('companion-page')?.classList.contains('active')) return false;
        if (document.querySelector('#wuziqi-inviting-overlay, #wuziqi-incoming-overlay')) return false;
        if (document.querySelector('#companion-inviting-overlay, #companion-incoming-overlay, #companion-modal-dynamic, .companion-transition')) return false;
        // 观影中（或 2 小时内），不打扰
        if (typeof window._cinemaShouldBlockInterruptions === 'function' && window._cinemaShouldBlockInterruptions()) return false;
        // 通话中不打扰
        const isCallActive = document.getElementById('call-window')?.classList.contains('visible')
            || document.getElementById('call-incoming-overlay')?.classList.contains('visible')
            || document.getElementById('call-mini-pill')?.classList.contains('visible');
        if (isCallActive) return false;
        return true;
    }

    function showIncomingWuziqi() {
        if (!canTrigger()) return;

        const partnerName = getPartnerName();
        const avSrc = getPartnerAvatarSrc();
        const line = pickRandom(INVITE_QUOTES);

        document.querySelectorAll('#wuziqi-incoming-overlay').forEach(el => el.remove());

        const overlay = document.createElement('div');
        overlay.id = 'wuziqi-incoming-overlay';
        overlay.setAttribute('style', [
            'position:fixed', 'inset:0', 'z-index:99998',
            'background:rgba(15,15,20,0.95)',
            'display:flex', 'align-items:center', 'justify-content:center',
            'animation:companionFadeIn 0.35s ease',
        ].join(';'));

        const avatarHtml = avSrc
            ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;">`
            : `<i class="fas fa-user" style="font-size:34px;color:rgba(255,255,255,.85);"></i>`;

        overlay.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:18px;color:#fff;">
                <div style="position:relative;width:96px;height:96px;">
                    <div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(var(--accent-color-rgb,197,164,126),0.5);animation:companionPulseRing 1.6s ease-out infinite;"></div>
                    <div style="position:absolute;inset:-14px;border-radius:50%;border:2px solid rgba(var(--accent-color-rgb,197,164,126),0.3);animation:companionPulseRing 1.6s ease-out infinite 0.5s;"></div>
                    <div style="
                        width:96px;height:96px;border-radius:50%;overflow:hidden;
                        background:rgba(255,255,255,0.1);
                        display:flex;align-items:center;justify-content:center;
                        border:2px solid rgba(255,255,255,0.15);
                        position:relative;z-index:1;
                    ">${avatarHtml}</div>
                </div>
                <div style="font-size:20px;font-weight:600;letter-spacing:1px;">${escapeHtml(partnerName)}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.5);display:flex;align-items:center;gap:6px;">
                    <span style="width:6px;height:6px;border-radius:50%;background:var(--accent-color, #c5a47e);animation:companionDot 1.1s step-end infinite;"></span>
                    <span>想和你一起...</span>
                </div>
                <div style="
                    background:rgba(255,255,255,0.08);border-radius:14px;padding:12px 20px;
                    display:flex;align-items:center;gap:10px;max-width:280px;margin-top:4px;
                ">
                    <i class="fas fa-chess-board" style="color:var(--accent-color, #c5a47e);font-size:18px;"></i>
                    <span style="font-size:14px;">"${escapeHtml(line)}"</span>
                </div>
                <div style="display:flex;gap:44px;margin-top:26px;">
                    <button id="wuziqi-incoming-reject" style="
                        display:flex;flex-direction:column;align-items:center;gap:7px;
                        background:none;border:none;cursor:pointer;color:#fff;
                    ">
                        <div style="
                            width:60px;height:60px;border-radius:50%;
                            background:linear-gradient(135deg,#ff5252,#c62828);
                            box-shadow:0 6px 20px rgba(255,82,82,.45);
                            display:flex;align-items:center;justify-content:center;
                            transition:transform 0.15s ease;font-size:22px;
                        "><i class="fas fa-xmark"></i></div>
                        <span style="font-size:12px;color:rgba(255,255,255,.48);font-weight:500;">拒绝</span>
                    </button>
                    <button id="wuziqi-incoming-accept" style="
                        display:flex;flex-direction:column;align-items:center;gap:7px;
                        background:none;border:none;cursor:pointer;color:#fff;
                    ">
                        <div style="
                            width:60px;height:60px;border-radius:50%;
                            background:linear-gradient(135deg,#4caf50,#2e7d32);
                            box-shadow:0 6px 20px rgba(76,175,80,.45);
                            display:flex;align-items:center;justify-content:center;
                            transition:transform 0.15s ease;font-size:22px;
                        "><i class="fas fa-heart"></i></div>
                        <span style="font-size:12px;color:rgba(255,255,255,.48);font-weight:500;">接受</span>
                    </button>
                </div>
            </div>
        `;

        injectKeyframes();
        document.documentElement.appendChild(overlay);

        // 邀请音效（复用陪伴板块的通用邀请铃音）
        try {
            if (typeof playSound === 'function') playSound('invite_study');
        } catch (e) { console.warn('[wuziqi] invite sound error:', e); }

        // 后台推送通知
        try {
            if (typeof window._sendPartnerNotification === 'function') {
                window._sendPartnerNotification(
                    partnerName + ' 邀请你下五子棋',
                    '想和你一起切磋一局，快来看看吧 ✨'
                );
            }
        } catch (e) { console.warn('[wuziqi] invite notification error:', e); }

        // 60 秒未应答自动消失 → 错过
        _autoTimer = setTimeout(() => {
            if (!overlay.isConnected) return;
            try { if (typeof window.stopCurrentSound === 'function') window.stopCurrentSound(); } catch (e) {}
            overlay.remove();
            sendChatEvent('fa-heart-crack', `错过了${partnerName}的五子棋邀请`, null);
        }, 60000);

        overlay.querySelector('#wuziqi-incoming-reject').addEventListener('click', () => {
            clearTimeout(_autoTimer);
            try { if (typeof window.stopCurrentSound === 'function') window.stopCurrentSound(); } catch (e) {}
            if (overlay.isConnected) overlay.remove();
            sendChatEvent('fa-heart-crack', `我拒绝了这次五子棋邀请`, null);
            showTransition(pickRandom(PARTNER_REJECT_LINES));
        });

        overlay.querySelector('#wuziqi-incoming-accept').addEventListener('click', () => {
            clearTimeout(_autoTimer);
            try { if (typeof window.stopCurrentSound === 'function') window.stopCurrentSound(); } catch (e) {}
            if (overlay.isConnected) overlay.remove();
            showTransition(pickRandom(ACCEPT_LINES), () => {
                doOpenWuziqiPage('partner');
            });
        });
    }

    // ─── 梦角随机主动邀请（参考陪伴板块：15~60 分钟检查，25% 概率）─────────
    let _randTimer = null;
    function scheduleRandomWzq() {
        clearTimeout(_randTimer);
        const ms = (RANDOM_CHECK_MIN_MIN + Math.random() * (RANDOM_CHECK_MAX_MIN - RANDOM_CHECK_MIN_MIN)) * 60 * 1000;
        _randTimer = setTimeout(() => {
            if (Math.random() < RANDOM_FIRE_CHANCE) showIncomingWuziqi();
            scheduleRandomWzq();
        }, ms);
    }
    function stopRandomWzq() {
        clearTimeout(_randTimer);
        _randTimer = null;
    }

    // ─── 事件绑定 ──────────────────────────────────────────────────────────

    function bindEvents() {
        const canvasEl = document.getElementById('wuziqi-canvas');
        if (canvasEl) {
            canvasEl.addEventListener('click', e => {
                const rect = canvasEl.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const col = Math.round((x - cell) / cell);
                const row = Math.round((y - cell) / cell);
                doUserMove(row, col);
            });
        }

        // 计时球点击：显示本局时长
        const timer = document.getElementById('wuziqi-timer');
        if (timer) {
            timer.addEventListener('click', () => {
                const t = getElapsed();
                notify(gameOver ? `本局用时 ${fmtTimeText(t)}` : `本局已进行 ${fmtTimeText(t)}`, 'info');
            });
        }

        // 认输
        const forfeitBtn = document.getElementById('wuziqi-forfeit-btn');
        if (forfeitBtn) {
            forfeitBtn.addEventListener('click', () => {
                if (gameOver) return;
                endGame('userForfeit');
            });
        }

        // 重新开局
        const restartBtn = document.getElementById('wuziqi-restart-btn');
        if (restartBtn) restartBtn.addEventListener('click', restartGame);

        // 结果面板：重新开局 / 退出游戏
        const resultRestart = document.getElementById('wuziqi-result-restart');
        if (resultRestart) resultRestart.addEventListener('click', restartGame);
        const resultExit = document.getElementById('wuziqi-result-exit');
        if (resultExit) resultExit.addEventListener('click', () => closeWuziqiPage(true));

        // 左上角退出
        const exitBtn = document.getElementById('wuziqi-exit-btn');
        if (exitBtn) exitBtn.addEventListener('click', () => {
            if (gameOver) {
                closeWuziqiPage(true);
                return;
            }
            const confirmBox = document.getElementById('wuziqi-exit-confirm');
            if (confirmBox) confirmBox.classList.add('active');
        });

        // 退出确认
        const yesBtn = document.getElementById('wuziqi-exit-yes');
        if (yesBtn) {
            yesBtn.addEventListener('click', () => {
                if (!gameOver) sendChatEvent('fa-xmark', '提前退出了五子棋对弈', null);
                closeWuziqiPage(true);
            });
        }
        const noBtn = document.getElementById('wuziqi-exit-no');
        if (noBtn) {
            noBtn.addEventListener('click', () => {
                const confirmBox = document.getElementById('wuziqi-exit-confirm');
                if (confirmBox) confirmBox.classList.remove('active');
            });
        }

        // 尺寸切换
        document.querySelectorAll('#wuziqi-page .wzq-pill[data-size]').forEach(b => {
            b.addEventListener('click', () => {
                initBoard(parseInt(b.getAttribute('data-size'), 10));
                updatePills(_lastSize);
                startGameTimer();
            });
        });

        // 难度切换
        document.querySelectorAll('#wuziqi-page .wzq-pill[data-diff]').forEach(b => {
            b.addEventListener('click', () => {
                diff = b.getAttribute('data-diff');
                document.querySelectorAll('#wuziqi-page .wzq-pill[data-diff]').forEach(x => {
                    x.classList.toggle('active', x === b);
                });
            });
        });

        // 陪伴模式选择静态网格中的兜底入口（应用了 companion 的数据模式守卫）
        const staticCard = document.getElementById('companion-card-wuziqi');
        if (staticCard) staticCard.addEventListener('click', () => startInviting());
    }

    // ─── 初始化 ────────────────────────────────────────────────────────────

    async function init() {
        try {
            bindEvents();
            loadWzqData();
            scheduleRandomWzq();
            console.log('[wuziqi] 模块加载完成');
        } catch (e) {
            console.error('[wuziqi] 初始化失败', e);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 0);
    }

    // ─── 导出 ──────────────────────────────────────────────────────────────
    // 用法：
    //   wuziqiModule.start()                — 用户点击五子棋卡片（邀请流程）
    //   wuziqiModule.testIncoming()         — 立即触发"梦角邀请你下五子棋"
    //   wuziqiModule.testAccept()           — 强制同意（用户发起的邀请）
    //   wuziqiModule.testReject()           — 强制拒绝（用户发起的邀请）
    //   wuziqiModule.stopRandom()           — 停止随机邀请
    //   wuziqiModule.scheduleRandom()       — 重启随机邀请
    //   wuziqiModule._debug                 — 对局内部状态与测试用例
    const api = {
        start: startInviting,
        testIncoming: showIncomingWuziqi,
        testAccept: () => {
            _forceResult = 'accept';
            startInviting();
        },
        testReject: () => {
            _forceResult = 'reject';
            startInviting();
        },
        stopRandom: stopRandomWzq,
        scheduleRandom: scheduleRandomWzq,
        getRecord: () => ({ wins: wzData.wins, loses: wzData.loses, forfeits: wzData.forfeits, games: wzData.games }),
        _debug: {
            get state() {
                return {
                    size: gomokuSize, turn: turn, gameOver: gameOver, moveCount: moveCount,
                    diff: diff,
                    board: board.map(r => r.slice()),
                };
            },
            userMove: (row, col) => doUserMove(row, col),
            forceEnd: (winner) => endGame(winner),
            partnerForfeit: doPartnerForfeit,
            pageActive: () => document.getElementById('wuziqi-page')?.classList.contains('active') || false,
            timerText: () => document.getElementById('wuziqi-timer-display')?.textContent || '',
            resultShown: () => document.getElementById('wuziqi-result')?.classList.contains('show') || false,
        },
    };
    window.wuziqiModule = api;
    window.__wuziqiModule = api;
})();