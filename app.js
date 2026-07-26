// Bolik — the authenticated app (menu, cart, checkout, orders, admin).
// Runs on index.html only. Depends on shared.js being loaded first.

        // ── STATE (this page only) ──
        let cart = [];
        let currentPage = null;
        let payMethod = 'cash',
            payScreenshot = null,
            cashAmount = '';
        let deliveryOption = 'delivery';
        const DELIVERY_FEE = 200;
        const EXTRA_BUBBLE_FEE = 400;

        function logout() {
            _auth.signOut().then(() => {
                window.location.href = 'login.html';
            });
        }

        // ── NAV ──
        function buildNav() {
            const nl = $('nav-links');
            nl.innerHTML = '';
            const cb = $('nav-cart');
            if (currentUser.role === 'customer') {
                nl.innerHTML =
                    '<button onclick="navigate(\'menu\')" data-nav="menu">Menu</button><button onclick="navigate(\'myorders\')" data-nav="myorders">My Orders</button>';
                cb.classList.remove('hidden');
                updateCartBadge();
            } else {
                nl.innerHTML =
                    '<button onclick="navigate(\'pending\')" data-nav="pending">Pending Orders</button><button onclick="navigate(\'emporders\')" data-nav="emporders">My Orders</button>';
                if (currentUser.role === 'superadmin' || currentUser.role === 'admin') nl.innerHTML +=
                    '<button onclick="navigate(\'admin\')" data-nav="admin">Admin</button>';
                cb.classList.add('hidden');
            }
        }


        function navigate(page) {
            currentPage = page;
            document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));
            const m = $('main-content');
            if (page === 'menu') renderMenu(m);
            else if (page === 'myorders') renderCustomerOrders(m);
            else if (page === 'pending') renderPendingOrders(m);
            else if (page === 'emporders') renderEmpOrders(m);
            else if (page === 'admin') renderAdmin(m);
            else if (page === 'checkout') renderCheckout(m);
            else if (page === 'confirmation') renderConfirmation(m);
            closeCart();
            // Scroll to top on page change (helps mobile)
            window.scrollTo(0, 0);
        }


        // ── LIVE REFRESH (Firebase real-time listeners) ──
        // ── EMPLOYEE: PENDING ──
        function renderPendingOrders(m) {
            const orders = getOrders()
                .filter(o => o.status === 'pending')
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            m.innerHTML = `
            <h1 class="page-title">Pending Orders</h1>
            <p class="page-subtitle">Claim orders and start preparing delicious drinks</p>
            <div class="orders-grid" id="ep-grid"></div>
        `;

            const g = $('ep-grid');
            if (!orders.length) {
                g.innerHTML = `
                <div class="empty-state">
                    <span class="es-icon">🎉</span>
                    <p>All caught up — no pending orders right now!</p>
                </div>
            `;
                return;
            }

            g.innerHTML = orders.map(o => orderCardHTML(o, true)).join('');
        }

        function orderCardHTML(o, showTake) {
            const actions = [];
            if (showTake && o.status === 'pending') {
                actions.push(`<button class="btn-take" onclick="takeOrder('${o.id}')">Take Order</button>`);
            }
            // Collapsed from a 3-tap flow (take/ready/deliver) to 2 -- once
            // claimed, one tap finishes it. 'ready' is still checked here
            // so any order already sitting in that legacy state still gets
            // a way to be completed after this change ships.
            if ((o.status === 'preparing' || o.status === 'ready') && o.takenBy === currentUser.email) {
                actions.push(`<button class="btn-deliver" onclick="markOrder('${o.id}','delivered')">Complete Order</button>`);
            }

            const ss = (o.paymentMethod === 'card' && o.paymentDetails?.screenshot)
                ? `<img src="${o.paymentDetails.screenshot}" class="screenshot-thumb" onclick="event.stopPropagation();showImg('${o.id}')" title="View screenshot">`
                : '';

            const bill = (o.paymentMethod === 'cash')
                ? `֏${Number(o.paymentDetails?.billAmount || 0).toLocaleString()}`
                : '';

            return `
            <div class="order-card">
                <div class="oc-header">
                    <div>
                        <span class="oc-id">${o.id}</span>
                        <div class="oc-time">${fmtDate(o.timestamp)}</div>
                    </div>
                    <span class="status-badge ${o.status}">${o.status}</span>
                </div>
                <div class="oc-customer">${escapeHtml(o.customerName)} (${escapeHtml(o.customerEmail)})</div>
                <div class="oc-items">
                    ${(o.items || []).map(i => `${i.emoji} ${escapeHtml(i.name)} x${i.quantity} — ${_itemDetail(i)}`).join('<br>')}
                </div>
                <div class="oc-meta">
                    <span>📍 ${escapeHtml(o.deliveryNote)}</span>
                    <span>💰 ${o.paymentMethod === 'cash' ? 'Cash ' + bill : 'Card'} ${ss}</span>
                    ${o.takenBy ? `<span>👤 ${escapeHtml(o.takenBy)}</span>` : ''}
                </div>
                <div class="oc-total">${fmt(o.total)}</div>
                ${actions.length ? `<div class="oc-actions">${actions.join('')}</div>` : ''}
            </div>`;
        }

        function showImg(oid) {
            const o = getOrders().find(x => x.id === oid);
            if (!o || !o.paymentDetails || !o.paymentDetails.screenshot) return;

            const m = $('img-modal');
            m.innerHTML = `<img src="${o.paymentDetails.screenshot}">`;
            m.classList.remove('hidden');
        }

        function takeOrder(id) {
            const o = getOrders().find(x => x.id === id);
            if (!o || o.status !== 'pending') return;

            updateOrder(id, { status: 'preparing', takenBy: currentUser.email });
            toast('Order ' + id + ' claimed!', 'success');

            // stay on whichever employee page the user is already using
            refreshOrdersUI();
        }

        function markOrder(id, status) {
            const o = getOrders().find(x => x.id === id);
            if (!o) return;

            const changes = { status };
            if (status === 'delivered') changes.deliveredAt = new Date().toISOString();
            updateOrder(id, changes);
            toast('Order ' + id + ' marked as ' + status, 'success');

            refreshOrdersUI();
        }

        // Payment screenshots only matter as delivery proof -- once an
        // order's been complete for a while nobody needs it anymore, and
        // it's the single biggest thing bloating the DB. Sweeps the orders
        // already in memory (staff/admin only) rather than a fresh fetch,
        // and only writes back the one field that changed per order.
        const SCREENSHOT_RETENTION_MS = 30 * 60 * 1000;
        function cleanupOldScreenshots() {
            const cutoff = Date.now() - SCREENSHOT_RETENTION_MS;
            getOrders().forEach(o => {
                if (o.status === 'delivered' && o.deliveredAt && o.paymentDetails?.screenshot &&
                    new Date(o.deliveredAt).getTime() < cutoff) {
                    updateOrder(o.id, { paymentDetails: { ...o.paymentDetails, screenshot: null } });
                }
            });
        }

        function startScreenshotCleanup() {
            cleanupOldScreenshots();
            setInterval(cleanupOldScreenshots, 5 * 60 * 1000);
        }


        // ── EMPLOYEE: MY ORDERS ──
        function renderEmpOrders(m) {
            const orders = getOrders()
                .filter(o =>
                    o.takenBy === currentUser.email ||
                    (o.status === 'pending' && !o.takenBy)
                )
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            const active = orders.filter(o => o.status !== 'delivered');
            const done = orders.filter(o => o.status === 'delivered');

            m.innerHTML = `
            <h1 class="page-title">My Orders</h1>
            <p class="page-subtitle">Orders you've claimed and new pending orders</p>

            <div class="tabs-row">
                <button class="active" onclick="empTab(this,'emp-active')">
                    Active (${active.length})
                </button>
                <button onclick="empTab(this,'emp-done')">
                    Completed (${done.length})
                </button>
            </div>

            <div id="emp-active" class="orders-grid">
                ${active.length
                    ? active.map(o => orderCardHTML(o, o.status === 'pending')).join('')
                    : `<div class="empty-state">
                            <span class="es-icon">📭</span>
                            <p>No active orders.</p>
                        </div>`
                }
            </div>

            <div id="emp-done" class="orders-grid hidden">
                ${done.length
                    ? done.map(o => orderCardHTML(o, false)).join('')
                    : `<div class="empty-state">
                            <span class="es-icon">✨</span>
                            <p>No completed orders yet.</p>
                        </div>`
                }
            </div>
        `;
        }

        function empTab(btn, id) {
            btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.orders-grid').forEach(g => {
                if (g.closest('.checkout-card') || g.closest('.admin-tabs')) return;
                g.classList.add('hidden');
            });

            $(id).classList.remove('hidden');
        }


        // ── LIVE REFRESH (Firebase real-time listeners) ──
        function refreshOrdersUI() {
            if (!currentUser || !currentPage) return;
            const m = $('main-content');
            if (!m) return;

            if (currentPage === 'pending') {
                const g = $('ep-grid');
                if (g) {
                    const orders = getOrders().filter(o => o.status === 'pending').sort((a, b) => new Date(a
                        .timestamp) - new Date(b.timestamp));
                    if (!orders.length) g.innerHTML =
                        '<div class="empty-state"><span class="es-icon">🎉</span><p>All caught up — no pending orders right now!</p></div>';
                    else g.innerHTML = orders.map(o => orderCardHTML(o, true)).join('');
                } else renderPendingOrders(m);
            } else if (currentPage === 'emporders') {
                const activeWrapper = $('emp-active');
                const doneWrapper = $('emp-done');
                if (activeWrapper && doneWrapper) {
                    const orders = getOrders().filter(o => o.takenBy === currentUser.email || (o.status === 'pending' &&
                        !o.takenBy)).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    const active = orders.filter(o => o.status !== 'delivered');
                    const done = orders.filter(o => o.status === 'delivered');

                    const buttons = document.querySelectorAll('.tabs-row button');
                    if (buttons.length >= 2) {
                        buttons[0].textContent = `Active (${active.length})`;
                        buttons[1].textContent = `Completed (${done.length})`;
                    }

                    if (active.length) activeWrapper.innerHTML = active.map(o => orderCardHTML(o, o.status ===
                        'pending')).join('');
                    else activeWrapper.innerHTML =
                        '<div class="empty-state"><span class="es-icon">📭</span><p>No active orders.</p></div>';

                    if (done.length) doneWrapper.innerHTML = done.map(o => orderCardHTML(o, false)).join('');
                    else doneWrapper.innerHTML =
                        '<div class="empty-state"><span class="es-icon">✨</span><p>No completed orders yet.</p></div>';
                } else renderEmpOrders(m);
            } else if (currentPage === 'myorders') {
                const g = $('co-grid');
                if (g) {
                    const orders = getOrders().filter(o => o.customerEmail === currentUser.email).sort((a, b) =>
                        new Date(b.timestamp) - new Date(a.timestamp));
                    if (!orders.length) {
                        g.innerHTML =
                            '<div class="empty-state"><span class="es-icon">📋</span><p>No orders yet — browse our menu to get started!</p></div>';
                    } else g.innerHTML = orders.map(o => orderCardHTML(o, false)).join('');
                } else renderCustomerOrders(m);
            } else if (currentPage === 'admin' && typeof adminTab !== 'undefined' && adminTab === 'history') {
                const w = $('ah-table-wrap');
                if (w) {
                    let orders = getOrders().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    window._allOrders = orders;
                    const d = $('ah-date') ? $('ah-date').value : null;
                    const fOrders = d ? orders.filter(o => dateKey(o.timestamp) === d) : orders;
                    const h3 = document.querySelector('.section-header h3');
                    if (h3) h3.textContent = `All Orders (${orders.length})`;
                    renderHistoryTable(fOrders);
                } else renderAdmin(m);
            } else if (currentPage === 'confirmation') {
                renderConfirmation(m);
            }
        }

        function refreshCurrentPage() {
            if (!currentUser || !currentPage) return;

            const m = $('main-content');
            if (!m) return;

            if (currentPage === 'pending') renderPendingOrders(m);
            else if (currentPage === 'emporders') renderEmpOrders(m);
            else if (currentPage === 'myorders') renderCustomerOrders(m);
            else if (currentPage === 'admin') renderAdmin(m);
            else if (currentPage === 'menu') renderMenu(m);
            else if (currentPage === 'confirmation') renderConfirmation(m);
        }

        // Attaches a live 'value' listener and resolves once with its first
        // snapshot, so the initial load and the ongoing live sync share a
        // single read instead of the old once()-plus-on() double fetch.
        // An error before the first snapshot rejects (surfaces via the
        // caller's .catch, same as a failed once() used to); an error after
        // that is a live-update hiccup, handled the same way it always was.
        function onceThenListen(ref, onSnap, onLiveError) {
            return new Promise((resolve, reject) => {
                let settled = false;
                ref.on('value', snap => {
                    onSnap(snap);
                    if (!settled) { settled = true; resolve(); }
                }, err => {
                    if (!settled) { settled = true; reject(err); }
                    else if (onLiveError) onLiveError(err);
                });
            });
        }

        function setupFirebaseListeners(profile) {
            const isAdmin = profile.role === 'admin' || profile.role === 'superadmin';
            const isCustomer = profile.role === 'customer';

            // Staff/admin need to see every order to do their job. A
            // customer only ever looks at their own -- querying by their
            // own email instead of syncing the whole table (which used to
            // happen for every role) is the same read pattern Firebase
            // already supports, just scoped to what's actually shown.
            const ordersRef = isCustomer
                ? _ref.orders.orderByChild('customerEmail').equalTo(profile.email)
                : _ref.orders;

            const promises = [
                onceThenListen(ordersRef, snap => {
                    _dbOrders = _fbArr(snap);
                    if (_firebaseReady) refreshOrdersUI();
                }, err => toast('Live updates blocked: ' + err.message, 'error'))
            ];

            // The full account list and team roster only ever get shown on
            // admin-only screens (Accounts tab, Team Members tab) -- every
            // customer and employee session used to download both of those
            // in full on every single login for no reason. Skip them here;
            // getUsers()/getTeam() are never called outside admin-gated code.
            if (isAdmin) {
                // Admins edit this data directly and need to see other
                // admins' concurrent changes live, so this keeps the
                // always-on listeners rather than the cache below.
                promises.push(onceThenListen(_ref.products, snap => {
                    _dbProducts = _fbArr(snap);
                    if (_firebaseReady) refreshCurrentPage();
                }, err => console.warn('Products listener:', err.message)));

                promises.push(onceThenListen(_ref.bubbles, snap => {
                    _dbBubbles = _fbArr(snap);
                    if (_firebaseReady) refreshCurrentPage();
                }, err => console.warn('Bubbles listener:', err.message)));

                promises.push(_ref.syrups.once('value').then(snap => { _dbSyrups = _fbArr(snap); }));

                promises.push(onceThenListen(_ref.users, snap => {
                    _dbUsers = _fbArr(snap);
                }, err => console.warn('Users listener:', err.message)));

                promises.push(onceThenListen(_ref.team, snap => {
                    _dbTeam = _fbArr(snap);
                    if (_firebaseReady) renderLandingTeam();
                }, err => console.warn('Team listener:', err.message)));
            } else {
                _dbUsers = [profile];
                _dbTeam = [];
                // Customers/employees never edit the menu, so a live
                // listener buys them nothing -- this checks one small
                // version number and only re-downloads products/syrups/
                // bubbles when something actually changed since their
                // last visit, instead of on every single load.
                promises.push(loadCatalogWithCache());
            }

            return Promise.all(promises);
        }


        // ── MENU ──
        function renderMenu(m) {
            const products = getProducts();
            m.innerHTML =
                '<h1 class="page-title">Our Menu</h1><p class="page-subtitle">Handcrafted bubble teas made fresh for you — choose your flavor, pick your bubbles, and we\'ll deliver to your door.</p><div class="menu-grid" id="menu-grid"></div>';
            const g = $('menu-grid');
            if (!products.length) {
                g.innerHTML =
                    '<div class="empty-state"><span class="es-icon">🧋</span><p>No drinks available at the moment. Check back soon!</p></div>';
                return
            }
            products.forEach((p, i) => {
                const c = document.createElement('div');
                c.className = 'menu-card';
                c.style.animationDelay = i * .06 + 's';
                c.innerHTML =
                    `<span class="tag">${escapeHtml(p.tag)}</span><span class="emoji">${p.emoji}</span><h3>${escapeHtml(p.name)}</h3><p class="desc">${escapeHtml(p.description)}</p><div class="card-footer"><span class="price">${fmt(p.price)}</span><button class="btn-add" onclick="event.stopPropagation();openCustomize(${p.id})">Customize & Add</button></div>`;
                c.onclick = () => openCustomize(p.id);
                g.appendChild(c);
            });
        }

        // ── CUSTOMIZE MODAL ──
        function openCustomize(pid) {
            const p = getProducts().find(x => x.id === pid);
            if (!p) return;
            const ov = $('modal-overlay');
            ov.classList.remove('hidden');
            const currentSyrups = getSyrups();
            const currentBubbles = getBubbles();
            let selSyrup = currentSyrups.find(s => p.name.toLowerCase().includes(s.toLowerCase().split(' ')[0])) ||
                currentSyrups[0];
            let selBubbles = [];
            let bubbleAmount = 'standard';
            let qty = 1;

            function render() {
                const totalPrice = (p.price + (bubbleAmount === 'extra' ? EXTRA_BUBBLE_FEE : 0)) * qty;
                ov.innerHTML = `<div class="modal"><button class="modal-close" onclick="document.getElementById('modal-overlay').classList.add('hidden')">✕</button>
    <span style="font-size:2.5rem">${p.emoji}</span><h2 style="margin-top:8px">${escapeHtml(p.name)}</h2><p class="modal-sub">${fmt(p.price)} per drink</p>
    <div class="step-label"><span class="num">1</span>Choose Your Syrup</div>
    <div class="syrup-grid">${currentSyrups.map(s => `<div class="syrup-opt${s === selSyrup ? ' active' : ''}" onclick="window._cSyrup('${s}')">${escapeHtml(s)}</div>`).join('')}</div>
    <div class="step-label"><span class="num">2</span>Choose Your Bubbles</div>
    <div class="bubble-grid">${currentBubbles.map(t => `<div class="bubble-opt${selBubbles.includes(t.name) ? ' active' : ''}" onclick="window._cBub('${t.name}')">${t.emoji} ${escapeHtml(t.name)}</div>`).join('')}</div>
    <div class="step-label"><span class="num">3</span>Bubbles Amount</div>
    <div class="syrup-grid">
        <div class="syrup-opt${bubbleAmount === 'standard' ? ' active' : ''}" onclick="window._cAmount('standard')">Standard</div>
        <div class="syrup-opt${bubbleAmount === 'extra' ? ' active' : ''}" onclick="window._cAmount('extra')">Extra (+${fmt(EXTRA_BUBBLE_FEE)})</div>
    </div>
    <div class="qty-row"><label>Quantity</label><div class="qty-controls"><button onclick="window._cQty(-1)">−</button><span>${qty}</span><button onclick="window._cQty(1)">+</button></div></div>
    <button class="btn-primary" onclick="window._cAdd()">Add to Cart — ${fmt(totalPrice)}</button></div>`;
            }
            window._cSyrup = s => {
                selSyrup = s;
                render()
            };
            window._cBub = t => {
                const i = selBubbles.indexOf(t);
                i >= 0 ? selBubbles.splice(i, 1) : selBubbles.push(t);
                render()
            };
            window._cAmount = a => {
                bubbleAmount = a;
                render()
            };
            window._cQty = d => {
                qty = Math.max(1, qty + d);
                render()
            };
            window._cAdd = () => {
                const finalUnitPrice = p.price + (bubbleAmount === 'extra' ? EXTRA_BUBBLE_FEE : 0);
                cart.push({
                    productId: p.id,
                    productName: p.name,
                    emoji: p.emoji,
                    syrup: selSyrup,
                    bubbles: [...selBubbles],
                    bubbleAmount: bubbleAmount,
                    quantity: qty,
                    unitPrice: finalUnitPrice
                });
                updateCartBadge();
                ov.classList.add('hidden');
                toast(p.name + ' added to cart', 'success')
            };
            render();
        }


        // ── CART ──
        function toggleCart() {
            const p = $('cart-panel'),
                o = $('cart-overlay');
            p.classList.toggle('open');
            o.classList.toggle('hidden')
        }

        function closeCart() {
            $('cart-panel').classList.remove('open');
            $('cart-overlay').classList.add('hidden')
        }

        function updateCartBadge() {
            const b = $('cart-badge'),
                n = cart.reduce((s, i) => s + i.quantity, 0);
            b.textContent = n;
            b.classList.toggle('hidden', n === 0);
            renderCartItems()
        }

        function renderCartItems() {
            const ci = $('cart-items'),
                cf = $('cart-footer');
            if (!cart.length) {
                ci.innerHTML =
                    '<div class="cart-empty"><span class="ce-icon">🛒</span><p>Your cart is empty.<br>Add something delicious!</p></div>';
                cf.innerHTML = '';
                return
            }
            ci.innerHTML = cart.map((item, i) =>
                `<div class="cart-item"><span class="ci-emoji">${item.emoji}</span><div class="ci-info"><div class="ci-name">${escapeHtml(item.productName)}</div><div class="ci-detail">${_itemDetail(item)}</div><div class="ci-bottom"><span class="ci-price">${fmt(item.unitPrice * item.quantity)}</span><div class="ci-qty"><button onclick="cartQty(${i},-1)">−</button><span>${item.quantity}</span><button onclick="cartQty(${i},1)">+</button></div></div><button class="ci-remove" onclick="cartRemove(${i})">Remove</button></div></div>`
            ).join('');
            const total = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
            cf.innerHTML =
                `<div class="cart-total"><span>Total</span><span class="amount">${fmt(total)}</span></div><button class="btn-primary" onclick="closeCart();navigate('checkout')">Proceed to Checkout</button>`;
        }

        function cartQty(i, d) {
            cart[i].quantity = Math.max(1, cart[i].quantity + d);
            updateCartBadge()
        }

        function cartRemove(i) {
            const n = cart[i].productName;
            cart.splice(i, 1);
            updateCartBadge();
            toast(n + ' removed', 'info')
        }


        // ── CHECKOUT ──

        function renderCheckout(m) {
            if (!cart.length) {
                navigate('menu');
                toast('Your cart is empty', 'error');
                return
            }
            const totalItems = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
            const finalTotal = totalItems + (deliveryOption === 'delivery' ? DELIVERY_FEE : 0);
            payScreenshot = null;
            cashAmount = '';
            payMethod = 'cash';
            
            m.innerHTML = `<div class="checkout-card"><h2>Checkout</h2>
    <div class="order-summary-items">${cart.map(i => `<div class="osi"><span class="osi-name">${i.emoji} ${escapeHtml(i.productName)} x${i.quantity} <span style="color:var(--taupe);font-size:.8rem">(${_itemDetail(i)})</span></span><span class="osi-price">${fmt(i.unitPrice * i.quantity)}</span></div>`).join('')}
    ${deliveryOption === 'delivery' ? `<div class="osi"><span class="osi-name">🚚 Delivery Fee</span><span class="osi-price">${fmt(DELIVERY_FEE)}</span></div>` : ''}
    <div class="divider"></div>
    <div class="osi"><strong>Total</strong><strong style="color:var(--amber);font-family:'Playfair Display',serif;font-size:1.4rem">${fmt(finalTotal)}</strong></div></div>
    
    <div class="form-group"><label>How would you like to receive your order?</label>
        <div class="payment-tabs">
            <button class="${deliveryOption === 'pickup' ? 'active' : ''}" onclick="setDelivery('pickup')">🥡 Pickup</button>
            <button class="${deliveryOption === 'delivery' ? 'active' : ''}" onclick="setDelivery('delivery')">🚚 Delivery</button>  
        </div>
    </div>

    <div id="delivery-info" class="${deliveryOption === 'delivery' ? '' : 'hidden'}">
        <div class="form-group"><label>Delivery Location</label><input id="co-note" placeholder="e.g. MS2 Common Room, Vardenis Boys, Adriatic..." value=""><div class="form-error" id="co-note-err"></div></div>
    </div>
    
    <div class="form-group"><label>Payment Method</label>
        <div class="payment-tabs">
            <button class="active" id="pt-cash" onclick="switchPay('cash')">💵 Cash</button>
            <button id="pt-card" onclick="switchPay('card')">💳 Card Transfer</button>
        </div>
    </div>
    <div id="pay-details"></div>
    <div class="form-error" id="co-pay-err" style="margin-bottom:12px"></div>
    <button class="btn-primary" onclick="placeOrder()">Place Order</button></div>`;
            renderPayDetails();
        }

        function setDelivery(opt) {
            deliveryOption = opt;
            renderCheckout($('main-content'));
        }

        function switchPay(m) {
            payMethod = m;
            $('pt-cash').classList.toggle('active', m === 'cash');
            $('pt-card').classList.toggle('active', m === 'card');
            payScreenshot = null;
            cashAmount = '';
            clearErrs();
            renderPayDetails()
        }

        function renderPayDetails() {
            const d = $('pay-details');
            if (payMethod === 'cash') {
                const totalItems = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
                const total = totalItems + (deliveryOption === 'delivery' ? DELIVERY_FEE : 0);
                const mkBtn = (val) =>
                    `<button type="button" ${val < total ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''} onclick="setCash(${val})">֏${val.toLocaleString()}</button>`;
                d.innerHTML = `<div class="form-group"><label>Bill amount you will hand over</label><input type="number" id="co-cash" placeholder="e.g. ${total}" value="${cashAmount}" oninput="cashAmount=this.value" min="${total}">
    <div class="cash-amounts">${mkBtn(1000)}${mkBtn(2000)}${mkBtn(5000)}${mkBtn(10000)}${mkBtn(20000)}</div></div>`;
            } else {
                d.innerHTML =
                    `<div class="card-display">${CARD_NUMBER}</div><p style="text-align:center;color:var(--taupe);font-size:.85rem;margin-bottom:16px">Transfer the total and upload a screenshot as proof</p>
    <div class="upload-area" id="upload-area"><input type="file" accept="image/*" onchange="handleScreenshot(event)"><span id="upload-text">📎 Click or drag to upload screenshot</span><br><img id="upload-preview" class="preview" style="display:none"></div>`;
            }
        }

        function setCash(v) {
            cashAmount = v;
            const e = $('co-cash');
            if (e) e.value = v
        }

        function handleScreenshot(ev) {
            const f = ev.target.files[0];
            if (!f) return;
            const t = $('upload-text');
            if (t) t.textContent = 'Compressing…';
            compressImage(f, 1280, 0.7).then(dataUrl => {
                payScreenshot = dataUrl;
                const p = $('upload-preview');
                if (p) {
                    p.src = payScreenshot;
                    p.style.display = 'block'
                }
                if (t) t.textContent = '✓ Screenshot uploaded'
            }).catch(() => {
                if (t) t.textContent = '📎 Click or drag to upload screenshot';
                toast('Could not process that image, please try another', 'error');
            });
        }

        function placeOrder() {
            clearErrs();
            let note = 'Pickup';
            if (deliveryOption === 'delivery') {
                note = $('co-note').value.trim();
                if (!note) {
                    showErr('co-note-err', 'Please enter a delivery location');
                    return;
                }
            }
            const totalItems = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
            const total = totalItems + (deliveryOption === 'delivery' ? DELIVERY_FEE : 0);
            if (payMethod === 'cash' && (!cashAmount || Number(cashAmount) < total)) {
                showErr('co-pay-err', 'Please enter a bill amount of at least ֏' + total.toLocaleString());
                return;
            }
            if (payMethod === 'card' && !payScreenshot) {
                showErr('co-pay-err', 'Please upload a payment screenshot');
                return;
            }
            const order = {
                id: genOrderId(),
                customerEmail: currentUser.email,
                customerName: currentUser.name,
                items: cart.map(i => ({
                    name: i.productName,
                    emoji: i.emoji,
                    syrup: i.syrup,
                    bubbles: [...i.bubbles],
                    bubbleAmount: i.bubbleAmount,
                    quantity: i.quantity,
                    unitPrice: i.unitPrice
                })),
                total,
                deliveryFee: deliveryOption === 'delivery' ? DELIVERY_FEE : 0,
                deliveryType: deliveryOption,
                deliveryNote: note,
                paymentMethod: payMethod,
                paymentDetails: payMethod === 'cash' ? {
                    billAmount: Number(cashAmount)
                } : {
                    screenshot: payScreenshot
                },
                status: 'pending',
                timestamp: new Date().toISOString(),
                takenBy: null
            };
            createOrder(order);
            cart = [];
            updateCartBadge();
            window._lastOrderId = order.id;
            navigate('confirmation');
        }


        // ── CONFIRMATION ──
        function renderConfirmation(m) {
            const orders = getOrders(),
                o = orders.find(x => x.id === window._lastOrderId);
            if (!o) {
                navigate('menu');
                return
            }
            m.innerHTML =
                `<div class="confirmation"><div class="check">✓</div><h1 style="margin-bottom:8px">Order Placed!</h1>
    <p style="color:var(--taupe);margin-bottom:24px">Your drink is being prepared with care</p>
    <div style="background:var(--surface);border-radius:var(--radius);padding:24px;box-shadow:var(--shadow);text-align:left;max-width:460px;margin:0 auto">
    <div style="display:flex;justify-content:space-between;margin-bottom:16px"><span style="font-family:'Playfair Display',serif;font-size:1.2rem;font-weight:700;color:var(--amber)">${o.id}</span><span class="status-badge pending">Pending</span></div>
    ${(o.items || []).map(i => `<div class="osi"><span>${i.emoji} ${escapeHtml(i.name)} x${i.quantity}</span><span class="osi-price">${fmt(i.unitPrice * i.quantity)}</span></div>`).join('')}
    <div class="divider"></div>
    <div class="osi"><strong>Total</strong><strong style="color:var(--amber)">${fmt(o.total)}</strong></div>
    <p style="margin-top:12px;font-size:.85rem;color:var(--taupe)">📍 ${escapeHtml(o.deliveryNote)}</p>
    <p style="font-size:.85rem;color:var(--taupe)">💰 ${o.paymentMethod === 'cash' ? 'Cash — ֏' + Number(o.paymentDetails.billAmount).toLocaleString() : 'Card transfer'}</p>
    </div><button class="btn-primary" style="max-width:300px;margin:24px auto 0" onclick="navigate('menu')">Back to Menu</button></div>`;
        }

        // ── CUSTOMER ORDERS ──
        function renderCustomerOrders(m) {
            const orders = getOrders().filter(o => o.customerEmail === currentUser.email).sort((a, b) => new Date(b
                .timestamp) - new Date(a.timestamp));
            m.innerHTML =
                `<h1 class="page-title">My Orders</h1><p class="page-subtitle">Track the status of your bubble tea orders</p><div class="orders-grid" id="co-grid"></div>`;
            const g = $('co-grid');
            if (!orders.length) {
                g.innerHTML =
                    '<div class="empty-state"><span class="es-icon">📋</span><p>No orders yet — browse our menu to get started!</p></div>';
                return
            }
            g.innerHTML = orders.map(o => orderCardHTML(o, false)).join('');
        }



        function deleteTeamMember(id) {
            const team = getTeam();
            const m = team.find(x => x.id === id);
            if (!m) return;
            if (m.category === 'leader' && currentUser.role !== 'superadmin') {
                toast('Only Superadmin can delete leader cards', 'error');
                return;
            }
            if (!confirm('Delete ' + m.name + ' from the team?')) return;
            saveTeam(team.filter(x => x.id !== id));
            toast(m.name + ' removed', 'info');
            renderLandingTeam();
            if (currentPage === 'admin') renderAdminTab();
        }

        function openEditTeamMember(id) {
            const team = getTeam();
            const m = id ? team.find(x => x.id === id) : null;
            const isNew = !m;
            const category = m ? m.category : null;

            if (category === 'leader' && currentUser.role !== 'superadmin') {
                toast('Only Superadmin can edit leader cards', 'error');
                return;
            }

            const ov = $('modal-overlay');
            ov.classList.remove('hidden');
            let photoData = m ? (m.photo || null) : null;

            ov.innerHTML = `<div class="modal">
                <button class="modal-close" onclick="$('modal-overlay').classList.add('hidden')">✕</button>
                <h2>${isNew ? 'Add Team Member' : 'Edit ' + escapeHtml(m.name)}</h2>
                <p class="modal-sub">${category === 'leader' ? 'Leader card (superadmin only)' : 'Team member'}</p>
                <div class="form-group"><label>Full Name</label><input id="tm-name" value="${m ? escapeHtml(m.name) : ''}"></div>
                <div class="form-group"><label>Title / Role</label><input id="tm-title" value="${m ? escapeHtml(m.title) : ''}"></div>
                <div class="form-group"><label>Description</label><textarea id="tm-desc" rows="3" style="resize:vertical">${m ? escapeHtml(m.description || '') : ''}</textarea></div>
                <div class="form-group"><label>LinkedIn URL (optional)</label><input id="tm-linkedin" placeholder="https://www.linkedin.com/in/..." value="${m ? escapeHtml(m.linkedin || '') : ''}"></div>
                ${isNew ? `<div class="form-group"><label>Category</label>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <div class="role-opt active" id="tm-type-current-cas" onclick="tmSetCategory('current-cas')" style="flex:1">Current CAS Leader</div>
                        <div class="role-opt" id="tm-type-past-cas" onclick="tmSetCategory('past-cas')" style="flex:1">Past CAS Leader</div>
                        ${currentUser.role === 'superadmin' ? '<div class="role-opt" id="tm-type-leader" onclick="tmSetCategory(\'leader\')" style="flex:1">Leader (top card)</div>' : ''}
                    </div></div>` : ''}
                <div class="form-group"><label>Photo (optional)</label>
                    <div class="upload-area" style="padding:20px">
                        <input type="file" accept="image/*" onchange="tmHandlePhoto(event)">
                        <span id="tm-upload-txt">${photoData ? '✓ Photo uploaded' : '📎 Click to upload photo'}</span>
                        <img id="tm-preview" style="max-width:100px;max-height:100px;border-radius:50%;margin-top:8px;${photoData ? '' : 'display:none'}" src="${photoData || ''}">
                    </div>
                </div>
                <div class="form-error" id="tm-err"></div>
                <button class="btn-primary" onclick="saveTeamMember('${id || ''}')">${isNew ? 'Add Member' : 'Save Changes'}</button>
            </div>`;

            window._tmCategory = 'current-cas';
            window.tmSetCategory = (val) => {
                document.querySelectorAll('#tm-type-current-cas, #tm-type-past-cas, #tm-type-leader').forEach(el => el.classList.remove('active'));
                const target = document.getElementById('tm-type-' + val);
                if (target) target.classList.add('active');
                window._tmCategory = val;
            };
            window.tmHandlePhoto = (ev) => {
                const f = ev.target.files[0];
                if (!f) return;
                const txt = document.getElementById('tm-upload-txt');
                if (txt) txt.textContent = 'Compressing…';
                // Leader cards (Elina & Boris) render nearly twice as large
                // on-screen as the CAS cards and there are only ever two of
                // them, so they get a noticeably higher-quality compression
                // pass — negligible extra storage, much crisper photos.
                const isLeader = category === 'leader' || window._tmCategory === 'leader';
                compressImage(f, isLeader ? 640 : 320, isLeader ? 0.88 : 0.65).then(dataUrl => {
                    photoData = dataUrl;
                    const prev = document.getElementById('tm-preview');
                    if (prev) {
                        prev.src = photoData;
                        prev.style.display = 'block';
                    }
                    if (txt) txt.textContent = '✓ Photo uploaded';
                }).catch(() => {
                    if (txt) txt.textContent = '📎 Click to upload photo';
                    toast('Could not process that image, please try another', 'error');
                });
            };
            window.saveTeamMember = (existingId) => {
                const name = document.getElementById('tm-name').value.trim();
                const title = document.getElementById('tm-title').value.trim();
                const desc = document.getElementById('tm-desc').value.trim();
                const linkedin = document.getElementById('tm-linkedin').value.trim();
                if (!name || !title) {
                    showErr('tm-err', 'Name and title are required');
                    return;
                }
                if (linkedin && !/^https?:\/\//i.test(linkedin)) {
                    showErr('tm-err', 'LinkedIn URL must start with http:// or https://');
                    return;
                }
                const team = getTeam();
                if (existingId) {
                    const idx = team.findIndex(x => x.id === existingId);
                    if (idx >= 0) {
                        team[idx] = {
                            ...team[idx],
                            name,
                            title,
                            description: desc,
                            photo: photoData,
                            linkedin
                        };
                    }
                } else {
                    const newCategory = window._tmCategory || 'current-cas';
                    const sameCategory = team.filter(x => x.category === newCategory);
                    const maxOrder = sameCategory.length ? Math.max(...sameCategory.map(x => x.order)) + 1 : 0;
                    team.push({
                        id: 't' + Date.now(),
                        name,
                        title,
                        description: desc,
                        photo: photoData,
                        linkedin,
                        category: newCategory,
                        order: maxOrder
                    });
                }
                saveTeam(team);
                toast(existingId ? 'Member updated' : name + ' added to team', 'success');
                $('modal-overlay').classList.add('hidden');
                renderLandingTeam();
                if (currentPage === 'admin') renderAdminTab();
            };
        }


        // ── ADMIN ──
        let adminTab = 'history';

        function renderAdmin(m) {
            m.innerHTML = `<h1 class="page-title">Admin Panel</h1><p class="page-subtitle">Manage orders, products, accounts, and track revenue</p>
    <div class="admin-tabs"><button class="${adminTab === 'history' ? 'active' : ''}" onclick="adminNav('history')">📋 Orders History</button><button class="${adminTab === 'profit' ? 'active' : ''}" onclick="adminNav('profit')">💰 Daily Profit</button><button class="${adminTab === 'products' ? 'active' : ''}" onclick="adminNav('products')">🧋 Products</button><button class="${adminTab === 'syrups' ? 'active' : ''}" onclick="adminNav('syrups')">🍯 Syrups</button><button class="${adminTab === 'bubbles' ? 'active' : ''}" onclick="adminNav('bubbles')">🫧 Bubbles</button>${(currentUser.role === 'superadmin' || currentUser.role === 'admin') ? `<button class="${adminTab === 'accounts' ? 'active' : ''}" onclick="adminNav('accounts')">👥 Accounts</button>` : ''}<button class="${adminTab === 'team' ? 'active' : ''}" onclick="adminNav('team')">Team Members</button></div>
    <div id="admin-content"></div>`;
            renderAdminTab();
        }

        function adminNav(t) {
            adminTab = t;
            document.querySelectorAll('.admin-tabs button').forEach(b => b.classList.remove('active'));
            event.target.classList.add('active');
            renderAdminTab()
        }

        function renderAdminTab() {
            if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin' && adminTab === 'accounts') adminTab = 'history';
            const c = $('admin-content');
            if (!c) return;
            if (adminTab === 'history') renderAdminHistory(c);
            else if (adminTab === 'profit') renderAdminProfit(c);
            else if (adminTab === 'products') renderAdminProducts(c);
            else if (adminTab === 'syrups') renderAdminSyrups(c);
            else if (adminTab === 'bubbles') renderAdminBubbles(c);
            else if (adminTab === 'accounts') renderAdminAccounts(c);
            else if (adminTab === 'team') renderAdminTeam(c);
        }

        function renderAdminHistory(c) {
            let orders = getOrders().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            c.innerHTML =
                `<div class="section-header"><h3>All Orders (${orders.length})</h3><div class="filter-row"><label style="font-size:.85rem">Filter by date:</label><input type="date" id="ah-date" onchange="filterHistory()" style="width:auto"></div></div><div id="ah-table-wrap"></div>`;
            window._allOrders = orders;
            renderHistoryTable(orders);
        }
        window.filterHistory = function () {
            const d = $('ah-date').value;
            const orders = d ? window._allOrders.filter(o => dateKey(o.timestamp) === d) : window._allOrders;
            renderHistoryTable(orders)
        };

        function renderHistoryTable(orders) {
            const w = $('ah-table-wrap');
            if (!orders.length) {
                w.innerHTML = '<div class="empty-state"><p>No orders found.</p></div>';
                return
            }
            w.innerHTML = `<div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>ID</th><th>Customer</th><th>Location</th><th>Items</th><th>Total</th><th>Pay</th><th>Status</th><th>Time</th><th>Action</th></tr></thead><tbody>
    ${orders.map(o => `<tr><td style="color:var(--amber);font-weight:600">${o.id}</td><td>${escapeHtml(o.customerName)}<br><span style="color:var(--taupe);font-size:0.75rem">${escapeHtml(o.customerEmail)}</span></td><td style="font-size:0.85rem">${escapeHtml(o.deliveryNote)}</td><td style="font-size:0.85rem">${(o.items || []).map(i => i.emoji + ' ' + escapeHtml(i.name)).join(', ')}</td><td style="font-weight:600">${fmt(o.total)}</td><td>${o.paymentMethod === 'cash' ? 'Cash' : 'Card'}${o.paymentMethod === 'card' && o.paymentDetails?.screenshot ? ` <img src="${o.paymentDetails.screenshot}" class="screenshot-thumb" onclick="showImg('${o.id}')">` : ''}</td><td><span class="status-badge ${o.status}">${o.status}</span></td><td style="font-size:0.75rem">${fmtDate(o.timestamp)}</td><td><button class="btn-danger btn-sm" onclick="deleteOrder('${o.id}')">Delete</button></td></tr>`).join('')}
    </tbody></table></div>`;
        }

        function deleteOrder(id) {
            if (!confirm('Are you sure you want to delete this order entirely?')) return;
            removeOrder(id);
            toast('Order deleted forever', 'info');
            renderAdminTab()
        }

        function renderAdminProfit(c) {
            const orders = getOrders().filter(o => o.status === 'delivered');
            const byDate = {};
            orders.forEach(o => {
                const d = dateKey(o.timestamp);
                if (!byDate[d]) byDate[d] = {
                    date: d,
                    count: 0,
                    revenue: 0
                };
                byDate[d].count++;
                byDate[d].revenue += o.total
            });
            const rows = Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
            const totalRev = rows.reduce((s, r) => s + r.revenue, 0);
            c.innerHTML =
                `<div style="display:flex;gap:20px;margin-bottom:24px;flex-wrap:wrap">
    <div style="background:var(--surface);border-radius:16px;padding:24px 32px;box-shadow:var(--shadow);flex:1;min-width:200px"><p style="color:var(--taupe);font-size:.85rem;margin-bottom:4px">Total Revenue</p><h2 style="color:var(--amber);font-size:2rem">${fmt(totalRev)}</h2></div>
    <div style="background:var(--surface);border-radius:16px;padding:24px 32px;box-shadow:var(--shadow);flex:1;min-width:200px"><p style="color:var(--taupe);font-size:.85rem;margin-bottom:4px">Completed Orders</p><h2 style="font-size:2rem">${orders.length}</h2></div>
    <div style="background:var(--surface);border-radius:16px;padding:24px 32px;box-shadow:var(--shadow);flex:1;min-width:200px"><p style="color:var(--taupe);font-size:.85rem;margin-bottom:4px">Days Active</p><h2 style="font-size:2rem">${rows.length}</h2></div></div>
    ${rows.length ? `<div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>Date</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${new Date(r.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${r.count}</td><td style="font-weight:600;color:var(--amber)">${fmt(r.revenue)}</td></tr>`).join('')}
    </tbody></table></div>`: '<div class="empty-state"><span class="es-icon">📊</span><p>No completed orders yet. Revenue will appear here once orders are delivered.</p></div>'}`;
        }

        function renderAdminProducts(c) {
            const products = getProducts();
            c.innerHTML = `<div class="admin-form"><h3>Add New Product</h3>
    <div class="form-group"><label>Name</label><input id="ap-name" placeholder="e.g. Mango Sunrise"></div>
    <div class="form-row">
    <div class="form-group"><label>Emoji</label><input id="ap-emoji" placeholder="e.g. 🥭" maxlength="4"></div>
    <div class="form-group"><label>Price (֏)</label><input type="number" id="ap-price" placeholder="e.g. 1500"></div>
    </div>
    <div class="form-group"><label>Description</label><input id="ap-desc" placeholder="A short, appealing description"></div>
    <div class="form-group"><label>Tag</label><input id="ap-tag" placeholder="e.g. New, Premium, Fruity"></div>
    <div class="form-error" id="ap-err"></div>
    <button class="btn-primary" onclick="addProduct()">Add Product</button></div>
    <h3 style="margin-bottom:16px">Current Products (${products.length})</h3>
    <div class="orders-grid">${products.map(p => `<div class="order-card" style="display:flex;align-items:center;gap:16px">
    <span style="font-size:2.5rem">${p.emoji}</span><div style="flex:1"><strong>${escapeHtml(p.name)}</strong><br><span style="color:var(--taupe);font-size:.85rem">${escapeHtml(p.description)}</span><br><span style="color:var(--amber);font-weight:600">${fmt(p.price)}</span> · <span class="status-badge pending" style="font-size:.7rem">${escapeHtml(p.tag)}</span></div>
    <button class="btn-danger btn-sm" onclick="deleteProduct(${p.id})">Delete</button></div>`).join('')}</div>`;
        }

        function addProduct() {
            clearErrs();
            const name = $('ap-name').value.trim(),
                emoji = $('ap-emoji').value.trim(),
                price = Number($('ap-price').value),
                desc = $('ap-desc').value.trim(),
                tag = $('ap-tag').value.trim();
            if (!name || !emoji || !price || !desc || !tag) {
                showErr('ap-err', 'All fields are required');
                return
            }
            if (price <= 0) {
                showErr('ap-err', 'Price must be greater than 0');
                return
            }
            const products = getProducts();
            const id = products.length ? Math.max(...products.map(p => p.id)) + 1 : 1;
            products.push({
                id,
                name,
                emoji,
                description: desc,
                price,
                tag
            });
            saveProducts(products);
            toast(name + ' added to menu', 'success');
            renderAdminTab();
        }

        function deleteProduct(id) {
            const products = getProducts().filter(p => p.id !== id);
            saveProducts(products);
            toast('Product removed', 'info');
            renderAdminTab()
        }

        function renderAdminSyrups(c) {
            const syrups = getSyrups();
            c.innerHTML =
                `<div class="admin-form"><h3>Add New Syrup</h3>
    <div class="form-group"><label>Syrup Name</label><input id="as-name" placeholder="e.g. Vanilla Bean"></div>
    <div class="form-error" id="as-err"></div>
    <button class="btn-primary" onclick="addSyrup()">Add Syrup</button></div>
    <h3 style="margin-bottom:16px">Current Syrups (${syrups.length})</h3>
    <div class="orders-grid">${syrups.map((s, idx) => `<div class="order-card" style="display:flex;align-items:center;justify-content:space-between">
    <strong>${escapeHtml(s)}</strong><button class="btn-danger btn-sm" onclick="deleteSyrup(${idx})">Delete</button></div>`).join('')}</div>`;
        }

        function addSyrup() {
            clearErrs();
            const name = $('as-name').value.trim();
            if (!name) {
                showErr('as-err', 'Syrup name is required');
                return
            }
            const syrups = getSyrups();
            if (syrups.includes(name)) {
                showErr('as-err', 'Syrup already exists');
                return
            }
            syrups.push(name);
            saveSyrups(syrups);
            toast(name + ' added', 'success');
            renderAdminTab();
        }

        function deleteSyrup(idx) {
            const syrups = getSyrups();
            syrups.splice(idx, 1);
            saveSyrups(syrups);
            toast('Syrup removed', 'info');
            renderAdminTab()
        }

        function renderAdminBubbles(c) {
            const bubbles = getBubbles();
            c.innerHTML =
                `<div class="admin-form"><h3>Add New Bubble Type</h3>
    <div class="form-row">
    <div class="form-group"><label>Emoji</label><input id="ab-emoji" placeholder="e.g. ⚫" maxlength="4"></div>
    <div class="form-group"><label>Bubble Name</label><input id="ab-name" placeholder="e.g. Tapioca"></div>
    </div>
    <div class="form-error" id="ab-err"></div>
    <button class="btn-primary" onclick="addBubble()">Add Bubble</button></div>
    <h3 style="margin-bottom:16px">Current Bubbles (${bubbles.length})</h3>
    <div class="orders-grid">${bubbles.map((t, idx) => `<div class="order-card" style="display:flex;align-items:center;justify-content:space-between">
    <span><span style="font-size:1.5rem;margin-right:8px">${t.emoji}</span><strong>${escapeHtml(t.name)}</strong></span><button class="btn-danger btn-sm" onclick="deleteBubble(${idx})">Delete</button></div>`).join('')}</div>`;
        }

        function addBubble() {
            clearErrs();
            const name = $('ab-name').value.trim(),
                emoji = $('ab-emoji').value.trim() || '⚫';
            if (!name) {
                showErr('ab-err', 'Bubble name is required');
                return
            }
            const bubbles = getBubbles();
            if (bubbles.find(t => t.name.toLowerCase() === name.toLowerCase())) {
                showErr('ab-err', 'Bubble already exists');
                return
            }
            bubbles.push({
                emoji,
                name
            });
            saveBubbles(bubbles);
            toast(name + ' added', 'success');
            renderAdminTab();
        }

        function deleteBubble(idx) {
            const bubbles = getBubbles();
            bubbles.splice(idx, 1);
            saveBubbles(bubbles);
            toast('Bubble removed', 'info');
            renderAdminTab()
        }

        function renderAdminAccounts(c) {
            if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') return;
            const users = getUsers().filter(u => u && u.uid);
            c.innerHTML = `<h3 style="margin-bottom:16px">Registered Accounts (${users.length})</h3>
    <div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Action</th></tr></thead><tbody>
    ${users.map(u => {
        const isSuperRow = u.role === 'superadmin';
        const isSelf = u.uid === currentUser.uid;
        return `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td>
    <select class="role-changer" onchange="changeAccountRole('${u.uid}', this.value)" ${isSelf || isSuperRow ? 'disabled' : ''} style="padding:4px;border-radius:4px;background:var(--surface);color:var(--text);border:1px solid var(--border)">
        <option value="customer" ${u.role === 'customer' ? 'selected' : ''}>Customer</option>
        <option value="employee" ${u.role === 'employee' ? 'selected' : ''}>Staff</option>
        <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        ${isSuperRow ? '<option value="superadmin" selected>Superadmin</option>' : ''}
    </select>
    </td>
    <td>${isSelf ? '<span style="color:var(--taupe);font-size:.8rem">You</span>' : isSuperRow ? '<span style="color:var(--taupe);font-size:.8rem">Protected</span>' : `<button class="btn-danger btn-sm" onclick="deleteAccount('${u.uid}','${u.email}')">Delete</button>`}</td></tr>`;
    }).join('')}
    </tbody></table></div>
    <div id="legacy-accounts-section"></div>`;
            renderLegacyAccounts();
        }

        // Accounts still sitting in the old plaintext format (pre-upgrade,
        // haven't logged in yet to auto-migrate). Superadmin can clear these
        // out manually once confident everyone active has moved over.
        function renderLegacyAccounts() {
            _ref.users.once('value').then(snap => {
                const val = snap.val() || {};
                const legacyEntries = Object.entries(val).filter(([k, v]) => v && v.password !== undefined);
                const el = $('legacy-accounts-section');
                if (!el) return;
                if (!legacyEntries.length) {
                    el.innerHTML = '';
                    return;
                }
                el.innerHTML = `<h3 style="margin:24px 0 12px">Not Yet Migrated (${legacyEntries.length})</h3>
        <p style="color:var(--taupe);font-size:.85rem;margin-bottom:12px">These accounts registered before the security upgrade and will migrate automatically the next time they log in. You can remove old records manually below.</p>
        <div style="overflow-x:auto"><table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Action</th></tr></thead><tbody>
        ${legacyEntries.map(([key, v]) => `<tr><td>${escapeHtml(v.name || '')}</td><td>${escapeHtml(v.email || '')}</td><td>${escapeHtml(v.role || '')}</td><td><button class="btn-danger btn-sm" onclick="removeLegacyAccount('${key}')">Remove old record</button></td></tr>`).join('')}
        </tbody></table></div>`;
            }).catch(() => {});
        }

        function removeLegacyAccount(key) {
            if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') return;
            if (!confirm('Remove this old-format record? The person will need to register again to get a new account.')) return;
            _ref.users.child(key).remove().then(() => {
                toast('Old record removed', 'info');
                renderAdminTab();
            }).catch(e => toast('Could not remove: ' + e.message, 'error'));
        }

        // Admins can promote/demote anyone up to and including admin — but
        // never touch the superadmin's own record. The security rules
        // enforce this server-side too; this check just avoids a pointless
        // permission-denied round trip and keeps the UI honest.
        function changeAccountRole(uid, newRole) {
            if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') return;
            const target = getUsers().find(u => u.uid === uid);
            if (target && target.role === 'superadmin') return;
            if (currentUser.role === 'admin' && newRole === 'superadmin') return;
            _ref.users.child(uid).update({ role: newRole }).then(() => {
                toast('Role updated', 'success');
            }).catch(e => toast('Could not update role: ' + e.message, 'error'));
        }

        function deleteAccount(uid, email) {
            if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') return;
            if (uid === currentUser.uid) return;
            const target = getUsers().find(u => u.uid === uid);
            if (target && target.role === 'superadmin') return;
            _ref.users.child(uid).remove().then(() => {
                const theirOrders = getOrders().filter(o => o.customerEmail === email);
                theirOrders.forEach(o => removeOrder(o.id));
                toast('Account access removed', 'info');
                renderAdminTab();
            }).catch(e => toast('Could not delete account: ' + e.message, 'error'));
        }


        function adminTeamSectionHtml(members, canManage, gradient) {
            if (!members.length) return '';
            return `<div class="orders-grid" style="margin-bottom:32px">${members.map(m => {
                const photoSize = "80px";
                const photo = m.photo ? `<img src="${m.photo}" style="width:${photoSize};height:${photoSize};border-radius:50%;object-fit:cover;border:3px solid var(--surface);box-shadow:0 4px 12px rgba(0,0,0,0.1)">` : `<div style="width:${photoSize};height:${photoSize};border-radius:50%;background:linear-gradient(135deg,${gradient});display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--dark);font-size:1.5rem">${escapeHtml(getInitials(m.name))}</div>`;
                return `<div class="order-card" style="display:flex;align-items:center;gap:16px">
                    ${photo}
                    <div style="flex:1">
                        <strong>${escapeHtml(m.name)}</strong><br>
                        <span style="color:var(--amber);font-size:.85rem">${escapeHtml(m.title)}</span><br>
                        <span style="color:var(--taupe);font-size:.8rem">${escapeHtml((m.description||'').substring(0,80))}${(m.description||'').length>80?'...':''}</span>
                    </div>
                    ${canManage ? `<div style="display:flex;flex-direction:column;gap:6px">
                        <button class="btn-outline btn-sm" onclick="openEditTeamMember('${m.id}')">Edit</button>
                        <button class="btn-danger btn-sm" onclick="deleteTeamMember('${m.id}')">Delete</button>
                    </div>` : '<span style="color:var(--taupe);font-size:.75rem">Superadmin only</span>'}
                </div>`;
            }).join('')}</div>`;
        }

        function renderAdminTeam(c) {
            const team = getTeam();
            const isSuper = currentUser.role === 'superadmin';
            const canManageOthers = isSuper || currentUser.role === 'admin';
            const leaders = team.filter(m => m.category === 'leader').sort((a, b) => a.order - b.order);
            const currentCas = team.filter(m => m.category === 'current-cas').sort((a, b) => a.order - b.order);
            const pastCas = team.filter(m => m.category === 'past-cas').sort((a, b) => a.order - b.order);

            let html = `<div style="margin-bottom:24px;display:flex;gap:12px;flex-wrap:wrap">
                <button class="btn-primary" style="width:auto;padding:10px 20px" onclick="openEditTeamMember('')">+ Add Team Member</button>
            </div>`;

            html += `<h3 style="margin-bottom:12px;font-size:1.1rem">Our Leaders (Superadmin only)</h3>`;
            html += leaders.length ? adminTeamSectionHtml(leaders, isSuper, 'var(--amber),var(--gold)') :
                '<p style="color:var(--taupe);margin-bottom:24px">No leader cards yet.</p>';

            html += `<h3 style="margin-bottom:12px;font-size:1.1rem">Current CAS Leaders</h3>`;
            html += currentCas.length ? adminTeamSectionHtml(currentCas, canManageOthers, 'var(--taupe),var(--amber)') :
                '<p style="color:var(--taupe);margin-bottom:24px">No current CAS leaders yet.</p>';

            html += `<h3 style="margin-bottom:12px;font-size:1.1rem">Past CAS Leaders</h3>`;
            html += pastCas.length ? adminTeamSectionHtml(pastCas, canManageOthers, 'var(--taupe),var(--amber)') :
                '<p style="color:var(--taupe)">No past CAS leaders yet. Click "Add Team Member" above.</p>';

            c.innerHTML = html;
        }


        // ── INIT ──
        document.addEventListener('DOMContentLoaded', () => {
            _auth.onAuthStateChanged(authUser => {
                if (!authUser) {
                    window.location.href = 'login.html';
                    return;
                }
                enterApp(authUser);
            });
        });

        // A single targeted read for exactly this account instead of
        // pulling the whole users table just to find one row in it. A
        // fresh registration/migration redirects only after its own
        // profile write resolves, so this should already be visible; one
        // short retry is a cheap safety net against a stray timing hiccup.
        function readOwnProfile(uid, retriesLeft) {
            return _ref.users.child(uid).once('value').then(snap => {
                const p = snap.val();
                if (p) return p;
                if (retriesLeft > 0) {
                    return new Promise(r => setTimeout(r, 500)).then(() => readOwnProfile(uid, retriesLeft - 1));
                }
                throw new Error('Your account profile could not be found. Please try logging in again.');
            });
        }

        function enterApp(authUser) {
            readOwnProfile(authUser.uid, 1).then(profile => {
                // setupFirebaseListeners() attaches the live listeners this
                // app relies on for real-time updates, and resolves once
                // each has its first snapshot in hand — so the initial load
                // rides on those same reads instead of firing a second,
                // redundant once() read per ref on top of them. It also
                // knows the caller's role now, so it can skip fetching data
                // that role never needs.
                return setupFirebaseListeners(profile).then(() => profile);
            }).then(profile => {
                // Seeding defaults and running the team migration both
                // require admin/superadmin write permission under the
                // security rules — skip them entirely for everyone else
                // instead of surfacing a permission-denied error toast.
                const canManage = profile.role === 'admin' || profile.role === 'superadmin';
                if (canManage) {
                    if (!_dbProducts.length) saveProducts([...DEFAULT_PRODUCTS]);
                    if (!_dbSyrups.length) saveSyrups([...DEFAULT_SYRUPS]);
                    if (!_dbBubbles.length) saveBubbles([...DEFAULT_BUBBLES]);
                }
                // migrateOrders() needs the full order list to rebuild it
                // correctly, so only run it from a role that actually has
                // that (customers only ever fetch their own orders below).
                const migrateP = profile.role !== 'customer' ? migrateOrders() : Promise.resolve();
                return Promise.all([initTeam(canManage), migrateP]).then(() => profile);
            }).then(profile => {
                _firebaseReady = true;
                startApp(profile);
                if (profile.role !== 'customer') startScreenshotCleanup();
            }).catch(err => {
                console.error('Firebase init error:', err);
                toast('Connection failed: ' + err.message, 'error');
            });
        }

        function startApp(user) {
            currentUser = user;
            $('app').style.display = 'block';
            $('nav-user').textContent = user.name;
            cart = [];
            buildNav();
            navigate(user.role === 'customer' ? 'menu' : 'pending');
        }
