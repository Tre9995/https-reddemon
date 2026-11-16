
import crypto from 'node:crypto';

const KEY = process.env.REDDemon_TOKEN_ENCRYPTION_KEY ||
  process.env.REDDEMON_TOKEN_ENCRYPTION_KEY;

function getKey() {
  if (!KEY || !/^[0-9a-fA-F]{64}$/.test(KEY)) {
    throw new Error('A valid 64-character encryption key is required.');
  }

  return Buffer.from(KEY, 'hex');
}

export function encryptSecret(value) {
  if (typeof value !== 'string' || !value) {
    throw new Error('A non-empty secret is required.');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('hex'),
    tag.toString('hex'),
    encrypted.toString('hex')
  ].join(':');
}

export function decryptSecret(value) {
  if (typeof value !== 'string') {
    throw new Error('Invalid encrypted secret.');
  }

  const parts = value.split(':');

  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted secret format.');
  }

  const [, ivHex, tagHex, encryptedHex] = parts;

  if (
    !/^[0-9a-f]{24}$/i.test(ivHex) ||
    !/^[0-9a-f]{32}$/i.test(tagHex) ||
    !/^(?:[0-9a-f]{2})+$/i.test(encryptedHex)
  ) {
    throw new Error('Invalid encrypted secret data.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivHex, 'hex')
  );

  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}
