import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { geographyPoint } from './types'

export const subscriptionTier = pgEnum('subscription_tier', ['free', 'pro'])
export const avatarKind = pgEnum('avatar_kind', [
  'photo',
  'gravatar',
  'monogram',
  'emoji',
  'random',
])
export const listKind = pgEnum('list_kind', [
  'custom',
  'location',
  'group',
  'favorites',
  'promoted',
])
export const locationSource = pgEnum('location_source', ['osm', 'user'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarKind: avatarKind('avatar_kind').notNull().default('monogram'),
  avatarValue: text('avatar_value'),
  subscriptionTier: subscriptionTier('subscription_tier').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    geo: geographyPoint('geo').notNull(),
    canonicalName: text('canonical_name').notNull(),
    geocodedAddress: text('geocoded_address'),
    source: locationSource('source').notNull().default('osm'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    geoIdx: index('locations_geo_gist').using('gist', t.geo),
  }),
)

export const locationAliases = pgTable(
  'location_aliases',
  {
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    notes: text('notes'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.locationId, t.userId] }),
  }),
)

export const contacts = pgTable('contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  firstName: text('first_name'),
  lastName: text('last_name'),
  company: text('company'),
  avatarKind: avatarKind('avatar_kind').notNull().default('monogram'),
  avatarValue: text('avatar_value'),
  favorite: boolean('favorite').notNull().default(false),
  promoted: boolean('promoted').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

const multiValueColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  label: text('label'),
  value: text('value').notNull(),
}

export const contactPhones = pgTable('contact_phones', multiValueColumns)
export const contactEmails = pgTable('contact_emails', multiValueColumns)
export const contactAddresses = pgTable('contact_addresses', multiValueColumns)
export const contactSocials = pgTable('contact_socials', multiValueColumns)

export const contactPets = pgTable('contact_pets', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  species: text('species'),
  meta: jsonb('meta'),
})

export const interactions = pgTable('interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id')
    .notNull()
    .references(() => locations.id, { onDelete: 'restrict' }),
  metAt: timestamp('met_at', { withTimezone: true }).notNull().defaultNow(),
  notes: text('notes'),
})

export const lists = pgTable('lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: listKind('kind').notNull().default('custom'),
  coverImage: text('cover_image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const listLocations = pgTable(
  'list_locations',
  {
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.listId, t.locationId] }) }),
)

export const listChildren = pgTable(
  'list_children',
  {
    parentListId: uuid('parent_list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    childListId: uuid('child_list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.parentListId, t.childListId] }) }),
)

export const listMembers = pgTable(
  'list_members',
  {
    listId: uuid('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.listId, t.contactId] }) }),
)

export const userThemePrefs = pgTable('user_theme_prefs', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull().default('system'),
  activeThemeId: text('active_theme_id').notNull().default('default'),
  autoSeasonal: boolean('auto_seasonal').notNull().default(false),
})
