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
  }
};

export const INITIAL_PLOTS = [
  { id: 0, x: 0, y: 0, unlocked: true },
  { id: 1, x: 1, y: 0, unlocked: true },
  { id: 2, x: 2, y: 0, unlocked: true },
  { id: 3, x: 0, y: 1, unlocked: true },
  { id: 4, x: 1, y: 1, unlocked: false, cost: 50 },
  { id: 5, x: 2, y: 1, unlocked: false, cost: 100 },
  { id: 6, x: 0, y: 2, unlocked: false, cost: 250 },
  { id: 7, x: 1, y: 2, unlocked: false, cost: 500 },
  { id: 8, x: 2, y: 2, unlocked: false, cost: 1000 },
  { id: 9, x: 3, y: 0, unlocked: false, cost: 2000 },
  { id: 10, x: 3, y: 1, unlocked: false, cost: 3500 },
  { id: 11, x: 3, y: 2, unlocked: false, cost: 5000 },
  { id: 12, x: 0, y: 3, unlocked: false, cost: 8000 },
  { id: 13, x: 1, y: 3, unlocked: false, cost: 12000 },
  { id: 14, x: 2, y: 3, unlocked: false, cost: 18000 },
  { id: 15, x: 3, y: 3, unlocked: false, cost: 25000 },
];

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
