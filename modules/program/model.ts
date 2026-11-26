import { firestore } from '../../config/firebase';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
    ProgramData,
    ProgramWorkoutData,
    ProgramWorkoutResultData,
    ProgramMemberData,
    ProgramWorkoutDays,
} from '../../types/program.types';
import { PRDetail } from '../../types/workout.types';
import type { Query } from '@google-cloud/firestore';
import {
    addWorkoutDay,
    recomputeWorkoutDay,
    buildProgramContext,
    progressStateToMember,
    storedWorkoutDays,
    toUserProgress,
    withoutInternalFields,
} from './progressMapping';
import {
    buildFormerMember,
    checkDurationChange,
    checkNewWorkoutDay,
    checkWorkoutDelete,
    checkWorkoutMove,
    hasHadMembers,
    isAlreadyExistsError,
    isShortening,
    type ProgramRuleViolation,
} from './rules';
import {
    applyStartDateChange,
    resolveProgress,
    seedForJoin,
    toProgressView,
    type ProgressState,
    type ProgressView,
} from './progress';
import {
    findResultsInDays,
    loadMemberProgress,
    loadSubmissions,
    loadWorkoutDays,
    saveMemberProgress,
} from './progressStore';
import { restoreFromArchive } from './join';
import { localDateString, resolveTimezone } from './localDate';
import { parseJoinStartDate, resolveStartDate, type StartDateInput } from './startDate';
import { evaluateSkip, type SkipRejection, type SkipRequest } from './skip';
import { ALREADY_SUBMITTED, evaluateSubmit, type SubmitRejection } from './submit';

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

export type ProgramJoinOutcome =
    | { status: 'joined'; programId: string; programName: string; startDate: Date; restored: boolean }
    | { status: 'invalid_code' }
    | { status: 'already_member' }
    | { status: 'invalid_start_date' };

export type ProgramStartDateOutcome =
    | { status: 'changed'; progress: ProgressView }
    | { status: 'rejected'; code: 'START_DATE_LOCKED' }
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

/** A transaction, or a plain reader for read endpoints. */
interface QueryReader {
    get(query: Query): Promise<FirebaseFirestore.QuerySnapshot>;
}

/**
 * Whether anyone has ever joined. In a transaction, the program doc must have
 * been read through it; a first join writes it, so a concurrent first join
 * cannot slip past. `persistFlag`: members were found but the flag is missing
 * (older program), so a writing caller saves it with its other writes.
 */
async function loadMembersEver(
    reader: QueryReader,
    program: FirebaseFirestore.DocumentSnapshot,
): Promise<{ membersEver: boolean; persistFlag: boolean }> {
    const flag: unknown = program.data()?.hasHadMembers;
    if (flag === true) return { membersEver: true, persistFlag: false };

    const [members, formerMembers] = await Promise.all(
        ['members', 'formerMembers'].map(name => reader.get(program.ref.collection(name).limit(1).select())),
    );
    const membersEver = hasHadMembers({
        flag,
        hasCurrentMember: !members.empty,
        hasFormerMember: !formerMembers.empty,
    });
    return { membersEver, persistFlag: membersEver && program.exists };
}

/**
 * The program doc write of a transaction that changes which days have workouts
 * (create, move, delete), made even without a cache to update. It always changes
 * the doc, so a transaction that read the program and then queried the workouts
 * without locking them cannot commit across this change (see progressStore.ts).
 * All reads must be done.
 */
function writeWorkoutDayChange(
    tx: FirebaseFirestore.Transaction,
    programRef: FirebaseFirestore.DocumentReference,
    workoutDays: ProgramWorkoutDays | undefined,
): void {
    tx.update(programRef, {
        // An absent cache stays absent: it is computed from the workouts later.
        ...(workoutDays && { workoutDays }),
        workoutsRevision: FieldValue.increment(1),
    });
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

/** A member with the doc as stored, which progress reads need. Not for responses. */
type StoredProgramMember = ProgramMemberData & { stored: FirebaseFirestore.DocumentData };

function toStoredMember(data: FirebaseFirestore.DocumentData): StoredProgramMember {
    return {
        userId: data.userId,
        startDate: data.startDate?.toDate?.() ?? new Date(data.startDate),
        joinedAt: data.joinedAt?.toDate?.() ?? (data.joinedAt ? new Date(data.joinedAt) : undefined),
        stored: data,
    };
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

    /**
     * The program with its stored doc, which progress reads need for the
     * internal workout-days cache. The doc must not reach a response.
     */
    static async getWithSnapshot(programId: string) {
        try {
            const snapshot = await firestore.collection('programs').doc(programId).get();
            if (!snapshot.exists) return null;
            return { program: toProgram(snapshot), snapshot };
        } catch (error) {
            console.error('Error fetching program by ID:', error);
            throw new Error('Failed to fetch program');
        }
    }

    /** Whether the coach edit locks apply (someone has joined). Stores nothing. */
    static async isEditLocked(program: FirebaseFirestore.DocumentSnapshot): Promise<boolean> {
        try {
            const { membersEver } = await loadMembersEver({ get: query => query.get() }, program);
            return membersEver;
        } catch (error) {
            console.error('Error checking program edit lock:', error);
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

/** Most values Firestore accepts in an `in` filter. */
const MAX_IN_VALUES = 30;

function toListedWorkout(
    programId: string,
    doc: FirebaseFirestore.QueryDocumentSnapshot
): ProgramWorkoutData & { id: string } {
    const data = doc.data();
    return {
        id: doc.id,
        programId,
        ...data,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt),
    } as ProgramWorkoutData & { id: string };
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
                writeWorkoutDayChange(tx, programRef, cache && addWorkoutDay(cache, data));
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
            return snapshot.docs.map(doc => toListedWorkout(programId, doc));
        } catch (error) {
            console.error('Error fetching program workouts:', error);
            throw new Error('Failed to fetch program workouts');
        }
    }

    /** The workouts on the given days, in no particular order. */
    static async getByDays(
        programId: string,
        days: readonly number[]
    ): Promise<(ProgramWorkoutData & { id: string })[]> {
        try {
            const collection = firestore.collection('programs').doc(programId).collection('workouts');
            const chunks: number[][] = [];
            for (let i = 0; i < days.length; i += MAX_IN_VALUES) {
                chunks.push(days.slice(i, i + MAX_IN_VALUES));
            }
            const snapshots = await Promise.all(
                chunks.map(chunk => collection.where('dayNumber', 'in', chunk).get())
            );
            return snapshots.flatMap(snapshot =>
                snapshot.docs.map(doc => toListedWorkout(programId, doc))
            );
        } catch (error) {
            console.error('Error fetching program workouts by day:', error);
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
                    // All reads are done; writes start here. The flag is only
                    // missing when members were found, which refuses the move.
                    if (persistFlag) tx.update(programRef, { hasHadMembers: true });
                    if (violation) return violation;
                    writeWorkoutDayChange(tx, programRef, cache && addWorkoutDay(
                        recomputeWorkoutDay(cache, current.dayNumber, remaining),
                        { dayNumber: newDay, createdAt: current.createdAt },
                    ));
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
                    const remaining = cache
                        ? await otherWorkoutsOnDay(tx, workouts, current.dayNumber, workoutId)
                        : [];
                    writeWorkoutDayChange(
                        tx,
                        programRef,
                        cache && recomputeWorkoutDay(cache, current.dayNumber, remaining),
                    );
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
            // A concurrent submit created the result doc first (the only create).
            if (isAlreadyExistsError(error)) return { status: 'rejected', rejection: ALREADY_SUBMITTED };
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
    /**
     * Join or rejoin by code, in one transaction: the member doc with its
     * progress, the user-doc entry and the program's permanent "has had members"
     * flag. An archive from an earlier membership is restored and removed;
     * without one, progress is seeded from the user's submissions. A refused
     * join writes nothing. `startDate` is the value as sent by the client.
     */
    static async join(code: string, userId: string, startDate: unknown): Promise<ProgramJoinOutcome> {
        const byCode = firestore.collection('programs').where('joinCode', '==', code.toUpperCase()).limit(1);
        const userRef = firestore.collection('users').doc(userId);
        try {
            return await firestore.runTransaction<ProgramJoinOutcome>(async tx => {
                // Taken per attempt, so a retry after midnight uses the new date.
                const now = new Date();
                const program = (await tx.get(byCode)).docs[0];
                if (!program) return { status: 'invalid_code' };
                const programId = program.id;
                const { name, durationDays, hasHadMembers: flag } = program.data();
                const memberRef = program.ref.collection('members').doc(userId);
                const archiveRef = program.ref.collection('formerMembers').doc(userId);
                const [member, user, archive] = await tx.getAll(memberRef, userRef, archiveRef);
                if (member.exists) return { status: 'already_member' };
                const requestedInput = parseJoinStartDate(startDate, now);
                if (!requestedInput) return { status: 'invalid_start_date' };
                const userData = user.data();
                if (!userData) throw new Error(`User ${userId} does not exist`);

                const timezone = resolveTimezone(userData.timezone);
                const today = localDateString(now, timezone);
                const requested = resolveStartDate(requestedInput, timezone);
                const archived = archive.data();
                const restored = archived ? restoreFromArchive(archived, requested, today, timezone) : null;
                if (archived && !restored) {
                    console.error(`Unusable archive of member ${userId} of program ${programId}: seeding from submissions`);
                }

                let state: ProgressState;
                let cacheUpdate = {};
                if (restored) {
                    state = restored.state;
                } else {
                    const submissions = await loadSubmissions(tx, program.ref, userId, timezone);
                    // Without submissions the seed does not look at the workouts.
                    const days = submissions.length > 0 ? await loadWorkoutDays(program) : null;
                    if (days?.persistWorkoutDays) cacheUpdate = { workoutDays: days.workoutDays };
                    state = seedForJoin(
                        { startLocalDate: requested.startLocalDate, today, submissions },
                        buildProgramContext(durationDays, days?.workoutDays ?? {}, timezone),
                        now,
                    );
                }
                const memberStart = restored?.startDate ?? requested.startDate;

                // All reads are done; writes start here.
                tx.create(memberRef, {
                    ...restored?.member,
                    userId,
                    startDate: memberStart,
                    joinedAt: now,
                    ...progressStateToMember(state),
                });
                tx.update(userRef, {
                    [`programMemberships.${programId}`]: {
                        name,
                        startDate: memberStart,
                        durationDays,
                        ...toUserProgress(state),
                    },
                    ...(archived && { formerProgramIds: FieldValue.arrayRemove(programId) }),
                });
                if (archived) tx.delete(archiveRef);
                const programUpdate = { ...(flag !== true && { hasHadMembers: true }), ...cacheUpdate };
                if (Object.keys(programUpdate).length > 0) tx.update(program.ref, programUpdate);
                return {
                    status: 'joined',
                    programId,
                    programName: name,
                    startDate: memberStart,
                    restored: restored !== null,
                };
            });
        } catch (error) {
            // A concurrent join created the member doc first.
            if (isAlreadyExistsError(error)) {
                return { status: 'already_member' };
            }
            console.error('Error joining program:', error);
            throw new Error('Failed to record program membership');
        }
    }

    /**
     * Move a start date that is still in the future, in one transaction: the
     * member doc and its user-doc copy. A rejected change writes nothing, except
     * that it saves days healed from existing results.
     */
    static async changeStartDate(
        programId: string,
        userId: string,
        requested: StartDateInput,
    ): Promise<ProgramStartDateOutcome> {
        try {
            return await firestore.runTransaction<ProgramStartDateOutcome>(async tx => {
                // Taken per attempt, so a retry after midnight uses the new date.
                const now = new Date();
                const loaded = await loadMemberProgress(tx, { programId, userId, now });
                if (loaded.status === 'unresolvable') {
                    return { status: loaded.status, reason: loaded.reason };
                }
                if (loaded.status !== 'ok') return { status: loaded.status };

                const { state, ctx, today, timezone } = loaded;
                const { startDate, startLocalDate } = resolveStartDate(requested, timezone);
                const decision = applyStartDateChange(state, startLocalDate, today);
                if (!decision.ok) {
                    // Same exception as submit: healed days are kept for stored progress.
                    if (loaded.healed && !loaded.isLegacy) saveMemberProgress(tx, loaded, state);
                    return { status: 'rejected', code: decision.code };
                }

                saveMemberProgress(tx, loaded, decision.state, {}, startDate);
                return {
                    status: 'changed',
                    progress: toProgressView(decision.state, ctx, today, timezone, now),
                };
            });
        } catch (error) {
            console.error('Error changing program start date:', error);
            throw new Error('Failed to save start date');
        }
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

    static async get(programId: string, userId: string): Promise<StoredProgramMember | null> {
        const doc = await firestore
            .collection('programs').doc(programId)
            .collection('members').doc(userId)
            .get();

        if (!doc.exists) return null;

        return toStoredMember(doc.data()!);
    }

    /**
     * Get a page of member docs for a program's roster (used by the coach admin view).
     */
    static async getAllPage(
        programId: string,
        limit: number,
        cursor?: string
    ): Promise<{ members: StoredProgramMember[]; nextCursor: string | null }> {
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
        const members = snap.docs.map(doc => toStoredMember(doc.data()));

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
