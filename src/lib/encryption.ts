import CryptoJS from 'crypto-js';

const FIXED_SALT = 'presensi.pin.salt.v1';

// APP_SECRET diambil murni dari env variable VITE_APP_SECRET (GitHub Secret / .env).
const APP_SECRET: string =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_APP_SECRET) || '';

// Kunci enkripsi layered untuk payload login (Vigenere-like).
// Diambil dari env variable VITE_PAYLOAD_KEY jika tersedia.
export const PAYLOAD_ENCRYPTION_KEY: string =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_PAYLOAD_KEY) || '';

export const hashPinLayered = (pin: string): string => {
  // Layered hash tanpa bcrypt (offline/local)
  const layer1 = CryptoJS.SHA256(`${FIXED_SALT}:${pin}`).toString();
  const layer2 = CryptoJS.SHA256(layer1).toString();
  const layer3 = CryptoJS.SHA256(`${layer2}:${FIXED_SALT}`).toString();
  return `sha256$${layer3}`;
};

export const verifyPinLayered = (pin: string, hashFromDb: string): boolean => {
  try {
    if (!hashFromDb) return false;
    const computed = hashPinLayered(pin);
    if (computed === hashFromDb) return true;
    // fallback: direct compare for legacy/plain values
    return hashFromDb === pin;
  } catch {
    return false;
  }
};

export const decryptAppCredential = (encryptedText: string): string => {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, APP_SECRET);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return '';
  }
};

export const encryptAppCredential = (text: string): string => {
  return CryptoJS.AES.encrypt(text, APP_SECRET).toString();
};

/**
 * Enkripsi objek JSON menggunakan layered encoding:
 * Layer 1: Vigenere-like char shift dengan PAYLOAD_ENCRYPTION_KEY
 * Layer 2: UTF-8 → Base64
 * Layer 3: Reverse + salt markers ENC$...$SEC
 */
export function encryptPayload(data: Record<string, any>): string {
  const jsonStr = JSON.stringify(data);
  const key = PAYLOAD_ENCRYPTION_KEY;

  // Layer 1
  let layer1 = '';
  for (let i = 0; i < jsonStr.length; i++) {
    const shifted = (jsonStr.charCodeAt(i) + key.charCodeAt(i % key.length)) % 65536;
    layer1 += String.fromCharCode(shifted);
  }

  // Layer 2
  const utf8Bytes = new TextEncoder().encode(layer1);
  let binary = '';
  for (let i = 0; i < utf8Bytes.byteLength; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  const layer2 = btoa(binary);

  // Layer 3
  return 'ENC$' + layer2.split('').reverse().join('') + '$SEC';
}

/**
 * Dekripsi string yang dihasilkan oleh encryptPayload.
 * Mengembalikan objek JSON atau {} jika gagal.
 */
export function decryptPayload(encryptedStr: string): Record<string, any> {
  if (!encryptedStr || !encryptedStr.startsWith('ENC$') || !encryptedStr.endsWith('$SEC')) {
    try { return JSON.parse(encryptedStr); } catch { return {}; }
  }

  try {
    const key = PAYLOAD_ENCRYPTION_KEY;
    const cleaned = encryptedStr.substring(4, encryptedStr.length - 4);
    const layer2  = cleaned.split('').reverse().join('');
    const binary  = atob(layer2);
    const bytes   = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const layer1  = new TextDecoder().decode(bytes);

    let jsonStr = '';
    for (let i = 0; i < layer1.length; i++) {
      const unshifted = (layer1.charCodeAt(i) - key.charCodeAt(i % key.length) + 65536) % 65536;
      jsonStr += String.fromCharCode(unshifted);
    }
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('Gagal melakukan dekripsi payload:', e);
    return {};
  }
}
