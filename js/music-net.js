/* ============================================================
 * wz2 网易云音乐解析（复刻自 mochi js/music-player.js 的网易云部分）
 * ------------------------------------------------------------
 * 用途：让「添加歌曲」里可以直接粘贴网易云的
 *       单曲链接 / 歌单链接 / 短链 / 纯数字歌曲ID，
 *       自动补出歌名、歌手、封面，并把整首歌单一次性导进 wz2 歌单。
 *
 * 播放地址用 meting 代理（type=url&id=xxx 会 302 到真实音频）：
 *   https://api.injahow.cn/meting/?type=url&id=<id>
 * 失败时依次退回：
 *   1) 再解析一次真实直链（resolveDirect）
 *   2) 网易云官方外链 https://music.163.com/song/media/outer/url?id=<id>
 *
 * 歌单/单曲信息用多路源并行赛跑，谁先返回用谁：
 *   api.qijieya.cn/meting  →  api.injahow.cn/meting
 *   → proxy.cors.sh(网易云官方接口)  →  api.allorigins.win(网易云官方接口)
 * ============================================================ */
(function () {
    'use strict';
    if (window.NetMusic) return;

    const METING = 'https://api.injahow.cn/meting/';
    const PLAYLIST_API = id =>
        'https://music.163.com/api/v6/playlist/detail?id=' + encodeURIComponent(String(id)) + '&n=1000&s=8';

    /* ── 链接/ID 识别 ─────────────────────────────── */
    function extractPlaylistId(line) {
        if (!line || typeof line !== 'string') return '';
        if (/\.mp3/i.test(line)) return '';
        const m = line.match(/playlist[\/?#&!\s]*(?:id=)?(\d+)/i);
        return m ? m[1] : '';
    }

    function extractNeteaseSongId(line) {
        if (!line || typeof line !== 'string') return '';
        const s = String(line).trim();
        if (/^\d+$/.test(s)) return s;
        let m = s.match(/[?&]id=(\d+)/);
        if (m) return m[1];
        m = s.match(/\/(?:song|playlist)\/(\d+)/i);
        if (m) return m[1];
        m = s.match(/\/(\d{5,})(?:\.mp3)?(?:\?|#|$)/);
        if (m) return m[1];
        return '';
    }

    function isNetShortLink(line) {
        if (!line || typeof line !== 'string') return false;
        return /(?:^|[\s/])163cn\.tv\/[\w-]+/i.test(String(line).trim());
    }

    /* 有没有可能是网易云的东西（用来决定要不要自动去解析） */
    function looksLikeNetease(line) {
        const s = String(line || '').trim();
        if (!s) return false;
        if (isNetShortLink(s)) return true;
        if (/music\.163\.com/i.test(s)) return true;
        if (/^(?:netease:|163cn)/i.test(s)) return true;
        if (/playlist/i.test(s) && /\d{5,}/.test(s)) return true;
        return false;
    }

    function fetchText(url, ms) {
        let ctrl = null;
        try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
        const timer = setTimeout(() => { try { ctrl && ctrl.abort(); } catch (e) {} }, ms || 8000);
        return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
            .then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(t => { clearTimeout(timer); return t; })
            .catch(e => { clearTimeout(timer); throw e; });
    }

    /* 短链 163cn.tv/xxx → 真实歌曲ID */
    function resolveNetShortLink(link) {
        const target = String(link).trim().replace(/^http:\/\//i, 'https://');
        const sources = [
            { p: 'https://proxy.cors.sh/', enc: false },
            { p: 'https://api.allorigins.win/raw?url=', enc: true }
        ];
        return Promise.all(sources.map(pr =>
            fetchText(pr.p + (pr.enc ? encodeURIComponent(target) : target), 7000)
                .then(txt => {
                    let m = String(txt || '').match(/music\.163\.com[^"'<>]*?\/song[^"'<>]*?(?:id=)?(\d{5,})/i);
                    if (!m) m = String(txt || '').match(/(?:song[\/?#]+id=|song\/)[^"'<>]{0,40}?(\d{5,})/i);
                    return m && m[1] ? m[1] : '';
                })
                .catch(() => '')
        )).then(ids => ids.find(Boolean) || '');
    }

    function canonicalMetingPicUrl(pic) {
        const s = String(pic || '');
        if (!s) return '';
        const idm = /[?&]type=pic\b/i.test(s) && s.match(/[?&]id=(\d+)/);
        if (idm) return METING + '?server=netease&type=pic&id=' + idm[1];
        return s.replace(/^http:\/\//i, 'https://');
    }

    function normNeteaseCoverUrl(u) {
        const s = String(u || '');
        if (!/^https?:\/\/([^/]+\.)?music\.126\.net\//i.test(s)) return s;
        return s.replace(/^http:\/\//i, 'https://').replace(/\?.*$/, '') + '?param=300y300';
    }

    function parseMetingPlaylist(txt) {
        let j;
        try { j = JSON.parse(txt); } catch (e) { return null; }
        if (!Array.isArray(j) || !j.length) return null;
        const list = [];
        j.forEach(t => {
            if (!t) return;
            const mid = String(t.url || '').match(/type=url&id=(\d+)/);
            const url = mid ? neteaseMetingUrl(mid[1]) : (t.url || '');
            if (!url) return;
            list.push({
                neteaseId: mid ? mid[1] : '',
                name: t.name || t.title || '',
                artist: t.artist || t.author || '',
                cover: canonicalMetingPicUrl(t.pic),
                url,
                duration: 0
            });
        });
        return list.length ? { list } : null;
    }

    function parseOfficialPlaylist(txt) {
        let j;
        try { j = JSON.parse(txt); } catch (e) { return null; }
        const pl = j && j.playlist;
        if (!pl || !Array.isArray(pl.tracks) || !pl.tracks.length) return null;
        const list = [];
        pl.tracks.forEach(s => {
            if (!s || !s.id) return;
            list.push({
                neteaseId: String(s.id),
                name: s.name || '',
                artist: ((s.ar || []).map(a => a.name).filter(Boolean).join('/')),
                cover: String((s.al && s.al.picUrl) || '').replace(/^http:\/\//i, 'https://'),
                url: neteaseMetingUrl(s.id),
                duration: s.dt ? Math.round(s.dt / 1000) : 0
            });
        });
        return list.length ? { list, total: parseInt(pl.trackCount, 10) || 0 } : null;
    }

    /* 官方 song/detail 接口解析单曲信息 */
    function parseOfficialSong(txt) {
        let d;
        try { d = (typeof txt === 'string') ? JSON.parse(txt) : txt; } catch (e) { return null; }
        if (d && d.songs && d.songs[0]) {
            const s = d.songs[0];
            return {
                name: s.name || '',
                artist: (s.artists || []).map(a => a.name).filter(Boolean).join('/'),
                cover: (s.album && s.album.picUrl) || '',
                duration: s.dt ? Math.round(s.dt / 1000) : 0
            };
        }
        return null;
    }

    /* 抓网易云歌曲网页的 <title>（"歌名 - 歌手 - 网易云音乐"） */
    function parseNeteasePageTitle(txt) {
        const m = String(txt || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (!m) return null;
        const seg = m[1].split(/\s*-\s*/).map(x => x.trim()).filter(Boolean);
        if (!seg.length) return null;
        return { name: seg[0], artist: seg[1] || '', cover: '' };
    }

    /* ── 播放地址 ─────────────────────────────────── */
    function neteaseMetingUrl(id) {
        return METING + '?type=url&id=' + encodeURIComponent(String(id));
    }

    function neteaseOuterUrl(id) {
        return 'https://music.163.com/song/media/outer/url?id=' + encodeURIComponent(String(id));
    }

    /* meting 会 302 到真实音频，这里把落地地址取出来（失败就交回 null） */
    function resolveDirect(id) {
        let ctrl = null;
        try { ctrl = new AbortController(); } catch (e) { ctrl = null; }
        const timer = setTimeout(() => { try { ctrl && ctrl.abort(); } catch (e) {} }, 8000);
        return fetch(neteaseMetingUrl(id), ctrl ? { signal: ctrl.signal } : undefined)
            .then(r => {
                clearTimeout(timer);
                let ct = '';
                try { ct = (r.headers && r.headers.get('content-type')) || ''; } catch (e) {}
                const ok = !!(r.redirected || /^audio\//i.test(ct));
                const finalUrl = ok ? String(r.url || '').replace(/^http:/i, 'https:') : '';
                try { r.body && r.body.cancel && r.body.cancel().catch(() => {}); } catch (e) {}
                return finalUrl || null;
            })
            .catch(() => { clearTimeout(timer); return null; });
    }

    /* 依次尝试：meting 直链 → 官方外链，返回第一个能用的 */
    function resolvePlayable(id) {
        return resolveDirect(id).then(u => u || neteaseOuterUrl(id));
    }

    /* ── 单曲信息（多路赛跑，谁先回用谁）────────────── */
    function fetchSongInfo(id) {
        const pageUrl = 'https://music.163.com/song?id=' + encodeURIComponent(String(id));
        const detailApi = 'https://music.163.com/api/song/detail/?ids=' + encodeURIComponent(String(id));
        const sources = [
            {
                url: METING + '?server=netease&type=song&id=' + encodeURIComponent(String(id)),
                parse(t) { return parseMetingSong(t); }
            },
            { url: 'https://proxy.cors.sh/' + pageUrl, parse: parseNeteasePageTitle },
            { url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(pageUrl), parse: parseNeteasePageTitle },
            { url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(detailApi), parse: parseOfficialSong }
        ];
        // 串行回退：第 1 条失败/超时才试下一条，避免同时打 4 个请求
        let idx = 0;
        const tryNext = () => {
            if (idx >= sources.length) return Promise.resolve(null);
            const src = sources[idx++];
            return fetchText(src.url, 8000)
                .then(t => {
                    let res = null;
                    try { res = src.parse(t); } catch (e) { res = null; }
                    if (res && res.name) return res;
                    return tryNext();
                })
                .catch(() => tryNext());
        };
        return tryNext();
    }

    function parseMetingSong(txt) {
        let d;
        try { d = JSON.parse(txt); } catch (e) { return null; }
        const s = d && d[0];
        return s && s.name ? { name: s.name, artist: s.artist || '', cover: s.pic || '', duration: 0 } : null;
    }

    /* ── 歌单（多路赛跑，谁先回用谁）────────────────── */
    function fetchPlaylist(id) {
        const pid = encodeURIComponent(String(id));
        const sources = [
            { url: 'https://api.qijieya.cn/meting/?server=netease&type=playlist&id=' + pid, parse: parseMetingPlaylist },
            { url: METING + '?type=playlist&id=' + pid, parse: parseMetingPlaylist },
            { url: 'https://proxy.cors.sh/' + PLAYLIST_API(id), parse: parseOfficialPlaylist },
            { url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(PLAYLIST_API(id)), parse: parseOfficialPlaylist }
        ];
        let idx = 0;
        const tryNext = () => {
            if (idx >= sources.length) return Promise.resolve(null);
            const src = sources[idx++];
            return fetchText(src.url, 9000)
                .then(t => {
                    let res = null;
                    try { res = src.parse(t); } catch (e) { res = null; }
                    if (res && res.list && res.list.length) return res;
                    return tryNext();
                })
                .catch(() => tryNext());
        };
        return tryNext();
    }

    /* ── 对外主入口 ───────────────────────────────
       返回 { kind:'playlist'|'song', tracks:[{neteaseId,name,artist,cover,url,duration}] }
       不是网易云内容就返回 null，交给调用方走原来的普通链接逻辑。   */
    function resolve(input) {
        const text = String(input || '').trim();
        if (!text) return Promise.resolve(null);

        const plId = extractPlaylistId(text);
        const songId = extractNeteaseSongId(text);

        if (plId) {
            return fetchPlaylist(plId).then(res => {
                if (!res) return null;
                return { kind: 'playlist', playlistId: plId, tracks: res.list, total: res.total || res.list.length };
            });
        }

        let idPromise;
        if (isNetShortLink(text)) {
            idPromise = resolveNetShortLink(text).then(id => id || '');
        } else if (songId) {
            idPromise = Promise.resolve(songId);
        } else {
            return Promise.resolve(null);
        }

        return idPromise.then(id => {
            if (!id) return null;
            return fetchSongInfo(id).then(info => {
                const it = info || { name: '', artist: '', cover: '', duration: 0 };
                return {
                    kind: 'song',
                    tracks: [{
                        neteaseId: id,
                        name: it.name || ('网易云歌曲 ' + id),
                        artist: it.artist || '',
                        cover: normNeteaseCoverUrl(it.cover || ''),
                        url: neteaseMetingUrl(id),
                        duration: it.duration || 0
                    }]
                };
            });
        });
    }

    window.NetMusic = {
        resolve,
        resolveSong: id => resolve(String(id)),
        resolvePlaylist: id => resolve('playlist?id=' + id),
        resolveDirect,
        resolvePlayable,
        neteaseMetingUrl,
        neteaseOuterUrl,
        extractNeteaseSongId,
        extractPlaylistId,
        isNetShortLink,
        looksLikeNetease,
        normNeteaseCoverUrl
    };
})();