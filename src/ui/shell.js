import { el, clear, keepingFocus } from './dom.js';
import { icon } from './icons.js';
import { openModal, confirmDialog, closeAllModals } from './modal.js';
import { toast, mountToastRoot } from './toast.js';
import { store } from '../lib/store.js';
import { todayISO } from '../lib/util.js';
import { wipeSampleData } from '../lib/sample.js';
import { openOnboarding } from './onboarding.js';
import { openPalette, installPaletteShortcut } from './palette.js';
import { offlineIndicator } from './offline.js';
import { dashboardView } from '../views/dashboard.js';
import { pipelineMvpView } from '../views/pipeline-mvp.js';
import { contactsMvpView } from '../views/contacts-mvp.js';
import { leadsMvpView } from '../views/leads-mvp.js';
import { employeesView } from '../views/employees.js';
import { dictionariesView } from '../views/dictionaries.js';
import { companiesMvpView } from '../views/companies-mvp.js';
import { tasksMvpView } from '../views/tasks-mvp.js';
import { reportsView } from '../views/reports.js';
import { activityView } from '../views/activity.js';
import { settingsView, confirmSignOut } from '../views/settings.js';
import { auditView } from '../views/audit.js';
import { canWrite, roleLabel } from '../lib/access.js';
import { openQuickCreate } from './quick-create.js';
import { openNotifications } from './notifications.js';
import { blockEnabled, routeEnabled, homeHash, workspaceOf } from '../lib/workspace.js';
import { operationalAlerts } from '../lib/operations.js';
import { controlView } from '../views/control.js';

/* The mobile tab bar holds four destinations plus More; routes marked
   tab: false live in the More sheet there. The desktop sidebar shows
   everything. */
const ROUTES = [
  { hash: '#/', label: 'Главная', icon: 'dashboard', view: dashboardView },
  { hash: '#/pipeline', label: 'Сделки', icon: 'pipeline', view: pipelineMvpView },
  { hash: '#/leads', label: 'Лиды', icon: 'target', view: leadsMvpView },
  { hash: '#/followups', label: 'Задачи', icon: 'followups', view: tasksMvpView },
  { hash: '#/contacts', label: 'Контакты', icon: 'users', view: contactsMvpView, tab: false },
  { hash: '#/companies', label: 'Контрагенты', icon: 'company', view: companiesMvpView, tab: false },
  { hash: '#/employees', label: 'Сотрудники', icon: 'briefcase', view: employeesView, tab: false },
  { hash: '#/activity', label: 'История', icon: 'video', view: activityView, tab: false },
  { hash: '#/audit', label: 'Журнал', icon: 'listChecks', view: auditView, tab: false, admin: true },
  { hash: '#/control', label: 'Пульт управления', icon: 'gear', view: controlView, tab: false, admin: true },
  { hash: '#/forecast', label: 'Отчётность', icon: 'chart', view: reportsView, tab: false },
  { hash: '#/dictionaries', label: 'Справочники', icon: 'listChecks', view: dictionariesView, tab: false },
  { hash: '#/settings', label: 'Настройки', icon: 'gear', view: settingsView, tab: false },
];

/* One-line descriptions for the More sheet. */
const MORE_SUBS = {
  '#/companies': 'Организации, их сотрудники и сделки',
  '#/activity': 'Все записанные встречи, звонки, письма и заметки',
  '#/audit': 'Кто, когда и что изменил в CRM',
  '#/forecast': 'Взвешенная воронка по месяцам закрытия',
  '#/settings': 'Оформление, валюта, этапы и ваши данные',
  '#/control': 'Модули, рабочие блоки и активность сотрудников',
  '#/employees': 'Бизнес-роли, назначения и загрузка',
  '#/dictionaries': 'Управляемые значения прикладных полей',
};

/** Apple keyboards say ⌘K; everyone else says Ctrl K. */
function shortcutHint() {
  const mac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  return mac ? '⌘K' : 'Ctrl K';
}

export function mountShell(appRoot) {
  // Before the first message can need announcing - see the note in toast.js.
  mountToastRoot();
  if (!location.hash || location.hash === '#/') {
    history.replaceState(history.state, '', homeHash(store.settings));
  }
  const sampleBanner = el('div');
  const workspaceBar = el('header.workspace-topbar');
  const viewWrap = el('div');
  // tabindex -1 lets navigation hand focus to the new view's content:
  // the clicked nav link is rebuilt by renderNav, so without this the
  // keyboard user is dumped back at the top of the document every route.
  const main = el('main.main', { id: 'main', tabindex: -1 }, workspaceBar, sampleBanner, viewWrap);
  let currentView = null;

  /* Sample-data banner: always visible while exploring, one-tap wipe. */
  function renderSampleBanner() {
    clear(sampleBanner);
    if (!store.settings.sampleData) return;
    sampleBanner.append(el('div.sample-banner', {},
      el('span.sample-banner-ic', { html: icon('sparkle', 14, 2.2) }),
      el('span.grow', {}, 'Демо-данные: можно смело пробовать, ваших данных здесь нет'),
      canWrite(store.user) && el('button', {
        onclick: async () => {
          const ok = await confirmDialog({
            title: 'Начать с чистого листа?',
            message: 'Все демо-данные будут удалены, и вы начнёте с пустой CRM.',
            confirmLabel: 'Удалить демо-данные',
          });
          if (!ok) return;
          try {
            await wipeSampleData(store);
          } catch (err) {
            console.error(err);
            toast('Не удалось удалить. Проверьте связь', { icon: 'wifiOff' });
            return;
          }
          openOnboarding();
        },
      }, 'Начать с нуля')
    ));
  }
  store.addEventListener('change', renderSampleBanner);
  renderSampleBanner();

  function navigate(hash) {
    location.hash = hash;
  }

  function routePath(hash) {
    const clean = (hash || '#/').split('?')[0];
    return clean === '#/' ? 'dashboard' : clean.replace(/^#\//, '');
  }

  function visibleRoutes() {
    return ROUTES.filter((r) => (!r.admin || store.user?.role === 'admin')
      && routeEnabled(store.settings, routePath(r.hash)));
  }

  function routeFor(hash) {
    const clean = (hash || '#/').split('?')[0];
    return visibleRoutes().find((r) => r.hash === clean) || ROUTES[0];
  }

  function paramsFor(hash) {
    return new URLSearchParams((hash || '').split('?')[1] || '');
  }

  /* Attention badge: follow-ups needing eyes now - overdue in red, or
     due-today count in the muted style when nothing is overdue. */
  function followupBadge() {
    const today = todayISO();
    const open = store.openTasks();
    const overdue = open.filter((t) => t.due < today).length;
    const dueToday = open.filter((t) => t.due === today).length;
    const n = overdue || dueToday;
    if (!n) return null;
    const label = overdue ? `Просрочено: ${overdue}` : `На сегодня: ${dueToday}`;
    return el(`span.nav-badge${overdue ? '' : '.info'}`, {
      role: 'img', 'aria-label': label, title: label,
    }, n > 9 ? '9+' : String(n));
  }

  function navBadge(route) {
    return route.hash === '#/followups' ? followupBadge() : null;
  }

  /** What the badges would say, so a render that changes nothing is skipped. */
  let badgeState = '';
  function badgeSignature() {
    const today = todayISO();
    const open = store.openTasks();
    return `${open.filter((t) => t.due < today).length}|${open.filter((t) => t.due === today).length}|${JSON.stringify(workspaceOf(store.settings))}|${operationalAlerts(store, store.settings).length}`;
  }

  /* Quick add - the FAB (mobile) and sidebar button (desktop) both open it. */
  function openQuickAdd() {
    if (!canWrite(store.user)) {
      toast('Роль наблюдателя позволяет только просматривать данные', { icon: 'info' });
      return;
    }
    openQuickCreate();
  }

  /* Sidebar (desktop) */
  const username = store.user?.username || 'Пользователь';
  const sidebarNav = el('div', { style: { display: 'contents' } });
  const sidebarSearch = el('button.sidebar-search', {
    type: 'button', html: icon('search', 17, 2), 'aria-haspopup': 'dialog', onclick: openPalette,
  }, el('span.grow', {}, 'Поиск'), el('kbd.kbd', { 'aria-hidden': 'true' }, shortcutHint()));
  const sidebarAdd = canWrite(store.user) && el('button.btn.btn-primary.sidebar-add', {
    html: icon('plus', 17, 2.2), onclick: openQuickAdd,
  }, ' Создать');
  const sidebar = el('nav.sidebar', { 'aria-label': 'Основное меню' },
    el('button.brand', { type: 'button', onclick: () => navigate(homeHash(store.settings)), 'aria-label': 'Авандок CRM — на главную' },
      el('img.brand-wordmark', { src: './brand/avandok-white-wordmark.png', alt: 'Авандок' }),
      el('span.brand-product', {}, 'CRM · SALES OS'),
      el('span.brand-pulse', { 'aria-hidden': 'true' })
    ),
    sidebarSearch,
    sidebarNav,
    el('div.sidebar-spacer'),
    // Where the data actually is, whenever that isn't "in your cloud".
    offlineIndicator(),
    sidebarAdd,
    el('div.sidebar-user', {},
      el('span.avatar', {}, username.charAt(0).toUpperCase()),
      el('span.sidebar-user-copy.grow.min0', {},
        el('span.name', { title: username }, username),
        el('span.sidebar-role', {}, roleLabel(store.user?.role))
      ),
      // Inside Puter's desktop the platform owns the session - no sign-out.
      puter.env !== 'app' && el('button.icon-btn', {
        html: icon('logout', 18, 2),
        'aria-label': 'Выйти',
        title: 'Выйти',
        onclick: confirmSignOut,
      })
    )
  );

  /* Tab bar (mobile) */
  const tabbar = el('nav.tabbar', { 'aria-label': 'Основное меню' });

  function openMoreSheet() {
    const modal = openModal({
      title: 'Ещё',
      content: el('div.settings-list', {},
        blockEnabled(store.settings, 'globalSearch') && el('button.settings-row', {
          type: 'button',
          onclick: () => { modal.close(); setTimeout(openPalette, 120); },
        },
          el('span.row-ic', { html: icon('search', 20, 1.8) }),
          el('div.grow', {},
            el('div.title', {}, 'Поиск'),
            el('div.sub', {}, 'Контакты, компании, сделки и задачи')
          ),
          el('span.row-chev', { html: icon('chevR', 18) })
        ),
        visibleRoutes().filter((r) => r.tab === false).map((r) =>
          el('a.settings-row', {
            href: r.hash,
            onclick: () => modal.close(),
          },
            el('span.row-ic', { html: icon(r.icon, 20, 1.8) }),
            el('div.grow', {},
              el('div.title', {}, r.label),
              el('div.sub', {}, MORE_SUBS[r.hash] || '')
            ),
            el('span.row-chev', { html: icon('chevR', 18) })
          ))
      ),
    });
  }

  function renderNav() {
    const active = routeFor(location.hash);
    badgeState = badgeSignature();
    clear(sidebarNav);
    clear(tabbar);
    for (const r of visibleRoutes()) {
      // A destination is found again by where it goes, so a rebuild can
      // hand the keyboard back to the link it was on - see keepingFocus.
      sidebarNav.append(el('a.nav-item', {
        href: r.hash,
        className: `nav-item${r === active ? ' active' : ''}`,
        html: icon(r.icon, 21, 1.8),
        dataset: { focusKey: `nav-${r.hash}` },
        'aria-current': r === active ? 'page' : null,
      }, el('span', {}, r.label), navBadge(r)));
      if (r.tab === false) continue;
      tabbar.append(el('a.tab-item', {
        href: r.hash,
        className: `tab-item${r === active ? ' active' : ''}`,
        html: icon(r.icon, 23, 1.8),
        dataset: { focusKey: `tab-${r.hash}` },
        'aria-current': r === active ? 'page' : null,
      }, el('span', {}, r.label), navBadge(r)));
    }
    const moreActive = active.tab === false;
    tabbar.append(el('button.tab-item', {
      type: 'button',
      className: `tab-item${moreActive ? ' active' : ''}`,
      html: icon('more', 23, 1.8),
      'aria-haspopup': 'dialog',
      onclick: openMoreSheet,
    }, el('span', {}, 'Ещё')));
  }

  /* ---------- scroll memory ----------
     The core loop is: scan a list, open a record, come back, carry on. Back
     rebuilt the list at the top every time, so a founder working down a
     long list of leads restarted the scan after every one they opened.

     Only a history traversal lands where it left off. Picking a page from
     the nav is a fresh arrival and starts at the top, which is what asking
     for a page means. Positions are kept per URL, capped so a long session
     of deal pages can't grow the map without bound. */
  const SCROLL_MEMORY_MAX = 30;
  const scrollMemory = new Map();
  // The views are rebuilt from scratch on every route change, so the
  // browser's own guess about where the page was is about a document that
  // no longer exists. Own the decision rather than race it.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  let lastHash = location.hash;

  /* Telling a Back apart from a fresh navigation. popstate looks like the
     obvious signal and isn't - browsers fire it for ordinary fragment
     navigation too, so it says yes to both. A history entry this app has
     already rendered carries a stamp instead: an entry arriving without
     one is somewhere new, and one arriving with it is somewhere we have
     been, which is exactly the case that should land where it left off. */
  const STAMP = 'crmVisited';
  const stampEntry = () => history.replaceState({ ...history.state, [STAMP]: true }, '');
  const isReturnVisit = () => !!history.state?.[STAMP];
  stampEntry();

  function rememberScroll() {
    scrollMemory.delete(lastHash);
    scrollMemory.set(lastHash, main.scrollTop || window.scrollY);
    if (scrollMemory.size > SCROLL_MEMORY_MAX) {
      scrollMemory.delete(scrollMemory.keys().next().value);
    }
  }

  function renderTopbar() {
    clear(workspaceBar);
    sidebarSearch.hidden = !blockEnabled(store.settings, 'globalSearch');
    if (sidebarAdd) sidebarAdd.hidden = !blockEnabled(store.settings, 'quickCreate');
    if (fab) fab.hidden = !blockEnabled(store.settings, 'quickCreate');
    const route = routeFor(location.hash);
    const alerts = blockEnabled(store.settings, 'notifications') ? operationalAlerts(store, store.settings) : [];
    document.documentElement.dataset.density = workspaceOf(store.settings).density;
    workspaceBar.append(
      el('div.workspace-location', {},
        el('span.workspace-location-brand', {}, 'АВАНДОК'),
        el('span.workspace-location-separator', {}, '/'),
        el('strong', {}, route.label)),
      el('div.workspace-status', {}, el('span.pulse-dot', { 'aria-hidden': 'true' }), 'Данные в работе'),
      el('div.workspace-actions', {},
        el('span.workspace-date', {}, new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' }).format(new Date())),
        blockEnabled(store.settings, 'globalSearch') && el('button.icon-btn.workspace-action', {
          type: 'button', html: icon('search', 18), 'aria-label': 'Поиск по всему', onclick: openPalette,
        }),
        blockEnabled(store.settings, 'notifications') && el('button.icon-btn.workspace-action.notification-button', {
          type: 'button', html: icon('alert', 18),
          'aria-label': alerts.length ? `Уведомления: ${alerts.length}` : 'Уведомления',
          onclick: openNotifications,
        }, alerts.length > 0 && el('span.notification-count', {}, alerts.length > 9 ? '9+' : String(alerts.length))),
        store.user?.role === 'admin' && el('a.btn.btn-ghost.btn-sm.workspace-control-link', { href: '#/control', 'aria-label': 'Пульт управления' },
          el('span', { html: icon('gear', 15) }), 'Пульт'),
        canWrite(store.user) && blockEnabled(store.settings, 'quickCreate') && el('button.btn.btn-primary.btn-sm.workspace-create', {
          type: 'button', onclick: openQuickAdd, 'aria-label': 'Создать запись',
        }, el('span', { html: icon('plus', 15) }), 'Создать')));
  }

  function renderRoute({ resumeScroll = false } = {}) {
    const path = routePath(location.hash);
    document.documentElement.dataset.density = workspaceOf(store.settings).density;
    if (!routeEnabled(store.settings, path)) {
      renderNav();
      renderTopbar();
      currentView?.destroy?.();
      clear(viewWrap);
      document.title = 'Раздел выключен · Авандок CRM';
      currentView = el('div.view', {}, el('div.module-disabled', {},
        el('span.module-disabled-icon', { html: icon('gear', 28) }),
        el('div.brand-kicker', {}, 'ПУЛЬТ УПРАВЛЕНИЯ'),
        el('h1', {}, 'Раздел выключен'),
        el('p', {}, 'Модуль скрыт администратором. Записи и история сохранены — их можно вернуть включением модуля.'),
        store.user?.role === 'admin'
          ? el('a.btn.btn-primary', { href: '#/control' }, 'Открыть пульт управления')
          : el('a.btn.btn-primary', { href: homeHash(store.settings) }, 'На главную')));
      viewWrap.append(currentView);
      return;
    }
    const route = routeFor(location.hash);
    // Name the page in the tab and in history, not just the app.
    document.title = route === ROUTES[0] ? 'Авандок CRM' : `${route.label} · Авандок CRM`;
    renderNav();
    renderTopbar();
    currentView?.destroy?.();
    clear(viewWrap);
    currentView = route.view({ navigate, params: paramsFor(location.hash) });
    viewWrap.append(currentView);
    const resume = (resumeScroll && scrollMemory.get(location.hash)) || 0;
    lastHash = location.hash;
    main.scrollTop = resume;
    window.scrollTo({ top: resume });
  }

  const fab = canWrite(store.user) ? el('button.fab', {
    html: icon('plus', 26, 2.2),
    'aria-label': 'Создать',
    onclick: openQuickAdd,
  }) : null;

  clear(appRoot);
  appRoot.append(
    el('div.shell', {}, sidebar, main),
    // The same status, where a phone can see it: the sidebar's copy is
    // behind the 900px breakpoint, and this one only shows below it.
    el('div.offline-floating', {}, offlineIndicator()),
    tabbar,
    ...(fab ? [fab] : [])
  );

  window.addEventListener('hashchange', () => {
    // A dialog belongs to the page it was opened from, and this is the page
    // leaving. Two ordinary moves get here with one still up: a link inside
    // the dialog (a lead chip on a follow-up in the calendar's day sheet)
    // and Back, which is how a sheet is dismissed on a phone. Either left
    // the sheet floating over a record it was never about, above a page
    // held inert until its X was found.
    closeAllModals();
    rememberScroll();
    const returning = isReturnVisit();
    if (!returning) stampEntry();
    renderRoute({ resumeScroll: returning });
    main.focus({ preventScroll: true });
  });
  installPaletteShortcut();
  renderRoute();

  // Badge counts follow the data: refresh (debounced) after any change -
  // but only when the count actually moved. Every save emits, and rebuilding
  // both navs for a count that hasn't changed threw away whichever
  // destination the keyboard was on, 400ms after an unrelated edit. The
  // rebuild that a real change does need hands focus back by the key above.
  let badgeTimer;
  store.addEventListener('change', () => {
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      if (badgeSignature() !== badgeState) keepingFocus(() => { renderNav(); renderTopbar(); })();
    }, 400);
  });
}
