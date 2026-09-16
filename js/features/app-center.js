/* ================================================================================
 * 应用中心 - 头部「应用中心」入口 + 六板块分发
 * 对齐 D:\wz\js\home.js 的 window.openApp(app) 分发逻辑；
 * 各板块脚本按需懒加载（js/features/<script>），加载完成后调用对应入口挂载。
 * 板块入口契约（移植时保持）：
 *   - shop   : window.ShopApp.showShop(tab?)            （tab === 'food' 时打开外卖）
 *   - moyu   : window.MoyuApp.open()
 *   - call-records : window.CallRecords.openCallRecordsModal()
 *   - gift   : window.GiftCabinetApp.open()
 *   - ta-phone : window.TaPhoneApp.showTaPhone()
 * ================================================================================ */
(function () {
    var APPS = [
        { id: 'shop', label: '商城', icon: 'fas fa-store', color: '#ff6b4a', script: 'js/features/shop.js', mount: function () { if (window.ShopApp && ShopApp.showShop) { ShopApp.showShop(); return true; } return false; } },
        { id: 'food', label: '外卖', icon: 'fas fa-utensils', color: '#ff9f43', script: 'js/features/shop.js', mount: function () { if (window.ShopApp && ShopApp.showShop) { ShopApp.showShop('food'); return true; } return false; } },
        { id: 'moyu', label: '摸鱼小记', icon: 'fas fa-fish', color: '#2ea6c9', script: 'js/features/moyu.js', mount: function () { if (window.MoyuApp && MoyuApp.open) { MoyuApp.open(); return true; } return false; } },
        { id: 'call-records', label: '通讯记录', icon: 'fas fa-phone-alt', color: '#9b59b6', script: 'js/features/call-records.js', mount: function () { if (window.CallRecords && CallRecords.openCallRecordsModal) { CallRecords.openCallRecordsModal(); return true; } return false; } },
        { id: 'gift', label: '礼物柜', icon: 'fas fa-gift', color: '#ff6b81', script: 'js/features/gift-cabinet.js', mount: function () { if (window.GiftCabinetApp && GiftCabinetApp.open) { GiftCabinetApp.open(); return true; } return false; } },
        { id: 'ta-phone', label: 'TA的手机', icon: 'fas fa-mobile-alt', color: '#a29bfe', script: 'js/features/ta-phone.js', mount: function () { if (window.TaPhoneApp && TaPhoneApp.showTaPhone) { TaPhoneApp.showTaPhone(); return true; } return false; } }
    ];

    var _byId = {};
    APPS.forEach(function (a) { _byId[a.id] = a; });

    function notify(type, text) {
        if (typeof showNotification === 'function') showNotification(text, type);
    }

    function getModal() { return document.getElementById('apps-modal'); }
    function getGrid() { return document.getElementById('apps-modal-grid'); }

    function renderGrid() {
        var grid = getGrid();
        if (!grid || grid.dataset.built) return;
        grid.dataset.built = '1';
        APPS.forEach(function (a) {
            var item = document.createElement('div');
            item.className = 'app-item';
            item.setAttribute('data-app', a.id);
            item.innerHTML = '<div class="app-icon" style="color:' + a.color + ';"><i class="' + a.icon + '"></i><span class="app-badge" style="display:none;"></span></div><div class="app-name">' + a.label + '</div>';
            item.addEventListener('click', function () { openApp(a.id); });
            grid.appendChild(item);
        });
    }

    function mountApp(a) {
        if (a && typeof a.mount === 'function') {
            try { return !!a.mount(); } catch (e) {}
        }
        return false;
    }

    function loadScript(src, onDone) {
        var s = document.createElement('script');
        s.src = src;
        s.onload = onDone;
        s.onerror = onDone;
        document.head.appendChild(s);
    }

    function dispatch(a) {
        if (!a) { notify('info', '未找到该板块'); return; }
        if (mountApp(a)) { closeAppCenter(); return; }
        if (a._loading) { notify('info', '正在加载「' + a.label + '」…'); return; }
        if (!a.script) { notify('info', '「' + a.label + '」暂未开放'); return; }
        a._loading = true;
        notify('info', '正在加载「' + a.label + '」…');
        loadScript(a.script, function () {
            a._loading = false;
            try {
                if (mountApp(a)) closeAppCenter();
                else notify('info', '「' + a.label + '」加载失败');
            } catch (e) {
                notify('info', '「' + a.label + '」加载失败');
            }
        });
    }

    function openAppCenter() {
        renderGrid();
        var modal = getModal();
        if (modal) showModal(modal);
        return modal;
    }

    function closeAppCenter() {
        var modal = getModal();
        if (modal) hideModal(modal);
    }

    function openApp(id) {
        dispatch(_byId[id] || { id: id, label: id });
    }

    function setBadge(id, show) {
        var item = document.querySelector('.app-item[data-app="' + id + '"]');
        if (!item) return;
        var badge = item.querySelector('.app-badge');
        if (badge) badge.style.display = show ? 'block' : 'none';
    }

    function updateBadges(map) {
        if (!map) return;
        Object.keys(map).forEach(function (k) { setBadge(k, !!map[k]); });
    }

    function init() {
        renderGrid();
        var modal = getModal();
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeAppCenter();
            });
        }
        var closeBtn = document.getElementById('apps-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', closeAppCenter);
    }

    init();

    window.AppCenter = {
        open: openAppCenter,
        openAppCenter: openAppCenter,
        closeAppCenter: closeAppCenter,
        openApp: openApp,
        setBadge: setBadge,
        updateBadges: updateBadges,
        getApps: function () { return APPS.slice(); }
    };
    window.openAppCenter = openAppCenter;
})();