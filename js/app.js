'use strict';

const WHATSAPP_NUMBER = '243858679024';
const CART_STORAGE_KEY = 'male-tacos-cart-v1';

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function formatFC(amount) {
  return amount.toLocaleString('fr-FR') + ' FC';
}

// ==========================================================================
// NAVIGATION MOBILE
// ==========================================================================
function initMobileNav() {
  const btn = $('#hamburgerBtn');
  const overlay = $('#navOverlay');
  const panel = $('#mobileNav');
  const closeBtn = $('#mobileNavClose');
  if (!btn || !overlay || !panel) return;

  function open() {
    btn.classList.add('is-open');
    overlay.classList.add('is-visible');
    panel.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    btn.classList.remove('is-open');
    overlay.classList.remove('is-visible');
    panel.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  btn.addEventListener('click', () => panel.classList.contains('is-open') ? close() : open());
  overlay.addEventListener('click', close);
  closeBtn && closeBtn.addEventListener('click', close);
  $$('.mobile-nav-list a').forEach((a) => a.addEventListener('click', close));
}

// ==========================================================================
// SÉLECTEUR DE PARCOURS
// ==========================================================================
function initPathSelector() {
  const cards = $$('.path-card');
  const sections = { eleve: $('#menu-eleve'), exterieur: $('#menu-exterieur') };
  if (!cards.length) return;

  function setPath(path) {
    cards.forEach((c) => c.classList.toggle('is-active', c.dataset.path === path));
    Object.entries(sections).forEach(([key, section]) => {
      if (section) section.classList.toggle('is-active', key === path);
    });
    localStorage.setItem('male-tacos-path', path);
    updateCartBar();
    sections[path] && sections[path].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  cards.forEach((card) => card.addEventListener('click', () => setPath(card.dataset.path)));
  const saved = localStorage.getItem('male-tacos-path');
  setPath(saved === 'exterieur' ? 'exterieur' : 'eleve');
}

function getActivePath() {
  return localStorage.getItem('male-tacos-path') === 'exterieur' ? 'exterieur' : 'eleve';
}

// ==========================================================================
// STEPPERS (+ / -) — génériques, marchent avec n'importe quel produit
// ==========================================================================
function initQtySteppers() {
  $$('.qty-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const step = btn.dataset.action === 'inc' ? 1 : -1;
      const min = parseInt(input.min || '0', 10);
      input.value = Math.max(min, (parseInt(input.value, 10) || 0) + step);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  $$('.qty-input').forEach((input) => {
    input.addEventListener('input', () => {
      if (input.value === '') return;
      input.value = Math.max(0, parseInt(input.value, 10) || 0);
      updateCartBar();
    });
    input.addEventListener('change', updateCartBar);
  });

  $$('.supp').forEach((el) => el.addEventListener('change', updateCartBar));
}

// ==========================================================================
// PANIER — calcul générique à partir des data-attributes
// ==========================================================================
function computeCart() {
  const activePath = getActivePath();
  let count = 0, total = 0;

  $$(`.qty-input[data-category="${activePath}"]`).forEach((input) => {
    const qty = parseInt(input.value, 10) || 0;
    if (qty > 0) {
      count += qty;
      total += qty * (parseFloat(input.dataset.price) || 0);
    }
  });

  if (activePath === 'exterieur') {
    $$('.supp:checked').forEach((s) => { total += parseFloat(s.dataset.price) || 0; });
    if (count > 0) {
      const fee = (window.__MALE_TACOS_PRODUCTS__ && window.__MALE_TACOS_PRODUCTS__.deliveryFee) || 0;
      total += fee;
    }
  }

  return { path: activePath, count, total };
}

function updateCartBar() {
  const bar = $('#cartBar');
  if (!bar) return;
  const cart = computeCart();
  bar.classList.toggle('is-visible', cart.count > 0);
  const countEl = $('#cartCount'), totalEl = $('#cartTotal');
  if (countEl) countEl.textContent = `${cart.count} article${cart.count > 1 ? 's' : ''}`;
  if (totalEl) totalEl.textContent = formatFC(cart.total);
  saveCartSnapshot(cart);
}

function saveCartSnapshot(cart) {
  if (cart.count === 0) { localStorage.removeItem(CART_STORAGE_KEY); return; }
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ ...cart, savedAt: Date.now() }));
}

function checkAbandonedCart() {
  const raw = localStorage.getItem(CART_STORAGE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    if (saved.count > 0 && Date.now() - saved.savedAt > 60000) showResumeToast(saved);
  } catch (e) {}
}

function showResumeToast(saved) {
  const toast = $('#resumeToast');
  if (!toast) return;
  const text = $('#resumeToastText');
  if (text) text.textContent = `Tu avais commencé une commande (${formatFC(saved.total)}).`;
  toast.classList.add('is-visible');

  $('#resumeBtn')?.addEventListener('click', () => {
    toast.classList.remove('is-visible');
    document.querySelector(`.path-card[data-path="${saved.path}"]`)?.click();
    $('#cartBar')?.scrollIntoView({ behavior: 'smooth' });
  }, { once: true });

  $('#resumeDismiss')?.addEventListener('click', () => toast.classList.remove('is-visible'), { once: true });
}

// ==========================================================================
// ENVOI DE COMMANDE WHATSAPP — générique
// ==========================================================================
function envoyerCommande(mode) {
  let commande = '', message = '';
  const annee = new Date().getFullYear();

  if (mode === 'retrait') {
    const nom = $('#nom-eleve')?.value.trim();
    const classe = $('#classe')?.value.trim();
    const jourS = $('#jour-semaine')?.value;
    const jourD = $('#jour-date')?.value;
    const mois = $('#mois')?.value;
    const heure = $('#h-retrait')?.value;

    if (!nom || !jourD) { alert("Remplis ton nom et le numéro du jour !"); return; }

    $$('.qty-input[data-category="eleve"]').forEach((input) => {
      const qty = parseInt(input.value, 10) || 0;
      if (qty > 0) commande += `%0A- ${qty} ${input.dataset.name}`;
    });
    if (!commande) { alert("Ajoute au moins un article !"); return; }

    message = `*INSTITUT BOBOKOLI 🏫*%0A👤 ${nom}%0A👥 Classe: ${classe}%0A📅 Date: ${jourS} ${jourD} ${mois} ${annee}%0A⏰ Heure: ${heure}%0A%0A*COMMANDE:*${commande}`;
  } else {
    const nom = $('#nom-livraison')?.value.trim();
    const commune = $('#commune')?.value.trim();
    const avenue = $('#avenue')?.value.trim();
    const num = $('#num-maison')?.value.trim();

    if (!nom || !commune) { alert("Remplis le nom et la commune !"); return; }

    $$('.qty-input[data-category="exterieur"]').forEach((input) => {
      const qty = parseInt(input.value, 10) || 0;
      if (qty > 0) {
        const label = input.dataset.variant ? `${input.dataset.name} ${input.dataset.variant}` : input.dataset.name;
        commande += `%0A- ${qty} ${label} (${formatFC(parseFloat(input.dataset.price))})`;
      }
    });
    if (!commande) { alert("Ajoute au moins un article !"); return; }

    const sauces = $$('.sauce:checked').map((s) => s.value);
    if (sauces.length) commande += `%0A🍯 *Sauces:* ${sauces.join(', ')}`;

    const supps = $$('.supp:checked').map((s) => s.value);
    if (supps.length) commande += `%0A🧀 *Suppléments:* ${supps.join(', ')}`;

    message = `*LIVRAISON DIRECTE 🚀*%0A👤 Nom: ${nom}%0A📍 ${commune}, ${avenue}%0A🏠 N°: ${num}%0A📍 _J'envoie ma localisation._%0A%0A*COMMANDE:*${commande}`;
  }

  localStorage.removeItem(CART_STORAGE_KEY);
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, '_blank');
}

function initOrderButtons() {
  $$('[data-order-mode]').forEach((btn) => btn.addEventListener('click', () => envoyerCommande(btn.dataset.orderMode)));
}

// ==========================================================================
// INSTALLATION PWA
// ==========================================================================
let deferredInstallPrompt = null;
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }

function initInstallBanner() {
  const banner = $('#installBanner');
  if (!banner || isStandalone()) return;
  const dismissedAt = localStorage.getItem('male-tacos-install-dismissed');
  if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < 7 * 24 * 3600 * 1000) return;

  const installBtn = $('#installBtn'), closeBtn = $('#installBannerClose'), textEl = $('#installBannerText');
  function show() { banner.classList.add('is-visible'); }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    show();
  });

  if (isIOS() && !isStandalone()) {
    if (textEl) textEl.innerHTML = `<strong>Installe l'application</strong>Appuie sur Partager, puis « Sur l'écran d'accueil ».`;
    if (installBtn) installBtn.style.display = 'none';
    show();
  }

  installBtn && installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    banner.classList.remove('is-visible');
    if (outcome !== 'accepted') localStorage.setItem('male-tacos-install-dismissed', String(Date.now()));
  });

  closeBtn && closeBtn.addEventListener('click', () => {
    banner.classList.remove('is-visible');
    localStorage.setItem('male-tacos-install-dismissed', String(Date.now()));
  });

  window.addEventListener('appinstalled', () => {
    banner.classList.remove('is-visible');
    deferredInstallPrompt = null;
  });
}

// ==========================================================================
// SERVICE WORKER
// ==========================================================================
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('[SW] Échec :', err));
  });
}

// ==========================================================================
// INIT
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initMobileNav();
  initPathSelector();
  initInstallBanner();
  registerServiceWorker();
});

// Les produits sont chargés de façon asynchrone (fichier products-render.js) :
// on attend qu'ils soient injectés dans le DOM avant d'activer steppers/panier.
document.addEventListener('products:ready', () => {
  initQtySteppers();
  initOrderButtons();
  updateCartBar();
  checkAbandonedCart();
});
