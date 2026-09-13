/**
 * moyu.js - 摸鱼小记功能（自 D:\wz 移植，自包含）
 * 覆盖：数据模型（moyuRecords / moyuLocations / moyuActivities / currentMoyuRecord
 *       / moyuWorkSession / moyuUnread）持久化、工作会话模拟（wz core.js 同款定时器）、
 *       面板渲染与地点库管理、自动生成开关、未读小红点（应用中心 badge）。
 * 数据键：${APP_PREFIX}moyuRecords 等（localforage），与 wz 键名一致。
 */
(function () {
  'use strict';

  const APP_PREFIX = window.APP_PREFIX || 'CHAT_APP_V3_';

  function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }
  if (typeof window.escapeHtml !== 'function') window.escapeHtml = escapeHtml;

  // ==================== 数据模型 ====================
  window.moyuRecords = [];
  window.moyuLocations = [];
  window.moyuActivities = [];
  window.currentMoyuRecord = null;
  window.moyuWorkSession = null;
  let moyuUnread = false;

  window.moyuFilterType = 'all';
  window.moyuFilterStartDate = null;
  window.moyuFilterEndDate = null;

  let moyuSessionTimer = null;
  let moyuMessageTimer = null;
  let moyuWorkEndTimer = null;

  function KEY(k) { return APP_PREFIX + k; }

  function persist(keys) {
    (keys || []).forEach(function (k) {
      let v = null;
      if (k === 'moyuRecords') v = window.moyuRecords;
      else if (k === 'moyuLocations') v = window.moyuLocations;
      else if (k === 'moyuActivities') v = window.moyuActivities;
      else if (k === 'currentMoyuRecord') v = window.currentMoyuRecord;
      else if (k === 'moyuWorkSession') v = window.moyuWorkSession;
      else if (k === 'moyuUnread') v = moyuUnread;
      localforage.setItem(KEY(k), v).catch(function () {});
    });
  }

  const DEFAULT_LOCATIONS = ['公司', '图书馆', '咖啡馆', '书房', '自习室'];
  const DEFAULT_ACTIVITIES = [
    '正在整理项目文档',
    '回复了几封邮件',
    '开了个线上会议',
    '更新了一份周报',
    '处理了一张统计表格',
    '写了一段代码',
    '给同事讲了下需求',
    '翻看了一篇技术文章',
    '整理待办清单',
    '调了一个小 Bug',
    '喝口水休息一下',
    '瞄了一眼窗外风景'
  ];

  // ==================== 数据加载 ====================
  async function loadMoyuData() {
    try {
      const [records, locations, activities, current, session, unread] = await Promise.all([
        localforage.getItem(KEY('moyuRecords')),
        localforage.getItem(KEY('moyuLocations')),
        localforage.getItem(KEY('moyuActivities')),
        localforage.getItem(KEY('currentMoyuRecord')),
        localforage.getItem(KEY('moyuWorkSession')),
        localforage.getItem(KEY('moyuUnread'))
      ]);
      if (Array.isArray(records)) window.moyuRecords = records;
      if (Array.isArray(locations)) window.moyuLocations = locations;
      if (Array.isArray(activities)) window.moyuActivities = activities;
      if (current) window.currentMoyuRecord = current;
      if (session) window.moyuWorkSession = session;
      moyuUnread = !!unread;
    } catch (e) {}

    // 种子数据：空地点/活动时填充默认值（保证开箱即用）
    if (window.moyuLocations.length === 0) {
      window.moyuLocations = DEFAULT_LOCATIONS.slice();
      persist(['moyuLocations']);
    }
    if (window.moyuActivities.length === 0) {
      window.moyuActivities = DEFAULT_ACTIVITIES.slice();
      persist(['moyuActivities']);
    }

    if (typeof settings === 'undefined' || settings.moyuAutoGenerateEnabled !== true) {
      if (typeof settings !== 'undefined') settings.moyuAutoGenerateEnabled = false;
    }
    if (typeof settings !== 'undefined') {
      if (typeof settings.moyuShowDetail !== 'boolean') settings.moyuShowDetail = true;
    }

    syncUnreadBadge();
    manageMoyuAutoGenerateTimer();
  }

  // ==================== 未读 / 应用中心 badge ====================
  window.setMoyuUnread = function () {
    moyuUnread = true;
    persist(['moyuUnread']);
    syncUnreadBadge();
  };

  window.clearMoyuUnread = function () {
    moyuUnread = false;
    persist(['moyuUnread']);
    syncUnreadBadge();
  };

  function syncUnreadBadge() {
    if (window.AppCenter && typeof window.AppCenter.setBadge === 'function') {
      window.AppCenter.setBadge('moyu', moyuUnread);
    }
  }

  // ==================== 弹窗管理 ====================
  window.openMoyuModal = function () {
    const modal = document.getElementById('moyu-modal');
    if (!modal) return;

    if (typeof window.clearMoyuUnread === 'function') window.clearMoyuUnread();

    if (typeof showModal === 'function') showModal(modal);
    else modal.style.display = 'flex';

    window.renderMoyuCurrent();
    window.renderMoyuRecords();
    window.renderMoyuLocations();
    window.renderMoyuStats();
    updateAutoGenerateUI();

    window.switchMoyuTab('current');
  };

  window.closeMoyuModal = function () {
    const modal = document.getElementById('moyu-modal');
    if (!modal) return;
    if (typeof hideModal === 'function') hideModal(modal);
    else modal.style.display = 'none';
  };

  // ==================== 标签页切换 ====================
  window.switchMoyuTab = function (tab) {
    const currentPanel = document.getElementById('moyu-current-panel');
    const recordsPanel = document.getElementById('moyu-records-panel');
    const currentTab = document.getElementById('moyu-tab-current');
    const recordsTab = document.getElementById('moyu-tab-records');

    if (!currentPanel || !recordsPanel || !currentTab || !recordsTab) return;

    if (tab === 'current') {
      currentPanel.style.display = 'block';
      recordsPanel.style.display = 'none';
      currentTab.classList.add('active');
      currentTab.style.background = 'rgba(var(--accent-color-rgb), 0.16)';
      currentTab.style.color = 'var(--accent-color)';
      recordsTab.classList.remove('active');
      recordsTab.style.background = 'transparent';
      recordsTab.style.color = 'var(--text-secondary)';
    } else {
      currentPanel.style.display = 'none';
      recordsPanel.style.display = 'block';
      currentTab.classList.remove('active');
      currentTab.style.background = 'transparent';
      currentTab.style.color = 'var(--text-secondary)';
      recordsTab.classList.add('active');
      recordsTab.style.background = 'rgba(var(--accent-color-rgb), 0.16)';
      recordsTab.style.color = 'var(--accent-color)';
    }
  };

  // ==================== 当前面板渲染 ====================
  window.renderMoyuCurrent = function () {
    const panel = document.getElementById('moyu-current-panel');
    if (!panel) return;

    if (!window.currentMoyuRecord) {
      panel.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
          <i class="fas fa-fish" style="font-size: 36px; margin-bottom: 12px; opacity: 0.3;"></i>
          <div style="font-size: 13px;">暂无摸鱼记录</div>
          <div style="font-size: 11px; margin-top: 8px; opacity: 0.7; line-height: 1.6;">
            梦角会在此生成<br>
            记录生活的摸鱼记录
          </div>
          <div style="margin-top: 16px; padding: 12px; background: rgba(var(--accent-color-rgb), 0.08); border-radius: 10px; border: 1px dashed rgba(var(--accent-color-rgb), 0.3);">
            <div style="font-size: 11px; color: var(--text-secondary);">
              <i class="fas fa-info-circle" style="margin-right: 4px;"></i>
              前往「记录」页签添加地点，<br>并开启摸摸鱼自动生成
            </div>
          </div>
        </div>
      `;
      return;
    }

    const record = window.currentMoyuRecord;
    const session = window.moyuWorkSession;

    let activitiesHtml = '';
    if (session && session.activities && session.activities.length > 0) {
      activitiesHtml = session.activities.map((act, idx) => {
        const time = new Date(act.time);
        const timeStr = time.getHours().toString().padStart(2, '0') + ':' + time.getMinutes().toString().padStart(2, '0') + ':' + time.getSeconds().toString().padStart(2, '0');
        return `
          <div style="background: var(--primary-bg); border-radius: 8px; padding: 10px 12px; margin-bottom: ${idx < session.activities.length - 1 ? '8px' : '0'};">
            <div style="font-size: 10px; color: var(--text-secondary); margin-bottom: 4px; opacity: 0.7;">
              <i class="fas fa-clock" style="margin-right: 2px; font-size: 9px;"></i>${timeStr}
            </div>
            <div style="font-size: 13px; color: var(--text-primary); line-height: 1.5;">${window.escapeHtml(act.content)}</div>
          </div>
        `;
      }).join('');
    } else if (record.note) {
      activitiesHtml = `
        <div style="background: var(--primary-bg); border-radius: 8px; padding: 10px 12px;">
          <div style="font-size: 13px; color: var(--text-primary); line-height: 1.5;">${window.escapeHtml(record.note)}</div>
        </div>
      `;
    }

    let remainingHtml = '';
    if (session && session.endTime) {
      const now = Date.now();
      const remaining = session.endTime - now;
      if (remaining > 0) {
        const remainMin = Math.floor(remaining / 60000);
        const remainHour = Math.floor(remainMin / 60);
        const remainMinLeft = remainMin % 60;
        const remainStr = remainHour > 0 ? `${remainHour}小时${remainMinLeft}分钟` : `${remainMinLeft}分钟`;
        remainingHtml = `
          <div style="font-size: 11px; color: var(--accent-color); background: rgba(var(--accent-color-rgb), 0.08); padding: 6px 10px; border-radius: 8px; margin-bottom: 12px; text-align: center;">
            <i class="fas fa-hourglass-half" style="margin-right: 4px;"></i>剩余工作时间 ${remainStr}
          </div>
        `;
      }
    }

    panel.innerHTML = `
      <div style="text-align: center; margin-bottom: 12px;">
        <span style="font-size: 11px; color: var(--text-secondary); background: rgba(var(--accent-color-rgb), 0.1); padding: 4px 10px; border-radius: 10px;">
          <i class="fas fa-clock" style="margin-right: 4px;"></i>当前摸鱼记录
        </span>
      </div>
      <div class="moyu-record-item" style="background: var(--secondary-bg); border-radius: 12px; padding: 14px; border: 1px solid var(--border-color);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-map-marker-alt" style="color: var(--accent-color); font-size: 12px;"></i>
            <span style="font-weight: 600; font-size: 14px;">${window.escapeHtml(record.location)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 12px; color: var(--text-secondary); background: rgba(var(--accent-color-rgb), 0.1); padding: 2px 8px; border-radius: 10px;">
              <i class="fas fa-clock" style="font-size: 10px; margin-right: 2px;"></i>${record.hours}h
            </span>
          </div>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">
          <i class="fas fa-calendar" style="margin-right: 4px;"></i>${record.date}
        </div>
        ${remainingHtml}
        <div style="margin-top: 8px;">
          ${activitiesHtml}
        </div>
      </div>
    `;
  };

  // ==================== 统计渲染 ====================
  window.renderMoyuStats = function () {
    const totalCountEl = document.getElementById('moyu-total-count');
    const totalHoursEl = document.getElementById('moyu-total-hours');
    const locationCountEl = document.getElementById('moyu-location-count');

    if (!totalCountEl || !totalHoursEl || !locationCountEl) return;

    const records = window.moyuRecords || [];
    const locations = window.moyuLocations || [];

    const totalCount = records.length;
    const totalHours = records.reduce((sum, r) => sum + (parseFloat(r.hours) || 0), 0);

    totalCountEl.textContent = totalCount;
    totalHoursEl.textContent = totalHours.toFixed(1);
    locationCountEl.textContent = locations.length;
  };

  // ==================== 记录列表渲染 ====================
  window.renderMoyuRecords = function () {
    const listEl = document.getElementById('moyu-records-list');
    if (!listEl) return;

    let records = window.moyuRecords || [];

    const filterType = window.moyuFilterType || 'all';
    const startDate = window.moyuFilterStartDate;
    const endDate = window.moyuFilterEndDate;

    if (filterType !== 'all') {
      const now = new Date();
      let filterStart = null;
      let filterEnd = null;

      switch (filterType) {
        case 'today':
          filterStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          filterEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          break;
        case 'week':
          filterStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          filterEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          break;
        case 'month':
          filterStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          filterEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          break;
        case 'custom':
          if (startDate && endDate) {
            filterStart = new Date(startDate);
            filterEnd = new Date(endDate);
            filterEnd.setDate(filterEnd.getDate() + 1);
          }
          break;
      }

      if (filterStart && filterEnd) {
        records = records.filter(r => {
          const recordDate = new Date(r.date);
          return recordDate >= filterStart && recordDate < filterEnd;
        });
      }
    }

    if (records.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
          <i class="fas fa-fish" style="font-size: 36px; margin-bottom: 12px; opacity: 0.3;"></i>
          <div style="font-size: 13px;">该时间段内没有记录~</div>
          <div style="font-size: 11px; margin-top: 4px; opacity: 0.7;">尝试调整时间筛选范围</div>
        </div>
      `;
      return;
    }

    const sortedRecords = [...records].sort((a, b) => new Date(b.date) - new Date(a.date));

    listEl.innerHTML = sortedRecords.map((record, index) => {
      const originalIndex = records.indexOf(record);

      let activities = [];
      if (record.activities && Array.isArray(record.activities)) {
        activities = record.activities;
      } else if (record.note && record.note.includes('• ')) {
        const lines = record.note.split('\n').filter(line => line.trim().startsWith('• '));
        activities = lines.map((line, idx) => ({
          content: line.replace(/^•\s*/, ''),
          time: record.createdAt ? new Date(record.createdAt).getTime() + idx * 60000 : Date.now()
        }));
      } else if (record.note) {
        activities = [{
          content: record.note,
          time: record.createdAt ? new Date(record.createdAt).getTime() : Date.now()
        }];
      }

      const displayCount = 2;
      const hasMore = activities.length > displayCount;
      const displayedActivities = activities.slice(0, displayCount);
      const hiddenActivities = activities.slice(displayCount);

      const activitiesHtml = displayedActivities.map((act, idx) => {
        const time = new Date(act.time);
        const timeStr = time.getHours().toString().padStart(2, '0') + ':' + time.getMinutes().toString().padStart(2, '0') + ':' + time.getSeconds().toString().padStart(2, '0');
        return `
          <div style="background: var(--primary-bg); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;">
            <div style="font-size: 10px; color: var(--text-secondary); margin-bottom: 4px; opacity: 0.7;">
              <i class="fas fa-clock" style="margin-right: 2px; font-size: 9px;"></i>${timeStr}
            </div>
            <div style="font-size: 13px; color: var(--text-primary); line-height: 1.5;">${window.escapeHtml(act.content)}</div>
          </div>
        `;
      }).join('');

      const hiddenActivitiesHtml = hiddenActivities.map((act) => {
        const time = new Date(act.time);
        const timeStr = time.getHours().toString().padStart(2, '0') + ':' + time.getMinutes().toString().padStart(2, '0') + ':' + time.getSeconds().toString().padStart(2, '0');
        return `
          <div style="background: var(--primary-bg); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px; display: none;" class="hidden-activity-${originalIndex}">
            <div style="font-size: 10px; color: var(--text-secondary); margin-bottom: 4px; opacity: 0.7;">
              <i class="fas fa-clock" style="margin-right: 2px; font-size: 9px;"></i>${timeStr}
            </div>
            <div style="font-size: 13px; color: var(--text-primary); line-height: 1.5;">${window.escapeHtml(act.content)}</div>
          </div>
        `;
      }).join('');

      const expandBtn = hasMore ? `
        <button onclick="window.toggleMoyuRecordExpand(${originalIndex})" id="moyu-expand-btn-${originalIndex}" style="width: 100%; padding: 8px; background: rgba(var(--accent-color-rgb), 0.08); border: 1px dashed rgba(var(--accent-color-rgb), 0.3); border-radius: 8px; color: var(--accent-color); font-size: 12px; cursor: pointer; font-family: var(--font-family); margin-top: 4px;">
          <i class="fas fa-chevron-down" style="margin-right: 4px;"></i>展开更多 (${hiddenActivities.length}条)
        </button>
      ` : '';

      return `
        <div class="moyu-record-item" style="background: var(--secondary-bg); border-radius: 12px; padding: 14px; margin-bottom: 10px; border: 1px solid var(--border-color);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i class="fas fa-map-marker-alt" style="color: var(--accent-color); font-size: 12px;"></i>
              <span style="font-weight: 600; font-size: 14px;">${window.escapeHtml(record.location)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 12px; color: var(--text-secondary); background: rgba(var(--accent-color-rgb), 0.1); padding: 2px 8px; border-radius: 10px;">
                <i class="fas fa-clock" style="font-size: 10px; margin-right: 2px;"></i>${record.hours}h
              </span>
              <button onclick="window.deleteMoyuRecord(${originalIndex})" style="background: none; border: none; color: #ff6b6b; cursor: pointer; padding: 4px; font-size: 12px;" title="删除">
                <i class="fas fa-trash-alt"></i>
              </button>
            </div>
          </div>
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">
            <i class="fas fa-calendar" style="margin-right: 4px;"></i>${record.date}
          </div>
          <div style="margin-top: 8px;">
            ${activitiesHtml}
            ${hiddenActivitiesHtml}
            ${expandBtn}
          </div>
        </div>
      `;
    }).join('');
  };

  window.toggleMoyuRecordExpand = function (index) {
    const hiddenItems = document.querySelectorAll(`.hidden-activity-${index}`);
    const btn = document.getElementById(`moyu-expand-btn-${index}`);
    if (!btn) return;

    const isExpanded = btn.dataset.expanded === 'true';
    if (isExpanded) {
      hiddenItems.forEach(item => item.style.display = 'none');
      btn.innerHTML = `<i class="fas fa-chevron-down" style="margin-right: 4px;"></i>展开更多 (${hiddenItems.length}条)`;
      btn.dataset.expanded = 'false';
    } else {
      hiddenItems.forEach(item => item.style.display = 'block');
      btn.innerHTML = `<i class="fas fa-chevron-up" style="margin-right: 4px;"></i>收起`;
      btn.dataset.expanded = 'true';
    }
  };

  // ==================== 时间筛选 ====================
  function updateFilterInfo(filterType) {
    const filterInfo = document.getElementById('moyu-filter-info');
    if (!filterInfo) return;

    const now = new Date();
    let infoText = '';

    switch (filterType) {
      case 'all':
        infoText = '显示全部记录';
        break;
      case 'today':
        infoText = `今天 (${now.toLocaleDateString('zh-CN')})`;
        break;
      case 'week': {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        infoText = `${weekAgo.toLocaleDateString('zh-CN')} 至 ${now.toLocaleDateString('zh-CN')}`;
        break;
      }
      case 'month': {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        infoText = `${monthAgo.toLocaleDateString('zh-CN')} 至 ${now.toLocaleDateString('zh-CN')}`;
        break;
      }
      case 'custom':
        if (window.moyuFilterStartDate && window.moyuFilterEndDate) {
          infoText = `${window.moyuFilterStartDate} 至 ${window.moyuFilterEndDate}`;
        } else {
          infoText = '请选择完整的日期范围';
        }
        break;
    }

    filterInfo.textContent = infoText;
  }

  window.initMoyuTimeFilter = function () {
    const presetSelect = document.getElementById('moyu-filter-preset');
    const customRange = document.getElementById('moyu-custom-date-range');
    const startInput = document.getElementById('moyu-filter-start');
    const endInput = document.getElementById('moyu-filter-end');
    const filterInfo = document.getElementById('moyu-filter-info');

    if (!presetSelect) return;

    const today = new Date().toISOString().split('T')[0];
    if (startInput) startInput.value = today;
    if (endInput) endInput.value = today;

    presetSelect.addEventListener('change', function () {
      const value = this.value;
      window.moyuFilterType = value;

      if (value === 'custom') {
        customRange.style.display = 'flex';
        filterInfo.textContent = '请选择自定义日期范围';
      } else {
        customRange.style.display = 'none';
        updateFilterInfo(value);
        window.renderMoyuRecords();
      }
    });

    if (startInput) {
      startInput.addEventListener('change', function () {
        window.moyuFilterStartDate = this.value;
        if (window.moyuFilterType === 'custom' && window.moyuFilterEndDate) {
          updateFilterInfo('custom');
          window.renderMoyuRecords();
        }
      });
    }

    if (endInput) {
      endInput.addEventListener('change', function () {
        window.moyuFilterEndDate = this.value;
        if (window.moyuFilterType === 'custom' && window.moyuFilterStartDate) {
          updateFilterInfo('custom');
          window.renderMoyuRecords();
        }
      });
    }

    window.moyuFilterType = 'all';
  };

  // ==================== 地点库渲染 ====================
  window.renderMoyuLocations = function () {
    const listEl = document.getElementById('moyu-locations-list');
    if (!listEl) return;

    const locations = window.moyuLocations || [];

    if (locations.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 20px 12px; color: var(--text-secondary);">
          <i class="fas fa-map-marked-alt" style="font-size: 28px; margin-bottom: 8px; opacity: 0.3;"></i>
          <div style="font-size: 12px;">还没有添加地点~</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = locations.map((loc, index) => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--secondary-bg); border-radius: 10px; margin-bottom: 6px; border: 1px solid var(--border-color);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <i class="fas fa-map-pin" style="color: var(--accent-color); font-size: 11px;"></i>
          <span style="font-size: 13px;">${window.escapeHtml(loc)}</span>
        </div>
        <button onclick="window.removeMoyuLocation(${index})" style="background: none; border: none; color: #ff6b6b; cursor: pointer; padding: 4px 8px; font-size: 12px;">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `).join('');
  };

  // ==================== 记录 / 地点管理 ====================
  window.deleteMoyuRecord = function (index) {
    if (!confirm('确定要删除这条记录吗？')) return;

    if (window.moyuRecords && index >= 0 && index < window.moyuRecords.length) {
      window.moyuRecords.splice(index, 1);
      persist(['moyuRecords']);
      if (typeof throttledSaveData === 'function') throttledSaveData();
      window.renderMoyuStats();
      window.renderMoyuRecords();
      if (typeof showNotification === 'function') showNotification('记录已删除', 'success');
    }
  };

  window.addMoyuLocation = function () {
    const input = document.getElementById('moyu-new-location-input');
    if (!input) return;

    const name = input.value.trim();
    if (!name) {
      if (typeof showNotification === 'function') showNotification('请输入地点名称', 'error');
      return;
    }

    if (!window.moyuLocations) window.moyuLocations = [];
    if (window.moyuLocations.includes(name)) {
      if (typeof showNotification === 'function') showNotification('该地点已存在', 'error');
      return;
    }

    window.moyuLocations.push(name);
    persist(['moyuLocations']);
    if (typeof throttledSaveData === 'function') throttledSaveData();

    input.value = '';

    window.renderMoyuStats();
    window.renderMoyuLocations();

    if (typeof showNotification === 'function') showNotification('地点添加成功', 'success');
  };

  window.removeMoyuLocation = function (index) {
    if (!confirm('确定要删除这个地点吗？')) return;

    if (window.moyuLocations && index >= 0 && index < window.moyuLocations.length) {
      window.moyuLocations.splice(index, 1);
      persist(['moyuLocations']);
      if (typeof throttledSaveData === 'function') throttledSaveData();
      window.renderMoyuStats();
      window.renderMoyuLocations();
      if (typeof showNotification === 'function') showNotification('地点已删除', 'success');
    }
  };

  // ==================== 自动生成开关 ====================
  function updateAutoGenerateUI() {
    const toggle = document.getElementById('moyu-auto-generate-toggle');
    const status = document.getElementById('moyu-auto-status');
    if (toggle) {
      const on = !!(settings && settings.moyuAutoGenerateEnabled);
      toggle.classList.toggle('active', on);
    }
    if (status) {
      const on = !!(settings && settings.moyuAutoGenerateEnabled);
      status.textContent = on ? '已开启：梦角会随机开始「工作」并生成摸鱼记录' : '已关闭：梦角将不生成新的摸鱼记录';
    }
  }

  window.toggleMoyuAutoGenerate = function () {
    if (typeof settings === 'undefined') return;
    settings.moyuAutoGenerateEnabled = !settings.moyuAutoGenerateEnabled;
    if (typeof throttledSaveData === 'function') throttledSaveData();
    updateAutoGenerateUI();
    if (settings.moyuAutoGenerateEnabled) {
      manageMoyuAutoGenerateTimer();
      if (typeof showNotification === 'function') showNotification('摸鱼自动生成已开启', 'success');
    } else {
      clearMoyuTimers();
      if (typeof showNotification === 'function') showNotification('摸鱼自动生成已关闭', 'success');
    }
  };

  // ==================== 工作会话模拟 ====================
  function clearMoyuTimers() {
    if (moyuSessionTimer) { clearTimeout(moyuSessionTimer); moyuSessionTimer = null; }
    if (moyuMessageTimer) { clearTimeout(moyuMessageTimer); moyuMessageTimer = null; }
    if (moyuWorkEndTimer) { clearTimeout(moyuWorkEndTimer); moyuWorkEndTimer = null; }
  }

  function manageMoyuAutoGenerateTimer() {
    clearMoyuTimers();
    if (!settings || !settings.moyuAutoGenerateEnabled) return;

    const now = Date.now();

    if (window.moyuWorkSession && now < window.moyuWorkSession.endTime) {
      scheduleNextMoyuMessage();
      return;
    }

    if (window.currentMoyuRecord && window.moyuWorkSession && now >= window.moyuWorkSession.endTime) {
      finishMoyuWorkSession();
    }

    const nextSessionDelay = Math.floor(Math.random() * 13) * 60 * 60 * 1000;
    moyuSessionTimer = setTimeout(() => {
      if (settings && settings.moyuAutoGenerateEnabled) {
        generateRandomMoyuRecord();
      }
    }, nextSessionDelay);
  }

  function scheduleNextMoyuMessage() {
    if (moyuMessageTimer) { clearTimeout(moyuMessageTimer); moyuMessageTimer = null; }

    if (!settings || !settings.moyuAutoGenerateEnabled || !window.moyuWorkSession) return;

    const now = Date.now();
    if (now >= window.moyuWorkSession.endTime) {
      finishMoyuWorkSession();
      const nextSessionDelay = Math.floor(Math.random() * 13) * 60 * 60 * 1000;
      moyuSessionTimer = setTimeout(() => {
        generateRandomMoyuRecord();
      }, nextSessionDelay);
      return;
    }

    const messageInterval = (Math.floor(Math.random() * 21) + 10) * 60 * 1000;
    const timeUntilEnd = window.moyuWorkSession.endTime - now;
    const actualInterval = Math.min(messageInterval, timeUntilEnd);

    moyuMessageTimer = setTimeout(() => {
      generateRandomMoyuRecord();
    }, actualInterval);
  }

  function scheduleWorkEndCheck() {
    if (moyuWorkEndTimer) { clearTimeout(moyuWorkEndTimer); moyuWorkEndTimer = null; }

    if (!window.moyuWorkSession) return;

    const now = Date.now();
    const timeUntilEnd = window.moyuWorkSession.endTime - now;

    if (timeUntilEnd > 0) {
      moyuWorkEndTimer = setTimeout(() => {
        finishMoyuWorkSession();
      }, timeUntilEnd);
    } else {
      finishMoyuWorkSession();
    }
  }

  function finishMoyuWorkSession() {
    if (!window.currentMoyuRecord || !window.moyuWorkSession) return;

    if (!window.moyuRecords) window.moyuRecords = [];
    window.moyuRecords.push(Object.assign({}, window.currentMoyuRecord, {
      activities: window.moyuWorkSession.activities
    }));

    window.currentMoyuRecord = null;
    window.moyuWorkSession = null;

    persist(['moyuRecords', 'currentMoyuRecord', 'moyuWorkSession']);

    if (typeof window.renderMoyuCurrent === 'function') window.renderMoyuCurrent();
    if (typeof window.renderMoyuRecords === 'function') window.renderMoyuRecords();
    if (typeof window.renderMoyuStats === 'function') window.renderMoyuStats();
    window.setMoyuUnread();

    showMoyuWorkEndNotification();

    if (settings && settings.moyuAutoGenerateEnabled) {
      const nextSessionDelay = Math.floor(Math.random() * 13) * 60 * 60 * 1000;
      moyuSessionTimer = setTimeout(() => {
        generateRandomMoyuRecord();
      }, nextSessionDelay);
    }
  }

  window.generateRandomMoyuRecord = function () {
    const locations = window.moyuLocations || [];
    const activities = window.moyuActivities || [];

    if (locations.length === 0 || activities.length === 0) return false;

    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    if (window.moyuWorkSession && now < window.moyuWorkSession.endTime) {
      const randomActivity = activities[Math.floor(Math.random() * activities.length)];
      window.moyuWorkSession.activities.push({
        content: randomActivity,
        time: now
      });

      window.currentMoyuRecord = {
        id: window.moyuWorkSession.id,
        location: window.moyuWorkSession.location,
        date: today,
        hours: window.moyuWorkSession.totalHours,
        note: window.moyuWorkSession.activities.map(a => `• ${a.content}`).join('\n'),
        isSession: true,
        createdAt: new Date(window.moyuWorkSession.startTime).toISOString()
      };

      persist(['currentMoyuRecord', 'moyuWorkSession']);

      if (typeof window.renderMoyuCurrent === 'function') window.renderMoyuCurrent();

      showMoyuNewMessageNotification(randomActivity);
      window.setMoyuUnread();

      scheduleNextMoyuMessage();
      return true;
    }

    if (window.currentMoyuRecord && window.moyuWorkSession && now >= window.moyuWorkSession.endTime) {
      finishMoyuWorkSession();
    }

    const randomLocation = locations[Math.floor(Math.random() * locations.length)];
    const randomActivity = activities[Math.floor(Math.random() * activities.length)];
    const workHours = Math.floor(Math.random() * 13);

    window.moyuWorkSession = {
      id: Date.now(),
      startTime: now,
      endTime: now + (workHours * 60 * 60 * 1000),
      location: randomLocation,
      totalHours: workHours,
      activities: [{
        content: randomActivity,
        time: now
      }]
    };

    window.currentMoyuRecord = {
      id: window.moyuWorkSession.id,
      location: randomLocation,
      date: today,
      hours: workHours,
      note: `• ${randomActivity}`,
      isSession: true,
      createdAt: new Date().toISOString()
    };

    persist(['currentMoyuRecord', 'moyuWorkSession']);

    if (typeof window.renderMoyuCurrent === 'function') window.renderMoyuCurrent();
    if (typeof window.renderMoyuRecords === 'function') window.renderMoyuRecords();

    scheduleNextMoyuMessage();
    scheduleWorkEndCheck();

    window.setMoyuUnread();
    showMoyuNotification();

    return true;
  };

  window.finishMoyuWorkSession = finishMoyuWorkSession;

  // ==================== 通知 ====================
  function removeById(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  window.closeMoyuNewMessageNotification = function () {
    removeById('moyu-new-message-notification');
    window.setMoyuUnread();
  };

  window.openMoyuFromNewMessageNotification = function () {
    removeById('moyu-new-message-notification');
    window.clearMoyuUnread();
    if (typeof window.openMoyuModal === 'function') window.openMoyuModal();
  };

  window.closeMoyuNotificationWithUnread = function () {
    removeById('moyu-notification');
    window.setMoyuUnread();
  };

  window.openMoyuFromNotification = function () {
    removeById('moyu-notification');
    window.clearMoyuUnread();
    if (typeof window.openMoyuModal === 'function') window.openMoyuModal();
  };

  function partnerName() {
    return (typeof settings !== 'undefined' && settings && settings.partnerName) || '梦角';
  }

  function showMoyuNewMessageNotification(activityContent) {
    removeById('moyu-new-message-notification');

    const showDetail = settings && settings.moyuShowDetail !== false;
    const detailHtml = showDetail ? `
      <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px; padding: 8px; background: var(--primary-bg); border-radius: 8px; line-height: 1.4;">
        ${escapeHtml(activityContent)}
      </div>
      <div style="font-size: 11px; color: var(--accent-color); margin-bottom: 14px;">
        <i class="fas fa-info-circle" style="margin-right: 4px;"></i>已并入当前工作记录
      </div>
    ` : `
      <div style="font-size: 11px; color: var(--accent-color); margin-bottom: 14px; margin-top: 8px;">
        <i class="fas fa-info-circle" style="margin-right: 4px;"></i>已并入当前工作记录
      </div>
    `;

    const notification = document.createElement('div');
    notification.id = 'moyu-new-message-notification';
    notification.innerHTML = `
      <div style="position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 10000; background: var(--secondary-bg); border: 1px solid var(--border-color); border-radius: 16px; padding: 16px 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); max-width: 360px; font-family: var(--font-family);">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(var(--accent-color-rgb), 0.15); display: flex; align-items: center; justify-content: center;">
            <i class="fas fa-fish" style="color: var(--accent-color); font-size: 16px;"></i>
          </div>
          <div style="flex: 1;">
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">滴！${partnerName()} 发来一条摸鱼信息</div>
          </div>
          <button onclick="window.closeMoyuNewMessageNotification()" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; font-size: 16px;">
            <i class="fas fa-times"></i>
          </button>
        </div>
        ${detailHtml}
        <div style="display: flex; gap: 10px;">
          <button onclick="window.openMoyuFromNewMessageNotification()" style="flex: 1; padding: 10px 16px; border: none; border-radius: 10px; background: var(--accent-color); color: white; font-size: 13px; font-weight: 600; cursor: pointer; font-family: var(--font-family);">
            <i class="fas fa-check" style="margin-right: 6px;"></i>查看
          </button>
          <button onclick="window.closeMoyuNewMessageNotification()" style="flex: 1; padding: 10px 16px; border: 1px solid var(--border-color); border-radius: 10px; background: transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer; font-family: var(--font-family);">
            关闭
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      removeById('moyu-new-message-notification');
    }, 5000);
  }

  function showMoyuWorkEndNotification() {
    const notification = document.createElement('div');
    notification.id = 'moyu-work-end-notification';
    notification.innerHTML = `
      <div style="position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 10000; background: var(--secondary-bg); border: 1px solid var(--border-color); border-radius: 16px; padding: 16px 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); max-width: 360px; font-family: var(--font-family);">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(var(--accent-color-rgb), 0.15); display: flex; align-items: center; justify-content: center;">
            <i class="fas fa-check-circle" style="color: var(--accent-color); font-size: 16px;"></i>
          </div>
          <div style="flex: 1;">
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${partnerName()} 的工作结束啦</div>
          </div>
          <button onclick="document.getElementById('moyu-work-end-notification').remove()" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; font-size: 16px;">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      removeById('moyu-work-end-notification');
    }, 3000);
  }

  function showMoyuNotification() {
    removeById('moyu-notification');

    const showDetail = settings && settings.moyuShowDetail !== false;
    const session = window.moyuWorkSession;
    const detailHtml = (showDetail && session) ? `
      <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 10px; padding: 8px; background: var(--primary-bg); border-radius: 8px; line-height: 1.4;">
        <div style="font-size: 11px; color: var(--accent-color); margin-bottom: 4px;">
          <i class="fas fa-map-marker-alt" style="margin-right: 4px;"></i>${window.escapeHtml(session.location)}
        </div>
        <div style="font-size: 11px; color: var(--text-secondary);">
          <i class="fas fa-clock" style="margin-right: 4px;"></i>预计工作 ${session.totalHours} 小时
        </div>
      </div>
      <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 14px;">是否现在查看？</div>
    ` : `
      <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; margin-top: 8px;">是否现在查看？</div>
    `;

    const notification = document.createElement('div');
    notification.id = 'moyu-notification';
    notification.innerHTML = `
      <div style="position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 10000; background: var(--secondary-bg); border: 1px solid var(--border-color); border-radius: 16px; padding: 16px 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); max-width: 360px; font-family: var(--font-family);">
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(var(--accent-color-rgb), 0.15); display: flex; align-items: center; justify-content: center;">
            <i class="fas fa-fish" style="color: var(--accent-color); font-size: 16px;"></i>
          </div>
          <div style="flex: 1;">
            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary);">${partnerName()} 开始工作了，是否前去陪伴？</div>
          </div>
          <button onclick="window.closeMoyuNotificationWithUnread()" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px; font-size: 16px;">
            <i class="fas fa-times"></i>
          </button>
        </div>
        ${detailHtml}
        <div style="display: flex; gap: 10px;">
          <button onclick="window.openMoyuFromNotification()" style="flex: 1; padding: 10px 16px; border: none; border-radius: 10px; background: var(--accent-color); color: white; font-size: 13px; font-weight: 600; cursor: pointer; font-family: var(--font-family);">
            <i class="fas fa-check" style="margin-right: 6px;"></i>现在去
          </button>
          <button onclick="window.closeMoyuNotificationWithUnread()" style="flex: 1; padding: 10px 16px; border: 1px solid var(--border-color); border-radius: 10px; background: transparent; color: var(--text-secondary); font-size: 13px; cursor: pointer; font-family: var(--font-family);">
            等会来
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      if (document.getElementById('moyu-notification')) {
        notification.remove();
        window.setMoyuUnread();
      }
    }, 5000);
  }

  // ==================== 初始化 ====================
  function init() {
    const closeBtn = document.getElementById('close-moyu-modal');
    if (closeBtn) closeBtn.addEventListener('click', window.closeMoyuModal);

    const toggle = document.getElementById('moyu-auto-generate-toggle');
    if (toggle) toggle.addEventListener('click', window.toggleMoyuAutoGenerate);

    const addBtn = document.getElementById('moyu-add-location-btn');
    if (addBtn) addBtn.addEventListener('click', window.addMoyuLocation);

    window.initMoyuTimeFilter();
    loadMoyuData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ==================== 暴露 ====================
  window.MoyuApp = {
    open: function () { window.openMoyuModal(); return true; },
    openMoyuModal: window.openMoyuModal,
    closeMoyuModal: window.closeMoyuModal,
    renderMoyuCurrent: window.renderMoyuCurrent,
    renderMoyuRecords: window.renderMoyuRecords,
    renderMoyuLocations: window.renderMoyuLocations,
    renderMoyuStats: window.renderMoyuStats,
    generateRandomMoyuRecord: window.generateRandomMoyuRecord,
    finishMoyuWorkSession: window.finishMoyuWorkSession
  };
})();