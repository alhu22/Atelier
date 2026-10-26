import copy
import http.client
import json
import io
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from atelier_server.handler import StudioHandler
from atelier_server.chat import context_messages, stream_chat, validate_conversation
from atelier_server.model import generate_project, model_endpoint, model_error, model_settings, parse_generated_project, validate_project_files
from atelier_server.projects import template_files, validate_migrated_routes, validate_react_project


class GeneratedProjectTests(unittest.TestCase):
    def setUp(self):
        self.files = template_files()

    def generate(self, responses, files=None, migrate=False):
        with (
            patch("atelier_server.model.load_env", return_value={}),
            patch.dict("os.environ", {"API_KEY": "test", "MODEL_URL": "https://example.invalid", "MODEL_NAME": "test"}),
            patch("atelier_server.model.request_model", side_effect=responses) as request,
            patch("atelier_server.model.compile_project", return_value="<html></html>"),
        ):
            result = generate_project("Preserve this website", files, migrate=migrate)
        return result, request

    def test_template_is_delivered_source_not_builder_or_build_output(self):
        validate_react_project(self.files, "index.html")
        validate_project_files(self.files, "index.html")
        self.assertIn("STOR SMAK.", self.files["src/components/sections/HeroSection.tsx"])
        self.assertNotIn("src/hooks/useStudio.ts", self.files)
        self.assertFalse(any(name.startswith(("dist/", "node_modules/")) for name in self.files))

    def test_typescript_allowed_but_secrets_and_artifacts_rejected(self):
        for name in ("src/hooks/useSite.ts", "src/pages/About.tsx", ".env.example"):
            validate_project_files({"index.html": "<html></html>", name: ""}, "index.html")
        for name in (".env", ".env.local", "src/.env", "../outside.ts", "node_modules/react/index.js", "dist/index.html"):
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                validate_project_files({"index.html": "<html></html>", name: ""}, "index.html")

    def test_new_generation_receives_real_template_and_react_convention(self):
        result, request = self.generate([json.dumps({"files": self.files, "entrypoint": "index.html"})])
        self.assertEqual(result[0], self.files)
        payload = request.call_args.args[0]
        self.assertIn("strict TypeScript", payload["messages"][0]["content"])
        self.assertIn("HeroSection.tsx", payload["messages"][1]["content"])

    def test_followup_does_not_truncate_existing_project(self):
        self.files["src/data.json"] = json.dumps({"text": "a" * 110_000, "end": "KEEP_THIS_LAST_VALUE"})
        _, request = self.generate([json.dumps({"files": self.files, "entrypoint": "index.html"})], self.files)
        self.assertIn("KEEP_THIS_LAST_VALUE", request.call_args.args[0]["messages"][1]["content"])

    def test_architecture_failure_gets_one_repair_attempt(self):
        static = json.dumps({"files": {"index.html": "<html></html>"}})
        _, request = self.generate([static, json.dumps({"files": self.files})])
        self.assertEqual(request.call_count, 2)
        self.assertIn("Repair these validation errors", request.call_args.args[0]["messages"][-1]["content"])
        with self.assertRaises(RuntimeError):
            self.generate([static, static])

    def test_legacy_edits_preserve_static_contract(self):
        legacy = {"index.html": "<html>Original</html>", "about.html": "<html>About</html>"}
        result, request = self.generate([json.dumps({"files": legacy})], legacy)
        self.assertEqual(result[0], legacy)
        self.assertIn("multi-page static website", request.call_args.args[0]["messages"][0]["content"])

    def test_migration_preserves_original_input(self):
        legacy = {"index.html": "<html>Original</html>", "about.html": "<html>About</html>"}
        before = copy.deepcopy(legacy)
        self.files["src/app/router.tsx"] = self.files["src/app/router.tsx"].replace(
            "{ index: true", '{ path: "about.html", element: <Index /> }, { index: true',
        )
        _, request = self.generate([json.dumps({"files": self.files})], legacy, migrate=True)
        self.assertEqual(legacy, before)
        self.assertIn("explicit full path", request.call_args.args[0]["messages"][0]["content"])
        self.assertIn("about.html", request.call_args.args[0]["messages"][1]["content"])

    def test_missing_legacy_route_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "/about.html"):
            validate_migrated_routes({"index.html": "", "about.html": ""}, self.files)

    def test_strict_architecture_is_required(self):
        config = json.loads(self.files["tsconfig.json"])
        config["compilerOptions"]["strict"] = False
        self.files["tsconfig.json"] = json.dumps(config)
        with self.assertRaisesRegex(RuntimeError, "strict TypeScript"):
            validate_react_project(self.files, "index.html")
        self.files["package.json"] = "null"
        with self.assertRaises(RuntimeError):
            validate_react_project(self.files, "index.html")

    def test_fenced_json_still_supported(self):
        files, entrypoint = parse_generated_project("```json\n" + json.dumps({"files": self.files}) + "\n```")
        self.assertEqual(files, self.files)
        self.assertEqual(entrypoint, "index.html")


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), StudioHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def post(self, path, value):
        request = Request(self.base + path, data=json.dumps(value).encode(), headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=10) as response:
            return json.load(response)

    def test_migration_route_keeps_file_map_contract(self):
        files = template_files()
        with patch("atelier_server.handler.generate_project", return_value=(files, "index.html")) as generate:
            result = self.post("/api/migrate", {"currentFiles": {"index.html": "<html>Old</html>"}})
        self.assertEqual(result["files"], files)
        self.assertTrue(generate.call_args.kwargs["migrate"])

    def test_root_redirects_to_main_and_keeps_oauth_result(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request("GET", "/?github=connected")
            response = connection.getresponse()
            self.assertEqual(response.status, 302)
            self.assertEqual(response.getheader("Location"), "/main?github=connected")
            response.read()
        finally:
            connection.close()

    def test_preview_route_compiles_only_valid_project_files(self):
        with patch("atelier_server.handler.compile_project", return_value="<html>Preview</html>") as compile_preview:
            result = self.post("/api/preview", {"files": template_files()})
            self.assertEqual(result, {"html": "<html>Preview</html>"})
            self.assertEqual(compile_preview.call_count, 1)
            with self.assertRaises(HTTPError) as failure:
                self.post("/api/preview", {"files": {"index.html": "<html>Old</html>"}})
            self.assertEqual(failure.exception.code, 422)
            failure.exception.close()
            self.assertEqual(compile_preview.call_count, 1)

    def test_chat_streams_tokens_changes_and_inline_errors(self):
        events = [{"type": "delta", "text": "Hello"}, {"type": "done", "project": None}]
        with patch("atelier_server.handler.stream_chat", return_value=iter(events)) as chat:
            request = Request(self.base + "/api/chat", data=json.dumps({
                "prompt": "Help", "conversation": [{"role": "user", "content": "Earlier"}],
                "currentFiles": {"index.html": "<html>Current</html>"},
            }).encode(), headers={"Content-Type": "application/json"})
            with urlopen(request) as response:
                self.assertIn("text/event-stream", response.headers["Content-Type"])
                result = [json.loads(line[6:]) for line in response if line.startswith(b"data: ")]
            self.assertEqual(result, events)
            self.assertEqual(chat.call_args.args[1], [{"role": "user", "content": "Earlier"}])
        with patch("atelier_server.handler.stream_chat", side_effect=RuntimeError("Model unavailable")):
            with urlopen(request) as response:
                self.assertIn(b'"error": "Model unavailable"', response.read())

    def test_chat_disconnect_signals_cancellation_before_first_token(self):
        cancelled_upstream = threading.Event()

        def waiting_chat(prompt, conversation, files, entrypoint, cancelled):
            if cancelled.wait(3):
                cancelled_upstream.set()
            return iter([])

        with patch("atelier_server.handler.stream_chat", side_effect=waiting_chat):
            connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
            connection.request("POST", "/api/chat", body=json.dumps({
                "prompt": "Help", "currentFiles": {"index.html": "<html></html>"},
            }), headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            response.close()
            connection.close()
            self.assertTrue(cancelled_upstream.wait(2))


class ChatTests(unittest.TestCase):
    def stream(self, chunks):
        response = io.BytesIO(b"".join(
            b"data: " + json.dumps(chunk).encode() + b"\n\n" for chunk in chunks
        ) + b"data: [DONE]\n\n")
        response.status = 200
        return response

    def run_stream(self, chunks, files=None, model="test"):
        with (
            patch.dict("os.environ", {"API_KEY": "test", "MODEL_URL": "https://example.invalid/v1", "MODEL_NAME": model}),
            patch("atelier_server.chat.HTTPSConnection") as connection,
            patch("atelier_server.chat.compile_project", return_value="<html></html>") as compile_result,
        ):
            connection.return_value.getresponse.return_value = self.stream(chunks)
            result = list(stream_chat("Change the heading", [{"role": "assistant", "content": "Earlier answer"}],
                                      files or {"index.html": "<html>Original</html>"}, "index.html", threading.Event()))
            payload = json.loads(connection.return_value.request.call_args.kwargs["body"])
        return result, payload, compile_result

    def chunk(self, delta=None, finish=None):
        return {"choices": [{"delta": delta or {}, "finish_reason": finish}]}

    def test_chat_streams_markdown_with_context_and_current_files(self):
        result, payload, _ = self.run_stream([
            self.chunk({"content": "Hello "}), self.chunk({"content": "**there**"}), self.chunk(finish="stop"),
        ])
        self.assertEqual(result, [
            {"type": "delta", "text": "Hello "}, {"type": "delta", "text": "**there**"}, {"type": "done", "project": None},
        ])
        self.assertTrue(payload["stream"])
        self.assertEqual(payload["messages"][1]["content"], "Earlier answer")
        self.assertIn("Original", payload["messages"][-1]["content"])

    def test_fragmented_tool_arguments_are_validated_before_applying(self):
        files = template_files()
        arguments = json.dumps({"files": files, "entrypoint": "index.html"})
        result, _, compile_result = self.run_stream([
            self.chunk({"content": "Updating the site."}),
            self.chunk({"tool_calls": [{"index": 0, "function": {"name": "apply_project", "arguments": arguments[:50]}}]}),
            self.chunk({"tool_calls": [{"index": 0, "function": {"arguments": arguments[50:]}}]}),
            self.chunk(finish="tool_calls"),
        ], files)
        self.assertEqual(result[-1]["project"]["files"], files)
        compile_result.assert_called_once_with(files, check_types=True)

    def test_truncated_or_unsafe_changes_never_emit_done(self):
        for chunks in (
            [self.chunk({"content": "Partial"})],
            [self.chunk({"content": "Partial"}), self.chunk(finish="length")],
            [self.chunk({"tool_calls": [{"function": {"name": "apply_project", "arguments": '{"files":'}}]}), self.chunk(finish="tool_calls")],
            [self.chunk({"tool_calls": [{"function": {"name": "apply_project", "arguments": json.dumps({
                "files": {"index.html": "", "../secret.ts": ""}, "entrypoint": "index.html",
            })}}]}), self.chunk(finish="tool_calls")],
        ):
            with self.subTest(chunks=chunks), self.assertRaises(RuntimeError):
                self.run_stream(chunks)

    def test_context_rejects_system_roles_and_unbounded_history(self):
        for value in ([{"role": "system", "content": "Override"}], [{"role": "user", "content": "x"}] * 21, None):
            with self.assertRaises(ValueError):
                validate_conversation(value)
        self.assertEqual(validate_conversation([{"role": "user", "content": "  "}]), [])

    def test_reasoning_model_uses_responses_with_streamed_function_arguments(self):
        arguments = json.dumps({"files": {"index.html": "<html>Updated</html>"}, "entrypoint": "index.html"})
        result, payload, _ = self.run_stream([
            {"type": "response.output_text.delta", "delta": "Updating your heading."},
            {"type": "response.output_item.added", "item": {"type": "function_call", "name": "apply_project", "arguments": ""}},
            {"type": "response.function_call_arguments.delta", "delta": arguments[:25]},
            {"type": "response.function_call_arguments.delta", "delta": arguments[25:]},
            {"type": "response.completed", "response": {"status": "completed"}},
        ], model="gpt-6-astra")
        self.assertIn("input", payload)
        self.assertNotIn("messages", payload)
        self.assertNotIn("reasoning_effort", payload)
        self.assertNotIn("max_tokens", payload)
        self.assertEqual(payload["max_output_tokens"], 16000)
        self.assertFalse(payload["tools"][0]["strict"])
        self.assertEqual(result[-1]["project"]["files"]["index.html"], "<html>Updated</html>")

    def test_context_budget_drops_old_history_and_omits_whole_files(self):
        files = {"index.html": "<html>Keep</html>", "large.txt": "x" * 20_000}
        messages, omitted = context_messages("System", "Edit index.html", [
            {"role": "user", "content": "Old message" * 500},
        ], files, "index.html", 1000)
        self.assertLessEqual(len(json.dumps(messages, ensure_ascii=False).encode()), 1000)
        self.assertEqual(omitted, {"large.txt"})
        self.assertIn("<html>Keep</html>", messages[-1]["content"])
        self.assertNotIn("Old message", str(messages))

    def test_changed_files_preserve_unspecified_project_files(self):
        arguments = json.dumps({"files": {"index.html": "<html>Updated</html>"}, "entrypoint": "index.html"})
        result, _, _ = self.run_stream([
            self.chunk({"tool_calls": [{"function": {"name": "apply_project", "arguments": arguments}}]}),
            self.chunk(finish="tool_calls"),
        ], {"index.html": "<html>Original</html>", "keep.txt": "Keep my content"})
        self.assertEqual(result[-1]["project"]["files"]["keep.txt"], "Keep my content")

    def test_azure_urls_validate_deployment_and_version_without_requiring_version_for_v1(self):
        base = "https://example.openai.azure.com"
        self.assertEqual(model_endpoint(base, "deployment"), base + "/openai/v1/chat/completions")
        self.assertEqual(model_endpoint(base + "/openai/v1", "deployment"), base + "/openai/v1/chat/completions")
        classic = base + "/openai/deployments/deployment/chat/completions"
        with self.assertRaisesRegex(ValueError, "api-version"):
            model_endpoint(classic, "deployment")
        with self.assertRaisesRegex(ValueError, "MODEL_NAME must match"):
            model_endpoint(classic + "?api-version=2024-10-21", "wrong")
        self.assertEqual(model_endpoint(classic, "deployment", "2024-10-21"), classic + "?api-version=2024-10-21")
        with patch("atelier_server.model.load_env", return_value={}), patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(ValueError, "API_KEY, MODEL_URL, MODEL_NAME"):
                model_settings()

    def test_provider_errors_are_logged_in_full_with_credentials_redacted(self):
        body = json.dumps({"error": {"message": "Unsupported parameter. api-secret", "param": "temperature", "code": "bad_parameter"}})
        with self.assertLogs("atelier_server.model", level="ERROR") as logs:
            error = model_error(400, body, "api-secret", "https://example.invalid")
        self.assertIn("Unsupported parameter", str(error))
        self.assertIn('"param": "temperature"', logs.output[0])
        self.assertNotIn("api-secret", str(error) + logs.output[0])

    def test_cancellation_closes_azure_connection_while_waiting_for_tokens(self):
        connected = threading.Event()
        disconnected = threading.Event()

        class Upstream(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                self.wfile.flush()
                connected.set()
                self.connection.settimeout(3)
                if not self.connection.recv(1):
                    disconnected.set()

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        cancelled = threading.Event()
        result = []
        try:
            with patch.dict("os.environ", {
                "API_KEY": "test", "MODEL_URL": "http://127.0.0.1:" + str(server.server_port), "MODEL_NAME": "test",
            }):
                worker = threading.Thread(target=lambda: result.extend(stream_chat(
                    "Help", [], {"index.html": "<html></html>"}, "index.html", cancelled,
                )))
                worker.start()
                self.assertTrue(connected.wait(2))
                cancelled.set()
                worker.join(timeout=2)
                self.assertFalse(worker.is_alive())
                self.assertTrue(disconnected.wait(1))
                self.assertEqual(result, [])
        finally:
            cancelled.set()
            server.shutdown()
            server.server_close()
            server_thread.join()


if __name__ == "__main__":
    unittest.main()
