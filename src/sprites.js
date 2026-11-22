// Пиксельные спрайты мифических плодов 24x24. Рисуются кодом, отдельные картинки не нужны.
const S = 24;

function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

// Закрашивает все пиксели, для которых test(x, y) истинно (координаты центра пикселя)
function fillShape(ctx, test, color) {
  ctx.fillStyle = color;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (test(x + 0.5, y + 0.5)) ctx.fillRect(x, y, 1, 1);
    }
  }
}

const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ell = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

function sparkle(ctx, x, y, color) {
  px(ctx, x, y, color);
  px(ctx, x - 1, y, color);
  px(ctx, x + 1, y, color);
  px(ctx, x, y - 1, color);
  px(ctx, x, y + 1, color);
}

// Золотое яблоко
function drawApple(ctx) {
  // форма яблока: две округлые доли и низ, сверху ямка
  const lobes = (r) => (x, y) => disc(9.8, 13.2, r)(x, y) || disc(14.2, 13.2, r)(x, y) || disc(12, 15.2, r - 0.4)(x, y);
  const body = lobes(6.6);
  fillShape(ctx, disc(12, 13.5, 11.5), 'rgba(255, 224, 102, 0.28)'); // сияние
  fillShape(ctx, lobes(7.7), '#7a4a00'); // контур
  fillShape(ctx, body, '#f2b600'); // тело
  fillShape(ctx, (x, y) => body(x, y) && (x - 13.5) ** 2 + (y - 15.5) ** 2 > 7 ** 2, '#d18a00'); // тень
  fillShape(ctx, disc(8.8, 10.8, 2.9), '#ffe066'); // свет
  fillShape(ctx, disc(8.1, 10.1, 1.4), '#fffbe0'); // блик
  fillShape(ctx, disc(12, 6.9, 1.9), '#7a4a00'); // ямка сверху
  // черенок и лист
  [[12, 3], [12, 4], [12, 5]].forEach(([x, y]) => px(ctx, x, y, '#6b3d12'));
  [[13, 3], [14, 2], [15, 2], [16, 3], [15, 4], [14, 4]].forEach(([x, y]) => px(ctx, x, y, '#3fa34d'));
  px(ctx, 14, 3, '#2d7a38');
  sparkle(ctx, 3, 5, '#ffffff');
  sparkle(ctx, 20, 9, '#fff3a0');
  px(ctx, 19, 20, '#ffffff');
}

// Персик бессмертия
function drawPeach(ctx) {
  const cx = 12;
  const cy = 14;
  const body = disc(cx, cy, 7.4);
  fillShape(ctx, disc(cx, cy, 11.3), 'rgba(255, 213, 74, 0.25)'); // золотое сияние
  fillShape(ctx, (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    return d >= 10.2 && d <= 11.2;
  }, 'rgba(255, 213, 74, 0.75)'); // золотое кольцо
  fillShape(ctx, disc(cx, cy, 8.4), '#a8484f'); // контур
  fillShape(ctx, body, '#ffb48a'); // тело
  fillShape(ctx, (x, y) => body(x, y) && (x - 15) ** 2 + (y - 16) ** 2 < 7.2 ** 2, '#ff7f8e'); // румянец
  fillShape(ctx, (x, y) => body(x, y) && (x - 16.5) ** 2 + (y - 17.5) ** 2 < 3.6 ** 2, '#f2606f');
  fillShape(ctx, disc(8.6, 11, 2.8), '#ffd8b8'); // свет
  fillShape(ctx, disc(8, 10.4, 1.3), '#fff0e0'); // блик
  for (let y = 8; y <= 20; y++) {
    const x = 12 + (y > 14 ? 1 : 0);
    if (body(x + 0.5, y + 0.5)) px(ctx, x, y, '#e5646f'); // складка
  }
  [[12, 5], [12, 6]].forEach(([x, y]) => px(ctx, x, y, '#6b3d12'));
  [[11, 5], [10, 4], [9, 4], [8, 5], [9, 6], [10, 6]].forEach(([x, y]) => px(ctx, x, y, '#3fa34d'));
  [[13, 4], [14, 3], [15, 3], [16, 4], [15, 5], [14, 5]].forEach(([x, y]) => px(ctx, x, y, '#4cc25c'));
  sparkle(ctx, 4, 6, '#ffffff');
  sparkle(ctx, 20, 11, '#fff3a0');
  px(ctx, 18, 21, '#ffffff');
}

// Драконий плод (питахайя в разрезе)
function drawDragon(ctx) {
  const cx = 12;
  const cy = 12;
  const skin = ell(cx, cy, 8.2, 9.2);
  const flesh = ell(cx, cy, 5.2, 6.4);
  // зелёные «языки пламени» по краю
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const bx = cx + dx * 8.6;
    const by = cy + dy * 9.6;
    for (let k = 0; k < 3; k++) {
      px(ctx, Math.round(bx + dx * (k + 0.5)), Math.round(by + dy * (k + 0.5)), k < 2 ? '#2fae4a' : '#8be37a');
    }
  }
  fillShape(ctx, ell(cx, cy, 9.2, 10.2), '#6b0a3a'); // контур
  fillShape(ctx, skin, '#e0267a'); // кожура
  fillShape(ctx, (x, y) => skin(x, y) && (x - cx) * 0.6 + (y - cy) * 0.8 > 4.6, '#b5155e'); // тень
  fillShape(ctx, flesh, '#fff7fb'); // мякоть
  [[10, 9], [13, 9], [11, 12], [14, 12], [9, 14], [12, 15], [15, 15], [11, 17], [13, 6]].forEach(([x, y]) => {
    if (flesh(x + 0.5, y + 0.5)) px(ctx, x, y, '#1b1b1b'); // семечки
  });
  [[5, 8], [5, 9], [6, 7]].forEach(([x, y]) => px(ctx, x, y, '#ff7fb5')); // блик на кожуре
  sparkle(ctx, 20, 3, '#ffffff');
}

const DRAW = { apple: drawApple, peach: drawPeach, dragon: drawDragon };

// Ключи культур (id из data.js), для которых есть красивый спрайт
export const FRUIT_SPRITE_IDS = Object.keys(DRAW);

// Возвращает canvas 24x24 со спрайтом или null, если рисовать нечем
export function makeFruitSprite(id) {
  const draw = DRAW[id];
  if (!draw || typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  draw(ctx);
  return c;
}