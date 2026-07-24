export function createHealthController(service) {
  return {
    getHealth(request, response) {
      response.json(service.getHealth(request.app.info));
    },
  };
}
