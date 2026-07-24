import axios from "axios";
import { mergeRequestHeaders } from "./index.js";

const req = axios.create();

req.interceptors.request.use((config) => {
  const currentHeaders = typeof config.headers?.toJSON === "function"
    ? config.headers.toJSON()
    : config.headers || {};
  config.headers = Object.fromEntries(mergeRequestHeaders(currentHeaders, config.data).entries());
  return config;
});

req.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const payload = error.response?.data;
    const message =
      (typeof payload === "string" ? payload : payload?.error || payload?.message) ||
      error.message ||
      "请求失败";
    return Promise.reject(new Error(message, { cause: error }));
  },
);

export default req;
