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

async function getDb(): Promise<IDBPDatabase<MyDB>> {
  try {
    // Always specify a version and ensure the object store is created during upgrade
    const db = await openDB<MyDB>(dbName, 1, {
      upgrade(db, oldVersion, newVersion, transaction) {
        if (!db.objectStoreNames.contains(storeName)) {
          console.log(`Creating object store: ${storeName}`);
          db.createObjectStore(storeName);
        }
      },
    });

    if (!db.objectStoreNames.contains(storeName)) {
      throw new Error(`Object store ${storeName} was not created`);
    }

    return db;
  } catch (err) {
    console.error('Failed to open the database', err);
    throw err;
  }
}

export async function getData(key: string): Promise<any> {
  try {
    const db = await getDb();
    return await db.get(storeName, key);
  } catch (err) {
    console.error(`Failed to get data for key ${key}`, err);
    throw err;
  }
}

export async function setData(key: string, val: any): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(storeName, 'readwrite');
    await tx.objectStore(storeName).put(val, key);
    await tx.done;
  } catch (err) {
    console.error(`Failed to set data for key ${key}`, err);
    throw err;
  }
}

export async function clearAllIDBData(): Promise<void> {
  try {
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
  } catch (err) {
    console.error('Failed to clear all IDB data', err);
    throw err;
  }
}

export async function clearDataByKey(key: string): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(storeName, 'readwrite');
    await tx.objectStore(storeName).delete(key);
    await tx.done;
  } catch (err) {
    console.error(`Failed to clear data for key ${key}`, err);
    throw err;
  }
}
