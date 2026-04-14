const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(",")
      .map((id) => Number(id.trim()))
      .filter(Boolean)
  : [];

function assertBotConfig() {
  if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is missing");
  }
  if (ADMIN_IDS.length === 0) {
    // Не падаем, но предупреждаем — без админов нельзя добавлять/удалять оборудование
    process.stderr.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        msg: "ADMIN_IDS not configured — admin functions (add/edit/delete) will be unavailable",
      }) + "\n",
    );
  }
}

function isAdmin(ctx) {
  return Boolean(ctx.from?.id && ADMIN_IDS.includes(ctx.from.id));
}

module.exports = {
  assertBotConfig,
  isAdmin,
};
