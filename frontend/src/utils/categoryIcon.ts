const iconMap: Record<string, string> = {
  'dining': '🍽️',
  'food & dining': '🍽️',
  'food': '🍽️',
  'groceries': '🛒',
  'transportation': '🚗',
  'transport': '🚗',
  'shopping': '🛍️',
  'entertainment': '🎬',
  'fun': '🎬',
  'healthcare': '🏥',
  'health': '🏥',
  'medical': '🏥',
  'housing': '🏠',
  'rent': '🏠',
  'utilities': '💡',
  'utility': '💡',
  'education': '📚',
  'insurance': '🛡️',
  // Loan categories are created by the backend (loans/repositories.py) and
  // picked in the add/edit form. Mapped explicitly rather than left to the
  // '💳' fallback so the picker chip, the lists and the dashboard all agree —
  // the same category used to render 🏦 in the form and 💳 in the list.
  'loan payment': '💳',
  'loan receipt': '💳',
  'travel': '✈️',
  'personal care': '💅',
  'personal': '💅',
  'other expense': '📦',
  'others': '📦',
  'salary': '💼',
  'wage': '💼',
  'freelance': '💻',
  'investment returns': '📈',
  'investment': '📈',
  'business income': '🏢',
  'business': '🏢',
  'rental income': '🏘️',
  'rental': '🏘️',
  'gift': '🎁',
  'refund': '💵',
  'other income': '💰',
};

export function getCategoryIcon(category: string | undefined): string {
  if (!category) return '💳';
  const lower = category.toLowerCase().trim();
  if (iconMap[lower]) return iconMap[lower];
  for (const [key, icon] of Object.entries(iconMap)) {
    if (lower.includes(key) || key.includes(lower)) return icon;
  }
  return '💳';
}
