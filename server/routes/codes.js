import express from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import { validateAndNormalizeUrl } from '../utils/urlValidator.js';
import { generateUniqueCode } from '../utils/codeGenerator.js';
import { resolvePreset, buildCustomPreset, PROCTORING_PRESETS } from '../../src/engine/proctoringPresets.js';

export const codesRouter = express.Router();

// Resolve the proctoring preset selection from a create request body into a
// storable { preset_id, preset_config } pair, or an { error }.
function resolvePresetInput(body) {
  const { preset, presetId, proctoringLevel, custom } = body || {};
  const requested = presetId || proctoringLevel || preset || 'level-2';

  // A full custom profile object, or the 'custom' id carrying overrides.
  if (requested === 'custom' || (typeof requested === 'object' && requested !== null)) {
    const overrides = typeof requested === 'object' && requested !== null ? requested : (custom || {});
    const baseId = overrides.baseId || 'level-2';
    const built = buildCustomPreset(baseId, overrides);
    if (!built.ok) {
      return { error: `Invalid custom preset: ${built.errors.join('; ')}` };
    }
    return { preset_id: 'custom', preset_config: JSON.stringify(built.preset) };
  }

  if (typeof requested !== 'string' || !PROCTORING_PRESETS[requested]) {
    return { error: `Unknown proctoring preset "${requested}". Expected level-1, level-2, level-3 or custom.` };
  }
  const resolved = resolvePreset(requested);
  return { preset_id: resolved.id, preset_config: JSON.stringify(resolved) };
}

codesRouter.post('/', async (req, res, next) => {
  try {
    const { url, expires_at, expiresAt, created_by, createdBy } = req.body || {};

    const validation = validateAndNormalizeUrl(url);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const presetResult = resolvePresetInput(req.body);
    if (presetResult.error) {
      return res.status(400).json({ error: presetResult.error });
    }

    const normalizedUrl = validation.url;
    const finalExpiresAt = expiresAt || expires_at || null;
    const finalCreatedBy = createdBy || created_by || null;

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
      preset_id: presetResult.preset_id,
      preset_config: presetResult.preset_config,
    });

    const resolvedPreset = JSON.parse(presetResult.preset_config);

    return res.status(201).json({
      code,
      url: normalizedUrl,
      status: 'active',
      createdAt,
      expiresAt: finalExpiresAt,
      presetId: presetResult.preset_id,
      preset: resolvedPreset,
    });
  } catch (err) {
    next(err);
  }
});

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

    if (record.status === 'revoked') {
      return res.status(410).json({
        error: 'This test code has been revoked.',
        status: 'revoked',
      });
    }

    if (record.status === 'expired' || (record.expires_at && new Date(record.expires_at) <= new Date())) {
      if (record.status !== 'expired') {
        await db('codes').where({ id: record.id }).update({ status: 'expired' });
      }
      return res.status(410).json({
        error: 'This test code has expired.',
        status: 'expired',
      });
    }

    await db('codes').where({ id: record.id }).increment('hit_count', 1);

    return res.json({
      code: record.code,
      url: record.target_url,
      status: record.status,
      presetId: record.preset_id || 'level-2',
      preset: record.preset_config ? JSON.parse(record.preset_config) : resolvePreset('level-2'),
    });
  } catch (err) {
    next(err);
  }
});

codesRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const status = req.query.status;

    let query = db('codes').select('code', 'target_url', 'status', 'created_at', 'expires_at', 'hit_count', 'preset_id');

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
      presetId: row.preset_id || 'level-2',
    }));

    return res.json(result);
  } catch (err) {
    next(err);
  }
});

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
