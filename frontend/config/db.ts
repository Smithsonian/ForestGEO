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
        console.log(`${storeName} not found in IDB. Creating...`);
        db.createObjectStore(storeName);
        console.log(`Store for ${storeName} created.`);
      }
    },
  });
}

export async function getData(key: string): Promise<any> {
  console.log(`attempting to access data from store: ${key}`);
  const db = await getDb();
  return db.get(storeName, key);
}

export async function setData(key: string, val: any): Promise<void> {
  console.log(`Attempting to store data ${val || 'undefined'} at storeName ${key}`);
  if (!val) console.log('undefined data set, skipping');
  else {
    console.log('val not undefined');
    const db = await getDb();
    const tx = db.transaction(storeName, 'readwrite');
    await tx.objectStore(storeName).put(val, key);
    await tx.done;
    console.log(`Data storage complete.`);
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