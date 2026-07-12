import express from "express";

const router = express.Router();

let dependencies = {};

export function configure(deps) {
  dependencies = deps;
}

router.get("/me", async (request, response) => {
  const { loadDb, requestAccountPayload, publicAccount } = dependencies;
  const db = await loadDb();
  const payload = requestAccountPayload(request);
  const account = payload?.accountId ? (db.accounts || []).find((item) => item.id === payload.accountId) : null;
  response.json({ authenticated: Boolean(account), account: account ? publicAccount(account) : null, profile: account ? publicAccount(account).profile : null });
});

router.post("/enter", async (request, response) => {
  const { normalizeAccountUsername, requestClientId, profilePatchForClient, updateDb, ensureDeleteAllAccount, verifyPassword, mergeLocalClientDataIntoAccount, crypto, createPasswordRecord, logger, accountAuthResponse } = dependencies;
  
  const username = normalizeAccountUsername(request.body?.username);
  const password = String(request.body?.password || "");
  if (!username) {
    response.status(400).json({ error: "账号不能为空" });
    return;
  }
  if (password.length < 6) {
    response.status(400).json({ error: "密码至少需要 6 位" });
    return;
  }

  const sourceClientId = requestClientId(request);
  const profilePatch = profilePatchForClient(request.body?.profile || {});
  let created = false;
  let passwordWrong = false;
  const account = await updateDb((db) => {
    db.accounts = Array.isArray(db.accounts) ? db.accounts : [];
    ensureDeleteAllAccount(db);
    const found = db.accounts.find((item) => normalizeAccountUsername(item.username) === username);
    if (found) {
      if (!verifyPassword(password, found)) {
        passwordWrong = true;
        return null;
      }
      return request.body?.mergeLocal === false ? found : mergeLocalClientDataIntoAccount(db, sourceClientId, found, profilePatch);
    }

    const id = crypto.randomUUID();
    const passwordRecord = createPasswordRecord(password);
    const nextAccount = {
      id,
      username,
      ...passwordRecord,
      profile: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.accounts.push(nextAccount);
    created = true;
    return mergeLocalClientDataIntoAccount(db, sourceClientId, nextAccount, profilePatch);
  });

  if (!account) {
    logger.warn("auth.enter.failed", {message: `username: ${username}, passwordWrong: ${passwordWrong}, sourceClientId: ${sourceClientId}, created: ${created}`, username, passwordWrong, sourceClientId, created});
    response.status(passwordWrong ? 401 : 400).json({ error: passwordWrong ? "密码不正确" : "账号进入失败" });
    return;
  }
  logger.info("auth.enter.success", {username, sourceClientId, created, accountId: account.id});
  response.status(created ? 201 : 200).json({ ...accountAuthResponse(account), created });
});

router.post("/register", async (request, response) => {
  const { normalizeAccountUsername, requestClientId, profilePatchForClient, updateDb, ensureDeleteAllAccount, mergeLocalClientDataIntoAccount, crypto, createPasswordRecord, logger, accountAuthResponse } = dependencies;
  
  const username = normalizeAccountUsername(request.body?.username);
  const password = String(request.body?.password || "");
  if (!username) {
    response.status(400).json({ error: "账号不能为空" });
    return;
  }
  if (password.length < 6) {
    response.status(400).json({ error: "密码至少需要 6 位" });
    return;
  }

  const sourceClientId = requestClientId(request);
  const profilePatch = profilePatchForClient(request.body?.profile || {});
  const account = await updateDb((db) => {
    db.accounts = Array.isArray(db.accounts) ? db.accounts : [];
    ensureDeleteAllAccount(db);
    if (db.accounts.some((item) => normalizeAccountUsername(item.username) === username)) {
      return null;
    }
    const id = crypto.randomUUID();
    const passwordRecord = createPasswordRecord(password);
    const created = {
      id,
      username,
      ...passwordRecord,
      profile: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.accounts.push(created);
    return mergeLocalClientDataIntoAccount(db, sourceClientId, created, profilePatch);
  });

  if (!account) {
    logger.warn("auth.register.conflict", {username, sourceClientId});
    response.status(409).json({ error: "账号已存在，请使用该注册名和密码进入" });
    return;
  }
  logger.info("auth.register.success", {username, sourceClientId, accountId: account.id});
  response.status(201).json(accountAuthResponse(account));
});

router.post("/login", async (request, response) => {
  const { normalizeAccountUsername, requestClientId, profilePatchForClient, updateDb, ensureDeleteAllAccount, verifyPassword, mergeLocalClientDataIntoAccount, logger, accountAuthResponse } = dependencies;
  
  const username = normalizeAccountUsername(request.body?.username);
  const password = String(request.body?.password || "");
  const sourceClientId = requestClientId(request);
  const profilePatch = profilePatchForClient(request.body?.profile || {});
  const account = await updateDb((db) => {
    db.accounts = Array.isArray(db.accounts) ? db.accounts : [];
    ensureDeleteAllAccount(db);
    const found = db.accounts.find((item) => normalizeAccountUsername(item.username) === username);
    if (!found || !verifyPassword(password, found)) return null;
    return request.body?.mergeLocal === false ? found : mergeLocalClientDataIntoAccount(db, sourceClientId, found, profilePatch);
  });

  if (!account) {
    logger.warn("auth.login.failed", {username, sourceClientId});
    response.status(401).json({ error: "账号或密码不正确" });
    return;
  }
  logger.info("auth.login.success", {username, sourceClientId, accountId: account.id});
  response.json(accountAuthResponse(account));
});

export default router;