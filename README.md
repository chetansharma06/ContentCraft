# ContentCraft

An AI-powered content generation platform supporting multiple LLM providers
(Gemini, Ollama, Mock) with a unified interface and configurable settings.

## Setup

```bash
# Create venv (Python 3.11+ recommended)
python -m venv .venv

# Activate
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment (optional for the default mock provider)
copy .env.example .env
# Edit .env with your credentials if using Gemini or Ollama

# Install frontend dependencies once
npm install --prefix frontend
```

## Run the Application

From the project root, start the backend and frontend together:

```bash
npm run dev
```

The launcher starts FastAPI, waits for its `/health` endpoint, and then starts Vite. Press `Ctrl+C` to stop both. The frontend is available at `http://127.0.0.1:5173` and the API docs at `http://127.0.0.1:8000/docs`.

The root command uses the project `.venv` when present. Create it and install backend dependencies once with the setup commands above if needed.

### Development Environment

The default provider is `mock`; no API key is needed. Configure `BACKEND_HOST`, `BACKEND_PORT`, `FRONTEND_HOST`, `FRONTEND_PORT`, and optionally `CORS_ORIGINS` in `.env` to change server addresses. `VITE_API_BASE_URL` defaults to `/api`, and Vite proxies that prefix to the backend URL. Browser requests use the same-origin proxy by default; CORS is configured for direct frontend-to-backend requests as well.
npm run dev