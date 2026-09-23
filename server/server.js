require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();

/*
|--------------------------------------------------------------------------
| CONFIGURATION
|--------------------------------------------------------------------------
*/

const PORT = process.env.PORT || 3000;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO =
  process.env.GITHUB_REPO || 'optisitedigital/male-tacos';

const GITHUB_BRANCH =
  process.env.GITHUB_BRANCH || 'main';

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD;

const PRODUCTS_PATH =
  'products.json';

const ADMIN_COOKIE =
  'male_tacos_admin';

const SESSION_DURATION =
  12 * 60 * 60 * 1000;

/*
|--------------------------------------------------------------------------
| EXPRESS
|--------------------------------------------------------------------------
*/

app.use(
  express.json({
    limit: '12mb'
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '12mb'
  })
);

/*
|--------------------------------------------------------------------------
| SERVIR LE SITE
|--------------------------------------------------------------------------
*/

app.use(
  express.static(
    path.join(__dirname, '..')
  )
);

/*
|--------------------------------------------------------------------------
| GITHUB HEADERS
|--------------------------------------------------------------------------
*/

function githubHeaders() {
  return {
    Authorization:
      `Bearer ${GITHUB_TOKEN}`,

    Accept:
      'application/vnd.github+json',

    'X-GitHub-Api-Version':
      '2022-11-28',

    'User-Agent':
      'male-tacos-admin'
  };
}

/*
|--------------------------------------------------------------------------
| AUTHENTIFICATION
|--------------------------------------------------------------------------
*/

function createAdminToken() {

  const timestamp =
    Date.now().toString();

  const signature =
    crypto
      .createHmac(
        'sha256',
        ADMIN_PASSWORD || ''
      )
      .update(timestamp)
      .digest('hex');

  return Buffer
    .from(
      `${timestamp}.${signature}`
    )
    .toString('base64url');
}


function verifyAdminToken(token) {

  if (
    !ADMIN_PASSWORD ||
    !token
  ) {
    return false;
  }

  try {

    const decoded =
      Buffer
        .from(
          token,
          'base64url'
        )
        .toString('utf8');

    const parts =
      decoded.split('.');

    if (parts.length !== 2) {
      return false;
    }

    const [
      timestamp,
      signature
    ] = parts;

    const time =
      Number(timestamp);

    if (
      !Number.isFinite(time)
    ) {
      return false;
    }

    if (
      Date.now() - time >
      SESSION_DURATION
    ) {
      return false;
    }

    const expectedSignature =
      crypto
        .createHmac(
          'sha256',
          ADMIN_PASSWORD
        )
        .update(timestamp)
        .digest('hex');

    if (
      signature.length !==
      expectedSignature.length
    ) {
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


function getCookie(
  req,
  name
) {

  const header =
    req.headers.cookie;

  if (!header) {
    return null;
  }

  const cookies =
    header.split(';');

  for (
    const cookie of cookies
  ) {

    const index =
      cookie.indexOf('=');

    if (index === -1) {
      continue;
    }

    const key =
      cookie
        .slice(0, index)
        .trim();

    const value =
      cookie
        .slice(index + 1)
        .trim();

    if (key === name) {

      return decodeURIComponent(
        value
      );

    }
  }

  return null;
}


function checkAdmin(
  req,
  res,
  next
) {

  if (!ADMIN_PASSWORD) {

    return res.status(500).json({
      ok: false,
      error:
        'ADMIN_PASSWORD non configuré sur Render.'
    });

  }

  const token =
    getCookie(
      req,
      ADMIN_COOKIE
    );

  if (
    !verifyAdminToken(token)
  ) {

    return res.status(401).json({
      ok: false,
      error:
        'Session administrateur expirée ou invalide.'
    });

  }

  next();
}

/*
|--------------------------------------------------------------------------
| LOGIN
|--------------------------------------------------------------------------
*/

app.post(
  '/api/admin/login',
  (req, res) => {

    const {
      password
    } = req.body || {};

    if (!ADMIN_PASSWORD) {

      return res.status(500).json({
        ok: false,
        error:
          'ADMIN_PASSWORD non configuré sur Render.'
      });

    }

    if (
      typeof password !== 'string' ||
      password.length === 0 ||
      password !== ADMIN_PASSWORD
    ) {

      return res.status(401).json({
        ok: false,
        error:
          'Mot de passe incorrect.'
      });

    }

    const token =
      createAdminToken();

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

  }
);

/*
|--------------------------------------------------------------------------
| LOGOUT
|--------------------------------------------------------------------------
*/

app.post(
  '/api/admin/logout',
  (req, res) => {

    res.setHeader(
      'Set-Cookie',
      `${ADMIN_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
    );

    res.json({
      ok: true
    });

  }
);

/*
|--------------------------------------------------------------------------
| SESSION
|--------------------------------------------------------------------------
*/

app.get(
  '/api/admin/session',
  checkAdmin,
  (req, res) => {

    res.json({
      ok: true
    });

  }
);

/*
|--------------------------------------------------------------------------
| GITHUB : LIRE PRODUCTS.JSON
|--------------------------------------------------------------------------
*/

async function getProductsFile() {

  if (
    !GITHUB_TOKEN ||
    !GITHUB_REPO
  ) {

    throw new Error(
      'GITHUB_TOKEN ou GITHUB_REPO non configuré.'
    );

  }

  const url =
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${PRODUCTS_PATH}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;

  const response =
    await fetch(
      url,
      {
        method: 'GET',
        headers:
          githubHeaders()
      }
    );

  const data =
    await response.json();

  if (!response.ok) {

    throw new Error(
      data.message ||
      `Impossible de lire products.json (${response.status}).`
    );

  }

  if (
    !data.content
  ) {

    throw new Error(
      'GitHub n’a pas retourné le contenu de products.json.'
    );

  }

  let content;

  try {

    content =
      JSON.parse(
        Buffer
          .from(
            data.content.replace(/\n/g, ''),
            'base64'
          )
          .toString('utf8')
      );

  } catch {

    throw new Error(
      'products.json contient un JSON invalide.'
    );

  }

  return {
    content,
    sha: data.sha
  };
}

/*
|--------------------------------------------------------------------------
| GITHUB : SAUVEGARDER PRODUCTS.JSON
|--------------------------------------------------------------------------
*/

async function saveProductsFile(
  newContent,
  sha,
  message
) {

  const url =
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${PRODUCTS_PATH}`;

  const body = {

    message:
      message ||
      'Mise à jour Malé Tacos',

    content:
      Buffer
        .from(
          JSON.stringify(
            newContent,
            null,
            2
          ),
          'utf8'
        )
        .toString('base64'),

    sha,

    branch:
      GITHUB_BRANCH

  };

  const response =
    await fetch(
      url,
      {
        method: 'PUT',

        headers: {
          ...githubHeaders(),
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify(body)
      }
    );

  const data =
    await response.json();

  if (!response.ok) {

    throw new Error(
      data.message ||
      `Erreur GitHub (${response.status}).`
    );

  }

  return data;
}

/*
|--------------------------------------------------------------------------
| VALIDATION PRODUCTS.JSON
|--------------------------------------------------------------------------
*/

function validateProductsStructure(
  content
) {

  if (
    !content ||
    typeof content !== 'object' ||
    Array.isArray(content)
  ) {

    throw new Error(
      'Structure de products.json invalide.'
    );

  }

  if (
    !Array.isArray(content.eleve)
  ) {

    throw new Error(
      'La section "eleve" doit être un tableau.'
    );

  }

  if (
    !Array.isArray(content.exterieur)
  ) {

    throw new Error(
      'La section "exterieur" doit être un tableau.'
    );

  }

  if (
    !Array.isArray(content.sauces)
  ) {

    throw new Error(
      'La section "sauces" doit être conservée.'
    );

  }

  if (
    !Array.isArray(content.supplements)
  ) {

    throw new Error(
      'La section "supplements" doit être conservée.'
    );

  }

  if (
    typeof content.deliveryFee !== 'number' ||
    !Number.isFinite(
      content.deliveryFee
    )
  ) {

    throw new Error(
      'deliveryFee invalide.'
    );

  }

}

/*
|--------------------------------------------------------------------------
| OUTILS
|--------------------------------------------------------------------------
*/

function sanitizeText(
  value,
  fallback = ''
) {

  if (
    typeof value !== 'string'
  ) {

    return fallback;

  }

  return value.trim();
}


function createProductId(
  name
) {

  const base =
    sanitizeText(
      name,
      'produit'
    )
      .toLowerCase()
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        ''
      )
      .replace(
        /[^a-z0-9]+/g,
        '-'
      )
      .replace(
        /^-+|-+$/g,
        ''
      )
      .slice(
        0,
        40
      );

  return `${
    base || 'produit'
  }-${Date.now()}`;

}


function validateImageData(
  imageData
) {

  if (
    !imageData
  ) {

    return null;

  }

  if (
    typeof imageData !== 'string'
  ) {

    throw new Error(
      'Image invalide.'
    );

  }

  const match =
    imageData.match(
      /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/
    );

  if (!match) {

    throw new Error(
      'Format image non supporté.'
    );

  }

  const mime =
    match[1]
      .toLowerCase();

  const base64 =
    match[2];

  const buffer =
    Buffer.from(
      base64,
      'base64'
    );

  /*
   * Limite de sécurité :
   * 2 MB maximum après compression.
   */

  if (
    buffer.length >
    2 * 1024 * 1024
  ) {

    throw new Error(
      'Image trop lourde. Maximum 2 Mo.'
    );

  }

  let extension =
    mime;

  if (
    extension === 'jpeg' ||
    extension === 'jpg'
  ) {

    extension = 'jpg';

  }

  return {
    buffer,
    extension
  };

}


function createImageFileName(
  name
) {

  const clean =
    sanitizeText(
      name,
      'produit'
    )
      .toLowerCase()
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        ''
      )
      .replace(
        /[^a-z0-9]+/g,
        '-'
      )
      .replace(
        /^-+|-+$/g,
        ''
      )
      .slice(
        0,
        40
      );

  return `${clean || 'produit'}-${Date.now()}.jpg`;

}

/*
|--------------------------------------------------------------------------
| GITHUB : UPLOAD IMAGE
|--------------------------------------------------------------------------
*/

async function uploadImageToGitHub(
  imageData,
  productName
) {

  const parsed =
    validateImageData(
      imageData
    );

  if (!parsed) {
    return null;
  }

  /*
   * Toutes les nouvelles images
   * seront stockées à la racine
   * du repository.
   */

  const fileName =
    createImageFileName(
      productName
    );

  const imagePath =
    fileName;

  const url =
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURIComponent(imagePath)}`;

  const body = {

    message:
      `Ajout image produit: ${productName}`,

    content:
      parsed.buffer.toString(
        'base64'
      ),

    branch:
      GITHUB_BRANCH

  };

  const response =
    await fetch(
      url,
      {
        method: 'PUT',

        headers: {
          ...githubHeaders(),
          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify(body)
      }
    );

  const data =
    await response.json();

  if (!response.ok) {

    throw new Error(
      data.message ||
      `Impossible d'envoyer l'image (${response.status}).`
    );

  }

  /*
   * products.json doit contenir
   * le nom relatif de l'image.
   *
   * Exemple :
   * tacos-poulet-123456.jpg
   */

  return fileName;

}

/*
|--------------------------------------------------------------------------
| API PUBLIQUE
|--------------------------------------------------------------------------
*/

app.get(
  '/api/products',
  async (req, res) => {

    try {

      const {
        content
      } =
        await getProductsFile();

      res.setHeader(
        'Cache-Control',
        'no-store'
      );

      res.json(
        content
      );

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({
        error:
          'Impossible de charger les produits.'
      });

    }

  }
);

/*
|--------------------------------------------------------------------------
| ADMIN : LECTURE
|--------------------------------------------------------------------------
*/

app.get(
  '/api/admin/products',
  checkAdmin,
  async (req, res) => {

    try {

      const {
        content
      } =
        await getProductsFile();

      res.json({
        ok: true,
        products:
          content
      });

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({
        ok: false,
        error:
          error.message
      });

    }

  }
);

/*
|--------------------------------------------------------------------------
| ADMIN : AJOUTER
|--------------------------------------------------------------------------
*/

app.post(
  '/api/admin/products/:category',
  checkAdmin,
  async (req, res) => {

    try {

      const {
        category
      } = req.params;

      if (
        ![
          'eleve',
          'exterieur'
        ].includes(category)
      ) {

        return res.status(400).json({
          ok: false,
          error:
            'Catégorie invalide.'
        });

      }

      const {
        content,
        sha
      } =
        await getProductsFile();

      validateProductsStructure(
        content
      );

      const body =
        req.body || {};

      const name =
        sanitizeText(
          body.name
        );

      if (!name) {

        return res.status(400).json({
          ok: false,
          error:
            'Le nom du produit est obligatoire.'
        });

      }

      /*
       * IMAGE
       *
       * Si une nouvelle image
       * est envoyée, elle est
       * d'abord sauvegardée
       * sur GitHub.
       */

      let image =
        sanitizeText(
          body.image
        );

      if (
        body.imageData
      ) {

        image =
          await uploadImageToGitHub(
            body.imageData,
            name
          );

      }

      if (!image) {

        return res.status(400).json({
          ok: false,
          error:
            'La photo du produit est obligatoire.'
        });

      }

      let product;

      /*
       * INSTITUT
       */

      if (
        category === 'eleve'
      ) {

        const price =
          Number(
            body.price
          );

        if (
          !Number.isFinite(price) ||
          price < 0
        ) {

          return res.status(400).json({
            ok: false,
            error:
              'Le prix est invalide.'
          });

        }

        product = {

          id:
            createProductId(
              name
            ),

          name,

          price,

          image

        };

      }

      /*
       * EXTÉRIEUR
       */

      if (
        category === 'exterieur'
      ) {

        const priceL =
          Number(
            body.priceL
          );

        const priceXL =
          Number(
            body.priceXL
          );

        if (
          !Number.isFinite(
            priceL
          ) ||
          priceL < 0
        ) {

          return res.status(400).json({
            ok: false,
            error:
              'Le prix L est invalide.'
          });

        }

        if (
          !Number.isFinite(
            priceXL
          ) ||
          priceXL < 0
        ) {

          return res.status(400).json({
            ok: false,
            error:
              'Le prix XL est invalide.'
          });

        }

        product = {

          id:
            createProductId(
              name
            ),

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

      content[
        category
      ].push(
        product
      );

      await saveProductsFile(
        content,
        sha,
        `Ajout produit ${category}: ${product.name}`
      );

      res.json({

        ok: true,

        products:
          content,

        message:
          'Produit ajouté avec succès.'

      });

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message

      });

    }

  }
);

/*
|--------------------------------------------------------------------------
| ADMIN : MODIFIER
|--------------------------------------------------------------------------
*/

app.put(
  '/api/admin/products/:category/:id',
  checkAdmin,
  async (req, res) => {

    try {

      const {
        category,
        id
      } = req.params;

      if (
        ![
          'eleve',
          'exterieur'
        ].includes(category)
      ) {

        return res.status(400).json({
          ok: false,
          error:
            'Catégorie invalide.'
        });

      }

      const {
        content,
        sha
      } =
        await getProductsFile();

      validateProductsStructure(
        content
      );

      const index =
        content[
          category
        ].findIndex(
          product =>
            product.id === id
        );

      if (
        index === -1
      ) {

        return res.status(404).json({
          ok: false,
          error:
            'Produit introuvable.'
        });

      }

      const oldProduct =
        content[
          category
        ][index];

      const body =
        req.body || {};

      const name =
        sanitizeText(
          body.name
        );

      if (!name) {

        return res.status(400).json({
          ok: false,
          error:
            'Le nom du produit est obligatoire.'
        });

      }

      /*
       * IMAGE
       *
       * Sans nouvelle image :
       * on conserve l'ancienne.
       *
       * Avec nouvelle image :
       * on upload la nouvelle.
       */

      let image =
        oldProduct.image;

      if (
        body.imageData
      ) {

        image =
          await uploadImageToGitHub(
            body.imageData,
            name
          );

      }

      if (
        body.image
      ) {

        image =
          sanitizeText(
            body.image
          );

      }

      if (!image) {

        return res.status(400).json({
          ok: false,
          error:
            'La photo du produit est obligatoire.'
        });

      }

      let updatedProduct;

      /*
       * INSTITUT
       */

      if (
        category === 'eleve'
      ) {

        const price =
          Number(
            body.price
          );

        if (
          !Number.isFinite(
            price
          ) ||
          price < 0
        ) {

          return res.status(400).json({
            ok: false,
            error:
              'Le prix est invalide.'
          });

        }

        updatedProduct = {

          id,

          name,

          price,

          image

        };

      }

      /*
       * EXTÉRIEUR
       */

      else {

        const priceL =
          Number(
            body.priceL
          );

        const priceXL =
          Number(
            body.priceXL
          );

        if (
          !Number.isFinite(
            priceL
          ) ||
          priceL < 0
        ) {

          return res.status(400).json({
            ok: false,
            error:
              'Le prix L est invalide.'
          });

        }

        if (
          !Number.isFinite(
            priceXL
          ) ||
          priceXL < 0
        ) {

          return res.status(400).json({
            ok: false,
            error:
              'Le prix XL est invalide.'
          });

        }

        updatedProduct = {

          id,

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

      content[
        category
      ][index] =
        updatedProduct;

      await saveProductsFile(
        content,
        sha,
        `Modification produit ${category}: ${updatedProduct.name}`
      );

      res.json({

        ok: true,

        products:
          content,

        message:
          'Produit modifié avec succès.'

      });

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message

      });

    }

  }
);

/*
|--------------------------------------------------------------------------
| ADMIN : SUPPRIMER
|--------------------------------------------------------------------------
*/

app.delete(
  '/api/admin/products/:category/:id',
  checkAdmin,
  async (req, res) => {

    try {

      const {
        category,
        id
      } = req.params;

      if (
        ![
          'eleve',
          'exterieur'
        ].includes(category)
      ) {

        return res.status(400).json({
          ok: false,
          error:
            'Catégorie invalide.'
        });

      }

      const {
        content,
        sha
      } =
        await getProductsFile();

      validateProductsStructure(
        content
      );

      const product =
        content[
          category
        ].find(
          p => p.id === id
        );

      if (!product) {

        return res.status(404).json({
          ok: false,
          error:
            'Produit introuvable.'
        });

      }

      content[
        category
      ] =
        content[
          category
        ].filter(
          p => p.id !== id
        );

      await saveProductsFile(
        content,
        sha,
        `Suppression produit ${category}: ${product.name}`
      );

      res.json({

        ok: true,

        products:
          content,

        message:
          'Produit supprimé avec succès.'

      });

    } catch (error) {

      console.error(
        error
      );

      res.status(500).json({

        ok: false,

        error:
          error.message

      });

    }

  }
);

/*
|--------------------------------------------------------------------------
| ADMIN.HTML
|--------------------------------------------------------------------------
*/

app.get(
  '/admin',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        '..',
        'admin.html'
      )
    );

  }
);

/*
|--------------------------------------------------------------------------
| TEST SERVEUR
|--------------------------------------------------------------------------
*/

app.get(
  '/',
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        '..',
        'index.html'
      )
    );

  }
);

/*
|--------------------------------------------------------------------------
| 404 API
|--------------------------------------------------------------------------
*/

app.use(
  '/api',
  (req, res) => {

    res.status(404).json({
      ok: false,
      error:
        'Route API introuvable.'
    });

  }
);

/*
|--------------------------------------------------------------------------
| DÉMARRAGE
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  () => {

    console.log(
      `Malé Tacos server prêt sur le port ${PORT}`
    );

    console.log(
      `Repository GitHub: ${GITHUB_REPO}`
    );

    console.log(
      `Branche: ${GITHUB_BRANCH}`
    );

    console.log(
      `Products: ${PRODUCTS_PATH}`
    );

  }
);
