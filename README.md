# Atelier

A local AI website studio powered by an OpenAI-compatible Gemma chat-completions endpoint.

## Run

```sh
python3 server.py
```

Open http://127.0.0.1:5173. Python 3.10 or newer is required; no package installation is needed.

The server reads `MODEL_URL`, `MODEL_NAME`, and `API_KEY` from `.env`. `MODEL_URL` can be a chat-completions URL, a `/v1` base URL, or a host URL. The API key is only sent from the local server to the model provider; it is never returned to the browser.# Atelier
# Atelier
