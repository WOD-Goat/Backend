/**
 * Firestore for an explicit service account. No environment variable chooses the
 * project: the id and credentials come from the key file only.
 */
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  getFirestore,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import type { ServiceAccountKey } from './guards';

export const PAGE_SIZE = 200;

export function openFirestore(
  key: ServiceAccountKey,
  appName: string,
): { db: Firestore; close: () => Promise<void> } {
  let app;
  try {
    app = initializeApp(
      { credential: cert({ ...key }), projectId: key.projectId },
      appName,
    );
  } catch {
    // The original error is dropped so that no part of the key can be printed.
    throw new Error(`Could not use the service account of project "${key.projectId}"`);
  }
  const db = getFirestore(app);
  return {
    db,
    close: async () => {
      await db.terminate();
      await deleteApp(app);
    },
  };
}

/** All docs of a query in pages, ordered by document id. */
export async function* queryPages(
  query: Query,
  pageSize: number = PAGE_SIZE,
): AsyncGenerator<QueryDocumentSnapshot[]> {
  const ordered = query.orderBy(FieldPath.documentId()).limit(pageSize);
  let page = await ordered.get();
  while (!page.empty) {
    yield page.docs;
    if (page.size < pageSize) return;
    page = await ordered.startAfter(page.docs[page.docs.length - 1]).get();
  }
}
