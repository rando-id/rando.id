// Errors that adapters throw so commands can produce useful CLI output.

/** Raised when an upstream API returns a non-success response. */
export class ProviderApiError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    public readonly body: string,
    message?: string,
  ) {
    super(message ?? `${provider} API error ${status}: ${body}`)
    this.name = 'ProviderApiError'
  }
}

/** Raised when a requested resource doesn't exist. */
export class NotFoundError extends Error {
  constructor(resource: string, identifier: string) {
    super(`${resource} not found: ${identifier}`)
    this.name = 'NotFoundError'
  }
}

/** Raised when env-var configuration for an adapter is missing. */
export class MissingConfigError extends Error {
  constructor(
    public readonly variable: string,
    public readonly forAdapter: string,
  ) {
    super(`Missing required env var "${variable}" for ${forAdapter} adapter`)
    this.name = 'MissingConfigError'
  }
}
