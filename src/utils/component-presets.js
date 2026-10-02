"use strict";

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function qty(name, count) {
  return { name, qty: count };
}

function normalizePresetEntry(entry) {
  if (typeof entry === "string") {
    const name = entry.trim();
    return name ? { name, qty: 1 } : null;
  }

  if (!entry || typeof entry !== "object") return null;

  const name = String(entry.name || "").trim();
  const count = Number(entry.qty);
  if (!name) return null;

  return {
    name,
    qty: Number.isInteger(count) && count > 0 ? count : 1,
  };
}

function normalizePresetEntries(entries = []) {
  const merged = new Map();

  for (const rawEntry of entries) {
    const entry = normalizePresetEntry(rawEntry);
    if (!entry) continue;
    merged.set(entry.name, entry.qty);
  }

  return Array.from(merged.entries()).map(([name, count]) => ({
    name,
    qty: count,
  }));
}

function extractNames(entries = []) {
  return normalizePresetEntries(entries).map((entry) => entry.name);
}

function getQtyMap(entries = []) {
  return Object.fromEntries(
    normalizePresetEntries(entries).map((entry) => [entry.name, entry.qty]),
  );
}

function preset({ single = [], quantity = [], minimal = [], full = [] }) {
  return {
    single: normalizePresetEntries(single),
    quantity: normalizePresetEntries(quantity),
    minimal: normalizePresetEntries(minimal),
    full: normalizePresetEntries(full),
  };
}

const BATTERIES_X2 = qty("Батарейка", 2);

const CAMERA_PRESET = preset({
  single: [
    "Штатив",
    "Анемометр",
    "Дальнометр",
    "Кабель HDMI",
    "Кабель HDMI-мини",
  ],
  quantity: [BATTERIES_X2],
  minimal: [BATTERIES_X2],
  full: [
    BATTERIES_X2,
    "Штатив",
    "Анемометр",
    "Дальнометр",
  ],
});

const LAPTOP_PRESET = preset({
  single: [
    "Зарядка",
    "Мышка",
    "Переходник",
    "Кабель HDMI",
    "Кабель HDMI-мини",
  ],
  minimal: [
    "Зарядка",
    "Мышка",
    "Переходник",
  ],
});

const GENERIC_PRESET = preset({
  single: [
    "Зарядка",
    "Переходник",
  ],
  quantity: [BATTERIES_X2],
  minimal: [
    "Зарядка",
    "Мышка",
    "Переходник",
  ],
});

const SAMPLER_PRESET = preset({
  single: [
    "Воронка",
    "Большой мешок",
    "Маленький мешок",
    "Конус",
  ],
  quantity: [qty("Розовый мешок", 1)],
  minimal: [
    "Воронка",
    "Маленький мешок",
    qty("Розовый мешок", 1),
  ],
  full: [
    "Воронка",
    "Большой мешок",
    "Маленький мешок",
    qty("Розовый мешок", 1),
    "Конус",
  ],
});

const CATEGORY_PRESETS = {
  camera: CAMERA_PRESET,
  laptop: LAPTOP_PRESET,
  sampler: SAMPLER_PRESET,
  generic: GENERIC_PRESET,
};

const MODEL_PRESETS = {
  sampler: SAMPLER_PRESET,
};

function detectCategoryKey(item) {
  const category = normalizeKey(item.category || "");
  const model = normalizeKey(item.model || "");

  if (
    category.includes("sampler")
    || category.includes("пробоотбор")
    || model.includes("sampler")
  ) {
    return "sampler";
  }
  if (category.includes("камер") || category.includes("camera")) {
    return "camera";
  }
  if (category.includes("ноут") || category.includes("laptop")) {
    return "laptop";
  }
  return "generic";
}

function mergePreset(basePreset, overridePreset = {}) {
  const singleEntries = normalizePresetEntries(
    overridePreset.single ?? basePreset.singleEntries ?? basePreset.single,
  );
  const quantityEntries = normalizePresetEntries(
    overridePreset.quantity ?? basePreset.quantityEntries ?? basePreset.quantity,
  );
  const minimalEntries = normalizePresetEntries(
    overridePreset.minimal ?? basePreset.minimalEntries ?? basePreset.minimal,
  );
  const fullEntries = normalizePresetEntries(
    overridePreset.full ?? basePreset.fullEntries ?? basePreset.full,
  );

  return {
    singleEntries,
    quantityEntries,
    minimalEntries,
    fullEntries,
  };
}

function getModelPreset(modelKey) {
  return (
    MODEL_PRESETS[modelKey]
    || Object.entries(MODEL_PRESETS).find(([key]) => modelKey.includes(key))?.[1]
    || null
  );
}

function getGiveComponentsPreset(item) {
  const categoryKey = detectCategoryKey(item);
  const modelKey = normalizeKey(`${item.category || ""} ${item.brand || ""} ${item.model || ""}`);

  const basePreset = CATEGORY_PRESETS[categoryKey] || CATEGORY_PRESETS.generic;
  const modelPreset = getModelPreset(modelKey);

  const resolved = mergePreset(basePreset, modelPreset || {});

  return {
    single: extractNames(resolved.singleEntries),
    quantity: extractNames(resolved.quantityEntries),
    minimal: resolved.minimalEntries,
    full: resolved.fullEntries,
    defaultQtyByName: {
      ...getQtyMap(resolved.singleEntries),
      ...getQtyMap(resolved.quantityEntries),
      ...getQtyMap(resolved.fullEntries),
    },
  };
}

const CATEGORIES_WITHOUT_COMPONENTS = ["газоанализ"];

function requiresGiveComponents(item) {
  const category = normalizeKey(item?.category);
  return !CATEGORIES_WITHOUT_COMPONENTS.some((key) => category.includes(key));
}

const KIT_MAX_ITEMS = 30;
const KIT_MAX_NAME_LENGTH = 60;
const KIT_EMPTY_INPUTS = new Set(["-", "нет", "пусто"]);

// Parses admin input like "Штатив, Батарейка x2". Items with xN get +/- buttons when giving out.
function parseKitInput(text) {
  const raw = String(text || "").trim();
  if (!raw || KIT_EMPTY_INPUTS.has(raw.toLowerCase())) return { items: [] };

  const merged = new Map();
  for (const part of raw.split(/[,;\n]/)) {
    const value = part.trim();
    if (!value) continue;

    const match = /^(.+?)\s*[xхXХ×*]\s*(\d+)$/.exec(value);
    const name = (match ? match[1] : value).trim();
    const count = match ? Number(match[2]) : 1;

    if (!name) continue;
    if (name.length > KIT_MAX_NAME_LENGTH) {
      return { error: `Слишком длинное название: «${name.slice(0, 20)}…». Максимум ${KIT_MAX_NAME_LENGTH} символов.` };
    }
    if (count < 1 || count > 99) {
      return { error: `Количество для «${name}» должно быть от 1 до 99.` };
    }
    merged.set(name, { name, qty: count, counted: Boolean(match) });
  }

  if (merged.size > KIT_MAX_ITEMS) {
    return { error: `Слишком много позиций. Максимум ${KIT_MAX_ITEMS}.` };
  }

  return { items: [...merged.values()] };
}

function formatKitItems(items = []) {
  if (!items.length) return "—";
  return items.map((item) => (item.counted ? `${item.name} x${item.qty}` : item.name)).join(", ");
}

// Converts a category_kits row into the preset shape used by the give-out keyboard.
// kit_items is everything offered; full/minimal are the quick-select presets.
function buildPresetFromKit(kit) {
  const full = Array.isArray(kit?.full_items) ? kit.full_items : [];
  const minimal = Array.isArray(kit?.minimal_items) ? kit.minimal_items : [];
  const items = Array.isArray(kit?.kit_items) ? kit.kit_items : full;

  return {
    single: items.filter((item) => !item.counted).map((item) => item.name),
    quantity: items.filter((item) => item.counted).map((item) => item.name),
    minimal: normalizePresetEntries(minimal),
    full: normalizePresetEntries(full),
    defaultQtyByName: { ...getQtyMap(items), ...getQtyMap(full) },
  };
}

// Converts a code preset into kit items, so admins start editing from the current defaults.
function presetToKitItems(presetValue, entries) {
  const quantityNames = new Set(presetValue?.quantity || []);
  return normalizePresetEntries(entries).map((entry) => ({
    name: entry.name,
    qty: entry.qty,
    counted: quantityNames.has(entry.name),
  }));
}

function buildPresetComponents(entries = []) {
  return normalizePresetEntries(entries);
}

function isQuantityComponent(name, presetValue) {
  return (
    Array.isArray(presetValue?.quantity) && presetValue.quantity.includes(name)
  );
}

module.exports = {
  buildPresetComponents,
  buildPresetFromKit,
  detectCategoryKey,
  formatKitItems,
  getGiveComponentsPreset,
  isQuantityComponent,
  parseKitInput,
  presetToKitItems,
  requiresGiveComponents,
};
