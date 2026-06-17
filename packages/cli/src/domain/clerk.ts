// Clerk Backend API surface — wraps the official `clerk` CLI's
// `api` subcommand so we get auth (--secret-key) and pagination for
// free. The adapter shells out per call; we don't hold any session.
//
// We don't model Clerk's whole API — only the bits Rando needs to
// automate staging/prod setup that would otherwise have to happen
// in the dashboard.

export interface ClerkProvider {
  /**
   * Cheap reachability probe — hits `GET /users/count`. Returns the
   * user count if auth is good; throws ProviderApiError otherwise.
   * `count` doubles as a sanity number for the operator.
   */
  whoami(): Promise<{ count: number }>

  /**
   * Ensure a Svix app exists for this Clerk instance. Idempotent —
   * if the app already exists, returns `{ alreadyExists: true }` and
   * suppresses the API's "already created" error.
   */
  ensureSvixApp(): Promise<{ alreadyExists: boolean }>

  /**
   * Get a deep-link into the Svix dashboard for THIS Clerk instance.
   * The URL is a one-time-use admin login; pasting it in a browser
   * drops the operator straight onto the webhook endpoints page where
   * they can create the endpoint and copy the signing secret.
   */
  getSvixDashboardUrl(): Promise<{ url: string }>

  /**
   * Create a Clerk user via the Backend API. Email + password is the
   * minimum; first/last name optional. Used for seeding test users
   * into staging without touching the dashboard.
   */
  createUser(input: ClerkCreateUserInput): Promise<ClerkUser>
}

export interface ClerkCreateUserInput {
  email: string
  password: string
  firstName?: string
  lastName?: string
}

export interface ClerkUser {
  id: string
  email: string
}
