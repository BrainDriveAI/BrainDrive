import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";

import App from "./App";

function renderApp() {
  return render(
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

describe("App", () => {
  it("shows login screen on first load", () => {
    renderApp();

    expect(
      screen.getByText("Welcome back to your BrainDrive.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("navigates to main interface after login", async () => {
    const user = userEvent.setup();

    renderApp();

    await user.type(screen.getByLabelText("Username"), "testuser");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      screen.getAllByPlaceholderText("Message your BrainDrive...").length
    ).toBeGreaterThan(0);
  });
});
