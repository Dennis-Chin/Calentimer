/**
 * Calentimer Telemetry & Real-Time Presence Worker
 * Platform: Cloudflare Workers + Cloudflare D1
 * 
 * Strictly zero optional chaining and zero nullish coalescing operators.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // 1. Ingest telemetry beacon / heartbeat
      if (path === '/api/telemetry' && method === 'POST') {
        return await handleTelemetryIngest(request, env);
      }

      // 2. Fetch aggregated stats for dashboard (JSON API)
      if (path === '/api/stats' && method === 'GET') {
        return await handleStatsQuery(request, env, url);
      }

      // 3. Serve responsive admin dashboard
      if (path === '/' || path === '/admin' || path === '/dashboard') {
        return serveDashboardHtml(request, env);
      }

      return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
    } catch (err) {
      const errMsg = (err && err.message) ? err.message : 'Internal Server Error';
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500,
        headers: Object.assign({}, CORS_HEADERS, { 'Content-Type': 'application/json' })
      });
    }
  }
};

/**
 * Ingests client heartbeat and session events into Cloudflare D1
 */
async function handleTelemetryIngest(request, env) {
  let body = null;
  try {
    const raw = await request.text();
    body = JSON.parse(raw);
  } catch (_) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: Object.assign({}, CORS_HEADERS, { 'Content-Type': 'application/json' })
    });
  }

  if (!body || !body.clientId) {
    return new Response(JSON.stringify({ error: 'Missing clientId' }), {
      status: 400,
      headers: Object.assign({}, CORS_HEADERS, { 'Content-Type': 'application/json' })
    });
  }

  const clientId = String(body.clientId).substring(0, 64);
  const deviceType = body.deviceType ? String(body.deviceType).substring(0, 32) : 'desktop';
  const isPwa = body.isPwa ? 1 : 0;
  const isTimerRunning = body.isTimerRunning ? 1 : 0;
  const activeCategory = body.activeCategory ? String(body.activeCategory).substring(0, 32) : null;

  const db = env && env.DB;
  if (!db) {
    // Graceful fallback if database binding is pending configuration
    return new Response(JSON.stringify({ success: true, warning: 'DB binding pending' }), {
      status: 200,
      headers: Object.assign({}, CORS_HEADERS, { 'Content-Type': 'application/json' })
    });
  }

  // 1. Upsert active heartbeat
  const upsertSql = `
    INSERT INTO active_heartbeats (client_id, last_seen_at, device_type, is_pwa, active_category, is_timer_running)
    VALUES (?1, CURRENT_TIMESTAMP, ?2, ?3, ?4, ?5)
    ON CONFLICT(client_id) DO UPDATE SET
      last_seen_at = CURRENT_TIMESTAMP,
      device_type = excluded.device_type,
      is_pwa = excluded.is_pwa,
      active_category = excluded.active_category,
      is_timer_running = excluded.is_timer_running;
  `;
  await db.prepare(upsertSql).bind(clientId, deviceType, isPwa, activeCategory, isTimerRunning).run();

  // 2. If event payload is attached, insert into event stream
  if (body.eventType) {
    const eventType = String(body.eventType).substring(0, 64);
    const payloadStr = JSON.stringify(body.payload || {});
    const insertEventSql = `
      INSERT INTO app_events (client_id, event_type, payload)
      VALUES (?1, ?2, ?3);
    `;
    await db.prepare(insertEventSql).bind(clientId, eventType, payloadStr).run();
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: Object.assign({}, CORS_HEADERS, { 'Content-Type': 'application/json' })
  });
}

/**
 * Returns aggregated stats for Admin Dashboard
 */
async function handleStatsQuery(request, env, url) {
  // Authentication check: header or query key
  const authHeader = request.headers.get('Authorization') || '';
  const queryKey = url.searchParams.get('key') || '';
  const expectedSecret = (env && env.ADMIN_SECRET) ? env.ADMIN_SECRET : 'calentimer_admin_2026';

  const isAuthorized = (authHeader === `Bearer ${expectedSecret}`) || (queryKey === expectedSecret);
  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Invalid Admin Key' }), {
      status: 401,
      headers: Object.assign({}, CORS_HEADERS, { 'Content-Type': 'application/json' })
    });
  }

  const db = env && env.DB;
  if (!db) {
    return new Response(JSON.stringify({
      activeNow: 0,
      totalSessions: 0,
      totalFocusMinutes: 0,
      avgSessionMinutes: 0,
      dau: 0,
      deviceBreakdown: {},
      featureAdoption: { hardStopUsagePct: 0, timeBankUsagePct: 0, googleSyncPct: 0, msSyncPct: 0 },
      recentEvents: []
    }), {
      status: 200,
      headers: Object.assign({}, CORS_HEADERS, { 'Content-Type': 'application/json' })
    });
  }

  // 1. Active Users Right Now (seen in last 5 minutes)
  const activeNowRes = await db.prepare(`
    SELECT COUNT(*) as count FROM active_heartbeats
    WHERE last_seen_at >= datetime('now', '-5 minutes');
  `).first();
  const activeNow = (activeNowRes && activeNowRes.count) ? activeNowRes.count : 0;

  // 2. Active Focus Timers Right Now
  const activeTimersRes = await db.prepare(`
    SELECT COUNT(*) as count FROM active_heartbeats
    WHERE last_seen_at >= datetime('now', '-5 minutes') AND is_timer_running = 1;
  `).first();
  const activeTimersRunning = (activeTimersRes && activeTimersRes.count) ? activeTimersRes.count : 0;

  // 3. Daily Active Users (DAU in last 24h)
  const dauRes = await db.prepare(`
    SELECT COUNT(DISTINCT client_id) as count FROM active_heartbeats
    WHERE last_seen_at >= datetime('now', '-24 hours');
  `).first();
  const dau = (dauRes && dauRes.count) ? dauRes.count : 0;

  // 4. Device & PWA breakdown in last 24 hours
  const devicesRes = await db.prepare(`
    SELECT device_type, COUNT(*) as count FROM active_heartbeats
    WHERE last_seen_at >= datetime('now', '-24 hours')
    GROUP BY device_type;
  `).all();
  const deviceBreakdown = {};
  if (devicesRes && devicesRes.results) {
    devicesRes.results.forEach(function(row) {
      deviceBreakdown[row.device_type || 'unknown'] = row.count;
    });
  }

  const pwaRes = await db.prepare(`
    SELECT is_pwa, COUNT(*) as count FROM active_heartbeats
    WHERE last_seen_at >= datetime('now', '-24 hours')
    GROUP BY is_pwa;
  `).all();
  let pwaCount = 0;
  let totalDeviceCount = 0;
  if (pwaRes && pwaRes.results) {
    pwaRes.results.forEach(function(row) {
      if (row.is_pwa === 1) pwaCount += row.count;
      totalDeviceCount += row.count;
    });
  }
  const pwaAdoptionPct = totalDeviceCount > 0 ? Math.round((pwaCount / totalDeviceCount) * 100) : 0;

  // 5. Completed Session Aggregates (from app_events)
  const sessionEventsRes = await db.prepare(`
    SELECT payload, created_at FROM app_events
    WHERE event_type = 'session_completed'
    ORDER BY id DESC LIMIT 500;
  `).all();

  let totalSessions = 0;
  let totalFocusSec = 0;
  let hardStopUsedCount = 0;
  let timeBankUsedCount = 0;
  let googleSyncCount = 0;
  let msSyncCount = 0;
  const categoryCounts = {};

  if (sessionEventsRes && sessionEventsRes.results) {
    const rows = sessionEventsRes.results;
    totalSessions = rows.length;

    for (let i = 0; i < rows.length; i++) {
      let p = {};
      try {
        p = JSON.parse(rows[i].payload);
      } catch (_) {}

      const duration = (typeof p.durationSec === 'number') ? p.durationSec : 0;
      totalFocusSec += duration;

      if (p.hasHardStop) hardStopUsedCount++;
      if (p.usedTimeBank) timeBankUsedCount++;
      if (p.googleConnected) googleSyncCount++;
      if (p.msConnected) msSyncCount++;

      const cat = p.category || 'General';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    }
  }

  const avgSessionMinutes = totalSessions > 0 ? Math.round((totalFocusSec / totalSessions) / 60) : 0;
  const totalFocusMinutes = Math.round(totalFocusSec / 60);
  const hardStopUsagePct = totalSessions > 0 ? Math.round((hardStopUsedCount / totalSessions) * 100) : 0;
  const timeBankUsagePct = totalSessions > 0 ? Math.round((timeBankUsedCount / totalSessions) * 100) : 0;
  const googleSyncPct = totalSessions > 0 ? Math.round((googleSyncCount / totalSessions) * 100) : 0;
  const msSyncPct = totalSessions > 0 ? Math.round((msSyncCount / totalSessions) * 100) : 0;

  // 6. Recent 20 Events Log
  const recentEventsRes = await db.prepare(`
    SELECT id, client_id, event_type, payload, created_at FROM app_events
    ORDER BY id DESC LIMIT 20;
  `).all();
  const recentEvents = (recentEventsRes && recentEventsRes.results) ? recentEventsRes.results : [];

  return new Response(JSON.stringify({
    activeNow: activeNow,
    activeTimersRunning: activeTimersRunning,
    dau: dau,
    totalSessionsAnalyzed: totalSessions,
    totalFocusMinutes: totalFocusMinutes,
    avgSessionMinutes: avgSessionMinutes,
    deviceBreakdown: deviceBreakdown,
    pwaAdoptionPct: pwaAdoptionPct,
    categoryCounts: categoryCounts,
    featureAdoption: {
      hardStopUsagePct: hardStopUsagePct,
      timeBankUsagePct: timeBankUsagePct,
      googleSyncPct: googleSyncPct,
      msSyncPct: msSyncPct
    },
    recentEvents: recentEvents
  }), {
    status: 200,
    headers: Object.assign({}, CORS_HEADERS, { 'Content-Type': 'application/json' })
  });
}

/**
 * Serves the responsive, mobile-first Admin Dashboard HTML
 */
function serveDashboardHtml(request, env) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Calentimer Telemetry & Real-Time Presence</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d0f14;
      --card-bg: #161922;
      --card-border: rgba(255, 255, 255, 0.08);
      --accent-neon: #00e676;
      --accent-blue: #00d2ff;
      --accent-purple: #a855f7;
      --accent-orange: #ff9100;
      --text-main: #f8fafc;
      --text-sub: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      padding: 16px;
      min-height: 100vh;
    }
    .container { max-width: 980px; margin: 0 auto; }
    
    /* Top Bar */
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--card-border);
      flex-wrap: wrap;
      gap: 12px;
    }
    .brand-wrap { display: flex; align-items: center; gap: 10px; }
    .brand-title { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; }
    .brand-pill {
      font-size: 11px;
      background: rgba(0, 230, 118, 0.15);
      color: var(--accent-neon);
      border: 1px solid rgba(0, 230, 118, 0.3);
      padding: 2px 8px;
      border-radius: 12px;
      font-family: 'JetBrains Mono', monospace;
    }
    .controls { display: flex; align-items: center; gap: 8px; }
    .btn {
      background: #202430;
      color: #fff;
      border: 1px solid var(--card-border);
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.15s ease;
    }
    .btn:hover { background: #2a3040; border-color: rgba(255,255,255,0.2); }
    .btn-primary { background: #0070f3; border-color: #0070f3; }
    .btn-primary:hover { background: #005bb5; }
    .key-input {
      background: #11141c;
      border: 1px solid var(--card-border);
      color: #fff;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-family: 'JetBrains Mono', monospace;
      width: 140px;
    }

    /* Live Hero Card */
    .hero-live-card {
      background: linear-gradient(135deg, rgba(0, 230, 118, 0.08) 0%, rgba(0, 210, 255, 0.08) 100%), var(--card-bg);
      border: 1px solid rgba(0, 230, 118, 0.3);
      border-radius: 16px;
      padding: 20px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 16px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
    }
    .live-indicator { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--accent-neon); font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .live-dot {
      width: 10px;
      height: 10px;
      background: var(--accent-neon);
      border-radius: 50%;
      box-shadow: 0 0 12px var(--accent-neon);
      animation: pulse 1.8s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.8; }
    }
    .live-count-wrap { display: flex; align-items: baseline; gap: 10px; }
    .live-count-num { font-size: 48px; font-weight: 800; font-family: 'JetBrains Mono', monospace; color: #fff; }
    .live-count-label { font-size: 14px; color: var(--text-sub); }
    .live-sub-stats { display: flex; gap: 16px; flex-wrap: wrap; }
    .live-sub-stat { font-size: 13px; color: var(--text-sub); background: rgba(255,255,255,0.04); padding: 6px 12px; border-radius: 8px; border: 1px solid var(--card-border); }
    .live-sub-stat strong { color: #fff; font-family: 'JetBrains Mono', monospace; }

    /* KPI Grid */
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .card-title { font-size: 12px; color: var(--text-sub); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
    .card-value { font-size: 28px; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: #fff; }
    .card-desc { font-size: 12px; color: var(--text-sub); }

    /* Feature Adoption & Decision Insights */
    .section-title { font-size: 15px; font-weight: 700; margin: 24px 0 12px 0; display: flex; align-items: center; gap: 8px; }
    .adoption-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 20px; }
    .meter-wrap { margin-top: 8px; }
    .meter-bar-bg { height: 8px; background: #202430; border-radius: 4px; overflow: hidden; margin-top: 4px; }
    .meter-bar-fill { height: 100%; border-radius: 4px; transition: width 0.4s ease; }

    /* Table / Logs */
    .log-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 30px;
      overflow-x: auto;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    th { padding: 10px; color: var(--text-sub); font-size: 11px; text-transform: uppercase; border-bottom: 1px solid var(--card-border); }
    td { padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.04); font-family: 'JetBrains Mono', monospace; }
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-study { background: rgba(0, 210, 255, 0.15); color: var(--accent-blue); }
    .badge-work { background: rgba(168, 85, 247, 0.15); color: var(--accent-purple); }
    .badge-general { background: rgba(255, 255, 255, 0.1); color: #fff; }

    /* Auto Refresh Pill */
    .refresh-status { font-size: 12px; color: var(--text-sub); display: flex; align-items: center; gap: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar">
      <div class="brand-wrap">
        <span class="brand-title">Calentimer Telemetry</span>
        <span class="brand-pill">Edge D1</span>
      </div>
      <div class="controls">
        <input type="password" id="adminKeyInput" class="key-input" placeholder="Admin Key" title="Enter Admin Key">
        <button class="btn btn-primary" id="btnRefresh">Refresh</button>
        <span class="refresh-status" id="refreshStatus">Live (5s)</span>
      </div>
    </div>

    <!-- Hero Live Card -->
    <div class="hero-live-card">
      <div>
        <div class="live-indicator">
          <span class="live-dot"></span>
          <span>Active Users Right Now</span>
        </div>
        <div class="live-count-wrap">
          <span class="live-count-num" id="liveUsersNum">0</span>
          <span class="live-count-label">active in last 5 minutes</span>
        </div>
      </div>
      <div class="live-sub-stats">
        <div class="live-sub-stat">⏱️ Timers Running: <strong id="liveTimersNum">0</strong></div>
        <div class="live-sub-stat">📅 24h Active Users: <strong id="dauNum">0</strong></div>
        <div class="live-sub-stat">📲 PWA Installed: <strong id="pwaPct">0%</strong></div>
      </div>
    </div>

    <!-- Core KPI Metrics -->
    <div class="grid">
      <div class="card">
        <span class="card-title">Average Session</span>
        <span class="card-value" id="avgSessionNum">0m</span>
        <span class="card-desc">Duration of completed focus blocks</span>
      </div>
      <div class="card">
        <span class="card-title">Total Focus Time</span>
        <span class="card-value" id="totalFocusNum">0h</span>
        <span class="card-desc">Across analyzed sessions</span>
      </div>
      <div class="card">
        <span class="card-title">Completed Sessions</span>
        <span class="card-value" id="totalSessionsNum">0</span>
        <span class="card-desc">Finished tasks & timers</span>
      </div>
      <div class="card">
        <span class="card-title">Top Device</span>
        <span class="card-value" id="topDeviceNum">Mobile</span>
        <span class="card-desc" id="topDeviceDesc">iOS vs Android vs Desktop</span>
      </div>
    </div>

    <!-- Feature Validation (Informs whether to keep or remove features) -->
    <div class="section-title">
      <span>Feature Adoption & Mechanics (Decision Data)</span>
    </div>
    <div class="adoption-grid">
      <div class="card">
        <span class="card-title">Hard Stop Usage</span>
        <span class="card-value" id="hardStopPct">0%</span>
        <span class="card-desc">Sessions with active deadline compression</span>
        <div class="meter-wrap">
          <div class="meter-bar-bg"><div class="meter-bar-fill" id="hardStopBar" style="width: 0%; background: #00e676;"></div></div>
        </div>
      </div>
      <div class="card">
        <span class="card-title">Time Bank Absorption</span>
        <span class="card-value" id="timeBankPct">0%</span>
        <span class="card-desc">Sessions utilizing banked minutes</span>
        <div class="meter-wrap">
          <div class="meter-bar-bg"><div class="meter-bar-fill" id="timeBankBar" style="width: 0%; background: #ff9100;"></div></div>
        </div>
      </div>
      <div class="card">
        <span class="card-title">Google Calendar Sync</span>
        <span class="card-value" id="googleSyncPct">0%</span>
        <span class="card-desc">Users syncing Google external meetings</span>
        <div class="meter-wrap">
          <div class="meter-bar-bg"><div class="meter-bar-fill" id="googleSyncBar" style="width: 0%; background: #00d2ff;"></div></div>
        </div>
      </div>
      <div class="card">
        <span class="card-title">Microsoft Outlook Sync</span>
        <span class="card-value" id="msSyncPct">0%</span>
        <span class="card-desc">Users syncing Microsoft 365 events</span>
        <div class="meter-wrap">
          <div class="meter-bar-bg"><div class="meter-bar-fill" id="msSyncBar" style="width: 0%; background: #a855f7;"></div></div>
        </div>
      </div>
    </div>

    <!-- Live Event Stream Table -->
    <div class="section-title">
      <span>Live Event Log (Recent Sessions)</span>
    </div>
    <div class="log-card">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Client</th>
            <th>Event</th>
            <th>Duration</th>
            <th>Category</th>
            <th>Hard Stop</th>
          </tr>
        </thead>
        <tbody id="eventsTableBody">
          <tr><td colspan="6" style="text-align:center; color:#64748b; padding:20px;">No events recorded yet.</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    (function() {
      var urlParams = (typeof window !== 'undefined' && window.location && window.location.search) ? new URLSearchParams(window.location.search) : null;
      var queryKey = urlParams ? (urlParams.get('key') || '') : '';
      var storedKey = localStorage.getItem('calentimer_admin_key') || '';
      var savedKey = queryKey || storedKey;
      var keyInput = document.getElementById('adminKeyInput');
      if (savedKey) {
        keyInput.value = savedKey;
        localStorage.setItem('calentimer_admin_key', savedKey);
      }

      function getKey() {
        var k = keyInput.value.trim();
        if (k) localStorage.setItem('calentimer_admin_key', k);
        return k;
      }

      async function fetchStats() {
        var key = getKey();
        if (!key) {
          document.getElementById('refreshStatus').textContent = 'Key required';
          return;
        }

        document.getElementById('refreshStatus').textContent = 'Updating...';
        try {
          var res = await fetch('/api/stats?key=' + encodeURIComponent(key));
          if (!res.ok) {
            document.getElementById('refreshStatus').textContent = 'Unauthorized key';
            return;
          }
          var data = await res.json();
          renderStats(data);
          document.getElementById('refreshStatus').textContent = 'Updated just now';
        } catch (e) {
          document.getElementById('refreshStatus').textContent = 'Network error';
        }
      }

      function renderStats(d) {
        document.getElementById('liveUsersNum').textContent = d.activeNow || 0;
        document.getElementById('liveTimersNum').textContent = d.activeTimersRunning || 0;
        document.getElementById('dauNum').textContent = d.dau || 0;
        document.getElementById('pwaPct').textContent = (d.pwaAdoptionPct || 0) + '%';
        document.getElementById('avgSessionNum').textContent = (d.avgSessionMinutes || 0) + 'm';
        document.getElementById('totalFocusNum').textContent = Math.round((d.totalFocusMinutes || 0) / 60) + 'h';
        document.getElementById('totalSessionsNum').textContent = d.totalSessionsAnalyzed || 0;

        // Top Device
        var devices = d.deviceBreakdown || {};
        var maxDev = 'Desktop';
        var maxCount = 0;
        Object.keys(devices).forEach(function(k) {
          if (devices[k] > maxCount) {
            maxCount = devices[k];
            maxDev = k;
          }
        });
        document.getElementById('topDeviceNum').textContent = maxDev;

        // Feature Adoption Meters
        var feat = d.featureAdoption || {};
        var hs = feat.hardStopUsagePct || 0;
        var tb = feat.timeBankUsagePct || 0;
        var gs = feat.googleSyncPct || 0;
        var ms = feat.msSyncPct || 0;

        document.getElementById('hardStopPct').textContent = hs + '%';
        document.getElementById('hardStopBar').style.width = hs + '%';

        document.getElementById('timeBankPct').textContent = tb + '%';
        document.getElementById('timeBankBar').style.width = tb + '%';

        document.getElementById('googleSyncPct').textContent = gs + '%';
        document.getElementById('googleSyncBar').style.width = gs + '%';

        document.getElementById('msSyncPct').textContent = ms + '%';
        document.getElementById('msSyncBar').style.width = ms + '%';

        // Table
        var tbody = document.getElementById('eventsTableBody');
        var events = d.recentEvents || [];
        if (events.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#64748b; padding:20px;">No events recorded yet.</td></tr>';
          return;
        }

        var rowsHtml = '';
        events.forEach(function(ev) {
          var p = {};
          try { p = JSON.parse(ev.payload); } catch (_) {}
          var timeStr = ev.created_at ? ev.created_at.replace('T', ' ').substring(11, 16) : '--:--';
          var clientShort = (ev.client_id || '').substring(0, 8);
          var dur = p.durationSec ? Math.round(p.durationSec / 60) + 'm' : '--';
          var cat = p.category || 'General';
          var catBadgeClass = (cat.toLowerCase().indexOf('study') !== -1) ? 'badge-study' : ((cat.toLowerCase().indexOf('work') !== -1) ? 'badge-work' : 'badge-general');
          var hsStr = p.hasHardStop ? '✅ Yes' : '❌ Open';

          rowsHtml += '<tr>' +
            '<td>' + timeStr + '</td>' +
            '<td><span style="color:#64748b;">' + clientShort + '</span></td>' +
            '<td>' + (ev.event_type || '') + '</td>' +
            '<td>' + dur + '</td>' +
            '<td><span class="badge ' + catBadgeClass + '">' + cat + '</span></td>' +
            '<td>' + hsStr + '</td>' +
          '</tr>';
        });
        tbody.innerHTML = rowsHtml;
      }

      document.getElementById('btnRefresh').addEventListener('click', fetchStats);
      keyInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') fetchStats(); });

      // Initial fetch if key exists
      if (savedKey) fetchStats();

      // 5s fast live polling
      setInterval(fetchStats, 5000);
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
