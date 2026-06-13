import { ContactDetailView } from '../../../src/features/contacts/ContactDetailView'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ContactDetailView id={id} />
}
