/**
 * music.js - 一起听歌功能
 * 支持网易云歌曲（按歌曲ID/链接播放）+ 网易云下载的本地音乐文件
 * 双方可一起听：对方每天 5% 概率邀请、使用时可能暂停/切歌(30%)/退出(2%)
 */
(function() {
    'use strict';

    var STORE_KEY = 'CHAT_APP_V3__music_together';
    var NETBASE = 'https://music.163.com/song/media/outer/url?id=';

    var t = {
        account: null,          // {nick}
        playlist: [],           // {id,title,kind:'netease'} | {title,url,kind:'local'}
        index: -1,
        playing: false,
        together: false,        // 一起听模式是否开启
        invitePending: false,   // 对方发来邀请待接受
        lastPartnerInviteDay: '',
        partnerExitChecked: false,
        log: []                 // {text, time}
    };

    var _logTpl = [];           // 会话期日志（不持久）

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

    function _log(text) {
        t.log.unshift({ text: text, time: _timeStr() });
        if (t.log.length > 30) t.log.length = 30;
        renderLog();
    }

    function _save() {
        try {
            var persist = {
                account: t.account,
                playlist: t.playlist.filter(function(s) { return s.kind === 'netease'; }).map(function(s) { return { id: s.id, title: s.title, kind: 'netease' }; }),
                together: t.together,
                lastPartnerInviteDay: t.lastPartnerInviteDay
            };
            localStorage.setItem(STORE_KEY, JSON.stringify(persist));
        } catch (e) {}
    }

    function _load() {
        try {
            var raw = localStorage.getItem(STORE_KEY);
            if (!raw) return;
            var d = JSON.parse(raw);
            if (d) {
                t.account = d.account || null;
                t.playlist = (d.playlist || []).filter(function(s) { return s && s.kind === 'netease'; });
                t.together = !!d.together;
                t.lastPartnerInviteDay = d.lastPartnerInviteDay || '';
                if (!t.playlist.length || t.index >= t.playlist.length) t.index = -1;
            }
        } catch (e) {}
    }

    // ========== 播放器 ==========

    function _audioEl() {
        var a = document.getElementById('music-audio');
        if (!a) {
            a = document.createElement('audio');
            a.id = 'music-audio';
            a.style.display = 'none';
            (document.body || document.documentElement).appendChild(a);
            a.addEventListener('ended', function() { _onEnded(); });
            a.addEventListener('error', function() { _onSrcError(); });
        }
        return a;
    }

    function currentSong() {
        return (t.index >= 0 && t.index < t.playlist.length) ? t.playlist[t.index] : null;
    }

    function playIndex(i, byPartner) {
        if (i < 0 || i >= t.playlist.length) return;
        t.index = i;
        var song = t.playlist[i];
        var audio = _audioEl();
        var src;
        if (song.kind === 'local') {
            src = song.url;
        } else {
            src = NETBASE + encodeURIComponent(song.id) + '.mp3';
        }
        audio.src = src;
        audio.currentTime = 0;
        var p = audio.play();
        if (p && typeof p.catch === 'function') p.catch(function() { /* 自动播放被拦截 */ });
        t.playing = true;
        renderNowPlaying();
        renderPlaylist();
        if (byPartner) {
            _log((_partnerName() + ' 开始听《' + song.title + '》'));
        }
    }

    function togglePlay() {
        var song = currentSong();
        if (!song) {
            if (t.playlist.length) playIndex(0);
            return;
        }
        var audio = _audioEl();
        if (t.playing) {
            audio.pause();
            t.playing = false;
        } else {
            var p = audio.play();
            if (p && typeof p.catch === 'function') p.catch(function() {});
            t.playing = true;
        }
        renderNowPlaying();
        renderPlaylist();
    }

    function prev() {
        if (t.playlist.length === 0) return;
        playIndex((t.index - 1 + t.playlist.length) % t.playlist.length);
    }

    function next() {
        if (t.playlist.length === 0) return;
        playIndex((t.index + 1) % t.playlist.length);
    }

    function stopPlayback() {
        var audio = _audioEl();
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        t.playing = false;
        renderNowPlaying();
        renderPlaylist();
    }

    var _skipTries = 0;

    function _onEnded() {
        _skipTries = 0;
        if (t.playlist.length) next();
    }

    function _onSrcError() {
        if (_skipTries >= 2) { _skipTries = 0; stopPlayback(); _notify('歌曲无法播放（可能受版权限制）', 'error', 3000); return; }
        _skipTries++;
        _log('《' + (currentSong() ? currentSong().title : '') + '》无法播放，自动切换下一首');
        next();
    }

    // ========== 添加歌曲 ==========

    function parseNeteaseInput(text) {
        text = String(text || '').trim();
        if (!text) return null;
        // 尝试提取歌曲 id
        var m = text.match(/(?:song[\/?]|id=)(\d+)/i) || text.match(/^(\d+)$/);
        var id = m ? m[1] : null;
        if (!id) return null;
        // 支持 "id 标题" 格式
        var title = null;
        var mm = text.match(/^\s*\d{5,}\s+(.+)$/);
        if (mm) title = mm[1].trim();
        if (!title) title = '网易云歌曲 #' + id;
        return { id: id, title: title };
    }

    function addNetease() {
        var input = document.getElementById('music-netease-input');
        if (!input) return;
        var parsed = parseNeteaseInput(input.value);
        if (!parsed) {
            _notify('请粘贴有效的网易云歌曲链接或歌曲ID', 'warning', 3000);
            return;
        }
        var exists = t.playlist.some(function(s) { return s.kind === 'netease' && String(s.id) === String(parsed.id); });
        if (exists) { _notify('该歌曲已在播放列表中', 'info', 2000); input.value = ''; return; }
        t.playlist.push(parsed);
        input.value = '';
        _save();
        renderPlaylist();
        renderCount();
        _notify('已添加《' + parsed.title + '》', 'success', 2000);
    }

    function removeSong(idx) {
        if (idx < 0 || idx >= t.playlist.length) return;
        t.playlist.splice(idx, 1);
        if (t.index === idx) stopPlayback();
        if (t.index > idx) t.index--;
        if (t.index >= t.playlist.length) t.index = t.playlist.length - 1;
        _save();
        renderPlaylist();
        renderCount();
    }

    function addLocalFiles(fileList) {
        var files = Array.prototype.slice.call(fileList || []);
        if (!files.length) return;
        files.forEach(function(file) {
            var url = URL.createObjectURL(file);
            var title = file.name.replace(/\.(mp3|m4a|flac|wav|ogg|aac|wma|ape)$/i, '');
            t.playlist.push({ title: title, url: url, kind: 'local', file: file.name });
        });
        renderPlaylist();
        renderCount();
        _notify('已添加 ' + files.length + ' 首本地音乐', 'success', 2000);
    }

    // ========== 一起听 ==========

    function startTogether() {
        t.together = true;
        t.invitePending = false;
        t.partnerExitChecked = false;
        if (!currentSong() && t.playlist.length) playIndex(0);
        if (!t.playing && !currentSong() && t.playlist.length) togglePlay();
        _save();
        renderTogether();
        _log('你发起了「一起听歌」🎧');
        _notify('一起听歌已开启', 'success', 2000);
    }

    function acceptInvite() {
        startTogether();
        _log('你接受了' + _partnerName() + '的邀请，开始一起听歌');
    }

    function exitTogether(byPartner) {
        if (!t.together) return;
        t.together = false;
        stopPlayback();
        if (byPartner) {
            _log(_partnerName() + ' 退出了一起听');
            renderTogether();
            _notify(_partnerName() + ' 结束了这次一起听', 'info', 3000);
        } else {
            _log('你结束了「一起听歌」');
            renderTogether();
            _notify('已结束一起听歌', 'info', 2000);
        }
        _save();
    }

    // 对方主动退出（每个一起听会话 2% 概率）
    function maybePartnerExit() {
        if (!t.together) return;
        if (t.partnerExitChecked) return;
        if (Math.random() < 0.02) {
            t.partnerExitChecked = true;
            setTimeout(function() { exitTogether(true); }, 2500 + Math.random() * 2000);
        }
    }

    // 一起听心跳：对方随机暂停/切歌
    function _heartbeat() {
        if (!t.together) return;
        if (!t.playing && !currentSong()) return;
        if (t.playing) {
            var r = Math.random();
            if (r < 0.30) {
                if (Math.random() < 0.5) { next(); _log(_partnerName() + ' 切到了下一首'); _notify(_partnerName() + ' 切换了歌曲', 'info', 2500); }
                else { prev(); _log(_partnerName() + ' 切回了上一首'); _notify(_partnerName() + ' 切换了歌曲', 'info', 2500); }
                maybePartnerExit();
                return;
            }
            if (r < 0.45) {
                togglePlay();
                _log(_partnerName() + ' 暂停了播放');
                _notify(_partnerName() + ' 暂停了播放', 'info', 2500);
                maybePartnerExit();
                return;
            }
        } else if (!t.playing && Math.random() < 0.15) {
            togglePlay();
            _log(_partnerName() + ' 继续播放');
            _notify(_partnerName() + ' 继续播放了', 'info', 2500);
        }
    }

    // ========== 对方邀请钩子（每天 5%）==========
    function maybeInvite() {
        try {
            if (t.together) return false;
            if (t.playlist.length === 0) return false;
            if (t.lastPartnerInviteDay === _today()) return false;
            if (Math.random() >= 0.05) return false;
            t.lastPartnerInviteDay = _today();
            t.invitePending = true;
            _save();
            _hideTyping();
            var texts = [
                '来一起听歌呀～',
                '我们一边聊天一边听歌吧 🎵',
                '一起听会儿歌？我给你放了首好听的～'
            ];
            var txt = texts[Math.floor(Math.random() * texts.length)];
            setTimeout(function() {
                _addMsg({
                    id: Date.now(),
                    sender: _partnerName(),
                    text: txt,
                    timestamp: new Date(),
                    status: 'received',
                    favorited: false,
                    note: null,
                    type: 'normal'
                });
                _sound('message');
                try { if (window._sendPartnerNotification) window._sendPartnerNotification(_partnerName(), txt); } catch (e) {}
            }, 700 + Math.random() * 800);
            _log(_partnerName() + ' 邀请你一起听歌');
            _notify(_partnerName() + ' 邀请你一起听歌，点开「一起听歌」看看吧～', 'info', 4000);
            return true;
        } catch (e) { return false; }
    }

    function _musicHook() {
        return maybeInvite();
    }

    // ========== 渲染 ==========

    function el(id) { return document.getElementById(id); }

    function renderAll() {
        renderCount();
        renderAccount();
        renderPlaylist();
        renderNowPlaying();
        renderTogether();
        renderLog();
    }

    function renderCount() {
        var c = el('music-playlist-count');
        if (c) c.textContent = t.playlist.length;
    }

    function renderAccount() {
        var box = el('music-net-account-widget');
        if (!box) return;
        if (t.account && t.account.nick) {
            box.innerHTML = '<div class="mq-account-line"><i class="fas fa-user-circle"></i> ' + escapeHtml(t.account.nick)
                + ' <span style="color:var(--text-secondary);font-size:11px;margin-left:4px;">（本地账号）</span>'
                + '<button style="border:none;background:none;color:var(--text-secondary);cursor:pointer;font-size:12px;margin-left:auto;" onclick="window.MusicApp && MusicApp.logoutAccount()">退出</button></div>';
        } else {
            box.innerHTML = '<div style="display:flex;gap:6px;align-items:center;">'
                + '<input type="text" id="music-account-input" placeholder="输入你的网易云昵称（本地模拟登录）" class="mq-input" style="flex:1;" onkeydown="if(event.key===\'Enter\'){window.MusicApp&&MusicApp.loginAccount();}">'
                + '<button class="modal-btn modal-btn-primary" style="padding:8px 14px;font-size:13px;white-space:nowrap;flex-shrink:0;" onclick="window.MusicApp && MusicApp.loginAccount()">登录</button></div>'
                + '<div style="font-size:11px;color:var(--text-secondary);margin-top:6px;line-height:1.5;">纯本地站点无法直连网易云服务器登录账号，此处为本地模拟体验；添加网易云歌曲后即可直接在线播放。</div>';
        }
    }

    function loginAccount() {
        var input = el('music-account-input');
        var nick = input ? input.value.trim() : '';
        if (!nick) { _notify('请输入昵称', 'warning', 2000); return; }
        t.account = { nick: nick };
        _save();
        renderAccount();
        _log('你已登录网易云账号：' + nick);
        _notify('登录成功：' + nick, 'success', 2000);
    }

    function logoutAccount() {
        t.account = null;
        _save();
        renderAccount();
        _notify('已退出网易云账号', 'info', 1800);
    }

    function renderPlaylist() {
        var box = el('music-playlist');
        var localBox = el('music-local-list');
        if (!box) return;
        if (!t.playlist.length) {
            box.innerHTML = '<div class="mq-empty">播放列表为空，先在上方添加网易云歌曲吧</div>';
            if (localBox) localBox.innerHTML = '';
            return;
        }
        var html = t.playlist.map(function(s, idx) {
            var active = idx === t.index;
            var badge = s.kind === 'netease' ? '网易云' : '本地';
            var isCurrent = active && t.playing ? '<i class="fas fa-volume-up" style="color:var(--accent-color);"></i>' : (active ? '<i class="fas fa-pause"></i>' : '');
            return '<div class="mq-song ' + (active ? 'active' : '') + '" onclick="window.MusicApp && MusicApp.playIndex(' + idx + ')">'
                + '<span class="mq-song-play">' + isCurrent + '</span>'
                + '<span class="mq-song-title">' + escapeHtml(s.title) + '</span>'
                + '<span class="mq-song-badge ' + (s.kind === 'netease' ? 'net' : 'loc') + '">' + badge + '</span>'
                + '<span class="mq-song-del" onclick="event.stopPropagation();window.MusicApp && MusicApp.removeSong(' + idx + ')"><i class="fas fa-times"></i></span>'
                + '</div>';
        }).join('');
        box.innerHTML = html;
        if (localBox) {
            var locals = t.playlist.filter(function(s) { return s.kind === 'local'; });
            localBox.innerHTML = locals.length
                ? locals.map(function(s, li) {
                    var idx = t.playlist.indexOf(s);
                    return '<div class="mq-song ' + (idx === t.index ? 'active' : '') + '" onclick="window.MusicApp && MusicApp.playIndex(' + idx + ')">'
                        + '<span class="mq-song-play"><i class="fas fa-music"></i></span>'
                        + '<span class="mq-song-title">' + escapeHtml(s.title) + '</span>'
                        + '<span class="mq-song-badge loc">本地</span>'
                        + '</div>';
                }).join('')
                : '<div class="mq-empty">尚未添加本地音乐文件</div>';
        }
    }

    function renderNowPlaying() {
        var box = el('music-now-playing');
        if (!box) return;
        var song = currentSong();
        if (!song) {
            box.innerHTML = '<i class="fas fa-music"></i> 未在播放';
            var icon = el('music-play-toggle');
            if (icon) icon.innerHTML = '<i class="fas fa-play"></i>';
            return;
        }
        box.innerHTML = '<i class="fas fa-music ' + (t.playing ? 'playing' : '') + '"></i> <span class="mq-now-title">' + escapeHtml(song.title) + '</span>'
            + '<span class="mq-now-src">' + (song.kind === 'netease' ? '网易云' : '本地音乐') + '</span>';
        var icon = el('music-play-toggle');
        if (icon) icon.innerHTML = t.playing ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
    }

    function renderTogether() {
        var status = el('music-together-status');
        var actions = el('music-together-actions');
        if (status) {
            if (t.invitePending && !t.together) {
                status.innerHTML = '<div class="mq-status-line"><i class="fas fa-phone-volume"></i> ' + _partnerName() + ' 邀请你一起听歌</div>';
                var card = el('music-invite-card');
                if (card) card.innerHTML = '<div style="font-size:13px;color:var(--text-primary);margin-bottom:10px;">' + _partnerName() + ' 正在等你一起听歌 🎧</div>';
            } else if (t.together) {
                status.innerHTML = '<div class="mq-status-line on"><i class="fas fa-headphones"></i> 正在一起听歌中</div>';
            } else {
                status.innerHTML = '<div class="mq-status-line"><i class="fas fa-music"></i> 当前未在收听</div>';
            }
        }
        if (actions) {
            if (t.invitePending && !t.together) {
                actions.innerHTML = '<button class="modal-btn modal-btn-primary" style="flex:1;" onclick="window.MusicApp && MusicApp.acceptInvite()"><i class="fas fa-check"></i> 接受邀请</button>'
                    + '<button class="modal-btn modal-btn-secondary" style="flex:1;" onclick="window.MusicApp && MusicApp.declineInvite()">拒绝</button>';
            } else if (t.together) {
                actions.innerHTML = '<button class="modal-btn modal-btn-secondary" style="flex:1;" onclick="window.MusicApp && MusicApp.exitTogether(false)"><i class="fas fa-sign-out-alt"></i> 结束一起听</button>';
            } else {
                actions.innerHTML = '<button class="modal-btn modal-btn-primary" style="flex:1;" ' + (t.playlist.length ? '' : 'disabled') + ' onclick="window.MusicApp && MusicApp.startTogether()"><i class="fas fa-headphones"></i> 发起一起听</button>';
            }
        }
    }

    function declineInvite() {
        t.invitePending = false;
        _save();
        renderTogether();
        _log('你婉拒了' + _partnerName() + '的邀请');
        _notify('已拒绝邀请', 'info', 1800);
    }

    function renderLog() {
        var box = el('music-log');
        if (!box) return;
        if (!t.log.length) {
            box.innerHTML = '<div class="mq-empty">暂无动态</div>';
            return;
        }
        box.innerHTML = t.log.slice(0, 20).map(function(li) {
            return '<div class="mq-log-item"><span class="mq-log-time">' + li.time + '</span><span class="mq-log-text">' + escapeHtml(li.text) + '</span></div>';
        }).join('');
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    // ========== 弹窗控制 ==========

    function openModal() {
        var modal = el('music-modal');
        if (!modal) return;
        if (typeof window.homeShowModal === 'function') window.homeShowModal(modal);
        else if (typeof window.showModal === 'function') window.showModal(modal);
        else modal.style.display = 'flex';
        renderAll();
    }

    function close() {
        var modal = el('music-modal');
        if (!modal) return;
        if (typeof window.homeHideModal === 'function') window.homeHideModal(modal);
        else if (typeof window.hideModal === 'function') window.hideModal(modal);
        else modal.style.display = 'none';
    }

    function switchTab(tab) {
        var map = { player: ['music-tab-player', 'music-panel-player'], local: ['music-tab-local', 'music-panel-local'], together: ['music-tab-together', 'music-panel-together'] };
        var cfg = map[tab];
        if (!cfg) return;
        Object.keys(map).forEach(function(k) {
            var mk = map[k];
            var tb = el(mk[0]); if (tb) tb.classList.toggle('active', k === tab);
            var pnl = el(mk[1]); if (pnl) pnl.classList.toggle('fl-panel-active', k === tab);
        });
        if (tab === 'together') renderTogether();
        if (tab === 'local') renderPlaylist();
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

        var localFile = el('music-local-file');
        if (localFile) {
            localFile.addEventListener('change', function() {
                addLocalFiles(localFile.files);
                localFile.value = '';
            });
        }

        if (typeof window._musicHook !== 'function') window._musicHook = _musicHook;

        if (typeof window._hookFeaturesSimulateReply !== 'function') {
            window._hookFeaturesSimulateReply = function() {
                try {
                    if (typeof window._musicHook === 'function' && window._musicHook()) return true;
                    if (typeof window._quizHook === 'function' && window._quizHook()) return true;
                } catch (e) { console.error('[hookFeaturesSimulateReply]', e); }
                return false;
            };
        }

        setInterval(_heartbeat, 45000);
    }

    // ========== 导出 ==========

    window.MusicApp = {
        init: init,
        onShow: onShow,
        openModal: openModal,
        close: close,
        switchTab: switchTab,
        loginAccount: loginAccount,
        logoutAccount: logoutAccount,
        addNetease: addNetease,
        playIndex: playIndex,
        togglePlay: togglePlay,
        prev: prev,
        next: next,
        stopPlayback: stopPlayback,
        removeSong: removeSong,
        startTogether: startTogether,
        acceptInvite: acceptInvite,
        declineInvite: declineInvite,
        exitTogether: exitTogether
    };

    window.initMusicFeature = function() { init(); };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();