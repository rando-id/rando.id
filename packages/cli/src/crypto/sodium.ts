// libsodium sealed-box encryption for GitHub Actions / Environment secrets.
// GitHub's secrets API expects values encrypted with crypto_box_seal under
// the repo or environment's curve25519 public key, then base64-encoded.

import sodium from 'libsodium-wrappers'

let readyPromise: Promise<void> | null = null

function ready(): Promise<void> {
  if (!readyPromise) readyPromise = sodium.ready
  return readyPromise
}

/**
 * Encrypt `value` for upload to GitHub's secrets API.
 *
 * @param value plaintext secret
 * @param publicKeyBase64 base64-encoded 32-byte curve25519 public key
 *        (from `/repos/.../actions/secrets/public-key` or its environment sibling)
 * @returns base64-encoded ciphertext suitable for the `encrypted_value` field
 */
export async function encryptSecretForGitHub(
  value: string,
  publicKeyBase64: string,
): Promise<string> {
  await ready()
  const messageBytes = Buffer.from(value, 'utf-8')
  const keyBytes = Buffer.from(publicKeyBase64, 'base64')
  const encrypted = sodium.crypto_box_seal(messageBytes, keyBytes)
  return Buffer.from(encrypted).toString('base64')
}
