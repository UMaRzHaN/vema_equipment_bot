const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

function createTempDbPath() {
  const tempDir = path.join(
    os.tmpdir(),
    "telegram-bot-vema-equipment",
    crypto.randomUUID(),
  );

  fs.mkdirSync(tempDir, { recursive: true });
  return path.join(tempDir, "inventory.db");
}

function copyDatabase(sourcePath, targetPath) {
  fs.copyFileSync(sourcePath, targetPath);
}

function createBotRegistry() {
  return {
    actions: [],
    onHandlers: [],
    hearsHandlers: [],
    startHandler: null,
    action(pattern, handler) {
      this.actions.push({ pattern, handler });
    },
    on(event, handler) {
      this.onHandlers.push({ event, handler });
    },
    hears(trigger, handler) {
      this.hearsHandlers.push({ trigger, handler });
    },
    start(handler) {
      this.startHandler = handler;
    },
    use() {},
    catch() {},
  };
}

function findActionHandler(registry, patternText) {
  return registry.actions.find(
    (entry) => String(entry.pattern) === patternText,
  )?.handler;
}

function findOnHandler(registry, eventName) {
  return registry.onHandlers.find((entry) => entry.event === eventName)?.handler;
}

function findHearsHandler(registry, trigger) {
  return registry.hearsHandlers.find((entry) => {
    if (entry.trigger instanceof RegExp && trigger instanceof RegExp) {
      return String(entry.trigger) === String(trigger);
    }

    return entry.trigger === trigger;
  })?.handler;
}

function createCtx(session = {}, overrides = {}) {
  const replies = [];
  const deleted = [];
  const documents = [];
  const photos = [];
  const answered = [];
  const edited = [];

  const messageIdBase = overrides.messageIdBase ?? 1000;
  let nextMessageId = messageIdBase;

  const ctx = {
    from: { id: 999001 },
    session: session || {},

    message: overrides.message || {
      text: "",
    },

    callbackQuery: {
      message: {
        chat: { id: 42 },
        message_id: 77,
      },
    },

    telegram: {
      deleteMessage: async (chatId, messageId) => {
        deleted.push({ chatId, messageId });
      },
      editMessageText: async (chatId, messageId, inlineMessageId, text, extra) => {
        edited.push({ chatId, messageId, inlineMessageId, text, extra });
      },
    },

    answerCbQuery: async (text, extra) => {
      answered.push({ text, extra });
    },

    editMessageText: async (text, extra) => {
      edited.push({ text, extra });
    },

    deleteMessage: async (messageId) => {
      deleted.push({ chatId: 42, messageId });
    },

    reply: async (text, extra) => {
      const message = {
        chat: { id: 42 },
        message_id: ++nextMessageId,
        text,
        extra: extra || {},
      };

      replies.push(message);
      return message;
    },

    replyWithDocument: async (payload, extra) => {
      const message = {
        chat: { id: 42 },
        message_id: ++nextMessageId,
        payload,
        extra: extra || {},
      };

      documents.push(message);
      return message;
    },

    replyWithPhoto: async (payload, extra) => {
      const message = {
        chat: { id: 42 },
        message_id: ++nextMessageId,
        payload,
        extra: extra || {},
      };

      photos.push(message);
      return message;
    },

    // 🔥 удобные хелперы для тестов
    replies,
    deleted,
    documents,
    photos,
    answered,
    edited,

    lastReply() {
      return replies.at(-1);
    },

    lastKeyboard() {
      return replies.at(-1)?.extra?.reply_markup?.keyboard || null;
    },

    // эмуляция next()
    async next() {},

    ...overrides,
  };

  return ctx;
}

module.exports = {
  copyDatabase,
  createBotRegistry,
  createCtx,
  createTempDbPath,
  findActionHandler,
  findHearsHandler,
  findOnHandler,
};