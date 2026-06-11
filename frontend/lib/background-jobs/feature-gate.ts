function parseAllowList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

function allows(raw: string | undefined, value: string | undefined | null): boolean {
  const entries = parseAllowList(raw);
  if (entries.length === 0) return true;
  if (!value) return false;
  const normalized = value.toLowerCase();
  return entries.includes('*') || entries.includes(normalized);
}

export function isAsyncUploadEnabledFor({ schema, formType, userIds }: { schema?: string | null; formType?: string | null; userIds?: string[] }): boolean {
  if (process.env.ASYNC_UPLOAD_ENABLED !== 'true') return false;

  const userAllowed = parseAllowList(process.env.ASYNC_UPLOAD_ALLOWED_USERS);
  const matchesUser =
    userAllowed.length === 0 || userAllowed.includes('*') || (userIds ?? []).some(userID => userAllowed.includes(userID.trim().toLowerCase()));

  return allows(process.env.ASYNC_UPLOAD_ALLOWED_SCHEMAS, schema) && allows(process.env.ASYNC_UPLOAD_ALLOWED_FORMS, formType) && matchesUser;
}
