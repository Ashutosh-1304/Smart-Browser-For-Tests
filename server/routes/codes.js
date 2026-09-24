import express from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { validateAndNormalizeUrl } from '../utils/urlValidator.js';
import { generateUniqueCode } from '../utils/codeGenerator.js';

export const codesRouter = express.Router();

/**
 * POST /api/codes
 * Create a new test code for a given assessment URL.
 */
codesRouter.post('/', async (req, res, next) => {
  try {
    const { url, expires_at, expiresAt, created_by, createdBy } = req.body || {};

    const validation = validateAndNormalizeUrl(url);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const normalizedUrl = validation.url;
    const finalExpiresAt = expiresAt || expires_at || null;
    const finalCreatedBy = createdBy || created_by || null;

    // Optional expiration validation
    if (finalExpiresAt) {
      const expDate = new Date(finalExpiresAt);
      if (isNaN(expDate.getTime())) {
        return res.status(400).json({ error: 'Invalid expires_at timestamp.' });
      }
      if (expDate <= new Date()) {
        return res.status(400).json({ error: 'expires_at must be in the future.' });
      }
    }

    const code = await generateUniqueCode(db);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await db('codes').insert({
      id,
      code,
      target_url: normalizedUrl,
      created_at: createdAt,
      expires_at: finalExpiresAt,
      status: 'active',
      hit_count: 0,
      created_by: finalCreatedBy,
    });

    return res.status(201).json({
      code,
      url: normalizedUrl,
      status: 'active',
      createdAt,
      expiresAt: finalExpiresAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/codes/:code
 * Resolves a test code to its target URL. Increments hit_count.
 */
codesRouter.get('/:code', async (req, res, next) => {
  try {
    const rawCode = req.params.code;
    if (!rawCode || typeof rawCode !== 'string') {
      return res.status(400).json({ error: 'Code is required.' });
    }

    const normalizedCode = rawCode.trim().toUpperCase();

    const record = await db('codes').where({ code: normalizedCode }).first();

    if (!record) {
      return res.status(404).json({ error: 'Test code not found.' });
    }

    // Check revocation
    if (record.status === 'revoked') {
      return res.status(410).json({
        error: 'This test code has been revoked.',
        status: 'revoked',
      });
    }

    // Check expiration
    if (record.status === 'expired' || (record.expires_at && new Date(record.expires_at) <= new Date())) {
      if (record.status !== 'expired') {
        await db('codes').where({ id: record.id }).update({ status: 'expired' });
      }
      return res.status(410).json({
        error: 'This test code has expired.',
        status: 'expired',
      });
    }

    // Increment hit_count
    await db('codes').where({ id: record.id }).increment('hit_count', 1);

    return res.json({
      code: record.code,
      url: record.target_url,
      status: record.status,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/codes
 * Lists recent codes (sanitized for website history / teacher view).
 */
codesRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const status = req.query.status;

    let query = db('codes').select('code', 'target_url', 'status', 'created_at', 'expires_at', 'hit_count');

    if (status) {
      query = query.where({ status });
    }

    const rows = await query.orderBy('created_at', 'desc').limit(limit);

    const result = rows.map((row) => ({
      code: row.code,
      url: row.target_url,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      hitCount: row.hit_count,
    }));

    return res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/codes/:code/revoke
 * Mark a code as revoked.
 */
codesRouter.post('/:code/revoke', async (req, res, next) => {
  try {
    const rawCode = req.params.code;
    if (!rawCode || typeof rawCode !== 'string') {
      return res.status(400).json({ error: 'Code is required.' });
    }

    const normalizedCode = rawCode.trim().toUpperCase();

    const record = await db('codes').where({ code: normalizedCode }).first();

    if (!record) {
      return res.status(404).json({ error: 'Test code not found.' });
    }

    await db('codes').where({ id: record.id }).update({ status: 'revoked' });

    return res.json({
      code: normalizedCode,
      status: 'revoked',
      message: 'Test code has been revoked.',
    });
  } catch (err) {
    next(err);
  }
});
