"""Copy a saved project to an admin account and publish a separate template snapshot."""

import argparse
import base64
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from atelier_server.model import validate_project_files
from atelier_server.projects import compile_project, validate_react_project


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="Firebase project ID")
    parser.add_argument("--source-owner", required=True)
    parser.add_argument("--source-project", required=True)
    parser.add_argument("--admin-owner", required=True)
    parser.add_argument("--template-id", required=True)
    parser.add_argument("--description", required=True)
    parser.add_argument("--order", type=int, default=0)
    parser.add_argument("--preview-image", type=Path, help="JPEG screenshot of the homepage (at most 192 KB)")
    args = parser.parse_args()
    for value in (args.project, args.source_owner, args.source_project, args.admin_owner, args.template_id):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            parser.error("Project IDs, template IDs and UIDs must contain only letters, numbers, underscores and hyphens.")
    if len(args.description) > 500:
        parser.error("Descriptions must be at most 500 characters.")
    preview_image = None
    if args.preview_image:
        image = args.preview_image.read_bytes()
        preview_image = "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii")
        if not image.startswith(b"\xff\xd8\xff") or len(preview_image) > 262144:
            parser.error("The preview must be a JPEG with a base64 data URL of at most 256 KB.")
    token = subprocess.run(
        ["gcloud", "auth", "application-default", "print-access-token", "--quiet"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    database = f"projects/{args.project}/databases/(default)/documents"

    def request(method, resource, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = Request(
            "https://firestore.googleapis.com/v1/" + resource,
            data=data, method=method,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        )
        with urlopen(req, timeout=60) as response:
            return json.load(response)

    source_path = f"{database}/users/{args.source_owner}/projects/{args.source_project}"
    source = request("GET", source_path)
    fields = source["fields"]
    files = {name: value["stringValue"] for name, value in fields["files"]["mapValue"]["fields"].items()}
    entrypoint = fields["entrypoint"]["stringValue"]
    validate_project_files(files, entrypoint)
    validate_react_project(files, entrypoint)
    compile_project(files, check_types=True)
    name = fields["name"]["stringValue"]
    if not name.strip() or len(name) > 120:
        raise ValueError("The source project needs a name of 1 to 120 characters.")
    copy_path = f"{database}/users/{args.admin_owner}/projects/template-{args.template_id}"
    template_path = f"{database}/templates/{args.template_id}"
    copy_fields = {
        "name": fields["name"],
        "owner": {"stringValue": args.admin_owner},
        "settings": fields.get("settings", {"mapValue": {"fields": {}}}),
        "files": fields["files"],
        "entrypoint": fields["entrypoint"],
        "generated": {"booleanValue": True},
    }
    template_fields = {
        "name": fields["name"],
        "description": {"stringValue": args.description},
        "order": {"integerValue": str(args.order)},
        "files": fields["files"],
        "entrypoint": fields["entrypoint"],
    }
    if preview_image:
        template_fields["previewImage"] = {"stringValue": preview_image}
    writes = []
    for path, value, timestamps in (
        (copy_path, copy_fields, ["createdAt", "updatedAt"]),
        (template_path, template_fields, ["updatedAt"]),
    ):
        writes.append({
            "update": {"name": path, "fields": value},
            "currentDocument": {"exists": False},
            "updateTransforms": [
                {"fieldPath": field, "setToServerValue": "REQUEST_TIME"} for field in timestamps
            ],
        })
    request("POST", database + ":commit", {"writes": writes})
    for path, expected in ((copy_path, copy_fields), (template_path, template_fields)):
        saved = request("GET", path)["fields"]
        if any(saved.get(key) != value for key, value in expected.items()):
            raise RuntimeError("Published data did not match the source snapshot.")
    if request("GET", source_path)["updateTime"] != source["updateTime"]:
        raise RuntimeError("The source changed during publication; the template contains the earlier snapshot.")
    print(f"Copied {name} ({len(files)} files) to {copy_path}")
    print(f"Published {template_path}; source unchanged.")


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        sys.exit(f"Firestore HTTP {error.code}. Existing copies/templates are never overwritten.")
    except subprocess.CalledProcessError:
        sys.exit("Google application-default authentication failed. Run gcloud auth application-default login.")
