/* ============================================================
   bot.js — GreenRoot Telegram Bot (GitHub Actions)
   ============================================================ */

const fs   = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const CHAT_ID   = process.env.CHAT_ID   || '';
const TG        = `https://api.telegram.org/bot${BOT_TOKEN}`;
const DATA      = path.join(__dirname, 'data');
const P_FILE    = path.join(DATA, 'products.json');
const STATE_FILE= path.join(DATA, 'bot-state.json');
const RUN_MS    = 230_000;

/* ---- DATA ------------------------------------------------- */

const GRADIENTS = ['#e8f4e8','#f3eaff','#ebf2e6','#fde8e8','#e8edf8','#e6f4f0','#ecf2e8','#fef3e8'];
const EMOJIS    = ['🌱','🌺','🪴','🍯','⚗️','🌿','🧪','🌸','🍃','💧'];

const DEFAULTS = [
  { id:1, emoji:'🌱', gradient:'#e8f4e8', stock:null, name:'Terra GROW',              price:'€14.90', shortDesc:'Balanced nitrogen-rich formula for vigorous vegetative growth.' },
  { id:2, emoji:'🌺', gradient:'#f3eaff', stock:null, name:'Terra BLOOM',             price:'€14.90', shortDesc:'Phosphorus-potassium rich formula to fuel prolific flowering.' },
  { id:3, emoji:'🪴', gradient:'#ebf2e6', stock:null, name:'Plagron LightMix',        price:'€18.50', shortDesc:'Airy peat-based substrate with gentle starter nutrients.' },
  { id:4, emoji:'🍯', gradient:'#fde8e8', stock:null, name:'Sugar Royal',             price:'€16.90', shortDesc:'Carbohydrate supplement for richer flavour and stronger yields.' },
  { id:5, emoji:'⚗️', gradient:'#e8edf8', stock:null, name:'PK 13-14',               price:'€12.50', shortDesc:'Concentrated phosphorus-potassium booster for peak bloom.' },
  { id:6, emoji:'🌿', gradient:'#e6f4f0', stock:null, name:'AZOS Extreme Gardening', price:'€24.90', shortDesc:'Beneficial nitrogen-fixing bacteria for explosive growth.' },
  { id:7, emoji:'🧪', gradient:'#ecf2e8', stock:null, name:'PH+ / PH-',              price:'€8.90',  shortDesc:'Precise pH adjustment for optimal nutrient uptake.' },
];

function rj(file, fallback) { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch { return fallback; } }
function wj(file, data)     { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function getProducts()   { const p = rj(P_FILE,[]); return p.length ? p : DEFAULTS; }
function saveProducts(p) { wj(P_FILE, p); }
function loadState()     { return rj(STATE_FILE, { offset:0, wizard:null, fresh:true }); }
function saveState(s)    { wj(STATE_FILE, s); }

function createProduct({ name, shortDesc='', price='', stock=null, emoji='' }) {
  const products = getProducts();
  const maxId    = products.reduce((m,p) => Math.max(m,p.id), 0);
  const idx      = products.length % GRADIENTS.length;
  const p = { id:maxId+1, emoji:emoji||EMOJIS[products.length%EMOJIS.length], gradient:GRADIENTS[idx], stock, name, shortDesc, price };
  products.push(p); saveProducts(products); return p;
}

/* ---- TELEGRAM --------------------------------------------- */

async function tg(method, body={}) {
  try {
    const r = await fetch(`${TG}/${method}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    return r.json();
  } catch(e) { console.error(`tg ${method} error:`, e.message); return {ok:false}; }
}

async function send(text, markup=null) {
  const body = { chat_id:CHAT_ID, text };
  if (markup) body.reply_markup = markup;
  return tg('sendMessage', body);
}

async function answerCb(id) { return tg('answerCallbackQuery', { callback_query_id:id }); }

/* ---- KEYBOARDS -------------------------------------------- */

const MAIN_KB = {
  keyboard: [
    [{text:'📦 Склад'},{text:'🛒 Заказы'}],
    [{text:'🗂 Все товары'},{text:'💰 Цены'}],
    [{text:'✏️ Изменить склад'},{text:'💲 Изменить цену'}],
    [{text:'➕ Добавить товар'},{text:'🗑 Удалить товар'}],
    [{text:'❓ Помощь'}],
  ],
  resize_keyboard:true, persistent:true,
};

function productKb(prefix) {
  const rows = [];
  const list = getProducts();
  for (let i=0; i<list.length; i+=2) {
    const row = [{text:`${list[i].emoji} #${list[i].id} ${list[i].name}`, callback_data:`${prefix}:${list[i].id}`}];
    if (list[i+1]) row.push({text:`${list[i+1].emoji} #${list[i+1].id} ${list[i+1].name}`, callback_data:`${prefix}:${list[i+1].id}`});
    rows.push(row);
  }
  rows.push([{text:'❌ Отмена', callback_data:'x'}]);
  return {inline_keyboard:rows};
}

function stockKb(id) {
  return {inline_keyboard:[
    [{text:'+1',callback_data:`sp:${id}:+1`},{text:'+5',callback_data:`sp:${id}:+5`},{text:'+10',callback_data:`sp:${id}:+10`}],
    [{text:'-1',callback_data:`sp:${id}:-1`},{text:'-5',callback_data:`sp:${id}:-5`},{text:'Обнулить',callback_data:`sp:${id}:0`}],
    [{text:'♾️ Безлимит',callback_data:`sp:${id}:inf`},{text:'❌ Отмена',callback_data:'x'}],
  ]};
}

const xKb   = {inline_keyboard:[[{text:'❌ Отмена',callback_data:'x'}]]};
const skipKb = {inline_keyboard:[[{text:'⏭ Пропустить',callback_data:'skip'},{text:'❌ Отмена',callback_data:'x'}]]};
const unlKb  = {inline_keyboard:[[{text:'♾️ Безлимит',callback_data:'skip'},{text:'❌ Отмена',callback_data:'x'}]]};

/* ---- HANDLERS --------------------------------------------- */

async function onMessage(text, state) {
  if (/^\/cancel$/i.test(text)) { state.wizard=null; await send('❌ Отменено.', MAIN_KB); return; }
  if (state.wizard) { await onWizard(text, state); return; }

  if (text==='❓ Помощь'||/^\/help$/i.test(text)) {
    await send('📋 GreenRoot\n\n📦 Склад · 🛒 Заказы · 🗂 Все товары · 💰 Цены\n✏️ Изменить склад · 💲 Изменить цену\n➕ Добавить товар · 🗑 Удалить товар\n\n/setstock [id] [кол|+n|-n]\n/setstock all [кол]\n/cancel', MAIN_KB);
    return;
  }

  if (text==='📦 Склад'||/^\/stock$/i.test(text)) {
    const lines = getProducts().map(p=>{
      const s=p.stock;
      if (s===null||s===undefined) return `♾️ #${p.id} ${p.emoji} ${p.name}`;
      return `${s===0?'❌':s<=5?'⚠️':'✅'} #${p.id} ${p.emoji} ${p.name}: ${s} шт.`;
    }).join('\n');
    await send('📦 Остатки:\n\n'+lines, MAIN_KB); return;
  }

  if (text==='🛒 Заказы') {
    await send('🛒 Заказы приходят в этот чат как сообщения — прокрути вверх чтобы их увидеть.\n\nКаждый новый заказ появляется здесь сразу после оформления.', MAIN_KB); return;
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
    state.wizard={step:'name',data:{}}; await send('➕ Новый товар — Шаг 1 из 4\n\nВведите название:', xKb); return;
  }

  if (text==='🗑 Удалить товар') { await send('🗑 Выберите товар:', productKb('dp')); return; }

  const dm=text.match(/^\/deleteproduct\s+(\d+)$/i);
  if (dm) {
    const p=getProducts().find(p=>p.id===+dm[1]);
    if (!p) { await send('❌ Не найден.', MAIN_KB); return; }
    await send(`🗑 Удалить "${p.name}"?\nНельзя отменить.`, {inline_keyboard:[[{text:'✅ Да',callback_data:`cd:${p.id}`},{text:'❌ Нет',callback_data:'x'}]]});
    return;
  }

  const am=text.match(/^\/setstock\s+all\s+(\d+)$/i);
  if (am) {
    const list=getProducts(); list.forEach(p=>{p.stock=+am[1];}); saveProducts(list);
    await send(`✅ Всем товарам: ${am[1]} шт.`, MAIN_KB); return;
  }

  const sm=text.match(/^\/setstock\s+(\d+)\s+([+\-]?\d+)$/);
  if (sm) {
    const list=getProducts(); const p=list.find(p=>p.id===+sm[1]);
    if (!p) { await send('❌ Не найден.', MAIN_KB); return; }
    const raw=sm[2];
    p.stock=raw.startsWith('+')||raw.startsWith('-')?Math.max(0,(p.stock||0)+parseInt(raw)):Math.max(0,parseInt(raw));
    saveProducts(list);
    await send(`${p.stock===0?'❌':p.stock<=5?'⚠️':'✅'} ${p.name}: ${p.stock} шт.`, MAIN_KB); return;
  }
}

async function onCallback(data, state) {
  if (data==='x')    { state.wizard=null; await send('❌ Отменено.', MAIN_KB); return; }
  if (data==='skip') { if (state.wizard) await onWizard('/skip', state); return; }

  if (data.startsWith('es:')) {
    const p=getProducts().find(p=>p.id===+data.split(':')[1]);
    if (!p){await send('❌',MAIN_KB);return;}
    state.wizard={step:'editStock',data:{id:p.id}};
    const q=p.stock===null||p.stock===undefined?'♾️':p.stock;
    await send(`✏️ ${p.emoji} ${p.name}\nОстаток: ${q}\n\nВведите число или нажмите кнопку:`, stockKb(p.id)); return;
  }

  if (data.startsWith('sp:')) {
    const [,id,preset]=data.split(':');
    const list=getProducts(); const p=list.find(p=>p.id===+id);
    if (!p){await send('❌',MAIN_KB);return;}
    p.stock=preset==='inf'?null:preset.startsWith('+')||preset.startsWith('-')?Math.max(0,(p.stock||0)+parseInt(preset)):Math.max(0,parseInt(preset));
    saveProducts(list); state.wizard=null;
    const lbl=p.stock===null?'♾️':p.stock;
    await send(`${p.stock===null?'♾️':p.stock===0?'❌':p.stock<=5?'⚠️':'✅'} ${p.name}: ${lbl}`, MAIN_KB); return;
  }

  if (data.startsWith('ep:')) {
    const p=getProducts().find(p=>p.id===+data.split(':')[1]);
    if (!p){await send('❌',MAIN_KB);return;}
    state.wizard={step:'editPrice',data:{id:p.id}};
    await send(`💲 ${p.emoji} ${p.name}\nЦена: ${p.price}\n\nВведите новую цену:`, xKb); return;
  }

  if (data.startsWith('dp:')) {
    const p=getProducts().find(p=>p.id===+data.split(':')[1]);
    if (!p){await send('❌',MAIN_KB);return;}
    await send(`🗑 Удалить "${p.name}" (#${p.id})?\nНельзя отменить.`,
      {inline_keyboard:[[{text:'✅ Да, удалить',callback_data:`cd:${p.id}`},{text:'❌ Нет',callback_data:'x'}]]}); return;
  }

  if (data.startsWith('cd:')) {
    const p=getProducts().find(p=>p.id===+data.split(':')[1]);
    if (!p){await send('❌',MAIN_KB);return;}
    saveProducts(getProducts().filter(x=>x.id!==p.id));
    await send(`🗑 "${p.name}" удалён.`, MAIN_KB); return;
  }
}

async function onWizard(text, state) {
  const {step,data}=state.wizard;

  if (step==='editStock') {
    const raw=text.trim(); const list=getProducts(); const p=list.find(p=>p.id===data.id);
    if (!p){state.wizard=null;await send('❌',MAIN_KB);return;}
    if (!raw||raw==='∞'||raw.toLowerCase()==='inf') p.stock=null;
    else if (raw.startsWith('+')||raw.startsWith('-')) p.stock=Math.max(0,(p.stock||0)+parseInt(raw));
    else { const n=parseInt(raw); if(isNaN(n)){await send('⚠️ Введите число:',stockKb(data.id));return;} p.stock=Math.max(0,n); }
    saveProducts(list); state.wizard=null;
    await send(`${p.stock===null?'♾️':p.stock===0?'❌':p.stock<=5?'⚠️':'✅'} ${p.name}: ${p.stock===null?'♾️':p.stock}`, MAIN_KB); return;
  }

  if (step==='editPrice') {
    if (!text.trim()){await send('⚠️ Введите цену:',xKb);return;}
    const list=getProducts(); const p=list.find(p=>p.id===data.id);
    if (!p){state.wizard=null;await send('❌',MAIN_KB);return;}
    p.price=text.trim(); saveProducts(list); state.wizard=null;
    await send(`✅ ${p.emoji} ${p.name}: цена → ${p.price}`, MAIN_KB); return;
  }

  if (step==='name')      { if(!text.trim()){await send('⚠️ Пустое название:',xKb);return;} data.name=text.trim(); state.wizard.step='shortDesc'; await send(`✅ "${data.name}"\n\nШаг 2 из 4 — Краткое описание:`,skipKb); return; }
  if (step==='shortDesc') { data.shortDesc=/^\/skip$/i.test(text)?'':text.trim(); state.wizard.step='price';    await send('Шаг 3 из 4 — Цена (например €14.90):',skipKb); return; }
  if (step==='price')     { data.price=/^\/skip$/i.test(text)?'':text.trim();     state.wizard.step='stock';    await send('Шаг 4 из 4 — Остаток:',unlKb); return; }
  if (step==='stock') {
    const raw=/^\/skip$/i.test(text)?'':text.trim();
    data.stock=raw===''?null:Math.max(0,parseInt(raw)||0);
    const p=createProduct(data); state.wizard=null;
    await send(`✅ Добавлен!\n${p.emoji} #${p.id} ${p.name}\n${p.price||'—'} | ${p.stock===null?'♾️':p.stock+' шт.'}`, MAIN_KB); return;
  }
}

/* ---- MAIN ------------------------------------------------- */

async function main() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error('❌ BOT_TOKEN и CHAT_ID не заданы в переменных окружения');
    process.exit(1);
  }

  console.log('🌿 GreenRoot bot starting...');

  /* Проверка токена */
  const me = await tg('getMe');
  if (!me.ok) { console.error('❌ Неверный BOT_TOKEN:', me.description); process.exit(1); }
  console.log(`✅ Bot: @${me.result.username}`);

  const state = loadState();

  /* Первый запуск — пропустить старые сообщения */
  if (state.fresh || state.offset === 0) {
    console.log('📍 First run — skipping old messages...');
    const r = await tg('getUpdates', { offset:-1, limit:1 });
    if (r.ok && r.result.length > 0) {
      state.offset = r.result[r.result.length-1].update_id + 1;
    }
    state.fresh = false;
    saveState(state);
    await send('✅ GreenRoot бот активен!', MAIN_KB);
  }

  console.log(`🔄 Polling from offset ${state.offset}...`);

  const endTime = Date.now() + RUN_MS;

  while (Date.now() < endTime) {
    const remaining = Math.floor((endTime - Date.now()) / 1000);
    const timeout   = Math.min(20, remaining - 3);
    if (timeout <= 0) break;

    let data;
    try {
      const r = await fetch(`${TG}/getUpdates?offset=${state.offset}&limit=20&timeout=${timeout}`);
      data = await r.json();
    } catch(e) { console.error('Fetch error:', e.message); await sleep(3000); continue; }

    if (!data.ok) { console.error('TG error:', data.description); await sleep(3000); continue; }

    for (const upd of data.result) {
      state.offset = upd.update_id + 1;

      const msg = upd.message;
      if (msg?.text && String(msg.chat.id) === String(CHAT_ID)) {
        console.log(`[msg] ${msg.text}`);
        await onMessage(msg.text.trim(), state);
      }

      const cb = upd.callback_query;
      if (cb && String(cb.message?.chat?.id ?? cb.from?.id) === String(CHAT_ID)) {
        console.log(`[cb] ${cb.data}`);
        await answerCb(cb.id);
        await onCallback(cb.data||'', state);
      }

      saveState(state);
    }
  }

  saveState(state);
  console.log('✅ Run complete');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(e => { console.error('Fatal:', e); process.exit(1); });
