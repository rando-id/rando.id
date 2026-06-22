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

/**
 * Raised when a Postman operation is blocked by a plan limit (e.g. the
 * Free tier allows 0 APIs). Distinct from a missing-scope auth failure
 * — no PAT change will unblock it; only a plan upgrade will. Commands
 * catch this specifically so the user sees "plan upgrade required"
 * rather than a raw 400 JSON dump.
 */
export class PostmanPlanLimitError extends ProviderApiError {
  constructor(
    public readonly limit: string,
    body: string,
  ) {
    super(
      'postman',
      400,
      body,
      `Postman plan limit reached: ${limit}. Upgrade your Postman plan to enable this feature.`,
    )
    this.name = 'PostmanPlanLimitError'
  }
}
