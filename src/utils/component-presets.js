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
  detectCategoryKey,
  getGiveComponentsPreset,
  isQuantityComponent,
  requiresGiveComponents,
};
