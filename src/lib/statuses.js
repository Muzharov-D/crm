/**
 * The small fixed vocabularies the whole app shares: where a person sits
 * with you, and the kinds of touch you can log. Kept apart from the store
 * so the CSV and reporting layers can read them without importing the
 * data layer they feed.
 */
export const CONTACT_STATUSES = [
  { value: 'lead', label: 'Лид' },
  { value: 'active', label: 'В работе' },
  { value: 'customer', label: 'Клиент' },
  { value: 'lost', label: 'Потерян' },
];

/** The kinds of touch that can be logged against a record. */
export const ACTIVITY_TYPES = [
  { value: 'meeting', label: 'Встреча', icon: 'video' },
  { value: 'call', label: 'Звонок', icon: 'phone' },
  { value: 'email', label: 'Письмо', icon: 'mail' },
  { value: 'note', label: 'Заметка', icon: 'note' },
];

/** The type record for an id; an unknown one reads as a note. */
export function activityTypeInfo(type) {
  return ACTIVITY_TYPES.find((t) => t.value === type) || ACTIVITY_TYPES[3];
}
