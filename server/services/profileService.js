import { accountClientId } from "../utils/auth.mjs";

export function createProfileService({
  loadDb,
  clientProfileForRequest,
  requestAccountPayload,
  updateDb,
  profilePatchForClient,
}) {
  return {
    async getProfile(request) {
      const db = await loadDb();
      return clientProfileForRequest(db, request);
    },

    async updateProfile({ clientId, accountPayload, input }) {
      return updateDb((db) => {
        const patch = profilePatchForClient(input || {});
        const account = accountPayload?.accountId
          ? (db.accounts || []).find((item) => item.id === accountPayload.accountId)
          : null;
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
          if (!db.clientProfiles || typeof db.clientProfiles !== "object" || Array.isArray(db.clientProfiles)) {
            db.clientProfiles = {};
          }
          db.clientProfiles[targetClientId] = account.profile;
          return { ...(db.profile || {}), ...account.profile };
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
        return { ...(db.profile || {}), ...db.clientProfiles[clientId] };
      });
    },

    requestAccountPayload,
  };
}
