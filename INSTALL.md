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

## 🧪 Step 3: Set Up the Backend

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

Look at [/backend/.env-dev](https://github.com/BrainDriveAI/BrainDrive/blob/main/backend/.env-dev) and set as your needs require. 

---

## 🚀 Step 4: Run the Backend Server

In the **first terminal window**:

```bash
cd BrainDrive/backend
uvicorn main:app --host localhost --port 8005
```

---

## 💻 Step 5: Set Up and Run the Frontend

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

Look at [/frontend/.env.example](https://github.com/BrainDriveAI/BrainDrive/blob/main/frontend/.env.example) and set as your needs require. 

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


