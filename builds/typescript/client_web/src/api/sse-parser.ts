export type SSEEvent = {
  event: string;
  data: string;
};

function findFrameBoundary(buffer: string): { index: number; length: number } | null {
  const candidates = [
    { index: buffer.indexOf("\r\n\r\n"), length: 4 },
    { index: buffer.indexOf("\n\n"), length: 2 },
    { index: buffer.indexOf("\r\r"), length: 2 }
  ].filter((candidate) => candidate.index >= 0);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((earliest, candidate) =>
    candidate.index < earliest.index ? candidate : earliest
  );
}

function parseFrame(frame: string): SSEEvent | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of frame.split(/\r?\n|\r/g)) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    let value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);

    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "event" && value !== "") {
      event = value;
      continue;
    }

    if (field === "data") {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n")
  };
}

export async function* parseSSE(response: Response): AsyncIterable<SSEEvent> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      while (true) {
        const boundary = findFrameBoundary(buffer);
        if (!boundary) {
          break;
        }

        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);

        const parsed = parseFrame(frame);
        if (parsed) {
          yield parsed;
        }
      }

      if (done) {
        break;
      }
    }

    const trailingFrame = parseFrame(buffer);
    if (trailingFrame) {
      yield trailingFrame;
    }
  } finally {
    reader.releaseLock();
  }
}
