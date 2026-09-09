'use strict';

const FLOW_TYPE = Object.freeze({
  IDLE: null,
  ADD_EQUIPMENT: 'add_equipment',
  EDIT_EQUIPMENT: 'edit_equipment',
  GIVE_PROJECT: 'give_project',
  GIVE_COUNTRY: 'give_country',
  GIVE_DURATION: 'give_duration',
  GIVE_COMPONENTS: 'give_components',
  REPAIR: 'repair',
  REGISTER_PROFILE: 'register_profile',
  EDIT_PROFILE: 'edit_profile',
  ASSIGN_ROLE: 'assign_role',
  RETURN_LOCATION: 'return_location',
});

const ADD_STEP = Object.freeze({
  CATEGORY: 1,
  BRAND: 2,
  MODEL: 3,
  SERIAL: 4,
  PURCHASE_DATE: 5,
});

const TOTAL_ADD_STEPS = Object.keys(ADD_STEP).length;

const EDIT_STEP = Object.freeze({
  SELECT_FIELD: 1,
  ENTER_VALUE: 2,
});

module.exports = { FLOW_TYPE, ADD_STEP, EDIT_STEP, TOTAL_ADD_STEPS };
