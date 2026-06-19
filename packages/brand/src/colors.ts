// Brand color tokens. Single source of truth for what "Rando" looks
// like as a color system. Names are semantic (the role) rather than
// literal (the RGB) so consumers don't bind to specific hexes —
// makes future palette tweaks a no-op at the call site.
//
// Tamagui themes in @rando/config consume these for standard theme
// slots (background, foreground, accent, etc.). Brand-specific roles
// without a standard slot (silhouette in particular) stay reachable
// via this module directly.

export type BrandColors = {
  surface: {
    base: string
    subtle: string
  }
  ink: {
    primary: string
    silhouette: string
  }
  accent: {
    secondary: string
    highlight: string
  }
}

export const lightColors: BrandColors = {
  surface: {
    base: '#F7F5F0', // Light Cream — main background
    subtle: '#F1EDE8', // Off-White — secondary surfaces (avatar circles, cards)
  },
  ink: {
    primary: '#383D3B', // Deep Charcoal — text + primary map contours
    silhouette: '#383D3B', // Avatar silhouettes — same as primary in light
  },
  accent: {
    secondary: '#E89C8A', // Terra Cotta — secondary map contours
    highlight: '#F7A590', // Coral Red — active selection rings
  },
}

export const darkColors: BrandColors = {
  surface: {
    base: '#1A1D1C', // Night Sky Gray — main background
    subtle: '#383D3B', // Mid-Tone Gray — secondary surfaces
  },
  ink: {
    primary: '#E8E6E2', // Soft White — text + primary map contours
    silhouette: '#F1EDE8', // Off-White — avatar silhouettes (brighter, for contrast against the dark avatar bg)
  },
  accent: {
    secondary: '#D68F7E', // Muted Terra Cotta — secondary map contours
    highlight: '#F7A590', // Luminous Coral — active selection rings (unchanged from light)
  },
}
