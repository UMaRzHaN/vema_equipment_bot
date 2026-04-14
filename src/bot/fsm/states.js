'use strict';

const FLOW_TYPE = Object.freeze({
  IDLE:             null,
  ADD_EQUIPMENT:    'add_equipment',
  EDIT_EQUIPMENT:   'edit_equipment',
  REPAIR:           'repair',
  WRITEOFF:         'writeoff',
  REGISTER_PROFILE: 'register_profile',
  EDIT_PROFILE:     'edit_profile',
});

const ADD_STEP = Object.freeze({
  CATEGORY:      1,
  BRAND:         2,
  MODEL:         3,
  SERIAL:        4,
  INVENTORY:     5,
  PURCHASE_DATE: 6,
  NOTES:         7,
});

const TOTAL_ADD_STEPS = Object.keys(ADD_STEP).length; // 7

const EDIT_STEP = Object.freeze({
  SELECT_FIELD: 1,
  ENTER_VALUE:  2,
});

module.exports = { FLOW_TYPE, ADD_STEP, EDIT_STEP, TOTAL_ADD_STEPS };
