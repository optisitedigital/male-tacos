require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Site public + dashboard admin
app.use(express.static(path.join(__dirname, '..')));

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const PRODUCTS_PATH = 'products.json';
const ADMIN_COOKIE = 'male_tacos_admin';
const SESSION_DURATION = 12 * 60 * 60 * 1000;

// ======================================================
// OUTILS
// ======================================================

function githubHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'male-tacos-admin'
  };
}

function requireGithubConfig() {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    throw new Error(
      'GITHUB_TOKEN ou GITHUB_REPO n’est pas configuré sur Render.'
    );
  }
}

function sanitizeText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim();
}

function createProductId(name) {
  const base = sanitizeText(name, 'produit')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return `${base || 'produit'}-${Date.now()}`;
}

function safeFilename(name) {
  return sanitizeText(name, 'produit')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// ======================================================
// AUTH ADMIN
// ======================================================

function createAdminToken() {
  const timestamp = Date.now().toString();

  const signature = crypto
    .createHmac('sha256', ADMIN_PASSWORD || '')
    .update(timestamp)
    .digest('hex');

  return Buffer
    .from(`${timestamp}.${signature}`)
    .toString('base64url');
}

function verifyAdminToken(token) {
  if (!ADMIN_PASSWORD || !token) return false;

  try {
    const decoded = Buffer
      .from(token, 'base64url')
      .toString('utf8');

    const [timestamp, signature] = decoded.split('.');

    if (!timestamp || !signature) return false;

    const time = Number(timestamp);

    if (!Number.isFinite(time)) return false;

    if (Date.now() - time > SESSION_DURATION) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', ADMIN_PASSWORD)
      .update(timestamp)
      .digest('hex');

    if (signature.length !== expectedSignature.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie;

  if (!header) return null;

  for (const cookie of header.split(';')) {
    const index = cookie.indexOf('=');

    if (index === -1) continue;

    const key = cookie.slice(0, index).trim();
    const value = cookie.slice(index + 1).trim();

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return null;
}

function checkAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({
      error: 'ADMIN_PASSWORD non configuré sur Render.'
    });
  }

  const token = getCookie(req, ADMIN_COOKIE);

  if (!verifyAdminToken(token)) {
    return res.status(401).json({
      error: 'Session administrateur expirée ou invalide.'
    });
  }

  next();
}

// ======================================================
// LOGIN
// ======================================================

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};

  if (!ADMIN_PASSWORD) {
    return res.status(500).json({
      ok: false,
      error: 'ADMIN_PASSWORD non configuré sur Render.'
    });
  }

  if (
    typeof password !== 'string' ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      ok: false,
      error: 'Mot de passe incorrect.'
    });
  }

  const token = createAdminToken();

  const secure =
    process.env.NODE_ENV === 'production'
      ? '; Secure'
      : '';

  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_DURATION / 1000}; SameSite=Lax${secure}`
  );

  res.json({
    ok: true
  });
});

// ======================================================
// LOGOUT
// ======================================================

app.post('/api/admin/logout', (req, res) => {
  res.setHeader(
    'Set-Cookie',
    `${ADMIN_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
  );

  res.json({
    ok: true
  });
});

// ======================================================
// SESSION
// ======================================================

app.get('/api/admin/session', checkAdmin, (req, res) => {
  res.json({
    ok: true
  });
});

// ======================================================
// GITHUB — LIRE PRODUCTS.JSON
// ======================================================

async function getProductsFile() {
  requireGithubConfig();

  const url =
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${PRODUCTS_PATH}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;

  const response = await fetch(url, {
    headers: githubHeaders()
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Impossible de lire products.json (${response.status}) : ${text}`
    );
  }

  const data = await response.json();

  const content = JSON.parse(
    Buffer.from(data.content, 'base64').toString('utf8')
  );

  return {
    content,
    sha: data.sha
  };
}

// ======================================================
// GITHUB — SAUVER PRODUCTS.JSON
// ======================================================

async function saveProductsFile(content, sha, message) {
  requireGithubConfig();

  const url =
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${PRODUCTS_PATH}`;

  const body = {
    message:
      message ||
      'Mise à jour du menu via le dashboard Malé Tacos',

    content: Buffer
      .from(JSON.stringify(content, null, 2))
      .toString('base64'),

    sha,
    branch: GITHUB_BRANCH
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: githubHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Erreur GitHub products.json (${response.status}) : ${text}`
    );
  }

  return response.json();
}

// ======================================================
// GITHUB — UPLOAD IMAGE
// ======================================================

async function uploadImageToGithub({
  base64,
  mimeType,
  productName
}) {
  requireGithubConfig();

  if (!base64) {
    throw new Error('Aucune image reçue.');
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new Error(
      'Format image non supporté. Utilise JPG, PNG ou WebP.'
    );
  }

  const extension =
    mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/webp'
        ? 'webp'
        : 'jpg';

  const filename =
    `${safeFilename(productName) || 'produit'}-${Date.now()}.${extension}`;

  const githubPath = `images/products/${filename}`;

  const cleanBase64 = base64.includes(',')
    ? base64.split(',')[1]
    : base64;

  const buffer = Buffer.from(cleanBase64, 'base64');

  if (!buffer.length) {
    throw new Error('Image vide ou invalide.');
  }

  // Sécurité : éviter les images énormes
  if (buffer.length > 7 * 1024 * 1024) {
    throw new Error(
      'Image trop lourde. Choisis une image plus légère.'
    );
  }

  const url =
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${githubPath}`;

  const body = {
    message: `Ajout image produit: ${productName}`,
    content: buffer.toString('base64'),
    branch: GITHUB_BRANCH
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: githubHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      `Impossible d'envoyer l'image sur GitHub (${response.status}) : ${text}`
    );
  }

  return filename;
}

// ======================================================
// VALIDATION
// ======================================================

function validateProductsStructure(content) {
  if (!content || typeof content !== 'object') {
    throw new Error('Structure products.json invalide.');
  }

  if (!Array.isArray(content.eleve)) {
    throw new Error('La section eleve doit être un tableau.');
  }

  if (!Array.isArray(content.exterieur)) {
    throw new Error('La section exterieur doit être un tableau.');
  }

  if (!Array.isArray(content.sauces)) {
    throw new Error('La section sauces doit être conservée.');
  }

  if (!Array.isArray(content.supplements)) {
    throw new Error('La section supplements doit être conservée.');
  }

  if (
    typeof content.deliveryFee !== 'number' ||
    !Number.isFinite(content.deliveryFee)
  ) {
    throw new Error('deliveryFee invalide.');
  }
}

function validateEleveProduct(body) {
  const name = sanitizeText(body.name);
  const image = sanitizeText(body.image);
  const price = Number(body.price);

  if (!name) {
    throw new Error('Le nom du produit est obligatoire.');
  }

  if (!image) {
    throw new Error('La photo du produit est obligatoire.');
  }

  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Le prix est invalide.');
  }

  return {
    name,
    price,
    image
  };
}

function validateExterieurProduct(body) {
  const name = sanitizeText(body.name);
  const image = sanitizeText(body.image);

  const priceL = Number(body.priceL);
  const priceXL = Number(body.priceXL);

  if (!name) {
    throw new Error('Le nom du produit est obligatoire.');
  }

  if (!image) {
    throw new Error('La photo du produit est obligatoire.');
  }

  if (!Number.isFinite(priceL) || priceL < 0) {
    throw new Error('Le prix L est invalide.');
  }

  if (!Number.isFinite(priceXL) || priceXL < 0) {
    throw new Error('Le prix XL est invalide.');
  }

  return {
    name,
    image,
    variants: [
      {
        size: 'L',
        price: priceL
      },
      {
        size: 'XL',
        price: priceXL
      }
    ]
  };
}

// ======================================================
// API PUBLIQUE
// ======================================================

app.get('/api/products', async (req, res) => {
  try {
    const { content } = await getProductsFile();

    res.setHeader('Cache-Control', 'no-store');

    res.json(content);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Impossible de charger les produits.'
    });
  }
});

// ======================================================
// ADMIN — LIRE PRODUITS
// ======================================================

app.get(
  '/api/admin/products',
  checkAdmin,
  async (req, res) => {
    try {
      const { content } = await getProductsFile();

      validateProductsStructure(content);

      res.json({
        ok: true,
        products: content
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: error.message
      });
    }
  }
);

// ======================================================
// ADMIN — AJOUT PRODUIT
// ======================================================

app.post(
  '/api/admin/products/:category',
  checkAdmin,
  async (req, res) => {
    try {
      const { category } = req.params;

      if (!['eleve', 'exterieur'].includes(category)) {
        return res.status(400).json({
          error: 'Catégorie invalide.'
        });
      }

      const { content, sha } =
        await getProductsFile();

      validateProductsStructure(content);

      let product;

      // ------------------------------
      // INSTITUT BOBOKOLI
      // ------------------------------

      if (category === 'eleve') {
        let image = sanitizeText(req.body.image);

        if (req.body.imageData) {
          image = await uploadImageToGithub({
            base64: req.body.imageData,
            mimeType: req.body.imageMimeType,
            productName: req.body.name
          });
        }

        product = validateEleveProduct({
          ...req.body,
          image
        });

        product = {
          id: createProductId(product.name),
          ...product
        };
      }

      // ------------------------------
      // LIVRAISON / EXTÉRIEUR
      // ------------------------------

      if (category === 'exterieur') {
        let image = sanitizeText(req.body.image);

        if (req.body.imageData) {
          image = await uploadImageToGithub({
            base64: req.body.imageData,
            mimeType: req.body.imageMimeType,
            productName: req.body.name
          });
        }

        product = validateExterieurProduct({
          ...req.body,
          image
        });

        product = {
          id: createProductId(product.name),
          ...product
        };
      }

      content[category].push(product);

      await saveProductsFile(
        content,
        sha,
        `Ajout produit ${category}: ${product.name}`
      );

      res.json({
        ok: true,
        products: content,
        message: 'Produit ajouté avec succès.'
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: error.message
      });
    }
  }
);

// ======================================================
// ADMIN — MODIFICATION
// ======================================================

app.put(
  '/api/admin/products/:category/:id',
  checkAdmin,
  async (req, res) => {
    try {
      const { category, id } = req.params;

      if (!['eleve', 'exterieur'].includes(category)) {
        return res.status(400).json({
          error: 'Catégorie invalide.'
        });
      }

      const { content, sha } =
        await getProductsFile();

      validateProductsStructure(content);

      const index =
        content[category].findIndex(
          product => product.id === id
        );

      if (index === -1) {
        return res.status(404).json({
          error: 'Produit introuvable.'
        });
      }

      const oldProduct = content[category][index];

      let image =
        sanitizeText(req.body.image) ||
        oldProduct.image;

      // Nouvelle photo choisie
      if (req.body.imageData) {
        image = await uploadImageToGithub({
          base64: req.body.imageData,
          mimeType: req.body.imageMimeType,
          productName: req.body.name
        });
      }

      let updatedProduct;

      if (category === 'eleve') {
        const validated =
          validateEleveProduct({
            ...req.body,
            image
          });

        updatedProduct = {
          id,
          ...validated
        };
      } else {
        const validated =
          validateExterieurProduct({
            ...req.body,
            image
          });

        updatedProduct = {
          id,
          ...validated
        };
      }

      content[category][index] =
        updatedProduct;

      await saveProductsFile(
        content,
        sha,
        `Modification produit ${category}: ${updatedProduct.name}`
      );

      res.json({
        ok: true,
        products: content,
        message: 'Produit modifié avec succès.'
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: error.message
      });
    }
  }
);

// ======================================================
// ADMIN — SUPPRESSION
// ======================================================

app.delete(
  '/api/admin/products/:category/:id',
  checkAdmin,
  async (req, res) => {
    try {
      const { category, id } = req.params;

      if (!['eleve', 'exterieur'].includes(category)) {
        return res.status(400).json({
          error: 'Catégorie invalide.'
        });
      }

      const { content, sha } =
        await getProductsFile();

      validateProductsStructure(content);

      const existingProduct =
        content[category].find(
          product => product.id === id
        );

      if (!existingProduct) {
        return res.status(404).json({
          error: 'Produit introuvable.'
        });
      }

      content[category] =
        content[category].filter(
          product => product.id !== id
        );

      await saveProductsFile(
        content,
        sha,
        `Suppression produit ${category}: ${existingProduct.name}`
      );

      res.json({
        ok: true,
        products: content,
        message: 'Produit supprimé avec succès.'
      });
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error: error.message
      });
    }
  }
);

// ======================================================
// ROUTE ADMIN
// ======================================================

app.get('/admin', (req, res) => {
  res.sendFile(
    path.join(__dirname, '..', 'admin.html')
  );
});

// ======================================================
// SERVEUR
// ======================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Malé Tacos server prêt sur le port ${PORT}`
  );
});
