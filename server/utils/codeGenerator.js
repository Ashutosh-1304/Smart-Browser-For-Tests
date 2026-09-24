import crypto from 'crypto';

// 32-character unambiguous charset: A-Z + 2-9 excluding 0, O, 1, I, L
export const CODE_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;

/**
 * Generate a random 6-character code from the unambiguous charset.
 * @returns {string}
 */
export function generateCandidateCode() {
  let result = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const idx = crypto.randomInt(0, CODE_CHARSET.length);
    result += CODE_CHARSET[idx];
  }
  return result;
}

/**
 * Generates a unique 6-character code with database collision retry.
 *
 * @param {import('knex').Knex} db
 * @param {number} maxRetries
 * @returns {Promise<string>}
 */
export async function generateUniqueCode(db, maxRetries = 10) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const candidate = generateCandidateCode();
    const existing = await db('codes').where({ code: candidate }).first();
    if (!existing) {
      return candidate;
    }
  }
  throw new Error('Failed to generate unique test code after multiple retries.');
}
