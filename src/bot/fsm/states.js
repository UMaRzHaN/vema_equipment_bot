'use strict';

const FLOW_TYPE = Object.freeze({
  IDLE:             null,
  ADD_EQUIPMENT:    'add_equipment',
  EDIT_EQUIPMENT:   'edit_equipment',
  GIVE_EQUIPMENT:   'give_equipment',
  EXTEND_EQUIPMENT: 'extend_equipment',
  REPAIR:           'repair',
  WRITEOFF:         'writeoff',
  REGISTER_PROFILE: 'register_profile',
  EDIT_PROFILE:     'edit_profile',
  ASSIGN_ROLE:      'assign_role',
  RETURN_LOCATION:  'return_location',
});

const ADD_STEP = Object.freeze({
  CATEGORY:      1,
  BRAND:         2,
  MODEL:         3,
  SERIAL:        4,
  PURCHASE_DATE: 5,
  NOTES:         6,
});

const TOTAL_ADD_STEPS = Object.keys(ADD_STEP).length; // 7

const EDIT_STEP = Object.freeze({
  SELECT_FIELD: 1,
  ENTER_VALUE:  2,
});

const GIVE_STEP = Object.freeze({
  ENTER_DAYS: 1,
});

module.exports = { FLOW_TYPE, ADD_STEP, EDIT_STEP, GIVE_STEP, TOTAL_ADD_STEPS };
