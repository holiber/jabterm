export function setDocumentTitle(title: string): void {
  try {
    if (typeof document === "undefined") return;
    document.title = title;
  } catch {
    /* ignore */
  }
}

