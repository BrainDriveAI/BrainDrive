import { render, screen } from "@testing-library/react";
import { Save } from "lucide-react";

import { DocumentActionButton, DocumentButton, documentStyles } from "./DocumentSurface";

it.each(["default", "ghost"] as const)("shares native %s button treatment for text-only app actions", (variant) => {
  render(<>
    <DocumentButton variant={variant}><Save />Native</DocumentButton>
    <DocumentActionButton variant={variant}>App action</DocumentActionButton>
  </>);
  const native = screen.getByRole("button", { name: "Native" });
  const action = screen.getByRole("button", { name: "App action" });
  expect(native).toHaveClass("px-3", "has-[>svg]:px-2.5");
  expect(native).not.toHaveClass("px-2.5");
  expect(action).toHaveClass("px-2.5", "has-[>svg]:px-2.5");
  expect(action).not.toHaveClass("px-3");
  for (const button of [native, action]) {
    expect(button).toHaveAttribute("data-size", "sm");
    expect(button).toHaveAttribute("data-variant", variant);
    expect(button).toHaveClass("h-8", "rounded-md", ...(variant === "ghost" ? documentStyles.secondary : documentStyles.primary).split(" "));
  }
});
