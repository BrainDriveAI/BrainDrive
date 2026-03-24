export async function promptForSecretInput(promptLabel: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive secret prompt requires a TTY");
  }

  process.stdout.write(promptLabel);
  return new Promise<string>((resolve, reject) => {
    let buffer = "";
    const stdin = process.stdin;
    const canSetRawMode = typeof stdin.setRawMode === "function";

    const cleanup = () => {
      stdin.off("data", onData);
      if (canSetRawMode) {
        stdin.setRawMode(false);
      }
      stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk: string | Buffer) => {
      const value = chunk.toString("utf8");
      for (const character of value) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Secret input canceled by user"));
          return;
        }

        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(buffer.trim());
          return;
        }

        if (character === "\u0008" || character === "\u007f") {
          buffer = buffer.slice(0, -1);
          continue;
        }

        buffer += character;
      }
    };

    if (canSetRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on("data", onData);
  });
}
