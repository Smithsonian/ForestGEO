'use client';

import { useEffect, useState } from 'react';
import type { FormType } from '@/config/macros/formdetails';
import ailogger from '@/ailogger';

export function useAsyncUploadFeature({ schema, formType }: { schema?: string | null; formType?: FormType | string | null }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!schema || !formType) {
      setEnabled(false);
      return;
    }

    let cancelled = false;
    const schemaName = schema;
    const formTypeName = String(formType);

    async function loadFlag() {
      try {
        const params = new URLSearchParams({ schema: schemaName, formType: formTypeName });
        const response = await fetch(`/api/features/async-upload?${params.toString()}`);
        if (!response.ok) {
          if (!cancelled) setEnabled(false);
          return;
        }
        const payload = (await response.json()) as { enabled?: boolean };
        if (!cancelled) setEnabled(payload.enabled === true);
      } catch (error) {
        ailogger.warn('[useAsyncUploadFeature] Failed to load async upload flag:', error instanceof Error ? error : new Error(String(error)));
        if (!cancelled) setEnabled(false);
      }
    }

    loadFlag();

    return () => {
      cancelled = true;
    };
  }, [schema, formType]);

  return enabled;
}
