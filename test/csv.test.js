import { describe, it, expect } from 'vitest';
import {
  parseCSV, toCSV, detectDelimiter, parseMoney, parseDateLoose, parseBool,
  autoMap, mapRows, matchStatus, matchStage, matchBilling, parseTerm, IMPORT_FIELDS,
  importFieldsFor, coerceCustomCell, customCellValues, customCellText, exportRecords,
  guardFormula, unguardFormula,
} from '../src/lib/csv.js';

describe('parseCSV', () => {
  it('reads a plain file with a header', () => {
    expect(parseCSV('name,email\nMei,mei@x.example\nSam,sam@x.example')).toEqual([
      ['name', 'email'],
      ['Mei', 'mei@x.example'],
      ['Sam', 'sam@x.example'],
    ]);
  });

  it('handles quotes, embedded delimiters, newlines, and doubled quotes', () => {
    const rows = parseCSV('name,notes\r\n"Acme, Inc","Said ""yes"" on\nthe call"\r\n');
    expect(rows).toEqual([
      ['name', 'notes'],
      ['Acme, Inc', 'Said "yes" on\nthe call'],
    ]);
  });

  it('drops blank lines but keeps empty cells', () => {
    expect(parseCSV('a,b\n\n1,\n')).toEqual([['a', 'b'], ['1', '']]);
  });

  it('strips a BOM and follows the delimiter the header uses', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(parseCSV('﻿a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCSV('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('reads past leading blank lines to the real header', () => {
    expect(detectDelimiter('\r\na;b\n1;2')).toBe(';');
    expect(detectDelimiter('\n\nx\ty\n1\t2')).toBe('\t');
    expect(parseCSV('\r\na;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('ends a row on a bare CR, as classic-Mac exports do', () => {
    expect(parseCSV('name,email\rMei,mei@x.example\rSam,sam@x.example')).toEqual([
      ['name', 'email'],
      ['Mei', 'mei@x.example'],
      ['Sam', 'sam@x.example'],
    ]);
    // A CR that really is half of a CRLF still ends exactly one row.
    expect(parseCSV('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('ignores delimiters inside a quoted header cell', () => {
    expect(detectDelimiter('"Last, First";Email')).toBe(';');
    expect(detectDelimiter('"Last, First, Middle";Email;Phone')).toBe(';');
    expect(parseCSV('"Last, First";Email\n"Fox, Dana";dana@x.example')).toEqual([
      ['Last, First', 'Email'],
      ['Fox, Dana', 'dana@x.example'],
    ]);
    // A plain comma file is still a comma file.
    expect(detectDelimiter('name,email\nMei,mei@x.example')).toBe(',');
  });

  it('round-trips through toCSV', () => {
    const rows = [['name', 'notes'], ['Acme, Inc', 'He said "hi"\nthen left'], ['Plain', '']];
    expect(parseCSV(toCSV(rows))).toEqual(rows);
  });
});

describe('formula guard', () => {
  it('neutralizes cells a spreadsheet would execute', () => {
    expect(guardFormula('=cmd|\'/c calc\'!A0')).toBe('\'=cmd|\'/c calc\'!A0');
    expect(guardFormula('+1-2')).toBe('\'+1-2');
    expect(guardFormula('@SUM(A1)')).toBe('\'@SUM(A1)');
    expect(guardFormula('-2+3+cmd')).toBe('\'-2+3+cmd');
    expect(guardFormula('\tsneaky')).toBe('\'\tsneaky');
  });

  it('leaves ordinary values, and plain numbers, alone', () => {
    expect(guardFormula('Mei Tanaka')).toBe('Mei Tanaka');
    expect(guardFormula('mei@acme.example')).toBe('mei@acme.example');
    expect(guardFormula(-1500)).toBe('-1500');
    expect(guardFormula('-1500.75')).toBe('-1500.75');
    expect(guardFormula(null)).toBe('');
  });

  it('round-trips: an import strips exactly what an export added', () => {
    for (const value of ['=1+1', 'Mei', "O'Brien", "'quoted'", '-1500', 'a - b']) {
      expect(unguardFormula(guardFormula(value))).toBe(String(value));
    }
  });

  it('mapRows unguards on the way in', () => {
    const rows = [['Name', 'Notes'], ['Mei', "'=HYPERLINK(\"http://evil\")"]];
    expect(mapRows(rows, { name: 0, notes: 1 })).toEqual([
      { name: 'Mei', notes: '=HYPERLINK("http://evil")' },
    ]);
  });
});

describe('value coercion', () => {
  it('reads money the way people type it', () => {
    expect(parseMoney('$12,500')).toBe(12500);
    expect(parseMoney('12 500,50')).toBe(12500.5);
    expect(parseMoney('1.234,50')).toBe(1234.5);
    expect(parseMoney('9999.99')).toBe(9999.99);
    expect(parseMoney('(1,200)')).toBe(-1200);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney('n/a')).toBe(0);
  });

  it('finds the minus sign wherever the accounting package put it', () => {
    expect(parseMoney('$-1,200.00')).toBe(-1200);
    expect(parseMoney('-$1,200.00')).toBe(-1200);
    expect(parseMoney('USD -500')).toBe(-500);
    expect(parseMoney('1.200,00-')).toBe(-1200);
    // A dash that isn't a sign must not flip a positive amount.
    expect(parseMoney('12,500')).toBe(12500);
    expect(parseMoney('n/a')).toBe(0);
  });

  it('reads a repeated separator as thousands grouping', () => {
    // One decimal point per number, so a second dot can only be grouping.
    expect(parseMoney('1.234.567')).toBe(1234567);
    expect(parseMoney('1.234.567,89')).toBe(1234567.89);
    expect(parseMoney('-1.234.567')).toBe(-1234567);
    expect(parseMoney('1,234,567')).toBe(1234567);
    expect(parseMoney('1,234,567.00')).toBe(1234567);
    // A single dot stays ambiguous, and keeps the reading it always had.
    expect(parseMoney('12.500')).toBe(12.5);
  });

  it('reads the date formats spreadsheets emit', () => {
    expect(parseDateLoose('2026-8-4')).toBe('2026-08-04');
    expect(parseDateLoose('2026-08-04T10:00:00Z')).toBe('2026-08-04');
    expect(parseDateLoose('8/4/2026')).toBe('2026-08-04');
    expect(parseDateLoose('24/12/26')).toBe('2026-12-24');   // day-first when > 12
    expect(parseDateLoose('12 Aug 2026')).toBe('2026-08-12');
    expect(parseDateLoose('August 12, 2026')).toBe('2026-08-12');
  });

  it('refuses to guess at nonsense rather than inventing a date', () => {
    expect(parseDateLoose('next tuesday')).toBeNull();
    expect(parseDateLoose('')).toBeNull();
  });

  it('rejects days that do not exist rather than passing them through', () => {
    expect(parseDateLoose('2020-45-13')).toBeNull();
    expect(parseDateLoose('13/45/2020')).toBeNull();
    expect(parseDateLoose('1/32/2020')).toBeNull();
    expect(parseDateLoose('99 Aug 2026')).toBeNull();
    expect(parseDateLoose('2026-02-30')).toBeNull();
    expect(parseDateLoose('31/06/2026')).toBeNull();   // June has 30 days
    expect(parseDateLoose('2026-02-29')).toBeNull();   // 2026 is not a leap year
    expect(parseDateLoose('2024-02-29')).toBe('2024-02-29');
  });

  it('falls back to the other reading when the first one is impossible', () => {
    // Month-first is the default, but 25 is no month.
    expect(parseDateLoose('12/25/2026')).toBe('2026-12-25');
    expect(parseDateLoose('25/12/2026')).toBe('2026-12-25');
  });

  it('reads dotted dates day-first, the convention that writes them', () => {
    expect(parseDateLoose('05.03.2026')).toBe('2026-03-05');   // 5 March, not May 3
    expect(parseDateLoose('24.12.26')).toBe('2026-12-24');
    // A dotted date that only works month-first still parses.
    expect(parseDateLoose('12.25.2026')).toBe('2026-12-25');
    expect(parseDateLoose('13.45.2020')).toBeNull();
  });

  it('rejects half-typed years and mixed separators', () => {
    expect(parseDateLoose('1/2/202')).toBeNull();
    expect(parseDateLoose('1/2.2026')).toBeNull();
  });

  it('reads the many spellings of yes', () => {
    expect(parseBool('Yes')).toBe(true);
    expect(parseBool('TRUE')).toBe(true);
    expect(parseBool('1')).toBe(true);
    expect(parseBool('done')).toBe(true);
    expect(parseBool('no')).toBe(false);
    expect(parseBool('')).toBe(false);
  });
});

describe('column mapping', () => {
  const fields = IMPORT_FIELDS.contacts;

  it('matches headers exactly, by alias, and loosely', () => {
    const map = autoMap(['Full Name', 'E-Mail', 'Organisation', 'Phone Number'], fields);
    expect(map.name).toBe(0);
    expect(map.email).toBe(1);
    expect(map.company).toBe(2);
    expect(map.phone).toBe(3);
    expect(map.notes).toBe(-1);
  });

  it('never assigns one column to two fields', () => {
    const map = autoMap(['name', 'name'], fields);
    const used = Object.values(map).filter((i) => i >= 0);
    expect(new Set(used).size).toBe(used.length);
  });

  it('turns rows into records using the mapping', () => {
    const rows = [['a', 'b'], ['Mei', 'mei@x.example'], ['  Sam  ', '']];
    expect(mapRows(rows, { name: 0, email: 1, phone: -1 })).toEqual([
      { name: 'Mei', email: 'mei@x.example' },
      { name: 'Sam', email: '' },
    ]);
  });
});

describe('custom fields in a spreadsheet', () => {
  const plan = { id: 'plan', name: 'Plan', type: 'select', options: ['Pro'] };
  const seats = { id: 'seats', name: 'Seats', type: 'number' };
  const renews = { id: 'renews', name: 'Renews', type: 'date' };
  const trial = { id: 'trial', name: 'Trial', type: 'checkbox' };
  const fields = [plan, seats, renews, trial];

  it('appends the user’s fields to the built-in import fields', () => {
    const list = importFieldsFor('contacts', [plan]);
    expect(list).toHaveLength(IMPORT_FIELDS.contacts.length + 1);
    expect(list[list.length - 1]).toMatchObject({ key: 'custom:plan', label: 'Plan' });
    expect(importFieldsFor('nope', [plan])).toHaveLength(1);
  });

  it('auto-maps a custom column by its name', () => {
    const mapping = autoMap(['Name', 'Plan', 'Seats'], importFieldsFor('contacts', [plan, seats]));
    expect(mapping['custom:plan']).toBe(1);
    expect(mapping['custom:seats']).toBe(2);
  });

  it('reads a cell the way a spreadsheet writes it', () => {
    expect(coerceCustomCell(seats, '1,200')).toBe(1200);
    expect(coerceCustomCell(seats, '$1,200')).toBe(1200);
    expect(coerceCustomCell(seats, 'n/a')).toBeUndefined();
    expect(coerceCustomCell(renews, '9/30/2026')).toBe('2026-09-30');
    expect(coerceCustomCell(renews, 'someday')).toBeUndefined();
    expect(coerceCustomCell(trial, 'x')).toBe(true);
    expect(coerceCustomCell(trial, 'No')).toBe(false);
    expect(coerceCustomCell(trial, 'later')).toBeUndefined();
    expect(coerceCustomCell(plan, 'Legacy')).toBe('Legacy');
    expect(coerceCustomCell(plan, '  ')).toBeNull();
  });

  it('collects only the cells a row actually filled', () => {
    expect(customCellValues(fields, {
      'custom:plan': 'Pro', 'custom:seats': '', 'custom:trial': 'yes',
    })).toEqual({ plan: 'Pro', trial: true });
    expect(customCellValues(fields, {})).toEqual({});
  });

  it('writes a value back out machine-readably', () => {
    const record = { custom: { plan: 'Pro', seats: 40, renews: '2026-09-30', trial: false } };
    expect(customCellText(plan, record)).toBe('Pro');
    expect(customCellText(seats, record)).toBe(40);
    expect(customCellText(renews, record)).toBe('2026-09-30');
    expect(customCellText(trial, record)).toBe('Нет');
    expect(customCellText(plan, { custom: {} })).toBe('');
  });

  it('exports one column per field, after the built-ins', () => {
    const ctx = {
      companyName: () => '', contactName: () => '', dealName: () => '',
      stageLabel: (s) => s, lastContacted: () => '',
      customFields: () => [plan, seats],
    };
    const csv = exportRecords('contacts', [
      { name: 'Mei', title: '', email: '', phone: '', companyId: null, source: '',
        status: 'lead', tags: [], notes: '', createdAt: 0, custom: { plan: 'Pro', seats: 40 } },
    ], ctx);
    const [header, row] = parseCSV(csv);
    expect(header.slice(-2)).toEqual(['Plan', 'Seats']);
    expect(row.slice(-2)).toEqual(['Pro', '40']);
  });

  it('guards a field name a spreadsheet would run', () => {
    const nasty = { id: 'x', name: '=cmd|\'/c calc\'!A0', type: 'text' };
    const ctx = {
      companyName: () => '', contactName: () => '', dealName: () => '',
      stageLabel: (s) => s, lastContacted: () => '',
      customFields: () => [nasty],
    };
    const [header] = parseCSV(exportRecords('contacts', [], ctx));
    expect(header.at(-1)).toBe("'=cmd|'/c calc'!A0");
    // And the guard comes off again on the way back in, so the column
    // still matches the field it came from.
    expect(unguardFormula(header.at(-1))).toBe(nasty.name);
  });
});

describe('value matching', () => {
  it('matches a status by value or label, defaulting to lead', () => {
    expect(matchStatus('customer')).toBe('customer');
    expect(matchStatus('In conversation')).toBe('active');
    expect(matchStatus('VIP')).toBe('lead');
    expect(matchStatus('')).toBe('lead');
    // The merge passes '' so an unknown status never overwrites a real one.
    expect(matchStatus('VIP', '')).toBe('');
  });

  it('matches billing the many ways a spreadsheet spells it', () => {
    expect(matchBilling('Monthly')).toBe('monthly');
    expect(matchBilling('per month')).toBe('monthly');
    expect(matchBilling('MRR')).toBe('monthly');
    expect(matchBilling('Annual')).toBe('annual');
    expect(matchBilling('yearly')).toBe('annual');
    expect(matchBilling('one-time')).toBe('one-time');
    expect(matchBilling('one off')).toBe('one-time');
    expect(matchBilling('quarterly')).toBe('one-time');
    // The merge passes '' so an unreadable cell never rewrites a plan.
    expect(matchBilling('quarterly', '')).toBe('');
    expect(matchBilling('', '')).toBe('');
  });

  it('reads a term in months, or in years when the cell says so', () => {
    expect(parseTerm('12')).toBe(12);
    expect(parseTerm('18 months')).toBe(18);
    expect(parseTerm('2 years')).toBe(24);
    expect(parseTerm('1 yr')).toBe(12);
    expect(parseTerm('999')).toBe(120);
    expect(parseTerm('0')).toBe('');
    expect(parseTerm('n/a')).toBe('');
    expect(parseTerm('')).toBe('');
  });

  it('matches a stage by id or label against the configured funnel', () => {
    const stages = [
      { id: 'scoping', label: 'Scoping' },
      { id: 'won', label: 'Won' },
    ];
    expect(matchStage('Scoping', stages, 'scoping')).toBe('scoping');
    expect(matchStage('won', stages, 'scoping')).toBe('won');
    expect(matchStage('Nurture', stages, 'scoping')).toBe('scoping');
  });
});

describe('Russian and legacy English spreadsheets', () => {
  const ctx = {
    companyName: () => 'Норд-Автоматика', contactName: () => 'Марина Тихонова', dealName: () => '',
    stageLabel: (s) => s, lastContacted: () => '', customFields: () => [],
  };
  const headerOf = (key) => parseCSV(exportRecords(key, [], ctx))[0];

  it('exports headers in Russian', () => {
    expect(headerOf('contacts')).toEqual([
      'Имя', 'Должность', 'Эл. почта', 'Телефон', 'Компания', 'Источник', 'Статус',
      'Метки', 'Последний контакт', 'Заметки', 'Создан',
    ]);
    expect(headerOf('companies')).toEqual(['Название', 'Отрасль', 'Сайт', 'Сотрудники', 'Метки', 'Заметки', 'Создана']);
    expect(headerOf('deals').slice(0, 7)).toEqual([
      'Название', 'Сумма', 'Оплата', 'Срок (мес.)', 'Сумма договора', 'Платёж в месяц', 'Этап',
    ]);
    expect(headerOf('tasks')).toEqual(['Задача', 'Срок', 'Время', 'Повтор', 'Выполнена', 'Контакт', 'Сделка']);
    expect(headerOf('activities')).toEqual(['Дата', 'Тип', 'Тема', 'Заметки', 'Контакт', 'Компания', 'Сделка']);
  });

  it('writes statuses, activity types, and done flags in Russian', () => {
    const [, contact] = parseCSV(exportRecords('contacts', [
      { name: 'Марина', status: 'customer', tags: [], createdAt: 0 },
    ], ctx));
    expect(contact[6]).toBe('Клиент');
    const [, activity] = parseCSV(exportRecords('activities', [
      { date: '2026-10-01', type: 'call', summary: 'Созвон' },
    ], ctx));
    expect(activity[1]).toBe('Звонок');
    const [, task] = parseCSV(exportRecords('tasks', [
      { title: 'Позвонить', due: '2026-10-01', done: true },
    ], ctx));
    expect(task[4]).toBe('Да');
  });

  it('maps every column of its own Russian export back to the field it came from', () => {
    for (const key of ['contacts', 'companies', 'deals']) {
      const headers = headerOf(key);
      const map = autoMap(headers, IMPORT_FIELDS[key]);
      for (const field of IMPORT_FIELDS[key]) {
        expect(headers[map[field.key]], `${key}.${field.key}`).toBe(field.label);
      }
    }
  });

  it('still maps the English headers older exports carry', () => {
    const contacts = autoMap(
      ['Name', 'Job title', 'Email', 'Phone', 'Company', 'Source', 'Status', 'Tags', 'Last contacted', 'Notes', 'Created'],
      IMPORT_FIELDS.contacts);
    expect(contacts).toMatchObject({
      name: 0, title: 1, email: 2, phone: 3, company: 4, source: 5, status: 6, tags: 7, notes: 9,
    });
    const deals = autoMap(
      ['Name', 'Value', 'Billing', 'Term (months)', 'Contract value', 'MRR', 'Stage', 'Company',
        'Contact', 'Expected close', 'Tags', 'Close reason', 'Close detail', 'Notes'],
      IMPORT_FIELDS.deals);
    expect(deals).toMatchObject({
      name: 0, value: 1, billing: 2, term: 3, stage: 6, company: 7, contact: 8,
      expectedClose: 9, tags: 10, notes: 13,
    });
    const companies = autoMap(['Name', 'Industry', 'Website', 'Company size', 'Tags', 'Notes'], IMPORT_FIELDS.companies);
    expect(companies).toEqual({ name: 0, industry: 1, website: 2, size: 3, tags: 4, notes: 5 });
  });

  it('reads Russian headers written by hand, case and ё aside', () => {
    const map = autoMap(['ФИО', 'Электронная почта', 'Номер телефона', 'Организация', 'Примечание'], IMPORT_FIELDS.contacts);
    expect(map).toMatchObject({ name: 0, email: 1, phone: 2, company: 3, notes: 4 });
    const deals = autoMap(['Название сделки', 'Бюджет', 'Стадия', 'Срок закрытия', 'Платёж в месяц'], IMPORT_FIELDS.deals);
    expect(deals).toMatchObject({ name: 0, value: 1, stage: 2, expectedClose: 3 });
  });

  it('matches a status by its Russian label and by the old English one', () => {
    expect(matchStatus('Клиент')).toBe('customer');
    expect(matchStatus('в работе')).toBe('active');
    expect(matchStatus('ЛИД')).toBe('lead');
    expect(matchStatus('Потерян')).toBe('lost');
    expect(matchStatus('Customer')).toBe('customer');
    expect(matchStatus('Lost touch')).toBe('lost');
    expect(matchStatus('Lead')).toBe('lead');
    expect(matchStatus('ВИП', '')).toBe('');
  });

  it('matches a stage by Russian or English name, only if the funnel has it', () => {
    const stages = [
      { id: 'new', label: 'Новая' },
      { id: 'proposal', label: 'Предложение' },
      { id: 'won', label: 'Выиграна' },
      { id: 'lost', label: 'Проиграна' },
    ];
    expect(matchStage('Предложение', stages, 'new')).toBe('proposal');
    expect(matchStage('Proposal', stages, 'new')).toBe('proposal');
    expect(matchStage('выиграна', stages, 'new')).toBe('won');
    expect(matchStage('Won', stages, 'new')).toBe('won');
    expect(matchStage('Lost', stages, 'new')).toBe('lost');
    expect(matchStage('Проиграно', stages, 'new')).toBe('new');
    // Negotiation is a default stage, but not one this funnel has.
    expect(matchStage('Переговоры', stages, 'new')).toBe('new');
    expect(matchStage('Negotiation', stages, '')).toBe('');
    // A renamed stage still answers to its id and its own label.
    const custom = [{ id: 'proposal', label: 'КП отправлено' }];
    expect(matchStage('КП отправлено', custom, '')).toBe('proposal');
    expect(matchStage('Предложение', custom, '')).toBe('');
  });

  it('reads billing written in Russian', () => {
    expect(matchBilling('В месяц')).toBe('monthly');
    expect(matchBilling('ежемесячно')).toBe('monthly');
    expect(matchBilling('В год')).toBe('annual');
    expect(matchBilling('Ежегодно')).toBe('annual');
    expect(matchBilling('разово')).toBe('one-time');
    expect(matchBilling('поквартально', '')).toBe('');
  });

  it('reads a term in Russian months and years', () => {
    expect(parseTerm('18 мес.')).toBe(18);
    expect(parseTerm('1 год')).toBe(12);
    expect(parseTerm('2 года')).toBe(24);
    expect(parseTerm('5 лет')).toBe(60);
  });

  it('reads Russian dates and yes', () => {
    expect(parseDateLoose('12 авг 2026')).toBe('2026-08-12');
    expect(parseDateLoose('12 августа 2026')).toBe('2026-08-12');
    expect(parseDateLoose('3 мая 2026 г.')).toBe('2026-05-03');
    expect(parseDateLoose('1 Мар 2026')).toBe('2026-03-01');
    expect(parseDateLoose('31 ноября 2026')).toBeNull();
    expect(parseBool('Да')).toBe(true);
    expect(parseBool('выполнено')).toBe(true);
    expect(parseBool('Нет')).toBe(false);
  });
});
