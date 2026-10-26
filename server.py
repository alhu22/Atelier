from http.server import ThreadingHTTPServer

from atelier_server.handler import StudioHandler
from atelier_server.config import setting


if __name__ == "__main__":
    port = int(setting("PORT") or "5173")
    server = ThreadingHTTPServer(("127.0.0.1", port), StudioHandler)
    print("Atelier running at http://127.0.0.1:%s/main" % port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStudio stopped.")
        server.server_close()
