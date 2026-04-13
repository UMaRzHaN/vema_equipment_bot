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

function buildCategoryItemsKeyboard(items) {
  return Markup.inlineKeyboard(
    items.map((item) => [
      Markup.button.callback(
        `${item.inventory_number || item.id}. ${item.model || "-"} - ${item.serial_number || "-"}`,
        `open_${item.id}`,
      ),
    ]),
  );
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
  mainMenu,
};
