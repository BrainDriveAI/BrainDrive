# 🧠 BrainDrive: Full Installation Guide

> **Compatible with Windows, macOS, and Linux**

---

## ✅ Requirements Overview

Before continuing, ensure the following are installed:

| Tool        | Download Link                                                                                                             | Check with             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Conda**   | [Miniconda](https://docs.conda.io/en/latest/miniconda.html) or [Anaconda](https://www.anaconda.com/products/distribution) | `conda --version`      |
| **Git**     | [Git](https://git-scm.com/downloads)                                                                                      | `git --version`        |
| **Node.js** | [Node.js](https://nodejs.org/en/download/)                                                                                | `node -v` and `npm -v` |

> ⚠️ **Development Mode Note:**
> While running BrainDrive in development, you’ll need **two terminal windows**:
>
> * One for the **backend server**
> * One for the **frontend server**

---

## 🧰 Step 1: Create Conda Development Environment

You can either install the tools system-wide or use Conda to isolate them. Using Conda is recommended for consistency.

```bash
conda create -n BrainDriveDev -c conda-forge python=3.11 nodejs git -y
conda activate BrainDriveDev
```

> You will need to activate this environment in **both terminal windows** when working on the project.

---

## 📦 Step 2: Clone the Repository

In either terminal:

```bash
git clone https://github.com/BrainDriveAI/BrainDrive.git
cd BrainDrive
```

---

## 🧩 Step 3: Build Required Plugins

Before using BrainDrive, plugins must be built. You can do this automatically or manually.

### 🔹 Option 1: ✅ Automatic (Recommended)

#### 🪟 Windows

```bat
conda activate BrainDriveDev  # if not already activated
build_plugins.bat
```

#### 🍎 macOS / 🐧 Linux

```bash
conda activate BrainDriveDev  # if not already activated
chmod +x build_plugins.sh
./build_plugins.sh
```

> 💡 These scripts detect all plugin folders in `plugins/` that contain a `package.json`, install dependencies, and run `npm run build`.

---

### 🔸 Option 2: 🛠 Manual Plugin Build

```bash
conda activate BrainDriveDev  # if not already activated
cd plugins/BrainDriveBasicAIChat
npm install
npm run build

cd ../BrainDriveSettings
npm install
npm run build
```

Repeat for any additional plugins.

---

## 🧪 Step 4: Set Up the Backend

```bash
cd backend
conda activate BrainDriveDev  # if not already activated
pip install -r requirements.txt
```

---

### ⚙️ Backend Configuration

Create a `.env` file in the `backend/` folder.

#### Option A: Copy template

```bash
cp .env-dev .env       # macOS/Linux
copy .env-dev .env     # Windows
```

#### Option B: Manual `.env` Setup

Paste the following into `backend/.env`:

```env
# Application Settings
APP_NAME="BrainDrive"
APP_ENV="dev"
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

# Database
DATABASE_URL="sqlite:///braindrive.db"
DATABASE_TYPE="sqlite"
USE_JSON_STORAGE=false
JSON_DB_PATH="./storage/database.json"
SQL_LOG_LEVEL="WARNING"

# Redis
USE_REDIS=false
REDIS_HOST="localhost"
REDIS_PORT=6379

# CORS
CORS_ORIGINS='["http://127.0.0.1:5173", "http://localhost:5173"]'
CORS_METHODS='["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"]'
CORS_HEADERS='["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"]'
CORS_EXPOSE_HEADERS='["*"]'
CORS_MAX_AGE=3600
CORS_ALLOW_CREDENTIALS=true

# Allowed Hosts
ALLOWED_HOSTS='["localhost", "127.0.0.1"]'

# AI Providers
ENABLE_TEST_ROUTES=true
```

---

## 🚀 Step 5: Run the Backend Server

In the **first terminal window**:

```bash
cd BrainDrive/backend
uvicorn main:app --reload --host localhost --port 8005
```

---

## 💻 Step 6: Set Up and Run the Frontend

In the **second terminal window**:

```bash
cd BrainDrive/frontend
npm install
```

### ⚙️ Frontend Configuration

Create a `.env` file in the `frontend/` folder.

#### Option A: Copy example file

```bash
cp .env.example .env       # macOS/Linux
copy .env.example .env     # Windows
```

#### Option B: Manual `.env`

```env
# API Configuration
VITE_API_URL=http://localhost:8005
VITE_API_TIMEOUT=10000

# Environment
NODE_ENV=development

# Development Auto Login
VITE_DEV_AUTO_LOGIN=false
VITE_DEV_EMAIL=your-email@example.com
VITE_DEV_PASSWORD=your-password
```

> ⚠️ **Security Note:** Remove auto-login credentials before production deployment.

Now start the frontend:

```bash
npm run dev
```

✅ Once both servers are running, you can access BrainDrive at:
[http://localhost:5173](http://localhost:5173)

---

## ✅ Final Verification Checklist

| Item       | URL / Result                                                             |
| ---------- | ------------------------------------------------------------------------ |
| ✅ Backend  | Open [http://localhost:8005](http://localhost:8005) to view FastAPI docs |
| ✅ Frontend | Open [http://localhost:5173](http://localhost:5173) to launch the UI     |
| ✅ Plugins  | Plugin builds completed successfully                                     |

---

## 🔁 Restarting BrainDrive Later

After shutting down or rebooting, restart BrainDrive with the following steps:

### 1️⃣ Open Two Terminal Windows

* One for the **backend**
* One for the **frontend**

### 2️⃣ Activate Conda in Both

```bash
conda activate BrainDriveDev
```

### 3️⃣ Start the Backend Server

```bash
cd BrainDrive/backend
uvicorn main:app --reload --host localhost --port 8005
```

### 4️⃣ Start the Frontend Server

```bash
cd BrainDrive/frontend
npm run dev
```

Then visit: [http://localhost:5173](http://localhost:5173)


