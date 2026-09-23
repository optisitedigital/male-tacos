'use strict';

/* ==========================================================================
   MALÉ TACOS — products-render.js
   Récupère products.json (via l'API si dispo, sinon en direct) et génère
   dynamiquement les cartes produits, sauces et suppléments.
   Émet un événement "products:ready" quand tout est injecté dans le DOM,
   pour que app.js puisse initialiser les steppers et le calcul du panier.
   ========================================================================== */

async function fetchProducts() {
  // 1) On essaie l'API du serveur (Render) — toujours à jour, gérée par l'admin
  try {
    const r = await fetch('/api/products', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch (e) { /* pas grave, on tente le fallback */ }

  // 2) Fallback : le fichier products.json directement (utile en dev local,
  //    ou si le serveur admin est temporairement endormi/indisponible)
  const r2 = await fetch('./products.json', { cache: 'no-store' });
  if (!r2.ok) throw new Error('Impossible de charger les produits');
  return r2.json();
}

function formatFC(amount) {
  return amount.toLocaleString('fr-FR') + ' FC';
}

// ---------- Carte produit simple (menu élève : un seul prix) ----------
function renderSimpleProductCard(product) {
  const qtyId = `qty_${product.id}`;
  return `
    <div class="product-card" data-product-id="${product.id}">
      <img src="${product.image}" alt="${product.name}" class="product-card-img">
      <div class="product-card-body">
        <h3 class="product-card-name">${product.name}</h3>
        <p class="product-card-price">${formatFC(product.price)}</p>
        <div class="product-card-variant">
          <span></span>
          <div class="qty-stepper">
            <button class="qty-btn" data-target="${qtyId}" data-action="dec">–</button>
            <input type="number" id="${qtyId}" value="0" min="0" class="qty-input"
                   inputmode="numeric" data-price="${product.price}"
                   data-product-id="${product.id}" data-category="eleve">
            <button class="qty-btn" data-target="${qtyId}" data-action="inc">+</button>
          </div>
        </div>
      </div>
    </div>`;
}

// ---------- Carte produit à variantes (menu extérieur : L / XL) ----------
function renderVariantProductCard(product) {
  const variantsHtml = product.variants.map((v) => {
    const qtyId = `qty_${product.id}_${v.size}`;
    return `
      <div class="product-card-variant">
        <span>Taille ${v.size} (${formatFC(v.price)})</span>
        <div class="qty-stepper">
          <button class="qty-btn" data-target="${qtyId}" data-action="dec">–</button>
          <input type="number" id="${qtyId}" value="0" min="0" class="qty-input"
                 inputmode="numeric" data-price="${v.price}"
                 data-product-id="${product.id}" data-variant="${v.size}" data-category="exterieur">
          <button class="qty-btn" data-target="${qtyId}" data-action="inc">+</button>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="product-card" data-product-id="${product.id}">
      <img src="${product.image}" alt="${product.name}" class="product-card-img">
      <div class="product-card-body">
        <h3 class="product-card-name">${product.name}</h3>
        ${variantsHtml}
      </div>
    </div>`;
}

function renderSauces(sauces) {
  return sauces.map((s) => `
    <label class="chip-label"><input type="checkbox" class="sauce" value="${s}"> ${s}</label>
  `).join('');
}

function renderSupplements(supplements) {
  return supplements.map((s) => `
    <label class="chip-label"><input type="checkbox" class="supp" value="${s.name}" data-price="${s.price}"> ${s.name}</label>
  `).join('');
}

async function initProducts() {
  const eleveGrid = document.querySelector('#menu-eleve .product-grid');
  const exteriGrid = document.querySelector('#menu-exterieur .product-grid');
  const sauceGrid = document.querySelector('#menu-exterieur .chip-panel .chip-grid:nth-of-type(1)');
  const suppGrid = document.querySelector('#menu-exterieur .chip-panel .chip-grid:nth-of-type(2)');
  const deliveryBanner = document.querySelector('#menu-exterieur [data-delivery-fee]');

  try {
    const data = await fetchProducts();

    if (eleveGrid) {
      eleveGrid.innerHTML = data.eleve.map(renderSimpleProductCard).join('');
    }
    if (exteriGrid) {
      exteriGrid.innerHTML = data.exterieur.map(renderVariantProductCard).join('');
    }
    if (sauceGrid && data.sauces) {
      sauceGrid.innerHTML = renderSauces(data.sauces);
    }
    if (suppGrid && data.supplements) {
      suppGrid.innerHTML = renderSupplements(data.supplements);
    }
    if (deliveryBanner && data.deliveryFee) {
      deliveryBanner.textContent = `🚀 Frais de livraison : ${formatFC(data.deliveryFee)}`;
    }

    // Rend les données brutes disponibles globalement (utile pour app.js)
    window.__MALE_TACOS_PRODUCTS__ = data;

    document.dispatchEvent(new CustomEvent('products:ready', { detail: data }));
  } catch (err) {
    console.error('[products-render] Erreur de chargement des produits :', err);
    if (eleveGrid) eleveGrid.innerHTML = `<p class="info-banner">Impossible de charger le menu. Réessaie dans un instant.</p>`;
    if (exteriGrid) exteriGrid.innerHTML = '';
  }
}

document.addEventListener('DOMContentLoaded', initProducts);
