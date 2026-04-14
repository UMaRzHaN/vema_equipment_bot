const { Markup } = require("telegraf");
const { isAdmin } = require("../config");
const { LABELS } = require("../labels");

function mainMenu(ctx) {
  const firstRow = [LABELS.categories];

  if (isAdmin(ctx)) {
    firstRow.push(LABELS.addEquipment);
  }

  return Markup.keyboard([firstRow, [LABELS.summary, LABELS.profile]]).resize();
}

function buildEditEquipmentKeyboard() {
  return Markup.keyboard([
    [LABELS.editCategory, LABELS.editBrand, LABELS.editModel],
    [LABELS.editSerialNumber, LABELS.editInventoryNumber, LABELS.editPurchaseDate],
    [LABELS.editNotes, LABELS.back],
  ]).resize();
}

function buildProfileKeyboard() {
  return Markup.keyboard([
    [LABELS.profileFirstName, LABELS.profileLastName],
    [LABELS.profilePhone, LABELS.profileDepartment],
    [LABELS.profilePosition, LABELS.profileUserNotes],
    [LABELS.back],
  ]).resize();
}

function buildBackKeyboard() {
  return Markup.keyboard([[LABELS.back]]).resize();
}

function buildPhoneRequestKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest(LABELS.sharePhone)],
    [LABELS.back],
  ]).resize();
}

function buildProfileInlineKeyboard(isComplete = true) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        isComplete ? LABELS.editProfileInline : LABELS.fillProfileInline,
        "edit_profile",
      ),
    ],
  ]);
}

function buildCategoryListKeyboard(categories, page, totalPages) {
  const keyboard = categories.map((categoryName) => [categoryName]);
  const navigation = [];

  if (page > 0) {
    navigation.push(LABELS.previousPage);
  }

  if (page < totalPages - 1) {
    navigation.push(LABELS.nextPage);
  }

  if (navigation.length) {
    keyboard.push(navigation);
  }

  keyboard.push([LABELS.back]);

  return Markup.keyboard(keyboard).resize();
}

const ITEMS_PER_PAGE = 8;

function buildCategoryItemsKeyboard(items, page = 0) {
  const totalPages = Math.max(Math.ceil(items.length / ITEMS_PER_PAGE), 1);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const start = safePage * ITEMS_PER_PAGE;
  const pageItems = items.slice(start, start + ITEMS_PER_PAGE);

  const rows = pageItems.map((item) => [
    Markup.button.callback(
      `${item.inventory_number || item.id}. ${item.model || "-"} - ${item.serial_number || "-"}`,
      `open_${item.id}`,
    ),
  ]);

  // Навигация
  if (totalPages > 1) {
    const nav = [];
    if (safePage > 0) {
      nav.push(Markup.button.callback("⬅️", `itemsPage_${encodeURIComponent(items[0]?.category || "")}_${safePage - 1}`));
    }
    nav.push(Markup.button.callback(`${safePage + 1}/${totalPages}`, "noop"));
    if (safePage < totalPages - 1) {
      nav.push(Markup.button.callback("➡️", `itemsPage_${encodeURIComponent(items[0]?.category || "")}_${safePage + 1}`));
    }
    rows.push(nav);
  }

  return Markup.inlineKeyboard(rows);
}

function buildCategoryExportKeyboard(categoryName) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(
        "📄 Экспорт в Excel",
        `excelCategory_${encodeURIComponent(categoryName)}`,
      ),
    ],
  ]);
}

module.exports = {
  buildBackKeyboard,
  buildCategoryExportKeyboard,
  buildCategoryItemsKeyboard,
  buildCategoryListKeyboard,
  buildEditEquipmentKeyboard,
  buildPhoneRequestKeyboard,
  buildProfileInlineKeyboard,
  buildProfileKeyboard,
  ITEMS_PER_PAGE,
  mainMenu,
};
