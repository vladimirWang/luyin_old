import { requestClientIdBetter } from "../utils/recordings.js";

export function createProfileController(service) {
  return {
    async getProfile(request, response, next) {
      try {
        response.json({ profile: await service.getProfile(request) });
      } catch (error) {
        next(error);
      }
    },

    async updateProfile(request, response, next) {
      try {
        const profile = await service.updateProfile({
          clientId: requestClientIdBetter(request),
          accountPayload: service.requestAccountPayload(request),
          input: request.body,
        });
        response.json({ profile });
      } catch (error) {
        next(error);
      }
    },
  };
}
