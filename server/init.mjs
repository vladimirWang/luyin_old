import { attachmentDir, audioDir, ensureStorage, loadDb, tempDir, transcriptDir, ttsDir, updateDb } from "./db.mjs";

export async function init() {
    const task1 = ensureStorage()

    return Promise.all([task1])
}
