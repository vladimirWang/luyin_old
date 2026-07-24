import { requestClientIdBetter } from "../utils/recordings.js";

export function createFolderController(service) {
  return {
    async list(request, response, next) {
      try {
        response.json(await service.list(requestClientIdBetter(request)));
      } catch (error) {
        next(error);
      }
    },

    async create(request, response, next) {
      try {
        const name = String(request.body?.name || "").trim();
        if (!name) {
          response.status(400).json({ error: "文件夹名称不能为空" });
          return;
        }
        const folder = await service.create({ clientId: requestClientIdBetter(request), name });
        response.status(201).json({ folder });
      } catch (error) {
        next(error);
      }
    },

    async update(request, response, next) {
      try {
        const folder = await service.update({
          id: request.params.id,
          clientId: requestClientIdBetter(request),
          name: request.body?.name,
        });
        if (!folder) {
          response.status(404).json({ error: "文件夹不存在" });
          return;
        }
        response.json({ folder });
      } catch (error) {
        next(error);
      }
    },

    async remove(request, response, next) {
      try {
        const removed = await service.remove({
          id: request.params.id,
          clientId: requestClientIdBetter(request),
        });
        if (!removed) {
          response.status(404).json({ error: "文件夹不存在" });
          return;
        }
        response.json({ ok: true });
      } catch (error) {
        next(error);
      }
    },
  };
}
