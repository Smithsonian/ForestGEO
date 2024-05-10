// db.ts
import { openDB, IDBPDatabase, DBSchema } from 'idb';

interface MyDB extends DBSchema {
  MyStore: {
    key: string;
    value: any;
  };
}

const dbName = 'MyDatabase';
const storeName = 'MyStore';

// Function to dynamically get or upgrade the database
async function getDb(): Promise<IDBPDatabase<MyDB>> {
  // Open the database to check the current version
  let db;
  try {
    db = await openDB<MyDB>(dbName);
    const currentVersion = db.version;
    db.close();

    // Re-open the database with the current version if no upgrade is needed
    return openDB<MyDB>(dbName, currentVersion, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      },
    });
  } catch (err) {
    if (db) db.close();
    // If db doesn't exist or other errors, attempt to open with version 1 or create if necessary
    return openDB<MyDB>(dbName, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      },
    });
  }
}

export async function getData(key: string): Promise<any> {
  const db = await getDb();
  return db.get(storeName, key);
}

export async function setData(key: string, val: any): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readwrite');
  await tx.objectStore(storeName).put(val, key);
  await tx.done;
}

export async function clearAllIDBData(): Promise<void> {
  const db = await getDb();
  const currentVersion = db.version;
  db.close();

  const newDb = await openDB<MyDB>(dbName, currentVersion + 1, {
    upgrade(db) {
      if (db.objectStoreNames.contains(storeName)) {
        db.deleteObjectStore(storeName);
      }
      db.createObjectStore(storeName);
    },
  });
  newDb.close();
}

export async function clearDataByKey(key: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(storeName, 'readwrite');
  await tx.objectStore(storeName).delete(key);
  await tx.done;
}
