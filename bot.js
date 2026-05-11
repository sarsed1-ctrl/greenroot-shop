/* ============================================================
   bot.js — GreenRoot Telegram Bot
   Хостинг: Glitch.com  |  npm start → node bot.js
   Env vars (Glitch → Settings → Environment Variables):
     BOT_TOKEN   — токен бота
     CHAT_ID     — твой chat id
   ============================================================ */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CHAT_ID   = process.env.CHAT_ID   || '';
const PORT      = process.env.PORT      || 3000;
const TG        = `https://api.telegram.org/bot${BOT_TOKEN}`;

/* ---- FILE STORAGE (Glitch .data — persists across restarts) */

const DATA_DIR      = path.join(__dirname, '.data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE   = path.join(DATA_DIR, 'orders.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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

/* ---- DATA HELPERS ----------------------------------------- */

function getProducts() {
  try {
    if (fs.existsSync(PRODUCTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch {}
  return DEFAULT_PRODUCTS;
}

function saveProducts(products) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(products, null, 2));
}

function getOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  } catch {}
  return [];
}

function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

function createProduct({ name, shortDesc = '', price = '', stock = null, emoji = '' }) {
  const products = getProducts();
  const maxId    = products.reduce((m, p) => Math.max(m, p.id), 0);
  const idx      = products.length % PRODUCT_GRADIENTS.length;
  const product  = {
    id:       maxId + 1,
    emoji:    emoji || PRODUCT_EMOJIS[products.length % PRODUCT_EMOJIS.length],
    gradient: PRODUCT_GRADIENTS[idx],
    stock, name, shortDesc, price,
  };
  products.push(product);
  saveProducts(products);
  return product;
}

function deleteProductById(id) {
  saveProducts(getProducts().filter(p => p.id !== id));
}

/* ---- HTTP SERVER (UptimeRobot ping + products API) -------- */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS_HEADERS); res.end(); return; }

  /* GET /products — сайт загружает товары отсюда */
  if (req.method === 'GET' && req.url === '/products') {
    res.writeHead(200, CORS_HEADERS);
    res.end(JSON.stringify(getProducts()));
    return;
  }

  /* POST /products-save — сайт (admin panel) сохраняет товары */
  if (req.method === 'POST' && req.url === '/products-save') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const products = JSON.parse(body);
        if (Array.isArray(products)) saveProducts(products);
        res.writeHead(200, CORS_HEADERS);
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, CORS_HEADERS);
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  /* POST /orders — сайт отправляет новый заказ */
  if (req.method === 'POST' && req.url === '/orders') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const order  = JSON.parse(body);
        const orders = getOrders();
        orders.unshift({ ts: new Date().toISOString(), ...order });
        if (orders.length > 50) orders.length = 50;
        saveOrders(orders);
        res.writeHead(200, CORS_HEADERS);
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, CORS_HEADERS);
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  /* GET / — для UptimeRobot (просто 200 OK) */
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('🌿 GreenRoot bot is alive');
}).listen(PORT, () => console.log(`HTTP server on port ${PORT}`));

/* ---- TELEGRAM --------------------------------------------- */

let pollOffset  = 0;
let wizardState = null;

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

function productInlineKeyboard(prefix) {
  const products = getProducts();
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
    [{ text:'+1', callback_data:`sp:${id}:+1` }, { text:'+5', callback_data:`sp:${id}:+5` }, { text:'+10', callback_data:`sp:${id}:+10` }],
    [{ text:'-1', callback_data:`sp:${id}:-1` }, { text:'-5', callback_data:`sp:${id}:-5` }, { text:'0 (обнулить)', callback_data:`sp:${id}:0` }],
    [{ text:'♾️ Безлимит', callback_data:`sp:${id}:inf` }, { text:'❌ Отмена', callback_data:'cancel_action' }],
  ]};
}

const cancelMarkup   = { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_action' }]] };
const skipCancelMarkup = { inline_keyboard: [[{ text: '⏭ Пропустить', callback_data: 'skip_step' }, { text: '❌ Отмена', callback_data: 'cancel_action' }]] };

/* ---- POLLING ---------------------------------------------- */

async function poll() {
  try {
    const data = await (await fetch(`${TG}/getUpdates?offset=${pollOffset}&limit=20&timeout=25`)).json();
    if (data.ok) {
      for (const update of data.result) {
        pollOffset = update.update_id + 1;
        const msg = update.message;
        if (msg?.text && String(msg.chat.id) === String(CHAT_ID)) await handleMessage(msg.text.trim());
        const cb = update.callback_query;
        if (cb && String(cb.message?.chat?.id ?? cb.from?.id) === String(CHAT_ID)) await handleCallback(cb);
      }
    }
  } catch (err) { console.error('Poll error:', err.message); }
  setTimeout(poll, 1000);
}

/* ---- MESSAGE HANDLER -------------------------------------- */

async function handleMessage(text) {
  console.log(`[msg] ${text}`);

  if (/^\/cancel$/i.test(text)) { wizardState = null; await send('❌ Отменено.', MAIN_KEYBOARD); return; }
  if (wizardState) { await handleWizardStep(text); return; }

  if (text === '❓ Помощь' || /^\/help$/i.test(text)) {
    await send('📋 GreenRoot — управление\n\n📦 Склад · 🛒 Заказы · 🗂 Все товары · 💰 Цены\n✏️ Изменить склад · 💲 Изменить цену\n➕ Добавить товар · 🗑 Удалить товар\n\n/setstock [id] [кол-во|+n|-n]\n/setstock all [кол-во]\n/cancel — отменить мастер', MAIN_KEYBOARD);
    return;
  }

  if (text === '📦 Склад' || /^\/stock$/i.test(text)) {
    const lines = getProducts().map(p => {
      const s = p.stock;
      if (s === null || s === undefined) return `♾️ #${p.id} ${p.emoji} ${p.name}`;
      return `${s===0?'❌':s<=5?'⚠️':'✅'} #${p.id} ${p.emoji} ${p.name}: ${s} шт.`;
    }).join('\n');
    await send('📦 Остатки:\n\n' + lines, MAIN_KEYBOARD); return;
  }

  if (text === '🛒 Заказы' || /^\/orders$/i.test(text)) {
    const orders = getOrders();
    if (!orders.length) { await send('🛒 Заказов пока нет.', MAIN_KEYBOARD); return; }
    const lines = orders.slice(0,10).map((o,i) => {
      const d = new Date(o.ts);
      const date = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      return `${i+1}. ${date} — ${o.name} (${o.phone})\n   ${o.items.map(it=>`${it.name}×${it.qty}`).join(', ')}\n   Итого: ${o.total}`;
    }).join('\n\n');
    await send(`🛒 Последние ${Math.min(orders.length,10)} заказов:\n\n` + lines, MAIN_KEYBOARD); return;
  }

  if (text === '💰 Цены' || /^\/prices$/i.test(text)) {
    const lines = getProducts().map(p=>`${p.emoji} #${p.id} ${p.name}: ${p.price}`).join('\n');
    await send('💰 Цены:\n\n' + lines, MAIN_KEYBOARD); return;
  }

  if (text === '🗂 Все товары' || /^\/listproducts$/i.test(text)) {
    const lines = getProducts().map(p=>{
      const qty = p.stock===null||p.stock===undefined ? '♾️' : `${p.stock} шт.`;
      return `${p.emoji} #${p.id} ${p.name} — ${p.price} | ${qty}`;
    }).join('\n');
    await send('🗂 Все товары:\n\n' + lines, MAIN_KEYBOARD); return;
  }

  if (text === '✏️ Изменить склад') { await send('✏️ Выберите товар:', productInlineKeyboard('es')); return; }
  if (text === '💲 Изменить цену')  { await send('💲 Выберите товар:', productInlineKeyboard('ep')); return; }

  if (text === '➕ Добавить товар' || /^\/addproduct$/i.test(text)) {
    wizardState = { step: 'name', data: {} };
    await send('➕ Новый товар — Шаг 1 из 4\n\nВведите название:', cancelMarkup); return;
  }

  if (text === '🗑 Удалить товар') { await send('🗑 Выберите товар:', productInlineKeyboard('dp')); return; }

  const delM = text.match(/^\/deleteproduct\s+(\d+)$/i);
  if (delM) {
    const product = getProducts().find(p=>p.id===+delM[1]);
    if (!product) { await send('❌ Не найден.', MAIN_KEYBOARD); return; }
    await send(`🗑 Удалить "${product.name}"?`, { inline_keyboard: [[{ text:'✅ Да', callback_data:`cd:${product.id}` }, { text:'❌ Нет', callback_data:'cancel_action' }]] }); return;
  }

  const allM = text.match(/^\/setstock\s+all\s+(\d+)$/i);
  if (allM) {
    const products = getProducts(); products.forEach(p=>{ p.stock=+allM[1]; }); saveProducts(products);
    await send(`✅ Всем товарам: ${allM[1]} шт.`, MAIN_KEYBOARD); return;
  }

  const setM = text.match(/^\/setstock\s+(\d+)\s+([+\-]?\d+)$/);
  if (setM) {
    const products = getProducts(); const product = products.find(p=>p.id===+setM[1]);
    if (!product) { await send('❌ Не найден.', MAIN_KEYBOARD); return; }
    const raw = setM[2];
    product.stock = raw.startsWith('+')||raw.startsWith('-') ? Math.max(0,(product.stock||0)+parseInt(raw)) : Math.max(0,parseInt(raw));
    saveProducts(products);
    await send(`${product.stock===0?'❌':product.stock<=5?'⚠️':'✅'} ${product.name}: ${product.stock} шт.`, MAIN_KEYBOARD); return;
  }
}

/* ---- CALLBACK HANDLER ------------------------------------- */

async function handleCallback(cb) {
  const d = cb.data || ''; console.log(`[cb] ${d}`); await answerCb(cb.id);

  if (d === 'cancel_action') { wizardState = null; await send('❌ Отменено.', MAIN_KEYBOARD); return; }
  if (d === 'skip_step')     { if (wizardState) await handleWizardStep('/skip'); return; }

  /* edit stock — select product */
  if (d.startsWith('es:')) {
    const product = getProducts().find(p=>p.id===+d.split(':')[1]);
    if (!product) { await send('❌ Не найден.', MAIN_KEYBOARD); return; }
    wizardState = { step: 'editStock', data: { id: product.id } };
    const qty = product.stock===null||product.stock===undefined ? '♾️' : product.stock;
    await send(`✏️ ${product.emoji} ${product.name}\nОстаток: ${qty}\n\nВведите число или выберите:`, stockPresetsMarkup(product.id)); return;
  }

  /* stock preset */
  if (d.startsWith('sp:')) {
    const [,idStr,preset] = d.split(':');
    const products = getProducts(); const product = products.find(p=>p.id===+idStr);
    if (!product) { await send('❌ Не найден.', MAIN_KEYBOARD); return; }
    product.stock = preset==='inf' ? null : preset.startsWith('+')||preset.startsWith('-') ? Math.max(0,(product.stock||0)+parseInt(preset)) : Math.max(0,parseInt(preset));
    saveProducts(products); wizardState = null;
    const lbl = product.stock===null ? '♾️' : product.stock;
    await send(`${product.stock===null?'♾️':product.stock===0?'❌':product.stock<=5?'⚠️':'✅'} ${product.name}: ${lbl}`, MAIN_KEYBOARD); return;
  }

  /* edit price — select product */
  if (d.startsWith('ep:')) {
    const product = getProducts().find(p=>p.id===+d.split(':')[1]);
    if (!product) { await send('❌ Не найден.', MAIN_KEYBOARD); return; }
    wizardState = { step: 'editPrice', data: { id: product.id } };
    await send(`💲 ${product.emoji} ${product.name}\nЦена: ${product.price}\n\nВведите новую цену:`, cancelMarkup); return;
  }

  /* delete — select product */
  if (d.startsWith('dp:')) {
    const product = getProducts().find(p=>p.id===+d.split(':')[1]);
    if (!product) { await send('❌ Не найден.', MAIN_KEYBOARD); return; }
    await send(`🗑 Удалить "${product.name}" (#${product.id})?\nНельзя отменить.`,
      { inline_keyboard: [[{ text:'✅ Да, удалить', callback_data:`cd:${product.id}` }, { text:'❌ Нет', callback_data:'cancel_action' }]] }); return;
  }

  /* confirm delete */
  if (d.startsWith('cd:')) {
    const product = getProducts().find(p=>p.id===+d.split(':')[1]);
    if (!product) { await send('❌ Не найден.', MAIN_KEYBOARD); return; }
    deleteProductById(product.id);
    await send(`🗑 "${product.name}" удалён.`, MAIN_KEYBOARD); return;
  }
}

/* ---- WIZARD ----------------------------------------------- */

async function handleWizardStep(text) {
  const { step, data } = wizardState;

  if (step === 'editStock') {
    const raw = text.trim(); const products = getProducts(); const product = products.find(p=>p.id===data.id);
    if (!product) { wizardState=null; await send('❌ Не найден.', MAIN_KEYBOARD); return; }
    if (!raw||raw==='∞'||raw.toLowerCase()==='inf') product.stock=null;
    else if (raw.startsWith('+')||raw.startsWith('-')) product.stock=Math.max(0,(product.stock||0)+parseInt(raw));
    else { const n=parseInt(raw); if(isNaN(n)){ await send('⚠️ Введите число:', stockPresetsMarkup(data.id)); return; } product.stock=Math.max(0,n); }
    saveProducts(products); wizardState=null;
    const lbl = product.stock===null?'♾️':product.stock;
    await send(`${product.stock===null?'♾️':product.stock===0?'❌':product.stock<=5?'⚠️':'✅'} ${product.name}: ${lbl}`, MAIN_KEYBOARD); return;
  }

  if (step === 'editPrice') {
    if (!text.trim()) { await send('⚠️ Цена не может быть пустой:', cancelMarkup); return; }
    const products = getProducts(); const product = products.find(p=>p.id===data.id);
    if (!product) { wizardState=null; await send('❌ Не найден.', MAIN_KEYBOARD); return; }
    product.price = text.trim(); saveProducts(products); wizardState=null;
    await send(`✅ ${product.emoji} ${product.name}: цена → ${product.price}`, MAIN_KEYBOARD); return;
  }

  if (step === 'name') {
    if (!text.trim()) { await send('⚠️ Название не может быть пустым:', cancelMarkup); return; }
    data.name = text.trim(); wizardState.step='shortDesc';
    await send(`✅ "${data.name}"\n\nШаг 2 из 4 — Краткое описание:`, skipCancelMarkup); return;
  }

  if (step === 'shortDesc') {
    data.shortDesc = /^\/skip$/i.test(text)?'':text.trim(); wizardState.step='price';
    await send('Шаг 3 из 4 — Цена (например €14.90):', skipCancelMarkup); return;
  }

  if (step === 'price') {
    data.price = /^\/skip$/i.test(text)?'':text.trim(); wizardState.step='stock';
    await send('Шаг 4 из 4 — Остаток на складе:',
      { inline_keyboard: [[{ text:'♾️ Безлимит', callback_data:'skip_step' }, { text:'❌ Отмена', callback_data:'cancel_action' }]] }); return;
  }

  if (step === 'stock') {
    const raw = /^\/skip$/i.test(text)?'':text.trim();
    data.stock = raw===''?null:Math.max(0,parseInt(raw)||0);
    const product = createProduct(data); wizardState=null;
    await send(`✅ Добавлен!\n${product.emoji} #${product.id} ${product.name}\n${product.price||'—'} | ${product.stock===null?'♾️':product.stock+' шт.'}`, MAIN_KEYBOARD); return;
  }
}

/* ---- START ------------------------------------------------ */

if (!BOT_TOKEN || !CHAT_ID) { console.error('Нужны BOT_TOKEN и CHAT_ID в переменных окружения'); process.exit(1); }
console.log('🌿 GreenRoot bot starting...');
send('✅ GreenRoot бот запущен и работает 24/7!', MAIN_KEYBOARD).then(() => poll());
