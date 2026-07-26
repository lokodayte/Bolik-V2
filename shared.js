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
        const _auth = firebase.auth();

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
            team: _fb.ref('bolik_team'),
            teamMigratedV3: _fb.ref('bolik_team_migrated_v3')
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
        // Timestamp component + random suffix, rather than 4 random base36
        // chars alone (~1.7M possible values, realistic collision risk at
        // scale) — genOrderId() below also checks for an actual collision.
        const genId = () => 'BO-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2, 3).toUpperCase();

        function genOrderId() {
            let id = genId();
            while (getOrders().some(o => o.id === id)) id = genId();
            return id;
        }
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

        // Escapes a value before it's dropped into an innerHTML template
        // literal, so a name/note/bio containing markup can't inject script
        // or break out of an attribute (stored XSS).
        function escapeHtml(str) {
            return String(str == null ? '' : str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
        const _itemDetail = i => {
            let d = `<span style="opacity:0.8">Syrup:</span> ${escapeHtml(i.syrup)}`;
            if (i.bubbles && i.bubbles.length) d += ` | <span style="opacity:0.8">Bubbles:</span> ${escapeHtml(i.bubbles.join(', '))}`;
            if (i.bubbleAmount === 'extra' || i.extraBubbles) d +=
                ' <span style="display:inline-block;background:var(--amber);color:#fff;padding:0 6px;border-radius:4px;font-weight:900;font-size:0.75rem;margin-left:5px;vertical-align:middle;box-shadow:0 0 10px rgba(217, 123, 168, 0.4)">EXTRA BUBBLES</span>';
            return d;
        };

        // ── DATA (Firebase-backed with local cache) ──
        function getUsers() {
            return _dbUsers;
        }

        // Targeted per-account write (as opposed to the old pattern of
        // overwriting the whole users list every time) — the security rules
        // gate writes per-uid, so every profile create/update goes through
        // this instead of a blanket saveUsers(wholeArray).
        function saveUserProfile(uid, data) {
            return _ref.users.child(uid).update(data).catch(e => {
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
            return _ref.team.set(t).catch(e => {
                toast('Team DB Error: ' + e.message, 'error');
                throw e;
            });
        }

        // category: 'leader' (Our Leaders — superadmin-only, always exactly
        // Elina + Boris), 'current-cas', or 'past-cas' (admin-manageable).
        // Replaces the old isLeader boolean two-tier model.
        const DEFAULT_TEAM = [{
                id: 't2',
                name: 'Elina Mosoyan',
                title: 'Founder & Project Leader',
                description: 'Elina is the heart of Bolik — her vision and leadership shaped the entire project. She drives the mission of student entrepreneurship at UWC Dilijan.',
                photo: null,
                category: 'leader',
                order: 0,
                linkedin: 'https://www.linkedin.com/in/elina-mosoian/'
            },
            {
                id: 't1',
                name: 'Boris Sargsyan',
                title: 'Lead Developer & Co-Founder',
                description: 'Boris is the technical backbone of Bolik, building the platform that powers every order. A passionate developer and CAS leader at UWC Dilijan.',
                photo: null,
                category: 'leader',
                order: 1,
                linkedin: 'https://www.linkedin.com/in/lokodayte/'
            },
            {
                id: 't4',
                name: 'Davit',
                title: 'Current CAS Leader',
                description: '',
                photo: null,
                category: 'current-cas',
                order: 0,
                linkedin: ''
            },
            {
                id: 't5',
                name: 'Drotsho',
                title: 'Current CAS Leader',
                description: '',
                photo: null,
                category: 'current-cas',
                order: 1,
                linkedin: ''
            },
            {
                id: 't3',
                name: 'Matteo Saad',
                title: 'Past CAS Leader',
                description: 'Matteo ensured Bolik stayed true to its CAS roots, coordinating activities and keeping the team connected to UWC values.',
                photo: null,
                category: 'past-cas',
                order: 0,
                linkedin: ''
            }
        ];

        // Runs once ever (tracked via bolik_team_migrated_v3) to reset the
        // team list to exactly DEFAULT_TEAM, replacing the old isLeader
        // model. Requires admin/superadmin write permission, so only
        // attempt it when the logged-in user actually has that — an
        // anonymous landing-page visitor or a customer can't write here
        // under the security rules, and would otherwise just see a
        // permission-denied error toast for no reason.
        function initTeam(canManage) {
            if (!canManage) return Promise.resolve();
            return _ref.teamMigratedV3.once('value').then(snap => {
                if (snap.val()) return;
                // Merge onto whatever's already there instead of blindly
                // overwriting — this preserves any photo/description already
                // uploaded for Boris, Elina, Matteo (matched by id) rather
                // than resetting them to the bare DEFAULT_TEAM placeholders.
                const existing = _dbTeam || [];
                const findExisting = (id, name) => existing.find(x => x.id === id) || existing.find(x => x.name === name);
                const merged = DEFAULT_TEAM.map(def => {
                    const old = findExisting(def.id, def.name);
                    if (!old) return def;
                    return {
                        ...def,
                        photo: old.photo || def.photo,
                        description: old.description || def.description
                    };
                });
                return saveTeam(merged).then(() => _ref.teamMigratedV3.set(true));
            });
        }

        function getInitials(name) {
            return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
        }

        // Clicking a team card with a linkedin field opens it in a new tab.
        // Reads the URL from a data-attribute (escaped as a normal HTML
        // attribute) rather than interpolating it into an inline onclick
        // JS-string, since the latter can't be safely escaped against a
        // value containing a quote.
        function openTeamLink(el, ev) {
            if (ev.target.closest('button')) return;
            const url = el.dataset.linkedin;
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
        }

        function leaderCardHtml(m, canManage) {
            const photo = m.photo ?
                `<img src="${m.photo}" class="leader-photo-img" alt="${escapeHtml(m.name)}" loading="lazy">` :
                `<div class="leader-initials-div">${escapeHtml(getInitials(m.name))}</div>`;
            const actions = canManage ?
                `<div class="card-admin-btns">
                    <button class="btn-outline btn-sm" onclick="event.stopPropagation();openEditTeamMember('${m.id}')">✏️ Edit</button>
                    <button class="btn-danger btn-sm" onclick="event.stopPropagation();deleteTeamMember('${m.id}')">🗑️ Delete</button>
                   </div>` : '';
            const clickAttrs = m.linkedin ? `data-linkedin="${escapeHtml(m.linkedin)}" onclick="openTeamLink(this,event)" style="cursor:pointer"` : '';
            return `<div class="leader-card-new" ${clickAttrs}>
                ${photo}
                <h4>${escapeHtml(m.name)}</h4>
                <div class="leader-card-title">${escapeHtml(m.title)}</div>
                <div class="leader-card-desc">${escapeHtml(m.description || '')}</div>
                ${actions}
            </div>`;
        }

        function teamCardHtml(m, canManage) {
            const photo = m.photo ?
                `<img src="${m.photo}" class="team-photo-img" alt="${escapeHtml(m.name)}" loading="lazy">` :
                `<div class="team-initials-div">${escapeHtml(getInitials(m.name))}</div>`;
            const actions = canManage ?
                `<div class="card-admin-btns" style="margin-top:16px">
                    <button class="btn-outline btn-sm" onclick="event.stopPropagation();openEditTeamMember('${m.id}')">✏️ Edit</button>
                    <button class="btn-danger btn-sm" onclick="event.stopPropagation();deleteTeamMember('${m.id}')">🗑️ Delete</button>
                   </div>` : '';
            const clickAttrs = m.linkedin ? `data-linkedin="${escapeHtml(m.linkedin)}" onclick="openTeamLink(this,event)" style="cursor:pointer"` : '';
            return `<div class="team-card-new" ${clickAttrs}>
                ${photo}
                <h4>${escapeHtml(m.name)}</h4>
                <div class="team-card-title">${escapeHtml(m.title)}</div>
                <div class="team-card-desc">${escapeHtml(m.description || '')}</div>
                ${actions}
            </div>`;
        }

        function renderLandingTeam() {
            const team = getTeam();
            const leaders = team.filter(m => m.category === 'leader').sort((a, b) => a.order - b.order);
            const currentCas = team.filter(m => m.category === 'current-cas').sort((a, b) => a.order - b.order);
            const pastCas = team.filter(m => m.category === 'past-cas').sort((a, b) => a.order - b.order);

            const lg = document.getElementById('lp-leaders-grid');
            if (!lg) return;
            const cg = document.getElementById('lp-current-cas-grid');
            const pg = document.getElementById('lp-past-cas-grid');

            // Safety: Ensure currentUser is valid and has a role before showing admin actions
            const isAdmin = currentUser && currentUser.role === 'admin';
            const isSuper = currentUser && currentUser.role === 'superadmin';

            const canManageLeaders = isSuper;
            const canManageOthers = isSuper || isAdmin;

            lg.innerHTML = leaders.map(m => leaderCardHtml(m, canManageLeaders)).join('');

            if (cg) {
                cg.innerHTML = currentCas.length ? currentCas.map(m => teamCardHtml(m, canManageOthers)).join('') :
                    '<p style="color:var(--taupe);text-align:center;padding:20px">No current CAS leaders yet.</p>';
            }
            if (pg) {
                pg.innerHTML = pastCas.length ? pastCas.map(m => teamCardHtml(m, canManageOthers)).join('') :
                    '<p style="color:var(--taupe);text-align:center;padding:20px">No past CAS leaders yet.</p>';
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

