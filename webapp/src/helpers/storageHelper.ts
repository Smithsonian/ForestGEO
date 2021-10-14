export async function getAllItems<T>(store: LocalForage): Promise<T[]> {
  const data: T[] = [];
  await store?.iterate((value: T) => data.push(value));

  return data;
}
