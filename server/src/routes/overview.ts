/**
 * Overview screen: KPI tiles, sign-ins per day, role distribution and recent access events —
 * all computed from MongoDB (users, invites and the audit log).
 */
import { Router } from 'express';
import { db, now } from '../db.js';
import { ok, q } from '../http.js';
import { ctx, requireAuth } from '../auth.js';
import { publicEvent } from '../serialize.js';
import { ROLES } from '../types.js';

const DAY = 864e5;
const router = Router();
router.use(requireAuth);

/** "YYYY-MM-DD" in UTC. */
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

router.get('/', async (req, res) => {
  const { workspace } = ctx(req);
  const days = Math.min(90, Math.max(7, Number(q(req.query.days)) || 30));
  const at = now();
  const live = { workspaceId: workspace._id, deletedAt: null };
  const since = new Date(at.getTime() - days * DAY);
  const start = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate() + 1));

  const [
    totalUsers, newUsers, active7d, enrolled, mfaMissing, pendingInvites, expiringInvites, roleCounts, signIns, events
  ] = await Promise.all([
    db.users.countDocuments(live),
    db.users.countDocuments({ ...live, createdAt: { $gte: new Date(at.getTime() - 30 * DAY) } }),
    db.users.countDocuments({ ...live, lastSeenAt: { $gte: new Date(at.getTime() - 7 * DAY) } }),
    db.users.countDocuments({ ...live, status: { $ne: 'Invited' }, mfaEnrolledAt: { $ne: null } }),
    db.users.countDocuments({ ...live, status: { $ne: 'Invited' }, mfaEnrolledAt: null }),
    db.invites.countDocuments({ workspaceId: workspace._id, revokedAt: null, acceptedAt: null, expiresAt: { $gte: at } }),
    db.invites.countDocuments({
      workspaceId: workspace._id, revokedAt: null, acceptedAt: null, expiresAt: { $gte: at, $lte: new Date(at.getTime() + 2 * DAY) }
    }),
    Promise.all(ROLES.map(async (role) => ({ role, count: await db.users.countDocuments({ ...live, role }) }))),
    db.auditEvents
      .aggregate<{ _id: string; count: number }>([
        { $match: { workspaceId: workspace._id, kind: 'signin', at: { $gte: start } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$at' } }, count: { $sum: 1 } } }
      ])
      .toArray(),
    db.auditEvents
      .find({ workspaceId: workspace._id, kind: { $ne: 'signin' } })
      .sort({ at: -1 })
      .limit(Math.min(50, Number(q(req.query.events)) || 8))
      .toArray()
  ]);

  // One bucket per day, including days with no sign-ins.
  const perDay = new Map(signIns.map((r) => [r._id, r.count]));
  const series = Array.from({ length: days }, (_, i) => {
    const date = dayKey(new Date(start.getTime() + i * DAY));
    return { date, count: perDay.get(date) ?? 0 };
  });

  const assessed = enrolled + mfaMissing;
  ok(res, {
    days,
    tiles: {
      totalUsers,
      newUsers30d: newUsers,
      active7d,
      seatsLicensed: workspace.seatsLicensed,
      pendingInvites,
      expiringInvites48h: expiringInvites,
      mfaCoverage: assessed ? Math.round((enrolled / assessed) * 100) : 100,
      mfaMissing
    },
    signIns: series,
    roles: roleCounts,
    events: events.map(publicEvent)
  });
});

export default router;
