import Constants from 'expo-constants';

const extraUrl = Constants.expoConfig?.extra?.apiUrl;
const fromExtra = typeof extraUrl === 'string' && extraUrl.trim() ? extraUrl.trim() : undefined;

/** Production API. Never fall back to localhost inside a phone APK. */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || fromExtra || 'https://bmf-bot-api.onrender.com/api';
