import express from 'express';
import crypto from 'crypto';
import { db } from '../db.js';
import {
  calculateNormalizedScore,
  determineSessionStatus,
  NORMALIZATION_RULES,
  PLATFORM_CHOICES,
} from '../utils/scoreNormalizer.js';
import { resolvePreset } from '../../src/engine/proctoringPresets.js';

export const sessionsRouter = express.Router();

sessionsRouter.get('/metadata', (_req, res) => {
  return res.json({
    rules: NORMALIZATION_RULES,
    platforms: PLATFORM_CHOICES,
  });
});

sessionsRouter.post('/', async (req, res, next) => {
  try {
    const {
      code,
      studentName,
      student_name,
      studentId,
      student_id,
      studentEmail,
      student_email,
      rawScore,
      raw_score,
      fairnessScore,
      fairness_score,
      violationsCount,
      violations_count,
      violationsSummary,
      violations_summary,
      urlLogs,
      url_logs,
      durationSeconds,
      duration_seconds,
      startedAt,
      started_at,
      submittedAt,
      submitted_at,
    } = req.body || {};

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Valid test code is required.' });
    }

    const finalStudentName = (studentName || student_name || '').trim();
    if (!finalStudentName) {
      return res.status(400).json({ error: 'Student name is required.' });
    }

    const normalizedCode = code.trim().toUpperCase();
    const codeRecord = await db('codes').where({ code: normalizedCode }).first();

    if (!codeRecord) {
      return res.status(404).json({ error: 'Assessment code not found.' });
    }

    if (codeRecord.status === 'revoked') {
      return res.status(410).json({ error: 'Assessment code has been revoked.', status: 'revoked' });
    }

    const maxScore = codeRecord.max_score || 100;
    const normRule = codeRecord.normalization_rule || 'multiplier';
    const finalFairnessScore = Math.min(100, Math.max(0, Number(fairnessScore ?? fairness_score ?? 100)));

    let preset = null;
    try {
      preset = codeRecord.preset_config ? JSON.parse(codeRecord.preset_config) : resolvePreset(codeRecord.preset_id || 'level-2');
    } catch {
      preset = resolvePreset('level-2');
    }
    const passThreshold = preset.passThreshold || 70;

    let finalRawScore = null;
    if (rawScore !== undefined && rawScore !== null && !isNaN(Number(rawScore))) {
      finalRawScore = Number(rawScore);
    } else if (raw_score !== undefined && raw_score !== null && !isNaN(Number(raw_score))) {
      finalRawScore = Number(raw_score);
    }

    const scoreForNormalization = finalRawScore !== null ? finalRawScore : maxScore;
    const normalizedScore = calculateNormalizedScore({
      rule: normRule,
      rawScore: scoreForNormalization,
      fairnessScore: finalFairnessScore,
      maxScore,
      passThreshold,
    });

    const status = determineSessionStatus(finalFairnessScore, passThreshold);
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const newSession = {
      id,
      code: normalizedCode,
      student_name: finalStudentName,
      student_id: (studentId || student_id || '').trim() || null,
      student_email: (studentEmail || student_email || '').trim() || null,
      raw_score: finalRawScore,
      max_score: maxScore,
      fairness_score: finalFairnessScore,
      normalized_score: normalizedScore,
      status,
      started_at: startedAt || started_at || null,
      submitted_at: submittedAt || submitted_at || nowIso,
      duration_seconds: Math.max(0, parseInt(durationSeconds ?? duration_seconds ?? 0, 10)),
      violations_count: Math.max(0, parseInt(violationsCount ?? violations_count ?? 0, 10)),
      violations_summary: violationsSummary || violations_summary ? JSON.stringify(violationsSummary || violations_summary) : null,
      url_logs: urlLogs || url_logs ? JSON.stringify(urlLogs || url_logs) : null,
      created_at: nowIso,
    };

    await db('sessions').insert(newSession);

    return res.status(201).json({
      id,
      code: normalizedCode,
      studentName: finalStudentName,
      studentId: newSession.student_id,
      studentEmail: newSession.student_email,
      rawScore: finalRawScore,
      maxScore,
      fairnessScore: finalFairnessScore,
      normalizedScore,
      status,
      startedAt: newSession.started_at,
      submittedAt: newSession.submitted_at,
      durationSeconds: newSession.duration_seconds,
      violationsCount: newSession.violations_count,
      violationsSummary: violationsSummary || violations_summary || [],
      urlLogs: urlLogs || url_logs || [],
      normalizationRule: normRule,
      platformType: codeRecord.platform_type || 'google-forms',
    });
  } catch (err) {
    next(err);
  }
});

sessionsRouter.get('/', async (req, res, next) => {
  try {
    const { code, status, search } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10), 1), 200);

    let query = db('sessions')
      .join('codes', 'sessions.code', '=', 'codes.code')
      .select(
        'sessions.*',
        'codes.target_url as target_url',
        'codes.platform_type as platform_type',
        'codes.normalization_rule as normalization_rule',
        'codes.preset_id as preset_id'
      );

    if (code) {
      query = query.where('sessions.code', code.trim().toUpperCase());
    }

    if (status && ['passed', 'flagged', 'failed'].includes(status.toLowerCase())) {
      query = query.where('sessions.status', status.toLowerCase());
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.where((builder) => {
        builder.whereILike('sessions.student_name', term)
          .orWhereILike('sessions.student_id', term)
          .orWhereILike('sessions.student_email', term)
          .orWhereILike('sessions.code', term);
      });
    }

    const rows = await query.orderBy('sessions.submitted_at', 'desc').limit(limit);

    const result = rows.map((r) => {
      let violationsSummary = [];
      let urlLogs = [];
      try {
        violationsSummary = r.violations_summary ? JSON.parse(r.violations_summary) : [];
      } catch {}
      try {
        urlLogs = r.url_logs ? JSON.parse(r.url_logs) : [];
      } catch {}

      return {
        id: r.id,
        code: r.code,
        studentName: r.student_name,
        studentId: r.student_id,
        studentEmail: r.student_email,
        rawScore: r.raw_score,
        maxScore: r.max_score,
        fairnessScore: r.fairness_score,
        normalizedScore: r.normalized_score,
        status: r.status,
        startedAt: r.started_at,
        submittedAt: r.submitted_at,
        durationSeconds: r.duration_seconds,
        violationsCount: r.violations_count,
        violationsSummary,
        urlLogs,
        targetUrl: r.target_url,
        platformType: r.platform_type,
        normalizationRule: r.normalization_rule,
        presetId: r.preset_id,
      };
    });

    return res.json(result);
  } catch (err) {
    next(err);
  }
});

sessionsRouter.get('/summary', async (req, res, next) => {
  try {
    const { code } = req.query;
    let query = db('sessions');
    if (code) {
      query = query.where({ code: code.trim().toUpperCase() });
    }

    const rows = await query.select('fairness_score', 'normalized_score', 'status', 'duration_seconds');
    const total = rows.length;

    if (total === 0) {
      return res.json({
        totalSessions: 0,
        passedSessions: 0,
        flaggedSessions: 0,
        failedSessions: 0,
        passRate: 0,
        avgFairnessScore: 100,
        avgNormalizedScore: 100,
        avgDurationSeconds: 0,
      });
    }

    const passed = rows.filter((r) => r.status === 'passed').length;
    const flagged = rows.filter((r) => r.status === 'flagged').length;
    const failed = rows.filter((r) => r.status === 'failed').length;

    const sumFairness = rows.reduce((s, r) => s + (r.fairness_score || 0), 0);
    const sumNormalized = rows.reduce((s, r) => s + (r.normalized_score || 0), 0);
    const sumDuration = rows.reduce((s, r) => s + (r.duration_seconds || 0), 0);

    return res.json({
      totalSessions: total,
      passedSessions: passed,
      flaggedSessions: flagged,
      failedSessions: failed,
      passRate: Number(((passed / total) * 100).toFixed(1)),
      avgFairnessScore: Number((sumFairness / total).toFixed(1)),
      avgNormalizedScore: Number((sumNormalized / total).toFixed(1)),
      avgDurationSeconds: Math.round(sumDuration / total),
    });
  } catch (err) {
    next(err);
  }
});

sessionsRouter.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const session = await db('sessions')
      .join('codes', 'sessions.code', '=', 'codes.code')
      .where('sessions.id', id)
      .select(
        'sessions.*',
        'codes.target_url as target_url',
        'codes.platform_type as platform_type',
        'codes.normalization_rule as normalization_rule',
        'codes.preset_id as preset_id',
        'codes.preset_config as preset_config'
      )
      .first();

    if (!session) {
      return res.status(404).json({ error: 'Session report not found.' });
    }

    let violationsSummary = [];
    let urlLogs = [];
    let preset = null;
    try {
      violationsSummary = session.violations_summary ? JSON.parse(session.violations_summary) : [];
    } catch {}
    try {
      urlLogs = session.url_logs ? JSON.parse(session.url_logs) : [];
    } catch {}
    try {
      preset = session.preset_config ? JSON.parse(session.preset_config) : resolvePreset(session.preset_id || 'level-2');
    } catch {}

    return res.json({
      id: session.id,
      code: session.code,
      studentName: session.student_name,
      studentId: session.student_id,
      studentEmail: session.student_email,
      rawScore: session.raw_score,
      maxScore: session.max_score,
      fairnessScore: session.fairness_score,
      normalizedScore: session.normalized_score,
      status: session.status,
      startedAt: session.started_at,
      submittedAt: session.submitted_at,
      durationSeconds: session.duration_seconds,
      violationsCount: session.violations_count,
      violationsSummary,
      urlLogs,
      targetUrl: session.target_url,
      platformType: session.platform_type,
      normalizationRule: session.normalization_rule,
      preset,
    });
  } catch (err) {
    next(err);
  }
});

sessionsRouter.patch('/:id/raw-score', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rawScore, raw_score } = req.body || {};

    const raw = rawScore !== undefined ? rawScore : raw_score;
    if (raw === undefined || raw === null || isNaN(Number(raw))) {
      return res.status(400).json({ error: 'Valid numerical rawScore is required.' });
    }

    const session = await db('sessions')
      .join('codes', 'sessions.code', '=', 'codes.code')
      .where('sessions.id', id)
      .select('sessions.*', 'codes.normalization_rule', 'codes.preset_id', 'codes.preset_config')
      .first();

    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const newRaw = Math.max(0, Number(raw));
    let preset = null;
    try {
      preset = session.preset_config ? JSON.parse(session.preset_config) : resolvePreset(session.preset_id || 'level-2');
    } catch {
      preset = resolvePreset('level-2');
    }

    const normalizedScore = calculateNormalizedScore({
      rule: session.normalization_rule || 'multiplier',
      rawScore: newRaw,
      fairnessScore: session.fairness_score,
      maxScore: session.max_score,
      passThreshold: preset.passThreshold || 70,
    });

    await db('sessions').where({ id }).update({
      raw_score: newRaw,
      normalized_score: normalizedScore,
    });

    const updatedSession = await db('sessions')
      .join('codes', 'sessions.code', '=', 'codes.code')
      .where('sessions.id', id)
      .select(
        'sessions.*',
        'codes.target_url as target_url',
        'codes.platform_type as platform_type',
        'codes.normalization_rule as normalization_rule',
        'codes.preset_id as preset_id'
      )
      .first();

    return res.json({
      id,
      rawScore: newRaw,
      normalizedScore,
      fairnessScore: session.fairness_score,
      normalizationRule: session.normalization_rule,
      session: updatedSession,
      message: 'Raw score updated and normalized score recalculated successfully.',
    });
  } catch (err) {
    next(err);
  }
});
