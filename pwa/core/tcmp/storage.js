const KEY = 'tango-cifrado:tcmp-config';

export function loadTCMPConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : { baseUrl: '', userId: '', deviceId: '', deviceToken: '' };
  } catch {
    return { baseUrl: '', userId: '', deviceId: '', deviceToken: '' };
  }
}

export function saveTCMPConfig(config) {
  localStorage.setItem(KEY, JSON.stringify(config));
}

export function clearTCMPConfig() {
  localStorage.removeItem(KEY);
}
