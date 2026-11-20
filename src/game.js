import { sound } from './audio.js';
import { sdk } from './sdk.js';
import { CROPS, INITIAL_PLOTS, UPGRADES } from './data.js';

// Опыт, нужный для каждого уровня (индекс = уровень)
const LEVEL_XP = [0, 0, 50, 150, 400, 1000, 2500];
const MAX_LEVEL = LEVEL_XP.length - 1;
const GRID = 4;       // поле 4x4
const BASE = 96;      // базовый размер грядки при рисовании (дальше масштабируется)
const SAVE_VERSION = 2;
const EMOJI_FONT = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";

class PixelFarm {
  constructor() {
    this.canvas = document.getElementById('farmCanvas');
    this.ctx = this.canvas.getContext('2d');

    this.coins = 30;
    this.xp = 0;
    this.inventory = {};
    Object.keys(CROPS).forEach((id) => (this.inventory[id] = 0));
    this.upgrades = {};
    Object.keys(UPGRADES).forEach((id) => (this.upgrades[id] = 0));
    this.selectedCrop = 'wheat';
    this.tutorialDone = false;
    this._shopKey = '';

    this.plots = INITIAL_PLOTS.map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      unlocked: p.unlocked,
      cost: p.cost || 0,
      crop: null,
      state: 'empty', // 'empty' | 'growing' | 'ripe'
      plantedAt: 0,
      ripeAt: 0,
    }));

    this.floatingTexts = [];
    this.particles = [];
    this.hoveredPlot = null;
    this.lastTime = performance.now();

    this.init();
  }

  get level() {
    let lvl = 1;
    for (let i = 2; i <= MAX_LEVEL; i++) {
      if (this.xp >= LEVEL_XP[i]) lvl = i;
    }
    return lvl;
  }

  // ---------- ЭФФЕКТЫ УЛУЧШЕНИЙ ----------
  growTimeOf(crop) {
    return crop.growTime / (1 + UPGRADES.speed.effectPerLevel * this.upgrades.speed);
  }

  priceOf(crop) {
    return Math.round(crop.sellPrice * (1 + UPGRADES.value.effectPerLevel * this.upgrades.value));
  }

  sellTotal() {
    let total = 0;
    Object.values(CROPS).forEach((c) => {
      total += this.inventory[c.id] * this.priceOf(c);
    });
    return total;
  }

  autoDelay() {
    const lvl = this.upgrades.autoHarvest;
    return lvl > 0 ? UPGRADES.autoHarvest.delays[lvl] : null;
  }

  upgradeCost(id) {
    const u = UPGRADES[id];
    return Math.round(u.baseCost * Math.pow(u.costMultiplier, this.upgrades[id]));
  }

  effectText(id) {
    const lvl = this.upgrades[id];
    if (id === 'autoHarvest') {
      return lvl > 0 ? `Сбор через ${UPGRADES.autoHarvest.delays[lvl]} с` : 'Не куплено';
    }
    const pct = Math.round(UPGRADES[id].effectPerLevel * lvl * 100);
    if (id === 'speed') return lvl > 0 ? `Рост быстрее на ${pct}%` : 'Не куплено';
    return lvl > 0 ? `Цена выше на ${pct}%` : 'Не куплено';
  }

  async init() {
    this.buildSeedBar();
    this.setupUI();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setupInputs();

    await sdk.init();
    await this.loadSave();

    setInterval(() => this.saveGame(), 5000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.saveGame();
    });

    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------- РАЗМЕРЫ ----------
  resize() {
    const wrap = this.canvas.parentElement;
    this.canvas.width = wrap.clientWidth;
    this.canvas.height = wrap.clientHeight;
    this.ctx.imageSmoothingEnabled = false;

    const top = document.querySelector('.hud-top').offsetHeight + 28;
    const bottom = document.querySelector('.hud-bottom').offsetHeight + 28;
    const availW = this.canvas.width - 24;
    const availH = this.canvas.height - top - bottom;

    const gapRatio = 0.12;
    const units = GRID + (GRID - 1) * gapRatio;
    const fit = Math.floor(Math.min(availW / units, availH / units));
    this.tile = Math.max(40, Math.min(fit, 120));
    this.gap = Math.round(this.tile * gapRatio);

    const total = GRID * this.tile + (GRID - 1) * this.gap;
    this.gridX = Math.round((this.canvas.width - total) / 2);
    this.gridY = Math.round(top + (availH - total) / 2);
  }

  plotPos(plot) {
    return {
      px: this.gridX + plot.x * (this.tile + this.gap),
      py: this.gridY + plot.y * (this.tile + this.gap),
    };
  }

  // ---------- ВВОД ----------
  setupInputs() {
    const getPlotAtPos = (x, y) => {
      for (const plot of this.plots) {
        const { px, py } = this.plotPos(plot);
        if (x >= px && x <= px + this.tile && y >= py && y <= py + this.tile) {
          return { plot, px, py };
        }
      }
      return null;
    };

    const handleClick = (clientX, clientY) => {
      sound.ensureContext();
      const rect = this.canvas.getBoundingClientRect();
      const hit = getPlotAtPos(clientX - rect.left, clientY - rect.top);
      if (hit) this.onPlotClick(hit.plot, hit.px + this.tile / 2, hit.py + this.tile / 2);
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handleClick(e.clientX, e.clientY);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const hit = getPlotAtPos(e.clientX - rect.left, e.clientY - rect.top);
      this.hoveredPlot = hit ? hit.plot : null;
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredPlot = null;
    });
  }

  // ---------- ДЕЙСТВИЯ ----------
  onPlotClick(plot, cx, cy) {
    // 1. Закрытая грядка: покупка
    if (!plot.unlocked) {
      if (this.coins < plot.cost) {
        sound.playClick();
        this.addFloatingText(cx, cy, `НУЖНО 💰${plot.cost}`, '#ff4d4d');
        return;
      }
      this.coins -= plot.cost;
      plot.unlocked = true;
      sound.playUnlock();
      this.addFloatingText(cx, cy, 'НОВАЯ ГРЯДКА!', '#7bed9f');
      this.spawnHarvestParticles(cx, cy);
      this.updateUI();
      this.saveGame();
      return;
    }

    // 2. Пустая грядка: посадка
    if (plot.state === 'empty') {
      const crop = CROPS[this.selectedCrop];
      if (this.coins < crop.seedCost) {
        sound.playClick();
        this.addFloatingText(cx, cy, 'НЕТ МОНЕТ!', '#ff4d4d');
        return;
      }
      this.coins -= crop.seedCost;
      plot.crop = crop.id;
      plot.state = 'growing';
      plot.plantedAt = Date.now();
      plot.ripeAt = 0;
      sound.playPlant();
      this.addFloatingText(cx, cy, `-💰${crop.seedCost}`, '#ffde59');
      this.spawnDirtParticles(cx, cy);
      const firstTime = !this.tutorialDone;
      this.tutorialDone = true;
      this.updateUI();
      if (firstTime) this.resize();
      return;
    }

    // 3. Созрело: сбор
    if (plot.state === 'ripe') {
      this.harvestPlot(plot, cx, cy, false);
      return;
    }

    // 4. Растёт
    if (plot.state === 'growing') {
      const crop = CROPS[plot.crop];
      const left = Math.ceil(Math.max(0, this.growTimeOf(crop) - (Date.now() - plot.plantedAt) / 1000));
      sound.playClick();
      this.addFloatingText(cx, cy, `ЕЩЁ ${left} с`, '#ffffff');
    }
  }

  harvestPlot(plot, cx, cy, auto) {
    const crop = CROPS[plot.crop];
    const levelBefore = this.level;
    plot.state = 'empty';
    plot.crop = null;
    plot.plantedAt = 0;
    plot.ripeAt = 0;
    this.inventory[crop.id] += 1;
    this.xp += crop.sellPrice;

    if (auto) {
      sound.playTone(700, 'sine', 0.05, 0.05);
      this.addFloatingText(cx, cy, `+1 ${crop.icon}`, '#c8f7dc', 10);
    } else {
      sound.playHarvest();
      this.addFloatingText(cx, cy, `+1 ${crop.icon}`, '#7bed9f');
      this.spawnHarvestParticles(cx, cy);
    }

    if (this.level > levelBefore) {
      sound.playUnlock();
      this.addFloatingText(this.canvas.width / 2, this.canvas.height / 2, `УРОВЕНЬ ${this.level}!`, '#ffde59', 20);
      const opened = Object.values(CROPS).filter((c) => c.levelReq === this.level);
      opened.forEach((c, i) => {
        this.addFloatingText(this.canvas.width / 2, this.canvas.height / 2 + 30 + i * 22, `ОТКРЫТО: ${c.icon} ${c.name}`, '#ffffff', 12);
      });
      this.saveGame();
    }
    this.updateUI();
  }

  sellAll() {
    sound.ensureContext();
    const total = this.sellTotal();
    if (total <= 0) {
      sound.playClick();
      this.addFloatingText(this.canvas.width / 2, this.canvas.height / 2, 'НЕЧЕГО ПРОДАВАТЬ!', '#ff4d4d');
      return;
    }
    this.coins += total;
    Object.keys(CROPS).forEach((id) => (this.inventory[id] = 0));
    sound.playSell();
    this.addFloatingText(this.canvas.width / 2, this.canvas.height / 2 - 40, `+💰${total}`, '#ffde59', 20);
    this.spawnHarvestParticles(this.canvas.width / 2, this.canvas.height / 2 - 40);
    this.updateUI();
    this.saveGame();
  }

  selectCrop(id) {
    sound.ensureContext();
    const crop = CROPS[id];
    if (this.level < crop.levelReq) {
      sound.playClick();
      this.addFloatingText(this.canvas.width / 2, this.canvas.height / 2, `НУЖЕН УРОВЕНЬ ${crop.levelReq}`, '#ff4d4d');
      return;
    }
    this.selectedCrop = id;
    sound.playClick();
    this.updateUI();
  }

  buyUpgrade(id) {
    const u = UPGRADES[id];
    if (this.upgrades[id] >= u.maxLevel) return;
    const cost = this.upgradeCost(id);
    if (this.coins < cost) {
      sound.playClick();
      return;
    }
    this.coins -= cost;
    this.upgrades[id] += 1;
    sound.playUnlock();
    this.updateUI();
    this.saveGame();
  }

  // ---------- ИНТЕРФЕЙС (HTML) ----------
  buildSeedBar() {
    const bar = document.getElementById('seedBar');
    bar.innerHTML = '';
    Object.values(CROPS).forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'seed-btn';
      btn.dataset.crop = c.id;
      btn.innerHTML = `<span class="seed-icon">${c.icon}</span><span class="seed-info"></span>`;
      btn.addEventListener('click', () => this.selectCrop(c.id));
      bar.appendChild(btn);
    });
  }

  setupUI() {
    document.getElementById('sellBtn').addEventListener('click', () => this.sellAll());

    const modal = document.getElementById('shopModal');
    const openShop = () => {
      sound.ensureContext();
      sound.playClick();
      this._shopKey = '';
      modal.classList.remove('hidden');
      this.renderShop();
    };
    const closeShop = () => modal.classList.add('hidden');

    document.getElementById('shopBtn').addEventListener('click', openShop);
    document.getElementById('shopClose').addEventListener('click', closeShop);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeShop();
    });
    document.getElementById('upgradeList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-up]');
      if (btn && !btn.disabled) this.buyUpgrade(btn.dataset.up);
    });

    this.updateUI();
  }

  renderShop() {
    const modal = document.getElementById('shopModal');
    if (modal.classList.contains('hidden')) return;

    // Перерисовываем только если что-то изменилось, чтобы не сбивать нажатия
    const key = JSON.stringify([this.coins, this.upgrades]);
    if (key === this._shopKey) return;
    this._shopKey = key;

    document.getElementById('upgradeList').innerHTML = Object.values(UPGRADES)
      .map((u) => {
        const lvl = this.upgrades[u.id];
        const max = lvl >= u.maxLevel;
        const cost = this.upgradeCost(u.id);
        const can = !max && this.coins >= cost;
        return `
          <div class="up-card">
            <div class="up-icon">${u.icon}</div>
            <div class="up-body">
              <div class="up-name">${u.name}</div>
              <div class="up-desc">${u.description}</div>
              <div class="up-lvl">Уровень ${lvl} из ${u.maxLevel}</div>
              <div class="up-effect">${this.effectText(u.id)}</div>
            </div>
            <button class="pixel-btn up-buy ${can ? 'can' : ''}" data-up="${u.id}" ${max ? 'disabled' : ''}>
              ${max ? 'МАКС' : '💰' + cost}
            </button>
          </div>`;
      })
      .join('');
  }

  updateUI() {
    const lvl = this.level;
    let totalCrops = 0;
    Object.values(CROPS).forEach((c) => (totalCrops += this.inventory[c.id]));
    const sellValue = this.sellTotal();

    document.getElementById('coinsVal').textContent = this.coins;
    document.getElementById('cropCountVal').textContent = totalCrops;
    document.getElementById('levelVal').textContent = lvl;
    document.getElementById('sellBtn').textContent = sellValue > 0 ? `💰 ПРОДАТЬ +${sellValue}` : '💰 ПРОДАТЬ';

    // Полоска опыта
    let pct = 100;
    if (lvl < MAX_LEVEL) {
      const from = LEVEL_XP[lvl];
      const to = LEVEL_XP[lvl + 1];
      pct = Math.round(((this.xp - from) / (to - from)) * 100);
    }
    document.getElementById('xpFill').style.width = `${Math.max(0, Math.min(100, pct))}%`;

    // Панель семян
    document.querySelectorAll('.seed-btn').forEach((btn) => {
      const c = CROPS[btn.dataset.crop];
      const locked = lvl < c.levelReq;
      btn.classList.toggle('locked', locked);
      btn.classList.toggle('selected', !locked && this.selectedCrop === c.id);
      btn.classList.toggle('poor', !locked && this.coins < c.seedCost);
      btn.querySelector('.seed-info').textContent = locked ? `УР.${c.levelReq}` : `💰${c.seedCost}`;
    });

    // Кнопка магазина мигает, когда есть что купить
    const canBuy = Object.values(UPGRADES).some(
      (u) => this.upgrades[u.id] < u.maxLevel && this.coins >= this.upgradeCost(u.id)
    );
    document.getElementById('shopBtn').classList.toggle('alert', canBuy);

    document.getElementById('hint').style.display = this.tutorialDone ? 'none' : '';
    this.renderShop();
  }

  // ---------- СОХРАНЕНИЕ ----------
  saveGame() {
    sdk.saveData({
      v: SAVE_VERSION,
      coins: this.coins,
      xp: this.xp,
      inventory: this.inventory,
      upgrades: this.upgrades,
      selectedCrop: this.selectedCrop,
      tutorialDone: this.tutorialDone,
      plots: this.plots.map((p) => ({
        id: p.id,
        unlocked: p.unlocked,
        crop: p.crop,
        state: p.state,
        plantedAt: p.plantedAt,
      })),
    });
  }

  async loadSave() {
    const saved = await sdk.loadData();
    if (!saved) return;

    if (typeof saved.coins === 'number') this.coins = saved.coins;

    if (saved.v === SAVE_VERSION) {
      if (typeof saved.xp === 'number') this.xp = saved.xp;
      if (saved.inventory) {
        Object.keys(CROPS).forEach((id) => {
          if (typeof saved.inventory[id] === 'number') this.inventory[id] = saved.inventory[id];
        });
      }
      if (saved.upgrades) {
        Object.keys(UPGRADES).forEach((id) => {
          if (typeof saved.upgrades[id] === 'number') {
            this.upgrades[id] = Math.max(0, Math.min(UPGRADES[id].maxLevel, saved.upgrades[id]));
          }
        });
      }
      this.tutorialDone = !!saved.tutorialDone;
      if (Array.isArray(saved.plots)) {
        saved.plots.forEach((sp) => {
          const p = this.plots.find((pl) => pl.id === sp.id);
          if (!p) return;
          p.unlocked = p.unlocked || !!sp.unlocked;
          if (sp.state !== 'empty' && CROPS[sp.crop]) {
            p.state = sp.state;
            p.crop = sp.crop;
            p.plantedAt = sp.plantedAt;
          }
        });
      }
      const sel = CROPS[saved.selectedCrop];
      if (sel && this.level >= sel.levelReq) this.selectedCrop = sel.id;
    } else if (typeof saved.wheatInventory === 'number') {
      this.inventory.wheat = saved.wheatInventory;
      this.tutorialDone = true;
    }

    this.updateUI();
    this.resize();
  }

  // ---------- ЭФФЕКТЫ ----------
  addFloatingText(x, y, text, color = '#fff', size = 12) {
    this.floatingTexts.push({ x, y, text, color, size, alpha: 1, vy: -1.0, life: 0 });
  }

  spawnDirtParticles(x, y) {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        color: Math.random() > 0.5 ? '#5c3c24' : '#855832',
        size: 3 + Math.floor(Math.random() * 3),
        alpha: 1,
      });
    }
  }

  spawnHarvestParticles(x, y) {
    const colors = ['#f4d03f', '#e67e22', '#7bed9f', '#ffffff'];
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.floor(Math.random() * 3),
        alpha: 1,
      });
    }
  }

  // ---------- ЦИКЛ ----------
  loop(currentTime) {
    const dt = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;
    this.update(dt);
    this.render();
    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    const now = Date.now();
    const delay = this.autoDelay();

    this.plots.forEach((plot) => {
      if (plot.state === 'growing') {
        const crop = CROPS[plot.crop];
        if ((now - plot.plantedAt) / 1000 >= this.growTimeOf(crop)) {
          plot.state = 'ripe';
          plot.ripeAt = now;
          sound.playTone(520, 'sine', 0.08, 0.08);
        }
      } else if (plot.state === 'ripe' && delay !== null) {
        // Автосбор
        if (!plot.ripeAt) {
          plot.ripeAt = now;
        } else if (now - plot.ripeAt >= delay * 1000) {
          const { px, py } = this.plotPos(plot);
          this.harvestPlot(plot, px + this.tile / 2, py + this.tile / 2, true);
        }
      }
    });

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.life += dt;
      if (ft.life > 0.8) ft.alpha -= dt * 1.5;
      if (ft.alpha <= 0) this.floatingTexts.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.alpha -= dt * 1.5;
      if (p.alpha <= 0) this.particles.splice(i, 1);
    }
  }

  // ---------- ОТРИСОВКА ----------
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBackground();

    const k = this.tile / BASE;
    this.plots.forEach((plot) => {
      const { px, py } = this.plotPos(plot);
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(k, k);
      this.drawPlot(plot, this.hoveredPlot === plot);
      ctx.restore();
    });

    this.particles.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      ctx.restore();
    });

    this.floatingTexts.forEach((ft) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.font = `${ft.size}px 'Press Start 2P', ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#000000';
      ctx.fillText(ft.text, Math.round(ft.x) + 2, Math.round(ft.y) + 2);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, Math.round(ft.x), Math.round(ft.y));
      ctx.restore();
    });
  }

  drawBackground() {
    const ctx = this.ctx;
    ctx.fillStyle = '#6eb767';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = '#83c57d';
    const step = 36;
    for (let x = 0; x < this.canvas.width; x += step) {
      for (let y = 0; y < this.canvas.height; y += step) {
        if ((x + y) % 72 === 0) {
          ctx.fillRect(x + 6, y + 6, 4, 3);
          ctx.fillRect(x + 10, y + 9, 3, 4);
        }
      }
    }

    const flowerStep = 120;
    for (let fx = 20; fx < this.canvas.width; fx += flowerStep) {
      for (let fy = 20; fy < this.canvas.height; fy += flowerStep) {
        const x = fx + ((fx * 17) % 60);
        const y = fy + ((fy * 23) % 60);
        if ((fx + fy) % 240 === 0) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x - 2, y, 6, 2);
          ctx.fillRect(x, y - 2, 2, 6);
          ctx.fillStyle = '#ffd166';
          ctx.fillRect(x, y, 2, 2);
        } else if ((fx + fy) % 180 === 0) {
          ctx.fillStyle = '#70a1ff';
          ctx.fillRect(x - 1, y - 1, 4, 4);
          ctx.fillStyle = '#fff9db';
          ctx.fillRect(x, y, 2, 2);
        }
      }
    }
  }

  // Рисует одну грядку в координатах 96x96 (масштаб задаётся снаружи)
  drawPlot(plot, hovered) {
    const ctx = this.ctx;
    const S = BASE;
    const cx = S / 2;
    const cy = S / 2;
    const now = Date.now();

    ctx.fillStyle = '#5c381e';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#8d5b36';
    ctx.fillRect(3, 3, S - 6, S - 6);
    ctx.fillStyle = '#b0784a';
    ctx.fillRect(3, 3, S - 6, 3);
    ctx.fillStyle = '#9c6644';
    ctx.fillRect(7, 7, S - 14, S - 14);

    ctx.fillStyle = '#7f4f24';
    for (let ry = 12; ry < S - 14; ry += 13) {
      ctx.fillRect(9, ry, S - 18, 4);
      ctx.fillStyle = '#b08968';
      ctx.fillRect(14, ry - 3, 4, 3);
      ctx.fillRect(S - 26, ry - 3, 5, 3);
      ctx.fillStyle = '#7f4f24';
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // --- Закрытая грядка ---
    if (!plot.unlocked) {
      ctx.fillStyle = 'rgba(25, 15, 8, 0.55)';
      ctx.fillRect(0, 0, S, S);

      if (this.coins >= plot.cost) {
        ctx.strokeStyle = `rgba(255, 209, 102, ${0.6 + 0.4 * Math.sin(now / 250)})`;
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, S - 4, S - 4);
      }

      ctx.font = `30px ${EMOJI_FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('🔒', cx, 34);

      ctx.fillStyle = '#000000';
      ctx.fillRect(8, 56, S - 16, 26);
      ctx.fillStyle = '#fff8e7';
      ctx.fillRect(10, 58, S - 20, 22);
      ctx.font = `9px 'Press Start 2P', ${EMOJI_FONT}`;
      ctx.fillStyle = this.coins >= plot.cost ? '#27ae60' : '#d48b00';
      ctx.fillText(`💰${plot.cost}`, cx, 70);
      if (hovered) this.hoverFrame();
      return;
    }

    if (hovered) this.hoverFrame();

    // --- Пустая: показываем выбранные семена ---
    if (plot.state === 'empty') {
      const crop = CROPS[this.selectedCrop];
      const can = this.coins >= crop.seedCost;
      ctx.globalAlpha = can ? 0.55 + 0.25 * Math.sin(now / 300) : 0.2;
      ctx.font = `36px ${EMOJI_FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(crop.icon, cx, cy + 2);
      ctx.globalAlpha = 1;
      return;
    }

    const crop = CROPS[plot.crop];

    // --- Растёт ---
    if (plot.state === 'growing') {
      const progress = Math.min(1, (now - plot.plantedAt) / 1000 / this.growTimeOf(crop));
      if (progress < 0.5) this.drawPixelSprout(cx, cy - 4);
      else this.drawPixelMidWheat(cx, cy - 4);

      const barW = S - 28;
      ctx.fillStyle = '#000000';
      ctx.fillRect(13, 77, barW + 2, 8);
      ctx.fillStyle = '#7bed9f';
      ctx.fillRect(14, 78, Math.round(barW * progress), 6);
      return;
    }

    // --- Созрела ---
    if (plot.state === 'ripe') {
      const bob = Math.round(Math.sin(now / 140) * 3);
      if (crop.id === 'wheat') {
        this.drawPixelRipeWheat(cx, cy + 12 + bob);
      } else {
        ctx.font = `42px ${EMOJI_FONT}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(crop.icon, cx, cy + 12 + bob);
      }

      ctx.fillStyle = '#000000';
      ctx.fillRect(cx - 22, 4, 44, 26);
      ctx.fillStyle = '#2ed573';
      ctx.fillRect(cx - 20, 6, 40, 22);
      ctx.fillStyle = '#7bed9f';
      ctx.fillRect(cx - 20, 6, 40, 3);
      ctx.font = `16px ${EMOJI_FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(crop.icon, cx, 19);
    }
  }

  hoverFrame() {
    this.ctx.strokeStyle = '#fff3b0';
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(2, 2, BASE - 4, BASE - 4);
  }

  // ---------- СПРАЙТЫ ----------
  drawPixelSprout(cx, cy) {
    const px = Math.round(cx);
    const py = Math.round(cy);
    this.ctx.fillStyle = '#2d6a4f';
    this.ctx.fillRect(px - 2, py - 4, 4, 12);
    this.ctx.fillStyle = '#52b788';
    this.ctx.fillRect(px - 10, py - 6, 8, 4);
    this.ctx.fillRect(px - 8, py - 10, 6, 4);
    this.ctx.fillRect(px + 2, py - 8, 8, 4);
    this.ctx.fillRect(px + 4, py - 12, 6, 4);
  }

  drawPixelMidWheat(cx, cy) {
    const px = Math.round(cx);
    const py = Math.round(cy);
    this.ctx.fillStyle = '#40916c';
    this.ctx.fillRect(px - 2, py - 14, 4, 22);
    this.ctx.fillStyle = '#74c69d';
    this.ctx.fillRect(px - 12, py - 6, 10, 4);
    this.ctx.fillRect(px + 2, py - 10, 10, 4);
    this.ctx.fillStyle = '#d8f3dc';
    this.ctx.fillRect(px - 4, py - 20, 8, 6);
  }

  drawPixelRipeWheat(cx, cy) {
    const px = Math.round(cx);
    const py = Math.round(cy);
    this.ctx.fillStyle = '#b7791f';
    this.ctx.fillRect(px - 3, py - 8, 6, 20);
    this.ctx.fillStyle = '#f6e05e';
    this.ctx.fillRect(px - 8, py - 22, 16, 14);
    this.ctx.fillStyle = '#ecc94b';
    this.ctx.fillRect(px - 6, py - 26, 12, 6);
    this.ctx.fillRect(px - 10, py - 14, 20, 6);
    this.ctx.fillStyle = '#fefcbf';
    this.ctx.fillRect(px - 4, py - 24, 4, 4);
    this.ctx.fillRect(px + 2, py - 18, 4, 4);
    this.ctx.fillRect(px - 6, py - 12, 4, 4);
    this.ctx.fillStyle = '#744210';
    this.ctx.fillRect(px - 9, py - 23, 2, 12);
    this.ctx.fillRect(px + 7, py - 23, 2, 12);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.pixelFarm = new PixelFarm();
});