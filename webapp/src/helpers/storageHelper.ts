import { Tree } from "../types";

export async function getAllItems<T>(store: LocalForage): Promise<T[]> {
  return new Promise<T[]>((resolve) => {
    const data: T[] = [];
    store?.iterate(
      (value: T) => {
        // note: return non undefined value here will exit the iteration early.
        data.push(value);
      },
      () => resolve(data)
    );
  });
}

// eslint-disable-next-line no-unused-vars
export function getKey(census: Tree): string {
  // The backend doesn't return a unique key. (Tag+Subquadrat) isn't unique per record.
  // As a temp workaround, we generate unique id to make sure there's no conflict when saving data to key-value pair local store.
  // TODO: Update the backend to return id property of the document.
  const uniqueId =
    Date.now().toString(36) + Math.random().toString(36).substring(2);
  return uniqueId;
}
