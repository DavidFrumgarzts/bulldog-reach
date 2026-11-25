// Read text from a PDF, Word (.docx) or plain-text file in the browser. Nothing is uploaded until the caller sends the text.
// Same approach as resume.js (pdf.js and mammoth from a CDN, loaded only when needed).
async function extractFileText(file) {
  if (!file) return "";
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith(".pdf")) {
    const pdfjs = await import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      const code = await fetch("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs").then((r) => r.text());
      pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    }
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    let out = "";
    for (let p = 1; p <= Math.min(pdf.numPages, 10); p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      let lastY = null;
      for (const it of tc.items) { const y = it.transform?.[5]; out += (lastY !== null && Math.abs(y - lastY) > 2 ? "\n" : " ") + it.str; lastY = y; }
      out += "\n\n";
    }
    return out.replace(/[ \t]+/g, " ").trim();
  }
  if (name.endsWith(".docx")) {
    if (!window.mammoth) await new Promise((ok, bad) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js"; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
    return (await window.mammoth.extractRawText({ arrayBuffer: buf })).value.trim();
  }
  return new TextDecoder().decode(buf).trim();
}
