export interface DiffLine {
  type: "context" | "add" | "remove";
  text: string;
}

function splitLines(input: string): string[] {
  return input.replace(/\r\n/g, "\n").split("\n");
}

export class DiffEngine {
  static hashContent(content: string): string {
    let hash = 2166136261;
    for (let i = 0; i < content.length; i += 1) {
      hash ^= content.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  static diffLines(before: string, after: string): DiffLine[] {
    const a = splitLines(before);
    const b = splitLines(after);
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        if (a[i] === b[j]) {
          dp[i][j] = dp[i + 1][j + 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    const out: DiffLine[] = [];
    let i = 0;
    let j = 0;

    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        out.push({ type: "context", text: a[i] });
        i += 1;
        j += 1;
        continue;
      }

      if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push({ type: "remove", text: a[i] });
        i += 1;
      } else {
        out.push({ type: "add", text: b[j] });
        j += 1;
      }
    }

    while (i < a.length) {
      out.push({ type: "remove", text: a[i] });
      i += 1;
    }

    while (j < b.length) {
      out.push({ type: "add", text: b[j] });
      j += 1;
    }

    return out;
  }

  static renderUnified(before: string, after: string): string {
    return this.diffLines(before, after)
      .map((line) => {
        if (line.type === "add") {
          return `+ ${line.text}`;
        }
        if (line.type === "remove") {
          return `- ${line.text}`;
        }
        return `  ${line.text}`;
      })
      .join("\n");
  }
}
