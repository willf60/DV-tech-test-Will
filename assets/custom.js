// shorthand helpers
const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => Array.from(context.querySelectorAll(selector));
const on = (type, selector, handler, options) => document.addEventListener(type, (event) => {
  const target = event.target.closest(selector);
  if (target) handler(event, target);
}, options);
// ensures a quantity value is always positive (min of 1)
const qtyGuard = (n) => Math.max(1, Number(n) || 1);
//error handling shorthand
const logError = (error) => console.error(error);

// Cart drawer ================================
const Drawer = {
  el: $("#CartDrawer"),
  body: $("[data-cart-body]"),
  subtotal: $("[data-cart-subtotal]"),
  countEls: $$('[data-cart-count]'),
  tpl: $("#CartItemTemplate"),

  //drawer open/close
  setOpen(isOpen) {
    this.el?.classList.toggle("is-open", isOpen);
    this.el?.setAttribute("aria-hidden", String(!isOpen));
    document.documentElement.classList.toggle("no-scroll", isOpen);
  },
  open() { this.setOpen(true); },
  close() { this.setOpen(false); },

  //cart item counter
  setCount(count) { this.countEls.forEach((n) => { n.textContent = count; n.hidden = count <= 0; }); },

  //formats pence into currency values
  money(cents) {
    const code = window.Shopify?.currency?.active || "GBP";
    try { return (cents / 100).toLocaleString(undefined, { style: "currency", currency: code }); }
    catch { return `£${(cents / 100).toFixed(2)}`; }
  },
  // hide qty '-' btn when qty value = 1
  markMin(lineEl, qty) { lineEl.classList.toggle("is-min", qty <= 1); },

  //empty cart state
  renderEmpty() {
    this.body.replaceChildren(Object.assign(document.createElement('p'), { className: 'CartDrawer__empty', textContent: 'Your basket is empty.' }));
    this.subtotal.textContent = this.money(0);
    updateLoyaltyButtons({ total_price: 0 });
  },

  //render cart contents
  render(cart) {
    //set cart header count, hide if 0. Hide clear all btn if item count = 0
    this.setCount(cart.item_count);
    this.el?.querySelector('[data-cart-clear]')?.toggleAttribute('hidden', cart.item_count === 0);
    if (!cart.items.length || !this.tpl) return this.renderEmpty();

    //Shorthand for creating div & documentFragment
    const list = Object.assign(document.createElement('div'), { className: 'CartList' });
    const docFrag = document.createDocumentFragment();

    //build each cart item
    cart.items.forEach((item, i) => {
      const node = this.tpl.content.firstElementChild.cloneNode(true);
      node.dataset.line = String(i + 1);

      // Cart item edia
      const img = node.querySelector('.CI__img');
      const placeholder = node.querySelector('.CI__ph');
      const hasImg = Boolean(item.image);
      if (img) {
        img.hidden = !hasImg;
        if (hasImg) { img.src = item.image; img.alt = item.title || item.product_title || ""; img.decoding = 'async'; }
      }
      if (placeholder) placeholder.hidden = hasImg;

      // Title + variant
      node.querySelector('.CI__title').textContent = item.product_title || item.title || '';
      const meta = node.querySelector('.CI__meta');
      const variantTitle = item.variant_title;
      const showMeta = Boolean(variantTitle && variantTitle !== 'Default Title');
      meta.hidden = !showMeta; if (showMeta) meta.textContent = variantTitle;

      // Qty + price
      node.querySelector('.Qty__input').value = String(item.quantity);
      node.querySelector('.CI__price').textContent = this.money(item.final_line_price);
      this.markMin(node, item.quantity);

      docFrag.appendChild(node);
    });

    //drawer construction
    list.appendChild(docFrag);
    this.body.replaceChildren(list);
    this.subtotal.textContent = this.money(cart.items_subtotal_price);
     updateLoyaltyButtons(cart);
  },
};

// Shopify cart API ===============================
const Cart = {
  async _post(url, payload) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload || {}) });
    if (!response.ok) {
      try { const data = await response.json(); throw new Error(data.description || data.message || 'Request failed'); }
      catch { throw new Error('Request failed'); }
    }
    return response.json();
  },
  async get() { const r = await fetch('/cart.js'); return r.json(); },
  async add(id, quantity = 1, properties) { await this._post('/cart/add.js', { id: Number(id), quantity: qtyGuard(quantity), properties }); return this.refresh(); },
  async change(line, quantity) { await this._post('/cart/change.js', { line, quantity: quantity === 0 ? 0 : qtyGuard(quantity) }); return this.refresh(); },
  async clear() { await this._post('/cart/clear.js'); return this.refresh(); },
  async refresh() { const cart = await this.get(); Drawer.render(cart); return cart; },
};

// Loyalty points ==================================
const calcPoints = (cart) => Math.floor((cart?.total_price || 0) / 10000) * 10; //every £100 = 10 points
// Update ALL loyalty buttons on the page
function updateLoyaltyButtons(cart) {
  const points = calcPoints(cart);
  $("[data-loyalty-earn]"); // ensure util is loaded
  $$('[data-loyalty-earn]').forEach((btn) => {
    btn.hidden = points <= 0;
    btn.querySelector('.Points__value')?.replaceChildren(String(points));
    if (!btn._loyaltyBound) {
      btn.onclick = () => {
        window.dispatchEvent(new CustomEvent('loyalty:earn', {
          detail: { points, subtotal_pence: cart.total_price, currency: Shopify?.currency?.active || 'GBP' }
        }));
        btn.classList.add('is-success');
        setTimeout(() => btn.classList.remove('is-success'), 1200);
      };
      btn._loyaltyBound = true; // avoid rebinding on every render
    }
  });
}

// Events  ===========================================
// Open cart drawer
on('click', `.CartToggle,[data-cart-open],a[href="${Shopify?.routes?.cart_url || '/cart'}"]`, (event, el) => {
  if (el.tagName === 'A') event.preventDefault();
  Drawer.open();
  Cart.refresh().catch(logError);
});

// Close / Clear
on('click', '[data-cart-close]', () => Drawer.close());
on('click', '[data-cart-clear]', () => Cart.clear().catch(logError));

// Remove item
on('click', '.CartItem [data-remove]', (_e, button) => {
  const line = Number(button.closest('.CartItem')?.dataset.line || 0);
  if (line) Cart.change(line, 0).catch(logError);
});

// Quantity changes (buttons + inputs)
function applyDrawerQuantity(lineEl, nextQty) {
  const line = Number(lineEl?.dataset.line || 0);
  if (!line) return;
  Cart.change(line, nextQty).then(() => Drawer.markMin(lineEl, nextQty)).catch(logError);
}

// Item quantity click handler
on('click', '.Qty__btn', (_e, btn) => {
  const qtyRoot = btn.closest('.Qty');
  const input = qtyRoot?.querySelector('.Qty__input');
  if (!input) return;
  const delta = btn.dataset.qty === '+1' ? 1 : -1;
  const nextQty = qtyGuard(Number(input.value) + delta);

  // If inside drawer, update cart
  const lineEl = btn.closest('#CartDrawer .CartItem');
  if (lineEl) applyDrawerQuantity(lineEl, nextQty);
  else input.value = String(nextQty);
});

// Updates cart as user types in qty input
on('input', '#CartDrawer .CartItem .Qty__input', (_e, input) => {
  const lineEl = input.closest('.CartItem');
  applyDrawerQuantity(lineEl, qtyGuard(input.value));
});

// Add-to-cart function
on('click', '[data-action="add-to-cart"]', (event, btn) => {
  event.preventDefault();
  event.stopPropagation();
  const card = btn.closest('.ProductCard, [data-product-card]') || document;
  const qtyEl = card.querySelector('.Qty__input, [name="quantity"], input[type="number"]');
  const quantity = qtyGuard(qtyEl?.value);
  const id = btn.dataset.variantId || btn.getAttribute('data-variant-id') || card.querySelector('input[name="id"]')?.value;
  if (!id) return console.warn('No variant id found for add-to-cart button');
  btn.disabled = true;
  Cart.add(id, quantity)
    .then(() => { Drawer.open(); if (qtyEl) qtyEl.value = 1; })
    .catch((err) => { console.error(err); alert(err.message || 'Could not add to cart'); })
    .finally(() => { btn.disabled = false; });
});

// Page Load =========================================
// fetch & render cart. Update loyalty btn & header cart item count
Cart.get()
  .then((cart) => {
    Drawer.render(cart); 
    updateLoyaltyButtons(cart);
    Drawer.setCount(cart.item_count);
  })
  .catch(logError);