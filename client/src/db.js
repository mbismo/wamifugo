// localStorage cache — used as offline fallback when server is unreachable
const PREFIX = 'wm_';

export const db = {
  get: (key, def = null) => {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v ? JSON.parse(v) : def;
    } catch {
      return def;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {}
  },
  remove: (key) => {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {}
  },
};
