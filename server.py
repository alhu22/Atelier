import os
from http.server import ThreadingHTTPServer

from atelier_server.handler import StudioHandler


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5173"))
    server = ThreadingHTTPServer(("127.0.0.1", port), StudioHandler)
    print("Studio running at http://127.0.0.1:%s" % port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStudio stopped.")
        server.server_close()
