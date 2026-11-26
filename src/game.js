import { sound } from './audio.js';
import { sdk } from './sdk.js';
import { makeFruitSprite, FRUIT_SPRITE_IDS } from './sprites.js';
import { CROPS, START_PLOTS, PLOT_COSTS, GOLDEN_COSTS, GOLDEN_MAX, GOLDEN_UPGRADE_BASE, GOLDEN_UPGRADE_MULT, PLOT_UPGRADE_BASE, PLOT_UPGRADE_MULT, NEIGHBOR_BONUS, GROW_SCALE, BUILDINGS, BUILDING_SETTINGS, UPGRADES } from './data.js';

// Опыт, нужный для каждого уровня (индекс = уровень)
// Опыт за сбор зависит от времени роста культуры (см. xpOf). Нужно для каждого уровня (индекс = уровень)
const LEVEL_XP = [0, 0, 8, 24, 48, 104, 200, 480, 1500, 2300, 3300, 4500, 5600, 6800, 8100, 9500];
const MAX_LEVEL = LEVEL_XP.length - 1;
const GRID = 6;       // поле 6x6 (грядки и здания)
const BASE = 96;      // базовый размер грядки при рисовании (дальше масштабируется)
const SAVE_VERSION = 3;
const GROW_TAP_MAX = 2; // сколько раз за один рост тап по ростку приносит монету
const EMOJI_FONT = "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";

// Быстрые цели идут по порядку. stat: harvested, earned, upgrades, plots (накопительно за всё время)
// или текущее состояние: level, buildings, golden, barn, late. target: сколько нужно, reward: монеты.
const QUESTS = [
  { stat: 'plots', target: 1, reward: 150, text: 'Купи 1 грядку' },
  { stat: 'harvested', target: 30, reward: 200, text: 'Собери 30 урожаев' },
  { stat: 'earned', target: 500, reward: 300, text: 'Заработай 500 монет' },
  { stat: 'plots', target: 3, reward: 500, text: 'Купи 3 грядки' },
  { stat: 'upgrades', target: 1, reward: 400, text: 'Купи первое улучшение' },
  { stat: 'harvested', target: 100, reward: 800, text: 'Собери 100 урожаев' },
  { stat: 'earned', target: 3000, reward: 1200, text: 'Заработай 3000 монет' },
  { stat: 'plots', target: 6, reward: 2000, text: 'Купи 6 грядок' },
  { stat: 'buildings', target: 1, reward: 2500, text: 'Построй первое здание' },
  { stat: 'level', target: 6, reward: 4000, text: 'Достигни 6 уровня' },
  { stat: 'harvested', target: 250, reward: 5000, text: 'Собери 250 урожаев' },
  { stat: 'earned', target: 25000, reward: 8000, text: 'Заработай 25000 монет' },
  { stat: 'upgrades', target: 5, reward: 12000, text: 'Купи 5 улучшений' },
  { stat: 'plots', target: 12, reward: 18000, text: 'Купи 12 грядок' },
  { stat: 'level', target: 9, reward: 35000, text: 'Достигни 9 уровня' },
  { stat: 'earned', target: 250000, reward: 60000, text: 'Заработай 250 тысяч монет' },
  { stat: 'buildings', target: 3, reward: 100000, text: 'Построй 3 здания' },
  { stat: 'golden', target: 1, reward: 250000, text: 'Получи золотую грядку' },
  { stat: 'earned', target: 3000000, reward: 500000, text: 'Заработай 3 млн монет' },
  { stat: 'barn', target: 1, reward: 1000000, text: 'Построй амбар' },
  { stat: 'earned', target: 20000000, reward: 3000000, text: 'Заработай 20 млн монет' },
  { stat: 'late', target: 1, reward: 5000000, text: 'Построй замок, фонтан или колесо' },
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
    this.sprites = {}; // пиксельные спрайты мифических плодов

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

  // Опыт за один сбор: чем дольше растёт культура, тем больше опыта (пшеница 1, арбуз 13)
  xpOf(crop) {
    return Math.max(1, Math.round(crop.growTime / 3));
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

  // Колесо обозрения: пока идёт бонус, каждый сбор даёт урожай ×2
  wheelActive() {
    const w = this.getBuilding('wheel');
    return !!w && w.boost > 0;
  }

  // Сундук замка: несколько секунд дохода, но не меньше трёх пшениц
  chestValue() {
    return Math.max(3 * this.priceOf(CROPS.wheat), Math.round(this.incomePerSec() * BUILDING_SETTINGS.castleSeconds));
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

  // Золотые, купленные новой клеткой, и золотые, полученные улучшением синей грядки
  boughtGoldenCount() {
    return this.plots.filter((p) => p.premium && !p.conv).length;
  }

  convertedGoldenCount() {
    return this.plots.filter((p) => p.premium && p.conv).length;
  }

  nextGoldenCost() {
    const i = this.boughtGoldenCount();
    return i < GOLDEN_COSTS.length && this.goldenCount() < GOLDEN_MAX ? GOLDEN_COSTS[i] : null;
  }

  goldenUpgradeCost() {
    return Math.round(GOLDEN_UPGRADE_BASE * Math.pow(GOLDEN_UPGRADE_MULT, this.convertedGoldenCount()));
  }

  // Золотой можно сделать только синюю (улучшенную) грядку
  canMakeGolden(plot) {
    return plot.upgraded && !plot.premium && this.goldenCount() < GOLDEN_MAX;
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
  // Улучшение синей грядки до золотой
  startGolden() {
    if (!this.plots.some((p) => this.canMakeGolden(p))) return;
    if (this.coins < this.goldenUpgradeCost()) {
      sound.playClick();
      return;
    }
    sound.playClick();
    this.closeShop();
    this.upgrading = 'gold';
    this.placing = false;
    this.updateUI();
    this.resize();
  }

  makeGolden(plot) {
    const cost = this.goldenUpgradeCost();
    if (!this.canMakeGolden(plot) || this.coins < cost) return;
    this.coins -= cost;
    plot.premium = true;
    plot.conv = true;
    this.stats.upgrades += 1;
    this.keepGolden();
    const { px, py } = this.plotPos(plot);
    this.addFloatingText(px + this.tile / 2, py + this.tile / 2, 'ЗОЛОТАЯ ГРЯДКА!', '#ffd23f', 10);
    this.spawnHarvestParticles(px + this.tile / 2, py + this.tile / 2);
    this.spawnHarvestParticles(px + this.tile / 2, py + this.tile / 2);
    this.buzz(40);
    sound.playUnlock();
    this.updateUI();
    this.resize();
    this.saveGame();
  }

  keepGolden() {
    const left = this.plots.some((p) => this.canMakeGolden(p));
    if (left && this.coins >= this.goldenUpgradeCost()) return;
    this.upgrading = false;
    if (left) this.addFloatingText(this.canvas.width / 2, this.canvas.height / 2, 'НЕТ МОНЕТ!', '#ff4d4d', 14);
  }

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
    if (id === 'castle') b.chest = false;
    if (id === 'fountain' || id === 'wheel') b.boost = 0;
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
    if (b.id === 'castle') {
      if (b.chest) {
        const reward = this.chestValue();
        b.chest = false;
        this.coins += reward;
        this.stats.earned += reward;
        sound.playSell();
        this.buzz(25);
        this.addFloatingText(cx, cy, `СУНДУК! +💰${reward}`, '#ffde59', 11);
        this.spawnHarvestParticles(cx, cy);
        this.flyItem(cx, cy, '💰', 'coinsVal', 6);
        this.updateUI();
      } else {
        sound.playClick();
        this.addFloatingText(cx, cy, 'СУНДУК СКОРО', '#ffffff', 10);
      }
      return;
    }
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
    this.bee = { t: 0, dur: 7, x: -30, y: 0, y0: this.gridY + Math.random() * this.boxRows * (this.tile + this.gap) };
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

  // Здания позднего этапа: замок, фонтан, колесо обозрения
  updateLateBuildings(step) {
    const S = BUILDING_SETTINGS;
    this.buildings.forEach((b) => {
      const { px, py } = this.plotPos(b);
      const cx = px + this.tile / 2;
      const cy = py + this.tile / 2;
      if (b.id === 'castle') {
        if (!b.chest) {
          b.t += step;
          if (b.t >= S.castleInterval) {
            b.t = 0;
            b.chest = true;
            sound.playTone(880, 'triangle', 0.08, 0.08);
          }
        }
      } else if (b.id === 'fountain') {
        if (b.boost > 0) {
          // пока фонтан работает, растущие культуры «прибавляют» время
          this.plots.forEach((p) => {
            if (p.state === 'growing') p.plantedAt -= step * (S.fountainMult - 1) * 1000;
          });
          b.boost -= step;
          if (b.boost <= 0) {
            b.boost = 0;
            b.t = 0;
          }
        } else {
          b.t += step;
          if (b.t >= S.fountainInterval) {
            b.t = 0;
            b.boost = S.fountainDuration;
            sound.playTone(660, 'sine', 0.12, 0.08);
            this.addFloatingText(cx, cy - 20, `РОСТ ×${S.fountainMult}!`, '#9fd3ff', 12);
            this.spawnHarvestParticles(cx, cy);
          }
        }
      } else if (b.id === 'wheel') {
        if (b.boost > 0) {
          b.boost -= step;
          if (b.boost <= 0) {
            b.boost = 0;
            b.t = 0;
          }
        } else {
          b.t += step;
          if (b.t >= S.wheelInterval) {
            b.t = 0;
            b.boost = S.wheelDuration;
            sound.playUnlock();
            this.buzz(30);
            this.addFloatingText(cx, cy - 20, `УРОЖАЙ ×${S.wheelMult}!`, '#ffd23f', 12);
            for (let i = 0; i < 3; i++) this.spawnHarvestParticles(cx, cy);
          }
        }
      }
    });
  }

  updateBuildings(dt) {
    const S = BUILDING_SETTINGS;
    const step = Math.min(dt, 1);
    this.updateLateBuildings(step);
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
    const n = this.plots.filter((p) => p.upgraded).length;
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
    this.upgrading = 'blue';
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
    this.buildSprites();
    this.buildSeedBar();
    this.setupUI();
    this.resize();
    window.addEventListener('resize', () => this.resize(true));
    this.setupInputs();

    // Сброс прогресса: открой игру с адресом вида http://127.0.0.1:5500/?reset
    if ((window.location.search || '').includes('reset')) {
      try { localStorage.removeItem('pixel_farm_save'); } catch (e) {}
      if (window.history && window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
    }
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
  // Поле подгоняется под то, что построено: мало грядок = крупно, много = мельче.
  // snap = true: сразу, без плавного перехода (старт, поворот экрана).
  resize(snap = false) {
    const wrap = this.canvas.parentElement;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) snap = true;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;

    const top = document.querySelector('.hud-top').offsetHeight + 28;
    const bottom = document.querySelector('.hud-bottom').offsetHeight + 28;
    const availW = w - 24;
    const availH = h - top - bottom;

    // Рамка вокруг всех грядок и зданий (в режиме «поставь» ещё и вокруг свободных клеток)
    const cells = [...this.plots, ...this.buildings];
    if (this.placing) cells.push(...this.plotSlots());
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const cols = Math.max(...xs) - minX + 1;
    const rows = Math.max(...ys) - minY + 1;

    // Меньше 3x3 не считаем, чтобы в самом начале грядки не были гигантскими
    const fc = Math.max(cols, 3);
    const fr = Math.max(rows, 3);
    const gapRatio = 0.12;
    const fit = Math.floor(Math.min(availW / (fc + (fc - 1) * gapRatio), availH / (fr + (fr - 1) * gapRatio)));
    const tile = Math.max(40, Math.min(fit, 170));
    const gap = Math.round(tile * gapRatio);
    const totalW = cols * tile + (cols - 1) * gap;
    const totalH = rows * tile + (rows - 1) * gap;
    const gx = Math.round((w - totalW) / 2);
    const gy = Math.round(top + (availH - totalH) / 2);

    // Если рамка сдвинулась (грядка слева или сверху), сохраняем текущее положение клеток на экране
    if (this.tile !== undefined && this.minX !== undefined && !snap) {
      this.gridX += (minX - this.minX) * (this.tile + this.gap);
      this.gridY += (minY - this.minY) * (this.tile + this.gap);
    }
    this.minX = minX;
    this.minY = minY;
    this.boxRows = rows;
    this.target = { tile, gridX: gx, gridY: gy };

    if (snap || this.tile === undefined) {
      this.tile = tile;
      this.gap = gap;
      this.gridX = gx;
      this.gridY = gy;
    }
  }

  // Плавно подтягиваем размер и положение поля к нужным
  animateView(dt) {
    const t = this.target;
    if (!t) return;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 10);
    const move = (cur, to) => (Math.abs(to - cur) < 0.5 ? to : cur + (to - cur) * k);
    this.tile = move(this.tile, t.tile);
    this.gridX = move(this.gridX, t.gridX);
    this.gridY = move(this.gridY, t.gridY);
    this.gap = Math.round(this.tile * 0.12);
  }

  plotPos(plot) {
    return {
      px: this.gridX + (plot.x - this.minX) * (this.tile + this.gap),
      py: this.gridY + (plot.y - this.minY) * (this.tile + this.gap),
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
        if (h && this.upgrading === 'gold') {
          if (this.canMakeGolden(h.plot)) this.makeGolden(h.plot);
        } else if (h && this.canUpgrade(h.plot)) {
          this.upgradePlot(h.plot);
        }
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
    const amount = (golden ? 5 : 1) * (this.wheelActive() ? BUILDING_SETTINGS.wheelMult : 1);
    this.inventory[crop.id] += amount;
    this.stats.harvested += 1;
    this.xp += this.xpOf(crop);
    this.valueLog.push({ t: Date.now(), v: this.priceOf(crop) * amount });

    if (auto) {
      sound.playTone(700, 'sine', 0.05, 0.05);
      this.addFloatingText(cx, cy, `+${amount} ${crop.icon}`, golden ? '#ffd23f' : '#c8f7dc', 10);
    } else {
      sound.playHarvest();
      this.addFloatingText(cx, cy, `+${amount} ${crop.icon}`, golden ? '#ffd23f' : '#7bed9f');
      this.spawnHarvestParticles(cx, cy);
    }

    this.flyItem(cx, cy, crop.icon, 'cropCountVal', Math.min(amount, 5));
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
  // Рисуем спрайты мифических плодов один раз при запуске
  buildSprites() {
    this.sprites = {};
    FRUIT_SPRITE_IDS.forEach((id) => {
      const c = makeFruitSprite(id);
      if (c) this.sprites[id] = c;
    });
  }

  // Рисует спрайт плода в размере size (пиксели остаются чёткими)
  drawFruit(id, x, y, size) {
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.sprites[id], Math.round(x), Math.round(y), size, size);
    ctx.restore();
  }

  buildSeedBar() {
    const bar = document.getElementById('seedBar');
    bar.innerHTML = '';
    Object.values(CROPS).forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'seed-btn';
      btn.dataset.crop = c.id;
      const spr = this.sprites[c.id];
      const iconHtml = spr ? `<img class="seed-img" alt="" src="${spr.toDataURL()}">` : c.icon;
      btn.innerHTML = `<span class="seed-icon">${iconHtml}</span><span class="seed-info"></span>`;
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
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) {
        this._shopTab = tabBtn.dataset.tab;
        this._shopKey = '';
        sound.playClick();
        this.renderShop();
        return;
      }
      const btn = e.target.closest('[data-up]');
      if (!btn || btn.disabled) return;
      const id = btn.dataset.up;
      if (id === 'plot') this.startPlacing('regular');
      else if (id === 'golden') this.startPlacing('golden');
      else if (id === 'plotup') this.startUpgrading();
      else if (id === 'goldup') this.startGolden();
      else if (id.startsWith('b:')) this.startPlacingBuilding(id.slice(2));
      else this.buyUpgrade(id);
    });

    this.updateUI();
  }

  renderShop() {
    const modal = document.getElementById('shopModal');
    if (modal.classList.contains('hidden')) return;

    // Перерисовываем только если что-то изменилось, чтобы не сбивать нажатия
    const tab = this._shopTab || 'plots';
    const key = JSON.stringify([this.coins, this.upgrades, this.plots.map((p) => this.plotTier(p)).join(''), this.buildings.length, this.level, tab]);
    if (key === this._shopKey) return;
    this._shopKey = key;

    const list = document.getElementById('upgradeList');
    const noSlots = this.plotSlots().length === 0;
    const regCost = this.nextRegularCost();
    const regMax = regCost === null || noSlots;
    const goldCost = this.nextGoldenCost();
    const goldMax = goldCost === null || noSlots;
    const upCost = this.plotUpgradeCost();
    const upgradedCount = this.plots.filter((p) => p.upgraded).length;
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

    // Вкладка «Грядки»
    const canReg = !regMax && this.coins >= regCost;
    const canGold = !goldMax && this.coins >= goldCost;
    const plotsHtml =
      '<div class="shop-title">ГРЯДКИ</div>' +
      card('🟫', 'Новая грядка', 'Ставишь сам, рядом с уже имеющимися',
        `Обычных: ${this.regularCount()} из ${START_PLOTS.length + PLOT_COSTS.length}`,
        'plot', canReg, regMax, regMax ? 'МАКС' : '💰' + regCost) +
      '<div class="shop-title">⭐ ЗОЛОТЫЕ ГРЯДКИ</div>' +
      card('⭐', 'Золотая грядка', `Мифические плоды, сама сажает и собирает, +${bonusPct}% роста соседям`,
        `Золотых: ${this.goldenCount()} из ${GOLDEN_MAX}`,
        'golden', canGold, goldMax, goldMax ? 'МАКС' : '💰' + goldCost);

    // Вкладка «Здания»
    let canBld = false;
    const bldHtml = Object.values(BUILDINGS).map((def) => {
      const built = this.hasBuilding(def.id);
      const locked = this.level < def.levelReq;
      const off = built || locked || noSlots;
      const can = !off && this.coins >= def.cost;
      if (can) canBld = true;
      const label = built ? 'ЕСТЬ' : locked ? `УР.${def.levelReq}` : '💰' + def.cost;
      return card(def.icon, def.name, def.desc, built ? 'Построено' : `Открывается с ${def.levelReq} уровня`, 'b:' + def.id, can, off, label);
    }).join('');

    // Вкладка «Улучшения»
    const canPlotUp = upLeft > 0 && this.coins >= upCost;
    const goldUpCost = this.goldenUpgradeCost();
    const blueLeft = this.plots.filter((p) => this.canMakeGolden(p)).length;
    const goldFull = this.goldenCount() >= GOLDEN_MAX;
    const canGoldUp = blueLeft > 0 && this.coins >= goldUpCost;
    let canUps = canPlotUp || canGoldUp;
    const upsHtml =
      '<div class="shop-title">ГРЯДКИ</div>' +
      card('🔷', 'Улучшить грядку', 'Можно сажать тыкву и виноград',
        `Улучшено: ${upgradedCount} из ${this.plots.length - this.boughtGoldenCount()}`,
        'plotup', canPlotUp, upLeft === 0, upLeft === 0 ? 'МАКС' : '💰' + upCost) +
      card('🌟', 'Улучшить до золотой', 'Синяя грядка становится золотой: сама сажает и собирает, мифические плоды',
        `Золотых: ${this.goldenCount()} из ${GOLDEN_MAX}`,
        'goldup', canGoldUp, blueLeft === 0, goldFull ? 'МАКС' : blueLeft === 0 ? 'НЕТ 🔷' : '💰' + goldUpCost) +
      '<div class="shop-title">ХОЗЯЙСТВО</div>' +
      Object.values(UPGRADES).map((u) => {
        const lvl = this.upgrades[u.id];
        const max = lvl >= u.maxLevel;
        const cost = this.upgradeCost(u.id);
        const can = !max && this.coins >= cost;
        if (can) canUps = true;
        return card(u.icon, u.name, u.description, `Уровень ${lvl} из ${u.maxLevel}<br>${this.effectText(u.id)}`,
          u.id, can, max, max ? 'МАКС' : '💰' + cost);
      }).join('');

    // Вкладки с красной меткой, если на ней можно что-то купить
    const marks = { plots: canReg || canGold, buildings: canBld, upgrades: canUps };
    const tabs = [['plots', '🟫 Грядки'], ['buildings', '🏠 Здания'], ['upgrades', '⚡ Улучшения']];
    const tabsHtml = '<div class="shop-tabs">' + tabs.map(([id, label]) =>
      `<button class="shop-tab ${tab === id ? 'active' : ''} ${marks[id] ? 'alert' : ''}" data-tab="${id}">${label}</button>`).join('') + '</div>';

    list.innerHTML = tabsHtml + { plots: plotsHtml, buildings: bldHtml, upgrades: upsHtml }[tab];
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
    const have = Math.min(this.questProgress(q), q.target);
    document.getElementById('questText').textContent = q.text;
    document.getElementById('questReward').textContent = `+💰${this.fmtNum(q.reward)}`;
    document.getElementById('questFill').style.width = `${Math.round((have / q.target) * 100)}%`;
    document.getElementById('questCount').textContent = `${this.fmtNum(have)}/${this.fmtNum(q.target)}`;

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
    const canUpPlot = (this.plots.some((p) => this.canUpgrade(p)) && this.coins >= this.plotUpgradeCost()) ||
      (this.plots.some((p) => this.canMakeGolden(p)) && this.coins >= this.goldenUpgradeCost());
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
    } else if (this.upgrading === 'gold') {
      document.getElementById('placeText').textContent = `Выбери синюю грядку для золота (💰${this.goldenUpgradeCost()})`;
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
        conv: p.conv,
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
          if (sb.id === 'castle') b.chest = !!sb.chest;
          if (sb.id === 'fountain' || sb.id === 'wheel') b.boost = 0;
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
          const p = { x, y, crop: null, state: 'empty', plantedAt: 0, ripeAt: 0, premium: !!sp.premium, upgraded: !!sp.upgraded, conv: !!sp.conv, lastCrop: CROPS[sp.lastCrop] ? sp.lastCrop : null };
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
    this.resize(true);
  }

  // ---------- ЦЕЛИ, ОКНА, ЭФФЕКТЫ ЭТАПА 4 ----------
  // Сколько уже выполнено по цели
  questProgress(q) {
    switch (q.stat) {
      case 'level': return this.level;
      case 'buildings': return this.buildings.length;
      case 'golden': return this.goldenCount();
      case 'barn': return this.hasBuilding('barn') ? 1 : 0;
      case 'late': return ['castle', 'fountain', 'wheel'].filter((id) => this.hasBuilding(id)).length;
      default: return this.stats[q.stat] || 0;
    }
  }

  // Короткая запись больших чисел: 12.5K, 3M
  fmtNum(n) {
    if (n >= 1000000) return `${+(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${+(n / 1000).toFixed(1)}K`;
    return `${n}`;
  }

  questAt(i) {
    if (i < QUESTS.length) return QUESTS[i];
    // Дальше бесконечно: «Заработай N монет», N каждый раз вдвое больше, награда 6% от N
    const n = i - QUESTS.length + 1;
    const target = 20000000 * Math.pow(2, n);
    return { stat: 'earned', target, reward: Math.round(target * 0.06), text: `Заработай ${this.fmtNum(target)} монет` };
  }

  checkQuests() {
    let guard = 0;
    while (guard++ < 10) {
      const q = this.questAt(this.questIndex);
      if (this.questProgress(q) < q.target) break;
      this.questIndex += 1;
      this.coins += q.reward;
      sound.playUnlock();
      this.buzz(40);
      const cx = this.canvas.width / 2;
      const cy = this.canvas.height / 2;
      this.addFloatingText(cx, cy - 60, 'ЗАДАНИЕ ВЫПОЛНЕНО!', '#ffde59', 14);
      this.addFloatingText(cx, cy - 36, `+💰${this.fmtNum(q.reward)}`, '#7bed9f', 14);
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
    this.animateView(dt);
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
      if (this.upgrading && (this.upgrading === 'gold' ? this.canMakeGolden(plot) : !plot.upgraded)) {
        const rgb = this.upgrading === 'gold' ? '255, 210, 63' : '159, 211, 255';
        ctx.strokeStyle = `rgba(${rgb}, ${0.5 + 0.5 * Math.sin(now / 250)})`;
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
      if (this.sprites[crop.id]) {
        this.drawFruit(crop.id, cx - 24, cy - 24, 48);
      } else {
        ctx.font = `36px ${EMOJI_FONT}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(crop.icon, cx, cy + 2);
      }
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
      if (crop.id === 'phoenix') this.drawPhoenixAura(cx, cy + 4 + bob, now);
      if (crop.id === 'wheat') {
        this.drawPixelRipeWheat(cx, cy + 12 + bob);
      } else if (this.sprites[crop.id]) {
        this.drawFruit(crop.id, cx - 24, cy - 14 + bob, 48);
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
      if (this.sprites[crop.id]) {
        this.drawFruit(crop.id, cx - 12, 5, 24);
      } else {
        ctx.font = `16px ${EMOJI_FONT}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(crop.icon, cx, 19);
      }
    }
  }

  // Свечение и искры вокруг созревшего плода феникса (координаты 96x96)
  drawPhoenixAura(cx, cy, now) {
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(now / 280);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, BASE, BASE);
    ctx.clip();
    const grad = ctx.createRadialGradient(cx, cy, 6, cx, cy, 46);
    grad.addColorStop(0, `rgba(255, 170, 40, ${0.55 + 0.25 * pulse})`);
    grad.addColorStop(1, 'rgba(255, 90, 20, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, 46, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const a = now / 700 + (i * Math.PI * 2) / 6;
      const r = 32 + 4 * Math.sin(now / 300 + i);
      ctx.fillStyle = i % 2 ? '#ffffff' : '#ffd23f';
      ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.85), 3, 3);
    }
    ctx.restore();
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
    } else if (b.id === 'castle') {
      if (b.chest) pill('🎁 ТАП', '#2ed573');
      else bar(b.t / SET.castleInterval, '#ffd23f');
    } else if (b.id === 'fountain') {
      if (b.boost > 0) pill(`×${SET.fountainMult} ${Math.ceil(b.boost)}с`, '#2d98da');
      else bar(b.t / SET.fountainInterval, '#74b9ff');
    } else if (b.id === 'wheel') {
      if (b.boost > 0) pill(`×${SET.wheelMult} ${Math.ceil(b.boost)}с`, '#d4a017');
      else bar(b.t / SET.wheelInterval, '#ff9ff3');
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