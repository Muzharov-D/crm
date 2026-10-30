import { el, clear, keepingFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { store } from '../lib/store.js';
import { pageHead, emptyState } from '../ui/mvp-bits.js';
import {
  MODULES, BLOCKS, WORKSPACE_PRESETS, workspaceOf, enabledModuleCount,
} from '../lib/workspace.js';
import { dataQuality } from '../lib/operations.js';

function toggle(checked, label, onChange, disabled = false) {
  const button = el('button.switch.control-switch', {
    type: 'button', role: 'switch', 'aria-checked': String(checked), 'aria-label': label,
    className: `switch control-switch${checked ? ' on' : ''}`, disabled,
    onclick: async () => {
      button.disabled = true;
      try { await onChange(!checked); } finally { button.disabled = false; }
    },
  }, el('span.switch-knob', { 'aria-hidden': 'true' }));
  return button;
}

function controlRow(title, description, control, meta = '') {
  return el('div.control-row', {},
    el('div.control-row-copy', {},
      el('div.control-row-title', {}, title),
      description && el('p.control-row-description', {}, description),
      meta && el('div.control-row-meta', {}, meta)),
    control);
}

function qualityLink(label, count, hash, detail) {
  return el('a.quality-row', { href: hash },
    el('span.quality-count', { className: `quality-count${count ? ' has-issues' : ''}` }, String(count)),
    el('span.grow.min0', {}, el('strong', {}, label), el('small', {}, detail)),
    el('span', { html: icon('chevR', 16), 'aria-hidden': 'true' }));
}

export function controlView() {
  const root = el('div.view.control-view');
  let tab = 'modules';

  const render = keepingFocus(() => {
    clear(root);
    if (store.user?.role !== 'admin') {
      root.append(pageHead('Пульт управления', 'Администрирование рабочей области'),
        emptyState('Нужны права администратора', 'Пульт меняет общую конфигурацию CRM. Рабочие разделы доступны в основном меню.'));
      return;
    }

    const workspace = workspaceOf(store.settings);
    const enabled = enabledModuleCount(store.settings);
    const activeBlocks = BLOCKS.filter((b) => workspace.blocks[b.key]).length;
    const activeEmployees = store.employees.filter((e) => e.active !== false).length;
    const quality = dataQuality(store);

    root.append(
      pageHead('Пульт управления', 'Единая настройка модулей, рабочего пространства и команды — без разработчика',
        el('a.btn.btn-ghost', { href: '#/settings', 'aria-label': 'Параметры CRM' }, el('span', { html: icon('gear', 16) }), 'Параметры CRM')),
      el('section.control-hero', {},
        el('div.control-hero-copy', {},
          el('div.brand-kicker.light', {}, 'АВАНДОК · CONTROL CENTER'),
          el('h2', {}, 'CRM подстраивается под процесс'),
          el('p', {}, 'Изменения применяются сразу и сохраняются для всей команды. Данные и история записей при выключении модулей не удаляются.'),
          el('div.control-live', {}, el('span.pulse-dot', { 'aria-hidden': 'true' }), 'Конфигурация активна')),
        el('div.control-hero-stats', {},
          el('div', {}, el('strong', {}, `${enabled}/${MODULES.length}`), el('span', {}, 'модулей')),
          el('div', {}, el('strong', {}, `${activeBlocks}/${BLOCKS.length}`), el('span', {}, 'блоков')),
          el('div', {}, el('strong', {}, `${activeEmployees}/${store.employees.length}`), el('span', {}, 'сотрудников')))),

      el('div.control-summary', {},
        qualityLink('Дубли контрагентов', quality.companyDuplicates.length, '#/companies', 'Совпадают ИНН или названия'),
        qualityLink('Дубли контактов', quality.contactDuplicates.length, '#/contacts', 'Совпадают email или телефоны'),
        qualityLink('Сделки без следующего шага', quality.dealsWithoutNextStep.length, '#/pipeline', 'Нет шага и открытой задачи'),
        qualityLink('Просроченные задачи', quality.overdueTasks.length, '#/followups', 'Срок уже прошёл')),

      el('div.control-layout', {},
        el('nav.control-tabs', { 'aria-label': 'Разделы пульта' },
          [
            ['modules', 'Модули', 'Включение разделов'],
            ['workspace', 'Рабочая область', 'Блоки и плотность'],
            ['team', 'Команда', 'Доступность для назначения'],
            ['quality', 'Качество данных', 'Что нужно исправить'],
          ].map(([key, label, sub]) => el('button.control-tab', {
            type: 'button', className: `control-tab${tab === key ? ' active' : ''}`,
            'aria-current': tab === key ? 'page' : null,
            dataset: { controlTab: key },
            onclick: () => { tab = key; render(); },
          }, el('strong', {}, label), el('small', {}, sub)))),

        el('div.control-content', {}),
        el('aside.control-rail', {},
          el('div.control-rail-section', {},
            el('div.brand-kicker', {}, 'БЫСТРЫЙ СЦЕНАРИЙ'),
            el('h3', {}, 'Готовые конфигурации'),
            el('p', {}, 'Набор переключателей можно изменить одним действием, затем настроить детали.'),
            el('div.preset-list', {}, WORKSPACE_PRESETS.map((preset) => el('button.preset-button', {
              type: 'button',
              onclick: async () => {
                await store.updateSettings({
                  workspace: {
                    ...workspace,
                    modules: { ...workspace.modules, ...preset.modules },
                    blocks: { ...workspace.blocks, ...preset.blocks },
                    home: preset.modules.dashboard ? 'dashboard' : 'pipeline',
                  },
                });
              },
            }, el('strong', {}, preset.label), el('small', {}, preset.description))))),
          el('div.control-rail-section', {},
            el('div.brand-kicker', {}, 'ПРИНЦИП РАБОТЫ'),
            el('h3', {}, 'Ничего не теряется'),
            el('p', {}, 'Выключенный модуль исчезает из меню и закрывается для прямого перехода. Записи остаются в общей базе и возвращаются при включении.'),
            el('a.text-link', { href: '#/audit' }, 'Открыть журнал аудита →'))),
      ));

    const content = root.querySelector('.control-content');
    if (tab === 'modules') {
      const effectiveHome = workspace.modules[workspace.home]
        ? workspace.home : MODULES.find((m) => workspace.modules[m.key])?.key || '';
      content.append(
        el('section.control-panel', {},
          el('div.control-panel-head', {}, el('div', {}, el('div.brand-kicker', {}, 'НАВИГАЦИЯ'),
            el('h2', {}, 'Прикладные модули')), el('span.status-chip.success', {}, `${enabled} активно`)),
          el('div.control-list', {}, MODULES.map((module) => controlRow(module.label, module.description,
            toggle(workspace.modules[module.key], `${workspace.modules[module.key] ? 'Выключить' : 'Включить'} модуль ${module.label}`, async (value) => {
              const modules = { ...workspace.modules, [module.key]: value };
              const nextHome = workspace.home === module.key && !value
                ? MODULES.find((m) => modules[m.key])?.key || 'dashboard' : workspace.home;
              await store.updateSettings({ workspace: { ...workspace, modules, home: nextHome } });
            }))))),
        el('section.control-panel', {},
          el('div.control-panel-head', {}, el('div', {}, el('div.brand-kicker', {}, 'СТАРТОВАЯ СТРАНИЦА'),
            el('h2', {}, 'Куда попадает пользователь при входе'))),
          el('div.control-home-grid', {}, MODULES.filter((m) => workspace.modules[m.key]).map((module) =>
            el('button.home-option', {
              type: 'button', className: `home-option${effectiveHome === module.key ? ' selected' : ''}`,
              'aria-pressed': String(effectiveHome === module.key),
              onclick: () => store.updateSettings({ workspace: { ...workspace, home: module.key } }),
            }, el('span.home-option-check', {}, effectiveHome === module.key ? '●' : '○'),
              el('strong', {}, module.label), el('small', {}, `#/${module.path}`))))));
    } else if (tab === 'workspace') {
      content.append(
        el('section.control-panel', {},
          el('div.control-panel-head', {}, el('div', {}, el('div.brand-kicker', {}, 'ПЛОТНОСТЬ'),
            el('h2', {}, 'Рабочий ритм интерфейса'))),
          el('div.density-options', {},
            [['comfortable', 'Комфортная', 'Больше воздуха для обзора и демонстрации'],
              ['compact', 'Компактная', 'Больше строк и данных на одном экране']].map(([key, label, sub]) =>
              el('button.density-option', {
                type: 'button', className: `density-option${workspace.density === key ? ' selected' : ''}`,
                'aria-pressed': String(workspace.density === key),
                onclick: () => store.updateSettings({ workspace: { ...workspace, density: key } }),
              }, el('span.density-preview', { dataset: { density: key } }, el('i'), el('i'), el('i')),
                el('strong', {}, label), el('small', {}, sub))))),
        ...['Обзор', 'Инструменты'].map((group) => el('section.control-panel', {},
          el('div.control-panel-head', {}, el('div', {}, el('div.brand-kicker', {}, group.toUpperCase()),
            el('h2', {}, group === 'Обзор' ? 'Блоки главной страницы' : 'Общие инструменты'))),
          el('div.control-list', {}, BLOCKS.filter((b) => b.group === group).map((block) =>
            controlRow(block.label, block.description,
              toggle(workspace.blocks[block.key], `${workspace.blocks[block.key] ? 'Скрыть' : 'Показать'} блок ${block.label}`, async (value) => {
                await store.updateSettings({ workspace: { ...workspace, blocks: { ...workspace.blocks, [block.key]: value } } });
              })))))));
    } else if (tab === 'team') {
      content.append(el('section.control-panel', {},
        el('div.control-panel-head', {}, el('div', {}, el('div.brand-kicker', {}, 'НАЗНАЧЕНИЯ'),
          el('h2', {}, 'Активность сотрудников')), el('a.btn.btn-ghost.btn-sm', { href: '#/employees' }, 'Реестр сотрудников')),
        el('p.control-note', {}, 'Выключенный сотрудник исчезает из вариантов новых назначений. Его текущие сделки, лиды, задачи и история сохраняются. Это прикладная настройка, а не блокировка входа.'),
        store.employees.length ? el('div.control-list', {}, store.employees.map((employee) => {
          const openTasks = store.tasks.filter((t) => t.employeeId === employee.id && !t.done).length;
          const deals = new Set(store.salesTeam.filter((r) => r.employeeId === employee.id).map((r) => r.dealId)).size;
          return controlRow(employee.name, employee.role || 'Бизнес-роль не указана',
            toggle(employee.active !== false, `${employee.active !== false ? 'Выключить' : 'Включить'} сотрудника ${employee.name}`, async (value) => {
              await store.updateEmployee(employee.id, { active: value });
            }), `${deals} сделок · ${openTasks} открытых задач`);
        })) : emptyState('Сотрудников пока нет', 'Добавьте команду в реестре сотрудников.')));
    } else {
      const duplicateCompanies = quality.companyDuplicates.flatMap((group) => group.slice(1));
      const duplicateContacts = quality.contactDuplicates.flatMap((group) => group.slice(1));
      content.append(
        el('section.control-panel', {},
          el('div.control-panel-head', {}, el('div', {}, el('div.brand-kicker', {}, 'DATA QUALITY'),
            el('h2', {}, 'Конкретные записи для исправления')), el('span.status-chip', { className: `status-chip${quality.total ? ' warning' : ' success'}` }, quality.total ? `${quality.total} сигналов` : 'Порядок')),
          el('p.control-note', {}, 'Пульт не выдумывает общий процент качества: каждый сигнал ведёт к реестру, где можно исправить данные.')),
        el('div.quality-grid', {},
          el('section.control-panel', {}, el('h3', {}, 'Возможные дубли контрагентов'),
            duplicateCompanies.length ? el('div.link-list', {}, duplicateCompanies.slice(0, 8).map((c) =>
              el('a.record-link', { href: `#/companies?id=${c.id}` }, c.name))) : el('p.all-clear', {}, 'Совпадений не найдено.')),
          el('section.control-panel', {}, el('h3', {}, 'Возможные дубли контактов'),
            duplicateContacts.length ? el('div.link-list', {}, duplicateContacts.slice(0, 8).map((c) =>
              el('a.record-link', { href: `#/contacts?id=${c.id}` }, c.name))) : el('p.all-clear', {}, 'Совпадений не найдено.')),
          el('section.control-panel', {}, el('h3', {}, 'Лиды без ответственного'),
            quality.leadsWithoutOwner.length ? el('div.link-list', {}, quality.leadsWithoutOwner.slice(0, 8).map((l) =>
              el('a.record-link', { href: `#/leads?id=${l.id}` }, l.name))) : el('p.all-clear', {}, 'У всех открытых лидов есть ответственный.')),
          el('section.control-panel', {}, el('h3', {}, 'Сделки без контрагента'),
            quality.dealsWithoutCompany.length ? el('div.link-list', {}, quality.dealsWithoutCompany.slice(0, 8).map((d) =>
              el('a.record-link', { href: `#/pipeline?id=${d.id}` }, d.name))) : el('p.all-clear', {}, 'Все открытые сделки связаны с контрагентами.'))));
    }
  });

  store.addEventListener('change', render);
  render();
  root.destroy = () => store.removeEventListener('change', render);
  return root;
}
