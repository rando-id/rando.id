import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

const sampleContacts = [
  {
    userId: 'user_demo123', // Replace with your actual Clerk user ID
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    phoneNumber: '(555) 123-4567',
    company: 'Tech Corp',
    jobTitle: 'Software Engineer',
    latitude: 33.8703,
    longitude: -117.9243,
    locationName: 'Coffee Shop on Harbor Blvd',
    notes: 'Met at the tech conference, very interested in AI',
  },
  {
    userId: 'user_demo123',
    firstName: 'Sarah',
    lastName: 'Johnson',
    email: 'sarah.j@example.com',
    phoneNumber: '(555) 234-5678',
    phoneNumberAlt: '(555) 234-5679',
    company: 'Design Studio',
    jobTitle: 'Creative Director',
    petName: 'Max',
    petType: 'Golden Retriever',
    latitude: 33.8821,
    longitude: -117.8886,
    locationName: 'Downtown Fullerton Restaurant',
    notes: 'Loves hiking and outdoor photography',
  },
  {
    userId: 'user_demo123',
    firstName: 'Michael',
    lastName: 'Chen',
    email: 'mchen@example.com',
    phoneNumber: '(555) 345-6789',
    company: 'StartupXYZ',
    jobTitle: 'Founder & CEO',
    spouseName: 'Emily Chen',
    childrenNames: 'Jake, Lily',
    latitude: 33.8634,
    longitude: -117.9264,
    locationName: 'Cal State Fullerton Campus',
    notes: 'Looking for investment opportunities in ed-tech',
  },
  {
    userId: 'user_demo123',
    firstName: 'Emma',
    lastName: 'Williams',
    email: 'emma.w@example.com',
    phoneNumber: '(555) 456-7890',
    company: 'Marketing Pro',
    jobTitle: 'Marketing Manager',
    petName: 'Whiskers',
    petType: 'Cat',
    birthday: '1990-05-15',
    latitude: 33.8753,
    longitude: -117.9200,
    locationName: 'Fullerton Arboretum',
    notes: 'Expert in social media marketing, helped with campaign ideas',
  },
  {
    userId: 'user_demo123',
    firstName: 'David',
    lastName: 'Martinez',
    phoneNumber: '(555) 567-8901',
    company: 'Real Estate Group',
    jobTitle: 'Real Estate Agent',
    spouseName: 'Lisa Martinez',
    anniversary: '2015-06-20',
    latitude: 33.8580,
    longitude: -117.9120,
    locationName: 'Fullerton Community Center',
    notes: 'Knows the local market very well, helped find office space',
  },
  {
    userId: 'user_demo123',
    firstName: 'Lisa',
    petName: 'Buddy',
    petType: 'Labrador',
    latitude: 33.8690,
    longitude: -117.9280,
    locationName: 'Dog Park on Chapman Ave',
    notes: 'Met at dog park, friendly neighbor',
  },
];

async function seed() {
  console.log('🌱 Starting database seed...');

  try {
    // Create table
    console.log('Creating contacts table...');
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

    // Create indexes
    console.log('Creating indexes...');
    await sql`
      CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_contacts_location ON contacts(latitude, longitude);
    `;

    // Insert sample contacts
    console.log('Inserting sample contacts...');
    for (const contact of sampleContacts) {
      await sql`
        INSERT INTO contacts (
          user_id, first_name, last_name, email, phone_number, phone_number_alt,
          company, job_title, pet_name, pet_type, spouse_name, children_names,
          birthday, anniversary, notes, latitude, longitude, location_name
        )
        VALUES (
          ${contact.userId},
          ${contact.firstName || null},
          ${contact.lastName || null},
          ${contact.email || null},
          ${contact.phoneNumber || null},
          ${contact.phoneNumberAlt || null},
          ${contact.company || null},
          ${contact.jobTitle || null},
          ${contact.petName || null},
          ${contact.petType || null},
          ${contact.spouseName || null},
          ${contact.childrenNames || null},
          ${contact.birthday || null},
          ${contact.anniversary || null},
          ${contact.notes || null},
          ${contact.latitude},
          ${contact.longitude},
          ${contact.locationName || null}
        )
      `;
    }

    console.log('✅ Database seeded successfully!');
    console.log(`📝 Inserted ${sampleContacts.length} sample contacts`);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
