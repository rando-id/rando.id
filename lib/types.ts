export interface Contact {
  id: string;
  userId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  phoneNumberAlt?: string;
  company?: string;
  jobTitle?: string;
  address?: string;
  petName?: string;
  petType?: string;
  spouseName?: string;
  childrenNames?: string;
  birthday?: string;
  anniversary?: string;
  notes?: string;
  latitude: number;
  longitude: number;
  locationName?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateContactInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  phoneNumberAlt?: string;
  company?: string;
  jobTitle?: string;
  address?: string;
  petName?: string;
  petType?: string;
  spouseName?: string;
  childrenNames?: string;
  birthday?: string;
  anniversary?: string;
  notes?: string;
  latitude: number;
  longitude: number;
  locationName?: string;
}
