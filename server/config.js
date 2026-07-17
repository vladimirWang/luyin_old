import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(__dirname, ".");
export const tencentMeetingWebhookDir = path.join(projectRoot, "storage", "tencent-meeting-webhooks");