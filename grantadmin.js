const fs = require("node:fs");
const path = require("node:path");
const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

function readEnvValue(name) {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return "";
  const line = fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "") || "";
}

const adminUid = process.env.ADMIN_UID?.trim() || readEnvValue("ADMIN_UID");
if (!adminUid) throw new Error("Set ADMIN_UID in .env first.");

initializeApp({
  credential: applicationDefault(),
  projectId: "atelier-6f995"
});

async function grantAdmin() {
  const auth = getAuth();
  const user = await auth.getUser(adminUid);

  await auth.setCustomUserClaims(adminUid, {
    ...user.customClaims,
    admin: true
  });

  console.log("Admin access granted.");
}

grantAdmin().catch((error) => {
  console.error("Could not grant admin access.", error);
  process.exitCode = 1;
});
