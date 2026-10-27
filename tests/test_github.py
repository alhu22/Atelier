import io
import json
import unittest
from unittest.mock import call, patch
from urllib.error import HTTPError

from atelier_server.github import GitHubAPIError, github_api_request, github_export


class GitHubExportTests(unittest.TestCase):
    def test_empty_repository_initializes_selected_or_default_branch(self):
        for selected, default, expected in (
            ("", "master", "master"),
            ("feature/site", "main", "feature/site"),
            ("", None, "main"),
        ):
            with self.subTest(branch=expected), patch(
                "atelier_server.github.github_api_request",
                side_effect=[
                    {"default_branch": default},
                    GitHubAPIError(409, "Git Repository is empty."),
                    {"commit": {"sha": "initial"}},
                    {"sha": "initial", "tree": {"sha": "initial-tree"}},
                    {"sha": "asset-blob"},
                    {"sha": "export-tree"},
                    {"sha": "export-commit"},
                    None,
                ],
            ) as api:
                files = {"index.html": "Hello", "public/logo.png": "data:image/png;base64,AP8="}
                result = github_export("token", "owner/repo", selected, "Site", files)
                self.assertEqual(api.call_args_list[2], call(
                    "/repos/owner/repo/contents/index.html", "token", method="PUT",
                    body={"message": "Export Site", "content": "SGVsbG8=", "branch": expected},
                ))
                self.assertEqual(api.call_args_list[3].args[0], "/repos/owner/repo/git/commits/initial")
                self.assertEqual(api.call_args_list[4].kwargs["body"], {
                    "content": "AP8=", "encoding": "base64",
                })
                self.assertEqual(api.call_args_list[5].kwargs["body"], {
                    "base_tree": "initial-tree",
                    "tree": [{"path": "public/logo.png", "mode": "100644", "type": "blob", "sha": "asset-blob"}],
                })
                self.assertEqual(api.call_args_list[6].kwargs["body"]["parents"], ["initial"])
                self.assertEqual(api.call_args_list[7], call(
                    "/repos/owner/repo/git/refs/heads/" + expected, "token", method="PATCH",
                    body={"sha": "export-commit", "force": False},
                ))
                self.assertEqual(result["message"], "Exported 2 files to owner/repo (" + expected + ").")
                self.assertEqual(len(files), 2)

    def test_single_file_empty_export_needs_only_initial_commit(self):
        with patch("atelier_server.github.github_api_request", side_effect=[
            {"default_branch": "main"},
            GitHubAPIError(409, "Git Repository is empty."),
            {"commit": {"sha": "initial"}},
        ]) as api:
            result = github_export("token", "owner/repo", "", "", {"public/logo.png": "data:image/png;base64,AP8="})
        self.assertEqual(api.call_count, 3)
        self.assertEqual(api.call_args.kwargs["body"]["content"], "AP8=")
        self.assertEqual(result["message"], "Exported 1 files to owner/repo (main).")

    def test_existing_repository_preserves_parent_tree_and_history(self):
        with patch("atelier_server.github.github_api_request", side_effect=[
            {"default_branch": "main"},
            {"object": {"sha": "parent"}},
            {"sha": "parent", "tree": {"sha": "parent-tree"}},
            {"sha": "blob"},
            {"sha": "tree"},
            {"sha": "commit"},
            None,
        ]) as api:
            github_export("token", "owner/repo", "", "Site", {"index.html": "Hello"})
        self.assertFalse(any(item.kwargs.get("method") == "PUT" for item in api.call_args_list))
        self.assertEqual(api.call_args_list[4].kwargs["body"]["base_tree"], "parent-tree")
        self.assertEqual(api.call_args_list[5].kwargs["body"]["parents"], ["parent"])
        self.assertEqual(api.call_args.kwargs["body"], {"sha": "commit", "force": False})

    def test_other_reference_errors_do_not_initialize_repository(self):
        for error in (
            GitHubAPIError(404, "Not Found"),
            GitHubAPIError(403, "Forbidden"),
            GitHubAPIError(409, "Another conflict"),
            RuntimeError("Could not reach GitHub."),
        ):
            with self.subTest(error=error), patch(
                "atelier_server.github.github_api_request",
                side_effect=[{"default_branch": "main"}, error],
            ) as api:
                with self.assertRaises(RuntimeError) as raised:
                    github_export("token", "owner/repo", "", "Site", {"index.html": "Hello"})
                self.assertIs(raised.exception, error)
                self.assertEqual(api.call_count, 2)

    def test_api_error_preserves_status_and_message(self):
        error = HTTPError(
            "https://api.github.com/repos/owner/repo/git/ref/heads/main", 409,
            "Conflict", {}, io.BytesIO(json.dumps({"message": "Git Repository is empty."}).encode()),
        )
        self.addCleanup(error.close)
        with patch("atelier_server.github.urlopen", side_effect=error):
            with self.assertRaises(GitHubAPIError) as raised:
                github_api_request("/repos/owner/repo/git/ref/heads/main", "token")
        self.assertEqual(raised.exception.status, 409)
        self.assertEqual(str(raised.exception), "Git Repository is empty.")
