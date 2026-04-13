const path = require('path');

module.exports = {
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ar', 'fr'],
  },
  localePath: path.resolve('./public/locales'),
  ns: ['common'],
  defaultNS: 'common',
  backend: {
    loadPath: './public/locales/{{lng}}/{{ns}}.json',
  },
  detection: {
    order: ['localStorage', 'cookie', 'navigator'],
    caches: ['localStorage', 'cookie'],
  },
};
