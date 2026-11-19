import { sound } from './audio.js';
import { sdk } from './sdk.js';

class PixelFarm {
  constructor() {
    this.canvas = document.getElementById('farmCanvas');
    this.ctx = this.canvas.getContext('2d');

    // Game Economy
    this.coins = 30;
    this.wheatInventory = 0;
    this.seedCost = 2;
    this.sellPrice = 6;
    this.growDuration = 4; // 4 seconds to grow

    // Farm Plots Grid (3 rows x 3 cols = 9 plots to start)
    this.cols = 3;
    this.rows = 3;
    this.tileSize = 96;
    this.gap = 14;

    this.plots = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.plots.push({
          id: `${r}-${c}`,
          row: r,
          col: c,
          state: 'empty', // 'empty' | 'growing' | 'ripe'
          plantedAt: 0,
        });
      }
    }

    // Visual particles & floating texts
    this.floatingTexts = [];
    this.particles = [];

    // Interaction state
    this.hoveredPlot = null;
    this.lastTime = performance.now();

    this.init();
  }

  async init() {
    this.setupResize();
    this.setupInputs();
    this.setupUI();

    // Init SDK safely
    await sdk.init();
    await this.loadSave();

    // Auto-save every 5s
    setInterval(() => this.saveGame(), 5000);

    // Start render loop
    requestAnimationFrame((t) => this.loop(t));
  }

  setupResize() {
    const resize = () => {
      const container = this.canvas.parentElement;
      this.canvas.width = container.clientWidth;
      this.canvas.height = container.clientHeight;
      this.ctx.imageSmoothingEnabled = false;

      // Calculate grid top-left to center it perfectly
      const totalGridW = this.cols * this.tileSize + (this.cols - 1) * this.gap;
      const totalGridH = this.rows * this.tileSize + (this.rows - 1) * this.gap;
      this.gridStartX = Math.round((this.canvas.width - totalGridW) / 2);
      this.gridStartY = Math.round((this.canvas.height - totalGridH) / 2);
    };

    window.addEventListener('resize', resize);
    resize();
  }

  setupInputs() {
    const getPlotAtPos = (x, y) => {
      for (const plot of this.plots) {
        const px = this.gridStartX + plot.col * (this.tileSize + this.gap);
        const py = this.gridStartY + plot.row * (this.tileSize + this.gap);
        if (x >= px && x <= px + this.tileSize && y >= py && y <= py + this.tileSize) {
          return { plot, px, py };
        }
      }
      return null;
    };

    const handleClick = (clientX, clientY) => {
      sound.ensureContext();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;

      const hit = getPlotAtPos(mouseX, mouseY);
      if (hit) {
        this.onPlotClick(hit.plot, hit.px, hit.py);
      }
    };

    this.canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); handleClick(e.clientX, e.clientY); });

    // Track mouse hover
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const hit = getPlotAtPos(mouseX, mouseY);
      this.hoveredPlot = hit ? hit.plot : null;
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredPlot = null;
    });
  }

  onPlotClick(plot, px, py) {
    const centerX = px + this.tileSize / 2;
    const centerY = py + this.tileSize / 2;

    // 1. Plot is empty: Plant seeds!
    if (plot.state === 'empty') {
      if (this.coins < this.seedCost) {
        sound.playClick();
        this.addFloatingText(centerX, centerY, `НЕТ МОНЕТ! (${this.seedCost})`, '#ff4d4d');
        return;
      }

      this.coins -= this.seedCost;
      plot.state = 'growing';
      plot.plantedAt = Date.now();

      sound.playPlant();
      this.addFloatingText(centerX, centerY, `-💰${this.seedCost}`, '#ffde59');
      this.spawnDirtParticles(centerX, centerY);
      this.updateUI();
      return;
    }

    // 2. Crop is Ripe: Harvest it!
    if (plot.state === 'ripe') {
      plot.state = 'empty';
      plot.plantedAt = 0;
      this.wheatInventory += 1;

      sound.playHarvest();
      this.addFloatingText(centerX, centerY, `+1 🌾`, '#7bed9f');
      this.spawnHarvestParticles(centerX, centerY);
      this.updateUI();
      return;
    }

    // 3. Crop is still growing
    if (plot.state === 'growing') {
      const elapsed = (Date.now() - plot.plantedAt) / 1000;
      const left = Math.ceil(Math.max(0, this.growDuration - elapsed));
      sound.playClick();
      this.addFloatingText(centerX, centerY, `РАСТЁТ... ${left}c`, '#ffffff');
    }
  }

  setupUI() {
    const sellBtn = document.getElementById('sellBtn');
    if (sellBtn) {
      sellBtn.addEventListener('click', () => {
        sound.ensureContext();
        if (this.wheatInventory <= 0) {
          sound.playClick();
          this.addFloatingText(this.canvas.width / 2, this.canvas.height / 2, 'НЕТ УРОЖАЯ ДЛЯ ПРОДАЖИ!', '#ff4d4d');
          return;
        }

        const totalEarned = this.wheatInventory * this.sellPrice;
        this.coins += totalEarned;
        const soldCount = this.wheatInventory;
        this.wheatInventory = 0;

        sound.playSell();
        this.addFloatingText(this.canvas.width / 2, this.canvas.height / 2 - 40, `ПРОДАНО: +💰${totalEarned}`, '#ffde59', 18);
        this.spawnHarvestParticles(this.canvas.width / 2, this.canvas.height / 2 - 40);
        this.updateUI();
        this.saveGame();
      });
    }

    this.updateUI();
  }

  updateUI() {
    const coinsEl = document.getElementById('coinsVal');
    const cropEl = document.getElementById('cropCountVal');
    if (coinsEl) coinsEl.textContent = this.coins;
    if (cropEl) cropEl.textContent = `${this.wheatInventory} 🌾`;
  }

  saveGame() {
    const data = {
      coins: this.coins,
      wheatInventory: this.wheatInventory,
      plots: this.plots.map(p => ({
        id: p.id,
        state: p.state,
        plantedAt: p.plantedAt
      }))
    };
    sdk.saveData(data);
  }

  async loadSave() {
    const saved = await sdk.loadData();
    if (!saved) return;
    if (typeof saved.coins === 'number') this.coins = saved.coins;
    if (typeof saved.wheatInventory === 'number') this.wheatInventory = saved.wheatInventory;
    if (Array.isArray(saved.plots)) {
      saved.plots.forEach(sp => {
        const p = this.plots.find(pl => pl.id === sp.id);
        if (p) {
          p.state = sp.state;
          p.plantedAt = sp.plantedAt;
        }
      });
    }
    this.updateUI();
  }

  addFloatingText(x, y, text, color = '#fff', size = 12) {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      size,
      alpha: 1,
      vy: -1.0,
      life: 0
    });
  }

  spawnDirtParticles(x, y) {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        color: Math.random() > 0.5 ? '#5c3c24' : '#855832',
        size: 3 + Math.floor(Math.random() * 3),
        alpha: 1
      });
    }
  }

  spawnHarvestParticles(x, y) {
    const colors = ['#f4d03f', '#e67e22', '#7bed9f', '#ffffff'];
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: 4 + Math.floor(Math.random() * 3),
        alpha: 1
      });
    }
  }

  loop(currentTime) {
    const dt = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    const now = Date.now();

    // Check crop growth
    this.plots.forEach(plot => {
      if (plot.state === 'growing') {
        const elapsed = (now - plot.plantedAt) / 1000;
        if (elapsed >= this.growDuration) {
          plot.state = 'ripe';
          sound.playTone(520, 'sine', 0.08, 0.08);
        }
      }
    });

    // Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.life += dt;
      if (ft.life > 0.5) {
        ft.alpha -= dt * 1.8;
      }
      if (ft.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12; // gravity
      p.alpha -= dt * 1.5;
      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw pasture background with pixel details
    this.drawBackground();

    // Draw plots
    this.plots.forEach(plot => {
      const px = this.gridStartX + plot.col * (this.tileSize + this.gap);
      const py = this.gridStartY + plot.row * (this.tileSize + this.gap);
      const isHovered = this.hoveredPlot === plot;
      this.drawPixelPlot(plot, px, py, isHovered);
    });

    // Draw particles
    this.particles.forEach(p => {
      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, p.alpha);
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      this.ctx.restore();
    });

    // Draw floating texts
    this.floatingTexts.forEach(ft => {
      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, ft.alpha);
      this.ctx.font = `${ft.size}px 'Press Start 2P', monospace`;
      this.ctx.textAlign = 'center';
      this.ctx.fillStyle = '#000000';
      this.ctx.fillText(ft.text, Math.round(ft.x) + 2, Math.round(ft.y) + 2);
      this.ctx.fillStyle = ft.color;
      this.ctx.fillText(ft.text, Math.round(ft.x), Math.round(ft.y));
      this.ctx.restore();
    });
  }

  drawBackground() {
    // Cozy light pasture background
    this.ctx.fillStyle = '#6eb767';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Light clover/grass pixel blades
    this.ctx.fillStyle = '#83c57d';
    const step = 36;
    for (let x = 0; x < this.canvas.width; x += step) {
      for (let y = 0; y < this.canvas.height; y += step) {
        if ((x + y) % 72 === 0) {
          this.ctx.fillRect(x + 6, y + 6, 4, 3);
          this.ctx.fillRect(x + 10, y + 9, 3, 4);
        }
      }
    }

    // Cute tiny pixel flowers (daisies & forget-me-nots)
    const flowerStep = 120;
    for (let fx = 20; fx < this.canvas.width; fx += flowerStep) {
      for (let fy = 20; fy < this.canvas.height; fy += flowerStep) {
        const ox = (fx * 17) % 60;
        const oy = (fy * 23) % 60;
        const x = fx + ox;
        const y = fy + oy;

        if ((fx + fy) % 240 === 0) {
          // White Daisy
          this.ctx.fillStyle = '#ffffff';
          this.ctx.fillRect(x - 2, y, 6, 2);
          this.ctx.fillRect(x, y - 2, 2, 6);
          this.ctx.fillStyle = '#ffd166';
          this.ctx.fillRect(x, y, 2, 2);
        } else if ((fx + fy) % 180 === 0) {
          // Blue flower
          this.ctx.fillStyle = '#70a1ff';
          this.ctx.fillRect(x - 1, y - 1, 4, 4);
          this.ctx.fillStyle = '#fff9db';
          this.ctx.fillRect(x, y, 2, 2);
        }
      }
    }
  }

  drawPixelPlot(plot, x, y, isHovered) {
    const s = this.tileSize;

    // 1. Warm Wooden Outer Border
    this.ctx.fillStyle = '#5c381e';
    this.ctx.fillRect(x, y, s, s);

    this.ctx.fillStyle = '#8d5b36';
    this.ctx.fillRect(x + 3, y + 3, s - 6, s - 6);

    // Warm wood highlight on top edge
    this.ctx.fillStyle = '#b0784a';
    this.ctx.fillRect(x + 3, y + 3, s - 6, 3);

    // 2. Inner Warm Fertile Soil
    this.ctx.fillStyle = '#9c6644';
    this.ctx.fillRect(x + 7, y + 7, s - 14, s - 14);

    // 3. Pixel Soil Furrows (horizontal rows)
    this.ctx.fillStyle = '#7f4f24';
    const rowH = 13;
    for (let ry = y + 12; ry < y + s - 14; ry += rowH) {
      this.ctx.fillRect(x + 9, ry, s - 18, 4);
      // Warm loam highlight specks
      this.ctx.fillStyle = '#b08968';
      this.ctx.fillRect(x + 14, ry - 3, 4, 3);
      this.ctx.fillRect(x + s - 26, ry - 3, 5, 3);
      this.ctx.fillStyle = '#7f4f24';
    }

    // 4. Hover highlight
    if (isHovered) {
      this.ctx.strokeStyle = '#fff3b0';
      this.ctx.lineWidth = 3;
      this.ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
    }

    // 5. Draw Content by State
    const cx = x + s / 2;
    const cy = y + s / 2;

    if (plot.state === 'empty') {
      // Empty plot indicator: cozy birch wood badge
      const btnW = 76;
      const btnH = 34;
      const btnX = Math.round(cx - btnW / 2);
      const btnY = Math.round(cy - btnH / 2);

      // Pixel box background
      this.ctx.fillStyle = '#5c381e';
      this.ctx.fillRect(btnX - 2, btnY - 2, btnW + 4, btnH + 4);
      this.ctx.fillStyle = isHovered ? '#fffdf7' : '#faedcd';
      this.ctx.fillRect(btnX, btnY, btnW, btnH);

      this.ctx.fillStyle = '#4a3525';
      this.ctx.font = "9px 'Press Start 2P', monospace";
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('ПОСАДИТЬ', cx, btnY + 11);

      this.ctx.fillStyle = '#d48b00';
      this.ctx.font = "8px 'Press Start 2P', monospace";
      this.ctx.fillText(`💰 ${this.seedCost}`, cx, btnY + 23);
    } else if (plot.state === 'growing') {
      const elapsed = (Date.now() - plot.plantedAt) / 1000;
      const progress = Math.min(1, elapsed / this.growDuration);

      if (progress < 0.5) {
        // Stage 1: Little Green Sprout
        this.drawPixelSprout(cx, cy - 4);
      } else {
        // Stage 2: Half-grown Wheat Stalk
        this.drawPixelMidWheat(cx, cy - 4);
      }

      // "РАСТЁТ..." label
      this.ctx.fillStyle = '#c8d6e5';
      this.ctx.font = "7px 'Press Start 2P', monospace";
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('РАСТЁТ...', cx, y + s - 24);

      // Small pixel progress bar
      const barW = s - 28;
      const barH = 6;
      const barX = x + 14;
      const barY = y + s - 14;

      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      this.ctx.fillStyle = '#7bed9f';
      this.ctx.fillRect(barX, barY, Math.round(barW * progress), barH);
    } else if (plot.state === 'ripe') {
      // Stage 3: Full Ripe Golden Wheat - positioned in center-lower area
      const bob = Math.round(Math.sin(Date.now() / 140) * 3);
      this.drawPixelRipeWheat(cx, cy + 12 + bob);

      // Prominent "ЗАБРАТЬ" pixel badge at the top of the tile
      const badgeW = 74;
      const badgeH = 20;
      const badgeX = Math.round(cx - badgeW / 2);
      const badgeY = Math.round(y + 8);

      // Badge border & shadow
      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(badgeX - 2, badgeY - 2, badgeW + 4, badgeH + 4);
      // Bright green button background
      this.ctx.fillStyle = '#2ed573';
      this.ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      // Top highlight line
      this.ctx.fillStyle = '#7bed9f';
      this.ctx.fillRect(badgeX, badgeY, badgeW, 2);

      this.ctx.fillStyle = '#ffffff';
      this.ctx.font = "9px 'Press Start 2P', monospace";
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('ЗАБРАТЬ', cx, badgeY + badgeH / 2 + 1);
    }
  }

  // Pixel Sprites Drawing Routines
  drawPixelSprout(cx, cy) {
    const px = Math.round(cx);
    const py = Math.round(cy);

    // Stem
    this.ctx.fillStyle = '#2d6a4f';
    this.ctx.fillRect(px - 2, py - 4, 4, 12);

    // Left Leaf
    this.ctx.fillStyle = '#52b788';
    this.ctx.fillRect(px - 10, py - 6, 8, 4);
    this.ctx.fillRect(px - 8, py - 10, 6, 4);

    // Right Leaf
    this.ctx.fillRect(px + 2, py - 8, 8, 4);
    this.ctx.fillRect(px + 4, py - 12, 6, 4);
  }

  drawPixelMidWheat(cx, cy) {
    const px = Math.round(cx);
    const py = Math.round(cy);

    // Main stalk
    this.ctx.fillStyle = '#40916c';
    this.ctx.fillRect(px - 2, py - 14, 4, 22);

    // Side stems
    this.ctx.fillStyle = '#74c69d';
    this.ctx.fillRect(px - 12, py - 6, 10, 4);
    this.ctx.fillRect(px + 2, py - 10, 10, 4);

    // Yellow tips starting
    this.ctx.fillStyle = '#d8f3dc';
    this.ctx.fillRect(px - 4, py - 20, 8, 6);
  }

  drawPixelRipeWheat(cx, cy) {
    const px = Math.round(cx);
    const py = Math.round(cy);

    // Golden Stalks
    this.ctx.fillStyle = '#b7791f';
    this.ctx.fillRect(px - 3, py - 8, 6, 20);

    // Main Golden Ears (Pixel Cluster)
    this.ctx.fillStyle = '#f6e05e';
    this.ctx.fillRect(px - 8, py - 22, 16, 14);

    this.ctx.fillStyle = '#ecc94b';
    this.ctx.fillRect(px - 6, py - 26, 12, 6);
    this.ctx.fillRect(px - 10, py - 14, 20, 6);

    // Highlights
    this.ctx.fillStyle = '#fefcbf';
    this.ctx.fillRect(px - 4, py - 24, 4, 4);
    this.ctx.fillRect(px + 2, py - 18, 4, 4);
    this.ctx.fillRect(px - 6, py - 12, 4, 4);

    // Dark outlines
    this.ctx.fillStyle = '#744210';
    this.ctx.fillRect(px - 9, py - 23, 2, 12);
    this.ctx.fillRect(px + 7, py - 23, 2, 12);
  }
}

// Launch
window.addEventListener('DOMContentLoaded', () => {
  window.pixelFarm = new PixelFarm();
});
