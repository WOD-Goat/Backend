/**
 * The copy's view of the source project: two read operations returning plain
 * data. The Firestore client stays inside this closure, so the copy has no way
 * to write to the source.
 */
import { openFirestore, queryPages } from './firestore';
import type { ServiceAccountKey } from './guards';
import type { Data } from './sanitize';

export interface SourceDoc {
  id: string;
  data: Data;
}

export interface ReadOnlySource {
  /** A collection in pages; only `fields` are requested. */
  pages(collectionPath: string, fields: readonly string[]): AsyncGenerator<SourceDoc[]>;
  /** The docs of a collection that exist among `ids`; only `fields` are requested. */
  getDocs(collectionPath: string, ids: readonly string[], fields: readonly string[]): Promise<SourceDoc[]>;
  close(): Promise<void>;
}

export function openReadOnlySource(key: ServiceAccountKey): ReadOnlySource {
  const { db, close } = openFirestore(key, 'copy-source');
  return Object.freeze<ReadOnlySource>({
    async *pages(collectionPath, fields) {
      for await (const page of queryPages(db.collection(collectionPath).select(...fields))) {
        yield page.map((doc) => ({ id: doc.id, data: doc.data() }));
      }
    },
    async getDocs(collectionPath, ids, fields) {
      if (ids.length === 0) return [];
      const refs = ids.map((id) => db.collection(collectionPath).doc(id));
      const docs = await db.getAll(...refs, { fieldMask: [...fields] });
      return docs.flatMap((doc) => {
        const data = doc.data();
        return data ? [{ id: doc.id, data }] : [];
      });
    },
    close,
  });
}
