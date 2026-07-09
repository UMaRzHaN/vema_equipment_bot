'use strict';

const STATUS = Object.freeze({
  IN_STOCK:   'на складе',
  WITH_USER:  'у пользователя',
  REPAIR:     'в ремонте',
  WRITTEN_OFF: 'списано',
});

module.exports = { STATUS };
