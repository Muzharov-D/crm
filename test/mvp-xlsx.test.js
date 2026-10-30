import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { store } from '../src/lib/store.js';
import { importRegistryXlsx } from '../src/lib/xlsx.js';

let kvData;

function xlsxFile(rows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Реестр');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  return { arrayBuffer: async () => bytes };
}

beforeEach(() => {
  kvData = new Map();
  globalThis.puter = {
    env: 'web',
    kv: {
      get: vi.fn(async (key) => kvData.get(key) ?? null),
      set: vi.fn(async (key, value) => { kvData.set(key, value); return true; }),
    },
    fs: { write: vi.fn(), read: vi.fn(), delete: vi.fn(async () => {}) },
    auth: {
      getUser: vi.fn(async () => ({ username: 'tester', role: 'admin' })),
      isSignedIn: () => true,
    },
  };
});

describe('MVP XLSX registries', () => {
  it('imports and updates companies with their hierarchy', async () => {
    await store.init();
    const result = await importRegistryXlsx('companies', xlsxFile([
      { 'Название': 'Дочерняя', 'ИНН': '1234567890', 'Роль': 'Клиент', 'Головная структура': 'Холдинг' },
      { 'Название': 'Холдинг', 'Роль': 'Клиент' },
    ]));
    expect(result).toMatchObject({ created: 2, updated: 0, skipped: 0 });
    const child = store.companies.find((c) => c.name === 'Дочерняя');
    const parent = store.companies.find((c) => c.name === 'Холдинг');
    expect(child.parentCompanyId).toBe(parent.id);
    const again = await importRegistryXlsx('companies', xlsxFile([{ 'Название': 'Холдинг', 'Отрасль': 'ИТ' }]));
    expect(again.updated).toBe(1);
    expect(store.companies.filter((c) => c.name === 'Холдинг')).toHaveLength(1);
    expect(parent.industry).toBe('ИТ');
  });

  it('imports contacts and links or creates their companies', async () => {
    await store.init();
    const result = await importRegistryXlsx('contacts', xlsxFile([
      { 'ФИО': 'Иванов Иван', 'Должность': 'CIO', 'Телефон': '+7 900 000-00-00', 'Email': 'cio@example.test', 'Контрагент': 'Клиент' },
    ]));
    expect(result.created).toBe(1);
    expect(store.contacts[0]).toMatchObject({ name: 'Иванов Иван', title: 'CIO', companyId: store.companies[0].id });
    await importRegistryXlsx('contacts', xlsxFile([{ 'ФИО': 'Иванов Иван', 'Email': 'cio@example.test', 'Должность': 'Директор', 'Контрагент': 'Клиент' }]));
    expect(store.contacts).toHaveLength(1);
    expect(store.contacts[0].title).toBe('Директор');
  });
});
