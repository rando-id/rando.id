import { ListDetailView } from '../../../src/features/lists/ListDetailView'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ListDetailView id={id} />
}
