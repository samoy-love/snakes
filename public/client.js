import { installErrorLogging } from './client_errors.js';
import { createAudioModule } from './client_audio.js';
import { createFxModule } from './client_fx.js';
import { createNetModule } from './client_net.js';

installErrorLogging();

const I18N_LANG_KEY = 'lang';

const I18N = {
  ru: {
    'lang.toggle': 'Сменить язык',
    'game.title': 'Змейки',
    'menu.kicker': 'Онлайн • быстрый матч',
    'menu.subtitle': 'Захватывайте территорию, избегайте следов и побеждайте',
    'menu.quick_start': 'Быстрый старт',
    'menu.nick': 'Ник',
    'menu.nick_placeholder': 'Введите ник',
    'menu.nick_random_aria': 'Случайный ник',
    'menu.nick_error_required': 'Введите ник',
    'menu.nick_error_chars': 'Только буквы, цифры, пробел, "-" и "_"',
    'menu.nick_error_length': 'Длина ника: 2–18',
    'menu.nick_random': 'Случайный',
    'menu.nick_random_prefix': 'Игрок',
    'menu.play': 'Играть',
    'menu.cosmetics': 'Косметика',
    'menu.hint': 'Совет: чат — Enter • управление — WASD/стрелки',
    'menu.online_now': 'сейчас играют',
    'menu.how_title': 'Как играть',
    'menu.how_step1': 'Выйди за свою зону',
    'menu.how_step2': 'Оставь след',
    'menu.how_step3': 'Замкни петлю — территория твоя',
    'menu.rooms_hint': 'выбрать вручную',

    'menu.controls_title': 'Управление',
    'menu.controls_desc': 'WASD/стрелки — движение • Enter — чат • Esc — меню • Space — снова (после смерти)',

    'rooms.title': 'Комнаты',
    'rooms.join': 'Войти',
    'rooms.create': 'Создать',
    'rooms.hide': 'Скрыть',
    'rooms.refresh': 'Обновить',
    'rooms.refresh_aria': 'Обновить список комнат',
    'rooms.search_placeholder': 'Поиск по названию/нику',
    'rooms.search_aria': 'Поиск комнат',
    'rooms.search_clear_aria': 'Очистить поиск',
    'rooms.sort_aria': 'Сортировка комнат',
    'rooms.sort_free': 'Свободные сверху',
    'rooms.sort_fill': 'По заполненности',
    'rooms.sort_humans': 'По онлайну',
    'rooms.sort_id': 'По номеру',
    'rooms.name': 'Название',
    'rooms.name_placeholder': 'Название комнаты',
    'rooms.create_and_join': 'Создать и войти',

    'cosmetics.kicker': 'Магазин • гардероб',
    'cosmetics.subtitle': 'Покупайте за Стиль и экипируйте — видят все',
    'cosmetics.style': 'Стиль',
    'cosmetics.preview': 'Предпросмотр',
    'cosmetics.categories_aria': 'Категории косметики',
    'cosmetics.style_info': 'Как заработать стиль',
    'cosmetics.filters_aria': 'Фильтры',
    'cosmetics.filter_all': 'Все',
    'cosmetics.filter_owned': 'Куплено',
    'cosmetics.filter_available': 'Доступно',
    'cosmetics.balance_you': 'У вас',
    'cosmetics.wear': 'Надеть',
    'cosmetics.remove': 'Снять',
    'cosmetics.not_enough': 'Не хватает стиля',
    'cosmetics.missing_prefix': 'До покупки',
    'cosmetics.empty_title': 'Ничего не найдено',
    'cosmetics.empty_desc': 'Попробуйте другой фильтр',
    'cosmetics.style_hint': 'Получайте ✨ за киллы, контракты и задания. Нажмите ⓘ для деталей.',
    'cosmetics.offline_hint': 'Данные косметики будут синхронизированы после входа в матч.',

    'death.title': 'Вы проиграли',
    'death.hint': 'Enter — снова • Esc — меню',
    'death.play_again': 'Играть снова',

    'match.title': 'Матч завершён',
    'match.hint_prefix': 'Новый матч начнётся через',
    'match.starting': 'Запускаем…',
    'match.play_on': 'Играть дальше',
    'match.rooms': 'Комнаты',
    'match.cosmetics': 'Косметика',
    'match.summary': 'Ваш результат',
    'match.victory': 'Победа',
    'match.defeat': 'Поражение',
    'match.place': 'Место',
    'match.out_of': 'из',
    'match.next_gap': 'До следующего места',
    'match.next_gap_points': 'очков',
    'match.next_gap_cells': 'клеток',
    'match.next_gap_kills': 'киллов',
    'match.reward': 'Награда',
    'match.style': 'Стиль',
    'match.contract': 'Контракт',
    'match.contract_done': 'Выполнено',
    'match.breakdown': 'Разбор начислений',
    'match.points_breakdown': 'Очки: разбор',
    'match.style_breakdown': 'Стиль: разбор',
    'match.points_kill': 'Килл',
    'match.points_revenge': 'Месть',
    'match.points_bounty': 'Баунти',
    'match.points_contract': 'Контракт',
    'match.points_daily': 'Дейлик',
    'match.points_capture': 'Захват',
    'match.autojoin': 'Автоприсоединение',
    'match.results_unavailable': 'Результаты недоступны',
    'match.player': 'Игрок',
    'match.points': 'Очки',
    'match.zone': 'Зона',
    'match.kills': 'Киллы',

    'settings.kicker': 'Настройки',
    'settings.title': 'Игровые',
    'settings.subtitle': 'Визуальные эффекты, интерфейс и звук',
    'settings.visual': 'Визуал',
    'settings.fx': 'Эффекты',
    'settings.fx_hint': 'Вспышки, частицы и небольшие эффекты в матче',
    'settings.intensity': 'Интенсивность',
    'settings.intensity_hint': 'Уменьшите, если эффекты мешают или проседает FPS',
    'settings.shake': 'Тряска',
    'settings.shake_hint': 'Сильнее — более заметная отдача/вибрация камеры',
    'settings.sound': 'Звук',
    'settings.sound_enable': 'Включить',
    'settings.volume': 'Громкость',
    'settings.volume_hint': 'Применяется к звуковым сигналам и событиям',
    'settings.mute_on_blur': 'Глушить в фоне',
    'settings.mute_on_blur_hint': 'Если переключились на другое окно — игра не будет пищать',
    'settings.test_beep': 'Проверить звук',
    'settings.reset': 'Сбросить по умолчанию',
    'settings.hud': 'HUD',
    'settings.hud_brightness': 'Яркость',
    'settings.hud_brightness_hint': 'Влияет на панели интерфейса в матче',
    'settings.hud_contrast': 'Контраст',
    'settings.hud_contrast_hint': 'Сделайте выше, если плохо читается на тёмном фоне',
    'settings.hud_panels': 'Прозрачность панелей',
    'settings.hud_panels_hint': 'Ниже — больше видно игру под панелями',
    'settings.debug': 'Отладка',
    'settings.perf_show': 'Статистика (FPS)',
    'settings.perf_hint': 'Горячая клавиша: P',
    'settings.perf_compact': 'Компактно',

    'settings.hud_density': 'Плотность HUD',
    'settings.hud_density_aria': 'Плотность HUD',
    'settings.hud_density_comfy': 'Комфортно',
    'settings.hud_density_compact': 'Компактно',

    'hud.leaders': 'Показать лидеров',
    'hud.cosmetics': 'Открыть косметику',
    'hud.settings': 'Открыть настройки',
    'hud.leave': 'Выйти в меню',
    'hud.nick_placeholder': 'Ваш ник',
    'hud.save_nick': 'Сохранить ник',
    'hud.help': 'Управление: стрелки / WASD • Чат: Enter • Карта: M',
    'hud.minimap': 'Открыть карту',
    'menu.your_look': 'Ваш облик',
    'menu.your_look_hint': 'Экипированное видят все игроки в матче',
    'hud.zone': 'Зона',

    'right.match': 'Матч',
    'right.team': 'Команда',
    'right.events': 'События',

    'right.match_empty_title': 'Нет данных',
    'right.match_empty_desc': 'Начните матч, чтобы увидеть прогресс и задания',
    'right.team_empty_title': 'Нет команды',
    'right.team_empty_desc': 'Войдите в матч, чтобы увидеть таблицу игроков',
    'right.events_empty_title': 'Тихо',
    'right.events_empty_desc': 'События появятся во время матча',

    'chat.title': 'Чат',
    'chat.status_room': 'Комната',
    'chat.status_lobby': 'Лобби',
    'chat.collapse': 'Свернуть чат',
    'chat.expand': 'Развернуть чат',
    'chat.emoji': 'Эмодзи',
    'chat.emoji_open': 'Открыть панель эмодзи',
    'chat.message_placeholder': 'Сообщение...',
    'chat.send': 'Отправить',
    'chat.emoji_search_placeholder': 'Поиск (эмодзи или код, напр. 1f602)',
    'chat.emoji_close': 'Закрыть панель эмодзи',

    'common.close': 'Закрыть',
    'common.to_menu': 'В меню',
    'common.ok': 'Ок',
    'common.error': 'Ошибка',

    'net.connecting': 'Соединение…',
    'net.reconnecting': 'Переподключение…',
    'net.offline': 'Нет соединения',
    'net.rejoin_hint': 'Не выходи — вернём в матч сами.',
    'net.rejoined': 'Снова в матче',

    'death.reason_prefix': 'Причина',
    'death.killed_by': 'Вас убил',
    'death.reason.cut': 'перерезал след',
    'death.reason.headon': 'лобовое',
    'death.reason.selftrail': 'врезались в свой след',
    'death.reason.wall': 'в стену',

    'hud.objective': 'Цель',
    'hud.objective_capture': 'захват территории',

    'meta.details': 'Детали',
    'meta.fight': 'Бой',
    'meta.tasks': 'Задания',

    'rooms.invalid_title': 'Некорректное название',
    'rooms.full': 'Комната заполнена',
    'rooms.not_found': 'Комната не найдена',
    'rooms.timeout': 'Таймаут запроса',
    'rooms.loading': 'Обновляем…',
    'rooms.empty': 'Комнат нет',
    'rooms.list_aria': 'Список комнат',
    'rooms.room': 'Комната',
    'rooms.empty_loading_title': 'Обновляем список…',
    'rooms.empty_loading_desc': 'Пожалуйста, подождите',
    'rooms.empty_error_title': 'Не удалось загрузить комнаты',
    'rooms.empty_error_desc': 'Попробуйте ещё раз',
    'rooms.retry': 'Повторить',
    'rooms.empty_no_match_title': 'Ничего не найдено',
    'rooms.empty_no_match_desc': 'Измените запрос или создайте свою комнату',
    'rooms.reset_search': 'Сбросить поиск',
    'rooms.create_room': 'Создать комнату',
    'rooms.empty_none_title': 'Комнат пока нет',
    'rooms.empty_none_desc': 'Создайте комнату и пригласите друзей',
    'rooms.stats_prefix': 'Комнат',
    'rooms.stats_online': 'Онлайн',

    'leaderboard.player': 'Игрок',
    'leaderboard.cells': 'Очки • Клетки',
    'leaderboard.share': 'Доля',

    'death.your_result': 'Ваш результат',
    'death.place': 'Место',
    'death.points': 'Очки',
    'death.zone': 'Зона',
    'death.kills': 'Киллы',
    'death.contract': 'Контракт',
    'death.top': 'Топ-5',
    'death.top1': 'Топ‑1! Отличная игра.',
    'death.try_again': 'Ещё попытка — и будет лучше.',

    'cosmetics.earn_title': 'Как заработать стиль',
    'cosmetics.earn_kills': 'Киллы',
    'cosmetics.earn_kills_desc': '✨ за убийства',
    'cosmetics.earn_revenge': 'Месть',
    'cosmetics.earn_revenge_desc': '✨ за килл в ответ',
    'cosmetics.earn_contracts': 'Контракты',
    'cosmetics.earn_contracts_desc': '✨ за выполнение',
    'cosmetics.earn_dailies': 'Дейлики',
    'cosmetics.earn_dailies_desc': '✨ за выполнение',
    'cosmetics.earn_bounty': 'Баунти',
    'cosmetics.earn_bounty_desc': '✨ за награду',
    'cosmetics.cat_frame': 'Рамки',
    'cosmetics.cat_nameplate': 'Имя',
    'cosmetics.cat_head': 'Голова',
    'cosmetics.cat_seg': 'Сегменты',
    'cosmetics.cat_capturefx': 'Захват',
    'cosmetics.item_equipped': 'Экипировано',
    'cosmetics.item_owned': 'Куплено',
    'cosmetics.item_not_owned': 'Не куплено',
    'cosmetics.buy': 'Купить',
    'cosmetics.equip': 'Экипировать',
    'cosmetics.style_points': 'стиль',
    'cosmetics.err_invalid_id': 'Некорректный предмет',
    'cosmetics.err_invalid_cat': 'Некорректная категория',
    'cosmetics.err_not_owned': 'Сначала купите предмет',
    'cosmetics.err_not_enough_style': 'Недостаточно стиля',
    'cosmetics.err_unavailable': 'Магазин временно недоступен',
    'cosmetics.not_enough_short': 'Не хватает',
    'cosmetics.item_owned_unconfirmed': 'Куплено (не подтверждено)',
    'cosmetics.unconfirmed_hint': 'Данные не подтверждены сервером. Покупка будет доступна после подключения.',
    'cosmetics.no_connection': 'Нет связи с сервером — покупки недоступны',
    'cosmetics.op_pending': 'Отправляем запрос…',
    'cosmetics.op_timeout': 'Сервер не ответил, попробуйте ещё раз',
    'cosmetics.bought_prefix': 'Куплено',
    'cosmetics.desired_not_applied': 'Не удалось надеть сохранённый предмет: его нет на аккаунте',

    'perf.room': 'Комната',
    'perf.fps': 'FPS',
    'perf.ping': 'Пинг',
    'perf.traffic': 'Трафик',
    'perf.ticks': 'Тики',
    'perf.server': 'сервер',

    'toast.streak': 'Серия',
    'toast.streak_3': 'Три убийства подряд',
    'toast.streak_5': 'Пять убийств подряд',
    'toast.bounty_desc': 'Убив цель, получите бонус очков',
    'toast.bounty_claim_title': 'Награда получена',
    'toast.bounty_claim_desc': 'Бонус очков за убийство цели',
    'toast.powerup_used': 'Использовано',

    'event.streak': 'серия',
    'event.bounty': 'НАГРАДА',
    'event.bounty_claimed': 'НАГРАДА ПОЛУЧЕНА',
    'event.round': 'РАУНД',
    'event.picked': 'поднял',
    'event.used': 'использовал',

    'meta.kills': 'Киллы',
    'meta.streak': 'Серия',
    'meta.until_end': 'До конца',

    'minimap.title': 'Миникарта',
    'minimap.expand': 'Увеличить миникарту',
    'minimap.overlay_aria': 'Увеличенная миникарта',
    'minimap.legend_you': 'Вы',
    'minimap.legend_view': 'Обзор',
    'minimap.legend_zone': 'Зона',

    'settings.fx_preset': 'Пресет эффектов',
    'settings.fx_preset_hint': 'Управляет тряской, вспышками, частицами и счётчиками. «Спокойно» включается автоматически при системном запрете анимаций.',
    'settings.fx_preset_calm': 'Спокойно',
    'settings.fx_preset_normal': 'Обычно',
    'settings.fx_preset_casino': 'Казино',

    'hud.combo': 'Комбо',
    'hud.trail_len': 'След',
    'hud.time_left': 'До конца',
    'hud.place_short': 'Место',
    'hud.points_short': 'Очки',
    'lb.player': 'Игрок',

    'banner.first_capture': 'Первый захват!',
    'banner.first_capture_sub': 'Замкнул петлю — территория твоя. Так и набирают зону.',
    'banner.jackpot': 'ДЖЕКПОТ',
    'banner.jackpot_sub': 'Огромный захват территории',
    'banner.revenge': 'МЕСТЬ',
    'banner.streak': 'СЕРИЯ',

    'death.hint.cut': 'Твой след пересекли. Пока петля не замкнута, след уязвим — возвращайся в свою зону, чтобы забрать территорию.',
    'death.hint.headon': 'Лобовое столкновение. Не иди в голову чужой змейке — выживает тот, кто свернул.',
    'death.hint.selftrail': 'Ты въехал в собственный след. Замыкай петлю только о свою территорию.',
    'death.hint.wall': 'Ты врезался в границу поля. Край карты убивает так же, как чужой след.',
    'death.hint.generic': 'Выйди из своей зоны, обведи участок и вернись в свою территорию — петля замкнётся и участок станет твоим.',

    'onb.return_here': 'Вернись сюда',
    'onb.bonus_title': 'Бонусы на поле',
    'onb.bonus_desc': 'Кружки на карте дают щит и ускорение. Подбирай их по дороге домой.',
    'onb.contract_title': 'Контракт',
    'onb.contract_desc': 'Небольшая задача в углу экрана. Выполнил — получил ✨ Стиль.',
    'onb.bounty_title': 'Убийства и награда',
    'onb.bounty_desc': 'Пересеки чужой след — и он погибнет. За голову с меткой 🎯 дают больше очков.',
    'onb.shop_title': 'Магазин открыт',
    'onb.shop_desc': 'Копи ✨ Стиль и меняй его на внешний вид змейки.',

    'reclaim.hint': 'Твоя земля остывает 20 секунд — успей вернуться и забрать её обратно.',
    'reclaim.toast': 'Земля возвращена',
    'reclaim.toast_desc': 'Ты успел вернуться до конца остывания.',

    'match.peak': 'Пик зоны',
    'match.avg': 'Средняя',
    'match.deaths': 'Смерти',
    'match.first_skin': 'До первого скина',
    'match.first_skin_sub': 'Копи ✨ Стиль и открой первый предмет в магазине',

    'cosmetics.where_frame': 'Рамка строки — в таблице лидеров и в итогах матча',
    'cosmetics.where_nameplate': 'Плашка ника — под вашей головой на поле, её видят все',
    'cosmetics.where_head': 'Силуэт головы — на поле и на миникарте, в бою и в превью',
    'cosmetics.where_seg': 'Стиль следа — виден, пока вы вне своей территории',
    'cosmetics.where_capturefx': 'Вспышка захвата — в момент, когда след замыкается в зону',
    'cosmetics.where_terr': 'Заливка территории — вся ваша зона на поле, самая большая вещь на экране',
    'cosmetics.where_death': 'Эффект гибели — на месте вашей смерти, его видят все вокруг',
    'cosmetics.where_title': 'Титул — перед ником в плашке, в таблице лидеров и в итогах матча',

    'cosmetics.cat_terr': 'Территория',
    'cosmetics.cat_death': 'Гибель',
    'cosmetics.cat_title': 'Титулы',

    'cosmetics.title_none': 'Без титула',
    'cosmetics.title_locked': 'Ещё не открыт',
    'cosmetics.title_unlocked': 'Открыт',
    'cosmetics.title_equipped': 'Надет',
    'cosmetics.title_req_prefix': 'Как получить',
    'cosmetics.title_free_hint': 'Титулы не продаются — их выдают за достижения',
    'cosmetics.title_earned_for': 'Получен за',
    'cosmetics.title_none_desc': 'Ник показывается без титула',
    'cosmetics.titles_unavailable': 'Список титулов появится после входа в матч',

    'cosmetics.tier_base': 'База',
    'cosmetics.tier_common': 'Обычный',
    'cosmetics.tier_rare': 'Редкий',
    'cosmetics.tier_epic': 'Эпический',
    'cosmetics.tier_legendary': 'Легендарный',
    'cosmetics.tier_mythic': 'Мифический',
    'cosmetics.locked': 'Заблокировано'
  },
  en: {
    'lang.toggle': 'Switch language',
    'game.title': 'Snakes',
    'menu.kicker': 'Online • quick match',
    'menu.subtitle': 'Capture territory, avoid trails, and win',
    'menu.quick_start': 'Quick start',
    'menu.nick': 'Nickname',
    'menu.nick_placeholder': 'Enter nickname',
    'menu.nick_random_aria': 'Random nickname',
    'menu.nick_error_required': 'Enter a nickname',
    'menu.nick_error_chars': 'Use letters, digits, space, "-" and "_" only',
    'menu.nick_error_length': 'Nickname length: 2–18',
    'menu.nick_random': 'Random',
    'menu.nick_random_prefix': 'Player',
    'menu.play': 'Play',
    'menu.cosmetics': 'Cosmetics',
    'menu.hint': 'Tip: chat — Enter • movement — WASD/arrows',
    'menu.online_now': 'playing now',
    'menu.how_title': 'How to play',
    'menu.how_step1': 'Leave your zone',
    'menu.how_step2': 'Draw a trail',
    'menu.how_step3': 'Close the loop — the land is yours',
    'menu.rooms_hint': 'pick manually',

    'menu.controls_title': 'Controls',
    'menu.controls_desc': 'WASD/arrows — move • Enter — chat • Esc — menu • Space — retry (after death)',

    'rooms.title': 'Rooms',
    'rooms.join': 'Join',
    'rooms.create': 'Create',
    'rooms.hide': 'Hide',
    'rooms.refresh': 'Refresh',
    'rooms.refresh_aria': 'Refresh room list',
    'rooms.search_placeholder': 'Search by title/nickname',
    'rooms.search_aria': 'Search rooms',
    'rooms.search_clear_aria': 'Clear search',
    'rooms.sort_aria': 'Sort rooms',
    'rooms.sort_free': 'Free first',
    'rooms.sort_fill': 'By fullness',
    'rooms.sort_humans': 'By online',
    'rooms.sort_id': 'By number',
    'rooms.name': 'Title',
    'rooms.name_placeholder': 'Room title',
    'rooms.create_and_join': 'Create & join',

    'cosmetics.kicker': 'Shop • wardrobe',
    'cosmetics.subtitle': 'Buy with Style and equip — everyone sees it',
    'cosmetics.style': 'Style',
    'cosmetics.preview': 'Preview',
    'cosmetics.categories_aria': 'Cosmetics categories',
    'cosmetics.style_info': 'How to earn Style',
    'cosmetics.filters_aria': 'Filters',
    'cosmetics.filter_all': 'All',
    'cosmetics.filter_owned': 'Owned',
    'cosmetics.filter_available': 'Affordable',
    'cosmetics.balance_you': 'You',
    'cosmetics.wear': 'Wear',
    'cosmetics.remove': 'Remove',
    'cosmetics.not_enough': 'Not enough Style',
    'cosmetics.missing_prefix': 'Need',
    'cosmetics.style_points': 'Style',
    'cosmetics.cat_capturefx': 'Capture',
    'cosmetics.item_equipped': 'Equipped',
    'cosmetics.empty_title': 'Nothing found',
    'cosmetics.empty_desc': 'Try another filter',
    'cosmetics.err_invalid_id': 'Invalid item',
    'cosmetics.err_invalid_cat': 'Invalid category',
    'cosmetics.err_not_owned': 'Buy it first',
    'cosmetics.err_not_enough_style': 'Not enough Style',
    'cosmetics.err_unavailable': 'Shop temporarily unavailable',
    'cosmetics.buy': 'Buy',
    'cosmetics.equip': 'Equip',
    'cosmetics.item_owned': 'Owned',
    'cosmetics.item_not_owned': 'Not owned',
    'cosmetics.not_enough_short': 'Need',
    'cosmetics.item_owned_unconfirmed': 'Owned (unconfirmed)',
    'cosmetics.unconfirmed_hint': 'Not confirmed by the server yet. Purchases unlock once connected.',
    'cosmetics.no_connection': 'No server connection — purchases unavailable',
    'cosmetics.op_pending': 'Sending request…',
    'cosmetics.op_timeout': 'Server did not respond, please try again',
    'cosmetics.bought_prefix': 'Purchased',
    'cosmetics.desired_not_applied': 'Could not equip the saved item: it is not on your account',
    'cosmetics.style_hint': 'Earn ✨ from kills, contracts and tasks. Press ⓘ for details.',
    'cosmetics.offline_hint': 'Cosmetics data will sync after you enter a match.',

    'death.title': 'You lost',
    'death.hint': 'Enter — again • Esc — menu',
    'death.play_again': 'Play again',

    'match.title': 'Match finished',
    'match.hint_prefix': 'New match starts in',
    'match.starting': 'Starting…',
    'match.play_on': 'Keep playing',
    'match.rooms': 'Rooms',
    'match.cosmetics': 'Cosmetics',
    'match.summary': 'Your result',
    'match.victory': 'Victory',
    'match.defeat': 'Defeat',
    'match.place': 'Place',
    'match.out_of': 'of',
    'match.next_gap': 'To next place',
    'match.next_gap_points': 'points',
    'match.next_gap_cells': 'cells',
    'match.next_gap_kills': 'kills',
    'match.reward': 'Reward',
    'match.style': 'Style',
    'match.contract': 'Contract',
    'match.contract_done': 'Completed',
    'match.breakdown': 'Breakdown',
    'match.points_breakdown': 'Points breakdown',
    'match.style_breakdown': 'Style breakdown',
    'match.points_kill': 'Kill',
    'match.points_revenge': 'Revenge',
    'match.points_bounty': 'Bounty',
    'match.points_contract': 'Contract',
    'match.points_daily': 'Daily',
    'match.points_capture': 'Capture',
    'match.autojoin': 'Auto-join',
    'match.results_unavailable': 'Results unavailable',
    'match.player': 'Player',
    'match.points': 'Points',
    'match.zone': 'Zone',
    'match.kills': 'Kills',

    'settings.kicker': 'Settings',
    'settings.title': 'Game',
    'settings.subtitle': 'Visual effects, UI and sound',
    'settings.visual': 'Visuals',
    'settings.fx': 'Effects',
    'settings.fx_hint': 'Flashes, particles and small match effects',
    'settings.intensity': 'Intensity',
    'settings.intensity_hint': 'Lower it if effects distract you or FPS drops',
    'settings.shake': 'Shake',
    'settings.shake_hint': 'Higher — more noticeable recoil/camera shake',
    'settings.sound': 'Sound',
    'settings.sound_enable': 'Enable',
    'settings.volume': 'Volume',
    'settings.volume_hint': 'Applies to beeps and event sounds',
    'settings.mute_on_blur': 'Mute in background',
    'settings.mute_on_blur_hint': "When you switch tabs/windows — the game won't beep",
    'settings.test_beep': 'Test sound',
    'settings.reset': 'Reset defaults',
    'settings.hud': 'HUD',
    'settings.hud_brightness': 'Brightness',
    'settings.hud_brightness_hint': 'Affects match UI panels',
    'settings.hud_contrast': 'Contrast',
    'settings.hud_contrast_hint': 'Increase if it is hard to read on dark backgrounds',
    'settings.hud_panels': 'Panel opacity',
    'settings.hud_panels_hint': 'Lower means more of the game is visible under panels',
    'settings.debug': 'Debug',
    'settings.perf_show': 'Stats (FPS)',
    'settings.perf_hint': 'Hotkey: P',
    'settings.perf_compact': 'Compact',
    'settings.hud_density': 'HUD density',
    'settings.hud_density_aria': 'HUD density',
    'settings.hud_density_comfy': 'Comfy',
    'settings.hud_density_compact': 'Compact',

    'hud.leaders': 'Show leaders',
    'hud.cosmetics': 'Open cosmetics',
    'hud.settings': 'Open settings',
    'hud.leave': 'Back to menu',
    'hud.nick_placeholder': 'Your name',
    'hud.save_nick': 'Save name',
    'hud.help': 'Move: arrows / WASD • Chat: Enter • Map: M',
    'hud.minimap': 'Open map',
    'menu.your_look': 'Your look',
    'menu.your_look_hint': 'Everyone in the match sees what you equip',
    'hud.zone': 'Zone',

    'right.match': 'Match',
    'right.team': 'Team',
    'right.events': 'Events',

    'right.match_empty_title': 'No data',
    'right.match_empty_desc': 'Start a match to see progress and tasks',
    'right.team_empty_title': 'No team',
    'right.team_empty_desc': 'Join a match to see the player table',
    'right.events_empty_title': 'Quiet',
    'right.events_empty_desc': 'Events will appear during the match',

    'chat.title': 'Chat',
    'chat.status_room': 'Room',
    'chat.status_lobby': 'Lobby',
    'chat.collapse': 'Collapse chat',
    'chat.expand': 'Expand chat',
    'chat.emoji': 'Emoji',
    'chat.emoji_open': 'Open emoji panel',
    'chat.message_placeholder': 'Message...',
    'chat.send': 'Send',
    'chat.emoji_search_placeholder': 'Search (emoji or code, e.g. 1f602)',
    'chat.emoji_close': 'Close emoji panel',

    'common.close': 'Close',
    'common.to_menu': 'Menu',
    'common.ok': 'OK',
    'common.error': 'Error',

    'net.connecting': 'Connecting…',
    'net.reconnecting': 'Reconnecting…',
    'net.offline': 'Offline',
    'net.rejoin_hint': 'Stay put — we will put you back in the match.',
    'net.rejoined': 'Back in the match',

    'death.reason_prefix': 'Reason',
    'death.killed_by': 'Killed by',
    'death.reason.cut': 'cut your trail',
    'death.reason.headon': 'head-on',
    'death.reason.selftrail': 'hit your own trail',
    'death.reason.wall': 'hit a wall',

    'hud.objective': 'Objective',
    'hud.objective_capture': 'capture territory',

    'meta.details': 'Details',
    'meta.fight': 'Fight',
    'meta.tasks': 'Tasks',

    'rooms.invalid_title': 'Invalid title',
    'rooms.full': 'Room is full',
    'rooms.not_found': 'Room not found',
    'rooms.timeout': 'Request timeout',
    'rooms.loading': 'Refreshing…',
    'rooms.empty': 'No rooms',
    'rooms.list_aria': 'Room list',
    'rooms.room': 'Room',
    'rooms.empty_loading_title': 'Refreshing…',
    'rooms.empty_loading_desc': 'Please wait',
    'rooms.empty_error_title': 'Failed to load rooms',
    'rooms.empty_error_desc': 'Try again',
    'rooms.retry': 'Retry',
    'rooms.empty_no_match_title': 'Nothing found',
    'rooms.empty_no_match_desc': 'Change the query or create a room',
    'rooms.reset_search': 'Reset search',
    'rooms.create_room': 'Create room',
    'rooms.empty_none_title': 'No rooms yet',
    'rooms.empty_none_desc': 'Create a room and invite friends',
    'rooms.stats_prefix': 'Rooms',
    'rooms.stats_online': 'Online',

    'leaderboard.player': 'Player',
    'leaderboard.cells': 'Points • Cells',
    'leaderboard.share': 'Share',

    'death.your_result': 'Your result',
    'death.place': 'Place',
    'death.points': 'Points',
    'death.zone': 'Zone',
    'death.kills': 'Kills',
    'death.contract': 'Contract',
    'death.top': 'Top 5',
    'death.top1': 'Top-1! Great game.',
    'death.try_again': 'One more try — you can do better.',

    'cosmetics.earn_title': 'How to earn Style',
    'cosmetics.earn_kills': 'Kills',
    'cosmetics.earn_kills_desc': '✨ for kills',
    'cosmetics.earn_revenge': 'Revenge',
    'cosmetics.earn_revenge_desc': '✨ for return kill',
    'cosmetics.earn_contracts': 'Contracts',
    'cosmetics.earn_contracts_desc': '✨ for completing',
    'cosmetics.earn_dailies': 'Dailies',
    'cosmetics.earn_dailies_desc': '✨ for completing',
    'cosmetics.earn_bounty': 'Bounty',
    'cosmetics.earn_bounty_desc': '✨ for bounty',
    'cosmetics.cat_frame': 'Frames',
    'cosmetics.cat_nameplate': 'Name',
    'cosmetics.cat_head': 'Head',
    'cosmetics.cat_seg': 'Segments',
    'perf.room': 'Room',
    'perf.fps': 'FPS',
    'perf.ping': 'Ping',
    'perf.traffic': 'Traffic',
    'perf.ticks': 'Ticks',
    'perf.server': 'server',

    'toast.streak': 'Streak',
    'toast.streak_3': 'Three kills in a row',
    'toast.streak_5': 'Five kills in a row',
    'toast.bounty_desc': 'Kill the target to get bonus points',
    'toast.bounty_claim_title': 'Bounty claimed',
    'toast.bounty_claim_desc': 'Bonus points for killing the target',
    'toast.powerup_used': 'Used',

    'event.streak': 'streak',
    'event.bounty': 'BOUNTY',
    'event.bounty_claimed': 'BOUNTY CLAIMED',
    'event.round': 'ROUND',
    'event.picked': 'picked up',
    'event.used': 'used',

    'meta.kills': 'Kills',
    'meta.streak': 'Streak',
    'meta.until_end': 'Time left',

    'minimap.title': 'Minimap',
    'minimap.expand': 'Expand minimap',
    'minimap.overlay_aria': 'Expanded minimap',
    'minimap.legend_you': 'You',
    'minimap.legend_view': 'View',
    'minimap.legend_zone': 'Zone',

    'settings.fx_preset': 'Effects preset',
    'settings.fx_preset_hint': 'Controls shake, flashes, particles and count-ups. "Calm" turns on automatically when the system asks for reduced motion.',
    'settings.fx_preset_calm': 'Calm',
    'settings.fx_preset_normal': 'Normal',
    'settings.fx_preset_casino': 'Casino',

    'hud.combo': 'Combo',
    'hud.trail_len': 'Trail',
    'hud.time_left': 'Time left',
    'hud.place_short': 'Place',
    'hud.points_short': 'Points',
    'lb.player': 'Player',

    'banner.first_capture': 'First capture!',
    'banner.first_capture_sub': 'You closed the loop — the land is yours. That is how you grow.',
    'banner.jackpot': 'JACKPOT',
    'banner.jackpot_sub': 'A massive land grab',
    'banner.revenge': 'REVENGE',
    'banner.streak': 'STREAK',

    'death.hint.cut': 'Your trail was cut. Until the loop is closed the trail is vulnerable — get back into your own zone to bank the land.',
    'death.hint.headon': 'Head-on collision. Never drive into another head — the one who turns away survives.',
    'death.hint.selftrail': 'You ran into your own trail. Close the loop against your own territory only.',
    'death.hint.wall': 'You hit the map border. The edge kills just like an enemy trail.',
    'death.hint.generic': 'Leave your zone, draw a loop around some land and come back into your territory — the loop closes and the land becomes yours.',

    'onb.return_here': 'Come back here',
    'onb.bonus_title': 'Pickups on the field',
    'onb.bonus_desc': 'The circles give you a shield or a dash. Grab them on your way home.',
    'onb.contract_title': 'Contract',
    'onb.contract_desc': 'A small task in the corner of the screen. Finish it and earn ✨ Style.',
    'onb.bounty_title': 'Kills and bounty',
    'onb.bounty_desc': 'Cross an enemy trail and they die. The head marked 🎯 is worth extra points.',
    'onb.shop_title': 'Shop unlocked',
    'onb.shop_desc': 'Bank ✨ Style and spend it on the look of your snake.',

    'reclaim.hint': 'Your land stays warm for 20 seconds — get back in time and take it back.',
    'reclaim.toast': 'Land reclaimed',
    'reclaim.toast_desc': 'You made it back before the land cooled down.',

    'match.peak': 'Peak zone',
    'match.avg': 'Average',
    'match.deaths': 'Deaths',
    'match.first_skin': 'To your first skin',
    'match.first_skin_sub': 'Bank ✨ Style and unlock your first shop item',

    'cosmetics.where_frame': 'Row frame — in the leaderboard and the match results',
    'cosmetics.where_nameplate': 'Name plate — under your head on the field, visible to everyone',
    'cosmetics.where_head': 'Head silhouette — on the field and the minimap, in every fight',
    'cosmetics.where_seg': 'Trail style — visible while you are outside your own territory',
    'cosmetics.where_capturefx': 'Capture burst — the moment your trail closes into territory',
    'cosmetics.where_terr': 'Territory fill — your whole zone, the largest thing on screen',
    'cosmetics.where_death': 'Death effect — at the spot where you die, everyone nearby sees it',
    'cosmetics.where_title': 'Title — before your nick on the plate, leaderboard and match results',

    'cosmetics.cat_terr': 'Territory',
    'cosmetics.cat_death': 'Death',
    'cosmetics.cat_title': 'Titles',

    'cosmetics.title_none': 'No title',
    'cosmetics.title_locked': 'Not unlocked yet',
    'cosmetics.title_unlocked': 'Unlocked',
    'cosmetics.title_equipped': 'Worn',
    'cosmetics.title_req_prefix': 'How to unlock',
    'cosmetics.title_free_hint': 'Titles are not for sale — they are earned through achievements',
    'cosmetics.title_earned_for': 'Earned for',
    'cosmetics.title_none_desc': 'Your nick is shown without a title',
    'cosmetics.titles_unavailable': 'The title list appears once you join a match',

    'cosmetics.tier_base': 'Base',
    'cosmetics.tier_common': 'Common',
    'cosmetics.tier_rare': 'Rare',
    'cosmetics.tier_epic': 'Epic',
    'cosmetics.tier_legendary': 'Legendary',
    'cosmetics.tier_mythic': 'Mythic',
    'cosmetics.locked': 'Locked'
  }
};

const MINIMAP_ZONE_REFRESH_MIN_MS = 14000;
const MINIMAP_ZONE_REFRESH_MAX_MS = 24000;

const MINIMAP_TOP1_SWITCH_COOLDOWN_MS = 4500;

const MINIMAP_ZONE_ICON_TOP1 = '👑';
const MINIMAP_ZONE_ICON_BOUNTY = '🎯';

let minimapTop1Zone = null;
let minimapBountyZone = null;

let minimapTop1PinnedId = 0;
let minimapTop1NextSwitchAt = 0;
let minimapLastBountyTarget = 0;

function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v) || 0);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function minimapZoneRadiusCells() {
  const base = Math.round(Math.min(W, H) * 0.085);
  return clampInt(base, 28, 90);
}

function rndDisk(r) {
  const a = Math.random() * Math.PI * 2;
  const rr = Math.sqrt(Math.random()) * r;
  return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
}

function scheduleNextZoneUpdate(now) {
  const span = MINIMAP_ZONE_REFRESH_MAX_MS - MINIMAP_ZONE_REFRESH_MIN_MS;
  return now + MINIMAP_ZONE_REFRESH_MIN_MS + Math.random() * Math.max(0, span);
}

function ensureZoneState(prev, pid, px, py, now) {
  const r = minimapZoneRadiusCells();

  let needUpdate = !prev || prev.pid !== pid || prev.r !== r;
  if (!needUpdate) {
    if (now >= (prev.nextAt || 0)) needUpdate = true;
  }

  if (!needUpdate) return prev;

  const off = rndDisk(r * 0.85);
  const cx = clampInt((Number(px) || 0) + off.x, 0, Math.max(0, W - 1));
  const cy = clampInt((Number(py) || 0) + off.y, 0, Math.max(0, H - 1));
  return {
    pid,
    r,
    cx,
    cy,
    trueX: Number(px) || 0,
    trueY: Number(py) || 0,
    nextAt: scheduleNextZoneUpdate(now)
  };
}

function drawZoneCircle(cx, cy, r, stroke, fill, icon) {
  if (cx < 0 || cy < 0 || cx >= W || cy >= H) return;

  mmCtx.save();
  mmCtx.beginPath();
  mmCtx.arc(cx + 0.5, cy + 0.5, r, 0, Math.PI * 2);
  mmCtx.fillStyle = fill;
  mmCtx.fill();
  mmCtx.strokeStyle = stroke;
  mmCtx.lineWidth = 2;
  mmCtx.stroke();

  if (icon) {
    mmCtx.font = '8px ui-sans-serif, system-ui, sans-serif';
    mmCtx.textAlign = 'center';
    mmCtx.textBaseline = 'middle';
    mmCtx.fillStyle = 'rgba(0,0,0,0.70)';
    mmCtx.fillText(icon, cx + 1.0, cy + 1.0);
    mmCtx.fillStyle = 'rgba(255,255,255,0.92)';
    mmCtx.fillText(icon, cx + 0.5, cy + 0.5);
  }

  mmCtx.restore();
}

function drawMinimapZones() {
  if (!lastState?.players?.length) return;
  const now = performance.now();

  const ordered = computeTopSorted(lastState.players);
  const candidateTop1 = ordered.find((p) => p && p.a) || null;
  if (!candidateTop1) {
    minimapTop1PinnedId = 0;
    minimapTop1NextSwitchAt = 0;
    minimapTop1Zone = null;
  } else {
    if (!minimapTop1PinnedId) {
      minimapTop1PinnedId = candidateTop1.n;
      minimapTop1NextSwitchAt = now + MINIMAP_TOP1_SWITCH_COOLDOWN_MS;
    }

    const pinned = lastState.players.find((p) => p && p.a && p.n === minimapTop1PinnedId) || null;
    if (!pinned) {
      minimapTop1PinnedId = candidateTop1.n;
      minimapTop1NextSwitchAt = now + MINIMAP_TOP1_SWITCH_COOLDOWN_MS;
      minimapTop1Zone = ensureZoneState(minimapTop1Zone, candidateTop1.n, candidateTop1.x, candidateTop1.y, now);
    } else if (candidateTop1.n === minimapTop1PinnedId) {
      minimapTop1Zone = ensureZoneState(minimapTop1Zone, pinned.n, pinned.x, pinned.y, now);
    } else {
      if (now >= minimapTop1NextSwitchAt) {
        minimapTop1PinnedId = candidateTop1.n;
        minimapTop1NextSwitchAt = now + MINIMAP_TOP1_SWITCH_COOLDOWN_MS;
        minimapTop1Zone = ensureZoneState(minimapTop1Zone, candidateTop1.n, candidateTop1.x, candidateTop1.y, now);
      } else {
        minimapTop1Zone = ensureZoneState(minimapTop1Zone, pinned.n, pinned.x, pinned.y, now);
      }
    }
  }

  const btId = Number(bountyTarget) || 0;
  if (btId !== (minimapLastBountyTarget || 0)) {
    minimapLastBountyTarget = btId;
    minimapBountyZone = null;
  }

  if (btId) {
    const bt = lastState.players.find((p) => p && p.n === btId) || null;
    if (!bt || !bt.a) {
      minimapBountyZone = null;
    } else {
      minimapBountyZone = ensureZoneState(minimapBountyZone, bt.n, bt.x, bt.y, now);
    }
  } else {
    minimapBountyZone = null;
  }

  if (minimapTop1Zone && minimapBountyZone && minimapTop1Zone.pid === minimapBountyZone.pid) {
    minimapTop1Zone = null;
  }

  if (minimapTop1Zone) {
    drawZoneCircle(
      minimapTop1Zone.cx,
      minimapTop1Zone.cy,
      minimapTop1Zone.r,
      'rgba(255, 215, 0, 0.35)',
      'rgba(255, 215, 0, 0.05)',
      MINIMAP_ZONE_ICON_TOP1
    );
  }
  if (minimapBountyZone) {
    drawZoneCircle(
      minimapBountyZone.cx,
      minimapBountyZone.cy,
      minimapBountyZone.r,
      'rgba(255, 59, 48, 0.35)',
      'rgba(255, 59, 48, 0.06)',
      MINIMAP_ZONE_ICON_BOUNTY
    );
  }
}

const HUD_DENSITY_KEY = 'hudDensity';

function infoPack() {
  return lang === 'en' ? EN : RU;
}

function getLangDefault() {
  try {
    const raw = localStorage.getItem(I18N_LANG_KEY);
    if (raw === 'ru' || raw === 'en') return raw;
  } catch {}
  return 'ru';
}

let lang = getLangDefault();

// Legacy local-only id. It is NOT sent to the server anymore (A1: signed tokens).
const PROFILE_ID_KEY = 'snakes_profile_id_v1';
let profileId = '';

const PROFILE_TOKEN_KEY = 'snakes_profile_token_v1';
let profileToken = '';

function getProfileToken() {
  if (profileToken) return profileToken;
  try {
    const cached = localStorage.getItem(PROFILE_TOKEN_KEY);
    if (cached && typeof cached === 'string' && cached.length >= 8 && cached.length <= 1024) {
      profileToken = cached;
    }
  } catch {}
  return profileToken;
}

function setProfileToken(tok) {
  const s = typeof tok === 'string' ? tok.trim() : '';
  if (!s || s.length > 1024) return;
  profileToken = s;
  try {
    localStorage.setItem(PROFILE_TOKEN_KEY, s);
  } catch {}
}

function ensureProfileId() {
  if (profileId) return profileId;
  try {
    const cached = localStorage.getItem(PROFILE_ID_KEY);
    if (cached && typeof cached === 'string' && cached.length >= 16 && cached.length <= 64) {
      profileId = cached;
      return profileId;
    }
  } catch {}

  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  try {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length; i++) out += alphabet[buf[i] % alphabet.length];
  } catch {
    out = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }
  if (out.length < 16) out = out.padEnd(16, '0');
  if (out.length > 64) out = out.slice(0, 64);

  profileId = out;
  try {
    localStorage.setItem(PROFILE_ID_KEY, profileId);
  } catch {}
  return profileId;
}

function t(key) {
  const k = String(key || '');
  const pack = I18N[lang] || I18N.ru;
  return pack[k] ?? I18N.ru[k] ?? k;
}

function numberLocale() {
  return lang === 'en' ? 'en-US' : 'ru-RU';
}

function formatNumber(value, options) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  try {
    return new Intl.NumberFormat(numberLocale(), options || {}).format(n);
  } catch {
    return String(n);
  }
}

function pluralRu(n, one, few, many) {
  const x = Math.abs(Number(n) || 0);
  const mod10 = x % 10;
  const mod100 = x % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function pluralEn(n, one, many) {
  const x = Math.abs(Number(n) || 0);
  return x === 1 ? one : many;
}

function plural(n, forms) {
  const x = Math.abs(Number(n) || 0);
  if (!forms || typeof forms !== 'object') return '';
  if (lang === 'en') return pluralEn(x, forms.one || '', forms.many || forms.other || forms.one || '');
  return pluralRu(x, forms.one || '', forms.few || forms.many || '', forms.many || forms.few || '');
}

function applyTranslations(root) {
  const r = root || document;
  try {
    document.documentElement.setAttribute('lang', lang);
  } catch {}

  const setText = (el, key) => {
    if (!el) return;
    const v = t(key);
    if (el.textContent !== v) el.textContent = v;
  };

  for (const el of r.querySelectorAll('[data-i18n]')) {
    setText(el, el.getAttribute('data-i18n'));
  }
  for (const el of r.querySelectorAll('[data-i18n-placeholder]')) {
    const v = t(el.getAttribute('data-i18n-placeholder'));
    if (el.getAttribute('placeholder') !== v) el.setAttribute('placeholder', v);
  }
  for (const el of r.querySelectorAll('[data-i18n-title]')) {
    const v = t(el.getAttribute('data-i18n-title'));
    if (el.getAttribute('title') !== v) el.setAttribute('title', v);
  }
  for (const el of r.querySelectorAll('[data-i18n-aria-label]')) {
    const v = t(el.getAttribute('data-i18n-aria-label'));
    if (el.getAttribute('aria-label') !== v) el.setAttribute('aria-label', v);
  }
}

function updateLangToggleUi() {
  const isRu = lang === 'ru';
  const btns = document.querySelectorAll('[data-lang-toggle]');
  if (!btns || !btns.length) return;
  for (const btn of btns) {
    if (!btn) continue;
    btn.replaceChildren();
    const img = document.createElement('img');
    img.alt = isRu ? 'RU' : 'EN';
    img.width = 22;
    img.height = 22;
    img.src = isRu ? 'emoji-64/1f1f7-1f1fa.png' : 'emoji-64/1f1fa-1f1f8.png';
    btn.appendChild(img);
  }
}

function setLang(next) {
  const v = String(next || 'ru');
  if (v !== 'ru' && v !== 'en') return;
  lang = v;
  try {
    localStorage.setItem(I18N_LANG_KEY, lang);
  } catch {}
  updateLangToggleUi();
  applyTranslations(document);

  // Обновляем динамические куски интерфейса, которые собираются в JS.
  try {
    updateMenuNameUi();
  } catch {}
  try {
    updateRoomsUi();
  } catch {}
  try {
    updateRoomInfo();
  } catch {}
  try {
    syncMatchOverlayActions();
  } catch {}
  try {
    ensureFxPresetControl();
  } catch {}
  try {
    updateMatchCountdown();
  } catch {}
  try {
    renderDeathStats();
  } catch {}
  // K4: обе строки собираются в JS и раньше оставались на прежнем языке.
  try {
    renderDeathReason();
  } catch {}
  try {
    renderCosmeticsStatus();
  } catch {}
  try {
    renderTeamHud();
  } catch {}
  try {
    renderTopHud();
  } catch {}
  try {
    ensureLeaderboardDom();
  } catch {}
  try {
    updateLeaderboard();
  } catch {}
  try {
    syncCosmeticsUi();
  } catch {}
  try {
    renderMetaHud();
  } catch {}
  try {
    updateMinimapLegend();
  } catch {}

  try {
    updateChatHeaderStatus();
  } catch {}
  try {
    syncChatCollapseButtonUi();
  } catch {}
  try {
    updateRightI18n();
  } catch {}

  try {
    refreshBotNames();
  } catch {}
}

for (const el of document.querySelectorAll('[data-lang-toggle]')) {
  el?.addEventListener?.('click', () => {
    setLang(lang === 'ru' ? 'en' : 'ru');
  });
}

updateLangToggleUi();
applyTranslations(document);

let net = null;

/* F5 «Реклейм»: сервер отдаёт остывающую территорию тем же полем сетки, но со
   старшим битом 0x8000 — значение читается как «клетка ничья, но её ещё может
   вернуть игрок (v & 0x7FFF)». Обе функции ниже обязаны снимать флаг, иначе
   0x8000|n читается как несуществующий игрок и клетка становится серой. */
const COOL_OWNER_FLAG = 0x8000;

function gridCellOwner(v) {
  return (Number(v) || 0) & 0x7fff;
}

function gridCellIsCooling(v) {
  return ((Number(v) || 0) & COOL_OWNER_FLAG) !== 0;
}

// Вспышка захвата конкретного игрока — берём из последнего снапшота.
function cosCaptureFxByPlayer(pid) {
  const list = lastState?.players;
  if (!Array.isArray(list)) return 0;
  for (const p of list) {
    if (p?.n === pid) return Number(p.cosCaptureFx) || 0;
  }
  return 0;
}

function setMinimapPixel(i) {
  if (!minimapImage || !minimapGridOwner) return;
  const raw = minimapGridOwner[i];
  const cooling = gridCellIsCooling(raw);
  const o = gridCellOwner(raw);
  let r = 12;
  let g = 16;
  let b = 20;
  if (o !== 0) {
    let rgb = minimapOwnerRgbCache.get(o);
    if (!rgb) {
      const c = boostHsl(colors.get(o) || 'hsl(210 20% 60%)');
      const raw2 = hslToRgb(c);
      rgb = [Math.round(raw2[0] * 0.50), Math.round(raw2[1] * 0.50), Math.round(raw2[2] * 0.50)];
      minimapOwnerRgbCache.set(o, rgb);
    }
    // Остывающая территория на миникарте заметно тусклее «живой».
    const k = cooling ? 0.42 : 1;
    r = Math.round(rgb[0] * k) + (cooling ? 10 : 0);
    g = Math.round(rgb[1] * k) + (cooling ? 10 : 0);
    b = Math.round(rgb[2] * k) + (cooling ? 10 : 0);
  }
  const di = i * 4;
  const data = minimapImage.data;
  data[di] = r;
  data[di + 1] = g;
  data[di + 2] = b;
  data[di + 3] = 255;
}

/* ==========================================================================
   КОСМЕТИКА: ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ
   --------------------------------------------------------------------------
   На каждую категорию — ровно ОДНА функция отрисовки. Её вызывает и игровой
   цикл draw(), и мини-иконка карточки магазина, и большое превью. Отличаются
   вызовы только параметрами (размер клетки, alpha, фаза анимации, направление).
   Поэтому расхождение «в магазине одно, в игре другое» структурно невозможно.

   Правило палитры: цвет редкости живёт ТОЛЬКО в UI магазина (полоска карточки,
   бейдж тира, цена). Сам предмет красится цветом игрока и различается
   СТРУКТУРОЙ и ДВИЖЕНИЕМ. Исключение — capturefx 5..7: у них своя палитра.
   ========================================================================== */

const COS_FONT = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';

function cosClampId(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(7, n | 0));
}

// Кэш градиентов «Плазмы». Ключ — цвет + размер клетки, хранилище привязано к
// конкретному контексту (градиент нельзя переносить между канвасами).
// Без кэша createLinearGradient звался бы на каждую клетку следа каждый кадр.
const cosGradCache = new WeakMap();

function cosCachedGradient(ctx, key, make) {
  let m = cosGradCache.get(ctx);
  if (!m) {
    m = new Map();
    cosGradCache.set(ctx, m);
  }
  let g = m.get(key);
  if (g) return g;
  g = make();
  if (m.size > 48) m.clear();
  m.set(key, g);
  return g;
}

/* K6: строки `rgba(...)` собирались на КАЖДУЮ клетку следа каждый кадр — до
   3.6к аллокаций за кадр на мобильном. Кэш повторяет приём getOwnerFillStyle:
   квантованная альфа + цвет как ключ. Ключом здесь служит hsl, а не номер
   игрока, потому что drawSegTile зовётся ещё и из превью магазина, где номера
   игрока нет вовсе. */
const COS_ALPHA_STEPS = 24;
const cosFillCache = new Map();

function cosQuantA(a) {
  const v = Math.max(0, Math.min(1, Number(a) || 0));
  return Math.round(v * COS_ALPHA_STEPS);
}

function cosSegFill(hsl, a) {
  const ai = cosQuantA(a);
  const key = `${hsl}|${ai}`;
  let v = cosFillCache.get(key);
  if (v) return v;
  const rgb = hslToRgb(hsl);
  v = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(ai / COS_ALPHA_STEPS).toFixed(3)})`;
  if (cosFillCache.size > 640) cosFillCache.clear();
  cosFillCache.set(key, v);
  return v;
}

const cosWhiteCache = new Map();

function cosWhiteFill(a) {
  const ai = cosQuantA(a);
  let v = cosWhiteCache.get(ai);
  if (v) return v;
  v = `rgba(255,255,255,${(ai / COS_ALPHA_STEPS).toFixed(3)})`;
  cosWhiteCache.set(ai, v);
  return v;
}

// «Бездна» (id 7) заливается фиксированным тёмным цветом — ему свой кэш.
const cosVoidCache = new Map();

function cosVoidFill(a) {
  const ai = cosQuantA(a);
  let v = cosVoidCache.get(ai);
  if (v) return v;
  v = `rgba(4,6,10,${(ai / COS_ALPHA_STEPS).toFixed(3)})`;
  cosVoidCache.set(ai, v);
  return v;
}

/* K6: «Неон» (id 1) и «Полосы» (id 2) — единственные варианты следа, чей
   рисунок не зависит ни от времени, ни от seed, и одновременно самые дорогие в
   цикле: у Неона был save/restore + shadowBlur НА КЛЕТКУ (4.23 мс на 300
   клеток на десктопе, 20-35 мс на телефоне — один кадровый бюджет целиком), у
   Полос — save + clip() + ~4 stroke() на клетку (2.09 мс).
   Тот же приём, что уже применён к территории: рисуем плитку один раз в
   оффскрин на пару (цвет, размер клетки), а в цикле остаётся один drawImage.
   Альфа не запекается — она накладывается через globalAlpha, иначе кэш
   размножился бы на каждый шаг пульсации собственного следа.
   У Неона свечение выходит за границы клетки, поэтому плитка шире на pad. */
const cosSegTileCache = new Map();

function cosSegTile(hsl, segId, cell) {
  const id = cosClampId(segId);
  if (id !== 1 && id !== 2) return null;
  const c = Math.max(1, Math.round(cell));
  const key = `${id}|${hsl}|${c}`;
  const hit = cosSegTileCache.get(key);
  if (hit) return hit;

  const blur = Math.max(6, c * 0.55);
  const pad = id === 1 ? Math.ceil(blur) + 2 : 0;
  const size = c + pad * 2;
  let cv = null;
  let g = null;
  try {
    cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    g = cv.getContext('2d');
  } catch {
    return null;
  }
  if (!g) return null;

  // Координаты внутри плитки повторяют геометрию исходного кода: отступ 1 px
  // от края клетки, сторона cell-2.
  const x = pad + 1;
  const y = pad + 1;
  const w = Math.max(1, c - 2);
  const h = Math.max(1, c - 2);

  if (id === 1) {
    g.shadowColor = hsl;
    g.shadowBlur = blur;
    g.fillStyle = cosSegFill(hsl, 1);
    g.fillRect(x, y, w, h);
  } else {
    g.fillStyle = cosSegFill(hsl, 0.92);
    g.fillRect(x, y, w, h);
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.globalAlpha = 0.45;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = Math.max(2, c * 0.10);
    const step = Math.max(4, (c * 0.55) | 0);
    for (let k = -c; k <= c * 2; k += step) {
      g.beginPath();
      g.moveTo(pad + k, pad - 2);
      g.lineTo(pad + k + c, pad + c + 2);
      g.stroke();
    }
  }

  const rec = { cv, pad };
  if (cosSegTileCache.size > 64) cosSegTileCache.clear();
  cosSegTileCache.set(key, rec);
  return rec;
}

/* --- SEG: одна клетка следа ------------------------------------------------
   px,py — левый верхний угол клетки; cell — сторона клетки в пикселях.
   seed — стабильное число клетки (в игре из x,y), timeMs — время для анимации.
   Вызывается для каждой клетки следа каждый кадр: внутри нет аллокаций,
   единственный градиент кэшируется. */
function drawSegTile(ctx, px, py, cell, hsl, segId, seed, alpha, timeMs) {
  const a = Math.max(0, Math.min(1, Number(alpha)));
  if (!(a > 0.02)) return;
  const id = cosClampId(segId);
  const rgb = hslToRgb(hsl);
  const now = Number(timeMs) || 0;
  const s = Number(seed) || 0;

  const x = px + 1;
  const y = py + 1;
  const w = Math.max(1, cell - 2);
  const h = Math.max(1, cell - 2);
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];

  // K6: Неон и Полосы — из готовой оффскрин-плитки, один drawImage на клетку.
  if (id === 1 || id === 2) {
    const tile = cosSegTile(hsl, id, cell);
    if (tile) {
      const ga = ctx.globalAlpha;
      ctx.globalAlpha = ga * a;
      ctx.drawImage(tile.cv, Math.round(px) - tile.pad, Math.round(py) - tile.pad);
      ctx.globalAlpha = ga;
      return;
    }
    // Плитку не удалось создать (нет canvas) — падаем в честный медленный путь.
    if (id === 1) {
      ctx.save();
      ctx.shadowColor = hsl;
      ctx.shadowBlur = Math.max(6, cell * 0.55);
      ctx.fillStyle = cosSegFill(hsl, a);
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.fillStyle = cosSegFill(hsl, a * 0.92);
    ctx.fillRect(x, y, w, h);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = Math.max(2, cell * 0.10);
    const step = Math.max(4, (cell * 0.55) | 0);
    for (let k = -cell; k <= cell * 2; k += step) {
      ctx.beginPath();
      ctx.moveTo(px + k, py - 2);
      ctx.lineTo(px + k + cell, py + cell + 2);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (id === 3) {
    // Плазма: диагональный градиент + бегущая волна яркости.
    const key = `p|${r},${g},${b}|${cell | 0}`;
    const grad = cosCachedGradient(ctx, key, () => {
      const gg = ctx.createLinearGradient(0, 0, cell, cell);
      gg.addColorStop(0, `rgb(${r},${g},${b})`);
      gg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      gg.addColorStop(1, 'rgba(0,0,0,0.85)');
      return gg;
    });
    const wv = 0.5 + 0.5 * Math.sin(now * 0.004 + s * 0.35);
    ctx.save();
    ctx.translate(px, py);
    ctx.globalAlpha = a * (0.72 + 0.28 * wv);
    ctx.fillStyle = grad;
    ctx.fillRect(1, 1, w, h);
    ctx.restore();
    return;
  }

  if (id === 4) {
    // Искры: заливка + одна белая искра, прыгающая по клетке.
    // Старая формула `h % (cell - 8)` при cell=9 давала `% 1` — искра всегда
    // в одной точке и мерцания не было вовсе. Считаем позицию долей стороны.
    ctx.fillStyle = cosSegFill(hsl, a * 0.92);
    ctx.fillRect(x, y, w, h);
    const hsh = (((s * 73856093) >>> 0) ^ (((now / 90) | 0) * 19349663)) >>> 0;
    const sz = Math.max(1.5, cell * 0.18);
    const sx = x + (w - sz) * ((hsh & 1023) / 1023);
    const sy = y + (h - sz) * (((hsh >>> 10) & 1023) / 1023);
    ctx.fillStyle = cosWhiteFill(0.90 * a);
    ctx.fillRect(sx, sy, sz, sz);
    return;
  }

  if (id === 5) {
    // Схема: тёмная подложка, яркие дорожки крестом и бегущий вдоль хвоста
    // импульс — узел вспыхивает белым, волна идёт от головы к хвосту.
    ctx.fillStyle = cosSegFill(hsl, a * 0.34);
    ctx.fillRect(x, y, w, h);
    const tw = Math.max(1, Math.round(cell * 0.24));
    ctx.fillStyle = cosSegFill(hsl, a);
    ctx.fillRect(x, y + (h - tw) / 2, w, tw);
    ctx.fillRect(x + (w - tw) / 2, y, tw, h * 0.5);
    const ph = (((s - ((now / 90) | 0)) % 6) + 6) % 6;
    if (ph === 0) {
      ctx.fillStyle = cosWhiteFill(0.92 * a);
      const nr = Math.max(1.4, cell * 0.20);
      ctx.fillRect(x + w / 2 - nr, y + h / 2 - nr, nr * 2, nr * 2);
    }
    return;
  }

  if (id === 6) {
    // Мозаика: четыре плитки со швом — шахматка читается даже на 7px.
    const hw = Math.max(1, (w - 1) / 2);
    const hh = Math.max(1, (h - 1) / 2);
    ctx.fillStyle = cosSegFill(hsl, a);
    ctx.fillRect(x, y, hw, hh);
    ctx.fillRect(x + hw + 1, y + hh + 1, hw, hh);
    ctx.fillStyle = cosSegFill(hsl, a * 0.42);
    ctx.fillRect(x + hw + 1, y, hw, hh);
    ctx.fillRect(x, y + hh + 1, hw, hh);
    return;
  }

  if (id === 7) {
    // Бездна: тёмная дыра в яркой рамке — единственный «полый» след.
    const lw = Math.max(1.5, cell * 0.20);
    ctx.fillStyle = cosVoidFill(0.72 * a);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = cosSegFill(hsl, a);
    ctx.lineWidth = lw;
    ctx.strokeRect(x + lw / 2, y + lw / 2, Math.max(0.5, w - lw), Math.max(0.5, h - lw));
    return;
  }

  // 0 — Классика.
  ctx.fillStyle = cosSegFill(hsl, a);
  ctx.fillRect(x, y, w, h);
}

/* --- HEAD: голова змейки ---------------------------------------------------
   cx,cy — центр клетки; dirX,dirY — вектор движения (асимметричные силуэты
   разворачиваются по нему). Поверх головы игра рисует кольца щита (~0.46-0.50
   клетки) и скорости (~0.60-0.64), поэтому декоративные кольца головы держим
   строго внутри 0.44. */
function drawHead(ctx, cx, cy, cell, hsl, headId, dirX, dirY, timeMs) {
  const id = cosClampId(headId);
  let dx = Number(dirX);
  let dy = Number(dirY);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    dx = 1;
    dy = 0;
  }
  const ang = Math.atan2(dy, dx);
  const now = Number(timeMs) || 0;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, cell * 0.07);
  ctx.fillStyle = hsl;
  ctx.strokeStyle = 'rgba(0,0,0,0.40)';

  if (id === 1) {
    // Ромб: вытянут по ходу движения.
    ctx.rotate(ang);
    const r = cell * 0.46;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(0, -r * 0.66);
    ctx.lineTo(-r, 0);
    ctx.lineTo(0, r * 0.66);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (id === 2) {
    // Куб: намеренно самый мелкий и «жёсткий» силуэт.
    const r = cell * 0.29;
    ctx.beginPath();
    ctx.rect(-r, -r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();
  } else if (id === 3) {
    // Кольцо: единственный силуэт с дыркой — опознаётся мгновенно.
    const ro = cell * 0.42;
    const ri = cell * 0.21;
    ctx.beginPath();
    ctx.arc(0, 0, ro, 0, Math.PI * 2, false);
    ctx.arc(0, 0, ri, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(0, 0, ro, 0, Math.PI * 2);
    ctx.stroke();
  } else if (id === 4) {
    // Щит: плоская корма, острый лоб по ходу движения.
    ctx.rotate(ang);
    const r = cell * 0.42;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(r * 0.24, -r * 0.80);
    ctx.lineTo(-r * 0.78, -r * 0.66);
    ctx.lineTo(-r * 0.78, r * 0.66);
    ctx.lineTo(r * 0.24, r * 0.80);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (id === 5) {
    // Стрела: самый крупный и самый асимметричный силуэт.
    ctx.rotate(ang);
    const r = cell * 0.46;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(-r * 0.62, -r * 0.78);
    ctx.lineTo(-r * 0.28, 0);
    ctx.lineTo(-r * 0.62, r * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (id === 6) {
    // Затмение: единственная тёмная голова в игре, узнаётся по яркому ободку.
    const r = cell * 0.37;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6,8,12,0.95)';
    ctx.fill();
    ctx.strokeStyle = hsl;
    ctx.lineWidth = Math.max(1.5, cell * 0.13);
    ctx.stroke();
  } else if (id === 7) {
    // Звезда: пятилучевой силуэт, медленно вращается.
    ctx.rotate(ang * 0.35 + now * 0.0006);
    const ro = cell * 0.44;
    const ri = cell * 0.19;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? ro : ri;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // 0 — Орб.
    ctx.beginPath();
    ctx.arc(0, 0, cell * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();

  // Направляющий «нос» — единый для всех вариантов, и в игре, и в превью.
  const noseX = cx + dx * cell * 0.26;
  const noseY = cy + dy * cell * 0.26;
  const noseW = cell * 0.18;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(noseX, noseY);
  ctx.lineTo(noseX - dy * noseW, noseY + dx * noseW);
  ctx.lineTo(noseX + dy * noseW, noseY - dx * noseW);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* --- NAMEPLATE: плашка ника ------------------------------------------------
   x — центр по горизонтали, y — нижняя граница плашки. Варианты отличаются
   ГЕОМЕТРИЕЙ пути, а не альфой заливки. */
function drawNamePlate(ctx, label, x, y, hsl, plateId, alpha, fontPx, timeMs) {
  const txt = String(label == null ? '' : label);
  if (!txt) return;
  const id = cosClampId(plateId);
  const fs = Math.max(9, Math.round(Number(fontPx) || 12));
  const a = Math.max(0, Math.min(1, Number(alpha == null ? 0.95 : alpha)));
  const now = Number(timeMs) || 0;
  const rgb = hslToRgb(hsl);
  const acc = (aa) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${aa})`;

  ctx.save();
  ctx.font = `${fs}px ${COS_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const h = Math.round(fs * 1.5);
  const basePad = Math.round(fs * 0.62);
  const extraPad = id === 1 ? Math.round(fs * 0.55) : id === 3 ? Math.round(fs * 0.5) : id === 7 ? Math.round(fs * 0.45) : 0;
  const w = Math.ceil(ctx.measureText(txt).width + basePad * 2 + extraPad);
  const px = Math.round(x - w / 2);
  const py = Math.round(y - h);
  const cyy = py + h / 2;
  let textX = px + w / 2;

  ctx.globalAlpha = a;
  ctx.lineWidth = 1;

  if (id === 1) {
    // Планка: прямой прямоугольник + цветная полоса слева.
    const bw = Math.max(3, Math.round(fs * 0.32));
    ctx.fillStyle = 'rgba(0,0,0,0.52)';
    ctx.fillRect(px, py, w, h);
    ctx.fillStyle = acc(0.95);
    ctx.fillRect(px, py, bw, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
    textX = px + bw + (w - bw) / 2;
  } else if (id === 2) {
    // Скос: срезанные углы.
    const c = Math.round(h * 0.34);
    ctx.beginPath();
    ctx.moveTo(px + c, py);
    ctx.lineTo(px + w - c, py);
    ctx.lineTo(px + w, py + c);
    ctx.lineTo(px + w, py + h - c);
    ctx.lineTo(px + w - c, py + h);
    ctx.lineTo(px + c, py + h);
    ctx.lineTo(px, py + h - c);
    ctx.lineTo(px, py + c);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.50)';
    ctx.fill();
    ctx.strokeStyle = acc(0.75);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (id === 3) {
    // Свиток: треугольные хвосты по бокам.
    const tl = Math.round(h * 0.42);
    ctx.beginPath();
    ctx.moveTo(px + tl, py);
    ctx.lineTo(px + w - tl, py);
    ctx.lineTo(px + w, py + h / 2);
    ctx.lineTo(px + w - tl, py + h);
    ctx.lineTo(px + tl, py + h);
    ctx.lineTo(px, py + h / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.48)';
    ctx.fill();
    ctx.strokeStyle = acc(0.68);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (id === 4) {
    // Терминал: пунктирная рамка и угловые засечки.
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(px, py, w, h);
    ctx.save();
    ctx.setLineDash([Math.max(2, fs * 0.22), Math.max(2, fs * 0.18)]);
    ctx.strokeStyle = acc(0.80);
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
    ctx.restore();
    const tk = Math.max(3, Math.round(fs * 0.34));
    ctx.strokeStyle = acc(0.95);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, py + tk); ctx.lineTo(px, py); ctx.lineTo(px + tk, py);
    ctx.moveTo(px + w - tk, py); ctx.lineTo(px + w, py); ctx.lineTo(px + w, py + tk);
    ctx.moveTo(px + w, py + h - tk); ctx.lineTo(px + w, py + h); ctx.lineTo(px + w - tk, py + h);
    ctx.moveTo(px + tk, py + h); ctx.lineTo(px, py + h); ctx.lineTo(px, py + h - tk);
    ctx.stroke();
  } else if (id === 5) {
    // Гравюра: фаска — светлая линия сверху-слева, тёмная снизу-справа,
    // текст рисуется дважды со сдвигом (выдавленные буквы).
    ctx.fillStyle = 'rgba(0,0,0,0.60)';
    ctx.fillRect(px, py, w, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.34)';
    ctx.beginPath();
    ctx.moveTo(px + 0.5, py + h - 1); ctx.lineTo(px + 0.5, py + 0.5); ctx.lineTo(px + w - 1, py + 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.moveTo(px + w - 0.5, py + 1); ctx.lineTo(px + w - 0.5, py + h - 0.5); ctx.lineTo(px + 1, py + h - 0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillText(txt, textX + 1, cyy + 1.5);
    ctx.fillStyle = acc(0.98);
    ctx.fillText(txt, textX, cyy + 0.5);
    ctx.restore();
    return;
  } else if (id === 6) {
    // Блик: капсула с бегущей диагональной подсветкой.
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + w, py, px + w, py + h, r);
    ctx.arcTo(px + w, py + h, px, py + h, r);
    ctx.arcTo(px, py + h, px, py, r);
    ctx.arcTo(px, py, px + w, py, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.46)';
    ctx.fill();
    ctx.strokeStyle = acc(0.45);
    ctx.stroke();
    ctx.save();
    ctx.clip();
    const period = 2200;
    const t01 = ((now % period) / period);
    const bx = px - h + (w + h * 2) * t01;
    ctx.globalAlpha = a * 0.55;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.moveTo(bx, py + h);
    ctx.lineTo(bx + h * 0.55, py);
    ctx.lineTo(bx + h * 1.05, py);
    ctx.lineTo(bx + h * 0.50, py + h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else if (id === 7) {
    // Шеврон: параллелограмм со стрелкой по левому краю.
    const sk = Math.round(h * 0.36);
    ctx.beginPath();
    ctx.moveTo(px + sk, py);
    ctx.lineTo(px + w, py);
    ctx.lineTo(px + w - sk, py + h);
    ctx.lineTo(px, py + h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.50)';
    ctx.fill();
    ctx.strokeStyle = acc(0.70);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + sk * 0.5, py + h * 0.5);
    ctx.lineTo(px + sk * 1.5, py + 1);
    ctx.lineTo(px + sk * 1.15, py + h * 0.5);
    ctx.lineTo(px + sk * 1.5, py + h - 1);
    ctx.closePath();
    ctx.fillStyle = acc(0.95);
    ctx.fill();
    textX = px + sk + (w - sk) / 2;
  } else {
    // 0 — Капсула.
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.arcTo(px + w, py, px + w, py + h, r);
    ctx.arcTo(px + w, py + h, px, py + h, r);
    ctx.arcTo(px, py + h, px, py, r);
    ctx.arcTo(px, py, px + w, py, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();
  }

  ctx.globalAlpha = Math.min(1, a + 0.18);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillText(txt, textX, cyy + 0.5);
  ctx.restore();
}

/* --- CAPTUREFX: вспышка в момент захвата -----------------------------------
   progress 0..1 — фаза одного проигрывания. В игре это age/650мс, в магазине —
   зацикленная фаза. Варианты 0..4 красятся цветом игрока (раньше они дублировали
   палитру рамок и плашек), 5..7 имеют собственную яркую палитру. */
const COS_FX_PALETTE = {
  5: [255, 122, 24],   // магма
  6: [20, 224, 200],   // бирюза
  7: [255, 92, 225]    // магента
};

function cosFxRgb(fxId, hsl) {
  const id = cosClampId(fxId);
  return COS_FX_PALETTE[id] || hslToRgb(hsl);
}

function drawCaptureFx(ctx, cx, cy, cell, hsl, fxId, progress) {
  const id = cosClampId(fxId);
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const rgb = cosFxRgb(id, hsl);
  const col = (aa) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${aa})`;
  const base = cell * 1.05;
  const r = base * (0.35 + 1.25 * p);
  const a = Math.max(0, 1 - p) * 0.92;
  if (a <= 0.01) return;

  ctx.save();
  ctx.globalAlpha = a;
  ctx.strokeStyle = col(0.95);
  ctx.fillStyle = col(0.95);
  ctx.lineWidth = Math.max(1, cell * 0.10);

  if (id === 0) {
    // Кольца.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = a * 0.55;
    ctx.lineWidth = Math.max(1, cell * 0.06);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
  } else if (id === 1) {
    // Лучи.
    ctx.lineWidth = Math.max(2, cell * 0.08);
    for (let k = 0; k < 12; k++) {
      const ang = p * 2.4 + (k * Math.PI * 2) / 12;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r * 0.35, cy + Math.sin(ang) * r * 0.35);
      ctx.lineTo(cx + Math.cos(ang) * r * 1.10, cy + Math.sin(ang) * r * 1.10);
      ctx.stroke();
    }
  } else if (id === 2) {
    // Кристалл: вложенные ромбы.
    ctx.lineWidth = Math.max(2, cell * 0.08);
    const rr = r * (0.85 + 0.10 * Math.sin(p * Math.PI * 2));
    for (let k = 0; k < 2; k++) {
      const q = rr * (k === 0 ? 1 : 0.55);
      ctx.beginPath();
      ctx.moveTo(cx, cy - q);
      ctx.lineTo(cx + q * 0.72, cy);
      ctx.lineTo(cx, cy + q);
      ctx.lineTo(cx - q * 0.72, cy);
      ctx.closePath();
      ctx.stroke();
    }
  } else if (id === 3) {
    // Спираль: одна непрерывная линия (именно так, как в игре).
    ctx.lineWidth = Math.max(2, cell * 0.08);
    const rot = p * 8.0;
    ctx.beginPath();
    for (let s = 0; s <= 1.001; s += 0.045) {
      const ang = rot + s * Math.PI * 6.2;
      const rr = r * (0.12 + 0.90 * s);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (id === 4) {
    // Конфетти.
    const extra = ['rgba(255,255,255,0.92)', col(0.92), 'rgba(255,215,0,0.92)', 'rgba(120,255,200,0.92)'];
    ctx.globalAlpha = a * (0.75 + 0.25 * (1 - p));
    for (let k = 0; k < 26; k++) {
      const seed = ((k + 1) * 2654435761) >>> 0;
      const u = (seed & 1023) / 1023;
      const v = ((seed >>> 10) & 1023) / 1023;
      const ang = u * Math.PI * 2 + p * 1.2;
      const sp = 0.25 + 0.95 * v;
      const rr = r * (0.05 + p * 1.45 * sp);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      const sz = Math.max(2, (cell * (0.10 + 0.14 * (((seed >>> 20) & 3) / 3))) | 0);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((p * 10.0 + u * 6.0) % (Math.PI * 2));
      ctx.fillStyle = extra[seed % extra.length];
      if ((seed & 1) === 0) {
        ctx.beginPath();
        ctx.moveTo(0, -sz);
        ctx.lineTo(sz, 0);
        ctx.lineTo(0, sz);
        ctx.lineTo(-sz, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
      }
      ctx.restore();
    }
  } else if (id === 5) {
    // Магма: рваная корона, расходящаяся вспышкой.
    ctx.lineWidth = Math.max(2, cell * 0.12);
    ctx.beginPath();
    const n = 14;
    for (let k = 0; k <= n; k++) {
      const ang = (k * Math.PI * 2) / n;
      const jag = k % 2 === 0 ? 1 : 0.62;
      const rr = r * jag * (0.9 + 0.12 * Math.sin(p * 6 + k));
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = a * 0.28;
    ctx.fill();
  } else if (id === 6) {
    // Вихрь: три закрученные дуги с хвостами.
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const a0 = p * 9.0 + (k * Math.PI * 2) / 3;
      ctx.globalAlpha = a * (1 - k * 0.22);
      ctx.lineWidth = Math.max(1.5, cell * (0.12 - k * 0.025));
      ctx.beginPath();
      ctx.arc(cx, cy, r * (0.55 + 0.22 * k), a0, a0 + Math.PI * 0.85);
      ctx.stroke();
    }
  } else {
    // 7 — Осколки: треугольные обломки, разлетающиеся и вращающиеся.
    for (let k = 0; k < 9; k++) {
      const ang = (k * Math.PI * 2) / 9 + p * 0.8;
      const rr = r * (0.25 + 0.95 * p);
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      const sz = Math.max(2.5, cell * 0.30 * (1 - p * 0.55));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + p * 5.0);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(sz, 0);
      ctx.lineTo(-sz * 0.6, -sz * 0.75);
      ctx.lineTo(-sz * 0.6, sz * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

/* --- TERR: заливка территории ----------------------------------------------
   Самая большая вещь на экране (до 40% площади) — и до этой волны она вообще
   не продавалась. Заливка зовётся для КАЖДОЙ видимой клетки КАЖДЫЙ кадр
   (до 40×28 = 1120 вызовов), поэтому здесь нет ни одного createPattern или
   createLinearGradient внутри цикла: узор один раз рисуется в оффскрин-канвас
   64×64, из него один раз за кадр делается CanvasPattern, а на клетку остаётся
   ровно один fillRect.

   Цвет — всегда цвет игрока. Варианты различаются структурой узора. */

const COS_TERR_TILE = 64;

// Ключ — `hsl|id`; хранит оффскрин-канвасы 64×64, независимые от контекста.
const cosTerrTileCache = new Map();

// Пер-контекстный кэш CanvasPattern: паттерн привязан к своему ctx.
const cosTerrPatternCache = new WeakMap();

// Какие варианты вообще узорные. 0 (Заливка), 3 (Прилив) и 5 (Витраж)
// рисуются плоско — их отличие в модуляции альфы и в швах по границе.
function cosTerrIsPattern(id) {
  const i = cosClampId(id);
  return i === 1 || i === 2 || i === 4 || i === 6 || i === 7;
}

// Вариант 6 «Разлом» рисуется аддитивно.
function cosTerrIsAdditive(id) {
  return cosClampId(id) === 6;
}

function cosTerrTile(hsl, terrId) {
  const id = cosClampId(terrId);
  const key = `${hsl}|${id}`;
  const hit = cosTerrTileCache.get(key);
  if (hit) return hit;

  const S = COS_TERR_TILE;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const c = cv.getContext('2d');
  const rgb = hslToRgb(hsl);
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];
  const col = (a) => `rgba(${r},${g},${b},${a})`;

  if (id === 1) {
    // Штриховка: диагональные тёмные полосы поверх заливки.
    c.fillStyle = col(1);
    c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 7;
    for (let k = -S; k <= S * 2; k += 16) {
      c.beginPath();
      c.moveTo(k, -2);
      c.lineTo(k + S + 2, S + 2);
      c.stroke();
    }
    c.strokeStyle = 'rgba(255,255,255,0.16)';
    c.lineWidth = 2;
    for (let k = -S; k <= S * 2; k += 16) {
      c.beginPath();
      c.moveTo(k + 5, -2);
      c.lineTo(k + S + 7, S + 2);
      c.stroke();
    }
  } else if (id === 2) {
    // Соты: шестиугольная решётка со светлыми швами. Гексы слегка сплюснуты,
    // чтобы период узора был ровно 32×64 и плитка стыковалась без шва.
    c.fillStyle = col(0.55);
    c.fillRect(0, 0, S, S);
    const hw = 32;
    const hh = 42.67;
    c.lineWidth = 3;
    c.strokeStyle = col(1);
    c.lineJoin = 'round';
    for (let j = -1; j <= 3; j++) {
      const cy = j * 32;
      const off = (((j % 2) + 2) % 2) * (hw / 2);
      for (let i = -1; i <= 3; i++) {
        const cx = i * hw + off;
        c.beginPath();
        c.moveTo(cx, cy - hh / 2);
        c.lineTo(cx + hw / 2, cy - hh / 4);
        c.lineTo(cx + hw / 2, cy + hh / 4);
        c.lineTo(cx, cy + hh / 2);
        c.lineTo(cx - hw / 2, cy + hh / 4);
        c.lineTo(cx - hw / 2, cy - hh / 4);
        c.closePath();
        c.stroke();
      }
    }
  } else if (id === 4) {
    // Схема: тёмная подложка и яркие дорожки с контактными площадками.
    c.fillStyle = col(0.34);
    c.fillRect(0, 0, S, S);
    c.strokeStyle = col(1);
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(0, 32);
    c.lineTo(S, 32);
    c.moveTo(32, 0);
    c.lineTo(32, S);
    c.stroke();
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, 8);
    c.lineTo(16, 8);
    c.lineTo(16, 32);
    c.moveTo(S, 56);
    c.lineTo(48, 56);
    c.lineTo(48, 32);
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillRect(28, 28, 8, 8);
    c.fillRect(12, 4, 8, 8);
    c.fillRect(44, 52, 8, 8);
  } else if (id === 6) {
    // Разлом: тёмная порода с раскалёнными трещинами. Рисуется аддитивно,
    // поэтому базу держим тёмной — иначе территория выжжется в белый.
    c.fillStyle = `rgba(${(r * 0.30) | 0},${(g * 0.30) | 0},${(b * 0.30) | 0},1)`;
    c.fillRect(0, 0, S, S);
    c.lineCap = 'round';
    const cracks = [
      [0, 12, 20, 26, 40, 18, S, 30],
      [14, S, 26, 44, 44, 50, 58, 0],
      [S, 58, 40, 60, 24, S]
    ];
    for (const path of cracks) {
      c.beginPath();
      c.moveTo(path[0], path[1]);
      for (let k = 2; k < path.length; k += 2) c.lineTo(path[k], path[k + 1]);
      c.strokeStyle = col(0.85);
      c.lineWidth = 5;
      c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.75)';
      c.lineWidth = 1.6;
      c.stroke();
    }
  } else if (id === 7) {
    // Ткань: переплетение полос — единственный вариант с ощущением объёма.
    c.fillStyle = col(0.85);
    c.fillRect(0, 0, S, S);
    const pitch = 16;
    for (let y = 0; y < S; y += pitch) {
      for (let x = 0; x < S; x += pitch) {
        const over = ((x / pitch) + (y / pitch)) % 2 === 0;
        c.fillStyle = over ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.34)';
        if (over) c.fillRect(x, y + 2, pitch, pitch - 4);
        else c.fillRect(x + 2, y, pitch - 4, pitch);
      }
    }
    c.strokeStyle = 'rgba(0,0,0,0.28)';
    c.lineWidth = 1;
    for (let k = 0; k <= S; k += pitch) {
      c.beginPath();
      c.moveTo(k + 0.5, 0);
      c.lineTo(k + 0.5, S);
      c.moveTo(0, k + 0.5);
      c.lineTo(S, k + 0.5);
      c.stroke();
    }
  } else {
    // 0/3/5 — плоская база (в игре они плоские и различаются иначе).
    c.fillStyle = col(1);
    c.fillRect(0, 0, S, S);
  }

  if (cosTerrTileCache.size > 96) cosTerrTileCache.clear();
  cosTerrTileCache.set(key, cv);
  return cv;
}

/* Возвращает fillStyle для территории. Зовётся ОДИН раз на владельца за кадр,
   не на клетку. originX/originY — экранные координаты клетки (0,0) поля,
   cell — сторона клетки: по ним паттерн выравнивается по сетке, поэтому в
   каждой клетке узор выглядит одинаково. */
function cosTerrFillStyle(ctx, hsl, terrId, originX, originY, cell) {
  const id = cosClampId(terrId);
  if (!cosTerrIsPattern(id)) return null;
  let m = cosTerrPatternCache.get(ctx);
  if (!m) {
    m = new Map();
    cosTerrPatternCache.set(ctx, m);
  }
  const key = `${hsl}|${id}`;
  let pat = m.get(key);
  if (!pat) {
    pat = ctx.createPattern(cosTerrTile(hsl, id), 'repeat');
    if (!pat) return null;
    if (m.size > 48) m.clear();
    m.set(key, pat);
  }
  const k = cell / COS_TERR_TILE;
  try {
    pat.setTransform(new DOMMatrix([k, 0, 0, k, originX, originY]));
  } catch {}
  return pat;
}

/* Модуляция альфы для вариантов без узора. gx,gy — координаты клетки. */
function cosTerrAlphaMod(terrId, gx, gy, timeMs) {
  const id = cosClampId(terrId);
  if (id === 3) {
    // Прилив: медленная волна яркости через всю территорию.
    return 0.22 * (0.5 + 0.5 * Math.sin((gx * 0.85 + gy * 1.15) * 0.55 - timeMs * 0.0022));
  }
  if (id === 4) {
    // Схема: импульс, бегущий по диагонали от захвата к краю зоны.
    const w = Math.sin(timeMs * 0.006 - (gx + gy) * 0.6);
    return 0.16 * Math.max(0, w) * Math.max(0, w);
  }
  return 0;
}

/* Одна клетка территории — используется превью магазина и любым кодом,
   которому не нужен горячий путь. В игре тот же узор приходит через
   cosTerrFillStyle, поэтому расхождение невозможно. */
function drawTerrTile(ctx, px, py, cell, hsl, terrId, gx, gy, alpha, timeMs) {
  const id = cosClampId(terrId);
  const a = Math.max(0, Math.min(1, Number(alpha) + cosTerrAlphaMod(id, gx, gy, Number(timeMs) || 0)));
  if (!(a > 0.02)) return;
  ctx.save();
  ctx.globalAlpha = a;
  if (cosTerrIsAdditive(id)) ctx.globalCompositeOperation = 'lighter';
  const pat = cosTerrFillStyle(ctx, hsl, id, px - gx * cell, py - gy * cell, cell);
  if (pat) {
    ctx.fillStyle = pat;
  } else {
    const rgb = hslToRgb(hsl);
    ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }
  ctx.fillRect(px, py, cell, cell);
  ctx.restore();
}

/* Витраж: светящийся шов по внешней границе владения. Зовётся только для
   пограничных клеток, поэтому дешёв. `edges` — битовая маска: 1 верх,
   2 право, 4 низ, 8 лево. */
function drawTerrSeam(ctx, px, py, cell, hsl, edges, alpha, glow) {
  if (!edges) return;
  const rgb = hslToRgb(hsl);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.strokeStyle = `rgba(255,255,255,0.85)`;
  // shadowBlur зовётся только в магазине: в игре шов рисуется до сотни раз за
  // кадр по периметру владения, а тень — самая дорогая операция канваса.
  if (glow) {
    ctx.shadowColor = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx.shadowBlur = Math.max(4, cell * 0.55);
  }
  ctx.lineWidth = Math.max(1.5, cell * 0.16);
  ctx.beginPath();
  if (edges & 1) {
    ctx.moveTo(px, py + 0.5);
    ctx.lineTo(px + cell, py + 0.5);
  }
  if (edges & 2) {
    ctx.moveTo(px + cell - 0.5, py);
    ctx.lineTo(px + cell - 0.5, py + cell);
  }
  if (edges & 4) {
    ctx.moveTo(px, py + cell - 0.5);
    ctx.lineTo(px + cell, py + cell - 0.5);
  }
  if (edges & 8) {
    ctx.moveTo(px + 0.5, py);
    ctx.lineTo(px + 0.5, py + cell);
  }
  ctx.stroke();
  ctx.restore();
}

/* --- DEATH: эффект гибели --------------------------------------------------
   Смерть видят все, а обратной связи до этой волны не было вовсе. Длительность
   бурста — параметр (COS_DEATH_MS), progress 0..1. Цвет — цвет погибшего. */

const COS_DEATH_MS = 900;

function drawDeathFx(ctx, cx, cy, cell, hsl, deathId, progress) {
  const id = cosClampId(deathId);
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const rgb = hslToRgb(hsl);
  const col = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const fade = Math.max(0, 1 - p);
  if (fade <= 0.01) return;
  const R = cell * 1.6;

  ctx.save();
  ctx.globalAlpha = fade;

  if (id === 1) {
    // Осыпание в пиксели: сетка квадратов разлетается и падает вниз.
    const n = 5;
    const sz = Math.max(1.5, cell * 0.22);
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const seed = ((ix * 73856093) ^ (iy * 19349663)) >>> 0;
        const jx = ((seed & 255) / 255 - 0.5) * 2;
        const ox = (ix - (n - 1) / 2) * cell * 0.30;
        const oy = (iy - (n - 1) / 2) * cell * 0.30;
        const x = cx + ox + jx * R * 0.55 * p;
        const y = cy + oy + (R * 0.9 * p * p) - R * 0.15 * p;
        ctx.fillStyle = col(0.95);
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
    }
  } else if (id === 2) {
    // Чёрная дыра: кольца стягиваются внутрь, в центре растёт пустота.
    for (let k = 0; k < 3; k++) {
      const q = Math.max(0, Math.min(1, p * 1.2 - k * 0.14));
      const rr = R * (1.15 - q) * (1 - k * 0.16);
      if (rr <= 0.5) continue;
      ctx.strokeStyle = col(0.9 - k * 0.22);
      ctx.lineWidth = Math.max(1, cell * (0.14 - k * 0.03));
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = fade * 0.95;
    ctx.fillStyle = 'rgba(2,3,6,1)';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.42 * Math.min(1, p * 2.2), 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 3) {
    // Стеклянный разлёт: треугольные осколки, каждый со своей осью вращения.
    for (let k = 0; k < 10; k++) {
      const seed = ((k + 3) * 2654435761) >>> 0;
      const ang = ((seed & 1023) / 1023) * Math.PI * 2;
      const sp = 0.45 + ((seed >>> 10) & 511) / 511;
      const rr = R * p * sp;
      const sz = Math.max(2, cell * 0.34 * (1 - p * 0.5));
      ctx.save();
      ctx.translate(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      ctx.rotate(ang + p * 4.5 * (seed & 1 ? 1 : -1));
      ctx.fillStyle = col(0.55);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(sz, 0);
      ctx.lineTo(-sz * 0.55, -sz * 0.8);
      ctx.lineTo(-sz * 0.3, sz * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  } else if (id === 4) {
    // Сверхновая: белое ядро, ударная волна и лучи.
    const rr = R * (0.15 + 1.5 * p);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = Math.max(1.5, cell * 0.22 * (1 - p));
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = col(0.9);
    ctx.lineWidth = Math.max(1.5, cell * 0.14);
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI * 2) / 8 + p * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * rr * 0.35, cy + Math.sin(ang) * rr * 0.35);
      ctx.lineTo(cx + Math.cos(ang) * rr * 1.25, cy + Math.sin(ang) * rr * 1.25);
      ctx.stroke();
    }
    ctx.globalAlpha = fade * Math.max(0, 1 - p * 2);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.55 * (1 - p), 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 5) {
    // Глитч-развал: горизонтальные полосы уезжают в стороны.
    const bars = 7;
    const bh = (cell * 1.5) / bars;
    for (let k = 0; k < bars; k++) {
      const seed = ((k * 2246822519) ^ 0x9e3779b9) >>> 0;
      const dir = seed & 1 ? 1 : -1;
      const amt = ((seed >>> 4) & 255) / 255;
      const x = cx + dir * R * amt * p * 1.1;
      const y = cy - cell * 0.75 + k * bh;
      ctx.fillStyle = k % 3 === 0 ? 'rgba(255,255,255,0.85)' : col(0.9);
      ctx.fillRect(x - cell * 0.55, y, cell * 1.1, Math.max(1, bh - 1));
    }
  } else if (id === 6) {
    // Пепел: искры медленно всплывают и гаснут.
    for (let k = 0; k < 14; k++) {
      const seed = ((k + 7) * 40503) >>> 0;
      const u = (seed & 1023) / 1023;
      const v = ((seed >>> 10) & 1023) / 1023;
      const x = cx + (u - 0.5) * R * (0.6 + p * 0.9);
      const y = cy - R * p * (0.4 + v * 0.9);
      const sz = Math.max(1, cell * 0.11 * (1 - p * 0.6));
      ctx.globalAlpha = fade * (0.35 + 0.65 * v);
      ctx.fillStyle = k % 4 === 0 ? 'rgba(255,235,190,0.95)' : col(0.9);
      ctx.beginPath();
      ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (id === 7) {
    // Разряд: ломаные молнии во все стороны.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let k = 0; k < 6; k++) {
      const base = (k * Math.PI * 2) / 6 + p * 0.4;
      ctx.strokeStyle = k % 2 ? 'rgba(255,255,255,0.9)' : col(0.95);
      ctx.lineWidth = Math.max(1.2, cell * 0.11 * (1 - p * 0.5));
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      let ang = base;
      let rr = 0;
      for (let s = 0; s < 4; s++) {
        rr += (R * 1.2 * p) / 4;
        ang += ((((k * 7 + s * 13) % 11) / 11) - 0.5) * 1.1;
        ctx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      }
      ctx.stroke();
    }
  } else {
    // 0 — Вспышка: базовый бесплатный вариант.
    const rr = R * (0.2 + 1.1 * p);
    ctx.strokeStyle = col(0.95);
    ctx.lineWidth = Math.max(1.5, cell * 0.18 * (1 - p * 0.6));
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = fade * Math.max(0, 1 - p * 1.6);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.4 * (1 - p), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/* --- TITLE: заголовок перед ником ------------------------------------------
   Титулы не продаются: сервер присылает `titleMask` (что открыто) и `titleId`
   (что надето), экипировка уходит сообщением `titleEquip`. */

// Идентификаторы и порядок совпадают с таблицей titleRules на сервере (12 шт.).
// Сервер дополнительно шлёт свой список в `hello.titles` — он используется как
// подстраховка, если серверный набор титулов вырастет раньше клиента.
const COS_TITLE_MAX = 12;
const cosTitleServerNames = new Map();

function cosTitleName(id) {
  const i = Math.max(0, Number(id) || 0);
  if (i === 0) return '';
  const en = lang === 'en';
  const list = en
    ? ['', 'Fighter', 'Crusher', 'Legend', 'Landlord', 'Cartographer', 'Avenger',
       'Contractor', 'Executor', 'Bounty Hunter', 'Trendsetter', 'Regular', 'Devoted']
    : ['', 'Боец', 'Нагибатор', 'Легенда', 'Землевладелец', 'Картограф', 'Мститель',
       'Подрядчик', 'Исполнитель', 'Охотник за головами', 'Модник', 'Завсегдатай', 'Преданный'];
  return list[i] || cosTitleServerNames.get(i) || '';
}

function cosTitleReq(id) {
  const i = Math.max(0, Number(id) || 0);
  const en = lang === 'en';
  const list = en
    ? ['', '10 kills', '100 kills', '1000 kills', '10 000 cells captured', '100 000 cells captured',
       '15 revenge kills', '25 contracts completed', '100 contracts completed', '15 bounties claimed',
       '10 000 Style earned', '7-day play streak', '30-day play streak']
    : ['', '10 убийств', '100 убийств', '1000 убийств', '10 000 захваченных клеток',
       '100 000 захваченных клеток', '15 убийств мести', '25 выполненных контрактов',
       '100 выполненных контрактов', '15 собранных наград', '10 000 заработанного стиля',
       'Серия из 7 дней', 'Серия из 30 дней'];
  return list[i] || '';
}

// Титул перед ником: «⟨Охотник⟩ Вася». Возвращает готовую строку для плашки
// в канвасе, где никакой разметки быть не может.
function cosTitlePrefix(titleId) {
  const nm = cosTitleName(titleId);
  return nm ? `«${nm}» ` : '';
}

// В HTML-таблицах титул — отдельный элемент .playerTitle первым потомком
// ячейки имени, а не часть текста: у него своя вёрстка и своё усечение.
function playerTitleHtml(titleId) {
  const nm = cosTitleName(titleId);
  return nm ? `<span class="playerTitle">${escapeHtml(nm)}</span>` : '';
}

// То же для DOM-пути таблицы лидеров, которая обновляется каждый кадр:
// пересобираем ячейку только при смене титула или ника.
function setNameCellWithTitle(td, titleId, name) {
  if (!td) return;
  const tid = Math.max(0, Number(titleId) || 0);
  const nm = String(name || '');
  if (td._tid === tid && td._nm === nm) return;
  td._tid = tid;
  td._nm = nm;
  const tn = cosTitleName(tid);
  if (!tn) {
    td.textContent = nm;
    return;
  }
  const sp = document.createElement('span');
  sp.className = 'playerTitle';
  sp.textContent = tn;
  td.replaceChildren(sp, document.createTextNode(nm));
}

/* --- FRAME: рамка профиля --------------------------------------------------
   Единственная чисто CSS-категория: классы .frame0..frame7 навешиваются на
   строки таблицы лидеров и итогов матча. В канвасе рисуется только имитация
   этой строки — та же логика цвета берётся из одной таблицы. */
const COS_FRAME_STYLE = [
  { edge: '#6b7280', wash: 'rgba(107,114,128,0.16)', name: 'rgba(229,231,235,0.92)' },
  { edge: '#b87333', wash: 'rgba(184,115,51,0.20)', name: 'rgba(255,224,196,0.95)' },
  { edge: '#c9d1d9', wash: 'rgba(201,209,217,0.18)', name: 'rgba(255,255,255,0.96)' },
  { edge: '#34d399', wash: 'rgba(52,211,153,0.20)', name: 'rgba(209,250,229,0.96)' },
  { edge: '#4c1d95', wash: 'rgba(76,29,149,0.42)', name: 'rgba(237,233,254,0.96)' },
  { edge: '#e5e7eb', wash: 'rgba(229,231,235,0.14)', name: 'rgba(255,255,255,0.96)' },
  { edge: '#d4a017', wash: 'rgba(212,160,23,0.22)', name: 'rgba(255,243,205,0.96)' },
  { edge: '#1f2937', wash: 'rgba(31,41,55,0.55)', name: 'rgba(203,213,225,0.96)' }
];

function cosFrameStyle(frId) {
  return COS_FRAME_STYLE[cosClampId(frId)] || COS_FRAME_STYLE[0];
}

// Строка таблицы лидеров с рамкой — ровно то место, где рамка видна в игре.
function drawFrameRow(ctx, x, y, w, h, frId, rank, name, score, highlight) {
  const st = cosFrameStyle(frId);
  const fs = Math.max(10, Math.round(h * 0.46));
  ctx.save();
  ctx.fillStyle = highlight ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.025)';
  ctx.fillRect(x, y, w, h);
  if (highlight) {
    const g = ctx.createLinearGradient(x, y, x + w * 0.7, y);
    g.addColorStop(0, st.wash);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = st.edge;
    ctx.fillRect(x, y, 3, h);
    const fr = cosClampId(frId);
    if (fr === 2 || fr === 5) {
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.fillRect(x, y, w, 1);
    }
    if (fr === 7) {
      ctx.strokeStyle = 'rgba(148,163,184,0.35)';
      ctx.lineWidth = 1;
      for (let k = -h; k < w; k += 6) {
        ctx.beginPath();
        ctx.moveTo(x + k, y + h);
        ctx.lineTo(x + k + h, y);
        ctx.stroke();
      }
    }
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, y, 3, h);
  }
  ctx.font = `${fs}px ${COS_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = highlight ? st.name : 'rgba(229,231,235,0.62)';
  ctx.fillText(String(rank), x + 12, y + h / 2);
  if (highlight && (cosClampId(frId) === 3 || cosClampId(frId) === 6)) {
    ctx.save();
    ctx.shadowColor = st.edge;
    ctx.shadowBlur = 8;
    ctx.fillText(String(name), x + 34, y + h / 2);
    ctx.restore();
  } else {
    ctx.fillText(String(name), x + 34, y + h / 2);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = highlight ? 'rgba(255,255,255,0.88)' : 'rgba(229,231,235,0.55)';
  ctx.fillText(String(score), x + w - 12, y + h / 2);
  ctx.restore();
}

/* --- Мини-иконка карточки магазина ----------------------------------------
   Использует ровно те же функции, что и игра. Backing store умножается на
   devicePixelRatio, иначе иконка мылится на retina и на мобильном. */
function cosPrepCanvas(canvasEl, cssW, cssH) {
  const dpr = Math.max(1, Math.min(3, Number(window.devicePixelRatio) || 1));
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  // Размер на экране задаёт CSS; здесь только backing store под devicePixelRatio.
  if (canvasEl.width !== bw) canvasEl.width = bw;
  if (canvasEl.height !== bh) canvasEl.height = bh;
  const c = canvasEl.getContext('2d');
  if (!c) return null;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, cssW, cssH);
  return c;
}

function drawMiniCosmeticPreview(canvasEl, cat, id) {
  if (!canvasEl) return;
  const W = 44;
  const H = 44;
  const c = cosPrepCanvas(canvasEl, W, H);
  if (!c) return;
  c.fillStyle = 'rgba(0,0,0,0.26)';
  c.fillRect(0, 0, W, H);

  const base = boostHsl(colors.get(you) || 'hsl(210 20% 60%)');
  const cx = W / 2;
  const cy = H / 2;
  const now = performance.now();

  if (cat === 'frame') {
    drawFrameRow(c, 2, 8, W - 4, 13, id, 1, '', '', false);
    drawFrameRow(c, 2, 22, W - 4, 14, id, 2, '', '', true);
    return;
  }

  if (cat === 'capturefx') {
    // Иконка проигрывает тот же цикл, что и игра, только короче.
    const p = ((now % 1400) / 1400);
    c.save();
    c.translate(0, 0);
    drawCaptureFx(c, cx, cy, 13, base, id, p);
    c.restore();
    return;
  }

  if (cat === 'seg') {
    // Квадратные плитки — ровно как след в игре (раньше рисовалась цепочка кружков).
    const cell = 13;
    for (let i = 0; i < 3; i++) {
      drawSegTile(c, 2 + i * cell, cy - cell / 2, cell, base, id, i, 0.95, now);
    }
    drawHead(c, 2 + 3 * cell + cell * 0.5, cy, cell, base, 0, 1, 0, now);
    return;
  }

  if (cat === 'nameplate') {
    drawNamePlate(c, 'YOU', cx, cy + 9, base, id, 0.98, 10, now);
    return;
  }

  if (cat === 'head') {
    drawHead(c, cx - 3, cy, 34, base, id, 1, 0, now);
    return;
  }

  if (cat === 'terr') {
    // 2×2 клетки территории — тот же узор, что и на поле.
    const cell = 20;
    const ox = (W - cell * 2) / 2;
    const oy = (H - cell * 2) / 2;
    for (let gy = 0; gy < 2; gy++) {
      for (let gx = 0; gx < 2; gx++) {
        drawTerrTile(c, ox + gx * cell, oy + gy * cell, cell, base, id, gx, gy, 0.72, now);
      }
    }
    if (cosClampId(id) === 5) {
      drawTerrSeam(c, ox, oy, cell * 2, base, 15, 0.9, true);
    }
    return;
  }

  if (cat === 'death') {
    // Иконка статична (перерисовывается только при пересборке списка), поэтому
    // берём фазу середины эффекта — на случайной фазе он был бы уже погасшим.
    drawDeathFx(c, cx, cy, 11, base, id, 0.42);
    return;
  }

  if (cat === 'title') {
    c.save();
    c.font = `700 11px ${COS_FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillText(id === 0 ? '—' : '«»', cx, cy);
    c.restore();
    return;
  }
}

function wsSend(type, data) {
  return net.send(type, data) !== false;
}

function wsIsConnected() {
  try {
    return net?.isConnected?.() === true;
  } catch {
    return false;
  }
}

function wsStatusSuffix() {
  return net.statusSuffix();
}

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statsEl = document.getElementById('stats');

 ctx.imageSmoothingEnabled = true;
 ctx.imageSmoothingQuality = 'high';

const nameInput = document.getElementById('nameInput');
const nameBtn = document.getElementById('nameBtn');
const minimap = document.getElementById('minimap');
const mmCtx = minimap.getContext('2d');
const chat = document.getElementById('chat');

 mmCtx.imageSmoothingEnabled = true;
 mmCtx.imageSmoothingQuality = 'high';
const chatHeader = document.getElementById('chatHeader');
const chatLog = document.getElementById('chatLog');
const chatForm = document.getElementById('chatForm');
let chatInput = document.getElementById('chatInput');
const chatInputOverlay = document.getElementById('chatInputOverlay');
const emojiBtn = document.getElementById('emojiBtn');
const chatBtn = document.getElementById('chatBtn');
const emojiPanel = document.getElementById('emojiPanel');
const emojiSearch = document.getElementById('emojiSearch');
const emojiCloseBtn = document.getElementById('emojiCloseBtn');
const emojiRecent = document.getElementById('emojiRecent');
const emojiGrid = document.getElementById('emojiGrid');
const perfEl = document.getElementById('perf');
const roomInfoEl = document.getElementById('roomInfo');
const chatUnreadEl = document.getElementById('chatUnread');
const chatHeaderHintEl = document.getElementById('chatHeaderHint');

const hudEl = document.getElementById('hud');
const lbBtn = document.getElementById('lbBtn');

const topHudEl = document.getElementById('topHud');
const topHudCellsEl = document.getElementById('topHudCells');
const topHudPctEl = document.getElementById('topHudPct');
const topHudTimeEl = document.getElementById('topHudTime');
const topHudKillsEl = document.getElementById('topHudKills');
const topHudContractEl = document.getElementById('topHudContract');
const topHudBarFillEl = document.getElementById('topHudBarFill');

const metaHudEl = document.getElementById('metaHud');
const teamHudEl = document.getElementById('teamHud');
const killfeedEl = document.getElementById('killfeed');
const eventToastsEl = document.getElementById('eventToasts');
const settingsBtn = document.getElementById('settingsBtn');
const settingsOverlay = document.getElementById('settingsOverlay');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const hudDensitySelect = document.getElementById('hudDensitySelect');
const fxEnabledInput = document.getElementById('fxEnabled');
const fxIntensityInput = document.getElementById('fxIntensity');
const shakeIntensityInput = document.getElementById('shakeIntensity');
const perfEnabledInput = document.getElementById('perfEnabled');
const perfCompactInput = document.getElementById('perfCompact');
const soundEnabledInput = document.getElementById('soundEnabled');
const soundVolumeInput = document.getElementById('soundVolume');
const muteOnBlurInput = document.getElementById('muteOnBlur');
const testBeepBtn = document.getElementById('testBeepBtn');
const resetSettingsBtn = document.getElementById('resetSettingsBtn');

const hudBrightnessInput = document.getElementById('hudBrightness');
const hudContrastInput = document.getElementById('hudContrast');
const hudPanelOpacityInput = document.getElementById('hudPanelOpacity');

const menuOverlay = document.getElementById('menuOverlay');

const menuNameInput = document.getElementById('menuNameInput');
const menuNameError = document.getElementById('menuNameError');
const menuNameRandomBtn = document.getElementById('menuNameRandomBtn');
const menuOnboarding = document.getElementById('menuOnboarding');

const playBtn = document.getElementById('playBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const toggleCreateRoomBtn = document.getElementById('toggleCreateRoomBtn');
const refreshRoomsBtn = document.getElementById('refreshRoomsBtn');

const roomsStatsEl = document.getElementById('roomsStats');
const roomsListEl = document.getElementById('roomsList');
const roomsSearchInput = document.getElementById('roomsSearchInput');
const roomsSearchClearBtn = document.getElementById('roomsSearchClearBtn');
const roomsSortSelect = document.getElementById('roomsSortSelect');
const roomsCreateEl = document.getElementById('roomsCreate');
const roomsCreateNameInput = document.getElementById('roomsCreateNameInput');
const roomsCreateError = document.getElementById('roomsCreateError');
const createRoomBtn = document.getElementById('createRoomBtn');
const leaveBtn = document.getElementById('leaveBtn');
const langToggleGlobal = document.getElementById('langToggleGlobal');
const deathOverlay = document.getElementById('deathOverlay');
const restartBtn = document.getElementById('restartBtn');
const deathMenuBtn = document.getElementById('deathMenuBtn');
const deathReasonEl = document.getElementById('deathReason');
const deathStatsEl = document.getElementById('deathStats');

const matchOverlay = document.getElementById('matchOverlay');
const matchResultsEl = document.getElementById('matchResults');
const matchCountdownEl = document.getElementById('matchCountdown');
const matchContinueBtn = document.getElementById('matchContinueBtn');
const matchMenuBtn = document.getElementById('matchMenuBtn');
const matchActionsEl = matchOverlay?.querySelector?.('.matchActions') || null;

const overlayManager = (() => {
  const stack = [];
  const defs = new Map();

  const normalize = (id) => String(id || '').trim();

  const register = (id, def) => {
    const k = normalize(id);
    if (!k) return;
    defs.set(k, def || {});
  };

  const isOpen = (id) => {
    const k = normalize(id);
    return k ? stack.includes(k) : false;
  };

  const open = (id) => {
    const k = normalize(id);
    if (!k) return;
    const i = stack.lastIndexOf(k);
    if (i >= 0) stack.splice(i, 1);
    stack.push(k);
  };

  const close = (id) => {
    const k = normalize(id);
    if (!k) return;
    const i = stack.lastIndexOf(k);
    if (i >= 0) stack.splice(i, 1);
  };

  const getTop = () => {
    if (!stack.length) return null;
    return stack[stack.length - 1] || null;
  };

  const getTopDef = () => {
    const top = getTop();
    return top ? defs.get(top) : null;
  };

  const getRoot = (def) => {
    if (!def) return null;
    const r = def.root;
    if (typeof r === 'function') return r();
    return r || null;
  };

  const getDefaultFocus = (def) => {
    if (!def) return null;
    const root = getRoot(def);
    const df = def.defaultFocus;
    if (typeof df === 'function') return df();
    if (typeof df === 'string' && root) return root.querySelector(df);
    return null;
  };

  const focusDefault = (id) => {
    const k = normalize(id);
    const def = k ? defs.get(k) : null;
    if (!def) return;
    const root = getRoot(def);
    const target = getDefaultFocus(def) || focusablesIn(root)[0];
    if (!target) return;
    try {
      requestAnimationFrame(() => target?.focus?.());
    } catch {}
  };

  const trapFocus = (e) => {
    const def = getTopDef();
    if (!def || def.trap === false) return false;
    const root = getRoot(def);
    if (!root) return false;
    trapFocusIn(root, e);
    return true;
  };

  const closeTop = () => {
    const id = getTop();
    if (!id) return false;
    const def = defs.get(id);
    if (!def || def.closable === false) return false;
    try {
      def.close?.();
    } catch {}
    return true;
  };

  return {
    register,
    isOpen,
    open,
    close,
    getTop,
    focusDefault,
    trapFocus,
    closeTop
  };
})();

const cosmeticsBtn = document.getElementById('cosmeticsBtn');
const cosmeticsMenuBtn = document.getElementById('cosmeticsMenuBtn');
const cosmeticsOverlay = document.getElementById('cosmeticsOverlay');
const cosmeticsCloseBtn = document.getElementById('cosmeticsCloseBtn');
const cosmeticsStyleEl = document.getElementById('cosmeticsStyle');
const cosmeticsEarnStyleEl = document.getElementById('cosmeticsEarnStyle');
const cosmeticsTabsEl = document.getElementById('cosmeticsTabs');
const cosmeticsItemsEl = document.getElementById('cosmeticsItems');
const cosmeticsPreview = document.getElementById('cosmeticsPreview');
const cosmeticsHintEl = document.getElementById('cosmeticsHint');

const cosmeticsStyleInfoBtn = document.getElementById('cosmeticsStyleInfoBtn');
const cosmeticsFilterAllBtn = document.getElementById('cosmeticsFilterAll');
const cosmeticsFilterOwnedBtn = document.getElementById('cosmeticsFilterOwned');
const cosmeticsFilterAvailableBtn = document.getElementById('cosmeticsFilterAvailable');

const rightSidebarEl = document.getElementById('rightSidebar');
const rightInfoEl = document.getElementById('rightInfo');
const rightMatchDetailsEl = document.getElementById('rightMatchDetails');
const rightTeamDetailsEl = document.getElementById('rightTeamDetails');
const rightTabButtons = Array.from(document.querySelectorAll('#rightTabs .rightTabBtn'));
const rightTabMatchEl = document.getElementById('rightTabMatch');
const rightTabTeamEl = document.getElementById('rightTabTeam');
const rightTabChatEl = document.getElementById('rightTabChat');

overlayManager.register('menu', {
  root: () => menuOverlay,
  defaultFocus: () => menuNameInput,
  close: () => hideMenuOverlay(),
  closable: false
});
overlayManager.register('settings', {
  root: () => settingsOverlay,
  defaultFocus: () => closeSettingsBtn || settingsOverlay?.querySelector('input, select, button'),
  close: () => hideSettingsOverlay()
});
overlayManager.register('cosmetics', {
  root: () => cosmeticsOverlay,
  defaultFocus: () => cosmeticsCloseBtn,
  close: () => hideCosmeticsOverlay()
});
overlayManager.register('match', {
  root: () => matchOverlay,
  defaultFocus: () => (!matchContinueBtn?.disabled ? matchContinueBtn : matchMenuBtn),
  close: () => matchMenuBtn?.click?.()
});
overlayManager.register('death', {
  root: () => deathOverlay,
  defaultFocus: () => restartBtn,
  close: () => deathMenuBtn?.click?.()
});

try {
  if (menuOverlay && !menuOverlay.classList.contains('hidden')) overlayManager.open('menu');
  if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) overlayManager.open('settings');
  if (cosmeticsOverlay && !cosmeticsOverlay.classList.contains('hidden')) overlayManager.open('cosmetics');
  if (matchOverlay && !matchOverlay.classList.contains('hidden')) overlayManager.open('match');
  if (deathOverlay && !deathOverlay.classList.contains('hidden')) overlayManager.open('death');
} catch {}

function ensureChatTextarea() {
  if (!chatInput || chatInput.tagName === 'TEXTAREA') return;
  const prev = chatInput;
  const ta = document.createElement('textarea');
  ta.id = prev.id;
  ta.placeholder = prev.getAttribute('placeholder') || '';
  ta.maxLength = prev.maxLength;
  ta.autocomplete = prev.autocomplete;
  ta.autocapitalize = prev.autocapitalize;
  ta.autocorrect = prev.getAttribute('autocorrect') || '';
  ta.spellcheck = prev.spellcheck;
  ta.rows = 1;
  ta.value = prev.value || '';
  for (const a of prev.getAttributeNames()) {
    if (a === 'id') continue;
    if (a === 'value') continue;
    if (a === 'placeholder') continue;
    try {
      if (!ta.hasAttribute(a)) ta.setAttribute(a, prev.getAttribute(a) || '');
    } catch {}
  }
  try {
    prev.replaceWith(ta);
  } catch {
    return;
  }
  chatInput = ta;
}

ensureChatTextarea();

try {
  if (emojiBtn) emojiBtn.classList.add('iconBtn');
  if (chatBtn) {
    chatBtn.classList.add('iconBtn');
    chatBtn.replaceChildren();
    const s = document.createElement('span');
    s.setAttribute('aria-hidden', 'true');
    s.textContent = '➤';
    chatBtn.appendChild(s);
  }
} catch {}

const rightTabMatchBtn = rightTabButtons.find((b) => String(b?.dataset?.tab || '') === 'match') || null;
let matchTabBadgeCount = 0;
const matchTabBadgeEl = (() => {
  if (!rightTabMatchBtn) return null;
  const el = document.createElement('span');
  el.className = 'tabBadge hidden';
  el.setAttribute('aria-hidden', 'true');
  rightTabMatchBtn.appendChild(el);
  return el;
})();

let W = 0;
let H = 0;
let N = 0;
let you = 0;
let tickMs = 100;
let mapCells = 0;
let roomId = null;

/* K7 «Реконнект». roomId комнаты, в которую нужно вернуться после разрыва:
   ставится в onClose, гасится после успешного onInit или явного выхода.
   userLeftRoom отличает «игрок нажал Выйти» от «сеть отвалилась». */
let rejoinRoomId = null;
let rejoinPending = false;
let userLeftRoom = false;
let roomLimit = null;

let matchSeq = 0;
let matchEndTick = 0;
let matchEnded = false;
let matchResetAt = 0;

let matchStyleEarned = 0;

let matchContinuePending = false;
let matchContinueTimeout = 0;
let matchAutoJoin = localStorage.getItem('matchAutoJoin') !== '0';
let lastMatchResults = null;

let mutatorType = 0;
let mutatorUntil = 0;
let bountyTarget = 0;
let bountyUntil = 0;
let powerUps = new Map();

let youKills = 0;
let youStreak = 0;

const eventFeed = [];

const toastByKey = new Map();
const toastQueue = [];
const MAX_EVENT_TOASTS = 3;

// J19: приоритеты вместо чистого FIFO — иначе ачивка ждёт за тремя «+15 Стиля».
const TOAST_PRIO = { minor: 0, important: 1, jackpot: 2 };

function toastPrioValue(name) {
  return TOAST_PRIO[String(name || 'minor')] ?? 0;
}

function toastDrain() {
  if (!eventToastsEl) return;
  while (eventToastsEl.children.length < MAX_EVENT_TOASTS && toastQueue.length) {
    // Берём самый приоритетный, при равенстве — самый старый.
    let best = -1;
    let bestPrio = -1;
    for (let i = 0; i < toastQueue.length; i++) {
      const it = toastByKey.get(toastQueue[i]);
      if (!it || it.el) continue;
      const pv = toastPrioValue(it.prio);
      if (pv > bestPrio) {
        bestPrio = pv;
        best = i;
      }
    }
    if (best < 0) {
      toastQueue.length = 0;
      return;
    }
    const nextKey = toastQueue.splice(best, 1)[0];
    const next = toastByKey.get(nextKey);
    if (!next || next.el) continue;
    toastMount(next);
  }
}

// Смонтированный тост с наименьшим приоритетом — кандидат на вытеснение.
function toastLowestMounted() {
  let worst = null;
  let worstPrio = Infinity;
  for (const it of toastByKey.values()) {
    if (!it?.el) continue;
    const pv = toastPrioValue(it.prio);
    if (pv < worstPrio) {
      worstPrio = pv;
      worst = it;
    }
  }
  return worst;
}

function toastUnmount(item) {
  if (!item) return;
  try {
    if (item.timer) clearTimeout(item.timer);
  } catch {}
  item.timer = 0;
  try {
    item.el?.remove?.();
  } catch {}
  item.el = null;
  item.textEl = null;
  toastByKey.delete(item.key);
}

// J7: пульс при повторе события — с рефлоу-сбросом, иначе анимация не рестартует.
function toastBump(el) {
  if (!el) return;
  try {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  } catch {}
}

function toastMount(item) {
  if (!eventToastsEl || !item) return;
  const wrap = document.createElement('div');
  wrap.className = item.variant === 'big' ? 'eventToast eventToastBig' : 'eventToast';

  const ic = document.createElement('div');
  ic.className = 'eventToastIcon';
  ic.textContent = String(item.icon || '★');

  const body = document.createElement('div');
  body.style.display = 'grid';
  body.style.gap = '2px';

  const tx = document.createElement('div');
  tx.className = 'eventToastText';
  const baseText = String(item.baseText || item.text || '');
  tx.textContent = item.count > 1 ? `${baseText} x${item.count}` : baseText;
  body.appendChild(tx);

  const sub = String(item.subtext || '').trim();
  if (sub) {
    const subEl = document.createElement('div');
    subEl.className = 'eventToastSub';
    subEl.textContent = sub;
    body.appendChild(subEl);
  }

  wrap.appendChild(ic);
  wrap.appendChild(body);

  if (item.action && typeof item.action === 'object') {
    wrap.classList.add('eventToastAction');
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('aria-label', baseText);
    const run = () => {
      const tab = String(item.action?.tab || '');
      if (tab === 'match' || tab === 'team' || tab === 'chat') setRightTab(tab, true);
    };
    wrap.addEventListener('click', (e) => {
      e?.preventDefault?.();
      run();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === ' ') {
        e.preventDefault();
        run();
      }
    });
  }

  eventToastsEl.prepend(wrap);
  item.el = wrap;
  item.textEl = tx;

  const ttl = item.variant === 'big' ? 8200 : 2200;
  if (item.variant === 'big') {
    bigToastCooldownUntil = performance.now() + 2500;
    // J21: класс .eventToastBig раньше снимался через 2100 мс при живущем
    // 8200 мс тосте — 3/4 времени «крупный» тост выглядел обычным.
    // Теперь модификатор держится всю жизнь тоста.
  }

  item.timer = setTimeout(() => {
    try {
      wrap.remove();
    } catch {}
    toastByKey.delete(item.key);
    toastDrain();
  }, ttl);
}

let lastEventsTick = 0;
let lastEventsAt = 0;

let bigToastCooldownUntil = 0;

let youShield = false;
let youSpeedUntilTick = 0;
let youSpeedType = 0;

let youStyle = 0;
let youCosInvCaptureFx = 0;
let youCosInvHead = 0;
let youCosInvSeg = 0;
let youCosInvNameplate = 0;
let youCosInvFrame = 0;
let youCosEqCaptureFx = 0;
let youCosEqHead = 0;
let youCosEqSeg = 0;
let youCosEqNameplate = 0;
let youCosEqFrame = 0;

// Новые категории приходят отдельным JSON-сообщением `cosExtra` (бинарный
// ROI-снапшот остаётся 21-байтным и не меняется). Сообщения может не быть
// вовсе — тогда всё по нулям и всё выглядит как базовый вариант.
let youCosInvTerr = 0;
let youCosInvDeath = 0;
let youCosEqTerr = 0;
let youCosEqDeath = 0;
let youTitleId = 0;
let youTitleMask = 0;

// Экипировка новых категорий по номерам игроков (из cosExtra).
const cosTerrByPlayer = new Map();
const cosDeathByPlayer = new Map();
const cosTitleByPlayer = new Map();

let cosmeticsOpen = false;
let cosmeticsCat = 'terr';
let cosmeticsSelId = 0;

// Последняя категория, к которой уже подскроллили ленту вкладок.
let cosmeticsTabsScrolledCat = '';

let cosmeticsFilter = 'all';
let cosmeticsEarnExpanded = false;

let cosmeticsLoaded = false;

let cosmeticsSource = 'server';

let cosmeticsPrices = null;

let cosmeticsPreviewRaf = 0;

let cosmeticsPreviewLastAt = 0;

// Превью реагирует на наведение/фокус карточки; по уходу курсора возвращается
// к выбранному варианту.
let cosmeticsHoverId = null;
let cosmeticsHoverCat = null;

let pendingCosmeticsOp = null;
let cosmeticsOpTimer = 0;

const COSMETICS_CACHE_KEY = 'snakes_cosmetics_cache_v1';
const COSMETICS_DESIRED_KEY = 'snakes_cosmetics_desired_v1';

let styleToastAcc = 0;
let styleToastReason = 0;
let styleToastCount = 0;
let styleToastTimer = 0;
let youContractType = 0;
let youContractGoal = 0;
let youContractProgress = 0;
let youContractUntil = 0;

let youDaily1Type = 0;
let youDaily1Goal = 0;
let youDaily1Prog = 0;
let youDaily2Type = 0;
let youDaily2Goal = 0;
let youDaily2Prog = 0;

let fxEnabled = true;
let fxIntensity = 0.85;
let shakeIntensity = 0.55;
let perfEnabled = false;
let perfCompact = false;
let soundEnabled = true;
let soundVolume = 0.7;
let muteOnBlur = true;
let hudBrightness = 1;
let hudContrast = 1;
let hudPanelOpacity = 0.82;

let hudDensity = 'comfy';

let soundMutedByBlur = false;

const fxBursts = [];
const fxParticles = [];
let shakeX = 0;
let shakeY = 0;
let shakeVelX = 0;
let shakeVelY = 0;

const audio = createAudioModule();
const fx = createFxModule();

function audioState() {
  return {
    soundEnabled: soundEnabled && !soundMutedByBlur,
    soundVolume: Math.max(0, Math.min(1, (Number(soundVolume) || 0) * fxVolumeScale()))
  };
}

audio.configure(audioState);

function playBeep(freq, ms, vol) {
  audio.playBeep(freq, ms, vol, audioState);
}

function applyHudSettings() {
  const b = document.body;
  if (!b) return;
  try {
    b.style.setProperty('--hud-brightness', String(hudBrightness));
    b.style.setProperty('--hud-contrast', String(hudContrast));
    b.style.setProperty('--hud-panel-alpha', String(hudPanelOpacity));
  } catch {}
}

function getHudDensityDefault() {
  try {
    const raw = localStorage.getItem(HUD_DENSITY_KEY);
    if (raw === 'comfy' || raw === 'compact') return raw;
  } catch {}
  return 'comfy';
}

function applyHudDensity(next) {
  const v = String(next || 'comfy');
  if (v !== 'comfy' && v !== 'compact') return;
  hudDensity = v;
  try {
    document.body.dataset.hudDensity = hudDensity;
  } catch {}
  try {
    localStorage.setItem(HUD_DENSITY_KEY, hudDensity);
  } catch {}
  if (hudDensitySelect) {
    try {
      hudDensitySelect.value = hudDensity;
    } catch {}
  }
}

function applyPerfUi() {
  if (perfEl) perfEl.classList.toggle('perfCompact', !!perfCompact);
}

function addFxBurst(x, y, kind, extra) {
  fx.addFxBurst(x, y, kind, () => ({ fxEnabled, fxBursts, shakeIntensity, addShakeVel }), extra);
}

function addShake(amount, dirX, dirY) {
  fx.addShake(amount, () => ({ shakeIntensity, addShakeVel }), dirX, dirY);
}

function addShakeVel(dx, dy) {
  shakeVelX += dx;
  shakeVelY += dy;
}

/* ==========================================================================
 * J22 — пресеты эффектов
 * ======================================================================== */

const FX_PRESET_KEY = 'fxPreset';
const FX_PRESETS = {
  calm: { shake: 0, flash: 0, particles: 0.35, hitstop: 0, countUp: false, volume: 0.6, banner: true },
  normal: { shake: 1, flash: 1, particles: 1, hitstop: 1, countUp: true, volume: 1, banner: true },
  casino: { shake: 1.45, flash: 1.25, particles: 1.4, hitstop: 1.3, countUp: true, volume: 1.1, banner: true }
};

let fxPreset = 'normal';
// Ручное переопределение авто-падения в «Спокойно» при prefers-reduced-motion.
let fxPresetUserSet = false;

function prefersReducedMotion() {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {}
  return false;
}

function fxPresetDef() {
  return FX_PRESETS[fxPreset] || FX_PRESETS.normal;
}

function fxShakeScale() {
  // K7: единственная из пяти fx-функций, которая не уважала системный запрет
  // анимаций. Тряска экрана — ровно то, что prefers-reduced-motion выключает.
  if (prefersReducedMotion()) return 0;
  return Math.max(0, fxPresetDef().shake);
}

// J9: вспышки жёстко выключены при системном запрете анимаций и в «Спокойно».
function fxFlashScale() {
  if (prefersReducedMotion()) return 0;
  return Math.max(0, fxPresetDef().flash);
}

function fxParticleScale() {
  return Math.max(0, fxPresetDef().particles);
}

function fxHitstopScale() {
  if (prefersReducedMotion()) return 0;
  return Math.max(0, fxPresetDef().hitstop);
}

function fxCountUpEnabled() {
  if (prefersReducedMotion()) return false;
  return !!fxPresetDef().countUp;
}

function fxBannerEnabled() {
  return !!fxPresetDef().banner;
}

function fxVolumeScale() {
  return Math.max(0, fxPresetDef().volume);
}

/* ==========================================================================
 * J12 — hitstop
 *
 * На джекпот-события интерполяция игроков идёт с множителем 0.15 в течение
 * 90-140 мс. Эффекты (вспышки, бурсты, тосты) живут по реальному времени —
 * замедляется только движение змеек, поэтому удар «звенит», а не тормозит UI.
 * В пресете «Спокойно» hitstop равен 0 и весь механизм выключен.
 * ======================================================================== */

const HITSTOP_TIME_SCALE = 0.15;

let hitstopFrom = 0;
let hitstopUntil = 0;

function triggerHitstop(ms) {
  const k = fxHitstopScale();
  if (k <= 0) return;
  const dur = Math.max(0, Number(ms) || 0) * k;
  if (dur <= 0) return;
  const now = performance.now();
  if (now < hitstopUntil) {
    hitstopUntil = Math.max(hitstopUntil, now + dur);
    return;
  }
  hitstopFrom = now;
  hitstopUntil = now + dur;
}

// Сколько «съел» hitstop из окна [since, now]. Вычитается из времени
// интерполяции, поэтому змейки в эти миллисекунды почти стоят.
function hitstopLostMs(since, now) {
  if (!hitstopUntil) return 0;
  const s = Math.max(hitstopFrom, Number(since) || 0);
  const e = Math.min(now, hitstopUntil);
  if (e <= s) return 0;
  return (e - s) * (1 - HITSTOP_TIME_SCALE);
}

function normalizeFxPreset(v) {
  const s = String(v || '').trim();
  return FX_PRESETS[s] ? s : '';
}

function applyFxPreset(next, fromUser) {
  const v = normalizeFxPreset(next);
  if (!v) return;
  fxPreset = v;
  if (fromUser) fxPresetUserSet = true;
  try {
    document.body.dataset.fxPreset = fxPreset;
  } catch {}
  const sel = document.getElementById('fxPresetSelect');
  if (sel) {
    try {
      sel.value = fxPreset;
    } catch {}
  }
}

/* ==========================================================================
 * J6 — count-up чисел
 * ======================================================================== */

const numberAnims = new WeakMap();

function easeOutCubic(p) {
  const t = Math.max(0, Math.min(1, p));
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(p) {
  const t = Math.max(0, Math.min(1, p));
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function cancelNumberAnim(el) {
  const prev = numberAnims.get(el);
  if (!prev) return;
  try {
    if (prev.raf) cancelAnimationFrame(prev.raf);
  } catch {}
  try {
    if (prev.to) clearTimeout(prev.to);
  } catch {}
  numberAnims.delete(el);
  try {
    el.classList.remove('counting');
  } catch {}
}

// animateNumber(el, from, to, ms, { delay, prefix, suffix, format, onDone })
function animateNumber(el, from, to, ms, opts) {
  if (!el) return;
  const o = opts || {};
  const fmt = typeof o.format === 'function' ? o.format : (v) => fmtInt(v);
  const pre = String(o.prefix ?? '');
  const suf = String(o.suffix ?? '');
  const a = Number(from) || 0;
  const b = Number(to) || 0;
  const dur = Math.max(0, Number(ms) || 0);
  const delay = Math.max(0, Number(o.delay) || 0);

  cancelNumberAnim(el);

  const write = (v) => {
    try {
      el.textContent = `${pre}${fmt(v)}${suf}`;
    } catch {}
  };

  const finish = () => {
    write(b);
    try {
      el.classList.remove('counting');
    } catch {}
    numberAnims.delete(el);
    try {
      o.onDone?.();
    } catch {}
  };

  const wide = Math.abs(b - a) > 5;
  const animated = dur > 0 && wide && fxCountUpEnabled();

  if (!animated) {
    if (delay > 0) {
      numberAnims.set(el, { raf: 0, to: setTimeout(finish, delay) });
    } else {
      finish();
    }
    return;
  }

  write(a);

  const start = () => {
    const rec = numberAnims.get(el) || { raf: 0, to: 0 };
    rec.to = 0;
    try {
      el.classList.add('counting');
    } catch {}
    const t0 = performance.now();
    const step = () => {
      const p = dur > 0 ? (performance.now() - t0) / dur : 1;
      if (p >= 1) {
        finish();
        return;
      }
      write(a + (b - a) * easeOutCubic(p));
      rec.raf = requestAnimationFrame(step);
      numberAnims.set(el, rec);
    };
    rec.raf = requestAnimationFrame(step);
    numberAnims.set(el, rec);
  };

  if (delay > 0) {
    numberAnims.set(el, { raf: 0, to: setTimeout(start, delay) });
  } else {
    start();
  }
}

/* ==========================================================================
 * J9 — полноэкранная вспышка (#fxFlash)
 * ======================================================================== */

const FX_FLASH_MIN_INTERVAL_MS = 400; // не чаще 2.5 Гц
const FX_FLASH_PEAK_ALPHA = 0.35;
const FX_FLASH_DUR_MS = 280;
const FX_FLASH_RISE_MS = 90;

let fxFlashLastAt = 0;
let fxFlashRaf = 0;

function clampByte(v) {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(255, n));
}

// Красный канал не должен мигать изолированно: подтягиваем G/B под R.
function safeFlashRgb(rgb) {
  let r = clampByte(rgb?.[0]);
  let g = clampByte(rgb?.[1]);
  let b = clampByte(rgb?.[2]);
  const floor = Math.round(r * 0.45);
  if (g < floor) g = floor;
  if (b < floor) b = floor;
  return [r, g, b];
}

function fxFlashScreen(rgb, strength) {
  if (!fxEnabled) return;
  const scale = fxFlashScale();
  if (scale <= 0) return;
  const el = document.getElementById('fxFlash');
  if (!el) return;

  const now = performance.now();
  if (now - fxFlashLastAt < FX_FLASH_MIN_INTERVAL_MS) return;
  fxFlashLastAt = now;

  const [r, g, b] = safeFlashRgb(rgb);
  const s = Math.max(0, Math.min(1, Number(strength ?? 1)));
  const peak = Math.min(FX_FLASH_PEAK_ALPHA, FX_FLASH_PEAK_ALPHA * s * scale);
  if (peak <= 0.005) return;

  try {
    if (fxFlashRaf) cancelAnimationFrame(fxFlashRaf);
  } catch {}
  fxFlashRaf = 0;

  try {
    el.style.transition = 'none';
    el.style.background = `radial-gradient(circle at 50% 50%, rgba(${r},${g},${b},0.90) 0%, rgba(${r},${g},${b},0.42) 42%, rgba(${r},${g},${b},0) 72%)`;
    el.style.opacity = '0';
    el.classList.add('isOn');
  } catch {
    return;
  }

  const t0 = performance.now();
  const step = () => {
    const age = performance.now() - t0;
    if (age >= FX_FLASH_DUR_MS) {
      try {
        el.style.opacity = '0';
        el.classList.remove('isOn');
      } catch {}
      fxFlashRaf = 0;
      return;
    }
    const a =
      age < FX_FLASH_RISE_MS
        ? (age / FX_FLASH_RISE_MS) * peak
        : peak * (1 - (age - FX_FLASH_RISE_MS) / (FX_FLASH_DUR_MS - FX_FLASH_RISE_MS));
    try {
      el.style.opacity = Math.max(0, a).toFixed(3);
    } catch {}
    fxFlashRaf = requestAnimationFrame(step);
  };
  fxFlashRaf = requestAnimationFrame(step);
}

/* ==========================================================================
 * J13 — центральный баннер крупных событий (#bigBanner)
 * ======================================================================== */

const BIG_BANNER_MIN_INTERVAL_MS = 3000;
const BIG_BANNER_TTL_MS = 2600;

let bigBannerLastAt = 0;
let bigBannerTimer = 0;

// Возвращает true, если баннер показан. Иначе вызывающий откатывается на тост.
function showBigBanner(icon, title, sub, mod) {
  if (!fxBannerEnabled()) return false;
  const el = document.getElementById('bigBanner');
  if (!el) return false;

  const now = performance.now();
  if (now - bigBannerLastAt < BIG_BANNER_MIN_INTERVAL_MS) return false;
  bigBannerLastAt = now;

  try {
    if (bigBannerTimer) clearTimeout(bigBannerTimer);
  } catch {}
  bigBannerTimer = 0;

  try {
    el.classList.remove('bannerJackpot', 'bannerDanger');
    const m = String(mod || '');
    if (m === 'jackpot') el.classList.add('bannerJackpot');
    else if (m === 'danger') el.classList.add('bannerDanger');

    const wrap = document.createElement('div');
    wrap.className = 'bigBannerInner';

    const ic = document.createElement('div');
    ic.className = 'bigBannerIcon';
    ic.textContent = String(icon || '★');

    const tt = document.createElement('div');
    tt.className = 'bigBannerTitle';
    tt.textContent = String(title || '');

    wrap.appendChild(ic);
    wrap.appendChild(tt);

    const s = String(sub || '').trim();
    if (s) {
      const se = document.createElement('div');
      se.className = 'bigBannerSub';
      se.textContent = s;
      wrap.appendChild(se);
    }

    el.replaceChildren(wrap);
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    // Перезапуск анимации: снимаем класс, форсируем рефлоу, ставим обратно.
    el.classList.remove('isOn');
    void el.offsetWidth;
    el.classList.add('isOn');
  } catch {
    return false;
  }

  bigBannerTimer = setTimeout(() => {
    bigBannerTimer = 0;
    try {
      el.classList.remove('isOn');
    } catch {}
  }, BIG_BANNER_TTL_MS);
  return true;
}

/* ==========================================================================
 * J14 — классы тряски
 * ======================================================================== */

const SHAKE_CLASSES = { micro: 0.08, small: 0.2, medium: 0.4, large: 0.7 };

function addShakeClass(kind, dirX, dirY) {
  const amt = SHAKE_CLASSES[String(kind || '')] ?? SHAKE_CLASSES.small;
  const scaled = amt * fxShakeScale();
  if (scaled <= 0) return;
  addShake(scaled, dirX, dirY);
}

// Вектор «от точки события к моей голове» — толчок в сторону игрока.
function shakeDirFrom(ex, ey) {
  const me = currPlayers?.get?.(you);
  if (!me) return [0, 0];
  const dx = (Number(me.x) || 0) - (Number(ex) || 0);
  const dy = (Number(me.y) || 0) - (Number(ey) || 0);
  if (!dx && !dy) return [0, 0];
  return [dx, dy];
}

/* ==========================================================================
 * J5 — всплывающие числа над точкой захвата
 * ======================================================================== */

const SCORE_POPUP_MS = 900;
const CAPTURE_JACKPOT_CELLS = 250;

/* F14 — первый захват в жизни игрока празднуется отдельно. */
const FIRST_CAPTURE_KEY = 'snakes_first_capture_v1';

function hasFirstCapture() {
  try {
    return localStorage.getItem(FIRST_CAPTURE_KEY) === '1';
  } catch {}
  return true;
}

function celebrateFirstCapture(delta) {
  if (hasFirstCapture()) return;
  try {
    localStorage.setItem(FIRST_CAPTURE_KEY, '1');
  } catch {}
  trackEvent('first_capture');
  sfx.firstCapture();
  fxFlashScreen([170, 255, 210], 1);
  // J12: момент озарения тоже заслуживает hitstop.
  triggerHitstop(120);
  const sub = `+${fmtInt(delta)} · ${t('banner.first_capture_sub')}`;
  if (!showBigBanner('🎉', t('banner.first_capture'), sub, 'jackpot')) {
    addToast('🎉', t('banner.first_capture'), 'big', sub, { key: 'first_capture', prio: 'jackpot' });
  }
}

function addScorePopup(x, y, value) {
  const v = Math.max(0, Math.round(Number(value) || 0));
  if (!v) return;
  addFxBurst(x, y, 'score', { value: v });
}

/* ==========================================================================
 * J10 — комбо с растущим тоном
 * ======================================================================== */

const COMBO_WINDOW_MS = 3000;
let comboCount = 0;
let comboLastAt = 0;
let comboTimer = 0;

let comboHudSig = '';

function renderComboHud() {
  const el = document.getElementById('hudCombo');
  if (!el) return;
  // renderTopHud вызывается каждый кадр — пересобираем DOM только при изменении.
  const sig = started ? `${youKills}|${comboCount}` : '';
  if (sig === comboHudSig) return;
  comboHudSig = sig;

  const showCombo = comboCount >= 2;
  if (!started) {
    el.classList.remove('isOn');
    el.replaceChildren();
    return;
  }
  try {
    const kills = document.createElement('span');
    kills.className = 'hudComboKills';
    kills.textContent = `⚔ ${youKills}`;

    el.replaceChildren(kills);

    if (showCombo) {
      const c = document.createElement('span');
      c.className = 'hudComboValue';
      c.textContent = `x${comboCount}`;
      const grow = Math.min(2.0, 1 + (comboCount - 2) * 0.14);
      c.style.fontSize = `${(100 * grow).toFixed(0)}%`;
      el.appendChild(c);
    }
    el.classList.toggle('isOn', showCombo || youKills > 0);
  } catch {}
}

function comboBump() {
  const now = performance.now();
  if (now - comboLastAt > COMBO_WINDOW_MS) comboCount = 0;
  comboLastAt = now;
  comboCount++;

  if (comboCount >= 2) {
    // +2 полутона за шаг цепочки.
    const semis = Math.min(24, (comboCount - 2) * 2);
    sfx.comboStep(semis);
  }
  renderComboHud();

  try {
    if (comboTimer) clearTimeout(comboTimer);
  } catch {}
  comboTimer = setTimeout(comboBreak, COMBO_WINDOW_MS + 40);
}

function comboBreak() {
  comboTimer = 0;
  const had = comboCount;
  comboCount = 0;
  renderComboHud();
  if (had >= 2) sfx.comboBreak();
}

function comboReset() {
  try {
    if (comboTimer) clearTimeout(comboTimer);
  } catch {}
  comboTimer = 0;
  comboCount = 0;
  comboLastAt = 0;
  comboHudSig = '';
  renderComboHud();
}

/* ==========================================================================
 * J16-J18 — звуковая палитра
 * ======================================================================== */

// Ноты (Гц)
const NOTE = {
  C3: 130.81,
  E3: 164.81,
  G3: 196.0,
  A3: 220.0,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5,
  E6: 1318.51,
  G6: 1567.98,
  C7: 2093.0,
  E7: 2637.02
};

const sfx = {
  // ——— низ 70-350 Гц: опасность ———
  death() {
    audio.sweep(330, 82, 750, 'sawtooth', {
      vol: 0.9,
      attack: 0.012,
      decay: 0.72,
      filter: { type: 'lowpass', freq: 1400, freq2: 160, q: 1.2 },
      prio: 5
    });
    audio.noiseBurst(240, 'lowpass', 420, { vol: 0.35, attack: 0.004, decay: 0.22, prio: 4 });
  },
  kill() {
    audio.noiseBurst(160, 'lowpass', 900, { vol: 0.45, attack: 0.003, decay: 0.14, prio: 4 });
    audio.sweep(180, 70, 220, 'sawtooth', { vol: 0.55, attack: 0.004, decay: 0.2, prio: 4 });
  },
  revenge() {
    audio.sweep(220, 96, 380, 'sawtooth', { vol: 0.7, attack: 0.006, decay: 0.34, prio: 4 });
    audio.tone({ type: 'triangle', freq: NOTE.E3, dur: 260, vol: 0.4, delay: 120, prio: 3 });
  },
  explode() {
    audio.noiseBurst(320, 'lowpass', 700, { vol: 0.55, cutoff2: 140, attack: 0.002, decay: 0.3, prio: 4 });
    audio.sweep(140, 62, 300, 'sawtooth', { vol: 0.5, prio: 3 });
  },

  // ——— середина 350-700 Гц, triangle: прогресс ———
  captureSmall() {
    audio.tone({ type: 'triangle', freq: NOTE.C5, dur: 100, vol: 0.28, attack: 0.004, prio: 1 });
  },
  captureBig() {
    audio.arp([NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5], 62, { type: 'triangle', vol: 0.5, dur: 150, prio: 3 });
  },
  contractAssigned() {
    audio.arp([NOTE.D4, NOTE.G4], 90, { type: 'triangle', vol: 0.45, dur: 190, prio: 2 });
  },
  contractDone() {
    audio.arp([NOTE.G4, NOTE.B4, NOTE.D5], 70, { type: 'triangle', vol: 0.5, dur: 200, prio: 3 });
  },
  dailyAssigned() {
    audio.arp([NOTE.C4, NOTE.F4], 100, { type: 'triangle', vol: 0.4, dur: 200, prio: 2 });
  },
  dailyDone() {
    audio.arp([NOTE.F4, NOTE.A4, NOTE.C5], 72, { type: 'triangle', vol: 0.5, dur: 200, prio: 3 });
  },
  bountyAssigned(vol) {
    audio.tone({ type: 'triangle', freq: NOTE.E4, dur: 150, vol: 0.42 * (vol ?? 1), prio: 2 });
    audio.tone({ type: 'triangle', freq: NOTE.A4, dur: 190, vol: 0.38 * (vol ?? 1), delay: 110, prio: 2 });
  },
  bountyClaimed() {
    audio.arp([NOTE.A4, NOTE.C5, NOTE.E5, NOTE.A5], 66, { type: 'triangle', vol: 0.55, dur: 200, prio: 4 });
  },
  pickup() {
    audio.tone({ type: 'triangle', freq: NOTE.G4, dur: 90, vol: 0.35, prio: 1 });
    audio.tone({ type: 'triangle', freq: NOTE.D5, dur: 110, vol: 0.3, delay: 55, prio: 1 });
  },
  powerUsed() {
    audio.tone({ type: 'square', freq: NOTE.E4, dur: 120, vol: 0.3, filter: { type: 'lowpass', freq: 1600 }, prio: 2 });
  },
  streak(step) {
    const n = Math.max(0, Math.min(10, Number(step) || 0));
    audio.tone({ type: 'triangle', freq: 440 * Math.pow(2, n / 12), dur: 110, vol: 0.42, prio: 2 });
  },

  // ——— верх 700-1400 Гц, sine/аккорды: награды ———
  achievement() {
    audio.chord([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 520, { type: 'sine', vol: 0.7, spread: 22, prio: 5 });
    audio.tone({ type: 'sine', freq: NOTE.E7, dur: 220, vol: 0.22, delay: 150, attack: 0.004, prio: 3 });
  },
  jackpot() {
    audio.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6], 58, { type: 'triangle', vol: 0.55, dur: 200, prio: 5 });
    audio.chord([NOTE.C5, NOTE.G5, NOTE.C6], 620, { type: 'sine', vol: 0.55, delay: 300, prio: 4 });
  },
  victory() {
    audio.arp([NOTE.C5, NOTE.D5, NOTE.E5, NOTE.G5, NOTE.A5, NOTE.C6], 130, {
      type: 'triangle',
      vol: 0.5,
      dur: 240,
      prio: 6
    });
    audio.chord([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 780, { type: 'sine', vol: 0.65, delay: 820, prio: 6 });
  },
  defeat() {
    audio.arp([NOTE.A4, NOTE.G4, NOTE.F4, NOTE.E4], 150, { type: 'triangle', vol: 0.45, dur: 300, prio: 6 });
    audio.chord([NOTE.A3, NOTE.C4, NOTE.E4], 700, { type: 'sine', vol: 0.5, delay: 620, prio: 5 });
  },
  firstCapture() {
    audio.arp([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6], 90, { type: 'triangle', vol: 0.55, dur: 260, prio: 6 });
    audio.tone({ type: 'sine', freq: NOTE.E7, dur: 260, vol: 0.2, delay: 320, prio: 4 });
  },
  styleGain() {
    audio.tone({ type: 'sine', freq: NOTE.C6, dur: 120, vol: 0.24, prio: 1 });
  },

  // ——— свипы: временные состояния ———
  mutatorOn(vol) {
    audio.sweep(240, 720, 340, 'sawtooth', {
      vol: 0.45 * (vol ?? 1),
      filter: { type: 'lowpass', freq: 700, freq2: 2600 },
      prio: 2
    });
  },
  mutatorOff(vol) {
    audio.sweep(620, 220, 300, 'triangle', { vol: 0.35 * (vol ?? 1), prio: 1 });
  },
  speedOn() {
    audio.sweep(420, 980, 260, 'triangle', { vol: 0.4, prio: 2 });
  },

  // ——— комбо ———
  comboStep(semis) {
    const s = Math.max(0, Math.min(28, Number(semis) || 0));
    audio.tone({ type: 'triangle', freq: 392 * Math.pow(2, s / 12), dur: 110, vol: 0.34, prio: 2 });
  },
  comboBreak() {
    audio.sweep(520, 180, 260, 'sine', { vol: 0.28, prio: 1 });
  },

  ui() {
    audio.tone({ type: 'sine', freq: NOTE.A5, dur: 70, vol: 0.2, prio: 0 });
  },

  // J6: восходящий бип каскада результатов.
  countStep(i) {
    const n = Math.max(0, Math.min(8, Number(i) || 0));
    audio.tone({ type: 'sine', freq: 523.25 * Math.pow(2, (n * 2) / 12), dur: 110, vol: 0.26, prio: 2 });
  }
};

let started = false;
let youAlive = false;

let lastRooms = [];

let roomsLoading = false;
let roomsLoadError = '';
let roomsLoadTimeout = 0;

let selectedRoomId = null;

let roomsCreateOpen = false;
let createRoomPending = false;

let roomsAutoRefreshAt = 0;

function trackEvent(name) {
  const ev = String(name || '').trim();
  if (!ev) return;
  try {
    const key = `an_${ev}`;
    const cur = Number(localStorage.getItem(key)) || 0;
    localStorage.setItem(key, String(cur + 1));
  } catch {
    // ignore
  }
}

let lastState = null;
let gridOwner = null;
let trailOwner = null;

let minimapGridOwner = null;

let gridFillAt = null;

/* F5 «Реклейм»: сервер пока не передаёт момент истечения остывающей клетки,
   поэтому окно отсчитывается от того кадра, в котором клетка впервые пришла
   с флагом остывания. Ошибка не превышает задержки одного пакета.
   TODO: заменить на серверное время истечения, когда появится событие с
   его байтовым layout — тогда coolSeenAt станет coolUntilMs. */
const RECLAIM_WINDOW_MS = 20000;
let coolSeenAt = null;

// Бывший владелец -> момент (performance.now), когда его остывающая земля
// исчезнет окончательно. Приходит событием EventCoolBatch (21).
const coolDeadlineByOwner = new Map();

// Точка замыкания петли по игроку — из неё расходится волна заливки (J15).
const captureAnchorByOwner = new Map();

let prevPlayers = new Map();
let currPlayers = new Map();
let lastPacketAt = performance.now();

let camX = null;
let camY = null;

const VIEW_CELLS_X = 40;
const VIEW_CELLS_Y = 28;

let chatOpenUntil = 0;

const CHAT_AUTO_OPEN_MS = 6500;

function bumpChatVisibility(ms, focusInput) {
  if (!chat) return;
  if (menuOverlay && !menuOverlay.classList.contains('hidden')) return;
  if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) return;
  if (cosmeticsOverlay && !cosmeticsOverlay.classList.contains('hidden')) return;
  if (matchOverlay && !matchOverlay.classList.contains('hidden')) return;

  if (chat.classList.contains('collapsed')) setChatCollapsed(false);
  const now = performance.now();
  const d = Math.max(0, Number(ms) || 0);
  chatOpenUntil = Math.max(chatOpenUntil, now + d);
  if (focusInput && chatInput) {
    try {
      chatInput.focus();
    } catch {}
  }
}

let unreadCount = 0;

function updateUnreadBadge() {
  if (!chatUnreadEl) return;
  const n = Math.max(0, Number(unreadCount) || 0);
  if (n <= 0) {
    chatUnreadEl.classList.add('hidden');
    chatUnreadEl.textContent = '';
    return;
  }
  chatUnreadEl.classList.remove('hidden');
  chatUnreadEl.textContent = n > 99 ? '99+' : String(n);
}

updateUnreadBadge();

function updateChatLayout() {
  if (!chat || !chatLog) return;
  const count = chatMessages.length;
  chat.classList.toggle('chatEmpty', count <= 0);
  let max = 320;
  if (count <= 0) max = 80;
  if (count <= 2) max = 140;
  if (count <= 6) max = 220;
  try {
    chat.style.setProperty('--chat-log-max', `${max}px`);
  } catch {}
}

const colors = new Map();
const rgbCache = new Map();
const boostCache = new Map();
const hslPartsCache = new Map();

const minimapOwnerRgbCache = new Map();

const ownerFillStyleCache = new Map();
const ALPHA_STEPS = 64;

const fillAnimMs = 480;
const fillDelayMod = 170;
const waveSpeed = 0.0042;
const waveScale = 0.55;
const waveAlpha = 0.10;
const wavePeriodMs = (Math.PI * 2) / waveSpeed;

const chatMessages = [];
const nameById = new Map();

let botIds = new Set();

const BOT_NAMES_RU = [
  'Сокол',
  'Рысь',
  'Барс',
  'Ворон',
  'Лис',
  'Ёж',
  'Волк',
  'Тигр',
  'Дракон',
  'Шершень',
  'Кобра',
  'Панда',
  'Скат',
  'Орёл',
  'Ястреб',
  'Пиранья',
  'Шторм',
  'Гром',
  'Искра',
  'Метеор',
  'Комета',
  'Спутник',
  'Космос',
  'Ниндзя',
  'Самурай',
  'Пират',
  'Робот',
  'Котик',
  'Енот',
  'Пингвин',
  'Кракен',
  'Феникс'
];

const BOT_NAMES_EN = [
  'Falcon',
  'Lynx',
  'Leopard',
  'Raven',
  'Fox',
  'Hedgehog',
  'Wolf',
  'Tiger',
  'Dragon',
  'Hornet',
  'Cobra',
  'Panda',
  'Ray',
  'Eagle',
  'Hawk',
  'Piranha',
  'Storm',
  'Thunder',
  'Spark',
  'Meteor',
  'Comet',
  'Satellite',
  'Cosmos',
  'Ninja',
  'Samurai',
  'Pirate',
  'Robot',
  'Kitten',
  'Raccoon',
  'Penguin',
  'Kraken',
  'Phoenix'
];

function botDisplayName(id) {
  const n = Number(id) || 0;
  const seed = (Math.imul(n, 1103515245) + 12345) >>> 0;
  const list = lang === 'en' ? BOT_NAMES_EN : BOT_NAMES_RU;
  const base = list[seed % list.length] || (lang === 'en' ? 'Bot' : 'Бот');
  return `${base}#${(seed % 99) + 1}`;
}

function refreshBotNames() {
  if (!botIds || botIds.size === 0) return;
  // G15: серверные ники ботов («Лютый Пельмень») не трогаем — локальный
  // генератор нужен только там, где имени с сервера ещё нет.
  for (const id of botIds) {
    const cur = nameById.get(id);
    if (typeof cur === 'string' && cur.trim()) continue;
    nameById.set(id, botDisplayName(id));
  }
}

let chatDirty = false;

let chatRenderedCount = 0;

const minimapLegendEl = document.getElementById('minimapLegend');
const minimapOverlayEl = document.getElementById('minimapOverlay');
const minimapOverlayCloseBtn = document.getElementById('minimapOverlayCloseBtn');
const minimapOverlayCanvas = document.getElementById('minimapOverlayCanvas');

let minimapOverlayOpen = false;
let minimapOverlayCtx = null;

function updateMinimapLegend() {
  if (!minimapLegendEl) return;
  try {
    minimapLegendEl.classList.add('hidden');
  } catch {}
  try {
    minimapLegendEl.setAttribute('aria-hidden', 'true');
  } catch {}
  try {
    minimapLegendEl.replaceChildren();
  } catch {}
}

function ensureMinimapOverlayCanvas() {
  if (!minimapOverlayCanvas) return;
  const ctx = minimapOverlayCanvas.getContext('2d');
  if (!ctx) return;
  minimapOverlayCtx = ctx;
  const w = (minimap?.width || 0) * 2;
  const h = (minimap?.height || 0) * 2;
  if (w > 0 && h > 0) {
    if (minimapOverlayCanvas.width !== w) minimapOverlayCanvas.width = w;
    if (minimapOverlayCanvas.height !== h) minimapOverlayCanvas.height = h;
  }
  minimapOverlayCtx.imageSmoothingEnabled = false;
}

function syncMinimapOverlayCanvas() {
  if (!minimapOverlayOpen) return;
  if (!minimapOverlayCanvas || !minimap || !minimapOverlayCtx) return;
  if (minimapOverlayCanvas.width !== minimap.width * 2 || minimapOverlayCanvas.height !== minimap.height * 2) {
    ensureMinimapOverlayCanvas();
  }
  minimapOverlayCtx.clearRect(0, 0, minimapOverlayCanvas.width, minimapOverlayCanvas.height);
  minimapOverlayCtx.drawImage(
    minimap,
    0,
    0,
    minimap.width,
    minimap.height,
    0,
    0,
    minimapOverlayCanvas.width,
    minimapOverlayCanvas.height
  );
}

function showMinimapOverlay() {
  if (!minimapOverlayEl) return;
  minimapOverlayOpen = true;
  minimapOverlayEl.classList.remove('hidden');
  overlayManager.open('minimap');
  syncOverlayUiState();
  ensureMinimapOverlayCanvas();
  syncMinimapOverlayCanvas();
  overlayManager.focusDefault('minimap');
}

function hideMinimapOverlay() {
  if (!minimapOverlayEl) return;
  minimapOverlayOpen = false;
  minimapOverlayEl.classList.add('hidden');
  overlayManager.close('minimap');
  syncOverlayUiState();
}

function toggleMinimapOverlay() {
  if (minimapOverlayOpen) hideMinimapOverlay();
  else showMinimapOverlay();
}

overlayManager.register('minimap', {
  root: () => minimapOverlayEl,
  defaultFocus: () => minimapOverlayCloseBtn,
  close: () => hideMinimapOverlay()
});

minimapOverlayCloseBtn?.addEventListener('click', (e) => {
  e?.preventDefault?.();
  hideMinimapOverlay();
});

// Тач-доступ к карте: на мобильном #minimapPanel скрыт, а клавиши M нет,
// поэтому без этой кнопки игрок в игре про захват территории играет вслепую.
document.getElementById('minimapMobileBtn')?.addEventListener('click', (e) => {
  e?.preventDefault?.();
  toggleMinimapOverlay();
});

minimapOverlayEl?.addEventListener('click', (e) => {
  if (e.target === minimapOverlayEl) {
    hideMinimapOverlay();
  }
});

try {
  updateMinimapLegend();
} catch {}

let minimapImage = null;
let minimapDirty = true;

let minimapHadChunkUpdate = false;

const MINIMAP_REFRESH_MS = 200;

let lastMinimapDrawAt = 0;

let viewMinX = 0;
let viewMinY = 0;
let viewMaxX = 0;
let viewMaxY = 0;

/* K1 «Туман войны». Сервер шлёт дельту сетки только для прямоугольника ROI
   (сейчас 80×56 клеток) и присылает его границы в каждом снапшоте. Экран же на
   портретном телефоне выше: cell считается по ширине (375/40 ≈ 9 px), и по
   вертикали в кадр влезает ~79 строк. Разница (верхние и нижние ~11 строк)
   никогда не обновлялась — там оставались нули или данные многолетней
   давности, то есть игрок видел «свободную» землю ровно по курсу движения.
   Теперь всё, что вне последнего полученного ROI, не рисуется из gridOwner и
   закрашивается туманом: честное «не знаю» вместо уверенного вранья. */
let lastRoi = null;

let fps = 0;
let fpsLast = performance.now();
let fpsFrames = 0;

let pingMs = null;

let bytesInTotal = 0;
let bytesOutTotal = 0;
let bytesInSample = 0;
let bytesOutSample = 0;
let bytesSampleAt = null;
let downBps = null;
let upBps = null;

let tickrate = 0;
let lastStateAt = null;

let headIndexByOwner = new Map();

let lastLeaderboardRenderAt = 0;

let leaderboardTable = null;
let leaderboardTbody = null;
let leaderboardRowsById = new Map();
let lastLeaderboardSig = '';

let lbMode = 'top';
let lbAroundIndex = null;
let lbAroundIndexAt = 0;

let lastDeathStatsAt = 0;

let lastDeathInfo = null;

let lastYouStats = null;

/* I2/F18: геометрия «своего» — длина следа и ближайшая своя клетка. */
const TRAIL_PULSE_FROM = 22;
let youTrailLen = 0;
let youInOwnZone = true;
let youNearestHomeX = -1;
let youNearestHomeY = -1;
let youNearestHomeAt = 0;
let ownGeometryAt = 0;

// Полный проход по сетке дешевле, чем кажется (200x140), и вызывается 5 раз в
// секунду вне кадрового цикла: считает длину своего следа и ближайшую свою
// клетку, если её не нашлось в видимой области.
function refreshOwnGeometry(force) {
  if (!gridOwner || !trailOwner || !you || !W || !H) return;
  const now = performance.now();
  if (!force && now - ownGeometryAt < 200) return;
  ownGeometryAt = now;

  const me = currPlayers.get(you);
  if (!me || !me.a) {
    youTrailLen = 0;
    youInOwnZone = true;
    youNearestHomeX = -1;
    youNearestHomeY = -1;
    return;
  }

  const hx = Number(me.x) || 0;
  const hy = Number(me.y) || 0;
  const hi = hy * W + hx;
  youInOwnZone = hi >= 0 && hi < gridOwner.length ? gridOwner[hi] === you : false;

  const staleHome = now - youNearestHomeAt > 400;
  let len = 0;
  let bestD = Infinity;
  let bx = -1;
  let by = -1;
  let i = 0;
  for (let y = 0; y < H; y++) {
    const dy = y - hy;
    const dy2 = dy * dy;
    for (let x = 0; x < W; x++, i++) {
      if (trailOwner[i] === you) len++;
      if (staleHome && gridOwner[i] === you) {
        const dx = x - hx;
        const d = dx * dx + dy2;
        if (d < bestD) {
          bestD = d;
          bx = x;
          by = y;
        }
      }
    }
  }
  youTrailLen = len;
  if (staleHome) {
    youNearestHomeX = bx;
    youNearestHomeY = by;
    youNearestHomeAt = bx >= 0 ? now : 0;
  }
}

function fmtInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  try {
    return Math.round(v).toLocaleString(numberLocale());
  } catch {
    return String(Math.round(v));
  }
}

function fmtPct1(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0,0%';
  try {
    return v.toLocaleString(numberLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  } catch {
    return v.toFixed(1) + '%';
  }
}

function deathReasonText(info) {
  const killer = Number(info?.killer) || 0;
  const killerName = String(info?.killerName || '').trim();
  const reason = Number(info?.reason) || 0;
  const rs =
    reason === 1
      ? t('death.reason.cut')
      : reason === 2
        ? t('death.reason.headon')
        : reason === 3
          ? t('death.reason.selftrail')
          : reason === 4
            ? t('death.reason.wall')
            : '';
  if (killer && killer === you) return rs ? `${t('death.reason_prefix')}: ${rs}` : '';
  if (killer && killerName) return rs ? `${t('death.killed_by')}: ${killerName} (${rs})` : `${t('death.killed_by')}: ${killerName}`;
  return rs ? `${t('death.reason_prefix')}: ${rs}` : '';
}

// F15: сухое «Разрез следа» ничего не объясняет новичку. Даём правило игры.
function deathReasonHint(info) {
  const reason = Number(info?.reason) || 0;
  const killerName = String(info?.killerName || '').trim();
  if (reason === 1) {
    if (killerName) {
      return lang === 'en'
        ? `${killerName} crossed your trail. Until the loop is closed you are vulnerable.`
        : `${killerName} пересёк твой след. Пока след не замкнут — ты уязвим.`;
    }
    return t('death.hint.cut');
  }
  if (reason === 2) return t('death.hint.headon');
  if (reason === 3) return t('death.hint.selftrail');
  if (reason === 4) return t('death.hint.wall');
  return t('death.hint.generic');
}

const storedName = localStorage.getItem('name') || '';
nameInput.value = storedName;
if (menuNameInput) menuNameInput.value = storedName;

const MENU_CONTROLS_SEEN_KEY = 'menuControlsSeen';

function getMenuControlsSeen() {
  try {
    return localStorage.getItem(MENU_CONTROLS_SEEN_KEY) === '1';
  } catch {}
  return false;
}

function setMenuControlsSeen() {
  try {
    localStorage.setItem(MENU_CONTROLS_SEEN_KEY, '1');
  } catch {}
}

function syncMenuOnboardingUi() {
  if (!menuOnboarding) return;
  menuOnboarding.classList.toggle('hidden', getMenuControlsSeen());
}

function normalizeMenuNickInput(name) {
  const raw = String(name || '')
    .replace(/\r|\n|\t/g, ' ')
    .trim();
  if (!raw) return { raw: '', value: '', hasBadChars: false };

  const maxLen = 18;
  let out = '';
  let hasBadChars = false;
  for (const ch of raw) {
    if (out.length >= maxLen) break;
    const code = ch.codePointAt(0);
    if (code == null) continue;
    if (code < 0x20) continue;
    if (ch === '<' || ch === '>') {
      hasBadChars = true;
      continue;
    }

    const ok =
      ch === ' ' ||
      ch === '-' ||
      ch === '_' ||
      (ch >= '0' && ch <= '9') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'А' && ch <= 'я') ||
      ch === 'Ё' ||
      ch === 'ё';

    if (!ok) {
      hasBadChars = true;
      continue;
    }
    out += ch;
  }
  out = out.replace(/\s+/g, ' ').trim();
  return { raw, value: out, hasBadChars };
}

function sanitizeNameClient(name) {
  const v = normalizeMenuNickInput(name);
  if (!v.value) return '';
  if (v.hasBadChars) return '';
  if (v.value.length < 2) return '';
  return v.value;
}

function sanitizeRoomTitleClient(title) {
  const raw = String(title || '')
    .replace(/\r|\n|\t/g, ' ')
    .trim();
  if (!raw) return '';

  const maxLen = 32;
  let out = '';
  for (const ch of raw) {
    if (out.length >= maxLen) break;
    const code = ch.codePointAt(0);
    if (code == null) continue;
    if (code < 0x20) continue;
    if (ch === '<' || ch === '>') continue;
    out += ch;
  }
  return out.trim();
}

function updateMenuNameUi() {
  if (!menuNameInput) return;
  const v = normalizeMenuNickInput(menuNameInput.value);
  // Пустое поле — не ошибка: при старте ник подставляется автоматически.
  // Иначе новый игрок видит красную ошибку и заблокированный «Играть» ещё
  // до того, как что-либо сделал.
  const empty = !v.raw;
  let errKey = '';
  if (!empty) {
    if (v.hasBadChars) errKey = 'menu.nick_error_chars';
    else if (!v.value) errKey = 'menu.nick_error_required';
    else if (v.value.length < 2) errKey = 'menu.nick_error_length';
  }

  const ok = !errKey;
  // «Играть» блокируется только при реально некорректном вводе, но не пустым полем.
  if (playBtn) playBtn.disabled = !ok;
  try {
    menuNameInput.setAttribute('aria-invalid', ok ? 'false' : 'true');
  } catch {}
  if (menuNameError) menuNameError.textContent = ok ? '' : t(errKey);
}

// Гарантирует непустой ник перед стартом: пустое поле заполняется случайным.
function ensureNickBeforePlay() {
  if (!menuNameInput) return true;
  const v = normalizeMenuNickInput(menuNameInput.value);
  if (!v.raw) {
    menuNameInput.value = randomNickValue();
    updateMenuNameUi();
  }
  return !playBtn || !playBtn.disabled;
}

function randomNickValue() {
  const prefix = t('menu.nick_random_prefix');
  const n = Math.floor(1000 + Math.random() * 9000);
  return `${prefix} ${n}`;
}

function applyRandomNick() {
  if (!menuNameInput) return;
  menuNameInput.value = randomNickValue();
  updateMenuNameUi();
  try {
    menuNameInput.focus();
  } catch {}
}

function syncRoomsSearchClearUi() {
  if (!roomsSearchClearBtn) return;
  const q = String(roomsSearchInput?.value || '').trim();
  roomsSearchClearBtn.classList.toggle('hidden', !q);
}

function clearRoomsSearch() {
  if (!roomsSearchInput) return;
  roomsSearchInput.value = '';
  syncRoomsSearchClearUi();
  updateRoomsUi();
  try {
    roomsSearchInput.focus();
  } catch {}
}

function attemptJoinRoom(rid) {
  const roomId = rid == null ? null : Number(rid);
  if (roomId == null) return;
  const nm = submitNameFromInput(menuNameInput);
  if (!nm) {
    updateMenuNameUi();
    menuNameInput?.focus();
    return;
  }
  trackEvent('join_room');
  wsSend('join', { roomId, mode: 'id' });
}

function setRoomsCreateOpen(v) {
  const on = !!v;
  roomsCreateOpen = on;
  if (roomsCreateEl) roomsCreateEl.classList.toggle('hidden', !on);
  if (toggleCreateRoomBtn) {
    toggleCreateRoomBtn.textContent = on ? t('rooms.hide') : t('rooms.create');
    toggleCreateRoomBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  if (on) {
    try {
      roomsCreateNameInput?.focus();
    } catch {}
  }
  updateRoomsCreateUi();
}

function updateRoomsCreateUi(errMsg) {
  if (!roomsCreateOpen) {
    if (roomsCreateError) roomsCreateError.textContent = '';
    if (createRoomBtn) createRoomBtn.disabled = true;
    return;
  }

  const title = sanitizeRoomTitleClient(roomsCreateNameInput?.value);
  const ok = !!title;
  const err = String(errMsg || '').trim();
  if (roomsCreateError) roomsCreateError.textContent = err ? err : ok ? '' : t('rooms.name_placeholder');
  if (createRoomBtn) createRoomBtn.disabled = !ok || createRoomPending;
}

function onError(d) {
  const code = String(d?.message || '').trim();
  createRoomPending = false;
  updateRoomsCreateUi();

  if (code === 'room_title_invalid') {
    setRoomsCreateOpen(true);
    updateRoomsCreateUi(t('rooms.invalid_title'));
    try {
      roomsCreateNameInput?.focus();
    } catch {}
    return;
  }

  const msgFor = () =>
    code === 'room_full'
      ? t('rooms.full')
      : code === 'room_not_found'
        ? t('rooms.not_found')
        : code === 'cosmetics_invalid_id'
          ? t('cosmetics.err_invalid_id')
          : code === 'cosmetics_invalid_cat'
            ? t('cosmetics.err_invalid_cat')
            : code === 'cosmetics_not_owned'
              ? t('cosmetics.err_not_owned')
              : code === 'cosmetics_not_enough_style'
                ? t('cosmetics.err_not_enough_style')
                : code === 'cosmetics_unavailable'
                  ? t('cosmetics.err_unavailable')
        : t('common.error');
  const msg = msgFor();

  // K7: если не удалось вернуться в свою комнату после обрыва — комнаты уже
  // нет или она заполнилась. Тогда честно отправляем в меню.
  if (rejoinPending && (code === 'room_not_found' || code === 'room_full')) {
    rejoinPending = false;
    rejoinRoomId = null;
    roomId = null;
    updateRoomInfo();
    showMenuOverlay();
    addToast('⚠', msg, null);
    return;
  }

  // C1/C4: shop errors must land inside the overlay — toasts are hidden while it is open.
  if (code.startsWith('cosmetics_')) {
    cosmeticsOpClear();
    if (cosmeticsOpen) {
      setCosmeticsStatus(msgFor, 'error');
      syncCosmeticsUi();
      return;
    }
  }

  addToast('⚠', msg, null);
}

updateMenuNameUi();

const LB_PIN_KEY = 'lbPinned';

function setLeaderboardPinned(v) {
  if (!hudEl) return;
  const on = !!v;
  if (on) hudEl.classList.add('lbPinned');
  else hudEl.classList.remove('lbPinned');
  try {
    localStorage.setItem(LB_PIN_KEY, on ? '1' : '0');
  } catch {
    // ignore
  }

  if (started) {
    renderTeamHud();
  }
}

function getLeaderboardPinnedDefault() {
  try {
    const raw = localStorage.getItem(LB_PIN_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // ignore
  }
  return false;
}

lbBtn?.addEventListener('click', () => {
  if (!hudEl) return;
  setLeaderboardPinned(!hudEl.classList.contains('lbPinned'));
});

matchContinueBtn?.addEventListener('click', () => {
  if (matchEnded) {
    matchContinuePending = true;
    syncMatchOverlayActions();
    if (matchContinueTimeout) {
      clearTimeout(matchContinueTimeout);
      matchContinueTimeout = 0;
    }
    matchContinueTimeout = setTimeout(() => {
      matchContinueTimeout = 0;
      if (matchEnded && matchContinuePending) {
        matchContinuePending = false;
        syncMatchOverlayActions();
      }
    }, 4000);
    wsSend('matchContinue', {});
    return;
  }
  hideMatchOverlay();
});

matchMenuBtn?.addEventListener('click', (e) => {
  e?.preventDefault?.();
  hideMatchOverlay();
  if (matchContinueTimeout) {
    clearTimeout(matchContinueTimeout);
    matchContinueTimeout = 0;
  }
  matchContinuePending = false;
  leaveBtn?.click();
});

toggleCreateRoomBtn?.addEventListener('click', () => {
  setRoomsCreateOpen(!roomsCreateOpen);
});

roomsCreateNameInput?.addEventListener('input', () => {
  updateRoomsCreateUi();
});

createRoomBtn?.addEventListener('click', () => {
  const nm = submitNameFromInput(menuNameInput);
  if (!nm) {
    updateMenuNameUi();
    menuNameInput?.focus();
    return;
  }

  const title = sanitizeRoomTitleClient(roomsCreateNameInput?.value);
  if (!title) {
    updateRoomsCreateUi();
    roomsCreateNameInput?.focus();
    return;
  }

  createRoomPending = true;
  updateRoomsCreateUi();
  trackEvent('create_room');
  wsSend('createRoom', { title });
});

setLeaderboardPinned(getLeaderboardPinnedDefault());

const RIGHT_MATCH_OPEN_KEY = 'rightMatchOpen';
const RIGHT_TEAM_OPEN_KEY = 'rightTeamOpen';

function initRightDetailsState() {
  const initOne = (el, key) => {
    if (!el) return;
    let open = true;
    try {
      const raw = localStorage.getItem(key);
      if (raw === '0') open = false;
      if (raw === '1') open = true;
    } catch {
      // ignore
    }
    el.open = open;
    el.addEventListener('toggle', () => {
      try {
        localStorage.setItem(key, el.open ? '1' : '0');
      } catch {
        // ignore
      }
    });
  };

  initOne(rightMatchDetailsEl, RIGHT_MATCH_OPEN_KEY);
  initOne(rightTeamDetailsEl, RIGHT_TEAM_OPEN_KEY);
}

initRightDetailsState();

const RIGHT_TAB_KEY = 'rightTab';
let rightTab = 'match';

function setRightTab(tab, fromUser) {
  const t = String(tab || 'match');
  if (t !== 'match' && t !== 'team' && t !== 'chat') return;
  rightTab = t;
  if (t === 'chat') {
    if (chat.classList.contains('collapsed')) setChatCollapsed(false);
    chatOpenUntil = performance.now() + 12000;
    if (chatInput && document.activeElement !== chatInput) {
      try {
        chatInput.focus();
      } catch {}
    }
    return;
  }

  const target = t === 'team' ? teamHudEl : metaHudEl;
  if (rightInfoEl && target) {
    const top = Math.max(0, (target.offsetTop || 0) - 6);
    try {
      rightInfoEl.scrollTo({ top, behavior: fromUser ? 'smooth' : 'auto' });
    } catch {
      rightInfoEl.scrollTop = top;
    }
  }
}

function updateMatchTabBadge() {
  if (!matchTabBadgeEl) return;
  const n = Math.max(0, Number(matchTabBadgeCount) || 0);
  matchTabBadgeEl.textContent = n > 99 ? '99+' : String(n);
  matchTabBadgeEl.classList.toggle('hidden', n <= 0);
}

function bumpMatchTabBadge() {
  if (!rightInfoEl) return;
  rightInfoEl.classList.add('rightInfoPulse');
  window.clearTimeout(bumpMatchTabBadge._t);
  bumpMatchTabBadge._t = window.setTimeout(() => {
    rightInfoEl.classList.remove('rightInfoPulse');
  }, 550);

  try {
    if (rightMatchDetailsEl && !rightMatchDetailsEl.open) {
      const now = performance.now();
      if (!bumpMatchTabBadge._u || now - bumpMatchTabBadge._u > 1200) {
        bumpMatchTabBadge._u = now;
        matchUnreadCount = Math.min(999, matchUnreadCount + 1);
        setBadgeCount(rightMatchBadgeEl, matchUnreadCount);
      }
    }
  } catch {}
}

bumpMatchTabBadge._t = 0;
bumpMatchTabBadge._u = 0;

function getRightTabDefault() {
  try {
    const raw = localStorage.getItem(RIGHT_TAB_KEY);
    if (raw === 'match' || raw === 'team' || raw === 'chat') return raw;
  } catch {
    // ignore
  }
  return 'match';
}

for (const b of rightTabButtons) {
  b.addEventListener('click', (e) => {
    const t = String(b?.dataset?.tab || 'match');
    setRightTab(t, true);
    e?.preventDefault?.();
  });
}

setRightTab(getRightTabDefault(), false);

// I5: отдельный слот баунти в верхнем HUD. Разметку добавляет вёрсточный агент
// (#topHudBounty); пока её нет — создаём сами, рядом с киллами.
function ensureTopHudBountyEl() {
  let el = document.getElementById('topHudBounty');
  if (el) return el;
  const host = topHudKillsEl?.parentElement || topHudTimeEl?.parentElement || null;
  if (!host) return null;
  try {
    el = document.createElement('span');
    el.id = 'topHudBounty';
    el.className = 'topHudBounty hidden';
    host.insertBefore(el, topHudKillsEl || null);
  } catch {
    return null;
  }
  return el;
}

/* K3: «Место N/M · Очки P» — единственная цифра, по которой игра на самом деле
   ранжирует, и её в HUD не было вовсе (показывалась «Зона %», по которой не
   ранжируют). Слот #topHudPlace ждём от вёрсточного агента; пока его нет —
   создаём сами, слева в правой группе верхнего HUD. */
function ensureTopHudPlaceEl() {
  let el = document.getElementById('topHudPlace');
  if (el) return el;
  const host = topHudTimeEl?.parentElement || topHudKillsEl?.parentElement || null;
  if (!host) return null;
  try {
    el = document.createElement('span');
    el.id = 'topHudPlace';
    // Пока вёрсточный агент не завёл собственный стиль, переиспользуем
    // существующую «пилюлю» .topHudChip — иначе строка выглядит как сырой текст.
    el.className = 'topHudPlace topHudChip';
    host.insertBefore(el, host.firstChild);
  } catch {
    return null;
  }
  return el;
}

function renderTopHud() {
  if (!topHudEl) return;
  if (!started || !lastState) {
    topHudEl.setAttribute('aria-hidden', 'true');
    return;
  }

  topHudEl.setAttribute('aria-hidden', 'false');

  // F17: постепенное раскрытие мета-систем в первом матче.
  obTick();
  const obKills = obUnlocked('bounty');
  const obContract = obUnlocked('contract');
  // Магазин — со второго матча: в первом тратить ещё нечего и незачем.
  if (cosmeticsBtn) cosmeticsBtn.classList.toggle('hidden', !obSecondMatchPlus());

  const me = lastState.players?.find((p) => p.n === you);
  const cells = Number(me?.s) || 0;
  const pct = mapCells ? (cells / mapCells) * 100 : 0;

  // J6: счётчик клеток догоняется анимацией, а не прыгает.
  if (topHudCellsEl) {
    const prevCells = Number(topHudCellsEl.dataset.value);
    if (!Number.isFinite(prevCells)) {
      topHudCellsEl.textContent = String(cells);
    } else if (prevCells !== cells) {
      animateNumber(topHudCellsEl, prevCells, cells, 420);
    }
    topHudCellsEl.dataset.value = String(cells);
  }
  if (topHudPctEl) topHudPctEl.textContent = `${pct.toFixed(1)}%`;

  // K3: место и очки — прямо в верхнем HUD, на каждом кадре HUD-а.
  {
    const placeEl = ensureTopHudPlaceEl();
    if (placeEl) {
      const ordered = computeTopSorted(lastState.players);
      const idx = ordered.findIndex((p) => p.n === you);
      const points = Number(me?.p) || 0;
      const txt =
        idx >= 0
          ? `${t('hud.place_short')} ${idx + 1}/${ordered.length} · ${t('hud.points_short')} ${fmtInt(points)}`
          : '';
      placeEl.textContent = txt;
      placeEl.classList.toggle('hidden', !txt);
      placeEl.classList.toggle('isLeader', idx === 0);
      try {
        placeEl.title = `${t('death.place')} / ${t('death.points')}`;
      } catch {}
    }
  }

  if (topHudKillsEl) {
    topHudKillsEl.textContent = obKills ? `⚔ ${youKills}` : '';
    topHudKillsEl.classList.toggle('hidden', !obKills);
  }
  if (obKills) renderComboHud();

  // I5: таймер матча — отдельный крупный элемент. Только время, без «•»-склейки,
  // иначе самое важное («сколько до конца») обрезается по ellipsis.
  if (topHudTimeEl) {
    const rem = matchEndTick ? formatTickRemain(matchEndTick) : '';
    topHudTimeEl.textContent = rem || '';
    const sec = matchEndTick ? tickRemainSeconds(matchEndTick) : null;
    topHudTimeEl.classList.toggle('isUrgent', sec != null && sec <= 30);
    topHudTimeEl.classList.toggle('hidden', !rem);
    try {
      topHudTimeEl.title = t('hud.time_left');
    } catch {}
  }

  // I5: баунти — отдельный элемент, а не часть таймерной строки.
  const bountyEl = ensureTopHudBountyEl();
  if (bountyEl) {
    if (bountyTarget && obKills) {
      const bn = nameById.get(bountyTarget) || String(bountyTarget);
      const rem = formatTickRemain(bountyUntil);
      bountyEl.textContent = rem ? `🎯 ${bn} (${rem})` : `🎯 ${bn}`;
      bountyEl.classList.remove('hidden');
      bountyEl.classList.toggle('isMe', bountyTarget === you);
    } else {
      bountyEl.textContent = '';
      bountyEl.classList.add('hidden');
    }
  }

  const ensureContractParts = () => {
    if (!topHudContractEl) return { obj: null, chip: null };
    let obj = topHudContractEl.querySelector('.topHudObjective');
    let chip = topHudContractEl.querySelector('.topHudChip');
    if (!obj || !chip) {
      topHudContractEl.replaceChildren();
      obj = document.createElement('span');
      obj.className = 'topHudObjective';
      chip = document.createElement('span');
      chip.className = 'topHudChip hidden';
      topHudContractEl.appendChild(obj);
      topHudContractEl.appendChild(chip);
    }
    return { obj, chip };
  };

  const { obj, chip } = ensureContractParts();
  if (obj) obj.textContent = `${t('hud.objective')}: ${t('hud.objective_capture')}`;

  if (chip) {
    if (youContractType && obContract) {
      const cn = contractLabel(youContractType) || infoPack().labels.contract;
      const goal = Number(youContractGoal) || 0;
      const prog = Number(youContractProgress) || 0;
      const rem = formatTickRemain(youContractUntil);
      chip.textContent = `📜 ${cn} ${prog}/${goal}${rem ? ` (${rem})` : ''}`;
      chip.classList.remove('hidden');
    } else {
      chip.textContent = '';
      chip.classList.add('hidden');
    }
  }

  if (topHudBarFillEl) {
    const p = mapCells ? Math.max(0, Math.min(1, cells / mapCells)) : 0;
    topHudBarFillEl.style.width = `${(p * 100).toFixed(1)}%`;
  }
}

net = createNetModule({
  t,
  wsQuery: () => {
    // A1: identity is a signed token issued by the server. No token yet -> no param at all.
    const tok = getProfileToken();
    if (!tok) return '';
    return `t=${encodeURIComponent(tok)}`;
  },
  onBytesIn: (n) => {
    bytesInTotal += Number(n) || 0;
  },
  onBytesOut: (n) => {
    bytesOutTotal += Number(n) || 0;
  },
  onStatusChange: () => {
    updateRoomsUi();
  },
  onOpen: ({ send }) => {
    if (storedName) send('setName', { name: storedName });
    refreshRoomsBtn?.click();
    updateRoomsUi();
    // K7: обрыв связи (блокировка экрана, Wi-Fi → LTE) выбрасывал игрока из
    // матча в меню. Соединение восстанавливается само — возвращаемся в ту же
    // комнату, а не заставляем искать её руками.
    if (rejoinRoomId != null) {
      const rid = rejoinRoomId;
      rejoinPending = true;
      send('join', { roomId: rid, mode: 'id' });
    }
  },
  onClose: () => {
    createRoomPending = false;
    updateRoomsCreateUi();
    roomsLoading = false;
    roomsLoadError = t('net.offline');
    if (roomsLoadTimeout) {
      clearTimeout(roomsLoadTimeout);
      roomsLoadTimeout = 0;
    }
    if (refreshRoomsBtn) {
      refreshRoomsBtn.disabled = false;
      refreshRoomsBtn.classList.remove('isLoading');
      refreshRoomsBtn.textContent = t('rooms.refresh');
    }
    // K7: если игрок был в комнате и не уходил сам — запоминаем комнату и
    // держим игровой экран, вместо того чтобы швырять в меню.
    if (roomId != null && !userLeftRoom) {
      rejoinRoomId = roomId;
      addToast('📶', t('net.reconnecting'), null, t('net.rejoin_hint'), { key: 'net_reconnect' });
      updateRoomsUi();
      return;
    }
    rejoinRoomId = null;
    showMenuOverlay();
    updateRoomsUi();
  },
  onTextMsg: (t, d) => {
    if (t === 'hello') {
      // A1: the server re-issues the profile token on every connect.
      if (typeof d?.token === 'string') setProfileToken(d.token);
      if (typeof d?.roomLimit === 'number') roomLimit = d.roomLimit;
      if (d?.cosmeticsPrices && typeof d.cosmeticsPrices === 'object') {
        cosmeticsPrices = d.cosmeticsPrices;
      }
      // Таблица титулов с сервера: страховка на случай, когда серверный набор
      // шире клиентского — тогда имя берётся оттуда, а не рисуется пустым.
      if (Array.isArray(d?.titles)) {
        cosTitleServerNames.clear();
        for (const it of d.titles) {
          const id = Number(it?.id);
          const nm = typeof it?.name === 'string' ? it.name.trim() : '';
          if (Number.isFinite(id) && id > 0 && nm) cosTitleServerNames.set(id, nm);
        }
      }
      updateRoomInfo();
    } else if (t === 'rooms') {
      onRooms(d);
    } else if (t === 'init') {
      onInit(d);
    } else if (t === 'cosmetics') {
      onCosmetics(d);
    } else if (t === 'cosExtra') {
      onCosExtra(d);
    } else if (t === 'matchEnd') {
      onMatchEnd(d);
    } else if (t === 'matchStart') {
      onMatchStart(d);
    } else if (t === 'error') {
      onError(d);
    } else if (t === 'chatInit') {
      onChatInit(d);
    } else if (t === 'chat') {
      onChat(d);
    } else if (t === 'nameUpdate') {
      onNameUpdate(d);
    } else if (t === 'left') {
      onLeft(d);
    } else if (t === 'rttPong') {
      onRttPong(d);
    }
  },
  onBinaryMsg: (buf) => {
    handleStateBinary(buf);
  }
});

function submitName() {
  const nm = sanitizeNameClient(nameInput.value);
  if (!nm) return;
  localStorage.setItem('name', nm);
  if (menuNameInput) menuNameInput.value = nm;
  wsSend('setName', { name: nm });
}

function submitNameFromInput(el) {
  const nm = sanitizeNameClient(el?.value);
  if (!nm) return null;
  localStorage.setItem('name', nm);
  nameInput.value = nm;
  if (menuNameInput) menuNameInput.value = nm;
  wsSend('setName', { name: nm });
  updateMenuNameUi();
  return nm;
}

function showDeathOverlay() {
  if (deathOverlay) deathOverlay.classList.remove('hidden');
  overlayManager.open('death');
  syncOverlayUiState();
  setChatCollapsed(true);
  toggleEmojiPanel(false);
  renderDeathStats();
  lastDeathStatsAt = 0;

  // J16: собственная смерть была беззвучной.
  sfx.death();
  comboBreak();

  // F16b: человеческое объяснение только на первых трёх смертях — дальше
  // ветеран читает сухую причину быстрее, чем абзац текста.
  // K4: сколько смертей было НА МОМЕНТ показа — запоминаем, чтобы блок можно
  // было пересобрать при смене языка с тем же составом строк.
  deathReasonDeathsSeen = obDeathsSeen();
  obBumpDeaths();
  renderDeathReason();

  overlayManager.focusDefault('death');
}

/* K4: раньше подсказка в оверлее смерти собиралась только внутри
   showDeathOverlay(), и setLang() её не трогал — в английском интерфейсе
   висело «Выйди из своей зоны, обведи участок…». Теперь это отдельная функция,
   которую зовёт и показ оверлея, и смена языка. */
let deathReasonDeathsSeen = 99;

function renderDeathReason() {
  if (deathReasonEl) {
    const deathsSeen = deathReasonDeathsSeen;
    const reasonText = deathReasonText(lastDeathInfo);
    const hintText = deathsSeen < 3 ? deathReasonHint(lastDeathInfo) : '';
    // F5 «Реклейм»: механика нигде не объяснена, показываем её на первой смерти.
    const reclaimText = deathsSeen < 1 ? t('reclaim.hint') : '';
    try {
      const frag = document.createDocumentFragment();
      if (reasonText) {
        const r = document.createElement('div');
        r.className = 'deathReasonMain';
        r.textContent = reasonText;
        frag.appendChild(r);
      }
      if (hintText) {
        const h = document.createElement('div');
        h.className = 'deathReasonHint';
        h.textContent = hintText;
        frag.appendChild(h);
      }
      if (reclaimText) {
        const rc = document.createElement('div');
        rc.className = 'deathReasonHint';
        rc.textContent = `♻ ${reclaimText}`;
        frag.appendChild(rc);
      }
      deathReasonEl.replaceChildren(frag);
    } catch {
      deathReasonEl.textContent = reasonText || hintText;
    }
    deathReasonEl.style.display = reasonText || hintText || reclaimText ? '' : 'none';
  }
}

function syncOverlayUiState() {
  const menuOpen = !!(menuOverlay && !menuOverlay.classList.contains('hidden'));
  const settingsOpen = !!(settingsOverlay && !settingsOverlay.classList.contains('hidden'));
  const matchOpen = !!(matchOverlay && !matchOverlay.classList.contains('hidden'));
  const cosmeticsIsOpen = !!(cosmeticsOverlay && !cosmeticsOverlay.classList.contains('hidden'));
  const deathOpen = !!(deathOverlay && !deathOverlay.classList.contains('hidden'));
  const minimapOpen = !!(minimapOverlayEl && !minimapOverlayEl.classList.contains('hidden'));
  const anyOverlayOpen = menuOpen || settingsOpen || matchOpen || cosmeticsIsOpen || deathOpen || minimapOpen;
  document.body.classList.toggle('overlayActive', anyOverlayOpen);
  if (langToggleGlobal) langToggleGlobal.classList.toggle('hidden', !anyOverlayOpen);
}

function syncMatchOverlayActions() {
  if (!matchContinueBtn) return;
  const waiting = !!matchContinuePending;
  matchContinueBtn.disabled = waiting;
  matchContinueBtn.setAttribute('aria-disabled', waiting ? 'true' : 'false');
  matchContinueBtn.textContent = waiting ? t('match.starting') : t('match.play_on');
}

function focusMatchOverlayDefault() {
  try {
    const target = !matchContinueBtn?.disabled ? matchContinueBtn : matchMenuBtn;
    requestAnimationFrame(() => target?.focus());
  } catch {
    // ignore
  }
}

function showMatchOverlay() {
  if (matchOverlay) matchOverlay.classList.remove('hidden');
  if (matchActionsEl) matchActionsEl.classList.add('hidden');
  overlayManager.open('match');
  syncOverlayUiState();
  syncMatchOverlayActions();

  // J16: конец матча был беззвучным.
  comboReset();
  const rows = Array.isArray(lastMatchResults) ? lastMatchResults : [];
  const meIdx = rows.findIndex((r) => (Number(r?.n) || 0) === you);
  if (meIdx === 0) sfx.victory();
  else sfx.defeat();

  runMatchResultsCascade();
  overlayManager.focusDefault('match');
}

function hideMatchOverlay() {
  if (matchOverlay) matchOverlay.classList.add('hidden');
  overlayManager.close('match');
  syncOverlayUiState();
}

// Поля Pk/Avg/D появились в matchResult позже; читаем терпимо к регистру ключа
// и откатываемся на мгновенный снимок, если сервер их ещё не шлёт.
function resultPeak(r) {
  const v = Number(r?.pk ?? r?.Pk);
  if (Number.isFinite(v) && v > 0) return v;
  return Number(r?.cells) || 0;
}

function resultAvg(r) {
  const v = Number(r?.avg ?? r?.Avg);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function resultDeaths(r) {
  const v = Number(r?.d ?? r?.D);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

const FIRST_MATCH_KEY = 'snakes_matches_played_v1';

function matchesPlayed() {
  try {
    return Math.max(0, Number(localStorage.getItem(FIRST_MATCH_KEY)) || 0);
  } catch {}
  return 0;
}

function bumpMatchesPlayed() {
  try {
    localStorage.setItem(FIRST_MATCH_KEY, String(matchesPlayed() + 1));
  } catch {}
}

/* ==========================================================================
 * F15/F17 — мягкая первая сессия
 *
 * Новичок видит шесть мета-систем одновременно поверх непонятой базовой
 * механики. В первом матче они открываются по одной, а путь домой
 * подсвечивается стрелкой, пока игрок ни разу не замкнул петлю.
 * ======================================================================== */

const OB_DEATHS_KEY = 'snakes_deaths_seen_v1';
const OB_STAGE_KEY = 'snakes_onboarding_stages_v1';

// Пороги подобраны так, чтобы первый захват (15-20 с) успел случиться раньше
// любой мета-системы: сначала правило игры, потом надстройки над ним.
/* K5: ступени онбординга висели на секундомере ПЕРВОГО матча (105/135/165 с),
   а `obUnlocked()` открывал всё сразу после двух сыгранных матчей. Новичок,
   умерший дважды за первые две минуты (типичный сценарий), не видел ни одной
   ступени и на второй жизни получал сразу весь HUD.
   Теперь ступень привязана к событию — к моменту, когда механика впервые
   становится осмысленной. Таймер остался только страховкой для игрока, который
   за все эти секунды так ничего и не сделал. */
const OB_STAGES = [
  // Захватил первый участок — теперь имеет смысл рассказать, что по дороге
  // домой валяются бонусы.
  { id: 'bonus', at: 105000, on: 'capture', icon: '🎁', title: 'onb.bonus_title', desc: 'onb.bonus_desc' },
  // Первое убийство — игрок понял, что за действия платят; контракт как раз про это.
  { id: 'contract', at: 135000, on: 'kill', icon: '📜', title: 'onb.contract_title', desc: 'onb.contract_desc' },
  // Первая смерть — теперь ясно, что охотятся и на него; здесь и про баунти.
  { id: 'bounty', at: 165000, on: 'death', icon: '🎯', title: 'onb.bounty_title', desc: 'onb.bounty_desc' }
];

let obMatchStartAt = 0;
let obStagesShown = null;

function obLoadStages() {
  if (obStagesShown) return obStagesShown;
  obStagesShown = new Set();
  try {
    const raw = localStorage.getItem(OB_STAGE_KEY);
    if (raw) for (const s of String(raw).split(',')) if (s) obStagesShown.add(s);
  } catch {}
  return obStagesShown;
}

function obMarkStageShown(id) {
  const set = obLoadStages();
  if (set.has(id)) return;
  set.add(id);
  try {
    localStorage.setItem(OB_STAGE_KEY, Array.from(set).join(','));
  } catch {}
}

// Первый матч в жизни игрока: только в нём мета-системы придерживаются.
function obFirstMatch() {
  return obMatchesEntered() <= 1;
}

// Второй и дальше — ежедневки и магазин уже показываем.
function obSecondMatchPlus() {
  return obMatchesEntered() >= 2;
}

function obDeathsSeen() {
  try {
    return Math.max(0, Number(localStorage.getItem(OB_DEATHS_KEY)) || 0);
  } catch {}
  return 99;
}

function obBumpDeaths() {
  try {
    localStorage.setItem(OB_DEATHS_KEY, String(obDeathsSeen() + 1));
  } catch {}
}

function obMatchElapsed() {
  if (!obMatchStartAt) return 0;
  return performance.now() - obMatchStartAt;
}

/* Отдельный счётчик «сколько матчей игрок начал». FIRST_MATCH_KEY растёт только
   в onMatchEnd, а тот приходит не всегда (умер и досидел до конца в оверлее
   смерти — экран итогов не показывается). Онбординг на таком счётчике завис бы
   в режиме «первый матч» навсегда, поэтому у него свой, по входам. */
const OB_ENTERED_KEY = 'snakes_ob_matches_v1';

function obMatchesEntered() {
  try {
    return Math.max(0, Number(localStorage.getItem(OB_ENTERED_KEY)) || 0);
  } catch {}
  return 99;
}

function obBumpMatchesEntered() {
  try {
    localStorage.setItem(OB_ENTERED_KEY, String(obMatchesEntered() + 1));
  } catch {}
}

// Разблокирована ли мета-система. Вне первого матча — всё открыто.
function obUnlocked(id) {
  if (!obFirstMatch()) return true;
  const st = OB_STAGES.find((s) => s.id === id);
  if (!st) return true;
  // K5: ступень, уже показанная по событию, остаётся открытой — в том числе
  // после смерти и респавна в том же матче.
  if (obLoadStages().has(st.id)) return true;
  return obMatchElapsed() >= st.at;
}

// K5: показать ступень (один раз за всю жизнь профиля).
function obShowStage(st) {
  if (!st) return;
  const set = obLoadStages();
  if (set.has(st.id)) return;
  obMarkStageShown(st.id);
  addToast(st.icon, t(st.title), 'big', t(st.desc), { key: `onb_${st.id}`, prio: 'important' });
}

/* K5: событийный триггер. kind — 'capture' | 'kill' | 'death'.
   Молчит у ветеранов (больше трёх входов в матч) — им объяснять нечего. */
function obFireEvent(kind) {
  if (obMatchesEntered() > 3) return;
  for (const st of OB_STAGES) {
    if (st.on !== kind) continue;
    obShowStage(st);
  }
}

// F15: стрелка домой живёт, пока игрок ни разу не замкнул петлю.
function obGuideActive() {
  return !hasFirstCapture() && obMatchesEntered() <= 2;
}

function obResetMatch() {
  obMatchStartAt = performance.now();
  obBumpMatchesEntered();
}

// Вызывается из renderTopHud (каждый кадр), поэтому дешёвая: сравнение чисел.
function obTick() {
  if (!started || !obMatchStartAt || obMatchesEntered() > 2) return;
  const el = obMatchElapsed();
  for (const st of OB_STAGES) {
    // K5: таймер теперь только страховка — событие обычно срабатывает раньше.
    if (el < st.at) continue;
    obShowStage(st);
  }
}

// Магазин и ежедневки — со второго матча, одним тостом и один раз.
function obAnnounceShop() {
  if (!obSecondMatchPlus()) return;
  if (obMatchesEntered() > 3) return;
  const set = obLoadStages();
  if (set.has('shop')) return;
  obMarkStageShown('shop');
  setTimeout(() => {
    addToast('🎨', t('onb.shop_title'), 'big', t('onb.shop_desc'), { key: 'onb_shop', prio: 'important' });
  }, 2500);
}

// F16: крючок «до первого скина N ✨» на экране результатов первого матча.
function firstSkinHookHtml() {
  if (matchesPlayed() > 1) return '';
  let owned = 0;
  for (const cat of COSMETICS_CATS) owned += Math.max(0, cosmeticsOwnedCount(cat) - 1);
  if (owned > 0) return '';

  const price = cosmeticsCheapestPrice();
  if (price <= 0) return '';
  const have = Math.max(0, Math.floor(Number(youStyle) || 0));
  const left = Math.max(0, price - have);
  const pct = Math.max(0, Math.min(100, (have / price) * 100));

  return `
      <div class="matchFirstSkin">
        <div class="matchFirstSkinTop">
          <span class="matchFirstSkinLabel">${escapeHtml(t('match.first_skin'))}</span>
          <span class="matchFirstSkinValue">${left > 0 ? `${escapeHtml(t('cosmetics.missing_prefix'))} ${fmtInt(left)} ✨` : '✨ ' + escapeHtml(t('cosmetics.buy'))}</span>
        </div>
        <div class="matchFirstSkinBar"><div class="matchFirstSkinFill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="matchFirstSkinSub">${escapeHtml(t('match.first_skin_sub'))}</div>
      </div>`;
}

// J6: каскад чисел — место → очки → зона → киллы → награда,
// по 250 мс со сдвигом 180 мс, каждое со своим восходящим бипом.
const MATCH_CASCADE_ORDER = ['place', 'points', 'zone', 'kills', 'reward'];

function runMatchResultsCascade() {
  if (!matchResultsEl) return;
  if (!fxCountUpEnabled()) return;
  let step = 0;
  for (const key of MATCH_CASCADE_ORDER) {
    const el = matchResultsEl.querySelector(`[data-count="${key}"]`);
    if (!el) continue;
    const to = Number(el.dataset.to) || 0;
    if (to <= 0) continue;
    const prefix = String(el.dataset.prefix || '');
    const delay = step * 180;
    animateNumber(el, 0, to, 250, {
      delay,
      prefix,
      onDone: () => {}
    });
    const i = step;
    setTimeout(() => sfx.countStep(i), delay);
    step++;
  }
}

function renderMatchResults(results) {
  if (!matchResultsEl) return;
  const rows = Array.isArray(results) ? results : [];
  if (!rows.length) {
    setSafeHtml(matchResultsEl, `<div class="matchSub">${escapeHtml(t('match.results_unavailable'))}</div>`);
    return;
  }
  const meIndex = rows.findIndex((r) => (Number(r?.n) || 0) === you);
  const me = meIndex >= 0 ? rows[meIndex] : null;
  const mePoints = Number(me?.p) || 0;
  // Мгновенный снимок зоны бесполезен: умерший на последней секунде видел 0.
  // Сервер шлёт пик (Pk), среднюю (Avg) и смерти (D) — показываем их.
  const meCells = resultPeak(me);
  const meAvg = resultAvg(me);
  const meDeaths = resultDeaths(me);
  const meKills = Number(me?.k) || 0;
  const mePlace = Number(me?.place) || (meIndex >= 0 ? meIndex + 1 : 0);
  const meCt = Number(me?.ct) || 0;
  const meCp = Number(me?.cp) || 0;
  const meCg = Number(me?.cg) || 0;
  const meSe = Number(me?.se) || 0;
  const meSb = Array.isArray(me?.sb) ? me.sb : null;
  const mePb = Array.isArray(me?.pb) ? me.pb : null;
  const meCd = Array.isArray(me?.cd) ? me.cd : null;
  const totalPlayers = rows.length;
  const isWin = meIndex === 0;

  let nextGapText = '';
  if (meIndex > 0 && me) {
    const next = rows[meIndex - 1];
    const dp = (Number(next?.p) || 0) - mePoints;
    const dc = (Number(next?.cells) || 0) - meCells;
    const dk = (Number(next?.k) || 0) - meKills;
    const parts = [];
    if (dp > 0) parts.push(`${fmtInt(dp)} ${t('match.next_gap_points')}`);
    else if (dc > 0) parts.push(`${fmtInt(dc)} ${t('match.next_gap_cells')}`);
    else if (dk > 0) parts.push(`${fmtInt(dk)} ${t('match.next_gap_kills')}`);
    if (parts.length) nextGapText = `${t('match.next_gap')}: ${parts.join(' ')}`;
  }

  const trs = rows
    .slice(0, 32)
    .map((r, i) => {
      const n = Number(r?.n) || 0;
      const nm = String(r?.nm || n || '—');
      const p = Number(r?.p) || 0;
      const peak = resultPeak(r);
      const k = Number(r?.k) || 0;
      const d = resultDeaths(r);
      const isMe = n === you;
      const fr = Number(r?.fr) || 0;
      const frClass = `frame${Math.max(0, Math.min(7, fr))}`;
      return `
        <tr class="${isMe ? 'matchRowMe' : ''} ${frClass}">
          <td class="num">${i + 1}</td>
          <td class="name">${playerTitleHtml(cosTitleByPlayer.get(n) || 0)}${escapeHtml(nm)}</td>
          <td class="num">${fmtInt(p)}</td>
          <td class="num">${fmtInt(peak)}</td>
          <td class="num">${fmtInt(k)}</td>
          <td class="num">${fmtInt(d)}</td>
        </tr>
      `;
    })
    .join('');

  setSafeHtml(
    matchResultsEl,
    `
    <div class="matchSummary" aria-label="${escapeHtml(t('match.summary'))}">
      <div class="matchSummaryTop">
        <div class="matchResultPill ${isWin ? 'matchResultWin' : 'matchResultLose'}">${escapeHtml(isWin ? t('match.victory') : t('match.defeat'))}</div>
      </div>

      <div class="matchKpiGrid">
        <div class="matchKpi">
          <div class="matchKpiLabel">${escapeHtml(t('match.place'))}</div>
          <div class="matchKpiValue"><span data-count="place" data-to="${mePlace || 0}">${mePlace ? fmtInt(mePlace) : '—'}</span><span class="matchKpiOf"> ${escapeHtml(t('match.out_of'))} ${fmtInt(totalPlayers)}</span></div>
        </div>
        <div class="matchKpi">
          <div class="matchKpiLabel">${escapeHtml(t('match.points'))}</div>
          <div class="matchKpiValue" data-count="points" data-to="${mePoints}">${me ? fmtInt(mePoints) : '—'}</div>
        </div>
      </div>

      <div class="matchMiniGrid">
        <div class="matchMini">
          <div class="matchMiniLabel">${escapeHtml(t('match.peak'))}</div>
          <div class="matchMiniValue" data-count="zone" data-to="${meCells}">${me ? fmtInt(meCells) : '—'}</div>
        </div>
        <div class="matchMini">
          <div class="matchMiniLabel">${escapeHtml(t('match.avg'))}</div>
          <div class="matchMiniValue">${me ? fmtInt(meAvg) : '—'}</div>
        </div>
        <div class="matchMini">
          <div class="matchMiniLabel">${escapeHtml(t('match.kills'))}</div>
          <div class="matchMiniValue" data-count="kills" data-to="${meKills}">${me ? fmtInt(meKills) : '—'}</div>
        </div>
        <div class="matchMini">
          <div class="matchMiniLabel">${escapeHtml(t('match.deaths'))}</div>
          <div class="matchMiniValue">${me ? fmtInt(meDeaths) : '—'}</div>
        </div>
        ${meSe > 0 ? `<div class="matchMini matchMiniReward"><div class="matchMiniLabel">${escapeHtml(t('match.reward'))}</div><div class="matchMiniValue"><span data-count="reward" data-to="${meSe}" data-prefix="✨ +">✨ +${fmtInt(meSe)}</span> ${escapeHtml(t('cosmetics.style_points'))}</div></div>` : ''}
      </div>

      ${firstSkinHookHtml()}

      ${me && meCt ? `<div class="matchNextGap">${escapeHtml(t('match.contract'))}: ${escapeHtml(contractLabel(meCt) || String(meCt))} ${fmtInt(meCp)}/${fmtInt(meCg)}</div>` : ''}

      ${meCd ? `<div class="matchNextGap">${escapeHtml(t('match.contract_done'))}: ${escapeHtml(contractLabel(1) || '1')} ${fmtInt(Number(meCd[1]) || 0)} · ${escapeHtml(contractLabel(2) || '2')} ${fmtInt(Number(meCd[2]) || 0)} · ${escapeHtml(contractLabel(3) || '3')} ${fmtInt(Number(meCd[3]) || 0)}</div>` : ''}

      ${(meSb || mePb) ? `<div class="matchNextGap">${escapeHtml(t('match.breakdown'))}</div>` : ''}
      ${mePb ? `<div class="matchMiniGrid">
        <div class="matchMini"><div class="matchMiniLabel">${escapeHtml(t('match.points_breakdown'))}</div><div class="matchMiniValue">${escapeHtml(pointsBreakdownText(mePb))}</div></div>
      </div>` : ''}
      ${meSb ? `<div class="matchMiniGrid">
        <div class="matchMini"><div class="matchMiniLabel">${escapeHtml(t('match.style_breakdown'))}</div><div class="matchMiniValue">${escapeHtml(styleBreakdownText(meSb))}</div></div>
      </div>` : ''}

      ${nextGapText ? `<div class="matchNextGap">${escapeHtml(nextGapText)}</div>` : ''}

      <div class="matchNextActions" aria-label="${escapeHtml(t('match.summary'))}">
        <button id="matchQuickBtn" class="btnPrimary" type="button">${escapeHtml(t('match.play_on'))}</button>
        <button id="matchRoomsBtn" class="btnSecondary" type="button">${escapeHtml(t('match.rooms'))}</button>
        <button id="matchCosmeticsBtn" class="btnGhost" type="button">${escapeHtml(t('match.cosmetics'))}</button>
      </div>

      <label class="matchNextGap" style="display:flex; gap:10px; align-items:center;">
        <input id="matchAutoJoin" type="checkbox" ${matchAutoJoin ? 'checked' : ''} />
        <span>${escapeHtml(t('match.autojoin'))}</span>
      </label>
    </div>

    <div class="matchTableWrap" role="region" aria-label="${escapeHtml(t('match.player'))}">
      <table class="matchTable">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>${escapeHtml(t('match.player'))}</th>
            <th class="num">${escapeHtml(t('match.points'))}</th>
            <th class="num">${escapeHtml(t('match.peak'))}</th>
            <th class="num">${escapeHtml(t('match.kills'))}</th>
            <th class="num">${escapeHtml(t('match.deaths'))}</th>
          </tr>
        </thead>
        <tbody>
          ${trs}
        </tbody>
      </table>
    </div>
  `
  );

  const quickBtn = matchResultsEl.querySelector('#matchQuickBtn');
  quickBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    matchContinueBtn?.click();
  });

  const roomsBtn = matchResultsEl.querySelector('#matchRoomsBtn');
  roomsBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    matchMenuBtn?.click();
  });

  const cosBtn = matchResultsEl.querySelector('#matchCosmeticsBtn');
  cosBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    hideMatchOverlay();
    showCosmeticsOverlay();
  });

  const autoJoinEl = matchResultsEl.querySelector('#matchAutoJoin');
  if (autoJoinEl) {
    autoJoinEl.addEventListener('change', () => {
      matchAutoJoin = !!autoJoinEl.checked;
      localStorage.setItem('matchAutoJoin', matchAutoJoin ? '1' : '0');
    });
  }
}

function pointsBreakdownText(pb) {
  const arr = Array.isArray(pb) ? pb : [];
  const parts = [];
  const vKill = Number(arr[1]) || 0;
  const vRev = Number(arr[2]) || 0;
  const vBounty = Number(arr[3]) || 0;
  const vContract = Number(arr[4]) || 0;
  const vDaily = Number(arr[5]) || 0;
  const vCap = Number(arr[6]) || 0;
  if (vKill) parts.push(`${t('match.points_kill')}: ${fmtInt(vKill)}`);
  if (vRev) parts.push(`${t('match.points_revenge')}: ${fmtInt(vRev)}`);
  if (vBounty) parts.push(`${t('match.points_bounty')}: ${fmtInt(vBounty)}`);
  if (vContract) parts.push(`${t('match.points_contract')}: ${fmtInt(vContract)}`);
  if (vDaily) parts.push(`${t('match.points_daily')}: ${fmtInt(vDaily)}`);
  if (vCap) parts.push(`${t('match.points_capture')}: ${fmtInt(vCap)}`);
  return parts.length ? parts.join(' · ') : '—';
}

function styleBreakdownText(sb) {
  const arr = Array.isArray(sb) ? sb : [];
  const parts = [];
  for (let i = 1; i <= 7; i++) {
    const v = Number(arr[i]) || 0;
    if (!v) continue;
    parts.push(`${styleLabel(i)}: ${fmtInt(v)}`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

function updateMatchCountdown() {
  if (!matchCountdownEl) return;
  if (!matchEnded || !matchResetAt) {
    matchCountdownEl.textContent = '—';
    syncMatchOverlayActions();
    return;
  }
  const nt = approxNowTick();
  if (nt == null) {
    matchCountdownEl.textContent = '—';
    syncMatchOverlayActions();
    return;
  }
  const remTicks = Math.max(0, matchResetAt - nt);
  const remMs = tickMs ? remTicks * tickMs : 0;
  const sec = Math.max(0, Math.ceil(remMs / 1000));
  matchCountdownEl.textContent = `${sec}s`;
  syncMatchOverlayActions();
}

function resetClientForNewMatch() {
  matchContinuePending = false;
  if (matchContinueTimeout) {
    clearTimeout(matchContinueTimeout);
    matchContinueTimeout = 0;
  }

  matchStyleEarned = 0;

  // K2: номера игроков в новом матче раздаются заново — кэши по номеру нужно
  // обнулить, иначе враг ещё несколько минут рисуется цветом прошлого хозяина
  // номера, а два игрока могут оказаться одного цвета.
  colors.clear();
  ownerFillStyleCache.clear();
  minimapOwnerRgbCache.clear();
  botIds = new Set();
  coolDeadlineByOwner.clear();
  lastRoi = null;

  eventFeed.length = 0;
  lastEventsTick = 0;
  lastEventsAt = 0;
  bigToastCooldownUntil = 0;

  matchTabBadgeCount = 0;
  updateMatchTabBadge();
  try {
    for (const it of toastByKey.values()) {
      if (it?.timer) clearTimeout(it.timer);
    }
  } catch {}
  toastByKey.clear();
  toastQueue.length = 0;

  lastDeathInfo = null;
  lastYouStats = null;

  mutatorType = 0;
  mutatorUntil = 0;
  bountyTarget = 0;
  bountyUntil = 0;
  powerUps = new Map();

  youKills = 0;
  youStreak = 0;
  youTrailLen = 0;
  youInOwnZone = true;
  youNearestHomeX = -1;
  youNearestHomeY = -1;
  youNearestHomeAt = 0;
  comboReset();
  youContractType = 0;
  youContractGoal = 0;
  youContractProgress = 0;
  youContractUntil = 0;
  youShield = false;
  youSpeedUntilTick = 0;
  youSpeedType = 0;
  // keep youStyle; it is a persistent currency, not match-scoped

  try {
    if (killfeedEl) killfeedEl.replaceChildren();
    if (eventToastsEl) eventToastsEl.replaceChildren();
  } catch {}

  lastState = null;
  prevPlayers = new Map();
  currPlayers = new Map();
  headIndexByOwner = new Map();
  lastPacketAt = performance.now();
  camX = null;
  camY = null;

  shakeX = 0;
  shakeY = 0;
  shakeVelX = 0;
  shakeVelY = 0;

  minimapDirty = true;
  minimapHadChunkUpdate = false;
  lastMinimapDrawAt = 0;

  lastLeaderboardSig = '';
  lbAroundIndex = null;
  lbAroundIndexAt = 0;
  leaderboardRowsById = new Map();
  try {
    leaderboardTbody?.replaceChildren?.();
  } catch {}

  renderKillfeed();
  renderMetaHud();
  renderTopHud();
  syncMatchOverlayActions();
}

function onMatchEnd(d) {
  if (typeof d?.tick === 'number' && Number.isFinite(d.tick)) {
    lastEventsTick = d.tick;
    lastEventsAt = Date.now();
  }
  matchSeq = Number(d?.seq) || matchSeq;
  matchEndTick = Number(d?.endTick) || matchEndTick;
  matchResetAt = Number(d?.resetAt) || 0;
  matchEnded = true;

  matchContinuePending = false;
  if (matchContinueTimeout) {
    clearTimeout(matchContinueTimeout);
    matchContinueTimeout = 0;
  }

  youAlive = false;
  lastDirSent = null;
  started = false;

  hideOverlays();

  lastMatchResults = d?.results || null;

  bumpMatchesPlayed();
  renderMatchResults(lastMatchResults);
  updateMatchCountdown();
  showMatchOverlay();
}

function onMatchStart(d) {
  if (typeof d?.tick === 'number' && Number.isFinite(d.tick)) {
    lastEventsTick = d.tick;
    lastEventsAt = Date.now();
  }
  matchSeq = Number(d?.seq) || matchSeq;
  matchEndTick = Number(d?.endTick) || 0;
  matchResetAt = 0;
  matchEnded = false;

  matchContinuePending = false;
  if (matchContinueTimeout) {
    clearTimeout(matchContinueTimeout);
    matchContinueTimeout = 0;
  }

  youAlive = false;
  lastDirSent = null;

  if (matchAutoJoin) {
    resetClientForNewMatch();
    hideMatchOverlay();
    hideOverlays();
    toggleEmojiPanel(false);
    syncMatchOverlayActions();
    started = true;
    obResetMatch();
    obAnnounceShop();
    try {
      document.body.classList.add('inGame');
    } catch {}
  } else {
    // stay in results overlay until user clicks "Играть дальше"
    started = false;
    updateMatchCountdown();
    showMatchOverlay();
  }
}

function hideOverlays() {
  // K7: флаг залипал — оверлей магазина скрыт, а cosmeticsOpen остаётся true,
  // и каждое начисление Стиля запускало полную пересборку DOM скрытого
  // магазина (замер 3.3 мс на начисление).
  cosmeticsOpen = false;
  if (menuOverlay) menuOverlay.classList.add('hidden');
  if (settingsOverlay) settingsOverlay.classList.add('hidden');
  if (matchOverlay) matchOverlay.classList.add('hidden');
  if (deathOverlay) deathOverlay.classList.add('hidden');
  if (cosmeticsOverlay) cosmeticsOverlay.classList.add('hidden');
  if (minimapOverlayEl) minimapOverlayEl.classList.add('hidden');
  overlayManager.close('menu');
  overlayManager.close('settings');
  overlayManager.close('match');
  overlayManager.close('death');
  overlayManager.close('cosmetics');
  overlayManager.close('minimap');
  syncOverlayUiState();
}

restartBtn?.addEventListener('click', () => {
  wsSend('respawn', { rejoin: true });
  hideOverlays();
  started = true;
  youStreak = 0;
  lastDeathInfo = null;
  lastYouStats = null;
});

deathMenuBtn?.addEventListener('click', () => {
  leaveBtn?.click();
});

function showMenuOverlay() {
  if (menuOverlay) menuOverlay.classList.remove('hidden');
  if (deathOverlay) deathOverlay.classList.add('hidden');
  overlayManager.close('death');
  overlayManager.open('menu');
  started = false;
  youAlive = false;
  try {
    document.body.classList.remove('inGame');
  } catch {}
  updateMenuNameUi();
  syncMenuOnboardingUi();
  createRoomPending = false;
  updateRoomsCreateUi();
  lastYouStats = null;
  if (roomsLoadTimeout) {
    clearTimeout(roomsLoadTimeout);
    roomsLoadTimeout = 0;
  }
  if (roomsLoading && (!Array.isArray(lastRooms) || lastRooms.length === 0)) {
    roomsLoading = false;
  }
  overlayManager.focusDefault('menu');
  if (topHudEl) topHudEl.setAttribute('aria-hidden', 'true');
  youStreak = 0;
  syncOverlayUiState();
}

function hideMenuOverlay() {
  if (menuOverlay) menuOverlay.classList.add('hidden');
  overlayManager.close('menu');
  syncOverlayUiState();
}

leaveBtn?.addEventListener('click', () => {
  // K7: явный выход — реконнект в эту комнату больше не нужен.
  userLeftRoom = true;
  rejoinRoomId = null;
  rejoinPending = false;
  wsSend('leave', {});
  roomId = null;
  roomLimit = null;
  updateRoomInfo();
  showMenuOverlay();
});

function renderRoomsList(rooms, emptyMessage) {
  if (!roomsListEl) return;
  roomsListEl.textContent = '';
  if (!Array.isArray(rooms) || rooms.length === 0) {
    roomsListEl.textContent = emptyMessage || t('rooms.empty');
    return;
  }

  const wrap = document.createElement('div');
  wrap.setAttribute('role', 'listbox');
  wrap.setAttribute('aria-label', t('rooms.list_aria'));
  for (const r of rooms) {
    const row = document.createElement('div');
    const rid = r?.id;
    const titleText = String(r?.title || '').trim();
    const humans = Number(r?.humans) || 0;
    const limit = Number(r?.limit) || 0;
    const names = Array.isArray(r?.names) ? r.names : [];
    const nameCount = Number(r?.nameCount) || names.length;
    const namesTruncated = !!r?.namesTruncated;

    const title = document.createElement('div');
    title.className = 'roomRowTitle';
    if (titleText) title.textContent = `${titleText} (#${rid})`;
    else title.textContent = `${t('rooms.room')} ${rid}`;

    const meta = document.createElement('div');
    meta.className = 'roomRowMeta';
    meta.textContent = `${humans}/${limit}`;

    const list = document.createElement('div');
    list.className = 'roomRowSub';
    const hidden = Math.max(0, nameCount - names.length);
    const suffix = (namesTruncated || hidden > 0) && hidden > 0 ? ` (+${hidden})` : '';
    list.textContent = (names.length ? names.join(', ') : '—') + suffix;

    const join = document.createElement('button');
    join.className = 'btnGhost roomRowJoin';
    join.type = 'button';
    join.textContent = t('rooms.join');
    join.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      attemptJoinRoom(rid);
    });

    row.classList.add('roomRow');
    row.dataset.rid = String(rid);
    row.setAttribute('role', 'option');
    if (selectedRoomId != null && Number(rid) === Number(selectedRoomId)) {
      row.classList.add('selected');
      row.setAttribute('aria-selected', 'true');
    } else {
      row.setAttribute('aria-selected', 'false');
    }
    row.tabIndex = 0;

    const applySelection = (target) => {
      selectedRoomId = rid;
      if (joinRoomBtn) joinRoomBtn.disabled = selectedRoomId == null;
      const parent = target?.parentElement;
      if (parent) {
        for (const el of parent.children) {
          try {
            el.classList.remove('selected');
            el.setAttribute('aria-selected', 'false');
          } catch {}
        }
      }
      try {
        target.classList.add('selected');
        target.setAttribute('aria-selected', 'true');
      } catch {}
    };

    row.addEventListener('click', () => {
      applySelection(row);
      updateRoomsStats(lastRooms);
    });
    row.addEventListener('dblclick', () => {
      applySelection(row);
      attemptJoinRoom(rid);
    });
    row.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        applySelection(row);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        applySelection(row);
        attemptJoinRoom(rid);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const parent = row.parentElement;
        if (!parent) return;
        const items = Array.from(parent.children);
        const idx = items.indexOf(row);
        const next = e.key === 'ArrowDown' ? items[idx + 1] : items[idx - 1];
        const nextRid = next?.dataset?.rid;
        if (!next || nextRid == null) return;
        try {
          next.focus();
        } catch {}
        selectedRoomId = Number(nextRid);
        if (joinRoomBtn) joinRoomBtn.disabled = selectedRoomId == null;
        for (const el of items) {
          try {
            el.classList.remove('selected');
            el.setAttribute('aria-selected', 'false');
          } catch {}
        }
        try {
          next.classList.add('selected');
          next.setAttribute('aria-selected', 'true');
        } catch {}
      }
    });

    const top = document.createElement('div');
    top.className = 'roomRowTop';
    const left = document.createElement('div');
    left.className = 'roomRowLeft';
    left.appendChild(title);
    left.appendChild(meta);
    top.appendChild(left);
    top.appendChild(join);

    row.appendChild(top);
    row.appendChild(list);
    wrap.appendChild(row);
  }
  roomsListEl.appendChild(wrap);
}

function renderRoomsEmpty(kind, message) {
  if (!roomsListEl) return;
  roomsListEl.textContent = '';

  const wrap = document.createElement('div');
  wrap.className = 'roomsEmpty';

  const title = document.createElement('div');
  title.className = 'roomsEmptyTitle';

  const desc = document.createElement('div');
  desc.className = 'roomsEmptyDesc';

  const actions = document.createElement('div');
  actions.className = 'roomsEmptyActions';

  const k = String(kind || 'empty');
  if (k === 'loading') {
    title.textContent = t('rooms.empty_loading_title');
    desc.textContent = t('rooms.empty_loading_desc');
  } else if (k === 'error') {
    title.textContent = t('rooms.empty_error_title');
    desc.textContent = String(message || t('rooms.empty_error_desc'));
    const retry = document.createElement('button');
    retry.className = 'btnGhost';
    retry.textContent = t('rooms.retry');
    retry.addEventListener('click', () => refreshRoomsBtn?.click());
    const create = document.createElement('button');
    create.className = 'btnPrimary';
    create.textContent = t('rooms.create_room');
    create.addEventListener('click', () => setRoomsCreateOpen(true));
    actions.appendChild(retry);
    actions.appendChild(create);
  } else if (k === 'noMatch') {
    title.textContent = t('rooms.empty_no_match_title');
    desc.textContent = t('rooms.empty_no_match_desc');
    const reset = document.createElement('button');
    reset.className = 'btnGhost';
    reset.textContent = t('rooms.reset_search');
    reset.addEventListener('click', () => {
      if (roomsSearchInput) roomsSearchInput.value = '';
      updateRoomsUi();
      try {
        roomsSearchInput?.focus();
      } catch {}
    });
    const create = document.createElement('button');
    create.className = 'btnPrimary';
    create.textContent = t('rooms.create_room');
    create.addEventListener('click', () => {
      setRoomsCreateOpen(true);
    });
    actions.appendChild(reset);
    actions.appendChild(create);
  } else {
    title.textContent = t('rooms.empty_none_title');
    desc.textContent = t('rooms.empty_none_desc');
    const create = document.createElement('button');
    create.className = 'btnPrimary';
    create.textContent = t('rooms.create_room');
    create.addEventListener('click', () => {
      setRoomsCreateOpen(true);
    });
    actions.appendChild(create);
  }

  wrap.appendChild(title);
  wrap.appendChild(desc);
  if (actions.childNodes.length) wrap.appendChild(actions);
  roomsListEl.appendChild(wrap);
}

function roomsQueryText(r) {
  const rid = r?.id;
  const title = String(r?.title || '').trim();
  const humans = Number(r?.humans) || 0;
  const limit = Number(r?.limit) || 0;
  const names = Array.isArray(r?.names) ? r.names : [];
  const nameCount = Number(r?.nameCount) || names.length;
  return `${rid} ${title} ${humans}/${limit} ${nameCount} ${names.join(' ')}`.toLowerCase();
}

function updateRoomsStats(rawRooms) {
  const rooms = Array.isArray(rawRooms) ? rawRooms : [];
  const totalHumans = rooms.reduce((acc, r) => acc + (Number(r?.humans) || 0), 0);

  // Счётчик онлайна в шапке меню: самая ценная для конверсии цифра, раньше она
  // была спрятана в служебную строку внутри свёрнутой панели комнат.
  try {
    const onlineEl = document.getElementById('menuOnlineCount');
    if (onlineEl) onlineEl.textContent = formatNumber(totalHumans);
    // K7: в поле `humans` сервер считает только людей, поэтому в пустой момент
    // бейдж честно писал «0 сейчас играют» — при 13 живых ботах на карте это
    // худшая из возможных первых цифр. Ботов в списке комнат нет, посчитать их
    // клиент не может, поэтому нулевой бейдж просто прячем.
    const badgeEl = document.getElementById('menuOnlineBadge');
    if (badgeEl) badgeEl.classList.toggle('hidden', !(totalHumans > 0));
  } catch {}

  if (!roomsStatsEl) return;
  const status = roomsLoading ? ` • ${t('rooms.loading')}` : roomsLoadError ? ` • ${roomsLoadError}` : '';
  roomsStatsEl.textContent = `${t('rooms.stats_prefix')}: ${formatNumber(rooms.length)} • ${t('rooms.stats_online')}: ${formatNumber(totalHumans)}${wsStatusSuffix()}${status}`;
}

function sortRooms(rooms) {
  const mode = String(roomsSortSelect?.value || 'free');
  const out = [...rooms];

  if (mode === 'id') {
    out.sort((a, b) => (Number(a?.id) || 0) - (Number(b?.id) || 0));
    return out;
  }

  if (mode === 'free') {
    out.sort((a, b) => {
      const ah = Number(a?.humans) || 0;
      const al = Math.max(1, Number(a?.limit) || 1);
      const bh = Number(b?.humans) || 0;
      const bl = Math.max(1, Number(b?.limit) || 1);
      const aFull = ah >= al;
      const bFull = bh >= bl;
      if (aFull !== bFull) return aFull ? 1 : -1;
      if (bh !== ah) return bh - ah;
      return (Number(a?.id) || 0) - (Number(b?.id) || 0);
    });
    return out;
  }

  if (mode === 'humans') {
    out.sort((a, b) => {
      const ah = Number(a?.humans) || 0;
      const bh = Number(b?.humans) || 0;
      if (bh !== ah) return bh - ah;
      return (Number(a?.id) || 0) - (Number(b?.id) || 0);
    });
    return out;
  }

  out.sort((a, b) => {
    const ah = Number(a?.humans) || 0;
    const al = Math.max(1, Number(a?.limit) || 1);
    const bh = Number(b?.humans) || 0;
    const bl = Math.max(1, Number(b?.limit) || 1);
    const af = ah / al;
    const bf = bh / bl;
    if (bf !== af) return bf - af;
    if (bh !== ah) return bh - ah;
    return (Number(a?.id) || 0) - (Number(b?.id) || 0);
  });
  return out;
}

function applyRoomsFilterSort() {
  const raw = Array.isArray(lastRooms) ? lastRooms : [];
  const q = String(roomsSearchInput?.value || '').trim().toLowerCase();
  const filtered = q ? raw.filter((r) => roomsQueryText(r).includes(q)) : raw;
  return sortRooms(filtered);
}

function updateRoomsUi() {
  syncRoomsSearchClearUi();
  const rawAll = Array.isArray(lastRooms) ? lastRooms : [];
  if (selectedRoomId != null) {
    const exists = rawAll.some((r) => Number(r?.id) === Number(selectedRoomId));
    if (!exists) selectedRoomId = null;
  }

  if (joinRoomBtn) {
    joinRoomBtn.disabled = selectedRoomId == null;
  }
  updateRoomsStats(lastRooms);
  const raw = Array.isArray(lastRooms) ? lastRooms : [];
  const filtered = applyRoomsFilterSort();

  if (roomsLoading && raw.length === 0) {
    renderRoomsEmpty('loading');
    return;
  }
  if (roomsLoadError && raw.length === 0) {
    renderRoomsEmpty('error', roomsLoadError);
    return;
  }
  if (raw.length === 0) {
    renderRoomsEmpty('empty');
    return;
  }
  if (filtered.length === 0) {
    renderRoomsEmpty('noMatch');
    return;
  }
  renderRoomsList(filtered);
}

playBtn?.addEventListener('click', () => {
  // Пустой ник не должен быть барьером: подставляем случайный и стартуем.
  ensureNickBeforePlay();
  const nm = submitNameFromInput(menuNameInput);
  if (!nm) {
    updateMenuNameUi();
    menuNameInput?.focus();
    return;
  }
  userLeftRoom = false;
  trackEvent('quick_start');
  wsSend('join', { mode: 'auto' });
});

joinRoomBtn?.addEventListener('click', () => {
  if (selectedRoomId == null) return;
  const nm = submitNameFromInput(menuNameInput);
  if (!nm) {
    updateMenuNameUi();
    menuNameInput?.focus();
    return;
  }
  userLeftRoom = false;
  trackEvent('join_room');
  wsSend('join', { roomId: selectedRoomId, mode: 'id' });
});

menuNameInput?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  // H5: Enter в поле ника запускает игру — привычный для жанра паттерн.
  // Раньше нажатие просто гасилось, и клавиатурный путь «ввёл ник → Enter» не работал.
  e.preventDefault();
  playBtn?.click();
});

menuNameInput?.addEventListener('input', () => {
  updateMenuNameUi();
});

menuNameRandomBtn?.addEventListener('click', (e) => {
  e?.preventDefault?.();
  applyRandomNick();
});

roomsSearchInput?.addEventListener('input', () => {
  syncRoomsSearchClearUi();
});

roomsSearchClearBtn?.addEventListener('click', (e) => {
  e?.preventDefault?.();
  clearRoomsSearch();
});

refreshRoomsBtn?.addEventListener('click', () => {
  if (roomsLoading) return;
  if (roomsLoadTimeout) {
    clearTimeout(roomsLoadTimeout);
    roomsLoadTimeout = 0;
  }

  roomsLoading = true;
  roomsLoadError = '';
  trackEvent('refresh_rooms');
  if (refreshRoomsBtn) {
    refreshRoomsBtn.disabled = true;
    refreshRoomsBtn.classList.add('isLoading');
    refreshRoomsBtn.textContent = t('rooms.loading');
  }
  updateRoomsUi();
  wsSend('rooms', {});

  roomsLoadTimeout = setTimeout(() => {
    roomsLoadTimeout = 0;
    if (!roomsLoading) return;
    roomsLoading = false;
    roomsLoadError = t('rooms.timeout');
    if (refreshRoomsBtn) {
      refreshRoomsBtn.disabled = false;
      refreshRoomsBtn.classList.remove('isLoading');
      refreshRoomsBtn.textContent = t('rooms.refresh');
    }
    updateRoomsUi();
  }, 4000);
});

roomsSearchInput?.addEventListener('input', () => {
  updateRoomsUi();
});

roomsSortSelect?.addEventListener('change', () => {
  updateRoomsUi();
});

function updateRoomInfo() {
  if (!roomInfoEl) return;
  const rid = roomId == null ? '…' : String(roomId);
  const lim = roomLimit == null ? '' : ` / ${roomLimit}`;
  roomInfoEl.textContent = `${t('perf.room')}: ${rid}${lim}${wsStatusSuffix()}`;
  try {
    updateChatHeaderStatus();
  } catch {}
}

function ensureLeaderboardDom() {
  if (!statsEl) return;
  if (leaderboardTable && leaderboardTbody) return;

  leaderboardTable = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  const thRank = document.createElement('th');
  thRank.textContent = '#';
  thRank.className = 'rank';
  const thName = document.createElement('th');
  thName.textContent = t('leaderboard.player');
  const thCells = document.createElement('th');
  thCells.textContent = t('leaderboard.cells');
  thCells.style.textAlign = 'right';
  const thPct = document.createElement('th');
  thPct.textContent = t('leaderboard.share');
  thPct.style.textAlign = 'right';
  trh.appendChild(thRank);
  trh.appendChild(thName);
  trh.appendChild(thCells);
  trh.appendChild(thPct);
  thead.appendChild(trh);
  leaderboardTable.appendChild(thead);

  leaderboardTbody = document.createElement('tbody');
  leaderboardTable.appendChild(leaderboardTbody);

  statsEl.replaceChildren(leaderboardTable);
}

function createLeaderboardRow(p) {
  const tr = document.createElement('tr');
  tr.dataset.pid = String(p.n);
  tr.classList.add('lb-enter');

  const tdRank = document.createElement('td');
  tdRank.className = 'rank';
  const tdName = document.createElement('td');
  tdName.className = 'name';
  const tdCells = document.createElement('td');
  tdCells.className = 'num';
  const tdPct = document.createElement('td');
  tdPct.className = 'num';

  tr.appendChild(tdRank);
  tr.appendChild(tdName);
  tr.appendChild(tdCells);
  tr.appendChild(tdPct);

  tr._lb = { tdRank, tdName, tdCells, tdPct };
  return tr;
}

function computeTopSorted(players) {
  const ordered = [...(players || [])].sort((a, b) => (b.p || 0) - (a.p || 0) || (b.s || 0) - (a.s || 0));
  return ordered;
}

function renderDeathStats() {
  if (!deathStatsEl) return;
  if (!lastState) {
    deathStatsEl.textContent = '';
    return;
  }
  const ordered = computeTopSorted(lastState.players);
  const meIndex = ordered.findIndex((p) => p.n === you);
  const me = meIndex >= 0 ? ordered[meIndex] : null;

  const snap = lastYouStats;
  const cells = Number(snap?.cells ?? me?.s) || 0;
  const pct = Number(snap?.pct ?? (mapCells ? (cells / mapCells) * 100 : 0)) || 0;
  const place =
    String(snap?.place || '').trim() || (meIndex >= 0 ? `${meIndex + 1}/${ordered.length}` : '—');

  const points = Number(snap?.points ?? me?.p) || 0;

  let contractText = '';
  if (youContractType) {
    const cn = contractLabel(youContractType) || infoPack().labels.contract;
    contractText = `${cn}: ${youContractProgress}/${youContractGoal}`;
  }

  const top = ordered.slice(0, 5);
  const rows = top
    .map((p, i) => {
      const pid = String(p.n);
      const nm = p.nm || String(p.n);
      const isMe = p.n === you;
      const isTop1 = i === 0;
      return `
        <tr class="${isMe ? 'me' : ''} ${isTop1 ? 'top1' : ''} frame${Math.max(0, Math.min(7, Number(p.cosFrame) || 0))}" data-pid="${pid}">
          <td class="num">${i + 1}</td>
          <td class="name">${playerTitleHtml(cosTitleByPlayer.get(p.n) || 0)}${escapeHtml(nm)}</td>
          <td class="num">${Number(p.p) || 0}</td>
        </tr>
      `;
    })
    .join('');

  const youBlock =
    meIndex >= 0
      ? `
    <div class="deathYou">
      <div class="deathYouTitle">${escapeHtml(t('death.your_result'))}</div>
      <div class="deathYouRow">
        <div>${escapeHtml(t('death.place'))}</div>
        <div class="num">${escapeHtml(place)}</div>
      </div>
      <div class="deathYouRow">
        <div>${escapeHtml(t('death.points'))}</div>
        <div class="num">${fmtInt(points)}</div>
      </div>
      <div class="deathYouRow">
        <div>${escapeHtml(t('death.zone'))}</div>
        <div class="num">${fmtInt(cells)} • ${fmtPct1(pct)}</div>
      </div>
      <div class="deathYouRow">
        <div>${escapeHtml(t('death.kills'))}</div>
        <div class="num">${fmtInt(youKills)}</div>
      </div>
      ${
        contractText
          ? `
      <div class="deathYouRow">
        <div>${escapeHtml(t('death.contract'))}</div>
        <div class="num">${escapeHtml(contractText)}</div>
      </div>
      `
          : ''
      }
    </div>
    `
      : '';

  setSafeHtml(
    deathStatsEl,
    `
    <div class="deathStatsGrid">
      <div class="deathStat deathStatPrimary">
        <div class="deathStatLabel">${escapeHtml(t('death.place'))}</div>
        <div class="deathStatValue">${escapeHtml(place)}</div>
      </div>
      <div class="deathStat">
        <div class="deathStatLabel">${escapeHtml(t('death.points'))}</div>
        <div class="deathStatValue">${fmtInt(points)}</div>
      </div>
      <div class="deathStat">
        <div class="deathStatLabel">${escapeHtml(t('death.kills'))}</div>
        <div class="deathStatValue">${fmtInt(youKills)}</div>
      </div>
    </div>

    <div class="toastSub">${place && place !== '—' && place.startsWith('1/') ? escapeHtml(t('death.top1')) : escapeHtml(t('death.try_again'))}</div>

    ${youBlock}

    <div class="deathTop">
      <div class="deathTopTitle">${escapeHtml(t('death.top'))}</div>
      <table>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `
  );

  try {
    const now = performance.now();
    if (rightTeamDetailsEl && !rightTeamDetailsEl.open) {
      if (!renderTeamHud._u || now - renderTeamHud._u > 1600) {
        renderTeamHud._u = now;
        teamUnreadCount = Math.min(999, teamUnreadCount + 1);
        setBadgeCount(rightTeamBadgeEl, teamUnreadCount);
      }
    }
  } catch {}
  try {
    syncRightEmptyStates();
  } catch {}
}

renderTeamHud._u = 0;
renderTeamHud._at = 0;

function updateLeaderboard() {
  if (!lastState) return;
  ensureLeaderboardDom();
  if (!leaderboardTbody) return;

  const now = performance.now();
  lastLeaderboardRenderAt = now;

  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const small = window.innerWidth <= 720;
  const maxRows = small ? 8 : 10;
  const topCount = 5;
  const ordered = computeTopSorted(lastState.players);
  const meIndex = ordered.findIndex((p) => p.n === you);

  // Hysteresis for switching between "Top" and "Around me" mode.
  // This prevents the leaderboard from constantly changing its set of rows near the boundary.
  if (meIndex < 0) {
    lbMode = 'top';
  } else if (lbMode === 'top') {
    if (meIndex >= topCount + 1) {
      lbMode = 'around';
      lbAroundIndex = meIndex;
      lbAroundIndexAt = now;
    }
  } else {
    if (meIndex <= topCount - 2) {
      lbMode = 'top';
    }
  }

  const pick = [];
  const picked = new Set();
  const pushAt = (i) => {
    if (i < 0 || i >= ordered.length) return;
    const p = ordered[i];
    const pid = String(p.n);
    if (picked.has(pid)) return;
    picked.add(pid);
    pick.push({ p, rank: i + 1 });
  };

  for (let i = 0; i < topCount; i++) pushAt(i);
  if (lbMode === 'around' && meIndex >= topCount) {
    if (lbAroundIndex == null) {
      lbAroundIndex = meIndex;
      lbAroundIndexAt = now;
    } else {
      const diff = Math.abs(meIndex - lbAroundIndex);
      // Update the around-me anchor only on meaningful movement or after a short cooldown.
      if (diff >= 2 || (diff >= 1 && now - lbAroundIndexAt > 2500)) {
        lbAroundIndex = meIndex;
        lbAroundIndexAt = now;
      }
    }
    for (let i = lbAroundIndex - 2; i <= lbAroundIndex + 2; i++) pushAt(i);
  }
  if (pick.length > maxRows) pick.length = maxRows;

  const nearIds = new Set();
  if (meIndex >= 0) {
    for (let i = meIndex - 1; i <= meIndex + 1; i++) {
      if (i < 0 || i >= ordered.length) continue;
      nearIds.add(String(ordered[i].n));
    }
  }

  const firstTops = new Map();
  if (!reduceMotion) {
    for (const tr of leaderboardTbody.children) {
      const pid = tr?.dataset?.pid;
      if (!pid) continue;
      firstTops.set(pid, tr.getBoundingClientRect().top);
    }
  }

  const nextIds = new Set();
  for (const it of pick) {
    const p = it.p;
    const pid = String(p.n);
    nextIds.add(pid);

    let tr = leaderboardRowsById.get(pid);
    if (!tr) {
      tr = createLeaderboardRow(p);
      leaderboardRowsById.set(pid, tr);
    }

    if (p.n === you) tr.classList.add('me');
    else tr.classList.remove('me');
    // Рамка — CSS-класс .frame0..7 на строке таблицы лидеров.
    const frCls = `frame${cosClampId(p.cosFrame)}`;
    if (tr._frCls !== frCls) {
      if (tr._frCls) tr.classList.remove(tr._frCls);
      tr.classList.add(frCls);
      tr._frCls = frCls;
    }
    if (p.n !== you && nearIds.has(pid)) tr.classList.add('lbNear');
    else tr.classList.remove('lbNear');

    const lb = tr._lb;
    if (lb) {
      if (lb.tdRank) lb.tdRank.textContent = String(it.rank);
      // Титул перед ником — как в плашке над головой и в итогах матча.
      setNameCellWithTitle(lb.tdName, cosTitleByPlayer.get(p.n) || 0, p.nm || String(p.n));
      lb.tdCells.textContent = `${p.p || 0} • ${p.s || 0}`;
      const pct = mapCells ? ((p.s || 0) / mapCells) * 100 : 0;
      lb.tdPct.textContent = pct.toFixed(1);
    }
  }

  // Signature must be stable and preserve order; Set iteration order can be misleading.
  const sig = pick.map((it) => String(it.p.n)).join(',');
  if (sig === lastLeaderboardSig) {
    // Только обновляем данные/классы — без перестановок DOM и без FLIP.
    return;
  }
  lastLeaderboardSig = sig;

  for (const it of pick) {
    const pid = String(it.p.n);
    const tr = leaderboardRowsById.get(pid);
    if (!tr) continue;
    leaderboardTbody.appendChild(tr);
  }

  for (const [pid, tr] of leaderboardRowsById) {
    if (nextIds.has(pid)) continue;
    if (!tr || tr.classList.contains('lb-leave')) {
      leaderboardRowsById.delete(pid);
      continue;
    }
    tr.classList.remove('lb-enter');
    tr.classList.add('lb-leave');
    setTimeout(() => {
      tr.remove();
    }, 260);
    leaderboardRowsById.delete(pid);
  }

  const moved = [];
  if (!reduceMotion) {
    for (const pid of nextIds) {
      const tr = leaderboardRowsById.get(pid);
      if (!tr) continue;
      const firstTop = firstTops.get(pid);
      if (firstTop == null) continue;
      const lastTop = tr.getBoundingClientRect().top;
      const dy = firstTop - lastTop;
      if (!dy) continue;
      tr.style.transition = 'none';
      tr.style.transform = `translateY(${dy}px)`;
      moved.push(tr);
    }

    // Force layout so the browser applies the inverted transforms before we start transitions.
    leaderboardTbody.getBoundingClientRect();
  }

  requestAnimationFrame(() => {
    for (const pid of nextIds) {
      const tr = leaderboardRowsById.get(pid);
      if (!tr) continue;
      if (tr.classList.contains('lb-enter')) tr.classList.remove('lb-enter');
    }

    if (reduceMotion) return;

    for (const tr of moved) {
      tr.style.transition = '';
      tr.style.transform = '';
    }
  });
}

const EMOJIS = [
  '\u{1F44B}',
  '\u{1F44D}',
  '\u{1F44E}',
  '\u{2705}',
  '\u{274C}',
  '\u{2753}',
  '\u{203C}\u{FE0F}',
  '\u{26A0}\u{FE0F}',
  '\u{1F198}',
  '\u{23F3}',
  '\u{1F440}',
  '\u{1F9E0}',
  '\u{1F5FA}\u{FE0F}',
  '\u{1F9ED}',
  '\u{1F3C1}',
  '\u{1F6A9}',
  '\u{1F3AF}',
  '\u{2694}\u{FE0F}',
  '\u{1F6E1}\u{FE0F}',
  '\u{1F3F9}',
  '\u{1F4A3}',
  '\u{1F4A5}',
  '\u{1F525}',
  '\u{26A1}',
  '\u{2728}',
  '\u{2764}\u{FE0F}',
  '\u{1F494}',
  '\u{1F602}',
  '\u{1F605}',
  '\u{1F60E}',
  '\u{1F621}',
  '\u{1F62D}',
  '\u{1F631}',
  '\u{1F92F}'
];

const EMOJI_PNG_BASE = '/emoji-64/';

const TWEMOJI_OPTS = {
  callback: (icon) => {
    const normalized = String(icon).toLowerCase().replace(/-fe0f/g, '');
    return `${EMOJI_PNG_BASE}${normalized}.png`;
  },
  className: 'emoji',
  attributes: () => ({ loading: 'lazy', decoding: 'async' })
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emojiParseSafeHtml(text) {
  const raw = String(text);
  const escaped = escapeHtml(raw);
  if (!/[\p{Extended_Pictographic}]/u.test(raw)) return escaped;
  const tw = globalThis.twemoji;
  if (tw && typeof tw.parse === 'function') return tw.parse(escaped, TWEMOJI_OPTS);
  return escaped;
}

function setSafeHtml(el, html) {
  if (!el) return;
  el.innerHTML = String(html ?? '');
}

function setSafeEmojiHtml(el, text) {
  if (!el) return;
  el.innerHTML = emojiParseSafeHtml(text);
}

function syncChatInputOverlayScroll() {
  if (!chatInputOverlay || !chatInput) return;
  chatInputOverlay.scrollLeft = chatInput.scrollLeft;
}

let chatInputOverlayRaf = 0;
function renderChatInputOverlayNow() {
  chatInputOverlayRaf = 0;
  if (!chatInputOverlay || !chatInput) return;
  const v = chatInput.value || '';
  setSafeHtml(chatInputOverlay, v ? `<span class="chatInputText">${emojiParseSafeHtml(v)}</span>` : '<span class="chatInputText"></span>');
  requestAnimationFrame(syncChatInputOverlayScroll);
}

function scheduleChatInputOverlayRender() {
  if (chatInputOverlayRaf) return;
  chatInputOverlayRaf = requestAnimationFrame(renderChatInputOverlayNow);
}

function insertAtCursor(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  el.value = `${before}${text}${after}`;
  const pos = start + text.length;
  el.selectionStart = pos;
  el.selectionEnd = pos;
  el.focus();
  if (el === chatInput) scheduleChatInputOverlayRender();
}

chatInput?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.shiftKey) {
    chatOpenUntil = performance.now() + 12000;
    return;
  }
  e.preventDefault();
  try {
    chatForm?.requestSubmit?.();
  } catch {
    try {
      chatForm?.dispatchEvent?.(new Event('submit', { cancelable: true }));
    } catch {}
  }
});

function toggleEmojiPanel(open) {
  const shouldOpen = open ?? !emojiPanel.classList.contains('open');
  emojiPanel.classList.toggle('open', shouldOpen);
  if (shouldOpen) chatOpenUntil = performance.now() + 12000;
  if (shouldOpen) {
    renderEmojiRecent();
    emojiSearch?.focus();
  } else {
    emojiSearch && (emojiSearch.value = '');
    renderEmojiGrid(EMOJIS);
  }
}

emojiBtn.addEventListener('click', () => {
  if (chat.classList.contains('collapsed')) setChatCollapsed(false);
  toggleEmojiPanel();
});

const RECENT_KEY = 'recentEmojis';
let recentEmojis = [];

function getEmojiCode(e) {
  const cps = Array.from(String(e)).map((ch) => ch.codePointAt(0).toString(16));
  return cps.join('-').toLowerCase().replace(/-fe0f/g, '');
}

function loadRecentEmojis() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').slice(0, 24);
  } catch {
    // ignore
  }
  return [];
}

function saveRecentEmojis() {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentEmojis.slice(0, 24)));
  } catch {
    // ignore
  }
}

function pushRecentEmoji(e) {
  const s = String(e);
  recentEmojis = [s, ...recentEmojis.filter((x) => x !== s)].slice(0, 24);
  saveRecentEmojis();
}

function createEmojiButton(e) {
  const b = document.createElement('button');
  b.type = 'button';
  setSafeEmojiHtml(b, e);
  b.addEventListener('click', () => {
    insertAtCursor(chatInput, e);
    pushRecentEmoji(e);
    renderEmojiRecent();
    chatOpenUntil = performance.now() + 12000;
  });
  return b;
}

function renderEmojiGrid(list) {
  if (!emojiGrid) return;
  const frag = document.createDocumentFragment();
  for (const e of list) frag.appendChild(createEmojiButton(e));
  emojiGrid.replaceChildren(frag);
}

function renderEmojiRecent() {
  if (!emojiRecent) return;
  if (!recentEmojis.length) {
    emojiRecent.classList.add('hidden');
    emojiRecent.replaceChildren();
    return;
  }
  emojiRecent.classList.remove('hidden');
  const frag = document.createDocumentFragment();
  for (const e of recentEmojis) frag.appendChild(createEmojiButton(e));
  emojiRecent.replaceChildren(frag);
}

recentEmojis = loadRecentEmojis();
renderEmojiGrid(EMOJIS);

setSafeEmojiHtml(emojiBtn, '\u{1F600}');

emojiCloseBtn?.addEventListener('click', () => {
  toggleEmojiPanel(false);
});

emojiSearch?.addEventListener('input', () => {
  const q = String(emojiSearch.value || '').trim().toLowerCase();
  if (!q) {
    renderEmojiGrid(EMOJIS);
    return;
  }

  const filtered = EMOJIS.filter((e) => {
    if (String(e).includes(q)) return true;
    return getEmojiCode(e).includes(q);
  });
  renderEmojiGrid(filtered);
});

function setChatCollapsed(v) {
  chat.classList.toggle('collapsed', v);
  if (v) toggleEmojiPanel(false);
  if (!v) {
    unreadCount = 0;
    updateUnreadBadge();
    if (chatDirty) {
      renderChat();
      chatDirty = false;
    }
  }

  try {
    localStorage.setItem('chatCollapsed', v ? '1' : '0');
  } catch {
    // ignore
  }
}

function getChatCollapsedDefault() {
  try {
    const raw = localStorage.getItem('chatCollapsed');
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // ignore
  }
  const small = (window.innerWidth <= 1400 && window.innerHeight <= 820) || window.innerWidth <= 720;
  return small;
}

const CHAT_ENTER_HINT_KEY = 'chatEnterHintDismissed';
let chatEnterHintTimer = 0;
let chatEnterHintDismissed = false;

function hideChatEnterHint() {
  if (!chatHeaderHintEl || chatEnterHintDismissed) return;
  chatEnterHintDismissed = true;
  chatHeaderHintEl.classList.add('hidden');
  if (chatEnterHintTimer) {
    clearTimeout(chatEnterHintTimer);
    chatEnterHintTimer = 0;
  }
  try {
    localStorage.setItem(CHAT_ENTER_HINT_KEY, '1');
  } catch {
    // ignore
  }
}

function initChatEnterHint() {
  if (!chatHeaderHintEl) return;
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(CHAT_ENTER_HINT_KEY) === '1';
  } catch {
    // ignore
  }
  if (dismissed) {
    chatEnterHintDismissed = true;
    chatHeaderHintEl.classList.add('hidden');
    return;
  }
  chatHeaderHintEl.classList.remove('hidden');
  if (chatEnterHintTimer) clearTimeout(chatEnterHintTimer);
  chatEnterHintTimer = setTimeout(() => {
    hideChatEnterHint();
  }, 12000);
}

setChatCollapsed(getChatCollapsedDefault());
initChatEnterHint();

const chatHeaderStatusEl = (() => {
  if (!chatHeader) return null;
  const left = document.getElementById('chatHeaderLeft');
  if (!left) return null;
  const el = document.createElement('span');
  el.id = 'chatHeaderStatus';
  el.className = 'chatHeaderStatus';
  left.appendChild(el);
  return el;
})();

const chatCollapseBtnEl = (() => {
  if (!chatHeader) return null;
  const right = document.getElementById('chatHeaderRight');
  if (!right) return null;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'iconBtn chatCollapseBtn';
  b.setAttribute('data-role', 'chatCollapse');
  b.appendChild(document.createTextNode('▾'));
  right.appendChild(b);
  return b;
})();

function updateChatHeaderStatus() {
  if (!chatHeaderStatusEl) return;
  const inRoom = roomId != null;
  const suf = wsStatusSuffix();
  const base = inRoom ? `${t('chat.status_room')} ${roomId}` : t('chat.status_lobby');
  chatHeaderStatusEl.textContent = `${base}${suf ? ` ${suf}` : ''}`;
}

function updateRightI18n() {
  try {
    const sum = rightEventsDetailsEl?.querySelector?.('.rightDetailsSummary');
    if (sum) {
      const badge = sum.querySelector('.badge');
      sum.replaceChildren();
      sum.appendChild(document.createTextNode(t('right.events')));
      if (badge) sum.appendChild(badge);
    }
  } catch {}
  try {
    if (rightMatchEmptyEl) {
      const tt = rightMatchEmptyEl.querySelector('.rightEmptyTitle');
      const dd = rightMatchEmptyEl.querySelector('.rightEmptyDesc');
      if (tt) tt.textContent = t('right.match_empty_title');
      if (dd) dd.textContent = t('right.match_empty_desc');
    }
    if (rightTeamEmptyEl) {
      const tt = rightTeamEmptyEl.querySelector('.rightEmptyTitle');
      const dd = rightTeamEmptyEl.querySelector('.rightEmptyDesc');
      if (tt) tt.textContent = t('right.team_empty_title');
      if (dd) dd.textContent = t('right.team_empty_desc');
    }
    if (rightEventsEmptyEl) {
      const tt = rightEventsEmptyEl.querySelector('.rightEmptyTitle');
      const dd = rightEventsEmptyEl.querySelector('.rightEmptyDesc');
      if (tt) tt.textContent = t('right.events_empty_title');
      if (dd) dd.textContent = t('right.events_empty_desc');
    }
  } catch {}
}

function syncChatCollapseButtonUi() {
  if (!chatCollapseBtnEl) return;
  const collapsed = chat.classList.contains('collapsed');
  chatCollapseBtnEl.textContent = collapsed ? '▸' : '▾';
  chatCollapseBtnEl.setAttribute('aria-label', collapsed ? t('chat.expand') : t('chat.collapse'));
}

syncChatCollapseButtonUi();
updateChatHeaderStatus();

try {
  if (chatHeader) {
    chatHeader.tabIndex = 0;
    chatHeader.setAttribute('role', 'button');
  }
} catch {}

chatHeader.addEventListener('click', (e) => {
  const role = String(e?.target?.getAttribute?.('data-role') || '');
  if (role === 'chatCollapse') {
    const isCollapsed = chat.classList.contains('collapsed');
    if (isCollapsed) {
      setChatCollapsed(false);
      chatOpenUntil = performance.now() + 12000;
      try {
        chatInput?.focus?.();
      } catch {}
    } else {
      setChatCollapsed(true);
    }
    syncChatCollapseButtonUi();
    e?.preventDefault?.();
    e?.stopPropagation?.();
    return;
  }
  const isCollapsed = chat.classList.contains('collapsed');
  if (isCollapsed) {
    setChatCollapsed(false);
    chatOpenUntil = performance.now() + 12000;
    chatInput.focus();
    e?.preventDefault?.();
  } else {
    setChatCollapsed(true);
  }
  syncChatCollapseButtonUi();
});

chatHeader.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    const role = String(e?.target?.getAttribute?.('data-role') || '');
    if (role === 'chatCollapse') return;
    e.preventDefault();
    chatHeader.click();
  }
});

nameBtn.addEventListener('click', (e) => {
  e.preventDefault();
  submitName();
});

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.preventDefault();
});

function formatTime(t) {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function addChatLine(msg) {
  chatMessages.push(msg);
  let shifted = false;
  while (chatMessages.length > 200) {
    chatMessages.shift();
    shifted = true;
  }
  if (chat.classList.contains('collapsed')) {
    bumpChatVisibility(CHAT_AUTO_OPEN_MS, false);
  }

  try {
    const ae = document.activeElement;
    const focused = !!(ae && chat.contains(ae));
    if (!focused) {
      unreadCount = Math.min(999, unreadCount + 1);
      updateUnreadBadge();
    }
  } catch {}

  if (shifted) {
    renderChat();
    bumpChatVisibility(CHAT_AUTO_OPEN_MS, false);
    return;
  }

  if (chatRenderedCount === chatMessages.length - 1) {
    const atBottom = chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 24;
    chatLog.appendChild(buildChatLineElement(msg));
    chatRenderedCount = chatMessages.length;
    if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
  } else {
    renderChat();
  }
  bumpChatVisibility(CHAT_AUTO_OPEN_MS, false);
  updateChatLayout();
}

function buildChatLineElement(m) {
  const line = document.createElement('div');
  line.className = 'chatLine';
  if (m?.n === you) line.classList.add('me');

  const meta = document.createElement('div');
  meta.className = 'chatMeta';

  const nameEl = document.createElement('div');
  nameEl.className = 'chatName';
  nameEl.textContent = nameById.get(m?.n) || String(m?.n);

  const timeEl = document.createElement('div');
  timeEl.className = 'chatTime';
  timeEl.textContent = formatTime(m?.t);

  meta.appendChild(nameEl);
  meta.appendChild(timeEl);

  const textEl = document.createElement('div');
  textEl.className = 'chatText';
  setSafeEmojiHtml(textEl, String(m?.text ?? ''));

  line.appendChild(meta);
  line.appendChild(textEl);
  return line;
}

function renderChat() {
  const atBottom = chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 24;

  const frag = document.createDocumentFragment();
  for (const m of chatMessages) {
    frag.appendChild(buildChatLineElement(m));
  }

  chatLog.replaceChildren(frag);
  chatRenderedCount = chatMessages.length;
  if (atBottom) chatLog.scrollTop = chatLog.scrollHeight;
  updateChatLayout();
}

chatInput?.addEventListener('input', () => {
  scheduleChatInputOverlayRender();
  if (chatInput && String(chatInput.value || '').trim()) hideChatEnterHint();
});
chatInput?.addEventListener('scroll', syncChatInputOverlayScroll);
chatInput?.addEventListener('click', syncChatInputOverlayScroll);
chatInput?.addEventListener('keyup', syncChatInputOverlayScroll);
scheduleChatInputOverlayRender();

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = String(chatInput.value || '').trim();
  if (!text) return;
  wsSend('chat', { text });
  hideChatEnterHint();
  chatInput.value = '';
  scheduleChatInputOverlayRender();
  chatOpenUntil = performance.now() + 12000;
  unreadCount = 0;
  updateUnreadBadge();
});

let matchUnreadCount = 0;
let teamUnreadCount = 0;
let eventsUnreadCount = 0;

function createSummaryBadge(detailsEl) {
  const sum = detailsEl?.querySelector?.('.rightDetailsSummary');
  if (!sum) return null;
  const el = document.createElement('span');
  el.className = 'badge hidden';
  el.setAttribute('aria-hidden', 'true');
  sum.appendChild(el);
  return el;
}

function setBadgeCount(el, n) {
  if (!el) return;
  const v = Math.max(0, Number(n) || 0);
  el.textContent = v > 99 ? '99+' : String(v);
  el.classList.toggle('hidden', v <= 0);
}

const rightMatchBadgeEl = createSummaryBadge(rightMatchDetailsEl);
const rightTeamBadgeEl = createSummaryBadge(rightTeamDetailsEl);

const rightEventsDetailsEl = (() => {
  if (!rightInfoEl || !killfeedEl) return null;
  if (document.getElementById('rightEventsDetails')) return document.getElementById('rightEventsDetails');
  const det = document.createElement('details');
  det.id = 'rightEventsDetails';
  det.className = 'rightDetails';
  det.open = true;
  const sum = document.createElement('summary');
  sum.className = 'rightDetailsSummary';
  sum.textContent = t('right.events');
  det.appendChild(sum);
  try {
    killfeedEl.parentElement?.removeChild?.(killfeedEl);
  } catch {}
  det.appendChild(killfeedEl);
  rightInfoEl.appendChild(det);
  return det;
})();

const rightEventsBadgeEl = createSummaryBadge(rightEventsDetailsEl);

function createRightEmpty(detailsEl, titleKey, descKey) {
  if (!detailsEl) return null;
  const el = document.createElement('div');
  el.className = 'rightEmpty hidden';
  const tEl = document.createElement('div');
  tEl.className = 'rightEmptyTitle';
  tEl.textContent = t(titleKey);
  const dEl = document.createElement('div');
  dEl.className = 'rightEmptyDesc';
  dEl.textContent = t(descKey);
  el.appendChild(tEl);
  el.appendChild(dEl);
  detailsEl.appendChild(el);
  return el;
}

const rightMatchEmptyEl = createRightEmpty(rightMatchDetailsEl, 'right.match_empty_title', 'right.match_empty_desc');
const rightTeamEmptyEl = createRightEmpty(rightTeamDetailsEl, 'right.team_empty_title', 'right.team_empty_desc');
const rightEventsEmptyEl = createRightEmpty(rightEventsDetailsEl, 'right.events_empty_title', 'right.events_empty_desc');

function syncRightEmptyStates() {
  const matchEmpty = !started || !metaHudEl || metaHudEl.style.display === 'none' || metaHudEl.childElementCount === 0;
  const teamEmpty = !started || !teamHudEl || !String(teamHudEl.textContent || '').trim();
  const eventsEmpty = !started || !killfeedEl || killfeedEl.childElementCount === 0;
  if (rightMatchEmptyEl) rightMatchEmptyEl.classList.toggle('hidden', !matchEmpty);
  if (rightTeamEmptyEl) rightTeamEmptyEl.classList.toggle('hidden', !teamEmpty);
  if (rightEventsEmptyEl) rightEventsEmptyEl.classList.toggle('hidden', !eventsEmpty);
}

rightMatchDetailsEl?.addEventListener?.('toggle', () => {
  if (rightMatchDetailsEl.open) {
    matchUnreadCount = 0;
    setBadgeCount(rightMatchBadgeEl, matchUnreadCount);
  }
});

rightTeamDetailsEl?.addEventListener?.('toggle', () => {
  if (rightTeamDetailsEl.open) {
    teamUnreadCount = 0;
    setBadgeCount(rightTeamBadgeEl, teamUnreadCount);
  }
});

rightEventsDetailsEl?.addEventListener?.('toggle', () => {
  if (rightEventsDetailsEl.open) {
    eventsUnreadCount = 0;
    setBadgeCount(rightEventsBadgeEl, eventsUnreadCount);
  }
});

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

let resizeRaf = 0;
function scheduleResize() {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    resize();
  });
}

window.addEventListener('resize', scheduleResize);
resize();

let lastDirSent = null;

function setDir(dir) {
  if (!youAlive) return;
  if (dir === lastDirSent) return;
  // F13: подсказка про управление гаснет по факту действия, а не по факту входа.
  if (!getMenuControlsSeen()) {
    setMenuControlsSeen();
    syncMenuOnboardingUi();
  }
  lastDirSent = dir;
  wsSend('input', { dir });
}

function focusablesIn(root) {
  if (!root) return [];
  const nodes = Array.from(
    root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  );
  return nodes.filter((el) => {
    if (el.disabled) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.tabIndex < 0) return false;
    const r = el.getBoundingClientRect?.();
    if (r && r.width === 0 && r.height === 0) return false;
    return true;
  });
}

function trapFocusIn(root, e) {
  const list = focusablesIn(root);
  if (!list.length) return;
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !root.contains(active)) {
      last.focus();
      e.preventDefault();
    }
  } else {
    if (active === last || !root.contains(active)) {
      first.focus();
      e.preventDefault();
    }
  }
}

window.addEventListener(
  'keydown',
  (e) => {
    if (deathOverlay && !deathOverlay.classList.contains('hidden')) {
      const isSpace =
        e.code === 'Space' ||
        e.key === ' ' ||
        e.key === 'Space' ||
        e.code === 'Spacebar' ||
        e.key === 'Spacebar' ||
        e.keyCode === 32 ||
        e.which === 32;

      if (e.key === 'Enter') {
        bumpChatVisibility(12000, true);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (isSpace) {
        restartBtn?.click();
        e.preventDefault();
        e.stopPropagation();
      }
    }
  },
  { capture: true }
);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    if (overlayManager.trapFocus(e)) return;
  }

  if (e.code === 'KeyM') {
    const ae = document.activeElement;
    if (ae && (ae === nameInput || ae === menuNameInput || chat.contains(ae))) return;
    if (menuOverlay && !menuOverlay.classList.contains('hidden')) return;
    if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) return;
    if (cosmeticsOverlay && !cosmeticsOverlay.classList.contains('hidden')) return;
    if (matchOverlay && !matchOverlay.classList.contains('hidden')) return;
    if (deathOverlay && !deathOverlay.classList.contains('hidden')) return;
    toggleMinimapOverlay();
    e.preventDefault();
    return;
  }

  if (e.code === 'KeyP') {
    const ae = document.activeElement;
    if (ae && (ae === nameInput || ae === menuNameInput || chat.contains(ae))) return;
    if (menuOverlay && !menuOverlay.classList.contains('hidden')) return;
    if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) return;
    if (deathOverlay && !deathOverlay.classList.contains('hidden')) return;
    perfEnabled = !perfEnabled;
    if (perfEnabledInput) perfEnabledInput.checked = !!perfEnabled;
    if (perfEl) perfEl.style.display = perfEnabled ? '' : 'none';
    saveSettingsState();
    e.preventDefault();
    return;
  }

  if (e.key === 'Escape' || e.key === 'Esc') {
    if (overlayManager.closeTop()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (chat && !chat.classList.contains('collapsed')) {
      setChatCollapsed(true);
      try {
        document.activeElement?.blur?.();
      } catch {}
      e.preventDefault();
      return;
    }
  }

  if (e.key === 'Enter') {
    const ae = document.activeElement;
    if (ae && chat.contains(ae)) return;
    if (menuOverlay && !menuOverlay.classList.contains('hidden')) {
      e.preventDefault();
      return;
    }
    if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) {
      e.preventDefault();
      return;
    }
    if (cosmeticsOverlay && !cosmeticsOverlay.classList.contains('hidden')) {
      e.preventDefault();
      return;
    }
    if (matchOverlay && !matchOverlay.classList.contains('hidden')) {
      e.preventDefault();
      return;
    }

    bumpChatVisibility(12000, true);
    e.preventDefault();
    return;
  }

  // C6: never steer the snake while an overlay is on top of the game.
  if (overlayManager.getTop()) return;

  const ae = document.activeElement;
  if (ae && (ae === nameInput || chat.contains(ae))) return;
  if (e.code === 'ArrowUp' || e.code === 'KeyW') setDir('up');
  else if (e.code === 'ArrowDown' || e.code === 'KeyS') setDir('down');
  else if (e.code === 'ArrowLeft' || e.code === 'KeyA') setDir('left');
  else if (e.code === 'ArrowRight' || e.code === 'KeyD') setDir('right');
});

// Mobile / touch: swipe on the canvas to change direction
try {
  canvas.style.touchAction = 'none';
} catch {
  // ignore
}

let swipeActive = false;
let swipeX0 = 0;
let swipeY0 = 0;
let swipePointerId = null;
const SWIPE_PX = 22;

function swipeDir(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

canvas.addEventListener(
  'pointerdown',
  (e) => {
    if (!youAlive) return;
    if (e.pointerType !== 'touch') return;
    swipeActive = true;
    swipePointerId = e.pointerId;
    swipeX0 = e.clientX;
    swipeY0 = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  },
  { passive: false }
);

canvas.addEventListener(
  'pointermove',
  (e) => {
    if (!swipeActive) return;
    if (swipePointerId != null && e.pointerId !== swipePointerId) return;
    const dx = e.clientX - swipeX0;
    const dy = e.clientY - swipeY0;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
    setDir(swipeDir(dx, dy));
    swipeX0 = e.clientX;
    swipeY0 = e.clientY;
    e.preventDefault();
  },
  { passive: false }
);

function endSwipe(e) {
  if (swipePointerId != null && e.pointerId !== swipePointerId) return;
  swipeActive = false;
  swipePointerId = null;
}

canvas.addEventListener('pointerup', endSwipe);
canvas.addEventListener('pointercancel', endSwipe);

// Zoom disabled: fixed visible area regardless of screen size

function onInit(msg) {
  W = msg.w;
  H = msg.h;
  N = W * H;
  tickMs = msg.tickMs;
  if (typeof msg?.tick === 'number' && Number.isFinite(msg.tick)) {
    lastEventsTick = msg.tick;
    lastEventsAt = Date.now();
  }
  you = Number(msg.you) || 0;
  mapCells = msg.mapCells || N;
  roomId = msg.room ?? null;
  roomLimit = msg.roomLimit ?? null;

  // K7: вход в комнату состоялся — реконнект-цель обновлена, флаг «ушёл сам» снят.
  rejoinRoomId = roomId;
  userLeftRoom = false;
  if (rejoinPending) {
    rejoinPending = false;
    addToast('✅', t('net.rejoined'), null, null, { key: 'net_reconnect' });
  }

  matchSeq = Number(msg?.matchSeq) || 0;
  matchEndTick = Number(msg?.matchEnd) || 0;
  matchEnded = !!msg?.matchEnded;
  matchResetAt = Number(msg?.matchReset) || 0;
  updateRoomInfo();

  matchContinuePending = false;
  if (matchContinueTimeout) {
    clearTimeout(matchContinueTimeout);
    matchContinueTimeout = 0;
  }
  if (matchEnded) {
    if (msg?.matchResults) {
      lastMatchResults = msg.matchResults;
      renderMatchResults(lastMatchResults);
    }
    updateMatchCountdown();
    showMatchOverlay();
  } else {
    resetClientForNewMatch();
    hideMatchOverlay();
  }

  createRoomPending = false;
  setRoomsCreateOpen(false);
  updateRoomsCreateUi();
  selectedRoomId = null;

  hideMenuOverlay();
  hideOverlays();

  started = true;
  // F13: раньше подсказка гасилась прямо здесь, ещё до того как игрок её прочитал.
  // Теперь её снимает первое реальное действие (см. setDir).
  syncMenuOnboardingUi();
  obResetMatch();
  obAnnounceShop();
  try {
    document.body.classList.add('inGame');
  } catch {}

  gridOwner = new Uint16Array(N);
  trailOwner = new Uint16Array(N);

  minimapGridOwner = new Uint16Array(N);

  // K2: вход в комнату — новый набор номеров игроков. Всё, что кэшируется по
  // номеру, обязано умереть здесь, иначе чужие цвета и «ботовость» приезжают
  // из прошлой комнаты.
  colors.clear();
  ownerFillStyleCache.clear();
  minimapOwnerRgbCache.clear();
  botIds = new Set();
  lastRoi = null;

  gridFillAt = new Float32Array(N);
  coolSeenAt = new Float32Array(N);
  captureAnchorByOwner.clear();
  coolDeadlineByOwner.clear();

  minimap.width = W;
  minimap.height = H;
  minimapImage = mmCtx.createImageData(W, H);
  // minimap is updated by server-sent chunk updates

  mmCtx.imageSmoothingEnabled = true;
  mmCtx.imageSmoothingQuality = 'high';

  if (storedName) {
    wsSend('setName', { name: storedName });
  }

  // Spawn in the current room (no rejoin). Without this the player stays dead and cannot move.
  wsSend('respawn', {});

  youKills = 0;
  youStreak = 0;

  if (msg?.cosmetics) {
    onCosmetics(msg.cosmetics);
  }
  renderTopHud();
}

function onCosmetics(msg) {
  // C4: remember the previous inventory so we can detect what was just bought.
  const prevInv = {
    capturefx: Number(youCosInvCaptureFx) || 0,
    head: Number(youCosInvHead) || 0,
    seg: Number(youCosInvSeg) || 0,
    nameplate: Number(youCosInvNameplate) || 0,
    frame: Number(youCosInvFrame) || 0,
    terr: Number(youCosInvTerr) || 0,
    death: Number(youCosInvDeath) || 0
  };
  const hadServerState = cosmeticsSource === 'server';

  const st = Number(msg?.style);
  if (Number.isFinite(st)) youStyle = Math.max(0, st);

  cosmeticsLoaded = true;
  cosmeticsSource = 'server';

  youCosInvCaptureFx = Number(msg?.invCaptureFx) || 0;
  youCosInvHead = Number(msg?.invHead) || 0;
  youCosInvSeg = Number(msg?.invSeg) || 0;
  youCosInvNameplate = Number(msg?.invNameplate) || 0;
  youCosInvFrame = Number(msg?.invFrame) || 0;

  youCosEqCaptureFx = Number(msg?.eqCaptureFx) || 0;
  youCosEqHead = Number(msg?.eqHead) || 0;
  youCosEqSeg = Number(msg?.eqSeg) || 0;
  youCosEqNameplate = Number(msg?.eqNameplate) || 0;
  youCosEqFrame = Number(msg?.eqFrame) || 0;

  // Новые категории и титулы: сервер может их ещё не присылать. В этом случае
  // поля undefined -> нули, магазин показывает только базовый вариант, а
  // «Титулы» честно сообщают, что список пока недоступен.
  if (msg?.invTerr !== undefined) youCosInvTerr = Number(msg.invTerr) || 0;
  if (msg?.invDeath !== undefined) youCosInvDeath = Number(msg.invDeath) || 0;
  if (msg?.eqTerr !== undefined) youCosEqTerr = cosClampId(msg.eqTerr);
  if (msg?.eqDeath !== undefined) youCosEqDeath = cosClampId(msg.eqDeath);
  if (msg?.titleMask !== undefined) youTitleMask = Number(msg.titleMask) || 0;
  if (msg?.titleId !== undefined) youTitleId = Math.max(0, Math.min(COS_TITLE_MAX, Number(msg.titleId) || 0));
  // Базовый вариант всегда доступен — иначе магазин выглядит полностью пустым.
  youCosInvTerr |= 1;
  youCosInvDeath |= 1;

  cosmeticsCacheSave();

  // C4: report the purchase that just landed.
  const pending = pendingCosmeticsOp;
  cosmeticsOpClear();

  if (hadServerState) {
    const nextInv = {
      capturefx: Number(youCosInvCaptureFx) || 0,
      head: Number(youCosInvHead) || 0,
      seg: Number(youCosInvSeg) || 0,
      nameplate: Number(youCosInvNameplate) || 0,
      frame: Number(youCosInvFrame) || 0,
      terr: Number(youCosInvTerr) || 0,
      death: Number(youCosInvDeath) || 0
    };
    let boughtCat = '';
    let boughtId = -1;
    for (const cat of Object.keys(nextInv)) {
      const added = nextInv[cat] & ~prevInv[cat];
      if (!added) continue;
      for (let id = 0; id <= COSMETICS_MAX_ID; id++) {
        if (added & (1 << id)) {
          boughtCat = cat;
          boughtId = id;
          break;
        }
      }
      if (boughtCat) break;
    }
    if (!boughtCat && pending) {
      // Server confirmed but nothing new appeared (already owned).
      boughtCat = '';
    }
    if (boughtCat) {
      const bc = boughtCat;
      const bi = boughtId;
      const boughtText = () => `${t('cosmetics.bought_prefix')}: ${cosmeticsLabel(bc)} — ${cosmeticsVariantName(bc, bi)}`;
      setCosmeticsStatus(boughtText, 'success');
      addToast('✨', boughtText(), null);
      playBeep(880, 150, 0.9);
    } else if (pending) {
      setCosmeticsStatus('', '');
    }
  }

  cosmeticsApplyDesiredServer();

  syncCosmeticsUi();

  renderMetaHud();
}

function cosmeticsDesiredLoad() {
  try {
    const raw = localStorage.getItem(COSMETICS_DESIRED_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    return s;
  } catch {
    return null;
  }
}

function cosmeticsDesiredSave(s) {
  try {
    if (!s) {
      localStorage.removeItem(COSMETICS_DESIRED_KEY);
      return;
    }
    localStorage.setItem(COSMETICS_DESIRED_KEY, JSON.stringify(s));
  } catch {}
}

function cosmeticsSetDesiredEq(cat, id) {
  const c = String(cat || '').trim().toLowerCase();
  const itemId = Math.max(0, Math.min(7, Number(id) || 0));
  const d = cosmeticsDesiredLoad() || {};
  if (c === 'capturefx') d.eqCaptureFx = itemId;
  else if (c === 'head') d.eqHead = itemId;
  else if (c === 'seg') d.eqSeg = itemId;
  else if (c === 'nameplate') d.eqNameplate = itemId;
  else if (c === 'frame') d.eqFrame = itemId;
  else if (c === 'terr') d.eqTerr = itemId;
  else if (c === 'death') d.eqDeath = itemId;
  cosmeticsDesiredSave(d);
}

function cosmeticsApplyDesiredServer() {
  if (cosmeticsSource !== 'server') return;
  const d = cosmeticsDesiredLoad();
  if (!d) return;

  const failed = [];
  const kept = {};

  const apply = (cat, desiredId, invMask, currentEq, keyName) => {
    if (desiredId === undefined || desiredId === null) return;
    const want = Math.max(0, Math.min(7, Number(desiredId) || 0));
    if (want === Math.max(0, Math.min(7, Number(currentEq) || 0))) return;
    const bit = 1 << want;
    if ((Number(invMask) & bit) === 0) {
      // C9: the cache promised an item the account does not have — say so out loud.
      failed.push(`${cosmeticsLabel(cat)} — ${cosmeticsVariantName(cat, want)}`);
      return;
    }
    if (!wsSend('cosmeticsEquip', { cat, id: want })) kept[keyName] = want;
  };

  apply('capturefx', d.eqCaptureFx, youCosInvCaptureFx, youCosEqCaptureFx, 'eqCaptureFx');
  apply('head', d.eqHead, youCosInvHead, youCosEqHead, 'eqHead');
  apply('seg', d.eqSeg, youCosInvSeg, youCosEqSeg, 'eqSeg');
  apply('nameplate', d.eqNameplate, youCosInvNameplate, youCosEqNameplate, 'eqNameplate');
  apply('frame', d.eqFrame, youCosInvFrame, youCosEqFrame, 'eqFrame');
  apply('terr', d.eqTerr, youCosInvTerr, youCosEqTerr, 'eqTerr');
  apply('death', d.eqDeath, youCosInvDeath, youCosEqDeath, 'eqDeath');

  if (failed.length) {
    setCosmeticsStatus(() => `${t('cosmetics.desired_not_applied')}: ${failed.join(', ')}`, 'error');
  }

  // Keep only what could not be sent; drop everything that was applied or is impossible.
  cosmeticsDesiredSave(Object.keys(kept).length ? kept : null);
}

// C1: shop feedback goes into a dedicated in-overlay line (#cosmeticsStatus),
// because body.overlayActive hides #eventToasts. Falls back to a toast if the
// element is not present in the markup.
/* K4: строка статуса магазина ставилась готовым текстом один раз, и переключение
   языка её не трогало — в русском интерфейсе висело «Not confirmed by the
   server yet…». Теперь источник строки хранится: если это функция, она
   перевычисляется при каждой смене языка. */
let cosmeticsStatusSrc = '';
let cosmeticsStatusKind = '';

function setCosmeticsStatus(text, kind) {
  cosmeticsStatusSrc = typeof text === 'function' ? text : String(text || '');
  cosmeticsStatusKind = String(kind || '');
  renderCosmeticsStatus();
}

// Перерисовать статус из сохранённого источника (вызывается из setLang).
function renderCosmeticsStatus() {
  let text = cosmeticsStatusSrc;
  if (typeof text === 'function') {
    try {
      text = text();
    } catch {
      text = '';
    }
  }
  const kind = cosmeticsStatusKind;
  const msg = String(text || '').trim();
  const k = String(kind || '');
  let el = null;
  try {
    el = document.getElementById('cosmeticsStatus');
  } catch {}
  if (!el) {
    if (msg) addToast(k === 'error' ? '⚠' : k === 'success' ? '✅' : 'ℹ', msg, null);
    return;
  }
  try {
    el.textContent = msg;
    el.classList.toggle('isError', k === 'error');
    el.classList.toggle('isSuccess', k === 'success');
    el.classList.toggle('isInfo', k === 'info');
    el.classList.toggle('hidden', !msg);
    el.setAttribute('role', k === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', k === 'error' ? 'assertive' : 'polite');
  } catch {}
}

// C4: one in-flight shop operation at a time, with a hard timeout.
function cosmeticsOpBegin(cat, id) {
  pendingCosmeticsOp = { cat: String(cat || ''), id: Number(id) || 0, at: Date.now() };
  if (cosmeticsOpTimer) {
    try {
      clearTimeout(cosmeticsOpTimer);
    } catch {}
    cosmeticsOpTimer = 0;
  }
  cosmeticsOpTimer = setTimeout(() => {
    cosmeticsOpTimer = 0;
    if (!pendingCosmeticsOp) return;
    pendingCosmeticsOp = null;
    setCosmeticsStatus(() => t('cosmetics.op_timeout'), 'error');
    syncCosmeticsUi();
  }, 5000);
}

function cosmeticsOpClear() {
  pendingCosmeticsOp = null;
  if (cosmeticsOpTimer) {
    try {
      clearTimeout(cosmeticsOpTimer);
    } catch {}
    cosmeticsOpTimer = 0;
  }
}

function cosmeticsOpIsPending(cat, id) {
  if (!pendingCosmeticsOp) return false;
  return pendingCosmeticsOp.cat === cat && Number(pendingCosmeticsOp.id) === Number(id);
}

function showCosmeticsOverlay() {
  if (!cosmeticsOverlay) return;
  if (!cosmeticsLoaded) {
    cosmeticsEnsureLocalReady();
  }
  cosmeticsOpen = true;
  cosmeticsOverlay.classList.remove('hidden');
  overlayManager.open('cosmetics');
  cosmeticsOpClear();
  // C13: open the preview on the item that is actually equipped.
  const eq0 = cosmeticsEqForCat(cosmeticsCat);
  cosmeticsSelId = Number.isFinite(Number(eq0)) ? Number(eq0) : 0;
  setCosmeticsStatus('', '');
  if (!wsIsConnected()) setCosmeticsStatus(() => t('cosmetics.no_connection'), 'info');
  else if (cosmeticsSource !== 'server') setCosmeticsStatus(() => t('cosmetics.unconfirmed_hint'), 'info');
  syncOverlayUiState();
  syncCosmeticsUi();
  overlayManager.focusDefault('cosmetics');
}

function hideCosmeticsOverlay() {
  if (!cosmeticsOverlay) return;
  cosmeticsOpen = false;
  cosmeticsOverlay.classList.add('hidden');
  overlayManager.close('cosmetics');
  cosmeticsOpClear();
  setCosmeticsStatus('', '');
  cosmeticsHoverId = null;
  cosmeticsHoverCat = null;
  syncOverlayUiState();
  if (cosmeticsPreviewRaf) {
    try {
      cancelAnimationFrame(cosmeticsPreviewRaf);
    } catch {}
    cosmeticsPreviewRaf = 0;
  }
}

function scheduleCosmeticsPreviewAnim() {
  if (cosmeticsPreviewRaf) return;
  const tick = () => {
    cosmeticsPreviewRaf = 0;
    if (!cosmeticsOverlay || cosmeticsOverlay.classList.contains('hidden')) return;
    const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (!reduceMotion) {
      const now = performance.now();
      if (!cosmeticsPreviewLastAt || now - cosmeticsPreviewLastAt > 33) {
        cosmeticsPreviewLastAt = now;
        renderCosmeticsPreview();
      }
      cosmeticsPreviewRaf = requestAnimationFrame(tick);
    }
  };
  cosmeticsPreviewRaf = requestAnimationFrame(tick);
}

// Потолок id косметики: маска инвентаря — uint8, ровно 8 слотов (0..7).
const COSMETICS_MAX_ID = 7;
// Покупаемые категории. `title` сюда НЕ входит: титулы не продаются.
const COSMETICS_CATS = ['terr', 'seg', 'head', 'death', 'capturefx', 'nameplate', 'frame'];
// Порядок вкладок магазина: сверху то, что занимает больше всего экрана.
const COSMETICS_TABS = [...COSMETICS_CATS, 'title'];

function bitHas(mask, id) {
  const bit = 1 << (Number(id) || 0);
  return (Number(mask) & bit) !== 0;
}

function cosmeticsMaskForCat(cat) {
  if (cat === 'capturefx') return youCosInvCaptureFx;
  if (cat === 'head') return youCosInvHead;
  if (cat === 'seg') return youCosInvSeg;
  if (cat === 'nameplate') return youCosInvNameplate;
  if (cat === 'terr') return youCosInvTerr;
  if (cat === 'death') return youCosInvDeath;
  return youCosInvFrame;
}

function cosmeticsEqForCat(cat) {
  if (cat === 'capturefx') return youCosEqCaptureFx;
  if (cat === 'head') return youCosEqHead;
  if (cat === 'seg') return youCosEqSeg;
  if (cat === 'nameplate') return youCosEqNameplate;
  if (cat === 'terr') return youCosEqTerr;
  if (cat === 'death') return youCosEqDeath;
  return youCosEqFrame;
}

// Фолбэк-цены по id, если сервер ещё не прислал `cosmeticsPrices` в hello.
const COSMETICS_FALLBACK_PRICES = {
  frame: [0, 30, 45, 85, 115, 200, 330, 550],
  nameplate: [0, 40, 60, 105, 140, 240, 390, 640],
  seg: [0, 160, 55, 210, 360, 90, 580, 950],
  head: [0, 50, 75, 135, 175, 300, 500, 800],
  capturefx: [0, 65, 100, 180, 240, 410, 660, 1050],
  terr: [0, 60, 90, 150, 220, 360, 600, 980],
  death: [0, 55, 85, 140, 210, 340, 560, 900]
};

// Сервер шлёт массив цен по id: {"frame":[0,30,45,...], ...}.
// Старый формат (одно число на категорию) поддерживаем как деградацию.
function cosmeticsPrice(cat, id) {
  const c = String(cat || '');
  const i = Math.max(0, Math.min(COSMETICS_MAX_ID, Number(id) || 0));
  if (cosmeticsPrices && typeof cosmeticsPrices === 'object') {
    const row = cosmeticsPrices[c];
    if (Array.isArray(row)) {
      const v = Number(row[i]);
      if (Number.isFinite(v) && v >= 0) return v;
    } else {
      const v = Number(row);
      if (Number.isFinite(v) && v >= 0) return i === 0 ? 0 : v;
    }
  }
  const fb = COSMETICS_FALLBACK_PRICES[c] || COSMETICS_FALLBACK_PRICES.frame;
  const v = Number(fb[i]);
  return Number.isFinite(v) ? v : 0;
}

// D11: тир считается из цены — единая лестница редкости для всех категорий.
function cosmeticsTier(price) {
  const p = Math.max(0, Number(price) || 0);
  if (p <= 0) return 'base';
  if (p <= 100) return 'common';
  if (p <= 250) return 'rare';
  if (p <= 450) return 'epic';
  if (p <= 700) return 'legendary';
  return 'mythic';
}

function cosmeticsTierLabel(tier) {
  return t(`cosmetics.tier_${String(tier || 'base')}`) || String(tier || '');
}

// Самый дешёвый платный предмет во всём магазине — крючок «до первого скина».
function cosmeticsCheapestPrice() {
  let best = Infinity;
  for (const cat of COSMETICS_CATS) {
    for (let id = 1; id <= COSMETICS_MAX_ID; id++) {
      const p = cosmeticsPrice(cat, id);
      if (p > 0 && p < best) best = p;
    }
  }
  return Number.isFinite(best) ? best : 0;
}

function cosmeticsOwnedCount(cat) {
  const mask = cosmeticsMaskForCat(cat);
  let n = 0;
  for (let id = 0; id <= COSMETICS_MAX_ID; id++) {
    if (bitHas(mask, id)) n++;
  }
  return n;
}

function cosmeticsLabel(cat) {
  if (cat === 'capturefx') return t('cosmetics.cat_capturefx');
  if (cat === 'head') return t('cosmetics.cat_head');
  if (cat === 'seg') return t('cosmetics.cat_seg');
  if (cat === 'nameplate') return t('cosmetics.cat_nameplate');
  if (cat === 'terr') return t('cosmetics.cat_terr');
  if (cat === 'death') return t('cosmetics.cat_death');
  if (cat === 'title') return t('cosmetics.cat_title');
  return t('cosmetics.cat_frame');
}

function cosmeticsVariantName(cat, id) {
  const i = Math.max(0, Math.min(COSMETICS_MAX_ID, Number(id) || 0));
  const en = lang === 'en';
  // Названия не повторяются между категориями: раньше «Лазурь/Алая/Золото/Аметист»
  // стояли и в рамках, и в плашках, отчего покупка ощущалась как «купил цвет».
  if (cat === 'capturefx') {
    return (en
      ? ['Rings', 'Rays', 'Crystal', 'Spiral', 'Confetti', 'Magma', 'Vortex', 'Shards']
      : ['Кольца', 'Лучи', 'Кристалл', 'Спираль', 'Конфетти', 'Магма', 'Вихрь', 'Осколки'])[i];
  }
  if (cat === 'seg') {
    return (en
      ? ['Classic', 'Neon', 'Stripes', 'Plasma', 'Sparks', 'Circuit', 'Mosaic', 'Void']
      : ['Классика', 'Неон', 'Полосы', 'Плазма', 'Искры', 'Схема', 'Мозаика', 'Бездна'])[i];
  }
  if (cat === 'frame') {
    // Семейство «металлы и материалы» — совпадает с классами .frame0..7 в CSS.
    return (en
      ? ['Steel', 'Copper', 'Chrome', 'Emerald', 'Obsidian', 'Aurora', 'Golden Age', 'Prism']
      : ['Сталь', 'Медь', 'Хром', 'Изумруд', 'Обсидиан', 'Северное сияние', 'Золотой век', 'Призма'])[i];
  }
  if (cat === 'nameplate') {
    // Семейство «формы плашки» — различие в геометрии, не в цвете.
    return (en
      ? ['Capsule', 'Bar', 'Bevel', 'Scroll', 'Terminal', 'Engrave', 'Gleam', 'Chevron']
      : ['Капсула', 'Планка', 'Скос', 'Свиток', 'Терминал', 'Гравюра', 'Блик', 'Шеврон'])[i];
  }
  if (cat === 'head') {
    return (en
      ? ['Orb', 'Rhombus', 'Cube', 'Ring', 'Shield', 'Arrow', 'Eclipse', 'Star']
      : ['Орб', 'Ромб', 'Куб', 'Кольцо', 'Щит', 'Стрела', 'Затмение', 'Звезда'])[i];
  }
  if (cat === 'terr') {
    // Семейство «поверхности»: различие в структуре узора, цвет всегда ваш.
    return (en
      ? ['Solid', 'Hatch', 'Honeycomb', 'Tide', 'Circuit', 'Stained glass', 'Rift', 'Weave']
      : ['Заливка', 'Штриховка', 'Соты', 'Прилив', 'Схема', 'Витраж', 'Разлом', 'Ткань'])[i];
  }
  if (cat === 'death') {
    return (en
      ? ['Flash', 'Pixels', 'Black hole', 'Glass', 'Supernova', 'Glitch', 'Ash', 'Discharge']
      : ['Вспышка', 'Пиксели', 'Чёрная дыра', 'Стекло', 'Сверхновая', 'Глитч', 'Пепел', 'Разряд'])[i];
  }
  if (cat === 'title') return cosTitleName(id) || t('cosmetics.title_none');
  return String(i + 1);
}

/* --- Титулы в магазине -----------------------------------------------------
   Отдельная вкладка: покупать нечего, поэтому вместо цены — условие открытия,
   а вместо «Купить» — «Надеть». Отправка идёт сообщением `titleEquip`. */

function cosTitleUnlocked(id) {
  const i = Math.max(0, Math.min(COS_TITLE_MAX, Number(id) || 0));
  if (i === 0) return true;
  return (Number(youTitleMask) & (1 << i)) !== 0;
}

// Доля выполнения условия титула: 1 — открыт, null — данных нет.
// TODO: сервер пока не передаёт накопленную статистику по ачивкам.
function cosTitleProgress(id) {
  const i = Math.max(0, Math.min(COS_TITLE_MAX, Number(id) || 0));
  if (i === 0) return null;
  return cosTitleUnlocked(i) ? 1 : null;
}

function cosTitlesUnlockedCount() {
  let n = 0;
  for (let i = 1; i <= COS_TITLE_MAX; i++) {
    if (cosTitleUnlocked(i)) n++;
  }
  return n;
}

function cosTitleEquip(id) {
  const i = Math.max(0, Math.min(COS_TITLE_MAX, Number(id) || 0));
  if (!cosTitleUnlocked(i)) return;
  youTitleId = i;
  if (you) {
    if (i) cosTitleByPlayer.set(you, i);
    else cosTitleByPlayer.delete(you);
  }
  cosmeticsCacheSave();
  if (!wsSend('titleEquip', { id: i })) {
    setCosmeticsStatus(() => (wsIsConnected() ? t('cosmetics.unconfirmed_hint') : t('cosmetics.no_connection')), 'info');
  }
  syncCosmeticsUi();
}

function renderCosmeticsTitles() {
  if (!cosmeticsItemsEl) return;
  const items = [];

  const hint = document.createElement('div');
  hint.className = 'cosmeticsTierSep tierBase';
  hint.textContent = t('cosmetics.title_free_hint');
  items.push(hint);

  if (!youTitleMask && cosmeticsSource !== 'server') {
    const note = document.createElement('div');
    note.className = 'cosmeticsItemWhere';
    note.textContent = t('cosmetics.titles_unavailable');
    items.push(note);
  }

  for (let id = 0; id <= COS_TITLE_MAX; id++) {
    const unlocked = cosTitleUnlocked(id);
    const worn = Number(youTitleId) === id;
    if (cosmeticsFilter === 'owned' && !unlocked) continue;
    if (cosmeticsFilter === 'available' && unlocked) continue;

    // Разметка карточки титула согласована с вёрсткой (.titleItem): медаль
    // вместо превью-канваса, условие получения вместо цены, никакой валюты.
    const card = document.createElement('div');
    card.className = 'titleItem' + (cosmeticsSelId === id ? ' isSelected' : '');
    // K7: тот же приём, что и для карточек предметов — выбор не пересобирает
    // список и не роняет фокус.
    card.dataset.cosid = String(id);
    card.classList.toggle('isUnlocked', unlocked);
    card.classList.toggle('isEquipped', worn);
    card.classList.toggle('isLocked', !unlocked);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.addEventListener('click', () => {
      cosmeticsSelectItem(id);
    });
    card.addEventListener('mouseenter', () => cosmeticsSetHover('title', id));
    card.addEventListener('focus', () => cosmeticsSetHover('title', id));
    card.addEventListener('mouseleave', () => cosmeticsSetHover(null, null));
    card.addEventListener('blur', () => cosmeticsSetHover(null, null));

    const medal = document.createElement('span');
    medal.className = 'titleMedal';
    medal.setAttribute('aria-hidden', 'true');
    medal.textContent = id === 0 ? '—' : '🏅';

    const left = document.createElement('div');
    left.className = 'titleItemLeft';

    const nameEl = document.createElement('div');
    nameEl.className = 'titleName';
    nameEl.textContent = id === 0 ? t('cosmetics.title_none') : `«${cosTitleName(id)}»`;
    left.appendChild(nameEl);

    if (unlocked) {
      const desc = document.createElement('div');
      desc.className = 'titleDesc';
      desc.textContent =
        id === 0 ? t('cosmetics.title_none_desc') : `${t('cosmetics.title_earned_for')}: ${cosTitleReq(id)}`;
      left.appendChild(desc);
    } else {
      const req = document.createElement('div');
      req.className = 'titleReq';
      req.textContent = cosTitleReq(id) || t('cosmetics.title_locked');
      left.appendChild(req);
    }

    // Прогресс к ачивке. Сервер пока не присылает накопленные значения, поэтому
    // честно показываем только «открыт / не открыт».
    // TODO: заполнять реальным прогрессом, когда сервер начнёт его отдавать.
    const prog = cosTitleProgress(id);
    if (prog != null) {
      const bar = document.createElement('div');
      bar.className = 'cosmeticsItemProgress';
      const fill = document.createElement('span');
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, prog)) * 100)}%`;
      bar.appendChild(fill);
      left.appendChild(bar);
    }

    const right = document.createElement('div');
    right.className = 'titleItemRight';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btnSecondary';
    if (!unlocked) {
      btn.disabled = true;
      btn.textContent = t('cosmetics.locked');
    } else if (worn) {
      btn.disabled = true;
      btn.textContent = t('cosmetics.title_equipped');
    } else {
      btn.textContent = t('cosmetics.wear');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cosTitleEquip(id);
      });
    }
    right.appendChild(btn);

    card.appendChild(medal);
    card.appendChild(left);
    card.appendChild(right);
    items.push(card);
  }

  // Контейнер несёт --title-accent для вкладки титулов (см. .cosmeticsItems.isTitles).
  cosmeticsItemsEl.classList.add('isTitles');

  if (items.length <= 1) {
    setSafeHtml(
      cosmeticsItemsEl,
      `
      <div class="roomsEmpty">
        <div class="roomsEmptyTitle">${escapeHtml(t('cosmetics.empty_title'))}</div>
        <div class="roomsEmptyDesc">${escapeHtml(t('cosmetics.empty_desc'))}</div>
      </div>
      `
    );
    return;
  }
  cosmeticsItemsEl.replaceChildren(...items);
}

function cosmeticsSetFilter(next) {
  const v = String(next || 'all');
  if (v !== 'all' && v !== 'owned' && v !== 'available') return;
  cosmeticsFilter = v;
  syncCosmeticsUi();
}

// C15: only the price here — the balance already lives in the shop header.
function cosmeticsFormatCost(price) {
  const p = Math.max(0, Number(price) || 0);
  const pTxt = escapeHtml(fmtInt(p));
  const unit = escapeHtml(t('cosmetics.style_points'));
  return `<span class="num">${pTxt}</span> ${unit}`;
}

// C7: keep the shop in sync whenever the currency balance changes.
function setYouStyle(v) {
  const next = Math.max(0, Math.floor(Number(v) || 0));
  if (next === youStyle) return;
  youStyle = next;
  try {
    cosmeticsCacheSave();
  } catch {}
  if (cosmeticsOpen) {
    try {
      syncCosmeticsUi();
    } catch {}
  }
}

function cosmeticsGetStateObject() {
  return {
    style: Math.max(0, Math.floor(Number(youStyle) || 0)),
    invCaptureFx: Number(youCosInvCaptureFx) || 0,
    invHead: Number(youCosInvHead) || 0,
    invSeg: Number(youCosInvSeg) || 0,
    invNameplate: Number(youCosInvNameplate) || 0,
    invFrame: Number(youCosInvFrame) || 0,
    eqCaptureFx: Number(youCosEqCaptureFx) || 0,
    eqHead: Number(youCosEqHead) || 0,
    eqSeg: Number(youCosEqSeg) || 0,
    eqNameplate: Number(youCosEqNameplate) || 0,
    eqFrame: Number(youCosEqFrame) || 0,
    invTerr: Number(youCosInvTerr) || 0,
    invDeath: Number(youCosInvDeath) || 0,
    eqTerr: Number(youCosEqTerr) || 0,
    eqDeath: Number(youCosEqDeath) || 0,
    titleId: Number(youTitleId) || 0,
    titleMask: Number(youTitleMask) || 0
  };
}

function cosmeticsApplyStateObject(s) {
  if (!s || typeof s !== 'object') return;
  // C3: the balance is part of the cache, otherwise the shop always shows 0 before a match.
  const st = Number(s.style);
  if (Number.isFinite(st)) youStyle = Math.max(0, Math.floor(st));
  youCosInvCaptureFx = Number(s.invCaptureFx) || 0;
  youCosInvHead = Number(s.invHead) || 0;
  youCosInvSeg = Number(s.invSeg) || 0;
  youCosInvNameplate = Number(s.invNameplate) || 0;
  youCosInvFrame = Number(s.invFrame) || 0;
  youCosEqCaptureFx = Number(s.eqCaptureFx) || 0;
  youCosEqHead = Number(s.eqHead) || 0;
  youCosEqSeg = Number(s.eqSeg) || 0;
  youCosEqNameplate = Number(s.eqNameplate) || 0;
  youCosEqFrame = Number(s.eqFrame) || 0;
  youCosInvTerr = Number(s.invTerr) || 0;
  youCosInvDeath = Number(s.invDeath) || 0;
  youCosEqTerr = Number(s.eqTerr) || 0;
  youCosEqDeath = Number(s.eqDeath) || 0;
  youTitleId = Number(s.titleId) || 0;
  youTitleMask = Number(s.titleMask) || 0;
}

function cosmeticsCacheLoad() {
  try {
    const raw = localStorage.getItem(COSMETICS_CACHE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    return s;
  } catch {
    return null;
  }
}

function cosmeticsCacheSave() {
  try {
    localStorage.setItem(COSMETICS_CACHE_KEY, JSON.stringify(cosmeticsGetStateObject()));
  } catch {}
}

function cosmeticsEnsureLocalReady() {
  if (cosmeticsLoaded) return;
  const cached = cosmeticsCacheLoad();
  if (cached) {
    cosmeticsApplyStateObject(cached);
  } else {
    youStyle = 0;
    youCosInvCaptureFx = 1;
    youCosInvHead = 1;
    youCosInvSeg = 1;
    youCosInvNameplate = 1;
    youCosInvFrame = 1;
    youCosInvTerr = 1;
    youCosInvDeath = 1;
    youCosEqTerr = 0;
    youCosEqDeath = 0;
    youTitleId = 0;
    youTitleMask = 0;
    youCosEqCaptureFx = 0;
    youCosEqHead = 0;
    youCosEqSeg = 0;
    youCosEqNameplate = 0;
    youCosEqFrame = 0;
  }
  cosmeticsSource = 'cache';
  cosmeticsLoaded = true;
}

// C2: purchases work outside a room (profile-scoped on the server), so `started`
// must not gate the shop. What we do need is a live socket and server-confirmed state.
function cosmeticsServerReady() {
  return wsIsConnected() && cosmeticsSource === 'server';
}

function cosmeticsBuyLocal(cat, id) {
  // C1/C2: no server -> explain why the purchase cannot go through, inside the overlay.
  setCosmeticsStatus(() => (wsIsConnected() ? t('cosmetics.unconfirmed_hint') : t('cosmetics.no_connection')), 'error');
}

function cosmeticsEquipLocal(cat, id) {
  const c = String(cat || '').trim().toLowerCase();
  const itemId = Math.max(0, Math.min(7, Number(id) || 0));
  const bit = 1 << itemId;
  const mask = cosmeticsMaskForCat(c);
  if ((mask & bit) === 0) return;
  if (c === 'capturefx') youCosEqCaptureFx = itemId;
  else if (c === 'head') youCosEqHead = itemId;
  else if (c === 'seg') youCosEqSeg = itemId;
  else if (c === 'nameplate') youCosEqNameplate = itemId;
  else if (c === 'terr') youCosEqTerr = itemId;
  else if (c === 'death') youCosEqDeath = itemId;
  else youCosEqFrame = itemId;
  if (you) {
    if (c === 'terr') cosTerrByPlayer.set(you, itemId);
    if (c === 'death') cosDeathByPlayer.set(you, itemId);
  }
  cosmeticsSetDesiredEq(c, itemId);
  cosmeticsCacheSave();
  syncCosmeticsUi();
}

function syncCosmeticsUi() {
  if (!cosmeticsOverlay || cosmeticsOverlay.classList.contains('hidden')) return;

  if (!cosmeticsLoaded) {
    cosmeticsEnsureLocalReady();
  }

  if (!cosmeticsLoaded) {
    if (cosmeticsStyleEl) cosmeticsStyleEl.textContent = '—';

    try {
      if (cosmeticsEarnStyleEl) {
        const wrap = document.createElement('div');
        wrap.style.display = 'grid';
        wrap.style.gap = '8px';
        const l1 = document.createElement('div');
        l1.className = 'skeletonLine';
        l1.style.width = '62%';
        const l2 = document.createElement('div');
        l2.className = 'skeletonLine';
        l2.style.width = '92%';
        const l3 = document.createElement('div');
        l3.className = 'skeletonLine';
        l3.style.width = '86%';
        wrap.appendChild(l1);
        wrap.appendChild(l2);
        wrap.appendChild(l3);
        cosmeticsEarnStyleEl.replaceChildren(wrap);
      }

      if (cosmeticsTabsEl) {
        const btns = Array.from({ length: 5 }).map(() => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'cosmeticsTabBtn';
          b.disabled = true;
          const sk = document.createElement('div');
          sk.className = 'skeletonLine';
          sk.style.width = '86px';
          sk.style.height = '10px';
          b.appendChild(sk);
          return b;
        });
        cosmeticsTabsEl.replaceChildren(...btns);
      }

      if (cosmeticsItemsEl) {
        const items = Array.from({ length: 5 }).map(() => {
          const card = document.createElement('div');
          card.className = 'cosmeticsItem';

          const prev = document.createElement('div');
          prev.className = 'cosmeticsItemPreview skeletonBlock';

          const left = document.createElement('div');
          left.className = 'cosmeticsItemLeft';
          const t1 = document.createElement('div');
          t1.className = 'skeletonLine';
          t1.style.width = '220px';
          const t2 = document.createElement('div');
          t2.className = 'skeletonLine';
          t2.style.width = '140px';
          left.appendChild(t1);
          left.appendChild(t2);

          const right = document.createElement('div');
          right.className = 'cosmeticsItemRight';
          const b = document.createElement('div');
          b.className = 'skeletonBlock';
          b.style.width = '92px';
          b.style.height = '34px';
          b.style.borderRadius = '12px';
          right.appendChild(b);

          card.appendChild(left);
          card.appendChild(right);
          card.insertBefore(prev, left);
          return card;
        });
        cosmeticsItemsEl.replaceChildren(...items);
      }

      if (cosmeticsHintEl) cosmeticsHintEl.textContent = '';
    } catch {}
    return;
  }

  if (cosmeticsStyleEl) cosmeticsStyleEl.textContent = String(Math.floor(youStyle || 0));

  if (cosmeticsFilterAllBtn) cosmeticsFilterAllBtn.classList.toggle('isActive', cosmeticsFilter === 'all');
  if (cosmeticsFilterOwnedBtn) cosmeticsFilterOwnedBtn.classList.toggle('isActive', cosmeticsFilter === 'owned');
  if (cosmeticsFilterAvailableBtn) cosmeticsFilterAvailableBtn.classList.toggle('isActive', cosmeticsFilter === 'available');

  if (cosmeticsEarnStyleEl) {
    if (!cosmeticsEarnExpanded) {
      const hint = `<div>${escapeHtml(t('cosmetics.style_hint'))}</div>`;
      const off = cosmeticsSource === 'cache' ? `<div style="margin-top:6px">${escapeHtml(t('cosmetics.offline_hint'))}</div>` : '';
      setSafeHtml(cosmeticsEarnStyleEl, hint + off);
    } else {
      setSafeHtml(
        cosmeticsEarnStyleEl,
        `
        <div><b>${escapeHtml(t('cosmetics.earn_title'))}</b></div>
        <div class="row"><span class="k">${escapeHtml(t('cosmetics.earn_kills'))}</span><span>${escapeHtml(t('cosmetics.earn_kills_desc'))}</span></div>
        <div class="row"><span class="k">${escapeHtml(t('cosmetics.earn_revenge'))}</span><span>${escapeHtml(t('cosmetics.earn_revenge_desc'))}</span></div>
        <div class="row"><span class="k">${escapeHtml(t('cosmetics.earn_contracts'))}</span><span>${escapeHtml(t('cosmetics.earn_contracts_desc'))}</span></div>
        <div class="row"><span class="k">${escapeHtml(t('cosmetics.earn_dailies'))}</span><span>${escapeHtml(t('cosmetics.earn_dailies_desc'))}</span></div>
        <div class="row"><span class="k">${escapeHtml(t('cosmetics.earn_bounty'))}</span><span>${escapeHtml(t('cosmetics.earn_bounty_desc'))}</span></div>
        `
      );
    }
  }

  if (cosmeticsTabsEl) {
    const btns = COSMETICS_TABS.map((cid) => {
      const b = document.createElement('button');
      b.type = 'button';
      // .isTitles — вкладка титулов оформлена золотом: это награда за достижения,
      // а не товар, и визуально не должна читаться как магазин.
      b.className = cid === 'title' ? 'cosmeticsTabBtn isTitles' : 'cosmeticsTabBtn';
      // D11: счётчик владения прямо в табе — «Рамки 2/8».
      const total = cid === 'title' ? COS_TITLE_MAX : COSMETICS_MAX_ID + 1;
      const have = cid === 'title' ? cosTitlesUnlockedCount() : cosmeticsOwnedCount(cid);
      b.textContent = `${cosmeticsLabel(cid)} ${have}/${total}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', cid === cosmeticsCat ? 'true' : 'false');
      b.addEventListener('click', () => {
        cosmeticsCat = cid;
        cosmeticsHoverId = null;
        cosmeticsHoverCat = null;
        cosmeticsSelId = cid === 'title' ? Math.max(0, Number(youTitleId) || 0) : (Number(cosmeticsEqForCat(cid)) || 0);
        syncCosmeticsUi();
      });
      return b;
    });
    cosmeticsTabsEl.replaceChildren(...btns);
    // Вкладок восемь и лента скроллится: активная вкладка после смены категории
    // может оказаться за краем. scroll-margin для неё уже задан в CSS.
    if (cosmeticsTabsScrolledCat !== cosmeticsCat) {
      cosmeticsTabsScrolledCat = cosmeticsCat;
      try {
        const active = btns.find((b) => b.getAttribute('aria-selected') === 'true');
        active?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
      } catch {}
    }
  }

  if (cosmeticsItemsEl && cosmeticsCat === 'title') {
    renderCosmeticsTitles();
    renderCosmeticsPreview();
    scheduleCosmeticsPreviewAnim();
    return;
  }

  if (cosmeticsItemsEl) {
    cosmeticsItemsEl.classList.remove('isTitles');
    // «Где это видно» — свойство КАТЕГОРИИ, а не предмета: раньше одна и та же
    // строка дублировалась на всех восьми карточках. Показываем один раз под
    // вкладками; пустая строка скрывается стилями через :empty.
    try {
      const whereEl = document.getElementById('cosmeticsWhere');
      if (whereEl) whereEl.textContent = t(`cosmetics.where_${cosmeticsCat}`) || '';
    } catch {}
    const mask = cosmeticsMaskForCat(cosmeticsCat);
    const eq = cosmeticsEqForCat(cosmeticsCat);
    // C9: until the server confirms the inventory, everything we show is provisional.
    const confirmed = cosmeticsSource === 'server';
    const online = wsIsConnected();
    const items = [];
    const balance = Math.max(0, Math.floor(Number(youStyle) || 0));

    // D11: порядок по цене, а не по id — при поштучных ценах порядок по id
    // ломает восприятие лестницы редкости.
    const order = [];
    for (let id = 0; id <= COSMETICS_MAX_ID; id++) {
      order.push({ id, price: cosmeticsPrice(cosmeticsCat, id) });
    }
    order.sort((x, y) => (x.price - y.price) || (x.id - y.id));

    let lastTier = '';
    for (const entry of order) {
      const id = entry.id;
      const price = entry.price;
      const owned = bitHas(mask, id);
      const equipped = Number(eq) === id;

      if (cosmeticsFilter === 'owned' && !owned) continue;
      if (cosmeticsFilter === 'available' && (owned || balance < price)) continue;

      const variant = cosmeticsVariantName(cosmeticsCat, id);
      const tier = cosmeticsTier(price);

      // D11: разделители между группами тиров.
      if (tier !== lastTier) {
        lastTier = tier;
        const sep = document.createElement('div');
        sep.className = `cosmeticsTierSep tier${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;
        sep.textContent = cosmeticsTierLabel(tier);
        items.push(sep);
      }

      const card = document.createElement('div');
      card.className = 'cosmeticsItem' + (cosmeticsSelId === id ? ' isSelected' : '');
      // K7: выбор предмета раньше пересобирал весь список, и фокус улетал в
      // <body>. Теперь у карточки есть стабильный id, а выбор только
      // переключает класс на уже существующих карточках.
      card.dataset.cosid = String(id);
      card.classList.toggle('isOwned', owned);
      card.classList.toggle('isEquipped', owned && equipped);
      card.classList.toggle('isLocked', !owned && balance < price);
      card.tabIndex = 0;
      card.addEventListener('click', () => {
        cosmeticsSelectItem(id);
      });
      // Превью следует за наведением и за фокусом с клавиатуры.
      const catNow = cosmeticsCat;
      card.addEventListener('mouseenter', () => cosmeticsSetHover(catNow, id));
      card.addEventListener('focus', () => cosmeticsSetHover(catNow, id));
      card.addEventListener('mouseleave', () => cosmeticsSetHover(null, null));
      card.addEventListener('blur', () => cosmeticsSetHover(null, null));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cosmeticsSelectItem(id);
        }
      });

      const prev = document.createElement('div');
      prev.className = 'cosmeticsItemPreview';
      const cvs = document.createElement('canvas');
      prev.appendChild(cvs);
      drawMiniCosmeticPreview(cvs, cosmeticsCat, id);

      const left = document.createElement('div');
      left.className = 'cosmeticsItemLeft';
      const titleEl = document.createElement('div');
      titleEl.className = 'cosmeticsItemTitle';
      titleEl.textContent = `${cosmeticsLabel(cosmeticsCat)}: ${variant}`;

      // D11: бейдж редкости, тир вычислен из цены.
      const badge = document.createElement('span');
      badge.className = `tierBadge tier${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;
      badge.textContent = cosmeticsTierLabel(tier);
      titleEl.appendChild(document.createTextNode(' '));
      titleEl.appendChild(badge);

      const sub = document.createElement('div');
      sub.className = 'cosmeticsItemSub';
      const missing = Math.max(0, Math.ceil(price - balance));
      if (!owned && missing > 0) {
        sub.textContent = `${t('cosmetics.missing_prefix')} ${fmtInt(missing)} ${t('cosmetics.style_points')}`;
        sub.classList.add('isBlocked');
      } else if (owned && !confirmed) {
        sub.textContent = t('cosmetics.item_owned_unconfirmed');
        sub.classList.add('isUnconfirmed');
      } else {
        sub.textContent = equipped ? t('cosmetics.item_equipped') : owned ? t('cosmetics.item_owned') : t('cosmetics.item_not_owned');
      }
      left.appendChild(titleEl);
      // Короткое описание: где именно предмет виден. Закрывает претензию
      // «не понимаю, за что плачу».
      const where = document.createElement('div');
      where.className = 'cosmeticsItemWhere';
      where.textContent = t(`cosmetics.where_${cosmeticsCat}`);
      left.appendChild(where);
      left.appendChild(sub);

      // D11: прогресс-бар накопления на заблокированном товаре.
      if (!owned && price > 0 && missing > 0) {
        const bar = document.createElement('div');
        bar.className = 'cosmeticsItemProgress';
        const fill = document.createElement('div');
        fill.className = 'cosmeticsItemProgressFill';
        fill.style.width = `${Math.max(0, Math.min(100, (balance / price) * 100)).toFixed(1)}%`;
        bar.appendChild(fill);
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', String(price));
        bar.setAttribute('aria-valuenow', String(Math.min(balance, price)));
        bar.setAttribute('aria-label', `${t('cosmetics.missing_prefix')} ${fmtInt(missing)}`);
        left.appendChild(bar);
      }

      const right = document.createElement('div');
      right.className = 'cosmeticsItemRight';
      if (!owned) {
        const pr = document.createElement('div');
        pr.className = 'cosmeticsPrice';
        setSafeHtml(pr, cosmeticsFormatCost(price));
        right.appendChild(pr);

        const cat = cosmeticsCat;
        const pending = cosmeticsOpIsPending(cat, id);
        const poor = balance < price;

        const buy = document.createElement('button');
        buy.type = 'button';
        // C2/C9: buying needs a live socket and server-confirmed state.
        buy.disabled = poor || pending || !online || !confirmed || !!pendingCosmeticsOp;
        buy.className = buy.disabled && !pending ? 'btnSecondary' : 'btnPrimary';
        // C14: show exactly how much is missing.
        buy.textContent = poor ? `${t('cosmetics.not_enough_short')} ${fmtInt(missing)} ✨` : t('cosmetics.buy');
        if (pending) buy.classList.add('isLoading');
        if (!online) buy.title = t('cosmetics.no_connection');
        else if (!confirmed) buy.title = t('cosmetics.unconfirmed_hint');

        buy.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (pendingCosmeticsOp) return;
          if (!cosmeticsServerReady()) {
            setCosmeticsStatus(() => (wsIsConnected() ? t('cosmetics.unconfirmed_hint') : t('cosmetics.no_connection')), 'error');
            cosmeticsBuyLocal(cat, id);
            return;
          }
          // C4: lock the button until the server answers (or we time out).
          buy.disabled = true;
          buy.classList.add('isLoading');
          cosmeticsOpBegin(cat, id);
          setCosmeticsStatus(() => t('cosmetics.op_pending'), 'info');
          // C5: a silently dropped send must not leave a dead spinner.
          if (!wsSend('cosmeticsBuy', { cat, id })) {
            cosmeticsOpClear();
            setCosmeticsStatus(() => t('cosmetics.no_connection'), 'error');
            syncCosmeticsUi();
          }
        });
        right.appendChild(buy);
      } else {
        const eqBtn = document.createElement('button');
        eqBtn.type = 'button';
        const cat = cosmeticsCat;
        const doEquip = (wantId) => {
          if (!cosmeticsServerReady()) {
            cosmeticsEquipLocal(cat, wantId);
            setCosmeticsStatus(() => (wsIsConnected() ? t('cosmetics.unconfirmed_hint') : t('cosmetics.no_connection')), 'info');
            return;
          }
          // C5: react to a dropped send instead of pretending it worked.
          if (!wsSend('cosmeticsEquip', { cat, id: wantId })) {
            cosmeticsEquipLocal(cat, wantId);
            setCosmeticsStatus(() => t('cosmetics.no_connection'), 'error');
          } else {
            cosmeticsSetDesiredEq(cat, wantId);
          }
        };

        if (equipped && id !== 0) {
          eqBtn.className = 'btnSecondary';
          eqBtn.textContent = t('cosmetics.remove');
          eqBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            doEquip(0);
          });
        } else {
          eqBtn.className = equipped ? 'btnGhost' : 'btnPrimary';
          eqBtn.textContent = equipped ? t('cosmetics.item_equipped') : t('cosmetics.wear');
          eqBtn.disabled = equipped;
          eqBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            doEquip(id);
          });
        }
        right.appendChild(eqBtn);
      }

      card.appendChild(left);
      card.appendChild(right);
      card.insertBefore(prev, left);
      items.push(card);
    }

    if (!items.length) {
      setSafeHtml(
        cosmeticsItemsEl,
        `
        <div class="roomsEmpty">
          <div class="roomsEmptyTitle">${escapeHtml(t('cosmetics.empty_title'))}</div>
          <div class="roomsEmptyDesc">${escapeHtml(t('cosmetics.empty_desc'))}</div>
        </div>
        `
      );
    } else {
      cosmeticsItemsEl.replaceChildren(...items);
    }
  }

  renderCosmeticsPreview();
  scheduleCosmeticsPreviewAnim();
}

/* --------------------------------------------------------------------------
   Большое превью магазина. Ни одной собственной функции отрисовки предметов:
   всё рисуют drawSegTile / drawHead / drawNamePlate / drawCaptureFx / drawFrameRow,
   то есть ровно то же, что и игровой цикл.
   -------------------------------------------------------------------------- */

// Какой id показывать: наведённая карточка важнее выбранной, при уходе курсора
// превью возвращается к выбранному варианту.
/* K7: сменить выделение без пересборки списка. Возврат к полному
   syncCosmeticsUi() — только если карточек с data-cosid в DOM нет (список ещё
   не строился или отрисован пустой заглушкой). */
function cosmeticsSelectItem(id) {
  const next = Number(id) || 0;
  cosmeticsHoverId = null;
  cosmeticsHoverCat = null;
  if (cosmeticsSelId === next) {
    renderCosmeticsPreview();
    return;
  }
  cosmeticsSelId = next;
  let patched = false;
  try {
    const cards = cosmeticsItemsEl?.querySelectorAll?.('.cosmeticsItem[data-cosid], .titleItem[data-cosid]');
    if (cards && cards.length) {
      for (const c of cards) c.classList.toggle('isSelected', Number(c.dataset.cosid) === next);
      patched = true;
    }
  } catch {}
  if (patched) renderCosmeticsPreview();
  else syncCosmeticsUi();
}

function cosmeticsPreviewId() {
  // У титулов свой потолок id (их 16, а не 8), поэтому клампим по категории.
  const clamp = cosmeticsCat === 'title'
    ? (v) => Math.max(0, Math.min(COS_TITLE_MAX, Number(v) || 0))
    : cosClampId;
  if (cosmeticsHoverId != null && cosmeticsHoverCat === cosmeticsCat) return clamp(cosmeticsHoverId);
  return clamp(cosmeticsSelId);
}

function cosmeticsSetHover(cat, id) {
  const nextCat = id == null ? null : String(cat);
  const nextId = id == null
    ? null
    : (nextCat === 'title' ? Math.max(0, Math.min(COS_TITLE_MAX, Number(id) || 0)) : cosClampId(id));
  if (cosmeticsHoverCat === nextCat && cosmeticsHoverId === nextId) return;
  cosmeticsHoverCat = nextCat;
  cosmeticsHoverId = nextId;
  renderCosmeticsPreview();
}

function renderCosmeticsPreview() {
  if (!cosmeticsPreview) return;
  const cssW = Math.max(200, Math.round(cosmeticsPreview.clientWidth || 420));
  const cssH = Math.max(140, Math.round(cosmeticsPreview.clientHeight || 260));
  const ctx2 = cosPrepCanvas(cosmeticsPreview, cssW, cssH);
  if (!ctx2) return;
  const w = cssW;
  const h = cssH;

  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const now = reduceMotion ? 0 : performance.now();

  const baseC = boostHsl(colors.get(you) || 'hsl(210 20% 60%)');
  const selId = cosmeticsPreviewId();

  const setHint = () => {
    if (!cosmeticsHintEl) return;
    const where = t(`cosmetics.where_${cosmeticsCat}`);
    cosmeticsHintEl.textContent = `${cosmeticsLabel(cosmeticsCat)}: ${cosmeticsVariantName(cosmeticsCat, selId)} — ${where}`;
  };

  if (cosmeticsCat === 'frame') {
    drawCosmeticsFramesScene(ctx2, w, h, selId);
    setHint();
    return;
  }

  const fieldPad = Math.round(Math.min(w, h) * 0.08);
  const fx = fieldPad;
  const fy = fieldPad;
  const fw = w - fieldPad * 2;
  const fh = h - fieldPad * 2;
  drawCosmeticsFieldBackdrop(ctx2, fx, fy, fw, fh);

  const cell = Math.min(fw, fh) * 0.12;
  const scell = Math.max(14, Math.round(cell * 0.85));
  const cx = fx + fw * 0.40;
  const cy = fy + fh * 0.62;

  const headId = cosmeticsCat === 'head' ? selId : youCosEqHead;
  const segId = cosmeticsCat === 'seg' ? selId : youCosEqSeg;
  const nameId = cosmeticsCat === 'nameplate' ? selId : youCosEqNameplate;
  const capId = cosmeticsCat === 'capturefx' ? selId : youCosEqCaptureFx;
  const terrId = cosmeticsCat === 'terr' ? selId : youCosEqTerr;
  const deathId = cosmeticsCat === 'death' ? selId : youCosEqDeath;
  const titleId = cosmeticsCat === 'title' ? selId : youTitleId;
  const plateFont = Math.max(11, Math.round(scell * 0.62));
  const plateLabel = `${cosTitlePrefix(titleId)}${t('cosmetics.balance_you')}`;

  const zone = {
    x: Math.round(fx + fw * 0.58),
    y: Math.round(fy + fh * 0.42),
    w: Math.round(cell * 3.2),
    h: Math.round(cell * 3.2)
  };

  if (cosmeticsCat === 'terr') {
    // Территория — самая большая вещь на экране, поэтому в превью она занимает
    // почти всё поле: иначе разницу между узорами просто не видно.
    const big = {
      x: Math.round(fx + fw * 0.06),
      y: Math.round(fy + fh * 0.10),
      w: Math.round(fw * 0.62),
      h: Math.round(fh * 0.80)
    };
    drawCosmeticsZone(ctx2, big, you, 0.62, terrId, scell);
    const hx = big.x + big.w + scell * 1.6;
    const hy = big.y + big.h * 0.55;
    drawCosmeticsSnake(ctx2, hx, hy, scell, you, youCosEqSeg, youCosEqHead, baseC, 4);
    drawNamePlate(ctx2, plateLabel, hx, hy - scell * 0.95, baseC, youCosEqNameplate, 0.95, plateFont, now);
    setHint();
    return;
  }

  if (cosmeticsCat === 'death') {
    // Зацикленный сценарий гибели: змейка едет, потом взрывается.
    const period = 2200;
    const p = reduceMotion ? 0.35 : (now % period) / period;
    const dieStart = 0.42;
    const dieP = p < dieStart ? -1 : Math.min(1, (p - dieStart) / (COS_DEATH_MS / period));
    drawCosmeticsZone(ctx2, zone, you, 0.58, youCosEqTerr, scell);
    const hx = fx + fw * (0.18 + 0.22 * Math.min(1, p / dieStart));
    const hy = cy;
    if (dieP < 0) {
      drawCosmeticsSnake(ctx2, hx, hy, scell, you, youCosEqSeg, youCosEqHead, baseC, 5);
      drawNamePlate(ctx2, plateLabel, hx, hy - scell * 0.95, baseC, youCosEqNameplate, 0.95, plateFont, now);
    } else if (dieP <= 1) {
      drawDeathFx(ctx2, hx, hy, Math.max(16, Math.round(scell * 1.2)), baseC, deathId, dieP);
    }
    setHint();
    return;
  }

  if (cosmeticsCat === 'title') {
    drawCosmeticsZone(ctx2, zone, you, 0.58, youCosEqTerr, scell);
    drawCosmeticsSnake(ctx2, cx, cy, scell, you, youCosEqSeg, youCosEqHead, baseC, 5);
    drawNamePlate(ctx2, plateLabel, cx, cy - scell * 0.95, baseC, youCosEqNameplate, 0.95, plateFont, now);
    ctx2.save();
    ctx2.strokeStyle = 'rgba(96,165,250,0.55)';
    ctx2.setLineDash([5, 4]);
    ctx2.lineWidth = 2;
    const ph = Math.round(plateFont * 1.5);
    ctx2.strokeRect(cx - scell * 3.2, cy - scell * 0.95 - ph - 3.5, scell * 6.4, ph + 7);
    ctx2.restore();
    setHint();
    return;
  }

  if (cosmeticsCat === 'capturefx') {
    // Зацикленный сценарий захвата. Раньше здесь была рассинхронизация: фаза
    // эффекта считалась от performance.now() независимо от фазы сцены, поэтому
    // в момент показа вспышка чаще всего уже догорела (alpha ≈ 0) и покупатель
    // видел пустое поле. Теперь фаза эффекта — часть одного цикла.
    const period = 2400;
    const p = reduceMotion ? 0.60 : (now % period) / period;

    const approach = Math.max(0, Math.min(1, p / 0.30));
    const loopP = p < 0.30 ? 0 : Math.max(0, Math.min(1, (p - 0.30) / 0.22));
    // Вспышка занимает ровно 650 мс — столько же, сколько живёт бурст в игре.
    const burstStart = 0.52;
    const burstLen = 650 / period;
    const burstP = p < burstStart ? -1 : (p - burstStart) / burstLen;
    const showBurst = burstP >= 0 && burstP <= 1;
    const filled = p >= burstStart;

    const loopRect = {
      x: zone.x - Math.round(zone.w * 0.44),
      y: zone.y + Math.round(zone.h * 0.16),
      w: Math.round(zone.w * 0.44),
      h: Math.round(zone.h * 0.66)
    };

    drawCosmeticsZone(ctx2, zone, you, 0.58, terrId, scell);
    if (filled) drawCosmeticsZone(ctx2, loopRect, you, 0.58, terrId, scell);

    const headX = cx + (loopRect.x - cx) * (0.15 + 0.85 * approach);
    const headY = cy + (reduceMotion ? 0 : Math.sin(now * 0.0032) * cell * 0.10);

    if (!filled && loopP > 0) {
      const per = Math.max(1, Math.round(((loopRect.w + loopRect.h) * 2) / scell));
      const k = Math.floor(loopP * per);
      const pts = [];
      for (let x = loopRect.x; x <= loopRect.x + loopRect.w; x += scell) pts.push({ x, y: loopRect.y });
      for (let y = loopRect.y + scell; y <= loopRect.y + loopRect.h; y += scell) pts.push({ x: loopRect.x + loopRect.w, y });
      for (let x = loopRect.x + loopRect.w - scell; x >= loopRect.x; x -= scell) pts.push({ x, y: loopRect.y + loopRect.h });
      for (let y = loopRect.y + loopRect.h - scell; y >= loopRect.y + scell; y -= scell) pts.push({ x: loopRect.x, y });
      for (let i = 0; i < Math.min(pts.length, k); i++) {
        drawSegTile(ctx2, pts[i].x, pts[i].y, scell, baseC, youCosEqSeg, i + 3, 0.85, now);
      }
    }

    drawCosmeticsSnake(ctx2, headX, headY, scell, you, youCosEqSeg, youCosEqHead, baseC);
    drawNamePlate(ctx2, plateLabel, headX, headY - scell * 0.85, baseC, youCosEqNameplate, 0.95, plateFont, now);

    if (showBurst) {
      const fxX = loopRect.x + loopRect.w / 2;
      const fxY = loopRect.y + loopRect.h / 2;
      // В магазине эффект обязан проигрываться всегда — независимо от того,
      // выключил ли игрок эффекты в настройках (fxEnabled гасит только игру).
      drawCaptureFx(ctx2, fxX, fxY, Math.max(18, Math.round(scell * 1.4)), baseC, capId, burstP);
    }

    setHint();
    return;
  }

  // Территория игрока всегда рисуется его сплошным цветом: стиль следа в игре
  // применяется ТОЛЬКО к временному следу вне территории, и превью обязано
  // показывать ровно это, а не заливать стилем всю зону.
  drawCosmeticsZone(ctx2, zone, you, 0.58, terrId, scell);

  drawCosmeticsSnake(ctx2, cx, cy, scell, you, segId, headId, baseC, cosmeticsCat === 'seg' ? 9 : 6);
  drawNamePlate(ctx2, plateLabel, cx, cy - scell * 0.95, baseC, nameId, 0.95, plateFont, now);

  // Указатель на то место сцены, которое меняет выбранный предмет.
  ctx2.save();
  ctx2.strokeStyle = 'rgba(96,165,250,0.55)';
  ctx2.setLineDash([5, 4]);
  ctx2.lineWidth = 2;
  if (cosmeticsCat === 'head') {
    ctx2.beginPath();
    ctx2.arc(cx, cy, scell * 0.78, 0, Math.PI * 2);
    ctx2.stroke();
  } else if (cosmeticsCat === 'nameplate') {
    const ph = Math.round(plateFont * 1.5);
    ctx2.strokeRect(cx - scell * 1.9, cy - scell * 0.95 - ph - 3.5, scell * 3.8, ph + 7);
  } else if (cosmeticsCat === 'seg') {
    ctx2.strokeRect(cx - scell * 6.4, cy - scell * 0.72, scell * 6.0, scell * 1.44);
  }
  ctx2.restore();

  setHint();
}

function drawCosmeticsSnake(ctx2, headX, headY, cell, ownerId, segId, headId, headColor, tileCount) {
  const base = boostHsl(colors.get(ownerId) || 'hsl(210 20% 60%)');
  const c = headColor || base;
  const scell = Math.max(14, Math.round(cell));
  const now = performance.now();
  const tiles = Math.max(3, Math.min(12, Number(tileCount) || 6));
  const startX = headX - scell * 0.85;
  for (let i = 0; i < tiles; i++) {
    drawSegTile(ctx2, startX - i * scell - scell / 2, headY - scell / 2, scell, base, segId, i + 17, 0.88, now);
  }
  drawHead(ctx2, headX, headY, scell, c, headId, 1, 0, now);
}

function cosmeticsFrameSampleName(i) {
  return i === 1 ? t('cosmetics.balance_you') : `${t('leaderboard.player')} ${i + 2}`;
}

function drawCosmeticsFramesScene(ctx2, w, h, frameId) {
  const pad = Math.round(Math.min(w, h) * 0.09);
  const th = Math.max(22, Math.round(h * 0.12));
  const rowH = Math.max(22, Math.round(h * 0.12));
  const rows = 4;
  const tw = w - pad * 2;
  const tx = pad;
  const ty = Math.round((h - (th + rows * rowH)) / 2);

  ctx2.save();
  ctx2.fillStyle = 'rgba(0,0,0,0.26)';
  ctx2.fillRect(tx, ty, tw, th + rows * rowH);
  ctx2.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx2.lineWidth = 1;
  ctx2.strokeRect(tx + 0.5, ty + 0.5, tw - 1, th + rows * rowH - 1);

  ctx2.fillStyle = 'rgba(0,0,0,0.34)';
  ctx2.fillRect(tx, ty, tw, th);
  ctx2.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx2.beginPath();
  ctx2.moveTo(tx, ty + th + 0.5);
  ctx2.lineTo(tx + tw, ty + th + 0.5);
  ctx2.stroke();

  ctx2.font = `12px ${COS_FONT}`;
  ctx2.fillStyle = 'rgba(255,255,255,0.86)';
  ctx2.textBaseline = 'middle';
  ctx2.textAlign = 'left';
  ctx2.fillText('#', tx + 12, ty + th / 2);
  ctx2.fillText(t('leaderboard.player'), tx + 34, ty + th / 2);
  ctx2.textAlign = 'right';
  ctx2.fillText(t('leaderboard.cells'), tx + tw - 12, ty + th / 2);
  ctx2.restore();

  const youRow = 1;
  for (let i = 0; i < rows; i++) {
    drawFrameRow(
      ctx2,
      tx,
      ty + th + i * rowH,
      tw,
      rowH,
      frameId,
      i + 1,
      cosmeticsFrameSampleName(i),
      fmtInt(1200 - i * 180),
      i === youRow
    );
  }
}

function drawCosmeticsFieldBackdrop(ctx2, x, y, w, h) {
  ctx2.save();
  const bg = ctx2.createLinearGradient(x, y, x + w, y + h);
  bg.addColorStop(0, '#070a0f');
  bg.addColorStop(1, '#0b0f14');
  ctx2.fillStyle = bg;
  ctx2.fillRect(x, y, w, h);

  ctx2.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx2.lineWidth = 1;
  const step = Math.max(16, Math.min(28, Math.round(Math.min(w, h) * 0.11)));
  for (let px = x + step; px < x + w; px += step) {
    ctx2.beginPath();
    ctx2.moveTo(px + 0.5, y);
    ctx2.lineTo(px + 0.5, y + h);
    ctx2.stroke();
  }
  for (let py = y + step; py < y + h; py += step) {
    ctx2.beginPath();
    ctx2.moveTo(x, py + 0.5);
    ctx2.lineTo(x + w, py + 0.5);
    ctx2.stroke();
  }

  ctx2.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx2.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx2.restore();
}

function drawCosmeticsZone(ctx2, rect, ownerId, alpha, terrId, cellHint) {
  const base = boostHsl(colors.get(ownerId) || 'hsl(210 20% 60%)');
  const id = cosClampId(terrId);
  const a = Math.max(0, Math.min(1, alpha));
  const now = performance.now();
  // Территория рисуется теми же плитками, что и в игре: узор выбранного
  // стиля обязан выглядеть в магазине ровно так же, как на поле.
  const cell = Math.max(8, Math.round(Number(cellHint) || 16));
  const cols = Math.max(1, Math.ceil(rect.w / cell));
  const rows = Math.max(1, Math.ceil(rect.h / cell));
  ctx2.save();
  ctx2.beginPath();
  ctx2.rect(rect.x, rect.y, rect.w, rect.h);
  ctx2.clip();
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      drawTerrTile(ctx2, rect.x + gx * cell, rect.y + gy * cell, cell, base, id, gx, gy, a, now);
    }
  }
  ctx2.restore();
  ctx2.save();
  if (id === 5) {
    // Витраж: светящийся шов ровно по границе владения.
    const rgb = hslToRgb(base);
    ctx2.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx2.shadowColor = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    ctx2.shadowBlur = 14;
    ctx2.lineWidth = 3;
  } else {
    ctx2.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx2.lineWidth = 1;
  }
  ctx2.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
  ctx2.restore();
}

function hueToHsl(h) {
  const COLOR_VARIANTS = [
    [78, 52],
    [78, 42],
    [78, 62],
    [90, 52],
    [66, 52],
    [90, 62]
  ];
  const code = Number(h);
  if (!Number.isFinite(code)) return 'hsl(210 78% 52%)';
  const safe = Math.max(0, Math.floor(code));
  const hue = safe % 360;
  const vi = Math.floor(safe / 360) % COLOR_VARIANTS.length;
  const v = COLOR_VARIANTS[vi] || COLOR_VARIANTS[0];
  return `hsl(${hue} ${v[0]}% ${v[1]}%)`;
}

const DIR_NAMES = ['up', 'down', 'left', 'right'];

const EN = {
  labels: {
    room: 'Room',
    round: 'Round',
    roundEnded: 'Round ended',
    bounty: 'Bounty',
    buffs: 'Buffs',
    contract: 'Contract',
    daily: 'Daily',
    contractComplete: 'Contract completed',
    dailyComplete: 'Daily completed',
    achievement: 'Achievement',
    style: 'Style'
  },
  powerups: {
    1: { name: 'Shield', desc: 'Saves you once from having your trail cut' },
    2: { name: 'Dash', desc: 'Short speed boost' },
    3: { name: 'Nova', desc: 'Bonus territory + clears trails nearby' },
    4: { name: 'Mega dash', desc: 'Strong speed boost (extension limit applies)' }
  },
  mutators: {
    1: { name: 'Double capture', desc: 'Capture gives more points and bonus territory' },
    2: { name: 'Energy surge', desc: 'More items on the map and faster progress' }
  },
  contracts: {
    1: { name: 'Kills', desc: 'Kill opponents (by cutting trails)' },
    2: { name: 'Pickups', desc: 'Collect items on the map' },
    3: { name: 'Capture', desc: 'Close loops and capture cells' }
  },
  dailies: {
    1: { name: 'Kills', desc: 'Get kills in a match' },
    2: { name: 'Pickups', desc: 'Collect items in a match' },
    3: { name: 'Capture', desc: 'Capture enough cells' },
    4: { name: 'Style', desc: 'Earn style points' }
  },
  achv: {
    1: { name: '10 kills', desc: 'Get 10 kills' },
    2: { name: '3 bounties', desc: 'Claim bounty 3 times' },
    3: { name: '3 contracts', desc: 'Complete 3 contracts' },
    4: { name: 'Style 200', desc: 'Reach 200 style' },
    5: { name: '3 revenges', desc: 'Get 3 revenge kills' }
  },
  style: {
    1: { name: 'Kill' },
    2: { name: 'Revenge' },
    3: { name: 'Bounty' },
    4: { name: 'Contract' },
    5: { name: 'Daily' },
    6: { name: 'Win' },
    7: { name: 'Top-5' }
  }
};

const RU = {
  labels: {
    room: 'Комната',
    round: 'Раунд',
    roundEnded: 'Раунд завершён',
    bounty: 'Награда',
    buffs: 'Эффекты',
    contract: 'Контракт',
    daily: 'Задание',
    contractComplete: 'Контракт выполнен',
    dailyComplete: 'Задание выполнено',
    achievement: 'Достижение',
    style: 'Стиль'
  },
  powerups: {
    1: { name: 'Щит', desc: 'Один раз спасает от перерезания следа' },
    2: { name: 'Рывок', desc: 'Ускорение на короткое время' },
    3: { name: 'Нова', desc: 'Бонусная территория + очищает следы рядом' },
    4: { name: 'Мегарывок', desc: 'Сильное ускорение (есть лимит продления)' }
  },
  mutators: {
    1: { name: 'Двойной захват', desc: 'Захват даёт больше очков и бонус-территорию' },
    2: { name: 'Скачок энергии', desc: 'Больше предметов на карте и быстрее прогресс' }
  },
  contracts: {
    1: { name: 'Убийства', desc: 'Убейте соперников (перерезая след)' },
    2: { name: 'Подборы', desc: 'Собирайте предметы на карте' },
    3: { name: 'Захват', desc: 'Замыкайте петлю и захватывайте клетки' }
  },
  dailies: {
    1: { name: 'Убийства', desc: 'Наберите убийства за матч' },
    2: { name: 'Подборы', desc: 'Соберите предметы за матч' },
    3: { name: 'Захват', desc: 'Захватите достаточно клеток' },
    4: { name: 'Стиль', desc: 'Заработайте стильные очки' }
  },
  achv: {
    1: { name: '10 убийств', desc: 'Сделайте 10 убийств' },
    2: { name: '3 награды', desc: 'Соберите награду 3 раза' },
    3: { name: '3 контракта', desc: 'Выполните 3 контракта' },
    4: { name: 'Стиль 200', desc: 'Наберите 200 стиля' },
    5: { name: '3 мести', desc: 'Сделайте 3 убийства мести' }
  },
  style: {
    1: { name: 'Убийство' },
    2: { name: 'Месть' },
    3: { name: 'Награда' },
    4: { name: 'Контракт' },
    5: { name: 'Задание' },
    6: { name: 'Победа' },
    7: { name: 'Топ-5' }
  }
};

function infoName(map, type, fallback) {
  const it = map && map[type];
  return it?.name || fallback || '';
}

function infoDesc(map, type, fallback) {
  const it = map && map[type];
  return it?.desc || fallback || '';
}

function powerupLabel(type) {
  const p = infoPack();
  return infoName(p.powerups, type, lang === 'en' ? 'Item' : 'Предмет');
}

function mutatorLabel(type) {
  const p = infoPack();
  return infoName(p.mutators, type, '');
}

function contractLabel(type) {
  const p = infoPack();
  return infoName(p.contracts, type, '');
}

function dailyLabel(type) {
  const p = infoPack();
  return infoName(p.dailies, type, lang === 'en' ? 'Daily' : 'Задание');
}

function achvLabel(type) {
  const p = infoPack();
  return infoName(p.achv, type, lang === 'en' ? `Achievement ${type}` : `Достижение ${type}`);
}

function styleLabel(type) {
  const p = infoPack();
  return infoName(p.style, type, p.labels.style);
}

// J19: мелкие начисления Стиля агрегируются в один тост «+N Стиля ×3».
function flushStyleToast() {
  styleToastTimer = 0;
  const delta = styleToastAcc;
  if (!delta) return;
  const reason = styleToastReason;
  const count = Math.max(1, styleToastCount);
  styleToastAcc = 0;
  styleToastReason = 0;
  styleToastCount = 0;
  const suffix = count > 1 ? ` ×${count}` : '';
  addToast('✨', `+${delta} ${t('cosmetics.style_points')}${suffix}`, null, styleLabel(reason), {
    tab: 'match',
    key: `style_small_${reason}`,
    prio: 'minor'
  });
}

function approxNowTick() {
  if (!tickMs) return null;
  if (!lastEventsTick || !lastEventsAt) return null;
  const dtMs = Date.now() - lastEventsAt;
  return lastEventsTick + Math.max(0, dtMs / tickMs);
}

function formatTickRemain(untilTick) {
  const ut = Number(untilTick) || 0;
  if (!ut || !tickMs) return '';
  const nt = approxNowTick();
  if (nt == null) return '';
  const remTicks = ut - nt;
  const remMs = Math.max(0, remTicks * tickMs);
  const sec = Math.ceil(remMs / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function tickRemainSeconds(untilTick) {
  const ut = Number(untilTick) || 0;
  if (!ut || !tickMs) return null;
  const nt = approxNowTick();
  if (nt == null) return null;
  const remTicks = ut - nt;
  const remMs = Math.max(0, remTicks * tickMs);
  return remMs / 1000;
}

function ensureSettingsState() {
  try {
    const raw = localStorage.getItem('snakes_settings_v1');
    if (raw) {
      const s = JSON.parse(raw);
      fxEnabled = s.fxEnabled ?? fxEnabled;
      fxIntensity = s.fxIntensity ?? fxIntensity;
      shakeIntensity = s.shakeIntensity ?? shakeIntensity;
      perfEnabled = s.perfEnabled ?? perfEnabled;
      perfCompact = s.perfCompact ?? perfCompact;
      soundEnabled = s.soundEnabled ?? soundEnabled;
      soundVolume = s.soundVolume ?? soundVolume;
      muteOnBlur = s.muteOnBlur ?? muteOnBlur;
      hudBrightness = s.hudBrightness ?? hudBrightness;
      hudContrast = s.hudContrast ?? hudContrast;
      hudPanelOpacity = s.hudPanelOpacity ?? hudPanelOpacity;
      const p = normalizeFxPreset(s.fxPreset);
      if (p) {
        fxPreset = p;
        fxPresetUserSet = !!s.fxPresetUserSet;
      }
    }
  } catch {}

  // J22: без явного выбора пользователя уважаем системный запрет анимаций.
  if (!fxPresetUserSet && prefersReducedMotion()) fxPreset = 'calm';
  applyFxPreset(fxPreset, false);

  if (fxEnabledInput) fxEnabledInput.checked = !!fxEnabled;
  if (fxIntensityInput) fxIntensityInput.value = String(fxIntensity);
  if (shakeIntensityInput) shakeIntensityInput.value = String(shakeIntensity);
  if (perfEnabledInput) perfEnabledInput.checked = !!perfEnabled;
  if (perfCompactInput) perfCompactInput.checked = !!perfCompact;
  if (soundEnabledInput) soundEnabledInput.checked = !!soundEnabled;
  if (soundVolumeInput) soundVolumeInput.value = String(soundVolume);
  if (muteOnBlurInput) muteOnBlurInput.checked = !!muteOnBlur;
  if (hudBrightnessInput) hudBrightnessInput.value = String(hudBrightness);
  if (hudContrastInput) hudContrastInput.value = String(hudContrast);
  if (hudPanelOpacityInput) hudPanelOpacityInput.value = String(hudPanelOpacity);

  if (perfEl) perfEl.style.display = perfEnabled ? '' : 'none';
  applyPerfUi();
  applyHudSettings();

  applyHudDensity(getHudDensityDefault());
}

function saveSettingsState() {
  try {
    localStorage.setItem(
      'snakes_settings_v1',
      JSON.stringify({
        fxEnabled,
        fxIntensity,
        shakeIntensity,
        perfEnabled,
        perfCompact,
        soundEnabled,
        soundVolume,
        muteOnBlur,
        hudBrightness,
        hudContrast,
        hudPanelOpacity,
        fxPreset,
        fxPresetUserSet
      })
    );
  } catch {}
}

function resetSettingsState() {
  fxEnabled = true;
  fxIntensity = 0.85;
  shakeIntensity = 0.55;
  perfEnabled = false;
  perfCompact = false;
  soundEnabled = true;
  soundVolume = 0.7;
  muteOnBlur = true;
  hudBrightness = 1;
  hudContrast = 1;
  hudPanelOpacity = 0.82;
  soundMutedByBlur = false;
  fxPresetUserSet = false;
  applyFxPreset(prefersReducedMotion() ? 'calm' : 'normal', false);

  if (fxEnabledInput) fxEnabledInput.checked = !!fxEnabled;
  if (fxIntensityInput) fxIntensityInput.value = String(fxIntensity);
  if (shakeIntensityInput) shakeIntensityInput.value = String(shakeIntensity);
  if (perfEnabledInput) perfEnabledInput.checked = !!perfEnabled;
  if (perfCompactInput) perfCompactInput.checked = !!perfCompact;
  if (soundEnabledInput) soundEnabledInput.checked = !!soundEnabled;
  if (soundVolumeInput) soundVolumeInput.value = String(soundVolume);
  if (muteOnBlurInput) muteOnBlurInput.checked = !!muteOnBlur;
  if (hudBrightnessInput) hudBrightnessInput.value = String(hudBrightness);
  if (hudContrastInput) hudContrastInput.value = String(hudContrast);
  if (hudPanelOpacityInput) hudPanelOpacityInput.value = String(hudPanelOpacity);

  if (perfEl) perfEl.style.display = perfEnabled ? '' : 'none';
  applyPerfUi();
  applyHudSettings();
  saveSettingsState();
}

function showSettingsOverlay() {
  if (settingsOverlay) settingsOverlay.classList.remove('hidden');
  overlayManager.open('settings');
  syncOverlayUiState();
  overlayManager.focusDefault('settings');
}

function hideSettingsOverlay() {
  if (settingsOverlay) settingsOverlay.classList.add('hidden');
  overlayManager.close('settings');
  syncOverlayUiState();
}

// J22: тумблер пресета. Разметку добавляет вёрсточный агент (#fxPresetSelect);
// пока её нет — создаём поле сами, чтобы настройка была доступна.
function ensureFxPresetControl() {
  let sel = document.getElementById('fxPresetSelect');
  if (!sel) {
    const anchor = fxEnabledInput?.closest?.('.fieldInline') || null;
    const host = anchor?.parentElement || null;
    if (!host) return null;
    try {
      const label = document.createElement('label');
      label.className = 'fieldInline';
      const span = document.createElement('span');
      span.className = 'fieldLabel';
      span.setAttribute('data-i18n', 'settings.fx_preset');
      span.textContent = t('settings.fx_preset');
      sel = document.createElement('select');
      sel.id = 'fxPresetSelect';
      label.appendChild(span);
      label.appendChild(sel);

      const hint = document.createElement('div');
      hint.className = 'fieldHint';
      hint.setAttribute('data-i18n', 'settings.fx_preset_hint');
      hint.textContent = t('settings.fx_preset_hint');

      host.insertBefore(label, anchor);
      host.insertBefore(hint, anchor);
    } catch {
      return null;
    }
  }

  try {
    const opts = [
      ['calm', t('settings.fx_preset_calm')],
      ['normal', t('settings.fx_preset_normal')],
      ['casino', t('settings.fx_preset_casino')]
    ];
    const need = sel.options?.length !== opts.length;
    if (need) sel.replaceChildren();
    for (let i = 0; i < opts.length; i++) {
      let op = sel.options?.[i];
      if (!op) {
        op = document.createElement('option');
        sel.appendChild(op);
      }
      op.value = opts[i][0];
      op.textContent = opts[i][1];
    }
    sel.value = fxPreset;
  } catch {}
  return sel;
}

function bindSettingsUi() {
  ensureSettingsState();

  const fxPresetSelect = ensureFxPresetControl();
  fxPresetSelect?.addEventListener('change', () => {
    applyFxPreset(fxPresetSelect.value, true);
    saveSettingsState();
    sfx.ui();
  });

  if (hudDensitySelect) {
    try {
      hudDensitySelect.value = hudDensity;
    } catch {}
    hudDensitySelect.addEventListener('change', () => {
      applyHudDensity(hudDensitySelect.value);
    });
  }

  settingsBtn?.addEventListener('click', () => {
    showSettingsOverlay();
  });
  closeSettingsBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    hideSettingsOverlay();
  });

  settingsOverlay?.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      hideSettingsOverlay();
    }
  });

  fxEnabledInput?.addEventListener('change', () => {
    fxEnabled = !!fxEnabledInput.checked;
    saveSettingsState();
  });
  fxIntensityInput?.addEventListener('input', () => {
    fxIntensity = Math.max(0, Math.min(1, Number(fxIntensityInput.value) || 0));
    saveSettingsState();
  });
  shakeIntensityInput?.addEventListener('input', () => {
    shakeIntensity = Math.max(0, Math.min(1, Number(shakeIntensityInput.value) || 0));
    saveSettingsState();
  });
  perfEnabledInput?.addEventListener('change', () => {
    perfEnabled = !!perfEnabledInput.checked;
    if (perfEl) perfEl.style.display = perfEnabled ? '' : 'none';
    saveSettingsState();
  });
  perfCompactInput?.addEventListener('change', () => {
    perfCompact = !!perfCompactInput.checked;
    applyPerfUi();
    saveSettingsState();
  });
  soundEnabledInput?.addEventListener('change', () => {
    soundEnabled = !!soundEnabledInput.checked;
    saveSettingsState();
  });
  soundVolumeInput?.addEventListener('input', () => {
    soundVolume = Math.max(0, Math.min(1, Number(soundVolumeInput.value) || 0));
    saveSettingsState();
  });

  muteOnBlurInput?.addEventListener('change', () => {
    muteOnBlur = !!muteOnBlurInput.checked;
    if (!muteOnBlur) soundMutedByBlur = false;
    saveSettingsState();
  });

  hudBrightnessInput?.addEventListener('input', () => {
    hudBrightness = Math.max(0.5, Math.min(2, Number(hudBrightnessInput.value) || 1));
    applyHudSettings();
    saveSettingsState();
  });
  hudContrastInput?.addEventListener('input', () => {
    hudContrast = Math.max(0.5, Math.min(2, Number(hudContrastInput.value) || 1));
    applyHudSettings();
    saveSettingsState();
  });
  hudPanelOpacityInput?.addEventListener('input', () => {
    hudPanelOpacity = Math.max(0.3, Math.min(1, Number(hudPanelOpacityInput.value) || 0.82));
    applyHudSettings();
    saveSettingsState();
  });

  testBeepBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    playBeep(660, 120, 1);
  });

  resetSettingsBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    resetSettingsState();
  });

  window.addEventListener('blur', () => {
    if (!muteOnBlur) return;
    soundMutedByBlur = true;
  });
  window.addEventListener('focus', () => {
    soundMutedByBlur = false;
  });
}

function bindCosmeticsUi() {
  cosmeticsBtn?.addEventListener('click', () => {
    showCosmeticsOverlay();
  });
  cosmeticsMenuBtn?.addEventListener('click', () => {
    showCosmeticsOverlay();
  });
  cosmeticsCloseBtn?.addEventListener('click', () => {
    hideCosmeticsOverlay();
  });
  cosmeticsOverlay?.addEventListener('click', (e) => {
    if (e.target === cosmeticsOverlay) {
      hideCosmeticsOverlay();
    }
  });

  cosmeticsStyleInfoBtn?.addEventListener('click', (e) => {
    e?.preventDefault?.();
    cosmeticsEarnExpanded = !cosmeticsEarnExpanded;
    syncCosmeticsUi();
    try {
      cosmeticsEarnStyleEl?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    } catch {}
  });

  cosmeticsFilterAllBtn?.addEventListener('click', () => cosmeticsSetFilter('all'));
  cosmeticsFilterOwnedBtn?.addEventListener('click', () => cosmeticsSetFilter('owned'));
  cosmeticsFilterAvailableBtn?.addEventListener('click', () => cosmeticsSetFilter('available'));
}

function addToast(icon, text, variant, subtext, action) {
  if (!eventToastsEl) return;
  const now = performance.now();
  let v = String(variant || '');
  if (v === 'big' && now < bigToastCooldownUntil) v = '';

  let st = subtext;
  let act = action;
  if (!act && st && typeof st === 'object') {
    act = st;
    st = '';
  }

  // J20: ключ не включает вариант. Раньше `v` даунгрейдился с 'big' на '' при
  // активном кулдауне, из-за чего одно событие получало два разных ключа и
  // вместо счётчика «x2» появлялся второй тост.
  const key = String(act?.key || `${String(icon || '')}|${String(text || '')}|${String(st || '')}`);
  const prio = String(act?.prio || (String(variant || '') === 'big' ? 'important' : 'minor'));

  const prev = toastByKey.get(key);
  if (prev && prev.el) {
    prev.at = now;
    prev.count = (prev.count || 1) + 1;
    if (toastPrioValue(prio) > toastPrioValue(prev.prio)) prev.prio = prio;
    try {
      const bt = String(prev.baseText || prev.text || '');
      if (prev.textEl) prev.textEl.textContent = `${bt} x${prev.count}`;
      toastBump(prev.el);
      if (prev.timer) clearTimeout(prev.timer);
      prev.timer = setTimeout(() => {
        try {
          prev.el?.remove?.();
        } catch {}
        toastByKey.delete(key);
        toastDrain();
      }, (prev.variant || v) === 'big' ? 8200 : 2200);
    } catch {}
    return;
  }

  if (prev && !prev.el) {
    prev.at = now;
    prev.count = (prev.count || 1) + 1;
    if (toastPrioValue(prio) > toastPrioValue(prev.prio)) prev.prio = prio;
    return;
  }

  const item = {
    key,
    icon,
    text: String(text || ''),
    baseText: String(text || ''),
    variant: v,
    prio,
    subtext: String(st || ''),
    action: act,
    at: now,
    count: 1,
    el: null,
    textEl: null,
    timer: 0,
  };

  toastByKey.set(key, item);
  if (eventToastsEl.children.length >= MAX_EVENT_TOASTS) {
    // J19: важное событие вытесняет самый незначительный тост на экране.
    const worst = toastLowestMounted();
    if (worst && toastPrioValue(item.prio) > toastPrioValue(worst.prio)) {
      toastUnmount(worst);
      toastMount(item);
      return;
    }
    toastQueue.push(key);
    return;
  }

  toastMount(item);
  return;
}

function pushEventFeed(text, kind) {
  const t = performance.now();
  const s = String(text || '').trim();
  if (!s) return;
  const k = String(kind || '');
  eventFeed.unshift({ t, text: s, k });
  if (eventFeed.length > 64) eventFeed.length = 64;
}

// K7: флаг «киллфид нужно перерисовать» — выставляется в цикле разбора
// событий, гасится один раз в конце пакета.
let killfeedDirty = false;

function renderKillfeed() {
  if (!killfeedEl) return;
  const now = performance.now();
  const small = window.innerWidth <= 720;
  const maxAge = small ? 8000 : 12000;
  const maxLines = small ? 4 : 6;
  const lines = eventFeed
    .filter((e) => now - e.t < maxAge)
    .slice(0, maxLines)
    .map((e) => {
      const div = document.createElement('div');
      const k = String(e?.k || '').trim();
      div.className = k ? `killLine killLine${k}` : 'killLine';
      div.textContent = e.text;
      return div;
    });
  killfeedEl.replaceChildren(...lines);

  try {
    if (rightEventsDetailsEl && !rightEventsDetailsEl.open && lines.length) {
      if (!renderKillfeed._u || now - renderKillfeed._u > 1200) {
        renderKillfeed._u = now;
        eventsUnreadCount = Math.min(999, eventsUnreadCount + 1);
        setBadgeCount(rightEventsBadgeEl, eventsUnreadCount);
      }
    }
  } catch {}
  try {
    syncRightEmptyStates();
  } catch {}
}

renderKillfeed._u = 0;

function renderMetaHud() {
  if (!metaHudEl) return;
  const addRow = (rows, label, value, urgent) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    rows.push({ label, value: v, urgent: !!urgent });
  };

  const addProgressRow = (rows, label, p, leftText, rightText, urgent) => {
    const pct = Number(p);
    if (!Number.isFinite(pct)) return;
    const lt = String(leftText || '').trim();
    const rt = String(rightText || '').trim();
    const vv = lt && rt ? `${lt} • ${rt}` : lt || rt;
    rows.push({
      label,
      value: vv,
      urgent: !!urgent,
      progress: Math.max(0, Math.min(1, pct / 100)),
      progressRight: vv,
    });
  };

  const buildSection = (title, rows) => {
    const sec = document.createElement('div');
    sec.className = 'metaSection';
    const t = document.createElement('div');
    t.className = 'metaSectionTitle';
    t.textContent = title;
    sec.appendChild(t);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = r.urgent ? 'metaRow metaRowUrgent' : 'metaRow';
      if (typeof r.progress === 'number') {
        row.className += ' metaRowProgress';
        row.style.setProperty('--p', String(r.progress));
      }
      const l = document.createElement('span');
      l.className = 'metaLabel';
      l.textContent = `${r.label}:`;
      const v = document.createElement('span');
      v.className = 'metaValue';
      v.textContent = typeof r.progressRight === 'string' && r.progressRight ? r.progressRight : r.value;
      row.appendChild(l);
      row.appendChild(v);
      sec.appendChild(row);
    }
    return sec;
  };

  const me = lastState?.players?.find?.((p) => p.n === you) || null;
  const cells = Number(me?.s) || 0;
  const pct = mapCells ? (cells / mapCells) * 100 : 0;

  // F17: в первом матче мета-системы открываются по одной (см. OB_STAGES).
  const obBonus = obUnlocked('bonus');
  const obKills = obUnlocked('bounty');
  const obDaily = obSecondMatchPlus();

  const matchRows = [];
  if (mutatorType && obBonus) {
    const mt = mutatorLabel(mutatorType);
    const rem = formatTickRemain(mutatorUntil);
    if (mt) {
      const sec = tickRemainSeconds(mutatorUntil);
      addRow(matchRows, infoPack().labels.round, rem ? `${mt} (${rem})` : mt, sec != null && sec <= 6);
    }
  }
  if (bountyTarget && obKills) {
    const bn = nameById.get(bountyTarget) || String(bountyTarget);
    const rem = formatTickRemain(bountyUntil);
    const sec = tickRemainSeconds(bountyUntil);
    addRow(matchRows, infoPack().labels.bounty, rem ? `${bn} (${rem})` : bn, sec != null && sec <= 6);
  }

  const fightRows = [];
  if (obKills) {
    addRow(fightRows, t('meta.kills'), String(youKills));
    if (youStreak >= 2) addRow(fightRows, t('meta.streak'), `x${youStreak}`);
  }
  const buffs = [];
  if (youShield && obBonus) buffs.push(infoName(infoPack().powerups, 1, powerupLabel(1)));
  if (obBonus && youSpeedUntilTick && lastEventsTick && youSpeedUntilTick > lastEventsTick) {
    const rem = formatTickRemain(youSpeedUntilTick);
    const tpe = youSpeedType === 4 ? 4 : 2;
    const dash = infoName(infoPack().powerups, tpe, powerupLabel(tpe));
    buffs.push(rem ? `${dash} (${rem})` : dash);
  }
  if (buffs.length) addRow(fightRows, infoPack().labels.buffs, buffs.join(' • '));

  const mainRows = [];
  addRow(mainRows, t('hud.objective'), t('hud.objective_capture'));
  if (started && lastState) addProgressRow(mainRows, t('match.zone'), pct, String(cells), `${pct.toFixed(1)}%`);
  if (matchEndTick) {
    const rem = formatTickRemain(matchEndTick);
    const sec = tickRemainSeconds(matchEndTick);
    addRow(mainRows, t('meta.until_end'), rem || '—', sec != null && sec <= 10);
  }
  // I6: контракт живёт только в чипе #topHudContract. Третья копия здесь
  // (плюс копия в строке таймера) просто съедала место в HUD.
  // Стиль как валюта имеет смысл только вместе с контрактом, который его даёт.
  if (youStyle && obUnlocked('contract')) addRow(mainRows, infoPack().labels.style, String(youStyle));

  // Ежедневки — со второго матча: в первом они только добавляют шума.
  const dailyRows = [];
  if (obDaily) {
    if (youDaily1Type) addRow(dailyRows, dailyLabel(youDaily1Type), `${youDaily1Prog}/${youDaily1Goal}`);
    if (youDaily2Type) addRow(dailyRows, dailyLabel(youDaily2Type), `${youDaily2Prog}/${youDaily2Goal}`);
  }

  const detailSections = [];
  const addDetailSection = (title, rows) => {
    if (!rows.length) return;
    detailSections.push({ title, rows });
  };
  addDetailSection(t('right.match'), matchRows);
  addDetailSection(t('meta.fight'), fightRows);
  addDetailSection(t('meta.tasks'), dailyRows);

  if (!mainRows.length && !detailSections.length) {
    metaHudEl.textContent = '';
    metaHudEl.style.display = 'none';
    return;
  }

  metaHudEl.style.display = '';
  const frag = document.createDocumentFragment();
  if (mainRows.length) {
    frag.appendChild(buildSection(t('hud.objective'), mainRows));
  }

  if (detailSections.length) {
    const det = document.createElement('details');
    det.className = 'metaDetails';

    const sum = document.createElement('summary');
    sum.className = 'metaDetailsSummary';
    sum.textContent = t('meta.details');
    det.appendChild(sum);

    for (const s of detailSections) {
      det.appendChild(buildSection(s.title, s.rows));
    }
    frag.appendChild(det);
  }
  metaHudEl.replaceChildren(frag);

  try {
    syncRightEmptyStates();
  } catch {}
}

function renderTeamHud() {
  if (!teamHudEl) return;
  if (!started || !lastState) {
    teamHudEl.textContent = '';
    try {
      syncRightEmptyStates();
    } catch {}
    return;
  }
  const ordered = computeTopSorted(lastState.players);
  const meIndex = ordered.findIndex((p) => p.n === you);
  const me = meIndex >= 0 ? ordered[meIndex] : null;
  const cells = Number(me?.s) || 0;
  const pct = mapCells ? (cells / mapCells) * 100 : 0;
  const place = meIndex >= 0 ? `${meIndex + 1}/${ordered.length}` : '—';

  const small = window.innerWidth <= 720;
  const maxRows = small ? 10 : 12;
  const topN = ordered.slice(0, maxRows);

  const rows = topN
    .map((p, i) => {
      const pid = String(p.n);
      const nm = p.nm || String(p.n);
      const isMe = p.n === you;
      const pp = mapCells ? ((Number(p.s) || 0) / mapCells) * 100 : 0;
      const fr = Number(p.cosFrame) || 0;
      const frClass = `frame${Math.max(0, Math.min(7, fr))}`;
      return `
        <tr class="${isMe ? 'me' : ''} ${frClass}" data-pid="${pid}">
          <td class="num">${i + 1}</td>
          <td class="name">${playerTitleHtml(cosTitleByPlayer.get(p.n) || 0)}${escapeHtml(nm)}</td>
          <td class="num">${Number(p.p) || 0}</td>
          <td class="num">${pp.toFixed(1)}%</td>
        </tr>
      `;
    })
    .join('');

  setSafeHtml(
    teamHudEl,
    `
    <div class="metaSection">
      <div class="metaSectionTitle">${escapeHtml(t('right.team'))}</div>
      <div class="metaRow"><span class="metaLabel">${escapeHtml(t('death.place'))}:</span><span class="metaValue">${escapeHtml(place)}</span></div>
      <div class="metaRow"><span class="metaLabel">${escapeHtml(t('death.points'))}:</span><span class="metaValue">${escapeHtml(String(Number(me?.p) || 0))}</span></div>
    </div>
    <div class="metaSection">
      <div class="metaSectionTitle">${escapeHtml(t('death.top'))}</div>
      <table class="teamTable">
        <thead>
          <tr>
            <th class="num">#</th>
            <th class="name">${escapeHtml(t('lb.player'))}</th>
            <th class="num">${escapeHtml(t('death.points'))}</th>
            <th class="num">${escapeHtml(t('match.zone'))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `
  );
}

// ...

function handleStateBinary(buf) {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 1) return;
  try {
    const dv = new DataView(buf);
    const bl = dv.byteLength;
    let o = 0;
    const msgType = dv.getUint8(o);
    o += 1;

  // legacy full state (1) is no longer used for minimap; server primarily sends ROI (2) + minimap chunks (4)
  if (msgType === 1) {
    if (o + 1 + 4 + 2 > bl) return;
    const full = dv.getUint8(o) === 1;
    o += 1;
    const tick = dv.getUint32(o, true);
    o += 4;
    const pc = dv.getUint16(o, true);
    o += 2;

    const perPlayerV4 = 21;
    const perPlayerV3 = 20;
    const perPlayerV2 = 15;
    const perPlayerV1 = 14;
    let perPlayer = perPlayerV4;
    if (o + pc * perPlayerV4 + 4 + 4 > bl) {
      perPlayer = perPlayerV3;
    }
    if (o + pc * perPlayer + 4 + 4 > bl) {
      perPlayer = perPlayerV2;
      if (o + pc * perPlayerV2 + 4 + 4 > bl) {
        perPlayer = perPlayerV1;
        if (o + pc * perPlayerV1 + 4 + 4 > bl) return;
      }
    }

    const players = [];
    for (let k = 0; k < pc; k++) {
      const n = dv.getUint16(o, true);
      o += 2;
      const x = dv.getUint16(o, true);
      o += 2;
      const y = dv.getUint16(o, true);
      o += 2;
      const d = dv.getUint8(o);
      o += 1;
      const a = dv.getUint8(o) === 1;
      o += 1;
      const s = dv.getUint16(o, true);
      o += 2;
      const p = dv.getUint16(o, true);
      o += 2;
      const hue = dv.getUint16(o, true);
      o += 2;
      let sh = 0;
      let bot = 0;
      let cosCaptureFx = 0;
      let cosHead = 0;
      let cosSeg = 0;
      let cosNameplate = 0;
      let cosFrame = 0;
      if (perPlayer === perPlayerV2 || perPlayer === perPlayerV3) {
        sh = dv.getUint8(o);
        o += 1;
      }
      if (perPlayer === perPlayerV4) {
        sh = dv.getUint8(o);
        o += 1;
      }
      if (perPlayer === perPlayerV4) {
        bot = dv.getUint8(o);
        o += 1;
      }
      if (perPlayer === perPlayerV3 || perPlayer === perPlayerV4) {
        cosCaptureFx = dv.getUint8(o);
        o += 1;
        cosHead = dv.getUint8(o);
        o += 1;
        cosSeg = dv.getUint8(o);
        o += 1;
        cosNameplate = dv.getUint8(o);
        o += 1;
        cosFrame = dv.getUint8(o);
        o += 1;
      }
      const c = hueToHsl(hue);
      if (bot) botIds.add(n);
      players.push({
        n,
        x,
        y,
        d: DIR_NAMES[d] || 'right',
        a,
        c,
        s,
        p,
        sh,
        cosCaptureFx,
        cosHead,
        cosSeg,
        cosNameplate,
        cosFrame,
        nm: nameById.get(n) || (bot ? botDisplayName(n) : `Игрок ${n}`),
        b: 0
      });
    }

    const len1 = dv.getUint32(o, true);
    o += 4;
    const len2 = dv.getUint32(o, true);
    o += 4;
    if (o + len1 + len2 > bl) return;
    if (full) {
      const grid = buf.slice(o, o + len1);
      o += len1;
      const trail = buf.slice(o, o + len2);
      minimapGridOwner = new Uint16Array(grid);
      minimapDirty = true;
      onState({ full: true, tick, t: Date.now(), players, grid, trail });
      return;
    }
    const dg = buf.slice(o, o + len1);
    o += len1;
    const dt = buf.slice(o, o + len2);
    onState({ full: false, tick, t: Date.now(), players, dg, dt });
    return;
  }

  // ROI update: type(1)=2, tick(4), players, rx/ry/rw/rh, dg, dt
  if (msgType === 2) {
    if (o + 4 + 2 > bl) return;
    const tick = dv.getUint32(o, true);
    o += 4;
    const pc = dv.getUint16(o, true);
    o += 2;

    const perPlayerV4 = 21;
    const perPlayerV3 = 20;
    const perPlayerV2 = 15;
    const perPlayerV1 = 14;
    let perPlayer = perPlayerV4;
    // players + rx/ry/rw/rh (8) + lenDG/lenDT (8)
    if (o + pc * perPlayerV4 + 8 + 8 > bl) perPlayer = perPlayerV3;
    if (o + pc * perPlayer + 8 + 8 > bl) {
      perPlayer = perPlayerV2;
      if (o + pc * perPlayerV2 + 8 + 8 > bl) {
        perPlayer = perPlayerV1;
        if (o + pc * perPlayerV1 + 8 + 8 > bl) return;
      }
    }
    const players = [];
    for (let k = 0; k < pc; k++) {
      const n = dv.getUint16(o, true);
      o += 2;
      const x = dv.getUint16(o, true);
      o += 2;
      const y = dv.getUint16(o, true);
      o += 2;
      const d = dv.getUint8(o);
      o += 1;
      const a = dv.getUint8(o) === 1;
      o += 1;
      const s = dv.getUint16(o, true);
      o += 2;
      const p = dv.getUint16(o, true);
      o += 2;
      const hue = dv.getUint16(o, true);
      o += 2;
      let sh = 0;
      let bot = 0;
      let cosCaptureFx = 0;
      let cosHead = 0;
      let cosSeg = 0;
      let cosNameplate = 0;
      let cosFrame = 0;
      if (perPlayer === perPlayerV2 || perPlayer === perPlayerV3) {
        sh = dv.getUint8(o);
        o += 1;
      }
      if (perPlayer === perPlayerV4) {
        sh = dv.getUint8(o);
        o += 1;
      }
      if (perPlayer === perPlayerV4) {
        bot = dv.getUint8(o);
        o += 1;
      }
      if (perPlayer === perPlayerV3 || perPlayer === perPlayerV4) {
        cosCaptureFx = dv.getUint8(o);
        o += 1;
        cosHead = dv.getUint8(o);
        o += 1;
        cosSeg = dv.getUint8(o);
        o += 1;
        cosNameplate = dv.getUint8(o);
        o += 1;
        cosFrame = dv.getUint8(o);
        o += 1;
      }
      const c = hueToHsl(hue);
      if (bot) botIds.add(n);
      players.push({
        n,
        x,
        y,
        d: DIR_NAMES[d] || 'right',
        a,
        c,
        s,
        p,
        sh,
        cosCaptureFx,
        cosHead,
        cosSeg,
        cosNameplate,
        cosFrame,
        nm: nameById.get(n) || (bot ? botDisplayName(n) : `Игрок ${n}`),
        b: 0
      });
    }
    const rx = dv.getUint16(o, true);
    o += 2;
    const ry = dv.getUint16(o, true);
    o += 2;
    const rw = dv.getUint16(o, true);
    o += 2;
    const rh = dv.getUint16(o, true);
    o += 2;
    const lenDG = dv.getUint32(o, true);
    o += 4;
    const lenDT = dv.getUint32(o, true);
    o += 4;
    if (o + lenDG + lenDT > bl) return;
    const dg = buf.slice(o, o + lenDG);
    o += lenDG;
    const dt = buf.slice(o, o + lenDT);
    onState({ full: false, tick, t: Date.now(), players, dg, dt, roi: { rx, ry, rw, rh } });
    return;
  }

  // Minimap chunks: type(1)=4, tick(4), cw(1), ch(1), count(2), chunks...
  if (msgType === 4) {
    if (o + 4 + 1 + 1 + 2 + 1 > bl) return;
    o += 4;
    const cw = dv.getUint8(o);
    o += 1;
    const ch = dv.getUint8(o);
    o += 1;
    if (!cw || !ch) return;
    const count = dv.getUint16(o, true);
    o += 2;
    const flags = dv.getUint8(o);
    o += 1;
    const hasTrail = (flags & 1) === 1;
    const chunkCells = cw * ch;
    for (let k = 0; k < count; k++) {
      const bytesChunk = 2 + chunkCells * 2 + (hasTrail ? chunkCells * 2 : 0);
      if (o + bytesChunk > bl) return;
      const cx = dv.getUint8(o);
      o += 1;
      const cy = dv.getUint8(o);
      o += 1;
      const x0 = cx * cw;
      const y0 = cy * ch;
      for (let n = 0; n < chunkCells; n++) {
        const v = dv.getUint16(o, true);
        o += 2;
        const xx = n % cw;
        const yy = (n / cw) | 0;
        const i = (y0 + yy) * W + (x0 + xx);
        if (i >= 0 && i < N && minimapGridOwner) minimapGridOwner[i] = v;
      }
      if (hasTrail) {
        for (let n = 0; n < chunkCells; n++) {
          o += 2;
        }
      }

      // update pixels for this chunk only
      for (let yy = 0; yy < ch; yy++) {
        const row = (y0 + yy) * W + x0;
        for (let xx = 0; xx < cw; xx++) {
          const i = row + xx;
          if (i >= 0 && i < N) setMinimapPixel(i);
        }
      }
    }
    minimapHadChunkUpdate = true;
    return;
  }

  if (msgType === 5) {
    const need = (n) => o+n <= bl;
    if (!need(4 + 1 + 4 + 2 + 4 + 1)) return;
    const tick = dv.getUint32(o, true);
    o += 4;

    lastEventsTick = tick;
    lastEventsAt = Date.now();

    mutatorType = dv.getUint8(o);
    o += 1;
    mutatorUntil = dv.getUint32(o, true);
    o += 4;

    bountyTarget = dv.getUint16(o, true);
    o += 2;
    bountyUntil = dv.getUint32(o, true);
    o += 4;

    const puCount = dv.getUint8(o);
    o += 1;
    const nextPU = new Map();
    if (!need(puCount * 11 + 2)) return;
    for (let k = 0; k < puCount; k++) {
      const id = dv.getUint16(o, true);
      o += 2;
      const type = dv.getUint8(o);
      o += 1;
      const x = dv.getUint16(o, true);
      o += 2;
      const y = dv.getUint16(o, true);
      o += 2;
      const expires = dv.getUint32(o, true);
      o += 4;
      nextPU.set(id, { id, type, x, y, expires });
    }
    powerUps = nextPU;

    const evCount = dv.getUint16(o, true);
    o += 2;
    for (let k = 0; k < evCount; k++) {
      if (!need(1)) return;
      const kind = dv.getUint8(o);
      o += 1;

      if (kind === 1) {
        if (!need(9)) return;
        const victim = dv.getUint16(o, true);
        o += 2;
        const killer = dv.getUint16(o, true);
        o += 2;
        const reason = dv.getUint8(o);
        o += 1;
        const ex = dv.getUint16(o, true);
        o += 2;
        const ey = dv.getUint16(o, true);
        o += 2;
        const vn = nameById.get(victim) || String(victim);
        const kn = killer ? nameById.get(killer) || String(killer) : '';

        if (victim === you) {
          lastDeathInfo = { killer, killerName: kn, reason };
        }

        const rs =
          reason === 1
            ? t('death.reason.cut')
            : reason === 2
              ? t('death.reason.headon')
              : reason === 3
                ? t('death.reason.selftrail')
                : reason === 4
                  ? t('death.reason.wall')
                  : '';
        // Эффект гибели жертвы — его видят все, а не только убийца.
        // Стиль берём из cosExtra; без сообщения это базовая вспышка (0).
        addFxBurst(ex, ey, `die${cosClampId(cosDeathByPlayer.get(victim) || 0)}`, {
          pid: victim,
          life: COS_DEATH_MS
        });

        if (killer) pushEventFeed(`${kn} -> ${vn}${rs ? ` (${rs})` : ''}`, 'Kill');
        else pushEventFeed(`${vn} ${lang === 'en' ? 'died' : 'погиб'}${rs ? ` (${rs})` : ''}`, 'Death');

        if (killer && killer === you) {
          youKills++;
          addFxBurst(ex, ey, 'kill');
          addShakeClass('medium', ...shakeDirFrom(ex, ey));
          sfx.kill();
          fxFlashScreen([255, 96, 96], 0.75);
          comboBump();
          // K5: первое убийство — открываем контракты.
          obFireEvent('kill');
        }
        if (victim === you) {
          // J2: отклик на собственную смерть — не на чужую.
          addShakeClass('large', ...shakeDirFrom(ex, ey));
          fxFlashScreen([255, 80, 80], 1);
          comboBreak();
          // K5: первая смерть — теперь понятно, зачем баунти и киллы.
          obFireEvent('death');
        }
        killfeedDirty = true;
        continue;
      }

      if (kind === 19) {
        if (!need(2 + 2 + 2 + 4 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const ex = dv.getUint16(o, true);
        o += 2;
        const ey = dv.getUint16(o, true);
        o += 2;
        const delta = dv.getUint32(o, true);
        o += 4;
        const fxId = dv.getUint8(o);
        o += 1;
        const pn = nameById.get(pid) || String(pid);
        pushEventFeed(`${pn} ${lang === 'en' ? 'captured' : 'захватил'} +${delta} ${lang === 'en' ? 'zone' : 'зоны'}`, 'Capture');
        addFxBurst(ex, ey, `cap${Math.max(0, Math.min(7, Number(fxId) || 0))}`, { pid });
        if (pid === you) {
          // J5: самое частое приятное действие теперь показывает число.
          addScorePopup(ex, ey, delta);
          comboBump();

          const jackpot = delta >= CAPTURE_JACKPOT_CELLS;
          if (jackpot) {
            addShakeClass('large', ...shakeDirFrom(ex, ey));
            fxFlashScreen([255, 215, 120], 1);
            // J12: 140 мс на самом жирном событии игры.
            triggerHitstop(140);
            sfx.jackpot();
            bumpMatchTabBadge();
            if (!showBigBanner('💎', t('banner.jackpot'), `+${fmtInt(delta)} · ${t('banner.jackpot_sub')}`, 'jackpot')) {
              addToast('💎', `${t('banner.jackpot')} +${fmtInt(delta)}`, 'big', t('banner.jackpot_sub'), {
                tab: 'match',
                key: 'capture_jackpot',
                prio: 'jackpot'
              });
            }
          } else {
            addShakeClass('small', ...shakeDirFrom(ex, ey));
            // J17: раньше захват меньше 40 клеток звучал как ничто.
            if (delta >= 40) sfx.captureBig();
            else sfx.captureSmall();
          }

          celebrateFirstCapture(delta);
          // K5: первый захват — момент, когда про бонусы уже есть смысл рассказать.
          obFireEvent('capture');
        }
        killfeedDirty = true;
        continue;
      }

      // F5 «Реклейм»: игрок вернул свою остывающую территорию.
      // A=игрок, B=клетки, X/Y=точка возврата. Без разбора этого kind весь
      // остаток пакета событий терялся бы (парсер ломается на неизвестном kind).
      if (kind === 20) {
        if (!need(2 + 2 + 2 + 2)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const cells = dv.getUint16(o, true);
        o += 2;
        const ex = dv.getUint16(o, true);
        o += 2;
        const ey = dv.getUint16(o, true);
        o += 2;
        const pn = nameById.get(pid) || String(pid);
        pushEventFeed(`${pn} ${lang === 'en' ? 'reclaimed' : 'вернул'} +${cells}`, 'Reclaim');
        addFxBurst(ex, ey, `cap${cosClampId(cosCaptureFxByPlayer(pid))}`, { pid });
        if (pid === you && cells > 0) {
          addScorePopup(ex, ey, cells);
          // F5: возврат своей земли должен читаться иначе, чем обычный захват —
          // это отыгранная назад потеря, а не прирост.
          addFxBurst(ex, ey, 'reclaim', { life: 900 });
          addShakeClass(cells >= 120 ? 'medium' : 'small', ...shakeDirFrom(ex, ey));
          fxFlashScreen([120, 220, 255], Math.min(1, 0.35 + cells / 400));
          sfx.bountyClaimed();
          addToast('♻', t('reclaim.toast'), cells >= 120 ? 'big' : '', `+${fmtInt(cells)} · ${t('reclaim.toast_desc')}`, {
            key: 'reclaim',
            prio: cells >= 120 ? 'jackpot' : 'important'
          });
          if (cells >= 120) triggerHitstop(110);
        }
        coolDeadlineByOwner.delete(pid);
        continue;
      }

      // F5 «Реклейм»: EventCoolBatch (21) — территория погибшего пошла остывать.
      // A=бывший владелец, B=клетки, C=тик окончательного исчезновения.
      // Даёт честное время истечения вместо клиентской оценки по первому кадру.
      if (kind === 21) {
        if (!need(2 + 2 + 4)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const cells = dv.getUint16(o, true);
        o += 2;
        const untilTick = dv.getUint32(o, true);
        o += 4;
        if (cells > 0) {
          const nt = approxNowTick();
          const remMs = nt != null && tickMs ? Math.max(0, (untilTick - nt) * tickMs) : RECLAIM_WINDOW_MS;
          coolDeadlineByOwner.set(pid, performance.now() + Math.min(RECLAIM_WINDOW_MS * 1.5, remMs));
        }
        continue;
      }

      if (kind === 15) {
        if (!need(2 + 1 + 2 + 4)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const slot = dv.getUint8(o);
        o += 1;
        const goal = dv.getUint16(o, true);
        o += 2;
        const packed = dv.getUint32(o, true);
        o += 4;
        // K7: раньше здесь объявлялась `const t`, перекрывавшая функцию перевода
        // на весь блок. Переименовано в `type`.
        const type = (packed >>> 16) & 0xffff;
        const prog = packed & 0xffff;
        if (pid === you) {
          if (slot === 1) {
            youDaily1Type = type;
            youDaily1Goal = goal;
            youDaily1Prog = prog;
          } else {
            youDaily2Type = type;
            youDaily2Goal = goal;
            youDaily2Prog = prog;
          }
          bumpMatchTabBadge();
          // J16: назначение ежедневки было беззвучным.
          sfx.dailyAssigned();
          addToast('📅', `${infoPack().labels.daily}: ${dailyLabel(type)}`, 'big', infoDesc(infoPack().dailies, type, ''), { tab: 'match', key: `daily_assign_${type}`, prio: 'important' });
        }
        continue;
      }

      if (kind === 16) {
        if (!need(2 + 1 + 2)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const slot = dv.getUint8(o);
        o += 1;
        const prog = dv.getUint16(o, true);
        o += 2;
        if (pid === you) {
          if (slot === 1) youDaily1Prog = prog;
          else youDaily2Prog = prog;
        }
        continue;
      }

      if (kind === 17) {
        if (!need(2 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const slot = dv.getUint8(o);
        o += 1;
        if (pid === you) {
          bumpMatchTabBadge();
          addToast('🏁', infoPack().labels.dailyComplete, 'big', '', { tab: 'match', key: 'daily_complete', prio: 'important' });
          sfx.dailyDone();
          comboBump();
        }
        continue;
      }

      if (kind === 18) {
        if (!need(2 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const achv = dv.getUint8(o);
        o += 1;
        const pn = nameById.get(pid) || String(pid);
        pushEventFeed(`${pn} — ${infoPack().labels.achievement}: ${achvLabel(achv)}`, 'Achv');
        if (pid === you) {
          bumpMatchTabBadge();
          sfx.achievement();
          fxFlashScreen([255, 225, 150], 0.8);
          triggerHitstop(90);
          // J13: ачивка идёт в центральный баннер, а не тонет за тремя мелкими тостами.
          if (!showBigBanner('🏅', achvLabel(achv), infoDesc(infoPack().achv, achv, ''), 'jackpot')) {
            addToast('🏅', `${infoPack().labels.achievement}: ${achvLabel(achv)}`, 'big', infoDesc(infoPack().achv, achv, ''), { tab: 'match', key: `achv_${achv}`, prio: 'jackpot' });
          }
        }
        killfeedDirty = true;
        continue;
      }

      if (kind === 10) {
        if (!need(2 + 1 + 2 + 4)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const goal = dv.getUint16(o, true);
        o += 2;
        const until = dv.getUint32(o, true);
        o += 4;
        const pn = nameById.get(pid) || String(pid);
        pushEventFeed(`${pn} — ${infoPack().labels.contract}: ${contractLabel(type) || type} ${goal}`, 'Contract');
        if (pid === you) {
          youContractType = type;
          youContractGoal = goal;
          youContractProgress = 0;
          youContractUntil = until;
          bumpMatchTabBadge();
          // J16: назначение контракта было беззвучным.
          sfx.contractAssigned();
          addToast('📜', `${infoPack().labels.contract}: ${contractLabel(type) || type}`, 'big', infoDesc(infoPack().contracts, type, ''), { tab: 'match', key: `contract_assign_${type}`, prio: 'important' });
        }
        killfeedDirty = true;
        continue;
      }

      if (kind === 11) {
        if (!need(2 + 1 + 2)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const prog = dv.getUint16(o, true);
        o += 2;
        if (pid === you) {
          youContractType = type;
          youContractProgress = prog;
        }
        continue;
      }

      if (kind === 12) {
        if (!need(2 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const pn = nameById.get(pid) || String(pid);
        pushEventFeed(`${pn} — ${infoPack().labels.contractComplete}: ${contractLabel(type) || type}`, 'Contract');
        if (pid === you) {
          youContractProgress = youContractGoal;
          bumpMatchTabBadge();
          addToast('✅', `${infoPack().labels.contractComplete}: ${contractLabel(type) || type}`, 'big', infoDesc(infoPack().contracts, type, ''), { tab: 'match', key: `contract_complete_${type}`, prio: 'important' });
          sfx.contractDone();
          comboBump();
        }
        killfeedDirty = true;
        continue;
      }

      if (kind === 13) {
        if (!need(2 + 2 + 4 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const delta = dv.getUint16(o, true);
        o += 2;
        const total = dv.getUint32(o, true);
        o += 4;
        const reason = dv.getUint8(o);
        o += 1;
        const pn = nameById.get(pid) || String(pid);
        pushEventFeed(`${pn} +${delta} ${t('cosmetics.style_points')} (${styleLabel(reason)})`, 'Style');
        if (pid === you) {
          if (delta > 0) matchStyleEarned += delta;
          setYouStyle(total);
          bumpMatchTabBadge();
          if (delta >= 20) {
            if (styleToastTimer) {
              try {
                clearTimeout(styleToastTimer);
              } catch {}
              styleToastTimer = 0;
              styleToastAcc = 0;
              styleToastReason = 0;
              styleToastCount = 0;
            }
            addToast('✨', `+${delta} ${t('cosmetics.style_points')}`, 'big', styleLabel(reason), { tab: 'match', key: `style_${reason}_${delta}` });
          } else if (delta > 0) {
            if (styleToastAcc && styleToastReason && styleToastReason !== reason) {
              flushStyleToast();
            }
            styleToastAcc += delta;
            styleToastReason = reason;
            styleToastCount++;
            if (!styleToastTimer) {
              styleToastTimer = setTimeout(flushStyleToast, 650);
            }
          }
        }
        killfeedDirty = true;
        continue;
      }

      if (kind === 14) {
        if (!need(2 + 2)) return;
        const killer = dv.getUint16(o, true);
        o += 2;
        const victim = dv.getUint16(o, true);
        o += 2;
        const kn = nameById.get(killer) || String(killer);
        const vn = nameById.get(victim) || String(victim);
        pushEventFeed(`${lang === 'en' ? 'REVENGE' : 'МЕСТЬ'}: ${kn} -> ${vn}`, 'Revenge');
        if (killer === you) {
          bumpMatchTabBadge();
          sfx.revenge();
          fxFlashScreen([255, 110, 110], 0.85);
          if (!showBigBanner('😈', t('banner.revenge'), lang === 'en' ? 'A kill in return for your death' : 'Убийство в ответ на вашу смерть', 'danger')) {
            addToast('😈', lang === 'en' ? 'Revenge!' : 'Месть!', 'big', lang === 'en' ? 'A kill in return for your death' : 'Убийство в ответ на вашу смерть', { tab: 'match', key: 'revenge', prio: 'jackpot' });
          }
        }
        killfeedDirty = true;
        continue;
      }

      if (kind === 2) {
        if (!need(2 + 1)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const streak = dv.getUint8(o);
        o += 1;
        const pn = nameById.get(pid) || String(pid);
        pushEventFeed(`${pn} — ${t('event.streak')} x${streak}`, 'Streak');
        if (pid === you) {
          youStreak = streak;
          // J3: раньше бип стоял вне этой проверки — в комнате с 14 ботами
          // получался метроном.
          sfx.streak(Math.max(0, streak - 2));
          if (streak === 3) {
            bumpMatchTabBadge();
            addToast('🔥', `${t('toast.streak')} x${streak}`, null, t('toast.streak_3'), { tab: 'match', key: `streak_${streak}`, prio: 'important' });
          }
          if (streak >= 5) {
            bumpMatchTabBadge();
            fxFlashScreen([255, 170, 90], 0.8);
            if (!showBigBanner('🔥', `${t('banner.streak')} x${streak}`, t('toast.streak_5'), 'jackpot')) {
              addToast('🔥', `${t('toast.streak')} x${streak}`, 'big', t('toast.streak_5'), { tab: 'match', key: `streak_${streak}`, prio: 'jackpot' });
            }
          }
        }
        killfeedDirty = true;
        continue;
      }

      if (kind === 3) {
        if (!need(2 + 4)) return;
        const target = dv.getUint16(o, true);
        o += 2;
        const until = dv.getUint32(o, true);
        o += 4;
        bountyTarget = target;
        bountyUntil = until;
        const tn = nameById.get(target) || String(target);
        pushEventFeed(`${t('event.bounty')}: ${tn}`, 'Bounty');

        bumpMatchTabBadge();
        addToast('🎯', `${infoPack().labels.bounty}: ${tn}`, 'big', t('toast.bounty_desc'), { tab: 'match', key: `bounty_${target}`, prio: target === you ? 'jackpot' : 'important' });
        // J2/J3: назначение баунти — глобальное событие. Полная громкость только
        // если цель — ты, иначе 40%.
        sfx.bountyAssigned(target === you ? 1 : 0.4);
        if (target === you) fxFlashScreen([255, 140, 90], 0.7);
        killfeedDirty = true;
        continue;
      }

      if (kind === 4) {
        if (!need(2 + 2)) return;
        const killer = dv.getUint16(o, true);
        o += 2;
        const victim = dv.getUint16(o, true);
        o += 2;
        const kn = nameById.get(killer) || String(killer);
        const vn = nameById.get(victim) || String(victim);
        pushEventFeed(`${t('event.bounty_claimed')}: ${kn} -> ${vn}`, 'Bounty');

        bumpMatchTabBadge();
        const mineClaim = killer === you;
        addToast('🏆', t('toast.bounty_claim_title'), 'big', t('toast.bounty_claim_desc'), { tab: 'match', key: 'bounty_claim', prio: mineClaim ? 'jackpot' : 'minor' });
        // J2: тряска и полная громкость только тому, кто забрал награду.
        if (mineClaim) {
          sfx.bountyClaimed();
          addShakeClass('large');
          fxFlashScreen([255, 210, 120], 0.9);
          comboBump();
        } else {
          sfx.bountyAssigned(0.4);
        }
        killfeedDirty = true;
        continue;
      }

      if (kind === 5) {
        if (!need(2 + 1 + 2 + 2 + 4)) return;
        const id = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const x = dv.getUint16(o, true);
        o += 2;
        const y = dv.getUint16(o, true);
        o += 2;
        const expires = dv.getUint32(o, true);
        o += 4;
        powerUps.set(id, { id, type, x, y, expires });
        continue;
      }

      if (kind === 6) {
        if (!need(2 + 2 + 1 + 2 + 2)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const id = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const ex = dv.getUint16(o, true);
        o += 2;
        const ey = dv.getUint16(o, true);
        o += 2;
        powerUps.delete(id);
        const pn = nameById.get(pid) || String(pid);
        pushEventFeed(`${pn} ${t('event.picked')}: ${powerupLabel(type)}`, 'Pickup');

        if (pid === you) {
          if (type === 1) youShield = true;
          if (type === 2) {
            youSpeedUntilTick = lastEventsTick + 45;
            youSpeedType = 2;
          }
          if (type === 4) {
            youSpeedUntilTick = lastEventsTick + 95;
            youSpeedType = 4;
          }
          addFxBurst(ex, ey, type === 2 ? 'pickup2' : type === 4 ? 'pickup4' : 'pickup');
          if (type === 2 || type === 4) sfx.speedOn();
          else sfx.pickup();
          addShakeClass('micro', ...shakeDirFrom(ex, ey));
          comboBump();
        }
        killfeedDirty = true;
        continue;
      }

      if (kind === 9) {
        if (!need(2 + 1 + 2 + 2)) return;
        const pid = dv.getUint16(o, true);
        o += 2;
        const type = dv.getUint8(o);
        o += 1;
        const ex = dv.getUint16(o, true);
        o += 2;
        const ey = dv.getUint16(o, true);
        o += 2;
        const pn = nameById.get(pid) || String(pid);
        pushEventFeed(`${pn} ${t('event.used')}: ${powerupLabel(type)}`, 'Use');

        if (pid === you) {
          if (type === 1) youShield = false;
          addFxBurst(ex, ey, 'use');
          addToast(type === 3 ? '💥' : '🛡', `${t('toast.powerup_used')}: ${powerupLabel(type)}`, null, infoDesc(infoPack().powerups, type, ''));
          if (type === 3) {
            sfx.explode();
            fxFlashScreen([255, 150, 90], 0.8);
          } else {
            sfx.powerUsed();
          }
          addShakeClass('medium', ...shakeDirFrom(ex, ey));
        }
        killfeedDirty = true;
        continue;
      }

      if (kind === 7) {
        if (!need(1 + 4)) return;
        const type = dv.getUint8(o);
        o += 1;
        const until = dv.getUint32(o, true);
        o += 4;
        mutatorType = type;
        mutatorUntil = until;
        const mn = mutatorLabel(type);
        if (mn) pushEventFeed(`${t('event.round')}: ${mn}`, 'Round');

        if (mn) addToast('⚡', `${infoPack().labels.round}: ${mn}`, 'big', infoDesc(infoPack().mutators, type, ''), { key: `mutator_${type}`, prio: 'important' });
        // J2: глобальное событие — 40% громкости.
        sfx.mutatorOn(0.4);
        killfeedDirty = true;
        continue;
      }

      if (kind === 8) {
        if (!need(1)) return;
        const type = dv.getUint8(o);
        o += 1;
        if (mutatorType === type) {
          mutatorType = 0;
          mutatorUntil = 0;
        }

        addToast('✓', infoPack().labels.roundEnded, 'big');
        sfx.mutatorOff(0.4);
        continue;
      }

      // Сервер для неизвестного типа события пишет ровно один байт-заглушку
      // (см. default в buildEventsPooledLocked). Пропускаем его и продолжаем
      // разбор: иначе старый закешированный клиент терял бы весь остаток
      // пакета после первого же нового типа события — этот баг в проекте уже
      // случался дважды и молча ломал киллфид, тосты и обновления заданий.
      try {
        console.warn('unknown event kind', kind);
      } catch {}
      if (!need(1)) break;
      o += 1;
      continue;
    }

    // K7: renderKillfeed() звался 13 раз внутри цикла разбора событий (замер:
    // 784 мутации DOM за 115 с). Один пакет — одна перерисовка в конце.
    if (killfeedDirty) {
      killfeedDirty = false;
      renderKillfeed();
    }
    renderMetaHud();
    renderTopHud();
    return;
  }
  } catch (e) {
    console.warn('bad binary state packet', e);
  }
}

function onChatInit(history) {
  chatLog.textContent = '';
  chatMessages.length = 0;
  if (!Array.isArray(history)) return;
  for (const m of history) chatMessages.push(m);
  renderChat();
  chatDirty = false;
  updateChatLayout();
}

function onChat(m) {
  if (!m) return;
  addChatLine(m);
  updateChatHeaderStatus();
}

/* Новые косметические категории приходят отдельным JSON-сообщением, потому что
   бинарный ROI-снапшот остаётся 21-байтным и не расширяется:
   {"players":[{"n":12,"terr":3,"death":1,"title":7}, ...]}
   Сообщения может не быть (старый сервер) — тогда карты пусты и всё рисуется
   базовыми вариантами. */
function onCosExtra(m) {
  const arr = Array.isArray(m?.players) ? m.players : null;
  if (!arr) return;
  cosTerrByPlayer.clear();
  cosDeathByPlayer.clear();
  cosTitleByPlayer.clear();
  for (const it of arr) {
    const n = Number(it?.n);
    if (!Number.isFinite(n)) continue;
    const terr = cosClampId(it?.terr);
    const death = cosClampId(it?.death);
    const title = Math.max(0, Math.min(COS_TITLE_MAX, Number(it?.title) || 0));
    if (terr) cosTerrByPlayer.set(n, terr);
    if (death) cosDeathByPlayer.set(n, death);
    if (title) cosTitleByPlayer.set(n, title);
    if (n === you) {
      youCosEqTerr = terr;
      youCosEqDeath = death;
      youTitleId = title;
    }
  }
  try {
    if (cosmeticsOpen) syncCosmeticsUi();
  } catch {}
}

function onNameUpdate(m) {
  const id = m?.n;
  const nm = m?.nm;
  if (typeof id !== 'number' || typeof nm !== 'string') return;
  // G15: сервер генерирует уникальные шуточные ники ботов — используем их.
  // Свой запасной вариант нужен только когда сервер прислал пустую строку.
  const clean = nm.trim();
  if (clean) {
    nameById.set(id, clean);
  } else if (botIds && botIds.has(id)) {
    nameById.set(id, botDisplayName(id));
  } else {
    return;
  }
  if (chat.classList.contains('collapsed')) {
    chatDirty = true;
    return;
  }
  renderChat();
}

function onRttPong(m) {
  const ts = m?.t;
  if (typeof ts !== 'number') return;
  const now = performance.now();
  pingMs = Math.max(0, now - ts);
}

function onRooms(rooms) {
  roomsLoading = false;
  roomsLoadError = '';
  if (roomsLoadTimeout) {
    clearTimeout(roomsLoadTimeout);
    roomsLoadTimeout = 0;
  }
  if (refreshRoomsBtn) {
    refreshRoomsBtn.disabled = false;
    refreshRoomsBtn.classList.remove('isLoading');
    refreshRoomsBtn.textContent = t('rooms.refresh');
  }
  lastRooms = Array.isArray(rooms) ? rooms : [];
  updateRoomsUi();
}
function onLeft() {
  rejoinRoomId = null;
  rejoinPending = false;
  roomId = null;
  roomLimit = null;
  updateRoomInfo();
  showMenuOverlay();
}

function connectWs() {
  net.connect();
}

setInterval(() => {
  if (!menuOverlay || menuOverlay.classList.contains('hidden')) return;
  if (started) return;
  if (roomsCreateOpen || createRoomPending) return;
  const now = performance.now();
  if (now < roomsAutoRefreshAt) return;
  roomsAutoRefreshAt = now + 5000;
  wsSend('rooms', {});
}, 1200);

function applyPackedDelta(u16, buf) {
  if (!u16 || !buf) return;
  const d = new Uint32Array(buf);
  const len = u16.length;
  for (let k = 0; k < d.length; k++) {
    const v = d[k];
    const i = v >>> 16;
    const o = v & 0xffff;
    if (i < len) u16[i] = o;
  }
}

/* J15 — заливка расходится волной от точки замыкания петли.
   Раньше задержка была `(i * 37) % 170` — псевдослучайный шум, который читался
   как «мигание». Теперь честная дистанция от головы владельца до клетки на 8 мс,
   так что фронт заливки идёт из той точки, где игрок вернулся в свою зону.
   Стоимость — один sqrt на изменённую клетку. */
const FILL_WAVE_MS_PER_CELL = 8;
const FILL_WAVE_MAX_MS = 700;

function fillDelayFor(i, owner) {
  const a = captureAnchorByOwner.get(owner);
  if (!a || !W) return (i * 37) % fillDelayMod;
  const dx = (i % W) - a.x;
  const dy = ((i / W) | 0) - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  return Math.min(FILL_WAVE_MAX_MS, d * FILL_WAVE_MS_PER_CELL);
}

// Головы всех живых игроков в момент прихода снапшота — они же точки замыкания
// для тех, кто именно в этом тике захватил территорию.
function refreshCaptureAnchors(players) {
  if (!Array.isArray(players)) return;
  captureAnchorByOwner.clear();
  for (const p of players) {
    if (!p || !p.a) continue;
    captureAnchorByOwner.set(p.n, { x: Number(p.x) || 0, y: Number(p.y) || 0 });
  }
}

function markCoolSeen(i, raw, now) {
  if (!coolSeenAt) return;
  if (gridCellIsCooling(raw)) {
    if (!coolSeenAt[i]) coolSeenAt[i] = now;
  } else if (coolSeenAt[i]) {
    coolSeenAt[i] = 0;
  }
}

function applyPackedDeltaGridWithAnim(buf, now) {
  if (!gridOwner || !buf || !gridFillAt) return;
  const d = new Uint32Array(buf);
  const len = gridOwner.length;
  for (let k = 0; k < d.length; k++) {
    const v = d[k];
    const i = v >>> 16;
    const o = v & 0xffff;
    if (i >= len) continue;
    const prev = gridOwner[i];
    if (prev !== o) {
      gridOwner[i] = o;
      markCoolSeen(i, o, now);
      // Остывающие клетки (старший бит) не анимируем как свежий захват.
      if (o !== 0 && !gridCellIsCooling(o)) {
        gridFillAt[i] = now + fillDelayFor(i, o);
      }
    }
  }
}

function onState(s) {
  lastState = s;

  // K1: прямоугольник ROI приходил и молча выбрасывался. Он — единственный
  // источник правды о том, какая часть сетки вообще свежая.
  const r = s?.roi;
  if (r && Number(r.rw) > 0 && Number(r.rh) > 0) {
    lastRoi = {
      rx: Math.max(0, Number(r.rx) || 0),
      ry: Math.max(0, Number(r.ry) || 0),
      rw: Number(r.rw) || 0,
      rh: Number(r.rh) || 0
    };
  } else if (s?.full) {
    // Полный снапшот освежает всю карту — тумана в этом кадре нет.
    lastRoi = null;
  }

  const now = performance.now();

  // J15: якоря должны быть готовы до применения дельты сетки — именно в этом
  // снапшоте голова стоит там, где петля замкнулась.
  refreshCaptureAnchors(s.players);

  if (s.full) {
    const prev = gridOwner;
    gridOwner = new Uint16Array(s.grid);
    trailOwner = new Uint16Array(s.trail);
    if (!gridFillAt || gridFillAt.length !== gridOwner.length) gridFillAt = new Float32Array(gridOwner.length);
    if (!coolSeenAt || coolSeenAt.length !== gridOwner.length) coolSeenAt = new Float32Array(gridOwner.length);
    if (prev && prev.length === gridOwner.length) {
      for (let i = 0; i < gridOwner.length; i++) {
        const n = gridOwner[i];
        if (prev[i] !== n) markCoolSeen(i, n, now);
        if (n !== 0 && !gridCellIsCooling(n) && prev[i] !== n) {
          gridFillAt[i] = now + fillDelayFor(i, n);
        }
      }
    } else {
      for (let i = 0; i < gridOwner.length; i++) markCoolSeen(i, gridOwner[i], now);
    }
  } else {
    applyPackedDeltaGridWithAnim(s.dg, now);
    applyPackedDelta(trailOwner, s.dt);
  }

  // minimap is updated by server-sent chunk updates

  const tmpPlayers = prevPlayers;
  prevPlayers = currPlayers;
  currPlayers = tmpPlayers;
  currPlayers.clear();
  let nameChanged = false;
  for (const p of s.players) {
    currPlayers.set(p.n, p);
    // K2: номера игроков переиспользуются (аллокатор отдаёт первый свободный,
    // боты пересоздаются при каждом входе/выходе человека). Кэш «номер → цвет»
    // раньше писался один раз и никогда не обновлялся: номер 7 оставался
    // красным даже после того, как его получил новый синий бот. Сравниваем
    // цвет каждый кадр и сбрасываем зависимые кэши при расхождении.
    if (colors.get(p.n) !== p.c) {
      colors.set(p.n, p.c);
      ownerFillStyleCache.delete(p.n);
      minimapOwnerRgbCache.delete(p.n);
      minimapDirty = true;
    }
    if (p.nm && nameById.get(p.n) !== p.nm) {
      nameById.set(p.n, p.nm);
      nameChanged = true;
    }
  }

  if (nameChanged && chatMessages.length) renderChat();

  headIndexByOwner.clear();
  for (const p of s.players) {
    headIndexByOwner.set(p.n, p.y * W + p.x);
  }

  lastPacketAt = performance.now();

  if (lastStateAt != null) {
    const dt = lastPacketAt - lastStateAt;
    if (dt > 0) tickrate = lerp(tickrate || 0, 1000 / dt, 0.15);
  }
  lastStateAt = lastPacketAt;

  try {
    refreshOwnGeometry(false);
  } catch {}

  const me = s.players?.find((p) => p.n === you);
  if (me) {
    const alive = !!me.a;
    if (alive) {
      const ordered = computeTopSorted(s.players);
      const idx = ordered.findIndex((p) => p.n === you);
      const cells = Number(me?.s) || 0;
      const pct = mapCells ? (cells / mapCells) * 100 : 0;
      const points = Number(me?.p) || 0;
      const place = idx >= 0 ? `${idx + 1}/${ordered.length}` : '—';
      lastYouStats = { cells, pct, points, place };
    }
    if (alive && !youAlive) {
      youAlive = true;
      lastDirSent = null;
      hideOverlays();
    } else if (!alive && youAlive) {
      youAlive = false;
      lastDirSent = null;
      youStreak = 0;
      showDeathOverlay();
    }
  }
}

setInterval(() => {
  updateLeaderboard();
}, 1000);

showMenuOverlay();
connectWs();

function colorWithAlpha(hsl, a) {
  const key = String(hsl);
  let parts = hslPartsCache.get(key);
  if (!parts) {
    const m = key.match(/^hsl\((\d+)\s+(\d+)%\s+(\d+)%\)$/);
    if (!m) return `rgba(255,255,255,${a})`;
    parts = { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
    hslPartsCache.set(key, parts);
  }
  return `hsla(${parts.h} ${parts.s}% ${parts.l}% / ${a})`;
}

function quantizeAlpha(a) {
  const v = Math.max(0, Math.min(1, a));
  return Math.round(v * ALPHA_STEPS);
}

function getOwnerFillStyle(owner, a) {
  const ai = quantizeAlpha(a);
  let arr = ownerFillStyleCache.get(owner);
  if (!arr) {
    arr = new Array(ALPHA_STEPS + 1);
    ownerFillStyleCache.set(owner, arr);
  }
  let s = arr[ai];
  if (s) return s;
  const c = boostHsl(colors.get(owner) || 'hsl(210 20% 60%)');
  const rgb = hslToRgb(c);
  const aa = ai / ALPHA_STEPS;
  s = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${aa})`;
  arr[ai] = s;
  return s;
}

function boostHsl(hsl) {
  const key = String(hsl);
  const cached = boostCache.get(key);
  if (cached) return cached;
  const m = key.match(/^hsl\((\d+)\s+(\d+)%\s+(\d+)%\)$/);
  if (!m) return key;
  const h = Number(m[1]);
  const s = Number(m[2]);
  const l = Number(m[3]);
  const s2 = Math.max(72, Math.min(100, Math.round(s * 1.25)));
  const l2 = Math.max(48, Math.min(74, Math.round(l + 10)));
  const out = `hsl(${h} ${s2}% ${l2}%)`;
  boostCache.set(key, out);
  return out;
}

function hslToRgb(hsl) {
  const cached = rgbCache.get(hsl);
  if (cached) return cached;
  const m = String(hsl).match(/^hsl\((\d+)\s+(\d+)%\s+(\d+)%\)$/);
  if (!m) {
    const fallback = [200, 200, 200];
    rgbCache.set(hsl, fallback);
    return fallback;
  }
  let h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;

  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  let r;
  let g;
  let b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const out = [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  rgbCache.set(hsl, out);
  return out;
}

function drawMinimap() {
  if (!minimapImage || !minimapGridOwner || !lastState) return;
  if (minimapDirty) {
    minimapDirty = false;
    for (let i = 0; i < N; i++) setMinimapPixel(i);
  }

  mmCtx.putImageData(minimapImage, 0, 0);
  minimapHadChunkUpdate = false;

  // I3: на миникарте видны все живые игроки, а не только ты.
  // Свою точку рисуем последней и крупнее (ниже, после рамки обзора).
  for (const p of lastState.players) {
    if (!p.a) continue;
    if (p.n === you) continue;
    if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) continue;
    const c = boostHsl(colors.get(p.n) || p.c || 'hsl(210 20% 60%)');
    const rgb = hslToRgb(c);
    const isBot = botIds.has(p.n);
    const isBounty = !!(bountyTarget && p.n === bountyTarget);

    // Тёмная подложка, чтобы точка читалась на своей же территории.
    mmCtx.fillStyle = 'rgba(0,0,0,0.62)';
    mmCtx.fillRect(p.x - 1, p.y - 1, 3, 3);
    mmCtx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${isBot ? 0.62 : 0.98})`;
    mmCtx.fillRect(p.x, p.y, isBot ? 1 : 2, isBot ? 1 : 2);

    if (isBounty) {
      mmCtx.save();
      mmCtx.strokeStyle = 'rgba(255,90,60,0.95)';
      mmCtx.lineWidth = 1;
      mmCtx.strokeRect(p.x - 2.5, p.y - 2.5, 6, 6);
      mmCtx.restore();
    }
  }

  mmCtx.save();
  mmCtx.lineWidth = 1;
  const w = Math.max(1, viewMaxX - viewMinX + 1);
  const h = Math.max(1, viewMaxY - viewMinY + 1);
  mmCtx.strokeStyle = 'rgba(0,0,0,0.70)';
  mmCtx.lineWidth = 3;
  mmCtx.strokeRect(viewMinX + 0.5, viewMinY + 0.5, w - 1, h - 1);
  mmCtx.strokeStyle = 'rgba(255,255,255,0.90)';
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(viewMinX + 0.5, viewMinY + 0.5, w - 1, h - 1);

  try {
    drawMinimapZones();
  } catch {}

  const me = lastState.players.find((p) => p.n === you && p.a);
  if (me) {
    mmCtx.fillStyle = 'rgba(0,0,0,0.72)';
    mmCtx.fillRect(me.x - 2, me.y - 2, 5, 5);
    mmCtx.fillStyle = 'rgba(255,255,255,0.96)';
    mmCtx.fillRect(me.x - 1, me.y - 1, 3, 3);
    mmCtx.fillStyle = 'rgba(0,0,0,0.70)';
    mmCtx.fillRect(me.x, me.y, 1, 1);
  }
  mmCtx.restore();

  syncMinimapOverlayCanvas();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function formatRate(bps) {
  const v = Number(bps);
  if (!Number.isFinite(v) || v < 0) return '…';
  const kb = v / 1024;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)}MB/s`;
  return `${kb.toFixed(1)}KB/s`;
}

function perfValueSpan(text, bad) {
  const cls = bad ? 'perfBad' : 'perfOk';
  return `<span class="perfValue ${cls}">${text}</span>`;
}

function getInterpPlayer(id, t) {
  const b = currPlayers.get(id);
  if (!b) return null;
  const a = prevPlayers.get(id) || b;
  return {
    ...b,
    ix: lerp(a.x, b.x, t),
    iy: lerp(a.y, b.y, t)
  };
}

function draw() {
  requestAnimationFrame(draw);
  const matchOverlayOpen = !!(matchOverlay && !matchOverlay.classList.contains('hidden'));
  if (matchOverlayOpen) {
    updateMatchCountdown();
  }

  if (!lastState || !gridOwner || !trailOwner) return;

  /* K7: под открытым оверлеем смерти/итогов поле продолжало рисоваться на
     60 fps, причём сквозь backdrop-filter: blur(8px) — худший из возможных
     сценариев для мобильного GPU: каждый кадр поля тянет за собой пересчёт
     размытия всей области оверлея. Поле там статично и всё равно размыто,
     поэтому обновляем его раз в 4 кадра. */
  const deathOverlayOpen = !!(deathOverlay && !deathOverlay.classList.contains('hidden'));
  if (matchOverlayOpen || deathOverlayOpen) {
    draw._blurSkip = ((draw._blurSkip || 0) + 1) % 4;
    if (draw._blurSkip !== 0) return;
  } else {
    draw._blurSkip = 0;
  }

  const cw = window.innerWidth;
  const ch = window.innerHeight;

  let occludedBottom = 0;
  try {
    if (chat) {
      const r = chat.getBoundingClientRect();
      const coversMostWidth = r.width >= cw * 0.85;
      const touchesBottom = r.bottom >= ch - 1;
      if (coversMostWidth && touchesBottom) {
        occludedBottom = Math.max(0, ch - r.top);
      }
    }
  } catch {
    occludedBottom = 0;
  }

  const viewH = Math.max(1, ch - occludedBottom);

  // J12: hitstop замедляет только интерполяцию игроков, не эффекты.
  const interpNow = performance.now();
  const interpElapsed = interpNow - lastPacketAt - hitstopLostMs(lastPacketAt, interpNow);
  const interp = Math.max(0, Math.min(1, interpElapsed / tickMs));

  const my = getInterpPlayer(you, interp);
  const nt = approxNowTick();
  const speedActive = !!(my && my.a && nt != null && youSpeedUntilTick && nt < youSpeedUntilTick);
  const targetX = my ? my.ix + 0.5 : W / 2;
  const targetY = my ? my.iy + 0.5 : H / 2;
  if (camX == null || camY == null) {
    camX = targetX;
    camY = targetY;
  } else {
    camX = lerp(camX, targetX, 0.12);
    camY = lerp(camY, targetY, 0.12);
  }

  {
    const now = performance.now();
    const dt = Math.min(50, now - (draw._shakeAt || now));
    draw._shakeAt = now;
    const k = Math.max(0, dt / 16);
    shakeVelX *= Math.pow(0.78, k);
    shakeVelY *= Math.pow(0.78, k);
    shakeX += shakeVelX;
    shakeY += shakeVelY;
    shakeX *= Math.pow(0.72, k);
    shakeY *= Math.pow(0.72, k);

    // J14: потолок поднят до 0.8 клетки, иначе класс large физически незаметен.
    const maxShake = 0.8 * Math.max(0, shakeIntensity);
    shakeX = Math.max(-maxShake, Math.min(maxShake, shakeX));
    shakeY = Math.max(-maxShake, Math.min(maxShake, shakeY));
  }

  const cell = Math.max(6, Math.floor(Math.min(cw / VIEW_CELLS_X, viewH / VIEW_CELLS_Y)));

  ctx.clearRect(0, 0, cw, ch);

  const offsetX = cw / 2 - (camX + shakeX) * cell;
  const offsetY = viewH / 2 - (camY + shakeY) * cell;

  const minX = Math.max(0, Math.floor((-offsetX) / cell) - 2);
  const minY = Math.max(0, Math.floor((-offsetY) / cell) - 2);
  const maxX = Math.min(W - 1, Math.floor((cw - offsetX) / cell) + 2);
  const maxY = Math.min(H - 1, Math.floor((viewH - offsetY) / cell) + 2);

  viewMinX = minX;
  viewMinY = minY;
  viewMaxX = maxX;
  viewMaxY = maxY;

  /* K1: границы горячего цикла по сетке — пересечение экрана с последним
     полученным ROI. За его пределами gridOwner/trailOwner заведомо устарели. */
  const roi = lastRoi;
  const gMinX = roi ? Math.max(minX, roi.rx) : minX;
  const gMinY = roi ? Math.max(minY, roi.ry) : minY;
  const gMaxX = roi ? Math.min(maxX, roi.rx + roi.rw - 1) : maxX;
  const gMaxY = roi ? Math.min(maxY, roi.ry + roi.rh - 1) : maxY;

  {
    const bg = ctx.createLinearGradient(0, 0, cw, ch);
    bg.addColorStop(0, '#070a0f');
    bg.addColorStop(0.55, '#0b0f14');
    bg.addColorStop(1, '#070812');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cw, ch);

    const vg = ctx.createRadialGradient(cw * 0.52, viewH * 0.46, Math.min(cw, viewH) * 0.25, cw * 0.52, viewH * 0.46, Math.min(cw, viewH) * 0.85);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cw, ch);
  }

  const nowFrame = performance.now();

  const segByOwner = new Map();
  // Цвет владельца кэшируем до горячего цикла: drawSegTile зовётся для каждой
  // клетки следа каждый кадр, лишний boostHsl там не нужен.
  const hslByOwner = new Map();
  // Стиль территории приходит отдельным JSON (`cosExtra`), а не в 21-байтной
  // записи снапшота. Паттерн создаётся ОДИН раз на владельца за кадр, дальше в
  // цикле по клеткам остаётся один fillRect.
  const terrByOwner = new Map();
  const terrStyleByOwner = new Map();
  for (const p of lastState.players) {
    segByOwner.set(p.n, Math.max(0, Math.min(7, Number(p.cosSeg) || 0)));
    const hsl = boostHsl(colors.get(p.n) || p.c || 'hsl(210 20% 60%)');
    hslByOwner.set(p.n, hsl);
    const tid = cosClampId(cosTerrByPlayer.get(p.n) || 0);
    if (tid) {
      terrByOwner.set(p.n, tid);
      if (cosTerrIsPattern(tid)) {
        const st = cosTerrFillStyle(ctx, hsl, tid, offsetX, offsetY, cell);
        if (st) terrStyleByOwner.set(p.n, st);
      }
    }
  }

  if (fxEnabled && speedActive) {
    const dt = Math.min(40, nowFrame - (draw._spAt || nowFrame));
    draw._spAt = nowFrame;
    const dir = my.d;
    const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    const bx = my.ix + 0.5 - dx * 0.55;
    const by = my.iy + 0.5 - dy * 0.55;
    const c = boostHsl(colors.get(you) || my.c || 'hsl(210 20% 60%)');
    // J22: пресет эффектов масштабирует плотность частиц.
    const rate = (0.22 + 0.55 * fxIntensity) * fxParticleScale();
    const count = Math.max(0, Math.min(7, Math.round((dt / 16) * rate * 3)));
    for (let k = 0; k < count; k++) {
      const jx = (Math.random() - 0.5) * 0.25;
      const jy = (Math.random() - 0.5) * 0.25;
      const pvx = (-dx * (0.010 + Math.random() * 0.010) + (Math.random() - 0.5) * 0.006) * (0.55 + fxIntensity * 0.85);
      const pvy = (-dy * (0.010 + Math.random() * 0.010) + (Math.random() - 0.5) * 0.006) * (0.55 + fxIntensity * 0.85);
      fxParticles.push({
        bornAt: nowFrame,
        lastAt: nowFrame,
        x: bx + jx,
        y: by + jy,
        vx: pvx,
        vy: pvy,
        c,
        r: 0.10 + Math.random() * 0.14
      });
    }
    // Hard cap: remove oldest particles without O(n) shift()
    const hardCap = 220;
    if (fxParticles.length > hardCap) {
      fxParticles.splice(0, fxParticles.length - hardCap);
    }
  }

  // I2: собственный след — главный объект риска в игре. Раньше он отличался от
  // собственной территории всего на 0.07 альфы. Теперь: 0.85 + светлая обводка,
  // а на длинном следе (сигнал риска) добавляется пульсация яркости.
  const trailRisk =
    youTrailLen <= TRAIL_PULSE_FROM ? 0 : Math.min(1, (youTrailLen - TRAIL_PULSE_FROM) / 55);
  const trailPulse =
    trailRisk <= 0 || !fxEnabled || prefersReducedMotion()
      ? 0
      : trailRisk * (0.5 + 0.5 * Math.sin(nowFrame * 0.0115));
  const ownTrailA = Math.min(0.98, 0.85 + 0.11 * trailPulse);
  const otherTrailA = 0.74;
  const ownTrailStroke = `rgba(255,255,255,${(0.45 + 0.40 * trailPulse).toFixed(3)})`;
  const drawOwnOutline = cell >= 8;

  // F18/I4: ближайшая своя клетка ищется бесплатно, прямо в горячем цикле.
  let nearHomeD = Infinity;
  let nearHomeX = -1;
  let nearHomeY = -1;
  const headCX = my ? my.ix : -1;
  const headCY = my ? my.iy : -1;

  for (let y = gMinY; y <= gMaxY; y++) {
    for (let x = gMinX; x <= gMaxX; x++) {
      const i = y * W + x;
      const rawOwner = gridOwner[i];
      // F5: старший бит = «клетка остывает, её ещё можно вернуть».
      const cooling = gridCellIsCooling(rawOwner);
      const o = cooling ? 0 : rawOwner;
      const coolOwner = cooling ? gridCellOwner(rawOwner) : 0;
      const t = trailOwner[i];

      if (cooling) {
        // Остывающая территория: полупрозрачная заливка, пунктирная граница,
        // ритм пульса подсказывает, что время уходит.
        // F5: плюс затухание по мере приближения к концу окна — чем ближе
        // истечение, тем бледнее клетка и тем чаще пульс.
        const px = offsetX + x * cell;
        const py = offsetY + y * cell;
        // Точное время истечения — из EventCoolBatch; клиентская оценка по
        // первому увиденному кадру остаётся запасным вариантом.
        const deadline = coolDeadlineByOwner.get(coolOwner) || 0;
        const seen = coolSeenAt ? coolSeenAt[i] : 0;
        const prog = deadline
          ? Math.max(0, Math.min(1, 1 - (deadline - nowFrame) / RECLAIM_WINDOW_MS))
          : seen
            ? Math.max(0, Math.min(1, (nowFrame - seen) / RECLAIM_WINDOW_MS))
            : 0;
        const fade = 1 - prog * 0.8;
        const rate = 0.005 + 0.012 * prog;
        const pulse = 0.5 + 0.5 * Math.sin(nowFrame * rate - (x + y) * 0.35);
        ctx.fillStyle = getOwnerFillStyle(coolOwner, (0.14 + 0.10 * pulse) * fade);
        ctx.fillRect(px, py, cell, cell);
        if (cell >= 7) {
          ctx.save();
          ctx.setLineDash([Math.max(2, cell * 0.22), Math.max(2, cell * 0.22)]);
          ctx.lineDashOffset = -nowFrame * 0.02;
          ctx.strokeStyle = getOwnerFillStyle(coolOwner, (0.45 + 0.25 * pulse) * fade);
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
          ctx.restore();
        }
      }

      if (o === you && headCX >= 0) {
        const hdx = x - headCX;
        const hdy = y - headCY;
        const hd = hdx * hdx + hdy * hdy;
        if (hd < nearHomeD) {
          nearHomeD = hd;
          nearHomeX = x;
          nearHomeY = y;
        }
      }

      if (o !== 0) {
        const baseA = 0.58;
        const filledAt = gridFillAt ? gridFillAt[i] : 0;
        const age = filledAt ? nowFrame - filledAt : 1e9;

        let waveA = 0;
        if (filledAt && age >= fillAnimMs) {
          const t = age - fillAnimMs;
          if (t < wavePeriodMs) {
            const wave = 0.5 + 0.5 * Math.sin((x * 0.85 + y * 1.15) * waveScale - t * waveSpeed);
            const fade = 1 - (t / wavePeriodMs);
            waveA = waveAlpha * wave * fade;
          }
        }

        const px = offsetX + x * cell;
        const py = offsetY + y * cell;
        const tid = terrByOwner.get(o) || 0;

        // Одна альфа на все три фазы (появление / анимация заливки / покой),
        // чтобы стиль территории подключался ровно в одном месте.
        let a;
        let shineA = 0;
        if (age < 0) {
          a = 0.12 + waveA * 0.35;
        } else if (age < fillAnimMs) {
          const p = Math.max(0, Math.min(1, age / fillAnimMs));
          a = Math.min(0.92, baseA * (0.25 + 0.75 * p) + waveA * 0.5);
          shineA = 0.18 * (1 - Math.abs(p - 0.5) * 2);
        } else {
          a = Math.min(0.92, baseA + waveA);
        }
        if (tid) a = Math.max(0, Math.min(1, a + cosTerrAlphaMod(tid, x, y, nowFrame)));

        const pat = tid ? terrStyleByOwner.get(o) : null;
        if (pat) {
          if (cosTerrIsAdditive(tid)) ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = a;
          ctx.fillStyle = pat;
          ctx.fillRect(px, py, cell, cell);
          ctx.globalAlpha = 1;
          if (cosTerrIsAdditive(tid)) ctx.globalCompositeOperation = 'source-over';
        } else {
          ctx.fillStyle = getOwnerFillStyle(o, a);
          ctx.fillRect(px, py, cell, cell);
        }

        if (shineA > 0.01) {
          ctx.fillStyle = getOwnerFillStyle(o, Math.min(0.92, 0.22 + shineA + waveA * 0.35));
          const inset = Math.max(1, (cell * 0.18) | 0);
          ctx.fillRect(px + inset, py + inset, cell - inset * 2, cell - inset * 2);
        }

        // Витраж: светящийся шов только по внешней границе владения.
        if (tid === 5 && cell >= 7) {
          let e = 0;
          if (y === 0 || gridOwner[i - W] !== o) e |= 1;
          if (x === W - 1 || gridOwner[i + 1] !== o) e |= 2;
          if (y === H - 1 || gridOwner[i + W] !== o) e |= 4;
          if (x === 0 || gridOwner[i - 1] !== o) e |= 8;
          if (e) drawTerrSeam(ctx, px, py, cell, hslByOwner.get(o) || 'hsl(210 20% 60%)', e, 0.75);
        }
      }

      if (t !== 0) {
        const mineTrail = t === you;
        let a = mineTrail ? ownTrailA : otherTrailA;
        if (headIndexByOwner.get(t) === i) a *= interp;
        if (a > 0.02) {
          const segId = segByOwner.get(t) || 0;
          const px = offsetX + x * cell;
          const py = offsetY + y * cell;
          // Единый источник правды: тот же drawSegTile, что и в магазине.
          drawSegTile(ctx, px, py, cell, hslByOwner.get(t) || 'hsl(210 20% 60%)', segId, x * 31 + y * 17, a, nowFrame);

          if (mineTrail && drawOwnOutline) {
            ctx.strokeStyle = ownTrailStroke;
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3);
          }
        }
      }
    }
  }

  if (nearHomeX >= 0) {
    youNearestHomeX = nearHomeX;
    youNearestHomeY = nearHomeY;
    youNearestHomeAt = nowFrame;
  }

  {
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = cell >= 16 ? 1 : 2;
    for (let x = minX; x <= maxX; x += step) {
      const px = offsetX + x * cell;
      ctx.moveTo(px, offsetY + minY * cell);
      ctx.lineTo(px, offsetY + (maxY + 1) * cell);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let y = minY; y <= maxY; y += step) {
      const py = offsetY + y * cell;
      ctx.moveTo(offsetX + minX * cell, py);
      ctx.lineTo(offsetX + (maxX + 1) * cell, py);
    }
    ctx.stroke();
  }

  /* K1: туман за пределами ROI. Рисуется после сетки и до рамки карты, чтобы
     гасить и клетки, и линии, но не трогать игроков, эффекты и HUD. */
  if (roi && (gMinX > minX || gMinY > minY || gMaxX < maxX || gMaxY < maxY)) {
    const kx = offsetX + roi.rx * cell;
    const ky = offsetY + roi.ry * cell;
    const kw = roi.rw * cell;
    const kh = roi.rh * cell;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(kx, ky, kw, kh);
    ctx.fillStyle = 'rgba(6,8,12,0.82)';
    ctx.fill('evenodd');
    ctx.restore();

    // Тонкая граница известной области: игрок должен понимать, что дальше не
    // «пусто», а «неизвестно».
    ctx.save();
    ctx.strokeStyle = 'rgba(148,163,184,0.20)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(kx + 0.5, ky + 0.5, Math.max(1, kw - 1), Math.max(1, kh - 1));
    ctx.restore();
  }

  {
    const left = offsetX;
    const top = offsetY;
    const w = W * cell;
    const h = H * cell;
    const lw = Math.max(6, Math.min(26, cell * 0.30));

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    ctx.rect(left, top, w, h);
    ctx.clip('evenodd');
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(96,165,250,0.18)';
    ctx.shadowColor = 'rgba(96,165,250,0.55)';
    ctx.shadowBlur = 22;
    ctx.strokeRect(left - lw / 2, top - lw / 2, w + lw, h + lw);
    ctx.restore();

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, lw * 0.40);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    {
      const lw2 = ctx.lineWidth;
      ctx.strokeRect(left - lw2 / 2, top - lw2 / 2, w + lw2, h + lw2);
    }
    ctx.restore();
  }

  if (powerUps && powerUps.size) {
    const now = performance.now();
    const nt = approxNowTick();
    for (const pu of powerUps.values()) {
      const x = Number(pu.x) || 0;
      const y = Number(pu.y) || 0;
      if (x < minX - 1 || x > maxX + 1 || y < minY - 1 || y > maxY + 1) continue;

      const cx = offsetX + (x + 0.5) * cell;
      const cy = offsetY + (y + 0.5) * cell;

      let pulse = 1;
      let alpha = 1;
      if (nt != null && pu.expires) {
        const rem = Number(pu.expires) - nt;
        if (rem < 30) {
          const blink = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(now * 0.020));
          alpha *= Math.max(0.15, blink);
          pulse *= 0.96 + 0.10 * (0.5 + 0.5 * Math.sin(now * 0.016));
        } else {
          pulse *= 0.98 + 0.06 * (0.5 + 0.5 * Math.sin(now * 0.008));
        }
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);
      ctx.translate(-cx, -cy);

      const r = cell * 0.34;
      if (pu.type === 1) {
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 3;
          const px = cx + Math.cos(a) * r;
          const py = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,255,255,0.18)';
        ctx.strokeStyle = 'rgba(0,255,255,0.92)';
        ctx.lineWidth = Math.max(1, cell * 0.10);
        ctx.shadowColor = 'rgba(0,255,255,0.55)';
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else if (pu.type === 2) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.35, cy - r * 0.65);
        ctx.lineTo(cx + r * 0.05, cy - r * 0.10);
        ctx.lineTo(cx - r * 0.05, cy - r * 0.10);
        ctx.lineTo(cx + r * 0.35, cy + r * 0.65);
        ctx.lineTo(cx - r * 0.05, cy + r * 0.15);
        ctx.lineTo(cx + r * 0.05, cy + r * 0.15);
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,215,0,0.20)';
        ctx.strokeStyle = 'rgba(255,215,0,0.92)';
        ctx.lineWidth = Math.max(1, cell * 0.10);
        ctx.shadowColor = 'rgba(255,215,0,0.55)';
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else if (pu.type === 3) {
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 === 0 ? r * 0.95 : r * 0.42;
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,80,80,0.18)';
        ctx.strokeStyle = 'rgba(255,80,80,0.95)';
        ctx.lineWidth = Math.max(1, cell * 0.10);
        ctx.shadowColor = 'rgba(255,80,80,0.65)';
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.90)';
        ctx.fill();
        ctx.restore();
      } else if (pu.type === 4) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.55, cy - r * 0.05);
        ctx.lineTo(cx - r * 0.10, cy - r * 0.70);
        ctx.lineTo(cx - r * 0.05, cy - r * 0.22);
        ctx.lineTo(cx + r * 0.55, cy + r * 0.05);
        ctx.lineTo(cx + r * 0.10, cy + r * 0.70);
        ctx.lineTo(cx + r * 0.05, cy + r * 0.22);
        ctx.closePath();
        ctx.fillStyle = 'rgba(170,120,255,0.20)';
        ctx.strokeStyle = 'rgba(190,150,255,0.96)';
        ctx.lineWidth = Math.max(1, cell * 0.10);
        ctx.shadowColor = 'rgba(190,150,255,0.70)';
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.90, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(190,150,255,0.22)';
        ctx.lineWidth = Math.max(1, cell * 0.06);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }
  }

  if (fxEnabled && fxParticles.length) {
    for (let i = fxParticles.length - 1; i >= 0; i--) {
      const p0 = fxParticles[i];
      const bornAt = typeof p0.bornAt === 'number' ? p0.bornAt : p0.t0;
      const lastAt = typeof p0.lastAt === 'number' ? p0.lastAt : p0.t0;
      const age = nowFrame - bornAt;
      if (age > 520) {
        fxParticles.splice(i, 1);
        continue;
      }
      const dt = Math.min(40, Math.max(0, nowFrame - lastAt));
      p0.x += p0.vx * dt;
      p0.y += p0.vy * dt;
      p0.lastAt = nowFrame;

      if (p0.x < minX - 2 || p0.x > maxX + 2 || p0.y < minY - 2 || p0.y > maxY + 2) continue;
      const a = (1 - age / 520) * (0.50 + 0.40 * fxIntensity);
      const cx = offsetX + p0.x * cell;
      const cy = offsetY + p0.y * cell;
      const rr = Math.max(1, cell * p0.r);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = p0.c;
      ctx.shadowBlur = Math.max(6, cell * 0.45);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.font = `12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;

  const dirVec = (d) => {
    if (d === 'up') return [0, -1];
    if (d === 'down') return [0, 1];
    if (d === 'left') return [-1, 0];
    return [1, 0];
  };

  for (const p of lastState.players) {
    if (!p.a) continue;
    const ip = getInterpPlayer(p.n, interp) || { ...p, ix: p.x, iy: p.y };
    const c = boostHsl(colors.get(p.n) || p.c || 'hsl(210 20% 60%)');
    const px = offsetX + (ip.ix + 0.5) * cell;
    const py = offsetY + (ip.iy + 0.5) * cell;

    const [dx, dy] = dirVec(ip.d);
    if (fxEnabled && p.n === you && speedActive) {
      ctx.save();
      ctx.globalAlpha = 0.55 * (0.35 + fxIntensity * 0.65);
      ctx.strokeStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = Math.max(10, cell * 0.9);
      ctx.lineWidth = Math.max(2, cell * 0.14);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - dx * cell * 0.85, py - dy * cell * 0.85);
      ctx.stroke();
      ctx.restore();
    }

    const isBounty = !!(bountyTarget && p.n === bountyTarget);
    // Байт `sh` — битовая маска: бит0 = щит, бит1 = неуязвимость после респавна.
    const shMask = Number(ip.sh) || 0;
    const hasShield = (shMask & 1) !== 0;
    const hasInvuln = (shMask & 2) !== 0;
    const hasSpeed = !!(p.n === you && speedActive);
    const speedType = hasSpeed ? (youSpeedType === 4 ? 4 : 2) : 0;

    if (hasInvuln) {
      const tt = performance.now() * 0.010 + (p.n % 997) * 0.02;
      const pulse = 0.5 + 0.5 * Math.sin(tt);
      ctx.save();
      ctx.globalAlpha = 0.30 + 0.30 * pulse;
      ctx.setLineDash([Math.max(2, cell * 0.14), Math.max(2, cell * 0.12)]);
      ctx.lineDashOffset = -performance.now() * 0.04;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = Math.max(1, cell * 0.07);
      ctx.beginPath();
      ctx.arc(px, py, cell * (0.54 + 0.04 * pulse), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (hasShield) {
      const tt = performance.now() * 0.004 + (p.n % 997) * 0.01;
      const pulse = 0.5 + 0.5 * Math.sin(tt);
      const rr = cell * (0.46 + 0.04 * pulse);
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.18 * pulse;
      ctx.strokeStyle = 'rgba(120,200,255,0.95)';
      ctx.shadowColor = 'rgba(120,200,255,0.95)';
      ctx.shadowBlur = Math.max(10, cell * 0.8);
      ctx.lineWidth = Math.max(2, cell * 0.10);
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (hasSpeed) {
      const tt = performance.now() * 0.006 + (p.n % 997) * 0.02;
      const pulse = 0.5 + 0.5 * Math.sin(tt);
      const rr = cell * (speedType === 4 ? (0.64 + 0.035 * pulse) : (0.60 + 0.03 * pulse));
      ctx.save();
      ctx.globalAlpha = (speedType === 4 ? 0.18 : 0.16) + (speedType === 4 ? 0.14 : 0.12) * pulse;
      ctx.strokeStyle = speedType === 4 ? 'rgba(190,150,255,0.94)' : 'rgba(255,215,0,0.92)';
      ctx.shadowColor = speedType === 4 ? 'rgba(190,150,255,0.85)' : 'rgba(255,215,0,0.75)';
      ctx.shadowBlur = Math.max(8, cell * (speedType === 4 ? 0.85 : 0.7));
      ctx.lineWidth = Math.max(2, cell * (speedType === 4 ? 0.095 : 0.08));
      if (speedType === 4) {
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha *= 0.60;
        ctx.lineWidth = Math.max(1, cell * 0.06);
        ctx.beginPath();
        ctx.arc(px, py, rr * 0.82, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.setLineDash([Math.max(2, cell * 0.10), Math.max(2, cell * 0.10)]);
        ctx.lineDashOffset = -performance.now() * 0.02;
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Голова и направляющий нос — единый drawHead, тот же и в магазине.
    drawHead(ctx, px, py, cell, c, ip.cosHead, dx, dy, nowFrame);

    if (isBounty) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,80,80,0.95)';
      ctx.lineWidth = Math.max(2, cell * 0.11);
      ctx.setLineDash([Math.max(3, cell * 0.16), Math.max(2, cell * 0.10)]);
      ctx.lineDashOffset = -performance.now() * 0.03;
      ctx.shadowColor = 'rgba(255,80,80,0.75)';
      ctx.shadowBlur = Math.max(10, cell * 0.75);
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (hasShield || hasSpeed || isBounty || hasInvuln) {
      const badges = [];
      if (hasInvuln) badges.push({ fill: 'rgba(255,255,255,0.95)', stroke: 'rgba(0,0,0,0.35)' });
      if (hasShield) badges.push({ fill: 'rgba(120,200,255,0.95)', stroke: 'rgba(255,255,255,0.25)' });
      if (hasSpeed) badges.push({ fill: speedType === 4 ? 'rgba(190,150,255,0.95)' : 'rgba(255,215,0,0.95)', stroke: 'rgba(255,255,255,0.25)' });
      if (isBounty) badges.push({ fill: 'rgba(255,80,80,0.95)', stroke: 'rgba(255,255,255,0.25)' });

      const br = Math.max(2, cell * 0.075);
      const gap = br * 2.25;
      const bx0 = px - ((badges.length - 1) * gap) / 2;
      const by = py - cell * 0.72;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6;
      for (let i = 0; i < badges.length; i++) {
        const b = badges[i];
        const bx = bx0 + i * gap;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = b.fill;
        ctx.fill();
        ctx.lineWidth = Math.max(1, cell * 0.03);
        ctx.strokeStyle = b.stroke;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Титул идёт перед ником — он виден всем, кто видит плашку.
    const label = `${cosTitlePrefix(cosTitleByPlayer.get(ip.n) || 0)}${ip.nm ? String(ip.nm) : String(ip.n)}`;
    // Плашка ника — единый drawNamePlate, тот же и в магазине.
    drawNamePlate(ctx, label, px, py - cell * 0.58, c, ip.cosNameplate, 0.95, 12, nowFrame);
  }

  // I4: радар угрозы. Дуга по краю экрана в направлении чужой головы ближе
  // 25 клеток, пока игрок вне своей территории. Интенсивность растёт при сближении.
  if (fxEnabled && my && my.a && !youInOwnZone) {
    const reduce = prefersReducedMotion();
    const hx = my.ix + 0.5;
    const hy = my.iy + 0.5;
    const ecx = cw / 2;
    const ecy = viewH / 2;
    const rx = Math.max(40, cw / 2 - 16);
    const ry = Math.max(40, viewH / 2 - 16);
    const THREAT_CELLS = 25;
    let drawn = 0;

    for (const p of lastState.players) {
      if (!p.a || p.n === you) continue;
      const dx = p.x + 0.5 - hx;
      const dy = p.y + 0.5 - hy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= THREAT_CELLS) continue;

      const inten = Math.max(0, Math.min(1, 1 - dist / THREAT_CELLS));
      const ang = Math.atan2(dy, dx);
      const pulse = reduce ? 1 : 0.8 + 0.2 * Math.sin(nowFrame * 0.012 + p.n * 0.7);
      const span = 0.28 + 0.34 * inten;
      const col = bountyTarget && p.n === bountyTarget ? 'rgba(255,140,60,0.95)' : 'rgba(255,70,92,0.95)';

      ctx.save();
      ctx.globalAlpha = Math.min(0.9, (0.14 + 0.66 * inten * inten) * pulse);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(3, 4 + 13 * inten);
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.ellipse(ecx, ecy, rx, ry, 0, ang - span, ang + span);
      ctx.stroke();
      ctx.restore();

      if (++drawn >= 4) break;
    }
  }

  // F18: счётчик длины следа у головы + компас в сторону ближайшей своей клетки.
  if (my && my.a && started) {
    const hpx = offsetX + (my.ix + 0.5) * cell;
    const hpy = offsetY + (my.iy + 0.5) * cell;
    const fontPx = Math.max(11, Math.round(cell * 0.60));

    if (youTrailLen > 0) {
      const risky = youTrailLen >= TRAIL_PULSE_FROM;
      const txt = String(youTrailLen);
      ctx.save();
      ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.92)';
      ctx.strokeText(txt, hpx, hpy + cell * 0.98);
      ctx.fillStyle = risky ? 'rgba(255,190,80,0.98)' : 'rgba(255,255,255,0.90)';
      ctx.fillText(txt, hpx, hpy + cell * 0.98);
      ctx.restore();
    }

    if (!youInOwnZone && youNearestHomeX >= 0) {
      const ax = youNearestHomeX + 0.5 - (my.ix + 0.5);
      const ay = youNearestHomeY + 0.5 - (my.iy + 0.5);
      const dlen = Math.sqrt(ax * ax + ay * ay);
      if (dlen > 1.2) {
        const ang = Math.atan2(ay, ax);
        const rr = cell * 1.25;
        const tipX = hpx + Math.cos(ang) * rr;
        const tipY = hpy + Math.sin(ang) * rr;
        const wgt = cell * 0.26;
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = 'rgba(120,255,190,0.95)';
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = Math.max(1, cell * 0.05);
        ctx.beginPath();
        ctx.moveTo(tipX + Math.cos(ang) * wgt, tipY + Math.sin(ang) * wgt);
        ctx.lineTo(tipX + Math.cos(ang + 2.4) * wgt, tipY + Math.sin(ang + 2.4) * wgt);
        ctx.lineTo(tipX + Math.cos(ang - 2.4) * wgt, tipY + Math.sin(ang - 2.4) * wgt);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // F15: пока игрок ни разу не замкнул петлю, компас — слишком тихая
    // подсказка. Ведём пунктирную линию прямо к своей земле и подписываем её.
    if (obGuideActive() && !youInOwnZone && youNearestHomeX >= 0) {
      const tx = offsetX + (youNearestHomeX + 0.5) * cell;
      const ty = offsetY + (youNearestHomeY + 0.5) * cell;
      const ddx = tx - hpx;
      const ddy = ty - hpy;
      const dpx = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dpx > cell * 1.5) {
        const ang = Math.atan2(ddy, ddx);
        // Линия не доходит до самой головы и до самой цели — чтобы не мешать.
        const x0 = hpx + Math.cos(ang) * cell * 0.9;
        const y0 = hpy + Math.sin(ang) * cell * 0.9;
        const reduce = prefersReducedMotion();
        const pulse = reduce ? 0.85 : 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(nowFrame * 0.006));

        ctx.save();
        ctx.globalAlpha = 0.9 * pulse;
        ctx.strokeStyle = 'rgba(120,255,190,0.95)';
        ctx.lineWidth = Math.max(2, cell * 0.16);
        ctx.lineCap = 'round';
        ctx.setLineDash([Math.max(4, cell * 0.5), Math.max(4, cell * 0.45)]);
        ctx.lineDashOffset = reduce ? 0 : -nowFrame * 0.06;
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);

        // Наконечник у цели.
        const hw = Math.max(6, cell * 0.55);
        ctx.fillStyle = 'rgba(120,255,190,0.98)';
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + Math.cos(ang + 2.5) * hw, ty + Math.sin(ang + 2.5) * hw);
        ctx.lineTo(tx + Math.cos(ang - 2.5) * hw, ty + Math.sin(ang - 2.5) * hw);
        ctx.closePath();
        ctx.fill();

        // Подпись у цели, но всегда внутри вьюпорта.
        const label = t('onb.return_here');
        const lf = Math.max(12, Math.round(cell * 0.85));
        ctx.font = `800 ${lf}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1;
        const lx = Math.max(70, Math.min(cw - 70, tx));
        const ly = Math.max(28, Math.min(viewH - 28, ty - cell * 1.4));
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(0,0,0,0.9)';
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = 'rgba(160,255,215,0.98)';
        ctx.fillText(label, lx, ly);
        ctx.restore();
      }
    }
  }

  if (!chat.classList.contains('collapsed')) {
    if (!chat.contains(document.activeElement) && performance.now() > chatOpenUntil) {
      setChatCollapsed(true);
    }
  }

  if (minimapDirty || minimapHadChunkUpdate || nowFrame - lastMinimapDrawAt >= MINIMAP_REFRESH_MS) {
    drawMinimap();
    lastMinimapDrawAt = nowFrame;
  }

  if (fxBursts.length) {
    for (let i = fxBursts.length - 1; i >= 0; i--) {
      const fx = fxBursts[i];
      const knd0 = String(fx.kind || '');
      const isScore = knd0 === 'score';
      // Длительность бурста — параметр: вспышка захвата живёт 650 мс,
      // эффект гибели дольше, всплывающее число — своё время.
      const life = Number(fx.life) > 0 ? Number(fx.life) : isScore ? SCORE_POPUP_MS : 650;
      const age = nowFrame - fx.t0;
      if (age > life) {
        fxBursts.splice(i, 1);
        continue;
      }
      if (!isScore && !fxEnabled) continue;
      const x = fx.x;
      const y = fx.y;
      if (x < minX - 2 || x > maxX + 2 || y < minY - 2 || y > maxY + 2) continue;

      // J5: всплывающее число «+247» над точкой захвата.
      if (isScore) {
        const sp = Math.max(0, Math.min(1, age / SCORE_POPUP_MS));
        const v = Math.max(0, Math.round(Number(fx.value) || 0));
        if (!v) continue;
        const scale = age < 150 ? easeOutBack(age / 150) : 1;
        const alpha = sp > 0.72 ? Math.max(0, (1 - sp) / 0.28) : 1;
        const size = Math.round(12 + Math.min(28, v * 0.35));
        const sx = offsetX + (x + 0.5) * cell;
        const sy = offsetY + (y + 0.5) * cell - easeOutCubic(sp) * cell * 1.2;
        const col = v >= 300 ? 'rgba(200,130,255,1)' : v >= 100 ? 'rgba(255,210,60,1)' : 'rgba(255,255,255,1)';
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(sx, sy);
        if (scale !== 1) ctx.scale(scale, scale);
        ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.95)';
        ctx.strokeText(`+${v}`, 0, 0);
        ctx.fillStyle = col;
        ctx.fillText(`+${v}`, 0, 0);
        ctx.restore();
        continue;
      }

      const p = Math.max(0, Math.min(1, age / life));
      const cx = offsetX + (x + 0.5) * cell;
      const cy = offsetY + (y + 0.5) * cell;
      const knd = knd0;

      // Гибель: тот же drawDeathFx, что и в превью магазина.
      if (knd.startsWith('die')) {
        const dieId = cosClampId(Number(knd.slice(3)) || 0);
        const owner = Number(fx.pid);
        const ownerHsl = boostHsl(colors.get(owner) || 'hsl(210 20% 60%)');
        drawDeathFx(ctx, cx, cy, cell * (0.6 + fxIntensity * 0.7), ownerHsl, dieId, p);
        continue;
      }

      const isCap = knd.startsWith('cap');
      const base = cell * (knd === 'kill' ? 1.1 : isCap ? 1.05 : 0.85);
      const r = base * (0.35 + 1.25 * p) * (0.35 + fxIntensity * 0.95);
      const a = (1 - p) * (0.55 + 0.45 * fxIntensity);

      // Захват: тот же drawCaptureFx, что и в превью магазина. Цвет берётся
      // от игрока, совершившего захват (варианты 5..7 — со своей палитрой).
      if (isCap) {
        const capId = Math.max(0, Math.min(7, Number(knd.slice(3)) || 0));
        const owner = Number(fx.pid);
        const ownerHsl = boostHsl(colors.get(owner) || colors.get(you) || 'hsl(210 20% 60%)');
        const capCell = cell * (0.35 + fxIntensity * 0.95);
        drawCaptureFx(ctx, cx, cy, capCell, ownerHsl, capId, p);
        continue;
      }

      let col = 'rgba(255,215,0,0.92)';
      if (knd === 'kill') col = 'rgba(255,45,85,0.95)';
      // F5: возврат остывшей земли — холодный голубой, а не «золото захвата».
      else if (knd === 'reclaim') col = 'rgba(120,220,255,0.96)';
      else if (knd === 'use') col = 'rgba(0,255,255,0.95)';
      else if (knd === 'pickup2') col = 'rgba(255,215,0,0.95)';
      else if (knd === 'pickup4') col = 'rgba(190,150,255,0.96)';

      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, cell * 0.10);
      if (knd === 'pickup4') {
        ctx.lineWidth = Math.max(2, cell * 0.10);
        for (let k = 0; k < 10; k++) {
          const ang = p * 2.0 + (k * Math.PI * 2) / 10;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * r * 0.30, cy + Math.sin(ang) * r * 0.30);
          ctx.lineTo(cx + Math.cos(ang) * r * 1.05, cy + Math.sin(ang) * r * 1.05);
          ctx.stroke();
        }
        ctx.globalAlpha = a * 0.85;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = a * 0.45;
        ctx.lineWidth = Math.max(1, cell * 0.06);
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
        ctx.stroke();
      } else if (knd === 'pickup2') {
        ctx.lineWidth = Math.max(2, cell * 0.09);
        ctx.setLineDash([Math.max(2, cell * 0.10), Math.max(2, cell * 0.10)]);
        ctx.lineDashOffset = -nowFrame * 0.03;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  if (started) {
    renderMetaHud();
    renderTopHud();
    /* K3: условие `rightSidebarEl.dataset.tab === 'team'` не выполнялось никогда
       — в разметке жёстко прописан `data-tab="match"`, и его никто не менял, так
       что живая таблица игроков не отрисовывалась ни разу за матч. Рендерим
       безусловно, но не 60 раз в секунду: таблица собирается через innerHTML. */
    const nowTeam = performance.now();
    if (nowTeam - (renderTeamHud._at || 0) >= 400) {
      renderTeamHud._at = nowTeam;
      renderTeamHud();
    }
  }

  if (deathOverlay && !deathOverlay.classList.contains('hidden')) {
    const now = performance.now();
    if (now - (lastDeathStatsAt || 0) > 500) {
      lastDeathStatsAt = now;
      renderDeathStats();
    }
  }

  fpsFrames++;
  const now = performance.now();
  const dtFps = now - fpsLast;
  if (dtFps >= 500) {
    const inst = (fpsFrames * 1000) / dtFps;
    fps = fps ? lerp(fps, inst, 0.2) : inst;
    fpsFrames = 0;
    fpsLast = now;
  }

  if (bytesSampleAt == null) {
    bytesSampleAt = now;
    bytesInSample = bytesInTotal;
    bytesOutSample = bytesOutTotal;
  } else {
    const dtNet = now - bytesSampleAt;
    if (dtNet >= 500) {
      const dtSec = dtNet / 1000;
      const instDown = (bytesInTotal - bytesInSample) / dtSec;
      const instUp = (bytesOutTotal - bytesOutSample) / dtSec;
      downBps = downBps ? lerp(downBps, instDown, 0.2) : instDown;
      upBps = upBps ? lerp(upBps, instUp, 0.2) : instUp;
      bytesSampleAt = now;
      bytesInSample = bytesInTotal;
      bytesOutSample = bytesOutTotal;
    }
  }

  const pingText = pingMs == null ? '…' : `${pingMs.toFixed(0)}ms`;
  const upText = formatRate(upBps);
  const downText = formatRate(downBps);
  const tr = tickrate ? `${tickrate.toFixed(1)}` : '…';
  const sr = tickMs ? `${(1000 / tickMs).toFixed(1)}` : '…';
  const rid = roomId == null ? '…' : String(roomId);

  const fpsText = fps ? fps.toFixed(0) : '…';
  const srvNum = tickMs ? 1000 / tickMs : null;
  const tickBad = srvNum != null && tickrate ? tickrate < srvNum * 0.8 : tr === '…';

  const roomBad = roomId == null;
  const fpsBad = fps ? fps < 30 : fpsText === '…';
  const pingBad = pingMs == null ? true : pingMs > 150;
  const upBad = upText === '…';
  const downBad = downText === '…';
  const srvBad = srvNum == null;

  if (!perfEnabled) {
    return;
  }

  setSafeHtml(perfEl, `
    <div class="perfRow">${escapeHtml(t('perf.room'))}: ${perfValueSpan(rid, roomBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.fps'))}: ${perfValueSpan(fpsText, fpsBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.ping'))}: ${perfValueSpan(pingText, pingBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.traffic'))}: ↑ ${perfValueSpan(upText, upBad)}&nbsp;&nbsp;↓ ${perfValueSpan(downText, downBad)}</div>
    <div class="perfRow">${escapeHtml(t('perf.ticks'))}: ${perfValueSpan(tr, tickBad)} (${escapeHtml(t('perf.server'))} ${perfValueSpan(sr, srvBad)})</div>
  `);
}

bindSettingsUi();
bindCosmeticsUi();

draw();
