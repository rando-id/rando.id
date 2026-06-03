'use client'

import type { ReactNode } from 'react'
import { TamaguiProvider } from 'tamagui'
import { tamaguiConfig } from '@rando/ui/tamagui.config'

export function TamaguiProviderClient({ children }: { children: ReactNode }) {
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="light">
      {children}
    </TamaguiProvider>
  )
}
