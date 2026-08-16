import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * `promisify(scrypt)` resolves to the three-argument overload, which cannot carry the
 * cost parameters. Wrapping it by hand keeps `options` — and therefore the whole point
 * of choosing scrypt — available.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Password hashing with scrypt.
 *
 * scrypt is a memory-hard KDF standardised in RFC 7914 and built into Node's crypto
 * module. Choosing it over argon2/bcrypt is a deliberate trade: those require native
 * compilation, which is a recurring source of broken Docker builds and supply-chain
 * surface, and the security difference at these parameters is not the weak link in this
 * system. The parameters below follow current OWASP guidance (N=2^16, r=8, p=1) and
 * cost roughly 100 ms per hash on a typical server.
 *
 * The stored format is self-describing:
 *   scrypt$N$r$p$<salt base64url>$<hash base64url>
 * so the cost can be raised later and old hashes still verify — and be upgraded
 * transparently on the user's next successful login.
 */
@Injectable()
export class PasswordService {
  private readonly N = 2 ** 16;
  private readonly r = 8;
  private readonly p = 1;
  private readonly keyLength = 64;
  private readonly saltLength = 16;

  async hash(password: string): Promise<string> {
    const salt = randomBytes(this.saltLength);
    const derived = await scryptAsync(password.normalize('NFKC'), salt, this.keyLength, {
      N: this.N,
      r: this.r,
      p: this.p,
      // scrypt's memory need is roughly 128 × N × r bytes; the default 32 MB cap is
      // below what these parameters require, so it is raised explicitly.
      maxmem: 256 * this.N * this.r,
    });

    return [
      'scrypt',
      this.N,
      this.r,
      this.p,
      salt.toString('base64url'),
      derived.toString('base64url'),
    ].join('$');
  }

  /**
   * Verifies a password. Returns false rather than throwing on a malformed hash so a
   * corrupted row cannot be used to distinguish accounts.
   */
  async verify(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
    const N = Number(nRaw);
    const r = Number(rRaw);
    const p = Number(pRaw);

    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    // Refuse absurd parameters from a tampered row rather than allocating gigabytes.
    if (N > 2 ** 20 || r > 32 || p > 16) return false;

    let expected: Buffer;
    try {
      expected = Buffer.from(hashRaw ?? '', 'base64url');
    } catch {
      return false;
    }
    if (expected.length === 0) return false;

    const salt = Buffer.from(saltRaw ?? '', 'base64url');
    const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * N * r,
    });

    // Constant-time comparison: a length check first, since timingSafeEqual throws on
    // mismatched lengths.
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  }

  /** True when a stored hash uses weaker parameters than the current policy. */
  needsRehash(stored: string): boolean {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
    return Number(parts[1]) < this.N || Number(parts[2]) < this.r;
  }
}
