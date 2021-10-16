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

export function getKey(census: Tree): string {
  return `${census.Tag}${census.Subquadrat}`;
}
