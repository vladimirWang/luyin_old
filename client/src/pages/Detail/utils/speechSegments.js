import {
  cleanAnswerForDisplay,
  cleanQaVisibleText,
  pointLabelForIndex,
  stripQaInternalIndexMarkers,
} from "../../../utils/index.js";

export function compactSpeechText(value) {
  return stripQaInternalIndexMarkers(String(value || "").replace(/\s+/g, " ").trim());
}

export function speechSegmentsFromText(value, idPrefix = "content", label = "朗读内容", maxLength = 480) {
  const chunks = [];
  const appendChunk = (rawText) => {
    const cleaned = compactSpeechText(rawText);
    if (!cleaned) return;
    if (Array.from(cleaned).length <= maxLength) {
      chunks.push(cleaned);
      return;
    }
    let buffer = "";
    for (const char of Array.from(cleaned)) {
      if (Array.from(buffer).length >= maxLength) {
        chunks.push(buffer);
        buffer = "";
      }
      buffer += char;
    }
    if (buffer) chunks.push(buffer);
  };

  let current = "";
  String(value || "")
    .replace(/([。！？；])/g, "$1\n")
    .split(/\r?\n+/)
    .forEach((part) => {
      const cleaned = compactSpeechText(part);
      if (!cleaned) return;
      const next = current ? `${current} ${cleaned}` : cleaned;
      if (Array.from(next).length <= maxLength) {
        current = next;
        return;
      }
      appendChunk(current);
      current = "";
      appendChunk(cleaned);
    });
  appendChunk(current);

  return chunks.map((text, index) => ({
    id: `${idPrefix}-${index + 1}`,
    label: index === 0 ? label : `${label}${index + 1}`,
    text,
  }));
}

export function structuredSpeechSegments(structured) {
  const segments = [];
  const add = (id, label, text) => {
    const cleaned = compactSpeechText(text);
    if (cleaned) segments.push({ id, label, text: cleaned });
  };

  add("overall", "整体判断", structured?.overall_judgement);
  add("judgement-level", "判断等级", structured?.judgement_level ? `判断等级：${structured.judgement_level}` : "");
  if (Array.isArray(structured?.core_basis) && structured.core_basis.length) {
    add("core-basis", "核心依据", `核心依据：${structured.core_basis.join("；")}`);
  }
  (Array.isArray(structured?.analysis) ? structured.analysis : []).forEach((point, index) => {
    const title = compactSpeechText(point?.title) || pointLabelForIndex(index);
    add(`analysis-${index}-conclusion`, `${title}：结论`, `${title}。结论：${point?.conclusion || ""}`);
    add(`analysis-${index}-reason`, `${title}：原因`, `原因：${point?.reason || ""}`);
    add(`analysis-${index}-basis`, `${title}：关键依据`, `关键依据：${point?.basis || ""}`);
  });
  add("final", "最后结论", structured?.final_conclusion);
  return segments;
}

export function speechSegmentsForAnswerItem(item, structured) {
  if (!structured) {
    return speechSegmentsFromText(
      cleanAnswerForDisplay(item?.answer || item?.content || ""),
      "answer",
      "朗读结论",
    );
  }

  const clean = (value, fallback = "") => cleanQaVisibleText(value, fallback);
  const analysis = Array.isArray(structured.analysis)
    ? structured.analysis.map((point, index) => ({
        ...point,
        title: clean(point?.title, pointLabelForIndex(index)),
        conclusion: clean(point?.conclusion),
        reason: clean(point?.reason),
        basis: clean(point?.basis),
      }))
    : [];
  const evidences = Array.isArray(structured.evidences)
    ? structured.evidences.map((evidence, index) => ({
        ...evidence,
        evidence_title: clean(evidence?.evidence_title, `证据 ${index + 1}`),
        quote: clean(evidence?.quote),
        evidence_role: clean(evidence?.evidence_role),
      }))
    : [];
  const coreBasis = Array.isArray(structured.core_basis)
    ? structured.core_basis.map((basis) => clean(basis)).filter(Boolean)
    : [];
  return structuredSpeechSegments({
    ...structured,
    overall_judgement: clean(structured.overall_judgement),
    judgement_level: clean(structured.judgement_level),
    final_conclusion: clean(structured.final_conclusion),
    core_basis: coreBasis,
    analysis,
    evidences,
  });
}
