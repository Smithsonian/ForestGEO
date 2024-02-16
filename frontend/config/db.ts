// db.ts
import {DBSchema, IDBPDatabase, openDB} from 'idb';

interface MyDB extends DBSchema {
  MyStore: {
    key: string;
    value: any;
  };
}

const dbName = 'MyDatabase';
const storeName = 'MyStore';

async function getDb(): Promise<IDBPDatabase<MyDB>> {
  return openDB<MyDB>(dbName, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    },
  });
}

export async function getData(key: string): Promise<any> {
  const db = await getDb();
  return db.get(storeName, key);
}

export async function setData(key: string, val: any): Promise<void> {
  if (val) {
    const db = await getDb();
    const tx = db.transaction(storeName, 'readwrite');
    await tx.objectStore(storeName).put(val, key);
    await tx.done;
  }
}

export async function clearAllIDBData() {
  console.log(`Clearing all IDB data`);
  const db = await getDb();
  const storeNames = Array.from(db.objectStoreNames);

  const transaction = db.transaction(storeNames, 'readwrite');
  storeNames.forEach(storeName => {
    transaction.objectStore(storeName).clear();
  });

  await transaction.done;
  db.close();
  console.log(`IDB data cleared`);
}

export async function clearDataByKey(key: string): Promise<void> {
  console.log(`Clearing data for key: ${key}`);
  const db = await getDb();
  const tx = db.transaction(storeName, 'readwrite');
  await tx.objectStore(storeName).delete(key);
  await tx.done;
  console.log(`Data cleared for key: ${key}`);
}