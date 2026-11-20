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
    growTime: 12,
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
    growTime: 60,
    color: '#2ED573',
    stages: 3,
    levelReq: 6,
  },
  pumpkin: {
    id: 'pumpkin',
    name: 'Тыква',
    icon: '🎃',
    seedCost: 2500,
    sellPrice: 6500,
    growTime: 90,
    color: '#E67E22',
    stages: 3,
    levelReq: 7,
    premiumOnly: true, // только на золотых грядках
  },
  grapes: {
    id: 'grapes',
    name: 'Виноград',
    icon: '🍇',
    seedCost: 8000,
    sellPrice: 22000,
    growTime: 150,
    color: '#8E44AD',
    stages: 3,
    levelReq: 8,
    premiumOnly: true,
  }
};

// Стартовые грядки (поле 5x5, центр)
export const START_PLOTS = [
  { x: 2, y: 2 },
  { x: 3, y: 2 },
  { x: 2, y: 3 },
  { x: 3, y: 3 },
];

// Цена каждой следующей грядки (по порядку покупки):
// до 12-й +300 к предыдущей, дальше умножение примерно на 1.4
export const PLOT_COSTS = [
  200, 500, 800, 1100, 1400, 1700, 2000, 2300, 2600, 2900, 3200, 3500,
  4900, 6900, 9600, 13500, 19000, 26000, 37000, 52000, 72000,
];

// Грядки от этой цены считаются золотыми
export const PREMIUM_COST = 10000;

// Бонус к скорости роста от каждой золотой грядки рядом (0.15 = +15%)
export const NEIGHBOR_BONUS = 0.15;

export const UPGRADES = {
  speed: {
    id: 'speed',
    name: 'Удобрения',
    description: 'Культуры растут быстрее',
    icon: '⚡',
    baseCost: 40,
    costMultiplier: 2.2,
    maxLevel: 10,
    effectPerLevel: 0.15, // +15% к скорости роста за уровень
  },
  value: {
    id: 'value',
    name: 'Селекция',
    description: 'Урожай продаётся дороже',
    icon: '💎',
    baseCost: 60,
    costMultiplier: 2.3,
    maxLevel: 10,
    effectPerLevel: 0.20, // +20% к цене продажи за уровень
  },
  autoHarvest: {
    id: 'autoHarvest',
    name: 'Автосбор',
    description: 'Сам собирает созревший урожай',
    icon: '🧺',
    baseCost: 150,
    costMultiplier: 2.8,
    maxLevel: 5,
    delays: [0, 8, 6, 4, 2, 1], // через сколько секунд после созревания собирает (индекс = уровень)
  }
};