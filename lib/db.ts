import { neon } from '@neondatabase/serverless';
import { Contact, CreateContactInput } from './types';

const sql = neon(process.env.DATABASE_URL!);

export async function createContactsTable() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR(255) NOT NULL,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        email VARCHAR(255),
        phone_number VARCHAR(50),
        phone_number_alt VARCHAR(50),
        company VARCHAR(255),
        job_title VARCHAR(255),
        address TEXT,
        pet_name VARCHAR(255),
        pet_type VARCHAR(100),
        spouse_name VARCHAR(255),
        children_names TEXT,
        birthday DATE,
        anniversary DATE,
        notes TEXT,
        latitude DECIMAL(10, 8) NOT NULL,
        longitude DECIMAL(11, 8) NOT NULL,
        location_name VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;

    // Create index on user_id for faster queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
    `;

    // Create index on location for spatial queries
    await sql`
      CREATE INDEX IF NOT EXISTS idx_contacts_location ON contacts(latitude, longitude);
    `;

    console.log('Contacts table created successfully');
  } catch (error) {
    console.error('Error creating contacts table:', error);
    throw error;
  }
}

export async function createContact(userId: string, data: CreateContactInput): Promise<Contact> {
  const result = await sql`
    INSERT INTO contacts (
      user_id, first_name, last_name, email, phone_number, phone_number_alt,
      company, job_title, address, pet_name, pet_type, spouse_name,
      children_names, birthday, anniversary, notes, latitude, longitude, location_name
    )
    VALUES (
      ${userId}, ${data.firstName || null}, ${data.lastName || null},
      ${data.email || null}, ${data.phoneNumber || null}, ${data.phoneNumberAlt || null},
      ${data.company || null}, ${data.jobTitle || null}, ${data.address || null},
      ${data.petName || null}, ${data.petType || null}, ${data.spouseName || null},
      ${data.childrenNames || null}, ${data.birthday || null}, ${data.anniversary || null},
      ${data.notes || null}, ${data.latitude}, ${data.longitude}, ${data.locationName || null}
    )
    RETURNING *
  `;

  return mapContact(result[0]);
}

export async function getContactsByUserId(userId: string): Promise<Contact[]> {
  const result = await sql`
    SELECT * FROM contacts
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;

  return result.map(mapContact);
}

export async function getContactById(id: string, userId: string): Promise<Contact | null> {
  const result = await sql`
    SELECT * FROM contacts
    WHERE id = ${id} AND user_id = ${userId}
  `;

  if (result.length === 0) return null;
  return mapContact(result[0]);
}

export async function updateContact(
  id: string,
  userId: string,
  data: Partial<CreateContactInput>
): Promise<Contact> {
  const result = await sql`
    UPDATE contacts
    SET
      first_name = COALESCE(${data.firstName}, first_name),
      last_name = COALESCE(${data.lastName}, last_name),
      email = COALESCE(${data.email}, email),
      phone_number = COALESCE(${data.phoneNumber}, phone_number),
      phone_number_alt = COALESCE(${data.phoneNumberAlt}, phone_number_alt),
      company = COALESCE(${data.company}, company),
      job_title = COALESCE(${data.jobTitle}, job_title),
      address = COALESCE(${data.address}, address),
      pet_name = COALESCE(${data.petName}, pet_name),
      pet_type = COALESCE(${data.petType}, pet_type),
      spouse_name = COALESCE(${data.spouseName}, spouse_name),
      children_names = COALESCE(${data.childrenNames}, children_names),
      birthday = COALESCE(${data.birthday}, birthday),
      anniversary = COALESCE(${data.anniversary}, anniversary),
      notes = COALESCE(${data.notes}, notes),
      latitude = COALESCE(${data.latitude}, latitude),
      longitude = COALESCE(${data.longitude}, longitude),
      location_name = COALESCE(${data.locationName}, location_name),
      updated_at = NOW()
    WHERE id = ${id} AND user_id = ${userId}
    RETURNING *
  `;

  return mapContact(result[0]);
}

export async function deleteContact(id: string, userId: string): Promise<void> {
  await sql`
    DELETE FROM contacts
    WHERE id = ${id} AND user_id = ${userId}
  `;
}

export async function getContactsNearLocation(
  userId: string,
  latitude: number,
  longitude: number,
  radiusKm: number = 5
): Promise<Contact[]> {
  // Using Haversine formula for distance calculation
  const result = await sql`
    SELECT *,
      (6371 * acos(
        cos(radians(${latitude})) *
        cos(radians(latitude)) *
        cos(radians(longitude) - radians(${longitude})) +
        sin(radians(${latitude})) *
        sin(radians(latitude))
      )) AS distance
    FROM contacts
    WHERE user_id = ${userId}
    HAVING distance < ${radiusKm}
    ORDER BY distance
  `;

  return result.map(mapContact);
}

function mapContact(row: any): Contact {
  return {
    id: row.id,
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phoneNumber: row.phone_number,
    phoneNumberAlt: row.phone_number_alt,
    company: row.company,
    jobTitle: row.job_title,
    address: row.address,
    petName: row.pet_name,
    petType: row.pet_type,
    spouseName: row.spouse_name,
    childrenNames: row.children_names,
    birthday: row.birthday,
    anniversary: row.anniversary,
    notes: row.notes,
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    locationName: row.location_name,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
