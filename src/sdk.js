// Yandex Games SDK Bridge
export class YandexSDK {
  constructor() {
    this.ysdk = null;
    this.player = null;
    this.lang = 'ru'; // язык интерфейса от платформы
    this.isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }

  async init() {
    // Локально YaGames.init() не отвечает вне окна Яндекса, поэтому используем заглушку
    if (this.isLocal) {
      console.log('[SDK] Running locally on localhost -> using Local Mock');
      return;
    }

    if (typeof window.YaGames !== 'undefined') {
      try {
        // Запас 8 секунд, чтобы игра не зависла, если запущена не на Яндексе
        this.ysdk = await Promise.race([
          window.YaGames.init(),
          new Promise((_, reject) => setTimeout(() => reject('timeout'), 8000))
        ]);

        // Язык определяем при запуске (требование модерации)
        try {
          this.lang = this.ysdk.environment.i18n.lang || 'ru';
        } catch (e) {}

        try {
          this.player = await this.ysdk.getPlayer({ scopes: false });
        } catch (e) {}
      } catch (e) {
        console.warn('[SDK] Init bypassed:', e);
      }
    }
  }

  // Сообщаем платформе, что игра загружена и можно играть (вызывать после загрузки сохранения)
  gameReady() {
    try {
      if (this.ysdk && this.ysdk.features && this.ysdk.features.LoadingAPI) {
        this.ysdk.features.LoadingAPI.ready();
      }
    } catch (e) {}
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