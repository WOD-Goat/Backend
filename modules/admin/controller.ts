import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { AdminRequest } from '../../middleware/adminAuth';
import User from '../user/model';
import { firestore } from '../../config/firebase';
import { NotificationService } from '../notification/notification.service';
import { NotificationSegment } from '../notification/model';
import { SubscriptionData } from '../../types/user.types';

const VALID_SEGMENTS: NotificationSegment[] = ['all', 'free', 'athlete_pro', 'coach'];

class AdminController {
  // POST /api/admin/login
  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ success: false, message: 'email and password are required' });
        return;
      }
      if (
        !process.env.ADMIN_EMAIL ||
        !process.env.ADMIN_PASSWORD ||
        !process.env.ADMIN_JWT_SECRET
      ) {
        console.error('Admin env vars (ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_JWT_SECRET) are not set');
        res.status(503).json({ success: false, message: 'Admin login not configured' });
        return;
      }
      if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
        return;
      }
      const token = jwt.sign({ role: 'admin', email }, process.env.ADMIN_JWT_SECRET, { expiresIn: '24h' });
      res.status(200).json({ success: true, token });
    } catch (error: any) {
      console.error('Admin login error:', error);
      res.status(500).json({ success: false, message: 'Login failed' });
    }
  }

  // GET /api/admin/stats — ~22 reads, all run in parallel
  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

      // 8 weekly buckets oldest → newest
      const weekStarts = Array.from({ length: 8 }, (_, i) =>
        new Date(now.getTime() - (8 - i) * MS_PER_WEEK)
      );
      const weekEnds = [...weekStarts.slice(1), now];

      const [baseSnaps, weeklySnaps] = await Promise.all([
        Promise.all([
          firestore.collection('users').count().get(),                                                          // 0 total
          firestore.collection('users').where('subscription.status', '==', 'active').count().get(),            // 1 athlete_pro
          firestore.collection('users').where('userType', '==', 'coach').count().get(),                        // 2 coaches
          firestore.collection('groups').count().get(),                                                         // 3 groups
          firestore.collection('users').where('createdAt', '>=', startOfMonth).count().get(),                  // 4 new this month
          firestore.collection('users').where('createdAt', '>=', startOfLastMonth)                             // 5 new last month
            .where('createdAt', '<', startOfMonth).count().get(),
          firestore.collection('users').where('coachApplication.status', '==', 'pending')                      // 6 pending apps (up to 5 docs)
            .select('name', 'email', 'coachApplication')
            .limit(5).get(),
        ]),
        Promise.all(
          weekStarts.map((start, i) =>
            firestore.collection('users')
              .where('createdAt', '>=', start)
              .where('createdAt', '<', weekEnds[i])
              .count().get()
          )
        ),
      ]);

      const [totalSnap, athleteProSnap, coachesSnap, groupsSnap,
             newThisMonthSnap, newLastMonthSnap, pendingAppsSnap] = baseSnaps;

      const total        = totalSnap.data().count;
      const athletePro   = athleteProSnap.data().count;
      const coaches      = coachesSnap.data().count;
      const free         = total - athletePro - coaches;
      const newThisMonth = newThisMonthSnap.data().count;
      const newLastMonth = newLastMonthSnap.data().count;

      const totalUsersChange = newLastMonth > 0
        ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 1000) / 10
        : null;

      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const signupTrend = weeklySnaps.map((snap, i) => {
        const s = weekStarts[i];
        const e = new Date(weekEnds[i].getTime() - 1);
        const label = s.getMonth() === e.getMonth()
          ? `${MONTHS[s.getMonth()]} ${s.getDate()}–${e.getDate()}`
          : `${MONTHS[s.getMonth()]} ${s.getDate()}–${MONTHS[e.getMonth()]} ${e.getDate()}`;
        return { week: label, count: snap.data().count };
      });

      const pendingApplications = pendingAppsSnap.docs.map((doc) => {
        const d = doc.data();
        const ca = d.coachApplication || {};
        return {
          applicantId:    doc.id,
          applicantName:  d.name,
          applicantEmail: d.email,
          phone:          ca.phoneNumber || null,
          currentGym:     ca.currentGym  || null,
          avgAthletes:    ca.avgAthletesCount ?? null,
          appliedDate:    ca.appliedAt || d.createdAt,
          status:         'pending',
        };
      });

      res.status(200).json({
        success: true,
        totalUsers:              total,
        totalUsersChange,
        subscribedUsers:         athletePro,
        subscribedUsersChange:   null,
        totalCoaches:            coaches,
        totalCoachesChange:      null,
        totalGroups:             groupsSnap.data().count,
        totalGroupsChange:       null,
        signupTrend,
        subscriptionBreakdown:   { free, athlete_pro: athletePro, coach: coaches },
        pendingApplications,
      });
    } catch (error: any) {
      console.error('getStats error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch stats' });
    }
  }

  // GET /api/admin/users
  // Query params:
  //   limit   — page size (default 20, max 100)
  //   cursor  — last doc ID from previous page (omit for first page)
  //   plan    — filter: free | athlete_pro | coach
  //   search  — substring match on name or email (scans up to 500 docs, no cursor)
  static async listUsers(req: Request, res: Response): Promise<void> {
    try {
      const { search, plan, limit = '20', cursor } = req.query;
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));

      const FIELDS = ['name', 'email', 'userType', 'coachStatus', 'subscription',
                      'coachApplication', 'coachSubscription', 'suspended', 'createdAt'];

      // --- Search path: Firestore can't filter by substring, so scan up to 200 docs ---
      // Returns all matches in one shot (no cursor); admin refines search to narrow results.
      if (search || plan === 'free') {
        if (search && (search as string).trim().length < 3) {
          res.status(400).json({ success: false, message: 'Search term must be at least 3 characters' });
          return;
        }
        const SCAN_CAP = 200;
        let q: FirebaseFirestore.Query = firestore.collection('users')
          .select(...FIELDS).limit(SCAN_CAP);

        if (plan === 'coach') {
          q = firestore.collection('users').where('userType', '==', 'coach')
            .select(...FIELDS).limit(SCAN_CAP);
        } else if (plan === 'athlete_pro') {
          q = firestore.collection('users').where('subscription.status', '==', 'active')
            .select(...FIELDS).limit(SCAN_CAP);
        }

        const snap = await q.get();
        let docs = snap.docs.map((d) => ({ uid: d.id, ...d.data() } as any));

        if (plan === 'free') {
          docs = docs.filter((u: any) => !u.subscription || u.subscription.status !== 'active');
        }
        if (search) {
          const term = (search as string).toLowerCase();
          docs = docs.filter((u: any) =>
            u.name?.toLowerCase().includes(term) || u.email?.toLowerCase().includes(term)
          );
        }

        res.status(200).json({
          success: true,
          total: docs.length,
          users: docs.map(AdminController.formatUser),
        });
        return;
      }

      // --- Browse path: Firestore paginates natively, reads exactly limitNum docs ---
      // NOTE: plan-filtered queries need composite indexes:
      //   users: userType ASC + createdAt DESC
      //   users: subscription.status ASC + createdAt DESC
      // Firestore will log the index-creation link on first run if missing.
      let baseQuery: FirebaseFirestore.Query = firestore.collection('users');
      if (plan === 'coach') {
        baseQuery = baseQuery.where('userType', '==', 'coach');
      } else if (plan === 'athlete_pro') {
        baseQuery = baseQuery.where('subscription.status', '==', 'active');
      }

      let q = baseQuery.orderBy('createdAt', 'desc').select(...FIELDS).limit(limitNum);

      if (cursor) {
        const cursorDoc = await firestore.collection('users').doc(cursor as string).get();
        if (cursorDoc.exists) q = q.startAfter(cursorDoc);
      }

      const [snap, countSnap] = await Promise.all([
        q.get(),
        baseQuery.count().get(),
      ]);

      const total      = countSnap.data().count;
      const totalPages = Math.ceil(total / limitNum);
      const docs       = snap.docs.map((d) => ({ uid: d.id, ...d.data() } as any));
      const nextCursor = snap.docs.length === limitNum
        ? snap.docs[snap.docs.length - 1].id
        : null;

      res.status(200).json({
        success: true,
        users: docs.map(AdminController.formatUser),
        total,
        totalPages,
        nextCursor,
      });
    } catch (error: any) {
      console.error('listUsers error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
  }

  private static formatUser(u: any) {
    return {
      uid: u.uid,
      name: u.name,
      email: u.email,
      userType: u.userType || 'athlete',
      coachStatus: u.coachStatus || null,
      subscription: u.subscription || null,
      coachApplication: u.coachApplication || null,
      coachSubscription: u.coachSubscription || null,
      suspended: u.suspended || false,
      createdAt: u.createdAt,
    };
  }

  // GET /api/admin/users/:id
  static async getUser(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const doc = await firestore.collection('users').doc(id).get();
      if (!doc.exists) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      res.status(200).json({ success: true, user: { uid: doc.id, ...doc.data() } });
    } catch (error: any) {
      console.error('getUser error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch user' });
    }
  }

  // PATCH /api/admin/users/:id
  // Body fields:
  //   suspended: boolean                                    — suspend or unsuspend
  //   grantSubscription: { tier: string, expiresAt: string } — manually grant a paid tier
  //   revokeSubscription: true                              — cancel active subscription
  //   userType: 'athlete' | 'coach'                        — change role
  static async updateUser(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { suspended, coachStatus, plan, grantSubscription, revokeSubscription, userType, coachSubscriptionExpiresAt, coachSubscriptionMaxAthletes } = req.body;

      const doc = await firestore.collection('users').doc(id).get();
      if (!doc.exists) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }

      const updates: Record<string, any> = { updatedAt: new Date() };

      if (typeof suspended === 'boolean') {
        updates.suspended = suspended;
      }

      if (coachStatus === 'active' || coachStatus === 'suspended') {
        updates.coachStatus = coachStatus;
      }

      if (grantSubscription !== undefined) {
        const { tier, expiresAt } = grantSubscription;
        if (!tier || !expiresAt) {
          res.status(400).json({ success: false, message: 'grantSubscription requires tier and expiresAt' });
          return;
        }
        const parsedExpiry = new Date(expiresAt);
        if (isNaN(parsedExpiry.getTime())) {
          res.status(400).json({ success: false, message: 'grantSubscription.expiresAt is not a valid date' });
          return;
        }
        updates.subscription = {
          status: 'active',
          entitlements: [tier],
          expiresAt: parsedExpiry.toISOString(),
          store: 'manual',
          updatedAt: new Date().toISOString(),
        } as SubscriptionData;
      }

      if (revokeSubscription === true) {
        updates['subscription.status'] = 'cancelled';
        updates['subscription.updatedAt'] = new Date().toISOString();
      }

      if (userType === 'athlete' || userType === 'coach') {
        updates.userType = userType;
      }

      // plan is the frontend-facing alias: 'coach' | 'athlete_pro' | 'free'
      if (plan === 'coach') {
        updates.userType  = 'coach';
        updates.coachStatus = 'active';
      } else if (plan === 'free' || plan === 'athlete') {
        updates.userType = 'athlete';
      }

      if (coachSubscriptionExpiresAt !== undefined) {
        if (coachSubscriptionExpiresAt === null) {
          updates.coachSubscription = null;
        } else {
          const parsed = new Date(coachSubscriptionExpiresAt);
          if (isNaN(parsed.getTime())) {
            res.status(400).json({ success: false, message: 'coachSubscriptionExpiresAt is not a valid date' });
            return;
          }
          updates['coachSubscription.expiresAt'] = parsed.toISOString();
        }
      }

      if (coachSubscriptionMaxAthletes !== undefined) {
        if (!Number.isInteger(coachSubscriptionMaxAthletes) || coachSubscriptionMaxAthletes < 1) {
          res.status(400).json({ success: false, message: 'coachSubscriptionMaxAthletes must be an integer >= 1' });
          return;
        }
        updates['coachSubscription.maxAthletes'] = coachSubscriptionMaxAthletes;
      }

      if (Object.keys(updates).length === 1) {
        res.status(400).json({ success: false, message: 'No valid fields to update' });
        return;
      }

      await firestore.collection('users').doc(id).update(updates);

      res.status(200).json({ success: true, message: 'User updated', uid: id });
    } catch (error: any) {
      console.error('updateUser error:', error);
      res.status(500).json({ success: false, message: 'Failed to update user' });
    }
  }

  // DELETE /api/admin/users/:id
  static async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const user = await User.getUserById(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      user.uid = id;
      await user.deleteUser();
      res.status(200).json({ success: true, message: 'User deleted' });
    } catch (error: any) {
      console.error('deleteUser error:', error);
      res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
  }

  // GET /api/admin/coach-applications
  // Note: applications are stored on user documents, not a separate coach_applications collection.
  static async listCoachApplications(req: Request, res: Response): Promise<void> {
    try {
      const { status = 'pending' } = req.query;
      const validStatuses = ['all', 'pending', 'approved', 'rejected'];
      if (!validStatuses.includes(status as string)) {
        res.status(400).json({ success: false, message: 'Invalid status. Use: all, pending, approved, rejected' });
        return;
      }

      let query: FirebaseFirestore.Query = firestore.collection('users');
      if (status !== 'all') {
        query = query.where('coachApplication.status', '==', status);
      } else {
        query = query.where('coachApplication.status', 'in', ['pending', 'approved', 'rejected']);
      }

      const snapshot = await query.get();

      const applications = snapshot.docs.map((doc) => {
        const d = doc.data();
        const ca = d.coachApplication || {};
        return {
          applicantId:     doc.id,
          applicantName:   d.name,
          applicantEmail:  d.email,
          phone:           ca.phoneNumber || null,
          currentGym:      ca.currentGym  || null,
          avgAthletes:     ca.avgAthletesCount ?? null,
          appliedDate:     ca.appliedAt || d.createdAt,
          status:          ca.status || null,
          rejectionReason: ca.rejectionReason || null,
        };
      });

      res.status(200).json({ success: true, count: applications.length, applications });
    } catch (error: any) {
      console.error('listCoachApplications error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch coach applications' });
    }
  }

  // POST /api/admin/coach-applications/:id/approve
  // Body: { maxAthletes: number }
  static async approveCoachApplication(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { maxAthletes } = req.body;

      if (maxAthletes == null || typeof maxAthletes !== 'number' || !Number.isInteger(maxAthletes) || maxAthletes < 1) {
        res.status(400).json({ success: false, message: 'maxAthletes (integer >= 1) is required' });
        return;
      }

      const user = await User.getUserById(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      if (user.coachApplication?.status !== 'pending') {
        res.status(400).json({
          success: false,
          message: `Cannot approve application with status '${user.coachApplication?.status}'`,
        });
        return;
      }

      await firestore.collection('users').doc(id).update({
        userType: 'coach',
        coachStatus: 'active',
        'coachApplication.status': 'approved',
        'coachSubscription.maxAthletes': maxAthletes,
        updatedAt: new Date(),
      });
      res.status(200).json({
        success: true,
        message: 'Coach application approved',
        uid: id,
        userType: 'coach',
        coachApplicationStatus: 'approved',
        maxAthletes,
      });
    } catch (error: any) {
      console.error('approveCoachApplication error:', error);
      res.status(500).json({ success: false, message: 'Failed to approve coach application' });
    }
  }

  // POST /api/admin/coach-applications/:id/decline
  static async declineCoachApplication(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const user = await User.getUserById(id);
      if (!user) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
      if (user.coachApplication?.status !== 'pending') {
        res.status(400).json({
          success: false,
          message: `Cannot decline application with status '${user.coachApplication?.status}'`,
        });
        return;
      }

      await firestore.collection('users').doc(id).update({
        'coachApplication.status': 'rejected',
        ...(reason && { 'coachApplication.rejectionReason': reason }),
        updatedAt: new Date(),
      });
      res.status(200).json({
        success: true,
        message: 'Coach application declined',
        uid: id,
        coachApplicationStatus: 'rejected',
      });
    } catch (error: any) {
      console.error('declineCoachApplication error:', error);
      res.status(500).json({ success: false, message: 'Failed to decline coach application' });
    }
  }

  // POST /api/admin/notifications/broadcast
  // Body: { title, body, target, deepLink? }
  // target: all | free | athlete_pro | coach
  // Note: uses Expo push (not FCM topics) — no mobile-side topic subscription required.
  static async broadcastNotification(req: AdminRequest, res: Response): Promise<void> {
    try {
      const { title, body, target = 'all', deepLink } = req.body;

      if (!title || !body) {
        res.status(400).json({ success: false, message: 'title and body are required' });
        return;
      }
      if (!VALID_SEGMENTS.includes(target)) {
        res.status(400).json({ success: false, message: `target must be one of: ${VALID_SEGMENTS.join(', ')}` });
        return;
      }

      const result = await NotificationService.sendBroadcastToSegment(
        title, body, target, deepLink ? { deepLink } : undefined
      );

      await firestore.collection('notifications').add({
        title,
        body,
        target,
        deepLink: deepLink ?? null,
        sentAt:   new Date(),
        sentBy:   req.admin?.email ?? process.env.ADMIN_EMAIL ?? 'admin',
        recipients: result.attempted,
        result,
      });

      res.status(200).json({ success: true, result });
    } catch (error: any) {
      console.error('broadcastNotification error:', error);
      res.status(500).json({ success: false, message: 'Failed to send broadcast' });
    }
  }

  // GET /api/admin/notifications/history
  static async notificationHistory(req: Request, res: Response): Promise<void> {
    try {
      const { limit = '20', cursor } = req.query;
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));

      let query = firestore
        .collection('notifications')
        .orderBy('sentAt', 'desc')
        .limit(limitNum);

      if (cursor) {
        const cursorDoc = await firestore.collection('notifications').doc(cursor as string).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.get();
      const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const nextCursor = snapshot.docs.length === limitNum ? snapshot.docs[snapshot.docs.length - 1].id : null;

      res.status(200).json({ success: true, items, nextCursor });
    } catch (error: any) {
      console.error('notificationHistory error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch notification history' });
    }
  }

  // GET /api/admin/revenue
  static async getRevenue(req: Request, res: Response): Promise<void> {
    try {
      const thirtyDaysAgoISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // 5 count() reads — one per status bucket, never touches individual documents
      const [totalSnap, activeSnap, cancelledSnap, expiredSnap, graceSnap] = await Promise.all([
        firestore.collection('users').count().get(),
        firestore.collection('users').where('subscription.status', '==', 'active').count().get(),
        firestore.collection('users').where('subscription.status', '==', 'cancelled').count().get(),
        firestore.collection('users').where('subscription.status', '==', 'expired').count().get(),
        firestore.collection('users').where('subscription.status', '==', 'grace_period').count().get(),
      ]);

      const active = activeSnap.data().count;
      const cancelled = cancelledSnap.data().count;
      const expired = expiredSnap.data().count;
      const grace_period = graceSnap.data().count;
      const free = totalSnap.data().count - active - cancelled - expired - grace_period;

      // Entitlement breakdown — read active users only (small set in practice)
      const activeDocsSnap = await firestore
        .collection('users')
        .where('subscription.status', '==', 'active')
        .select('subscription')
        .limit(500)
        .get();

      const byEntitlement: Record<string, number> = {};
      for (const doc of activeDocsSnap.docs) {
        for (const ent of (doc.data() as any).subscription?.entitlements || []) {
          byEntitlement[ent] = (byEntitlement[ent] || 0) + 1;
        }
      }

      // Recent events — query by subscription.updatedAt, limit 50 docs
      const recentSnap = await firestore
        .collection('users')
        .where('subscription.updatedAt', '>', thirtyDaysAgoISO)
        .orderBy('subscription.updatedAt', 'desc')
        .select('subscription')
        .limit(50)
        .get();

      const recentEvents = recentSnap.docs.map((doc) => {
        const sub = (doc.data() as any).subscription;
        return {
          uid: doc.id,
          status: sub?.status,
          entitlements: sub?.entitlements || [],
          store: sub?.store || null,
          updatedAt: sub?.updatedAt,
        };
      });

      res.status(200).json({
        success: true,
        byStatus: { free, active, cancelled, expired, grace_period },
        byEntitlement,
        recentEvents,
        totalPaid: active,
        totalFree: free,
      });
    } catch (error: any) {
      console.error('getRevenue error:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch revenue data' });
    }
  }

}

export default AdminController;
