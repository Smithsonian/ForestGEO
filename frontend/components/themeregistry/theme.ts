/**
 * ForestGEO Theme Configuration
 * Comprehensive design system with Forest/Nature-inspired colors
 */

import { extendTheme } from '@mui/joy/styles';
import { Inter, Source_Code_Pro } from 'next/font/google';
import { designTokens } from '@/config/design-tokens';

const inter = Inter({
  subsets: ['latin'],
  adjustFontFallback: false,
  fallback: ['var(--joy-fontFamily-fallback)'],
  display: 'swap'
});

const sourceCodePro = Source_Code_Pro({
  subsets: ['latin'],
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', 'monospace'],
  display: 'swap'
});

const theme = extendTheme({
  // ============================================================================
  // Color Schemes
  // ============================================================================
  colorSchemes: {
    dark: {
      palette: {
        // Forest Green as Primary
        primary: {
          ...designTokens.colors.forestGreen,
          solidBg: designTokens.colors.forestGreen[600],
          solidHoverBg: designTokens.colors.forestGreen[700],
          solidActiveBg: designTokens.colors.forestGreen[800],
          softBg: designTokens.colors.forestGreen[900],
          softHoverBg: designTokens.colors.forestGreen[800],
          outlinedBorder: designTokens.colors.forestGreen[600],
          outlinedHoverBg: designTokens.colors.forestGreen[900]
        },

        // Earth Brown as Neutral
        neutral: {
          ...designTokens.colors.earthBrown,
          solidBg: designTokens.colors.earthBrown[600],
          solidHoverBg: designTokens.colors.earthBrown[700],
          solidActiveBg: designTokens.colors.earthBrown[800]
        },

        // Success (using Forest Green lighter shades)
        success: {
          solidBg: designTokens.colors.forestGreen[500],
          solidHoverBg: designTokens.colors.forestGreen[600],
          solidActiveBg: designTokens.colors.forestGreen[700]
        },

        // Danger (using Danger Red)
        danger: {
          solidBg: designTokens.colors.dangerRed[500],
          solidHoverBg: designTokens.colors.dangerRed[600],
          solidActiveBg: designTokens.colors.dangerRed[700]
        },

        // Warning (using Sunset Orange)
        warning: {
          solidBg: designTokens.colors.sunsetOrange[500],
          solidHoverBg: designTokens.colors.sunsetOrange[600],
          solidActiveBg: designTokens.colors.sunsetOrange[700]
        }
      }
    }
  },

  // ============================================================================
  // Typography
  // ============================================================================
  fontFamily: {
    body: inter.style.fontFamily,
    display: inter.style.fontFamily,
    code: sourceCodePro.style.fontFamily
  },

  fontWeight: {
    sm: designTokens.typography.fontWeight.normal,
    md: designTokens.typography.fontWeight.medium,
    lg: designTokens.typography.fontWeight.semibold,
    xl: designTokens.typography.fontWeight.bold
  },

  // ============================================================================
  // Spacing
  // ============================================================================
  spacing: (factor: number) => `${0.25 * factor}rem`,

  // ============================================================================
  // Border Radius
  // ============================================================================
  radius: {
    xs: designTokens.radius.sm,
    sm: designTokens.radius.md,
    md: designTokens.radius.lg,
    lg: designTokens.radius.xl,
    xl: designTokens.radius.xl
  },

  // ============================================================================
  // Component Customization
  // ============================================================================
  components: {
    // Button
    JoyButton: {
      defaultProps: {
        size: 'md'
      },
      styleOverrides: {
        root: ({ theme, ownerState }) => ({
          minHeight: designTokens.components.button.minHeight,
          minWidth: designTokens.components.button.minWidth,
          borderRadius: theme.vars.radius.sm,
          fontWeight: theme.vars.fontWeight.md,
          transition: `all ${designTokens.transitions.normal} ${designTokens.transitions.easing}`,

          // Primary button customization
          ...(ownerState.color === 'primary' && {
            backgroundColor: designTokens.colors.forestGreen[600],
            '&:hover': {
              backgroundColor: designTokens.colors.forestGreen[700],
              transform: 'translateY(-1px)',
              boxShadow: designTokens.shadows.md
            },
            '&:active': {
              transform: 'translateY(0)',
              backgroundColor: designTokens.colors.forestGreen[800]
            },
            '&:focus-visible': {
              outline: `2px solid ${designTokens.colors.forestGreen[400]}`,
              outlineOffset: '2px'
            }
          })
        })
      }
    },

    // Card
    JoyCard: {
      styleOverrides: {
        root: ({ theme: _theme }) => ({
          borderRadius: designTokens.components.card.borderRadius,
          boxShadow: designTokens.shadows.sm,
          transition: `box-shadow ${designTokens.transitions.normal} ${designTokens.transitions.easing}`,
          '&:hover': {
            boxShadow: designTokens.shadows.md
          }
        })
      }
    },

    // Input
    JoyInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          minHeight: designTokens.components.input.minHeight,
          borderRadius: theme.vars.radius.sm,
          transition: `all ${designTokens.transitions.fast} ${designTokens.transitions.easing}`,
          '&:focus-within': {
            borderColor: designTokens.colors.forestGreen[500],
            boxShadow: `0 0 0 2px ${designTokens.colors.forestGreen[500]}33`
          }
        })
      }
    },

    // Textarea
    JoyTextarea: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: theme.vars.radius.sm,
          transition: `all ${designTokens.transitions.fast} ${designTokens.transitions.easing}`,
          '&:focus-within': {
            borderColor: designTokens.colors.forestGreen[500],
            boxShadow: `0 0 0 2px ${designTokens.colors.forestGreen[500]}33`
          }
        })
      }
    },

    // Select
    JoySelect: {
      styleOverrides: {
        root: ({ theme }) => ({
          minHeight: designTokens.components.input.minHeight,
          borderRadius: theme.vars.radius.sm,
          transition: `all ${designTokens.transitions.fast} ${designTokens.transitions.easing}`
        })
      }
    },

    // Tooltip
    JoyTooltip: {
      defaultProps: {
        disableTouchListener: true,
        sx: {
          leaveDelay: 100,
          pointerEvents: 'none'
        }
      },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: designTokens.colors.earthBrown[800],
          fontSize: designTokens.typography.fontSize.sm,
          padding: `${designTokens.spacing.xs} ${designTokens.spacing.sm}`,
          borderRadius: theme.vars.radius.sm,
          maxWidth: '300px'
        })
      }
    },

    // Modal
    JoyModal: {
      styleOverrides: {
        root: {
          zIndex: designTokens.zIndex.modal
        }
      }
    },

    JoyModalDialog: {
      styleOverrides: {
        root: ({ theme }) => ({
          maxWidth: designTokens.components.modal.maxWidth,
          padding: designTokens.components.modal.padding,
          borderRadius: theme.vars.radius.md,
          boxShadow: designTokens.shadows.xl
        })
      }
    },

    // Chip
    JoyChip: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: theme.vars.radius.md,
          fontWeight: theme.vars.fontWeight.md
        })
      }
    },

    // IconButton
    JoyIconButton: {
      styleOverrides: {
        root: {
          minHeight: designTokens.components.button.minHeight,
          minWidth: designTokens.components.button.minWidth,
          transition: `all ${designTokens.transitions.fast} ${designTokens.transitions.easing}`,
          '&:hover': {
            transform: 'scale(1.05)'
          },
          '&:active': {
            transform: 'scale(0.95)'
          }
        }
      }
    },

    // List
    JoyList: {
      styleOverrides: {
        root: {
          '--ListItem-minHeight': designTokens.components.sidebar.itemHeight
        }
      }
    },

    // ListItemButton
    JoyListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          minHeight: designTokens.components.sidebar.itemHeight,
          borderRadius: theme.vars.radius.sm,
          transition: `all ${designTokens.transitions.fast} ${designTokens.transitions.easing}`,
          '&:hover': {
            backgroundColor: designTokens.colors.forestGreen[900] + '50' // 50 is opacity
          },
          '&.Mui-selected': {
            backgroundColor: designTokens.colors.forestGreen[800] + '80',
            '&:hover': {
              backgroundColor: designTokens.colors.forestGreen[700] + '80'
            }
          }
        })
      }
    },

    // Alert
    JoyAlert: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: theme.vars.radius.md,
          padding: designTokens.spacing.md
        })
      }
    },

    // Divider
    JoyDivider: {
      styleOverrides: {
        root: {
          margin: `${designTokens.spacing.md} 0`
        }
      }
    }
  }
});

export default theme;
