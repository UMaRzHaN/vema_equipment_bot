const LABELS = {
  back: "🔙 Назад",
  categories: "📦 Оборудование",
  profile: "👤 Профиль",
  addEquipment: "➕ Добавить",
  summary: "📊 Сводка",
  previousPage: "⬅️",
  nextPage: "➡️",
  editCategory: "Категория",
  editBrand: "Бренд",
  editModel: "Модель",
  editSerialNumber: "Серийный номер",
  editInventoryNumber: "Инвентарный номер",
  editPurchaseDate: "Дата покупки",
  editNotes: "Примечания",
  profileFirstName: "Имя",
  profileLastName: "Фамилия",
  profilePhone: "Телефон",
  profileDepartment: "Отдел",
  profilePosition: "Должность",
  profileUserNotes: "Заметки",
  sharePhone: "📱 Поделиться номером",
  editProfileInline: "✏️ Редактировать профиль",
  fillProfileInline: "📝 Заполнить профиль",
};

const EDITABLE_FIELDS = {
  [LABELS.editCategory]: "category",
  [LABELS.editBrand]: "brand",
  [LABELS.editModel]: "model",
  [LABELS.editSerialNumber]: "serial_number",
  [LABELS.editInventoryNumber]: "inventory_number",
  [LABELS.editPurchaseDate]: "purchase_date",
  [LABELS.editNotes]: "notes",
};

const PROFILE_FIELDS = {
  [LABELS.profileFirstName]: "first_name",
  [LABELS.profileLastName]: "last_name",
  [LABELS.profilePhone]: "phone",
};

module.exports = {
  EDITABLE_FIELDS,
  LABELS,
  PROFILE_FIELDS,
};
