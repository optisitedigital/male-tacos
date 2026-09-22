'use strict';

/* ==========================================================================
   MALÉ TACOS — app.js
   ========================================================================== */

// ---------- Config produits (doit rester cohérent avec index.html) ----------
const PRICES = {
  std: 5000,
  can: 1500,
  spag: 1500,
  burger: 3000,
  vL: 12000,
  vXL: 24000,
  pL: 10000,
  pXL: 20000,
  supplement: 4000,
  deliveryFee: 6000
};

const WHATSAPP_NUMBER = '243858679024';
const CART_STORAGE_KEY = 'male-tacos-cart-v1';

// ==========================================================================
// UTILITAIRES
// ==========================================================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function formatFC(amount) {
  return amount.toLocaleString('fr-FR') + ' FC';
}

function getQty(id) {
  const el = document.getElementById(id);
  return el ? Math.max(0, parseInt(el.value, 10) || 0) : 0;
}

// ==========================================================================
// NAVIGATION MOBILE (menu hamburger)
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

  btn.addEventListener('click', () => {
    panel.classList.contains('is-open') ? close() : open();
  });
  overlay.addEventListener('click', close);
  closeBtn && closeBtn.addEventListener('click', close);

  // Fermer le menu si on clique un lien interne
  $$('.mobile-nav-list a').forEach((a) => a.addEventListener('click', close));
}

// ==========================================================================
// SÉLECTEUR DE PARCOURS — ÉLÈVE / EXTÉRIEUR
// ==========================================================================
function initPathSelector() {
  const cards = $$('.path-card');
  const sections = {
    eleve: $('#menu-eleve'),
    exterieur: $('#menu-exterieur')
  };
  if (!cards.length) return;

  function setPath(path) {
    cards.forEach((c) => c.classList.toggle('is-active', c.dataset.path === path));
    Object.entries(sections).forEach(([key, section]) => {
      if (section) section.classList.toggle('is-active', key === path);
    });
    localStorage.setItem('male-tacos-path', path);
    updateCartBar();
    // Scroll doux vers le menu correspondant
    sections[path] && sections[path].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  cards.forEach((card) => {
    card.addEventListener('click', () => setPath(card.dataset.path));
  });

  // Restaurer le dernier choix, sinon "eleve" par défaut
  const saved = localStorage.getItem('male-tacos-path');
  setPath(saved === 'exterieur' ? 'exterieur' : 'eleve');
}

// ==========================================================================
// STEPPERS DE QUANTITÉ (+ / -)
// ==========================================================================
function initQtySteppers() {
  $$('.qty-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      const step = btn.dataset.action === 'inc' ? 1 : -1;
      const min = parseInt(input.min || '0', 10);
      const next = Math.max(min, (parseInt(input.value, 10) || 0) + step);
      input.value = next;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  // Recalcul aussi si l'utilisateur tape directement dans le champ
  $$('.qty-input').forEach((input) => {
    input.addEventListener('input', () => {
      if (input.value === '') return;
      const min = parseInt(input.min || '0', 10);
      input.value = Math.max(min, parseInt(input.value, 10) || 0);
      updateCartBar();
    });
    input.addEventListener('change', updateCartBar);
  });
}

// ==========================================================================
// PANIER — calcul + barre sticky
// ==========================================================================
function computeCart() {
  const activePath = localStorage.getItem('male-tacos-path') === 'exterieur' ? 'exterieur' : 'eleve';
  let count = 0;
  let total = 0;

  if (activePath === 'eleve') {
    const qStd = getQty('q-std');
    const qCan = getQty('q-can');
    const qSpag = getQty('q-spag');
    const qBurger = getQty('q-burger');
    count = qStd + qCan + qSpag + qBurger;
    total = qStd * PRICES.std + qCan * PRICES.can + qSpag * PRICES.spag + qBurger * PRICES.burger;
  } else {
    const vL = getQty('v-l-qty');
    const vXL = getQty('v-xl-qty');
    const pL = getQty('p-l-qty');
    const pXL = getQty('p-xl-qty');
    const supplements = $$('.supp:checked').length;
    count = vL + vXL + pL + pXL;
    total =
      vL * PRICES.vL + vXL * PRICES.vXL + pL * PRICES.pL + pXL * PRICES.pXL +
      supplements * PRICES.supplement;
    if (count > 0) total += PRICES.deliveryFee;
  }

  return { path: activePath, count, total };
}

function updateCartBar() {
  const bar = $('#cartBar');
  const countEl = $('#cartCount');
  const totalEl = $('#cartTotal');
  if (!bar) return;

  const cart = computeCart();
  bar.classList.toggle('is-visible', cart.count > 0);
  if (countEl) countEl.textContent = `${cart.count} article${cart.count > 1 ? 's' : ''}`;
  if (totalEl) totalEl.textContent = formatFC(cart.total);

  saveCartSnapshot(cart);
}

// ==========================================================================
// PERSISTANCE DU PANIER (pour la reprise de commande)
// ==========================================================================
function saveCartSnapshot(cart) {
  if (cart.count === 0) {
    localStorage.removeItem(CART_STORAGE_KEY);
    return;
  }
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({
    ...cart,
    savedAt: Date.now()
  }));
}

function checkAbandonedCart() {
  const raw = localStorage.getItem(CART_STORAGE_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    // On ne propose la reprise que si le panier a été laissé il y a plus de 60s
    // (pour ne pas afficher le toast pendant que l'utilisateur remplit encore)
    const elapsed = Date.now() - saved.savedAt;
    if (saved.count > 0 && elapsed > 60000) {
      showResumeToast(saved);
    }
  } catch (e) { /* ignore */ }
}

function showResumeToast(saved) {
  const toast = $('#resumeToast');
  const text = $('#resumeToastText');
  const btn = $('#resumeBtn');
  const dismiss = $('#resumeDismiss');
  if (!toast) return;

  if (text) text.textContent = `Tu avais commencé une commande (${formatFC(saved.total)}).`;
  toast.classList.add('is-visible');

  btn && btn.addEventListener('click', () => {
    toast.classList.remove('is-visible');
    document.querySelector(`.path-card[data-path="${saved.path}"]`)?.click();
    $('#cartBar')?.scrollIntoView({ behavior: 'smooth' });
  }, { once: true });

  dismiss && dismiss.addEventListener('click', () => {
    toast.classList.remove('is-visible');
  }, { once: true });
}

// ==========================================================================
// ENVOI DE COMMANDE VIA WHATSAPP
// ==========================================================================
function envoyerCommande(mode) {
  let commande = '';
  let message = '';
  const anneeActuelle = new Date().getFullYear();

  if (mode === 'retrait') {
    const nom = $('#nom-eleve')?.value.trim();
    const classe = $('#classe')?.value.trim();
    const jourS = $('#jour-semaine')?.value;
    const jourD = $('#jour-date')?.value;
    const mois = $('#mois')?.value;
    const heure = $('#h-retrait')?.value;

    if (!nom || !jourD) {
      alert("Remplis ton nom et le numéro du jour !");
      return;
    }

    const qS = getQty('q-std');
    const qC = getQty('q-can');
    const qSp = getQty('q-spag');
    const qB = getQty('q-burger');

    if (qS > 0) commande += `%0A- ${qS} Tacos Standard`;
    if (qC > 0) commande += `%0A- ${qC} Em'’s yaourt`;
    if (qSp > 0) commande += `%0A- ${qSp} Spaghetti`;
    if (qB > 0) commande += `%0A- ${qB} Djo-burger`;

    if (!commande) {
      alert("Ajoute au moins un article !");
      return;
    }

    message = `*INSTITUT BOBOKOLI 🏫*%0A👤 ${nom}%0A👥 Classe: ${classe}%0A📅 Date: ${jourS} ${jourD} ${mois} ${anneeActuelle}%0A⏰ Heure: ${heure}%0A%0A*COMMANDE:*${commande}`;
  } else {
    const nom = $('#nom-livraison')?.value.trim();
    const commune = $('#commune')?.value.trim();
    const avenue = $('#avenue')?.value.trim();
    const num = $('#num-maison')?.value.trim();

    if (!nom || !commune) {
      alert("Remplis le nom et la commune !");
      return;
    }

    const vL = getQty('v-l-qty');
    const vXL = getQty('v-xl-qty');
    const pL = getQty('p-l-qty');
    const pXL = getQty('p-xl-qty');

    if (vL > 0) commande += `%0A- ${vL} Tacos Viande L (12k)`;
    if (vXL > 0) commande += `%0A- ${vXL} Tacos Viande XL (24k)`;
    if (pL > 0) commande += `%0A- ${pL} Tacos Poulet L (10k)`;
    if (pXL > 0) commande += `%0A- ${pXL} Tacos Poulet XL (20k)`;

    if (!commande) {
      alert("Ajoute au moins un article !");
      return;
    }

    const sauces = $$('.sauce:checked').map((s) => s.value);
    if (sauces.length) commande += `%0A🍯 *Sauces:* ${sauces.join(', ')}`;

    const supps = $$('.supp:checked').map((s) => s.value);
    if (supps.length) commande += `%0A🧀 *Suppléments:* ${supps.join(', ')}`;

    message = `*LIVRAISON DIRECTE 🚀*%0A👤 Nom: ${nom}%0A📍 ${commune}, ${avenue}%0A🏠 N°: ${num}%0A📍 _J'envoie ma localisation._%0A%0A*COMMANDE:*${commande}`;
  }

  // Commande envoyée avec succès : on vide le panier sauvegardé
  localStorage.removeItem(CART_STORAGE_KEY);

  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${message}`, '_blank');
}

function initOrderButtons() {
  $$('[data-order-mode]').forEach((btn) => {
    btn.addEventListener('click', () => envoyerCommande(btn.dataset.orderMode));
  });
}

// ==========================================================================
// INSTALLATION PWA
// ==========================================================================
let deferredInstallPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true; // iOS Safari
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function initInstallBanner() {
  const banner = $('#installBanner');
  const installBtn = $('#installBtn');
  const closeBtn = $('#installBannerClose');
  const textEl = $('#installBannerText');
  if (!banner) return;

  // Déjà installée, ou l'utilisateur a déjà refusé récemment
  if (isStandalone()) return;
  const dismissedAt = localStorage.getItem('male-tacos-install-dismissed');
  if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < 7 * 24 * 3600 * 1000) return;

  function show() {
    banner.classList.add('is-visible');
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    show();
  });

  // iOS ne déclenche jamais beforeinstallprompt : on affiche des instructions manuelles
  if (isIOS() && !isStandalone()) {
    if (textEl) {
      textEl.innerHTML = `<strong>Installe l'application</strong>Appuie sur Partager, puis « Sur l'écran d'accueil ».`;
    }
    if (installBtn) installBtn.style.display = 'none';
    show();
  }

  installBtn && installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    banner.classList.remove('is-visible');
    if (outcome !== 'accepted') {
      localStorage.setItem('male-tacos-install-dismissed', String(Date.now()));
    }
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
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[SW] Échec de l\'enregistrement :', err);
    });
  });
}

// ==========================================================================
// INIT
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initMobileNav();
  initPathSelector();
  initQtySteppers();
  initOrderButtons();
  initInstallBanner();
  registerServiceWorker();
  updateCartBar();
  checkAbandonedCart();
});
