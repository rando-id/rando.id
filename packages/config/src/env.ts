import { z } from 'zod'

export const sharedEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  RANDO_API_URL: z.string().url().optional(),
})

export type SharedEnv = z.infer<typeof sharedEnvSchema>
