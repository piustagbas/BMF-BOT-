const appJson = require('./app.json');

const apiUrl =
  process.env.EXPO_PUBLIC_API_URL?.trim() ||
  appJson.expo.extra?.apiUrl ||
  'https://bmf-bot-api.onrender.com/api';

module.exports = {
  ...appJson.expo,
  extra: {
    ...appJson.expo.extra,
    apiUrl,
  },
};
