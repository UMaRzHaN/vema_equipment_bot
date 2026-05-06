'use strict';

const LABELS = {
  back:              '🔙 Назад',
  categories:        '📦 Оборудование',
  profile:           '👤 Профиль',
  addEquipment:      '➕ Добавить',
  summary:           '📊 Сводка',
  previousPage:      '⬅️',
  nextPage:          '➡️',
  editCategory:      'Категория',
  editBrand:         'Бренд',
  editModel:         'Модель',
  editSerialNumber:  'Серийный номер',
  editPurchaseDate:  'Дата покупки',
  editNotes:         'Примечания',
  editWarehouse:     'Склад',
  manageUsers:       '👥 Пользователи',
  sharePhone:        '📱 Поделиться номером',
  editProfileInline: '✏️ Редактировать профиль',
  fillProfileInline: '📝 Заполнить профиль',
};

const EDITABLE_FIELDS = {
  [LABELS.editCategory]:        'category',
  [LABELS.editBrand]:           'brand',
  [LABELS.editModel]:           'model',
  [LABELS.editSerialNumber]:    'serial_number',
  [LABELS.editPurchaseDate]:    'purchase_date',
  [LABELS.editNotes]:           'notes',
  [LABELS.editWarehouse]:       'warehouse',
};

module.exports = { EDITABLE_FIELDS, LABELS };
