// Bolik — landing page + login/register/OTP flow. Runs on login.html only.
// Depends on shared.js being loaded first.

        // ── STATE (this page only) ──
        let selectedRole = 'customer';
        let pendingRegistration = null;
        let pendingOtp = null;
        let otpResendTimer = null;

        function showAuthTab(tab) {
            pendingRegistration = null;
            pendingOtp = null;
            clearInterval(otpResendTimer);
            $('otp-step').classList.add('hidden');
            $('login-form').classList.toggle('hidden', tab !== 'login');
            $('register-form').classList.toggle('hidden', tab !== 'register');
            $('tab-login').classList.toggle('active', tab === 'login');
            $('tab-register').classList.toggle('active', tab === 'register');
            document.querySelectorAll('.form-error').forEach(e => {
                e.classList.remove('show');
                e.textContent = ''
            })
        }

        function selectRole(el, role) {
            selectedRole = role;
            document.querySelectorAll('.role-opt').forEach(e => e.classList.remove('active'));
            el.classList.add('active')
        }

        // Works for both first-time sign-up and returning sign-in — Firebase
        // creates the underlying account transparently either way, so there's
        // no separate "register with Google" path.
        //
        // Note: this function does NOT itself decide what happens after a
        // successful sign-in (domain check, profile creation, redirect).
        // Firebase fires onAuthStateChanged the instant the popup resolves —
        // before this function's own .then() would run — so that listener
        // (in the INIT block below) is the single place that decides whether
        // to accept the session. Duplicating that logic here would race it.
        function signInWithGoogle() {
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            _auth.signInWithPopup(provider).catch(err => {
                if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
                if (err.code === 'auth/account-exists-with-different-credential') {
                    toast('An account already exists for this email — please sign in with your password instead.', 'error');
                } else {
                    toast('Google sign-in failed: ' + err.message, 'error');
                }
            });
        }

        function handleLogin(ev) {
            ev.preventDefault();
            clearErrs();
            const email = $('login-email').value.trim().toLowerCase(),
                pass = $('login-pass').value;
            if (!validEmail(email)) {
                showErr('login-email-err', 'Only @uwcdilijan.am or @student.uwcdilijan.am emails allowed');
                return
            }
            _auth.signInWithEmailAndPassword(email, pass).then(() => {
                loginAs();
            }).catch(err => {
                const noSuchAuthAccount = ['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential']
                    .includes(err.code);
                if (noSuchAuthAccount) {
                    // Not a Firebase Auth account yet — might be a pre-upgrade
                    // account that only exists in the old plaintext list.
                    attemptLegacyMigration(email, pass);
                } else {
                    showErr('login-pass-err', 'Login failed: ' + err.message);
                    toast('Login failed: ' + err.message, 'error');
                }
            });
        }

        // Accounts created before the security upgrade only exist as plaintext
        // rows in bolik_users, not as real Firebase Auth accounts. If the
        // password they just typed matches their old record, that's proof of
        // identity enough to silently create a real Firebase Auth account for
        // them with the same password and carry their role over — no separate
        // "reset your password" step needed.
        function attemptLegacyMigration(email, pass) {
            const legacy = getUsers().find(u => u && u.email && u.email.toLowerCase() === email && u.password === pass);
            if (!legacy) {
                const exists = getUsers().find(u => u && u.email && u.email.toLowerCase() === email);
                if (exists) showErr('login-pass-err', 'Invalid password. Account exists.');
                else showErr('login-pass-err', 'Account not found. Please register or check email.');
                return;
            }
            _auth.createUserWithEmailAndPassword(email, pass).then(cred => {
                const role = (legacy.email === SUPERADMIN_EMAIL) ? 'superadmin' : legacy.role;
                return saveUserProfile(cred.user.uid, {
                    uid: cred.user.uid,
                    email: legacy.email,
                    name: legacy.name,
                    role
                });
            }).then(() => {
                loginAs();
            }).catch(err => {
                showErr('login-pass-err', 'Could not upgrade your account: ' + err.message);
            });
        }

        function handleRegister(ev) {
            ev.preventDefault();
            clearErrs();
            const name = $('reg-name').value.trim(),
                email = $('reg-email').value.trim().toLowerCase(),
                pass = $('reg-pass').value,
                pass2 = $('reg-pass2').value;
            if (!name) {
                showErr('reg-name-err', 'Name is required');
                return
            }
            if (!validEmail(email)) {
                showErr('reg-email-err', 'Only @uwcdilijan.am or @student.uwcdilijan.am emails allowed');
                return
            }
            if (pass.length < 4) {
                showErr('reg-pass-err', 'Password must be at least 4 characters');
                return
            }
            if (pass !== pass2) {
                showErr('reg-pass2-err', 'Passwords do not match');
                return
            }
            let users = getUsers();
            if (users.find(u => u.email === email)) {
                showErr('reg-email-err', 'An account with this email already exists');
                return
            }
            const role = email === SUPERADMIN_EMAIL ? 'superadmin' : selectedRole;
            pendingRegistration = { name, email, pass, role };
            sendRegistrationOtp();
        }

        // ── REGISTRATION OTP (email verification, discourages mass account creation) ──
        const OTP_RESEND_COOLDOWN = 60; // seconds between resends
        const OTP_MAX_SENDS_PER_DAY = 5; // per email, guards against OTP spam/email-bombing

        function otpSendsAllowed(email) {
            const log = ls('bolik_otp_log') || {};
            const now = Date.now();
            const recent = (log[email] || []).filter(t => now - t < 24 * 60 * 60 * 1000);
            log[email] = recent;
            ls('bolik_otp_log', log);
            return recent.length < OTP_MAX_SENDS_PER_DAY;
        }

        function recordOtpSend(email) {
            const log = ls('bolik_otp_log') || {};
            log[email] = [...(log[email] || []), Date.now()];
            ls('bolik_otp_log', log);
        }

        function sendRegistrationOtp() {
            const email = pendingRegistration.email;
            if (!otpSendsAllowed(email)) {
                showErr('reg-email-err', 'Too many codes requested for this email today. Please try again tomorrow.');
                pendingRegistration = null;
                return;
            }
            const code = String(Math.floor(100000 + Math.random() * 900000));
            pendingOtp = { code, expires: Date.now() + 10 * 60 * 1000 };
            emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
                to_email: email,
                VERIFICATION_CODE: code
            }).then(() => {
                recordOtpSend(email);
                clearErrs();
                $('register-form').classList.add('hidden');
                $('otp-step').classList.remove('hidden');
                $('otp-email-display').textContent = email;
                $('otp-code').value = '';
                toast('Verification code sent to ' + email, 'success');
                startOtpResendCooldown();
            }).catch(err => {
                pendingOtp = null;
                toast('Could not send verification code: ' + (err.text || err.message || 'unknown error'), 'error');
            });
        }

        function startOtpResendCooldown() {
            const btn = $('otp-resend-btn');
            if (!btn) return;
            let remaining = OTP_RESEND_COOLDOWN;
            btn.disabled = true;
            btn.textContent = `Resend Code (${remaining}s)`;
            clearInterval(otpResendTimer);
            otpResendTimer = setInterval(() => {
                remaining--;
                if (remaining <= 0) {
                    clearInterval(otpResendTimer);
                    btn.disabled = false;
                    btn.textContent = 'Resend Code';
                } else {
                    btn.textContent = `Resend Code (${remaining}s)`;
                }
            }, 1000);
        }

        function resendOtp() {
            if (!pendingRegistration || $('otp-resend-btn').disabled) return;
            sendRegistrationOtp();
        }

        function cancelOtp() {
            pendingRegistration = null;
            pendingOtp = null;
            clearInterval(otpResendTimer);
            $('otp-step').classList.add('hidden');
            $('register-form').classList.remove('hidden');
            clearErrs();
        }

        function verifyOtpAndRegister() {
            const entered = $('otp-code').value.trim();
            if (!pendingOtp || !pendingRegistration) {
                showErr('otp-code-err', 'Session expired, please start over.');
                return;
            }
            if (Date.now() > pendingOtp.expires) {
                showErr('otp-code-err', 'Code expired. Tap Resend to get a new one.');
                return;
            }
            if (entered !== pendingOtp.code) {
                showErr('otp-code-err', 'Incorrect code. Please try again.');
                return;
            }
            const reg = pendingRegistration;
            pendingRegistration = null;
            pendingOtp = null;
            clearInterval(otpResendTimer);
            finishRegistration(reg);
        }


        function loginAs() {
            window.location.href = 'index.html';
        }

        function finishRegistration({ name, email, pass, role }) {
            let users = getUsers();
            if (users.find(u => u.email === email)) {
                $('otp-step').classList.add('hidden');
                $('register-form').classList.remove('hidden');
                showErr('reg-email-err', 'An account with this email already exists');
                return;
            }
            _auth.createUserWithEmailAndPassword(email, pass).then(cred => {
                return saveUserProfile(cred.user.uid, { uid: cred.user.uid, email, name, role });
            }).then(() => {
                loginAs();
            }).catch(err => {
                $('otp-step').classList.add('hidden');
                $('register-form').classList.remove('hidden');
                if (err.code === 'auth/email-already-in-use') {
                    showErr('reg-email-err', 'An account with this email already exists');
                } else if (err.code === 'auth/weak-password') {
                    showErr('reg-pass-err', 'Password is too weak, please choose a stronger one');
                } else {
                    showErr('reg-email-err', 'Could not create your account: ' + err.message);
                }
            });
        }

        function goToAuth() {
            $('landing-page').style.display = 'none';
            $('auth-page').style.display = 'flex';
        }

        function goToLanding() {
            $('auth-page').style.display = 'none';
            $('landing-page').style.display = 'flex';
        }

        // ── INIT ──
        document.addEventListener('DOMContentLoaded', () => {
            $('auth-page').style.display = 'none';

            // Single authority for "is this session acceptable" — covers
            // being already signed in on page load AND a Google popup
            // resolving (which fires this before any other code runs, ahead
            // of signInWithGoogle's own .then()). The domain check and the
            // "redirect once a profile exists" check apply to every sign-in
            // method. Auto-creating a *missing* profile only happens for
            // Google sign-ins: password-based flows (login/registration/
            // migration) already create their own profile via an explicit
            // call before redirecting, and racing that here with a second,
            // default-role write could leave the wrong role saved depending
            // on which write lands last.
            _auth.onAuthStateChanged(user => {
                if (!user) {
                    $('landing-page').style.display = 'flex';
                    return;
                }
                const email = (user.email || '').toLowerCase();
                if (!validEmail(email)) {
                    _auth.signOut().then(() => {
                        toast('Only @uwcdilijan.am or @student.uwcdilijan.am accounts are allowed.', 'error');
                    });
                    return;
                }
                _ref.users.child(user.uid).once('value').then(snap => {
                    if (snap.val()) {
                        window.location.href = 'index.html';
                        return;
                    }
                    const isGoogle = (user.providerData || []).some(p => p.providerId === 'google.com');
                    if (!isGoogle) return;
                    const role = (email === SUPERADMIN_EMAIL) ? 'superadmin' : 'customer';
                    return saveUserProfile(user.uid, {
                        uid: user.uid,
                        email,
                        name: user.displayName || email.split('@')[0],
                        role
                    }).then(() => {
                        window.location.href = 'index.html';
                    });
                });
            });

            // Keep the public team grid live if it changes while someone's browsing.
            _ref.team.on('value', function (snap) {
                _dbTeam = _fbArr(snap);
                if (_firebaseReady) renderLandingTeam();
            }, err => console.warn('Team listener:', err.message));

            // Fetch both in parallel instead of one after the other. Note:
            // the team migration (initTeam) never runs from this page —
            // it requires admin/superadmin write permission that an
            // anonymous landing-page visitor doesn't have; it runs from
            // index.html's enterApp() instead, once an admin logs in.
            Promise.all([
                _ref.users.once('value'),
                _ref.team.once('value')
            ]).then(([usersSnap, teamSnap]) => {
                _dbUsers = _fbArr(usersSnap);
                _dbTeam = _fbArr(teamSnap);

                _firebaseReady = true;
                renderLandingTeam();
            }).catch(err => {
                console.error('Firebase init error:', err);
                toast('Connection failed: ' + err.message, 'error');
            });
        });
