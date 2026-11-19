// Yandex Games SDK Bridge
export class YandexSDK {
  constructor() {
    this.ysdk = null;
    this.player = null;
    this.isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }

  async init() {
    // If running locally, don't attempt calling YaGames.init() which hangs/fails outside Yandex iframe
    if (this.isLocal) {
      console.log('[SDK] Running locally on localhost -> using Local Mock');
      return;
    }

    if (typeof window.YaGames !== 'undefined') {
      try {
        this.ysdk = await Promise.race([
          window.YaGames.init(),
          new Promise((_, reject) => setTimeout(() => reject('timeout'), 2000))
        ]);

        if (this.ysdk?.features?.LoadingAPI) {
          this.ysdk.features.LoadingAPI.ready();
        }

        try {
          this.player = await this.ysdk.getPlayer({ scopes: false });
        } catch (e) {}
      } catch (e) {
        console.warn('[SDK] Init bypassed:', e);
      }
    }
  }

  async saveData(data) {
    try {
      localStorage.setItem('pixel_farm_save', JSON.stringify(data));
    } catch (e) {}

    if (this.player) {
      try {
        await this.player.setData(data, true);
      } catch (e) {}
    }
  }

  async loadData() {
    if (this.player) {
      try {
        const cloudData = await this.player.getData();
        if (cloudData && Object.keys(cloudData).length > 0) return cloudData;
      } catch (e) {}
    }

    try {
      const local = localStorage.getItem('pixel_farm_save');
      if (local) return JSON.parse(local);
    } catch (e) {}

    return null;
  }
}

export const sdk = new YandexSDK();
