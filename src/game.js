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


// Детерминированный генератор случайных чисел: фон каждый раз рисуется одинаково
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Как выглядит растущая культура: kind задаёт форму, цвета свои у каждой
const GROWTH = {
  wheat: { kind: 'stalk', leaf: '#52b788', dark: '#2d6a4f', fruit: '#f6e05e' },
  carrot: { kind: 'root', leaf: '#4cc25c', dark: '#2d8a3a', fruit: '#f08a1c' },
  tomato: { kind: 'bush', leaf: '#4cae4f', dark: '#2d7a38', fruit: '#e74c3c' },
  corn: { kind: 'tall', leaf: '#6fcf5a', dark: '#3f9a3a', fruit: '#f1c40f' },
  strawberry: { kind: 'low', leaf: '#3fa34d', dark: '#2d7a38', fruit: '#ff4757' },
  watermelon: { kind: 'vine', leaf: '#2f9e44', dark: '#1f6b30', fruit: '#3ec96b', stripe: '#1f8a3f', light: '#9af5b3' },
  pumpkin: { kind: 'vine', leaf: '#4cae4f', dark: '#2d7a38', fruit: '#f08a1c', stripe: '#c4640f', light: '#ffc266' },
  grapes: { kind: 'grape', leaf: '#5fb85a', dark: '#2f7a38', fruit: '#8e44ad', light: '#c58be0' },
  apple: { kind: 'magic', leaf: '#3fa34d', dark: '#2d7a38', fruit: '#f2b600' },
  peach: { kind: 'magic', leaf: '#3fa34d', dark: '#2d7a38', fruit: '#ff8fa0' },
  dragon: { kind: 'magic', leaf: '#3fa34d', dark: '#2d7a38', fruit: '#e0267a' },
  phoenix: { kind: 'magic', leaf: '#3fa34d', dark: '#2d7a38', fruit: '#ff7a1a' },
};

// Пиксельные спрайты зданий 32x32: каждая буква это цвет, точка это пусто
const BUILDING_PAL = {"x": "rgba(0,0,0,0.22)", "k": "#2e1a0e", "w": "#c8844a", "W": "#e0a766", "d": "#8a5a2b", "D": "#5a3818", "r": "#d9442e", "R": "#a82a1c", "q": "#ff7a5c", "h": "#ffffff", "g": "#e6e6e0", "G": "#b8b8b0", "s": "#a8adb5", "S": "#7c828c", "t": "#d0d4da", "T": "#555b66", "b": "#3b8fe0", "B": "#2468b0", "c": "#7cc4ff", "C": "#d6f0ff", "y": "#ffd23f", "Y": "#e0a81c", "z": "#fff3a0", "o": "#f08a1c", "O": "#c4640f", "n": "#4cae4f", "N": "#2d7a38", "m": "#8be0a0", "a": "#e8c872", "A": "#b89440", "e": "#e8c98a", "E": "#c9a05a", "p": "#8e44ad", "i": "#ff8fa3", "K": "#1a1a1a", "u": "#6b4423"};
const BUILDING_ART = {
  coop: [
    '................................',
    '................................',
    '................................',
    '................................',
    '.............kkkkkkk............',
    '...........kkqRRRRRRk...........',
    '.........kkqrrrrrrrrrkk.........',
    '.......kkqRRRRRRRRRRRRRkk.......',
    '......kqrrrrrrrrrrrrrrrrrk......',
    '....kkqRRRRRRRRRRRRRRRRRRRkk....',
    '..kkqrrrrrrrrrrrrrrrrrrrrrrrkk..',
    '.kqRRRRRRRRRRRRRRRRRRRRRRRRRRRk.',
    'kqrrrrrrrrrrrrrrrrrrrrrrrrrrrrrk',
    'qRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR',
    'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr',
    'kkRRRRRRRRRRRRRRRRRRRRRRRRRRRRkk',
    '..kkkkkwwdwwdwwdwwdwwdwwwkkkkk..',
    '......kwwdwwdwDDDDdwwdwwwk......',
    '......kwwydydDDDDDDwwdwwwk......',
    '......kwwddddDDDDDDwwdwwwk.kk...',
    '......kwwydydDDKKDDwwdwwwkkrrk..',
    '......kwwdwwdDKKKKDwwdwwwkhrhk..',
    '...kkkkwwdwwdDKKKKDwwdgghhhhKok.',
    '..kaaaawwdwwdDKKKKDwwdgghhhhkk..',
    '.kaaaaAawdwwdDKKKKDwwdhhhhhhk...',
    '.kaAaaaawdwwdDKKKKDwwdhhoohhk...',
    '.kaaaAaaSSSSSDKKKKDSSSShoohk....',
    '.kaaaaaaTTTTTddddddTTTTTookx....',
    '..kkkkkkkkkkkkkkkkkkkkkkkkxxx...',
    '...xxxxxxxxxxxxxxxxxxxxxxxxxx...',
    '.......xxxxxxxxxxxxxxxxxx.......',
    '................................',
  ],
  shop: [
    '................................',
    '................................',
    '................................',
    '................................',
    '...kkkkkkkkkkkkkkkkkkkkkkkkk....',
    '..kRRRRRRRRRRRRRRRRRRRRRRRRRkk..',
    '..krrrhhhrrrhhhrrrhhhrrrhhhrrrk.',
    '..krrrhhhrrrhhhrrrhhhrrrhhhrrrk.',
    '..krrrhhhrrrhhhrrrhhhrrrhhhrrrk.',
    '..krrrhhhrrrhhhrrrhhhrrrhhhrrrk.',
    '..krrrhhhrrrhhhrrrhhhrrrhhhrrrk.',
    '..krrrhhhrrrhhhrrrhhhrrrhhhrrrk.',
    '...krkkhkkrkkhDkrkDhkkrkkhkkrk..',
    '....kddWWWWWAADAAADAWWWWWddkk...',
    '....kddWWWrWaaaYYaaaWWWWnddk....',
    '....krhrrhrraaaYzaaamnnmnndk....',
    '....krrrrrrraaaaaaaannnnnndk....',
    '....krrrrrrrooooooonnnnnnndk....',
    '....kddddddddddddddddddddddk....',
    '...kWWWWWWWWWWWWWWWWWWWWWWWWk...',
    '...kWWWWWWWWWWWWWWWWWWWWWWWWk...',
    '...kwwwwwwdwwwwwwwwwwdwwwwwwk...',
    '...kwwwwwwdwwwwwwwwwwdwwwwwwk...',
    '...kwwwwwwdwwwwwwwwwwdwwwwwwk...',
    '...kwwwwwwdwwwwwwwwwwdwwwwwwk...',
    '...kwwwwwwdwwwwwwwwwwdwwwwwwk...',
    '...kDDDDDDDDDDDDDDDDDDDDDDDDk...',
    '..kTTTTTTTTTTTTTTTTTTTTTTTTTTk..',
    '..xkkkkkkkkkkkkkkkkkkkkkkkkkkx..',
    '...xxxxxxxxxxxxxxxxxxxxxxxxxx...',
    '......xxxxxxxxxxxxxxxxxxxx......',
    '................................',
  ],
  apiary: [
    '................................',
    '................................',
    '................................',
    '................................',
    '...........k.k..................',
    '..........kCkCk.................',
    '..........kyKyk.................',
    '.....kkkkkkyyyk.k.k.............',
    '....kddddddddk.kCkCk..k.k.......',
    '...kkddddddddkkkyKyk.kCkCk......',
    '..kWWWWWWWWWWWWkyyykkkyKykk.k...',
    '..kddddddddddddkkkkdddyyydCkCk..',
    '..kddddddddddddk.kkdddddddyKyk..',
    '...kzzzzzzzzzzk.kWWWWWWWWWyyyk..',
    '...kyyyyyyyyyyk.kddddddddddddk..',
    '...kyyyyyyyyyyk.kddddddddddddk..',
    '...kyyyyyyyyyyk..kzzzzzzzzzzk...',
    '...kOOOOOOOOOOk..kyyyyyyyyyyk...',
    '...kyyyyyyyyyyk..kyyyyyyyyyyk...',
    '...kYYYYYYYYYYk..kyyyyyyyyyyk...',
    '...kYYYYYYYYYYk..kOOOOOOOOOOk...',
    '...kYYYKKKKYYYk..kyyyyyyyyyyk...',
    '...kOOOOOOOOOOk..kYYYYYYYYYYk...',
    '....kDDkkkkDDk...kYYYYYYYYYYk...',
    '....kDDk..kDDk...kYYYKKKKYYYk...',
    '..k.kDDk..kDDkkk.kOOOOOOOOOOk.k.',
    '.kik.kk..xxkkkypkxkDDkkkkDDk.kik',
    '.knkxxxxxxxxxknnkxkDDkxxkDDk.knk',
    '.kNkxxxxxxxxxkNNkxkDDkxxkDDkxkNk',
    '..kxxxxxxxxxxxkkxxxkkxxxxkkxx.k.',
    '.......xxxxxxxxxxxxxxxxxx.......',
    '................................',
  ],
  scarecrow: [
    '................................',
    '............kkkkkkkk............',
    '...........kzzzzzzzzk...........',
    '...........kaaaaaaaak...........',
    '........kkkkaaaaaaaakkkk........',
    '.......kddddrrrrrrrrddddk.......',
    '.......kddddddddddddddddk.......',
    '........kkkddddddddddkkk........',
    '...........keeeeeeeek...........',
    '...........keeKeeeKek...........',
    '...........keeKKeKKek...........',
    '...kkkk....kEEKEEEKEk...........',
    '..koKKKk....keKKKKKk......k.k...',
    '.kaKKKKKkkkkkkeeeekkkkkkkkakak..',
    '.kaaaWWWWWWWWWWWWWWWWWWWWWaaak..',
    '.kaaadddddddddddddddddddddaaak..',
    '.kaaakkkkkkBBBBBBBBBBkkkkkaaak..',
    '..kak.....kBBBBBBBBBBk....kak...',
    '...k......kbbbbBBbyyyk.....k....',
    '..........kbbbbBBbyYyk..........',
    '..........kBBBBBBByyyk..........',
    '..........kbbbbBBbbbbk..........',
    '..........kbrrrBBbbbbk..........',
    '..........kbrRrBBbbbbk..........',
    '..........kbrrrBBbbbbk..........',
    '..........kaaaaaaaaaak..........',
    '..........kaaaaaaaaaak..........',
    '......xxxxxkakaWdkakakxxxx......',
    '.....xxxxxxxkxkkkxkxkxxxxxx.....',
    '......xxxxxxxxxxxxxxxxxxxx......',
    '.........xxxxxxxxxxxxxx.........',
    '................................',
  ],
  barn: [
    '............kkkDDkyk............',
    '...........kyDDDDDDk............',
    '............kkkDDkk.............',
    '............kkkDDkkkk...........',
    '..........kktSSSSSSSSk..........',
    '........kktssssssssssskk........',
    '......kktSSSSSSSSSSSSSSSkk......',
    '....kktssssssssssssssssssskk....',
    '..kktSSSSSSSSShhhhSSSSSSSSSSkk..',
    '.ktssssssssssshaahssssssssssssk.',
    '.ktSSSSSSSSSSShaahSSSSSSSSSSSSSk',
    'ktsssssssssssshaahsssssssssssssk',
    'ktSSSSSSSSSSSShaahSSSSSSSSSSSSSS',
    'tssssssssssssshDDhssssssssssssss',
    'tSTTTTTTTTTTTTTTTTTTTTTTTTTTTTSS',
    'kkkkrRrrRrrRrrRrrRrrRrrRrrRrkkkk',
    '...krRrrRrrRrrRrrRrrRrrRrrRrk...',
    '...krRrrRrrRrrRrrRrrRrrRrrRrk...',
    '...krRrrRhhhhhhDDhhhhhhRrrRrk...',
    '...krRrrRhhRRRRDDRRRRhhRrrRrk...',
    '...krRrrRhRhRRRDDRRRhRhRrrRrk...',
    '...krRrrRhRRhRRDDRRhRRhRrrRrk...',
    '...krRrrRhRRRhRDDRhRRRhRrrRrk...',
    '...krRrrRhRRRRhDDhRRRRhRrrRrk...',
    '...krRrrRhRRRRRhhRRRRRhRrrRrk...',
    '...krRrrRhRRRRRhhRRRRRhRrrRrk...',
    '..kTTTTTTTTTTTTTTTTTTTTTTTTTTk..',
    '..kTTTTTTTTTTTTTTTTTTTTTTTTTTk..',
    '..xkkkkkkkkkkkkkkkkkkkkkkkkkkx..',
    '..xxxxxxxxxxxxxxxxxxxxxxxxxxxx..',
    '.....xxxxxxxxxxxxxxxxxxxxxx.....',
    '................................',
  ],
  castle: [
    '....kDrrrk................kDrrrk',
    '....kDrrrk................kDrrrk',
    '...kbDkkk................kbDkkk.',
    '..kBBBBk................kBBBBk..',
    '..kbbbbk................kbbbbk..',
    '.kBBBBBBk..............kBBBBBBk.',
    'kbbbbbbbbk............kbbbbbbbbk',
    'kBBBBBBBBk............kBBBBBBBBk',
    'bbbbbbbbbbk..........kbbbbbbbbbb',
    'kBBBBBBBBk..kk..kk..kkkBBBBBBBBk',
    '.ktttttSttkkttkkttkkttkktttttSk.',
    '.kssssssttkkttkkttkkttkkssssssk.',
    '.ktttttStttttttttttttttttttttSk.',
    '.kttKKtStttttttyytttttttttKKtSk.',
    '.kttKKtSssssssszzsssssssttKKtSk.',
    '.kssKKssssSSSsSyysSSSsSSssKKssk.',
    '.kttKKtSsssKKsDDDDsKKsssttKKtSk.',
    '.ktttttSsssKKDSDSDSKKssstttttSk.',
    '.ktttttSsssKKDSDSDSKKssstttttSk.',
    '.kssssssSSSsSDSDSDSsSSSsssssssk.',
    '.ktttttSsssssDSDSDSssssstttttSk.',
    '.ktttttSsssssSSSSSSssssstttttSk.',
    '.ktttttSsssssDSDSDSssssstttttSk.',
    '.kssssssssSSSDSDSDSSSsSSssssssk.',
    '.ktttttSsssssSSSSSSssssstttttSk.',
    '.ktttttSsssssDSDSDSssssstttttSk.',
    '.ktttttSsssssDSDSDSssssstttttSk.',
    'kTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTk',
    '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.',
    '.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.',
    '.....xxxxxxxxxxxxxxxxxxxxxx.....',
    '................................',
  ],
  fountain: [
    '................................',
    '................................',
    '................................',
    '...............kk...............',
    '..............kyyk..............',
    '.............kyzyyk.............',
    '..............kyyk..............',
    '..............kCCk..............',
    '..............kCCk..............',
    '..............kCCk..............',
    '..........kkkksCCskkkk..........',
    '.........ksscccCCcccssk.........',
    '........kscccccCCcccccsk........',
    '........kssccccccccccssk........',
    '.........kssssssssssssk.........',
    '..........kkkksssskkkk..........',
    '.........kkkkktttSkkkkk.........',
    '......kkkssssstttSssssskkk......',
    '....kksssbcccctttScbbbbssskk....',
    '...kssbccccccctttSccccbbbbssk...',
    '..ksbbcccCCCCCtttScccccbbbbbsk..',
    '.kssbbcccccccctttScccccbbbbbssk.',
    '.kssbbbcccccccccccccccbbbbbbssk.',
    '.kssbbbbbbcccccccccbbbbbbbbbssk.',
    '.kTsssbbbbbbbbbbbbbbbbbbbbsssTk.',
    '..kTTssssbbbbbbbbbbbbbbssssTTk..',
    '...kTTTssssssssssssssssssTTTk...',
    '....kkTTTTTssssssssssTTTTTkk....',
    '..xxxxkkkTTTTTTTTTTTTTTkkkxxxx..',
    '..xxxxxxxkkkkkkkkkkkkkkxxxxxxx..',
    '.....xxxxxxxxxxxxxxxxxxxxxx.....',
    '................................',
  ],
  wheel: [
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '..............kkkk..............',
    '.............kYYYYk.............',
    '.............kYzzYk.............',
    '.............kYzzYDk............',
    '.............kYYYYDDk...........',
    '............kDdDkkdDDk..........',
    '............kDdDkkdDDk..........',
    '...........kDdDk..kdDDk.........',
    '..........kDDdk...kdDDDk........',
    '.........kDDdDk....kdDDDk.......',
    '.........kDDdk.....kdDDDk.......',
    '........kDDdk.......kdDDDk......',
    '.......kDDDdk.......kdkDDDk.....',
    '.......kDDdk.........kdDDDk.....',
    '...kkkkDDDdkkkkkkkkkkkdkDDDkk...',
    '..kTSSSSSSSSSSSSSSSSSSSSSSSSTk..',
    '..xkkkkDDkkkkkkkkkkkkkkkkkDDkx..',
    '..xxxxxkkxxxxxxxxxxxxxxxxxkkxx..',
    '......xxxxxxxxxxxxxxxxxxxx......',
    '................................',
  ],
};

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
    const fit = Math.floor(Math.min(availW / (fc + (fc - 1) * gapRatio + 0.8), availH / (fr + (fr - 1) * gapRatio + 0.8)));
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

    // Рамка только по грядкам и зданиям (для забора и вспаханной земли)
    const fcells = [...this.plots, ...this.buildings];
    const fxs = fcells.map((c) => c.x);
    const fys = fcells.map((c) => c.y);
    this.farmBox = {
      minX: Math.min(...fxs),
      minY: Math.min(...fys),
      cols: Math.max(...fxs) - Math.min(...fxs) + 1,
      rows: Math.max(...fys) - Math.min(...fys) + 1,
    };

    // Фон рисуем один раз и запоминаем; пересобираем только при смене размеров
    const horizon = Math.round(Math.max(110, top + 80));
    const key = `${w}x${h}x${horizon}`;
    if (key !== this.sceneryKey) {
      this.sceneryKey = key;
      this.horizon = horizon;
      this.skyTop = top;
      this.buildScenery();
    }
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
    this.bldSprites = {};
    Object.keys(BUILDING_ART).forEach((id) => {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const g = c.getContext('2d');
      BUILDING_ART[id].forEach((row, y) => {
        for (let x = 0; x < 32; x++) {
          const col = BUILDING_PAL[row[x]];
          if (col) {
            g.fillStyle = col;
            g.fillRect(x, y, 1, 1);
          }
        }
      });
      this.bldSprites[id] = c;
    });
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

    // Настройки: звук и сброс прогресса
    const settings = document.getElementById('settingsModal');
    const confirmBox = document.getElementById('resetConfirm');
    const soundBtn = document.getElementById('soundBtn');
    try { sound.muted = localStorage.getItem('pixel_farm_muted') === '1'; } catch (e) {}
    const showSound = () => {
      soundBtn.textContent = sound.muted ? '🔇 ЗВУК: ВЫКЛ' : '🔊 ЗВУК: ВКЛ';
    };
    showSound();
    document.getElementById('settingsBtn').addEventListener('click', () => {
      sound.ensureContext();
      sound.playClick();
      confirmBox.style.display = 'none';
      settings.classList.remove('hidden');
    });
    document.getElementById('settingsClose').addEventListener('click', () => settings.classList.add('hidden'));
    settings.addEventListener('click', (e) => {
      if (e.target === settings) settings.classList.add('hidden');
    });
    soundBtn.addEventListener('click', () => {
      sound.toggleMute();
      showSound();
      sound.playClick();
      try { localStorage.setItem('pixel_farm_muted', sound.muted ? '1' : '0'); } catch (e) {}
    });
    document.getElementById('resetBtn').addEventListener('click', () => {
      sound.playClick();
      confirmBox.style.display = '';
    });
    document.getElementById('resetNo').addEventListener('click', () => {
      sound.playClick();
      confirmBox.style.display = 'none';
    });
    document.getElementById('resetYes').addEventListener('click', () => this.resetProgress());
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
  // Полный сброс: затираем сохранение (и локальное, и облачное) и перезагружаем игру
  async resetProgress() {
    this.resetting = true; // останавливаем автосохранение, чтобы оно не вернуло прогресс
    await sdk.saveData({ v: 0 });
    try { localStorage.removeItem('pixel_farm_save'); } catch (e) {}
    window.location.reload();
  }

  saveGame() {
    if (this.resetting) return;
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
    this.drawFarmland();

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

  // ---------- ФОН ----------
  // Небо, холмы, трава, деревья, пруд. Рисуется один раз в отдельный холст.
  buildScenery() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const hz = this.horizon;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const rnd = mulberry32(1337);
    const R = (x, y, w, h, col) => {
      g.fillStyle = col;
      g.fillRect(Math.round(x), Math.round(y), w, h);
    };
    const blob = (x, y, rx, ry, col) => {
      for (let yy = -ry; yy <= ry; yy += 4) {
        const half = Math.round((rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / (ry * ry)))) / 4) * 4;
        if (half > 0) R(x - half, y + yy, half * 2, 4, col);
      }
    };

    // Небо полосами и два слоя дальних холмов
    const sky = ['#86cdfa', '#98d6fc', '#abdffd', '#bde8fe', '#cff0ff'];
    const bh = Math.ceil(hz / sky.length);
    sky.forEach((col, i) => R(0, i * bh, W, bh + 1, col));
    for (let x = 0; x < W; x += 4) {
      const y1 = hz - 34 + Math.sin(x / 110) * 12 + Math.sin(x / 41) * 4;
      R(x, y1, 4, hz + 40 - y1, '#9ad98f');
      const y2 = hz - 14 + Math.sin(x / 70 + 2) * 9 + Math.sin(x / 29) * 3;
      R(x, y2, 4, hz + 40 - y2, '#7fc678');
    }

    // Трава: светлые и тёмные пятна, пучки, цветы
    R(0, hz + 4, W, H - hz - 4, '#6eb767');
    const area = (W * (H - hz)) / 10000;
    for (let i = 0; i < area / 3; i++) {
      blob(rnd() * W, hz + 10 + rnd() * (H - hz), 20 + rnd() * 50, 8 + rnd() * 18, rnd() < 0.5 ? '#78c271' : '#64ab5d');
    }
    for (let i = 0; i < area * 1.2; i++) {
      const x = rnd() * W;
      const y = hz + 14 + rnd() * (H - hz - 14);
      R(x, y, 2, 5, '#4f9a4a');
      R(x - 3, y + 2, 2, 3, '#4f9a4a');
      R(x + 3, y + 1, 2, 4, '#4f9a4a');
      R(x + 1, y, 1, 2, '#8fd68a');
    }
    const petals = ['#ffffff', '#ffd166', '#ff8fa3', '#9fd3ff', '#ff6b6b', '#c59bff'];
    for (let i = 0; i < area * 0.8; i++) {
      const x = Math.round(rnd() * W);
      const y = Math.round(hz + 16 + rnd() * (H - hz - 24));
      const col = petals[Math.floor(rnd() * petals.length)];
      R(x, y + 4, 1, 3, '#3f8f45');
      R(x - 2, y, 2, 2, col);
      R(x + 2, y, 2, 2, col);
      R(x, y - 2, 2, 2, col);
      R(x, y + 2, 2, 2, col);
      R(x, y, 2, 2, '#ffd166');
    }

    // Пруд сбоку
    const pondX = W * (rnd() < 0.5 ? 0.12 : 0.88);
    const pondY = hz + (H - hz) * 0.5;
    const prx = Math.max(48, Math.min(W * 0.07, 120));
    const pry = Math.round(prx * 0.55);
    blob(pondX, pondY, prx + 10, pry + 8, '#cdb883');
    blob(pondX, pondY, prx, pry, '#3f97e0');
    blob(pondX - 6, pondY - 4, prx * 0.7, pry * 0.6, '#5db5f5');
    blob(pondX - prx * 0.25, pondY - pry * 0.3, prx * 0.3, pry * 0.25, '#8fd0ff');
    R(pondX + prx * 0.3, pondY + 4, 10, 4, '#3f8f45');
    R(pondX + prx * 0.3 + 2, pondY + 2, 6, 2, '#6fcf5a');
    R(pondX - prx * 0.5, pondY + pry * 0.4, 8, 4, '#3f8f45');
    for (let i = 0; i < 5; i++) {
      const rx = pondX - prx - 4 + i * 5;
      R(rx, pondY - 6 - (i % 3) * 3, 2, 12 + (i % 3) * 3, '#4f8f3a');
      R(rx - 1, pondY - 9 - (i % 3) * 3, 4, 5, '#8a5a2b');
    }

    // Деревья, кусты, камни, пеньки, грибы (не слишком кучно)
    const shadow = (x, y, w) => blob(x, y, w, 8, 'rgba(0,0,0,0.16)');
    const oak = (x, y, k) => {
      shadow(x, y, 30 * k);
      R(x - 5 * k, y - 22 * k, 10 * k, 22 * k, '#6b4423');
      R(x + 1 * k, y - 22 * k, 4 * k, 22 * k, '#553419');
      R(x - 5 * k, y - 22 * k, 2 * k, 22 * k, '#8a5a30');
      const rows = [[16, -68], [32, -62], [44, -56], [52, -48], [52, -40], [44, -32], [32, -26]];
      rows.forEach(([w, dy], i) => {
        const col = i >= rows.length - 2 ? '#256f2f' : '#2f8a3b';
        R(x - (w * k) / 2, y + dy * k, w * k, 8 * k, col);
        if (i < rows.length - 2) R(x - (w * k) / 2 + 4 * k, y + dy * k, Math.max(4, w * k - 12 * k), 8 * k - 2, '#3fa34d');
      });
      R(x - 16 * k, y - 60 * k, 8 * k, 4 * k, '#6fcf5a');
      R(x - 22 * k, y - 50 * k, 6 * k, 4 * k, '#6fcf5a');
      R(x - 10 * k, y - 66 * k, 6 * k, 4 * k, '#6fcf5a');
    };
    const pine = (x, y, k) => {
      shadow(x, y, 24 * k);
      R(x - 3 * k, y - 14 * k, 6 * k, 14 * k, '#5a3a1c');
      for (let j = 0; j < 3; j++) {
        const top = y - (62 - j * 14) * k;
        for (let r = 0; r < 5; r++) {
          const w = (6 + r * 5 + j * 4) * k;
          R(x - w / 2, top + r * 4 * k, w, 4 * k, j % 2 ? '#2a7a46' : '#34905a');
          R(x - w / 2, top + r * 4 * k, Math.max(2, w * 0.3), 4 * k, '#4cb07a');
        }
      }
    };
    const bush = (x, y, k) => {
      shadow(x, y, 20 * k);
      R(x - 14 * k, y - 10 * k, 28 * k, 10 * k, '#3f9a45');
      R(x - 10 * k, y - 16 * k, 20 * k, 8 * k, '#4cae4f');
      R(x - 8 * k, y - 14 * k, 6 * k, 3 * k, '#7bd88f');
      R(x + 4 * k, y - 8 * k, 3 * k, 3 * k, '#e74c3c');
      R(x - 6 * k, y - 6 * k, 3 * k, 3 * k, '#e74c3c');
    };
    const rock = (x, y, k) => {
      shadow(x, y, 16 * k);
      R(x - 12 * k, y - 8 * k, 24 * k, 8 * k, '#8a8f98');
      R(x - 8 * k, y - 13 * k, 16 * k, 6 * k, '#a4a9b2');
      R(x - 7 * k, y - 12 * k, 6 * k, 3 * k, '#c9ced6');
    };
    const stump = (x, y, k) => {
      shadow(x, y, 14 * k);
      R(x - 9 * k, y - 12 * k, 18 * k, 12 * k, '#7a4f25');
      R(x - 9 * k, y - 14 * k, 18 * k, 4 * k, '#c9a066');
      R(x - 4 * k, y - 13 * k, 8 * k, 2 * k, '#a07a42');
    };
    const shroom = (x, y, k) => {
      R(x - 1 * k, y - 6 * k, 3 * k, 6 * k, '#f1e6d0');
      R(x - 5 * k, y - 12 * k, 11 * k, 6 * k, '#e74c3c');
      R(x - 3 * k, y - 11 * k, 2 * k, 2 * k, '#ffffff');
      R(x + 2 * k, y - 10 * k, 2 * k, 2 * k, '#ffffff');
    };
    const kinds = [oak, oak, oak, pine, pine, bush, bush, rock, stump, shroom];
    const placed = [];
    const attempts = Math.round(area * 4);
    for (let i = 0; i < attempts && placed.length < Math.max(8, area / 3.4); i++) {
      const x = 24 + rnd() * (W - 48);
      const y = hz + 40 + rnd() * (H - hz - 150);
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < 78)) continue;
      if (Math.abs(x - pondX) < prx + 40 && Math.abs(y - pondY) < pry + 40) continue;
      placed.push({ x, y, fn: kinds[Math.floor(rnd() * kinds.length)], k: 0.8 + rnd() * 0.5 });
    }
    placed.sort((p, q) => p.y - q.y).forEach((p) => p.fn(Math.round(p.x), Math.round(p.y), p.k));

    this.bg = c;
  }

  drawBackground() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const now = Date.now();
    if (this.bg) ctx.drawImage(this.bg, 0, 0);
    const top = this.skyTop || 130;
    const R = (x, y, w, h, col) => {
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x), Math.round(y), w, h);
    };

    // Солнце
    const sx = Math.round(W * 0.86);
    const sy = top + 14;
    const glow = 0.25 + 0.1 * Math.sin(now / 700);
    ctx.fillStyle = `rgba(255, 240, 150, ${glow})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 30, 0, Math.PI * 2);
    ctx.fill();
    R(sx - 14, sy - 14, 28, 28, '#ffe27a');
    R(sx - 10, sy - 18, 20, 36, '#ffe27a');
    R(sx - 18, sy - 10, 36, 20, '#ffe27a');
    R(sx - 8, sy - 8, 16, 16, '#fff3b0');

    // Облака плывут
    const span = W + 280;
    for (let i = 0; i < 4; i++) {
      const x = (((now / 1000) * (9 + i * 4) + (i * span) / 4) % span) - 140;
      const y = top - 6 + (i % 2) * 26 + i * 5;
      R(x + 4, y + 14, 52, 6, '#d6ecfb');
      R(x, y + 8, 60, 8, '#ffffff');
      R(x + 10, y, 22, 10, '#ffffff');
      R(x + 28, y + 4, 24, 8, '#ffffff');
    }

    // Птица пролетает раз в полминуты
    const bt = (now / 1000) % 30;
    if (bt < 9) {
      const bx = -20 + (W + 40) * (bt / 9);
      const by = top + 26 + Math.sin(bt * 3) * 8;
      const up = Math.sin(bt * 14) > 0;
      R(bx, by + (up ? 0 : 3), 4, 2, '#3d2b1f');
      R(bx + 4, by + 2, 3, 3, '#3d2b1f');
      R(bx + 7, by + (up ? 0 : 3), 4, 2, '#3d2b1f');
    }

    // Бабочки над травой
    const colors = ['#ffd166', '#ff8fa3', '#9fd3ff'];
    for (let i = 0; i < 3; i++) {
      const bx = W * (0.5 + 0.42 * Math.sin(now / 6500 + i * 2.1));
      const by = this.horizon + (H - this.horizon) * (0.4 + 0.18 * Math.sin(now / 4700 + i * 3)) + 14 * Math.sin(now / 600 + i);
      const flap = Math.sin(now / 80 + i * 2) > 0 ? 4 : 2;
      R(bx - flap - 1, by - 3, flap, 5, colors[i]);
      R(bx + 2, by - 3, flap, 5, colors[i]);
      R(bx, by - 2, 2, 6, '#3d2b1f');
    }
  }

  // Вспаханная земля, тропинка к калитке и забор. Всё повторяет форму построенных грядок и зданий:
  // там, где клеток нет, виден обычный фон.
  drawFarmland() {
    const ctx = this.ctx;
    const cells = [...this.plots, ...this.buildings];
    if (cells.length === 0) return;
    const t = this.tile;
    const gp = this.gap;
    const H = this.canvas.height;
    const set = new Set(cells.map((c) => `${c.x},${c.y}`));
    const has = (x, y) => set.has(`${x},${y}`);
    const half = gp / 2;
    const pad = Math.round(t * 0.34);
    const ext = Math.max(0, pad - half); // насколько земля выступает за клетку
    const o = Math.round(pad * 0.45); // расстояние забора от края клетки
    const sc = Math.max(0.6, Math.min(t / 96, 1.6));
    const R = (x, y, ww, hh, col) => {
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(ww), Math.round(hh));
    };
    const hsh = (n) => {
      const v = Math.sin(n * 127.1) * 43758.5453;
      return v - Math.floor(v);
    };
    const rectOf = (c) => {
      const { px, py } = this.plotPos(c);
      return { x: px - half, y: py - half, w: t + gp, h: t + gp };
    };

    // Калитка: в нижнем ряду, ближе всего к середине фермы
    const maxRow = Math.max(...cells.map((c) => c.y));
    const meanX = cells.reduce((a, c) => a + c.x, 0) / cells.length;
    const bottoms = cells.filter((c) => c.y === maxRow);
    const gateCell = bottoms.reduce((a, c) => (Math.abs(c.x - meanX) < Math.abs(a.x - meanX) ? c : a));
    const gr = rectOf(gateCell);
    const gateX = gr.x + gr.w / 2;
    const pathW = Math.round(t * 0.9);
    const gate = pathW / 2 + 4;

    // Тропинка вниз от калитки
    const yStart = gr.y + gr.h;
    R(gateX - pathW / 2 - 3, yStart, pathW + 6, H - yStart, '#a8844f');
    R(gateX - pathW / 2, yStart, pathW, H - yStart, '#cfae77');
    for (let yy = yStart + o + 6, i = 0; yy < H; yy += 20, i++) {
      R(gateX - pathW / 2 + 4 + hsh(i) * pathW * 0.8, yy, 4, 3, '#b89560');
      R(gateX - pathW / 2 + 4 + hsh(i + 50) * pathW * 0.8, yy + 9, 3, 3, '#e2c795');
    }

    // Вспаханная земля под каждой клеткой (вместе дают общую форму)
    cells.forEach((c) => {
      const r = rectOf(c);
      R(r.x - ext + 4, r.y - ext + 8, r.w + ext * 2, r.h + ext * 2, 'rgba(0,0,0,0.2)');
    });
    cells.forEach((c) => {
      const r = rectOf(c);
      R(r.x - ext - 4, r.y - ext - 4, r.w + ext * 2 + 8, r.h + ext * 2 + 8, '#6b4a2b');
    });
    cells.forEach((c) => {
      const r = rectOf(c);
      R(r.x - ext, r.y - ext, r.w + ext * 2, r.h + ext * 2, '#a07b4f');
    });
    cells.forEach((c, k) => {
      const r = rectOf(c);
      for (let i = 0; i < 6; i++) {
        R(r.x - ext + 6 + hsh(k * 9 + i) * (r.w + ext * 2 - 12), r.y - ext + 6 + hsh(k * 9 + i + 70) * (r.h + ext * 2 - 12), 3, 2, i % 2 ? '#b8946a' : '#7d5c38');
      }
    });

    // Забор по внешнему краю формы
    const th = Math.max(3, Math.round(4 * sc));
    const ps = Math.max(6, Math.round(9 * sc));
    const rail = (x, y, ww, hh) => {
      if (ww <= 0 || hh <= 0) return;
      R(x + 2, y + 3, ww, hh, 'rgba(0,0,0,0.22)');
      R(x, y, ww, hh, '#b8864a');
      if (ww > hh) R(x, y, ww, 1, '#e0b777');
      else R(x, y, 1, hh, '#e0b777');
    };
    const post = (x, y, cap) => {
      R(x - ps / 2 + 2, y - ps / 2 + 3, ps, ps, 'rgba(0,0,0,0.25)');
      R(x - ps / 2, y - ps / 2, ps, ps, '#8a5f2d');
      R(x - ps / 2 + 1, y - ps / 2 + 1, ps - 2, ps - 2, '#c99a5b');
      R(x - ps / 2 + 1, y - ps / 2 + 1, ps - 2, 2, cap || '#e8c48a');
    };
    // как продлевать забор на углу: нет соседа = продлеваем, внутренний угол = укорачиваем
    const ex = (side, diag) => (!side ? o : diag ? -o : 0);
    const segs = [];
    cells.forEach((c) => {
      const r = rectOf(c);
      const L = has(c.x - 1, c.y);
      const Rr = has(c.x + 1, c.y);
      const U = has(c.x, c.y - 1);
      const D = has(c.x, c.y + 1);
      if (!U) segs.push({ h: true, a: r.y - o, p0: r.x - ex(L, has(c.x - 1, c.y - 1)), p1: r.x + r.w + ex(Rr, has(c.x + 1, c.y - 1)) });
      if (!D) segs.push({ h: true, a: r.y + r.h + o, p0: r.x - ex(L, has(c.x - 1, c.y + 1)), p1: r.x + r.w + ex(Rr, has(c.x + 1, c.y + 1)), gate: c === gateCell });
      if (!L) segs.push({ h: false, a: r.x - o, p0: r.y - ex(U, has(c.x - 1, c.y - 1)), p1: r.y + r.h + ex(D, has(c.x - 1, c.y + 1)) });
      if (!Rr) segs.push({ h: false, a: r.x + r.w + o, p0: r.y - ex(U, has(c.x + 1, c.y - 1)), p1: r.y + r.h + ex(D, has(c.x + 1, c.y + 1)) });
    });
    const posts = new Map();
    segs.forEach((sg) => {
      const len = sg.p1 - sg.p0;
      if (sg.gate) {
        rail(sg.p0, sg.a - th / 2, gateX - gate - sg.p0, th);
        rail(gateX + gate, sg.a - th / 2, sg.p1 - gateX - gate, th);
      } else if (sg.h) {
        rail(sg.p0, sg.a - th / 2, len, th);
      } else {
        rail(sg.a - th / 2, sg.p0, th, len);
      }
      const n = Math.max(1, Math.round(len / (t * 0.6)));
      for (let i = 0; i <= n; i++) {
        const p = sg.p0 + (len * i) / n;
        const x = sg.h ? p : sg.a;
        const y = sg.h ? sg.a : p;
        if (sg.gate && Math.abs(x - gateX) < gate + ps) continue;
        posts.set(`${Math.round(x)},${Math.round(y)}`, [x, y]);
      }
    });
    posts.forEach(([x, y]) => post(x, y));
    post(gateX - gate, gr.y + gr.h + o, '#ffd166');
    post(gateX + gate, gr.y + gr.h + o, '#ffd166');
  }

  // Рисует одну грядку в координатах 96x96 (масштаб задаётся снаружи)
  drawPlot(plot, hovered) {
    const ctx = this.ctx;
    const S = BASE;
    const cx = S / 2;
    const cy = S / 2;
    const now = Date.now();

    this.drawPlotBase(plot, now);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Бонус от золотого соседа (зелёная стрелка) и подсветка при улучшении
    if (!plot.premium) {
      if (this.neighborBonus(plot) > 0) {
        ctx.font = "10px 'Press Start 2P', monospace";
        ctx.fillStyle = '#7bed9f';
        ctx.fillText('▲', S - 15, 15);
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
      this.drawGrowth(crop, progress, cx, cy - 4, now);

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

  // Основание грядки: деревянная, каменная (синяя) или золотая рамка и вспаханная земля
  drawPlotBase(plot, now) {
    const ctx = this.ctx;
    const S = BASE;
    const tier = this.plotTier(plot);
    const R = (x, y, w, h, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    const P = [
      { dark: '#4a2c14', mid: '#8d5b36', light: '#c08a54', shade: '#6e4524', line: '#5e3a1c' },
      { dark: '#3d4d5e', mid: '#8fa3b8', light: '#c8d8e8', shade: '#6c8198', line: '#566b80' },
      { dark: '#7a4d00', mid: '#e0a81c', light: '#ffe68a', shade: '#b07a0a', line: '#a06c00' },
    ][tier];

    // Тень под грядкой
    R(3, 6, S, S, 'rgba(0,0,0,0.28)');

    // Рамка
    R(0, 0, S, S, P.dark);
    R(2, 2, S - 4, S - 4, P.mid);
    R(2, 2, S - 4, 3, P.light);
    R(2, 2, 3, S - 4, P.light);
    R(2, S - 5, S - 4, 3, P.shade);
    R(S - 5, 2, 3, S - 4, P.shade);

    if (tier === 1) {
      // Каменные блоки
      [18, 38, 58, 78].forEach((x) => { R(x, 2, 1, 8, P.line); R(S - x, S - 10, 1, 8, P.line); });
      [18, 38, 58, 78].forEach((y) => { R(2, y, 8, 1, P.line); R(S - 10, S - y, 8, 1, P.line); });
    } else {
      // Доски: стыки и «волокна»
      [24, 48, 72].forEach((x) => { R(x, 2, 1, 8, P.line); R(x, S - 10, 1, 8, P.line); });
      [24, 48, 72].forEach((y) => { R(2, y, 8, 1, P.line); R(S - 10, y, 8, 1, P.line); });
      [[10, 4], [34, 6], [58, 4], [82, 6]].forEach(([x, y]) => { R(x, y, 6, 1, P.light); R(x + 2, S - y - 2, 6, 1, P.light); });
    }

    // Земля с бороздами
    R(9, 9, S - 18, S - 18, '#2e1b0e');
    R(10, 10, S - 20, S - 20, '#5b3a22');
    for (let i = 0; i < 5; i++) {
      const y = 13 + i * 13;
      R(12, y, S - 24, 3, '#7a4f2d');
      R(12, y + 3, S - 24, 5, '#4a2f1a');
      R(12, y + 8, S - 24, 2, '#3a2412');
    }
    [[20, 24], [62, 38], [30, 58], [70, 66], [48, 46]].forEach(([x, y]) => R(x, y, 3, 2, '#8a7f74'));

    // Уголки: гвозди, самоцветы или золотые скобы
    if (tier === 0) {
      [[4, 4], [S - 7, 4], [4, S - 7], [S - 7, S - 7]].forEach(([x, y]) => {
        R(x, y, 3, 3, '#3b3b3b');
        R(x, y, 2, 2, '#b9bec4');
      });
    } else if (tier === 1) {
      [[3, 3], [S - 9, 3], [3, S - 9], [S - 9, S - 9]].forEach(([x, y]) => {
        R(x, y, 6, 6, '#1e6fa8');
        R(x + 1, y + 1, 4, 4, '#2d98da');
        R(x + 1, y + 1, 2, 2, '#bfe9ff');
      });
      ctx.strokeStyle = 'rgba(120, 205, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, S - 2, S - 2);
    } else {
      const gems = ['#e74c3c', '#2d98da', '#2ed573', '#a55eea'];
      [[3, 3], [S - 10, 3], [3, S - 10], [S - 10, S - 10]].forEach(([x, y], i) => {
        R(x, y, 7, 7, '#7a4d00');
        R(x + 1, y + 1, 5, 5, gems[i]);
        R(x + 1, y + 1, 2, 2, '#ffffff');
      });
      [24, 48, 72].forEach((x) => { R(x, 4, 3, 3, '#fff2a8'); R(x, S - 7, 3, 3, '#fff2a8'); });
      [24, 48, 72].forEach((y) => { R(4, y, 3, 3, '#fff2a8'); R(S - 7, y, 3, 3, '#fff2a8'); });
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, S - 2, S - 2);
      // Блик ползёт по золотой грядке
      const p = ((now / 9) % (S + 260)) - 60;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, S, S);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p + 12, 0);
      ctx.lineTo(p - 28, S);
      ctx.lineTo(p - 40, S);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // Растущее растение: у каждой культуры свой вид и три стадии (росток, подросток, почти созрело)
  drawGrowth(crop, progress, cx, cy, now) {
    const ctx = this.ctx;
    const g = GROWTH[crop.id] || GROWTH.wheat;
    const st = progress < 0.34 ? 0 : progress < 0.67 ? 1 : 2;
    const bx = Math.round(cx);
    const by = Math.round(cy) + 17;
    const sw = Math.round(Math.sin(now / 450 + bx * 0.1));
    const R = (x, y, w, h, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(1.3, 1.3);
    const L = g.leaf;
    const D = g.dark;
    const F = g.fruit;
    R(-9, -1, 18, 3, 'rgba(0,0,0,0.25)');

    switch (g.kind) {
      case 'stalk':
        if (st === 0) {
          R(-1, -7, 3, 7, D); R(-7, -8, 6, 3, L); R(2, -10, 6, 3, L);
        } else if (st === 1) {
          R(-2, -18, 4, 18, D); R(-10, -8, 8, 3, L); R(2, -13, 8, 3, L); R(-2 + sw, -23, 4, 6, '#b7e4c7');
        } else {
          R(-2, -25, 4, 25, '#b7791f'); R(-10, -9, 8, 3, L); R(2, -15, 8, 3, L);
          R(-5 + sw, -35, 10, 12, F); R(-3 + sw, -38, 6, 4, '#fefcbf'); R(-6 + sw, -30, 2, 6, '#744210'); R(4 + sw, -30, 2, 6, '#744210');
        }
        break;
      case 'root':
        if (st === 0) {
          R(-1, -7, 2, 7, L); R(-5, -6, 2, 5, L); R(3, -6, 2, 5, L);
        } else if (st === 1) {
          R(-1, -17, 3, 17, L); R(-7 + sw, -13, 2, 13, D); R(5, -14, 2, 14, L); R(-4, -10, 2, 10, D);
        } else {
          R(-1, -23, 3, 23, L); R(-8 + sw, -17, 3, 17, D); R(6, -19, 3, 19, L); R(-4, -14, 2, 14, D); R(3, -12, 2, 12, D);
          R(-5, -2, 10, 5, F); R(-3, 3, 6, 3, '#c4640f'); R(-3, -1, 3, 2, '#ffb24d');
        }
        break;
      case 'bush':
        if (st === 0) {
          R(-1, -6, 2, 6, D); R(-6, -8, 5, 3, L); R(1, -9, 5, 3, L);
        } else {
          R(-2, -17, 4, 17, D); R(-13, -15, 11, 7, L); R(3, -17, 11, 7, L); R(-9, -24, 18, 8, L); R(-6, -22, 6, 2, '#8be0a0');
          if (st === 1) {
            R(-10, -10, 4, 4, '#8bc34a'); R(6, -12, 4, 4, '#8bc34a'); R(-2, -20, 4, 4, '#8bc34a');
          } else {
            [[-11, -12], [5, -14], [-3, -22]].forEach(([x, y]) => { R(x, y, 6, 6, F); R(x + 1, y + 1, 2, 2, '#ffffff'); R(x + 2, y - 2, 2, 2, D); });
          }
        }
        break;
      case 'tall':
        if (st === 0) {
          R(-1, -9, 2, 9, D); R(-7, -8, 6, 3, L); R(1, -11, 6, 3, L);
        } else if (st === 1) {
          R(-2, -27, 4, 27, D); R(-13, -15, 11, 3, L); R(2, -19, 11, 3, L); R(-11, -9, 9, 3, L);
        } else {
          R(-2, -33, 4, 33, D); R(-13, -17, 11, 3, L); R(2, -21, 11, 3, L); R(-11, -9, 9, 3, L);
          R(3, -22, 7, 13, F); R(3, -11, 7, 5, L); R(4, -21, 2, 10, '#ffe770'); R(-3 + sw, -37, 6, 4, '#e8c872');
        }
        break;
      case 'low':
        if (st === 0) {
          R(-6, -4, 12, 4, L); R(-2, -8, 4, 5, D);
        } else {
          R(-13, -6, 26, 6, L); R(-9, -11, 18, 6, D); R(-5, -15, 10, 5, L);
          if (st === 1) {
            R(-1, -17, 3, 3, '#ffffff'); R(0, -16, 1, 1, '#ffd166');
          } else {
            [[-11, -4], [6, -3], [-3, -11]].forEach(([x, y]) => { R(x, y, 6, 7, F); R(x + 1, y + 1, 2, 2, '#ffd0d6'); R(x + 3, y + 4, 1, 1, '#ffe0a0'); R(x + 1, y - 1, 4, 2, L); });
          }
        }
        break;
      case 'vine':
        if (st === 0) {
          R(-1, -6, 2, 6, D); R(-7, -7, 6, 3, L); R(2, -8, 6, 3, L);
        } else if (st === 1) {
          R(-20, -2, 40, 3, D); R(-18, -9, 9, 7, L); R(10, -10, 9, 7, L); R(-5, -10, 10, 9, F); R(-4, -9, 3, 3, g.light);
        } else {
          R(-22, -2, 44, 3, D); R(-20, -10, 10, 8, L); R(12, -11, 10, 8, L);
          R(-10, -18, 20, 17, F); R(-5, -18, 3, 17, g.stripe); R(2, -18, 3, 17, g.stripe); R(-8, -16, 4, 4, g.light);
          R(-1, -21, 3, 4, D);
        }
        break;
      case 'grape':
        if (st === 0) {
          R(-1, -8, 2, 8, D); R(-7, -9, 6, 3, L); R(1, -10, 6, 3, L);
        } else {
          R(-2, -28, 4, 28, '#8d6e63'); R(-12, -24, 10, 6, L); R(3, -20, 10, 6, L); R(-9, -30, 8, 5, L);
          if (st === 1) {
            R(-4, -15, 8, 8, '#9ccc65');
          } else {
            R(-7, -19, 14, 4, F); R(-6, -15, 12, 4, F); R(-5, -11, 10, 4, F); R(-3, -7, 6, 4, F); R(-1, -4, 3, 3, F);
            R(-5, -18, 2, 2, g.light); R(-3, -14, 2, 2, g.light); R(1, -10, 2, 2, g.light);
          }
        }
        break;
      default: // magic: саженец со светящимся плодом
        if (st === 0) {
          R(-1, -7, 3, 7, '#8d6e63'); R(-6, -9, 5, 3, L); R(2, -10, 5, 3, L);
        } else {
          R(-2, -20, 4, 20, '#8d6e63'); R(-12, -29, 24, 11, L); R(-8, -34, 16, 6, '#7bd88f'); R(-10, -27, 6, 3, '#7bd88f');
          if (st === 1) {
            R(-2, -22, 5, 5, F); R(-1, -21, 2, 2, '#ffffff');
          } else {
            [[-9, -24], [4, -22], [-3, -31]].forEach(([x, y]) => { R(x, y, 7, 7, F); R(x + 1, y + 1, 2, 2, '#ffffff'); });
            if (Math.sin(now / 220) > 0) { R(9, -38, 2, 7, '#ffffff'); R(6, -36, 8, 2, '#ffffff'); }
          }
        }
    }
    ctx.restore();
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

  // Брызги фонтана (в координатах 96x96); во время ускорения их больше и они золотые
  drawFountainWater(b, now) {
    const ctx = this.ctx;
    const boosted = b.boost > 0;
    const n = boosted ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const ph = (now / (boosted ? 520 : 760) + i / n) % 1;
      const dx = (i - (n - 1) / 2) * (boosted ? 4.2 : 8) * ph;
      const y = 19 - 22 * ph + 64 * ph * ph;
      ctx.globalAlpha = Math.max(0, 1 - ph * ph);
      ctx.fillStyle = boosted ? '#ffe27a' : '#d6f0ff';
      ctx.fillRect(Math.round(48 + dx), Math.round(y), 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  // Колесо обозрения: крутится, кабинки остаются ровными; во время бонуса вертится быстрее
  drawWheelTop(b, now) {
    const ctx = this.ctx;
    const cx = 48;
    const cy = 45;
    const R = 28;
    const fast = b.boost > 0;
    const rot = now / (fast ? 1100 : 3600);
    const dark = '#2e1a0e';
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 45) {
      const x = Math.round(cx + Math.cos(a) * R);
      const y = Math.round(cy + Math.sin(a) * R);
      ctx.fillStyle = dark;
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 45) {
      ctx.fillStyle = fast ? '#fff3a0' : '#e8eef5';
      ctx.fillRect(Math.round(cx + Math.cos(a) * R) - 1, Math.round(cy + Math.sin(a) * R) - 1, 2, 2);
    }
    for (let k = 0; k < 8; k++) {
      const a = rot + (k * Math.PI) / 4;
      for (let r = 4; r < R; r += 2) {
        ctx.fillStyle = '#c9d3df';
        ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 2, 2);
      }
    }
    const colors = ['#e74c3c', '#3b8fe0', '#ffd23f', '#4cae4f', '#a55eea', '#f08a1c', '#ff8fa3', '#7cc4ff'];
    for (let k = 0; k < 8; k++) {
      const a = rot + (k * Math.PI) / 4;
      const x = Math.round(cx + Math.cos(a) * R);
      const y = Math.round(cy + Math.sin(a) * R);
      ctx.fillStyle = dark;
      ctx.fillRect(x - 1, y, 2, 4);
      ctx.fillRect(x - 5, y + 3, 10, 9);
      ctx.fillStyle = colors[k];
      ctx.fillRect(x - 4, y + 4, 8, 7);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x - 4, y + 4, 8, 2);
    }
    ctx.fillStyle = dark;
    ctx.fillRect(cx - 5, cy - 5, 10, 10);
    ctx.fillStyle = '#e0a81c';
    ctx.fillRect(cx - 4, cy - 4, 8, 8);
    ctx.fillStyle = '#fff3a0';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
  }

  drawBuilding(b) {
    const ctx = this.ctx;
    const S = BASE;
    const now = Date.now();
    const SET = BUILDING_SETTINGS;

    const spr = this.bldSprites && this.bldSprites[b.id];
    if (spr) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(spr, 0, 0, S, S);
      ctx.restore();
    }
    if (b.id === 'fountain') this.drawFountainWater(b, now);
    if (b.id === 'wheel') this.drawWheelTop(b, now);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Подписи внизу, на «земле» под зданием
    const pill = (text, color) => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(8, 79, S - 16, 16);
      ctx.fillStyle = color;
      ctx.fillRect(10, 81, S - 20, 12);
      ctx.font = `8px 'Press Start 2P', ${EMOJI_FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, S / 2, 88);
    };
    const bar = (frac, color) => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(13, 84, S - 26, 9);
      ctx.fillStyle = '#3a2412';
      ctx.fillRect(14, 85, S - 28, 7);
      ctx.fillStyle = color;
      ctx.fillRect(14, 85, Math.round((S - 28) * Math.min(1, frac)), 7);
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