
# 🧠 BrainDrive: Full Installation Guide

> **Works on Windows, macOS, and Linux**

---

## ✅ Requirements Overview

Before installing BrainDrive, ensure the following are installed:

| Tool        | Download Link                                                                                                             | Verify Installed With  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Conda**   | [Miniconda](https://docs.conda.io/en/latest/miniconda.html) or [Anaconda](https://www.anaconda.com/products/distribution) | `conda --version`      |
| **Git**     | [Git](https://git-scm.com/downloads)                                                                                      | `git --version`        |
| **Node.js** | [Node.js](https://nodejs.org/en/download/)                                                                                | `node -v` and `npm -v` |

> ⚠️ **Development Note:**
> While running BrainDrive in development mode, you'll need to have **two terminal windows or tabs open**:
>
> * One to run the **backend server**
> * One to run the **frontend development server**
>
> These must run **simultaneously**, but in separate terminals.

All installs at this point in development and not production

---

## 📦 Step 1: Clone the Repository

```bash
git clone https://github.com/BrainDriveAI/BrainDrive.git
cd BrainDrive
```

---

## 🧰 Step 2: Set Up the Backend

### Option A: Using Conda (Recommended)

```bash
cd backend
conda create -n BrainDriveDev python=3.11 -y
conda activate BrainDriveDev
pip install -r requirements.txt
```

### Option B: Using Python venv

```bash
cd backend
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt
```

---

## ⚙️ Step 3: Backend Configuration

Create a `.env` file in the `backend/` directory.

Option 1: Copy from provided template:

```bash
cp .env-dev .env

or 

copy .env-dev .env
```

Option 2: Manually create `.env` with the following:

```env
# Application Settings
APP_NAME="BrainDrive"
APP_ENV="dev"  # Change to "prod" in production
API_V1_PREFIX="/api/v1"
DEBUG=true

# Server Settings
HOST="0.0.0.0"
PORT=8005
RELOAD=true
LOG_LEVEL="info"

# Security
SECRET_KEY="your-secret-key-here"
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30
ALGORITHM="HS256"

# Database Settings
DATABASE_URL="sqlite:///braindrive.db"
DATABASE_TYPE="sqlite"
USE_JSON_STORAGE=false
JSON_DB_PATH="./storage/database.json"
SQL_LOG_LEVEL="WARNING"  # Set to "DEBUG" for detailed SQL logging

# Redis Settings
USE_REDIS=false
REDIS_HOST="localhost"
REDIS_PORT=6379

# CORS Settings
CORS_ORIGINS='["http://127.0.0.1:5173", "http://localhost:5173"]'
CORS_METHODS='["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"]'
CORS_HEADERS='["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"]'
CORS_EXPOSE_HEADERS='["*"]'
CORS_MAX_AGE=3600
CORS_ALLOW_CREDENTIALS=true

# Allowed Hosts
ALLOWED_HOSTS='["localhost", "127.0.0.1"]'

# AI Provider Settings
ENABLE_TEST_ROUTES=true  # Enable test routes in development
```

---

## ▶️ Step 4: Run the Backend Server

```bash
uvicorn main:app --reload --host localhost --port 8005
```

---

## 🧩 Step 5: Build Required Plugins

Before using BrainDrive, plugins must be built. You can either build them **manually** or use our **automated script**.

### 📌 Requirements

* [Node.js (v16+)](https://nodejs.org/en/download)
* npm (comes with Node) or yarn

---

### 🔹 Option 1: ✅ Automatic (Recommended)

We provide cross-platform scripts to build all plugins with one command:

#### 🪟 Windows

From the project root (`BrainDrive/`), run:

```bat
build_plugins.bat
```

#### 🍎 macOS / 🐧 Linux

Make the script executable:

```bash
chmod +x build_plugins.sh
```

Then run:

```bash
./build_plugins.sh
```

> 💡 These scripts will automatically detect all plugin folders in `plugins/` that contain a `package.json`, install their dependencies, and run `npm run build`.

---

### 🔸 Option 2: 🛠 Manual Build

Build each plugin manually by navigating into its folder:

```bash
cd plugins/BrainDriveBasicAIChat
npm install
npm run build

cd ../BrainDriveSettings
npm install
npm run build
```

You can repeat this process for any additional plugins.



---

## 💻 Step 6: Set Up the Frontend

```bash
cd ../../frontend
npm install
```

---

## ⚙️ Step 7: Frontend Configuration

Create a `.env` file in the `frontend/` directory.

Option 1: Copy from example:

```bash
cp .env.example .env

or

copy .env.example .env
```

Option 2: Manually create `.env`:

```env
# API Configuration
VITE_API_URL=http://localhost:8005
VITE_API_TIMEOUT=10000

# Environment
NODE_ENV=development

# Development Only - Temporary Auto Login (Remove in production)
VITE_DEV_AUTO_LOGIN=false
VITE_DEV_EMAIL=your-email@example.com
VITE_DEV_PASSWORD=your-password
```

> ⚠️ **Important:** Remove auto-login values before deploying to production.

---

## 🚀 Step 8: Run the Frontend

```bash
npm run dev
```

Or:

```bash
yarn dev
```

---

## ✅ Verification Checklist

After completing the steps:

* [ ] `Backend`: [http://localhost:8005](http://localhost:8005) should load FastAPI Swagger docs.
* [ ] Plugins are built and available for use.
* [ ] `Frontend`: [http://localhost:5173](http://localhost:5173) should launch the PluginStudio UI.



