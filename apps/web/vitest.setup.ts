// Vitest global setup. Auto-cleanup between tests and DOM matchers from
// @testing-library/jest-dom (toBeInTheDocument, toHaveTextContent, etc).

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
