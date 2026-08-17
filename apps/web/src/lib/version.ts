// アプリバージョン。実体はモノレポルートの package.json の version で、
// vite.config.ts の define（__APP_VERSION__）でビルド時に埋め込まれる。
// dev / build のどちらでも置換されるが、万一置換されなかった場合は 'dev' を返す。
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
