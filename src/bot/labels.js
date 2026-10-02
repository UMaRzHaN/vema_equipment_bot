'use strict';

const LABELS = {
  back: '🔙 Назад',
  categories: '📦 Оборудование',
  myEquipment: '🎒 Мое оборудование',
  profile: '👤 Профиль',
  addEquipment: '➕ Добавить',
  summary: '📊 Сводка',
  previousPage: '⬅️',
  nextPage: '➡️',
  editCategory: 'Категория',
  editBrand: 'Бренд',
  editModel: 'Модель',
  editSerialNumber: 'Серийный номер',
  editPurchaseDate: 'Дата покупки',
  editWarehouse: 'Склад',
  editProject: 'Проект',
  editCity: 'Город',
  editNotes: 'Комплектующие',
  manageUsers: '👥 Пользователи',
  categoryKits: '🧰 Комплекты',
  sharePhone: '📱 Поделиться номером',
  editProfileInline: '✏️ Редактировать профиль',
  fillProfileInline: '📝 Заполнить профиль',
  allBrands: 'Все бренды',
};

const EDITABLE_FIELDS = {
  [LABELS.editCategory]: 'category',
  [LABELS.editBrand]: 'brand',
  [LABELS.editModel]: 'model',
  [LABELS.editSerialNumber]: 'serial_number',
  [LABELS.editPurchaseDate]: 'purchase_date',
  [LABELS.editWarehouse]: 'warehouse',
  [LABELS.editProject]: 'project',
  [LABELS.editCity]: 'country',
  [LABELS.editNotes]: 'components',
};

module.exports = { EDITABLE_FIELDS, LABELS };
