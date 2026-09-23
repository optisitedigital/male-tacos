require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// Sert tout le site (index.html, css, js, images, admin.html) depuis la racine du repo
app.use(express.static(path.join(__dirname, '..')));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;       // ex: "optisitedigital/male-tacos"
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PRODUCTS_PATH = 'products.json';

// ---------- Sécurité admin ----------
function checkAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD non configuré côté serveur' });
  }
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ ok: false, error: 'Mot de passe incorrect' });
});

// ---------- Lecture / écriture de products.json sur GitHub ----------
async function getProductsFile() {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${PRODUCTS_PATH}?ref=${GITHUB_BRANCH}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
  });
  if (!r.ok) throw new Error(`Impossible de lire products.json sur GitHub (${r.status})`);
  const data = await r.json();
  const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
  return { content, sha: data.sha };
}

async function saveProductsFile(newContent, sha, message) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${PRODUCTS_PATH}`;
  const body = {
    message: message || 'Mise à jour des produits via le panneau admin',
    content: Buffer.from(JSON.stringify(newContent, null, 2)).toString('base64'),
    sha,
    branch: GITHUB_BRANCH
  };
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Erreur GitHub (${r.status}) : ${await r.text()}`);
  return r.json();
}

// ---------- Routes publiques ----------
app.get('/api/products', async (req, res) => {
  try {
    const { content } = await getProductsFile();
    res.json(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Routes admin (protégées) ----------
app.post('/api/admin/products/:category', checkAdmin, async (req, res) => {
  try {
    const { category } = req.params;
    if (!['eleve', 'exterieur'].includes(category)) {
      return res.status(400).json({ error: 'Catégorie invalide' });
    }
    const newProduct = req.body;
    if (!newProduct.id) newProduct.id = 'p' + Date.now();

    const { content, sha } = await getProductsFile();
    content[category].push(newProduct);
    await saveProductsFile(content, sha, `Ajout produit: ${newProduct.name}`);
    res.json({ ok: true, products: content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/admin/products/:category/:id', checkAdmin, async (req, res) => {
  try {
    const { category, id } = req.params;
    if (!['eleve', 'exterieur'].includes(category)) {
      return res.status(400).json({ error: 'Catégorie invalide' });
    }
    const { content, sha } = await getProductsFile();
    const idx = content[category].findIndex((p) => p.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Produit introuvable' });

    content[category][idx] = { ...content[category][idx], ...req.body, id };
    await saveProductsFile(content, sha, `Modification produit: ${id}`);
    res.json({ ok: true, products: content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/products/:category/:id', checkAdmin, async (req, res) => {
  try {
    const { category, id } = req.params;
    if (!['eleve', 'exterieur'].includes(category)) {
      return res.status(400).json({ error: 'Catégorie invalide' });
    }
    const { content, sha } = await getProductsFile();
    const before = content[category].length;
    content[category] = content[category].filter((p) => p.id !== id);
    if (content[category].length === before) {
      return res.status(404).json({ error: 'Produit introuvable' });
    }
    await saveProductsFile(content, sha, `Suppression produit: ${id}`);
    res.json({ ok: true, products: content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Malé Tacos server prêt sur le port ' + PORT));
