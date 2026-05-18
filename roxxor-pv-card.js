/**
 * RoxXor-PV-Card v5.0
 * Energy flow visualization for Home Assistant
 * (formerly k-flow-card)
 *
 * v5.0 Changes:
 *  - Neuer pv_total_power Sensor (default sensor.evcc_pv_power) fuer Sonnen-Anzeige + Heartbeat
 *  - Heartbeat-Fix: nutzt jetzt einen schnell aktualisierenden Sensor statt inv_temp
 *  - Klickbarkeit auf alle Hauptelemente (more-info Popups)
 *  - Warn-Badge im Header bei kritischen Zustaenden (SOC, Temp, etc.)
 *  - EV-SOC Anzeige in der Wallbox-Box (wenn Sensor verfuegbar)
 *  - 24h PV-Sparkline ueber HA recorder/history API
 *  - Wochenvergleich PV-Ertrag (heute vs Durchschnitt der letzten 7 Tage)
 *  - Hausverbrauch-Trend-Pfeil kleiner und mit Abstand
 *  - Wallbox "today" wird ausgeblendet wenn Sensor fehlt
 */
class RoxXorPVCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this.config = {};
    this._rendered = false;
    this._trendHistory = { soc: [], house: [] };
    this._historyData = null;
    this._historyFetchAt = 0;
    this._weekData = null;
    this._weekFetchAt = 0;
  }

  setConfig(config) {
    this.config = {
      // Pflicht-Sensoren
      pv1_power: 'sensor.wr_garage_mppt_total_input_power',
      pv2_power: 'sensor.inverter_garten_mppt_total_input_power',
      pv3_power: 'sensor.inverter_keller_mppt_total_input_power',
      pv_total_power: 'sensor.evcc_pv_power',  // schnell-updatender Gesamt-Sensor
      grid_active_power: 'sensor.evcc_grid_power',
      consump: 'sensor.evcc_home_power',
      battery_soc: 'sensor.evcc_battery_soc',
      battery_power: 'sensor.evcc_battery_power',
      battery_voltage: 'sensor.battery_battery_voltage',
      inv_temp: 'sensor.wr_garage_inverter_internal_temperature',
      ev_power: 'sensor.evcc_wallbox_power',
      heatpump_power: 'sensor.evcc_warmepumpe_charge_power',
      today_pv: 'sensor.huawei_pv_total_current_day_energy',
      sun: 'sun.sun',

      // Forecast (Liste von Sensoren wird aufsummiert)
      forecast_today: [
        'sensor.energy_production_today_2',
        'sensor.energy_production_today_3',
        'sensor.energy_production_today_4',
      ],
      forecast_tomorrow: [
        'sensor.energy_production_tomorrow_2',
        'sensor.energy_production_tomorrow_3',
        'sensor.energy_production_tomorrow_4',
      ],

      // Optional - Tagesbilanz fuer Wirtschaftlichkeit
      pv_to_grid_today: 'sensor.evcc_grid_export_energy',
      grid_import_today: 'sensor.evcc_grid_import_energy',

      // Optional - Wallbox
      wallbox_mode: 'sensor.evcc_wallbox_mode',
      wallbox_energy_today: 'sensor.evcc_wallbox_charge_total',
      // EV-SOC: kann Sensor sein oder Attribut von wallbox-Sensor
      ev_soc: null,  // z.B. 'sensor.evcc_loadpoint_vehicle_soc'

      // Konfig
      batt_capacity_wh: 15000,
      grid_positive_means: 'import',
      battery_positive_means: 'discharge',
      power_in_kw: false,
      electricity_price: 0.32,
      feed_in_tariff: 0.082,
      currency: '€',

      // Warn-Schwellenwerte
      warn_soc_low: 15,         // SOC unter dieser % -> Warnung
      warn_inv_temp_high: 60,   // Inverter-Temp ueber dieser °C -> Warnung
      warn_battery_temp: null,  // optional separater Temp-Sensor

      // Features ein/aus
      show_sparkline: true,
      show_week_compare: true,
      show_warnings: true,

      ...config
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._rendered) this._update();
  }

  _val(eid, type = 'raw') {
    if (!eid || eid === 'none' || eid === 'null') return null;
    const s = this._hass?.states[eid];
    if (!s || s.state === 'unavailable' || s.state === 'unknown') return null;
    let v = parseFloat(s.state);
    if (isNaN(v)) return null;
    if (type === 'power') {
      const unit = (s.attributes?.unit_of_measurement || '').toLowerCase();
      if (unit === 'kw') return v * 1000;
      if (this.config.power_in_kw && !unit) return v * 1000;
      return v;
    }
    if (type === 'energy') {
      const unit = (s.attributes?.unit_of_measurement || '').toLowerCase();
      if (unit === 'wh') return v / 1000;
      return v;
    }
    return v;
  }

  _v(eid, type = 'raw') {
    const r = this._val(eid, type);
    return r === null ? 0 : r;
  }

  _sumVal(eidOrList, type = 'raw') {
    if (eidOrList == null) return null;
    if (Array.isArray(eidOrList)) {
      let total = 0;
      let any = false;
      for (const eid of eidOrList) {
        const v = this._val(eid, type);
        if (v !== null) { total += v; any = true; }
      }
      return any ? total : null;
    }
    return this._val(eidOrList, type);
  }

  _strState(eid) {
    if (!eid || eid === 'none' || eid === 'null') return null;
    const s = this._hass?.states[eid];
    if (!s || s.state === 'unavailable' || s.state === 'unknown') return null;
    return s.state;
  }

  _fmtPower(w) {
    const abs = Math.abs(w);
    if (abs >= 1000) return (w / 1000).toFixed(2) + ' kW';
    return w.toFixed(0) + ' W';
  }

  _fmtMoney(v) {
    return v.toFixed(2) + ' ' + this.config.currency;
  }

  _fmtTime(isoOrSunAttr) {
    if (!isoOrSunAttr) return '--:--';
    try {
      const d = new Date(isoOrSunAttr);
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    } catch (e) { return '--:--'; }
  }

  _trend(key, value) {
    const hist = this._trendHistory[key];
    const now = Date.now();
    hist.push({ t: now, v: value });
    while (hist.length > 0 && now - hist[0].t > 300000) hist.shift();
    if (hist.length < 2) return 0;
    const old = hist[0].v;
    const diff = value - old;
    if (key === 'soc' && Math.abs(diff) < 0.5) return 0;
    if (key === 'house' && Math.abs(diff) < 50) return 0;
    return diff > 0 ? 1 : -1;
  }

  _trendArrow(dir, color) {
    if (dir > 0) return `<tspan fill="${color}">▲</tspan>`;
    if (dir < 0) return `<tspan fill="${color}">▼</tspan>`;
    return `<tspan fill="#8b949e" opacity="0.5">●</tspan>`;
  }

  _openMoreInfo(entityId) {
    if (!entityId || entityId === 'none' || entityId === 'null') return;
    const ev = new Event('hass-more-info', { bubbles: true, composed: true });
    ev.detail = { entityId };
    this.dispatchEvent(ev);
  }

  // Holt History-Daten ueber WebSocket
  async _fetchHistory(entityId, hoursBack) {
    if (!this._hass?.callWS) return null;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - hoursBack * 3600 * 1000);
      const result = await this._hass.callWS({
        type: 'history/history_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [entityId],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      return result?.[entityId] || null;
    } catch (e) {
      console.warn('k-flow-card: history fetch failed', e);
      return null;
    }
  }

  async _fetchStatistics(entityId, daysBack) {
    if (!this._hass?.callWS) return null;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - daysBack * 24 * 3600 * 1000);
      const result = await this._hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: [entityId],
        period: 'day',
        units: { energy: 'kWh' },
        types: ['change'],
      });
      return result?.[entityId] || null;
    } catch (e) {
      console.warn('k-flow-card: statistics fetch failed', e);
      return null;
    }
  }

  async _maybeUpdateSparkline() {
    if (!this.config.show_sparkline) return;
    const now = Date.now();
    if (now - this._historyFetchAt < 10 * 60 * 1000 && this._historyData) return;
    this._historyFetchAt = now;
    const sensor = this.config.pv_total_power;
    if (!sensor) return;
    const data = await this._fetchHistory(sensor, 24);
    if (data && data.length > 0) {
      this._historyData = data.map(p => ({
        t: new Date(p.lu || p.last_updated).getTime(),
        v: parseFloat(p.s || p.state) || 0,
      })).filter(p => !isNaN(p.v));
      this._renderSparkline();
    }
  }

  async _maybeUpdateWeekCompare() {
    if (!this.config.show_week_compare) return;
    const now = Date.now();
    if (now - this._weekFetchAt < 60 * 60 * 1000 && this._weekData) return;
    this._weekFetchAt = now;
    const sensor = this.config.today_pv;
    if (!sensor) return;
    const data = await this._fetchStatistics(sensor, 8);
    if (data && data.length > 0) {
      // data ist Array von {start, end, change}
      // Letzter Eintrag = heute, davor = vergangene Tage
      const recent7 = data.slice(0, -1).slice(-7).map(d => d.change || 0);
      if (recent7.length > 0) {
        const avg = recent7.reduce((a, b) => a + b, 0) / recent7.length;
        this._weekData = { avg };
        this._renderWeekCompare();
      }
    }
  }

  _renderSparkline() {
    if (!this._historyData || this._historyData.length < 2) return;
    const svg = this.shadowRoot.getElementById('sparkline');
    if (!svg) return;
    const path = this.shadowRoot.getElementById('sparkPath');
    const fillPath = this.shadowRoot.getElementById('sparkFill');
    if (!path || !fillPath) return;

    const w = 100, h = 24;
    const data = this._historyData;
    const tMin = data[0].t;
    const tMax = data[data.length - 1].t;
    const tRange = Math.max(1, tMax - tMin);
    const vMax = Math.max(1, ...data.map(p => p.v));

    let d = '';
    let fd = '';
    data.forEach((p, i) => {
      const x = ((p.t - tMin) / tRange) * w;
      const y = h - (p.v / vMax) * h;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
      fd += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    });
    fd += `L ${w},${h} L 0,${h} Z`;
    path.setAttribute('d', d.trim());
    fillPath.setAttribute('d', fd);
  }

  _renderWeekCompare() {
    if (!this._weekData) return;
    const el = this.shadowRoot.getElementById('weekCompare');
    if (!el) return;
    const today = this._v(this.config.today_pv, 'energy');
    const avg = this._weekData.avg;
    if (avg < 0.1) { el.textContent = ''; return; }
    const diff = today - avg;
    const pct = (diff / avg) * 100;
    const sign = diff >= 0 ? '+' : '';
    const color = diff >= 0 ? '#3ce878' : '#f0883e';
    el.innerHTML = `<span style="color:#8b949e">Ø 7 Tage: ${avg.toFixed(1)} kWh</span> <span style="color:${color}">${sign}${pct.toFixed(0)}%</span>`;
  }

  _render() {
    this.shadowRoot.innerHTML = `
    <style>
      :host {
        display: block;
        background: radial-gradient(ellipse at top, #1a1f2e 0%, #0d1117 60%, #0a0d12 100%);
        border-radius: 18px;
        border: 1px solid #21262d;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04);
      }
      .container { padding: 14px; font-family: 'Segoe UI', -apple-system, Roboto, sans-serif; color: #c9d1d9; }
      .header { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px 8px; font-size: 11px; font-weight: 600; letter-spacing: 1.3px; gap: 8px; flex-wrap: wrap; }
      .header .title { color: #f4d03f; display: flex; align-items: center; gap: 6px; }
      .header .title-dot { width: 8px; height: 8px; background: #f4d03f; border-radius: 50%; box-shadow: 0 0 10px #f4d03f; animation: pulse 2s ease-in-out infinite; }
      @keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.6; transform: scale(0.85); } }
      .header .badges { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .badge { padding: 4px 10px; border-radius: 14px; font-size: 10px; backdrop-filter: blur(10px); display: inline-flex; align-items: center; gap: 4px; }
      .badge.autarky { background: rgba(60, 232, 120, 0.1); color: #3ce878; border: 1px solid rgba(60, 232, 120, 0.3); }
      .badge.self { background: rgba(244, 208, 63, 0.08); color: #f4d03f; border: 1px solid rgba(244, 208, 63, 0.25); }
      .badge.warn { background: rgba(240, 136, 62, 0.15); color: #f0883e; border: 1px solid rgba(240, 136, 62, 0.5); animation: warnPulse 2.5s ease-in-out infinite; }
      .badge.warn.critical { background: rgba(231, 76, 60, 0.18); color: #e74c3c; border-color: rgba(231, 76, 60, 0.6); }
      @keyframes warnPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(240,136,62,0.4); } 50% { box-shadow: 0 0 0 6px rgba(240,136,62,0); } }
      .badge.warn .warn-icon { font-size: 10px; }

      .forecast-bar { display: flex; align-items: center; gap: 10px; padding: 6px 10px; margin: 0 4px 8px; background: rgba(244,208,63,0.04); border: 1px solid rgba(244,208,63,0.15); border-radius: 10px; font-size: 10px; cursor: pointer; transition: background 0.2s; }
      .forecast-bar:hover { background: rgba(244,208,63,0.08); }
      .forecast-bar .fc-label { color: #8b949e; letter-spacing: 0.5px; min-width: 60px; }
      .forecast-bar .fc-track { flex: 1; height: 8px; background: rgba(255,255,255,0.04); border-radius: 4px; overflow: hidden; position: relative; }
      .forecast-bar .fc-fill { height: 100%; background: linear-gradient(90deg, #e8a317, #f4d03f, #fff9c4); border-radius: 4px; transition: width 0.6s ease; box-shadow: 0 0 8px rgba(244,208,63,0.4); }
      .forecast-bar .fc-vals { color: #f4d03f; font-weight: 700; min-width: 110px; text-align: right; }
      .forecast-bar .fc-tomorrow { color: #8b949e; font-weight: 500; margin-left: 6px; }

      .sparkline-row { display: flex; align-items: center; gap: 10px; padding: 4px 10px 6px; margin: 0 4px 8px; font-size: 9px; color: #8b949e; }
      .sparkline-row .spark-label { letter-spacing: 0.5px; }
      .sparkline-row svg { flex: 1; height: 28px; }
      .sparkline-row .week-cmp { font-weight: 700; }

      .economy-bar { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 8px 4px 0; margin-top: 4px; }
      .eco-item { background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; padding: 8px 6px; text-align: center; }
      .eco-label { font-size: 9px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.6px; }
      .eco-val { font-size: 14px; font-weight: 700; margin-top: 3px; }
      .eco-sub { font-size: 9px; color: #8b949e; margin-top: 1px; }
      .eco-val.save { color: #3ce878; }
      .eco-val.cost { color: #f0883e; }

      .footer { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 10px 4px 4px; margin-top: 6px; border-top: 1px solid #21262d; }
      .f-item { text-align: center; background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%); padding: 10px 4px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.04); cursor: pointer; transition: background 0.2s; }
      .f-item:hover { background: rgba(255,255,255,0.05); }
      .f-label { font-size: 9px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px; }
      .f-val { font-size: 15px; font-weight: 700; color: #f0883e; }

      .status-line { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px 2px; font-size: 9px; color: #8b949e; letter-spacing: 0.5px; }
      .status-line .status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #3ce878; margin-right: 5px; box-shadow: 0 0 6px #3ce878; }
      .status-line .status-dot.stale { background: #f0883e; box-shadow: 0 0 6px #f0883e; }

      svg { width: 100%; height: auto; display: block; }
      .flow-line { fill: none; stroke: #30363d; stroke-width: 2.5; stroke-linecap: round; }
      .flow-dot { filter: drop-shadow(0 0 6px currentColor); }
      .clickable { cursor: pointer; transition: filter 0.2s; }
      .clickable:hover { filter: brightness(1.2); }
    </style>
    <div class="container">
      <div class="header">
        <span class="title"><span class="title-dot"></span>RoxXor-PV-Card</span>
        <span class="badges">
          <span id="warnBadge" class="badge warn" style="display:none"><span class="warn-icon">⚠</span><span id="warnText">--</span></span>
          <span id="selfBadge" class="badge self">EIGENVERBRAUCH: --%</span>
          <span id="autarky" class="badge autarky">AUTARKIE: --%</span>
        </span>
      </div>

      <!-- Forecast.Solar -->
      <div id="fcBar" class="forecast-bar">
        <span class="fc-label">PROGNOSE</span>
        <div class="fc-track"><div id="fcFill" class="fc-fill" style="width: 0%"></div></div>
        <span class="fc-vals">
          <span id="fcToday">-- / -- kWh</span>
          <span class="fc-tomorrow" id="fcTomorrow">→ -- kWh</span>
        </span>
      </div>

      <!-- 24h Sparkline + Week-Compare -->
      <div id="sparklineRow" class="sparkline-row">
        <span class="spark-label">24 STD PV</span>
        <svg id="sparkline" viewBox="0 0 100 24" preserveAspectRatio="none">
          <defs>
            <linearGradient id="gradSpark" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#f4d03f" stop-opacity="0.4"/>
              <stop offset="100%" stop-color="#f4d03f" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path id="sparkFill" d="" fill="url(#gradSpark)"/>
          <path id="sparkPath" d="" fill="none" stroke="#f4d03f" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
        <span class="week-cmp" id="weekCompare"></span>
      </div>

      <svg viewBox="0 0 500 525" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <linearGradient id="gradSun" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fff9c4"/>
            <stop offset="50%" stop-color="#f4d03f"/>
            <stop offset="100%" stop-color="#e8a317"/>
          </linearGradient>
          <radialGradient id="gradSunGlow">
            <stop offset="0%" stop-color="#f4d03f" stop-opacity="0.7"/>
            <stop offset="50%" stop-color="#f4d03f" stop-opacity="0.2"/>
            <stop offset="100%" stop-color="#f4d03f" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="gradBatt" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#2db865"/>
            <stop offset="100%" stop-color="#7afca8"/>
          </linearGradient>
          <linearGradient id="gradBattLow" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#c0392b"/>
            <stop offset="100%" stop-color="#e74c3c"/>
          </linearGradient>
          <linearGradient id="gradBattMid" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#d35400"/>
            <stop offset="100%" stop-color="#f0883e"/>
          </linearGradient>
          <linearGradient id="gradInverter" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#1c2128"/>
            <stop offset="100%" stop-color="#161b22"/>
          </linearGradient>
          <linearGradient id="gradHouse" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="rgba(244,208,63,0.15)"/>
            <stop offset="100%" stop-color="rgba(244,208,63,0.02)"/>
          </linearGradient>
          <linearGradient id="gradSunFlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#f4d03f" stop-opacity="0.6"/>
            <stop offset="100%" stop-color="#f0883e" stop-opacity="0.4"/>
          </linearGradient>
        </defs>

        <path d="M 30,120 Q 250,-10 470,120" fill="none" stroke="#21262d" stroke-width="1" stroke-dasharray="2 4"/>

        <g id="sunriseMarker">
          <circle cx="30" cy="120" r="3" fill="#f4d03f" opacity="0.4"/>
          <text id="sunriseTime" x="30" y="138" text-anchor="middle" font-size="8" fill="#8b949e" letter-spacing="0.5">--:--</text>
        </g>
        <g id="sunsetMarker">
          <circle cx="470" cy="120" r="3" fill="#f0883e" opacity="0.4"/>
          <text id="sunsetTime" x="470" y="138" text-anchor="middle" font-size="8" fill="#8b949e" letter-spacing="0.5">--:--</text>
        </g>

        <path id="sunFlowPath" d="M 250,30 Q 280,100 250,170" fill="none" stroke="url(#gradSunFlow)" stroke-width="2" stroke-dasharray="3 4" opacity="0.5"/>

        <g id="sunClickable" class="clickable" data-entity="pv_total_power">
          <circle id="sunGlow" cx="250" cy="30" r="28" fill="url(#gradSunGlow)"/>
          <g id="sunGroup">
            <g id="sunRays" stroke="#f4d03f" stroke-width="1.5" stroke-linecap="round" opacity="0.7">
              <line x1="250" y1="14" x2="250" y2="9"/>
              <line x1="250" y1="46" x2="250" y2="51"/>
              <line x1="234" y1="30" x2="229" y2="30"/>
              <line x1="266" y1="30" x2="271" y2="30"/>
              <line x1="239" y1="19" x2="235" y2="15"/>
              <line x1="261" y1="41" x2="265" y2="45"/>
              <line x1="261" y1="19" x2="265" y2="15"/>
              <line x1="239" y1="41" x2="235" y2="45"/>
            </g>
            <circle id="sun" cx="250" cy="30" r="11" fill="url(#gradSun)" stroke="#fff9c4" stroke-width="0.5" filter="url(#softGlow)"/>
          </g>
          <g id="sunLabel">
            <rect id="sunBox" x="216" y="50" width="68" height="20" rx="10" fill="rgba(13,17,23,0.9)" stroke="#f4d03f" stroke-width="1"/>
            <text id="sunVal" x="250" y="64" text-anchor="middle" font-size="11" font-weight="700" fill="#f4d03f">0 W</text>
          </g>
        </g>

        <circle id="dotSun" class="flow-dot" r="3.5" fill="#f4d03f" opacity="0" style="color:#f4d03f">
          <animateMotion id="animSun" dur="2.5s" repeatCount="indefinite">
            <mpath href="#sunFlowPath"/>
          </animateMotion>
        </circle>

        <path class="flow-line" d="M 130,225 H 200"/>
        <path class="flow-line" d="M 300,225 H 370"/>
        <path class="flow-line" d="M 250,275 V 335"/>

        <circle id="dotBatt" class="flow-dot" r="4" fill="#3ce878" opacity="0" style="color:#3ce878">
          <animateMotion id="animBatt" dur="2s" repeatCount="indefinite" path="M 200,225 H 130"/>
        </circle>
        <circle id="dotGrid" class="flow-dot" r="4" fill="#f0883e" opacity="0" style="color:#f0883e">
          <animateMotion id="animGrid" dur="2s" repeatCount="indefinite" path="M 370,225 H 300"/>
        </circle>
        <circle id="dotHouse" class="flow-dot" r="4" fill="#f4d03f" opacity="0" style="color:#f4d03f">
          <animateMotion id="animHouse" dur="2s" repeatCount="indefinite" path="M 250,275 V 335"/>
        </circle>

        <!-- INVERTER -->
        <g class="clickable" data-entity="inv_temp">
          <rect x="200" y="180" width="100" height="95" rx="14" fill="url(#gradInverter)" stroke="#f0883e" stroke-width="2" filter="url(#glow)"/>
          <g transform="translate(218, 192)" fill="none" stroke="#f0883e" stroke-width="1.8" stroke-linecap="round">
            <path d="M 0,8 Q 8,0 16,8 T 32,8 T 48,8" stroke-linejoin="round"/>
            <path d="M 0,15 L 14,15 M 18,15 L 22,15 M 26,15 L 30,15 M 34,15 L 48,15" stroke-dasharray="0" opacity="0.7"/>
          </g>
          <text x="250" y="227" text-anchor="middle" font-size="9" fill="#8b949e" letter-spacing="1.5" font-weight="600">WECHSELRICHTER</text>
          <text id="invPwr" x="250" y="250" text-anchor="middle" font-size="20" font-weight="700" fill="#fff">0 W</text>
          <text id="invTemp" x="250" y="266" text-anchor="middle" font-size="10" fill="#f0883e">0.0 °C</text>
        </g>

        <!-- BATTERY -->
        <g class="clickable" data-entity="battery_soc">
          <g transform="translate(35, 175)">
            <text x="40" y="-12" text-anchor="middle" font-size="9" fill="#8b949e" letter-spacing="1.5" font-weight="600">BATTERIE</text>
            <rect x="0" y="0" width="80" height="105" rx="8" fill="#161b22" stroke="#30363d" stroke-width="1.5"/>
            <rect x="28" y="-5" width="24" height="6" rx="2" fill="#30363d"/>
            <line x1="0" y1="35" x2="80" y2="35" stroke="#21262d" stroke-width="0.8"/>
            <line x1="0" y1="70" x2="80" y2="70" stroke="#21262d" stroke-width="0.8"/>
            <rect id="battLevel" x="3" y="102" width="74" height="0" rx="4" fill="url(#gradBatt)" opacity="0.9"/>
            <text id="battSoc" x="40" y="58" text-anchor="middle" font-size="22" font-weight="700" fill="#fff" filter="url(#softGlow)">--%</text>
            <text id="battSocTrend" x="68" y="40" text-anchor="middle" font-size="9" font-weight="700">●</text>
          </g>
          <text id="battPwr" x="75" y="300" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">0 W</text>
          <text id="battEta" x="75" y="315" text-anchor="middle" font-size="9" fill="#8b949e"></text>
        </g>

        <!-- GRID -->
        <g class="clickable" data-entity="grid_active_power">
          <g transform="translate(380, 175)">
            <text x="40" y="-12" text-anchor="middle" font-size="9" fill="#8b949e" letter-spacing="1.5" font-weight="600">NETZ</text>
            <g stroke="#8b949e" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M 40,5 L 36,18 L 42,18 L 38,32" stroke="#f0883e" stroke-width="1.8" fill="none"/>
              <path d="M 22,90 L 40,35 L 58,90" stroke-width="2.2"/>
              <line x1="16" y1="55" x2="64" y2="55"/>
              <line x1="13" y1="72" x2="67" y2="72"/>
              <circle cx="22" cy="55" r="2" fill="#8b949e"/>
              <circle cx="40" cy="55" r="2" fill="#8b949e"/>
              <circle cx="58" cy="55" r="2" fill="#8b949e"/>
              <circle cx="16" cy="72" r="2" fill="#8b949e"/>
              <circle cx="40" cy="72" r="2" fill="#8b949e"/>
              <circle cx="64" cy="72" r="2" fill="#8b949e"/>
              <path d="M 28,90 L 52,55 M 52,90 L 28,55" stroke-width="1.2" opacity="0.6"/>
            </g>
          </g>
          <text id="gridPwr" x="420" y="300" text-anchor="middle" font-size="14" font-weight="700" fill="#f0883e">0 W</text>
          <text id="gridLabel" x="420" y="315" text-anchor="middle" font-size="9" fill="#8b949e" letter-spacing="1">IDLE</text>
        </g>

        <!-- HOUSE -->
        <g class="clickable" data-entity="consump">
          <g transform="translate(207, 335)">
            <g stroke-linejoin="round" stroke-linecap="round">
              <path d="M 3,32 L 43,5 L 83,32 L 83,68 L 3,68 Z" fill="url(#gradHouse)" stroke="#f4d03f" stroke-width="2"/>
              <path d="M 3,32 L 43,5 L 83,32" fill="none" stroke="#f4d03f" stroke-width="2.5"/>
              <path d="M 32,68 L 32,46 Q 32,42 36,42 L 50,42 Q 54,42 54,46 L 54,68" fill="none" stroke="#f4d03f" stroke-width="2"/>
              <circle cx="50" cy="56" r="1" fill="#f4d03f"/>
              <rect x="10" y="42" width="14" height="14" rx="1" fill="none" stroke="#f4d03f" stroke-width="1.5" opacity="0.7"/>
              <line x1="17" y1="42" x2="17" y2="56" stroke="#f4d03f" stroke-width="0.8" opacity="0.7"/>
              <line x1="10" y1="49" x2="24" y2="49" stroke="#f4d03f" stroke-width="0.8" opacity="0.7"/>
              <rect x="62" y="42" width="14" height="14" rx="1" fill="none" stroke="#f4d03f" stroke-width="1.5" opacity="0.7"/>
              <line x1="69" y1="42" x2="69" y2="56" stroke="#f4d03f" stroke-width="0.8" opacity="0.7"/>
              <line x1="62" y1="49" x2="76" y2="49" stroke="#f4d03f" stroke-width="0.8" opacity="0.7"/>
              <rect x="60" y="12" width="8" height="10" fill="#f4d03f" opacity="0.4"/>
            </g>
            <text id="housePwr" x="43" y="90" text-anchor="middle" font-size="17" font-weight="700" fill="#f4d03f">0 W</text>
            <text id="houseTrend" x="105" y="89" font-size="9" font-weight="700">●</text>
          </g>
        </g>

        <!-- PV STRINGS -->
        <g transform="translate(18, 340)" font-size="10">
          <text x="0" y="0" fill="#8b949e" letter-spacing="0.8" font-weight="600">PV STRINGS</text>
          <g transform="translate(78, -8)" stroke="#f4d03f" stroke-width="1" fill="none" opacity="0.6">
            <rect x="0" y="0" width="14" height="10" rx="1"/>
            <line x1="4.5" y1="0" x2="4.5" y2="10"/>
            <line x1="9.5" y1="0" x2="9.5" y2="10"/>
            <line x1="0" y1="5" x2="14" y2="5"/>
          </g>
          <g transform="translate(0, 16)" class="clickable" data-entity="pv1_power">
            <rect x="-4" y="-12" width="100" height="14" fill="transparent"/>
            <circle id="dPv1" cx="3" cy="-3" r="2.5" fill="#f4d03f" opacity="0.3"/>
            <text x="11" y="0" fill="#8b949e">Dach</text>
            <text id="vPv1" x="58" y="0" fill="#f4d03f" font-weight="700">0 W</text>
          </g>
        </g>

        <!-- Wallbox -->
        <g transform="translate(20, 455)" class="clickable" data-entity="ev_power">
          <g id="grpEV">
            <rect id="bgEV" x="0" y="0" width="220" height="58" rx="12" fill="rgba(60,232,120,0.04)" stroke="#3ce878" stroke-width="1.2" opacity="0.4"/>
            <g transform="translate(18, 14)" fill="none" stroke="#3ce878" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="2" width="18" height="28" rx="2.5"/>
              <rect x="6" y="6" width="12" height="8" rx="1" fill="#3ce878" opacity="0.2" stroke-width="0.8"/>
              <path d="M 21,18 Q 28,18 28,25 Q 28,31 23,31" stroke-width="1.7"/>
              <rect x="20" y="28" width="7" height="5" rx="1" fill="#3ce878" stroke="none"/>
              <path d="M 13,8 L 10,11 L 13,11 L 11,13" stroke="#3ce878" stroke-width="1"/>
            </g>
            <line x1="60" y1="14" x2="60" y2="44" stroke="#3ce878" stroke-width="0.6" opacity="0.25"/>
            <text x="74" y="20" font-size="10" fill="#8b949e" letter-spacing="1" font-weight="600">WALLBOX</text>
            <rect id="evModeBg" x="118" y="9" width="50" height="14" rx="7" fill="rgba(60,232,120,0.15)" stroke="#3ce878" stroke-width="0.6" opacity="0"/>
            <text id="evMode" x="143" y="19" text-anchor="middle" font-size="8" fill="#3ce878" font-weight="700" letter-spacing="0.8" opacity="0"></text>
            <text id="vEV" x="74" y="40" font-size="16" font-weight="700" fill="#3ce878">0 W</text>
            <text id="evToday" x="74" y="52" font-size="9" fill="#8b949e" opacity="0">today: -- kWh</text>
            <!-- EV-SOC Anzeige rechts -->
            <g id="evSocGroup" opacity="0">
              <text x="178" y="35" text-anchor="middle" font-size="8" fill="#8b949e" letter-spacing="0.5">EV SOC</text>
              <text id="evSocVal" x="178" y="50" text-anchor="middle" font-size="14" font-weight="700" fill="#3ce878">--%</text>
            </g>
            <circle id="dotEV" cx="204" cy="14" r="3.5" fill="#3ce878" opacity="0"/>
          </g>
        </g>

        <!-- Heatpump -->
        <g transform="translate(260, 455)" class="clickable" data-entity="heatpump_power">
          <g id="grpHP">
            <rect id="bgHP" x="0" y="0" width="220" height="58" rx="12" fill="rgba(106,176,255,0.04)" stroke="#6ab0ff" stroke-width="1.2" opacity="0.4"/>
            <g transform="translate(16, 14)" fill="none" stroke="#6ab0ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="0" y="2" width="32" height="28" rx="2.5"/>
              <line x1="4" y1="6" x2="28" y2="6" stroke-width="0.9" opacity="0.6"/>
              <circle cx="16" cy="18" r="9"/>
              <g id="hpFanRotate" transform="translate(16 18)">
                <g>
                  <path d="M 0,-7 Q 3.5,-3.5 0,0 Q -3.5,-3.5 0,-7" fill="#6ab0ff" opacity="0.55" stroke="none"/>
                  <path d="M 7,0 Q 3.5,3.5 0,0 Q 3.5,-3.5 7,0" fill="#6ab0ff" opacity="0.55" stroke="none"/>
                  <path d="M 0,7 Q -3.5,3.5 0,0 Q 3.5,3.5 0,7" fill="#6ab0ff" opacity="0.55" stroke="none"/>
                  <path d="M -7,0 Q -3.5,-3.5 0,0 Q -3.5,3.5 -7,0" fill="#6ab0ff" opacity="0.55" stroke="none"/>
                  <circle cx="0" cy="0" r="2.2" fill="#6ab0ff"/>
                </g>
              </g>
            </g>
            <line x1="60" y1="14" x2="60" y2="44" stroke="#6ab0ff" stroke-width="0.6" opacity="0.25"/>
            <text x="74" y="24" font-size="11" fill="#8b949e" letter-spacing="1.2" font-weight="600">3D DRUCKER</text>
            <text id="vHP" x="74" y="45" font-size="17" font-weight="700" fill="#6ab0ff">0 W</text>
            <circle id="dotHP" cx="204" cy="14" r="3.5" fill="#6ab0ff" opacity="0"/>
          </g>
        </g>
      </svg>

      <div class="economy-bar">
        <div class="eco-item">
          <div class="eco-label">ERSPARNIS HEUTE</div>
          <div id="ecoSavings" class="eco-val save">-- €</div>
          <div class="eco-sub">eigenverbraucht</div>
        </div>
        <div class="eco-item">
          <div class="eco-label">EINSPEISUNG HEUTE</div>
          <div id="ecoFeedin" class="eco-val save">-- €</div>
          <div id="ecoFeedinSub" class="eco-sub">-- kWh eingespeist</div>
        </div>
        <div class="eco-item">
          <div class="eco-label">NETZBEZUG HEUTE</div>
          <div id="ecoCost" class="eco-val cost">-- €</div>
          <div id="ecoCostSub" class="eco-sub">-- kWh bezogen</div>
        </div>
      </div>

      <div class="footer">
        <div class="f-item" data-entity="battery_voltage">
          <div class="f-label">Batterie Spannung</div>
          <div id="fVolt" class="f-val">-- V</div>
        </div>
        <div class="f-item" data-entity="today_pv">
          <div class="f-label">PV Heute</div>
          <div id="fToday" class="f-val">-- kWh</div>
        </div>
        <div class="f-item" data-entity="inv_temp">
          <div class="f-label">Wechselrichter Temp</div>
          <div id="fStat" class="f-val">-- °C</div>
        </div>
      </div>

      <div class="status-line">
        <span><span id="statusDot" class="status-dot"></span><span id="statusText">online</span></span>
        <span id="lastUpdate">--</span>
      </div>
    </div>
    `;
    this._rendered = true;
    this._attachClickHandlers();
    if (this._hass) this._update();
  }

  _attachClickHandlers() {
    // Alle Elemente mit data-entity bekommen Click-Handler zum Oeffnen des more-info Popups
    const elements = this.shadowRoot.querySelectorAll('[data-entity]');
    elements.forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = el.getAttribute('data-entity');
        const eid = this.config[key];
        // Bei Listen den ersten Sensor nehmen
        if (Array.isArray(eid)) {
          if (eid.length > 0) this._openMoreInfo(eid[0]);
        } else {
          this._openMoreInfo(eid);
        }
      });
    });
    // Forecast-Bar oeffnet ersten Forecast-Sensor
    const fcBar = this.shadowRoot.getElementById('fcBar');
    if (fcBar) {
      fcBar.addEventListener('click', () => {
        const f = this.config.forecast_today;
        if (Array.isArray(f) && f.length > 0) this._openMoreInfo(f[0]);
        else if (typeof f === 'string') this._openMoreInfo(f);
      });
    }
  }

  _checkWarnings(soc, invTemp, pvTotal, gridSigned, battSigned) {
    const cfg = this.config;
    if (!cfg.show_warnings) return null;
    const warnings = [];
    // SOC kritisch niedrig
    if (soc < cfg.warn_soc_low && battSigned < -50) {
      warnings.push({ level: soc < 8 ? 'critical' : 'normal', text: `BATTERIE NIEDRIG ${soc.toFixed(0)}%` });
    }
    // Inverter heiss
    if (invTemp > cfg.warn_inv_temp_high) {
      warnings.push({ level: invTemp > cfg.warn_inv_temp_high + 10 ? 'critical' : 'normal', text: `WR-TEMP ${invTemp.toFixed(0)}°C` });
    }
    // System-Anomalie: hoher Netzbezug bei vollem Speicher und PV
    if (gridSigned > 1500 && soc > 90 && pvTotal > 500) {
      warnings.push({ level: 'normal', text: 'NETZBEZUG TROTZ VOLLER BATT' });
    }
    if (warnings.length === 0) return null;
    // Zeige die kritischste
    warnings.sort((a, b) => (a.level === 'critical' ? -1 : 1));
    return warnings[0];
  }

  _update() {
    if (!this._hass) return;
    const root = this.shadowRoot;
    const cfg = this.config;

    const pv1 = this._v(cfg.pv1_power, 'power');
    const pv2 = this._v(cfg.pv2_power, 'power');
    const pv3 = this._v(cfg.pv3_power, 'power');

    // PV-Gesamtleistung kommt aus dem schnellen evcc-Sensor wenn verfuegbar.
    // Fallback summiert weiterhin alle konfigurierten Strings (auch wenn nur "Dach" angezeigt wird).
    const pvTotalFast = this._val(cfg.pv_total_power, 'power');
    const pvTotal = pvTotalFast !== null ? pvTotalFast : (pv1 + pv2 + pv3);

    let gridRaw = this._v(cfg.grid_active_power, 'power');
    let battRaw = this._v(cfg.battery_power, 'power');
    const gridSigned = cfg.grid_positive_means === 'export' ? -gridRaw : gridRaw;
    const battSigned = cfg.battery_positive_means === 'discharge' ? -battRaw : battRaw;

    const soc = this._v(cfg.battery_soc, 'percent');
    const house = this._v(cfg.consump, 'power');
    const invTemp = this._v(cfg.inv_temp, 'temp');
    const battVolt = this._v(cfg.battery_voltage, 'voltage');
    const todayPv = this._v(cfg.today_pv, 'energy');
    const evPwr = this._v(cfg.ev_power, 'power');
    const hpPwr = this._v(cfg.heatpump_power, 'power');

    // PV Strings (nur noch "Dach" sichtbar)
    root.getElementById('vPv1').textContent = this._fmtPower(pv1);
    root.getElementById('dPv1').setAttribute('opacity', pv1 > 10 ? '1' : '0.3');

    // Inverter zeigt den schnellen Gesamtwert
    root.getElementById('invPwr').textContent = this._fmtPower(pvTotal);
    root.getElementById('invTemp').textContent = invTemp.toFixed(1) + ' °C';

    // Grid
    root.getElementById('gridPwr').textContent = this._fmtPower(Math.abs(gridSigned));
    const gridLabel = root.getElementById('gridLabel');
    const gridPwrEl = root.getElementById('gridPwr');
    if (Math.abs(gridSigned) < 30) {
      gridLabel.textContent = 'LEERLAUF'; gridLabel.style.fill = '#8b949e'; gridPwrEl.style.fill = '#8b949e';
    } else if (gridSigned > 0) {
      gridLabel.textContent = 'BEZUG'; gridLabel.style.fill = '#f0883e'; gridPwrEl.style.fill = '#f0883e';
    } else {
      gridLabel.textContent = 'EINSPEISUNG'; gridLabel.style.fill = '#3ce878'; gridPwrEl.style.fill = '#3ce878';
    }

    // House + kleiner Trend
    root.getElementById('housePwr').textContent = this._fmtPower(house);
    const houseTrend = this._trend('house', house);
    root.getElementById('houseTrend').innerHTML = this._trendArrow(houseTrend, houseTrend > 0 ? '#f0883e' : '#3ce878');

    // Battery + SOC-Trend
    root.getElementById('battSoc').textContent = soc.toFixed(0) + '%';
    root.getElementById('battPwr').textContent = this._fmtPower(Math.abs(battSigned));
    const socTrend = this._trend('soc', soc);
    root.getElementById('battSocTrend').innerHTML = this._trendArrow(socTrend, socTrend > 0 ? '#3ce878' : '#f0883e');

    const bl = root.getElementById('battLevel');
    const fillHeight = Math.max(0, Math.min(102, (soc / 100) * 102));
    bl.setAttribute('height', fillHeight);
    bl.setAttribute('y', 102 - fillHeight);
    if (soc < 20) bl.setAttribute('fill', 'url(#gradBattLow)');
    else if (soc < 40) bl.setAttribute('fill', 'url(#gradBattMid)');
    else bl.setAttribute('fill', 'url(#gradBatt)');

    const eta = root.getElementById('battEta');
    if (Math.abs(battSigned) > 100) {
      const h = battSigned > 0
        ? ((100 - soc) / 100) * cfg.batt_capacity_wh / battSigned
        : (soc / 100) * cfg.batt_capacity_wh / Math.abs(battSigned);
      eta.textContent = (battSigned > 0 ? 'Voll in ' : 'Leer in ') + h.toFixed(1) + ' h';
    } else {
      eta.textContent = '';
    }

    // Autarkie + Eigenverbrauch
    const gridImport = Math.max(0, gridSigned);
    const gridExport = Math.max(0, -gridSigned);
    const aut = house > 50 ? Math.max(0, Math.min(100, ((house - gridImport) / house) * 100)) : 100;
    root.getElementById('autarky').textContent = `AUTARKIE: ${aut.toFixed(0)}%`;

    let selfUse = 100;
    if (pvTotal > 50) {
      const selfConsumed = Math.max(0, pvTotal - gridExport);
      selfUse = Math.max(0, Math.min(100, (selfConsumed / pvTotal) * 100));
    } else if (pvTotal <= 50 && gridExport > 0) {
      selfUse = 0;
    }
    root.getElementById('selfBadge').textContent = `EIGENVERBRAUCH: ${selfUse.toFixed(0)}%`;

    // Warnings
    const warn = this._checkWarnings(soc, invTemp, pvTotal, gridSigned, battSigned);
    const warnBadge = root.getElementById('warnBadge');
    if (warn) {
      warnBadge.style.display = '';
      warnBadge.classList.toggle('critical', warn.level === 'critical');
      root.getElementById('warnText').textContent = warn.text;
    } else {
      warnBadge.style.display = 'none';
    }

    // Sun
    const sunS = this._hass.states[cfg.sun];
    let sx = 250, sy = 30, sunVisible = true;
    if (sunS?.attributes?.elevation !== undefined && sunS?.attributes?.azimuth !== undefined) {
      const elev = sunS.attributes.elevation;
      const az = sunS.attributes.azimuth;
      if (elev < 0) sunVisible = false;
      else {
        const t = Math.max(0, Math.min(1, (az - 90) / 180));
        sx = 30 + t * 440;
        sy = 120 - Math.sin(t * Math.PI) * 100;
      }
    }
    const sr = sunS?.attributes?.next_rising;
    const ss = sunS?.attributes?.next_setting;
    root.getElementById('sunriseTime').textContent = this._fmtTime(sr);
    root.getElementById('sunsetTime').textContent = this._fmtTime(ss);

    const sunEl = root.getElementById('sun');
    const sunGlow = root.getElementById('sunGlow');
    const sunRays = root.getElementById('sunRays');
    const sunBox = root.getElementById('sunBox');
    const sunVal = root.getElementById('sunVal');
    const sunFlowPath = root.getElementById('sunFlowPath');
    const dotSun = root.getElementById('dotSun');
    const animSun = root.getElementById('animSun');

    const dmode = sunVisible ? '' : 'none';
    sunEl.style.display = dmode;
    sunGlow.style.display = dmode;
    sunRays.style.display = dmode;
    sunBox.style.display = dmode;
    sunVal.style.display = dmode;
    sunFlowPath.style.display = dmode;

    if (sunVisible) {
      sunEl.setAttribute('cx', sx);
      sunEl.setAttribute('cy', sy);
      sunGlow.setAttribute('cx', sx);
      sunGlow.setAttribute('cy', sy);
      sunRays.setAttribute('transform', `translate(${sx - 250}, ${sy - 30})`);
      sunBox.setAttribute('x', sx - 34);
      sunBox.setAttribute('y', sy + 18);
      sunVal.setAttribute('x', sx);
      sunVal.setAttribute('y', sy + 32);
      const targetX = 250, targetY = 180;
      const cx1 = sx + (targetX - sx) * 0.3;
      const cy1 = sy + 50;
      const cx2 = targetX - (targetX - sx) * 0.3;
      const cy2 = targetY - 40;
      const curvePath = `M ${sx},${sy + 12} C ${cx1},${cy1} ${cx2},${cy2} ${targetX},${targetY}`;
      sunFlowPath.setAttribute('d', curvePath);
    }

    // Sonnen-Wertanzeige: schneller Gesamt-Sensor
    sunVal.textContent = this._fmtPower(pvTotal);

    if (sunVisible && pvTotal > 50) {
      dotSun.setAttribute('opacity', '1');
      const speed = Math.max(1.5, Math.min(4, 4000 / pvTotal)).toFixed(1) + 's';
      if (animSun.getAttribute('dur') !== speed) {
        animSun.setAttribute('dur', speed);
        try { animSun.beginElement(); } catch (e) {}
      }
    } else {
      dotSun.setAttribute('opacity', '0');
    }

    // Flow Animations
    this._animFlow('dotBatt', 'animBatt', battSigned, 50,
      battSigned > 0 ? 'M 200,225 H 130' : 'M 130,225 H 200',
      battSigned > 0 ? '#3ce878' : '#f0883e');
    this._animFlow('dotGrid', 'animGrid', gridSigned, 30,
      gridSigned > 0 ? 'M 370,225 H 300' : 'M 300,225 H 370',
      gridSigned > 0 ? '#f0883e' : '#3ce878');
    this._animFlow('dotHouse', 'animHouse', house, 50, 'M 250,275 V 335', '#f4d03f');

    // Wallbox
    const bgEV = root.getElementById('bgEV');
    const vEV = root.getElementById('vEV');
    const dotEV = root.getElementById('dotEV');
    const evToday = root.getElementById('evToday');
    const evMode = root.getElementById('evMode');
    const evModeBg = root.getElementById('evModeBg');
    vEV.textContent = this._fmtPower(evPwr);

    const evTodayVal = this._val(cfg.wallbox_energy_today, 'energy');
    if (evTodayVal !== null) {
      evToday.textContent = `heute: ${evTodayVal.toFixed(1)} kWh`;
      evToday.setAttribute('opacity', '1');
    } else {
      evToday.setAttribute('opacity', '0');
    }

    const evModeVal = this._strState(cfg.wallbox_mode);
    if (evModeVal) {
      // evcc Modi auf lesbare Kuerzel mappen
      const modeMap = {
        'off': 'AUS',
        'now': 'JETZT',
        'minpv': 'MIN+PV',
        'pv': 'PV',
      };
      const modeLabel = modeMap[evModeVal.toLowerCase()] || evModeVal.toUpperCase().substring(0, 6);
      evMode.textContent = modeLabel;
      evMode.setAttribute('opacity', '1');
      evModeBg.setAttribute('opacity', '1');
    } else {
      evMode.setAttribute('opacity', '0');
      evModeBg.setAttribute('opacity', '0');
    }

    // EV-SOC
    const evSocGroup = root.getElementById('evSocGroup');
    const evSocVal = root.getElementById('evSocVal');
    const evSocReading = this._val(cfg.ev_soc, 'percent');
    if (evSocReading !== null) {
      evSocVal.textContent = evSocReading.toFixed(0) + '%';
      evSocGroup.setAttribute('opacity', '1');
    } else {
      evSocGroup.setAttribute('opacity', '0');
    }

    if (evPwr > 100) {
      bgEV.setAttribute('opacity', '1');
      bgEV.setAttribute('fill', 'rgba(60,232,120,0.12)');
      dotEV.setAttribute('opacity', '1');
      dotEV.innerHTML = '<animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/>';
    } else {
      bgEV.setAttribute('opacity', '0.4');
      bgEV.setAttribute('fill', 'rgba(60,232,120,0.04)');
      dotEV.setAttribute('opacity', '0');
      dotEV.innerHTML = '';
    }

    // Heatpump
    const bgHP = root.getElementById('bgHP');
    const vHP = root.getElementById('vHP');
    const dotHP = root.getElementById('dotHP');
    const hpFanRotate = root.getElementById('hpFanRotate');
    const hpFanInner = hpFanRotate ? hpFanRotate.querySelector('g') : null;
    vHP.textContent = this._fmtPower(hpPwr);
    if (hpPwr > 100) {
      bgHP.setAttribute('opacity', '1');
      bgHP.setAttribute('fill', 'rgba(106,176,255,0.12)');
      dotHP.setAttribute('opacity', '1');
      dotHP.innerHTML = '<animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/>';
      if (hpFanInner && !hpFanInner.querySelector('animateTransform')) {
        const fanAnim = document.createElementNS('http://www.w3.org/2000/svg', 'animateTransform');
        fanAnim.setAttribute('attributeName', 'transform');
        fanAnim.setAttribute('attributeType', 'XML');
        fanAnim.setAttribute('type', 'rotate');
        fanAnim.setAttribute('from', '0 0 0');
        fanAnim.setAttribute('to', '360 0 0');
        fanAnim.setAttribute('dur', '2s');
        fanAnim.setAttribute('repeatCount', 'indefinite');
        hpFanInner.appendChild(fanAnim);
      }
    } else {
      bgHP.setAttribute('opacity', '0.4');
      bgHP.setAttribute('fill', 'rgba(106,176,255,0.04)');
      dotHP.setAttribute('opacity', '0');
      dotHP.innerHTML = '';
      if (hpFanInner) {
        const existingFanAnim = hpFanInner.querySelector('animateTransform');
        if (existingFanAnim) existingFanAnim.remove();
      }
    }

    // Forecast.Solar
    const fcToday = this._sumVal(cfg.forecast_today, 'energy');
    const fcTomorrow = this._sumVal(cfg.forecast_tomorrow, 'energy');
    const fcBar = root.getElementById('fcBar');
    const fcFill = root.getElementById('fcFill');
    const fcTodayEl = root.getElementById('fcToday');
    const fcTomorrowEl = root.getElementById('fcTomorrow');
    if (fcToday !== null && fcToday > 0) {
      const pct = Math.max(0, Math.min(100, (todayPv / fcToday) * 100));
      fcFill.style.width = pct + '%';
      fcTodayEl.textContent = `${todayPv.toFixed(1)} / ${fcToday.toFixed(1)} kWh`;
      if (fcTomorrow !== null) {
        fcTomorrowEl.textContent = `→ ${fcTomorrow.toFixed(1)} kWh morgen`;
        fcTomorrowEl.style.display = '';
      } else {
        fcTomorrowEl.style.display = 'none';
      }
      fcBar.style.display = 'flex';
    } else {
      fcBar.style.display = 'none';
    }

    // Wirtschaftlichkeit
    const gridImportToday = this._v(cfg.grid_import_today, 'energy');
    const gridExportToday = this._v(cfg.pv_to_grid_today, 'energy');
    const selfConsumedToday = Math.max(0, todayPv - gridExportToday);
    const savings = selfConsumedToday * cfg.electricity_price;
    const feedin = gridExportToday * cfg.feed_in_tariff;
    const cost = gridImportToday * cfg.electricity_price;
    root.getElementById('ecoSavings').textContent = this._fmtMoney(savings);
    root.getElementById('ecoFeedin').textContent = this._fmtMoney(feedin);
    root.getElementById('ecoFeedinSub').textContent = `${gridExportToday.toFixed(1)} kWh eingespeist`;
    root.getElementById('ecoCost').textContent = this._fmtMoney(cost);
    root.getElementById('ecoCostSub').textContent = `${gridImportToday.toFixed(1)} kWh bezogen`;

    // Footer
    root.getElementById('fVolt').textContent = battVolt.toFixed(1) + ' V';
    root.getElementById('fToday').textContent = todayPv.toFixed(1) + ' kWh';
    root.getElementById('fStat').textContent = invTemp.toFixed(1) + ' °C';

    // Heartbeat - jetzt mit dem schnellen pv_total_power oder Fallback
    const heartbeatCandidates = [cfg.pv_total_power, cfg.grid_active_power, cfg.consump, cfg.battery_power];
    let heartbeatSensor = null;
    let bestAge = Infinity;
    for (const eid of heartbeatCandidates) {
      if (!eid) continue;
      const s = this._hass.states[eid];
      if (!s) continue;
      const age = (Date.now() - new Date(s.last_updated).getTime()) / 1000;
      if (age < bestAge) {
        bestAge = age;
        heartbeatSensor = s;
      }
    }
    if (heartbeatSensor) {
      const dot = root.getElementById('statusDot');
      const txt = root.getElementById('statusText');
      const upd = root.getElementById('lastUpdate');
      if (bestAge < 60) {
        dot.classList.remove('stale');
        txt.textContent = 'online';
        upd.textContent = `aktualisiert vor ${Math.round(bestAge)} s`;
      } else if (bestAge < 3600) {
        dot.classList.add('stale');
        txt.textContent = 'veraltet';
        upd.textContent = `aktualisiert vor ${Math.round(bestAge / 60)} min`;
      } else {
        dot.classList.add('stale');
        txt.textContent = 'offline?';
        upd.textContent = `aktualisiert vor ${Math.round(bestAge / 3600)} h`;
      }
    }

    // Historische Daten ggf. nachladen (asynchron)
    this._maybeUpdateSparkline();
    this._maybeUpdateWeekCompare();

    // Sparkline-Visibility
    const sparkRow = root.getElementById('sparklineRow');
    if (cfg.show_sparkline) sparkRow.style.display = '';
    else sparkRow.style.display = 'none';
  }

  _animFlow(dotId, animId, value, threshold, path, color) {
    const dot = this.shadowRoot.getElementById(dotId);
    const anim = this.shadowRoot.getElementById(animId);
    if (Math.abs(value) > threshold) {
      dot.setAttribute('opacity', '1');
      dot.setAttribute('fill', color);
      dot.style.color = color;
      if (anim.getAttribute('path') !== path) {
        anim.setAttribute('path', path);
        try { anim.beginElement(); } catch (e) {}
      }
      const speed = Math.max(0.8, Math.min(3, 3000 / Math.abs(value))).toFixed(1) + 's';
      if (anim.getAttribute('dur') !== speed) anim.setAttribute('dur', speed);
    } else {
      dot.setAttribute('opacity', '0');
    }
  }

  getCardSize() { return 12; }
}
customElements.define('roxxor-pv-card', RoxXorPVCard);
console.info('%c RoxXor-PV-Card %c v5.1 ', 'color:#f4d03f;background:#0d1117;padding:2px 6px;border-radius:3px 0 0 3px;font-weight:bold', 'color:#0d1117;background:#f4d03f;padding:2px 6px;border-radius:0 3px 3px 0;font-weight:bold');
