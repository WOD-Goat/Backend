/**
 * Environment guard. Pure: no Firebase import, no side effects.
 * Prevents mixing environments (e.g. staging/test code on the production
 * Firebase project, or production running against a non-production project).
 */

/** Production Firebase project id (from .firebaserc default). Not a secret. */
export const PRODUCTION_FIREBASE_PROJECT_ID = 'box-fa42e';

export const APP_ENVS = ['production', 'staging', 'development', 'test'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export interface EnvironmentGuardResult {
  appEnv: AppEnv;
  projectId: string | undefined;
  /** Set only for development against the production project; caller should warn loudly. */
  warning?: string;
}

export function resolveAppEnv(env: Record<string, string | undefined>): AppEnv {
  const raw = env.APP_ENV;
  if (raw !== undefined && raw !== '') {
    if ((APP_ENVS as readonly string[]).includes(raw)) return raw as AppEnv;
    throw new Error(
      `Invalid APP_ENV "${raw}". Allowed values: ${APP_ENVS.join(', ')}.`
    );
  }
  // Unset: NODE_ENV=test is always the test guard (emulator required), per the root CLAUDE.md.
  if (env.NODE_ENV === 'test') return 'test';
  // Live Vercel deploys have no APP_ENV and must keep behaving as production.
  return env.VERCEL ? 'production' : 'development';
}

export function checkEnvironment(
  env: Record<string, string | undefined>
): EnvironmentGuardResult {
  const appEnv = resolveAppEnv(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const isProdProject = projectId === PRODUCTION_FIREBASE_PROJECT_ID;
  const shown = projectId ? `"${projectId}"` : '(unset)';

  switch (appEnv) {
    case 'production':
      if (!isProdProject) {
        throw new Error(
          `[environmentGuard] APP_ENV=production requires FIREBASE_PROJECT_ID to be the production project "${PRODUCTION_FIREBASE_PROJECT_ID}", got ${shown}.`
        );
      }
      return { appEnv, projectId };
    case 'staging':
      if (isProdProject) {
        throw new Error(
          `[environmentGuard] APP_ENV=staging must NOT use the production Firebase project "${PRODUCTION_FIREBASE_PROJECT_ID}".`
        );
      }
      return { appEnv, projectId };
    case 'test': {
      if (isProdProject) {
        throw new Error(
          `[environmentGuard] APP_ENV=test must NOT use the production Firebase project "${PRODUCTION_FIREBASE_PROJECT_ID}".`
        );
      }
      const missing = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'].filter(
        (k) => !env[k]
      );
      if (missing.length > 0) {
        throw new Error(
          `[environmentGuard] APP_ENV=test requires the Firebase emulators; missing: ${missing.join(', ')}.`
        );
      }
      return { appEnv, projectId };
    }
    case 'development':
      return isProdProject
        ? {
            appEnv,
            projectId,
            warning: `[environmentGuard] WARNING: APP_ENV=development is connected to the PRODUCTION Firebase project "${PRODUCTION_FIREBASE_PROJECT_ID}". Writes will affect live data.`,
          }
        : { appEnv, projectId };
  }
}
