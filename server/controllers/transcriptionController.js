export function createTranscriptionController(service) {
  return {
    getStatus(_request, response) {
      response.json(service.getStatus());
    },
  };
}
