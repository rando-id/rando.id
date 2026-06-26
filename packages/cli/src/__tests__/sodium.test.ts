import { describe, expect, it } from 'vitest'
import sodium from 'libsodium-wrappers'
import { encryptSecretForGitHub } from '../crypto/sodium'

describe('encryptSecretForGitHub', () => {
  it('produces ciphertext decryptable by the matching private key', async () => {
    await sodium.ready
    const kp = sodium.crypto_box_keypair()
    const publicKeyB64 = Buffer.from(kp.publicKey).toString('base64')

    const plaintext = 'super-secret-value'
    const encryptedB64 = await encryptSecretForGitHub(plaintext, publicKeyB64)
    const ciphertext = Buffer.from(encryptedB64, 'base64')

    // Round-trip with the matching private key. GitHub's API does the
    // decrypt server-side using the repo's private key; we verify the
    // shape locally with a known keypair.
    const decrypted = sodium.crypto_box_seal_open(ciphertext, kp.publicKey, kp.privateKey)
    expect(Buffer.from(decrypted).toString('utf-8')).toBe(plaintext)
  })

  it('produces different ciphertext on repeated calls (sealed box is nondeterministic)', async () => {
    await sodium.ready
    const kp = sodium.crypto_box_keypair()
    const publicKeyB64 = Buffer.from(kp.publicKey).toString('base64')
    const a = await encryptSecretForGitHub('x', publicKeyB64)
    const b = await encryptSecretForGitHub('x', publicKeyB64)
    expect(a).not.toBe(b)
  })
})
