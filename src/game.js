import { sound } from './audio.js';
import { sdk } from './sdk.js';
import { CROPS, START_PLOTS, PLOT_COSTS, GOLDEN_COSTS, PLOT_UPGRADE_BASE, PLOT_UPGRADE_MULT, NEIGHBOR_BONUS, GROW_SCALE, BUILDINGS, BUILDING_SETTINGS, UPGRADES } from './data.js';

// Опыт, нужный для каждого уровня (индекс = уровень)
// Опыт = число собранных урожаев. Нужно для каждого уровня (индекс = уровень)
const LEVEL_XP = [0, 0, 8, 16, 24, 33, 43, 140, 280, 480, 760, 1150];
const MAX_LEVEL = LEVEL_XP.length - 1;
const GRID = 6;       // поле 6x6 (грядки и здания)
const BASE = 96;      // базовый размер грядки при рисовании (дальше масштабируется)
const SAVE_VERSION = 3;
const GROW_TAP_MAX = 2; // сколько раз за один рост тап по ростку приносит монету
const EMOJI_FONT = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";

// Быстрые цели. stat — что считаем (накопительно за всё время), target — сколько нужно, reward — монеты
const QUESTS = [
  { stat: 'harvested', target: 10, reward: 20, text: 'Собери 10 урожаев' },
  { stat: 'earned', target: 100, reward: 30, text: 'Заработай 100 монет' },
  { stat: 'plots', target: 1, reward: 40, text: 'Купи 1 грядку' },
  { stat: 'harvested', target: 30, reward: 60, text: 'Собери 30 урожаев' },
  { stat: 'upgrades', target: 1, reward: 80, text: 'Купи улучшение' },
  { stat: 'earned', target: 600, reward: 120, text: 'Заработай 600 монет' },
  { stat: 'harvested', target: 80, reward: 200, text: 'Собери 80 урожаев' },
  { stat: 'plots', target: 4, reward: 250, text: 'Купи 4 грядки' },
  { stat: 'earned', target: 3000, reward: 500, text: 'Заработай 3000 монет' },
  { stat: 'harvested', target: 200, reward: 800, text: 'Собери 200 урожаев' },
  { stat: 'upgrades', target: 6, reward: 1200, text: 'Купи 6 улучшений' },
  { stat: 'earned', target: 20000, reward: 3000, text: 'Заработай 20000 монет' },
];

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
    this.stats = { harvested: 0, planted: 0, earned: 0, upgrades: 0, plots: 0 };
    this.questIndex = 0;
    this.lastDaily = '';
    this.streak = 0;
    this.offlineGains = {};
    this.awaySeconds = 0;
    this.flyers = [];
    this.popupQueue = [];
    this._popupCb = null;

    this.plots = START_PLOTS.map((p) => ({
      x: p.x,
      y: p.y,
      crop: null,
      state: 'empty', // 'empty' | 'growing' | 'ripe'
      plantedAt: 0,
      ripeAt: 0,
      premium: false,
      upgraded: false,
      lastCrop: null,
    }));
    this.placing = false; // режим выбора места для новой грядки ('regular' или 'golden')
    this.upgrading = false; // режим выбора грядки для улучшения
    this.buildings = []; // здания: { id, x, y, t, ... }
    this.bee = null; // пчела с пасеки
    this.valueLog = []; // стоимость собранного урожая (для расчёта дохода)

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
  growTimeOf(crop, plot) {
    const bonus = plot ? this.neighborBonus(plot) : 0;
    return (crop.growTime * GROW_SCALE) / (1 + UPGRADES.speed.effectPerLevel * this.upgrades.speed + bonus);
  }

  // Каждая золотая грядка рядом ускоряет рост на этой грядке
  neighborBonus(plot) {
    let n = 0;
    this.plots.forEach((o) => {
      if (o.premium && Math.abs(o.x - plot.x) + Math.abs(o.y - plot.y) === 1) n += 1;
    });
    return n * NEIGHBOR_BONUS;
  }

  plotTier(plot) {
    return plot.premium ? 2 : plot.upgraded ? 1 : 0;
  }

  // На обычную грядку сажаются обычные культуры, на улучшенную особые (тыква, виноград),
  // на золотую мифические плоды. Пока своих культур у ступени ещё нет (не хватает уровня),
  // можно сажать культуры ниже ступенью, чтобы грядка не простаивала.
  canPlant(plot, crop) {
    if (this.level < crop.levelReq) return false;
    const tier = this.plotTier(plot);
    const ct = crop.tier || 0;
    if (ct === tier) return true;
    const hasOwn = Object.values(CROPS).some((c) => (c.tier || 0) === tier && this.level >= c.levelReq);
    return !hasOwn && ct < tier;
  }

  // Что сажать на золотой грядке автоматически
  autoCropFor(plot) {
    const last = plot.lastCrop && CROPS[plot.lastCrop];
    if (last && this.canPlant(plot, last)) return last;
    const list = Object.values(CROPS).filter((c) => this.canPlant(plot, c));
    return list.length ? list.reduce((a, c) => (c.sellPrice > a.sellPrice ? c : a)) : null;
  }

  fmt(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : `${n}`;
  }

  priceOf(crop) {
    const barn = this.hasBuilding('barn') ? 1 + BUILDING_SETTINGS.barnBonus : 1;
    return Math.round(crop.sellPrice * (1 + UPGRADES.value.effectPerLevel * this.upgrades.value) * barn);
  }

  hasBuilding(id) {
    return this.buildings.some((b) => b.id === id);
  }

  getBuilding(id) {
    return this.buildings.find((b) => b.id === id) || null;
  }

  // Сколько урожая зарезервировано под заказы лавки
  reservedFor(id) {
    const shop = this.getBuilding('shop');
    return shop ? shop.orders.filter((o) => o.crop === id).reduce((a, o) => a + o.qty, 0) : 0;
  }

  sellable(id) {
    return Math.max(0, this.inventory[id] - this.reservedFor(id));
  }

  // Средний доход от сбора урожая за последнюю минуту (монет в секунду)
  incomePerSec() {
    const from = Date.now() - 60000;
    this.valueLog = this.valueLog.filter((e) => e.t >= from);
    return this.valueLog.reduce((a, e) => a + e.v, 0) / 60;
  }

  // Яйцо стоит несколько секунд твоего дохода (см. eggSeconds), но не меньше трёх пшениц
  eggValue() {
    return Math.max(3 * this.priceOf(CROPS.wheat), Math.round(this.incomePerSec() * BUILDING_SETTINGS.eggSeconds));
  }

  bestCrop() {
    return Object.values(CROPS)
      .filter((c) => c.levelReq <= this.level)
      .reduce((a, c) => (c.sellPrice > a.sellPrice ? c : a));
  }

  sellTotal() {
    let total = 0;
    Object.values(CROPS).forEach((c) => {
      total += this.sellable(c.id) * this.priceOf(c);
    });
    return total;
  }

  autoDelay() {
    const lvl = this.upgrades.autoHarvest;
    return lvl > 0 ? UPGRADES.autoHarvest.delays[lvl] : null;
  }

  regularCount() {
    return this.plots.filter((p) => !p.premium).length;
  }

  goldenCount() {
    return this.plots.filter((p) => p.premium).length;
  }

  nextRegularCost() {
    const i = this.regularCount() - START_PLOTS.length;
    return i >= 0 && i < PLOT_COSTS.length ? PLOT_COSTS[i] : null;
  }

  nextGoldenCost() {
    const i = this.goldenCount();
    return i < GOLDEN_COSTS.length ? GOLDEN_COSTS[i] : null;
  }

  nextPlotCost(type) {
    return type === 'golden' ? this.nextGoldenCost() : this.nextRegularCost();
  }

  // Свободные клетки, которые касаются уже купленных грядок
  plotSlots() {
    const slots = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (this.plots.some((p) => p.x === x && p.y === y) || this.buildings.some((b) => b.x === x && b.y === y)) continue;
        if (this.plots.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) === 1)) slots.push({ x, y });
      }
    }
    return slots;
  }

  closeShop() {
    document.getElementById('shopModal').classList.add('hidden');
  }

  startPlacing(type) {
    const cost = this.nextPlotCost(type);
    if (cost === null || this.plotSlots().length === 0) return;
    if (this.coins < cost) {
      sound.playClick();
      return;
    }
    sound.playClick();
    this.closeShop();
    this.placing = type;
    this.upgrading = false;
    this.updateUI();
    this.resize();
  }

  cancelPlacing() {
    this.placing = false;
    this.upgrading = false;
    sound.playClick();
    this.updateUI();
    this.resize();
  }

  // После постановки грядки остаёмся в режиме, пока хватает монет и есть куда ставить
  keepPlacing(type) {
    const cost = this.nextPlotCost(type);
    const hasSlots = this.plotSlots().length > 0;
    if (cost !== null && hasSlots && this.coins >= cost) return;
    this.placing = false;
    if (cost !== null && hasSlots) {
      this.addFloatingText(this.canvas.width / 2, this.canvas.height / 2, 'НЕТ МОНЕТ!', '#ff4d4d', 14);
    }
  }

  // То же для улучшения грядок
  keepUpgrading() {
    const left = this.plots.some((p) => this.canUpgrade(p));
    if (left && this.coins >= this.plotUpgradeCost()) return;
    this.upgrading = false;
    if (left) this.addFloatingText(this.canvas.width / 2, this.canvas.height / 2, 'НЕТ МОНЕТ!', '#ff4d4d', 14);
  }

  placePlot(x, y) {
    const type = this.placing;
    if (typeof type === 'string' && type.startsWith('building:')) {
      this.placeBuilding(x, y);
      return;
    }
    const cost = this.nextPlotCost(type);
    if (cost === null || this.coins < cost) return;
    this.coins -= cost;
    this.plots.push({ x, y, crop: null, state: 'empty', plantedAt: 0, ripeAt: 0, premium: type === 'golden', upgraded: false, lastCrop: null });
    this.stats.plots += 1;
    this.keepPlacing(type);
    const { px, py } = this.plotPos({ x, y });
    this.addFloatingText(px + this.tile / 2, py + this.tile / 2, 'НОВАЯ ГРЯДКА!', '#7bed9f');
    this.spawnHarvestParticles(px + this.tile / 2, py + this.tile / 2);
    this.buzz(30);
    sound.playUnlock();
    this.updateUI();
    this.resize();
    this.saveGame();
  }

  // ---------- ЗДАНИЯ ----------
  startPlacingBuilding(id) {
    const def = BUILDINGS[id];
    if (!def || this.hasBuilding(id) || this.level < def.levelReq || this.plotSlots().length === 0) return;
    if (this.coins < def.cost) {
      sound.playClick();
      return;
    }
    sound.playClick();
    this.closeShop();
    this.placing = `building:${id}`;
    this.upgrading = false;
    this.updateUI();
    this.resize();
  }

  placeBuilding(x, y) {
    const id = String(this.placing).slice('building:'.length);
    const def = BUILDINGS[id];
    if (!def || this.hasBuilding(id) || this.coins < def.cost) return;
    this.coins -= def.cost;
    const b = { id, x, y, t: 0 };
    if (id === 'coop') {
      b.eggs = 0;
      b.made = 0; // сколько яиц уже снесено
      b.goldenAt = 1 + Math.floor(Math.random() * BUILDING_SETTINGS.goldenEggWithin); // номер золотого яйца
      b.goldenReady = false;
      b.goldenDone = false;
    }
    if (id === 'shop') b.orders = [];
    this.buildings.push(b);
    this.placing = false;
    const { px, py } = this.plotPos({ x, y });
    this.addFloatingText(px + this.tile / 2, py + this.tile / 2, 'ПОСТРОЕНО!', '#7bed9f');
    this.spawnHarvestParticles(px + this.tile / 2, py + this.tile / 2);
    this.buzz(30);
    sound.playUnlock();
    this.updateUI();
    this.resize();
    this.saveGame();
  }

  newOrder() {
    const maxTier = Math.max(...this.plots.map((p) => this.plotTier(p)));
    const S = BUILDING_SETTINGS;
    const all = Object.values(CROPS)
      .filter((c) => c.levelReq <= this.level && (c.tier || 0) <= maxTier)
      .sort((a, b) => a.sellPrice - b.sellPrice);
    const pool = all.slice(-S.orderPool); // самые дорогие из доступных
    const crop = pool[Math.floor(Math.random() * pool.length)];
    const qty = S.orderQtyMin + Math.floor(Math.random() * (S.orderQtyMax - S.orderQtyMin + 1));
    return { crop: crop.id, qty, reward: Math.round(qty * this.priceOf(crop) * BUILDING_SETTINGS.orderBonus) };
  }

  onBuildingClick(b, cx, cy) {
    sound.ensureContext();
    const def = BUILDINGS[b.id];
    if (b.id === 'coop') {
      if (b.eggs > 0) {
        const golden = b.goldenReady;
        const reward = b.eggs * this.eggValue() + (golden ? BUILDING_SETTINGS.goldenEggBonus : 0);
        if (golden) {
          b.goldenReady = false;
          b.goldenDone = true;
          sound.playUnlock();
          this.addFloatingText(cx, cy - 24, 'ЗОЛОТОЕ ЯЙЦО!', '#ffd23f', 12);
          this.spawnHarvestParticles(cx, cy);
          this.spawnHarvestParticles(cx, cy);
        }
        this.coins += reward;
        this.stats.earned += reward;
        b.eggs = 0;
        sound.playSell();
        this.buzz(20);
        this.addFloatingText(cx, cy, `+💰${reward}`, '#ffde59');
        this.flyItem(cx, cy, '💰', 'coinsVal', 5);
        this.updateUI();
      } else {
        sound.playClick();
        this.addFloatingText(cx, cy, 'ЯЙЦА СКОРО', '#ffffff', 10);
      }
      return;
    }
    if (b.id === 'shop') {
      const o = b.orders.find((x) => this.inventory[x.crop] >= x.qty);
      if (o) {
        this.inventory[o.crop] -= o.qty;
        b.orders.splice(b.orders.indexOf(o), 1);
        this.coins += o.reward;
        this.stats.earned += o.reward;
        sound.playSell();
        this.buzz(25);
        this.addFloatingText(cx, cy, `ЗАКАЗ! +💰${o.reward}`, '#ffde59', 11);
        this.flyItem(cx, cy, '💰', 'coinsVal', 6);
        this.updateUI();
      } else if (b.orders.length > 0) {
        const f = b.orders[0];
        sound.playClick();
        this.addFloatingText(cx, cy, `НУЖНО ${f.qty} ${CROPS[f.crop].icon}`, '#ffffff', 11);
      } else {
        sound.playClick();
        this.addFloatingText(cx, cy, 'ЗАКАЗОВ НЕТ', '#ffffff', 10);
      }
      return;
    }
    sound.playClick();
    this.addFloatingText(cx, cy, def.name.toUpperCase(), '#ffffff', 10);
  }

  spawnBee() {
    this.bee = { t: 0, dur: 7, x: -30, y: 0, y0: this.gridY + Math.random() * GRID * this.tile };
  }

  tapBee() {
    const boost = BUILDING_SETTINGS.beeBoost * 1000;
    this.plots.forEach((p) => {
      if (p.state === 'growing') p.plantedAt -= boost;
    });
    sound.playHarvest();
    this.buzz(25);
    this.addFloatingText(this.bee.x, this.bee.y, `РОСТ +${BUILDING_SETTINGS.beeBoost} с!`, '#ffde59', 11);
    this.spawnHarvestParticles(this.bee.x, this.bee.y);
    this.bee = null;
  }

  barnSell(b) {
    const total = this.sellTotal();
    if (total <= 0) return;
    this.coins += total;
    this.stats.earned += total;
    Object.keys(CROPS).forEach((id) => (this.inventory[id] -= this.sellable(id)));
    const { px, py } = this.plotPos(b);
    this.addFloatingText(px + this.tile / 2, py + this.tile / 2, `+💰${total}`, '#ffde59', 11);
    this.flyItem(px + this.tile / 2, py + this.tile / 2, '💰', 'coinsVal', 4);
    sound.playTone(880, 'triangle', 0.08, 0.08);
    this.updateUI();
  }

  updateBuildings(dt) {
    const S = BUILDING_SETTINGS;
    const step = Math.min(dt, 1);
    this.buildings.forEach((b) => {
      if (b.id === 'coop') {
        if (b.eggs < S.eggMax) {
          b.t += step;
          if (b.t >= S.eggInterval) {
            b.t = 0;
            b.eggs += 1;
            b.made = (b.made || 0) + 1;
            if (!b.goldenDone && !b.goldenReady && b.made === b.goldenAt) b.goldenReady = true;
          }
        }
      } else if (b.id === 'shop') {
        if (b.orders.length < S.orderMax) {
          b.t += step;
          if (b.t >= S.orderInterval) {
            b.t = 0;
            b.orders.push(this.newOrder());
            this.updateUI();
          }
        }
      } else if (b.id === 'apiary') {
        if (!this.bee) {
          b.t += step;
          if (b.t >= S.beeInterval) {
            b.t = 0;
            this.spawnBee();
          }
        }
      } else if (b.id === 'barn') {
        b.t += step;
        if (b.t >= S.barnInterval) {
          b.t = 0;
          this.barnSell(b);
        }
      }
    });
    if (this.bee) {
      this.bee.t += step;
      if (this.bee.t >= this.bee.dur) {
        this.bee = null;
      } else {
        this.bee.x = -30 + (this.canvas.width + 60) * (this.bee.t / this.bee.dur);
        this.bee.y = this.bee.y0 + Math.sin(this.bee.t * 3) * 30;
      }
    }
  }

  // Улучшение обычной грядки: можно сажать тыкву и виноград
  canUpgrade(plot) {
    return !plot.premium && !plot.upgraded;
  }

  plotUpgradeCost() {
    const n = this.plots.filter((p) => p.upgraded && !p.premium).length;
    return Math.round(PLOT_UPGRADE_BASE * Math.pow(PLOT_UPGRADE_MULT, n));
  }

  startUpgrading() {
    if (!this.plots.some((p) => this.canUpgrade(p))) return;
    if (this.coins < this.plotUpgradeCost()) {
      sound.playClick();
      return;
    }
    sound.playClick();
    this.closeShop();
    this.upgrading = true;
    this.placing = false;
    this.updateUI();
    this.resize();
  }

  upgradePlot(plot) {
    const cost = this.plotUpgradeCost();
    if (!this.canUpgrade(plot) || this.coins < cost) return;
    this.coins -= cost;
    plot.upgraded = true;
    this.stats.upgrades += 1;
    this.keepUpgrading();
    const { px, py } = this.plotPos(plot);
    this.addFloatingText(px + this.tile / 2, py + this.tile / 2, 'ГРЯДКА УЛУЧШЕНА!', '#9fd3ff', 10);
    this.spawnHarvestParticles(px + this.tile / 2, py + this.tile / 2);
    this.buzz(30);
    sound.playUnlock();
    this.updateUI();
    this.resize();
    this.saveGame();
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
    this.queuePopups();

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
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      if (this.placing) {
        for (const slot of this.plotSlots()) {
          const { px, py } = this.plotPos(slot);
          if (mx >= px && mx <= px + this.tile && my >= py && my <= py + this.tile) {
            this.placePlot(slot.x, slot.y);
            return;
          }
        }
        return;
      }
      if (this.upgrading) {
        const h = getPlotAtPos(mx, my);
        if (h && this.canUpgrade(h.plot)) this.upgradePlot(h.plot);
        return;
      }
      if (this.bee && Math.hypot(mx - this.bee.x, my - this.bee.y) < 36) {
        this.tapBee();
        return;
      }
      for (const b of this.buildings) {
        const { px, py } = this.plotPos(b);
        if (mx >= px && mx <= px + this.tile && my >= py && my <= py + this.tile) {
          this.onBuildingClick(b, px + this.tile / 2, py + this.tile / 2);
          return;
        }
      }
      const hit = getPlotAtPos(mx, my);
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
    // 2. Пустая грядка: посадка
    if (plot.state === 'empty') {
      const crop = CROPS[this.selectedCrop];
      if (!this.canPlant(plot, crop)) {
        const need = crop.tier || 0;
        const tier = this.plotTier(plot);
        let msg;
        if (need > tier) msg = need === 2 ? '⭐ ТОЛЬКО ЗОЛОТЫЕ' : 'НУЖНА УЛУЧШЕННАЯ';
        else msg = tier === 2 ? '⭐ ТУТ ТОЛЬКО МИФИЧЕСКИЕ' : 'ТУТ ТОЛЬКО ОСОБЫЕ';
        sound.playClick();
        this.addFloatingText(cx, cy, msg, '#ffde59', 9);
        return;
      }
      if (this.coins < crop.seedCost) {
        sound.playClick();
        this.addFloatingText(cx, cy, 'НЕТ МОНЕТ!', '#ff4d4d');
        return;
      }
      this.plantCrop(plot, crop, cx, cy, false);
      if (this.stats.planted <= 3) this.addFloatingText(cx, cy - 30, 'ТАПАЙ ПО РОСТКУ!', '#ffffff', 9);
      if (!this.tutorialDone) {
        this.tutorialDone = true;
        this.updateUI();
        this.resize();
      }
      return;
    }

    // 3. Созрело: сбор
    if (plot.state === 'ripe') {
      this.harvestPlot(plot, cx, cy, false);
      // Золотая грядка потом сама посадит выбранную сейчас культуру
      if (plot.premium && this.canPlant(plot, CROPS[this.selectedCrop])) plot.lastCrop = this.selectedCrop;
      return;
    }

    // 4. Растёт: первые тапы дают монеты, потом показываем, сколько осталось
    if (plot.state === 'growing') {
      if ((plot.taps || 0) < GROW_TAP_MAX) {
        plot.taps = (plot.taps || 0) + 1;
        const coin = this.level;
        this.coins += coin;
        this.stats.earned += coin;
        sound.playTone(760, 'triangle', 0.05, 0.08);
        this.addFloatingText(cx, cy, `+${coin} 💰`, '#ffde59', 11);
        this.flyItem(cx, cy, '💰', 'coinsVal', 1);
        this.updateUI();
        return;
      }
      const crop = CROPS[plot.crop];
      const left = Math.ceil(Math.max(0, this.growTimeOf(crop, plot) - (Date.now() - plot.plantedAt) / 1000));
      sound.playClick();
      this.addFloatingText(cx, cy, `ЕЩЁ ${left} с`, '#ffffff');
    }
  }

  plantCrop(plot, crop, cx, cy, auto) {
    this.coins -= crop.seedCost;
    plot.crop = crop.id;
    plot.lastCrop = crop.id;
    plot.state = 'growing';
    plot.plantedAt = Date.now();
    plot.ripeAt = 0;
    plot.taps = 0;
    this.stats.planted += 1;
    if (!auto) {
      sound.playPlant();
      this.addFloatingText(cx, cy, `-💰${crop.seedCost}`, '#ffde59');
      this.spawnDirtParticles(cx, cy);
    }
    this.updateUI();
  }

  harvestPlot(plot, cx, cy, auto) {
    const crop = CROPS[plot.crop];
    const levelBefore = this.level;
    plot.state = 'empty';
    plot.crop = null;
    plot.plantedAt = 0;
    plot.ripeAt = 0;
    const golden = this.hasBuilding('scarecrow') && Math.random() < BUILDING_SETTINGS.goldenChance;
    const amount = golden ? 5 : 1;
    this.inventory[crop.id] += amount;
    this.stats.harvested += 1;
    this.xp += 1;
    this.valueLog.push({ t: Date.now(), v: this.priceOf(crop) * amount });

    if (auto) {
      sound.playTone(700, 'sine', 0.05, 0.05);
      this.addFloatingText(cx, cy, `+${amount} ${crop.icon}`, golden ? '#ffd23f' : '#c8f7dc', 10);
    } else {
      sound.playHarvest();
      this.addFloatingText(cx, cy, `+${amount} ${crop.icon}`, golden ? '#ffd23f' : '#7bed9f');
      this.spawnHarvestParticles(cx, cy);
    }

    this.flyItem(cx, cy, crop.icon, 'cropCountVal', golden ? 5 : 1);
    if (golden) {
      sound.playUnlock();
      this.buzz(40);
      this.addFloatingText(cx, cy - 22, 'ЗОЛОТОЙ УРОЖАЙ ×5!', '#ffd23f', 12);
      this.spawnHarvestParticles(cx, cy);
      this.spawnHarvestParticles(cx, cy);
    }
    if (!auto) this.buzz(15);

    if (this.level > levelBefore) {
      this.buzz(40);
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
    this.stats.earned += total;
    Object.keys(CROPS).forEach((id) => (this.inventory[id] -= this.sellable(id)));
    this.flyItem(this.canvas.width / 2, this.canvas.height / 2 - 40, '💰', 'coinsVal', 8);
    this.buzz(25);
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
    this.stats.upgrades += 1;
    this.buzz(30);
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
    document.getElementById('placeCancel').addEventListener('click', () => this.cancelPlacing());
    document.getElementById('popupBtn').addEventListener('click', () => {
      const cb = this._popupCb;
      this._popupCb = null;
      this.hidePopup();
      if (cb) cb();
      this.nextPopup();
    });

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
      if (!btn || btn.disabled) return;
      const id = btn.dataset.up;
      if (id === 'plot') this.startPlacing('regular');
      else if (id === 'golden') this.startPlacing('golden');
      else if (id === 'plotup') this.startUpgrading();
      else if (id.startsWith('b:')) this.startPlacingBuilding(id.slice(2));
      else this.buyUpgrade(id);
    });

    this.updateUI();
  }

  renderShop() {
    const modal = document.getElementById('shopModal');
    if (modal.classList.contains('hidden')) return;

    // Перерисовываем только если что-то изменилось, чтобы не сбивать нажатия
    const key = JSON.stringify([this.coins, this.upgrades, this.plots.map((p) => this.plotTier(p)).join(''), this.buildings.length, this.level]);
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

    // Разделы с грядками
    const list = document.getElementById('upgradeList');
    const noSlots = this.plotSlots().length === 0;
    const regCost = this.nextRegularCost();
    const regMax = regCost === null || noSlots;
    const goldCost = this.nextGoldenCost();
    const goldMax = goldCost === null || noSlots;
    const upCost = this.plotUpgradeCost();
    const upgradedCount = this.plots.filter((p) => p.upgraded && !p.premium).length;
    const upLeft = this.plots.filter((p) => this.canUpgrade(p)).length;
    const bonusPct = Math.round(NEIGHBOR_BONUS * 100);

    const card = (icon, name, desc, info, id, can, off, label) => `
          <div class="up-card">
            <div class="up-icon">${icon}</div>
            <div class="up-body">
              <div class="up-name">${name}</div>
              <div class="up-desc">${desc}</div>
              <div class="up-lvl">${info}</div>
            </div>
            <button class="pixel-btn up-buy ${can ? 'can' : ''}" data-up="${id}" ${off ? 'disabled' : ''}>${label}</button>
          </div>`;

    const noBuildSlots = this.plotSlots().length === 0;
    const bCards = '<div class="shop-title">🏠 ПОСТРОЙКИ</div>' + Object.values(BUILDINGS).map((def) => {
      const built = this.hasBuilding(def.id);
      const locked = this.level < def.levelReq;
      const off = built || locked || noBuildSlots;
      const label = built ? 'ЕСТЬ' : locked ? `УР.${def.levelReq}` : '💰' + def.cost;
      return card(def.icon, def.name, def.desc, built ? 'Построено' : `Открывается с ${def.levelReq} уровня`, 'b:' + def.id,
        !off && this.coins >= def.cost, off, label);
    }).join('');

    list.insertAdjacentHTML('afterbegin',
      '<div class="shop-title">ГРЯДКИ</div>' +
      card('🟫', 'Новая грядка', 'Ставишь сам, рядом с уже имеющимися',
        `Обычных: ${this.regularCount()} из ${START_PLOTS.length + PLOT_COSTS.length}`,
        'plot', !regMax && this.coins >= regCost, regMax, regMax ? 'МАКС' : '💰' + regCost) +
      card('🔷', 'Улучшить грядку', 'Можно сажать тыкву и виноград',
        `Улучшено: ${upgradedCount} из ${this.regularCount()}`,
        'plotup', upLeft > 0 && this.coins >= upCost, upLeft === 0, upLeft === 0 ? 'МАКС' : '💰' + upCost) +
      '<div class="shop-title">⭐ ЗОЛОТЫЕ ГРЯДКИ</div>' +
      card('⭐', 'Золотая грядка', `Мифические плоды, сама сажает и собирает, +${bonusPct}% роста соседям`,
        `Золотых: ${this.goldenCount()} из ${GOLDEN_COSTS.length}`,
        'golden', !goldMax && this.coins >= goldCost, goldMax, goldMax ? 'МАКС' : '💰' + goldCost) +
      bCards +
      '<div class="shop-title">УЛУЧШЕНИЯ</div>');
  }

  updateUI() {
    this.checkQuests();
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

    // Быстрая цель
    const q = this.questAt(this.questIndex);
    const have = Math.min(this.stats[q.stat], q.target);
    document.getElementById('questText').textContent = q.text;
    document.getElementById('questReward').textContent = `+💰${q.reward}`;
    document.getElementById('questFill').style.width = `${Math.round((have / q.target) * 100)}%`;
    document.getElementById('questCount').textContent = `${have}/${q.target}`;

    // Панель семян
    document.querySelectorAll('.seed-btn').forEach((btn) => {
      const c = CROPS[btn.dataset.crop];
      const locked = lvl < c.levelReq;
      btn.classList.toggle('locked', locked);
      btn.classList.toggle('premium', c.tier === 2);
      btn.classList.toggle('special', c.tier === 1);
      btn.classList.toggle('selected', !locked && this.selectedCrop === c.id);
      btn.classList.toggle('poor', !locked && this.coins < c.seedCost);
      btn.querySelector('.seed-info').textContent = locked ? `УР.${c.levelReq}` : `💰${this.fmt(c.seedCost)}`;
    });

    // Кнопка магазина мигает, когда есть что купить
    const canBuy = Object.values(UPGRADES).some(
      (u) => this.upgrades[u.id] < u.maxLevel && this.coins >= this.upgradeCost(u.id)
    );
    const rc = this.nextRegularCost();
    const gc = this.nextGoldenCost();
    const hasSlot = this.plotSlots().length > 0;
    const canBuyPlot = hasSlot && ((rc !== null && this.coins >= rc) || (gc !== null && this.coins >= gc));
    const canUpPlot = this.plots.some((p) => this.canUpgrade(p)) && this.coins >= this.plotUpgradeCost();
    const canBuyBld = this.plotSlots().length > 0 && Object.values(BUILDINGS).some((d) => !this.hasBuilding(d.id) && this.level >= d.levelReq && this.coins >= d.cost);
    document.getElementById('shopBtn').classList.toggle('alert', canBuy || canBuyPlot || canUpPlot || canBuyBld);

    document.getElementById('hint').style.display = this.tutorialDone ? 'none' : '';
    document.getElementById('placeBanner').style.display = this.placing || this.upgrading ? '' : 'none';
    if (typeof this.placing === 'string' && this.placing.startsWith('building:')) {
      const d = BUILDINGS[this.placing.slice(9)];
      document.getElementById('placeText').textContent = `Выбери место: ${d.icon} ${d.name} (💰${d.cost})`;
    } else if (this.placing) {
      const c = this.nextPlotCost(this.placing);
      const what = this.placing === 'golden' ? '⭐ золотой грядки' : 'грядки';
      document.getElementById('placeText').textContent = `Выбери место для ${what} (💰${c})`;
    } else if (this.upgrading) {
      document.getElementById('placeText').textContent = `Выбери грядку для улучшения (💰${this.plotUpgradeCost()})`;
    }
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
      stats: this.stats,
      buildings: this.buildings,
      questIndex: this.questIndex,
      lastDaily: this.lastDaily,
      streak: this.streak,
      savedAt: Date.now(),
      selectedCrop: this.selectedCrop,
      tutorialDone: this.tutorialDone,
      plots: this.plots.map((p) => ({
        x: p.x,
        y: p.y,
        crop: p.crop,
        state: p.state,
        plantedAt: p.plantedAt,
        premium: p.premium,
        upgraded: p.upgraded,
        lastCrop: p.lastCrop,
      })),
    });
  }

  async loadSave() {
    const saved = await sdk.loadData();
    if (!saved) return;

    if (typeof saved.coins === 'number') this.coins = saved.coins;

    if (saved.v === 2 || saved.v === 3) {
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
      if (saved.stats) {
        Object.keys(this.stats).forEach((k) => {
          if (typeof saved.stats[k] === 'number') this.stats[k] = saved.stats[k];
        });
      }
      if (typeof saved.questIndex === 'number') this.questIndex = saved.questIndex;
      if (typeof saved.lastDaily === 'string') this.lastDaily = saved.lastDaily;
      if (typeof saved.streak === 'number') this.streak = saved.streak;
      if (typeof saved.savedAt === 'number') this.awaySeconds = (Date.now() - saved.savedAt) / 1000;
      if (Array.isArray(saved.buildings)) {
        saved.buildings.forEach((sb) => {
          const def = BUILDINGS[sb.id];
          if (!def || this.hasBuilding(sb.id) || !(sb.x >= 0 && sb.x < GRID && sb.y >= 0 && sb.y < GRID)) return;
          const b = { id: sb.id, x: sb.x, y: sb.y, t: 0 };
          if (sb.id === 'coop') {
            b.eggs = Math.min(BUILDING_SETTINGS.eggMax, sb.eggs || 0);
            b.made = sb.made || 0;
            b.goldenAt = sb.goldenAt || 1 + Math.floor(Math.random() * BUILDING_SETTINGS.goldenEggWithin);
            b.goldenReady = !!sb.goldenReady;
            b.goldenDone = !!sb.goldenDone;
          }
          if (sb.id === 'shop') {
            b.orders = Array.isArray(sb.orders) ? sb.orders.filter((o) => CROPS[o.crop]).slice(0, BUILDING_SETTINGS.orderMax) : [];
          }
          this.buildings.push(b);
        });
      }
      this.tutorialDone = !!saved.tutorialDone;
      if (Array.isArray(saved.plots)) {
        // Старые координаты грядок из версии 2 (по номеру)
        const OLD_POS = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2], [3, 0], [3, 1], [3, 2], [0, 3], [1, 3], [2, 3], [3, 3]];
        const loaded = [];
        saved.plots.forEach((sp) => {
          let x;
          let y;
          if (saved.v === 2) {
            if (!sp.unlocked || !OLD_POS[sp.id]) return;
            [x, y] = OLD_POS[sp.id];
          } else {
            x = sp.x;
            y = sp.y;
          }
          if (!(x >= 0 && x < GRID && y >= 0 && y < GRID)) return;
          if (loaded.some((l) => l.x === x && l.y === y)) return;
          const p = { x, y, crop: null, state: 'empty', plantedAt: 0, ripeAt: 0, premium: !!sp.premium, upgraded: !!sp.upgraded, lastCrop: CROPS[sp.lastCrop] ? sp.lastCrop : null };
          if (sp.state !== 'empty' && CROPS[sp.crop]) {
            p.state = sp.state;
            p.crop = sp.crop;
            p.plantedAt = sp.plantedAt;
            // Созрело, пока игрока не было
            if (sp.state === 'growing' && Date.now() - sp.plantedAt >= this.growTimeOf(CROPS[sp.crop]) * 1000) {
              this.offlineGains[sp.crop] = (this.offlineGains[sp.crop] || 0) + 1;
            }
          }
          loaded.push(p);
        });
        if (loaded.length > 0) this.plots = loaded;
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

  // ---------- ЦЕЛИ, ОКНА, ЭФФЕКТЫ ЭТАПА 4 ----------
  questAt(i) {
    if (i < QUESTS.length) return QUESTS[i];
    const n = i - QUESTS.length + 1;
    const target = 200 + 150 * n;
    return { stat: 'harvested', target, reward: 1500 * n, text: `Собери ${target} урожаев` };
  }

  checkQuests() {
    let guard = 0;
    while (guard++ < 10) {
      const q = this.questAt(this.questIndex);
      if (this.stats[q.stat] < q.target) break;
      this.questIndex += 1;
      this.coins += q.reward;
      sound.playUnlock();
      this.buzz(40);
      const cx = this.canvas.width / 2;
      const cy = this.canvas.height / 2;
      this.addFloatingText(cx, cy - 60, 'ЗАДАНИЕ ВЫПОЛНЕНО!', '#ffde59', 14);
      this.addFloatingText(cx, cy - 36, `+💰${q.reward}`, '#7bed9f', 14);
      this.flyItem(cx, cy - 40, '💰', 'coinsVal', 8);
    }
  }

  buzz(ms) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

  // Иконки летят к счётчику
  flyItem(x, y, icon, targetId, count = 1) {
    const el = document.getElementById(targetId);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const c = this.canvas.getBoundingClientRect();
    const tx = r.left + r.width / 2 - c.left;
    const ty = r.top + r.height / 2 - c.top;
    for (let i = 0; i < count; i++) {
      const sx = x + (Math.random() - 0.5) * 30;
      const sy = y + (Math.random() - 0.5) * 30;
      this.flyers.push({ x: sx, y: sy, sx, sy, tx, ty, t: -i * 0.06, icon, targetId });
    }
  }

  bump(targetId) {
    const el = document.getElementById(targetId);
    const box = el && el.closest('.hud-box');
    if (!box) return;
    box.classList.remove('bump');
    void box.offsetWidth;
    box.classList.add('bump');
  }

  dateKey(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  collectAllRipe() {
    let n = 0;
    this.plots.forEach((plot) => {
      if (plot.state === 'ripe') {
        const { px, py } = this.plotPos(plot);
        this.harvestPlot(plot, px + this.tile / 2, py + this.tile / 2, true);
        n += 1;
      }
    });
    if (n > 0) {
      sound.playHarvest();
      this.buzz(30);
    }
  }

  queuePopups() {
    // 1. Что созрело, пока игрока не было
    const gains = Object.entries(this.offlineGains);
    if (gains.length > 0 && this.awaySeconds >= 30) {
      const lines = gains.map(([id, n]) => `${CROPS[id].icon} × ${n}`).join('&nbsp;&nbsp;');
      this.popupQueue.push({
        title: 'С ВОЗВРАЩЕНИЕМ!',
        body: `Пока тебя не было, созрело:<div class="popup-big">${lines}</div>`,
        btn: 'ЗАБРАТЬ',
        cb: () => this.collectAllRipe(),
      });
    }

    // 2. Ежедневная награда (после первой посадки)
    if (this.tutorialDone) {
      const today = this.dateKey(0);
      if (this.lastDaily !== today) {
        const newStreak = this.lastDaily === this.dateKey(-1) ? this.streak + 1 : 1;
        const reward = Math.round(20 * Math.min(newStreak, 7) * (1 + 0.5 * (this.level - 1)));
        this.popupQueue.push({
          title: 'ПОДАРОК ДНЯ',
          body: `Серия: ${newStreak} дн.<div class="popup-big">+💰${reward}</div>Заходи каждый день: награда растёт!`,
          btn: 'ЗАБРАТЬ',
          cb: () => {
            this.lastDaily = today;
            this.streak = newStreak;
            this.coins += reward;
            this.flyItem(this.canvas.width / 2, this.canvas.height / 2, '💰', 'coinsVal', 8);
            sound.playSell();
            this.buzz(30);
            this.updateUI();
            this.saveGame();
          },
        });
      }
    }
    this.nextPopup();
  }

  nextPopup() {
    if (this.popupQueue.length === 0) return;
    const p = this.popupQueue.shift();
    this._popupCb = p.cb;
    document.getElementById('popupTitle').textContent = p.title;
    document.getElementById('popupBody').innerHTML = p.body;
    document.getElementById('popupBtn').textContent = p.btn;
    document.getElementById('popup').classList.remove('hidden');
  }

  hidePopup() {
    document.getElementById('popup').classList.add('hidden');
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
    this.updateBuildings(dt);

    this.plots.forEach((plot) => {
      if (plot.state === 'growing') {
        const crop = CROPS[plot.crop];
        if ((now - plot.plantedAt) / 1000 >= this.growTimeOf(crop, plot)) {
          plot.state = 'ripe';
          plot.ripeAt = now;
          sound.playTone(520, 'sine', 0.08, 0.08);
        }
      } else if (plot.state === 'ripe' && (delay !== null || plot.premium)) {
        // Автосбор
        if (!plot.ripeAt) {
          plot.ripeAt = now;
        } else if (now - plot.ripeAt >= (plot.premium ? 1000 : delay * 1000)) {
          const { px, py } = this.plotPos(plot);
          this.harvestPlot(plot, px + this.tile / 2, py + this.tile / 2, true);
        }
      } else if (plot.state === 'empty' && plot.premium && plot.lastCrop) {
        // Автопосадка на золотой грядке (семена платные)
        const crop = this.autoCropFor(plot);
        if (crop && this.coins >= crop.seedCost) {
          this.plantCrop(plot, crop, 0, 0, true);
        }
      }
    });

    for (let i = this.flyers.length - 1; i >= 0; i--) {
      const f = this.flyers[i];
      f.t += dt * 1.8;
      if (f.t >= 1) {
        this.bump(f.targetId);
        this.flyers.splice(i, 1);
        continue;
      }
      if (f.t > 0) {
        const e = f.t * f.t;
        f.x = f.sx + (f.tx - f.sx) * e;
        f.y = f.sy + (f.ty - f.sy) * e;
      }
    }

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

    this.buildings.forEach((b) => {
      const { px, py } = this.plotPos(b);
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(k, k);
      this.drawBuilding(b);
      ctx.restore();
    });

    if (this.placing) this.plotSlots().forEach((slot) => this.drawSlot(slot.x, slot.y));

    if (this.bee) {
      ctx.save();
      ctx.font = `30px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('🐝', Math.round(this.bee.x), Math.round(this.bee.y));
      ctx.restore();
    }

    this.particles.forEach((p) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      ctx.restore();
    });

    this.flyers.forEach((f) => {
      if (f.t < 0) return;
      ctx.save();
      ctx.font = `18px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(f.icon, Math.round(f.x), Math.round(f.y));
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

    // Золотая: золотая рамка и звезда. Улучшенная: синий ромб. Бонус соседа: зелёная стрелка.
    if (plot.premium) {
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, S - 4, S - 4);
      ctx.font = `14px ${EMOJI_FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('⭐', 14, 14);
    } else {
      if (plot.upgraded) {
        ctx.strokeStyle = '#9fd3ff';
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, S - 4, S - 4);
        ctx.font = `13px ${EMOJI_FONT}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText('🔷', 14, 14);
      }
      if (this.neighborBonus(plot) > 0) {
        ctx.font = "10px 'Press Start 2P', monospace";
        ctx.fillStyle = '#7bed9f';
        ctx.fillText('▲', S - 13, 14);
      }
      if (this.upgrading && !plot.upgraded) {
        ctx.strokeStyle = `rgba(159, 211, 255, ${0.5 + 0.5 * Math.sin(now / 250)})`;
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, S - 4, S - 4);
      }
    }

    if (hovered) this.hoverFrame();

    // --- Пустая: показываем выбранные семена ---
    if (plot.state === 'empty') {
      const crop = CROPS[this.selectedCrop];
      if (!this.canPlant(plot, crop)) return; // здесь этот плод сажать нельзя: не показываем
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
      const progress = Math.min(1, (now - plot.plantedAt) / 1000 / this.growTimeOf(crop, plot));
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

  drawBuilding(b) {
    const ctx = this.ctx;
    const S = BASE;
    const def = BUILDINGS[b.id];
    const now = Date.now();
    const SET = BUILDING_SETTINGS;

    ctx.fillStyle = '#5c381e';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#d9c7a0';
    ctx.fillRect(3, 3, S - 6, S - 6);
    ctx.fillStyle = '#e8dbb8';
    ctx.fillRect(3, 3, S - 6, 3);
    ctx.fillStyle = '#c9b389';
    ctx.fillRect(7, 7, S - 14, S - 14);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `46px ${EMOJI_FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(def.icon, S / 2, S / 2 - 4 + Math.round(Math.sin(now / 400) * 2));

    const pill = (text, color) => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(12, 66, S - 24, 22);
      ctx.fillStyle = color;
      ctx.fillRect(14, 68, S - 28, 18);
      ctx.font = `10px 'Press Start 2P', ${EMOJI_FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, S / 2, 78);
    };
    const bar = (frac, color) => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(13, 77, S - 26, 8);
      ctx.fillStyle = color;
      ctx.fillRect(14, 78, Math.round((S - 28) * Math.min(1, frac)), 6);
    };

    if (b.id === 'coop') {
      if (b.eggs > 0) pill(`${b.goldenReady ? '🌟' : '🥚'}×${b.eggs}`, b.goldenReady ? '#d4a017' : '#2ed573');
      else bar(b.t / SET.eggInterval, '#ffd23f');
    } else if (b.id === 'shop') {
      if (b.orders.length > 0) {
        const o = b.orders[0];
        const have = Math.min(this.inventory[o.crop], o.qty);
        pill(`${CROPS[o.crop].icon}${have}/${o.qty}`, have >= o.qty ? '#2ed573' : '#8c6239');
      }
    } else if (b.id === 'apiary') {
      if (!this.bee) bar(b.t / SET.beeInterval, '#ffd23f');
    } else if (b.id === 'barn') {
      bar(b.t / SET.barnInterval, '#7bed9f');
    } else if (b.id === 'scarecrow') {
      pill(`×5 ${Math.round(SET.goldenChance * 100)}%`, '#8c6239');
    }
  }

  drawSlot(x, y) {
    const ctx = this.ctx;
    const { px, py } = this.plotPos({ x, y });
    const t = this.tile;
    const pulse = 0.55 + 0.35 * Math.sin(Date.now() / 250);
    ctx.save();
    ctx.fillStyle = `rgba(255, 243, 176, ${0.2 * pulse})`;
    ctx.fillRect(px, py, t, t);
    ctx.strokeStyle = `rgba(255, 243, 176, ${pulse})`;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(px + 2, py + 2, t - 4, t - 4);
    ctx.setLineDash([]);
    ctx.font = `${Math.round(t * 0.4)}px 'Press Start 2P', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
    ctx.fillText('+', px + t / 2, py + t / 2);
    ctx.restore();
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