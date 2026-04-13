const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(",")
      .map((id) => Number(id.trim()))
      .filter(Boolean)
  : [];

function assertBotConfig() {
  if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is missing");
  }
}

function isAdmin(ctx) {
  return Boolean(ctx.from?.id && ADMIN_IDS.includes(ctx.from.id));
}

module.exports = {
  assertBotConfig,
  isAdmin,
};
