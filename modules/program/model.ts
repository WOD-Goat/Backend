import { firestore } from '../../config/firebase';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
    ProgramData,
    ProgramWorkoutData,
    ProgramWorkoutResultData,
    ProgramMemberData,
} from '../../types/program.types';
import { PRDetail } from '../../types/workout.types';
import type { Query } from '@google-cloud/firestore';
import {
    addWorkoutDay,
    recomputeWorkoutDay,
    storedWorkoutDays,
    withoutInternalFields,
} from './progressMapping';
import {
    buildFormerMember,
    checkDurationChange,
    checkNewWorkoutDay,
    checkWorkoutDelete,
    checkWorkoutMove,
    hasHadMembers,
    isShortening,
    type ProgramRuleViolation,
} from './rules';
import { resolveProgress, toProgressView, type ProgressState, type ProgressView } from './progress';
import { findResultsInDays, loadMemberProgress, saveMemberProgress } from './progressStore';
import { evaluateSkip, type SkipRejection, type SkipRequest } from './skip';
import { evaluateSubmit, type SubmitRejection } from './submit';

export type ProgramSubmitOutcome =
    | { status: 'submitted'; submittedAt: Date }
    | { status: 'rejected'; rejection: SubmitRejection }
    | { status: 'unresolvable'; reason: string }
    | { status: 'program_not_found' }
    | { status: 'not_member' };

export type ProgramSkipOutcome =
    | { status: 'skipped'; progress: ProgressView }
    | { status: 'rejected'; rejection: SkipRejection }
    | { status: 'unresolvable'; reason: string }
    | { status: 'program_not_found' }
    | { status: 'not_member' };

/**
 * Generates a random 6-character uppercase alphanumeric join code
 */
function generateJoinCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

/** Program doc -> API-safe data: the internal fields are left out. */
function toProgram(doc: FirebaseFirestore.DocumentSnapshot): ProgramData & { id: string } {
    return withoutInternalFields({ id: doc.id, ...doc.data() }) as ProgramData & { id: string };
}

/**
 * Transaction read: whether anyone has ever joined. The program doc must have
 * been read in the same transaction; a join writes it, so a concurrent first
 * join cannot slip past. `persistFlag`: members were found but the flag is
 * missing (older program), so the caller writes it with its other writes.
 */
async function loadMembersEver(
    tx: FirebaseFirestore.Transaction,
    program: FirebaseFirestore.DocumentSnapshot,
): Promise<{ membersEver: boolean; persistFlag: boolean }> {
    const flag: unknown = program.data()?.hasHadMembers;
    if (flag === true) return { membersEver: true, persistFlag: false };

    const [members, formerMembers] = await Promise.all(
        ['members', 'formerMembers'].map(name => tx.get(program.ref.collection(name).limit(1).select())),
    );
    const membersEver = hasHadMembers({
        flag,
        hasCurrentMember: !members.empty,
        hasFormerMember: !formerMembers.empty,
    });
    return { membersEver, persistFlag: membersEver && program.exists };
}

/** Transaction read: whether any workout is on this day number. */
async function isDayOccupied(
    tx: FirebaseFirestore.Transaction,
    workouts: FirebaseFirestore.CollectionReference,
    dayNumber: number,
): Promise<boolean> {
    const snapshot = await tx.get(workouts.where('dayNumber', '==', dayNumber).limit(1).select());
    return !snapshot.empty;
}

/** Transaction read: the day fields of the other workouts on a day number. */
async function otherWorkoutsOnDay(
    tx: FirebaseFirestore.Transaction,
    workouts: FirebaseFirestore.CollectionReference,
    dayNumber: unknown,
    workoutId: string,
): Promise<FirebaseFirestore.DocumentData[]> {
    // A stored workout without a numeric day cannot be queried (and is not cached).
    if (typeof dayNumber !== 'number') return [];
    const snapshot = await tx.get(
        workouts.where('dayNumber', '==', dayNumber).select('dayNumber', 'createdAt'),
    );
    return snapshot.docs.filter(d => d.id !== workoutId).map(d => d.data());
}

/**
 * Model Layer - Database Operations
 * Handles direct database interactions for program operations.
 * Mirrors modules/group/model.ts, keyed by dayNumber instead of scheduledFor,
 * and with a real adminIds array instead of a single createdBy owner.
 */
class Program {
    id?: string;
    name: string;
    description: string | null;
    durationDays: number;
    createdBy: string;
    adminIds: string[];
    joinCode: string;
    createdAt: Date;

    constructor(data: ProgramData) {
        this.name = data.name;
        this.description = data.description ?? null;
        this.durationDays = data.durationDays;
        this.createdBy = data.createdBy;
        this.adminIds = data.adminIds && data.adminIds.length > 0 ? data.adminIds : [data.createdBy];
        this.joinCode = data.joinCode || generateJoinCode();
        this.createdAt = data.createdAt || new Date();
    }

    /**
     * Save program to Firestore
     */
    async save(): Promise<string> {
        try {
            const programRef = await firestore.collection('programs').add({
                name: this.name,
                description: this.description,
                durationDays: this.durationDays,
                createdBy: this.createdBy,
                adminIds: this.adminIds,
                joinCode: this.joinCode,
                createdAt: this.createdAt,
                workoutDays: {},
            });

            this.id = programRef.id;
            return programRef.id;
        } catch (error) {
            console.error('Error saving program:', error);
            throw new Error('Failed to save program to database');
        }
    }

    /** Returns the broken rule, or null when the program was updated. */
    static async update(programId: string, updateData: Partial<ProgramData>): Promise<ProgramRuleViolation | null> {
        try {
            const ref = firestore.collection('programs').doc(programId);
            const newDuration = updateData.durationDays;
            if (newDuration === undefined) {
                await ref.update(updateData);
                return null;
            }
            return await firestore.runTransaction(async tx => {
                const program = await tx.get(ref);
                const storedDuration: unknown = program.data()?.durationDays;
                if (isShortening(storedDuration, newDuration)) {
                    const { membersEver, persistFlag } = await loadMembersEver(tx, program);
                    const violation = checkDurationChange({ storedDuration, newDuration, membersEver });
                    if (violation) {
                        if (persistFlag) tx.update(ref, { hasHadMembers: true });
                        return violation;
                    }
                }
                tx.update(ref, updateData);
                return null;
            });
        } catch (error) {
            console.error('Error updating program:', error);
            throw new Error('Failed to update program');
        }
    }

    static async getById(programId: string): Promise<(ProgramData & { id: string }) | null> {
        try {
            const doc = await firestore.collection('programs').doc(programId).get();
            if (!doc.exists) return null;
            return toProgram(doc);
        } catch (error) {
            console.error('Error fetching program by ID:', error);
            throw new Error('Failed to fetch program');
        }
    }

    static async getByJoinCode(code: string): Promise<(ProgramData & { id: string }) | null> {
        try {
            const snapshot = await firestore
                .collection('programs')
                .where('joinCode', '==', code.toUpperCase())
                .limit(1)
                .get();

            if (snapshot.empty) return null;

            return toProgram(snapshot.docs[0]);
        } catch (error) {
            console.error('Error fetching program by join code:', error);
            throw new Error('Failed to fetch program by join code');
        }
    }

    static async refreshJoinCode(programId: string): Promise<string> {
        try {
            const newCode = generateJoinCode();
            await firestore.collection('programs').doc(programId).update({ joinCode: newCode });
            return newCode;
        } catch (error) {
            console.error('Error refreshing join code:', error);
            throw new Error('Failed to refresh join code');
        }
    }

    /**
     * Get programs where userId is an admin (creator or co-admin)
     */
    static async getByAdmin(userId: string): Promise<(ProgramData & { id: string })[]> {
        try {
            const snapshot = await firestore
                .collection('programs')
                .where('adminIds', 'array-contains', userId)
                .get();

            const programs: (ProgramData & { id: string })[] = [];
            snapshot.forEach(doc => {
                programs.push(toProgram(doc));
            });

            return programs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        } catch (error) {
            console.error('Error fetching programs by admin:', error);
            throw new Error('Failed to fetch programs');
        }
    }

    static async addAdmin(programId: string, userId: string): Promise<void> {
        try {
            await firestore.collection('programs').doc(programId).update({
                adminIds: FieldValue.arrayUnion(userId),
            });
        } catch (error) {
            console.error('Error adding program admin:', error);
            throw new Error('Failed to add program admin');
        }
    }

    static async removeAdmin(programId: string, userId: string): Promise<void> {
        try {
            await firestore.collection('programs').doc(programId).update({
                adminIds: FieldValue.arrayRemove(userId),
            });
        } catch (error) {
            console.error('Error removing program admin:', error);
            throw new Error('Failed to remove program admin');
        }
    }

    /**
     * Denormalize a new member's program info onto their user doc — mirrors groupMemberships,
     * avoids an extra read when building the merged home feed (see WorkoutController.getWeekWorkouts).
     */
    static async setMemberDenormalization(
        userId: string,
        programId: string,
        info: { name: string; startDate: Date; durationDays: number }
    ): Promise<void> {
        try {
            await firestore.collection('users').doc(userId).update({
                [`programMemberships.${programId}`]: info,
            });
        } catch (error) {
            console.error('Error setting program membership denormalization:', error);
            throw new Error('Failed to record program membership');
        }
    }

    static async delete(programId: string): Promise<void> {
        try {
            const programRef = firestore.collection('programs').doc(programId);
            const membersSnap = await programRef.collection('members').get();
            const memberIds = membersSnap.docs.map(d => d.id);

            // Archives are listed after the program doc is gone: a later leave
            // finds no program and writes none.
            const deleteProgramAndArchives = async () => {
                await programRef.delete();
                const formerSnap = await programRef.collection('formerMembers').select().get();
                await Promise.all(formerSnap.docs.map(d => d.ref.delete()));
            };

            await Promise.all([
                deleteProgramAndArchives(),
                ...memberIds.map(uid =>
                    firestore.collection('users').doc(uid).update({
                        [`programMemberships.${programId}`]: FieldValue.delete(),
                    })
                ),
            ]);
        } catch (error) {
            console.error('Error deleting program:', error);
            throw new Error('Failed to delete program');
        }
    }
}

/**
 * ProgramWorkout Model - Manages day-numbered workouts within a program
 * Stored as subcollection: programs/{programId}/workouts/{workoutId}
 */
export class ProgramWorkout {
    programId?: string;
    dayNumber: number;
    title?: string | null;
    createdBy: string;
    wodType: ProgramWorkoutData['wodType'];
    wods: ProgramWorkoutData['wods'];
    notes?: string | null;
    createdAt: Date;
    referenceLinks: ProgramWorkoutData['referenceLinks'];

    constructor(data: ProgramWorkoutData) {
        this.programId = data.programId;
        this.dayNumber = data.dayNumber;
        this.title = data.title || null;
        this.createdBy = data.createdBy;
        this.wodType = data.wodType ?? 'structured';
        this.wods = data.wods;
        this.notes = data.notes || null;
        this.createdAt = data.createdAt || new Date();
        this.referenceLinks = data.referenceLinks ?? [];
    }

    async save(programId: string): Promise<{ id: string } | { violation: ProgramRuleViolation }> {
        try {
            const programRef = firestore.collection('programs').doc(programId);
            const ref = programRef.collection('workouts').doc();
            const data = {
                dayNumber: this.dayNumber,
                title: this.title,
                createdBy: this.createdBy,
                wodType: this.wodType,
                wods: this.wods,
                notes: this.notes,
                createdAt: this.createdAt,
                referenceLinks: this.referenceLinks,
            };
            const violation = await firestore.runTransaction(async tx => {
                const program = (await tx.get(programRef)).data();
                const broken = checkNewWorkoutDay({
                    dayNumber: data.dayNumber,
                    durationDays: program?.durationDays,
                    dayOccupied: await isDayOccupied(tx, programRef.collection('workouts'), data.dayNumber),
                });
                if (broken) return broken;
                const cache = storedWorkoutDays(program);
                tx.create(ref, data);
                // An absent cache stays absent: it is computed from the workouts later.
                if (cache) tx.update(programRef, { workoutDays: addWorkoutDay(cache, data) });
                return null;
            });
            return violation ? { violation } : { id: ref.id };
        } catch (error) {
            console.error('Error saving program workout:', error);
            throw new Error('Failed to save program workout');
        }
    }

    /**
     * Get workouts for a program, ordered by dayNumber ASC, optionally restricted to a day range.
     * Single-field range query on dayNumber — no composite index required.
     */
    static async getAll(
        programId: string,
        minDay?: number,
        maxDay?: number
    ): Promise<(ProgramWorkoutData & { id: string })[]> {
        try {
            let query: FirebaseFirestore.Query = firestore
                .collection('programs')
                .doc(programId)
                .collection('workouts')
                .orderBy('dayNumber', 'asc');

            if (minDay !== undefined) query = query.where('dayNumber', '>=', minDay);
            if (maxDay !== undefined) query = query.where('dayNumber', '<=', maxDay);

            const snapshot = await query.get();
            const workouts: (ProgramWorkoutData & { id: string })[] = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                workouts.push({
                    id: doc.id,
                    programId,
                    ...data,
                    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
                } as ProgramWorkoutData & { id: string });
            });

            return workouts;
        } catch (error) {
            console.error('Error fetching program workouts:', error);
            throw new Error('Failed to fetch program workouts');
        }
    }

    static async getById(programId: string, workoutId: string): Promise<(ProgramWorkoutData & { id: string }) | null> {
        try {
            const doc = await firestore
                .collection('programs')
                .doc(programId)
                .collection('workouts')
                .doc(workoutId)
                .get();

            if (!doc.exists) return null;

            const data = doc.data()!;
            return {
                id: doc.id,
                programId,
                ...data,
                createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
            } as ProgramWorkoutData & { id: string };
        } catch (error) {
            console.error('Error fetching program workout by ID:', error);
            throw new Error('Failed to fetch program workout');
        }
    }

    /** Returns the broken rule, or null when the workout was updated. */
    static async update(
        programId: string,
        workoutId: string,
        updateData: Partial<ProgramWorkoutData>,
    ): Promise<ProgramRuleViolation | null> {
        try {
            const programRef = firestore.collection('programs').doc(programId);
            const workouts = programRef.collection('workouts');
            const ref = workouts.doc(workoutId);
            const newDay = updateData.dayNumber;
            // Content edits cannot change the day or the workout-days cache.
            if (newDay === undefined) {
                await ref.update(updateData);
                return null;
            }
            return await firestore.runTransaction(async tx => {
                const current = (await tx.get(ref)).data();
                // A missing workout falls through to update(), which fails.
                if (current && current.dayNumber !== newDay) {
                    const program = await tx.get(programRef);
                    const { membersEver, persistFlag } = await loadMembersEver(tx, program);
                    const violation = checkWorkoutMove({
                        fromDay: current.dayNumber,
                        toDay: newDay,
                        durationDays: program.data()?.durationDays,
                        membersEver,
                        targetOccupied: await isDayOccupied(tx, workouts, newDay),
                    });
                    const cache = violation ? undefined : storedWorkoutDays(program.data());
                    const remaining = cache
                        ? await otherWorkoutsOnDay(tx, workouts, current.dayNumber, workoutId)
                        : [];
                    // All reads are done; writes start here.
                    if (persistFlag) tx.update(programRef, { hasHadMembers: true });
                    if (violation) return violation;
                    if (cache) {
                        const workoutDays = addWorkoutDay(
                            recomputeWorkoutDay(cache, current.dayNumber, remaining),
                            { dayNumber: newDay, createdAt: current.createdAt },
                        );
                        tx.update(programRef, { workoutDays });
                    }
                }
                tx.update(ref, updateData);
                return null;
            });
        } catch (error) {
            console.error('Error updating program workout:', error);
            throw new Error('Failed to update program workout');
        }
    }

    /** Returns the broken rule, or null when deleted (or there was nothing to delete). */
    static async delete(programId: string, workoutId: string): Promise<ProgramRuleViolation | null> {
        try {
            const programRef = firestore.collection('programs').doc(programId);
            const workouts = programRef.collection('workouts');
            const ref = workouts.doc(workoutId);
            return await firestore.runTransaction(async tx => {
                const current = (await tx.get(ref)).data();
                if (current) {
                    const program = await tx.get(programRef);
                    const { membersEver, persistFlag } = await loadMembersEver(tx, program);
                    const violation = checkWorkoutDelete(membersEver);
                    if (violation) {
                        if (persistFlag) tx.update(programRef, { hasHadMembers: true });
                        return violation;
                    }
                    const cache = storedWorkoutDays(program.data());
                    if (cache) {
                        const remaining = await otherWorkoutsOnDay(tx, workouts, current.dayNumber, workoutId);
                        tx.update(programRef, {
                            workoutDays: recomputeWorkoutDay(cache, current.dayNumber, remaining),
                        });
                    }
                }
                tx.delete(ref);
                return null;
            });
        } catch (error) {
            console.error('Error deleting program workout:', error);
            throw new Error('Failed to delete program workout');
        }
    }
}

/**
 * ProgramWorkoutResult Model - Manages member results for a program day-workout
 * Stored as subcollection: programs/{programId}/workouts/{workoutId}/results/{userId}
 */
export class ProgramWorkoutResult {
    userId: string;
    userName: string;
    userProfilePictureUrl?: string | null;
    submittedAt: Date;
    results: ProgramWorkoutResultData['results'];
    comment?: string | null;
    prDetails?: PRDetail[];

    constructor(data: ProgramWorkoutResultData) {
        this.userId = data.userId;
        this.userName = data.userName;
        this.userProfilePictureUrl = data.userProfilePictureUrl || null;
        this.submittedAt = data.submittedAt || new Date();
        this.results = data.results;
        this.comment = data.comment ?? null;
        this.prDetails = data.prDetails ?? [];
    }

    private static ref(
        programId: string,
        workoutId: string,
        userId: string,
    ): FirebaseFirestore.DocumentReference {
        return firestore
            .collection('programs')
            .doc(programId)
            .collection('workouts')
            .doc(workoutId)
            .collection('results')
            .doc(userId);
    }

    /**
     * Claims the member's current day in one transaction: the result doc (without
     * prDetails, see savePRDetails), submittedBy, the member progress and the
     * completedWorkouts count. Any other outcome writes nothing, except that a
     * rejected submit saves days healed from existing results.
     *
     * The workout doc is not read here. The caller reads it after confirming
     * membership: from then on the program has members, so its day cannot change.
     */
    static async submit(input: {
        programId: string;
        workoutId: string;
        dayNumber: number;
        result: Omit<ProgramWorkoutResultData, 'submittedAt' | 'prDetails'>;
    }): Promise<ProgramSubmitOutcome> {
        const { programId, workoutId, dayNumber, result } = input;
        const { userId } = result;
        try {
            const resultRef = ProgramWorkoutResult.ref(programId, workoutId, userId);
            const workoutRef = firestore
                .collection('programs').doc(programId)
                .collection('workouts').doc(workoutId);

            return await firestore.runTransaction<ProgramSubmitOutcome>(async tx => {
                // Taken per attempt, so a retry after midnight uses the new date.
                const now = new Date();
                const [loaded, existing] = await Promise.all([
                    loadMemberProgress(tx, { programId, userId, now }),
                    tx.get(resultRef),
                ]);
                if (loaded.status === 'unresolvable') {
                    return { status: loaded.status, reason: loaded.reason };
                }
                if (loaded.status !== 'ok') return { status: loaded.status };

                const decision = evaluateSubmit({
                    state: loaded.state,
                    ctx: loaded.ctx,
                    submission: { dayNumber, workoutId },
                    resultExists: existing.exists,
                    today: loaded.today,
                    timezone: loaded.timezone,
                    now,
                });
                if (!decision.ok) {
                    // Healed days only: no result, count, PR or streak writes. A legacy
                    // member is saved by a successful submit, as with seeding.
                    if (loaded.healed && !loaded.isLegacy) saveMemberProgress(tx, loaded, loaded.state);
                    return { status: 'rejected', rejection: decision.rejection };
                }

                new ProgramWorkoutResult({ ...result, submittedAt: now }).createIn(tx, resultRef);
                tx.update(workoutRef, { submittedBy: FieldValue.arrayUnion(userId) });
                saveMemberProgress(tx, loaded, decision.state, {
                    'statsSummary.completedWorkouts': FieldValue.increment(1),
                });
                return { status: 'submitted', submittedAt: now };
            });
        } catch (error) {
            console.error('Error submitting program workout result:', error);
            throw new Error('Failed to save program workout result');
        }
    }

    /** Fails if the result doc already exists. prDetails are added after the commit. */
    private createIn(
        tx: FirebaseFirestore.Transaction,
        ref: FirebaseFirestore.DocumentReference,
    ): void {
        tx.create(ref, {
            userId: this.userId,
            userName: this.userName,
            userProfilePictureUrl: this.userProfilePictureUrl,
            submittedAt: this.submittedAt,
            results: this.results,
            comment: this.comment,
        });
    }

    static async savePRDetails(
        programId: string,
        workoutId: string,
        userId: string,
        prDetails: PRDetail[],
    ): Promise<void> {
        await ProgramWorkoutResult.ref(programId, workoutId, userId).update({ prDetails });
    }

    static async getAll(programId: string, workoutId: string): Promise<ProgramWorkoutResultData[]> {
        try {
            const snapshot = await firestore
                .collection('programs')
                .doc(programId)
                .collection('workouts')
                .doc(workoutId)
                .collection('results')
                .get();

            const results: ProgramWorkoutResultData[] = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                results.push({
                    ...data,
                    submittedAt: data.submittedAt?.toDate ? data.submittedAt.toDate() : new Date(data.submittedAt),
                } as ProgramWorkoutResultData);
            });

            return results;
        } catch (error) {
            console.error('Error fetching program workout results:', error);
            throw new Error('Failed to fetch program workout results');
        }
    }

    /**
     * Get results for a program-day workout, sorted by submittedAt DESC, with cursor pagination
     */
    static async getResultsPaginated(
        programId: string,
        workoutId: string,
        limit: number,
        startAfter?: Date
    ): Promise<ProgramWorkoutResultData[]> {
        try {
            let query: Query = firestore
                .collection('programs')
                .doc(programId)
                .collection('workouts')
                .doc(workoutId)
                .collection('results')
                .orderBy('submittedAt', 'desc')
                .limit(limit);

            if (startAfter) {
                query = query.startAfter(Timestamp.fromDate(startAfter));
            }

            const snapshot = await query.get();
            const results: ProgramWorkoutResultData[] = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                results.push({
                    ...data,
                    submittedAt: data.submittedAt?.toDate ? data.submittedAt.toDate() : new Date(data.submittedAt),
                } as ProgramWorkoutResultData);
            });

            return results;
        } catch (error) {
            console.error('Error fetching paginated program workout results:', error);
            throw new Error('Failed to fetch program workout results');
        }
    }

    static async getByUser(programId: string, workoutId: string, userId: string): Promise<ProgramWorkoutResultData | null> {
        try {
            const doc = await firestore
                .collection('programs')
                .doc(programId)
                .collection('workouts')
                .doc(workoutId)
                .collection('results')
                .doc(userId)
                .get();

            if (!doc.exists) return null;

            const data = doc.data()!;
            return {
                ...data,
                submittedAt: data.submittedAt?.toDate ? data.submittedAt.toDate() : new Date(data.submittedAt),
            } as ProgramWorkoutResultData;
        } catch (error) {
            console.error('Error fetching user program workout result:', error);
            throw new Error('Failed to fetch program workout result');
        }
    }
}

/**
 * ProgramMember Model
 * Stored as: programs/{programId}/members/{userId}
 */
export class ProgramMember {
    /** Writes the member doc and the program's permanent "has had members" flag together. */
    static async create(programId: string, userId: string, startDate: Date): Promise<void> {
        const programRef = firestore.collection('programs').doc(programId);
        await firestore
            .batch()
            .set(
                programRef.collection('members').doc(userId),
                { userId, startDate, joinedAt: new Date() },
                { merge: true },
            )
            .update(programRef, { hasHadMembers: true })
            .commit();
    }

    /**
     * Skip to a later day, in one transaction: the member progress and its
     * user-doc copy. Result docs are only read. A rejected skip writes nothing,
     * except that it saves days healed from existing results.
     */
    static async skip(programId: string, userId: string, skip: SkipRequest): Promise<ProgramSkipOutcome> {
        try {
            return await firestore.runTransaction<ProgramSkipOutcome>(async tx => {
                // Taken per attempt, so a retry after midnight uses the new date.
                const now = new Date();
                const loaded = await loadMemberProgress(tx, { programId, userId, now });
                if (loaded.status === 'unresolvable') {
                    return { status: loaded.status, reason: loaded.reason };
                }
                if (loaded.status !== 'ok') return { status: loaded.status };

                const { programRef, state, ctx, today, timezone } = loaded;
                const decision = await evaluateSkip({
                    state,
                    ctx,
                    skip,
                    today,
                    now,
                    findResults: (fromDay, toDay) =>
                        findResultsInDays(tx, { programRef, userId, timezone }, fromDay, toDay),
                });
                if (!decision.ok) {
                    // Same exception as submit: healed days are kept for stored progress.
                    if (loaded.healed && !loaded.isLegacy) saveMemberProgress(tx, loaded, state);
                    return { status: 'rejected', rejection: decision.rejection };
                }

                saveMemberProgress(tx, loaded, decision.state);
                return {
                    status: 'skipped',
                    progress: toProgressView(decision.state, ctx, today, timezone, now),
                };
            });
        } catch (error) {
            console.error('Error skipping program days:', error);
            throw new Error('Failed to save skipped days');
        }
    }

    static async get(programId: string, userId: string): Promise<ProgramMemberData | null> {
        const doc = await firestore
            .collection('programs').doc(programId)
            .collection('members').doc(userId)
            .get();

        if (!doc.exists) return null;

        const data = doc.data()!;
        return {
            userId: data.userId,
            startDate: data.startDate?.toDate?.() ?? new Date(data.startDate),
            joinedAt: data.joinedAt?.toDate?.() ?? (data.joinedAt ? new Date(data.joinedAt) : undefined),
        };
    }

    /**
     * Get a page of member docs for a program's roster (used by the coach admin view).
     */
    static async getAllPage(
        programId: string,
        limit: number,
        cursor?: string
    ): Promise<{ members: ProgramMemberData[]; nextCursor: string | null }> {
        let query: Query = firestore
            .collection('programs').doc(programId)
            .collection('members')
            .orderBy('joinedAt', 'desc')
            .limit(limit);

        if (cursor) {
            const cursorDoc = await firestore
                .collection('programs').doc(programId)
                .collection('members').doc(cursor)
                .get();
            if (cursorDoc.exists) query = query.startAfter(cursorDoc);
        }

        const snap = await query.get();
        const members: ProgramMemberData[] = snap.docs.map(doc => {
            const data = doc.data();
            return {
                userId: data.userId,
                startDate: data.startDate?.toDate?.() ?? new Date(data.startDate),
                joinedAt: data.joinedAt?.toDate?.() ?? (data.joinedAt ? new Date(data.joinedAt) : undefined),
            };
        });

        const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length - 1].id : null;
        return { members, nextCursor };
    }

    /**
     * Leave or removal, in one transaction: the member's progress is archived to
     * formerMembers, the member doc and the user-doc entry are removed, and the
     * program id is listed on the user doc for account deletion. For a
     * non-member only a leftover user-doc entry is removed; no archive is touched.
     */
    static async removeAndArchive(programId: string, userId: string): Promise<'removed' | 'program_not_found'> {
        const membershipPath = `programMemberships.${programId}`;
        const now = new Date();
        try {
            const outcome = await firestore.runTransaction(async tx => {
                const loaded = await loadMemberProgress(tx, { programId, userId, now });
                if (loaded.status === 'program_not_found') return loaded.status;
                if (loaded.status === 'not_member') {
                    // Fails when the user doc does not exist.
                    tx.update(firestore.collection('users').doc(userId), {
                        [membershipPath]: FieldValue.delete(),
                    });
                    return 'removed';
                }

                let state: ProgressState | null = null;
                let problem = loaded.status === 'unresolvable' ? loaded.reason : '';
                if (loaded.status === 'ok') {
                    try {
                        state = resolveProgress(loaded.state, loaded.ctx, loaded.today, now);
                    } catch (error) {
                        problem = error instanceof Error ? error.message : String(error);
                    }
                }
                if (!state) {
                    console.error(`Archiving member ${userId} of program ${programId} unresolved: ${problem}`);
                }

                // A deleted account gets no archive: nothing could restore or clean it up.
                if (loaded.hasUserDoc) {
                    tx.set(
                        loaded.programRef.collection('formerMembers').doc(userId),
                        buildFormerMember({ userId, memberData: loaded.memberData, state, archivedAt: now }),
                    );
                    tx.update(loaded.userRef, {
                        [membershipPath]: FieldValue.delete(),
                        formerProgramIds: FieldValue.arrayUnion(programId),
                    });
                }
                tx.delete(loaded.memberRef);
                tx.update(loaded.programRef, { hasHadMembers: true });
                return loaded.hasUserDoc ? 'removed' : 'user_not_found';
            });
            // Same response as before: removing a deleted account reports a failure,
            // after the member doc is gone.
            if (outcome === 'user_not_found') throw new Error(`User ${userId} does not exist`);
            return outcome;
        } catch (error) {
            console.error('Error removing program member:', error);
            throw new Error('Failed to remove program membership');
        }
    }
}

export default Program;
