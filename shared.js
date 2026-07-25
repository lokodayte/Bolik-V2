// Bolik — shared data layer, Firebase/EmailJS setup, and helpers used by
// both login.html and index.html. Load this before auth.js / app.js.

        // ── DATA ──
        const DEFAULT_SYRUPS = ['Classic Milk', 'Taro', 'Brown Sugar', 'Strawberry', 'Matcha', 'Passion Fruit',
            'Lychee Rose'
        ];
        const DEFAULT_BUBBLES = [{
            name: 'Tapioca Pearls',
            emoji: '⚫'
        }, {
            name: 'Popping Boba',
            emoji: '🫧'
        }, {
            name: 'Coconut Jelly',
            emoji: '🥥'
        }, {
            name: 'Red Bean',
            emoji: '🫘'
        }, {
            name: 'Aloe Vera',
            emoji: '🌿'
        }];
        const DEFAULT_PRODUCTS = [{
                id: 1,
                name: 'Classic Milk Tea',
                emoji: '🧋',
                description: 'Rich and creamy traditional milk tea with a smooth, malty finish',
                price: 1200,
                tag: 'Popular'
            },
            {
                id: 2,
                name: 'Taro Dream',
                emoji: '🟣',
                description: 'Velvety taro with a hint of vanilla and natural sweetness',
                price: 1500,
                tag: 'Signature'
            },
            {
                id: 3,
                name: 'Brown Sugar Boba',
                emoji: '🍯',
                description: 'Caramelized brown sugar swirled with fresh milk and tiger stripes',
                price: 1800,
                tag: 'Best Seller'
            },
            {
                id: 4,
                name: 'Strawberry Bliss',
                emoji: '🍓',
                description: 'Fresh strawberry essence blended with cream for a fruity finish',
                price: 1400,
                tag: 'Fruity'
            },
            {
                id: 5,
                name: 'Matcha Zen',
                emoji: '🍵',
                description: 'Ceremonial-grade Japanese matcha, earthy and impossibly smooth',
                price: 2000,
                tag: 'Premium'
            },
            {
                id: 6,
                name: 'Passion Fruit Burst',
                emoji: '🌺',
                description: 'Tropical passion fruit with a tangy, refreshing twist',
                price: 1300,
                tag: 'Refreshing'
            },
            {
                id: 7,
                name: 'Lychee Rose Garden',
                emoji: '🌹',
                description: 'Delicate lychee meets aromatic rose petals in a floral symphony',
                price: 1700,
                tag: 'Signature'
            }
        ];
        const SUPERADMIN_EMAIL = 'b.sargsyan@student.uwcdilijan.am';
        const CARD_NUMBER = 'Elina: 4083 0600 1503 9825';

        // ── FIREBASE ──
        const firebaseConfig = {
            apiKey: "AIzaSyAxem36soBAXOsfGHGgf33O9odr3mM6uy0",
            authDomain: "bolik-v2.firebaseapp.com",
            databaseURL: "https://bolik-v2-default-rtdb.firebaseio.com",
            projectId: "bolik-v2",
            storageBucket: "bolik-v2.firebasestorage.app",
            messagingSenderId: "919070471375",
            appId: "1:919070471375:web:39b5f3f8645fb98a30b3ba"
        };
        firebase.initializeApp(firebaseConfig);
        const _fb = firebase.database();

        // ── EMAILJS (registration OTP) ──
        const EMAILJS_SERVICE_ID = 'Bolik';
        const EMAILJS_TEMPLATE_ID = 'template_xj6bigj';
        const EMAILJS_PUBLIC_KEY = '4Rhjzk_gR3p1Vst5g';
        emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });

        const _ref = {
            users: _fb.ref('bolik_users'),
            orders: _fb.ref('bolik_orders'),
            products: _fb.ref('bolik_products'),
            syrups: _fb.ref('bolik_syrups'),
            bubbles: _fb.ref('bolik_bubbles'),
            team: _fb.ref('bolik_team')
        };

        // ── STATE (shared across pages) ──
        let currentUser = null;
        let _dbUsers = [];
        let _dbOrders = [];
        let _dbProducts = [];
        let _dbSyrups = [];
        let _dbBubbles = [];
        let _dbTeam = [];
        let _firebaseReady = false;

        // ── HELPERS ──
        const $ = id => document.getElementById(id);
        const ls = (k, v) => {
            if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
            localStorage.setItem(k, JSON.stringify(v))
        };
        const fmt = n => '֏' + n.toLocaleString();
        const genId = () => 'BO-' + Math.random().toString(36).substr(2, 4).toUpperCase();
        const fmtDate = d => {
            const o = new Date(d);
            return o.toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            }) + ' ' + o.toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit'
            })
        };
        const dateKey = d => new Date(d).toISOString().split('T')[0];

        // Resizes + re-encodes an uploaded image before it's stored in the DB,
        // since raw phone-camera screenshots (often several MB) get stored as
        // base64 and re-downloaded on every order-list render otherwise.
        function compressImage(file, maxDim, quality) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => {
                    const img = new Image();
                    img.onload = () => {
                        let { width, height } = img;
                        if (width > maxDim || height > maxDim) {
                            if (width > height) {
                                height = Math.round(height * maxDim / width);
                                width = maxDim;
                            } else {
                                width = Math.round(width * maxDim / height);
                                height = maxDim;
                            }
                        }
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL('image/jpeg', quality));
                    };
                    img.onerror = () => reject(new Error('Could not read image'));
                    img.src = e.target.result;
                };
                reader.onerror = () => reject(new Error('Could not read file'));
                reader.readAsDataURL(file);
            });
        }

        function _fbArr(snap) {
            const v = snap.val();
            if (!v) return [];
            return Array.isArray(v) ? v.filter(Boolean) : Object.values(v);
        }

        function validEmail(email) {
            return email.endsWith('@uwcdilijan.am') || email.endsWith('@student.uwcdilijan.am');
        }
        const _itemDetail = i => {
            let d = `<span style="opacity:0.8">Syrup:</span> ${i.syrup}`;
            if (i.bubbles && i.bubbles.length) d += ` | <span style="opacity:0.8">Bubbles:</span> ${i.bubbles.join(', ')}`;
            if (i.bubbleAmount === 'extra' || i.extraBubbles) d +=
                ' <span style="display:inline-block;background:var(--amber);color:#fff;padding:0 6px;border-radius:4px;font-weight:900;font-size:0.75rem;margin-left:5px;vertical-align:middle;box-shadow:0 0 10px rgba(217, 123, 168, 0.4)">EXTRA BUBBLES</span>';
            return d;
        };

        // ── DATA (Firebase-backed with local cache) ──
        function getUsers() {
            return _dbUsers;
        }

        function saveUsers(u) {
            _dbUsers = [...u];
            return _ref.users.set(u).catch(e => {
                toast('User DB Error: ' + e.message, 'error');
                throw e;
            });
        }

        function getOrders() {
            return _dbOrders;
        }

        function saveOrders(o) {
            _dbOrders = [...o];
            _ref.orders.set(o).catch(e => toast('Order DB Error: ' + e.message, 'error'));
        }

        function getProducts() {
            return _dbProducts.length ? _dbProducts : [...DEFAULT_PRODUCTS];
        }

        function saveProducts(p) {
            _dbProducts = [...p];
            _ref.products.set(p).catch(e => toast('Product DB Error: ' + e.message, 'error'));
        }

        function getSyrups() {
            return _dbSyrups.length ? _dbSyrups : [...DEFAULT_SYRUPS];
        }

        function saveSyrups(s) {
            _dbSyrups = [...s];
            _ref.syrups.set(s).catch(e => toast('Syrups DB Error: ' + e.message, 'error'));
        }

        function getBubbles() {
            return _dbBubbles.length ? _dbBubbles : [...DEFAULT_BUBBLES];
        }

        function saveBubbles(t) {
            _dbBubbles = [...t];
            _ref.bubbles.set(t).catch(e => toast('Bubbles DB Error: ' + e.message, 'error'));
        }

        function getTeam() {
            return _dbTeam;
        }

        function saveTeam(t) {
            _dbTeam = [...t];
            _ref.team.set(t).catch(e => toast('Team DB Error: ' + e.message, 'error'));
        }

        const DEFAULT_TEAM = [{
                id: 't2',
                name: 'Elina Mosoyan',
                title: 'Founder & Project Leader',
                description: 'Elina is the heart of Bolik — her vision and leadership shaped the entire project. She drives the mission of student entrepreneurship at UWC Dilijan.',
                photo: null,
                isLeader: true,
                order: 0
            },
            {
                id: 't1',
                name: 'Boris Sargsyan',
                title: 'Lead Developer & Co-Founder',
                description: 'Boris is the technical backbone of Bolik, building the platform that powers every order. A passionate developer and CAS leader at UWC Dilijan.',
                photo: null,
                isLeader: true,
                order: 1
            },
            {
                id: 't3',
                name: 'Matteo Saad',
                title: 'CAS Coordinator',
                description: 'Matteo ensures Bolik stays true to its CAS roots, coordinating activities and keeping the team connected to UWC values.',
                photo: null,
                isLeader: false,
                order: 2
            }
        ];

        function initTeam() {
            if (!_dbTeam.length) {
                saveTeam(DEFAULT_TEAM);
            } else {
                let changed = false;
                // One-time fix: if Boris is still order 0 and Elina is order 1, swap them
                const b = _dbTeam.find(x => x.id === 't1');
                const e = _dbTeam.find(x => x.id === 't2');
                if (b && e && b.order === 0 && e.order === 1) {
                    b.order = 1; e.order = 0;
                    changed = true;
                }
                // One-time fix: correct Boris's name (was saved as "Babken")
                if (b && b.name !== 'Boris Sargsyan') {
                    b.name = 'Boris Sargsyan';
                    changed = true;
                }
                if (changed) saveTeam(_dbTeam);
            }
        }

        function getInitials(name) {
            return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
        }

        function renderLandingTeam() {
            const team = getTeam();
            const leaders = team.filter(m => m.isLeader).sort((a, b) => a.order - b.order);
            const others = team.filter(m => !m.isLeader).sort((a, b) => a.order - b.order);

            const lg = document.getElementById('lp-leaders-grid');
            const tg = document.getElementById('lp-team-grid');
            if (!lg || !tg) return;

            // Safety: Ensure currentUser is valid and has a role before showing admin actions
            const isAdmin = currentUser && currentUser.role === 'admin';
            const isSuper = currentUser && currentUser.role === 'superadmin';
            
            const canManageLeaders = isSuper;
            const canManageOthers = isSuper || isAdmin;

            lg.innerHTML = leaders.map(m => {
                const photo = m.photo ?
                    `<img src="${m.photo}" class="leader-photo-img" alt="${m.name}">` :
                    `<div class="leader-initials-div">${getInitials(m.name)}</div>`;
                const actions = canManageLeaders ?
                    `<div class="card-admin-btns">
                        <button class="btn-outline btn-sm" onclick="openEditTeamMember('${m.id}')">✏️ Edit</button>
                        <button class="btn-danger btn-sm" onclick="deleteTeamMember('${m.id}')">🗑️ Delete</button>
                       </div>` : '';
                return `<div class="leader-card-new">
                    ${photo}
                    <h4>${m.name}</h4>
                    <div class="leader-card-title">${m.title}</div>
                    <div class="leader-card-desc">${m.description || ''}</div>
                    ${actions}
                </div>`;
            }).join('');

            if (!others.length) {
                tg.innerHTML =
                    '<p style="color:var(--taupe);text-align:center;padding:20px">No other team members yet.</p>';
            } else {
                tg.innerHTML = others.map(m => {
                    const photo = m.photo ?
                        `<img src="${m.photo}" class="team-photo-img" alt="${m.name}">` :
                        `<div class="team-initials-div">${getInitials(m.name)}</div>`;
                    const actions = canManageOthers ?
                        `<div class="card-admin-btns" style="margin-top:16px">
                            <button class="btn-outline btn-sm" onclick="openEditTeamMember('${m.id}')">✏️ Edit</button>
                            <button class="btn-danger btn-sm" onclick="deleteTeamMember('${m.id}')">🗑️ Delete</button>
                           </div>` : '';
                    return `<div class="team-card-new">
                        ${photo}
                        <h4>${m.name}</h4>
                        <div class="team-card-title">${m.title}</div>
                        <div class="team-card-desc">${m.description || ''}</div>
                        ${actions}
                    </div>`;
                }).join('');
            }
        }

        function initSuperadmin() {
            const idx = _dbUsers.findIndex(x => x && x.email === SUPERADMIN_EMAIL);
            if (idx === -1) {
                _dbUsers.push({
                    email: SUPERADMIN_EMAIL,
                    password: 'admin123',
                    name: 'Boris Sargsyan',
                    role: 'superadmin'
                });
                saveUsers(_dbUsers);
            } else {
                let changed = false;
                if (_dbUsers[idx].role !== 'superadmin') {
                    _dbUsers[idx].role = 'superadmin';
                    changed = true;
                }
                if (_dbUsers[idx].password !== 'admin123') {
                    _dbUsers[idx].password = 'admin123';
                    changed = true;
                }
                if (_dbUsers[idx].name !== 'Boris Sargsyan') {
                    _dbUsers[idx].name = 'Boris Sargsyan';
                    changed = true;
                }
                if (changed) saveUsers(_dbUsers);
            }
        }

        function toast(msg, type = 'info') {
            const t = document.createElement('div');
            t.className = 'toast ' + type;
            t.innerHTML = (type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ') + ' ' + msg;
            $('toast-container').appendChild(t);
            setTimeout(() => {
                t.style.opacity = '0';
                t.style.transform = 'translateX(40px)';
                setTimeout(() => t.remove(), 300)
            }, 3500)
        }

        function showErr(id, msg) {
            const e = $(id);
            e.textContent = msg;
            e.classList.add('show')
        }

        function clearErrs() {
            document.querySelectorAll('.form-error').forEach(e => {
                e.classList.remove('show');
                e.textContent = ''
            })
        }

