/**
 * Loads the server's progress modules bound to the script's own Firestore.
 *
 * The modules import config/firebase, which loads .env (production credentials
 * on a developer machine) and initializes the default Firebase app. A stand-in
 * is put into Node's module cache under that file's path first, so the real file
 * is never executed. Nothing here may import those modules statically.
 */
import Module from 'node:module';
import { getApps } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';

export async function loadServerModules(firestore: Firestore) {
  const configPath = require.resolve('../../config/firebase');
  if (require.cache[configPath]) {
    throw new Error('config/firebase is already loaded; refusing to continue');
  }
  const standIn = new Module(configPath);
  standIn.filename = configPath;
  standIn.loaded = true;
  standIn.exports = { firestore };
  require.cache[configPath] = standIn;

  const { loadMemberProgress, saveMemberProgress } = await import(
    '../../modules/program/progressStore'
  );
  const { writeWorkoutDayChange } = await import('../../modules/program/model');

  // The real config/firebase would have replaced the entry or added the default app.
  if (require.cache[configPath] !== standIn || getApps().some((app) => app.name === '[DEFAULT]')) {
    throw new Error('config/firebase was executed; refusing to continue');
  }
  return { loadMemberProgress, saveMemberProgress, writeWorkoutDayChange };
}

export type ServerModules = Awaited<ReturnType<typeof loadServerModules>>;
