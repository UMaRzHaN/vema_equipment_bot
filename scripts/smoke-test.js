const assert = require("assert");
const path = require("path");
const {
  copyDatabase,
  createBotRegistry,
  createCtx,
  createTempDbPath,
  findHearsHandler,
  findOnHandler,
} = require("./test-helpers");

const projectRoot = path.resolve(__dirname, "..");
const sourceDbPath = path.join(projectRoot, "data", "inventory.db");

// 🔥 helper для изоляции
function withDb(testFn) {
  return async () => {
    const tempDbPath = createTempDbPath();
    copyDatabase(sourceDbPath, tempDbPath);

    process.env.DB_PATH = tempDbPath;
    process.env.BOT_TOKEN = "123:TEST"; // 🔥 ВАЖНО
    process.env.ADMIN_IDS = "999001";

    delete require.cache[require.resolve("../src/db")];
    delete require.cache[require.resolve("../src/services/equipment.service")];
    delete require.cache[require.resolve("../src/services/user.service")];
    delete require.cache[require.resolve("../src/bot")]; // 🔥 ДОБАВЬ

    return testFn();
  };
}

// --- imports внутри тестов (важно для DB)

const testBotLoads = withDb(async () => {
  process.env.BOT_TOKEN = "123:TEST"; // 🔥 важно

  const { bot } = require("../src/bot");

  assert(bot);
  assert(bot.telegram);
});

const testReport = withDb(async () => {
  const { buildSummaryText } = require("../src/services/report.service");
  const summary = buildSummaryText();
  assert(summary.includes("Сводка"));
});

const testAddEquipmentFlow = withDb(async () => {
  const { registerFlowHandlers } = require("../src/bot/handlers/flow.handlers");
  const {
    findEquipmentBySerial,
  } = require("../src/services/equipment.service");

  const registry = createBotRegistry();
  registerFlowHandlers(registry);

  const textHandler = findOnHandler(registry, "text");

  const session = {
    flow: { type: "add_equipment", step: 1, data: {} },
  };

  const serial = `AUTO-${Date.now()}`;

  const steps = [
    "Компрессор",
    "Siemens",
    "X1",
    serial,
    "INV-1",
    "2025-01-01",
    "note",
  ];

  for (const value of steps) {
    await textHandler(
      createCtx(session, { message: { text: value } }),
      async () => {},
    );
  }

  assert.strictEqual(session.flow, null);

  const created = findEquipmentBySerial(serial);
  assert(created);
});

const testSuggestions = withDb(async () => {
  const { registerFlowHandlers } = require("../src/bot/handlers/flow.handlers");

  const registry = createBotRegistry();
  registerFlowHandlers(registry);

  const textHandler = findOnHandler(registry, "text");

  const session = {
    flow: { type: "add_equipment", step: 1, data: {} },
  };

  const ctx = createCtx(session, {
    message: { text: "Компрессор" },
  });

  await textHandler(ctx, async () => {});

  const keyboard = ctx.lastKeyboard();

  if (keyboard) {
    assert(Array.isArray(keyboard));
  }
});

const testHintsFromDatabase = withDb(async () => {
  const { registerFlowHandlers } = require("../src/bot/handlers/flow.handlers");
  const { addEquipment } = require("../src/services/equipment.service");

  const registry = createBotRegistry();
  registerFlowHandlers(registry);

  const textHandler = findOnHandler(registry, "text");

  // добавляем данные
  addEquipment({
    category: "CAT",
    brand: "BRAND_TEST",
    model: "MODEL",
    serial_number: `S-${Date.now()}`,
    status: "in_stock",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const session = {
    flow: { type: "add_equipment", step: 2, data: {} },
  };

  const ctx = createCtx(session, {
    message: { text: "" },
  });

  await textHandler(ctx, async () => {});

  const keyboard = ctx.lastKeyboard();

  assert(keyboard);
  assert(keyboard.flat().length > 0);
});

const testHintsOrder = withDb(async () => {
  const { registerFlowHandlers } = require("../src/bot/handlers/flow.handlers");
  const { addEquipment } = require("../src/services/equipment.service");

  const registry = createBotRegistry();
  registerFlowHandlers(registry);

  const textHandler = findOnHandler(registry, "text");

  const oldBrand = "OLD";
  const newBrand = "NEW";

  addEquipment({
    category: "C",
    brand: oldBrand,
    model: "M",
    serial_number: `OLD-${Date.now()}`,
    status: "in_stock",
    created_at: "2020-01-01",
    updated_at: "2020-01-01",
  });

  addEquipment({
    category: "C",
    brand: newBrand,
    model: "M",
    serial_number: `NEW-${Date.now()}`,
    status: "in_stock",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const session = {
    flow: { type: "add_equipment", step: 2, data: {} },
  };

  const ctx = createCtx(session, {
    message: { text: "" },
  });

  await textHandler(ctx, async () => {});

  const flat = ctx.lastKeyboard().flat();

  assert(flat.indexOf(newBrand) <= flat.indexOf(oldBrand));
});

const testProfileRegistration = withDb(async () => {
  const { registerFlowHandlers } = require("../src/bot/handlers/flow.handlers");
  const {
    saveTelegramUser,
    getUserByTelegramId,
  } = require("../src/services/user.service");

  const registry = createBotRegistry();
  registerFlowHandlers(registry);

  const textHandler = findOnHandler(registry, "text");
  const contactHandler = findOnHandler(registry, "contact");

  saveTelegramUser({ id: 999001 }, new Date().toISOString());

  const session = {
    flow: { type: "register_profile", step: 1, data: {} },
  };

  await textHandler(
    createCtx(session, {
      from: { id: 999001 },
      message: { text: "Иван" },
    }),
    async () => {},
  );

  await textHandler(
    createCtx(session, {
      from: { id: 999001 },
      message: { text: "Иванов" },
    }),
    async () => {},
  );

  await contactHandler(
    createCtx(session, {
      from: { id: 999001 },
      message: {
        contact: { user_id: 999001, phone_number: "+998901234567" },
      },
    }),
    async () => {},
  );

  const user = getUserByTelegramId(999001);

  assert(user);
  assert(user.phone);
  assert.strictEqual(session.flow, null);
});

const testNavigation = withDb(async () => {
  const {
    registerNavigationHandlers,
  } = require("../src/bot/handlers/navigation.handlers");
  const { LABELS } = require("../src/bot/labels");

  const registry = createBotRegistry();
  registerNavigationHandlers(registry);

  const handler = findHearsHandler(registry, LABELS.categories);

  const ctx = createCtx({});
  await handler(ctx);

  assert(ctx.replies.length === 1);
});

// --- RUN

async function run() {
  await testBotLoads();
  await testReport();
  await testAddEquipmentFlow();
  await testSuggestions();
  await testHintsFromDatabase();
  await testHintsOrder();
  await testProfileRegistration();
  await testNavigation();

  console.log("ALL TESTS PASSED");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

