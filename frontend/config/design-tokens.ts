/**
 * Design Tokens
 * Centralized design values for consistent styling across the application
 */

export const designTokens = {
  // ============================================================================
  // Spacing Scale
  // ============================================================================
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
    xxxl: '64px'
  },

  // ============================================================================
  // Layout Sizes
  // ============================================================================
  sizes: {
    sidebarMin: '340px',
    sidebarMax: '500px',
    headerHeight: '52px',
    headerHeightMobile: '52px',
    contentMaxWidth: '1440px',
    formMaxWidth: '800px',
    cardMaxWidth: '400px'
  },

  // ============================================================================
  // Breakpoints (matches MUI Joy UI defaults)
  // ============================================================================
  breakpoints: {
    xs: '0px',
    sm: '600px',
    md: '960px',
    lg: '1280px',
    xl: '1920px'
  },

  // ============================================================================
  // Z-Index Layers
  // ============================================================================
  zIndex: {
    base: 0,
    dropdown: 1000,
    sidebar: 1000,
    sticky: 1100,
    fixed: 1200,
    modalBackdrop: 1300,
    modal: 1400,
    popover: 1500,
    tooltip: 1600,
    header: 9995,
    loadingOverlay: 1999
  },

  // ============================================================================
  // Transitions
  // ============================================================================
  transitions: {
    fast: '0.1s',
    normal: '0.2s',
    slow: '0.3s',
    verySlow: '0.5s',
    easing: 'ease-in-out',
    easingIn: 'ease-in',
    easingOut: 'ease-out',
    spring: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)'
  },

  // ============================================================================
  // Border Radius
  // ============================================================================
  radius: {
    none: '0',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    full: '9999px'
  },

  // ============================================================================
  // Shadows
  // ============================================================================
  shadows: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)'
  },

  // ============================================================================
  // Typography
  // ============================================================================
  typography: {
    fontFamily: {
      body: 'Inter, var(--joy-fontFamily-fallback)',
      display: 'Inter, var(--joy-fontFamily-fallback)',
      code: 'Source Code Pro, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    },
    fontSize: {
      xs: '0.75rem', // 12px
      sm: '0.875rem', // 14px
      md: '1rem', // 16px
      lg: '1.125rem', // 18px
      xl: '1.25rem', // 20px
      xxl: '1.5rem', // 24px
      xxxl: '2rem' // 32px
    },
    fontWeight: {
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800
    },
    lineHeight: {
      tight: 1.25,
      normal: 1.5,
      relaxed: 1.75,
      loose: 2
    }
  },

  // ============================================================================
  // Colors (Forest/Nature Theme)
  // ============================================================================
  colors: {
    // Forest Green (Primary)
    forestGreen: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      300: '#86efac',
      400: '#4ade80',
      500: '#22c55e', // Primary
      600: '#16a34a', // Primary dark
      700: '#15803d',
      800: '#166534',
      900: '#14532d'
    },

    // Earth Brown (Neutral)
    earthBrown: {
      50: '#fafaf9',
      100: '#f5f5f4',
      200: '#e7e5e4',
      300: '#d6d3d1',
      400: '#a8a29e',
      500: '#78716c',
      600: '#57534e',
      700: '#44403c',
      800: '#292524',
      900: '#1c1917'
    },

    // Sky Blue (Info/Secondary)
    skyBlue: {
      50: '#f0f9ff',
      100: '#e0f2fe',
      200: '#bae6fd',
      300: '#7dd3fc',
      400: '#38bdf8',
      500: '#0ea5e9',
      600: '#0284c7',
      700: '#0369a1',
      800: '#075985',
      900: '#0c4a6e'
    },

    // Sunset Orange (Warning)
    sunsetOrange: {
      50: '#fff7ed',
      100: '#ffedd5',
      200: '#fed7aa',
      300: '#fdba74',
      400: '#fb923c',
      500: '#f59e0b', // Warning
      600: '#d97706',
      700: '#b45309',
      800: '#92400e',
      900: '#78350f'
    },

    // Danger Red
    dangerRed: {
      50: '#fef2f2',
      100: '#fee2e2',
      200: '#fecaca',
      300: '#fca5a5',
      400: '#f87171',
      500: '#ef4444', // Danger
      600: '#dc2626',
      700: '#b91c1c',
      800: '#991b1b',
      900: '#7f1d1d'
    }
  },

  // ============================================================================
  // Component-Specific Tokens
  // ============================================================================
  components: {
    button: {
      minHeight: '44px',
      minWidth: '44px',
      paddingX: '16px',
      paddingY: '8px'
    },
    input: {
      minHeight: '44px',
      paddingX: '12px',
      paddingY: '8px'
    },
    card: {
      padding: '24px',
      borderRadius: '12px'
    },
    modal: {
      padding: '32px',
      maxWidth: '600px'
    },
    sidebar: {
      padding: '16px',
      itemHeight: '44px'
    },
    datagrid: {
      rowHeight: '52px',
      headerHeight: '56px'
    }
  }
} as const;

// Export type for TypeScript
export type DesignTokens = typeof designTokens;

// Helper function to get spacing value
export const getSpacing = (size: keyof typeof designTokens.spacing): string => {
  return designTokens.spacing[size];
};

// Helper function to get color value
export const getColor = (palette: keyof typeof designTokens.colors, shade: 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900): string => {
  return designTokens.colors[palette][shade];
};

// Helper function to get transition
export const getTransition = (
  property: string | string[],
  duration: keyof typeof designTokens.transitions = 'normal',
  easing: keyof Pick<typeof designTokens.transitions, 'easing' | 'easingIn' | 'easingOut' | 'spring'> = 'easing'
): string => {
  const properties = Array.isArray(property) ? property : [property];
  return properties.map(prop => `${prop} ${designTokens.transitions[duration]} ${designTokens.transitions[easing]}`).join(', ');
};
