export function mapCannedResponse(r) {
  return { id: r.id, label: r.label, text: r.message_text };
}

export function mapResolveCategory(c) {
  return { id: c.id, name: c.name, icon: c.icon || '📋', desc: c.description || '', color: c.color || 'rgba(108,92,231,0.1)' };
}
