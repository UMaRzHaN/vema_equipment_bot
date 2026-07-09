'use strict';

function normalizeComponentItem(item) {
  if (typeof item === 'string') {
    const name = item.trim();
    return name ? { name, qty: 1 } : null;
  }

  if (!item || typeof item !== 'object') return null;

  const name = String(item.name || '').trim();
  const qty = Number(item.qty);
  if (!name) return null;

  return {
    name,
    qty: Number.isInteger(qty) && qty > 0 ? qty : 1,
  };
}

function normalizeComponents(value) {
  if (!Array.isArray(value)) return [];

  const merged = new Map();
  for (const rawItem of value) {
    const item = normalizeComponentItem(rawItem);
    if (!item) continue;
    merged.set(item.name, (merged.get(item.name) || 0) + item.qty);
  }

  return Array.from(merged.entries())
    .slice(0, 20)
    .map(([name, qty]) => ({ name, qty }));
}

function formatComponent(item) {
  const normalized = normalizeComponentItem(item);
  if (!normalized) return '';
  return normalized.qty > 1
    ? `${normalized.name} x${normalized.qty}`
    : normalized.name;
}

module.exports = {
  formatComponent,
  normalizeComponentItem,
  normalizeComponents,
};
