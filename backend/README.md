# BrainDrive Backend

## 🚀 Overview

BrainDrive Backend is the engine behind the BrainDrive application—a modular, extensible AI platform. This FastAPI-based backend provides robust APIs for managing users, plugins, conversations, settings, and more, with a focus on flexibility, security, and developer experience.

---

## 🛠️ Tech Stack

* **[FastAPI](https://fastapi.tiangolo.com/)** — High-performance, Python-based web framework
* **[SQLModel](https://sqlmodel.tiangolo.com/)** — ORM built on SQLAlchemy and Pydantic
* **[Uvicorn](https://www.uvicorn.org/)** — Lightning-fast ASGI server
* **[Pydantic](https://docs.pydantic.dev/)** — Data validation and serialization
* **[Alembic](https://alembic.sqlalchemy.org/)** — Database migrations
* **[SQLite](https://www.sqlite.org/)** — Default lightweight database engine
* **[Structlog](https://www.structlog.org/)** — Structured logging
* **[Passlib](https://passlib.readthedocs.io/)** — Password hashing
* **[Python-Jose](https://python-jose.readthedocs.io/)** — JWT creation and verification

---

## ✨ Features

* 🔒 JWT-based authentication with refresh tokens
* 👤 User registration, login, and profile management
* ⚙️ Dynamic settings system with multi-tier support
* 🤖 Modular plugin system with automatic discovery
* 📚 AI provider registry and switching support
* 🧭 Dynamic navigation and component rendering
* 💬 Conversation history management
* 🏷️ Tag-based organization system
* 🌐 CORS, environment profiles, and structured logging

---

## 📦 Installation

### Prerequisites

* Python 3.8 or higher (Python 3.11 recommended)
* Git
* Conda (recommended) or Python's built-in `venv`

### Clone Repository

```bash
git clone https://github.com/BrainDriveAI/BrainDrive.git
cd BrainDrive/backend
```

### Environment Setup

#### Option 1: Conda (Recommended)

```bash
conda create -n BrainDriveDev python=3.11
conda activate BrainDriveDev
pip install -r requirements.txt
```

#### Option 2: venv

```bash
python -m venv venv
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate
pip install -r requirements.txt
```

### Configuration

Create a `.env` file in the `backend/` folder. You can copy from an example:

```bash
<<<<<<< HEAD
cp .env-dev .env
=======
cp .env.prod .env
>>>>>>> dadcccd276a9a310f6516273cbcc3bd5974e9c05
```

Or manually create it using the following template:

```env
APP_NAME=BrainDrive
APP_ENV=dev
DEBUG=true
LOG_LEVEL=info
HOST=0.0.0.0
PORT=8005
RELOAD=true
PROXY_HEADERS=true
FORWARDED_ALLOW_IPS=*
SECRET_KEY=your-secret-key
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=30
ALGORITHM=HS256
DATABASE_URL=sqlite:///braindrive.db
DATABASE_TYPE=sqlite
USE_JSON_STORAGE=false
JSON_DB_PATH=./storage/database.json
SQL_LOG_LEVEL=WARNING
CORS_ORIGINS=["http://localhost:3000"]
CORS_METHODS=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"]
CORS_HEADERS=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"]
CORS_MAX_AGE=3600
CORS_ALLOW_CREDENTIALS=true
ALLOWED_HOSTS=["localhost", "127.0.0.1"]
```

---

## ▶️ Running the Backend

### Development Mode

```bash
python main.py
# or with uvicorn
uvicorn main:app --reload --host 0.0.0.0 --port 8005
```

### Production Mode

1. Set in `.env`: `APP_ENV=prod`, `DEBUG=false`, `RELOAD=false`
2. Run with process manager (e.g., systemd, supervisor):

```bash
uvicorn main:app --host 0.0.0.0 --port 8005 --workers 4
```

#### Example systemd Unit

```ini
[Unit]
Description=BrainDrive Backend
After=network.target

[Service]
User=BrainDriveAI
WorkingDirectory=/opt/BrainDrive/backend
Environment="PATH=/opt/BrainDrive/backend/venv/bin"
ExecStart=/opt/BrainDrive/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8005 --workers 4
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable braindrive
sudo systemctl start braindrive
```

---

## 📖 API Docs

Once running:

* Swagger UI: [http://localhost:8005/api/v1/docs](http://localhost:8005/api/v1/docs)
* ReDoc: [http://localhost:8005/api/v1/redoc](http://localhost:8005/api/v1/redoc)

---

## 🧬 Database Migrations (Alembic)

```bash
# Create a new revision
d alembic revision --autogenerate -m "Add new field"

# Apply migrations
alembic upgrade head

# Downgrade (if needed)
alembic downgrade <revision>
```

---

## 🧪 Development Workflow

1. Activate your environment (`conda activate BrainDriveDev` or `source venv/bin/activate`)
2. Pull latest changes
3. Install new dependencies if needed
4. Test locally
5. Add/update requirements with:

   ```bash
   pip freeze > requirements.txt
   ```

---

## 🛠 Troubleshooting

| Issue                 | Solution                                       |
| --------------------- | ---------------------------------------------- |
| Package install fails | `pip install --upgrade pip`, retry install     |
| Port in use           | Change `PORT` in `.env`                        |
| Module not found      | `pip install <module>` and update requirements |
| DB errors             | Check `.env` values and DB file                |
| Activation fails      | Confirm conda/venv setup and shell support     |

---

## 📄 License

[MIT License](../LICENSE)

---

## 🤝 Contributing

We welcome contributions! Please open issues or submit PRs for bugs, enhancements, or documentation improvements.

* Follow PEP8 and use type hints
* Document new APIs with OpenAPI annotations
* Run tests before submitting changes

---

## 🌐 Additional Resources

* [FastAPI Docs](https://fastapi.tiangolo.com/)
* [Alembic Docs](https://alembic.sqlalchemy.org/)
* [SQLModel Docs](https://sqlmodel.tiangolo.com/)
* [Structlog Docs](https://www.structlog.org/)

---

