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
    withoutWorkoutDays,
} from './progressMapping';

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

/** Program doc -> API-safe data: the internal workoutDays cache is left out. */
function toProgram(doc: FirebaseFirestore.DocumentSnapshot): ProgramData & { id: string } {
    return withoutWorkoutDays({ id: doc.id, ...doc.data() }) as ProgramData & { id: string };
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

    static async update(programId: string, updateData: Partial<ProgramData>): Promise<void> {
        try {
            await firestore.collection('programs').doc(programId).update(updateData);
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

    static async removeMemberDenormalization(userId: string, programId: string): Promise<void> {
        try {
            await firestore.collection('users').doc(userId).update({
                [`programMemberships.${programId}`]: FieldValue.delete(),
            });
        } catch (error) {
            console.error('Error removing program membership denormalization:', error);
            throw new Error('Failed to remove program membership');
        }
    }

    static async delete(programId: string): Promise<void> {
        try {
            const membersSnap = await firestore.collection('programs').doc(programId).collection('members').get();
            const memberIds = membersSnap.docs.map(d => d.id);

            await Promise.all([
                firestore.collection('programs').doc(programId).delete(),
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

    async save(programId: string): Promise<string> {
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
            await firestore.runTransaction(async tx => {
                const cache = storedWorkoutDays((await tx.get(programRef)).data());
                tx.create(ref, data);
                // An absent cache stays absent: it is computed from the workouts later.
                if (cache) tx.update(programRef, { workoutDays: addWorkoutDay(cache, data) });
            });
            return ref.id;
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

    static async update(programId: string, workoutId: string, updateData: Partial<ProgramWorkoutData>): Promise<void> {
        try {
            const programRef = firestore.collection('programs').doc(programId);
            const workouts = programRef.collection('workouts');
            const ref = workouts.doc(workoutId);
            const newDay = updateData.dayNumber;
            // Content edits cannot change the workout-days cache.
            if (newDay === undefined) {
                await ref.update(updateData);
                return;
            }
            await firestore.runTransaction(async tx => {
                const current = (await tx.get(ref)).data();
                // A missing workout falls through to update(), which fails.
                if (current && current.dayNumber !== newDay) {
                    const cache = storedWorkoutDays((await tx.get(programRef)).data());
                    if (cache) {
                        const remaining = await otherWorkoutsOnDay(tx, workouts, current.dayNumber, workoutId);
                        const workoutDays = addWorkoutDay(
                            recomputeWorkoutDay(cache, current.dayNumber, remaining),
                            { dayNumber: newDay, createdAt: current.createdAt },
                        );
                        tx.update(programRef, { workoutDays });
                    }
                }
                tx.update(ref, updateData);
            });
        } catch (error) {
            console.error('Error updating program workout:', error);
            throw new Error('Failed to update program workout');
        }
    }

    static async addSubmittedBy(programId: string, workoutId: string, userId: string): Promise<void> {
        try {
            await firestore
                .collection('programs')
                .doc(programId)
                .collection('workouts')
                .doc(workoutId)
                .update({ submittedBy: FieldValue.arrayUnion(userId) });
        } catch (error) {
            console.error('Error updating submittedBy:', error);
            throw new Error('Failed to update submittedBy');
        }
    }

    static async delete(programId: string, workoutId: string): Promise<void> {
        try {
            const programRef = firestore.collection('programs').doc(programId);
            const workouts = programRef.collection('workouts');
            const ref = workouts.doc(workoutId);
            await firestore.runTransaction(async tx => {
                const current = (await tx.get(ref)).data();
                if (current) {
                    const cache = storedWorkoutDays((await tx.get(programRef)).data());
                    if (cache) {
                        const remaining = await otherWorkoutsOnDay(tx, workouts, current.dayNumber, workoutId);
                        tx.update(programRef, {
                            workoutDays: recomputeWorkoutDay(cache, current.dayNumber, remaining),
                        });
                    }
                }
                tx.delete(ref);
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

    async save(programId: string, workoutId: string, userId: string): Promise<void> {
        try {
            await firestore
                .collection('programs')
                .doc(programId)
                .collection('workouts')
                .doc(workoutId)
                .collection('results')
                .doc(userId)
                .set({
                    userId: this.userId,
                    userName: this.userName,
                    userProfilePictureUrl: this.userProfilePictureUrl,
                    submittedAt: this.submittedAt,
                    results: this.results,
                    comment: this.comment,
                    prDetails: this.prDetails ?? [],
                });
        } catch (error) {
            console.error('Error saving program workout result:', error);
            throw new Error('Failed to save program workout result');
        }
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
    static async create(programId: string, userId: string, startDate: Date): Promise<void> {
        await firestore
            .collection('programs').doc(programId)
            .collection('members').doc(userId)
            .set({ userId, startDate, joinedAt: new Date() }, { merge: true });
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

    static async remove(programId: string, userId: string): Promise<void> {
        await firestore
            .collection('programs').doc(programId)
            .collection('members').doc(userId)
            .delete();
    }
}

export default Program;
