'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

class WorksheetStub {
  constructor() {
    this.rows = [];
    this.columns = [];
  }

  addRow(row) {
    const rowObj = {
      ...row,
      number: this.rows.length + 1,
      font: null,
      fill: null,
    };
    this.rows.push(rowObj);
    return rowObj;
  }

  mergeCells() {}
}

class WorkbookStub {
  constructor() {
    this.worksheets = [];
    this.xlsx = {
      writeBuffer: async () => Buffer.from('xlsx'),
    };
  }

  addWorksheet() {
    const sheet = new WorksheetStub();
    this.worksheets.push(sheet);
    return sheet;
  }
}

describe('buildCategoryXlsx', () => {
  it('keeps warehouse empty when equipment is with user', async () => {
    let workbookRef = null;

    const reportService = proxyquire('../src/services/report.service', {
      exceljs: {
        Workbook: class extends WorkbookStub {
          constructor() {
            super();
            workbookRef = this;
          }
        },
      },
      './equipment.service': {
        getEquipmentStats: async () => ({}),
        listAllEquipment: async () => [],
      },
      './history.service': {
        getEquipmentTimelinesBatch: async () => new Map(),
      },
      './user.service': {
        getUsersByTelegramIds: async () => new Map([['42', { first_name: 'Ivan', last_name: 'Petrov' }]]),
        formatUser: (user) => [user?.first_name, user?.last_name].filter(Boolean).join(' '),
      },
      '../utils/formatters': {
        formatDate: () => '',
        formatDateOnly: () => '',
        statusLabel: (status) => status,
      },
      '../utils/components': {
        formatComponent: (component) => component.name || String(component),
        normalizeComponents: (components) => components || [],
      },
      pureimage: {},
    });

    await reportService.buildCategoryXlsx('Камеры', [
      {
        id: 1,
        category: 'Камеры',
        brand: 'FLIR',
        model: 'C5',
        serial_number: 'SN-1',
        components: [],
        warehouse: 'Ташкент',
        status: 'у пользователя',
        current_holder_user_id: 42,
        current_issue_date: null,
        purchase_date: null,
      },
    ]);

    const dataRow = workbookRef.worksheets[0].rows[1];
    assert.equal(dataRow.warehouse, '');
  });
});
