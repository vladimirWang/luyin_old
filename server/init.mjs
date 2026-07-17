import { attachmentDir, audioDir, ensureStorage, loadDb, tempDir, transcriptDir, ttsDir, updateDb } from "./db.mjs";
export async function init() {
    const taskEnsureStorage = ensureStorage()

    return Promise.all([taskEnsureStorage])
}
