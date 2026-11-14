// מחלקות הסופר — הסדר כאן הוא סדר ההצגה ברשימה ובמצב קניות (מסלול הליכה טיפוסי בסופר).
// הקובץ משותף לאפליקציה ולתהליך הייבוא (importer/lib/categorize.mjs).

export const DEPARTMENTS = [
  { id: 'produce',    name: 'פירות וירקות',            icon: '🥬', color: '#7FB77E' },
  { id: 'bakery',     name: 'לחם ומאפים',              icon: '🍞', color: '#D9A46B' },
  { id: 'dairy',      name: 'מוצרי חלב וביצים',        icon: '🥛', color: '#8EB8E5' },
  { id: 'deli',       name: 'נקניקים ומעדניה',         icon: '🧀', color: '#E8B86B' },
  { id: 'meat',       name: 'בשר ועוף',                icon: '🍗', color: '#D97A6C' },
  { id: 'fish',       name: 'דגים',                    icon: '🐟', color: '#6FA8B8' },
  { id: 'frozen',     name: 'קפואים',                  icon: '❄️', color: '#9FC6D9' },
  { id: 'dry',        name: 'פסטה, אורז וקטניות',      icon: '🍝', color: '#D8B26E' },
  { id: 'canned',     name: 'שימורים ורטבים',          icon: '🥫', color: '#C9845E' },
  { id: 'baking',     name: 'אפייה, תבלינים ושמנים',   icon: '🧂', color: '#BFA27A' },
  { id: 'breakfast',  name: 'דגני בוקר, ממרחים וקפה',  icon: '☕', color: '#A88466' },
  { id: 'snacks',     name: 'חטיפים ומתוקים',          icon: '🍫', color: '#C77D9B' },
  { id: 'drinks',     name: 'משקאות',                  icon: '🧃', color: '#E39B5C' },
  { id: 'baby',       name: 'תינוקות',                 icon: '🍼', color: '#E7A9B9' },
  { id: 'hygiene',    name: 'טיפוח והיגיינה',          icon: '🧴', color: '#9C9BD4' },
  { id: 'cleaning',   name: 'ניקיון וכביסה',           icon: '🧽', color: '#7DB3A8' },
  { id: 'paper',      name: 'נייר וחד־פעמי',           icon: '🧻', color: '#B5B0A6' },
  { id: 'pets',       name: 'בעלי חיים',               icon: '🐾', color: '#B79A7A' },
  { id: 'other',      name: 'אחר',                     icon: '🛒', color: '#A7A29A' },
];

export const DEPT_BY_ID = Object.fromEntries(DEPARTMENTS.map((d, i) => [d.id, { ...d, order: i }]));

export function dept(id) {
  return DEPT_BY_ID[id] || DEPT_BY_ID.other;
}
