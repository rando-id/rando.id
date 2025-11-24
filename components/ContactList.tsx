'use client';

import { Contact } from '@/lib/types';
import { MapPin, Phone, Mail, Building, Calendar } from 'lucide-react';
import Link from 'next/link';

interface ContactListProps {
  contacts: Contact[];
}

export default function ContactList({ contacts }: ContactListProps) {
  if (contacts.length === 0) {
    return (
      <div className="text-center py-12">
        <MapPin className="w-16 h-16 text-slate-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-slate-700 mb-2">No contacts yet</h2>
        <p className="text-slate-500">Start adding contacts with their locations!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {contacts.map((contact) => (
        <Link
          key={contact.id}
          href={`/contacts/${contact.id}`}
          className="block bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-800">
                {contact.firstName || contact.lastName
                  ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
                  : contact.email || contact.phoneNumber || 'Unnamed Contact'}
              </h3>

              {contact.company && (
                <div className="flex items-center gap-2 text-sm text-slate-600 mt-1">
                  <Building className="w-4 h-4" />
                  <span>{contact.company}</span>
                  {contact.jobTitle && <span>• {contact.jobTitle}</span>}
                </div>
              )}

              <div className="flex flex-wrap gap-4 mt-3">
                {contact.email && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Mail className="w-4 h-4" />
                    <span>{contact.email}</span>
                  </div>
                )}
                {contact.phoneNumber && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Phone className="w-4 h-4" />
                    <span>{contact.phoneNumber}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 text-sm text-slate-500 mt-3">
                <MapPin className="w-4 h-4" />
                <span>
                  {contact.locationName ||
                    `${contact.latitude.toFixed(4)}, ${contact.longitude.toFixed(4)}`}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400 mt-2">
                <Calendar className="w-3 h-3" />
                <span>Added {new Date(contact.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
