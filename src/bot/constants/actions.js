'use strict';

/**
 * Константы callback_data для оборудования.
 * Используйте их вместо хардкодинга строк в коде.
 */
const ACTIONS = {
  // Просмотр и навигация
  OPEN:          'open',
  HISTORY:       'history',
  BACK_TO_CARD:  'open', // alias для возврата к карточке

  // Операции с оборудованием
  GIVE:           'give',
  RETURN:         'return',
  REPAIR:         'repair',
  FROM_REPAIR:    'fromRepair',
  WRITEOFF:       'writeoff',
  EDIT:           'edit',
  DELETE:         'delete',
  CONFIRM_DELETE: 'confirmDelete',

  // Редактирование полей
  EDIT_CATEGORY:         'edit_category',
  EDIT_MODEL:            'edit_model',
  EDIT_SERIAL:           'edit_serial',
  EDIT_INVENTORY:        'edit_inventory',
  EDIT_NOTES:            'edit_notes',
  EDIT_LOCATION:          'edit_location',
  CANCEL_EDIT:           'cancel_edit',
};

const ACTIONS_REGEX = {
  OPEN:          /^open_(\d+)$/,
  HISTORY:       /^history_(\d+)$/,
  GIVE:          /^give_(\d+)$/,
  RETURN:        /^return_(\d+)$/,
  REPAIR:        /^repair_(\d+)$/,
  FROM_REPAIR:   /^fromRepair_(\d+)$/,
  WRITEOFF:      /^writeoff_(\d+)$/,
  EDIT:          /^edit_(\d+)$/,
  DELETE:        /^delete_(\d+)$/,
  CONFIRM_DELETE:/^confirmDelete_(\d+)$/,
};

module.exports = { ACTIONS, ACTIONS_REGEX };
