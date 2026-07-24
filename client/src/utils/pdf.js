import { downloadBlob, fetchWithClient } from "./index.js";

export async function fetchPdfFile(url, fileName) {
  const response = await fetchWithClient(url, { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "PDF 生成失败");
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error("PDF 生成失败");
  const pdfBlob = blob.type === "application/pdf"
    ? blob
    : blob.slice(0, blob.size, "application/pdf");
  return new File([pdfBlob], fileName, { type: "application/pdf" });
}

export async function sharePdf({
  url,
  fileName,
  title,
  text,
  onDownloaded,
}) {
  const file = await fetchPdfFile(url, fileName);

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title, text, files: [file] });
    return { shared: true, file };
  }

  downloadBlob(file, fileName);
  onDownloaded?.();
  return { shared: false, file };
}
