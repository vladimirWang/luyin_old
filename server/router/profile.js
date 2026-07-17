import express from "express";
import { requestClientIdBetter } from "../utils/recordings.js";
import { accountClientId } from "../utils/auth.mjs";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

router.get("/", async (request, response) => {
  const { loadDb, clientProfileForRequest } = dependencies;
  const db = await loadDb();
  response.json({ profile: clientProfileForRequest(db, request) });
});

router.put("/", async (request, response) => {
  const { requestAccountPayload, updateDb, profilePatchForClient } = dependencies;
  const clientId = requestClientIdBetter(request);
  const accountPayload = requestAccountPayload(request);
  const nextProfile = await updateDb((db) => {
    const patch = profilePatchForClient(request.body || {});
    const account = accountPayload?.accountId ? (db.accounts || []).find((item) => item.id === accountPayload.accountId) : null;
    if (account) {
      const targetClientId = accountClientId(account.id);
      account.profile = {
        ...(account.profile || {}),
        ...patch,
        name: account.username,
        username: account.username,
        accountId: account.id,
        clientId: targetClientId,
        accountLoggedIn: true,
        updatedAt: new Date().toISOString(),
      };
      account.updatedAt = new Date().toISOString();
      if (!db.clientProfiles || typeof db.clientProfiles !== "object" || Array.isArray(db.clientProfiles)) db.clientProfiles = {};
      db.clientProfiles[targetClientId] = account.profile;
      return {
        ...(db.profile || {}),
        ...account.profile,
      };
    }

    if (!db.clientProfiles || typeof db.clientProfiles !== "object" || Array.isArray(db.clientProfiles)) {
      db.clientProfiles = {};
    }
    db.clientProfiles[clientId] = {
      ...(db.clientProfiles[clientId] || {}),
      ...patch,
      clientId,
      updatedAt: new Date().toISOString(),
    };
    return {
      ...(db.profile || {}),
      ...db.clientProfiles[clientId],
    };
  });

  response.json({ profile: nextProfile });
});

export default router;
