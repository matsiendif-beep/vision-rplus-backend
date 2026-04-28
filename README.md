# Vision R+ — Backend API

> API SaaS comptable multi-systèmes (OHADA + PCG France)  
> Stack : **NestJS · Prisma · PostgreSQL · JWT**

---

## 🗂️ Structure du projet

```
src/
├── main.ts                          # Point d'entrée
├── app.module.ts                    # Module racine
│
├── prisma/
│   ├── prisma.service.ts            # Client Prisma (singleton global)
│   └── prisma.module.ts             # Module global
│
├── auth/
│   ├── dto/auth.dto.ts              # RegisterDto, LoginDto
│   ├── jwt.strategy.ts              # Stratégie Passport JWT
│   ├── auth.service.ts              # Inscription, connexion, profil
│   ├── auth.controller.ts           # POST /auth/register | /login | GET /me
│   └── auth.module.ts
│
├── companies/
│   ├── dto/company.dto.ts           # CreateCompanyDto, UpdateCompanyDto
│   ├── companies.service.ts         # CRUD + limites par plan
│   ├── companies.controller.ts      # REST /companies
│   └── companies.module.ts
│
├── accounts/
│   ├── dto/account.dto.ts           # CreateAccountDto, FilterAccountsDto
│   ├── accounts.service.ts          # Plan comptable OHADA/PCG + CRUD
│   ├── accounts.controller.ts       # REST /companies/:id/accounts
│   └── accounts.module.ts
│
├── journal/
│   ├── dto/journal.dto.ts           # CreateEntryDto, FilterEntriesDto
│   ├── accounting.engine.ts         # 🧠 Moteur comptable (soldes, CR, bilan)
│   ├── journal.service.ts           # CRUD écritures + états financiers
│   ├── journal.controller.ts        # REST /companies/:id/entries + financials
│   └── journal.module.ts
│
└── common/
    ├── decorators/index.ts          # @GetUser, @RequireRoles
    ├── guards/
    │   ├── jwt-auth.guard.ts        # Protection JWT
    │   └── company-access.guard.ts  # Isolation multi-tenant
    └── filters/
        └── http-exception.filter.ts # Format unifié des erreurs

prisma/
├── schema.prisma                    # Modèle de données complet
└── seed.ts                          # Plans comptables OHADA + PCG France
```

---

## 🚀 Installation et démarrage

### 1. Prérequis
- Node.js ≥ 18
- PostgreSQL ≥ 14
- npm ≥ 9

### 2. Cloner et installer
```bash
npm install
```

### 3. Configuration
```bash
cp .env.example .env
# Remplir DATABASE_URL, JWT_SECRET, etc.
```

### 4. Base de données
```bash
# Créer la base
createdb vision_rplus_dev

# Générer le client Prisma
npm run prisma:generate

# Appliquer les migrations
npm run prisma:migrate

# Charger les plans comptables (OHADA + PCG France)
npm run prisma:seed
```

### 5. Démarrer
```bash
npm run start:dev
```

Swagger disponible sur : **http://localhost:3000/docs**

---

## 📡 Routes API

### Auth
| Méthode | Route           | Description                |
|---------|-----------------|----------------------------|
| POST    | /auth/register  | Créer un compte            |
| POST    | /auth/login     | Connexion + tokens JWT     |
| GET     | /auth/me        | Profil utilisateur 🔒      |

### Entreprises
| Méthode | Route                               | Description                         |
|---------|-------------------------------------|-------------------------------------|
| POST    | /companies                          | Créer une entreprise 🔒             |
| GET     | /companies                          | Mes entreprises 🔒                  |
| GET     | /companies/:id                      | Détail entreprise 🔒                |
| GET     | /companies/:id/stats                | Statistiques rapides 🔒             |
| GET     | /companies/:id/fiscal-years         | Exercices fiscaux 🔒                |
| PATCH   | /companies/:id                      | Modifier 🔒                         |
| DELETE  | /companies/:id                      | Désactiver 🔒                       |

### Comptes (Plan comptable)
| Méthode | Route                                        | Description               |
|---------|----------------------------------------------|---------------------------|
| GET     | /companies/:id/accounts                      | Plan comptable 🔒         |
| GET     | /companies/:id/accounts/search?q=            | Autocomplete 🔒           |
| GET     | /companies/:id/accounts/:accountId           | Détail compte 🔒          |
| POST    | /companies/:id/accounts                      | Créer compte perso 🔒     |
| PATCH   | /companies/:id/accounts/:accountId           | Modifier 🔒               |
| DELETE  | /companies/:id/accounts/:accountId           | Désactiver 🔒             |

### Journal & États financiers
| Méthode | Route                                                    | Description                     |
|---------|----------------------------------------------------------|---------------------------------|
| POST    | /companies/:id/entries                                   | Saisir écriture 🔒              |
| GET     | /companies/:id/entries                                   | Journal (paginé, filtré) 🔒     |
| GET     | /companies/:id/entries/:entryId                          | Détail écriture 🔒              |
| PATCH   | /companies/:id/entries/:entryId                          | Modifier brouillon 🔒           |
| POST    | /companies/:id/entries/:entryId/validate                 | Valider écriture 🔒             |
| POST    | /companies/:id/entries/:entryId/reverse                  | Contrepasser écriture 🔒        |
| GET     | /companies/:id/fiscal-years/:fyId/income-statement       | Compte de résultat 🔒           |
| GET     | /companies/:id/fiscal-years/:fyId/balance-sheet          | Bilan 🔒                        |
| GET     | /companies/:id/fiscal-years/:fyId/dashboard              | Dashboard financier 🔒          |

---

## 🧠 Logique comptable — AccountingEngine

Le cœur du système. Calcule automatiquement :

```
Solde actif/charge/trésorerie  = total_debit  - total_credit
Solde passif/produit           = total_credit - total_debit
Résultat net                   = total_produits - total_charges
Bilan équilibré                = total_actif == total_passif (± 0.01€)
```

---

## 🔐 Sécurité

- **JWT** : access token (7j) + refresh token (30j)
- **Isolation multi-tenant** : `CompanyAccessGuard` vérifie chaque requête
- **Écritures immuables** : une écriture validée ne peut plus être modifiée
- **Soft delete** : aucune donnée comptable n'est jamais supprimée physiquement
- **Argon2** : hachage des mots de passe (plus sécurisé que bcrypt)
