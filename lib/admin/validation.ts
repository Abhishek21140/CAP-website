/**
 * Strict Google Drive and proof link validation.
 * Extracts canonical linkKey (Google file or folder ID) for duplicate detection.
 */
export function validateAndExtractDriveKey(urlStr: string): { isValid: boolean; linkKey: string | null; error?: string } {
  if (!urlStr || typeof urlStr !== "string") {
    return { isValid: false, linkKey: null, error: "Proof URL is required" };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    return { isValid: false, linkKey: null, error: "Invalid URL format" };
  }

  // Must strictly use HTTPS
  if (parsed.protocol !== "https:") {
    return { isValid: false, linkKey: null, error: "Only secure HTTPS URLs are allowed" };
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = [
    "drive.google.com",
    "docs.google.com",
    "photos.google.com",
  ];

  const isAllowedHost = allowedHosts.some(
    (h) => hostname === h || hostname.endsWith(`.${h}`)
  );

  if (!isAllowedHost) {
    return {
      isValid: false,
      linkKey: null,
      error: "Proof URL must be a valid Google Drive, Docs, or Photos link",
    };
  }

  // Extract canonical ID
  // 1. /file/d/{id}/...
  const fileMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch?.[1]) {
    return { isValid: true, linkKey: fileMatch[1] };
  }

  // 2. /folders/{id}
  const folderMatch = parsed.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) {
    return { isValid: true, linkKey: folderMatch[1] };
  }

  // 3. /document/d/{id}/... or /spreadsheets/d/{id}/... or /presentation/d/{id}/...
  const docsMatch = parsed.pathname.match(/\/(?:document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]+)/);
  if (docsMatch?.[1]) {
    return { isValid: true, linkKey: docsMatch[1] };
  }

  // 4. Query param id: ?id={id}
  const idParam = parsed.searchParams.get("id");
  if (idParam && /^[a-zA-Z0-9_-]+$/.test(idParam)) {
    return { isValid: true, linkKey: idParam };
  }

  // Fallback for valid drive URLs without standard ID structure: use pathname + search
  const normalizedFallback = `${hostname}${parsed.pathname}`;
  return { isValid: true, linkKey: normalizedFallback };
}

/**
 * Validates review decision input parameters strictly.
 */
export function validateDecisionInput(params: {
  decision: string;
  pointsAwarded?: number;
  reasonFeedback?: string;
  maxPoints: number;
}): { isValid: boolean; error?: string } {
  if (!["approved", "needs_changes", "rejected"].includes(params.decision)) {
    return { isValid: false, error: "Invalid decision. Must be approved, needs_changes, or rejected." };
  }

  const reason = params.reasonFeedback?.trim();

  if (params.decision === "needs_changes") {
    if (!reason || reason.length < 5) {
      return { isValid: false, error: "Please provide at least 5 characters of feedback for requested changes." };
    }
  }

  if (params.decision === "rejected") {
    if (!reason || reason.length < 5) {
      return { isValid: false, error: "Please provide at least 5 characters of feedback explaining the rejection." };
    }
  }

  if (params.decision === "approved") {
    if (params.pointsAwarded === undefined || !Number.isInteger(params.pointsAwarded)) {
      return { isValid: false, error: "Points awarded must be an integer." };
    }
    if (params.pointsAwarded < 0 || params.pointsAwarded > params.maxPoints) {
      return { isValid: false, error: `Points must be between 0 and ${params.maxPoints}.` };
    }
  }

  return { isValid: true };
}
