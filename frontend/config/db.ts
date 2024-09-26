import { DBSchema, IDBPDatabase, openDB } from 'idb';

interface MyDB extends DBSchema {
  MyStore: {
    key: string;
    value: any;
  };
}

const dbName = 'MyDatabase';
const storeName = 'MyStore';

async function getDb(): Promise<IDBPDatabase<MyDB>> {
  const db = await openDB<MyDB>(dbName, undefined, {
    upgrade(db, oldVersion, newVersion, transaction) {
      console.log('db.ts: db object store names: ', db.objectStoreNames);
      if (!db.objectStoreNames.contains(storeName)) {
        console.log(`Creating object store: ${storeName}`);
        db.createObjectStore(storeName);
      }
    }
  });

  return db;
}

export async function ensureObjectStore() {
  try {
    let db = await openDB<MyDB>(dbName);
    const currentVersion = db.version;
    db.close();
    db = await openDB<MyDB>(dbName, currentVersion + 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    });
    db.close();
  } catch (err) {
    console.error('Error ensuring object store:', err);
    throw err;
  }
}

export async function fetchDataFromMySQL(key: string, endpoint: string): Promise<any> {
  await ensureObjectStore();
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('Failed to fetch data from MySQL', err);
    // Attempt IDB fetch (backup)
    try {
      const db = await getDb();
      const idbData = await db.get(storeName, key);
      if (idbData !== undefined) {
        return idbData;
      }
      throw new Error('No data found in backup IDB');
    } catch (error) {
      console.error('Failed to retrieve data from backup IDB', error);
      throw error;
    }
  }
}

export async function getDataFromIDB(key: string): Promise<any> {
  await ensureObjectStore();
  try {
    const db = await getDb();
    const data = await db.get(storeName, key);
    if (data === undefined) {
      throw new Error(`No data found in IDB for key ${key}`);
    }
    return data;
  } catch (err) {
    console.error(`Failed to get data from IDB for key ${key}`, err);
    throw err;
  }
}

export async function setData(key: string, val: any): Promise<void> {
  await ensureObjectStore();
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
    const db = await openDB<MyDB>(dbName);
    const currentVersion = db.version;
    db.close();

    const newDb = await openDB<MyDB>(dbName, currentVersion + 1, {
      upgrade(db) {
        if (db.objectStoreNames.contains(storeName)) {
          db.deleteObjectStore(storeName);
        }
        db.createObjectStore(storeName);
      }
    });
    newDb.close();
  } catch (err) {
    console.error('Failed to clear all IDB data', err);
    throw err;
  }
}

export async function getData(key: string, endpoint?: string): Promise<any> {
  await ensureObjectStore();
  try {
    if (endpoint) {
      const data = await fetchDataFromMySQL(key, endpoint);
      if (data === undefined) {
        throw new Error(`Data for key ${key} is undefined`);
      }
      await setData(key, data); // Backup to IDB
      return data;
    } else {
      // Fetch from IDB only
      return await getDataFromIDB(key);
    }
  } catch (err) {
    console.error(`Failed to get data for key ${key}`, err);
    throw err;
  }
}

export async function clearDataByKey(key: string): Promise<void> {
  await ensureObjectStore();
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
