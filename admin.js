/* ============================================================
   admin.js — GreenRoot Admin Panel

   ⚠️  SECURITY NOTE: client-side password only. Keep the
   admin.html URL out of public navigation.
   ============================================================ */

const ADMIN_PASSWORD = 'Gardenado'; /* ← change before publishing */

/* ---- DOM REFS --------------------------------------------- */
const gateEl      = document.getElementById('admin-gate');
const panelEl     = document.getElementById('admin-panel');
const loginForm   = document.getElementById('login-form');
const loginError  = document.getElementById('login-error');
const productList = document.getElementById('admin-product-list');
const saveBtn     = document.getElementById('save-all-btn');
const resetBtn    = document.getElementById('reset-btn');
const statusEl    = document.getElementById('save-status');

/* ---- BOT WIZARD STATE ------------------------------------- */
let wizardState = null; /* { step: 'name'|'shortDesc'|'price'|'stock', data: {} } */

/* ---- AUTH ------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  if (sessionStorage.getItem('gr_admin_auth') === '1') showPanel();

  loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const entered = document.getElementById('admin-password').value;
    if (entered === ADMIN_PASSWORD) {
      sessionStorage.setItem('gr_admin_auth', '1');
      loginError.textContent = '';
      showPanel();
    } else {
      loginError.textContent = 'Incorrect password. Please try again.';
      document.getElementById('admin-password').value = '';
      document.getElementById('admin-password').focus();
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('gr_admin_auth');
    stopBotPolling();
    panelEl.hidden = true;
    gateEl.hidden  = false;
    document.getElementById('admin-password').value = '';
    document.getElementById('admin-password').focus();
  });

  saveBtn.addEventListener('click', saveAllProducts);

  resetBtn.addEventListener('click', () => {
    if (!confirm('Reset all products to factory defaults? This discards saved changes.')) return;
    localStorage.removeItem('greenroot_products');
    renderAdminProducts();
    showStatus('✓ Products reset to defaults.', 'success');
  });

  document.getElementById('bot-toggle-btn').addEventListener('click', () => {
    if (isPolling) stopBotPolling(); else startBotPolling();
  });

  /* Add Product form */
  const addForm = document.getElementById('add-product-form');
  if (addForm) {
    addForm.addEventListener('submit', e => {
      e.preventDefault();
      const npError = document.getElementById('np-error');
      npError.textContent = '';

      const name      = document.getElementById('np-name').value.trim();
      const shortDesc = document.getElementById('np-shortdesc').value.trim();
      const desc      = document.getElementById('np-desc').value.trim();
      const usage     = document.getElementById('np-usage').value.trim();
      const price     = document.getElementById('np-price').value.trim();
      const rawStock  = document.getElementById('np-stock').value.trim();
      const emoji     = document.getElementById('np-emoji').value.trim();
      const stock     = rawStock === '' ? null : Math.max(0, parseInt(rawStock, 10) || 0);

      if (!name)  { npError.textContent = 'Product name is required.'; return; }
      if (!price) { npError.textContent = 'Price is required.'; return; }

      const product = createProduct({ name, shortDesc, description: desc, usage, price, stock, emoji });
      renderAdminProducts();
      showStatus(`✓ "${product.name}" added (ID #${product.id}).`, 'success');
      addForm.reset();
    });
  }
});

function showPanel() {
  gateEl.hidden  = true;
  panelEl.hidden = false;
  renderAdminProducts();
}

/* ---- PRODUCT EDITOR --------------------------------------- */

function renderAdminProducts() {
  const products = getProducts();
  productList.innerHTML = '';

  products.forEach((product, index) => {
    const stockVal = (product.stock === null || product.stock === undefined) ? '' : product.stock;
    const item = document.createElement('div');
    item.className = 'admin-product-item';
    item.dataset.index = index;
    item.innerHTML = `
      <div class="admin-product-label-row">
        <p class="admin-product-label">#${product.id} — ${escapeHtml(product.name)}</p>
        <button class="btn-danger admin-delete-btn" type="button">Delete</button>
      </div>
      <div class="admin-fields">
        <div>
          <label for="a-name-${index}">Name</label>
          <input type="text" id="a-name-${index}" class="admin-name"
                 value="${escapeHtml(product.name)}" required maxlength="80" />
        </div>
        <div>
          <label for="a-desc-${index}">Short Description</label>
          <textarea id="a-desc-${index}" class="admin-desc"
                    maxlength="200">${escapeHtml(product.shortDesc)}</textarea>
        </div>
        <div>
          <label for="a-price-${index}">Price</label>
          <input type="text" id="a-price-${index}" class="admin-price"
                 value="${escapeHtml(product.price)}" placeholder="€0.00" maxlength="20" />
        </div>
        <div>
          <label for="a-stock-${index}">
            Stock
            <span class="label-hint">(blank&nbsp;=&nbsp;∞)</span>
          </label>
          <input type="number" id="a-stock-${index}" class="admin-stock"
                 value="${stockVal}" min="0" placeholder="∞" />
        </div>
      </div>`;
    item.querySelector('.admin-delete-btn').addEventListener('click', () => {
      if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) return;
      deleteProduct(product.id);
      renderAdminProducts();
      showStatus(`✓ "${product.name}" deleted.`, 'success');
    });
    productList.appendChild(item);
  });
}

function saveAllProducts() {
  const products = getProducts();
  let hasError   = false;

  document.querySelectorAll('.admin-product-item').forEach(item => {
    const index = parseInt(item.dataset.index, 10);
    const name  = item.querySelector('.admin-name').value.trim();
    const desc  = item.querySelector('.admin-desc').value.trim();
    const price = item.querySelector('.admin-price').value.trim();
    const rawStock = item.querySelector('.admin-stock').value.trim();
    const stock = rawStock === '' ? null : Math.max(0, parseInt(rawStock, 10) || 0);

    if (!name) { item.querySelector('.admin-name').focus(); hasError = true; return; }

    products[index] = { ...products[index], name, shortDesc: desc, price, stock };
  });

  if (hasError) { showStatus('✗ Product name cannot be empty.', 'error'); return; }

  try {
    saveProducts(products);
    showStatus('✓ All changes saved.', 'success');
    renderAdminProducts();
  } catch (e) {
    console.error(e);
    showStatus('✗ Could not save. Check browser storage settings.', 'error');
  }
}

/* ---- BOT KEYBOARD ----------------------------------------- */

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

/* ---- INLINE KEYBOARD HELPERS ------------------------------ */

function productInlineKeyboard(callbackPrefix) {
  const products = getProducts();
  const rows = [];
  for (let i = 0; i < products.length; i += 2) {
    const row = [{
      text: `${products[i].emoji} #${products[i].id} ${products[i].name}`,
      callback_data: `${callbackPrefix}:${products[i].id}`,
    }];
    if (products[i + 1]) {
      row.push({
        text: `${products[i + 1].emoji} #${products[i + 1].id} ${products[i + 1].name}`,
        callback_data: `${callbackPrefix}:${products[i + 1].id}`,
      });
    }
    rows.push(row);
  }
  rows.push([{ text: '❌ Отмена', callback_data: 'cancel_action' }]);
  return { inline_keyboard: rows };
}

function stockPresetsMarkup(productId) {
  return {
    inline_keyboard: [
      [
        { text: '+1',  callback_data: `stock_preset:${productId}:+1` },
        { text: '+5',  callback_data: `stock_preset:${productId}:+5` },
        { text: '+10', callback_data: `stock_preset:${productId}:+10` },
      ],
      [
        { text: '-1',      callback_data: `stock_preset:${productId}:-1` },
        { text: '-5',      callback_data: `stock_preset:${productId}:-5` },
        { text: '0 (обнулить)', callback_data: `stock_preset:${productId}:0` },
      ],
      [
        { text: '♾️ Безлимит', callback_data: `stock_preset:${productId}:inf` },
        { text: '❌ Отмена',   callback_data: 'cancel_action' },
      ],
    ],
  };
}

function skipCancelMarkup() {
  return {
    inline_keyboard: [[
      { text: '⏭ Пропустить', callback_data: 'skip_step' },
      { text: '❌ Отмена',     callback_data: 'cancel_action' },
    ]],
  };
}

function cancelOnlyMarkup() {
  return {
    inline_keyboard: [[
      { text: '❌ Отмена', callback_data: 'cancel_action' },
    ]],
  };
}

/* ---- BOT POLLING ------------------------------------------ */
/*
   How it works:
   — This page polls getUpdates from the Telegram Bot API every 10 s.
   — Only messages from CHAT_ID are processed.
   — Available commands:
       /stock               → bot replies with current stock table
       /setstock [id] [qty] → set stock to exact qty
       /setstock [id] +[n]  → add n units
       /setstock [id] -[n]  → subtract n units
       /setstock all [qty]  → set all products to qty
       /help                → bot replies with command list
*/

let pollTimer  = null;
let pollOffset = parseInt(localStorage.getItem('gr_bot_offset') || '0', 10);
let isPolling  = false;

async function startBotPolling() {
  if (isPolling) return;

  if (BOT_TOKEN === 'YOUR_BOT_TOKEN') {
    setBotStatus('error', 'Configure BOT_TOKEN in main.js first');
    return;
  }

  /* On first run: skip all existing messages, start from now */
  if (!localStorage.getItem('gr_bot_offset')) {
    await initPollOffset();
  }

  isPolling = true;
  setBotStatus('active', 'Listening…');
  document.getElementById('bot-toggle-btn').textContent = 'Stop';

  await sendTelegramMessage('✅ GreenRoot bot started. Use the buttons below.', MAIN_KEYBOARD);
  await doPoll(); /* immediate first tick */
  pollTimer = setInterval(doPoll, 10000);
}

function stopBotPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
  isPolling = false;
  setBotStatus('stopped', 'Stopped');
  document.getElementById('bot-toggle-btn').textContent = 'Start';
}

async function initPollOffset() {
  try {
    const url  = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=-1&limit=1`;
    const data = await (await fetch(url)).json();
    if (data.ok && data.result.length > 0) {
      pollOffset = data.result[data.result.length - 1].update_id + 1;
    } else {
      pollOffset = 0;
    }
    localStorage.setItem('gr_bot_offset', pollOffset);
  } catch { pollOffset = 0; }
}

async function doPoll() {
  try {
    const url  = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${pollOffset}&limit=20&timeout=0`;
    const data = await (await fetch(url)).json();

    if (!data.ok) {
      setBotStatus('error', 'API error: ' + (data.description || 'unknown'));
      return;
    }

    for (const update of data.result) {
      pollOffset = update.update_id + 1;
      localStorage.setItem('gr_bot_offset', pollOffset);

      /* Regular text message */
      const msg = update.message;
      if (msg && msg.text && String(msg.chat.id) === String(CHAT_ID)) {
        await handleBotCommand(msg.text.trim());
      }

      /* Inline button tap */
      const cb = update.callback_query;
      if (cb) {
        const chatId = cb.message?.chat?.id ?? cb.from?.id;
        if (String(chatId) === String(CHAT_ID)) {
          await handleCallbackQuery(cb);
        }
      }
    }

    setBotStatus('active', 'Active — ' + new Date().toLocaleTimeString());
  } catch (err) {
    setBotStatus('error', 'Network error');
    console.warn('Bot poll error:', err);
  }
}

async function handleBotCommand(text) {
  appendBotLog(text);

  /* /cancel — abort active wizard */
  if (/^\/cancel$/i.test(text)) {
    wizardState = null;
    await sendTelegramMessage('❌ Отменено.', MAIN_KEYBOARD);
    return;
  }

  /* ---- Active wizard: route next reply into wizard steps ---- */
  if (wizardState) {
    await handleWizardStep(text);
    return;
  }

  /* ❓ Помощь  OR  /help */
  if (text === '❓ Помощь' || /^\/help$/i.test(text)) {
    await sendTelegramMessage(
      '📋 GreenRoot — Управление магазином\n\n' +
      'Используйте кнопки меню:\n\n' +
      '📦 Склад — остатки товаров\n' +
      '🛒 Заказы — последние 10 заказов\n' +
      '🗂 Все товары — список с ID и ценами\n' +
      '💰 Цены — прайс-лист\n' +
      '✏️ Изменить склад — выбрать товар и обновить остаток\n' +
      '💲 Изменить цену — выбрать товар и задать новую цену\n' +
      '➕ Добавить товар — пошаговый мастер\n' +
      '🗑 Удалить товар — выбрать товар и подтвердить удаление\n\n' +
      'Команды:\n' +
      '/setstock [id] [кол-во|+n|-n] — обновить остаток\n' +
      '/setstock all [кол-во] — установить всем\n' +
      '/cancel — отменить активный мастер',
      MAIN_KEYBOARD
    );
    return;
  }

  /* 📦 Склад  OR  /stock */
  if (text === '📦 Склад' || /^\/stock$/i.test(text)) {
    const products = getProducts();
    const lines = products.map(p => {
      const s = p.stock;
      if (s === null || s === undefined) return `  ♾️  #${p.id} ${p.emoji} ${p.name}`;
      const icon = s === 0 ? '❌' : s <= 5 ? '⚠️' : '✅';
      return `  ${icon} #${p.id} ${p.emoji} ${p.name}: ${s} шт.`;
    }).join('\n');
    await sendTelegramMessage('📦 Остатки:\n\n' + lines, MAIN_KEYBOARD);
    return;
  }

  /* 🛒 Заказы  OR  /orders */
  if (text === '🛒 Заказы' || /^\/orders$/i.test(text)) {
    let orders = [];
    try { orders = JSON.parse(localStorage.getItem('greenroot_orders') || '[]'); } catch {}

    if (orders.length === 0) {
      await sendTelegramMessage('🛒 Заказов пока нет.', MAIN_KEYBOARD);
      return;
    }

    const lines = orders.slice(0, 10).map((o, i) => {
      const d    = new Date(o.ts);
      const date = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const items = o.items.map(it => `${it.name} ×${it.qty}`).join(', ');
      return `${i + 1}. ${date} — ${o.name} (${o.phone})\n   ${items}\n   Итого: ${o.total}`;
    }).join('\n\n');

    await sendTelegramMessage(`🛒 Последние ${Math.min(orders.length, 10)} заказов:\n\n` + lines, MAIN_KEYBOARD);
    return;
  }

  /* 💰 Цены  OR  /prices */
  if (text === '💰 Цены' || /^\/prices$/i.test(text)) {
    const lines = getProducts().map(p => `  ${p.emoji} #${p.id} ${p.name}: ${p.price}`).join('\n');
    await sendTelegramMessage('💰 Цены:\n\n' + lines, MAIN_KEYBOARD);
    return;
  }

  /* 🗂 Все товары  OR  /listproducts */
  if (text === '🗂 Все товары' || /^\/listproducts$/i.test(text)) {
    const lines = getProducts().map(p => {
      const qty = (p.stock === null || p.stock === undefined) ? '♾️' : `${p.stock} шт.`;
      return `  ${p.emoji} #${p.id} ${p.name} — ${p.price} | склад: ${qty}`;
    }).join('\n');
    await sendTelegramMessage('🗂 Все товары:\n\n' + lines, MAIN_KEYBOARD);
    return;
  }

  /* ✏️ Изменить склад — выбор через inline-кнопки */
  if (text === '✏️ Изменить склад') {
    await sendTelegramMessage('✏️ Выберите товар для изменения остатка:', productInlineKeyboard('edit_stock'));
    return;
  }

  /* 💲 Изменить цену — выбор через inline-кнопки */
  if (text === '💲 Изменить цену') {
    await sendTelegramMessage('💲 Выберите товар для изменения цены:', productInlineKeyboard('edit_price'));
    return;
  }

  /* ➕ Добавить товар  OR  /addproduct */
  if (text === '➕ Добавить товар' || /^\/addproduct$/i.test(text)) {
    wizardState = { step: 'name', data: {} };
    await sendTelegramMessage(
      '➕ Новый товар — Шаг 1 из 4\n\nВведите название товара:',
      cancelOnlyMarkup()
    );
    return;
  }

  /* 🗑 Удалить товар  OR  /deleteproduct [id] */
  if (text === '🗑 Удалить товар') {
    await sendTelegramMessage('🗑 Выберите товар для удаления:', productInlineKeyboard('delete_product'));
    return;
  }

  const delMatch = text.match(/^\/deleteproduct\s+(\d+)$/i);
  if (delMatch) {
    const id      = parseInt(delMatch[1], 10);
    const product = getProducts().find(p => p.id === id);
    if (!product) {
      await sendTelegramMessage(`❌ Товар #${id} не найден.`, MAIN_KEYBOARD);
      return;
    }
    await sendTelegramMessage(
      `🗑 Удалить "${product.name}" (#${id})?\nЭто действие нельзя отменить.`,
      { inline_keyboard: [[
        { text: '✅ Да, удалить', callback_data: `confirm_delete:${id}` },
        { text: '❌ Отмена',      callback_data: 'cancel_action' },
      ]] }
    );
    return;
  }

  /* /setstock all [qty] */
  const allMatch = text.match(/^\/setstock\s+all\s+(\d+)$/i);
  if (allMatch) {
    const qty = parseInt(allMatch[1], 10);
    const products = getProducts();
    products.forEach(p => { p.stock = qty; });
    saveProducts(products);
    renderAdminProducts();
    await sendTelegramMessage(`✅ Всем товарам установлено ${qty} шт.`, MAIN_KEYBOARD);
    showStatus(`✓ Bot: all stock → ${qty}`, 'success');
    return;
  }

  /* /setstock [id] [qty|+n|-n] */
  const setMatch = text.match(/^\/setstock\s+(\d+)\s+([+\-]?\d+)$/);
  if (setMatch) {
    const id       = parseInt(setMatch[1], 10);
    const rawQty   = setMatch[2];
    const products = getProducts();
    const product  = products.find(p => p.id === id);

    if (!product) {
      await sendTelegramMessage(`❌ Товар #${id} не найден.`, MAIN_KEYBOARD);
      return;
    }

    let newQty;
    if (rawQty.startsWith('+') || rawQty.startsWith('-')) {
      newQty = Math.max(0, (product.stock || 0) + parseInt(rawQty, 10));
    } else {
      newQty = Math.max(0, parseInt(rawQty, 10));
    }

    product.stock = newQty;
    saveProducts(products);
    renderAdminProducts();

    const icon = newQty === 0 ? '❌' : newQty <= 5 ? '⚠️' : '✅';
    await sendTelegramMessage(`${icon} ${product.name}: остаток → ${newQty} шт.`, MAIN_KEYBOARD);
    showStatus(`✓ Bot: ${product.name} stock → ${newQty}`, 'success');
    return;
  }
}

/* ---- CALLBACK QUERY HANDLER ------------------------------- */

async function handleCallbackQuery(cb) {
  const data = cb.data || '';
  appendBotLog(`[кнопка] ${data}`);
  await answerCallbackQuery(cb.id);

  /* Отмена */
  if (data === 'cancel_action') {
    wizardState = null;
    await sendTelegramMessage('❌ Отменено.', MAIN_KEYBOARD);
    return;
  }

  /* Пропустить шаг мастера */
  if (data === 'skip_step') {
    if (wizardState) await handleWizardStep('/skip');
    return;
  }

  /* Выбор товара для изменения остатка */
  if (data.startsWith('edit_stock:')) {
    const id = parseInt(data.split(':')[1], 10);
    const product = getProducts().find(p => p.id === id);
    if (!product) { await sendTelegramMessage('❌ Товар не найден.', MAIN_KEYBOARD); return; }
    const qty = (product.stock === null || product.stock === undefined) ? '♾️' : product.stock;
    wizardState = { step: 'editStock_qty', data: { id } };
    await sendTelegramMessage(
      `✏️ ${product.emoji} ${product.name}\nТекущий остаток: ${qty}\n\nВведите новое количество или выберите пресет:`,
      stockPresetsMarkup(id)
    );
    return;
  }

  /* Пресет изменения остатка через inline-кнопку */
  if (data.startsWith('stock_preset:')) {
    const parts  = data.split(':');
    const id     = parseInt(parts[1], 10);
    const preset = parts[2];
    const products = getProducts();
    const product  = products.find(p => p.id === id);
    if (!product) { await sendTelegramMessage('❌ Товар не найден.', MAIN_KEYBOARD); return; }

    let newQty;
    if (preset === 'inf') {
      newQty = null;
    } else if (preset.startsWith('+') || preset.startsWith('-')) {
      newQty = Math.max(0, (product.stock || 0) + parseInt(preset, 10));
    } else {
      newQty = Math.max(0, parseInt(preset, 10));
    }

    product.stock = newQty;
    saveProducts(products);
    renderAdminProducts();
    wizardState = null;

    const qtyLabel = newQty === null ? '♾️' : newQty;
    const icon = newQty === null ? '♾️' : newQty === 0 ? '❌' : newQty <= 5 ? '⚠️' : '✅';
    await sendTelegramMessage(`${icon} ${product.name}: остаток → ${qtyLabel}`, MAIN_KEYBOARD);
    showStatus(`✓ Bot: ${product.name} stock → ${newQty}`, 'success');
    return;
  }

  /* Выбор товара для изменения цены */
  if (data.startsWith('edit_price:')) {
    const id = parseInt(data.split(':')[1], 10);
    const product = getProducts().find(p => p.id === id);
    if (!product) { await sendTelegramMessage('❌ Товар не найден.', MAIN_KEYBOARD); return; }
    wizardState = { step: 'editPrice_qty', data: { id } };
    await sendTelegramMessage(
      `💲 ${product.emoji} ${product.name}\nТекущая цена: ${product.price}\n\nВведите новую цену (например, €14.90):`,
      cancelOnlyMarkup()
    );
    return;
  }

  /* Выбор товара для удаления */
  if (data.startsWith('delete_product:')) {
    const id = parseInt(data.split(':')[1], 10);
    const product = getProducts().find(p => p.id === id);
    if (!product) { await sendTelegramMessage('❌ Товар не найден.', MAIN_KEYBOARD); return; }
    await sendTelegramMessage(
      `🗑 Удалить "${product.name}" (#${id})?\nЭто действие нельзя отменить.`,
      { inline_keyboard: [[
        { text: '✅ Да, удалить', callback_data: `confirm_delete:${id}` },
        { text: '❌ Отмена',      callback_data: 'cancel_action' },
      ]] }
    );
    return;
  }

  /* Подтверждение удаления */
  if (data.startsWith('confirm_delete:')) {
    const id = parseInt(data.split(':')[1], 10);
    const product = getProducts().find(p => p.id === id);
    if (!product) { await sendTelegramMessage('❌ Товар не найден.', MAIN_KEYBOARD); return; }
    deleteProduct(id);
    renderAdminProducts();
    await sendTelegramMessage(`🗑 "${product.name}" (ID #${id}) удалён.`, MAIN_KEYBOARD);
    showStatus(`✓ Bot: "${product.name}" deleted.`, 'success');
    return;
  }
}

async function answerCallbackQuery(callbackId) {
  if (BOT_TOKEN === 'YOUR_BOT_TOKEN') return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId }),
  }).catch(() => {});
}

/* ---- BOT WIZARD ------------------------------------------- */

async function handleWizardStep(text) {
  const { step, data } = wizardState;

  /* --- Изменение остатка (после выбора товара через inline-кнопку) --- */
  if (step === 'editStock_qty') {
    const rawQty = text.trim();
    const products = getProducts();
    const product  = products.find(p => p.id === data.id);
    if (!product) { wizardState = null; await sendTelegramMessage('❌ Товар не найден.', MAIN_KEYBOARD); return; }

    let newQty;
    if (rawQty === '' || rawQty.toLowerCase() === 'inf' || rawQty === '∞') {
      newQty = null;
    } else if (rawQty.startsWith('+') || rawQty.startsWith('-')) {
      newQty = Math.max(0, (product.stock || 0) + parseInt(rawQty, 10));
    } else {
      const n = parseInt(rawQty, 10);
      if (isNaN(n)) {
        await sendTelegramMessage('⚠️ Введите число или выберите пресет:', stockPresetsMarkup(data.id));
        return;
      }
      newQty = Math.max(0, n);
    }

    product.stock = newQty;
    saveProducts(products);
    renderAdminProducts();
    wizardState = null;

    const qtyLabel = newQty === null ? '♾️' : newQty;
    const icon = newQty === null ? '♾️' : newQty === 0 ? '❌' : newQty <= 5 ? '⚠️' : '✅';
    await sendTelegramMessage(`${icon} ${product.name}: остаток → ${qtyLabel}`, MAIN_KEYBOARD);
    showStatus(`✓ Bot: ${product.name} stock → ${newQty}`, 'success');
    return;
  }

  /* --- Изменение цены (после выбора товара через inline-кнопку) --- */
  if (step === 'editPrice_qty') {
    const newPrice = text.trim();
    if (!newPrice) {
      await sendTelegramMessage('⚠️ Цена не может быть пустой. Введите цену (например €14.90):', cancelOnlyMarkup());
      return;
    }
    const products = getProducts();
    const product  = products.find(p => p.id === data.id);
    if (!product) { wizardState = null; await sendTelegramMessage('❌ Товар не найден.', MAIN_KEYBOARD); return; }

    product.price = newPrice;
    saveProducts(products);
    renderAdminProducts();
    wizardState = null;

    await sendTelegramMessage(`✅ ${product.emoji} ${product.name}: цена → ${newPrice}`, MAIN_KEYBOARD);
    showStatus(`✓ Bot: ${product.name} price → ${newPrice}`, 'success');
    return;
  }

  /* --- Мастер добавления товара --- */

  if (step === 'name') {
    if (!text.trim()) {
      await sendTelegramMessage('⚠️ Название не может быть пустым. Попробуйте ещё раз:', cancelOnlyMarkup());
      return;
    }
    data.name = text.trim();
    wizardState.step = 'shortDesc';
    await sendTelegramMessage(
      `✅ Название: "${data.name}"\n\n` +
      '➕ Шаг 2 из 4 — Краткое описание\n(одно предложение, показывается на карточке)\n\nВведите текст или пропустите:',
      skipCancelMarkup()
    );
    return;
  }

  if (step === 'shortDesc') {
    data.shortDesc = /^\/skip$/i.test(text) ? '' : text.trim();
    wizardState.step = 'price';
    await sendTelegramMessage(
      '➕ Шаг 3 из 4 — Цена\n\nПример: €14.90\n\nВведите цену или пропустите:',
      skipCancelMarkup()
    );
    return;
  }

  if (step === 'price') {
    data.price = /^\/skip$/i.test(text) ? '' : text.trim();
    wizardState.step = 'stock';
    await sendTelegramMessage(
      '➕ Шаг 4 из 4 — Количество на складе\n\nВведите число или нажмите «Безлимит»:',
      {
        inline_keyboard: [[
          { text: '♾️ Безлимит', callback_data: 'skip_step' },
          { text: '❌ Отмена',   callback_data: 'cancel_action' },
        ]],
      }
    );
    return;
  }

  if (step === 'stock') {
    const rawStock = /^\/skip$/i.test(text) ? '' : text.trim();
    data.stock = rawStock === '' ? null : Math.max(0, parseInt(rawStock, 10) || 0);

    const product = createProduct(data);
    wizardState = null;
    renderAdminProducts();

    const stockLabel = product.stock === null ? '♾️ безлимит' : `${product.stock} шт.`;
    await sendTelegramMessage(
      `✅ Товар добавлен!\n\n` +
      `${product.emoji} #${product.id} ${product.name}\n` +
      `Цена: ${product.price || '—'}\n` +
      `Склад: ${stockLabel}`,
      MAIN_KEYBOARD
    );
    showStatus(`✓ Bot: "${product.name}" added (ID #${product.id}).`, 'success');
    return;
  }
}

/* ---- BOT UI HELPERS --------------------------------------- */

function setBotStatus(state, text) {
  const dot  = document.getElementById('bot-status-dot');
  const txt  = document.getElementById('bot-status-text');
  if (!dot || !txt) return;
  dot.className   = `bot-status-dot bot-status-${state}`;
  txt.textContent = text;
}

function appendBotLog(cmdText) {
  const log = document.getElementById('bot-log');
  if (!log) return;

  const empty = log.querySelector('.bot-log-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = 'bot-log-entry';
  entry.innerHTML = `
    <span class="bot-log-time">${new Date().toLocaleTimeString()}</span>
    <code class="bot-log-cmd">${escapeHtml(cmdText)}</code>`;
  log.insertBefore(entry, log.firstChild);

  /* Keep only last 10 entries */
  while (log.children.length > 10) log.removeChild(log.lastChild);
}

/* ---- UTILITY --------------------------------------------- */

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className   = `save-status ${type}`;
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className   = 'save-status';
  }, 3500);
}
