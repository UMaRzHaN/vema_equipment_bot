'use strict';

const {
  buildPresetFromKit,
  getGiveComponentsPreset,
  presetToKitItems,
  requiresGiveComponents,
} = require('../utils/component-presets');
const {
  deleteCategoryKit,
  findCategoryKit,
  upsertCategoryKit,
} = require('../repositories/category-kit.repo');

// All names the give-out keyboard would offer for a category that has no admin settings yet.
function defaultKitItems(category) {
  const preset = getGiveComponentsPreset({ category });
  const names = [...new Set([...preset.single, ...preset.quantity])];
  const entries = names.map((name) => ({ name, qty: preset.defaultQtyByName[name] || 1 }));
  return {
    kitItems: presetToKitItems(preset, entries),
    fullItems: presetToKitItems(preset, preset.full),
    minimalItems: presetToKitItems(preset, preset.minimal),
  };
}

function toKitView(category, row) {
  if (row) {
    const fullItems = Array.isArray(row.full_items) ? row.full_items : [];
    return {
      category,
      configured: true,
      hasKit: row.has_kit,
      kitItems: Array.isArray(row.kit_items) ? row.kit_items : fullItems,
      fullItems,
      minimalItems: Array.isArray(row.minimal_items) ? row.minimal_items : [],
    };
  }

  const { kitItems, fullItems, minimalItems } = defaultKitItems(category);
  return {
    category,
    configured: false,
    hasKit: requiresGiveComponents({ category }),
    kitItems,
    fullItems,
    minimalItems,
  };
}

async function getCategoryKit(category) {
  return toKitView(category, await findCategoryKit(category));
}

async function saveCategoryKit(category, changes, updatedBy) {
  const current = await getCategoryKit(category);
  const next = {
    hasKit: changes.hasKit ?? current.hasKit,
    kitItems: changes.kitItems ?? current.kitItems,
    fullItems: changes.fullItems ?? current.fullItems,
    minimalItems: changes.minimalItems ?? current.minimalItems,
    updatedBy,
  };

  // Presets typed with new names extend the composition instead of being dropped.
  if (!changes.kitItems) {
    const known = new Set(next.kitItems.map((item) => item.name));
    const added = [...(changes.fullItems || []), ...(changes.minimalItems || [])]
      .filter((item) => !known.has(item.name) && known.add(item.name));
    next.kitItems = [...next.kitItems, ...added];
  }

  // Full and minimal can only contain items that are part of the kit.
  const kitNames = new Set(next.kitItems.map((item) => item.name));
  next.fullItems = next.fullItems.filter((item) => kitNames.has(item.name));
  next.minimalItems = next.minimalItems.filter((item) => kitNames.has(item.name));

  return toKitView(category, await upsertCategoryKit(category, next));
}

async function resetCategoryKit(category) {
  await deleteCategoryKit(category);
  return getCategoryKit(category);
}

// Resolves what the give-out flow should offer for one equipment item.
async function getItemKit(item) {
  const row = await findCategoryKit(item.category || '');
  if (!row) {
    return {
      enabled: requiresGiveComponents(item),
      preset: getGiveComponentsPreset(item),
    };
  }

  const kit = toKitView(item.category || '', row);
  return {
    enabled: kit.hasKit && kit.kitItems.length > 0,
    preset: buildPresetFromKit(row),
  };
}

module.exports = { getCategoryKit, getItemKit, resetCategoryKit, saveCategoryKit };
