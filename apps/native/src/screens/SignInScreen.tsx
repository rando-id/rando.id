import { useState } from 'react'
import { useSignIn } from '@clerk/clerk-expo'
import { Button, Input, Text, YStack } from 'tamagui'

export function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!isLoaded) return null

  const submit = async () => {
    setError(null)
    try {
      const attempt = await signIn.create({ identifier: email, password })
      if (attempt.status === 'complete') {
        await setActive({ session: attempt.createdSessionId })
      } else {
        setError(`Status: ${attempt.status}`)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    }
  }

  return (
    <YStack flex={1} p="$6" gap="$3" justify="center">
      <Text fontSize="$8" fontWeight="600">
        Sign in
      </Text>
      <Input value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" />
      <Input value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
      <Button onPress={submit}>Continue</Button>
      {error ? <Text color="$red10">{error}</Text> : null}
    </YStack>
  )
}
