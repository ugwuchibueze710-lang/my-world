// HUD: clock, realm list, chronicle, inspector, minimap and floating labels.
import * as THREE from 'three';
import { SEASONS } from '/shared/constants.js';
import { GRID, HALF, WORLD_SIZE } from '/shared/world.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STORM_ICON = { hurricane: '🌀 Hurricane', tornado: '🌪 Tornado', blizzard: '❄ Blizzard', wildfire: '🔥 Wildfire', flood: '🌊 Flood', plague: '☠ Plague', drought: '☀ Drought', thunderstorm: '⛈ Thunderstorm', heatwave: '🌡 Heatwave', windstorm: '💨 Windstorm', snow: '🌨 Snow', rain: '🌧 Rain' };

export class UI {
  constructor(app) {
    this.app = app;
    this.filter = 'major';
    this.events = [];
    this.labels = new Map();
    this.inspect = null;
    $('realms-toggle').onclick = () => $('realms').classList.toggle('collapsed');
    $('insp-close').onclick = () => this.closeInspector();
    $('help-close').onclick = () => $('help').classList.add('hidden');
    $('t-help').onclick = () => $('help').classList.toggle('hidden');
    $('t-territory').onclick = (e) => { app.showTerritory = !app.showTerritory; e.target.classList.toggle('on', app.showTerritory); };
    $('t-labels').onclick = (e) => { app.showLabels = !app.showLabels; e.target.classList.toggle('on', app.showLabels); };
    $('t-overview').onclick = () => app.flyTo(0, 0, 7200, true);
    document.querySelectorAll('.chip').forEach((c) => c.onclick = () => {
      document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
      this.filter = c.dataset.f; this.renderFeed();
    });
    $('feed').onclick = (e) => {
      const el = e.target.closest('.ev'); if (!el) return;
      const ev = this.events.find((x) => x.id === +el.dataset.id); if (!ev) return;
      if (ev.pid) this.app.selectPerson(ev.pid, true);
      else if (ev.x !== undefined) this.app.flyTo(ev.x, ev.z, ev.type === 'weather' ? 2600 : 700);
      else if (ev.k) this.app.selectKingdom(ev.k, true);
    };
    $('insp-body').onclick = (e) => {
      const a = e.target.closest('[data-p],[data-k],[data-act]'); if (!a) return;
      if (a.dataset.p) this.app.selectPerson(+a.dataset.p, true);
      else if (a.dataset.k) this.app.selectKingdom(+a.dataset.k, true);
      else if (a.dataset.act === 'follow') { this.app.follow = this.app.follow ? 0 : this.inspect.id; a.classList.toggle('on', !!this.app.follow); }
      else if (a.dataset.act === 'goto') this.app.flyTo(+a.dataset.x, +a.dataset.z, +a.dataset.d || 120);
    };
    $('realm-list').onclick = (e) => { const r = e.target.closest('.realm'); if (r) this.app.selectKingdom(+r.dataset.k, true); };
    const mm = $('minimap');
    mm.onclick = (e) => {
      const b = mm.getBoundingClientRect();
      const x = ((e.clientX - b.left) / b.width) * WORLD_SIZE - HALF, z = ((e.clientY - b.top) / b.height) * WORLD_SIZE - HALF;
      this.app.flyTo(x, z, Math.min(app.camDist(), 1800));
    };
    $('labels').addEventListener('click', (e) => {
      const l = e.target.closest('.lbl'); if (!l) return;
      if (l.dataset.k) this.app.selectKingdom(+l.dataset.k, true);
      if (l.dataset.p) this.app.selectPerson(+l.dataset.p, true);
    });
  }

  buildMinimapBase(world) {
    const S = 220, c = document.createElement('canvas'); c.width = c.height = S;
    const ctx = c.getContext('2d'), img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const wx = (x / S) * WORLD_SIZE - HALF, wz = (y / S) * WORLD_SIZE - HALF;
      const ci = world.cellIndex(wx, wz), h = world.gh[ci];
      let r, g, b;
      if (h < 0.5) { const d = Math.min(1, -h / 120); r = 18 - d * 8; g = 52 - d * 22; b = 78 - d * 25; }
      else {
        const sh = Math.min(1, h / 450), f = world.forest[ci], fe = world.fert[ci];
        r = 92 + sh * 120 - f * 40; g = 112 + sh * 90 - f * 30 + fe * 25; b = 62 + sh * 130 - f * 20;
        if (h > 330) { r = g = b = 200 + (h - 330) * 0.2; }
      }
      if (world.river[ci] && world.rdist[ci] === 0 && h > 0.5) { r = 50; g = 110; b = 160; }
      const o = (y * S + x) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mmBase = c;
  }

  setOwner(owner, ids, colorOf) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d'), img = ctx.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) {
      const o = owner[i]; if (!o) continue;
      const col = colorOf(ids[o - 1]);
      img.data[i * 4] = col.r * 255; img.data[i * 4 + 1] = col.g * 255; img.data[i * 4 + 2] = col.b * 255; img.data[i * 4 + 3] = 110;
    }
    ctx.putImageData(img, 0, 0);
    this.mmOwner = c;
  }

  drawMinimap(state, camera, focus, time) {
    const cv = $('minimap'), ctx = cv.getContext('2d'), S = cv.width;
    if (!this.mmBase) return;
    ctx.drawImage(this.mmBase, 0, 0);
    if (this.mmOwner) { ctx.imageSmoothingEnabled = false; ctx.drawImage(this.mmOwner, 0, 0, S, S); ctx.imageSmoothingEnabled = true; }
    const m = (v) => ((v + HALF) / WORLD_SIZE) * S;
    if (state) {
      for (const s of state.storms) {
        if (s.type === 'rain' || s.type === 'snow') continue;
        ctx.beginPath(); ctx.arc(m(s.x), m(s.z), Math.max(3, (s.r / WORLD_SIZE) * S), 0, Math.PI * 2);
        ctx.fillStyle = { hurricane: 'rgba(220,230,255,.35)', tornado: 'rgba(80,80,80,.8)', blizzard: 'rgba(240,250,255,.4)', wildfire: 'rgba(255,110,30,.6)', drought: 'rgba(230,180,60,.22)', plague: 'rgba(130,200,60,.35)', flood: 'rgba(80,140,255,.4)', thunderstorm: 'rgba(120,130,170,.35)', heatwave: 'rgba(255,120,60,.15)', windstorm: 'rgba(200,200,200,.18)' }[s.type] || 'rgba(255,255,255,.2)';
        ctx.fill();
      }
      for (const k of state.kingdoms) {
        if (k.army && k.army.s !== 'muster') {
          ctx.strokeStyle = k.color; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]);
          ctx.beginPath(); ctx.moveTo(m(k.x), m(k.z)); ctx.lineTo(m(k.army.x), m(k.army.z)); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(m(k.army.x), m(k.army.z), 2.5, 0, 7); ctx.fill();
        }
        ctx.fillStyle = k.color; ctx.strokeStyle = k.capital ? '#ffd56b' : '#000'; ctx.lineWidth = k.capital ? 2 : 1;
        ctx.beginPath(); ctx.arc(m(k.x), m(k.z), 3 + Math.min(4, Math.sqrt(k.pop) / 3), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    // camera footprint
    const d = Math.max(60, (camera.position.y - focus.y) * 1.2);
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1;
    ctx.strokeRect(m(focus.x) - (d / WORLD_SIZE) * S, m(focus.z) - (d / WORLD_SIZE) * S, (2 * d / WORLD_SIZE) * S, (2 * d / WORLD_SIZE) * S);
  }

  updateTop(st, hours, dayHours) {
    const yearH = 8760, y = Math.floor(hours / yearH), yh = hours - y * yearH, season = Math.min(3, Math.floor((yh / yearH) * 4));
    const dh = dayHours ?? hours, hr = Math.floor(dh % 24), mn = Math.floor((dh * 60) % 60);
    const daysPerYear = st ? Math.max(1, Math.round(yearH / (st.hps * (st.dayS || 360)))) : 24;
    const day = Math.floor((yh / yearH) * daysPerYear) + 1;
    const part = hr < 5 ? 'Night' : hr < 8 ? 'Dawn' : hr < 12 ? 'Morning' : hr < 17 ? 'Afternoon' : hr < 21 ? 'Evening' : 'Night';
    $('date').textContent = `Year ${y + 1} · ${SEASONS[season]} · Day ${day}`;
    $('hour').textContent = `${String(hr).padStart(2, '0')}:${String(mn).padStart(2, '0')} · ${part}`;
    if (!st) return;
    $('s-pop').textContent = st.pop.toLocaleString();
    $('s-king').textContent = st.kingdoms.length;
    $('s-wars').textContent = new Set(st.kingdoms.filter((k) => k.war.length).map((k) => k.id)).size;
    $('s-births').textContent = st.stats.births.toLocaleString();
    $('s-deaths').textContent = st.stats.deaths.toLocaleString();
    const cap = st.kingdoms.find((k) => k.id === st.capital);
    $('s-capital').textContent = cap ? '♛ ' + cap.name : 'None yet';
    $('scale').textContent = `1 sec = ${st.hps === 1 ? '1 hr' : st.hps + ' hrs'}`;
  }

  renderRealms(st) {
    const ks = [...st.kingdoms].sort((a, b) => (b.capital - a.capital) || (b.power - a.power));
    const name = (id) => st.kingdoms.find((k) => k.id === id)?.name || '?';
    $('realm-list').innerHTML = ks.map((k) => `
      <div class="realm" data-k="${k.id}">
        <div class="sw" style="background:${k.color}"></div>
        <div>
          <div class="nm">${esc(k.name)} ${k.capital ? '<span class="tag cap">Capital</span>' : ''}${k.siege > 0 ? '<span class="tag siege">Besieged</span>' : ''}</div>
          <div class="meta">${k.ruler ? esc(k.ruler.name) : 'No ruler'} · ${k.pop} people${k.soldiers ? ` · ⚔ ${k.soldiers}` : ''}</div>
          <div class="meta">${k.war.length ? `<span class="tag war">War: ${k.war.map(name).map(esc).join(', ')}</span> ` : ''}${k.ally.length ? `<span class="tag ally">Allies ${k.ally.length}</span>` : ''}</div>
        </div>
        <div class="pw"><b>${Math.round(k.power * 10) / 10}</b>power</div>
      </div>`).join('');
  }

  addEvents(evs) {
    if (!evs.length) return;
    this.events.push(...evs);
    if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
    this.renderFeed();
  }
  renderFeed() {
    const list = this.events.filter((e) => this.filter === 'all' || !e.minor).slice(-120).reverse();
    $('feed').innerHTML = list.map((e) => e.narrOnly
      ? `<div class="ev narration" data-id="${e.id}"><i>“${esc(e.narr)}”</i></div>`
      : `<div class="ev ${e.type} ${e.minor ? 'minor' : ''}" data-id="${e.id}"><span class="when">Y${e.year} ${e.season?.[0] || ''}${e.day}</span>${esc(e.text)}${e.narr ? `<div class="narr">${esc(e.narr)}</div>` : ''}</div>`).join('');
  }

  closeInspector() { $('inspector').classList.add('hidden'); this.inspect = null; this.app.onInspectClosed(); }

  showPerson(d) {
    if (d.gone) { $('insp-body').innerHTML = '<p class="thought">This person has died.</p>'; return; }
    this.inspect = { kind: 'person', id: d.id };
    $('inspector').classList.remove('hidden');
    $('insp-title').textContent = `${d.title ? d.title + ' ' : ''}${d.name}`;
    const pl = (p) => (p ? `<a class="link" data-p="${p.id}">${esc(p.name)}</a>` : '—');
    const bar = (label, v, col) => `<div><label><span>${label}</span><span>${Math.round(v * 100)}%</span></label><div class="meter"><i style="width:${Math.max(2, v * 100)}%;background:${col}"></i></div></div>`;
    const g = d.genes;
    const trait = (n, v) => `<span>${n}</span><span>${'●'.repeat(Math.round(v * 5))}${'○'.repeat(5 - Math.round(v * 5))}</span>`;
    $('insp-body').innerHTML = `
      <div class="kv">
        <span>Realm</span><span>${d.kingdom ? `<a class="link" data-k="${d.kingdom.id}" style="color:${d.kingdom.color}">${esc(d.kingdom.name)}</a>` : '—'}</span>
        <span>House</span><span>${esc(d.house || '—')}</span>
        <span>Sex · Age</span><span>${d.sex === 'F' ? 'Female' : 'Male'} · ${Math.floor(d.age)} yrs</span>
        <span>Generation</span><span>${d.gen}</span>
        <span>Doing</span><span>${esc(d.state)}${d.soldier ? ' ⚔' : ''}${d.pregnant ? ' · expecting' : ''}${d.sick ? ' · <b style="color:#9c6">sick</b>' : ''}</span>
      </div>
      <div class="thought">“${esc(d.thought)}”</div>
      <div class="sec">Body</div>
      <div class="meters">
        ${bar('Health', d.health / 100, '#e0533f')}${bar('Fed', d.satiety, '#d9a441')}
        ${bar('Water', d.hydration, '#4ea3e0')}${bar('Energy', d.energy, '#8bc34a')}
        ${bar('Nourished', d.nourish, '#c9a227')}${bar('Loyalty', d.loyalty, '#9575cd')}
      </div>
      <div class="kv" style="margin-top:8px"><span>Strength</span><span>${d.strength.toFixed(2)}</span><span>Battle kills</span><span>${d.kills}</span></div>
      <div class="sec">Nature (free will)</div>
      <div class="kv">${trait('Ambition', g.ambit)}${trait('Aggression', g.aggr)}${trait('Courage', g.courage)}${trait('Loyalty', g.loyal)}${trait('Diligence', g.dilig)}${trait('Sociable', g.social)}</div>
      ${d.secret ? `<div class="sec">Secret (only you can see this)</div><div class="thought" style="border-color:#c0392b">${esc(d.secret)}</div>` : ''}
      ${d.relations?.length ? `<div class="sec">Feelings</div>${d.relations.map((r) => `<div class="rel"><a class="link" data-p="${r.id}">${esc(r.name)}</a><span>${esc(r.label)} <b style="color:${r.v >= 0 ? '#7fd17f' : '#ff8a7a'}">${r.v > 0 ? '+' : ''}${r.v}</b></span></div>`).join('')}` : ''}
      ${d.memories?.length ? `<div class="sec">Memories</div>${d.memories.map((m) => `<div class="hist">${esc(m)}</div>`).join('')}` : ''}
      <div class="sec">Family</div>
      <div class="kv"><span>Spouse</span><span>${pl(d.spouse)}</span><span>Father</span><span>${pl(d.father)}</span><span>Mother</span><span>${pl(d.mother)}</span></div>
      <div class="people-list" style="margin-top:4px">${d.children.length ? d.children.map(pl).join(' ') : '<span style="color:var(--muted)">No living children</span>'}</div>
      <div class="actions"><button class="btn ${this.app.follow === d.id ? 'on' : ''}" data-act="follow">Follow</button><button class="btn" data-act="goto" data-x="${d.x}" data-z="${d.z}" data-d="40">Zoom in</button></div>`;
  }

  showKingdom(d) {
    if (d.gone) { $('insp-body').innerHTML = '<p class="thought">This kingdom has fallen.</p>'; return; }
    this.inspect = { kind: 'kingdom', id: d.id };
    $('inspector').classList.remove('hidden');
    $('insp-title').innerHTML = `<span style="color:${d.color}">■</span> ${esc(d.name)}${d.capital ? ' ♛' : ''}`;
    const pl = (p) => (p ? `<a class="link" data-p="${p.id}">${esc(p.name)}</a>` : '—');
    const tier = ['', 'Hamlet', 'Village', 'Town', 'Citadel'][d.tier];
    $('insp-body').innerHTML = `
      ${d.capital ? '<div class="thought" style="border-color:#ffd56b">The capital and superior realm of the world.</div>' : ''}
      <div class="kv">
        <span>Ruler</span><span>${pl(d.ruler)}${d.ruler ? `, ${d.ruler.age}` : ''}</span>
        <span>Dynasty</span><span>House ${esc(d.dynasty)}</span>
        <span>Founded</span><span>${esc(d.founded)}</span>
        ${d.parent ? `<span>Broke away from</span><span><a class="link" data-k="${d.parent.id}">${esc(d.parent.name)}</a></span>` : ''}
        <span>Settlement</span><span>${tier} · ${d.houses} homes${d.well ? ' · well' : ''}</span>
        <span>Monarchs so far</span><span>${d.monarchs}</span>
      </div>
      <div class="sec">People</div>
      <div class="kv">
        <span>Population</span><span>${d.pop}</span><span>Men · Women · Children</span><span>${d.men} · ${d.women} · ${d.kids}</span>
        <span>Nourishment</span><span>${Math.round(d.nourish * 100)}%</span>
      </div>
      <div class="sec">Strength</div>
      <div class="kv">
        <span>Military power</span><span>${d.power}</span><span>Fighters · Soldiers</span><span>${d.fighters} · ${d.soldiers}</span>
        <span>Weapons</span><span>level ${d.weapon}</span>
        <span>Food stores</span><span>${d.food}</span><span>Ore · Armory</span><span>${d.minerals} · ${d.armory}</span>
        <span>Army</span><span>${d.army === 'none' ? 'At home' : esc(d.army) + (d.armyTarget ? ' → ' + esc(d.armyTarget) : '')}</span>
        ${d.general ? `<span>General</span><span>${pl(d.general)}</span>` : ''}
        ${d.champion ? `<span>Champion</span><span>${pl(d.champion)} (${d.champion.kills} kills)</span>` : ''}
        <span>Wars won · lost</span><span>${d.wins} · ${d.losses}</span><span>Conquests</span><span>${d.conquests}</span>
        <span>Enemies slain · own dead</span><span>${d.kills} · ${d.deaths}</span>
      </div>
      <div class="sec">Royal family</div>
      <div class="people-list">${d.royals.length ? d.royals.map((p) => `${pl(p)} <span style="color:var(--muted)">${p.age}</span>`).join(' · ') : '<span style="color:var(--muted)">None</span>'}</div>
      <div class="sec">Tension with other realms</div>
      ${(d.tensions || []).map((t) => `<div class="rel"><a class="link" data-k="${t.id}">${esc(t.name)}</a><span>${t.cb ? `<i style="color:#ff9c8c">grievance: ${esc(t.cb)}</i> ` : ''}<b style="color:${t.t > 60 ? '#ff7a6a' : t.t > 35 ? '#f3c76b' : '#8fd18f'}">${t.t}</b>/100</span></div><div class="meter"><i style="width:${t.t}%;background:${t.t > 60 ? '#e0533f' : t.t > 35 ? '#d9a441' : '#6fbf73'}"></i></div>`).join('') || '<div style="color:var(--muted);font-size:12px">No neighbours</div>'}
      <div class="sec">Relations</div>
      ${d.relations.filter((r) => r.state !== 'peace' || r.truce || r.tribute).map((r) => `<div class="rel"><a class="link" data-k="${r.id}" style="color:${r.color}">${esc(r.name)}</a><span>${r.state === 'war' ? `<span class="tag war">War</span> ${r.theirDead} slain / ${r.ourDead} lost` : r.state === 'ally' ? '<span class="tag ally">Ally</span>' : r.tribute ? 'Pays tribute' : 'Truce'}</span></div>`).join('') || '<div style="color:var(--muted);font-size:12px">At peace with all</div>'}
      <div class="sec">Chronicle</div>
      ${d.history.slice().reverse().map((h) => `<div class="hist">${esc(h)}</div>`).join('')}
      <div class="actions"><button class="btn" data-act="goto" data-x="${d.x}" data-z="${d.z}" data-d="260">Fly to castle</button></div>`;
  }

  // floating labels for realms, armies, rulers, storms and ruins
  updateLabels(items, camera, w, h) {
    const seen = new Set();
    const v = new THREE.Vector3();
    for (const it of items) {
      v.set(it.x, it.y, it.z).project(camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
      seen.add(it.key);
      let el = this.labels.get(it.key);
      if (!el) { el = document.createElement('div'); el.className = 'lbl ' + it.cls; $('labels').appendChild(el); this.labels.set(it.key, el); el._html = ''; }
      if (el._html !== it.html) { el.innerHTML = it.html; el._html = it.html; el.className = 'lbl ' + it.cls; }
      if (it.k) el.dataset.k = it.k; if (it.p) el.dataset.p = it.p;
      el.style.left = ((v.x * 0.5 + 0.5) * w).toFixed(1) + 'px';
      el.style.top = ((-v.y * 0.5 + 0.5) * h).toFixed(1) + 'px';
      el.style.opacity = it.o ?? 1;
    }
    for (const [k, el] of this.labels) if (!seen.has(k)) { el.remove(); this.labels.delete(k); }
  }
  stormLabel(type) { return STORM_ICON[type] || type; }
}
