// Tiny promise wrapper around IndexedDB: one database, two stores.
const DB_NAME = 'learningcenter';
const DB_VERSION = 1;
export const FILES = 'files';
export const KV = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await open();
  return wrap(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function idbSet(store: string, key: string, value: unknown): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).put(value, key));
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export async function idbKeys(store: string): Promise<string[]> {
  const db = await open();
  return (await wrap(db.transaction(store).objectStore(store).getAllKeys())) as string[];
}

export async function idbClear(store: string): Promise<void> {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).clear());
}

/** All entries whose key starts with `prefix`. */
export async function idbEntries(store: string, prefix: string): Promise<[string, unknown][]> {
  const db = await open();
  const range = IDBKeyRange.bound(prefix, prefix + '￿');
  const tx = db.transaction(store).objectStore(store);
  const [keys, values] = await Promise.all([wrap(tx.getAllKeys(range)), wrap(tx.getAll(range))]);
  return (keys as string[]).map((k, i) => [k, values[i]]);
}
