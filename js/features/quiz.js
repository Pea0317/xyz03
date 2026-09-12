/**
 * quiz.js - 答题问卷功能
 * 对方聊天时 1% 概率给出 1-3 道问卷题（题目来自「问卷问题」字卡分组或自定义题目）
 * 对方答案/评价来自除问题分组外的全部字卡；双方可互相评价对方答案
 */
(function() {
    'use strict';

    var STORE_KEY = 'CHAT_APP_V3__quiz';
    var QUESTION_GROUP = '问卷问题';

    var q = {
        customQuestions: [], // {q, a, enabled}
        history: [],         // {time, dir, items:[{q, userAnswer, partnerAnswer, partnerEval, userRating}]}
        startedCount: 0
    };

    var sess = null; // {dir:'partner_asks_me'|'i_ask_partner', total, asked, current:{q,a}, awaiting:'user'|'partner'|'user_rating', items:[]}

    // ========== 工具 ==========

    function _notify(msg, type, dur) {
        try {
            var f = window.showNotification || (typeof showNotification === 'function' ? showNotification : null);
            if (f) f(msg, type || 'info', dur || 3000);
        } catch (e) {}
    }

    function _sound(type) {
        try {
            var f = window.playSound || (typeof playSound === 'function' ? playSound : null);
            if (f) f(type);
        } catch (e) {}
    }

    function _addMsg(m) {
        try {
            if (typeof window.addMessage === 'function') { window.addMessage(m); return true; }
        } catch (e) {}
        return false;
    }

    function _partnerName() {
        try {
            if (window.settings && window.settings.partnerName) return window.settings.partnerName;
        } catch (e) {}
        return '对方';
    }

    function _myName() {
        try {
            if (window.settings && window.settings.myName) return window.settings.myName;
        } catch (e) {}
        return '我';
    }

    function _hideTyping() {
        try {
            var w = document.getElementById('typing-indicator-wrapper');
            if (!w) return;
            var i = w.querySelector('.typing-indicator');
            if (i) {
                i.classList.add('hiding');
                setTimeout(function() { w.style.display = 'none'; if (i) i.classList.remove('hiding'); }, 240);
            } else { w.style.display = 'none'; }
        } catch (e) {}
    }

    function _today() {
        var d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function _timeStr() {
        var d = new Date();
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function _save() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify({ customQuestions: q.customQuestions, history: q.history, startedCount: q.startedCount }));
        } catch (e) {}
    }

    function _load() {
        try {
            var raw = localStorage.getItem(STORE_KEY);
            if (!raw) return;
            var d = JSON.parse(raw);
            if (!d) return;
            q.customQuestions = Array.isArray(d.customQuestions) ? d.customQuestions : [];
            q.history = Array.isArray(d.history) ? d.history : [];
            q.startedCount = d.startedCount || 0;
        } catch (e) {}
    }

    function _rand(arr) {
        if (!arr || !arr.length) return null;
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // ========== 字卡取数 ==========

    function isQuestionGroup(name) {
        var n = String(name || '').trim();
        return n === QUESTION_GROUP || n.indexOf('问卷') >= 0 || n.indexOf('题目') >= 0 || n.indexOf('提问') >= 0;
    }

    // 问题池：题卡分组 + 自定义题目
    function getQuestionPool() {
        var out = [];
        try {
            (window.customReplyGroups || []).forEach(function(g) {
                if (isQuestionGroup(g.name) && Array.isArray(g.items)) {
                    g.items.forEach(function(it) {
                        var s = String(it || '').trim();
                        if (s) out.push({ q: s, a: '' });
                    });
                }
            });
        } catch (e) {}
        (q.customQuestions || []).forEach(function(c) {
            if (c.enabled !== false && c.q && String(c.q).trim()) out.push({ q: String(c.q).trim(), a: String(c.a || '').trim() });
        });
        return out;
    }

    // 答案/评价池：除问题分组外的全部字卡（与 simulateReply 同样的禁用过滤逻辑）
    function getAnswerPool() {
        var out = [];
        var disabled = {};
        try {
            var raw = localStorage.getItem('disabledReplyItems');
            if (raw) JSON.parse(raw).forEach(function(i) { disabled[String(i)] = 1; });
        } catch (e) {}
        try {
            var base = window._customReplies || [];
            if (Array.isArray(base)) base.forEach(function(r) {
                var s = String(r || '').trim();
                if (s && !disabled[String(r)]) out.push(s);
            });
        } catch (e) {}
        try {
            (window.customReplyGroups || []).forEach(function(g) {
                if (g && (g.disabled || isQuestionGroup(g.name))) return;
                (g.items || []).forEach(function(it) {
                    var s = String(it || '').trim();
                    if (s && !disabled[s]) out.push(s);
                });
            });
        } catch (e) {}
        return out;
    }

    function pickAnswer(pool, fallback) {
        if (pool && pool.length) return pool[Math.floor(Math.random() * pool.length)];
        return fallback || '嗯嗯～';
    }

    function getLastUserText() {
        try {
            var msgs = window.messages || [];
            for (var i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i] && msgs[i].sender === 'user' && msgs[i].text && !String(msgs[i].text).indexOf('【问卷】')) {
                    return String(msgs[i].text).trim();
                }
            }
        } catch (e) {}
        return null;
    }

    function _sendPartnerMsg(text, delay) {
        setTimeout(function() {
            _addMsg({
                id: Date.now() + Math.floor(Math.random() * 1000),
                sender: _partnerName(),
                text: text,
                timestamp: new Date(),
                status: 'received',
                favorited: false,
                note: null,
                type: 'normal'
            });
            _sound('message');
            try { if (window._sendPartnerNotification) window._sendPartnerNotification(_partnerName(), text); } catch (e) {}
        }, delay || 0);
    }

    // ========== 对方出题（quiz 给用户）==========

    function startPartnerSession(sourcePool, byUser) {
        var pool = sourcePool || getQuestionPool();
        if (!pool.length) {
            _hideTyping();
            _sendPartnerMsg('想给你出几道问卷题，可是我的题库还是空的呢，快去「答题问卷」里添加题目吧～', 700);
            return true;
        }
        var total = 1 + Math.floor(Math.random() * 3); // 1-3 题
        var picked = shuffle(pool).slice(0, total);
        var items = picked.map(function(p) { return { q: p.q, a: p.a }; });

        sess = {
            dir: 'partner_asks_me',
            total: total,
            asked: 0,
            awaiting: 'user',
            items: items
        };
        q.startedCount++;
        _save();

        _hideTyping();
        var greet = byUser
            ? '好啦，我来考考你～'
            : (Math.random() < 0.5 ? '我来考考你吧～' : '考考你！');
        _sendPartnerMsg(greet, 600);
        _sendQuestionItem(sess, 0, 1600);
        renderAll();
        _notify(_partnerName() + ' 给你出了一道问卷题', 'info', 3500);
        return true;
    }

    function shuffle(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        }
        return a;
    }

    function _sendQuestionItem(s, idx, delay) {
        var item = s.items[idx];
        _sendPartnerMsg('▪️ 问卷 Q' + (idx + 1) + '：' + item.q, delay);
        s.asked = idx + 1;
        s.awaiting = 'user';
        renderAll();
    }

    // 对方评价用户答案并继续下一题/结束
    function _handleUserAnswer() {
        if (!sess || sess.dir !== 'partner_asks_me' || sess.awaiting !== 'user') return false;
        var answer = getLastUserText();
        if (answer === null) return false;
        sess.awaiting = 'busy';
        _hideTyping();

        var item = sess.items[Math.min(sess.asked - 1, sess.items.length - 1)];
        item.userAnswer = answer;

        var pool = getAnswerPool();
        var evalText = pickAnswer(pool, '答案我收到啦～');
        // 偶尔加评价前缀，突出"评价"感（内容仍取自字卡）
        var prefix = _rand(['', '评价：', '嗯嗯：', '我的看法：']);
        item.partnerEval = (prefix ? prefix : '') + evalText;

        var isLast = sess.asked >= sess.total;
        if (isLast) {
            _sendPartnerMsg(item.partnerEval, 800);
            var done = _rand([
                '问卷完成！答了 ' + sess.total + ' 道题，辛苦啦～',
                '好啦，问卷结束，来「答题问卷」看看结果吧！',
                '收卷！我把这 ' + sess.total + ' 道题都记下来啦～'
            ]);
            _sendPartnerMsg(done, 2200);
            pushHistory();
            sess = null;
        } else {
            _sendPartnerMsg(item.partnerEval, 800);
            _sendQuestionItem(sess, sess.asked, 2200);
        }
        _save();
        renderAll();
        return true;
    }

    function pushHistory() {
        if (!sess) return;
        q.history.unshift({ time: _timeStr() + ' ' + _today(), dir: sess.dir, items: sess.items });
        if (q.history.length > 50) q.history.length = 50;
    }

    // ========== 用户出题（问对方）==========

    function askPartner() {
        var qInput = el('quiz-custom-question');
        var aInput = el('quiz-custom-answer');
        var question = qInput ? qInput.value.trim() : '';
        var refA = aInput ? aInput.value.trim() : '';
        if (!question) { _notify('请输入要问对方的问题', 'warning', 2000); return; }

        qInput.value = '';
        aInput.value = '';

        // 以用户身份发送问题
        _addMsg({
            id: Date.now(),
            sender: 'user',
            text: '【问卷】' + question + (refA ? '　（参考答案：' + refA + '）' : ''),
            timestamp: new Date(),
            status: 'sent',
            favorited: false,
            note: null,
            type: 'normal'
        });
        try { if (window.playSound) window.playSound('send'); } catch (e) {}

        sess = {
            dir: 'i_ask_partner',
            total: 1,
            asked: 1,
            awaiting: 'partner',
            items: [{ q: question, a: refA }]
        };
        renderAll();
        _notify('已向' + _partnerName() + '提问', 'info', 2000);

        // 对方稍后作答
        setTimeout(function() {
            if (!sess || sess.awaiting !== 'partner') return;
            _hideTyping();
            var pool = getAnswerPool();
            var ans = pickAnswer(pool, '让我想想…我选……唔，就它了！');
            sess.items[0].partnerAnswer = ans;
            sess.awaiting = 'user_rating';
            _sendPartnerMsg(ans, 600);
            _save();
            renderAll();
        }, 1500 + Math.random() * 800);
    }

    // 用户评价对方答案
    function ratePartner(rating) {
        if (!sess || sess.dir !== 'i_ask_partner' || sess.awaiting !== 'user_rating') return;
        sess.items[0].userRating = rating;
        var label = { good: '好棒', ok: '还好', bad: '一般般' }[rating] || rating;
        _sendPartnerMsg('（你评价了' + _partnerName() + '的回答：' + label + '）', 300);
        pushHistory();
        sess = null;
        _save();
        renderAll();
        _notify('已记录评价', 'success', 1500);
    }

    function endSession() {
        if (!sess) return;
        var wasDir = sess.dir;
        pushHistory();
        sess = null;
        _save();
        renderAll();
        _notify(wasDir === 'partner_asks_me' ? '已结束本次问卷' : '已结束本次提问', 'info', 1800);
    }

    // ========== 钩子 ==========

    function _quizHook() {
        try {
            if (sess) {
                if (sess.awaiting === 'user') {
                    return _handleUserAnswer();
                }
                return false;
            }
            // 对方主动出题：1% 概率
            if (Math.random() < 0.01) {
                return startPartnerSession(null, false);
            }
        } catch (e) {
            console.error('[quizHook]', e);
        }
        return false;
    }

    // ========== 渲染 ==========

    function el(id) { return document.getElementById(id); }

    function renderAll() {
        renderStatus();
        renderActions();
        renderRating();
        renderQuestionPoolInfo();
        renderCustomList();
        renderHistory();
        var ns = el('quiz-new-session-btn');
        if (ns) ns.style.display = sess ? 'none' : 'inline-flex';
    }

    function renderStatus() {
        var box = el('quiz-status');
        if (!box) return;
        if (!sess) {
            var pool = getQuestionPool();
            box.innerHTML = '<div class="mq-status-line"><i class="fas fa-star"></i> 当前暂无进行中的问卷</div>'
                + '<div style="font-size:12px;color:var(--text-secondary);margin-top:6px;line-height:1.6;">题库现有题目 <b style="color:var(--accent-color);">' + pool.length + '</b> 道，历史进行 <b style="color:var(--accent-color);">' + q.startedCount + '</b> 次</div>';
            return;
        }
        var dirText = sess.dir === 'partner_asks_me' ? _partnerName() + ' 出题给你' : '你问' + _partnerName();
        var stateText = sess.awaiting === 'user' ? '等待你回答…' : (sess.awaiting === 'partner' ? '等待' + _partnerName() + '回答…' : (sess.awaiting === 'user_rating' ? '等待你评价' + _partnerName() + '的回答' : '进行中…'));
        var cur = sess.items[Math.min(sess.asked - 1, sess.items.length - 1)];
        box.innerHTML = '<div class="mq-status-line on"><i class="fas fa-question-circle"></i> 问卷进行中：第 ' + sess.asked + ' / ' + sess.total + ' 题</div>'
            + '<div style="font-size:12px;color:var(--text-primary);margin-top:6px;">' + (dirText) + '（' + stateText + '）</div>'
            + (cur ? '<div class="mq-question-current">' + escapeHtml(cur.q) + '</div>' : '');
    }

    function renderActions() {
        var box = el('quiz-actions');
        if (!box) return;
        if (sess && sess.dir === 'i_ask_partner' && sess.awaiting === 'user_rating') {
            box.innerHTML = '';
            return; // 评分按钮在 renderRating
        }
        box.innerHTML = '<button class="modal-btn modal-btn-primary" style="flex:1;" ' + (sess ? 'disabled' : '') + ' onclick="window.QuizApp && QuizApp.startSession()"><i class="fas fa-play"></i> 让对方出题</button>'
            + (sess ? '<button class="modal-btn modal-btn-secondary" style="flex:1;" onclick="window.QuizApp && QuizApp.endSession()"><i class="fas fa-times"></i> 结束问卷</button>' : '');
    }

    function renderRating() {
        var box = el('quiz-rating-box');
        if (!box) return;
        if (sess && sess.dir === 'i_ask_partner' && sess.awaiting === 'user_rating') {
            box.style.display = 'block';
            box.innerHTML = '<div class="mq-sec-label"><i class="fas fa-star-half-alt"></i> 评价' + _partnerName() + '的回答</div>'
                + '<div class="mq-btn-row">'
                + '<button class="quart-btn good" onclick="window.QuizApp && QuizApp.ratePartner(\'good\')"><i class="fas fa-thumbs-up"></i> 好棒</button>'
                + '<button class="quart-btn ok" onclick="window.QuizApp && QuizApp.ratePartner(\'ok\')"><i class="fas fa-hand-peace"></i> 还好</button>'
                + '<button class="quart-btn bad" onclick="window.QuizApp && QuizApp.ratePartner(\'bad\')"><i class="fas fa-thumbs-down"></i> 一般般</button>'
                + '</div>';
        } else {
            box.style.display = 'none';
            box.innerHTML = '';
        }
    }

    function renderQuestionPoolInfo() {
        var box = el('quiz-question-pool-info');
        if (!box) return;
        var cardCount = 0;
        try {
            (window.customReplyGroups || []).forEach(function(g) {
                if (isQuestionGroup(g.name) && Array.isArray(g.items)) cardCount += g.items.length;
            });
        } catch (e) {}
        box.innerHTML = '<div class="mq-info-line"><i class="fas fa-folder-open"></i> 「' + QUESTION_GROUP + '」字卡分组题目：' + cardCount + ' 道</div>'
            + '<div class="mq-info-line" style="margin-top:4px;"><i class="fas fa-pencil-alt"></i> 自定义题目：' + (q.customQuestions || []).filter(function(c) { return c.enabled !== false; }).length + ' 道</div>'
            + '<div style="font-size:11px;color:var(--text-secondary);margin-top:6px;line-height:1.5;">在「自定义回复 → 分组」里新建名为「' + QUESTION_GROUP + '」的分组并添加题目即可；对方出题、作答与互评都会用到这些内容。</div>';
    }

    function renderCustomList() {
        var box = el('quiz-custom-list');
        if (!box) return;
        if (!q.customQuestions.length) {
            box.innerHTML = '<div class="mq-empty">还没有自定义题目</div>';
            return;
        }
        box.innerHTML = q.customQuestions.map(function(c, idx) {
            var badge = c.enabled === false ? '<span class="mq-song-badge off">停用</span>' : '<span class="mq-song-badge net">启用</span>';
            return '<div class="mq-song">'
                + '<span class="mq-song-title">' + escapeHtml(c.q) + '</span>'
                + '<span class="mq-song-sub">' + escapeHtml(c.a || '无参考答案') + '</span>'
                + '<span class="mq-song-del" onclick="window.QuizApp && QuizApp.toggleQuestion(' + idx + ')">' + badge + '</span>'
                + '<span class="mq-song-del" onclick="window.QuizApp && QuizApp.removeQuestion(' + idx + ')"><i class="fas fa-times"></i></span>'
                + '</div>';
        }).join('');
    }

    function addQuestion() {
        var qi = el('quiz-add-q');
        var ai = el('quiz-add-a');
        var question = qi ? qi.value.trim() : '';
        var answer = ai ? ai.value.trim() : '';
        if (!question) { _notify('请输入问题', 'warning', 2000); return; }
        q.customQuestions.push({ q: question, a: answer, enabled: true });
        qi.value = '';
        ai.value = '';
        _save();
        renderAll();
        _notify('题目已保存', 'success', 1800);
    }

    function toggleQuestion(idx) {
        if (idx < 0 || idx >= q.customQuestions.length) return;
        q.customQuestions[idx].enabled = q.customQuestions[idx].enabled === false;
        _save();
        renderAll();
    }

    function removeQuestion(idx) {
        if (idx < 0 || idx >= q.customQuestions.length) return;
        q.customQuestions.splice(idx, 1);
        _save();
        renderAll();
        _notify('已删除', 'info', 1500);
    }

    function renderHistory() {
        var box = el('quiz-history-list');
        if (!box) return;
        if (!q.history.length) {
            box.innerHTML = '<div class="mq-empty">暂无问卷记录</div>';
            return;
        }
        box.innerHTML = q.history.slice(0, 20).map(function(h, hidx) {
            var dirLabel = h.dir === 'partner_asks_me' ? _partnerName() + ' 出题' : '我出题';
            var parts = (h.items || []).map(function(it, i) {
                var line = 'Q' + (i + 1) + ' ' + escapeHtml(it.q);
                if (it.userAnswer) line += ' → 我答：' + escapeHtml(it.userAnswer);
                if (it.partnerEval) line += ' · ' + escapeHtml(it.partnerEval);
                if (it.partnerAnswer) line += ' → ' + _partnerName() + '答：' + escapeHtml(it.partnerAnswer);
                if (it.userRating) line += ' · 评价：' + ({ good: '好棒', ok: '还好', bad: '一般般' }[it.userRating] || it.userRating);
                return '<div class="mq-history-item">' + line + '</div>';
            }).join('');
            return '<div class="mq-history-block"><div class="mq-history-head"><i class="fas fa-scroll"></i> ' + dirLabel + ' · ' + (h.items || []).length + ' 题 · ' + escapeHtml(h.time) + '</div>' + parts + '</div>';
        }).join('');
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    // ========== 弹窗控制 ==========

    function openModal() {
        var modal = el('quiz-modal');
        if (!modal) return;
        if (typeof window.homeShowModal === 'function') window.homeShowModal(modal);
        else if (typeof window.showModal === 'function') window.showModal(modal);
        else modal.style.display = 'flex';
        renderAll();
    }

    function startSession() {
        if (sess) return;
        var pool = getQuestionPool();
        if (!pool.length) {
            _hideTyping();
            _sendPartnerMsg('题库还是空的呢，等你添加了「' + QUESTION_GROUP + '」字卡或自定义题目后我们再开始吧～', 500);
            return;
        }
        startPartnerSession(pool, true);
    }

    function close() {
        var modal = el('quiz-modal');
        if (!modal) return;
        if (typeof window.homeHideModal === 'function') window.homeHideModal(modal);
        else if (typeof window.hideModal === 'function') window.hideModal(modal);
        else modal.style.display = 'none';
    }

    function switchTab(tab) {
        var map = { main: ['quiz-tab-main', 'quiz-panel-main'], questions: ['quiz-tab-questions', 'quiz-panel-questions'], history: ['quiz-tab-history', 'quiz-panel-history'] };
        var cfg = map[tab];
        if (!cfg) return;
        Object.keys(map).forEach(function(k) {
            var mk = map[k];
            var tb = el(mk[0]); if (tb) tb.classList.toggle('active', k === tab);
            var pnl = el(mk[1]); if (pnl) pnl.classList.toggle('fl-panel-active', k === tab);
        });
        if (tab === 'questions') renderQuestionPoolInfo();
        if (tab === 'history') renderHistory();
    }

    function onShow() {
        renderAll();
    }

    // ========== 初始化 ==========

    var _bound = false;

    function init() {
        if (_bound) return;
        _bound = true;
        _load();
        if (typeof window._quizHook !== 'function') window._quizHook = _quizHook;

        if (typeof window._hookFeaturesSimulateReply !== 'function') {
            window._hookFeaturesSimulateReply = function() {
                try {
                    if (typeof window._musicHook === 'function' && window._musicHook()) return true;
                    if (typeof window._quizHook === 'function' && window._quizHook()) return true;
                } catch (e) { console.error('[hookFeaturesSimulateReply]', e); }
                return false;
            };
        }
    }

    window.QuizApp = {
        init: init,
        onShow: onShow,
        openModal: openModal,
        close: close,
        switchTab: switchTab,
        startSession: startSession,
        askPartner: askPartner,
        ratePartner: ratePartner,
        endSession: endSession,
        addQuestion: addQuestion,
        toggleQuestion: toggleQuestion,
        removeQuestion: removeQuestion
    };

    window.initQuizFeature = function() { init(); };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();