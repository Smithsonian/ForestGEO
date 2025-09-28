'use client';
import { useCallback, useMemo } from 'react';
import { useOrgCensusContext, usePlotContext, useSiteContext } from '@/app/contexts/userselectionprovider';

export interface ContextValidationResult {
  isValid: boolean;
  missing: string[];
  hasAll: boolean;
  site: any;
  plot: any;
  census: any;
}

export interface ContextValidationOptions {
  requireSite?: boolean;
  requirePlot?: boolean;
  requireCensus?: boolean;
  throwOnMissing?: boolean;
}

/**
 * Hook for validating and gracefully handling missing contextual values
 * Returns validation state and provides fallback mechanisms
 */
export function useContextValidation(options: ContextValidationOptions = {}) {
  const { requireSite = true, requirePlot = true, requireCensus = true, throwOnMissing = false } = options;

  const site = useSiteContext();
  const plot = usePlotContext();
  const census = useOrgCensusContext();

  const validationResult = useMemo((): ContextValidationResult => {
    const missing: string[] = [];

    if (requireSite && !site) missing.push('site');
    if (requirePlot && !plot) missing.push('plot');
    if (requireCensus && !census) missing.push('census');

    const isValid = missing.length === 0;
    const hasAll = Boolean(site && plot && census);

    return {
      isValid,
      missing,
      hasAll,
      site,
      plot,
      census
    };
  }, [site, plot, census, requireSite, requirePlot, requireCensus]);

  const validateContext = useCallback(() => {
    if (throwOnMissing && !validationResult.isValid) {
      throw new Error(`Missing required context values: ${validationResult.missing.join(', ')}`);
    }
    return validationResult;
  }, [validationResult, throwOnMissing]);

  const getContextIds = useCallback(() => {
    return {
      siteID: site?.siteID || null,
      plotID: plot?.plotID || null,
      censusID: census?.dateRanges?.[0]?.censusID || null,
      schemaName: site?.schemaName || null
    };
  }, [site, plot, census]);

  return {
    ...validationResult,
    validateContext,
    getContextIds,
    // Helper functions for common patterns
    canProceed: validationResult.isValid,
    requiresSelection: !validationResult.isValid,
    missingMessage: validationResult.missing.length > 0 ? `Please select: ${validationResult.missing.join(', ')}` : null
  };
}
