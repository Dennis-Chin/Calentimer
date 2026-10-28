/**
 * cryptoPolyfill.js
 * 
 * Lightweight Web Crypto API subtle.digest('SHA-256') polyfill for Calentimer.
 * Ensures MSAL PKCE generation works reliably across all environments:
 * - Mobile browsers accessing local network IP (e.g. http://192.168.x.x:3000)
 * - Insecure HTTP contexts where window.crypto.subtle is disabled by browsers
 * - Older mobile WebViews and embedded browsers
 * Strictly zero optional chaining and zero nullish coalescing operators.
 */

export function ensureWebCryptoPolyfill(scope) {
  const target = scope || (typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
  if (!target) return null;

  // 1. Ensure target.crypto exists
  if (!target.crypto) {
    try {
      target.crypto = {};
    } catch (_) {}
  }

  // 2. Ensure target.crypto.getRandomValues exists
  if (target.crypto && typeof target.crypto.getRandomValues !== 'function') {
    const getRandomValuesPolyfill = function(array) {
      if (!array || !array.length) return array;
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    };

    try {
      Object.defineProperty(target.crypto, 'getRandomValues', {
        value: getRandomValuesPolyfill,
        configurable: true,
        writable: true,
        enumerable: true
      });
    } catch (_) {
      try {
        target.crypto.getRandomValues = getRandomValuesPolyfill;
      } catch (_2) {}
    }
  }

  // 3. Check if target.crypto.subtle && target.crypto.subtle.digest already exists
  if (target.crypto && target.crypto.subtle && typeof target.crypto.subtle.digest === 'function') {
    return target.crypto.subtle; // Native implementation is present and active
  }

  // 4. Pure JavaScript SHA-256 Algorithm
  function rotr(n, b) {
    return (n >>> b) | (n << (32 - b));
  }

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256Buffer(data) {
    let bytes;
    if (data instanceof Uint8Array) {
      bytes = data;
    } else if (data instanceof ArrayBuffer) {
      bytes = new Uint8Array(data);
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else if (typeof data === 'string') {
      const utf8 = [];
      for (let i = 0; i < data.length; i++) {
        let code = data.charCodeAt(i);
        if (code < 0x80) {
          utf8.push(code);
        } else if (code < 0x800) {
          utf8.push(0xc0 | (code >> 6));
          utf8.push(0x80 | (code & 0x3f));
        } else if (code < 0xd800 || code >= 0xe000) {
          utf8.push(0xe0 | (code >> 12));
          utf8.push(0x80 | ((code >> 6) & 0x3f));
          utf8.push(0x80 | (code & 0x3f));
        } else {
          i++;
          code = 0x10000 + (((code & 0x3ff) << 10) | (data.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (code >> 18));
          utf8.push(0x80 | ((code >> 12) & 0x3f));
          utf8.push(0x80 | ((code >> 6) & 0x3f));
          utf8.push(0x80 | (code & 0x3f));
        }
      }
      bytes = new Uint8Array(utf8);
    } else {
      bytes = new Uint8Array(0);
    }

    const bitLength = bytes.length * 8;
    const newByteLength = ((bytes.length + 9 + 63) >> 6) << 6;
    const padded = new Uint8Array(newByteLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;

    const view = new DataView(padded.buffer);
    const highBits = Math.floor(bitLength / 0x100000000);
    const lowBits = (bitLength & 0xffffffff) >>> 0;
    view.setUint32(newByteLength - 8, highBits, false);
    view.setUint32(newByteLength - 4, lowBits, false);

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const W = new Uint32Array(64);

    for (let offset = 0; offset < newByteLength; offset += 64) {
      for (let t = 0; t < 16; t++) {
        W[t] = view.getUint32(offset + (t * 4), false);
      }
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;

      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ ((~e) & g);
        const temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) | 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) | 0;
      }

      h0 = (h0 + a) | 0;
      h1 = (h1 + b) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;
      h5 = (h5 + f) | 0;
      h6 = (h6 + g) | 0;
      h7 = (h7 + h) | 0;
    }

    const outBuffer = new ArrayBuffer(32);
    const outView = new DataView(outBuffer);
    outView.setUint32(0, h0, false);
    outView.setUint32(4, h1, false);
    outView.setUint32(8, h2, false);
    outView.setUint32(12, h3, false);
    outView.setUint32(16, h4, false);
    outView.setUint32(20, h5, false);
    outView.setUint32(24, h6, false);
    outView.setUint32(28, h7, false);

    return outBuffer;
  }

  const subtlePolyfill = {
    digest: function(algorithm, data) {
      return new Promise(function(resolve, reject) {
        try {
          const algoName = (typeof algorithm === 'string')
            ? algorithm.toUpperCase()
            : (algorithm && algorithm.name ? algorithm.name.toUpperCase() : '');
          if (algoName !== 'SHA-256' && algoName !== 'SHA256') {
            reject(new Error('SubtleCrypto polyfill only supports SHA-256'));
            return;
          }
          const hashBuffer = sha256Buffer(data);
          resolve(hashBuffer);
        } catch (err) {
          reject(err);
        }
      });
    }
  };

  let subtleInstalled = false;

  // Attempt 1: Direct Object.defineProperty on target.crypto
  if (target.crypto) {
    try {
      Object.defineProperty(target.crypto, 'subtle', {
        value: subtlePolyfill,
        configurable: true,
        writable: true,
        enumerable: true
      });
      if (target.crypto.subtle === subtlePolyfill) {
        subtleInstalled = true;
      }
    } catch (_) {}
  }

  // Attempt 2: Override prototype getter on Crypto.prototype if direct define failed
  if (!subtleInstalled) {
    try {
      const proto = (target.Crypto && target.Crypto.prototype)
        ? target.Crypto.prototype
        : (target.crypto ? Object.getPrototypeOf(target.crypto) : null);
      if (proto) {
        Object.defineProperty(proto, 'subtle', {
          get: function() { return subtlePolyfill; },
          set: function(val) { subtlePolyfill = val; },
          configurable: true,
          enumerable: true
        });
        if (target.crypto && target.crypto.subtle) {
          subtleInstalled = true;
        }
      }
    } catch (_) {}
  }

  // Attempt 3: Direct assignment if target.crypto is a plain object
  if (!subtleInstalled && target.crypto) {
    try {
      target.crypto.subtle = subtlePolyfill;
      if (target.crypto.subtle === subtlePolyfill) {
        subtleInstalled = true;
      }
    } catch (_) {}
  }

  // Attempt 4: Wrap/proxy target.crypto
  if (!subtleInstalled) {
    try {
      const baseCrypto = target.crypto || {};
      const proxiedCrypto = Object.create(baseCrypto);
      proxiedCrypto.subtle = subtlePolyfill;
      if (typeof proxiedCrypto.getRandomValues !== 'function' && typeof baseCrypto.getRandomValues === 'function') {
        proxiedCrypto.getRandomValues = function(arr) { return baseCrypto.getRandomValues(arr); };
      }
      Object.defineProperty(target, 'crypto', {
        value: proxiedCrypto,
        configurable: true,
        writable: true,
        enumerable: true
      });
      if (target.crypto && target.crypto.subtle) {
        subtleInstalled = true;
      }
    } catch (_) {}
  }

  return subtlePolyfill;
}

// Auto-run polyfill check on load in browser environments
if (typeof window !== 'undefined') {
  window.ensureWebCryptoPolyfill = ensureWebCryptoPolyfill;
  ensureWebCryptoPolyfill(window);
}
if (typeof globalThis !== 'undefined') {
  globalThis.ensureWebCryptoPolyfill = ensureWebCryptoPolyfill;
}

export default ensureWebCryptoPolyfill;
