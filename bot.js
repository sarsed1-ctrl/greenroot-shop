/* ============================================================
   bot.js — GreenRoot Telegram Bot
   Deploy on Railway: railway up
   Env vars: BOT_TOKEN, CHAT_ID, JSONBIN_KEY, JSONBIN_PRODUCTS_ID, JSONBIN_ORDERS_ID
   ============================================================ */

const BOT_TOKEN           = process.env.BOT_TOKEN           || '';
const CHAT_ID             = process.env.CHAT_ID             || '';
const JSONBIN_KEY         = process.env.JSONBIN_KEY         || '';
const JSONBIN_PRODUCTS_ID = process.env.JSONBIN_PRODUCTS_ID || '';
const JSONBIN_ORDERS_ID   = process.env.JSONBIN_ORDERS_ID   || '';

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

let pollOffset  = 0;
let wizardState = null;

/* ---- DEFAULT PRODUCTS ------------------------------------- */

const DEFAULT_PRODUCTS = [
  { id:1, emoji:'🌱', gradient:'#e8f4e8', stock:null, name:'Terra GROW',              price:'€14.90', shortDesc:'Balanced nitrogen-rich formula for vigorous vegetative growth.' },
  { id:2, emoji:'🌺', gradient:'#f3eaff', stock:null, name:'Terra BLOOM',             price:'€14.90', shortDesc:'Phosphorus-potassium rich formula to fuel prolific flowering.' },
  { id:3, emoji:'🪴', gradient:'#ebf2e6', stock:null, name:'Plagron LightMix',        price:'€18.50', shortDesc:'Airy peat-based substrate with gentle starter nutrients.' },
  { id:4, emoji:'🍯', gradient:'#fde8e8', stock:null, name:'Sugar Royal',             price:'€16.90', shortDesc:'Carbohydrate supplement for richer flavour and stronger yields.' },
  { id:5, emoji:'⚗️', gradient:'#e8edf8', stock:null, name:'PK 13-14',               price:'€12.50', shortDesc:'Concentrated phosphorus-potassium booster for peak bloom.' },
  { id:6, emoji:'🌿', gradient:'#e6f4f0', stock:null, name:'AZOS Extreme Gardening', price:'€24.90', shortDesc:'Beneficial nitrogen-fixing bacteria for explosive growth.' },
  { id:7, emoji:'🧪', gradient:'#ecf2e8', stock:null, name:'PH+ / PH-',              price:'€8.90',  shortDesc:'Precise pH adjustment for optimal nutrient uptake.' },
];

const PRODUCT_GRADIENTS = ['#e8f4e8','#f3eaff','#ebf2e6','#fde8e8','#e8edf8','#e6f4f0','#ecf2e8','#fef3e8','#e8f0fe','#fde8f3'];
const PRODUCT_EMOJIS    = ['🌱','🌺','🪴','🍯','⚗️','🌿','🧪','🌸','🍃','💧'];

/* ---- JSONBIN ---------------------------------------------- */

async function dbGet(binId) {
  const res = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
    headers: { 'X-Master-Key': JSONBIN_KEY },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.record;
}

async function dbSet(binId, value) {
  await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_KEY },
    body: JSON.stringify(value),
  });
}

async function getProducts() {
  const stored = await dbGet(JSONBIN_PRODUCTS_ID);
  if (Array.isArray(stored) && stored.length > 0) return stored;
  return DEFAULT_PRODUCTS;
}

async function saveProducts(products) {
  await dbSet(JSONBIN_PRODUCTS_ID, products);
}

async function getOrders() {
  const stored = await dbGet(JSONBIN_ORDERS_ID);
  return Array.isArray(stored) ? stored : [];
}

async function createProduct({ name, shortDesc = '', price = '', stock = null, emoji = '' }) {
  const products = await getProducts();
  const maxId    = products.reduce((m, p) => Math.max(m, p.id), 0);
  const idx      = products.length % PRODUCT_GRADIENTS.length;
  const product  = {
    id:       maxId + 1,
    emoji:    emoji || PRODUCT_EMOJIS[products.length % PRODUCT_EMOJIS.length],
    gradient: PRODUCT_GRADIENTS[idx],
    stock, name, shortDesc, price,
  };
  products.push(product);
  await saveProducts(products);
  return product;
}

async function deleteProduct(id) {
  const products = await getProducts();
  await saveProducts(products.filter(p => p.id !== id));
}

/* ---- TELEGRAM --------------------------------------------- */

async function tg(method, body = {}) {
  const res = await fetch(`${TG}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function send(text, replyMarkup = null) {
  const body = { chat_id: CHAT_ID, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await tg('sendMessage', body);
}

async function answerCb(id) {
  await tg('answerCallbackQuery', { callback_query_id: id });
}

/* ---- KEYBOARDS -------------------------------------------- */

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '📦 Склад' },          { text: '🛒 Заказы' }],
    [{ text: '🗂 Все товары' },      { text: '💰 Цены' }],
    [{ text: '✏️ Изменить склад' },  { text: '💲 Изменить цену' }],
    [{ text: '➕ Добавить товар' },  { text: '🗑 Удалить товар' }],
    [{ text: '❓ Помощь' }],
  ],
  resize_keyboard: true,
  persistent: true,
};

async function productInlineKeyboard(prefix) {
  const products = await getProducts();
  const rows = [];
  for (let i = 0; i < products.length; i += 2) {
    const row = [{ text: `${products[i].emoji} #${products[i].id} ${products[i].name}`, callback_data: `${prefix}:${products[i].id}` }];
    if (products[i + 1]) row.push({ text: `${products[i+1].emoji} #${products[i+1].id} ${products[i+1].name}`, callback_data: `${prefix}:${products[i+1].id}` });
    rows.push(row);
  }
  rows.push([{ text: '❌ Отмена', callback_data: 'cancel_action' }]);
  return { inline_keyboard: rows };
}

function stockPresetsMarkup(id) {
  return { inline_keyboard: [
    [{ text:'+1', callback_data:`stock_preset:${id}:+1` }, { text:'+5', callback_data:`stock_preset:${id}:+5` }, { text:'+10', callback_data:`stock_preset:${id}:+10` }],
    [{ text:'-1', callback_data:`stock_preset:${id}:-1` }, { text:'-5', callback_data:`stock_preset:${id}:-5` }, { text:'0 (обнулить)', callback_data:`stock_preset:${id}:0` }],
    [{ text:'♾️ Безлимит', callback_data:`stock_preset:${id}:inf` }, { text:'❌ Отмена', callback_data:'cancel_action' }],
  ]};
}

function cancelOnlyMarkup() {
  return { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_action' }]] };
}

function skipCancelMarkup() {
  return { inline_keyboard: [[{ text: '⏭ Пропустить', callback_data: 'skip_step' }, { text: '❌ Отмена', callback_data: 'cancel_action' }]] };
}

/* ---- POLLING ---------------------------------------------- */

async function poll() {
  try {
    const data = await (await fetch(`${TG}/getUpdates?offset=${pollOffset}&limit=20&timeout=30`)).json();
    if (!data.ok) { console.error('TG API error:', data.description); return; }

    for (const update of data.result) {
      pollOffset = update.update_id + 1;

      const msg = update.message;
      if (msg?.text && String(msg.chat.id) === String(CHAT_ID)) {
        await handleMessage(msg.text.trim());
      }

      const cb = update.callback_query;
      if (cb) {
        const chatId = cb.message?.chat?.id ?? cb.from?.id;
        if (String(chatId) === String(CHAT_ID)) await handleCallback(cb);
      }
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }
  setTimeout(poll, 1000);
}

/* ---- MESSAGE HANDLER -------------------------------------- */

async function handleMessage(text) {
  console.log(`[msg] ${text}`);

  if (/^\/cancel$/i.test(text)) {
    wizardState = null;
    await send('❌ Отменено.', MAIN_KEYBOARD);
    return;
  }

  if (wizardState) { await handleWizardStep(text); return; }

  if (text === '❓ Помощь' || /^\/help$/i.test(text)) {
    await send(
      '📋 GreenRoot — Управление магазином\n\n' +
      '📦 Склад — остатки товаров\n' +
      '🛒 Заказы — последние 10 заказов\n' +
      '🗂 Все товары — список с ID и ценами\n' +
      '💰 Цены — прайс-лист\n' +
      '✏️ Изменить склад — выбрать товар и обновить остаток\n' +
      '💲 Изменить цену — выбрать товар и задать новую цену\n' +
      '➕ Добавить товар — пошаговый мастер\n' +
      '🗑 Удалить товар — выбрать и подтвердить удаление\n\n' +
      '/setstock [id] [кол-во|+n|-n] — обновить остаток\n' +
      '/setstock all [кол-во] — установить всем\n' +
      '/cancel — отменить мастер',
      MAIN_KEYBOARD
    );
    return;
  }

  if (text === '📦 Склад' || /^\/stock$/i.test(text)) {
    const products = await getProducts();
    const lines = products.map(p => {
      const s = p.stock;
      if (s === null || s === undefined) return `  ♾️  #${p.id} ${p.emoji} ${p.name}`;
      const icon = s === 0 ? '❌' : s <= 5 ? '⚠️' : '✅';
      return `  ${icon} #${p.id} ${p.emoji} ${p.name}: ${s} шт.`;
    }).join('\n');
    await send('📦 Остатки:\n\n' + lines, MAIN_KEYBOARD);
    return;
  }

  if (text === '🛒 Заказы' || /^\/orders$/i.test(text)) {
    const orders = await getOrders();
    if (orders.length === 0) { await send('🛒 Заказов пока нет.', MAIN_KEYBOARD); return; }
    const lines = orders.slice(0, 10).map((o, i) => {
      const d    = new Date(o.ts);
      const date = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const items = o.items.map(it => `${it.name} ×${it.qty}`).join(', ');
      return `${i+1}. ${date} — ${o.name} (${o.phone})\n   ${items}\n   Итого: ${o.total}`;
    }).join('\n\n');
    await send(`🛒 Последние ${Math.min(orders.length, 10)} заказов:\n\n` + lines, MAIN_KEYBOARD);
    return;
  }

  if (text === '💰 Цены' || /^\/prices$/i.test(text)) {
    const products = await getProducts();
    const lines = products.map(p => `  ${p.emoji} #${p.id} ${p.name}: ${p.price}`).join('\n');
    await send('💰 Цены:\n\n' + lines, MAIN_KEYBOARD);
    return;
  }

  if (text === '🗂 Все товары' || /^\/listproducts$/i.test(text)) {
    const products = await getProducts();
    const lines = products.map(p => {
      const qty = (p.stock === null || p.stock === undefined) ? '♾️' : `${p.stock} шт.`;
      return `  ${p.emoji} #${p.id} ${p.name} — ${p.price} | склад: ${qty}`;
    }).join('\n');
    await send('🗂 Все товары:\n\n' + lines, MAIN_KEYBOARD);
    return;
  }

  if (text === '✏️ Изменить склад') {
    await send('✏️ Выберите товар:', await productInlineKeyboard('edit_stock'));
    return;
  }

  if (text === '💲 Изменить цену') {
    await send('💲 Выберите товар:', await productInlineKeyboard('edit_price'));
    return;
  }

  if (text === '➕ Добавить товар' || /^\/addproduct$/i.test(text)) {
    wizardState = { step: 'name', data: {} };
    await send('➕ Новый товар — Шаг 1 из 4\n\nВведите название товара:', cancelOnlyMarkup());
    return;
  }

  if (text === '🗑 Удалить товар') {
    await send('🗑 Выберите товар для удаления:', await productInlineKeyboard('delete_product'));
    return;
  }

  const delMatch = text.match(/^\/deleteproduct\s+(\d+)$/i);
  if (delMatch) {
    const id = parseInt(delMatch[1], 10);
    const products = await getProducts();
    const product  = products.find(p => p.id === id);
    if (!product) { await send(`❌ Товар #${id} не найден.`, MAIN_KEYBOARD); return; }
    await send(`🗑 Удалить "${product.name}" (#${id})?\nЭто действие нельзя отменить.`,
      { inline_keyboard: [[{ text:'✅ Да, удалить', callback_data:`confirm_delete:${id}` }, { text:'❌ Отмена', callback_data:'cancel_action' }]] });
    return;
  }

  const allMatch = text.match(/^\/setstock\s+all\s+(\d+)$/i);
  if (allMatch) {
    const qty = parseInt(allMatch[1], 10);
    const products = await getProducts();
    products.forEach(p => { p.stock = qty; });
    await saveProducts(products);
    await send(`✅ Всем товарам установлено ${qty} шт.`, MAIN_KEYBOARD);
    return;
  }

  const setMatch = text.match(/^\/setstock\s+(\d+)\s+([+\-]?\d+)$/);
  if (setMatch) {
    const id = parseInt(setMatch[1], 10);
    const rawQty = setMatch[2];
    const products = await getProducts();
    const product  = products.find(p => p.id === id);
    if (!product) { await send(`❌ Товар #${id} не найден.`, MAIN_KEYBOARD); return; }
    let newQty = rawQty.startsWith('+') || rawQty.startsWith('-')
      ? Math.max(0, (product.stock || 0) + parseInt(rawQty, 10))
      : Math.max(0, parseInt(rawQty, 10));
    product.stock = newQty;
    await saveProducts(products);
    const icon = newQty === 0 ? '❌' : newQty <= 5 ? '⚠️' : '✅';
    await send(`${icon} ${product.name}: остаток → ${newQty} шт.`, MAIN_KEYBOARD);
    return;
  }
}

/* ---- CALLBACK HANDLER ------------------------------------- */

async function handleCallback(cb) {
  const data = cb.data || '';
  console.log(`[cb] ${data}`);
  await answerCb(cb.id);

  if (data === 'cancel_action') {
    wizardState = null;
    await send('❌ Отменено.', MAIN_KEYBOARD);
    return;
  }

  if (data === 'skip_step') {
    if (wizardState) await handleWizardStep('/skip');
    return;
  }

  if (data.startsWith('edit_stock:')) {
    const id = parseInt(data.split(':')[1], 10);
    const products = await getProducts();
    const product  = products.find(p => p.id === id);
    if (!product) { await send('❌ Товар не найден.', MAIN_KEYBOARD); return; }
    const qty = (product.stock === null || product.stock === undefined) ? '♾️' : product.stock;
    wizardState = { step: 'editStock_qty', data: { id } };
    await send(`✏️ ${product.emoji} ${product.name}\nТекущий остаток: ${qty}\n\nВведите количество или выберите пресет:`, stockPresetsMarkup(id));
    return;
  }

  if (data.startsWith('stock_preset:')) {
    const [, idStr, preset] = data.split(':');
    const id = parseInt(idStr, 10);
    const products = await getProducts();
    const product  = products.find(p => p.id === id);
    if (!product) { await send('❌ Товар не найден.', MAIN_KEYBOARD); return; }
    let newQty;
    if (preset === 'inf') newQty = null;
    else if (preset.startsWith('+') || preset.startsWith('-')) newQty = Math.max(0, (product.stock || 0) + parseInt(preset, 10));
    else newQty = Math.max(0, parseInt(preset, 10));
    product.stock = newQty;
    await saveProducts(products);
    wizardState = null;
    const lbl  = newQty === null ? '♾️' : newQty;
    const icon = newQty === null ? '♾️' : newQty === 0 ? '❌' : newQty <= 5 ? '⚠️' : '✅';
    await send(`${icon} ${product.name}: остаток → ${lbl}`, MAIN_KEYBOARD);
    return;
  }

  if (data.startsWith('edit_price:')) {
    const id = parseInt(data.split(':')[1], 10);
    const products = await getProducts();
    const product  = products.find(p => p.id === id);
    if (!product) { await send('❌ Товар не найден.', MAIN_KEYBOARD); return; }
    wizardState = { step: 'editPrice_qty', data: { id } };
    await send(`💲 ${product.emoji} ${product.name}\nТекущая цена: ${product.price}\n\nВведите новую цену (например €14.90):`, cancelOnlyMarkup());
    return;
  }

  if (data.startsWith('delete_product:')) {
    const id = parseInt(data.split(':')[1], 10);
    const products = await getProducts();
    const product  = products.find(p => p.id === id);
    if (!product) { await send('❌ Товар не найден.', MAIN_KEYBOARD); return; }
    await send(`🗑 Удалить "${product.name}" (#${id})?\nЭто действие нельзя отменить.`,
      { inline_keyboard: [[{ text:'✅ Да, удалить', callback_data:`confirm_delete:${id}` }, { text:'❌ Отмена', callback_data:'cancel_action' }]] });
    return;
  }

  if (data.startsWith('confirm_delete:')) {
    const id = parseInt(data.split(':')[1], 10);
    const products = await getProducts();
    const product  = products.find(p => p.id === id);
    if (!product) { await send('❌ Товар не найден.', MAIN_KEYBOARD); return; }
    await deleteProduct(id);
    await send(`🗑 "${product.name}" (ID #${id}) удалён.`, MAIN_KEYBOARD);
    return;
  }
}

/* ---- WIZARD ----------------------------------------------- */

async function handleWizardStep(text) {
  const { step, data } = wizardState;

  if (step === 'editStock_qty') {
    const raw = text.trim();
    const products = await getProducts();
    const product  = products.find(p => p.id === data.id);
    if (!product) { wizardState = null; await send('❌ Товар не найден.', MAIN_KEYBOARD); return; }
    let newQty;
    if (!raw || raw === '∞' || raw.toLowerCase() === 'inf') newQty = null;
    else if (raw.startsWith('+') || raw.startsWith('-')) newQty = Math.max(0, (product.stock || 0) + parseInt(raw, 10));
    else {
      const n = parseInt(raw, 10);
      if (isNaN(n)) { await send('⚠️ Введите число или выберите пресет:', stockPresetsMarkup(data.id)); return; }
      newQty = Math.max(0, n);
    }
    product.stock = newQty;
    await saveProducts(products);
    wizardState = null;
    const lbl  = newQty === null ? '♾️' : newQty;
    const icon = newQty === null ? '♾️' : newQty === 0 ? '❌' : newQty <= 5 ? '⚠️' : '✅';
    await send(`${icon} ${product.name}: остаток → ${lbl}`, MAIN_KEYBOARD);
    return;
  }

  if (step === 'editPrice_qty') {
    const newPrice = text.trim();
    if (!newPrice) { await send('⚠️ Цена не может быть пустой:', cancelOnlyMarkup()); return; }
    const products = await getProducts();
    const product  = products.find(p => p.id === data.id);
    if (!product) { wizardState = null; await send('❌ Товар не найден.', MAIN_KEYBOARD); return; }
    product.price = newPrice;
    await saveProducts(products);
    wizardState = null;
    await send(`✅ ${product.emoji} ${product.name}: цена → ${newPrice}`, MAIN_KEYBOARD);
    return;
  }

  if (step === 'name') {
    if (!text.trim()) { await send('⚠️ Название не может быть пустым:', cancelOnlyMarkup()); return; }
    data.name = text.trim();
    wizardState.step = 'shortDesc';
    await send(`✅ Название: "${data.name}"\n\n➕ Шаг 2 из 4 — Краткое описание\n\nВведите текст или пропустите:`, skipCancelMarkup());
    return;
  }

  if (step === 'shortDesc') {
    data.shortDesc = /^\/skip$/i.test(text) ? '' : text.trim();
    wizardState.step = 'price';
    await send('➕ Шаг 3 из 4 — Цена\n\nПример: €14.90\n\nВведите цену или пропустите:', skipCancelMarkup());
    return;
  }

  if (step === 'price') {
    data.price = /^\/skip$/i.test(text) ? '' : text.trim();
    wizardState.step = 'stock';
    await send('➕ Шаг 4 из 4 — Количество на складе\n\nВведите число или нажмите «Безлимит»:',
      { inline_keyboard: [[{ text:'♾️ Безлимит', callback_data:'skip_step' }, { text:'❌ Отмена', callback_data:'cancel_action' }]] });
    return;
  }

  if (step === 'stock') {
    const raw = /^\/skip$/i.test(text) ? '' : text.trim();
    data.stock = raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0);
    const product = await createProduct(data);
    wizardState   = null;
    const lbl = product.stock === null ? '♾️ безлимит' : `${product.stock} шт.`;
    await send(`✅ Товар добавлен!\n\n${product.emoji} #${product.id} ${product.name}\nЦена: ${product.price || '—'}\nСклад: ${lbl}`, MAIN_KEYBOARD);
    return;
  }
}

/* ---- START ------------------------------------------------ */

async function main() {
  if (!BOT_TOKEN || !CHAT_ID || !JSONBIN_KEY || !JSONBIN_PRODUCTS_ID) {
    console.error('Missing required env vars: BOT_TOKEN, CHAT_ID, JSONBIN_KEY, JSONBIN_PRODUCTS_ID');
    process.exit(1);
  }
  console.log('🌿 GreenRoot bot started');
  await send('✅ GreenRoot бот запущен и работает 24/7!', MAIN_KEYBOARD);
  poll();
}

main();
