/* ============================================================
   bot.js — GreenRoot Telegram Bot
   Запускается через GitHub Actions каждые 5 минут.
   Данные хранятся в data/ внутри репозитория.
   ============================================================ */

const fs   = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CHAT_ID   = process.env.CHAT_ID   || '';
const TG        = `https://api.telegram.org/bot${BOT_TOKEN}`;

const DATA        = path.join(__dirname, 'data');
const P_FILE      = path.join(DATA, 'products.json');
const O_FILE      = path.join(DATA, 'orders.json');
const STATE_FILE  = path.join(DATA, 'bot-state.json');

const RUN_SECONDS = 230; /* ~4 мин, Actions timeout = 6 мин */

/* ---- DATA ------------------------------------------------- */

const PRODUCT_GRADIENTS = ['#e8f4e8','#f3eaff','#ebf2e6','#fde8e8','#e8edf8','#e6f4f0','#ecf2e8','#fef3e8','#e8f0fe','#fde8f3'];
const PRODUCT_EMOJIS    = ['🌱','🌺','🪴','🍯','⚗️','🌿','🧪','🌸','🍃','💧'];

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getProducts()      { return readJSON(P_FILE, []); }
function saveProducts(p)    { writeJSON(P_FILE, p); }
function getOrders()        { return readJSON(O_FILE, []); }
function saveOrders(o)      { writeJSON(O_FILE, o); }

function loadState()  { return readJSON(STATE_FILE, { offset: 0, wizard: null }); }
function saveState(s) { writeJSON(STATE_FILE, s); }

function createProduct({ name, shortDesc='', price='', stock=null, emoji='' }) {
  const products = getProducts();
  const maxId    = products.reduce((m,p) => Math.max(m,p.id), 0);
  const idx      = products.length % PRODUCT_GRADIENTS.length;
  const product  = { id: maxId+1, emoji: emoji||PRODUCT_EMOJIS[products.length % PRODUCT_EMOJIS.length], gradient: PRODUCT_GRADIENTS[idx], stock, name, shortDesc, price };
  products.push(product);
  saveProducts(products);
  return product;
}

/* ---- TELEGRAM --------------------------------------------- */

async function tg(method, body={}) {
  const res = await fetch(`${TG}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}

async function send(text, replyMarkup=null) {
  const body = { chat_id: CHAT_ID, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return tg('sendMessage', body);
}

async function answerCb(id) { return tg('answerCallbackQuery', { callback_query_id: id }); }

/* ---- KEYBOARDS -------------------------------------------- */

const MAIN_KB = {
  keyboard: [
    [{ text:'📦 Склад' },         { text:'🛒 Заказы' }],
    [{ text:'🗂 Все товары' },     { text:'💰 Цены' }],
    [{ text:'✏️ Изменить склад' }, { text:'💲 Изменить цену' }],
    [{ text:'➕ Добавить товар' }, { text:'🗑 Удалить товар' }],
    [{ text:'❓ Помощь' }],
  ],
  resize_keyboard: true, persistent: true,
};

function productKb(prefix) {
  const rows = [];
  const products = getProducts();
  for (let i = 0; i < products.length; i += 2) {
    const row = [{ text:`${products[i].emoji} #${products[i].id} ${products[i].name}`, callback_data:`${prefix}:${products[i].id}` }];
    if (products[i+1]) row.push({ text:`${products[i+1].emoji} #${products[i+1].id} ${products[i+1].name}`, callback_data:`${prefix}:${products[i+1].id}` });
    rows.push(row);
  }
  rows.push([{ text:'❌ Отмена', callback_data:'cancel' }]);
  return { inline_keyboard: rows };
}

function stockKb(id) {
  return { inline_keyboard: [
    [{ text:'+1', callback_data:`sp:${id}:+1` },{ text:'+5', callback_data:`sp:${id}:+5` },{ text:'+10', callback_data:`sp:${id}:+10` }],
    [{ text:'-1', callback_data:`sp:${id}:-1` },{ text:'-5', callback_data:`sp:${id}:-5` },{ text:'Обнулить', callback_data:`sp:${id}:0` }],
    [{ text:'♾️ Безлимит', callback_data:`sp:${id}:inf` },{ text:'❌ Отмена', callback_data:'cancel' }],
  ]};
}

const cancelKb    = { inline_keyboard: [[{ text:'❌ Отмена', callback_data:'cancel' }]] };
const skipKb      = { inline_keyboard: [[{ text:'⏭ Пропустить', callback_data:'skip' },{ text:'❌ Отмена', callback_data:'cancel' }]] };
const unlimSkipKb = { inline_keyboard: [[{ text:'♾️ Безлимит', callback_data:'skip' },{ text:'❌ Отмена', callback_data:'cancel' }]] };

/* ---- MESSAGE HANDLER -------------------------------------- */

async function handleMessage(text, state) {
  if (/^\/cancel$/i.test(text)) { state.wizard=null; await send('❌ Отменено.', MAIN_KB); return; }
  if (state.wizard) { await handleWizard(text, state); return; }

  if (text==='❓ Помощь'||/^\/help$/i.test(text)) {
    await send('📋 GreenRoot\n\n📦 Склад · 🛒 Заказы · 🗂 Все товары · 💰 Цены\n✏️ Изменить склад · 💲 Изменить цену\n➕ Добавить товар · 🗑 Удалить товар\n\n/setstock [id] [кол|+n|-n]\n/setstock all [кол]\n/cancel — отмена мастера', MAIN_KB);
    return;
  }

  if (text==='📦 Склад'||/^\/stock$/i.test(text)) {
    const lines = getProducts().map(p => {
      const s = p.stock;
      if (s===null||s===undefined) return `♾️ #${p.id} ${p.emoji} ${p.name}`;
      return `${s===0?'❌':s<=5?'⚠️':'✅'} #${p.id} ${p.emoji} ${p.name}: ${s} шт.`;
    }).join('\n');
    await send('📦 Остатки:\n\n'+lines, MAIN_KB); return;
  }

  if (text==='🛒 Заказы'||/^\/orders$/i.test(text)) {
    await send('🛒 Заказы приходят напрямую в этот чат как сообщения — прокрути вверх чтобы увидеть их.\n\n📌 Каждый новый заказ появляется здесь сразу после оформления.', MAIN_KB);
    return;
  }

  if (text==='💰 Цены'||/^\/prices$/i.test(text)) {
    await send('💰 Цены:\n\n'+getProducts().map(p=>`${p.emoji} #${p.id} ${p.name}: ${p.price}`).join('\n'), MAIN_KB); return;
  }

  if (text==='🗂 Все товары'||/^\/listproducts$/i.test(text)) {
    await send('🗂 Все товары:\n\n'+getProducts().map(p=>{
      const q=p.stock===null||p.stock===undefined?'♾️':`${p.stock} шт.`;
      return `${p.emoji} #${p.id} ${p.name} — ${p.price} | ${q}`;
    }).join('\n'), MAIN_KB); return;
  }

  if (text==='✏️ Изменить склад') { await send('✏️ Выберите товар:', productKb('es')); return; }
  if (text==='💲 Изменить цену')  { await send('💲 Выберите товар:', productKb('ep')); return; }
  if (text==='➕ Добавить товар'||/^\/addproduct$/i.test(text)) {
    state.wizard={step:'name',data:{}}; await send('➕ Новый товар — Шаг 1 из 4\n\nВведите название:', cancelKb); return;
  }
  if (text==='🗑 Удалить товар') { await send('🗑 Выберите товар:', productKb('dp')); return; }

  const delM=text.match(/^\/deleteproduct\s+(\d+)$/i);
  if (delM) {
    const p=getProducts().find(p=>p.id===+delM[1]);
    if (!p) { await send('❌ Не найден.', MAIN_KB); return; }
    await send(`🗑 Удалить "${p.name}"?\nНельзя отменить.`, { inline_keyboard:[[{ text:'✅ Да', callback_data:`cd:${p.id}` },{ text:'❌ Нет', callback_data:'cancel' }]] });
    return;
  }

  const allM=text.match(/^\/setstock\s+all\s+(\d+)$/i);
  if (allM) {
    const products=getProducts(); products.forEach(p=>{ p.stock=+allM[1]; }); saveProducts(products);
    await send(`✅ Всем товарам: ${allM[1]} шт.`, MAIN_KB); return;
  }

  const setM=text.match(/^\/setstock\s+(\d+)\s+([+\-]?\d+)$/);
  if (setM) {
    const products=getProducts(); const p=products.find(p=>p.id===+setM[1]);
    if (!p) { await send('❌ Не найден.', MAIN_KB); return; }
    const raw=setM[2];
    p.stock=raw.startsWith('+')||raw.startsWith('-')?Math.max(0,(p.stock||0)+parseInt(raw)):Math.max(0,parseInt(raw));
    saveProducts(products);
    await send(`${p.stock===0?'❌':p.stock<=5?'⚠️':'✅'} ${p.name}: ${p.stock} шт.`, MAIN_KB); return;
  }
}

/* ---- CALLBACK HANDLER ------------------------------------- */

async function handleCallback(data, state) {
  if (data==='cancel') { state.wizard=null; await send('❌ Отменено.', MAIN_KB); return; }
  if (data==='skip')   { if (state.wizard) await handleWizard('/skip', state); return; }

  if (data.startsWith('es:')) {
    const p=getProducts().find(p=>p.id===+data.split(':')[1]);
    if (!p) { await send('❌ Не найден.', MAIN_KB); return; }
    state.wizard={step:'editStock',data:{id:p.id}};
    await send(`✏️ ${p.emoji} ${p.name}\nОстаток: ${p.stock===null||p.stock===undefined?'♾️':p.stock}\n\nВведите число или выберите:`, stockKb(p.id)); return;
  }

  if (data.startsWith('sp:')) {
    const [,idStr,preset]=data.split(':');
    const products=getProducts(); const p=products.find(p=>p.id===+idStr);
    if (!p) { await send('❌ Не найден.', MAIN_KB); return; }
    p.stock=preset==='inf'?null:preset.startsWith('+')||preset.startsWith('-')?Math.max(0,(p.stock||0)+parseInt(preset)):Math.max(0,parseInt(preset));
    saveProducts(products); state.wizard=null;
    await send(`${p.stock===null?'♾️':p.stock===0?'❌':p.stock<=5?'⚠️':'✅'} ${p.name}: ${p.stock===null?'♾️':p.stock}`, MAIN_KB); return;
  }

  if (data.startsWith('ep:')) {
    const p=getProducts().find(p=>p.id===+data.split(':')[1]);
    if (!p) { await send('❌ Не найден.', MAIN_KB); return; }
    state.wizard={step:'editPrice',data:{id:p.id}};
    await send(`💲 ${p.emoji} ${p.name}\nЦена: ${p.price}\n\nВведите новую цену:`, cancelKb); return;
  }

  if (data.startsWith('dp:')) {
    const p=getProducts().find(p=>p.id===+data.split(':')[1]);
    if (!p) { await send('❌ Не найден.', MAIN_KB); return; }
    await send(`🗑 Удалить "${p.name}" (#${p.id})?\nНельзя отменить.`,
      { inline_keyboard:[[{ text:'✅ Да, удалить', callback_data:`cd:${p.id}` },{ text:'❌ Нет', callback_data:'cancel' }]] }); return;
  }

  if (data.startsWith('cd:')) {
    const p=getProducts().find(p=>p.id===+data.split(':')[1]);
    if (!p) { await send('❌ Не найден.', MAIN_KB); return; }
    saveProducts(getProducts().filter(x=>x.id!==p.id));
    await send(`🗑 "${p.name}" удалён.`, MAIN_KB); return;
  }
}

/* ---- WIZARD ----------------------------------------------- */

async function handleWizard(text, state) {
  const { step, data } = state.wizard;

  if (step==='editStock') {
    const raw=text.trim(); const products=getProducts(); const p=products.find(p=>p.id===data.id);
    if (!p) { state.wizard=null; await send('❌ Не найден.', MAIN_KB); return; }
    if (!raw||raw==='∞'||raw.toLowerCase()==='inf') p.stock=null;
    else if (raw.startsWith('+')||raw.startsWith('-')) p.stock=Math.max(0,(p.stock||0)+parseInt(raw));
    else { const n=parseInt(raw); if(isNaN(n)){ await send('⚠️ Введите число:', stockKb(data.id)); return; } p.stock=Math.max(0,n); }
    saveProducts(products); state.wizard=null;
    await send(`${p.stock===null?'♾️':p.stock===0?'❌':p.stock<=5?'⚠️':'✅'} ${p.name}: ${p.stock===null?'♾️':p.stock}`, MAIN_KB); return;
  }

  if (step==='editPrice') {
    if (!text.trim()) { await send('⚠️ Введите цену:', cancelKb); return; }
    const products=getProducts(); const p=products.find(p=>p.id===data.id);
    if (!p) { state.wizard=null; await send('❌ Не найден.', MAIN_KB); return; }
    p.price=text.trim(); saveProducts(products); state.wizard=null;
    await send(`✅ ${p.emoji} ${p.name}: цена → ${p.price}`, MAIN_KB); return;
  }

  if (step==='name') {
    if (!text.trim()) { await send('⚠️ Название не может быть пустым:', cancelKb); return; }
    data.name=text.trim(); state.wizard.step='shortDesc';
    await send(`✅ "${data.name}"\n\nШаг 2 из 4 — Краткое описание:`, skipKb); return;
  }
  if (step==='shortDesc') {
    data.shortDesc=/^\/skip$/i.test(text)?'':text.trim(); state.wizard.step='price';
    await send('Шаг 3 из 4 — Цена (например €14.90):', skipKb); return;
  }
  if (step==='price') {
    data.price=/^\/skip$/i.test(text)?'':text.trim(); state.wizard.step='stock';
    await send('Шаг 4 из 4 — Остаток на складе:', unlimSkipKb); return;
  }
  if (step==='stock') {
    const raw=/^\/skip$/i.test(text)?'':text.trim();
    data.stock=raw===''?null:Math.max(0,parseInt(raw)||0);
    const p=createProduct(data); state.wizard=null;
    await send(`✅ Добавлен!\n${p.emoji} #${p.id} ${p.name}\n${p.price||'—'} | ${p.stock===null?'♾️':p.stock+' шт.'}`, MAIN_KB); return;
  }
}

/* ---- MAIN LOOP -------------------------------------------- */

async function main() {
  if (!BOT_TOKEN||!CHAT_ID) { console.error('Нужны BOT_TOKEN и CHAT_ID'); process.exit(1); }

  const state   = loadState();
  const endTime = Date.now() + RUN_SECONDS * 1000;

  console.log(`🌿 Bot started, offset=${state.offset}, running ${RUN_SECONDS}s`);

  while (Date.now() < endTime) {
    try {
      const remaining = Math.floor((endTime - Date.now()) / 1000);
      const timeout   = Math.min(20, remaining - 2);
      if (timeout <= 0) break;

      const res  = await fetch(`${TG}/getUpdates?offset=${state.offset}&limit=20&timeout=${timeout}`);
      const data = await res.json();

      if (!data.ok) { console.error('TG error:', data.description); await sleep(3000); continue; }

      for (const update of data.result) {
        state.offset = update.update_id + 1;

        const msg = update.message;
        if (msg?.text && String(msg.chat.id)===String(CHAT_ID)) {
          await handleMessage(msg.text.trim(), state);
        }

        const cb = update.callback_query;
        if (cb && String(cb.message?.chat?.id??cb.from?.id)===String(CHAT_ID)) {
          await answerCb(cb.id);
          await handleCallback(cb.data||'', state);
        }

        saveState(state);
      }
    } catch (err) {
      console.error('Loop error:', err.message);
      await sleep(3000);
    }
  }

  saveState(state);
  console.log('✅ Run complete, state saved');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main();
