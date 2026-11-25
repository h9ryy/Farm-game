// crops, upgrades and balance configs
export const CROPS = {
  wheat: {
    id: 'wheat',
    name: 'Пшеница',
    icon: '🌾',
    seedCost: 2,
    sellPrice: 5,
    growTime: 3, // seconds
    color: '#F4D03F',
    stages: 3,
    levelReq: 1,
  },
  carrot: {
    id: 'carrot',
    name: 'Морковь',
    icon: '🥕',
    seedCost: 8,
    sellPrice: 18,
    growTime: 6,
    color: '#E67E22',
    stages: 3,
    levelReq: 2,
  },
  tomato: {
    id: 'tomato',
    name: 'Томат',
    icon: '🍅',
    seedCost: 25,
    sellPrice: 55,
    growTime: 8,
    color: '#E74C3C',
    stages: 3,
    levelReq: 3,
  },
  corn: {
    id: 'corn',
    name: 'Кукуруза',
    icon: '🌽',
    seedCost: 80,
    sellPrice: 180,
    growTime: 20,
    color: '#F1C40F',
    stages: 3,
    levelReq: 4,
  },
  strawberry: {
    id: 'strawberry',
    name: 'Клубника',
    icon: '🍓',
    seedCost: 250,
    sellPrice: 580,
    growTime: 35,
    color: '#FF4757',
    stages: 3,
    levelReq: 5,
  },
  watermelon: {
    id: 'watermelon',
    name: 'Арбуз',
    icon: '🍉',
    seedCost: 800,
    sellPrice: 1900,
    growTime: 40,
    color: '#2ED573',
    stages: 3,
    levelReq: 6,
  },
  pumpkin: {
    id: 'pumpkin',
    name: 'Тыква',
    icon: '🎃',
    seedCost: 2000,
    sellPrice: 3300,
    growTime: 40,
    color: '#E67E22',
    stages: 3,
    levelReq: 7,
    tier: 1, // нужна улучшенная или золотая грядка
  },
  grapes: {
    id: 'grapes',
    name: 'Виноград',
    icon: '🍇',
    seedCost: 3500,
    sellPrice: 5400,
    growTime: 40,
    color: '#8E44AD',
    stages: 3,
    levelReq: 8,
    tier: 1,
  },
  apple: {
    id: 'apple',
    name: 'Золотое яблоко',
    icon: '🍎',
    seedCost: 6000,
    sellPrice: 10300,
    growTime: 40,
    color: '#F1C40F',
    stages: 3,
    levelReq: 9,
    tier: 2, // только на золотых грядках
  },
  peach: {
    id: 'peach',
    name: 'Персик бессмертия',
    icon: '🍑',
    seedCost: 10000,
    sellPrice: 16900,
    growTime: 40,
    color: '#FF9F9F',
    stages: 3,
    levelReq: 10,
    tier: 2,
  },
  dragon: {
    id: 'dragon',
    name: 'Драконий плод',
    icon: '🐲',
    seedCost: 18000,
    sellPrice: 29000,
    growTime: 40,
    color: '#E74C3C',
    stages: 3,
    levelReq: 11,
    tier: 2,
  }
};

// Стартовые грядки (поле 5x5, центр)
export const START_PLOTS = [
  { x: 2, y: 2 },
  { x: 3, y: 2 },
  { x: 2, y: 3 },
  { x: 3, y: 3 },
];

// Цены обычных грядок (по порядку покупки): до 12-й +300, дальше примерно ×1.4.
// Вместе с 4 стартовыми это 20 обычных грядок.
export const PLOT_COSTS = [
  200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400,
  3400, 4800, 6700, 9400,
];

// Цены золотых грядок (всего 5)
export const GOLDEN_COSTS = [150000, 350000, 1000000, 2500000, 3500000];

// Всего золотых грядок максимум (куплены клеткой + получены улучшением синей)
export const GOLDEN_MAX = 10;

// Улучшение синей грядки до золотой: цена первой и во сколько раз дорожает каждая следующая (1 = без роста)
export const GOLDEN_UPGRADE_BASE = 1500000;
export const GOLDEN_UPGRADE_MULT = 1;

// Улучшение обычной грядки (даёт сажать тыкву и виноград): цена растёт с каждой улучшенной
export const PLOT_UPGRADE_BASE = 20000;
export const PLOT_UPGRADE_MULT = 1.15; // каждое следующее улучшение дороже в 1.12 раза

// Бонус к скорости роста от каждой золотой грядки рядом (0.15 = +15%)
export const NEIGHBOR_BONUS = 0.15;

export const UPGRADES = {
  speed: {
    id: 'speed',
    name: 'Удобрения',
    description: 'Культуры растут быстрее',
    icon: '⚡',
    baseCost: 40,
    costMultiplier: 3.3,
    maxLevel: 10,
    effectPerLevel: 0.15, // +15% к скорости роста за уровень
  },
  value: {
    id: 'value',
    name: 'Селекция',
    description: 'Урожай продаётся дороже',
    icon: '💎',
    baseCost: 60,
    costMultiplier: 3.5,
    maxLevel: 10,
    effectPerLevel: 0.20, // +20% к цене продажи за уровень
  },
  autoHarvest: {
    id: 'autoHarvest',
    name: 'Автосбор',
    description: 'Сам собирает созревший урожай',
    icon: '🧺',
    baseCost: 150,
    costMultiplier: 3.6,
    maxLevel: 5,
    delays: [0, 8, 6, 4, 2, 1], // через сколько секунд после созревания собирает (индекс = уровень)
  }
};

// Все культуры растут быстрее на четверть (время × 0.75). Поменяй число, чтобы ускорить или замедлить всё сразу
export const GROW_SCALE = 0.75;

// ---------- Здания (ставятся на поле рядом с грядками) ----------
export const BUILDINGS = {
  coop: {
    id: 'coop',
    name: 'Курятник',
    icon: '🐔',
    cost: 2000,
    levelReq: 3,
    desc: 'Несёт яйца: тапни по зданию и получи монеты',
  },
  shop: {
    id: 'shop',
    name: 'Лавка',
    icon: '🏪',
    cost: 28000,
    levelReq: 5,
    desc: 'Заказы покупателей: награда в 2 раза выше цены',
  },
  apiary: {
    id: 'apiary',
    name: 'Пасека',
    icon: '🐝',
    cost: 100000,
    levelReq: 6,
    desc: 'Пчела пролетает над полем: поймай её, и рост ускорится',
  },
  scarecrow: {
    id: 'scarecrow',
    name: 'Пугало',
    icon: '👨‍🌾',
    cost: 700000,
    levelReq: 7,
    desc: 'Шанс золотого урожая ×5 при каждом сборе',
  },
  barn: {
    id: 'barn',
    name: 'Амбар',
    icon: '🏚',
    cost: 3500000,
    levelReq: 11,
    desc: 'Сам продаёт урожай и добавляет +10% к цене',
  },
  
  // ---------- Здания позднего этапа ----------
  castle: {
    id: 'castle',
    name: 'Замок',
    icon: '🏰',
    cost: 15000000,
    levelReq: 11,
    desc: 'Раз в минуту появляется сундук: тапни по замку и получи монеты',
  },
  fountain: {
    id: 'fountain',
    name: 'Фонтан',
    icon: '⛲',
    cost: 30000000,
    levelReq: 11,
    desc: 'Каждые 45 секунд включается на 10 секунд: рост культур ×2,5',
  },
  wheel: {
    id: 'wheel',
    name: 'Колесо',
    icon: '🎡',
    cost: 50000000,
    levelReq: 11,
    desc: 'Раз в минуту салют: 20 секунд каждый сбор даёт урожай ×2',
  },
};

export const BUILDING_SETTINGS = {
  castleInterval: 60,   // секунд до нового сундука
  castleSeconds: 8,     // награда сундука = столько секунд твоего дохода
  fountainInterval: 45, // пауза между включениями фонтана
  fountainDuration: 10, // сколько секунд он работает
  fountainMult: 2.5,    // во сколько раз быстрее растут культуры
  wheelInterval: 60,    // пауза между салютами
  wheelDuration: 20,    // сколько секунд действует бонус
  wheelMult: 2,         // урожай за сбор ×2
  eggInterval: 17,   // секунд до нового яйца
  eggSeconds: 4,     // награда за яйцо = столько секунд твоего дохода (за последнюю минуту)
  goldenEggBonus: 5000, // золотое яйцо: бонус, бывает один раз за игру
  goldenEggWithin: 10,  // золотое яйцо попадётся среди первых N яиц
  eggMax: 3,         // сколько яиц копится
  orderInterval: 25, // секунд до нового заказа в лавке
  orderMax: 2,       // сколько заказов одновременно
  orderPool: 3,      // заказы берутся из N лучших культур, которые ты можешь вырастить
  orderQtyMin: 3,    // сколько штук в заказе: от
  orderQtyMax: 5,    // ... до
  orderBonus: 2,     // награда за заказ = цена урожая × это число
  beeInterval: 20,   // секунд между пчёлами
  beeBoost: 5,       // на сколько секунд ускоряет рост при поимке
  goldenChance: 0.08, // шанс золотого урожая (8%)
  barnInterval: 20,  // как часто амбар продаёт урожай
  barnBonus: 0.1,    // +10% к цене продажи
};