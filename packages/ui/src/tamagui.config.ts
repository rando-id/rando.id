import { defaultConfig } from '@tamagui/config/v4'
import { createTamagui } from 'tamagui'

export const tamaguiConfig = createTamagui(defaultConfig)

// Aliases for Tamagui's babel plugin, which looks for `config` or `default`.
export const config = tamaguiConfig
export default tamaguiConfig

export type AppTamaguiConfig = typeof tamaguiConfig

declare module 'tamagui' {
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}
