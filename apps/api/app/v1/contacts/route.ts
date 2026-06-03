import { NextResponse } from 'next/server'
import type { ContactListItem } from '@rando/api-client'
import { getContactsNearby } from '@rando/db'
import { getDb } from '@/lib/db'
import { requireCurrentUser } from '@/lib/current-user'

function parseNear(value: string | null): { lat: number; lng: number } | null {
  if (!value) return null
  const [latStr, lngStr] = value.split(',')
  const lat = parseFloat(latStr ?? '')
  const lng = parseFloat(lngStr ?? '')
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export async function GET(req: Request) {
  try {
    const user = await requireCurrentUser()
    const url = new URL(req.url)
    const near = parseNear(url.searchParams.get('near'))

    const rows = await getContactsNearby(getDb(), user.id, near)

    const body: ContactListItem[] = rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      avatarKind: r.avatar_kind,
      avatarValue: r.avatar_value,
      favorite: r.favorite,
      promoted: r.promoted,
      location:
        r.location_id && r.location_name && r.lat != null && r.lng != null && r.meters != null
          ? {
              id: r.location_id,
              name: r.location_name,
              lat: r.lat,
              lng: r.lng,
              meters: r.meters,
            }
          : null,
    }))

    return NextResponse.json(body)
  } catch (e) {
    if (e instanceof Response) return e
    throw e
  }
}
