import { Suspense } from 'react'
import { ContactsList } from '../../src/features/contacts/ContactsList'

export default function Page() {
  return (
    <Suspense>
      <ContactsList />
    </Suspense>
  )
}
