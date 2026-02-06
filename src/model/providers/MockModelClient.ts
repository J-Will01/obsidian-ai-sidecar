import { Attachment, ModelResult, ProposedChangeInput } from "../../state/types";
import { ModelClient, ModelRequest, ModelStreamHooks } from "../ModelClient";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBullets(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);

  if (lines.length === 0) {
    return "- (No content found)";
  }

  return lines.map((line) => `- ${line}`).join("\n");
}

function rewriteSelection(selected: string): string {
  const trimmed = selected.trim();
  if (!trimmed) {
    return selected;
  }

  return `Rewritten:\n${trimmed}`;
}

function findAttachment(attachments: Attachment[], type: Attachment["type"]): Attachment | undefined {
  return attachments.find((item) => item.type === type && item.included);
}

function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[^a-z0-9\-\s]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
  return cleaned || "consolidated-notes";
}

function buildResult(request: ModelRequest): ModelResult {
  const content = request.userMessage.trim();
  const lower = content.toLowerCase();
  const proposals: ProposedChangeInput[] = [];

  const selectionAttachment = findAttachment(request.attachments, "selection");
  const noteAttachment = findAttachment(request.attachments, "note");
  const searchAttachment = findAttachment(request.attachments, "search");

  let assistantText = "I reviewed the request and prepared a response.";

  if (lower.includes("rewrite") && selectionAttachment && noteAttachment && noteAttachment.source.path) {
    const rewritten = rewriteSelection(selectionAttachment.contentSnapshot);
    const originalContent = noteAttachment.contentSnapshot;
    const replaced = originalContent.includes(selectionAttachment.contentSnapshot)
      ? originalContent.replace(selectionAttachment.contentSnapshot, rewritten)
      : `${rewritten}\n\n${originalContent}`;

    proposals.push({
      action: "modify",
      path: noteAttachment.source.path,
      content: replaced,
      rationale: "Rewrite selected text in-place."
    });

    assistantText = "I drafted a rewrite for the attached selection and prepared a file change proposal.";
  } else if (lower.includes("summarize") && noteAttachment && noteAttachment.source.path) {
    const bullets = toBullets(noteAttachment.contentSnapshot);
    proposals.push({
      action: "modify",
      path: noteAttachment.source.path,
      content: `## Summary\n${bullets}\n\n${noteAttachment.contentSnapshot}`,
      rationale: "Insert summary bullets at the top of the note."
    });

    assistantText = "I created a summary block and prepared an insertion proposal at the top of the note.";
  } else if (lower.includes("consolid") && searchAttachment) {
    const match = lower.match(/about\s+(.+?)(?:\.|$)/i);
    const topic = (match?.[1] || "topic").trim();
    const fileName = `${sanitizeFileName(topic)}-consolidated.md`;

    proposals.push({
      action: "create",
      path: fileName,
      content: `# Consolidated Notes: ${topic}\n\n${searchAttachment.contentSnapshot}`,
      rationale: "Create a consolidated document from search results."
    });

    assistantText = "I prepared a consolidated note proposal from the search context.";
  } else {
    assistantText = [
      "I can read context, run vault search, and prepare file proposals.",
      "For a concrete edit proposal, try prompts like:",
      "- Rewrite the attached selection",
      "- Summarize the attached note into bullets",
      "- Find notes about X and create a consolidated doc"
    ].join("\n");
  }

  return {
    assistantText,
    proposals
  };
}

export class MockModelClient implements ModelClient {
  readonly id = "mock";

  async stream(request: ModelRequest, hooks?: ModelStreamHooks): Promise<ModelResult> {
    const result = buildResult(request);
    let partial = "";

    for (const token of result.assistantText.split(/(\s+)/)) {
      partial += token;
      hooks?.onToken?.(partial);
      await sleep(16);
    }

    return result;
  }
}
