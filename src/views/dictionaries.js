import { el, clear, keepingFocus } from '../ui/dom.js';
import { store } from '../lib/store.js';
import { DICTIONARY_DEFINITIONS, dictionary } from '../lib/spec.js';
import { canWrite } from '../lib/access.js';
import { pageHead, actionButton } from '../ui/mvp-bits.js';
import { confirmDialog } from '../ui/modal.js';

export function dictionariesView({ params }) {
  const root = el('div.view'); let selected = params.get('key') || DICTIONARY_DEFINITIONS[0].key;
  const render = keepingFocus(() => {
    clear(root);
    const definition = DICTIONARY_DEFINITIONS.find((d) => d.key === selected) || DICTIONARY_DEFINITIONS[0];
    const values = dictionary(store.settings, definition.key);
    const value = el('input.input', { placeholder: definition.key === 'subproducts' ? 'Новый подпродукт' : 'Новое значение', disabled: !canWrite(store.user) });
    const parent = el('select.select', { disabled: !canWrite(store.user) }, dictionary(store.settings, 'products').map((p) => el('option', { value: p }, p)));
    const add = async () => {
      if (!value.value.trim()) return;
      const next = definition.key === 'subproducts' ? { value: value.value.trim(), parent: parent.value } : value.value.trim();
      await store.updateDictionary(definition.key, [...values, next]);
    };
    root.append(pageHead('Справочники', 'Управляемые значения используются в формах, фильтрах и отчётах.'),
      el('div.dictionary-layout', {}, el('nav.dictionary-nav', { 'aria-label': 'Справочники' }, DICTIONARY_DEFINITIONS.map((d) =>
        el('button', { type: 'button', className: d.key === definition.key ? 'active' : '', onclick: () => { selected = d.key; render(); } }, d.label))),
        el('section.detail-section.dictionary-editor', {}, el('div.section-head', {}, el('h2.section-title', {}, definition.label), el('span.muted', {}, `${values.length} значений`)),
          el('div.table-wrap', {}, el('table.data-table.compact', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Значение'), definition.key === 'subproducts' && el('th', {}, 'Продукт'), el('th', {}, ''))),
            el('tbody', {}, values.map((v, index) => el('tr', {}, el('td', {}, typeof v === 'string' ? v : v.value),
              definition.key === 'subproducts' && el('td', {}, v.parent || '—'),
              el('td', {}, canWrite(store.user) && actionButton('Удалить', async () => {
                if (!await confirmDialog({ title: 'Удалить значение справочника?', message: 'Существующие записи сохранят прежнее текстовое значение.' })) return;
                await store.updateDictionary(definition.key, values.filter((_, i) => i !== index));
              }, { iconName: 'trash' }))))))),
          canWrite(store.user) && el('div.inline-add-grid.dictionary-add', {}, definition.key === 'subproducts' ? parent : null, value, actionButton('Добавить значение', add, { primary: true, iconName: 'plus' })),
          definition.key === 'subproducts' && el('p.field-hint', {}, 'Подпродукт всегда зависит от выбранного продукта.'))));
  });
  render(); const onChange = () => render(); store.addEventListener('change', onChange);
  root.destroy = () => store.removeEventListener('change', onChange); return root;
}
